// FR-112 AC-635〜640: ペン・タッチによる自由描画。契約: tests/system/CONTRACT-P2.md §4。
// - 描いた線（ストローク）は図の座標に固定する。要点には結びつけないので、自動の再配置（FR-079）・手修正・拡大縮小・再描画で消えず、図に対する位置が変わらない（AC-636）。
// - 線を描く操作そのものはポインタ（ペン・マウス・タッチ）限定。描いた線の管理（モード・色・消しゴム・取り消し・やり直し・全消去・表示の切り替え）はキーボードでもできる（AC-635・AC-637）。
// - 色は PARAM-150 の名前つきの一覧。背景（紙面）とのコントラスト比が PARAM-083 未満になる色には細い縁取り（白または黒）を付ける。色は意味を持たせない装飾（色名は文字で示す）。
// - 線は 1 セッションに PARAM-151 本まで。取り消し・やり直しは操作の記録（追加・消去・全消去）で決定的に行う。
// - 保存・復元・初期化は registerPersist('draw')。表示／非表示は端末ごとの設定（storage）で、線も保存物・件数も変えない（AC-640）。
// - SVG・PNG・PDF・HTML の出力に図と同じ位置で含める。「機密の要点を除く」保存では、機密の要点の外接矩形と線の外接矩形（線幅の半分を外側に含む）が
//   1 点でも交わる線を出力から除く（AC-638。FR-104 の visibility.js の流儀）。生成 AI へは何も送らない。外部通信 0 件。
import { parseColor, contrastRatio } from './stylepresets.js';

