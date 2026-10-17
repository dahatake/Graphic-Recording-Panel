// FR-004: 2D のグラフィック・ファシリテーション表示。シーンごとに「見出し・吹き出し（要点）・矢印（関係線）・絵記号」を SVG で描く。
// 純粋関数 renderDiagramSvg（単体で SVG ファイルとしても自立する。色は属性で持つ）と、パネル描画（拡大・縮小・移動）。
import { sceneEmotions } from './emotion.js';
import { renderRpgSvg, RPG_STYLE_ID } from './rpgmap.js';

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
};
// ASSUMPTION: 種類は語のパターンで決める（決定的・外部通信なし）。上から順に最初に合うもの、どれにも合わなければ補足。
const KIND_RULES = [
  ['issue', /困|課題|問題|不安|心配|遅れ|高い|高く|できない|足りな|不足|障害|エラー|trouble|problem|issue|risk|bug|stuck|blocked|difficult/i],
  ['conclusion', /決め|決定|決ま|結論|合意|方針|採用|にする|します|decid|conclu|agree|resolv|chose/i],
  ['idea', /アイデア|案|しよう|してみ|ひらめ|提案|かも|どう|idea|propos|how about|what if|maybe|[?？]/i],
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
function rng(seedStr) {
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
function outline(shape, x, y, w, h) {
  switch (shape) {
    case 'banner': return [[x, y], [x + w - 14, y], [x + w, y + h / 2], [x + w - 14, y + h], [x, y + h]];
    case 'octagon': return [[x + 10, y], [x + w - 10, y], [x + w, y + 10], [x + w, y + h - 10], [x + w - 10, y + h], [x + 10, y + h], [x, y + h - 10], [x, y + 10]];
    case 'hexagon': return [[x + 14, y], [x + w - 14, y], [x + w, y + h / 2], [x + w - 14, y + h], [x + 14, y + h], [x, y + h / 2]];
    default: return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  }
}
const PAD = 20; const HEAD_H = 44; const BUBBLE_H = 38; const GAP = 30; const SCENE_GAP = 64; const MARGIN = 24;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');
function textWidth(s, size) {
  let w = 0;
  for (const ch of String(s)) w += ch.codePointAt(0) >= 0x2e80 ? size : size * 0.56;
  return w;
}

// 絵記号（24x24 の枠に収まる図形）。(x,y) は左上。
function iconShape(shape, x, y, color) {
  const g = (inner) => `<g transform="translate(${x} ${y})" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</g>`;
  switch (shape) {
    case 'swirl': return g('<path d="M12 12m0-2a2 2 0 1 1-2 2 5 5 0 1 1 5 5 8 8 0 1 1-8-8"/>');
    case 'sweat': return g('<circle cx="12" cy="13" r="9"/><path d="M8 11v2M16 11v2M8 18q4-3 8 0"/><path d="M20 3q2 3 0 4q-2-1 0-4z"/>');
    case 'cloud': return g('<path d="M7 19a5 5 0 0 1-1-9.9A6 6 0 0 1 17.5 8 4.5 4.5 0 0 1 17 19z"/>');
    case 'bolt': return g('<path d="M13 2L5 14h6l-1 8 9-13h-6z"/>');
    case 'smile': return g('<circle cx="12" cy="12" r="10"/><path d="M8 10h.01M16 10h.01M7.5 14.5q4.5 5 9 0"/>');
    case 'bulb': return g('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>');
    case 'burst': return g('<path d="M12 2l2.5 6L21 7l-4 5 4 5-6.500-1L12 22l-2.500-6L3 17l4-5-4-5 6.500 1z"/>');
    case 'check': return g('<circle cx="12" cy="12" r="10"/><path d="M7 12.500l3.500 3.500 7-8"/>');
    case 'alert': return g('<path d="M12 3L22 20H2z"/><path d="M12 10v5M12 17.500v.5"/>');
    case 'note': return g('<path d="M5 3h10l4 4v14H5z"/><path d="M8 11h8M8 15h8"/>');
    case 'star': return g('<path d="M12 2l3 7 7 .5-5.500 4.500 2 7.500-6.500-4-6.500 4 2-7.500L2 9.500 9 9z"/>');
    case 'drop': return g('<path d="M12 2q7 8 7 13a7 7 0 0 1-14 0q0-5 7-13z"/>');
    default: return g('<circle cx="12" cy="12" r="9"/>');
  }
}

// scenes: アプリの状態のシーン配列。opts: { selectedSceneId, t, title }
export function renderDiagramSvg(scenes, opts = {}) {
  ST = opts.style ?? HAND;
  const t = opts.t ?? ((k) => k);
  const sel = opts.selectedSceneId ?? null;
  const hlId = opts.highlightPointId ?? null;
  const parts = []; let x = MARGIN; let maxH = 0;
  const heads = [];
  scenes.forEach((s, i) => {
    const color = PALETTE[i % PALETTE.length];
    const emos = sceneEmotions(s);
    const emoW = Math.max(0, ...emos.map((e) => 34 + textWidth(e.word, FS)));
    const w = Math.ceil(Math.max(240, textWidth(s.heading, FS_HEAD) + 70, ...s.points.map((p) => textWidth(p.text, FS) + 32 + ICON_W), emoW + 32));
    const isSel = s.id === sel;
    const body = [];
    const cx = x + w / 2;
    // 見出し（色分けの帯＋太い下線）。要点より大きく太い。
    body.push(`<path d="${wobblyD(outline('rect', x, MARGIN, w, HEAD_H), `${s.id}:h`, true, 1.4)}" fill="${color}" stroke="${isSel ? INK : color}" stroke-width="${sw(isSel ? 4 : 2)}" stroke-linejoin="round" data-role="heading-band"/>`);
    body.push(`<text x="${x + 14}" y="${MARGIN + 29}" font-size="${FS_HEAD}" font-weight="${HEAD_WEIGHT[ST.text.decor]}" fill="#ffffff" data-role="status">${STATUS_MARK[s.status] ?? ''}${isSel ? SELECTED_MARK : ''}</text>`);
    body.push(`<text x="${x + 44}" y="${MARGIN + 29}" font-size="${FS_HEAD}" font-weight="${HEAD_WEIGHT[ST.text.decor]}" fill="#ffffff" data-role="heading">${esc(s.heading)}</text>`);
    body.push(`<path d="${wobblyD([[x + 6, MARGIN + HEAD_H + 6], [x + w - 6, MARGIN + HEAD_H + 6]], `${s.id}:u`, false, 1.2)}" fill="none" stroke="${color}" stroke-width="${sw(3)}" stroke-linecap="round"/>`);
    // 要点の吹き出し（種類ごとに 色・形・絵記号 が異なる）
    const top = new Map(); let y = MARGIN + HEAD_H + GAP;
    const dash = s.status === 'in_progress' ? ' stroke-dasharray="6 4"' : '';
    s.points.forEach((p) => {
      top.set(p.id, y);
      const k = KINDS[classifyPoint(p.text)];
      const kind = classifyPoint(p.text);
      const hl = p.id === hlId;
      const stroke = hl ? HL_COLOR : k.color;
      const sWidth = sw(hl ? 5 : 2.5);
      const frame = hl ? `<path d="${wobblyD(outline(k.shape, x - 6, y - 6, w + 12, BUBBLE_H + 12), `${p.id}:f`, true, 1.2)}" fill="none" stroke="${HL_COLOR}" stroke-width="2" stroke-dasharray="3 3" data-role="highlight-frame"/>` : '';
      const star = hl ? `<g data-role="highlight-icon">${iconShape('star', x + w - 20, y - 16, HL_COLOR)}</g>` : '';
      const paper = paperFor(k.color);
      body.push(`<g data-point-id="${attr(p.id)}" data-kind="${kind}"${hl ? ' data-highlight="1"' : ''}>${frame}`
        + `<path d="${wobblyD(outline(k.shape, x, y, w, BUBBLE_H), p.id, true)}" fill="${paper}" stroke="${stroke}" stroke-width="${sWidth}" stroke-linejoin="round"${dash}/>`
        + `<path d="${wobblyD([[x + 18, y + BUBBLE_H], [x + 12, y + BUBBLE_H + 8], [x + 26, y + BUBBLE_H]], `${p.id}:t`, false, 0.4)}"         fill="${paper}" stroke="${stroke}" stroke-width="${sw(2.5)}" stroke-linejoin="round"/>`
        + decoIcon(k.icon, x + 8, y + 7, stroke)
        + `<text x="${x + 8 + ICON_W}" y="${y + 24}" font-size="${FS}" fill="${INK}">${esc(p.text)}</text>${star}</g>`);
      y += BUBBLE_H + GAP;
    });
    // 関係線（手描き風の矢印）
    for (const r of s.relations) {
      const a = top.get(r.from); const b = top.get(r.to);
      if (a == null || b == null) continue;
      const [from, to] = a <= b ? [a, b] : [b, a];
      const hot = hlId != null && (r.from === hlId || r.to === hlId);
      body.push(`<path data-relation="${attr(r.from)}>${attr(r.to)}"${hot ? ' data-highlight="1"' : ''} d="${wobblyD([[cx, from + BUBBLE_H + 4], [cx, to - 3]], `${r.from}>${r.to}`, false, 1)}" fill="none" stroke="${hot ? HL_COLOR : color}" stroke-width="${sw(hot ? 5 : 2.5)}" stroke-linecap="round" marker-end="url(#${hot ? 'arrow-hl' : `arrow-${i % PALETTE.length}`})"/>`);
    }
    // 絵記号（感情・様子の語）
    emos.forEach((e) => {
      body.push(`<g data-emotion="${attr(e.id)}">${decoIcon(e.shape, x + 14, y - 8, color)}<text x="${x + 44}" y="${y + 10}" font-size="${FS}" font-weight="700" fill="${INK}">${esc(e.word)}</text></g>`);
      y += 34;
    });
    // シーンの囲み（背面）
    body.unshift(`<path d="${wobblyD(outline('rect', x - 10, MARGIN - 10, w + 20, y - MARGIN + 6), `${s.id}:e`, true, 1.6)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-opacity="0.45" stroke-dasharray="2 5" data-role="scene-frame"/>`);
    parts.push(`<g data-scene-id="${attr(s.id)}" data-status="${attr(s.status)}"${isSel ? ' aria-current="true"' : ''}>${body.join('')}</g>`);
    heads.push({ x, w, color });
    maxH = Math.max(maxH, y + MARGIN);
    x += w + SCENE_GAP;
  });
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, 'Hiragino Sans', 'Yu Gothic UI', Meiryo, sans-serif" role="img" aria-label="${attr(opts.title ?? '')}">`
    + `<title>${title}</title><defs>${markers}</defs><rect width="100%" height="100%" fill="${PAPER}"/>${parts.join('')}${flows.join('')}${empty}</svg>`;
}

// FR-025/FR-026: 2D の時系列で詳細度が「大項目」「中項目」のときの図。トピックを大項目の箱（題名）、中項目ではその下にシーンの見出しを描く。
// トピック間の関係は線と種類の文字（順・関連）で示し、色だけに頼らない。要点・関係線・絵記号は描かない（テキスト一覧・ポップアップで確認できる）。
// topics: [{id,title,sceneIds,containsSelected}]、relations: [{id,from,to,kind,label}]、scenes: アプリのシーン配列。opts: { level, selectedSceneId, t, title }
export function renderTopicsSvg(topics, relations, scenes, opts = {}) {
  ST = opts.style ?? HAND;
  const t = opts.t ?? ((k) => k);
  const level = opts.level === 'middle' ? 'middle' : 'major';
  const sel = opts.selectedSceneId ?? null;
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const ROW = 32; const BOX_GAP = 90;
  const selText = t('topic.selected');
  const boxes = []; const groups = []; let x = MARGIN;
  const span = (r) => Math.abs(topics.findIndex((q) => q.id === r.to) - topics.findIndex((q) => q.id === r.from));
  const arcMax = Math.max(0, ...relations.filter((r) => r.kind === 'related').map((r) => 36 + 20 * span(r)));
  const top = MARGIN + (arcMax ? arcMax + 22 : 0);
  let maxH = 0;
  topics.forEach((tp, i) => {
    const color = PALETTE[i % PALETTE.length];
    const heads = tp.sceneIds.map((id) => byId.get(id)).filter(Boolean);
    const marks = (s) => `${s.id === sel ? SELECTED_MARK : ''}`;
    const w = Math.ceil(Math.max(220, textWidth(tp.title, FS_HEAD) + 40,
      level === 'middle' ? Math.max(0, ...heads.map((s) => textWidth(s.heading, FS) + 48)) : 0,
      tp.containsSelected && level === 'major' ? textWidth(selText, FS) + 48 : 0));
    const body = [];
    body.push(`<path d="${wobblyD(outline('rect', x, top, w, HEAD_H), `${tp.id}:h`, true, 1.4)}" fill="${color}" stroke="${tp.containsSelected ? INK : color}" stroke-width="${tp.containsSelected ? 4 : 2}" stroke-linejoin="round" data-role="topic-band"/>`);
    body.push(`<text x="${x + 14}" y="${top + 29}" font-size="${FS_HEAD}" font-weight="800" fill="#ffffff" data-role="topic-title">${esc(tp.title)}</text>`);
    let y = top + HEAD_H + 22;
    if (level === 'major' && tp.containsSelected) {
      body.push(`<text x="${x + 10}" y="${y}" font-size="${FS}" font-weight="700" fill="${INK}" data-role="contains-selected">${SELECTED_MARK} ${esc(selText)}</text>`);
      y += ROW - 6;
    }
    if (level === 'middle') {
      for (const s of heads) {
        const on = s.id === sel;
        body.push(`<text x="${x + 10}" y="${y}" font-size="${FS}" font-weight="${on ? 800 : 600}" fill="${INK}" data-scene-id="${attr(s.id)}" data-role="scene-heading"${on ? ' aria-current="true"' : ''}>${STATUS_MARK[s.status] ?? ''}${marks(s)} ${esc(s.heading)}</text>`);
        y += ROW;
      }
    }
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
      const ax = a.x + a.w / 2; const bx = b.x + b.w / 2; const h = 36 + 20 * Math.abs(topics.findIndex((q) => q.id === r.to) - topics.findIndex((q) => q.id === r.from));
      lines.push(`<g data-topic-relation="${attr(r.id)}" data-kind="related"><path d="M${ax} ${top - 10} C${ax} ${top - 10 - h} ${bx} ${top - 10 - h} ${bx} ${top - 12}" fill="none" stroke="${INK}" stroke-width="2.5" stroke-dasharray="6 4" stroke-linecap="round" marker-end="url(#arrow-flow)"/>`
        + `<text x="${(ax + bx) / 2}" y="${top - 10 - h * 0.75 - 4}" text-anchor="middle" font-size="${FS}" font-weight="700" fill="${INK}" data-role="relation-label">${label}</text></g>`);
    }
  }
  const width = Math.max(320, x - BOX_GAP + MARGIN);
  const height = Math.max(160, maxH);
  const marker = `<marker id="arrow-flow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${INK}"/></marker>`;
  const title = esc(opts.title ?? '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, 'Hiragino Sans', 'Yu Gothic UI', Meiryo, sans-serif" role="img" aria-label="${attr(opts.title ?? '')}">`
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
    } else {
      const p = scenes.flatMap((s) => s.points).find((q) => q.id === it.id);
      const kind = classifyPoint(p.text); const k = KINDS[kind];
      const hl = p.id === hlId;
      const stroke = hl ? HL_COLOR : k.color;
      parts.push(`<g data-point-id="${attr(p.id)}" data-kind="${kind}" data-assigned="${it.unclassified ? 'unclassified' : 'assigned'}"${hl ? ' data-highlight="1"' : ''}>${reason}`
        + `<path d="${wobblyD(outline(k.shape, it.x, it.y, it.w, BUBBLE_H), p.id, true)}" fill="${PAPER}" stroke="${stroke}" stroke-width="${hl ? 5 : 2.5}" stroke-linejoin="round"/>`
        + iconShape(k.icon, it.x + 8, it.y + 7, stroke)
        + `<text x="${it.x + 8 + ICON_W}" y="${it.y + 24}" font-size="${FS}" fill="${INK}">${esc(p.text)}</text></g>`);
    }
  }
  parts.push(...relLabels);
  const title = esc(opts.title ?? '');
  const { width, height } = g;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, 'Hiragino Sans', 'Yu Gothic UI', Meiryo, sans-serif" role="img" aria-label="${attr(opts.title ?? '')}" data-display-mode="arrange">`
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
    const tools = host.querySelector('.diagram-tools');
    const mk = (cmd, label) => {
      const b = doc.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm'; b.dataset.zoom = cmd; b.textContent = label;
      b.addEventListener('click', () => {
        host._fit = cmd !== 'reset';
        host._zoom = cmd === 'in' ? clampZoom(host._zoom * ZOOM_STEP) : cmd === 'out' ? clampZoom(host._zoom / ZOOM_STEP) : 1;
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
      paint(host, app);
    }, { passive: false });
  }
  paint(host, app);
}

function paint(host, app) {
  const t = (k) => app.t(k);
  const tools = host.querySelector('.diagram-tools');
  tools.setAttribute('aria-label', t('diagram.tools'));
  const names = { out: t('diagram.zoomOut'), reset: t('diagram.zoomReset'), in: t('diagram.zoomIn') };
  for (const b of tools.querySelectorAll('[data-zoom]')) { b.title = names[b.dataset.zoom]; b.setAttribute('aria-label', names[b.dataset.zoom]); }
  const canvas = host.querySelector('.diagram-canvas');
  canvas.setAttribute('aria-label', t('diagram.canvasLabel'));
  const svg = app.renderSvg();
  canvas.innerHTML = svg;
  const el = canvas.querySelector('svg');
  if (el) {
    const w = Number(el.getAttribute('width')); const h = Number(el.getAttribute('height'));
    // 既定は「幅に合わせる」: パネルより広い図は縮めて、右にはみ出さない（ボタンで拡大・縮小すると解除）
    const avail = canvas.clientWidth - 2;
    const fit = host._fit !== false && avail > 0 && w > avail ? avail / w : 1;
    const z = host._fit !== false ? fit * host._zoom : host._zoom;
    el.setAttribute('width', String(Math.round(w * z))); el.setAttribute('height', String(Math.round(h * z)));
    // 図が空のときは案内文の紙面を図の幅いっぱいに広げる（文字は等倍のまま）
    if (!el.querySelector('[data-scene-id], [data-topic-id]') && avail > w * z) {
      el.setAttribute('viewBox', `0 0 ${avail / z} ${h}`);
      el.setAttribute('width', String(avail));
    }
  }
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
  return `<g data-role="metaphor" data-metaphor-kind="${attr(m.kind)}">${out.join('')}${(m.sections ?? []).map((s) => `<g data-metaphor-section="${attr(s.id)}"><rect data-role="frame" x="${r1(s.frame.x)}" y="${r1(s.frame.y)}" width="${r1(s.frame.w)}" height="${r1(s.frame.h)}" rx="8" fill="none" stroke="#9a9a9a" stroke-width="1"/><text data-role="subheading" x="${r1(s.headingRect.x)}" y="${r1(s.headingRect.y + 14)}" font-size="13" font-weight="700">${esc(s.heading)}</text></g>`).join('')}</g>`;
}

// FR-036: 共通配置（タイトル欄・各まとまりの小見出しと外枠）の SVG。まとまりは <g data-group-id>、小見出しは data-role="subheading"、外枠は data-role="frame"。
function commonPlacementSvg(L) {
  if (!L) return '';
  const parts = [];
  if (L.title?.visible && L.titleLines?.length) {
    parts.push(`<g data-role="title">${L.titleLines.map((line, i) => `<text x="${L.title.x}" y="${L.title.y + 14 + i * 16}" font-size="13" font-weight="700">${esc(line)}</text>`).join('')}</g>`);
  }
  // FR-035: 比喩（道・山・橋・太陽・4 象限）を先に描く。文字のラベルを必ず付け、外部の画像は使わない
  if (L.metaphor) parts.push(metaphorSvg(L.metaphor));
  const divided = (L.dividers ?? []).length > 0; // FR-034: 区切り線があるとき、区画の外枠は線にしない
  for (const g of L.groups ?? []) {
    parts.push(`<g data-group-id="${attr(g.id)}" data-group-kind="${attr(g.kind)}"><rect data-role="frame" x="${g.frame.x}" y="${g.frame.y}" width="${g.frame.w}" height="${g.frame.h}" rx="8" fill="none" stroke="${divided && g.kind === 'zone' ? 'none' : 'currentColor'}" stroke-width="1.5"/><text data-role="subheading" x="${g.headingRect.x}" y="${g.headingRect.y + 14}" font-size="13" font-weight="700">${esc(g.heading)}</text></g>`);
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
    parts.push(`<g data-unit-id="center" data-role="center">${box({ ...c, emphasis: 'center', shape: 'round', text: c.text }, '', 20)}</g>`);
  }
  for (const u of L.units ?? []) {
    parts.push(`<g data-unit-id="${attr(u.id)}" data-order="${u.order}" data-unit-kind="${attr(u.kind)}"${u.role ? ` data-role-kind="${u.role}"` : ''}${u.attachedTo ? ` data-attached-to="${attr(u.attachedTo)}"` : ''}${u.shape ? ` data-bubble-shape="${u.shape}"` : ''}${u.emphasis ? ` data-emphasis="${u.emphasis}"` : ''}>${box(u, '', 12)}</g>`);
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
    const o = { selectedSceneId: ctx.state.selectedSceneId, highlightPointId: currentHighlight()?.pointId ?? null, t: ctx.t, title: ctx.t('app.title'), style: ctx.api.getDrawStyleSpec?.() };
    const level = ctx.api.getDetailLevel?.() ?? 'detail';
    const units = level !== 'detail' && ctx.state.scenes.length ? { topics: ctx.api.getTopics(), relations: ctx.api.getTopicRelations(), level } : null;
    // FR-029 AC-146: 現在の描画スタイル、FR-027 AC-140: 時系列の 2D の図に適用している型を、ルートの属性で示す（整理の表示に型は適用されない）
    const mark = (svg) => {
      const info = ctx.api.getLayoutInfo?.();
      const attrs = [`data-draw-style="${ctx.api.getDrawStyle?.() ?? 'handwritten'}"`];
      if (info && info.applied) attrs.push(`data-layout-types="${info.selected.join(' ')}"`, `data-layout-head="${info.head}"`);
      let out = svg.replace('<svg ', `<svg ${attrs.join(' ')} `);
      if (info && info.applied) out = out.replace(/<\/svg>\s*$/, `${commonPlacementSvg(ctx.api.getDiagramLayout?.())}</svg>`);
      return out;
    };
    // FR-016 AC-089: 画面で選んでいる表示（時系列／整理）と同じ配置で出力する（保存もここを通る）
    if (ctx.state.displayMode === 'arrange' && ctx.api.getArrangement) return mark(renderArrangedSvg(ctx.state.scenes, ctx.api.getArrangement(), { ...o, ...(units ?? {}), selectedLabel: ctx.t('topic.selected') }));
    if (units) return mark(renderTopicsSvg(units.topics, units.relations, ctx.state.scenes, { ...o, level }));
    return mark(renderDiagramSvg(ctx.state.scenes, o));
  };

  // ---- FR-015 AC-074: 図の演出の記述（見出しと要点の表現） ----
  ctx.api.getDiagramStyle = () => ({
    scenes: ctx.state.scenes.map((s) => ({
      id: s.id,
      heading: { fontSize: FS_HEAD, fontWeight: 800, framed: true },
      points: s.points.map((p) => { const kind = classifyPoint(p.text); const k = KINDS[kind]; const icons = ctx.api.getDrawStyleSpec?.()?.text.icons !== false; return { id: p.id, kind, color: k.color, shape: k.shape, icon: icons ? k.icon : 'none', fontSize: FS, fontWeight: 400 }; }),
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
