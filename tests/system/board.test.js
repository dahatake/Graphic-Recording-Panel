// FR-114 AC-667 AC-680 AC-669 AC-666 AC-681 AC-668 AC-665（System Test。契約: tests/system/CONTRACT-BOARD.md）
// 期待値は要求定義書の受入基準と PARAM だけから決める。web/ の実装の値は使わない（実装がなければ失敗するのが正常）。
// 1 ケースで (a)〜(i) と外部へのリクエスト 0 件、AC-680（名前を表示しない）を確かめる: node --test --test-name-pattern="AC-667|AC-680" tests/system/board.test.js
// (h) は実ブラウザ（perf-util の launch。Chromium 系）で描いた文字の範囲を getExtentOfChar で測る。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { newApp, toDetail, ROOT, FakeSpeech, CJK, pdfTexts } from './helpers.js';
import { parseSvg, contrast, rgb, lum } from './stylepreset-util.js';
import { linkedClock, weight } from './liveshow-util.js';
import { launch } from './perf-util.js';

// ---- PARAM（要求定義書 2026-11-04 の値） ----
const PARAM = {
  P007: 4.5, // 文字の最小コントラスト比
  P158_SEC: 3, // 単発の反映の上限（手入力・ファイル取込）
  P001_SEC: 60, P104_SEC: 2, // ライブ: AC-053 の上限 = PARAM-001 + PARAM-104（PARAM-001 は PARAM-099 の別名で 60 秒。1c4bd9d）
  P179: 6, // 要点のある区画の数の下限
  P180: 8, // 部品の種類の数の下限
  P181_MS: 600, // 出現・移動のアニメーションの時間の上限
  P190_SEC: 10, // 議論の流れのステップを無音で区切る間隔（AC-666。2026-11-05）
  P187: 0.5, // 強調（マーカー・下線）の位置のずれの上限（文字。font-size に対する比。2026-11-05）
  P011: 6, // ラベルの文字数の上限（全角。英語は半角 12。AC-680 の「名前を表示しない」）
  P126: '決まりました／決めました／決定／確定／承認／合意／採用する／に決めた／agreed／decided',
  P129: 'お願いします／してください／対応する／やります／確認します／共有します／調整します／対応します／連絡します／までに／担当／TODO／action item',
  P127: '保留／未定／持ち帰り／次回／検討中／pending／TBD',
  P131: '？／?／でしょうか／ですか／ますか／ませんか／でしょう／why／how／what',
  P132: 'なぜなら／たとえば／例えば／根拠／理由は／データでは／実績／because／for example／e.g.',
  P178: { purpose: '目的／ねらい／背景／経緯／趣旨／purpose／background', vision: '目指す／目指したい／あるべき姿／理想／将来像／to-be', members: '参加／出席／メンバー／attendee', themes: 'テーマ／論点／ポイント／課題／issue', memo: '補足／ちなみに／参考／メモ／note' },
};
const SECTIONS = ['purpose', 'members', 'flow', 'decisions', 'open', 'themes', 'vision', 'actions', 'memo'];
// 区画の順（並びの順）は PARAM-192 の初期の並びを上から左から読んだ順（FR-114 の列挙の順ではない）。AC-669 (4)
const ORDER192 = ['purpose', 'members', 'vision', 'flow', 'decisions', 'themes', 'open', 'actions', 'memo'];
const PART_KINDS = ['title', 'frame', 'badge', 'bubble', 'check', 'question', 'table', 'arrow', 'person', 'icon', 'emphasis'];
const FIX = path.join(ROOT, 'tests', 'system', 'fixtures');
const LINES = fs.readFileSync(path.join(FIX, 'teama-meeting.txt'), 'utf8').split(/\r?\n/).filter((l) => l.trim());
const EXPECTED = JSON.parse(fs.readFileSync(path.join(FIX, 'teama-meeting.expected.json'), 'utf8')).rows;

// ---- AC-665 の規則（文字だけで当てはめる。種類の判定と食い違わない発言だけで作った固定データに使う） ----
const words = (s) => s.split('／');
const isEn = (w) => /^[A-Za-z]/.test(w);
const partial = (t, ws) => ws.some((w) => t.toLowerCase().includes(w.toLowerCase()));
const wordHit = (t, ws) => ws.some((w) => new RegExp(`(?<![A-Za-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i').test(t));
const jpPartialEnWord = (t, s) => partial(t, words(s).filter((w) => !isEn(w))) || wordHit(t, words(s).filter(isEn));
const RULE_GROUPS = [
  ['decisions', (t) => partial(t, words(PARAM.P126))],
  ['actions', (t) => partial(t, words(PARAM.P129))],
  ['open', (t) => partial(t, words(PARAM.P127)) || jpPartialEnWord(t, PARAM.P131)],
  ...Object.entries(PARAM.P178).map(([k, s]) => [k, (t) => jpPartialEnWord(t, s)]),
  ['memo', (t) => jpPartialEnWord(t, PARAM.P132)],
];
const classify = (t) => (RULE_GROUPS.find(([, f]) => f(t)) ?? ['flow'])[0];

// ---- 幾何 ----
const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inside = (r, o, eps = 0.5) => r.x >= o.x - eps && r.y >= o.y - eps && r.x + r.w <= o.x + o.w + eps && r.y + r.h <= o.y + o.h + eps;
const isBox = (r) => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w >= 0 && r.h >= 0;

function checkGeometry(model, where) {
  assert.ok(model && Array.isArray(model.sections), `${where}: getBoardModel() がある`);
  assert.deepEqual(model.sections.map((s) => s.id).sort(), [...SECTIONS].sort(), `${where}: 9 つの区画`);
  const canvas = { x: 0, y: 0, w: model.canvas.w, h: model.canvas.h };
  const frames = model.sections.map((s) => ({ id: s.id, ...s.frame }));
  if (model.band) frames.push({ id: 'band', ...model.band });
  for (const f of frames) { assert.ok(isBox(f), `${where}: ${f.id} の外枠`); assert.ok(inside(f, canvas), `${where}: ${f.id} が図の領域に収まる`); }
  for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) assert.ok(overlapArea(frames[i], frames[j]) <= 0.5, `${where}: 区画 ${frames[i].id} と ${frames[j].id} が重ならない`);
  const els = [];
  for (const s of model.sections) for (const e of s.elements) {
    assert.ok(isBox(e), `${where}: ${s.id}/${e.id} の外枠`);
    assert.ok(inside(e, s.frame), `${where} (d): ${s.id}/${e.id} が自分の区画の枠からはみ出さない ${JSON.stringify(e)} ⊄ ${JSON.stringify(s.frame)}`);
    els.push({ ...e, sec: s.id });
  }
  assert.equal(new Set(els.map((e) => e.id)).size, els.length, `${where}: 要素の id は一意`);
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
    const a = els[i]; const b = els[j];
    if (a.parent === b.id || b.parent === a.id) continue; // 親子の包含は重なりに含めない（AC-430 (c)）
    assert.ok(overlapArea(a, b) <= 0.5, `${where} (d): ${a.sec}/${a.id} と ${b.sec}/${b.id} の外枠が重ならない`);
  }
}
const positions = (model) => new Map(model.sections.flatMap((s) => s.elements.map((e) => [e.id, { x: e.x, y: e.y, w: e.w, h: e.h }])));

// AC-669 (2)(7)(b):  要点のある区画は、横に並ぶ区画に揃えず自分の中身の高さなので、最後の要素の下の空き（枠の内側の余白だけ）が枠の高さの PARAM-188（20%）以下。
// 例外（最も高い区画の除外）はない。要点が 0 件の区画は対象外。
const P188 = 0.2;
function checkFill(model, where) {
  const withPts = new Set(model.assigned.map((a) => a.section));
  let measured = 0;
  for (const s of model.sections) {
    if (!(withPts.has(s.id) && s.elements.length)) continue;
    const gap = (s.frame.y + s.frame.h) - Math.max(...s.elements.map((e) => e.y + e.h));
    assert.ok(gap >= -0.5, `${where} (AC-669): ${s.id} の中身が枠に収まる`);
    assert.ok(gap / s.frame.h <= P188 + 0.005, `${where} (AC-669): ${s.id} の最後の要素の下の空き ${gap.toFixed(1)} は枠の高さ ${s.frame.h.toFixed(1)} の ${P188 * 100}% 以下（${(100 * gap / s.frame.h).toFixed(1)}%）`);
    measured++;
  }
  return measured;
}

// ---- SVG: 要点の区画・部品の種類・文字と直下の背景 ----
function ancestorAttr(n, name) { for (let p = n; p; p = p.parent) if (p.attrs[name] != null) return p.attrs[name]; return null; }
function pointSections(svg) {
  const doc = parseSvg(svg); const out = new Map();
  for (const n of doc.all) {
    const pid = n.attrs['data-point-id']; if (!pid) continue;
    const sec = ancestorAttr(n, 'data-board-section');
    if (!out.has(pid)) out.set(pid, new Set());
    if (sec) out.get(pid).add(sec);
  }
  return out;
}
const partKinds = (svg) => new Set([...parseSvg(svg).all].map((n) => n.attrs['data-board-part']).filter((k) => PART_KINDS.includes(k)));

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const I = [1, 0, 0, 1, 0, 0];
function parseTransform(s) {
  let m = I;
  for (const t of String(s ?? '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = t[2].trim().split(/[\s,]+/).map(Number);
    let k = I;
    if (t[1] === 'translate') k = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
    else if (t[1] === 'scale') k = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    else if (t[1] === 'matrix') k = v;
    else if (t[1] === 'rotate') { const a = (v[0] * Math.PI) / 180; const c = Math.cos(a); const sn = Math.sin(a); const r = [c, sn, -sn, c, 0, 0]; k = v.length >= 3 ? mul(mul([1, 0, 0, 1, v[1], v[2]], r), [1, 0, 0, 1, -v[1], -v[2]]) : r; }
    m = mul(m, k);
  }
  return m;
}
function ctm(n) { const chain = []; for (let p = n; p; p = p.parent) chain.unshift(p); return chain.reduce((m, p) => mul(m, parseTransform(p.attrs.transform)), I); }
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function pathPoints(d) {
  const pts = []; let x = 0; let y = 0; let sx = 0; let sy = 0;
  const toks = String(d ?? '').match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  let cmd = null; let i = 0;
  const num = () => Number(toks[i++]);
  const counts = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    if (!cmd) break;
    const U = cmd.toUpperCase(); const rel = cmd !== U;
    if (U === 'Z') { x = sx; y = sy; pts.push([x, y]); cmd = null; continue; }
    const v = []; for (let k = 0; k < counts[U]; k++) v.push(num());
    if (v.some((z) => !Number.isFinite(z))) break;
    const bx = rel ? x : 0; const by = rel ? y : 0;
    if (U === 'H') { x = bx + v[0]; pts.push([x, y]); continue; }
    if (U === 'V') { y = by + v[0]; pts.push([x, y]); continue; }
    if (U === 'A') { x = bx + v[5]; y = by + v[6]; pts.push([x - v[0], y - v[1]], [x + v[0], y + v[1]]); continue; }
    for (let k = 0; k < v.length; k += 2) pts.push([bx + v[k], by + v[k + 1]]);
    x = bx + v[v.length - 2]; y = by + v[v.length - 1];
    if (U === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; }
  }
  return pts;
}
function localBox(n) {
  const a = (k, d = 0) => Number(n.attrs[k] ?? d);
  if (n.tag === 'rect') return [[a('x'), a('y')], [a('x') + a('width'), a('y') + a('height')]];
  if (n.tag === 'circle') return [[a('cx') - a('r'), a('cy') - a('r')], [a('cx') + a('r'), a('cy') + a('r')]];
  if (n.tag === 'ellipse') return [[a('cx') - a('rx'), a('cy') - a('ry')], [a('cx') + a('rx'), a('cy') + a('ry')]];
  if (n.tag === 'polygon') return (n.attrs.points ?? '').trim().split(/[\s,]+/).map(Number).reduce((o, v, k, arr) => (k % 2 ? o : [...o, [v, arr[k + 1]]]), []);
  if (n.tag === 'path') return pathPoints(n.attrs.d);
  return [];
}
function worldBox(n) {
  const m = ctm(n); const pts = localBox(n).map(([x, y]) => apply(m, x, y)).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
const styleProp = (n, k) => { const m = String(n.attrs.style ?? '').match(new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([^;]+)`)); return m ? m[1].trim() : null; };
const prop = (n, k) => { for (let p = n; p; p = p.parent) { const v = styleProp(p, k) ?? p.attrs[k]; if (v != null) return v; } return null; };
function alphaOf(n) {
  let a = Number(styleProp(n, 'fill-opacity') ?? n.attrs['fill-opacity'] ?? 1);
  for (let p = n; p; p = p.parent) a *= Number(styleProp(p, 'opacity') ?? p.attrs.opacity ?? 1);
  return Number.isFinite(a) ? a : 1;
}
const hex = (v) => `#${v.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
function paintColor(doc, n, v) {
  if (!v) return '#000000'; // SVG の fill の既定は黒
  const u = v.match(/^url\(\s*['"]?#([^'")]+)['"]?\s*\)/);
  if (u) {
    let g = doc.all.find((x) => x.attrs.id === u[1]);
    let stops = g ? g.children.filter((c) => c.tag === 'stop') : [];
    const href = g && (g.attrs.href ?? g.attrs['xlink:href']);
    if (!stops.length && href) { g = doc.all.find((x) => `#${x.attrs.id}` === href); stops = g ? g.children.filter((c) => c.tag === 'stop') : []; }
    const cols = stops.map((s) => styleProp(s, 'stop-color') ?? s.attrs['stop-color']).filter((c) => rgb(c));
    assert.ok(cols.length, `グラデーション #${u[1]} の色を読める`);
    return cols.sort((a, b) => lum(b) - lum(a))[0]; // 最も明るい位置で測る（AC-667 (e)）
  }
  if (v === 'none' || v === 'transparent') return null;
  assert.ok(rgb(v), `色として解釈できる: ${v}`);
  return v;
}
const EXCLUDE = ['defs', 'clipPath', 'mask', 'pattern', 'marker', 'symbol', 'title', 'desc'];
function backgroundAt(doc, shapes, textIndex, px, py) {
  // 文字より前（文書順）に描かれ、その位置を覆う面を上から合成する。何もなければ白（紙面）
  const layers = shapes.filter((s) => s.n.index < textIndex && s.box && px >= s.box.x && px <= s.box.x + s.box.w && py >= s.box.y && py <= s.box.y + s.box.h);
  let color = [255, 255, 255];
  for (const s of layers) {
    const c = paintColor(doc, s.n, prop(s.n, 'fill')); if (!c) continue;
    const a = Math.max(0, Math.min(1, alphaOf(s.n))); if (a === 0) continue;
    const v = rgb(c); color = color.map((b, k) => a * v[k] + (1 - a) * b);
  }
  return hex(color);
}
function contrastFailures(svg) {
  const doc = parseSvg(svg); const fails = []; let n = 0;
  const shapes = doc.all.filter((s) => ['rect', 'circle', 'ellipse', 'path', 'polygon'].includes(s.tag) && !doc.within(s, EXCLUDE) && s.attrs['data-style-role'] !== 'paper-texture' && ancestorAttr(s, 'data-style-role') !== 'paper-texture').map((s) => ({ n: s, box: worldBox(s) })).filter((s) => s.box && s.box.w > 0 && s.box.h > 0);
  for (const t of doc.all.filter((x) => x.tag === 'text' && !doc.within(x, EXCLUDE))) {
    const str = t.text.trim(); if (!str) continue;
    const fill = paintColor(doc, t, prop(t, 'fill')); if (!fill) continue;
    const tsp = t.children.find((c) => c.tag === 'tspan' && c.attrs.x != null);
    const x = Number(t.attrs.x ?? tsp?.attrs.x ?? 0); const y = Number(t.attrs.y ?? tsp?.attrs.y ?? 0);
    const fsz = Number(String(prop(t, 'font-size') ?? '16').replace('px', '')) || 16;
    const anchor = prop(t, 'text-anchor') ?? 'start';
    const lx = anchor === 'middle' ? x : anchor === 'end' ? x - fsz * 0.5 : x + fsz * 0.5;
    const [px, py] = apply(ctm(t), lx, y - fsz * 0.35);
    const bg = backgroundAt(doc, shapes, t.index, px, py);
    const r = contrast(fill, bg); n++;
    if (r < PARAM.P007) fails.push(`「${str.slice(0, 12)}」 ${fill} on ${bg} = ${r.toFixed(2)}`);
  }
  return { fails, n };
}

