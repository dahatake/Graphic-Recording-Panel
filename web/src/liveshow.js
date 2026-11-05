// FR-115 ライブ描画ショー（AC-672〜AC-675、PARAM-182）。決定 C-01: 会議ボード型でショーが ON のときは、
// 会議ボード型の出現・移動の演出（AC-669）をこの演出で置き換える（両方は出さない。時間はこの要求の値）。
// - ON のとき、[図] の 2D 表示で、更新の時点で加わった要素は「ペン先が輪郭をなぞる描線（pathLength＋stroke-dasharray/dashoffset）」と
//   「文字を 1 字ずつ書き込む（まだ書いていない字は透明の tspan）」で、読み順（文書の順）に 1 つずつ現れる。
//   位置が変わる既存の要素は、仮想の手がつかみ（選択の枠つき）、途中の位置を経て運んで離す。決定事項・区画が空でなくなったときは紙吹雪ときらめき。
// - 演出は「最終の SVG（OFF と同じもの）」と「計画（時刻つき）」と「いまの時刻（ctx.now。テスト用の時計）」だけから作る純粋な変換で、
//   図の内容・最終の配置・保存物（renderSvgForSave）を変えない。演出が終われば OFF と同じ文字列に戻る。生成 AI・外部通信は使わない。
// - 1 回の描き足しの演出の合計は、その時点の更新間隔（FR-014）の 80% 以内。超えるときは各要素の時間を等しく縮める（PARAM-182）。
//   次の更新が来たら、前の演出は最後の状態へ収束させてから新しい演出を始める（前の演出を残さない）。
// - 演出はライブ（音声入力の記録中・.vtt の再生取込）の更新間隔ごとの描き足し（FR-014 の 'live:tick'。liverefresh.js の ctx.liveRefreshing の間）にだけ行う。
//   手入力・ファイルの一括取込（AC-054・AC-523）や、それ以外の図の変化は、ON でも演出せず従来どおり即時に反映する。
// - 動きを減らす設定（prefers-reduced-motion）では動きを出さず、描き足した件数を状態メッセージ（読み上げ対象）で示す。
//   強制カラーでは、ペン先・手・紙吹雪を出さない（文字と背景のコントラストを下げない）。
// - 演出の音（FR-116）への接続点: 演出の出来事（getLiveShow().log）の時点で ctx.showAudio?.cue(name, detail) を呼ぶ
//   （描線の始まり→'pen'・現れた→'pop'・運ぶ→'whoosh'・決定→'chime'・お祝い（紙吹雪・きらめき）→'sparkle'）。ON/OFF は ctx.showAudio.setEnabled に連動し、ON で BGM を始める。
import { readJson, writeJson } from './persist.js';

export const SHOW_KEY = 'grp.liveShow';
// PARAM-182 の上限（ミリ秒・割合）
export const SHOW_LIMITS = { strokeMax: 1200, charMax: 80, carryMax: 800, celebrateMax: 1500, budgetRatio: 0.8 };
// 上限の中で選んだ値（目で追える長さ）
export const SHOW_TIMING = { strokeMin: 260, strokePerUnit: 1.4, strokeCap: 1000, charMs: 55, carryMs: 700, celebrateMs: 1300, minStepMs: 40, tickMs: 40 };
const DEFAULT_INTERVAL_MS = 10000;
const MOVE_EPS = 0.5;

const KEY_ATTRS = ['data-board-el', 'data-point-id', 'data-scene-id', 'data-topic-id', 'data-group-id', 'data-unit-id', 'data-board-section'];
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'image', 'use']);
const SKIP = new Set(['defs', 'clipPath', 'clippath', 'marker', 'pattern', 'filter', 'mask', 'symbol', 'title', 'desc', 'style', 'linearGradient', 'lineargradient', 'radialGradient', 'radialgradient', 'metadata', 'script']);

// ---- 属性・変換・図形の幾何（DOM に依存しない） ----
const attrRe = new Map();
export function attrOf(tag, name) {
  let re = attrRe.get(name);
  if (!re) { re = new RegExp(`\\s${name.replace(/[-]/g, '\\-')}="([^"]*)"`); attrRe.set(name, re); }
  const m = re.exec(tag);
  return m ? m[1] : null;
}
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const nums = (s) => String(s ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite);
const ID = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export function parseTransform(s) {
  let m = ID;
  for (const [, fn, args] of String(s ?? '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = nums(args);
    let n = ID;
    if (fn === 'matrix' && a.length === 6) n = a;
    else if (fn === 'translate') n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === 'scale') n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === 'rotate') {
      const r = ((a[0] ?? 0) * Math.PI) / 180; const c = Math.cos(r); const sn = Math.sin(r);
      n = [c, sn, -sn, c, 0, 0];
      if (a.length >= 3) n = mul(mul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
    } else if (fn === 'skewX') n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === 'skewY') n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, n);
  }
  return m;
}

// path の d を折れ線（部分の線の集まり）にする。曲線は 8 分割、円弧は端点への直線で近似する
export function flattenPath(d) {
  const toks = String(d ?? '').match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const polys = []; let cur = null; let x = 0; let y = 0; let sx = 0; let sy = 0; let cmd = null; let i = 0;
  let lcx = null; let lcy = null; let lq = null;
  const take = (k) => { const out = []; for (let j = 0; j < k; j++) { const v = Number(toks[i++]); if (!Number.isFinite(v)) return null; out.push(v); } return out; };
  const line = (nx, ny) => { if (!cur) { cur = [[x, y]]; polys.push(cur); } cur.push([nx, ny]); x = nx; y = ny; };
  const bez = (pts) => { // pts: 制御点（始点を含む）
    for (let s = 1; s <= 8; s++) {
      const t = s / 8; let q = pts.map((p) => [...p]);
      while (q.length > 1) q = q.slice(1).map((p, k) => [q[k][0] + (p[0] - q[k][0]) * t, q[k][1] + (p[1] - q[k][1]) * t]);
      line(q[0][0], q[0][1]);
    }
  };
  while (i < toks.length) {
    if (/^[A-Za-z]$/.test(toks[i])) cmd = toks[i++];
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase(); const C = cmd.toUpperCase();
    const ox = rel ? x : 0; const oy = rel ? y : 0;
    if (C === 'Z') { if (cur) line(sx, sy); cur = null; cmd = null; lcx = null; lq = null; continue; }
    if (C === 'M') { const a = take(2); if (!a) break; x = ox + a[0]; y = oy + a[1]; sx = x; sy = y; cur = [[x, y]]; polys.push(cur); cmd = rel ? 'l' : 'L'; lcx = null; lq = null; continue; }
    if (C === 'L') { const a = take(2); if (!a) break; line(ox + a[0], oy + a[1]); lcx = null; lq = null; continue; }
    if (C === 'H') { const a = take(1); if (!a) break; line(ox + a[0], y); lcx = null; lq = null; continue; }
    if (C === 'V') { const a = take(1); if (!a) break; line(x, (rel ? y : 0) + a[0]); lcx = null; lq = null; continue; }
    if (C === 'C') { const a = take(6); if (!a) break; const p = [[x, y], [ox + a[0], oy + a[1]], [ox + a[2], oy + a[3]], [ox + a[4], oy + a[5]]]; bez(p); lcx = p[2][0]; lcy = p[2][1]; lq = null; continue; }
    if (C === 'S') { const a = take(4); if (!a) break; const c1 = lcx == null ? [x, y] : [2 * x - lcx, 2 * y - lcy]; const p = [[x, y], c1, [ox + a[0], oy + a[1]], [ox + a[2], oy + a[3]]]; bez(p); lcx = p[2][0]; lcy = p[2][1]; lq = null; continue; }
    if (C === 'Q') { const a = take(4); if (!a) break; const p = [[x, y], [ox + a[0], oy + a[1]], [ox + a[2], oy + a[3]]]; bez(p); lq = p[1]; lcx = null; continue; }
    if (C === 'T') { const a = take(2); if (!a) break; const c = lq ? [2 * x - lq[0], 2 * y - lq[1]] : [x, y]; const p = [[x, y], c, [ox + a[0], oy + a[1]]]; bez(p); lq = c; lcx = null; continue; }
    if (C === 'A') { const a = take(7); if (!a) break; line(ox + a[5], oy + a[6]); lcx = null; lq = null; continue; }
    break;
  }
  return polys.filter((p) => p.length > 1);
}