export const MIN_CONTRAST = 3; // PARAM-083
export const STROKE_MAX = 500; // PARAM-151
export const STROKE_WIDTH = 3;
const POINTS_MAX = 3000;
const HIDDEN_KEY = 'grp.draw.hidden'; // 端末ごとの設定（AC-640）
const HIT_TOLERANCE = 6; // 消しゴムの当たり判定（図の座標での余裕）
// PARAM-150: 手描きの色の一覧（名前つき）
export const DRAW_COLORS = [
  { id: 'black', hex: '#111111', name: { ja: '黒', en: 'Black' } },
  { id: 'red', hex: '#c62828', name: { ja: '赤', en: 'Red' } },
  { id: 'blue', hex: '#1565c0', name: { ja: '青', en: 'Blue' } },
  { id: 'green', hex: '#2e7d32', name: { ja: '緑', en: 'Green' } },
  { id: 'orange', hex: '#e65100', name: { ja: '橙', en: 'Orange' } },
  { id: 'purple', hex: '#6a1b9a', name: { ja: '紫', en: 'Purple' } },
];
const COLOR_IDS = new Set(DRAW_COLORS.map((c) => c.id));
const hexOf = (id) => DRAW_COLORS.find((c) => c.id === id)?.hex ?? '#111111';
const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- 純関数（単体テストの対象） ----
// 線の外接矩形（線幅の半分を外側に含む）
export function strokeBox(s, width = STROKE_WIDTH) {
  const xs = s.points.map((p) => p.x); const ys = s.points.map((p) => p.y);
  const h = (s.width ?? width) / 2;
  return { x1: Math.min(...xs) - h, y1: Math.min(...ys) - h, x2: Math.max(...xs) + h, y2: Math.max(...ys) + h };
}
// 閉じた区間どうしの交差（辺・角が接するだけも重なり）。a・b は { x1, y1, x2, y2 }
export const boxesOverlap = (a, b) => a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
export const toRect = (b) => ({ x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height });
// 機密の要点の外接矩形（{x,y,width,height} の配列）と重なる線を除いた線
export function withoutOverlapping(strokes, boxes) {
  const rects = boxes.map(toRect);
  return strokes.filter((s) => { const sb = strokeBox(s); return !rects.some((r) => boxesOverlap(sb, r)); });
}
// 背景に対して色が最小コントラスト比を満たさないときの縁取りの色（満たすなら null）。縁取りは線の色と最もコントラストが高い白または黒
export function haloFor(hex, backgrounds = ['#ffffff']) {
  const bad = backgrounds.some((bg) => contrastRatio(hex, bg) < MIN_CONTRAST);
  if (!bad) return null;
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#000000') ? '#ffffff' : '#000000';
}
// 図の SVG の紙面（背景）の色。分からなければ白
export function paperOf(svg) {
  const m = /<rect[^>]*data-style-role="paper-bg"[^>]*\bfill="(#[0-9a-fA-F]{3,6})"/.exec(svg) ?? /<rect[^>]*width="100%"[^>]*height="100%"[^>]*\bfill="(#[0-9a-fA-F]{3,6})"/.exec(svg);
  return m && parseColor(m[1]) ? m[1] : '#ffffff';
}
const pathD = (pts) => (pts.length === 1 ? `M${r1(pts[0].x)} ${r1(pts[0].y)}l0 0` : `M${pts.map((p) => `${r1(p.x)} ${r1(p.y)}`).join('L')}`);
// 手描きの層（SVG の断片）。保存物にも使う（許可リストの要素・属性だけ。NFR-SEC-004）。colorName は文字の手掛かり（<title>）
export function renderStrokesSvg(strokes, { background = '#ffffff', hidden = false, label = '', nameOf = (id) => id } = {}) {
  if (!strokes.length) return '';
  const body = strokes.map((s) => {
    const hex = hexOf(s.color); const halo = haloFor(hex, [background]);
    const d = pathD(s.points); const w = s.width ?? STROKE_WIDTH;
    const line = `<path d="${d}" fill="none" stroke="${hex}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
    const edge = halo ? `<path d="${d}" fill="none" stroke="${halo}" stroke-width="${w + 2}" stroke-linecap="round" stroke-linejoin="round"/>` : '';
    return `<g data-stroke-id="${escAttr(s.id)}" data-color="${escAttr(s.color)}"${halo ? ' data-halo="1"' : ''}><title>${escAttr(nameOf(s.color))}</title>${edge}${line}</g>`;
  }).join('');
  return `<g data-role="draw-layer"${label ? ` aria-label="${escAttr(label)}"` : ''}${hidden ? ' display="none"' : ''}>${body}</g>`;
}

// SVG の <g data-point-id> のブロックから、図の座標の外接矩形を求める（要点の枠・吹き出し・文字・印を含む。多めに取る＝機密は伏せる側に倒す）
export function pointBoxFromSvg(svg, pointId) {
  const re = /<g\b[^>]*\bdata-point-id(s)?="([^"]*)"[^>]*>/g;
  let m;
  while ((m = re.exec(svg))) {
    const ids = m[1] ? m[2].split(/\s+/) : [m[2]];
    if (!ids.includes(pointId)) continue;
    // 対応する </g> まで（入れ子を数える）
    let depth = 1; const tagRe = /<(\/?)g\b[^>]*?(\/?)>/g; tagRe.lastIndex = re.lastIndex; let t; let end = svg.length;
    while ((t = tagRe.exec(svg))) { if (t[2] === '/') continue; depth += t[1] ? -1 : 1; if (depth === 0) { end = t.index; break; } }
    const inner = svg.slice(m.index + m[0].length, end);
    return boundsOf(inner);
  }
  return null;
}
function boundsOf(rawInner) {
  let x1 = Infinity; let y1 = Infinity; let x2 = -Infinity; let y2 = -Infinity;
  const add = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); } };
  // 平行移動した絵記号の入れ子の g は、局所座標なので、移動先から 24 角の範囲として数える
  const inner = rawInner.replace(/<g\b[^>]*\btransform="translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)"[^>]*>(?:(?!<g\b)[\s\S])*?<\/g>/g, (all, tx, ty) => { add(Number(tx), Number(ty)); add(Number(tx) + 24, Number(ty) + 24); return ''; });
  const attr = (tag, k) => { const a = new RegExp(`\\b${k}="([^"]*)"`).exec(tag); return a ? a[1] : null; };
  for (const tag of inner.match(/<(rect|path|text|polygon|polyline|line|circle|ellipse)\b[^>]*>/g) ?? []) {
    const name = /^<(\w+)/.exec(tag)[1];
    const sw = Number(attr(tag, 'stroke-width')) || 0;
    if (name === 'rect') { const x = Number(attr(tag, 'x') ?? 0); const y = Number(attr(tag, 'y') ?? 0); add(x - sw / 2, y - sw / 2); add(x + Number(attr(tag, 'width')) + sw / 2, y + Number(attr(tag, 'height')) + sw / 2); }
    else if (name === 'path' || name === 'polygon' || name === 'polyline') {
      const nums = (attr(tag, name === 'path' ? 'd' : 'points') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      for (let i = 0; i + 1 < nums.length; i += 2) add(nums[i], nums[i + 1]);
    } else if (name === 'text') { const x = Number(attr(tag, 'x')); const y = Number(attr(tag, 'y')); const fs = Number(attr(tag, 'font-size')) || 14; add(x, y - fs); add(x + fs, y + fs / 3); }
    else if (name === 'line') { add(Number(attr(tag, 'x1')), Number(attr(tag, 'y1'))); add(Number(attr(tag, 'x2')), Number(attr(tag, 'y2'))); }
    else { const cx = Number(attr(tag, 'cx')); const cy = Number(attr(tag, 'cy')); const rx = Number(attr(tag, 'r') ?? attr(tag, 'rx')); const ry = Number(attr(tag, 'r') ?? attr(tag, 'ry')); add(cx - rx, cy - ry); add(cx + rx, cy + ry); }
  }
  return Number.isFinite(x1) ? { x: r2(x1), y: r2(y1), width: r2(x2 - x1), height: r2(y2 - y1) } : null;
}

const W = {
  ja: { title: '手描き', count: (n) => `手描き ${n} 本`, hidden: (n) => `手描きは非表示です（${n} 本）`, warning: '手描きは図の座標に固定され要点に結びつかないため、要点と重ならない線は残ります' },
  en: { title: 'Free drawing', count: (n) => `Free drawing: ${n} ${n === 1 ? 'stroke' : 'strokes'}`, hidden: (n) => `Free drawing is hidden (${n} ${n === 1 ? 'stroke' : 'strokes'})`, warning: 'Free drawing is fixed to the diagram coordinates and is not tied to points, so strokes that do not overlap a confidential point remain' },
};
const SAVE_COMMANDS = ['save.png', 'save.svg', 'save.pdf', 'save.markdown', 'save.html'];

export function drawModule(ctx) {
  const { api, state } = ctx;
  const lang = () => (state.lang === 'en' ? 'en' : 'ja');
  const w = () => W[lang()];
  const colorName = (id) => DRAW_COLORS.find((c) => c.id === id)?.name[lang()] ?? id;
  ctx.i18n.addStrings({
    ja: {
      'draw.title': '手描き', 'draw.toggle': '手描き', 'draw.color': '色', 'draw.erase': '消しゴム', 'draw.undo': '取り消し', 'draw.redo': 'やり直し', 'draw.clear': '全消去', 'draw.visibility': '表示',
      'draw.group': '手描きの操作', 'draw.hint': 'ペン・マウス・タッチで図の上に線を描きます。キーボードでは、モード・色・消しゴム・取り消し・やり直し・全消去・表示を操作できます。',
      'draw.confirmText': '手描きの線をすべて消します。取り消しで戻せます。', 'draw.confirm': '全消去する', 'draw.cancel': 'キャンセル', 'draw.modeOn': '描画のモード: オン', 'draw.modeOff': '描画のモード: オフ',
      'draw.toolPen': '道具: ペン', 'draw.toolEraser': '道具: 消しゴム', 'draw.shown': '表示中', 'draw.canvasHint': '描画のモードです。ポインタで線を描きます',
      'msg.drawOn': '描画のモードをオンにしました', 'msg.drawOff': '描画のモードをオフにしました', 'msg.drawColor': '手描きの色', 'msg.drawEraserOn': '消しゴムにしました', 'msg.drawEraserOff': 'ペンに戻しました',
      'msg.drawUndone': '手描きを取り消しました', 'msg.drawRedone': '手描きをやり直しました', 'msg.drawNothingUndo': '取り消せる手描きの操作がありません', 'msg.drawNothingRedo': 'やり直せる手描きの操作がありません',
      'msg.drawErased': '線を 1 本消しました', 'msg.drawCleared': '手描きをすべて消しました', 'msg.drawNone': '消す手描きの線がありません', 'msg.drawConfirm': '手描きの全消去の確認を開きました', 'msg.drawCancelled': '手描きの全消去をやめました',
      'msg.drawShown': '手描きを表示しました', 'msg.drawHiddenNow': '手描きを非表示にしました（線は残っています）', 'msg.drawLimit': '手描きの線の上限（500 本）に達したため、これ以上描けません。線を消してください', 'msg.drawHiddenRefuse': '手描きが非表示です。表示してから描いてください', 'msg.drawNotMode': '描画のモードをオンにしてから描いてください',
    },
    en: {
      'draw.title': 'Free drawing', 'draw.toggle': 'Draw', 'draw.color': 'Color', 'draw.erase': 'Eraser', 'draw.undo': 'Undo', 'draw.redo': 'Redo', 'draw.clear': 'Clear all', 'draw.visibility': 'Show',
      'draw.group': 'Free drawing controls', 'draw.hint': 'Draw on the diagram with a pen, mouse or touch. With the keyboard you can control the mode, color, eraser, undo, redo, clear and visibility.',
      'draw.confirmText': 'This removes every drawn stroke. You can bring them back with undo.', 'draw.confirm': 'Clear all', 'draw.cancel': 'Cancel', 'draw.modeOn': 'Draw mode: on', 'draw.modeOff': 'Draw mode: off',
      'draw.toolPen': 'Tool: pen', 'draw.toolEraser': 'Tool: eraser', 'draw.shown': 'Shown', 'draw.canvasHint': 'Draw mode. Draw lines with the pointer',
      'msg.drawOn': 'Draw mode is on', 'msg.drawOff': 'Draw mode is off', 'msg.drawColor': 'Drawing color', 'msg.drawEraserOn': 'The eraser is selected', 'msg.drawEraserOff': 'Back to the pen',
      'msg.drawUndone': 'A drawing action was undone', 'msg.drawRedone': 'A drawing action was redone', 'msg.drawNothingUndo': 'There is no drawing action to undo', 'msg.drawNothingRedo': 'There is no drawing action to redo',
      'msg.drawErased': 'One stroke was erased', 'msg.drawCleared': 'All drawing was cleared', 'msg.drawNone': 'There is no stroke to clear', 'msg.drawConfirm': 'The clear-all confirmation was opened', 'msg.drawCancelled': 'Clearing the drawing was cancelled',
      'msg.drawShown': 'The drawing is shown', 'msg.drawHiddenNow': 'The drawing is hidden (the strokes are kept)', 'msg.drawLimit': 'The limit of 500 strokes was reached, so no more can be drawn. Erase some strokes', 'msg.drawHiddenRefuse': 'The drawing is hidden. Show it before drawing', 'msg.drawNotMode': 'Turn on draw mode before drawing',
    },
  });

  // 状態
  let strokes = []; // [{ id, color, width, points:[{x,y}] }]
  let seq = 0;
  let undoStack = []; let redoStack = []; // 操作の記録: { type:'add'|'erase'|'clear', stroke?, index?, strokes? }
  let mode = false; let tool = 'pen'; let colorId = DRAW_COLORS[0].id;
  let current = null; let erasing = false; let dialogOpen = false;
  let visible = true;
  try { visible = ctx.storage?.getItem?.(HIDDEN_KEY) !== '1'; } catch { visible = true; }
  const copyStroke = (s) => ({ id: s.id, color: s.color, width: s.width, points: s.points.map((p) => ({ x: p.x, y: p.y })) });
  const msg = (key, extra = '') => { state.message = { key, text: `${ctx.t(key)}${extra}` }; };
  const fail = (reason, extra) => ({ ok: false, reason, ...extra });

  // ---- 図の座標・機密の外接矩形 ----
  const baseRender = api.renderSvg;
  let boxMemo = { ver: -2, all: null };
  const svgForBoxes = () => { const v = ctx.getDataVersion(); if (v != null && boxMemo.ver === v && boxMemo.svg) return boxMemo.svg; const svg = baseRender(); boxMemo = { ver: v ?? -2, svg }; return svg; };
  api.getPointBox = (pointId) => (typeof baseRender === 'function' && pointId ? pointBoxFromSvg(svgForBoxes(), String(pointId)) : null);
  const confidentialIds = () => state.scenes.flatMap((s) => s.points).filter((p) => p.confidential === true).map((p) => p.id);
  const confidentialBoxes = () => confidentialIds().map((id) => api.getPointBox(id)).filter(Boolean);

  // ---- 出力に含める線（保存の作成中は、「除く」なら機密の要点と重なる線を除く） ----
  let saving = 0; let exportBoxes = null;
  const inExport = () => saving > 0 || exportBoxes != null;
  const exportStrokes = () => {
    if (!api.getExcludeConfidential?.()) return strokes;
    return withoutOverlapping(strokes, exportBoxes ?? confidentialBoxes());
  };
  api.getDrawExportStrokes = () => (inExport() ? exportStrokes() : strokes).map((s) => ({ id: s.id, color: hexOf(s.color), colorId: s.color, width: s.width, halo: haloFor(hexOf(s.color)), points: s.points.map((p) => ({ x: p.x, y: p.y })) }));
  api.getSaveWarnings = () => {
    if (!api.getExcludeConfidential?.() || !strokes.length || !confidentialIds().length) return [];
    return withoutOverlapping(strokes, confidentialBoxes()).length ? [w().warning] : [];
  };
  api.renderDrawLayer = (svg, { forExport = inExport() } = {}) => {
    const list = forExport ? exportStrokes() : strokes;
    const layer = renderStrokesSvg(list, { background: paperOf(svg), hidden: !visible && !forExport, label: w().title, nameOf: colorName });
    if (!layer) return svg;
    const end = svg.lastIndexOf('</svg>');
    return end < 0 ? svg : `${svg.slice(0, end)}${layer}${svg.slice(end)}`;
  };
  api.renderSvg = () => api.renderDrawLayer(baseRender(), { forExport: inExport() });
  {
    const baseSave = api.renderSvgForSave ?? null;
    api.renderSvgForSave = () => { saving++; try { return (baseSave ?? api.renderSvg)(); } finally { saving--; } };
  }
  for (const name of SAVE_COMMANDS) {
    const base = api.commands[name];
    if (typeof base !== 'function') continue;
    // 機密を除く保存は、状態が機密を除いた写しに差し替わる前（このコマンドの外側）に、機密の要点の外接矩形を求めておく
    ctx.registerCommand(name, (...a) => {
      const prev = exportBoxes;
      exportBoxes = api.getExcludeConfidential?.() ? confidentialBoxes() : [];
      try { return base(...a); } finally { exportBoxes = prev; }
    });
  }

  // ---- 状態・色 ----
  const countsByColor = (list) => DRAW_COLORS.map((c) => [c, list.filter((s) => s.color === c.id).length]).filter(([, n]) => n > 0);
  const countText = (list = strokes) => {
    const parts = countsByColor(list).map(([c, n]) => `${c.name[lang()]} ${n}`);
    return `${w().count(list.length)}${parts.length ? (lang() === 'en' ? ` (${parts.join(', ')})` : `（${parts.join('・')}）`) : ''}`;
  };
  api.getDrawColors = () => DRAW_COLORS.map((c) => ({ id: c.id, name: c.name[lang()], hex: c.hex }));
  api.getDrawState = () => ({
    mode, tool, colorId, colorName: colorName(colorId), color: hexOf(colorId), count: strokes.length, max: STROKE_MAX, limitReached: strokes.length >= STROKE_MAX,
    countText: countText(), visible, hiddenText: visible ? '' : w().hidden(strokes.length), canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, confirmOpen: dialogOpen,
    modeText: ctx.t(mode ? 'draw.modeOn' : 'draw.modeOff'), toolText: ctx.t(tool === 'eraser' ? 'draw.toolEraser' : 'draw.toolPen'),
  });
  api.getStrokes = () => strokes.map((s) => ({ id: s.id, color: s.color, colorName: colorName(s.color), width: s.width, points: s.points.map((p) => ({ x: p.x, y: p.y })) }));
  api.getDrawCurrent = () => (current ? { color: hexOf(current.color), width: current.width, points: current.points.map((p) => ({ x: p.x, y: p.y })) } : null);
  api.getDrawBackgroundContrast = (id, background = '#ffffff') => ({ ratio: contrastRatio(hexOf(id), background), halo: haloFor(hexOf(id), [background]) });
  api.setDrawColor = (id) => {
    if (!COLOR_IDS.has(id)) return fail('invalid_color');
    ctx.change(() => { colorId = id; msg('msg.drawColor', `: ${colorName(id)}`); });
    return { ok: true, colorId: id, colorName: colorName(id) };
  };
  const nextColor = () => { const i = DRAW_COLORS.findIndex((c) => c.id === colorId); return api.setDrawColor(DRAW_COLORS[(i + 1) % DRAW_COLORS.length].id); };

  // ---- 描く・消す ----
  const push = (rec) => { undoStack.push(rec); redoStack = []; };
  const clean = (p) => ({ x: r2(Number(p?.x)), y: r2(Number(p?.y)) });
  const validPt = (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y));
  const hit = (p) => {
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i]; const tol = HIT_TOLERANCE + (s.width ?? STROKE_WIDTH) / 2;
      const pts = s.points;
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k]; const b = pts[k + 1] ?? a;
        const dx = b.x - a.x; const dy = b.y - a.y; const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
        if (Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)) <= tol) return s.id;
      }
    }
    return null;
  };
  const doErase = (id, silent = false) => {
    const i = strokes.findIndex((s) => s.id === id);
    if (i < 0) return fail('not_found');
    const [s] = strokes.splice(i, 1);
    push({ type: 'erase', stroke: s, index: i });
    ctx.change(() => { if (!silent) msg('msg.drawErased'); });
    return { ok: true, id };
  };
  api.eraseStroke = (id) => {
    const i = strokes.findIndex((s) => s.id === id);
    if (i < 0) return fail('not_found');
    return doErase(id);
  };
  // ポインタ（ペン・マウス・タッチ）の操作。座標は図の座標。down → move … → up（cancel で破棄）
  api.drawPointer = (phase, pt) => {
    if (phase === 'cancel') { const had = !!current; current = null; erasing = false; return { ok: true, cancelled: had }; }
    if (!mode) { ctx.change(() => msg('msg.drawNotMode')); return fail('not_in_draw_mode'); }
    if (!visible) { ctx.change(() => msg('msg.drawHiddenRefuse')); return fail('hidden'); }
    if (phase === 'down') {
      if (!validPt(pt)) return fail('invalid_point');
      const p = clean(pt);
      if (tool === 'eraser') { erasing = true; const id = hit(p); return id ? { ...doErase(id), erased: id } : { ok: true, erased: null }; }
      if (strokes.length >= STROKE_MAX) { ctx.change(() => msg('msg.drawLimit')); return fail('limit', { max: STROKE_MAX }); }
      current = { color: colorId, width: STROKE_WIDTH, points: [p] };
      return { ok: true };
    }
    if (phase === 'move') {
      if (erasing) { const id = validPt(pt) ? hit(clean(pt)) : null; return id ? { ...doErase(id), erased: id } : { ok: true, erased: null }; }
      if (!current || !validPt(pt)) return fail('no_stroke');
      const p = clean(pt); const last = current.points[current.points.length - 1];
      if ((p.x !== last.x || p.y !== last.y) && current.points.length < POINTS_MAX) current.points.push(p);
      return { ok: true }; // 途中は再描画しない（画面は api.getDrawCurrent の線を重ねる）
    }
    if (phase === 'up') {
      if (erasing) { erasing = false; return { ok: true }; }
      if (!current) return fail('no_stroke');
      if (validPt(pt)) { const p = clean(pt); const last = current.points[current.points.length - 1]; if ((p.x !== last.x || p.y !== last.y) && current.points.length < POINTS_MAX) current.points.push(p); }
      const s = { id: `d${++seq}`, color: current.color, width: current.width, points: current.points };
      current = null;
      strokes.push(s); push({ type: 'add', stroke: s });
      ctx.change(() => {});
      return { ok: true, id: s.id };
    }
    return fail('invalid_phase');
  };

  // ---- 取り消し・やり直し・全消去 ----
  api.undoDraw = () => {
    const rec = undoStack.pop();
    if (!rec) { ctx.change(() => msg('msg.drawNothingUndo')); return fail('nothing'); }
    if (rec.type === 'add') strokes = strokes.filter((s) => s.id !== rec.stroke.id);
    else if (rec.type === 'erase') strokes.splice(Math.min(rec.index, strokes.length), 0, rec.stroke);
    else if (rec.type === 'clear') strokes = rec.strokes.map(copyStroke);
    redoStack.push(rec);
    ctx.change(() => msg('msg.drawUndone'));
    return { ok: true, count: strokes.length };
  };
  api.redoDraw = () => {
    const rec = redoStack.pop();
    if (!rec) { ctx.change(() => msg('msg.drawNothingRedo')); return fail('nothing'); }
    if (rec.type === 'add') strokes.push(rec.stroke);
    else if (rec.type === 'erase') strokes = strokes.filter((s) => s.id !== rec.stroke.id);
    else if (rec.type === 'clear') strokes = [];
    undoStack.push(rec);
    ctx.change(() => msg('msg.drawRedone'));
    return { ok: true, count: strokes.length };
  };
  api.requestDrawClear = () => {
    if (!strokes.length) { ctx.change(() => msg('msg.drawNone')); return fail('none'); }
    dialogOpen = true; ctx.change(() => msg('msg.drawConfirm'));
    return { ok: true, pending: true };
  };
  api.confirmDrawClear = () => {
    if (!dialogOpen) return fail('no_dialog');
    dialogOpen = false;
    if (!strokes.length) { ctx.change(() => msg('msg.drawNone')); return fail('none'); }
    push({ type: 'clear', strokes: strokes.map(copyStroke) });
    strokes = [];
    ctx.change(() => msg('msg.drawCleared'));
    return { ok: true };
  };
  api.cancelDrawClear = () => {
    if (!dialogOpen) return fail('no_dialog');
    dialogOpen = false; ctx.change(() => msg('msg.drawCancelled'));
    return { ok: true };
  };
  api.getDrawDialog = () => (dialogOpen ? { kind: 'draw-clear', text: ctx.t('draw.confirmText'), countText: countText(), buttons: [{ id: 'confirm', label: ctx.t('draw.confirm') }, { id: 'cancel', label: ctx.t('draw.cancel') }] } : null);

  // ---- モード・道具・表示 ----
  api.toggleDraw = () => { mode = !mode; if (!mode) { current = null; erasing = false; tool = 'pen'; } ctx.change(() => msg(mode ? 'msg.drawOn' : 'msg.drawOff')); return { ok: true, mode }; };
  api.toggleDrawEraser = () => { tool = tool === 'eraser' ? 'pen' : 'eraser'; ctx.change(() => msg(tool === 'eraser' ? 'msg.drawEraserOn' : 'msg.drawEraserOff')); return { ok: true, tool }; };
  api.toggleDrawVisibility = () => {
    visible = !visible;
    try { if (visible) ctx.storage?.removeItem?.(HIDDEN_KEY); else ctx.storage?.setItem?.(HIDDEN_KEY, '1'); } catch { /* 端末の設定が書けなくても動く */ }
    if (!visible) { current = null; erasing = false; }
    ctx.change(() => msg(visible ? 'msg.drawShown' : 'msg.drawHiddenNow'));
    return { ok: true, visible };
  };
  ctx.registerCommand('draw.toggle', () => api.toggleDraw());
  ctx.registerCommand('draw.color.next', () => nextColor());
  ctx.registerCommand('draw.erase', () => api.toggleDrawEraser());
  ctx.registerCommand('draw.undo', () => api.undoDraw());
  ctx.registerCommand('draw.redo', () => api.redoDraw());
  ctx.registerCommand('draw.clear', () => api.requestDrawClear());
  ctx.registerCommand('draw.visibility', () => api.toggleDrawVisibility());
  // Ctrl+Alt+Shift+記号（使用済みの組み合わせと重ならないもの）
  for (const [key, command] of [['!', 'draw.toggle'], ['@', 'draw.color.next'], ['#', 'draw.erase'], ['$', 'draw.undo'], ['%', 'draw.redo'], ['^', 'draw.clear'], ['&', 'draw.visibility']]) ctx.registerKey({ key, ctrl: true, alt: true, shift: true, command });
  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    if (dialogOpen && ev?.key === 'Escape' && !ev?.ctrlKey && !ev?.altKey) { api.cancelDrawClear(); return 'draw.cancel'; }
    return baseKey(ev);
  };

  // ---- テキスト一覧・出力の行（AC-638・640）。線がなければ何も足さない（従来の出力のまま） ----
  api.getDrawLine = () => {
    const list = inExport() ? exportStrokes() : strokes;
    return list.length ? countText(list) : '';
  };
  const baseLines = api.getConflictLines;
  api.getConflictLines = () => {
    const base = baseLines ? baseLines() : {};
    const line = api.getDrawLine();
    return line ? { ...base, drawLine: line } : base;
  };
  const baseOutline = api.getConflictOutlineHtml;
  api.getConflictOutlineHtml = () => {
    const base = baseOutline ? baseOutline() : '';
    if (!strokes.length) return base;
    const e = escAttr;
    return `${base}<section class="outline-draw" data-draw-outline="1" aria-label="${e(w().title)}"><h2>${e(w().title)}</h2><p data-id="draw.count">${e(countText())}</p>${visible ? '' : `<p data-id="draw.hidden">${e(w().hidden(strokes.length))}</p>`}</section>`;
  };

  // ---- 保存・復元・初期化（FR-012・FR-018・FR-019） ----
  const parse = (raw) => {
    const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const out = []; const ids = new Set();
    for (const s of Array.isArray(o.strokes) ? o.strokes : []) {
      if (out.length >= STROKE_MAX) break;
      if (!s || typeof s.id !== 'string' || ids.has(s.id) || !COLOR_IDS.has(s.color) || !Array.isArray(s.points)) continue;
      const pts = s.points.slice(0, POINTS_MAX).filter(validPt).map(clean);
      if (!pts.length) continue;
      ids.add(s.id); out.push({ id: s.id, color: s.color, width: Number.isFinite(s.width) && s.width > 0 && s.width <= 20 ? s.width : STROKE_WIDTH, points: pts });
    }
    const max = out.reduce((n, s) => Math.max(n, Number(/^d(\d+)$/.exec(s.id)?.[1] ?? 0)), 0);
    return { strokes: out, seq: Math.max(max, Number.isInteger(o.seq) && o.seq >= 0 ? o.seq : 0) };
  };
  ctx.registerPersist('draw', {
    export: () => (strokes.length ? { strokes: strokes.map(copyStroke), seq } : undefined),
    import: (v) => { const p = parse(v); strokes = p.strokes; seq = p.seq; undoStack = []; redoStack = []; current = null; erasing = false; dialogOpen = false; },
    reset: () => { strokes = []; seq = 0; undoStack = []; redoStack = []; current = null; erasing = false; dialogOpen = false; mode = false; tool = 'pen'; },
  });
}
