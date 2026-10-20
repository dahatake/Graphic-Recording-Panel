// 画風プリセット（FR-075・FR-076）の System Test の補助。契約: tests/system/CONTRACT-STYLE-PRESET.md
// 期待値（PRESETS）は要求定義書 3.6 の表と FR-075 の候補だけから決める。web/ の実装の値は使わない。
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from './helpers.js';

export const LEGACY = ['handwritten', 'anime', 'simple', 'rpg'];
export const PARAM_007 = 4.5; // 本文の文字の最小コントラスト比
export const PARAM_083 = 3; // 要点の枠・吹き出しの輪郭と紙面の最小コントラスト比

// 3.6 の表（FR-076）。width: 太め・やや太め・太い=thick、中=medium、細め・細い=thin
export const PRESETS = [
  { ja: '黄黒手書き風', en: 'Yellow Black', paper: 'plain', font: 'handwriting', heading: 'band', balloon: 'cloud', wobble: true, width: 'thick', figures: true },
  { ja: '黒板風', en: 'Chalkboard', paper: 'chalkboard', font: 'handwriting', heading: 'marker', balloon: 'rounded', wobble: true, width: 'thick', figures: true },
  { ja: '付箋ボード風', en: 'Sticky Notes', paper: 'whiteboard', font: 'handwriting', heading: 'sticky', balloon: 'sticky', wobble: true, width: 'medium', figures: false },
  { ja: '色鉛筆風', en: 'Color Pencil', paper: 'ruled', font: 'handwriting', heading: 'marker', balloon: 'rounded', wobble: true, width: 'thin', figures: true },
  { ja: 'ミント風', en: 'Mint Note', paper: 'grid', font: 'roundGothic', heading: 'marker', balloon: 'rounded', wobble: true, width: 'medium', figures: false },
  { ja: 'ビジネス風', en: 'Business', paper: 'plain', font: 'gothic', heading: 'band', balloon: 'rounded', wobble: false, width: 'thin', figures: false },
  { ja: 'ミニマル風', en: 'Minimal', paper: 'plain', font: 'gothic', heading: 'classic', balloon: 'rounded', wobble: false, width: 'thin', figures: false },
  { ja: 'ポップ風', en: 'Pop Color', paper: 'plain', font: 'roundGothic', heading: 'band', balloon: 'cloud', wobble: false, width: 'thick', figures: true },
  { ja: 'クラフト紙風', en: 'Kraft Paper', paper: 'kraft', font: 'handwriting', heading: 'sticky', balloon: 'sticky', wobble: true, width: 'medium', figures: true },
];
export const PAPERS = ['plain', 'grid', 'ruled', 'chalkboard', 'whiteboard', 'kraft'];
export const FONTS = ['handwriting', 'roundGothic', 'gothic'];
export const HEADINGS = ['band', 'marker', 'sticky', 'classic'];
export const BALLOONS = ['cloud', 'rounded', 'sticky'];
export const SYSTEM_COLORS = ['canvas', 'canvastext', 'linktext', 'visitedtext', 'activetext', 'buttonface', 'buttontext', 'buttonborder', 'field', 'fieldtext',
  'highlight', 'highlighttext', 'selecteditem', 'selecteditemtext', 'mark', 'marktext', 'graytext', 'accentcolor', 'accentcolortext'];