function shapeGeometry(name, tag) {
  const g = (k) => num(attrOf(tag, k));
  if (name === 'rect' || name === 'image' || name === 'use') {
    const x = g('x'); const y = g('y'); const w = g('width'); const h = g('height');
    if (!(w > 0 && h > 0)) return name === 'rect' ? [] : [[[x, y], [x, y]]];
    return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
  }
  if (name === 'circle' || name === 'ellipse') {
    const cx = g('cx'); const cy = g('cy'); const rx = name === 'circle' ? g('r') : g('rx'); const ry = name === 'circle' ? g('r') : g('ry');
    if (!(rx > 0 && ry > 0)) return [];
    const pts = []; for (let k = 0; k <= 24; k++) { const a = -Math.PI / 2 + (k / 24) * Math.PI * 2; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
    return [pts];
  }
  if (name === 'line') return [[[g('x1'), g('y1')], [g('x2'), g('y2')]]];
  if (name === 'polyline' || name === 'polygon') {
    const a = nums(attrOf(tag, 'points')); const pts = [];
    for (let k = 0; k + 1 < a.length; k += 2) pts.push([a[k], a[k + 1]]);
    if (name === 'polygon' && pts.length) pts.push([...pts[0]]);
    return pts.length > 1 ? [pts] : [];
  }
  if (name === 'path') return flattenPath(attrOf(tag, 'd'));
  return [];
}

// 文字列の 1 字ずつ（文字参照・サロゲートペアは 1 字）
const CHAR_RE = /&[#a-zA-Z0-9]+;|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]/g;
export const charsOf = (s) => String(s ?? '').match(CHAR_RE) ?? [];
const isWide = (ch) => /[\u2e80-\uffef]/.test(ch);
const advance = (chars, fs) => chars.reduce((w, ch) => w + (isWide(ch) ? fs : fs * 0.56), 0);

// ---- SVG の文字列の解析: キーのある要素（g）・図形・文字の位置（文字列の位置と絶対座標） ----
export function parseShowSvg(svg) {
  const re = /<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/g; // 属性の値の中の「>」（data-relation="a>b" など）でタグを切らない
  const units = []; const shapes = []; const texts = []; const stack = []; const seen = new Map();
  let root = null; let m;
  while ((m = re.exec(svg))) {
    const tok = m[0]; const at = m.index;
    if (tok[0] !== '<') {
      const top = stack[stack.length - 1];
      if (top && top.text && !top.skip) top.text.segs.push({ at, len: tok.length, chars: charsOf(tok) });
      continue;
    }
    if (tok.startsWith('<!') || tok.startsWith('<?')) continue;
    if (tok[1] === '/') {
      const el = stack.pop();
      if (el?.own) { el.own.closeAt = at; el.own.closeEnd = at + tok.length; }
      continue;
    }
    const name = /^<([a-zA-Z][\w:-]*)/.exec(tok)?.[1] ?? '';
    const self = tok.endsWith('/>');
    const parent = stack[stack.length - 1] ?? null;
    const pm = parent ? parent.m : ID;
    const tr = attrOf(tok, 'transform');
    const mm = tr ? mul(pm, parseTransform(tr)) : pm;
    const skip = !!parent?.skip || SKIP.has(name);
    const sa = attrOf(tok, 'stroke'); const sw = attrOf(tok, 'stroke-width');
    const strokeColor = sa != null ? sa : parent?.strokeColor ?? null;
    const stroke = strokeColor != null && strokeColor !== 'none' && strokeColor !== 'transparent' && !(sw != null && num(sw) <= 0) && !(sw == null && parent?.noStrokeWidth);
    const fs = num(attrOf(tok, 'font-size'), parent?.fs ?? 16);
    const anchor = attrOf(tok, 'text-anchor') ?? parent?.anchor ?? 'start';
    const el = { name, m: mm, skip, strokeColor, noStrokeWidth: sw != null ? num(sw) <= 0 : parent?.noStrokeWidth ?? false, fs, anchor, unit: parent?.unit ?? null, text: parent?.text ?? null, own: null };
    if (name === 'svg' && !root) root = { w: num(attrOf(tok, 'width'), 0), h: num(attrOf(tok, 'height'), 0), vb: nums(attrOf(tok, 'viewBox')) };
    if (!skip && name === 'g') {
      const ka = KEY_ATTRS.find((k) => attrOf(tok, k) != null);
      if (ka) {
        const base = `${ka}=${attrOf(tok, ka)}`; const n = seen.get(base) ?? 0; seen.set(base, n + 1);
        const u = { key: n ? `${base}#${n}` : base, keyAttr: ka, kind: attrOf(tok, 'data-kind'), section: ka === 'data-board-section' ? attrOf(tok, ka) : null, count: attrOf(tok, 'data-count'), parent: el.unit, openAt: at, openEnd: at + tok.length, closeAt: at + tok.length, closeEnd: at + tok.length, shapes: [], texts: [], kids: [], idx: units.length, anchor: null, box: null };
        el.unit?.kids.push(u);
        units.push(u); el.unit = u; el.own = u;
      }
    }
    if (!skip && SHAPES.has(name)) {
      const polys = shapeGeometry(name, tok).map((p) => p.map(([x, y]) => ap(mm, x, y)));
      let len = 0; for (const p of polys) for (let k = 1; k < p.length; k++) len += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
      const sh = { at, len: tok.length, tag: tok, unit: el.unit, stroke: stroke && name !== 'image' && name !== 'use', color: stroke ? strokeColor : (attrOf(tok, 'fill') ?? null), polys, length: len };
      shapes.push(sh); el.unit?.shapes.push(sh);
    }
    if (!skip && name === 'text') {
      const [x, y] = ap(mm, num(nums(attrOf(tok, 'x'))[0]), num(nums(attrOf(tok, 'y'))[0]));
      const tx = { at, len: tok.length, tag: tok, unit: el.unit, segs: [], x, y, fs: fs * Math.hypot(mm[0], mm[1]), anchor };
      texts.push(tx); el.unit?.texts.push(tx); el.text = tx;
    }
    if (!self) stack.push(el);
  }
  // 要素の外枠（自分と子孫）と位置の基準（図形の外枠の左上と文字の基準点の最小）
  const grow = (u, x0, y0, x1, y1) => { for (let p = u; p; p = p.parent) { const b = p.box; p.box = b ? [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)] : [x0, y0, x1, y1]; } };
  const anch = (u, x, y) => { for (let p = u; p; p = p.parent) p.anchor = p.anchor ? [Math.min(p.anchor[0], x), Math.min(p.anchor[1], y)] : [x, y]; };
  for (const s of shapes) {
    if (!s.unit) continue;
    const pts = s.polys.flat(); if (!pts.length) continue;
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    grow(s.unit, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)); anch(s.unit, Math.min(...xs), Math.min(...ys));
  }
  for (const t of texts) {
    if (!t.unit) continue;
    const w = advance(t.segs.flatMap((s) => s.chars), t.fs);
    const x0 = t.anchor === 'middle' ? t.x - w / 2 : t.anchor === 'end' ? t.x - w : t.x;
    grow(t.unit, x0, t.y - t.fs, x0 + w, t.y + t.fs * 0.25); anch(t.unit, t.x, t.y);
  }
  return { units, shapes, texts, root, byKey: new Map(units.map((u) => [u.key, u])) };
}