// ---- 外部へのリクエストの記録 ----
function spyNetwork() {
  const calls = []; const saved = {};
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
  for (const k of names) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: function (...a) { calls.push({ k, a: String(a[0]) }); throw new Error('network blocked'); } });
  }
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { ...(nav?.value || {}), sendBeacon: (...a) => { calls.push({ k: 'sendBeacon', a: String(a[0]) }); return false; } } });
  return { calls, restore() { for (const k of names) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; } if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator; } };
}

// ---- (h) 強調の位置: 実ブラウザで SVG を描き、強調語の最初・最後の文字の実際の範囲（getExtentOfChar）と強調の外枠を画面の座標で返す ----
// 契約（CONTRACT-BOARD.md「強調」）: data-board-part="emphasis" の要素に data-emph-word（強調語）と data-emph-start（その text の文字列の中での
// 強調語の最初の文字の位置。0 始まり）。強調語の text は、強調の要素の祖先のまとまり（g）のどれかの子孫にある。
async function emphasisExtents(page, svg) {
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${svg}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const out = [];
    for (const e of document.querySelectorAll('[data-board-part="emphasis"]')) {
      const word = e.getAttribute('data-emph-word'); const start = Number(e.getAttribute('data-emph-start'));
      let t = null;
      if (word && Number.isInteger(start) && start >= 0) {
        for (let g = e.parentNode; g && !t && g.nodeType === 1; g = g.parentNode) {
          t = [...g.querySelectorAll('text')].find((x) => x.textContent.substr(start, word.length) === word) || null;
        }
      }
      if (!t) { out.push({ word, start, missing: true }); continue; }
      const m = t.getScreenCTM();
      const scr = (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
      const corners = (r) => [scr(r.x, r.y), scr(r.x + r.width, r.y), scr(r.x, r.y + r.height), scr(r.x + r.width, r.y + r.height)];
      const c0 = corners(t.getExtentOfChar(start)); const c1 = corners(t.getExtentOfChar(start + word.length - 1));
      const all = [...c0, ...c1];
      const b = e.getBoundingClientRect();
      out.push({
        word, start,
        left: Math.min(...c0.map((p) => p.x)), right: Math.max(...c1.map((p) => p.x)),
        top: Math.min(...all.map((p) => p.y)), bottom: Math.max(...all.map((p) => p.y)),
        eLeft: b.left, eRight: b.right, eTop: b.top, eBottom: b.bottom,
        fs: parseFloat(getComputedStyle(t).fontSize) * Math.hypot(m.a, m.b),
      });
    }
    return out;
  });
}

