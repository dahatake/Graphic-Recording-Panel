// FR-004: 2D のグラフィック・ファシリテーション表示。シーンごとに「見出し・吹き出し（要点）・矢印（関係線）・絵記号」を SVG で描く。
// 純粋関数 renderDiagramSvg（単体で SVG ファイルとしても自立する。色は属性で持つ）と、パネル描画（拡大・縮小・移動）。
import { sceneEmotions } from './emotion.js';
import { matchParts, getPartGroup } from './parts.js';
import { renderRpgSvg, RPG_STYLE_ID } from './rpgmap.js';
import { provisionalTree, leaves, subgroupLabel, countMark, TYPE_SCALE } from './infodesign.js';
// NFR-UX-012 AC-466: 既存の 4 つの描画スタイルの図の書体の指定（欧文専用の書体がないため Yu Gothic UI が先頭。stylepresets.js の LEGACY_FONT_FAMILY と同じ）
const SVG_FONT_FAMILY = `font-family="'Yu Gothic UI', system-ui, 'Hiragino Sans', Meiryo, sans-serif"`;

export const STATUS_MARK = { in_progress: '○', confirmed: '●' };
const SELECTED_MARK = '▶';
// 色分け（見出しは白文字で 4.5:1 以上）。色だけに頼らず、状態は記号と枠線の種類でも示す。
const PALETTE = ['#1346a8', '#0b5d2a', '#8a3c00', '#6b2a8f', '#9b1c1c', '#0b6070'];
const INK = '#15191f';
const PAPER = '#ffffff';

const FS = 14; const FS_HEAD = 18;
const HL_COLOR = '#b45309'; // 強調（ハイライト）の色。白地に 3:1 以上
const ICON_W = 28; // 要点の左に置く絵記号の幅