// SVG のキー（data-* の属性=値）から、図の要素の id（getDiagramElements・getBoardModel の id）へ
const ID_PREFIX = { 'data-scene-id': 'scene:', 'data-point-id': 'point:', 'data-group-id': 'group:', 'data-unit-id': 'unit:', 'data-topic-id': 'topic:', 'data-board-section': 'section:', 'data-board-el': '' };
export function elementIdOf(key) {
  const m = /^([\w-]+)=(.*?)(#\d+)?$/.exec(String(key));
  if (!m) return String(key);
  return `${ID_PREFIX[m[1]] ?? `${m[1]}:`}${m[2]}${m[3] ?? ''}`;
}

const snapshotOf = (P) => new Map(P.units.map((u) => [u.key, { anchor: u.anchor, count: u.count }]));
const sectionOf = (u) => { for (let p = u; p; p = p.parent) if (p.section) return p.section; return null; };
const charCount = (u) => u.texts.reduce((n, t) => n + t.segs.reduce((k, s) => k + s.chars.length, 0), 0);
const drawLength = (u) => u.shapes.reduce((n, s) => n + Math.max(s.length, 1), 0);

// ---- 計画: 運ぶ（同時）→ 新しい要素を読み順に 1 つずつ描く・書く → お祝い（その要素を描き終えた時点から） ----
export function planShow(prev, P, opts = {}) {
  const T = { ...SHOW_TIMING, ...(opts.timing ?? {}) };
  const budget = Math.max(0, (opts.intervalMs ?? DEFAULT_INTERVAL_MS) * SHOW_LIMITS.budgetRatio);
  // 運ぶ: 前回の位置から動いた既存の要素（祖先を運ぶなら、その分を差し引いた残りがあるときだけ）
  const carries = []; const applied = new Map();
  for (const u of P.units) {
    const pa = u.parent ? applied.get(u.parent.key) ?? [0, 0] : [0, 0];
    const was = prev.get(u.key);
    if (!was || !was.anchor || !u.anchor) { applied.set(u.key, pa); continue; }
    const d = [was.anchor[0] - u.anchor[0], was.anchor[1] - u.anchor[1]];
    const rel = [d[0] - pa[0], d[1] - pa[1]];
    if (Math.hypot(rel[0], rel[1]) > MOVE_EPS) { carries.push({ key: u.key, dx: rel[0], dy: rel[1] }); applied.set(u.key, d); } else applied.set(u.key, pa);
  }
  let t = carries.length ? Math.min(T.carryMs, SHOW_LIMITS.carryMax) : 0;
  const carryDur = t;
  const units = []; const celebrations = []; const celebrated = new Set();
  const fresh = P.units.filter((u) => !prev.has(u.key));
  for (const u of fresh) {
    const draw = u.shapes.length ? Math.min(SHOW_LIMITS.strokeMax, T.strokeCap, T.strokeMin + drawLength(u) * T.strokePerUnit) : 0;
    const chars = charCount(u); const charMs = Math.min(SHOW_LIMITS.charMax, T.charMs);
    units.push({ key: u.key, start: t, draw, write: chars * charMs, charMs });
    t += draw + chars * charMs;
    // お祝い（AC-675）: 決定事項（会議ボード型の決定事項の区画への追加、種類「結論」の要点）と、空だった区画・新しいトピック
    const sec = sectionOf(u);
    const decided = (u.kind === 'conclusion' || (sec === 'decisions' && u.keyAttr === 'data-board-el'));
    let firstIn = null;
    if (sec && u.keyAttr === 'data-board-el') { for (let p = u.parent; p; p = p.parent) if (p.section) { const w = prev.get(p.key); if (w && Number(w.count) === 0 && Number(p.count) > 0 && !celebrated.has(p.key)) firstIn = p; break; } }
    if (u.keyAttr === 'data-topic-id') firstIn = u;
    const target = decided ? u : firstIn;
    if (target && !celebrated.has(target.key)) {
      celebrated.add(target.key); if (firstIn) celebrated.add(firstIn.key);
      celebrations.push({ key: target.key, kind: decided ? 'decision' : 'section', start: t, dur: Math.min(SHOW_LIMITS.celebrateMax, T.celebrateMs), seed: hash(target.key) });
    }
  }
  let total = Math.max(t, ...celebrations.map((c) => c.start + c.dur), 0);
  let f = 1;
  // PARAM-182: 各要素の時間を等しく縮める（浮動小数の丸めで予算をわずかに超えないよう、少しだけ小さく取る。超えると次の更新の時点に演出が残る）
  if (total > budget && total > 0) f = (budget / total) * (1 - 1e-9);
  const sc = (v) => v * f;
  const carryOut = sc(carryDur) >= T.minStepMs ? carries.map((c) => ({ ...c, start: 0, dur: sc(carryDur) })) : [];
  const unitOut = units.map((u) => { const d = sc(u.draw + u.write); const instant = d < T.minStepMs; return { ...u, start: sc(u.start), draw: instant ? 0 : sc(u.draw), write: instant ? 0 : sc(u.write), charMs: instant ? 0 : sc(u.charMs) }; });
  const celOut = celebrations.map((c) => ({ ...c, start: sc(c.start), dur: sc(c.dur) })).filter((c) => c.dur >= T.minStepMs);
  total = Math.max(0, ...carryOut.map((c) => c.start + c.dur), ...unitOut.map((u) => u.start + u.draw + u.write), ...celOut.map((c) => c.start + c.dur));
  return { carries: carryOut, units: unitOut, celebrations: celOut, total, scale: f, budget, fresh: fresh.length, moved: carries.length };
}

function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let s = seed || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const r1 = (n) => Math.round(n * 10) / 10;
const r3 = (n) => Math.round(n * 1000) / 1000;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

// 開始タグの属性を置き換える（同じ名前の属性は 1 つにする。HTML の解析は最初の属性を採るため）
export function setAttrs(tag, attrs) {
  let out = tag;
  for (const k of Object.keys(attrs)) out = out.replace(new RegExp(`\\s${k.replace(/[-]/g, '\\-')}="[^"]*"`, 'g'), '');
  const add = Object.entries(attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
  return out.endsWith('/>') ? `${out.slice(0, -2).replace(/\s+$/, '')}${add}/>` : `${out.slice(0, -1)}${add}>`;
}
const opacityOf = (tag) => { const v = attrOf(tag, 'opacity'); return v == null ? 1 : num(v, 1); };
const hide = (tag) => setAttrs(tag, { opacity: '0', 'data-show-hidden': '1' });

function pointAt(polys, frac) {
  const segs = []; let total = 0;
  for (const p of polys) for (let k = 1; k < p.length; k++) { const l = Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]); segs.push([p[k - 1], p[k], l]); total += l; }
  if (!segs.length) { const p = polys[0]?.[0]; return p ? [...p] : null; }
  let goal = Math.max(0, Math.min(1, frac)) * total;
  for (const [a, b, l] of segs) { if (goal <= l || l === 0 && goal === 0) { const k = l ? goal / l : 0; return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; } goal -= l; }
  const last = segs[segs.length - 1][1]; return [...last];
}