async function boardApp(over = {}) {
  const r = await newApp(over);
  r.app.setLang('ja');
  toDetail(r.app);
  const sel = r.app.setLayoutTypes(['board']);
  assert.equal(sel && sel.ok, true, '会議ボード型（board）を選べる');
  assert.equal(r.app.getLayoutInfo().head, 'board');
  r.advance = (ms) => { r.env.clock.t += ms; r.env.scheduler.advance(ms); };
  return r;
}
// ライブ描画ショーの確認用: テスト用の時計（タイマーの発火の時刻に now() を合わせる）で起動する
async function boardShowApp(over = {}) {
  const lc = linkedClock();
  const r = await boardApp({ ...lc, ...over });
  r.advance = (ms) => lc.scheduler.advance(ms);
  return r;
}
const pointCount = (svg) => new Set([...svg.matchAll(/data-point-id="([^"]+)"/g)].map((m) => m[1])).size;
const allPoints = (app) => app.getState().scenes.flatMap((s) => s.points);
const norm = (s) => String(s ?? '').replace(/[\s。．.、,]/g, '');
const lineOf = (text) => EXPECTED.find((e) => norm(e.text).includes(norm(text)) || norm(text).includes(norm(e.text)));

// FR-114 AC-667
test('FR-114 AC-667: 固定の文字起こし（TeamA との会議）を会議ボード型で 1 発言ずつ取り込むと、(a) 区画 6 以上 (b) 部品 8 種類以上 (c) 期待の表の区画 (d) 重なり・はみ出しなし (e) コントラスト 4.5 以上（15 の描画スタイル）(f) 600ms 以内の途中を経由する移動（動きを減らす設定ではなし）(g) 反映の時間 (h) 強調の左右端のずれ 0.5 文字以下（実ブラウザ・15 の描画スタイル）(i) 議論の流れの 4 つ以上のステップ（番号バッジ・吹き出し・人物が 1 組ずつ、間ごとに矢印）、外部へのリクエスト 0 件', async () => {
  // ---- 0. 固定データの自己検証（期待の表は PARAM から作り直せる） ----
  assert.ok(LINES.length >= 15 && LINES.length <= 25, `15〜25 発言（${LINES.length}）`);
  assert.equal(EXPECTED.length, LINES.length);
  LINES.forEach((t, i) => {
    assert.equal(EXPECTED[i].text, t, `期待の表の ${i + 1} 行目は文字起こしの同じ行`);
    assert.ok([...t].length <= 24, `PARAM-165 以内（${t}）`);
    const hits = RULE_GROUPS.filter(([, f]) => f(t)).length;
    assert.ok(hits <= 1, `規則の語の組にちょうど 1 つだけ当たる（${t}: ${hits}）`);
    assert.equal(classify(t), EXPECTED[i].section, `期待の表は AC-665 の規則の結果（${t}）`);
  });
  const by = (sec) => EXPECTED.filter((e) => e.section === sec);
  for (const sec of SECTIONS) assert.ok(by(sec).length >= 1, `固定データに ${sec} の発言がある`);
  assert.ok(by('flow').length >= 4, '議論の 4 つのトピック');
  for (const e of by('actions')) assert.ok(/さん|担当/.test(e.text) && /まで/.test(e.text), `次アクションは担当・期限付き（${e.text}）`);

  const net = spyNetwork();
  try {
    // ---- 1. 手入力で 1 発言ずつ: (c)(d)(f)(g) ----
    const { app, env, advance } = await boardApp();
    app.commands['session.start']();
    let svg = app.renderSvg();
    assert.match(svg, /data-layout-head="board"/);
    checkGeometry(app.getBoardModel(), '発話 0 件');
    let moved = 0;
    const feed = (text, where) => {
      const before = positions(app.getBoardModel());
      const n0 = pointCount(app.renderSvg());
      const t0 = performance.now(); const c0 = env.clock.t;
      app.setDraft(text);
      assert.equal(app.submitDraft().ok, true, `${where}: 取込`);
      // (g) 受付から図への表示まで: 実時間・アプリの時刻とも PARAM-158 以内
      let shownAt = null; const samples = [];
      for (let dt = 0; dt <= 1600; dt += 50) {
        if (dt) advance(50);
        if (shownAt == null && pointCount(app.renderSvg()) > n0) shownAt = { real: performance.now() - t0, app: env.clock.t - c0 };
        samples.push({ dt, pos: positions(app.getBoardModel()) });
      }
      assert.ok(shownAt, `${where} (g): 要点が図に表示される`);
      assert.ok(shownAt.real <= PARAM.P158_SEC * 1000 && shownAt.app <= PARAM.P158_SEC * 1000, `${where} (g): ${PARAM.P158_SEC} 秒以内（実 ${shownAt.real.toFixed(0)}ms・アプリ ${shownAt.app}ms）`);
      const final = samples.at(-1).pos;
      // (f) 位置が変わった既存の要素は 600ms 以内に着き、途中の位置を経由する
      for (const [id, p0] of before) {
        const pf = final.get(id); if (!pf) continue;
        const dx = pf.x - p0.x; const dy = pf.y - p0.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) continue;
        moved++;
        const axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
        const [lo, hi] = [Math.min(p0[axis], pf[axis]), Math.max(p0[axis], pf[axis])];
        const mid = samples.filter((s) => s.dt <= PARAM.P181_MS).map((s) => s.pos.get(id)?.[axis]).filter((v) => Number.isFinite(v) && v > lo + 0.5 && v < hi - 0.5);
        assert.ok(mid.length >= 1, `${where} (f): ${id} は途中の位置を経由して移る（${p0[axis]}→${pf[axis]}）`);
        for (const s of samples.filter((q) => q.dt >= PARAM.P181_MS)) {
          const q = s.pos.get(id);
          assert.ok(Math.abs(q.x - pf.x) <= 0.5 && Math.abs(q.y - pf.y) <= 0.5, `${where} (f): ${id} は ${PARAM.P181_MS}ms 以内に新しい位置に着く（${s.dt}ms）`);
        }
      }
      checkGeometry(app.getBoardModel(), where);
      checkFill(app.getBoardModel(), where);
    };
    LINES.forEach((t, i) => {
      // (i) 議論の 4 つのトピック（FR-025 の分類で別のトピックになる発言）として、流れの発言の前に［次のシーン］を入れる
      if (EXPECTED[i].section === 'flow') app.commands['session.nextScene']();
      feed(t, `${i + 1} 行目`);
    });
    // あふれによる詰め直しが起きなかったときは、同じ区画（目的・背景）に要点を足して、あふれさせて確かめる（どこまでも枠が足りるなら (d) が破れる）
    for (let k = 1; moved === 0 && k <= 12; k++) feed(`目的その${k}は品質の底上げ`, `追加 ${k}`);
    assert.ok(moved >= 1, '(f) あふれによる詰め直しで位置が変わる要素が観察できる');

    // (c) 各要点が期待の表の区画にある（図の上の区画と、モデルの振り分けの両方）
    svg = app.renderSvg();
    const secOf = pointSections(svg);
    const model = app.getBoardModel();
    const assigned = new Map(model.assigned.map((a) => [a.pointId, a.section]));
    const pts = allPoints(app).filter((p) => lineOf(p.text));
    assert.ok(pts.length >= LINES.length, `文字起こしの各発言が要点になる（${pts.length}）`);
    for (const e of EXPECTED) assert.ok(pts.some((p) => lineOf(p.text) === e), `「${e.text}」の要点がある`);
    for (const p of pts) {
      const want = lineOf(p.text).section;
      assert.deepEqual([...(secOf.get(p.id) ?? [])], [want], `(c) 「${p.text}」は図の ${want} の区画にだけある`);
      assert.equal(assigned.get(p.id), want, `(c) 「${p.text}」の振り分けは ${want}`);
    }
    // (a) 要点のある区画の数、(b) 部品の種類の数
    const withPoints = new Set([...secOf.values()].flatMap((s) => [...s]));
    assert.ok(withPoints.size >= PARAM.P179, `(a) 要点のある区画が ${PARAM.P179} 個以上（${[...withPoints]}）`);
    const kinds = partKinds(svg);
    assert.ok(kinds.size >= PARAM.P180, `(b) 部品の種類が ${PARAM.P180} 種類以上（${[...kinds]}）`);
    // (i) 議論の流れ: 4 つの流れの発言が 4 つ以上の別々のステップに分かれ、各ステップに番号バッジ・吹き出し・人物が 1 組ずつ、
    //     隣り合うステップの間ごとに矢印（⇒）。契約: CONTRACT-BOARD.md「議論の流れのステップ」
    {
      const doc = parseSvg(svg);
      const secOfNode = (n) => ancestorAttr(n, 'data-board-section');
      const stepOf = (n) => ancestorAttr(n, 'data-board-step');
      const flowPts = by('flow').map((e) => allPoints(app).find((p) => lineOf(p.text) === e));
      assert.ok(flowPts.every(Boolean) && flowPts.length >= 4, '(i) 流れの 4 発言が要点になる');
      const stepsOfPts = flowPts.map((p) => { const n = doc.all.find((x) => x.attrs['data-point-id'] === p.id && secOfNode(x) === 'flow'); return n ? stepOf(n) : null; });
      assert.ok(stepsOfPts.every((s) => s != null), `(i) 流れの各発言はステップの中にある（${stepsOfPts}）`);
      assert.equal(new Set(stepsOfPts).size, flowPts.length, `(i) 流れの 4 発言は別々のステップ（${stepsOfPts}）`);
      const steps = [...new Set(doc.all.filter((n) => n.attrs['data-board-step'] != null && secOfNode(n) === 'flow').map((n) => n.attrs['data-board-step']))].map(Number).sort((a, b) => a - b);
      assert.ok(steps.length >= 4 && steps.every(Number.isInteger), `(i) ステップが 4 つ以上（${steps}）`);
      const badgeTexts = [];
      for (const k of steps) {
        const inStep = doc.all.filter((n) => n.attrs['data-board-part'] && stepOf(n) === String(k));
        for (const part of ['badge', 'bubble', 'person']) assert.equal(inStep.filter((n) => n.attrs['data-board-part'] === part).length, 1, `(i) ステップ ${k} に ${part} が 1 つ`);
        badgeTexts.push(inStep.find((n) => n.attrs['data-board-part'] === 'badge').text.trim());
      }
      assert.equal(new Set(badgeTexts).size, steps.length, `(i) 番号バッジは別々の番号（${badgeTexts}）`);
      assert.ok(badgeTexts.every((b) => b.length > 0), '(i) 番号バッジに番号の文字がある');
      const arrows = doc.all.filter((n) => n.attrs['data-board-part'] === 'arrow' && secOfNode(n) === 'flow');
      for (let j = 0; j + 1 < steps.length; j++) {
        const want = `${steps[j]},${steps[j + 1]}`;
        assert.ok(arrows.some((a) => String(a.attrs['data-between']).replace(/\s/g, '') === want && stepOf(a) == null), `(i) ステップ ${steps[j]} と ${steps[j + 1]} の間に矢印（data-between="${want}"）`);
      }
    }
    assert.ok(checkFill(model, '全発言の後') >= 1, '(AC-669) 並びのほかの区画で、空きを測れた');
    // (i)（シーンの区切りなし）AC-666: ［次のシーン］を使わず、同じシーン・同じトピックの会議でも、話題の変わり目で別のステップに分かれる。
    //   (1) 無音 PARAM-190（10 秒）以上、(2) 話題語の入れ替わり（同じステップの要点と異なる語句を PARAM-015＝2 語以上共有しない）
    {
      const flowSteps = async (lines, gapMs, where) => {
        const r = await boardApp();
        r.app.commands['session.start']();
        for (const t of lines) {
          assert.equal(classify(t), 'flow', `${where}: 「${t}」は議論の流れの発言（AC-665 の規則のどの語にも当たらない）`);
          r.app.setDraft(t); assert.equal(r.app.submitDraft().ok, true, `${where}: 取込`);
          r.advance(gapMs); // 次の発話の受付までの無音（PARAM-002 の 20 秒より短くする。シーンは分かれない）
        }
        r.advance(1600);
        assert.equal(r.app.getState().scenes.length, 1, `${where}: シーンの区切りがない（1 シーン）`);
        checkGeometry(r.app.getBoardModel(), where);
        checkFill(r.app.getBoardModel(), where);
        const d = parseSvg(r.app.renderSvg());
        const inFlow = d.all.filter((n) => ancestorAttr(n, 'data-board-section') === 'flow' && n.attrs['data-board-step'] != null);
        const steps = [...new Set(inFlow.map((n) => n.attrs['data-board-step']))].map(Number).sort((a, b) => a - b);
        for (const k of steps) for (const part of ['badge', 'bubble', 'person']) assert.equal(d.all.filter((n) => n.attrs['data-board-part'] === part && ancestorAttr(n, 'data-board-step') === String(k)).length, 1, `${where}: ステップ ${k} に ${part} が 1 つ`);
        const arrows = d.all.filter((n) => n.attrs['data-board-part'] === 'arrow' && ancestorAttr(n, 'data-board-section') === 'flow' && n.attrs['data-between'] != null);
        for (let j = 0; j + 1 < steps.length; j++) assert.ok(arrows.some((a) => String(a.attrs['data-between']).replace(/\s/g, '') === `${steps[j]},${steps[j + 1]}`), `${where}: ステップ ${steps[j]} と ${steps[j + 1]} の間に矢印`);
        return steps;
      };
      // 語句を 2 つ以上共有する 4 発言（話題語は入れ替わらない）。区切りになりうるのは無音だけ
      const SAME_TOPIC = ['intake queue morning load', 'intake queue noon load', 'intake queue evening load', 'intake queue night load'];
      // 語句を共有しない 4 発言（話題語が入れ替わる）。無音はない
      const SWAP_TOPIC = ['intake queue morning load', 'billing refund policy draft', 'chatbot prototype demo scenario', 'vendor outsourcing cost estimate'];
      const silent = await flowSteps(SAME_TOPIC, PARAM.P190_SEC * 1000, '(i) 無音 10 秒');
      assert.equal(silent.length, 4, `(i) 無音が PARAM-190（${PARAM.P190_SEC} 秒）以上の 4 発言は 4 つのステップ（${silent}）`);
      const swapped = await flowSteps(SWAP_TOPIC, 0, '(i) 話題語の入れ替わり');
      assert.equal(swapped.length, 4, `(i) 話題語が入れ替わる 4 発言は無音がなくても 4 つのステップ（${swapped}）`);
      // 異常系: 無音が PARAM-190 より短く、話題語も入れ替わらないときは区切らない（1 つのステップ）
      const short = await flowSteps(SAME_TOPIC, PARAM.P190_SEC * 1000 - 1000, '(i) 無音 9 秒・同じ話題語');
      assert.equal(short.length, 1, `(i) 無音が ${PARAM.P190_SEC} 秒未満で話題語が同じなら 1 つのステップ（${short}）`);
    }
    assert.ok(!/<image\b|<foreignObject\b/i.test(svg) && !/(?:href|url\()\s*=?\s*["']?(?:https?:)?\/\//i.test(svg), 'SVG だけで外部参照なし');

    // (e) 見出し・ラベル・表の文字と直下の背景: 11 の画風と既存の 4 つ（計 15）のすべて
    const styles = app.getDrawStyles();
    assert.equal(styles.length, 15, '描画スタイルは 15（既存の 4 つ＋11 の画風）');
    const styleSvgs = [];
    for (const s of styles) {
      assert.equal(app.setDrawStyle(s.id).ok, true, s.id);
      const { fails, n } = contrastFailures(app.renderSvg());
      assert.ok(n >= LINES.length, `${s.label}: 文字を測った（${n}）`);
      assert.deepEqual(fails, [], `(e) ${s.label}: 文字と直下の背景のコントラスト比が ${PARAM.P007} 以上`);
      checkGeometry(app.getBoardModel(), `${s.label} の図`);
      checkFill(app.getBoardModel(), `${s.label} の図`);
      styleSvgs.push([s.label, app.renderSvg()]);
    }

    // (h) 強調（マーカー・下線）は、強調語の描かれた文字の実際の範囲（実ブラウザで描いた後に getExtentOfChar で測る）に重なり、
    //     左端・右端のずれがそれぞれ PARAM-187 文字（font-size の比）以下（15 の描画スタイルのすべて）
    {
      const browser = await launch();
      try {
        const page = await (await browser.newContext({ viewport: { width: 1600, height: 1200 } })).newPage();
        let measured = 0;
        for (const [label, s] of styleSvgs) {
          const res = await emphasisExtents(page, s);
          for (const r of res) {
            assert.ok(!r.missing, `(h) ${label}: 強調に data-emph-word・data-emph-start があり、その文字が同じまとまりの text にある（${r.word}@${r.start}）`);
            const tol = PARAM.P187 * r.fs;
            assert.ok(Math.abs(r.eLeft - r.left) <= tol, `(h) ${label}: 「${r.word}」の強調の左端のずれ ${(r.eLeft - r.left).toFixed(1)} ≤ ${tol.toFixed(1)}`);
            assert.ok(Math.abs(r.eRight - r.right) <= tol, `(h) ${label}: 「${r.word}」の強調の右端のずれ ${(r.eRight - r.right).toFixed(1)} ≤ ${tol.toFixed(1)}`);
            assert.ok(r.eBottom >= r.top - tol && r.eTop <= r.bottom + tol, `(h) ${label}: 「${r.word}」の強調は文字の範囲に縦にも重なる`);
            measured++;
          }
        }
        assert.ok(measured >= 1, `(h) 強調を測った（${measured}）`);
      } finally { await browser.close(); }
    }

    // ---- 2. 動きを減らす設定: 位置の変化はアニメーションなし（取込の直後から新しい位置） ----
    const rm = await boardApp({ options: { env: { webgl: true, reducedMotion: true, viewportWidth: 1280 } } });
    rm.app.commands['session.start']();
    for (const t of LINES) {
      rm.app.setDraft(t); rm.app.submitDraft();
      const now = positions(rm.app.getBoardModel());
      rm.advance(PARAM.P181_MS + 400);
      for (const [id, p] of positions(rm.app.getBoardModel())) {
        const q = now.get(id); if (!q) continue;
        assert.ok(Math.abs(q.x - p.x) <= 0.5 && Math.abs(q.y - p.y) <= 0.5, `(f) 動きを減らす設定: ${id} は取込の直後から新しい位置（${t}）`);
      }
    }

    // ---- 3. ファイル取込（.txt）: PARAM-158 以内に全発言が図に出て、区画は期待の表のとおり ----
    const fi = await boardApp();
    const text = LINES.join('\n');
    const t0 = performance.now(); const c0 = fi.env.clock.t;
    const r = await fi.app.importTextFile({ name: 'teama-meeting.txt', type: 'text/plain', size: Buffer.byteLength(text), text });
    assert.equal(r.ok, true, 'ファイル取込');
    let shown = false;
    for (let dt = 0; dt <= PARAM.P158_SEC * 1000 && !shown; dt += 100) { if (dt) fi.advance(100); shown = pointCount(fi.app.renderSvg()) >= LINES.length; }
    assert.ok(shown && performance.now() - t0 <= PARAM.P158_SEC * 1000 && fi.env.clock.t - c0 <= PARAM.P158_SEC * 1000, `(g) ファイル取込: ${PARAM.P158_SEC} 秒以内に全発言が図に出る`);
    fi.advance(1600);
    const fsec = pointSections(fi.app.renderSvg());
    for (const p of allPoints(fi.app).filter((q) => lineOf(q.text))) assert.deepEqual([...(fsec.get(p.id) ?? [])], [lineOf(p.text).section], `(c) ファイル取込: 「${p.text}」`);
    checkGeometry(fi.app.getBoardModel(), 'ファイル取込の後');

    // ---- 4. ライブ（音声の確定結果）: AC-053 の上限（PARAM-001＋PARAM-104 秒）以内 ----
    const lv = await boardApp({ speech: new FakeSpeech() });
    lv.app.commands['session.start']();
    // 更新間隔を設定できる最大（PARAM-099 = PARAM-001）にして、上限の境界で測る
    assert.equal(lv.app.setLiveInterval(PARAM.P001_SEC).ok, true, '更新間隔を PARAM-001 秒にできる');
    for (const t of LINES.slice(0, 3)) {
      const n0 = pointCount(lv.app.renderSvg()); const c1 = lv.env.clock.t;
      lv.env.speech.emit(t, true);
      let ok = false;
      for (let dt = 0; dt <= (PARAM.P001_SEC + PARAM.P104_SEC) * 1000 && !ok; dt += 500) {
        if (dt) lv.advance(500);
        const tr = performance.now(); ok = pointCount(lv.app.renderSvg()) > n0;
        if (ok) assert.ok(performance.now() - tr <= PARAM.P104_SEC * 1000, `(g) ライブ: 描画は ${PARAM.P104_SEC} 秒以内`);
      }
      assert.ok(ok && lv.env.clock.t - c1 <= (PARAM.P001_SEC + PARAM.P104_SEC) * 1000, `(g) ライブ: 「${t}」が ${PARAM.P001_SEC + PARAM.P104_SEC} 秒以内に図に出る`);
      lv.advance(1600);
      checkGeometry(lv.app.getBoardModel(), `ライブ「${t}」の後`);
    }

    // ---- 5. ライブ描画ショー（FR-115）ON（1c4bd9d）: 手入力・ファイル取込は PARAM-158 秒以内（演出で待たせない）、
    //         ライブは AC-053 の上限を描画の開始（最初の要素の描線の開始）に当てはめる（演出の完了は AC-675） ----
    const sm = await boardShowApp();
    assert.equal(sm.app.setLiveShow(true).ok, true, 'ショー ON');
    sm.app.commands['session.start']();
    for (const t of LINES.slice(0, 3)) {
      const n0 = pointCount(sm.app.renderSvg());
      sm.app.setDraft(t); assert.equal(sm.app.submitDraft().ok, true);
      sm.advance(PARAM.P158_SEC * 1000);
      assert.ok(pointCount(sm.app.renderSvg()) > n0, `(g) ショー ON・手入力: 「${t}」が ${PARAM.P158_SEC} 秒以内に図に出る`);
      assert.equal(sm.app.getLiveShow().running, false, `(g) ショー ON・手入力: ${PARAM.P158_SEC} 秒の時点で演出の途中ではない`);
      checkGeometry(sm.app.getBoardModel(), `ショー ON・手入力「${t}」の後`);
    }
    const sf = await boardShowApp();
    assert.equal(sf.app.setLiveShow(true).ok, true);
    assert.equal((await sf.app.importTextFile({ name: 'teama-meeting.txt', type: 'text/plain', size: Buffer.byteLength(text), text })).ok, true);
    sf.advance(PARAM.P158_SEC * 1000);
    assert.ok(pointCount(sf.app.renderSvg()) >= LINES.length, `(g) ショー ON・ファイル取込: ${PARAM.P158_SEC} 秒以内に全発言が図に出る`);
    assert.equal(sf.app.getLiveShow().running, false, `(g) ショー ON・ファイル取込: ${PARAM.P158_SEC} 秒の時点で演出の途中ではない`);
    checkGeometry(sf.app.getBoardModel(), 'ショー ON・ファイル取込の後');
    const sl = await boardShowApp({ speech: new FakeSpeech() });
    assert.equal(sl.app.setLiveShow(true).ok, true);
    sl.app.commands['session.start']();
    assert.equal(sl.app.setLiveInterval(PARAM.P001_SEC).ok, true);
    const LIVE_LIMIT = (PARAM.P001_SEC + PARAM.P104_SEC) * 1000;
    for (const t of LINES.slice(0, 2)) {
      sl.advance(10);
      const c1 = sl.env.clock.t;
      sl.env.speech.emit(t, true);
      let startAt = null;
      for (let dt = 0; dt <= LIVE_LIMIT && startAt === null; dt += 100) {
        if (dt) sl.advance(100);
        startAt = (sl.app.getLiveShow().log ?? []).find((e) => e.type === 'stroke' && e.at >= c1)?.at ?? null;
      }
      assert.ok(startAt !== null && startAt - c1 <= LIVE_LIMIT, `(g) ショー ON・ライブ: 「${t}」の描画の開始（最初の描線）が ${LIVE_LIMIT / 1000} 秒以内（${startAt === null ? '未開始' : `${startAt - c1} ms`}）`);
      sl.advance(PARAM.P001_SEC * 1000 - PARAM.P104_SEC * 1000); // 1 間隔ぶん進めて演出を終える（完了の時間は AC-675）
      assert.equal(sl.app.getLiveShow().running, false, `(g) ショー ON・ライブ: 「${t}」の演出が終わる`);
      assert.ok(allPoints(sl.app).some((p) => norm(p.text).includes(norm(t)) || norm(t).includes(norm(p.text))), `(g) ショー ON・ライブ: 「${t}」が要点になる`);
      checkGeometry(sl.app.getBoardModel(), `ショー ON・ライブ「${t}」の後`);
    }

    // ---- (f) ライブ描画ショー ON の例外（AC-667 (f)。別のケースは作らず E2E-289 の中で測る。A-933 2026-11-05） ----
    //   単発の反映（手入力）は ON でも (f) のまま: 位置が変わる既存の要素は途中の位置を経て PARAM-181 以内に着く。
    //   ライブの更新間隔ごとの描き足し 1 回は (f) に代えて AC-674 の運ぶ動き（800 ms 以内・途中の位置を経る）・AC-673 の描線（1200 ms）と書き込み（1 字 80 ms）の上限に従う。
    {
      const so = await boardShowApp();
      assert.equal(so.app.setLiveShow(true).ok, true);
      so.app.commands['session.start']();
      let movedOn = 0;
      const feedOn = (text, where) => {
        const before = positions(so.app.getBoardModel());
        so.app.setDraft(text); assert.equal(so.app.submitDraft().ok, true, `${where}: 取込`);
        const samples = [];
        for (let dt = 0; dt <= 1600; dt += 50) { if (dt) so.advance(50); samples.push({ dt, pos: positions(so.app.getBoardModel()) }); }
        const final = samples.at(-1).pos;
        for (const [id, p0] of before) {
          const pf = final.get(id); if (!pf) continue;
          const dx = pf.x - p0.x; const dy = pf.y - p0.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) continue;
          movedOn++;
          const axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
          const [lo, hi] = [Math.min(p0[axis], pf[axis]), Math.max(p0[axis], pf[axis])];
          const mid = samples.filter((s) => s.dt <= PARAM.P181_MS).map((s) => s.pos.get(id)?.[axis]).filter((v) => Number.isFinite(v) && v > lo + 0.5 && v < hi - 0.5);
          assert.ok(mid.length >= 1, `${where} (f) ショー ON・単発の反映: ${id} は途中の位置を経由して移る（${p0[axis]}→${pf[axis]}）`);
          for (const s of samples.filter((q) => q.dt >= PARAM.P181_MS)) {
            const q = s.pos.get(id);
            assert.ok(Math.abs(q.x - pf.x) <= 0.5 && Math.abs(q.y - pf.y) <= 0.5, `${where} (f) ショー ON・単発の反映: ${id} は ${PARAM.P181_MS}ms 以内に新しい位置に着く（${s.dt}ms）`);
          }
        }
        checkGeometry(so.app.getBoardModel(), `ショー ON・単発 ${where}`);
      };
      LINES.forEach((t, i) => { if (EXPECTED[i].section === 'flow') so.app.commands['session.nextScene'](); feedOn(t, `ショー ON ${i + 1} 行目`); });
      for (let k = 1; movedOn === 0 && k <= 12; k++) feedOn(`目的その${k}は品質の底上げ`, `ショー ON 追加 ${k}`);
      assert.ok(movedOn >= 1, '(f) ショー ON・単発の反映: 位置が変わる要素が観察できる');
      // ライブの更新間隔ごとの描き足し（AC-673・AC-674）
      const lo = await boardShowApp({ speech: new FakeSpeech() });
      assert.equal(lo.app.setLiveShow(true).ok, true);
      lo.app.commands['session.start']();
      const DT = 20; const carry = new Map(); const strokes = new Map(); let midway = false; let live = 0;
      for (let g = 0; g < LINES.length; g += 3) {
        for (const t of LINES.slice(g, g + 3)) lo.env.speech.emit(t, true);
        for (let t = 0; t <= PARAM.P001_SEC * 1000 / 6; t += DT) { // 更新間隔（PARAM-100 = 10 秒）の間を細かく観測する
          lo.advance(DT);
          const s = lo.app.getLiveShow();
          for (const m of s.moves ?? []) {
            if (m.phase !== 'carry') continue;
            const k = `${g}:${m.id}`; const c = carry.get(k);
            if (c && t - c.last <= DT * 2.5) { c.end = t; c.last = t; } else { carry.set(`${k}@${t}`, { start: t, end: t, last: t }); carry.set(k, carry.get(`${k}@${t}`)); } // 途切れずに続いた 1 回の運ぶ動き
            const between = (k) => Math.min(m.from[k], m.to[k]) - 0.5 <= m.at[k] && m.at[k] <= Math.max(m.from[k], m.to[k]) + 0.5;
            if (between('x') && between('y') && (m.at.x !== m.from.x || m.at.y !== m.from.y) && (m.at.x !== m.to.x || m.at.y !== m.to.y)) midway = true;
          }
          for (const x of s.items ?? []) if (x.phase === 'stroke') { const c = strokes.get(`${g}:${x.id}`) ?? { start: t, end: t }; c.end = t; strokes.set(`${g}:${x.id}`, c); live++; }
        }
      }
      assert.ok(live >= 1, '(f) ショー ON・ライブ: 描き足しの描線が観測できる（AC-673）');
      assert.ok(carry.size >= 1 && midway, '(f) ショー ON・ライブ: 位置が変わる既存の要素は、途中の位置を経て運ばれる（AC-674）');
      for (const [id, c] of carry) assert.ok(c.end - c.start <= 800 + DT, `(f) ショー ON・ライブ: ${id} の運ぶ動き ${c.end - c.start} ms は 800 ms（AC-674）以内`);
      for (const [id, c] of strokes) assert.ok(c.end - c.start <= 1200 + DT, `(f) ショー ON・ライブ: ${id} の描線 ${c.end - c.start} ms は 1200 ms（AC-673）以内`);
      checkGeometry(lo.app.getBoardModel(), 'ショー ON・ライブ描き足しの後');
    }

    // 外部へのリクエストは 0 件（LLM 連携は既定のまま無効）
    assert.deepEqual(net.calls, [], '外部へのリクエストは 0 件');
  } finally {
    net.restore();
  }
});

// FR-114 AC-680（契約: CONTRACT-BOARD.md「人物の名前」「名前を表示しない」）
test('FR-114 AC-680: ［設定］の「名前を表示しない」は既定オフ（名前を表示）で、キーボードだけでオンにすると参加者名簿と話者タグの名前が図・テキスト一覧・PNG・SVG・PDF・Markdown のどれにも出ず、オフで再び出る（Markdown はテキスト一覧と一致）。端末ごとに保存され、初期化・セッションファイルでは変わらず、外部へのリクエスト 0 件・LLM への送信に名前なし（要点の中の名前は簡易マスキングによらず伏せ字）・画像生成プロンプトに名前なし', async () => {
  const ROSTER = ['名簿NM青木', '名簿NM石井'];
  const TAG = '話者NM上田';
  const NAMES = [...ROSTER, TAG];
  const relayCalls = [];
  const relay = async ({ method = 'GET', path: p, body }) => {
    relayCalls.push({ method, path: p, body });
    if (p === '/api/llm/status') return { status: 200, body: { configured: { endpoint: true, deployment: true, credential: true }, endpointHost: 'foundry.example.test' } };
    if (p === '/api/llm/extract') return { status: 200, body: { objects: [], people: [], emotions: [], metaphors: [] } };
    return { status: 200, body: {} };
  };
  const net = spyNetwork();
  try {
    const { app, env, createApp } = await boardApp({ options: { relay } });
    assert.notEqual(app.setTitleInfo({ participants: ROSTER.join('\n') })?.ok, false, '参加者名簿を入力できる（1 行に 1 名）');
    app.commands['session.start']();
    const vtt = ['WEBVTT', '', '00:00:01.000 --> 00:00:03.000', `<v ${TAG}>まず現行の受付の流れを振り返りました</v>`, ''].join('\n');
    assert.equal((await app.importTextFile({ name: 'names.vtt', type: 'text/vtt', size: Buffer.byteLength(vtt), text: vtt })).ok, true, '.vtt を取り込める');
    env.tick(3); env.scheduler.advance(3000);
    const views = async () => {
      const nC = env.canvasFactory.log.texts.length; const nD = env.downloads.length;
      for (const c of ['save.png', 'save.svg', 'save.pdf', 'save.markdown']) await app.commands[c]();
      const dl = env.downloads.slice(nD);
      assert.deepEqual(dl.map((d) => d.mime), ['image/png', 'image/svg+xml', 'application/pdf', 'text/markdown'], '4 形式で保存できる');
      const pdf = dl[2].data instanceof Uint8Array ? pdfTexts(dl[2].data) : String(dl[2].data);
      // Markdown（AC-529・AC-668 (d)）: テキスト一覧と一致し、名前を表示する間は同じ「参加メンバー: 名前、…」の行と「（発言: 名前）」が載る
      return { 図: app.renderSvg(), テキスト一覧: app.renderOutline(), PNG: env.canvasFactory.log.texts.slice(nC).join('\n'), SVG: String(dl[1].data), PDF: pdf, Markdown: String(dl[3].data) };
    };
    const assertNames = (v, shown, where) => {
      for (const [k, s] of Object.entries(v)) for (const n of NAMES) assert.equal(s.includes(n), shown, `${where}: ${k} に「${n}」が${shown ? '載る' : '載らない'}`);
      // Markdown の名前の行はテキスト一覧と同じ（AC-529: 名前の掲載はテキスト一覧と一致）
      const memberLine = (s) => s.split(/\r?\n/).map((l) => l.replace(/^[\s>*\-#]+/, '').trim()).find((l) => /^参加メンバー\s*[:：]/.test(l)) ?? null;
      const said = (s) => [...s.matchAll(/[（(]発言\s*[:：]\s*([^）)]+)[）)]/g)].map((m) => m[1].trim());
      assert.equal(memberLine(v.Markdown), memberLine(v.テキスト一覧), `${where}: Markdown の「参加メンバー」の行はテキスト一覧と同じ`);
      assert.deepEqual(said(v.Markdown), said(v.テキスト一覧), `${where}: Markdown の「（発言: 名前）」はテキスト一覧と同じ`);
      if (shown) {
        assert.ok(memberLine(v.Markdown)?.includes(ROSTER[0]), `${where}: Markdown に「参加メンバー: 名前、…」の行が載る`);
        assert.ok(said(v.Markdown).includes(TAG), `${where}: Markdown に「（発言: ${TAG}）」が載る`);
      } else {
        assert.equal(said(v.Markdown).length, 0, `${where}: Markdown に「（発言: 名前）」は載らない`);
      }
    };
    // 既定はオフ（名前を表示する）
    assert.equal(app.getHideNames(), false, '既定はオフ');
    app.commands['settings.open']();
    const f = app.getSettingsDialog()?.fields.find((x) => x.id === 'board.hideNames');
    assert.ok(f, '［設定］に「名前を表示しない」がある');
    assert.equal(f.value, false);
    // AC-680（Q-047 A の確定後の文言）: ラベルは ja「名前を隠す」／en "Hide names"、説明・ツールチップに「名前を表示しない」
    assert.equal(f.label?.trim(), '名前を隠す', `ja のラベルは「名前を隠す」（${f.label}）`);
    assert.ok(weight(f.label) <= PARAM.P011, `ラベル「${f.label}」は PARAM-011 以内`);
    const helpText = [f.description, f.accessibleName, f.tooltip?.text, f.tooltip].filter((x) => typeof x === 'string').join(' ');
    assert.ok(helpText.includes('名前を表示しない'), `説明・ツールチップに「名前を表示しない」がある（${helpText}）`);
    app.setLang('en');
    const fe = app.getSettingsDialog()?.fields.find((x) => x.id === 'board.hideNames');
    assert.equal(fe.label.trim(), 'Hide names', `en のラベルは "Hide names"（${fe.label}）`);
    assert.ok(!CJK.test(fe.label) && weight(fe.label) <= PARAM.P011, `en: ${fe.label}`);
    app.setLang('ja');
    app.handleKey({ key: 'Escape' });
    assertNames(await views(), true, 'オフ');
    const persons = (svg) => parseSvg(svg).all.filter((n) => n.attrs['data-board-part'] === 'person' && ancestorAttr(n, 'data-board-section') === 'members').length;
    const nPersons = persons(app.renderSvg());
    assert.ok(nPersons >= 1, 'オフ: 参加メンバーの区画に人物');
    // キーボードだけでオンにする（コマンドで項目にフォーカス → Space）
    app.commands['settings.hideNames']();
    assert.equal(app.getSettingsDialog()?.focusedField, 'board.hideNames', '選ぶだけで項目にフォーカス');
    app.handleKey({ key: ' ' });
    assert.equal(app.getHideNames(), true, 'Space でオン');
    assert.equal(app.getSettingsDialog().fields.find((x) => x.id === 'board.hideNames').value, true, '状態が示される');
    app.handleKey({ key: 'Escape' });
    assertNames(await views(), false, 'オン');
    assert.ok(persons(app.renderSvg()) >= 1, 'オン: 人物は汎用の人物だけで描かれる（区画の人物は残る）');
    assert.ok(String(app.getTitleInfo().participants ?? '').includes(ROSTER[0]), 'オン: 名簿の入力は消えない');
    // 異常系: 真偽値でない値は受け付けず、直前の値が保たれる
    for (const bad of ['yes', 1, null, undefined, {}]) {
      let r; try { r = app.setHideNames(bad); } catch { r = { ok: false }; }
      assert.equal(r?.ok, false, `${JSON.stringify(bad)} は受け付けない`);
      assert.equal(app.getHideNames(), true, '直前の値が保たれる');
    }
    // LLM 連携を有効にしても、送信の内容に名前は含まれない（オン・オフどちらでも）。
    // 要点の文字に現れる名簿・話者タグの名前は、簡易マスキングの設定によらず伏せ字に置き換えて送られ、画像生成プロンプトにも名前は入らない（最終監査 202611050444 C-02・C-03）
    assert.equal((await app.requestLlmEnable()).ok, true); await app.answerLlmConsent(true);
    for (const hide of [true, false]) {
      for (const masking of [true, false]) {
        assert.equal(app.setHideNames(hide).ok, true);
        app.setLlmMasking(masking);
        const sfx = `${hide ? 'H' : 'S'}${masking ? 'M' : 'N'}`;
        const before = relayCalls.length;
        app.setDraft(`次に窓口ごとの負荷の差を見ました${sfx}`); app.submitDraft(); env.tick(1);
        app.setDraft(`「${ROSTER[1]}」と「${TAG}」が負荷を確認${sfx}`); app.submitDraft(); env.tick(1);
        await app.flushLlm();
        const sent = relayCalls.slice(before).filter((c) => c.path === '/api/llm/extract').map((c) => String(c.body?.input ?? '')).join('\n');
        const m = sent.match(new RegExp(`「([^」]*)」と「([^」]*)」が負荷を確認${sfx}`));
        assert.ok(m && m[1].length > 0 && m[2].length > 0, `名前を表示しない=${hide}・簡易マスキング=${masking}: 名前を含む要点は、名前を伏せ字に置き換えて送られる`);
        for (const mask of [true, false]) {
          const t = app.getImagePrompt({ mask }).text;
          for (const n of NAMES) assert.ok(!t.includes(n), `名前を表示しない=${hide}・簡易マスキング=${masking}: 画像生成プロンプト（mask=${mask}）に「${n}」を含めない`);
        }
      }
    }
    assert.ok(relayCalls.some((c) => c.path === '/api/llm/extract'), 'LLM への送信が行われた');
    for (const c of relayCalls) for (const n of NAMES) assert.ok(!JSON.stringify(c).includes(n), `LLM への送信に「${n}」を含まない`);
    // オフに戻すと再び出る（話者タグの名前の保持は切り替えで消えない）
    assert.equal(app.getHideNames(), false);
    env.scheduler.advance(3000);
    assertNames(await views(), true, 'オフに戻す');
    // 端末ごとの設定: セッションファイルに含まれず、読込・初期化で変わらず、再読込後も保たれる
    assert.equal(app.setHideNames(true).ok, true);
    assert.equal((await app.commands['file.save']()).ok, true);
    const file = env.downloads.at(-1);
    assert.ok(!/hideNames|hide_names|名前を表示しない/i.test(String(file.data)), 'セッションファイルに含まれない');
    assert.equal(app.setHideNames(false).ok, true);
    const lr = await app.loadSessionFile({ name: file.filename, type: 'application/json', size: String(file.data).length, text: String(file.data) });
    if (lr?.pending) await app.dialogAction('confirm');
    assert.equal(app.getHideNames(), false, 'セッションファイルの読込では変わらない');
    assert.equal(app.setHideNames(true).ok, true);
    const app2 = await createApp(env.options);
    assert.equal(app2.getHideNames(), true, '再読込後も保たれる');
    app.commands['data.reset'](); app.dialogAction('confirm');
    assert.equal(app.getHideNames(), true, 'データの初期化では変わらない');
    assert.deepEqual(net.calls, [], '外部へのリクエストは 0 件');
  } finally {
    net.restore();
  }
});

// 測定器の自己検証（WCAG 2.x の相対輝度の既知値）。AC-667 (e) の測定の前提
test('FR-114 AC-667 測定器: コントラスト比は WCAG の既知値（#767676 と白 = 4.54）を再現し、グラデーションは最も明るい位置で、変換・半透明を考慮して直下の背景を求める', () => {
  assert.equal(Math.round(contrast('#767676', '#ffffff') * 100) / 100, 4.54);
  assert.equal(Math.round(contrast('#000000', '#ffffff') * 10) / 10, 21);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop offset="0" stop-color="#1e40af"/><stop offset="1" stop-color="#93c5fd"/></linearGradient></defs>'
    + '<rect x="0" y="0" width="200" height="40" fill="url(#g)"/><text x="10" y="28" font-size="16" fill="#ffffff">見出し</text>'
    + '<g transform="translate(0 50)"><path d="M0 0h200v40h-200z" fill="#593C47"/><text x="10" y="28" font-size="16" fill="#ffffff">ラベル</text></g>'
    + '<rect x="0" y="100" width="200" height="40" fill="#000000" fill-opacity="0"/><text x="10" y="128" font-size="16" fill="#593C47">本文</text></svg>';
  const { fails, n } = contrastFailures(svg);
  assert.equal(n, 3);
  assert.equal(fails.length, 1, `白抜きの文字は明るい側の #93c5fd で測るので不足になる（${fails}）`);
  assert.match(fails[0], /見出し/);
  assert.equal(classify('補足ですが昨年度も同様の検討あり'), 'memo');
  assert.equal(classify('However we show it'), 'flow', 'how は however・show に当たらない（PARAM-131 は語単位）');
});

// FR-114 AC-669 AC-666（案 A: 区画の枠は自分の中身の高さ。図は幅 1 列の帯 A・B・C に分け、各帯は上端を揃えて独立に積む。契約: CONTRACT-BOARD.md「帯と区画の配置」）
// 期待値は受入基準 AC-669 (1)〜(7) と PARAM-186・188・191・192・194 だけから決める（要素の間隔を広げる処理・倍率 PARAM-189 は使わない。横並びの下端は揃えない）。
// 測るもの: (a) 上の空き 0 ≤ 下の空き (b) 下の空き ≤ 20%（枠の内側の余白だけ） (c) 外枠の重なり 0 (d) 各帯の最初の区画の上端が揃う・帯の積み方（x・幅・y を PARAM-191 から導く）
// (e) teama-meeting の図の高さ ≤ 913（15 の描画スタイル）、次アクションの切り詰めなし、決め直し（初期の高さ > 913 のときだけ）・決定的・契機がなければ動かない（冪等）。
test('FR-114 AC-669 AC-666: 要点の量が偏った会議を 15 の描画スタイルで描くと、各区画の枠は自分の中身の高さで（下の空きは枠の内側の余白だけ・20% 以下、上の空き 0）、幅 1 列の帯 A・B・C が上端を揃えて独立に積まれ（幅 2 列は隣り合う 2 本にまたがる）、外枠の重なり 0 件。初期の並び（PARAM-192）の図の高さが 913（PARAM-194）以下なら決め直さず、超えるときだけ図の高さが最小の割り当てにする（次アクションは 2 列以上）。決定的で、契機がなければ動かない。teama-meeting は図の高さ ≤ 913 で、次アクションの表は全文（…なし）', async () => {
  const EPS = 0.5;
  const P191 = { M: 24, GAP: 16, COL: 400, HEAD: 36, PAD: 12, ROW: 26 }; // PARAM-191（図の座標）
  const P194 = 913; // 並びの決め直しの契機となる図の高さの上限
  const COLW = [P191.COL, 2 * P191.COL + P191.GAP, 3 * P191.COL + 2 * P191.GAP]; // 区画の幅 400・816・1232
  // PARAM-192 の初期の置き方（区画の順に、幅 1 列は次の空いた帯、幅 2 列は A と B）。band は開始の帯（0=A・1=B・2=C）
  const INIT = { purpose: [0, 1], members: [1, 1], vision: [2, 1], flow: [0, 2], decisions: [2, 1], themes: [0, 2], open: [2, 1], actions: [0, 2], memo: [2, 1] };
  const secOf = (t) => classify(t);
  // 偏った会議: 決定事項・主要テーマ・メモは 1〜2 件、議論の流れ・次アクションが多い
  const skew = (lines, cap) => {
    const n = {}; const out = [];
    for (const t of lines) { const s = secOf(t); n[s] = (n[s] ?? 0) + 1; if (['decisions', 'themes', 'memo'].includes(s) && n[s] > cap) continue; out.push(t); }
    return out;
  };
  const MANY = skew(LINES, 2);
  const FEW = [];
  for (const s of ['flow', 'flow', 'decisions', 'themes', 'memo', 'actions']) { const c = LINES.filter((t) => secOf(t) === s && !FEW.includes(t))[0]; if (c) FEW.push(c); }
  assert.ok(MANY.length >= 12 && FEW.length >= 4 && FEW.length < MANY.length, `固定データ: 多い ${MANY.length}・少ない ${FEW.length}`);
  assert.ok(MANY.filter((t) => secOf(t) === 'flow').length >= 4 && MANY.filter((t) => secOf(t) === 'actions').length >= 2, '多いデータは議論の流れ・次アクションが多い');
  const DATA = [['要点が少ない・シーン区切りなし', FEW, false], ['要点が少ない・シーン区切りあり', FEW, true], ['要点が多い・シーン区切りなし', MANY, false], ['要点が多い・シーン区切りあり', MANY, true]];

  // 取込の前後で不変なのは区画の数・見出し・順だけ（割り当て＝幅 cols・開始の帯 band は並びの決め直しで変わりうる。AC-669 (4)）
  const skeleton = (m) => JSON.stringify({ n: m.sections.length, secs: m.sections.map((s) => [s.id, s.title]), columns: m.columns });
  const figH = (m) => Math.max(...m.sections.map((s) => s.frame.y + s.frame.h)) + P191.M; // 図の高さ＝最も下の下端＋外側の余白（PARAM-194）
  const assignOf = (m) => Object.fromEntries(m.sections.map((s) => [s.id, [s.band, s.cols]]));
  const layout = (m) => JSON.stringify({ bands: m.bands, init: m.initialHeight, re: m.reflowed, secs: m.sections.map((s) => [s.id, s.cols, s.band, s.frame, s.contentTop, s.contentBottom]), els: m.sections.flatMap((s) => s.elements.map((e) => [e.id, e.x, e.y, e.w, e.h])) });
  const geo = (m) => JSON.stringify({ bands: m.bands, secs: m.sections.map((s) => [s.id, s.cols, s.band, s.frame]) }); // 要素の id を除く（履歴に依存しないことの確認用）
  // AC-669 (3)(4): 帯への割り当て（rows→帯。契約 CONTRACT-BOARD.md）と、PARAM-191 から導く x・幅・積み方
  function checkBands(m, where) {
    assert.equal(m.columns, 3, `${where}: columns は 3（帯 A・B・C）`);
    assert.deepEqual(m.sections.map((s) => s.id), ORDER192, `${where}: sections は区画の順（PARAM-192。目的→参加メンバー→目指す姿→議論の流れ→決定事項→主要テーマ→未決事項→次アクション→メモ）のまま`);
    assert.ok(Array.isArray(m.bands) && m.bands.length === 3 && m.bands.every(Array.isArray), `${where}: bands は 3 本（A・B・C）の区画 id の列`);
    const seen = [[], [], []];
    const floor = [null, null, null]; // 帯ごとの積み上がりの下端
    const firstTops = [];
    for (const s of m.sections) {
      assert.ok(Number.isInteger(s.cols) && s.cols >= 1 && s.cols <= 3, `${where}: ${s.id} の幅 cols は 1〜3（${s.cols}）`);
      assert.ok(Number.isInteger(s.band) && s.band >= 0 && s.band + s.cols <= 3, `${where}: ${s.id} の開始の帯 band は 0〜${3 - s.cols}（${s.band}）`);
      assert.ok(Math.abs(s.frame.x - (P191.M + s.band * (P191.COL + P191.GAP))) <= EPS, `${where}: ${s.id} の x は帯の左端（${s.frame.x}）`);
      assert.ok(Math.abs(s.frame.w - COLW[s.cols - 1]) <= EPS, `${where}: ${s.id} の幅 ${s.frame.w} は ${COLW[s.cols - 1]}（幅 ${s.cols} 列）`);
      const span = [...Array(s.cols).keys()].map((k) => s.band + k);
      for (const b of span) seen[b].push(s.id);
      const under = span.map((b) => floor[b]).filter((v) => v != null);
      if (!under.length) firstTops.push(s.frame.y);
      else assert.ok(Math.abs(s.frame.y - (Math.max(...under) + P191.GAP)) <= EPS, `${where}: ${s.id} の上端 ${s.frame.y} は置く先の帯の積み上がりの最も下の下端の直下（${Math.max(...under)} + 間隔 ${P191.GAP}）`);
      for (const b of span) floor[b] = s.frame.y + s.frame.h;
    }
    assert.deepEqual(m.bands, seen, `${where}: bands は帯ごとの区画の列（またがる区画は置く先の帯のすべてに出る）`);
    assert.ok(firstTops.length >= 1 && Math.max(...firstTops) - Math.min(...firstTops) <= EPS, `${where} (d): 各帯の最初の区画の上端は揃う（${firstTops}）`);
    assert.ok(m.sections.find((s) => s.id === 'actions').cols >= 2, `${where}: 次アクションの区画の幅は 2 列以上（AC-666）`);
    assert.ok(m.canvas.h >= figH(m) - EPS, `${where}: 図の領域 ${m.canvas.h} は図の高さ ${figH(m)} を含む（足りないときは縦に伸ばす）`);
  }
  // AC-669 (4): 初期の並びの図の高さが 913 以下なら初期の並びのまま、超えるときだけ決め直す（結果の図の高さは初期以下）
  function checkReflow(m, where) {
    assert.ok(Number.isFinite(m.initialHeight) && m.initialHeight > 0, `${where}: initialHeight（初期の並びを (3) で置いた図の高さ）`);
    assert.equal(typeof m.reflowed, 'boolean', `${where}: reflowed`);
    assert.equal(m.reflowed, m.initialHeight > P194, `${where}: 決め直すのは初期の並びの図の高さ ${m.initialHeight} が ${P194} を超えるときだけ`);
    if (!m.reflowed) {
      assert.deepEqual(assignOf(m), INIT, `${where}: 初期の高さ ${m.initialHeight} ≤ ${P194} なら初期の並び（PARAM-192）のまま`);
      assert.ok(Math.abs(figH(m) - m.initialHeight) <= EPS, `${where}: 決め直さないとき図の高さ ${figH(m)} は initialHeight ${m.initialHeight} と同じ`);
    } else assert.ok(figH(m) <= m.initialHeight + EPS, `${where}: 決め直した図の高さ ${figH(m)} は初期の並びの高さ ${m.initialHeight} 以下（初期の並びも候補。最小を選ぶ）`);
  }
  function checkSpacing(m, where) {
    checkGeometry(m, where); // (c) 区画どうし・要素どうしの外枠の重なり 0 件、はみ出しなし
    checkBands(m, where);
    checkReflow(m, where);
    const withPts = new Set(m.assigned.map((a) => a.section));
    let measured = 0;
    for (const s of m.sections) {
      assert.ok(s.stretch === undefined || s.stretch === 1, `${where}: ${s.id} は要素の間隔を広げない（stretch ${s.stretch}。PARAM-189 は使わない）`);
      assert.ok(Number.isFinite(s.contentTop) && Number.isFinite(s.contentBottom) && s.contentBottom > s.contentTop, `${where}: ${s.id} の contentTop・contentBottom`);
      if (!(withPts.has(s.id) && s.elements.length)) {
        // 要点 0 件の区画: 見出しと PARAM-186（1 行）分の空きだけの高さ（空きの対象外）
        assert.ok(s.frame.h >= P191.HEAD + P191.ROW - EPS && s.frame.h <= P191.HEAD + 8 + P191.ROW + 2 * P191.PAD + EPS, `${where}: 要点 0 件の ${s.id} の高さ ${s.frame.h} は見出し＋1 行分の空きだけ`);
        continue;
      }
      const bottom = Math.max(...s.elements.map((e) => e.y + e.h));
      const top = Math.min(...s.elements.map((e) => e.y)) - s.contentTop;
      const gapFrame = s.frame.y + s.frame.h - bottom;
      assert.ok(Math.abs(top) <= EPS, `${where} (a): ${s.id} の最初の要素の上の空きは 0（${top.toFixed(1)}）`);
      assert.ok(gapFrame >= -EPS, `${where}: ${s.id} の中身が枠に収まる`);
      assert.ok(gapFrame / s.frame.h <= P188 + 0.005, `${where} (b): ${s.id} の下の空き ${gapFrame.toFixed(1)} は枠の高さ ${s.frame.h.toFixed(1)} の ${P188 * 100}% 以下`);
      assert.ok(Math.abs(gapFrame - P191.PAD) <= 1, `${where} (2): ${s.id} の枠の高さは自分の中身の高さ（下の空き ${gapFrame.toFixed(1)} は枠の内側の余白 ${P191.PAD} だけ。横に並ぶ区画に揃えない）`);
      measured++;
    }
    return measured;
  }

  const net = spyNetwork();
  try {
    const styleIds = (await boardApp()).app.getDrawStyles().map((s) => s.id);
    assert.equal(styleIds.length, 15, '描画スタイルは 15');
    for (const [name, lines, withScene] of DATA) {
      const run = async () => {
        const r = await boardApp();
        r.app.commands['session.start']();
        let base = null; let prevRows = null;
        for (const t of lines) {
          if (withScene && secOf(t) === 'flow') r.app.commands['session.nextScene']();
          r.app.setDraft(t);
          assert.equal(r.app.submitDraft().ok, true, `${name}: 取込 ${t}`);
          r.advance(PARAM.P181_MS + 100);
          const m = r.app.getBoardModel();
          // 取込の前後で区画の数・見出し・幅は変わらない（並びの組み合わせだけが変わりうる）
          if (base == null) base = skeleton(m); else assert.equal(skeleton(m), base, `${name}: 取込の前後で区画の数・見出し・幅は不変（${t}）`);
          checkSpacing(m, `${name}: ${t}`);
          prevRows = m.bands;
        }
        r.advance(1600);
        return { r, base, prevRows };
      };
      const a = await run();
      const b = await run();
      const m0 = a.r.app.getBoardModel();
      // 同じ入力なら、並び・枠・倍率・要素の位置は同じ（決定的）。履歴に依存しない
      assert.equal(layout(b.r.app.getBoardModel()), layout(m0), `${name}: 同じ入力なら並び・枠は毎回同じ`);
      // 追加（契機）がなければ動かない（冪等）: 時間が進む・再描画・何度の再配置・高さが変わらない編集（同じ文字への編集）
      const snap = layout(m0);
      a.r.advance(5000); a.r.app.renderSvg(); a.r.advance(5000);
      assert.equal(layout(a.r.app.getBoardModel()), snap, `${name}: 契機がなければ並び・枠・要素は動かない`);
      const p0 = allPoints(a.r.app)[0];
      assert.equal(a.r.app.editPoint(p0.id, p0.text).ok, true, `${name}: 同じ文字への編集`);
      a.r.advance(1600);
      assert.equal(layout(a.r.app.getBoardModel()), snap, `${name}: 高さが変わらない編集では動かない`);
      // 15 の描画スタイル
      let measured = 0;
      for (const id of styleIds) {
        assert.equal(a.r.app.setDrawStyle(id).ok, true, id);
        a.r.advance(1600);
        const m = a.r.app.getBoardModel();
        assert.equal(skeleton(m), a.base, `${name} / ${id}: 描画スタイルを変えても区画の数・見出し・幅は不変`);
        measured += checkSpacing(m, `${name} / ${id}`);
      }
      assert.ok(measured >= styleIds.length, `${name}: 要点のある区画で空きを測れた（${measured}）`);
    }
    // teama-meeting（次アクション 5 行）: 次アクションの表は 2 列幅以上で、24 文字以内のセルは「…」で切り詰めず全文を描く（AC-666）。
    // 図の高さは、初期の並びで空き 20% 以下なら決め直さず、決め直したときも以前の約 830 を大きく超えない（AC-669 (4)）
    {
      const tm = await boardApp();
      tm.app.commands['session.start']();
      const emptyBase = skeleton(tm.app.getBoardModel());
      for (const t of LINES) { tm.app.setDraft(t); assert.equal(tm.app.submitDraft().ok, true, `teama-meeting: 取込 ${t}`); tm.advance(PARAM.P181_MS + 100); }
      tm.advance(1600);
      const m = tm.app.getBoardModel();
      checkSpacing(m, 'teama-meeting');
      assert.equal(skeleton(m), emptyBase, 'teama-meeting: 取込の前後で区画の数・見出し・順は不変（幅は問わない）');
      const acts = allPoints(tm.app).filter((p) => classify(p.text) === 'actions');
      assert.equal(acts.length, 5, 'teama-meeting の次アクションは 5 行');
      for (const p of acts) assert.ok([...p.text].length <= 24, `各セルは PARAM-165（24 文字）以内（${p.text}）`);
      const actSec = parseSvg(tm.app.renderSvg()).all.find((n) => n.attrs['data-board-section'] === 'actions');
      assert.ok(actSec, '次アクションの区画が描かれる');
      assert.ok(!/[…]|\.\.\./.test(actSec.text), `次アクションの表に「…」の切り詰めがない（${actSec.text}）`);
      const count = (s) => { const c = new Map(); for (const ch of s) c.set(ch, (c.get(ch) ?? 0) + 1); return c; };
      const have = count(actSec.text.replace(/\s/g, '')); const want = count(acts.map((p) => p.text).join('').replace(/[\s。．.、,]/g, ''));
      for (const [ch, n] of want) assert.ok((have.get(ch) ?? 0) >= n, `次アクションの全文が描かれる: 「${ch}」が ${n} 個以上（${have.get(ch) ?? 0}）`);
      const BASE_H = P194; // PARAM-194: 初期の並びの図の高さの上限（teama-meeting は初期の並びで約 830 前後）
      assert.ok(figH(m) <= BASE_H, `teama-meeting (e): 図の高さ ${figH(m).toFixed(0)} は ${BASE_H} 以下`);
      assert.equal(m.reflowed, false, `teama-meeting: 初期の並びの高さ ${m.initialHeight} は ${P194} 以下なので決め直さない（初期の並び: A 目的・背景→議論の流れ→主要テーマ→次アクション / B 参加メンバー / C 最終的に目指す姿→決定事項→未決事項→メモ・補足）`);
      assert.deepEqual(m.bands, [['purpose', 'flow', 'themes', 'actions'], ['members', 'flow', 'themes', 'actions'], ['vision', 'decisions', 'open', 'memo']], 'teama-meeting: 帯 A・B・C の区画の列（PARAM-192）');
      // (e) 15 の描画スタイルでも図の高さ ≤ 913、各区画は自分の中身の高さ・重ならない
      for (const id of tm.app.getDrawStyles().map((s) => s.id)) {
        assert.equal(tm.app.setDrawStyle(id).ok, true, id);
        tm.advance(1600);
        const ms = tm.app.getBoardModel();
        checkSpacing(ms, `teama-meeting / ${id}`);
        assert.ok(figH(ms) <= BASE_H, `teama-meeting / ${id} (e): 図の高さ ${figH(ms).toFixed(0)} は ${BASE_H} 以下`);
      }
    }
    // 並びの決め直し（AC-669 (4)）: 初期の並びの図の高さが 913 を超えるほど要点が多い会議（teama-meeting を 3 回分）だけが決め直す。
    // 結果は図の高さが最小の割り当て（初期の並び以下）で、次アクションは 2 列以上、重ならない・各区画は自分の中身の高さ。
    // 入力（区画の中身の量と順）が同じなら、取込の経路（1 発言ずつ・ファイル取込）によらず同じ配置（決定的・履歴によらない）。契機がなければ動かない。
    {
      const HEAVY = [0, 1, 2].flatMap((k) => LINES.map((t) => `${t} ${k + 1}`));
      const one = await boardApp();
      one.app.commands['session.start']();
      let k = 0;
      for (const t of HEAVY) {
        one.app.setDraft(t); assert.equal(one.app.submitDraft().ok, true, `重い会議: 取込 ${t}`); one.advance(PARAM.P181_MS + 100);
        if (++k % 23 === 0) checkSpacing(one.app.getBoardModel(), `重い会議: ${k} 発言の後`);
      }
      one.advance(1600);
      const mh = one.app.getBoardModel();
      checkSpacing(mh, '重い会議');
      assert.ok(mh.initialHeight > P194, `重い会議: 初期の並びの図の高さ ${mh.initialHeight} が ${P194} を超える（決め直しの契機を作れたデータ）`);
      assert.equal(mh.reflowed, true, '重い会議: 決め直した');
      assert.ok(figH(mh) <= mh.initialHeight + EPS, `重い会議: 決め直した高さ ${figH(mh)} は初期の並びの高さ ${mh.initialHeight} 以下`);
      const snapH = layout(mh);
      one.advance(5000); one.app.renderSvg(); one.advance(5000);
      assert.equal(layout(one.app.getBoardModel()), snapH, '重い会議: 契機がなければ決め直した並びも動かない（冪等）');
      const imp = await boardApp();
      imp.app.commands['session.start']();
      const text = HEAVY.join('\n');
      assert.equal((await imp.app.importTextFile({ name: 'heavy.txt', type: 'text/plain', size: Buffer.byteLength(text), text })).ok, true, '重い会議: ファイル取込');
      imp.advance(5000);
      assert.equal(geo(imp.app.getBoardModel()), geo(mh), '重い会議: 入力が同じなら取込の経路によらず並び・枠は同じ（決定的・履歴によらない）');
      for (const id of one.app.getDrawStyles().map((s) => s.id)) {
        assert.equal(one.app.setDrawStyle(id).ok, true, id);
        one.advance(1600);
        checkSpacing(one.app.getBoardModel(), `重い会議 / ${id}`);
      }
    }
    // 異常系: 要点が 1 件もない（0 件）でも帯への割り当ては作れ、重ならない（初期の並びのまま）
    const empty = await boardApp();
    empty.app.commands['session.start']();
    checkBands(empty.app.getBoardModel(), '要点 0 件');
    checkReflow(empty.app.getBoardModel(), '要点 0 件');
    checkGeometry(empty.app.getBoardModel(), '要点 0 件');
    assert.deepEqual(net.calls, [], '外部へのリクエスト 0 件');
  } finally {
    net.restore();
  }
});

// FR-114 AC-681 AC-680 AC-668 AC-666 AC-665（契約: CONTRACT-BOARD.md「参加者名簿の入力欄（AC-681）」「人物の名前」）
// 期待値は受入基準と PARAM-196（20 名）・PARAM-197（20 文字）・PARAM-011 だけから決める。AC-668・AC-666・AC-665 は integration（台帳の AC には載せず、同じケースで測る）。
test('FR-114 AC-681 AC-680: 参加者名簿の入力欄（ラベル・既定は空・1 行 1 名の入力・編集・削除・空行と前後の空白と重複の扱い）、名前の数は 20 名まで（超えると理由を status で示す）、1 件は 20 文字（先頭 19 文字＋「…」）、ブラウザ内の保存だけ（再読込で復元・初期化で消え・セッションファイルと LLM への送信に載らない）、「名前を隠す」の切り替えで消えず、外部へのリクエスト 0 件。AC-668 (b)(c) AC-666 AC-665: 名前の並びと、ステップの最初の発話の話者・続きのステップの名前・長さの上限', async () => {
  const P196 = 20; const P197 = 20; // 名前の数・長さの上限
  const clip = (s) => ([...s].length <= P197 ? s : `${[...s].slice(0, P197 - 1).join('')}…`);
  const net = spyNetwork();
  try {
    const relayCalls = [];
    const relay = async ({ method = 'GET', path: p, body }) => {
      relayCalls.push({ method, path: p, body });
      if (p === '/api/llm/status') return { status: 200, body: { configured: { endpoint: true, deployment: true, credential: true }, endpointHost: 'foundry.example.test' } };
      if (p === '/api/llm/extract') return { status: 200, body: { objects: [], people: [], emotions: [], metaphors: [] } };
      return { status: 200, body: {} };
    };
    const { app, env, createApp, advance } = await boardApp({ options: { relay } });
    const roster = () => String(app.getTitleInfo().participants ?? '').split('\n').filter((x) => x !== '');
    const members = () => parseSvg(app.renderSvg()).all.filter((n) => n.attrs['data-board-name'] === 'participant').map((n) => n.text.trim());
    const speakersOf = (a) => parseSvg(a.renderSvg()).all.filter((n) => n.attrs['data-board-name'] === 'speaker').map((n) => n.text.trim());

    // ---- 入力欄: ラベル（PARAM-011 以内・表示言語に従う）・既定は空 ----
    const field = () => app.getMeetingFormSpec().fields.find((f) => f.id === 'participants');
    assert.ok(field(), '入力欄（getMeetingFormSpec().fields の id: participants）がある');
    assert.equal(field().label.trim(), '参加者名簿', `ja のラベル（${field().label}）`);
    assert.ok(weight(field().label) <= PARAM.P011, `ラベルは PARAM-011 以内（${field().label}）`);
    app.setLang('en');
    assert.equal(field().label.trim(), 'Participants', `en のラベル（${field().label}）`);
    assert.ok(!CJK.test(field().label) && weight(field().label) <= PARAM.P011, `en: ${field().label}`);
    app.setLang('ja');
    assert.deepEqual(roster(), [], '既定は空');
    assert.equal(String(app.getMeetingFormValues().participants ?? ''), '', '入力欄の既定値は空');

    // ---- 入力・編集・削除（1 行に 1 名）。空行・前後の空白は無視、同じ名前は 1 名 ----
    assert.equal(app.setTitleInfo({ participants: '名簿甲\n\n  名簿乙  \n名簿甲\n   \n名簿丙' }).ok, true);
    assert.deepEqual(roster(), ['名簿甲', '名簿乙', '名簿丙'], '空行・前後の空白は無視、同じ名前は 1 名（入力順）');
    assert.deepEqual(members(), ['名簿甲', '名簿乙', '名簿丙'], '参加メンバーの区画に入力順で載る');
    assert.equal(app.setTitleInfo({ participants: '名簿甲\n名簿乙改\n名簿丙' }).ok, true, '編集');
    assert.deepEqual(roster(), ['名簿甲', '名簿乙改', '名簿丙']);
    assert.equal(app.setTitleInfo({ participants: '名簿甲\n名簿丙' }).ok, true, '行の削除');
    assert.deepEqual(members(), ['名簿甲', '名簿丙']);
    // 異常系: 文字列・文字列の配列以外は受け付けず、直前の名簿が保たれる
    for (const bad of [1, null, {}, true]) { let r; try { r = app.setTitleInfo({ participants: bad }); } catch { r = { ok: false }; } assert.equal(r?.ok, false, `${JSON.stringify(bad)} は受け付けない`); assert.deepEqual(roster(), ['名簿甲', '名簿丙'], '直前の名簿が保たれる'); }
    // 渡さなかった項目は変えない（タイトル欄の既存の項目と同じ呼び出し）
    assert.equal(app.setTitleInfo({ theme: '定例' }).ok, true); assert.deepEqual(roster(), ['名簿甲', '名簿丙'], '名簿は変わらない');
    assert.equal(app.setTitleInfo({ participants: '' }).ok, true, '全部削除'); assert.deepEqual(roster(), []);
    assert.deepEqual(members(), [], '名前がないときは従来どおり汎用の人物だけ');

    // ---- (b) 名前の数の上限 PARAM-196（重複は数えない）と理由のメッセージ（読み上げ対象 status） ----
    const names = (n) => Array.from({ length: n }, (_, i) => `名簿N${String(i + 1).padStart(2, '0')}`);
    const dup = [...names(P196), ...names(3)]; // 20 名＋重複 3 行 = 20 名（上限を超えない）
    let r = app.setTitleInfo({ participants: dup.join('\n') });
    assert.equal(r.ok, true); assert.equal(roster().length, P196, '20 名ちょうど（重複は数えない）');
    assert.ok(!r.notice, `上限を超えていないので理由は出ない（${JSON.stringify(r.notice)}）`);
    r = app.setTitleInfo({ participants: names(P196 + 5).join('\n') });
    assert.equal(r.ok, true);
    assert.deepEqual(roster(), names(P196), '超える行は名簿に取り込まず、先頭の 20 名だけ');
    assert.equal(r.notice?.text, `参加者は ${P196} 名までです`, `理由を文字で示す（${JSON.stringify(r.notice)}）`);
    assert.ok(['status', 'alert'].includes(r.notice?.role), '画面の読み上げ対象のメッセージ（status）');
    app.setLang('en');
    r = app.setTitleInfo({ participants: names(P196 + 1).join('\n') });
    assert.equal(r.notice?.text, `Up to ${P196} participants`, `en の理由（${JSON.stringify(r.notice)}）`);
    app.setLang('ja');
    assert.equal(members().length, P196, '図の参加メンバーも 20 名');

    // ---- 1 件の長さの上限 PARAM-197（先頭 19 文字＋「…」＝ 20 文字。ちょうど 20 文字はそのまま。PARAM-165 の 24 は使わない） ----
    const exact = '一二三四五六七八九十一二三四五六七八九十'; // 20 文字
    const over = `${exact}超過`; // 22 文字
    const mid = '一二三四五六七八九十一二三四五六七八九十一二三四'; // 24 文字（PARAM-165 の水準）
    assert.equal(app.setTitleInfo({ participants: [exact, over, mid].join('\n') }).ok, true);
    assert.deepEqual(roster(), [exact, clip(over), clip(mid)], '20 文字以内はそのまま、超えるときは先頭 19 文字＋「…」で保持');
    assert.ok(roster().every((x) => [...x].length <= P197), '保持する名前は 20 文字以内');
    assert.deepEqual(members(), [exact, clip(over), clip(mid)], '図にも切り詰めた名前が載る');
    assert.ok(app.renderOutline().includes(clip(over)), 'テキスト一覧にも同じ名前');

    // ---- (c) ブラウザ内の保存だけ: 再読込で復元・セッションファイルに含まれない・初期化で消える ----
    const ROSTER = ['名簿保存甲', '名簿保存乙'];
    assert.equal(app.setTitleInfo({ participants: ROSTER.join('\n') }).ok, true);
    assert.ok(env.storage.dump().some(([, v]) => ROSTER.every((n) => String(v).includes(n))), 'ブラウザ内の保存（options.storage）に保存される');
    app.commands['session.start'](); app.setDraft('現行の受付の流れを振り返りました'); assert.equal(app.submitDraft().ok, true); advance(1600); // 保存できる内容（要点）を用意する
    assert.equal((await app.commands['file.save']()).ok, true);
    const file = env.downloads.at(-1);
    for (const n of ROSTER) assert.ok(!String(file.data).includes(n), `セッションファイルに「${n}」を含めない`);
    const app2 = await createApp(env.options);
    assert.deepEqual(String(app2.getTitleInfo().participants ?? '').split('\n'), ROSTER, '再読込後も復元される');
    // (e) 「名前を隠す」の切り替えで名簿は消えず、入力・編集も使える
    assert.equal(app.setHideNames(true).ok, true);
    assert.deepEqual(roster(), ROSTER, '名前を隠すオンでも名簿は消えない');
    assert.deepEqual(members(), [], '名前を隠すオンでは図に名前が出ない（AC-680）');
    assert.equal(app.setTitleInfo({ participants: [...ROSTER, '名簿保存丙'].join('\n') }).ok, true, 'オンでも名簿を編集できる');
    assert.equal(app.setHideNames(false).ok, true);
    assert.deepEqual(members(), [...ROSTER, '名簿保存丙'], 'オフに戻すと編集した名簿が図に載る');
    // (d) LLM への送信に名前の値は含まれない
    assert.equal((await app.requestLlmEnable()).ok, true); await app.answerLlmConsent(true);
    app.setDraft('名簿保存甲と名簿保存乙が現行の流れを確認'); app.submitDraft(); env.tick(1); await app.flushLlm();
    assert.ok(relayCalls.some((c) => c.path === '/api/llm/extract'), 'LLM への送信が行われた');
    for (const c of relayCalls) for (const n of [...ROSTER, '名簿保存丙']) assert.ok(!JSON.stringify(c).includes(n), `LLM への送信に「${n}」を含まない`);
    app.commands['data.reset'](); app.dialogAction('confirm');
    assert.deepEqual(roster(), [], 'データの初期化で名簿が消える');
    assert.ok(!env.storage.dump().some(([, v]) => ROSTER.some((n) => String(v).includes(n))), '初期化後はブラウザ内の保存にも残らない');

    // ---- AC-668 (b)(c)・AC-666・AC-665: 名前の並びと、ステップの人物の名前 ----
    const LONG = 'SpeakerLongNameAAAAAAAAAA'; // 25 文字
    assert.ok([...LONG].length > P197);
    const ts = (sec, ms = 0) => `00:00:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    const cue = (i, who, text) => `${ts(i)} --> ${ts(i, 500)}\n${who ? `<v ${who}>${text}</v>` : text}`;
    const FRUIT = ['kiwi', 'mango', 'pear', 'plum', 'lime', 'fig', 'date', 'peach', 'melon']; const NUM = ['one', 'two', 'six', 'ten', 'nine', 'four', 'five', 'seven', 'eight'];
    const A9 = Array.from({ length: 9 }, (_, i) => cue(i + 1, i === 0 ? LONG : 'Other', `alpha beta ${FRUIT[i]} ${NUM[i]}`)); // 同じ話題（共有する語句 alpha・beta）の 9 発言（PARAM-088=7 を超えて続きのステップに分かれる。最初の発話の話者は LONG）
    const B1 = [cue(12, '名簿甲', 'omega sigma tau kappa first'), cue(13, 'Other', 'omega sigma tau kappa second')]; // 話題が替わる（共有する語句 0）。最初の発話の話者は名簿の「名簿甲」
    const C1 = [cue(15, null, 'rho zeta lambda mu third')]; // 話者タグなし
    const vtt = ['WEBVTT', '', ...[...A9, ...B1, ...C1].flatMap((c) => [c, ''])].join('\n');
    const b = await boardApp();
    assert.equal(b.app.setTitleInfo({ participants: '名簿甲\n名簿乙' }).ok, true);
    assert.equal((await b.app.importTextFile({ name: 'names.vtt', type: 'text/vtt', size: Buffer.byteLength(vtt), text: vtt })).ok, true, '.vtt を取り込める');
    b.advance(1600);
    const mem = parseSvg(b.app.renderSvg()).all.filter((n) => n.attrs['data-board-name'] === 'participant').map((n) => n.text.trim());
    assert.deepEqual(mem, ['名簿甲', '名簿乙', clip(LONG), 'Other'], '(b) 参加メンバー: 名簿の名前（入力順）→名簿にない話者タグの名前（最初に現れた順。20 文字以内）');
    // (c) ステップの人物の名前: そのステップの最初の要点の元の発話の話者（タグがなければ名前なし）。続きのステップは分ける前と同じ名前（続きの最初の要点では決め直さない）。名簿の名前は発話に結びつけない
    const sp = speakersOf(b.app);
    assert.deepEqual(sp, [clip(LONG), clip(LONG), '名簿甲'], `(c) 議論の流れのステップの名前: 最初の発話の話者（20 文字以内）・続きのステップは同じ名前・タグのないステップは名前なし（${JSON.stringify(sp)}）`);
    assert.ok(!sp.includes('Other') && !sp.includes('名簿乙'), '最初の発話でない話者・名簿だけの名前はステップに添えない');
    const personsInFlow = parseSvg(b.app.renderSvg()).all.filter((n) => n.attrs['data-board-part'] === 'person' && ancestorAttr(n, 'data-board-section') === 'flow').length;
    assert.ok(personsInFlow >= 4, `議論の流れの各ステップ（続きのステップを含む 4 つ以上）に人物が 1 組ずつ（${personsInFlow}）`);
    assert.ok(sp.every((x) => [...x].length <= P197), 'ステップの名前は 20 文字以内');
    const outline = b.app.renderOutline();
    assert.ok(outline.includes(`（発言: ${clip(LONG)}）`) && outline.includes('（発言: 名簿甲）'), 'テキスト一覧にも同じ名前（各ステップの最初の要点の行）');
    assert.ok(!outline.includes('（発言: Other）'), '最初の要点でない話者は添えない');
    // 外部へのリクエストは 0 件（入力・編集・削除・表示・保存の間）
    advance(0);
    assert.deepEqual(net.calls, [], '外部へのリクエストは 0 件');
  } finally {
    net.restore();
  }
});