// FR-015 AC-074: 要点の種類。色に加えて形（shape）と絵記号（icon）が異なるので、白黒でも見分けられる。
export const KINDS = {
  conclusion: { color: '#0b5d2a', shape: 'banner', icon: 'check' },
  issue: { color: '#9b1c1c', shape: 'octagon', icon: 'alert' },
  idea: { color: '#8a3c00', shape: 'hexagon', icon: 'bulb' },
  note: { color: '#1346a8', shape: 'rect', icon: 'note' },
  // FR-052: 提案・未決定は結論と別の種類（色・形・絵記号が異なる）
  proposal: { color: '#6b2a8f', shape: 'tab', icon: 'bolt' },
  undecided: { color: '#0b6070', shape: 'slant', icon: 'cloud' },
};
// FR-015 の 4 種類（3D の評価軸などの従来の集計用）。提案はアイデア、未決定は補足に含める。
export const BASE_KIND_IDS = ['conclusion', 'issue', 'idea', 'note'];
export const baseKind = (k) => (k === 'proposal' ? 'idea' : k === 'undecided' ? 'note' : k);
// FR-052 AC-231: 種類の文字のラベル（図と一覧で同じ語）
export const KIND_LABELS = {
  ja: { conclusion: '結論', issue: '課題', idea: 'アイデア', note: '補足', proposal: '提案', undecided: '未決定' },
  en: { conclusion: 'Conclusion', issue: 'Issue', idea: 'Idea', note: 'Note', proposal: 'Proposal', undecided: 'Undecided' },
};
export const kindLabelOf = (kind, lang) => KIND_LABELS[lang === 'en' ? 'en' : 'ja'][kind] ?? kind;
// ASSUMPTION: 種類は語のパターンで決める（決定的・外部通信なし）。上から順に最初に合うもの、どれにも合わなければ補足。
// FR-052: 合意済みの決定を述べる発言だけを結論とする。決定の否定・保留は未決定、提案する発言は提案。
const KIND_RULES = [
  ['undecided', /未定|未決|決まっていない|決まらない|決めていない|決定していない|決まって(い)?ません|決めかね|保留|(not|n't)\s+(yet\s+)?(been\s+)?(decided|agreed|concluded|resolved|settled)|\bundecided\b|\bto be decided\b|\btbd\b|yet to (decide|agree)/i],
  ['issue', /困|課題|問題|不安|心配|遅れ|高い|高く|できない|足りな|不足|障害|エラー|trouble|problem|issue|risk|bug|stuck|blocked|difficult/i],
  ['proposal', /提案|propos|suggest|recommend/i],
  // AC-231: 「〜と決まりました」など合意済みの決定は、アイデア・案の語を含んでいても結論
  ['conclusion', /決ま(りまし|った)|決定しまし|決めまし|合意しまし|採用(が)?決定/],
  ['idea', /アイデア|ひらめ|\bidea\b/i],
  ['conclusion', /決め|決定|決ま|結論|合意|方針|採用|にする|します|decid|conclu|agree|resolv|chose/i],
  ['idea', /案|しよう|してみ|かも|どう|how about|what if|maybe|[?？]/i],
];
export function classifyPoint(text) {
  const s = String(text ?? '');
  for (const [k, re] of KIND_RULES) if (re.test(s)) return k;
  return 'note';
}
// FR-029: 描画スタイル（drawstyles.js の定義）。描画の間だけ有効（同期処理）。既定は手書き調＝従来の見た目。
const HAND = { line: { width: 1, jitter: 1 }, fill: { mode: 'paper' }, text: { decor: 'standard', icons: true } };
let ST = HAND;
const HEAD_WEIGHT = { standard: 800, bold: 900, plain: 700 };
const sw = (n) => Math.round(n * ST.line.width * 100) / 100; // 線の太さ（スタイルの倍率）
// 塗り: 'tint' は種類の色を白に薄く混ぜた面、'paper' は白地
function paperFor(color) {
  if (ST.fill.mode !== 'tint' || !/^#[0-9a-f]{6}$/i.test(color)) return '#ffffff';
  const mix = (i) => Math.round(parseInt(color.slice(i, i + 2), 16) * 0.14 + 255 * 0.86).toString(16).padStart(2, '0');
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}
const decoIcon = (shape, x, y, color) => (ST.text.icons ? iconShape(shape, x, y, color) : '');

// 決定的な手描き風の線: 文字列から種を作り、同じ入力なら必ず同じ揺らぎにする。
export function rng(seedStr) {
  let h = 2166136261;
  for (const ch of String(seedStr)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const r1 = (n) => Math.round(n * 10) / 10;
// 折れ線（頂点列）を細かく分け、各点を少しずらした path の d を返す。
function wobblyD(pts, seed, closed, amp0 = 1.2) {
  const rand = rng(seed);
  const amp = amp0 * ST.line.jitter;
  const out = [];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const [ax, ay] = pts[i]; const [bx, by] = pts[(i + 1) % n];
    const len = Math.hypot(bx - ax, by - ay);
    const k = Math.max(1, Math.round(len / 26));
    for (let j = 0; j < k; j++) {
      const f = j / k;
      out.push([ax + (bx - ax) * f + (rand() - 0.5) * 2 * amp, ay + (by - ay) * f + (rand() - 0.5) * 2 * amp]);
    }
  }
  if (!closed) { const [lx, ly] = pts[n - 1]; out.push([lx + (rand() - 0.5) * amp, ly + (rand() - 0.5) * amp]); }
  return out.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join('') + (closed ? 'Z' : '');
}
export function outline(shape, x, y, w, h) {
  switch (shape) {
    case 'banner': return [[x, y], [x + w - 14, y], [x + w, y + h / 2], [x + w - 14, y + h], [x, y + h]];
    case 'octagon': return [[x + 10, y], [x + w - 10, y], [x + w, y + 10], [x + w, y + h - 10], [x + w - 10, y + h], [x + 10, y + h], [x, y + h - 10], [x, y + 10]];
    case 'hexagon': return [[x + 14, y], [x + w - 14, y], [x + w, y + h / 2], [x + w - 14, y + h], [x + 14, y + h], [x, y + h / 2]];
    case 'tab': return [[x, y], [x + w - 22, y], [x + w, y + 12], [x + w, y + h], [x, y + h]];
    case 'slant': return [[x + 14, y], [x + w, y], [x + w - 14, y + h], [x, y + h]];
    default: return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }
}
const PAD = 20; const HEAD_H = 44; const BUBBLE_H = 38; const GAP = 30; const SCENE_GAP = 64; const MARGIN = 24;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');
export function textWidth(s, size) {
  let w = 0;
  for (const ch of String(s)) w += ch.codePointAt(0) >= 0x2e80 ? size : size * 0.56;
  return w;
}

// 絵記号の中身（24x24 の枠に収まる図形）。FR-075 の画風プリセットの絵記号も同じ図形を使う。
export const ICON_GLYPHS = {
  swirl: '<path d="M12 12m0-2a2 2 0 1 1-2 2 5 5 0 1 1 5 5 8 8 0 1 1-8-8"/>',
  sweat: '<circle cx="12" cy="13" r="9"/><path d="M8 11v2M16 11v2M8 18q4-3 8 0"/><path d="M20 3q2 3 0 4q-2-1 0-4z"/>',
  cloud: '<path d="M7 19a5 5 0 0 1-1-9.9A6 6 0 0 1 17.5 8 4.5 4.5 0 0 1 17 19z"/>',
  bolt: '<path d="M13 2L5 14h6l-1 8 9-13h-6z"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 10h.01M16 10h.01M7.5 14.5q4.5 5 9 0"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  burst: '<path d="M12 2l2.5 6L21 7l-4 5 4 5-6.500-1L12 22l-2.500-6L3 17l4-5-4-5 6.500 1z"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="M7 12.500l3.500 3.500 7-8"/>',
  alert: '<path d="M12 3L22 20H2z"/><path d="M12 10v5M12 17.500v.5"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M8 11h8M8 15h8"/>',
  star: '<path d="M12 2l3 7 7 .5-5.500 4.500 2 7.500-6.500-4-6.500 4 2-7.500L2 9.500 9 9z"/>',
  drop: '<path d="M12 2q7 8 7 13a7 7 0 0 1-14 0q0-5 7-13z"/>',
};
export const iconGlyph = (shape) => ICON_GLYPHS[shape] ?? '<circle cx="12" cy="12" r="9"/>';
// 絵記号（24x24 の枠に収まる図形）。(x,y) は左上。
function iconShape(shape, x, y, color) {
  return `<g transform="translate(${x} ${y})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconGlyph(shape)}</g>`;
}

// FR-079: 詳細度「詳細」の 2D の図の幾何（シーンは話順に左から右の列、列の中は見出し→要点（再配置の木の読み順）→絵記号→部品）。
// 描画（renderDiagramSvg）と図の要素の外枠（app.getDiagramElements）が同じ値を使う。trees: Map(sceneId → 木。infodesign.js)。
// 木がないシーンは話順のまま（まとめない）。列の幅と高さはそのシーンの内容だけで決まるので、後ろのシーンの変化で前の列は動かない（AC-432(b)）。
const SUB_HEAD = 26; const SUB_PAD = 10; const SUB_GAP = 20; const FS_SUB = 15;
export function detailGeometry(scenes, trees = null, lang = 'ja', originX = 0) {
  const out = []; let x = MARGIN + originX;
  for (const s of scenes) {
    const tree = trees?.get?.(s.id) ?? provisionalTree(s, null);
    const byId = new Map(s.points.map((p) => [p.id, p]));
    const grouped = tree.children.some((n) => n.type === 'subgroup');
    const inset = grouped ? SUB_PAD : 0;
    const emos = sceneEmotions(s);
    const emoW = Math.max(0, ...emos.map((e) => 34 + textWidth(e.word, FS)));
    const pw = (leaf) => { const p = byId.get(leaf.refIds[0]); const c = countMark(leaf.refIds.length); return textWidth(p?.text ?? '', FS) + 32 + ICON_W + textWidth(kindLabelOf(classifyPoint(p?.text), lang), 11) + 12 + (c ? textWidth(c, 11) + 8 : 0) + inset * 2; };
    const count = (n) => n.children.reduce((a, l) => a + l.refIds.length, 0);
    const subs = tree.children.filter((n) => n.type === 'subgroup').map((n) => textWidth(subgroupLabel(n, lang, count(n)), FS_SUB) + SUB_PAD * 2 + 8);
    const w = Math.ceil(Math.max(240, textWidth(s.heading, FS_HEAD) + 70, ...leaves(tree).map(pw), ...subs, emoW + 32));
    const points = []; const subgroups = [];
    let y = MARGIN + HEAD_H + GAP;
    const place = (leaf, parent, idx, px, ww) => { points.push({ key: leaf.key, refIds: [...leaf.refIds], parent, readIndex: idx, x: px, y, w: ww, h: BUBBLE_H, provisional: leaf.provisional === true }); y += BUBBLE_H + GAP; };
    tree.children.forEach((n, ci) => {
      if (n.type !== 'subgroup') { place(n, null, ci, x, w); return; }
      const top = y; y += SUB_HEAD;
      n.children.forEach((l, li) => place(l, n.key, li, x + SUB_PAD, w - SUB_PAD * 2));
      const bottom = y - GAP + 8 + SUB_PAD; // 最後の吹き出しの尾（8）＋内側の余白
      subgroups.push({ key: n.key, node: n, readIndex: ci, x, y: top, w, h: bottom - top, label: subgroupLabel(n, lang, count(n)), refIds: n.children.flatMap((l) => l.refIds), provisional: false });
      y = bottom + SUB_GAP;
    });
    const contentEnd = y;
    y += emos.length * 34;
    if (matchParts([s.heading, ...s.points.map((p) => p.text)].join('\n'), 4).length) y += 48;
    out.push({ sceneId: s.id, x, w, y: MARGIN, h: y - MARGIN, contentEnd, end: y, points, subgroups, emotions: emos, provisional: tree.provisional === true });
    x += w + SCENE_GAP;
  }
  return out;
}

// scenes: アプリの状態のシーン配列。opts: { selectedSceneId, t, title, trees（FR-079 の再配置の木） }
export function renderDiagramSvg(scenes, opts = {}) {
  ST = opts.style ?? HAND;
  const t = opts.t ?? ((k) => k);
  const sel = opts.selectedSceneId ?? null;
  const hlId = opts.highlightPointId ?? null;
  const parts = []; let x = MARGIN; let maxH = 0;
  const heads = []; const rects = new Map();
  const geo = detailGeometry(scenes, opts.trees ?? null, opts.lang, opts.originX ?? 0);
  scenes.forEach((s, i) => {
    const g = geo[i];
    const color = PALETTE[i % PALETTE.length];
    const emos = g.emotions;
    x = g.x; const w = g.w;
    const isSel = s.id === sel;
    const body = [];
    const cx = x + w / 2;
    // 見出し（色分けの帯＋太い下線）。要点より大きく太い。
    body.push(`<path d="${wobblyD(outline('rect', x, MARGIN, w, HEAD_H), `${s.id}:h`, true, 1.4)}" fill="${color}" stroke="${isSel ? INK : color}" stroke-width="${sw(isSel ? 4 : 2)}" stroke-linejoin="round" data-role="heading-band"/>`);
    body.push(`<text x="${x + 14}" y="${MARGIN + 29}" font-size="${FS_HEAD}" font-weight="${HEAD_WEIGHT[ST.text.decor]}" fill="#ffffff" data-role="status">${STATUS_MARK[s.status] ?? ''}${isSel ? SELECTED_MARK : ''}</text>`);
    body.push(`<text x="${x + 44}" y="${MARGIN + 29}" font-size="${FS_HEAD}" font-weight="${HEAD_WEIGHT[ST.text.decor]}" fill="#ffffff" data-role="heading">${esc(s.heading)}</text>`);
    body.push(`<path d="${wobblyD([[x + 6, MARGIN + HEAD_H + 6], [x + w - 6, MARGIN + HEAD_H + 6]], `${s.id}:u`, false, 1.2)}" fill="none" stroke="${color}" stroke-width="${sw(3)}" stroke-linecap="round"/>`);
    // 要点の吹き出し（種類ごとに 色・形・絵記号 が異なる）。並び・下位のまとまり・同一の要点のまとめは再配置の木（FR-079）に従う。
    const top = new Map();
    const dash = s.status === 'in_progress' ? ' stroke-dasharray="6 4"' : '';
    const byId = new Map(s.points.map((p) => [p.id, p]));
    for (const sg of g.subgroups) {
      body.push(`<g data-subgroup="${attr(sg.key)}" data-subgroup-kind="${attr(sg.node.kind)}"><path d="${wobblyD(outline('rect', sg.x, sg.y, sg.w, sg.h), `${sg.key}:g`, true, 0.8)}" fill="none" stroke="${color}" stroke-width="${sw(1.2)}" stroke-dasharray="4 3" data-role="subgroup-frame"/>`
        + `<text x="${sg.x + SUB_PAD}" y="${sg.y + 18}" font-size="${FS_SUB}" font-weight="700" fill="${INK}" data-role="subgroup-heading">${esc(sg.label)}</text></g>`);
    }
    for (const g1 of g.points) {
      const p = byId.get(g1.refIds[0]);
      if (!p) continue;
      const { x: px, y, w: pw } = g1;
      for (const id of g1.refIds) { top.set(id, y); rects.set(id, { x: px, y, w: pw, sceneId: s.id }); }
      const kind = classifyPoint(p.text);
      const k = KINDS[kind];
      const hl = hlId != null && g1.refIds.includes(hlId);
      const stroke = hl ? HL_COLOR : k.color;
      const concl = kind === 'conclusion'; const sWidth = sw(hl ? 5 : concl ? 4.5 : 2.5);
      const frame = hl ? `<path d="${wobblyD(outline(k.shape, px - 6, y - 6, pw + 12, BUBBLE_H + 12), `${p.id}:f`, true, 1.2)}" fill="none" stroke="${HL_COLOR}" stroke-width="2" stroke-dasharray="3 3" data-role="highlight-frame"/>` : '';
      const star = hl ? `<g data-role="highlight-icon">${iconShape('star', px + pw - 20, y - 16, HL_COLOR)}</g>` : '';
      const paper = paperFor(k.color);
      const label = kindLabelOf(kind, opts.lang);
      const dup = countMark(g1.refIds.length);
      const dupSvg = dup ? `<text data-role="dup-count" x="${r1(px + pw - 14 - textWidth(label, 11))}" y="${y + 12}" font-size="11" font-weight="700" text-anchor="end" fill="${INK}">${esc(dup)}</text>` : '';
      body.push(`<g data-point-id="${attr(p.id)}"${g1.refIds.length > 1 ? ` data-point-ids="${attr(g1.refIds.join(' '))}"` : ''} data-kind="${kind}"${hl ? ' data-highlight="1"' : ''}${g1.provisional ? ' data-provisional="1"' : ''}>${frame}`
        + `<path d="${wobblyD(outline(k.shape, px, y, pw, BUBBLE_H), p.id, true)}" fill="${paper}" stroke="${stroke}" stroke-width="${sWidth}" stroke-linejoin="round"${dash}/>`
        + `<path d="${wobblyD([[px + 18, y + BUBBLE_H], [px + 12, y + BUBBLE_H + 8], [px + 26, y + BUBBLE_H]], `${p.id}:t`, false, 0.4)}"         fill="${paper}" stroke="${stroke}" stroke-width="${sw(2.5)}" stroke-linejoin="round"/>`
        + decoIcon(k.icon, px + 8, y + 7, stroke)
        + `<text x="${px + 8 + ICON_W}" y="${y + 24}" font-size="${FS}"${concl ? ' ' + 'font-weight="800"' : ''} fill="${INK}">${esc(p.text)}</text>`
        + `<text data-role="kind-label" x="${px + pw - 8}" y="${y + 12}" font-size="11" font-weight="700" text-anchor="end" fill="${INK}">${esc(label)}</text>${dupSvg}${star}</g>`);
    }
    let y = g.contentEnd;
    // 関係線（手描き風の矢印）。FR-079: 再配置で並びが変わったときは、同じまとまりの隣り合う要素の間だけに引く（ほかの要素を横切らない）
    const slot = new Map(); for (const g1 of g.points) for (const id of g1.refIds) slot.set(id, g1);
    for (const r of s.relations) {
      const a = top.get(r.from); const b = top.get(r.to);
      if (a == null || b == null || a === b) continue; // FR-079 AC-429: まとめた要素の中の関係は描かない
      const sa = slot.get(r.from); const sb = slot.get(r.to);
      if (sa.parent !== sb.parent || Math.abs(sa.readIndex - sb.readIndex) !== 1) continue;
      const [from, to] = a <= b ? [a, b] : [b, a];
      const hot = hlId != null && (r.from === hlId || r.to === hlId);
      body.push(`<path data-relation="${attr(r.from)}>${attr(r.to)}"${hot ? ' data-highlight="1"' : ''} d="${wobblyD([[cx, from + BUBBLE_H + 4], [cx, to - 3]], `${r.from}>${r.to}`, false, 1)}" fill="none" stroke="${hot ? HL_COLOR : color}" stroke-width="${sw(hot ? 5 : 2.5)}" stroke-linecap="round" marker-end="url(#${hot ? 'arrow-hl' : `arrow-${i % PALETTE.length}`})"/>`);
    }
    // 絵記号（感情・様子の語）
    emos.forEach((e) => {
      body.push(`<g data-emotion="${attr(e.id)}">${decoIcon(e.shape, x + 14, y - 8, color)}<text x="${x + 44}" y="${y + 10}" font-size="${FS}" font-weight="700" fill="${INK}">${esc(e.word)}</text></g>`);
      y += 34;
    });
    // FR-064: 同梱部品（語の辞書で対応づけた汎用の物体。LLM 連携なしで描く）
    const objs = matchParts([s.heading, ...s.points.map((p) => p.text)].join('\n'), 4);
    if (objs.length) {
      objs.forEach((o, n) => {
        body.push(`<g data-part-key="${attr(o.key)}" transform="translate(${x + 14 + n * 56} ${y - 8})">${getPartGroup(o.key)}</g>`);
      });
      y += 48;
    }
    // シーンの囲み（背面）
    body.unshift(`<path d="${wobblyD(outline('rect', x - 10, MARGIN - 10, w + 20, y - MARGIN + 6), `${s.id}:e`, true, 1.6)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-opacity="0.45" stroke-dasharray="2 5" data-role="scene-frame"/>`);
    parts.push(`<g data-scene-id="${attr(s.id)}" data-status="${attr(s.status)}"${isSel ? ' aria-current="true"' : ''}>${body.join('')}</g>`);
    heads.push({ x, w, color });
    maxH = Math.max(maxH, y + MARGIN);
    x += w + SCENE_GAP;
  });
  // FR-053: 要点どうしの関係線（種類のラベル・向き=始点→終点の矢印・明示/推測）。推測は破線＋文字「推測」で、明示と見分ける。
  const relSvg = (opts.relations ?? []).map((r, ri) => {
    const a = rects.get(r.from); const b = rects.get(r.to);
    if (!a || !b || (a.x === b.x && a.y === b.y)) return '';
    const inferred = r.basis === 'inferred';
    const dashA = inferred ? ' stroke-dasharray="5 4"' : '';
    const label = `${r.kindLabel}（${r.basisLabel}）`;
    const ya = a.y + BUBBLE_H / 2; const yb = b.y + BUBBLE_H / 2;
    let d; let lx; let ly;
    if (a.sceneId === b.sceneId) {
      const ex = a.x + a.w; const off = 22 + (ri % 3) * 8;
      d = `M${r1(ex)} ${r1(ya)} C${r1(ex + off)} ${r1(ya)} ${r1(ex + off)} ${r1(yb)} ${r1(ex + 3)} ${r1(yb)}`; lx = ex + off + 4; ly = (ya + yb) / 2;
    } else {
      const fwd = b.x >= a.x; const x1 = fwd ? a.x + a.w : a.x; const x2 = fwd ? b.x - 3 : b.x + b.w + 3;
      d = `M${r1(x1)} ${r1(ya)} L${r1(x2)} ${r1(yb)}`; lx = (x1 + x2) / 2; ly = (ya + yb) / 2 - 4;
    }
    return `<g data-role="point-relation"><path data-relation-kind="${attr(r.kind)}" data-relation-from="${attr(r.from)}" data-relation-to="${attr(r.to)}" data-relation-basis="${attr(r.basis)}" d="${d}" fill="none" stroke="${INK}" stroke-width="2"${dashA} marker-end="url(#arrow-flow)"/>`
      + `<text data-relation-label x="${r1(lx)}" y="${r1(ly)}" font-size="11" font-weight="700" fill="${INK}">${esc(label)}</text></g>`;
  }).join('');
  // シーン間の矢印（時系列）
  const flows = heads.slice(0, -1).map((h, i) => {
    const y = MARGIN + HEAD_H / 2; const nx = heads[i + 1].x;
    return `<path data-flow="${i}" d="${wobblyD([[h.x + h.w + 12, y], [nx - 12, y]], `flow${i}`, false, 1)}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" marker-end="url(#arrow-flow)"/>`;
  });
  const emptyW = scenes.length ? 0 : MARGIN * 2 + Math.ceil([...t('diagram.empty')].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? FS : FS * 0.6), 0));
  const width = Math.max(320, emptyW, x - SCENE_GAP + MARGIN);
  const height = Math.max(160, maxH);
  const markers = PALETTE.map((c, i) => `<marker id="arrow-${i}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`).join('')
    + `<marker id="arrow-flow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${INK}"/></marker>`
    + `<marker id="arrow-hl" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="${HL_COLOR}"/></marker>`;
  const title = esc(opts.title ?? '');
  const empty = scenes.length ? '' : `<text x="${MARGIN}" y="${MARGIN + 24}" font-size="${FS}" fill="${INK}">${esc(t('diagram.empty'))}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ${SVG_FONT_FAMILY} role="img" aria-label="${attr(opts.title ?? '')}">`
    + `<title>${title}</title><defs>${markers}</defs><rect width="100%" height="100%" fill="${PAPER}"/>${parts.join('')}${flows.join('')}${relSvg}${empty}</svg>`;
}

// FR-079: 大項目・中項目の幾何（トピックは話順に左から右の箱、中項目ではその下にシーンの見出しの行。1 トピックのシーンが PARAM-088 を超えると、
// 話順のまま下位のまとまり（chunks）に分ける。AC-428）。描画（renderTopicsSvg）と図の要素の外枠が同じ値を使う。
const T_ROW = 32; const T_BOX_GAP = 90;
// FR-079 AC-432(b): 関連の弧の帯の高さは一定（弧の高さを ARC_SPAN_MAX 個分の距離で頭打ちにする）。後から加わる関連で前のトピックが下へ動かない。
const ARC_SPAN_MAX = 3;
export const arcHeight = (span) => 36 + 20 * Math.min(Math.max(span, 1), ARC_SPAN_MAX);
export const TOPICS_TOP = MARGIN + arcHeight(ARC_SPAN_MAX) + 22;
export function topicsGeometry(topics, relations, scenes, opts = {}) {
  const t = opts.t ?? ((k) => k);
  const level = opts.level === 'middle' ? 'middle' : 'major';
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const selText = t('topic.selected');
  const top = TOPICS_TOP;
  const out = []; let x = MARGIN + (opts.originX ?? 0);
  for (const tp of topics) {
    const heads = tp.sceneIds.map((id) => byId.get(id)).filter(Boolean);
    const chunks = level === 'middle' ? (opts.chunks?.get?.(tp.id) ?? null) : null;
    const inset = chunks ? 14 : 0;
    const w = Math.ceil(Math.max(220, textWidth(tp.title, TYPE_SCALE.topic) + 40,
      level === 'middle' ? Math.max(0, ...heads.map((s) => textWidth(s.heading, TYPE_SCALE.scene) + 48 + inset * 2)) : 0,
      tp.containsSelected && level === 'major' ? textWidth(selText, FS) + 48 : 0));
    let y = top + HEAD_H + 22;
    const rows = []; const subs = [];
    let selY = null;
    if (level === 'major' && tp.containsSelected) { selY = y; y += T_ROW - 6; }
    const row = (s, parent, idx, rx, rw) => { rows.push({ sceneId: s.id, parent, readIndex: idx, x: rx, y: y - 20, w: rw, h: 26, baseline: y }); y += T_ROW; };
    if (level === 'middle' && chunks) {
      const live = new Set(heads.map((s) => s.id));
      const list = chunks.map((c) => c.filter((id) => live.has(id))).filter((c) => c.length);
      list.forEach((c, ci) => {
        const subTop = y - 22; y = subTop + 44;
        c.forEach((id, k) => row(byId.get(id), `${tp.id}:${ci + 1}`, k, x + inset, w - inset * 2));
        const bottom = y - T_ROW + 10;
        subs.push({ key: `${tp.id}:${ci + 1}`, readIndex: ci, x: x + 4, y: subTop, w: w - 8, h: bottom - subTop, label: `${ci + 1}/${list.length}（${c.length}）`, refIds: [...c] });
        y = bottom + 14 + 22;
      });
    } else if (level === 'middle') heads.forEach((s, k) => row(s, null, k, x + 6, w - 12));
    out.push({ topicId: tp.id, x, y: top, w, h: y - top - 8, end: y, rows, subs, selY });
    x += w + T_BOX_GAP;
  }
  return { top, topics: out, end: x };
}

// FR-025/FR-026: 2D の時系列で詳細度が「大項目」「中項目」のときの図。トピックを大項目の箱（題名）、中項目ではその下にシーンの見出しを描く。
// トピック間の関係は線と種類の文字（順・関連）で示し、色だけに頼らない。要点・関係線・絵記号は描かない（テキスト一覧・ポップアップで確認できる）。
// topics: [{id,title,sceneIds,containsSelected}]、relations: [{id,from,to,kind,label}]、scenes: アプリのシーン配列。opts: { level, selectedSceneId, t, title, chunks }
export function renderTopicsSvg(topics, relations, scenes, opts = {}) {
  ST = opts.style ?? HAND;
  const t = opts.t ?? ((k) => k);
  const sel = opts.selectedSceneId ?? null;
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const BOX_GAP = T_BOX_GAP;
  const selText = t('topic.selected');
  const boxes = []; const groups = []; let x = MARGIN;
  const geo = topicsGeometry(topics, relations, scenes, opts);
  const { top } = geo;
  let maxH = 0;
  topics.forEach((tp, i) => {
    const g = geo.topics[i];
    const color = PALETTE[i % PALETTE.length];
    const marks = (s) => `${s.id === sel ? SELECTED_MARK : ''}`;
    x = g.x; const { w } = g;
    const body = [];
    body.push(`<path d="${wobblyD(outline('rect', x, top, w, HEAD_H), `${tp.id}:h`, true, 1.4)}" fill="${color}" stroke="${tp.containsSelected ? INK : color}" stroke-width="${tp.containsSelected ? 4 : 2}" stroke-linejoin="round" data-role="topic-band"/>`);
    body.push(`<text x="${x + 14}" y="${top + 29}" font-size="${TYPE_SCALE.topic}" font-weight="800" fill="#ffffff" data-role="topic-title">${esc(tp.title)}</text>`);
    if (g.selY != null) body.push(`<text x="${x + 10}" y="${g.selY}" font-size="${FS}" font-weight="700" fill="${INK}" data-role="contains-selected">${SELECTED_MARK} ${esc(selText)}</text>`);
    for (const sg of g.subs) {
      body.push(`<g data-subgroup="${attr(sg.key)}"><path d="${wobblyD(outline('rect', sg.x, sg.y, sg.w, sg.h), `${sg.key}:g`, true, 0.8)}" fill="none" stroke="${color}" stroke-width="${sw(1.2)}" stroke-dasharray="4 3" data-role="subgroup-frame"/>`
        + `<text x="${sg.x + 8}" y="${sg.y + 17}" font-size="${FS_SUB}" font-weight="700" fill="${INK}" data-role="subgroup-heading">${esc(sg.label)}</text></g>`);
    }
    for (const r of g.rows) {
      const s = byId.get(r.sceneId);
      const on = s.id === sel;
      body.push(`<text x="${r.x + 4}" y="${r.baseline}" font-size="${TYPE_SCALE.scene}" font-weight="${on ? 800 : 600}" fill="${INK}" data-scene-id="${attr(s.id)}" data-role="scene-heading"${on ? ' aria-current="true"' : ''}>${STATUS_MARK[s.status] ?? ''}${marks(s)} ${esc(s.heading)}</text>`);
    }
    const y = g.end;
    body.unshift(`<path d="${wobblyD(outline('rect', x - 10, top - 10, w + 20, y - top + 2), `${tp.id}:e`, true, 1.6)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-opacity="0.45" stroke-dasharray="2 5" data-role="topic-frame"/>`);
    boxes.push({ id: tp.id, x, w, color });
    groups.push(`<g data-topic-id="${attr(tp.id)}"${tp.containsSelected ? ' aria-current="true"' : ''}>${body.join('')}</g>`);
    maxH = Math.max(maxH, y + MARGIN);
    x += w + BOX_GAP;
  });
  const pos = new Map(boxes.map((b) => [b.id, b]));
  const lines = [];
  for (const r of relations) {
    const a = pos.get(r.from); const b = pos.get(r.to);
    if (!a || !b) continue;
    const label = esc(r.label ?? t(`topic.rel.${r.kind}`));
    if (r.kind === 'order') {
      const y = top + HEAD_H / 2;
      lines.push(`<g data-topic-relation="${attr(r.id)}" data-kind="order"><path d="M${a.x + a.w + 10} ${y} L${b.x - 12} ${y}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" marker-end="url(#arrow-flow)"/>`
        + `<text x="${(a.x + a.w + b.x) / 2}" y="${y - 8}" text-anchor="middle" font-size="${FS}" font-weight="700" fill="${INK}" data-role="relation-label">${label}</text></g>`);
    } else {
      const ax = a.x + a.w / 2; const bx = b.x + b.w / 2; const h = arcHeight(Math.abs(topics.findIndex((q) => q.id === r.to) - topics.findIndex((q) => q.id === r.from)));
      lines.push(`<g data-topic-relation="${attr(r.id)}" data-kind="related"><path d="M${ax} ${top - 10} C${ax} ${top - 10 - h} ${bx} ${top - 10 - h} ${bx} ${top - 12}" fill="none" stroke="${INK}" stroke-width="2.5" stroke-dasharray="6 4" stroke-linecap="round" marker-end="url(#arrow-flow)"/>`
        + `<text x="${(ax + bx) / 2}" y="${top - 10 - h * 0.75 - 4}" text-anchor="middle" font-size="${FS}" font-weight="700" fill="${INK}" data-role="relation-label">${label}</text></g>`);
    }
  }
  const width = Math.max(320, (geo.topics.length ? x - BOX_GAP : MARGIN + (opts.originX ?? 0)) + MARGIN);
  const height = Math.max(160, maxH);
  const marker = `<marker id="arrow-flow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${INK}"/></marker>`;
  const title = esc(opts.title ?? '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ${SVG_FONT_FAMILY} role="img" aria-label="${attr(opts.title ?? '')}">`
    + `<title>${title}</title><defs>${marker}</defs><rect width="100%" height="100%" fill="${PAPER}"/>${groups.join('')}${lines.join('')}</svg>`;
}

// FR-016 AC-078 AC-079 AC-089: 意味のある配置（整理の表示）の SVG。model は app.getArrangement()（geometry つき）。
// 軸の名前・区分の見出し・未分類の領域は <text> の文字で示し、色だけに頼らない。
export function renderArrangedSvg(scenes, model, opts = {}) {
  ST = opts.style ?? HAND;
  const g = model.geometry;
  const sel = opts.selectedSceneId ?? null;
  const hlId = opts.highlightPointId ?? null;
  const parts = [];
  // 区分の見出し・枠
  g.rows.forEach((r) => {
    parts.push(`<rect x="${g.margin}" y="${r.y}" width="${g.width - g.margin * 2}" height="${r.h}" fill="${r.id ? '#f7f9fc' : '#fff7ed'}" stroke="#8a94a6" stroke-width="1"${r.id ? '' : ' stroke-dasharray="6 4"'} data-role="row" data-section="${attr(r.id ?? 'unclassified')}"/>`);
    parts.push(`<text x="${g.margin + 8}" y="${r.y + 22}" font-size="${FS}" font-weight="700" fill="${INK}" data-role="row-label">${esc(r.label)}</text>`);
  });
  g.cols.forEach((c) => {
    parts.push(`<path d="M${c.x} ${g.top} V${g.height - g.margin}" stroke="#8a94a6" stroke-width="1"${c.id ? '' : ' stroke-dasharray="6 4"'} data-role="col" data-section="${attr(c.id ?? 'unclassified')}"/>`);
    parts.push(`<text x="${c.x + 10}" y="${g.top - 8}" font-size="${FS}" font-weight="700" fill="${INK}" data-role="col-label">${esc(c.label)}</text>`);
  });
  parts.push(`<text x="${g.margin}" y="${g.margin + 16}" font-size="${FS_HEAD}" font-weight="800" fill="${INK}" data-role="axis-name-h">${esc(model.axisLabels.horizontal)}: ${esc(model.axes.horizontal.name)}</text>`);
  parts.push(`<text x="${g.margin}" y="${g.margin + 38}" font-size="${FS_HEAD}" font-weight="800" fill="${INK}" data-role="axis-name-v">${esc(model.axisLabels.vertical)}: ${esc(model.axes.vertical.name)}</text>`);
  // オブジェクト（要点の吹き出し・シーンの見出し）
  const sceneIdx = new Map(scenes.map((s, i) => [s.id, i]));
  // FR-025 AC-135: 大項目・中項目の整理では、トピック間の関係を線と種類の文字で示す（色だけに頼らない）
  const topicIdx = new Map((opts.topics ?? []).map((tp, i) => [tp.id, i]));
  const cen = new Map(g.items.filter((q) => q.kind === 'topic').map((q) => [q.id, { x: q.x + q.w / 2, y: q.y + q.h / 2 }]));
  const relLabels = [];
  for (const r of opts.relations ?? []) {
    const a = cen.get(r.from); const b = cen.get(r.to);
    if (!a || !b) continue;
    parts.push(`<path data-topic-relation="${attr(r.id)}" data-kind="${attr(r.kind)}" d="M${a.x} ${a.y} L${b.x} ${b.y}" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"${r.kind === 'related' ? ' stroke-dasharray="6 4"' : ''}/>`);
    relLabels.push(`<text x="${(a.x + b.x) / 2}" y="${(a.y + b.y) / 2 - 4}" text-anchor="middle" font-size="${FS}" font-weight="700" fill="${INK}" stroke="${PAPER}" stroke-width="3" paint-order="stroke" data-role="relation-label">${esc(r.label)}</text>`);
  }
  for (const it of g.items) {
    const reason = `<title>${esc(it.reason)}</title>`;
    if (it.kind === 'topic') {
      const tp = (opts.topics ?? []).find((q) => q.id === it.id);
      const color = PALETTE[(topicIdx.get(it.id) ?? 0) % PALETTE.length];
      const cs = !!tp?.containsSelected;
      parts.push(`<g data-topic-id="${attr(it.id)}" data-assigned="${it.unclassified ? 'unclassified' : 'assigned'}"${cs ? ' aria-current="true"' : ''}>${reason}`
        + `<path d="${wobblyD(outline('rect', it.x, it.y, it.w, it.h), `${it.id}:h`, true, 1.2)}" fill="${color}" stroke="${cs ? INK : color}" stroke-width="${cs ? 4 : 2}" stroke-linejoin="round" data-role="topic-band"/>`
        + `<text x="${it.x + 10}" y="${it.y + it.h - 11}" font-size="${FS_HEAD - 2}" font-weight="800" fill="#ffffff" data-role="topic-title">${cs ? SELECTED_MARK : ''} ${esc(it.text)}</text>`
        + (cs ? `<text x="${it.x + 10}" y="${it.y + it.h + 12}" font-size="${FS - 2}" fill="${INK}" data-role="contains-selected">${esc(opts.selectedLabel ?? '')}</text>` : '')
        + '</g>');
    } else if (it.kind === 'scene') {
      const sc = scenes[sceneIdx.get(it.id)];
      const color = PALETTE[sceneIdx.get(it.id) % PALETTE.length];
      const isSel = it.id === sel;
      parts.push(`<g data-scene-id="${attr(it.id)}" data-assigned="${it.unclassified ? 'unclassified' : 'assigned'}"${isSel ? ' aria-current="true"' : ''}>${reason}`
        + `<path d="${wobblyD(outline('rect', it.x, it.y, it.w, it.h), `${it.id}:h`, true, 1.2)}" fill="${color}" stroke="${isSel ? INK : color}" stroke-width="${isSel ? 4 : 2}" stroke-linejoin="round" data-role="heading-band"/>`
        + `<text x="${it.x + 10}" y="${it.y + it.h - 11}" font-size="${FS_HEAD - 2}" font-weight="800" fill="#ffffff" data-role="heading">${STATUS_MARK[sc.status] ?? ''}${isSel ? SELECTED_MARK : ''} ${esc(sc.heading)}</text></g>`);
    } else if (it.kind === 'subgroup') {
      // FR-079 AC-433 AC-428: 区分の中の下位のまとまりの小見出し（種類のラベルと件数）
      parts.push(`<text x="${it.x + 4}" y="${it.y + 24}" font-size="${FS_SUB}" font-weight="700" fill="${INK}" data-role="subgroup-heading" data-subgroup="${attr(it.id)}">${esc(it.text)}</text>`);
    } else {
      const p = scenes.flatMap((s) => s.points).find((q) => q.id === it.id);
      const kind = classifyPoint(p.text); const k = KINDS[kind];
      const refIds = it.refIds ?? [p.id];
      const hl = hlId != null && refIds.includes(hlId);
      const stroke = hl ? HL_COLOR : k.color;
      const dup = countMark(refIds.length); // FR-079 AC-429: 同一の要点のまとめの件数
      parts.push(`<g data-point-id="${attr(p.id)}"${refIds.length > 1 ? ` data-point-ids="${attr(refIds.join(' '))}"` : ''} data-kind="${kind}" data-assigned="${it.unclassified ? 'unclassified' : 'assigned'}"${hl ? ' data-highlight="1"' : ''}>${reason}`
        + `<path d="${wobblyD(outline(k.shape, it.x, it.y, it.w, BUBBLE_H), p.id, true)}" fill="${PAPER}" stroke="${stroke}" stroke-width="${hl ? 5 : 2.5}" stroke-linejoin="round"/>`
        + iconShape(k.icon, it.x + 8, it.y + 7, stroke)
        + `<text x="${it.x + 8 + ICON_W}" y="${it.y + 24}" font-size="${FS}" fill="${INK}">${esc(p.text)}</text>`
        + (dup ? `<text data-role="dup-count" x="${it.x + it.w - 8}" y="${it.y + 12}" font-size="11" font-weight="700" text-anchor="end" fill="${INK}">${esc(dup)}</text>` : '')
        + '</g>');
    }
  }
  parts.push(...relLabels);
  const title = esc(opts.title ?? '');
  const { width, height } = g;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ${SVG_FONT_FAMILY} role="img" aria-label="${attr(opts.title ?? '')}" data-display-mode="arrange">`
    + `<title>${title}</title><rect width="100%" height="100%" fill="${PAPER}"/>${parts.join('')}</svg>`;
}

// ---- パネル（拡大・縮小・移動できるキャンバス） ----
export const ZOOM_MIN = 0.4; export const ZOOM_MAX = 3; export const ZOOM_STEP = 1.25;
export const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export function mountDiagramPanel(host, app, doc = host.ownerDocument) {
  if (!host.dataset.diagramBuilt) {
    host.dataset.diagramBuilt = '1';
    host.innerHTML = '<div class="diagram-tools" role="group"></div><div class="diagram-canvas" tabindex="0" role="region"></div>';
    host._zoom = 1;
    host._lastSvg = null; host._ver = undefined; host._svgEl = null; // 作り直した器には必ず描く
    const tools = host.querySelector('.diagram-tools');
    const mk = (cmd, label) => {
      const b = doc.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm'; b.dataset.zoom = cmd; b.textContent = label;
      b.addEventListener('click', () => {
        host._fit = cmd !== 'reset';
        host._zoom = cmd === 'in' ? clampZoom(host._zoom * ZOOM_STEP) : cmd === 'out' ? clampZoom(host._zoom / ZOOM_STEP) : 1;
        app.setDiagramView?.({ zoom: host._zoom }, { silent: true }); // FR-080 AC-439: 拡大率は app が持ち、再描画（再配置）で保つ
        paint(host, app);
      });
      tools.append(b);
    };
    mk('out', '－'); mk('reset', '1:1'); mk('in', '＋');
    const canvas = host.querySelector('.diagram-canvas');
    // ドラッグで移動。キーボードでは矢印キーによるスクロールと、拡大・縮小ボタンが使える。
    canvas.addEventListener('pointerdown', (ev) => {
      if (ev.button > 0) return;
      const sx = ev.clientX; const sy = ev.clientY; const l = canvas.scrollLeft; const tp = canvas.scrollTop;
      canvas.setPointerCapture?.(ev.pointerId); canvas.classList.add('is-panning');
      const move = (e) => { canvas.scrollLeft = l - (e.clientX - sx); canvas.scrollTop = tp - (e.clientY - sy); };
      const up = () => { canvas.classList.remove('is-panning'); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); };
      canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
    });
    canvas.addEventListener('click', (ev) => {
      const g = ev.target?.closest?.('[data-point-id]');
      if (g) { app.highlightPoint(g.getAttribute('data-point-id'), 'pointer'); return; }
      app.clearHighlight();
      // FR-026 AC-137: 2D でトピック（大項目）・シーン（中項目）を選ぶ
      const tp = ev.target?.closest?.('[data-topic-id]'); const sc = ev.target?.closest?.('[data-scene-id]');
      if (tp) app.selectTopic?.(tp.getAttribute('data-topic-id')); else if (sc) app.selectScene(sc.getAttribute('data-scene-id'));
    });
    canvas.addEventListener('wheel', (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      host._zoom = clampZoom(host._zoom * (ev.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
      app.setDiagramView?.({ zoom: host._zoom }, { silent: true });
      paint(host, app);
    }, { passive: false });
    // FR-080 AC-439: 表示位置も app が持ち、再描画（再配置）の後に戻す
    canvas.addEventListener('scroll', () => { app.setDiagramView?.({ scrollX: canvas.scrollLeft, scrollY: canvas.scrollTop }, { silent: true }); }, { passive: true });
  }
  paint(host, app);
}

function paint(host, app) {
  const t = (k) => app.t(k);
  const tools = host.querySelector('.diagram-tools');
  const setAttr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); }; // 同じ値は書かない（NFR-PERF-003）
  setAttr(tools, 'aria-label', t('diagram.tools'));
  const names = { out: t('diagram.zoomOut'), reset: t('diagram.zoomReset'), in: t('diagram.zoomIn') };
  for (const b of tools.querySelectorAll('[data-zoom]')) { setAttr(b, 'title', names[b.dataset.zoom]); setAttr(b, 'aria-label', names[b.dataset.zoom]); }
  const canvas = host.querySelector('.diagram-canvas');
  setAttr(canvas, 'aria-label', t('diagram.canvasLabel'));
  const dv = app.getDiagramView?.() ?? null;
  if (dv) host._zoom = clampZoom(dv.zoom);
  // NFR-PERF-003 AC-538: データの版数が前回の描画と同じなら、SVG を作り直さない（パネルの移動・大きさ変更・スクロール・拡大縮小）
  const ver = app.getRenderVersion?.();
  const same = ver !== undefined && host._ver === ver && host._lastSvg != null;
  const svg = same ? host._lastSvg : app.renderSvg();
  host._ver = ver;
  // 同じ SVG・同じ拡大率・同じ幅なら、DOM を作り直さない（NFR-PERF-002/003: ドラッグ・ホバー中の全再構築を避ける）
  const sig = `${host._zoom}|${host._fit}|${canvas.clientWidth}`;
  if (host._lastSvg === svg && host._lastSig === sig) return;
  // SVG が同じで幅・拡大率だけ変わったとき（パネルの大きさ変更中）は、図の DOM を作り直さず寸法だけ直す（長いタスクの回避）
  const reuse = host._lastSvg === svg && host._base && host._svgEl && host._svgEl.isConnected;
  host._lastSvg = svg; host._lastSig = sig;
  if (!reuse) canvas.innerHTML = svg;
  const el = reuse ? host._svgEl : canvas.querySelector('svg');
  if (el) {
    if (!reuse) { host._svgEl = el; host._base = { w: Number(el.getAttribute('width')), h: Number(el.getAttribute('height')), vb: el.getAttribute('viewBox') }; }
    const { w, h, vb } = host._base;
    if (vb === null) el.removeAttribute('viewBox'); else el.setAttribute('viewBox', vb);
    // 既定は「幅に合わせる」: パネルより広い図は縮めて、右にはみ出さない（ボタンで拡大・縮小すると解除）
    const avail = canvas.clientWidth - 2;
    const fit = host._fit !== false && avail > 0 && w > avail ? avail / w : 1;
    const z = host._fit !== false ? fit * host._zoom : host._zoom;
    // 紙面（背景）は図の大きさではなく、表示域の全体を覆う。小さい図でも、パネルの領域を全部使って描く（文字は等倍のまま）
    const availH = canvas.clientHeight - 2;
    const cw = Math.max(w * z, avail);
    const ch = Math.max(h * z, availH);
    el.setAttribute('width', String(Math.round(cw))); el.setAttribute('height', String(Math.round(ch)));
    el.setAttribute('viewBox', `0 0 ${cw / z} ${ch / z}`);
  }
  if (dv && (canvas.scrollLeft !== dv.scrollX || canvas.scrollTop !== dv.scrollY)) { canvas.scrollLeft = dv.scrollX; canvas.scrollTop = dv.scrollY; }
}
// FR-035: 比喩の絵（SVG の図形だけ。色だけにせず、各要素に文字のラベル）
function metaphorSvg(m) {
  const out = [];
  const lab = (e, x, y) => `<text data-role="metaphor-label" x="${r1(x)}" y="${r1(y)}" font-size="12" font-weight="700" fill="#555">${esc(e.label)}</text>`;
  for (const e of m.elements) {
    let shape = '';
    if (e.type === 'sun') {
      const cx = e.x + e.w / 2; const cy = e.y + e.h / 2 - 8; const r = 40;
      const rays = Array.from({ length: 8 }, (_, i) => { const a = (Math.PI * i) / 4; return `<line x1="${r1(cx + Math.cos(a) * (r + 6))}" y1="${r1(cy + Math.sin(a) * (r + 6))}" x2="${r1(cx + Math.cos(a) * (r + 20))}" y2="${r1(cy + Math.sin(a) * (r + 20))}" stroke="#d9a400" stroke-width="3"/>`; }).join('');
      shape = `${rays}<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r}" fill="#ffe27a" stroke="#d9a400" stroke-width="2"/>${lab(e, cx - 18, cy + r + 36)}`;
    } else if (e.type === 'mountain') {
      shape = `<polygon points="${e.x},${e.y + e.h} ${r1(e.x + e.w * 0.45)},${e.y + 24} ${e.x + e.w},${e.y + e.h}" fill="#e3ebe0" stroke="#9fb39a" stroke-width="1"/>${lab(e, e.x + e.w * 0.45 - 36, e.y + 20)}`;
    } else if (e.type === 'bridge') {
      shape = `<path d="M${e.x} ${e.y + e.h} Q${r1(e.x + e.w / 2)} ${e.y + e.h - 70} ${e.x + e.w} ${e.y + e.h}" fill="none" stroke="#b9a58c" stroke-width="5"/>${lab(e, e.x + e.w / 2 - 36, e.y + e.h - 36)}`;
    } else if (e.type === 'road') {
      shape = `<rect x="${e.x}" y="${e.y}" width="${r1(e.w)}" height="${e.h}" rx="18" fill="#ececec" stroke="#b5b5b5" stroke-width="1"/><line x1="${e.x + 16}" y1="${e.y + e.h / 2}" x2="${r1(e.x + e.w - 16)}" y2="${e.y + e.h / 2}" stroke="#ffffff" stroke-width="3" stroke-dasharray="14 10"/>${lab(e, e.x + 24, e.y + 14)}`;
    } else {
      shape = `<rect x="${r1(e.x)}" y="${r1(e.y)}" width="${r1(e.w)}" height="${r1(e.h)}" fill="none" stroke="#bdbdbd" stroke-width="1" stroke-dasharray="4 4"/>`;
      if (m.axes) shape += `<line x1="${r1(e.x + e.w / 2)}" y1="${r1(e.y)}" x2="${r1(e.x + e.w / 2)}" y2="${r1(e.y + e.h)}" stroke="#7a7a7a" stroke-width="1.5"/><line x1="${r1(e.x)}" y1="${r1(e.y + e.h / 2)}" x2="${r1(e.x + e.w)}" y2="${r1(e.y + e.h / 2)}" stroke="#7a7a7a" stroke-width="1.5"/>`;
    }
    out.push(`<g data-metaphor-element="${attr(e.type)}">${shape}</g>`);
  }
  if (m.axes) {
    out.push(`<g data-role="axes"><text data-role="axis-label" data-axis="x" x="${r1(m.axes.x.x1)}" y="${r1(m.axes.x.y1)}" font-size="12" font-weight="700">${esc(m.axes.x.label)}</text><text data-role="axis-label" data-axis="y" x="${r1(m.axes.y.x1)}" y="${r1(m.axes.y.y1 + 14)}" font-size="12" font-weight="700">${esc(m.axes.y.label)}</text></g>`);
  }
  return `<g data-role="metaphor" data-metaphor-kind="${attr(m.kind)}">${out.join('')}${(m.sections ?? []).map((s) => `<g data-metaphor-section="${attr(s.id)}"><rect data-role="frame" x="${r1(s.frame.x)}" y="${r1(s.frame.y)}" width="${r1(s.frame.w)}" height="${r1(s.frame.h)}" rx="8" fill="none" stroke="#9a9a9a" stroke-width="1"/><text data-role="subheading" x="${r1(s.headingRect.x)}" y="${r1(s.headingRect.y + 18)}" font-size="${TYPE_SCALE.topic}" font-weight="800">${esc(s.heading)}</text></g>`).join('')}</g>`;
}