// ---- 演出の絵（画風の配色に合わせる。ペン先・手・選択の枠・紙吹雪・きらめき） ----
const FALLBACK = { primary: '#242424', accent: ['#0f6cbd', '#ffb900', '#e3008c', '#13a10e'], background: '#ffffff' };
export function showLook(spec) {
  const p = spec?.palette ?? null;
  const primary = p?.primary ?? p?.text ?? FALLBACK.primary;
  const accent = (Array.isArray(p?.accent) && p.accent.length ? p.accent : FALLBACK.accent).filter(Boolean);
  const confetti = [...new Set([...accent, primary === '#ffffff' ? '#ffd400' : primary, '#ffd400', '#ff6b6b', '#4cc9f0'])].slice(0, 6);
  return { line: primary, barrel: accent[0], cuff: accent[1] ?? accent[0], select: accent[0], glove: '#ffffff', confetti, sparkle: '#ffd400' };
}

export function penSvg(x, y, s, ink, L, writing = false, wobble = 0) {
  const tilt = writing ? 28 + wobble * 4 : 32;
  return `<g data-show-pen="${writing ? 'write' : 'draw'}" transform="translate(${r1(x)} ${r1(y)}) scale(${r3(s)})">`
    + `<ellipse cx="10" cy="3" rx="10" ry="3" fill="#000000" opacity="0.16"/>`
    + `<g transform="rotate(${r1(tilt)})">`
    + `<path d="M0 0L-4.6 -13L4.6 -13Z" fill="${ink}" stroke="${L.line}" stroke-width="0.8" stroke-linejoin="round"/>`
    + `<path d="M-1.4 -9L0 -1.6" stroke="#ffffff" stroke-width="1" stroke-linecap="round" opacity="0.55"/>`
    + `<rect x="-6.6" y="-21.5" width="13.2" height="9" rx="2" fill="#d9dee4" stroke="${L.line}" stroke-width="1"/>`
    + `<path d="M-6.6 -17h13.2" stroke="${L.line}" stroke-width="0.6" opacity="0.5"/>`
    + `<rect x="-7.6" y="-66" width="15.2" height="45" rx="6" fill="${L.barrel}" stroke="${L.line}" stroke-width="1.4"/>`
    + `<rect x="-4.6" y="-62" width="3.2" height="36" rx="1.6" fill="#ffffff" opacity="0.45"/>`
    + `<rect x="-7.6" y="-75" width="15.2" height="12" rx="5.5" fill="${ink}" stroke="${L.line}" stroke-width="1.2"/>`
    + `<path d="M7.6 -61h2.6v19a2 2 0 0 1-2 2h-0.6" fill="none" stroke="${L.line}" stroke-width="1.6" stroke-linecap="round"/>`
    + `</g><circle r="1.8" fill="${ink}"/></g>`;
}

export function handSvg(x, y, s, L, grip, alpha) {
  const fl = r1(20 - 7 * grip); // つかむと指が曲がる
  const finger = (fx) => `<rect x="${fx}" y="-20" width="8" height="${fl}" rx="4" fill="${L.glove}" stroke="${L.line}" stroke-width="1.6"/>`;
  return `<g data-show-hand="${grip >= 0.5 ? 'grab' : 'open'}" opacity="${r3(alpha)}" transform="translate(${r1(x)} ${r1(y)}) scale(${r3(s)})">`
    + `<ellipse cx="3" cy="${r1(4 + 6 * (1 - grip))}" rx="${r1(14 + 4 * (1 - grip))}" ry="3.5" fill="#000000" opacity="0.14"/>`
    + `<g transform="rotate(-12)">${finger(-12)}${finger(-3.5)}${finger(5)}`
    + `<path d="M-14 -47h29a4 4 0 0 1 4 4v15a14 14 0 0 1-14 14h-9a14 14 0 0 1-14-14v-15a4 4 0 0 1 4-4z" fill="${L.glove}" stroke="${L.line}" stroke-width="1.8" stroke-linejoin="round"/>`
    + `<path d="M-8 -40v7M0 -40v7M8 -40v7" stroke="${L.line}" stroke-width="1" stroke-linecap="round" opacity="0.45"/>`
    + `<ellipse cx="-17" cy="-29" rx="5" ry="9.5" transform="rotate(28 -17 -29)" fill="${L.glove}" stroke="${L.line}" stroke-width="1.6"/>`
    + `<rect x="-15" y="-60" width="32" height="13" rx="4.5" fill="${L.cuff}" stroke="${L.line}" stroke-width="1.6"/>`
    + `</g></g>`;
}

function selectSvg(b, dx, dy, L, alpha) {
  const pad = 4; const x = b[0] - pad + dx; const y = b[1] - pad + dy; const w = b[2] - b[0] + pad * 2; const h = b[3] - b[1] + pad * 2;
  const hd = (hx, hy) => `<rect x="${r1(hx - 3.5)}" y="${r1(hy - 3.5)}" width="7" height="7" rx="1.5" fill="#ffffff" stroke="${L.select}" stroke-width="1.6"/>`;
  return `<g data-show-select opacity="${r3(alpha)}"><rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="4" fill="${L.select}" fill-opacity="0.06" stroke="${L.select}" stroke-width="2" stroke-dasharray="6 4"/>${hd(x, y)}${hd(x + w, y)}${hd(x, y + h)}${hd(x + w, y + h)}</g>`;
}

const STAR = 'M0 -8C1 -2 2 -1 8 0C2 1 1 2 0 8C-1 2 -2 1 -8 0C-2 -1 -1 -2 0 -8Z';
export function confettiSvg(b, tau, seed, s, L) {
  const rand = rng(seed);
  const cx = (b[0] + b[2]) / 2; const cy = b[1];
  const fade = tau < 0.7 ? 1 : Math.max(0, (1 - tau) / 0.3);
  const parts = [];
  for (let i = 0; i < 18; i++) {
    const a = (-160 + rand() * 140) * (Math.PI / 180); const v = (70 + rand() * 90) * s; const spin = (rand() - 0.5) * 900;
    const col = L.confetti[Math.floor(rand() * L.confetti.length)]; const kind = Math.floor(rand() * 3);
    const x = cx + Math.cos(a) * v * tau; const y = cy + Math.sin(a) * v * tau + 150 * s * tau * tau;
    const body = kind === 0 ? `<rect x="-3" y="-5" width="6" height="10" rx="1" fill="${col}"/>` : kind === 1 ? `<circle r="3.2" fill="${col}"/>` : `<path d="M-6 0q3 -4 6 0t6 0" fill="none" stroke="${col}" stroke-width="2.4" stroke-linecap="round"/>`;
    parts.push(`<g transform="translate(${r1(x)} ${r1(y)}) rotate(${r1(spin * tau)}) scale(${r3(s)})">${body}</g>`);
  }
  const stars = [];
  for (let i = 0; i < 5; i++) {
    const off = i * 0.12; const k = Math.max(0, Math.min(1, (tau - off) / 0.55)); const z = Math.sin(Math.PI * k);
    if (z <= 0.01) continue;
    const sx = b[0] + (b[2] - b[0]) * (0.1 + 0.2 * i) + (rand() - 0.5) * 10; const sy = b[1] - 6 + (rand() - 0.5) * 16 + (i % 2 ? (b[3] - b[1]) * 0.6 : 0);
    stars.push(`<g transform="translate(${r1(sx)} ${r1(sy)}) scale(${r3(z * s * (0.8 + 0.3 * (i % 3)))})"><path d="${STAR}" fill="${i % 2 ? L.sparkle : L.confetti[0]}" stroke="#ffffff" stroke-width="0.8"/><circle r="1.6" fill="#ffffff"/></g>`);
  }
  const ring = `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1((8 + 46 * tau) * s)}" fill="none" stroke="${L.sparkle}" stroke-width="${r1(3 * (1 - tau) + 0.5)}" opacity="${r3(0.7 * (1 - tau))}"/>`;
  return `<g data-show-confetti opacity="${r3(fade)}">${ring}${parts.join('')}${stars.join('')}</g>`;
}

