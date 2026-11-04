// FR-114 AC-667（System Test。契約: tests/system/CONTRACT-BOARD.md）
// 期待値は要求定義書の受入基準と PARAM だけから決める。web/ の実装の値は使わない（実装がなければ失敗するのが正常）。
// 1 ケースで (a)〜(g) と外部へのリクエスト 0 件を確かめる: node --test --test-name-pattern="AC-667" tests/system/board.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { newApp, toDetail, ROOT, FakeSpeech } from './helpers.js';
import { parseSvg, contrast, rgb, lum } from './stylepreset-util.js';
import { linkedClock } from './liveshow-util.js';

// ---- PARAM（要求定義書 2026-11-04 の値） ----
const PARAM = {
  P007: 4.5, // 文字の最小コントラスト比
  P158_SEC: 3, // 単発の反映の上限（手入力・ファイル取込）
  P001_SEC: 60, P104_SEC: 2, // ライブ: AC-053 の上限 = PARAM-001 + PARAM-104（PARAM-001 は PARAM-099 の別名で 60 秒。1c4bd9d）
  P179: 6, // 要点のある区画の数の下限
  P180: 8, // 部品の種類の数の下限
  P181_MS: 600, // 出現・移動のアニメーションの時間の上限
  P126: '決まりました／決めました／決定／確定／承認／合意／採用する／に決めた／agreed／decided',
  P129: 'お願いします／してください／対応する／やります／確認します／共有します／調整します／対応します／連絡します／までに／担当／TODO／action item',
  P127: '保留／未定／持ち帰り／次回／検討中／pending／TBD',
  P131: '？／?／でしょうか／ですか／ますか／ませんか／でしょう／why／how／what',
  P132: 'なぜなら／たとえば／例えば／根拠／理由は／データでは／実績／because／for example／e.g.',
  P178: { purpose: '目的／ねらい／背景／経緯／趣旨／purpose／background', vision: '目指す／目指したい／あるべき姿／理想／将来像／to-be', members: '参加／出席／メンバー／attendee', themes: 'テーマ／論点／ポイント／課題／issue', memo: '補足／ちなみに／参考／メモ／note' },
};
const SECTIONS = ['purpose', 'members', 'flow', 'decisions', 'open', 'themes', 'vision', 'actions', 'memo'];
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
test('FR-114 AC-667: 固定の文字起こし（TeamA との会議）を会議ボード型で 1 発言ずつ取り込むと、(a) 区画 6 以上 (b) 部品 8 種類以上 (c) 期待の表の区画 (d) 重なり・はみ出しなし (e) コントラスト 4.5 以上（15 の描画スタイル）(f) 600ms 以内の途中を経由する移動（動きを減らす設定ではなし）(g) 反映の時間、外部へのリクエスト 0 件', async () => {
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
    };
    LINES.forEach((t, i) => feed(t, `${i + 1} 行目`));
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
    assert.ok(!/<image\b|<foreignObject\b/i.test(svg) && !/(?:href|url\()\s*=?\s*["']?(?:https?:)?\/\//i.test(svg), 'SVG だけで外部参照なし');

    // (e) 見出し・ラベル・表の文字と直下の背景: 11 の画風と既存の 4 つ（計 15）のすべて
    const styles = app.getDrawStyles();
    assert.equal(styles.length, 15, '描画スタイルは 15（既存の 4 つ＋11 の画風）');
    for (const s of styles) {
      assert.equal(app.setDrawStyle(s.id).ok, true, s.id);
      const { fails, n } = contrastFailures(app.renderSvg());
      assert.ok(n >= LINES.length, `${s.label}: 文字を測った（${n}）`);
      assert.deepEqual(fails, [], `(e) ${s.label}: 文字と直下の背景のコントラスト比が ${PARAM.P007} 以上`);
      checkGeometry(app.getBoardModel(), `${s.label} の図`);
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

    // 外部へのリクエストは 0 件（LLM 連携は既定のまま無効）
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