// FR-036: 共通配置（タイトル欄・各まとまりの小見出しと外枠）の SVG。まとまりは <g data-group-id>、小見出しは data-role="subheading"、外枠は data-role="frame"。
function commonPlacementSvg(L) {
  if (!L) return '';
  const parts = [];
  if (L.title?.visible && L.titleLines?.length) {
    // FR-079 AC-431: タイトル欄は階層の最上位（いちばん大きい文字）。欄の幅で折り返し、欄の範囲に収める（fitTitle）
    parts.push(`<g data-role="title">${(L.titleRows ?? []).map((r) => `<text x="${r.x}" y="${r.y}" font-size="${r.size}" font-weight="800">${esc(r.text)}</text>`).join('')}</g>`);
  }
  // FR-035: 比喩（道・山・橋・太陽・4 象限）を先に描く。文字のラベルを必ず付け、外部の画像は使わない
  if (L.metaphor) parts.push(metaphorSvg(L.metaphor));
  const divided = (L.dividers ?? []).length > 0; // FR-034: 区切り線があるとき、区画の外枠は線にしない
  for (const g of L.groups ?? []) {
    parts.push(`<g data-group-id="${attr(g.id)}" data-group-kind="${attr(g.kind)}"><rect data-role="frame" x="${g.frame.x}" y="${g.frame.y}" width="${g.frame.w}" height="${g.frame.h}" rx="8" fill="none" stroke="${divided && g.kind === 'zone' ? 'none' : 'currentColor'}" stroke-width="1.5"/><text data-role="subheading" x="${g.headingRect.x}" y="${g.headingRect.y + 18}" font-size="${TYPE_SCALE.topic}" font-weight="800">${esc(g.heading)}</text></g>`);
  }
  // FR-034: 区画の区切り線（グレー。本文より細く、高コントラスト表示では CSS が GrayText にする）
  for (const d of L.dividers ?? []) parts.push(`<line data-role="zone-divider" x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}" stroke="#8a8a8a" stroke-width="1"/>`);
  // FR-031〜033: 各単位（data-unit-id・data-order）・中心のテーマ・矢印（data-flow-from/to）。強調は太さ・二重枠・文字の印（色だけにしない）
  const wrap = (text, w, fs, max) => {
    const lines = []; let cur = ''; let cw = 0;
    for (const ch of [...String(text ?? '')]) {
      const c = ch.codePointAt(0) >= 0x2e80 ? fs : fs * 0.56;
      if (cw + c > w && cur) { lines.push(cur); cur = ''; cw = 0; }
      cur += ch; cw += c;
    }
    if (cur) lines.push(cur);
    if (lines.length > max) { lines.length = max; lines[max - 1] = `${lines[max - 1].slice(0, -1)}…`; }
    return lines;
  };
  const rectOf = (id) => (id === 'center' ? L.center : (L.units ?? []).find((u) => u.id === id));
  const clip = (r, tx, ty) => { // 矩形 r の中心から (tx,ty) へ向かう線が矩形の縁と交わる点
    const cx = r.x + r.w / 2; const cy = r.y + r.h / 2; const dx = tx - cx; const dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    const k = Math.min(dx ? (r.w / 2) / Math.abs(dx) : Infinity, dy ? (r.h / 2) / Math.abs(dy) : Infinity);
    return [cx + dx * k, cy + dy * k];
  };
  const box = (u, extra, fs) => {
    const emph = u.emphasis ? 3.5 : 1.5;
    const jag = u.shape === 'jagged';
    let frame;
    if (jag) {
      const pts = []; const n = 14; const cx = u.x + u.w / 2; const cy = u.y + u.h / 2;
      for (let i = 0; i < n * 2; i++) { const a = (Math.PI * i) / n; const k = i % 2 ? 0.88 : 1; pts.push(`${r1(cx + Math.cos(a) * (u.w / 2) * k)} ${r1(cy + Math.sin(a) * (u.h / 2) * k)}`); }
      frame = `<path data-role="unit-frame" d="M${pts.join('L')}Z" fill="#fff" stroke="currentColor" stroke-width="${emph}"/>`;
    } else frame = `<rect data-role="unit-frame" x="${u.x}" y="${u.y}" width="${u.w}" height="${u.h}" rx="${u.shape === 'round' ? 14 : 6}" fill="#fff" stroke="currentColor" stroke-width="${emph}"/>`;
    const inner = u.emphasis ? `<rect data-role="emphasis-frame" x="${u.x + 4}" y="${u.y + 4}" width="${u.w - 8}" height="${u.h - 8}" rx="4" fill="none" stroke="currentColor" stroke-width="1"/>` : '';
    const lines = wrap(u.text, u.w - 28, fs, Math.max(1, Math.floor((u.h - 8) / (fs + 3))));
    const text = lines.map((ln, i) => `<text x="${u.x + 14}" y="${u.y + 6 + fs + i * (fs + 3)}" font-size="${fs}"${u.emphasis ? ' font-weight="800"' : ''}>${esc(ln)}</text>`).join('');
    const num = (L.orderMark === 'number' || L.orderMark === 'both') && u.order != null ? `<text data-role="order" x="${u.x + 4}" y="${u.y + 12}" font-size="11" font-weight="700">${u.order + 1}</text>` : '';
    const badge = u.badge ? `<text data-role="emphasis-mark" x="${u.x + u.w - 6}" y="${u.y + 14}" font-size="11" font-weight="800" text-anchor="end">${esc(u.badge)}</text>` : '';
    const rel = (u.relations ?? []).map((rl, i) => `<text data-role="inner-relation" x="${u.x + u.w - 6}" y="${u.y + u.h - 6 - i * 12}" font-size="10" text-anchor="end">${esc(rl.label)}</text>`).join('');
    return `${frame}${inner}${text}${num}${badge}${rel}${extra}`;
  };
  if (L.center) {
    const c = L.center;
    parts.push(`<g data-unit-id="center" data-role="center">${box({ ...c, emphasis: 'center', shape: 'round', text: c.text }, '', TYPE_SCALE.theme)}</g>`);
  }
  for (const u of L.units ?? []) {
    parts.push(`<g data-unit-id="${attr(u.id)}" data-order="${u.order}" data-unit-kind="${attr(u.kind)}"${u.role ? ` data-role-kind="${u.role}"` : ''}${u.attachedTo ? ` data-attached-to="${attr(u.attachedTo)}"` : ''}${u.shape ? ` data-bubble-shape="${u.shape}"` : ''}${u.emphasis ? ` data-emphasis="${u.emphasis}"` : ''}>${box(u, '', TYPE_SCALE[u.kind] ?? TYPE_SCALE.point)}</g>`);
  }
  for (const a of L.arrows ?? []) {
    const f = rectOf(a.from); const t = rectOf(a.to);
    if (!f || !t) continue;
    const [x1, y1] = clip(f, t.x + t.w / 2, t.y + t.h / 2); const [x2, y2] = clip(t, f.x + f.w / 2, f.y + f.h / 2);
    const ang = Math.atan2(y2 - y1, x2 - x1); const hx = (k) => r1(x2 - Math.cos(ang + k) * 9); const hy = (k) => r1(y2 - Math.sin(ang + k) * 9);
    parts.push(`<g data-role="flow"><line data-flow-from="${attr(a.from)}" data-flow-to="${attr(a.to)}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="currentColor" stroke-width="1.5"/><polygon points="${r1(x2)},${r1(y2)} ${hx(0.4)},${hy(0.4)} ${hx(-0.4)},${hy(-0.4)}" fill="currentColor"/>${a.label ? `<text data-role="arrow-label" x="${r1((x1 + x2) / 2 + 4)}" y="${r1((y1 + y2) / 2 - 4)}" font-size="11" font-weight="700">${esc(a.label)}</text>` : ''}</g>`);
  }
  return parts.join('');
}