// ---- いまの時刻の見た目: 最終の SVG に、計画の時刻に応じた変更を当てる（純粋関数） ----
export function renderShowFrame(svg, P, plan, elapsed, opts = {}) {
  const edits = []; const overlay = []; const L = opts.look ?? showLook(null);
  const s = opts.scale ?? 1; const overlays = opts.overlays !== false;
  const stats = { hiddenUnits: 0, partialStroke: 0, partialText: 0, carrying: 0, celebrating: 0, pen: null, hands: [] };
  const rep = (at, del, ins, prio = 2) => edits.push({ at, del, ins, prio });
  // 新しい要素: 描線 → 書き込み
  for (const tm of plan.units) {
    const u = P.byKey.get(tm.key); if (!u) continue;
    const local = elapsed - tm.start;
    if (local >= tm.draw + tm.write) continue;
    if (local < 0) { stats.hiddenUnits++; for (const sh of u.shapes) rep(sh.at, sh.len, hide(sh.tag)); for (const tx of u.texts) rep(tx.at, tx.len, hide(tx.tag)); continue; }
    if (local < tm.draw) {
      const total = u.shapes.reduce((n, sh) => n + Math.max(sh.length, 1), 0);
      const prog = (local / tm.draw) * total; let acc = 0; let pen = null;
      for (const sh of u.shapes) {
        const l = Math.max(sh.length, 1); const k = (prog - acc) / l; acc += l;
        if (k >= 1) continue;
        if (k <= 0) { rep(sh.at, sh.len, hide(sh.tag)); continue; }
        const kk = r3(k);
        if (sh.stroke) {
          const fo = attrOf(sh.tag, 'fill-opacity'); const fov = fo == null ? 1 : num(fo, 1);
          rep(sh.at, sh.len, setAttrs(sh.tag, { pathLength: '1', 'stroke-dasharray': '1 1', 'stroke-dashoffset': String(r3(1 - k)), 'fill-opacity': String(r3(fov * k * k)), 'data-show-drawing': String(kk) }));
          stats.partialStroke++;
        } else rep(sh.at, sh.len, setAttrs(sh.tag, { opacity: String(r3(opacityOf(sh.tag) * k)), 'data-show-drawing': String(kk) }));
        if (!pen) { const p = pointAt(sh.polys, k); if (p) pen = { x: p[0], y: p[1], ink: sh.stroke ? sh.color : (sh.color && sh.color !== 'none' ? sh.color : L.line) }; }
      }
      for (const tx of u.texts) rep(tx.at, tx.len, hide(tx.tag));
      if (pen) { stats.pen = { ...pen, mode: 'draw' }; if (overlays) overlay.push(penSvg(pen.x, pen.y, s, pen.ink, L, false)); }
      continue;
    }
    // 書き込み: 先頭から n 字（まだ書いていない字は透明の tspan。文字の配置は最終と同じ）
    let n = tm.charMs > 0 ? Math.floor((local - tm.draw) / tm.charMs) : Infinity; let pen = null;
    for (const tx of u.texts) {
      const cnt = tx.segs.reduce((k, sg) => k + sg.chars.length, 0);
      if (n >= cnt) { n -= cnt; continue; }
      if (n <= 0 && !pen) { pen = penAtText(tx, 0); }
      if (n <= 0) { rep(tx.at, tx.len, hide(tx.tag)); continue; }
      rep(tx.at, tx.len, setAttrs(tx.tag, { 'data-show-writing': String(n) })); stats.partialText++;
      let left = n; const done = [];
      for (const sg of tx.segs) {
        const w = Math.max(0, Math.min(sg.chars.length, left)); left -= w;
        done.push(...sg.chars.slice(0, w));
        if (w >= sg.chars.length) continue;
        const ink = sg.chars.slice(0, w).join(''); const rest = sg.chars.slice(w).join('');
        rep(sg.at, sg.len, `${ink}<tspan data-show-unwritten fill-opacity="0" stroke-opacity="0">${rest}</tspan>`);
      }
      pen = penAtText(tx, n, done);
      n = 0;
    }
    if (pen) { stats.pen = { ...pen, mode: 'write' }; if (overlays) overlay.push(penSvg(pen.x, pen.y, s, pen.ink ?? L.line, L, true, Math.sin(elapsed / 45))); }
  }
  // 運ぶ: つかむ（0〜0.2）→ 途中の位置を経て運ぶ（0.2〜0.85）→ 離す（0.85〜1）
  for (const c of plan.carries) {
    const u = P.byKey.get(c.key); if (!u) continue;
    const k = (elapsed - c.start) / c.dur;
    if (k >= 1 || k < 0) continue;
    const mk = Math.max(0, Math.min(1, (k - 0.2) / 0.65)); const e = ease(mk);
    const dx = c.dx * (1 - e); const dy = c.dy * (1 - e);
    rep(u.openAt, 0, `<g data-show-carry="${escapeAttr(c.key)}" transform="translate(${r1(dx)} ${r1(dy)})">`, 1);
    rep(u.closeEnd, 0, '</g>', 0);
    stats.carrying++;
    if (u.box) {
      const alpha = k < 0.12 ? k / 0.12 : k > 0.9 ? (1 - k) / 0.1 : 1;
      const grip = k < 0.2 ? Math.min(1, k / 0.15) : k > 0.85 ? Math.max(0, 1 - (k - 0.85) / 0.1) : 1;
      const hx = (u.box[0] + u.box[2]) / 2 + dx; const hy = u.box[1] + Math.min(14, (u.box[3] - u.box[1]) / 2) + dy;
      stats.hands.push({ key: c.key, x: hx, y: hy, grip });
      if (overlays) overlay.push(selectSvg(u.box, dx, dy, L, alpha), handSvg(hx, hy - (1 - grip) * 10 * s, s, L, grip, alpha));
    }
  }
  // お祝い
  for (const c of plan.celebrations) {
    const u = P.byKey.get(c.key); if (!u?.box) continue;
    const tau = (elapsed - c.start) / c.dur;
    if (tau < 0 || tau >= 1) continue;
    stats.celebrating++;
    if (overlays) overlay.push(confettiSvg(u.box, tau, c.seed, s, L));
  }
  if (overlay.length) {
    const end = svg.lastIndexOf('</svg>');
    if (end >= 0) rep(end, 0, `<g data-show-layer aria-hidden="true" pointer-events="none">${overlay.join('')}</g>`, 1);
  }
  if (!edits.length) return { svg, stats };
  edits.sort((a, b) => a.at - b.at || a.prio - b.prio);
  let out = ''; let pos = 0;
  for (const e of edits) { if (e.at < pos) continue; out += svg.slice(pos, e.at) + e.ins; pos = e.at + e.del; }
  out += svg.slice(pos);
  return { svg: out, stats };
}
function penAtText(tx, n, done = []) {
  const all = tx.segs.flatMap((s) => s.chars); const w = advance(all, tx.fs);
  const x0 = tx.anchor === 'middle' ? tx.x - w / 2 : tx.anchor === 'end' ? tx.x - w : tx.x;
  return { x: x0 + advance(done.length ? done : all.slice(0, n), tx.fs), y: tx.y - tx.fs * 0.15, ink: null };
}
const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// ---- アプリ組立の拡張（modules）。描画の拡張（renderBaseSvg）の最も外側に置くため、モジュールの並びの末尾に足す ----
const STRINGS = {
  ja: {
    'show.title': '描画ショー', 'show.hint': '描き足しを、ペン先がなぞって描き・文字を書き込み・手で運び・お祝いする演出で見せます。図の内容と保存物は変わりません。動きを減らす設定では動きを出しません。',
    'show.state.on': 'オン', 'show.state.off': 'オフ',
    'label.show.toggle': '描画ショー', 'tooltip.show.toggle': 'ライブ描画ショー（描き足しをペン・手・お祝いの演出で見せる）のオン・オフを切り替えます',
    'cmd.show.toggle': 'ライブ描画ショーの切り替え（オン・オフ）', 'description.show.toggle': '描き足しを演出で見せる',
    'msg.showState': 'ライブ描画ショー', 'msg.showInstant': 'ライブ描画ショー: {n} 件を描き足しました（動きを減らす設定のため動きなし）', 'msg.showInvalid': 'ライブ描画ショーはオンかオフを指定してください',
  },
  en: {
    'show.title': 'Live show', 'show.hint': 'Shows each update as if drawn live: a pen traces outlines and writes the text, a hand carries moved items, and small confetti celebrates. The diagram and saved files do not change. Reduced motion is respected.',
    'show.state.on': 'On', 'show.state.off': 'Off',
    'label.show.toggle': 'Live show', 'tooltip.show.toggle': 'Turn the live drawing show (pen, hand and celebration effects for each update) on or off',
    'cmd.show.toggle': 'Live show: toggle the live drawing show (on/off)', 'description.show.toggle': 'Animate each update',
    'msg.showState': 'Live drawing show', 'msg.showInstant': 'Live drawing show: added {n} item(s) (no motion because reduced motion is on)', 'msg.showInvalid': 'Specify on or off for the live drawing show',
  },
};