// ---- 色 ----
export function rgb(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3})$/);
  if (m) return [0, 1, 2].map((i) => parseInt(m[1][i] + m[1][i], 16));
  m = s.match(/^#([0-9a-f]{6})$/);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].substr(i, 2), 16));
  m = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (m) return [1, 2, 3].map((i) => Number(m[i]));
  if (s === 'white') return [255, 255, 255];
  if (s === 'black') return [0, 0, 0];
  return null;
}
export function lum(c) {
  const v = rgb(c); assert.ok(v, `色として解釈できる: ${c}`);
  const [r, g, b] = v.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function hsv(c) {
  const [r, g, b] = rgb(c).map((x) => x / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
export const isYellow = (c) => { if (!rgb(c)) return false; const { h, s, v } = hsv(c); return h >= 40 && h <= 65 && s >= 0.6 && v >= 0.8; };
export const isNeutral = (c) => { const v = rgb(c); return !!v && Math.max(...v) - Math.min(...v) <= 24; };
export const isBlack = (c) => isNeutral(c) && Math.max(...rgb(c)) <= 0x33;
export const isGray = (c) => isNeutral(c) && !isBlack(c) && lum(c) < 0.8;
export const isBlackOrGray = (c) => isBlack(c) || isGray(c);
export const isWhite = (c) => { const v = rgb(c); return !!v && Math.min(...v) >= 0xf0; };

// ---- SVG の簡易パーサ（要素・属性・親子・文字） ----
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
export function parseSvg(svg) {
  const all = []; const stack = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g;
  for (const m of svg.matchAll(re)) {
    if (m[0].startsWith('<!--')) continue;
    const textPart = m[1] ?? m[6];
    if (textPart !== undefined) { const t = decode(textPart); for (const n of stack) n.text += t; continue; }
    const [, , close, tag, attrStr, selfClose] = m;
    if (close) { while (stack.length && stack.at(-1).tag !== tag) stack.pop(); stack.pop(); continue; }
    const attrs = {};
    for (const a of (attrStr || '').matchAll(/([^\s=>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
    const node = { tag, attrs, parent: stack.at(-1) || null, children: [], text: '', index: all.length };
    if (node.parent) node.parent.children.push(node);
    all.push(node);
    if (!selfClose) stack.push(node);
  }
  const within = (n, tags) => { for (let p = n.parent; p; p = p.parent) if (tags.includes(p.tag)) return true; return false; };
  const root = all.find((n) => n.tag === 'svg');
  return {
    all, root,
    role: (r) => all.filter((n) => n.attrs['data-style-role'] === r),
    texts: () => all.filter((n) => n.tag === 'text' && !within(n, ['defs', 'title', 'desc', 'symbol', 'marker'])),
    within,
  };
}
export const descendants = (doc, g) => doc.all.filter((n) => { for (let q = n.parent; q; q = q.parent) if (q === g) return true; return false; });
export const box = (n) => { const v = String(n.attrs['data-box'] ?? '').trim().split(/[\s,]+/).map(Number); return v.length === 4 && v.every(Number.isFinite) ? { x: v[0], y: v[1], w: v[2], h: v[3] } : null; };
export const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
export function fontList(ff) {
  const out = []; let cur = ''; let q = null;
  for (const ch of String(ff ?? '')) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}
// 図に描かれた文字の集合（<title> 等を除く）
export const svgTextSet = (svg) => [...new Set(parseSvg(svg).texts().map((t) => t.text.trim()).filter(Boolean))].sort();

// ---- アプリの準備 ----
// 表示名（日本語）→ 風の id
export function presetIds(app) {
  const map = new Map();
  for (const s of app.getDrawStyles()) map.set(s.label, s.id);
  const ids = {};
  for (const p of PRESETS) { assert.ok(map.has(p.ja), `選択肢に「${p.ja}」がある`); ids[p.ja] = map.get(p.ja); }
  return ids;
}
// 3 シーン（課題「困った」・決定「決める」を含む）を詳細度「詳細」で表示した状態
export async function seededApp(over = {}) {
  const ctx = await newApp(over);
  ctx.app.setLang('ja');
  await seedThreeScenes(ctx.app, ctx.env);
  toDetail(ctx.app);
  ctx.ids = presetIds(ctx.app);
  return ctx;
}
export function usePreset(app, ids, ja) {
  const id = ids[ja];
  const r = app.setDrawStyle(id);
  assert.equal(r && r.ok, true, `「${ja}」を選べる`);
  assert.equal(app.getDrawStyle(), id);
  return { id, svg: app.renderSvg(), doc: parseSvg(app.renderSvg()), spec: app.getDrawStyleSpec(id) };
}
export const pointsOf = (app) => app.getDiagramStyle().scenes.flatMap((s) => s.points);
export function stateTexts(app) {
  const out = [];
  for (const s of app.getState().scenes) { out.push(s.heading); for (const p of s.points) out.push(p.text); }
  return out;
}