// FR-079 AC-430(c): 型の配置（タイトル欄・まとまり・単位）がある図では、シーン・要点の詳細をその右に置き、外枠を重ねない。
// 型の配置の幅（canvas.w）は発散型以外は一定なので、詳細の位置は後から加わる要素で動かない（AC-432(b)）。
export function diagramOriginX(L) {
  if (!L || !((L.units ?? []).length || (L.groups ?? []).length || L.center)) return 0;
  return Math.ceil(L.canvas?.w ?? 0);
}
// 型の配置の範囲（canvas）が入るように、ルートの SVG の幅・高さ・viewBox を広げる（はみ出して切れないように）
export function fitViewBox(svg, canvas) {
  if (!canvas) return svg;
  return svg.replace(/<svg ([^>]*?)viewBox="0 0 ([\d.]+) ([\d.]+)" width="([\d.]+)" height="([\d.]+)"/, (m, pre, vw, vh) => {
    const w = Math.max(Number(vw), Math.ceil(canvas.w)); const h = Math.max(Number(vh), Math.ceil(canvas.h));
    return `<svg ${pre}viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"`;
  });
}

// アプリ組立の拡張（modules）: 図の描画・文言・パネル
export function diagramModule(ctx) {
  ctx.i18n.addStrings({
    ja: {
      'diagram.tools': '図の表示操作', 'diagram.zoomIn': '拡大', 'diagram.zoomOut': '縮小', 'diagram.zoomReset': '等倍に戻す',
      'diagram.canvasLabel': '図（矢印キーでスクロール）',
    },
    en: {
      'diagram.tools': 'Diagram view controls', 'diagram.zoomIn': 'Zoom in', 'diagram.zoomOut': 'Zoom out', 'diagram.zoomReset': 'Reset zoom',
      'diagram.canvasLabel': 'Diagram (scroll with arrow keys)',
    },
  });
  // FR-047: RPG風のときは、従来の SVG（文字・配置の元）を、ドット絵の地図に載せ替える（renderBaseSvg は載せ替える前の SVG）
  ctx.api.renderSvg = () => {
    const base = ctx.api.renderBaseSvg();
    const map = ctx.api.getDrawStyle?.() === RPG_STYLE_ID ? ctx.api.getRpgMap?.() : null;
    return map ? renderRpgSvg(base, map) : base;
  };
  ctx.api.renderBaseSvg = () => {
    const o = { lang: ctx.state.lang, relations: ctx.api.getDiagramRelations?.() ?? [], selectedSceneId: ctx.state.selectedSceneId, highlightPointId: currentHighlight()?.pointId ?? null, t: ctx.t, title: ctx.t('app.title'), style: ctx.api.getDrawStyleSpec?.() };
    const level = ctx.api.getDetailLevel?.() ?? 'detail';
    const units = level !== 'detail' && ctx.state.scenes.length ? { topics: ctx.api.getTopics(), relations: ctx.api.getTopicRelations(), level } : null;
    // FR-029 AC-146: 現在の描画スタイル、FR-027 AC-140: 時系列の 2D の図に適用している型を、ルートの属性で示す（整理の表示に型は適用されない）
    const info = ctx.api.getLayoutInfo?.();
    const L = info && info.applied && ctx.state.displayMode !== 'arrange' ? (ctx.api.getDiagramLayout?.() ?? null) : null;
    const originX = diagramOriginX(L); // FR-079 AC-430(c): 型の配置（左）と、シーン・要点の詳細（右）を重ねない
    const mark = (svg) => {
      const attrs = [`data-draw-style="${ctx.api.getDrawStyle?.() ?? 'handwritten'}"`];
      if (info && info.applied) attrs.push(`data-layout-types="${info.selected.join(' ')}"`, `data-layout-head="${info.head}"`);
      let out = svg.replace('<svg ', `<svg ${attrs.join(' ')} `);
      if (info && info.applied) out = out.replace(/<\/svg>\s*$/, `${commonPlacementSvg(L ?? ctx.api.getDiagramLayout?.())}</svg>`);
      if (L) out = fitViewBox(out, L.canvas);
      return out;
    };
    // FR-016 AC-089: 画面で選んでいる表示（時系列／整理）と同じ配置で出力する（保存もここを通る）
    if (ctx.state.displayMode === 'arrange' && ctx.api.getArrangement) return mark(renderArrangedSvg(ctx.state.scenes, ctx.api.getArrangement(), { ...o, ...(units ?? {}), selectedLabel: ctx.t('topic.selected') }));
    // FR-079: 再配置の木（まとまりの中の並び・下位のまとまり・同一の要点のまとめ）に従って描く
    const view = ctx.api.getArrangeView?.() ?? null;
    if (units) return mark(renderTopicsSvg(units.topics, units.relations, ctx.state.scenes, { ...o, level, chunks: view?.chunks ?? null, originX }));
    return mark(renderDiagramSvg(ctx.state.scenes, { ...o, trees: view?.trees ?? null, originX }));
  };
  // FR-079: 図の詳細（シーンの列・トピックの箱）の左端。型の配置があればその右に置く（図の要素の外枠と描画で同じ値）
  ctx.api.getDiagramOriginX = () => {
    const info = ctx.api.getLayoutInfo?.();
    return info && info.applied && ctx.state.displayMode !== 'arrange' ? diagramOriginX(ctx.api.getDiagramLayout?.()) : 0;
  };

  // ---- FR-015 AC-074: 図の演出の記述（見出しと要点の表現） ----
  ctx.api.getDiagramStyle = () => ({
    scenes: ctx.state.scenes.map((s) => ({
      id: s.id,
      heading: { fontSize: FS_HEAD, fontWeight: 800, framed: true },
      typeScale: { ...TYPE_SCALE }, // FR-079 AC-431: 階層ごとの基準の文字の大きさ（タイトル・テーマ＞トピック＞シーン＞要点）
      points: s.points.map((p) => { const kind = classifyPoint(p.text); const k = KINDS[kind]; const icons = ctx.api.getDrawStyleSpec?.()?.text.icons !== false; return { id: p.id, kind, kindLabel: kindLabelOf(kind, ctx.state.lang), emphasized: kind === 'conclusion', color: k.color, shape: k.shape, icon: icons ? k.icon : 'none', fontSize: FS, fontWeight: kind === 'conclusion' ? 800 : 400 }; }),
    })),
  });

  // ---- FR-015 AC-076: 要点の強調（ポインタ・キーボード）。保存しない表示だけの状態 ----
  let hl = null; // { pointId, source }
  const allPoints = () => ctx.state.scenes.flatMap((s) => s.points.map((p) => ({ sceneId: s.id, id: p.id })));
  function currentHighlight() {
    if (!hl) return null;
    return allPoints().some((p) => p.id === hl.pointId) ? hl : null;
  }
  ctx.api.highlightPoint = (pointId, source = 'pointer') => {
    if (!allPoints().some((p) => p.id === pointId)) return false;
    hl = { pointId, source: source === 'keyboard' ? 'keyboard' : 'pointer' };
    ctx.emit('change', ctx.api);
    return true;
  };
  ctx.api.clearHighlight = () => { if (hl) { hl = null; ctx.emit('change', ctx.api); } };
  ctx.api.getHighlight = () => {
    const cur = currentHighlight();
    if (!cur) return null;
    const sc = ctx.state.scenes.find((s) => s.points.some((p) => p.id === cur.pointId));
    return {
      pointId: cur.pointId,
      relations: sc.relations.filter((r) => r.from === cur.pointId || r.to === cur.pointId).map((r) => ({ from: r.from, to: r.to })),
      point: { strokeWidth: 5, framed: true, icon: 'star', color: HL_COLOR },
      others: { strokeWidth: 2.5, framed: false, color: 'kind' },
      textLegible: true,
    };
  };
  const step = (d) => {
    const list = allPoints();
    if (!list.length) return;
    const cur = currentHighlight();
    const i = cur ? list.findIndex((p) => p.id === cur.pointId) : (d > 0 ? -1 : 0);
    ctx.api.highlightPoint(list[(i + d + list.length) % list.length].id, 'keyboard');
  };
  ctx.registerCommand('highlight.next', () => step(1));
  ctx.registerCommand('highlight.prev', () => step(-1));
  ctx.registerCommand('highlight.clear', () => ctx.api.clearHighlight());
  ctx.registerPanelRenderer('diagram', (host) => mountDiagramPanel(host, ctx.api));
}