export function liveShowModule(ctx) {
  const { api, state } = ctx;
  const t = ctx.t;
  ctx.i18n.addStrings(STRINGS);
  const raw = readJson(ctx.storage, SHOW_KEY);
  let on = !!raw && typeof raw === 'object' && raw.on === true; // 既定は OFF（AC-672）
  const sched = ctx.options?.scheduler ?? { setTimeout: (f, ms) => { const h = globalThis.setTimeout(f, ms); h?.unref?.(); return h; } };
  const now = () => (typeof ctx.now === 'function' ? ctx.now() : Date.now());
  const reduced = () => ctx.env?.reducedMotion === true;
  const forced = () => api.getForcedColors?.() === true;
  // 演出する面: 2D の図（3D・RPG風の地図・プレゼンテーションの再生中は演出しない。AC-439 の保留と同じ扱い）
  const surface = () => on && state.viewMode !== '3d' && api.getDrawStyle?.() !== 'rpg' && state.presentation?.status !== 'playing';
  let snap = null; let lastBase = null; let parsed = null; let plan = null; let ticking = false; let tickRV = null;
  let instantCount = 0; let lastCount = 0; let fired = 0; let saving = 0;
  const cueLog = [];

  const intervalMs = () => { const s = api.getLiveInterval?.()?.sec; return Number.isFinite(s) && s > 0 ? s * 1000 : DEFAULT_INTERVAL_MS; };
  // 演出の出来事（契約 CONTRACT-LIVE-SHOW: log の type）と効果音（FR-116 AC-677: stroke→pen・appear→pop・move→whoosh・decision→chime・celebrate→sparkle）
  const SFX_OF = { stroke: 'pen', appear: 'pop', move: 'whoosh', decision: 'chime', celebrate: 'sparkle' };
  const eventLog = [];
  const fire = (type, key, detail = {}) => {
    const at = now();
    eventLog.push({ type, id: elementIdOf(key), at }); if (eventLog.length > 400) eventLog.splice(0, eventLog.length - 400);
    const name = SFX_OF[type];
    cueLog.push({ name, key, ...detail }); if (cueLog.length > 200) cueLog.splice(0, cueLog.length - 200);
    try { ctx.showAudio?.cue?.(name, { key, ...detail }); } catch { /* 音の失敗で描画を止めない */ }
  };
  const eventsOf = (p) => {
    const list = [];
    for (const c of p.carries) list.push({ at: c.start, type: 'move', key: c.key });
    for (const u of p.units) {
      const P = parsed?.byKey.get(u.key); if (!P || (!P.shapes.length && !P.texts.length)) continue; // 中身のない入れ物の g
      if (u.draw > 0 && P.shapes.some((s) => s.stroke)) list.push({ at: u.start, type: 'stroke', key: u.key }); // 描線の始まり（ペン）
      list.push({ at: u.start + u.draw + u.write, type: 'appear', key: u.key }); // 描き終えて現れた（ポン）
    }
    for (const c of p.celebrations) {
      if (c.kind === 'decision') list.push({ at: c.start, type: 'decision', key: c.key });
      list.push({ at: c.start, type: 'celebrate', key: c.key, detail: { kind: c.kind } }); // お祝い（紙吹雪・きらめき）の時点で、きらめきの音
    }
    return list.sort((a, b) => a.at - b.at);
  };
  const fireCues = () => {
    if (!plan) return;
    const el = now() - plan.t0;
    while (fired < plan.cues.length && plan.cues[fired].at <= el) {
      const c = plan.cues[fired++];
      if (el - c.at <= 500) fire(c.type, c.key, c.detail); // 時計が大きく進んだときの古い合図はまとめて鳴らさない
    }
  };
  // 次の出来事か演出の終わりまで、tickMs ごとに時計を進める（出来事の時点は ±tickMs 以内）
  const arm = () => { if (ticking || !plan) return; ticking = true; sched.setTimeout(tick, SHOW_TIMING.tickMs); };
  function tick() {
    ticking = false;
    if (!plan) return;
    if (!surface() || reduced()) { finish(); selfEmit(); return; }
    const done = now() - plan.t0 >= plan.total;
    tickRV = (api.getRenderVersion?.() ?? 0) + 1;
    fireCues();
    if (done) finish();
    selfEmit(); // 見た目だけ（文字列・テキスト一覧の版数は進めない）
    if (plan) arm();
  }
  let selfEmitting = 0;
  const selfEmit = () => { selfEmitting++; try { ctx.emit('change', api, { arrangeOnly: true }); } finally { selfEmitting--; } };
  // 演出の終わり: 直近の描き足しの要素は「done」で残す（getLiveShow().items）
  let lastPlan = null;
  const finish = () => { if (plan) { fireCues(); lastPlan = { ...plan, finished: true }; } plan = null; };

  // 図の元の SVG（同じ描画の版数なら作り直さない）と、更新の検出（前回の SVG から加わった・動いた要素があれば計画を作る）
  let baseRv = null; let instant = null;
  // 同じ同期の処理（1 回の描き足し・取込）を表す番号。マイクロタスクで閉じる
  let turn = 0; let turnOpen = false;
  const openTurn = () => { if (!turnOpen) { turnOpen = true; turn++; Promise.resolve().then(() => { turnOpen = false; }); } return turn; };
  const baseNow = () => {
    const rv = api.getRenderVersion?.();
    if (lastBase != null && rv != null && (rv === tickRV || rv === baseRv)) return lastBase;
    const S = baseRender(); baseRv = rv ?? null; return S;
  };
  function detect(sync = false) {
    const S = baseNow();
    if (!surface()) { lastBase = S; parsed = null; snap = null; plan = null; return S; }
    if (S !== lastBase || !parsed) {
      lastBase = S; parsed = parseShowSvg(S);
      const cur = snapshotOf(parsed);
      if (snap) {
        const changed = parsed.units.some((u) => { const w = snap.get(u.key); return !w || (w.anchor && u.anchor && Math.hypot(w.anchor[0] - u.anchor[0], w.anchor[1] - u.anchor[1]) > MOVE_EPS); });
        // 演出するのはライブ（音声・.vtt の再生取込）の更新間隔ごとの描き足し（ctx.liveRefreshing）だけ。手入力・一括取込・周期の再配置などは
        // ON でも演出せず即時に反映する（AC-054・AC-523。進行中の演目は続け、新しい要素はそのまま見せる）
        const liveRefresh = ctx.liveRefreshing === true;
        if (changed && liveRefresh) {
          // 同じ時点の続けての変更（一度の更新・取込で加わる複数の発話）は 1 回の演出にまとめる（まだ何も進んでいない計画を作り直す）
          // （ライブの描き足し 'live:tick' は flushHeld → 再配置 → 通知 が同期で続くので、同じ同期の処理の中の変更もまとめる。AC-675）
          const merge = plan && fired === 0 && (plan.t0 === now() || (turnOpen && plan.turn === turn)) ? plan.from : null;
          if (plan && !merge) finish(); // 前の演出は最後の状態へ収束させてから新しい演出を始める
          const from = merge ?? snap;
          const p = planShow(from, parsed, { intervalMs: intervalMs() });
          lastCount = p.fresh;
          if (reduced()) {
            // 同じ時点の続けての変更は 1 回の描き足しとして数える
            if (instant && instant.at === now()) { instant.n += p.fresh; lastCount = instant.n; } else instant = { at: now(), n: p.fresh }; // AC-675: 動きなし。描き足した件数を状態メッセージで示す（音は現れる・移る時点で鳴らす。AC-677）
            plan = null; lastPlan = { ...p, t0: now(), finished: true, cues: [] };
            for (const c of p.carries) fire('move', c.key);
            for (const u of p.units) { const P = parsed.byKey.get(u.key); if (P && (P.shapes.length || P.texts.length)) fire('appear', u.key); }
            if (p.fresh > 0) {
              instantCount++; const n = lastCount;
              const say = () => ctx.change((s) => { s.message = { key: 'msg.showInstant', text: t('msg.showInstant').replace('{n}', String(n)) }; });
              // 変更の時点で示し、同じ操作の後続の処理がメッセージを置き換えたときは、その操作の後に示し直す（描画の途中では状態を変えない）
              const text = t('msg.showInstant').replace('{n}', String(n));
              if (sync) say();
              Promise.resolve().then(() => { if (state.message?.text !== text && instant?.n === n) say(); });
            }
          } else if (p.total > 0) {
            const t0 = merge ? plan.t0 : now(); const refresh = merge ? plan.refresh : null;
            plan = { ...p, t0, from, turn: openTurn(), refresh }; plan.cues = eventsOf(plan); fired = 0; lastPlan = null; arm(); // 出来事は時計（tick）で起こす
          } else plan = null;
        }
      }
      snap = cur;
    }
    return S;
  }
  // 状態の変更の時点で検出する（描画を待たない。演出の始まりは更新の時点）
  ctx.on('change', () => { if (on && !saving && !selfEmitting) detect(true); });
  // FR-014 との結合（AC-675・AC-521）: ライブの 1 回の描き足し（'live:tick' {count, refresh}）でまとめて加わった要素を 1 つの演目として順に描く。
  // 演目の合計は更新間隔の PARAM-182 の割合以内（planShow の予算）なので、次の描き足しの前に終わる。次の描き足しが来たときに前の演目が
  // 残っていれば（時計が飛んだときなど）、最後の状態へ収束させてから新しい演目を始める（detect の finish）。
  let refreshCount = 0; let lastRefresh = null;
  ctx.on('live:tick', (e) => {
    refreshCount++; lastRefresh = { refresh: e?.refresh ?? refreshCount, count: e?.count ?? 0 };
    if (!on || saving) return;
    detect(true);
    if (plan && turnOpen && plan.turn === turn) plan.refresh = lastRefresh.refresh;
  });

  const baseRender = api.renderBaseSvg;
  api.renderBaseSvg = () => {
    if (!on || saving) return baseRender();
    const S = detect();
    if (!plan || !surface()) return S;
    const el = now() - plan.t0;
    if (el >= plan.total || reduced()) { finish(); return S; }
    fireCues();
    const w = parsed.root?.w || 1200;
    const look = showLook(api.getDrawStyleSpec?.() ?? null);
    return renderShowFrame(S, parsed, plan, el, { look, scale: Math.max(0.8, Math.min(1.8, w / 1300)), overlays: !forced() }).svg;
  };
  // 保存物（SVG）は演出を含めない（最終の SVG。AC-672）
  const baseSave = api.renderSvgForSave ?? null;
  api.renderSvgForSave = () => { saving++; try { return (baseSave ?? api.renderSvg)(); } finally { saving--; } };

  // ---- いまの時刻の演出の状態（契約 CONTRACT-LIVE-SHOW: items・moves・overlays・log） ----
  const textOf = (u) => u.texts.map((x) => x.segs.map((s) => s.chars.join('')).join('')).join('');
  const charsOfUnit = (u) => u.texts.flatMap((x) => x.segs.flatMap((s) => s.chars));
  const center = (b) => (b ? { x: r1((b[0] + b[2]) / 2), y: r1((b[1] + b[3]) / 2) } : { x: 0, y: 0 });
  function viewOf() {
    const pl = plan ?? lastPlan; const live = !!plan && surface() && !reduced();
    const el = pl ? (pl.finished ? Infinity : now() - pl.t0) : Infinity;
    const items = []; const moves = []; const overlays = [];
    if (!pl || !parsed) return { items, moves, overlays };
    for (const tm of pl.units) {
      const u = parsed.byKey.get(tm.key); if (!u) continue;
      const text = textOf(u); const chars = charsOfUnit(u);
      if (!(tm.draw > 0) && !text) continue; // 描線も文字もない入れ物（区画の枠の g など）は並べない
      const local = el - tm.start;
      let phase = 'done'; let stroke = 1; let shown = text;
      if (local < 0) { phase = 'pending'; stroke = 0; shown = ''; }
      else if (local < tm.draw) { phase = 'stroke'; stroke = Math.max(0, Math.min(1, local / tm.draw)); shown = ''; }
      else if (local < tm.draw + tm.write) { phase = 'write'; const n = tm.charMs > 0 ? Math.floor((local - tm.draw) / tm.charMs) : chars.length; shown = chars.slice(0, Math.max(0, n)).join(''); }
      items.push({ id: elementIdOf(tm.key), text, phase, stroke: r3(stroke), shown });
      if (live && (phase === 'stroke' || phase === 'write')) {
        const pen = phase === 'stroke' ? (() => { const sh = u.shapes.find((s) => s.polys.length); const q = sh ? pointAt(sh.polys, stroke) : null; return q ? { x: r1(q[0]), y: r1(q[1]) } : center(u.box); })() : center(u.box);
        overlays.push({ kind: 'pen', ...pen, targetId: elementIdOf(tm.key), systemColor: forced() });
      }
    }
    for (const c of pl.carries) {
      const u = parsed.byKey.get(c.key); if (!u) continue;
      const to = { x: r1(u.anchor?.[0] ?? 0), y: r1(u.anchor?.[1] ?? 0) }; const from = { x: r1(to.x + c.dx), y: r1(to.y + c.dy) };
      const k = (el - c.start) / c.dur;
      let phase = 'done'; let at = to;
      if (k < 0) { phase = 'pending'; at = from; } else if (k < 1) {
        phase = 'carry'; const e = ease(Math.max(0, Math.min(1, (k - 0.2) / 0.65)));
        at = { x: r1(to.x + c.dx * (1 - e)), y: r1(to.y + c.dy * (1 - e)) };
        if (live) { const b = u.box; overlays.push({ kind: 'hand', x: r1(b ? (b[0] + b[2]) / 2 + (at.x - to.x) : at.x), y: r1(b ? b[1] + (at.y - to.y) : at.y), targetId: elementIdOf(c.key), systemColor: forced() }); }
      }
      moves.push({ id: elementIdOf(c.key), phase, from, to, at });
    }
    if (live) for (const c of pl.celebrations) {
      const tau = (el - c.start) / c.dur; if (tau < 0 || tau >= 1) continue;
      const u = parsed.byKey.get(c.key); const pt = center(u?.box);
      overlays.push({ kind: 'confetti', ...pt, targetId: elementIdOf(c.key), systemColor: forced() }, { kind: 'sparkle', ...pt, targetId: elementIdOf(c.key), systemColor: forced() });
    }
    // 強制カラーでは演出の絵を出さない（AC-675。renderSvg にも描かない）
    return { items, moves, overlays: forced() ? [] : overlays };
  }

  const label = () => t(on ? 'show.state.on' : 'show.state.off');
  const isRunning = () => !!plan && surface() && !reduced() && now() - plan.t0 < plan.total;
  api.getLiveShow = () => {
    if (on && !saving) detect();
    if (plan && now() - plan.t0 >= plan.total) finish();
    else fireCues();
    return { on, label: t('show.title'), stateText: label(), reducedMotion: reduced(), running: isRunning(), surface: surface(), lastAddedCount: lastCount, ...viewOf(), log: eventLog.map((e) => ({ ...e })) };
  };
  // 会議ボード型の出現・移動の演出（AC-669）を置き換えるか（決定 C-01）。動きを減らす設定では、どちらも動きなし
  // AC-667 (f): 置き換えるのはライブの更新間隔ごとの描き足しの最中だけ。手入力・一括取込の単発の反映は ON でも board.js の出現・移動（PARAM-181 以内）を通る
  api.isLiveShowDriving = () => on && !reduced() && ctx.liveRefreshing === true;
  api.getLiveShowStatus = () => ({
    on, running: isRunning(), instantCount, lastCount, refreshCount, lastRefresh: lastRefresh ? { ...lastRefresh } : null,
    plan: plan ? { total: plan.total, budget: plan.budget, scale: plan.scale, fresh: plan.fresh, moved: plan.moved, refresh: plan.refresh ?? null, units: plan.units.map((u) => ({ ...u })), carries: plan.carries.map((c) => ({ ...c })), celebrations: plan.celebrations.map((c) => ({ ...c })), elapsed: now() - plan.t0 } : null,
    cues: cueLog.map((c) => ({ ...c })),
  });
  // 演出の音（FR-116）: ショーの ON/OFF に合わせて音を有効にし、ON で BGM を始める（鳴るのは利用者の最初の操作の後だけ。showaudio.js が判定）
  const syncAudio = () => { try { ctx.showAudio?.setEnabled?.(on); if (on) ctx.showAudio?.startBgm?.(); } catch { /* 音の失敗で描画を止めない */ } };
  api.syncLiveShowAudio = syncAudio;
  api.setLiveShow = (next) => {
    if (typeof next !== 'boolean') { ctx.change((s) => { s.message = { key: 'msg.showInvalid', text: t('msg.showInvalid') }; }); return { ok: false, reason: 'invalid' }; }
    on = next; writeJson(ctx.storage, SHOW_KEY, { on });
    snap = null; parsed = null; plan = null; lastPlan = null; lastBase = null; baseRv = null; // ON にした時点の図を基準にする（それまでの要素は演出しない）
    syncAudio();
    ctx.change((s) => { s.message = { key: 'msg.showState', text: `${t('msg.showState')}: ${label()}` }; });
    return { ok: true, on };
  };
  // ［設定］の項目の値の変更（契約: show.enabled・live.interval。ほかの項目は後続のモジュールが足す）
  const baseSetField = api.setSettingsField;
  api.setSettingsField = (id, value) => {
    if (id === 'show.enabled') return api.setLiveShow(value);
    if (id === 'live.interval' && typeof api.setLiveInterval === 'function') return api.setLiveInterval(value);
    return baseSetField ? baseSetField(id, value) : { ok: false, reason: 'not_found' };
  };
  ctx.registerCommand('show.toggle', () => api.setLiveShow(!on));
  ctx.registerKey({ key: '~', ctrl: true, alt: true, shift: true, command: 'show.toggle' }); // NFR-A11Y-001: キーボードだけでも操作できる

  // ---- ［設定］画面の項目 ----
  const baseDialog = api.getSettingsDialog;
  if (baseDialog) api.getSettingsDialog = () => { const d = baseDialog(); return d ? { ...d, fields: [...d.fields, { id: 'show.enabled', label: t('show.title'), value: on, role: 'switch', stateText: label(), description: t('show.hint') }] } : d; };
  const baseView = api.getSettingsView;
  if (baseView) api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, { id: 'show.enabled', visible: true }] }; };

  // 端末ごとの設定。セッションの保存物には含めない（データの初期化・セッションファイルでは変わらない）。初期化・復元では演出の途中だけを消す
  const clearRun = () => { snap = null; parsed = null; plan = null; lastPlan = null; lastBase = null; baseRv = null; };
  ctx.registerPersist('liveShow', { export: () => undefined, import: clearRun, reset: clearRun });
}

// ---- コマンドバーの項目（設定グループ）: 状態を文字でも示す（AC-672）。リボンの「設定」グループ（ribbonsettings.js）の後に足す ----
export function liveShowBarModule(ctx) {
  const { api } = ctx;
  const t = ctx.t;
  const showLabel = () => t(api.getLiveShow().on ? 'show.state.on' : 'show.state.off');
  const on = () => api.getLiveShow().on;

  const baseBar = api.getCommandBar;
  if (baseBar) {
    api.getCommandBar = () => {
      const bar = baseBar();
      return { ...bar, items: bar.items.map((it) => (it.command !== 'show.toggle' ? it : { ...it, settingsField: 'show.enabled', kind: 'toggle', value: on(), pressed: on(), stateText: showLabel(), description: t('description.show.toggle'), descriptionVisible: false })) };
    };
  }
  const baseOp = api.operateBarItem;
  if (baseOp) {
    api.operateBarItem = (command, value) => {
      if (command !== 'show.toggle') return baseOp(command, value);
      const r = api.setLiveShow(value === undefined ? !on() : value);
      return r.ok ? { ok: true, effect: 'state' } : { ok: false, effect: 'none' };
    };
  }
}
