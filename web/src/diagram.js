// FR-004: 2D のグラフィック・ファシリテーション表示。シーンごとに「見出し・吹き出し（要点）・矢印（関係線）・絵記号」を SVG で描く。
// 純粋関数 renderDiagramSvg（単体で SVG ファイルとしても自立する。色は属性で持つ）と、パネル描画（拡大・縮小・移動）。
import { sceneEmotions } from './emotion.js';

export const STATUS_MARK = { in_progress: '○', confirmed: '●' };
const SELECTED_MARK = '▶';
// 色分け（見出しは白文字で 4.5:1 以上）。色だけに頼らず、状態は記号と枠線の種類でも示す。
const PALETTE = ['#1346a8', '#0b5d2a', '#8a3c00', '#6b2a8f', '#9b1c1c', '#0b6070'];
const INK = '#15191f';
const PAPER = '#ffffff';

const FS = 14; const FS_HEAD = 16;
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
    case 'drop': return g('<path d="M12 2q7 8 7 13a7 7 0 0 1-14 0q0-5 7-13z"/>');
    default: return g('<circle cx="12" cy="12" r="9"/>');
  }
}

// scenes: アプリの状態のシーン配列。opts: { selectedSceneId, t, title }
export function renderDiagramSvg(scenes, opts = {}) {
  const t = opts.t ?? ((k) => k);
  const sel = opts.selectedSceneId ?? null;
  const parts = []; let x = MARGIN; let maxH = 0;
  const heads = [];
  scenes.forEach((s, i) => {
    const color = PALETTE[i % PALETTE.length];
    const emos = sceneEmotions(s);
    const emoW = Math.max(0, ...emos.map((e) => 34 + textWidth(e.word, FS)));
    const w = Math.ceil(Math.max(240, textWidth(s.heading, FS_HEAD) + 70, ...s.points.map((p) => textWidth(p.text, FS) + 32), emoW + 32));
    const isSel = s.id === sel;
    const body = [];
    const cx = x + w / 2;
    // 見出し（色分けの帯）
    body.push(`<rect x="${x}" y="${MARGIN}" width="${w}" height="${HEAD_H}" rx="10" fill="${color}"${isSel ? ` stroke="${INK}" stroke-width="4"` : ''}/>`);
    body.push(`<text x="${x + 14}" y="${MARGIN + 28}" font-size="${FS_HEAD}" font-weight="700" fill="#ffffff" data-role="status">${STATUS_MARK[s.status] ?? ''}${isSel ? SELECTED_MARK : ''}</text>`);
    body.push(`<text x="${x + 44}" y="${MARGIN + 28}" font-size="${FS_HEAD}" font-weight="700" fill="#ffffff" data-role="heading">${esc(s.heading)}</text>`);
    // 要点の吹き出し
    const top = new Map(); let y = MARGIN + HEAD_H + GAP;
    const dash = s.status === 'in_progress' ? ' stroke-dasharray="6 4"' : '';
    s.points.forEach((p) => {
      top.set(p.id, y);
      body.push(`<g data-point-id="${attr(p.id)}"><rect x="${x}" y="${y}" width="${w}" height="${BUBBLE_H}" rx="12" fill="${PAPER}" stroke="${color}" stroke-width="2.5"${dash}/>`
        + `<path d="M${x + 18} ${y + BUBBLE_H}l-6 8l14-8z" fill="${PAPER}" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>`
        + `<text x="${x + 16}" y="${y + 24}" font-size="${FS}" fill="${INK}">${esc(p.text)}</text></g>`);
      y += BUBBLE_H + GAP;
    });
    // 関係線（矢印）
    for (const r of s.relations) {
      const a = top.get(r.from); const b = top.get(r.to);
      if (a == null || b == null) continue;
      const [from, to] = a <= b ? [a, b] : [b, a];
      body.push(`<line x1="${cx}" y1="${from + BUBBLE_H + 4}" x2="${cx}" y2="${to - 3}" stroke="${color}" stroke-width="2.5" marker-end="url(#arrow-${i % PALETTE.length})"/>`);
    }
    // 絵記号（感情・様子の語）
    emos.forEach((e) => {
      body.push(`<g data-emotion="${attr(e.id)}">${iconShape(e.shape, x + 14, y - 8, color)}<text x="${x + 44}" y="${y + 10}" font-size="${FS}" font-weight="700" fill="${INK}">${esc(e.word)}</text></g>`);
      y += 34;
    });
    parts.push(`<g data-scene-id="${attr(s.id)}" data-status="${attr(s.status)}"${isSel ? ' aria-current="true"' : ''}>${body.join('')}</g>`);
    heads.push({ x, w, color });
    maxH = Math.max(maxH, y + MARGIN);
    x += w + SCENE_GAP;
  });
  // シーン間の矢印（時系列）
  const flows = heads.slice(0, -1).map((h, i) => {
    const y = MARGIN + HEAD_H / 2; const nx = heads[i + 1].x;
    return `<line x1="${h.x + h.w + 4}" y1="${y}" x2="${nx - 4}" y2="${y}" stroke="${INK}" stroke-width="3" marker-end="url(#arrow-flow)"/>`;
  });
  const width = Math.max(320, x - SCENE_GAP + MARGIN);
  const height = Math.max(160, maxH);
  const markers = PALETTE.map((c, i) => `<marker id="arrow-${i}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`).join('')
    + `<marker id="arrow-flow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="${INK}"/></marker>`;
  const title = esc(opts.title ?? '');
  const empty = scenes.length ? '' : `<text x="${MARGIN}" y="${MARGIN + 24}" font-size="${FS}" fill="${INK}">${esc(t('diagram.empty'))}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, 'Hiragino Sans', 'Yu Gothic UI', Meiryo, sans-serif" role="img" aria-label="${attr(opts.title ?? '')}">`
    + `<title>${title}</title><defs>${markers}</defs><rect width="100%" height="100%" fill="${PAPER}"/>${parts.join('')}${flows.join('')}${empty}</svg>`;
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
    el.setAttribute('width', String(Math.round(w * host._zoom))); el.setAttribute('height', String(Math.round(h * host._zoom)));
  }
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
  ctx.api.renderSvg = () => renderDiagramSvg(ctx.state.scenes, { selectedSceneId: ctx.state.selectedSceneId, t: ctx.t, title: ctx.t('app.title') });
  ctx.registerPanelRenderer('diagram', (host) => mountDiagramPanel(host, ctx.api));
}
