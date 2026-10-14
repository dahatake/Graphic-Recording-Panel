// FR-011 AC-025 AC-026 AC-027 / AC-028: パネルのレイアウト（純粋関数）。DOM に依存しない。

export const PANEL_IDS = ['input', 'diagram', 'outline'];
export const STORAGE_KEY = 'grp.layout';
export const STEP = 20;
export const MIN_W = 160;
export const MIN_H = 120;
export const NARROW_PX = 768; // 画面幅がこれ未満ならパネルを積み重ねる（AC-028）

// FR-017: パネルのタイル配置とフォーカス。作業領域（原点 0,0）を、表示中のパネルが隙間なく占める。
export const FOCUS_RATIO = 0.75; // PARAM-009: フォーカス時のメインの面積の割合
export const DEFAULT_WORK_AREA = { w: 1000, h: 560 };
export const KINDS = ['tile', 'focus', 'maximized', 'free']; // free: 利用者が手で動かした後（表示用）
// タイル配置の列の幅の比（FR-013: 認識文字列パネルは図より右）
const TILE_ORDER = ['diagram', 'outline', 'input'];
const TILE_WEIGHT = { diagram: 410, outline: 232, input: 320 };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const validArea = (a) => a && isNum(a.w) && isNum(a.h) && a.w >= MIN_W && a.h >= MIN_H;

function visibleIds(layout) { return TILE_ORDER.filter((id) => layout.panels[id].visible); }

// メインにするパネル: 指定が表示中ならそれ、なければ表示中の先頭。
export function effectiveMain(layout) {
  const vis = visibleIds(layout);
  return vis.includes(layout.mainPanel) ? layout.mainPanel : (vis[0] ?? null);
}

function setRect(p, x, y, w, h) { p.x = x; p.y = y; p.w = w; p.h = h; }

// 表示中のパネルをタイル（列）に並べる。非表示のパネルの矩形は変えない。
export function applyTile(layout) {
  const ids = visibleIds(layout);
  const { w: W, h: H } = layout.workArea;
  const total = ids.reduce((s, id) => s + TILE_WEIGHT[id], 0);
  let x = 0;
  ids.forEach((id, i) => {
    const w = i === ids.length - 1 ? W - x : Math.round((W * TILE_WEIGHT[id]) / total);
    setRect(layout.panels[id], x, 0, w, H);
    x += w;
  });
}

// メインを面積の 75%（左の列）、ほかの表示中のパネルを残りの右の列に均等な高さで並べる。
export function applyFocus(layout) {
  const main = effectiveMain(layout);
  const others = visibleIds(layout).filter((id) => id !== main);
  const { w: W, h: H } = layout.workArea;
  if (!main) return;
  if (!others.length) { setRect(layout.panels[main], 0, 0, W, H); return; }
  const mw = W * FOCUS_RATIO;
  setRect(layout.panels[main], 0, 0, mw, H);
  const oh = H / others.length;
  others.forEach((id, i) => setRect(layout.panels[id], mw, oh * i, W - mw, oh));
}

function retile(layout) {
  if (layout.kind === 'tile') applyTile(layout);
  else if (layout.kind === 'focus') applyFocus(layout);
}

export function defaultLayout(workArea = DEFAULT_WORK_AREA) {
  const mk = () => ({ x: 0, y: 0, w: MIN_W, h: MIN_H, visible: true, maximized: false });
  const layout = {
    panels: { diagram: mk(), outline: mk(), input: mk() },
    kind: 'tile', mainPanel: null, workArea: { w: workArea.w, h: workArea.h },
  };
  applyTile(layout);
  return layout;
}

// 保存内容を検証して正規化する。壊れていれば既定のレイアウトを返す。
export function normalizeLayout(raw) {
  const base = defaultLayout();
  if (!raw || typeof raw !== 'object' || !raw.panels || typeof raw.panels !== 'object') return base;
  for (const id of PANEL_IDS) {
    const p = raw.panels[id];
    if (!p || ![p.x, p.y, p.w, p.h].every(isNum)) return defaultLayout();
    if (typeof p.visible !== 'boolean' || typeof p.maximized !== 'boolean') return defaultLayout();
    base.panels[id] = {
      x: Math.max(0, p.x), y: Math.max(0, p.y),
      w: Math.max(MIN_W, p.w), h: Math.max(MIN_H, p.h),
      visible: p.visible, maximized: p.maximized,
    };
  }
  // FR-017 AC-087: 種類・メイン・作業領域も復元する（古い保存内容は kind なし = 自由配置）
  base.kind = KINDS.includes(raw.kind) ? raw.kind : 'free';
  base.mainPanel = PANEL_IDS.includes(raw.mainPanel) ? raw.mainPanel : null;
  base.workArea = validArea(raw.workArea) ? { w: raw.workArea.w, h: raw.workArea.h } : { ...DEFAULT_WORK_AREA };
  return base;
}

export function parseLayout(text) {
  if (typeof text !== 'string') return defaultLayout();
  try { return normalizeLayout(JSON.parse(text)); } catch { return defaultLayout(); }
}

export function layoutMode(viewportWidth) {
  return isNum(viewportWidth) && viewportWidth < NARROW_PX ? 'stacked' : 'floating';
}

const COMMANDS = {
  'move-left': (p) => { p.x = Math.max(0, p.x - STEP); },
  'move-right': (p) => { p.x += STEP; },
  'move-up': (p) => { p.y = Math.max(0, p.y - STEP); },
  'move-down': (p) => { p.y += STEP; },
  grow: (p) => { p.w += STEP * 2; p.h += STEP * 2; },
  shrink: (p) => { p.w = Math.max(MIN_W, p.w - STEP * 2); p.h = Math.max(MIN_H, p.h - STEP * 2); },
};
export const PANEL_COMMANDS = Object.keys(COMMANDS);

// 各操作は layout を直接変更し、変更したら true を返す（存在しないパネル・不正な値は false）。
export const ops = {
  move(layout, id, pos) {
    const p = layout.panels[id];
    if (!p || !pos || !isNum(pos.x) || !isNum(pos.y)) return false;
    p.x = Math.max(0, pos.x); p.y = Math.max(0, pos.y);
    layout.kind = 'free';
    return true;
  },
  resize(layout, id, size) {
    const p = layout.panels[id];
    if (!p || !size || !isNum(size.w) || !isNum(size.h)) return false;
    p.w = Math.max(MIN_W, size.w); p.h = Math.max(MIN_H, size.h);
    layout.kind = 'free';
    return true;
  },
  visible(layout, id, v) {
    const p = layout.panels[id];
    if (!p) return false;
    p.visible = !!v; // 最大化の状態は独立に保つ（FR-011/FR-013 AC-049）
    retile(layout); // FR-017 AC-083: タイル・フォーカスでは残りのパネルが空きを埋める
    return true;
  },
  maximized(layout, id, v) {
    const p = layout.panels[id];
    if (!p) return false;
    p.maximized = !!v;
    if (p.maximized) { p.visible = true; layout.kind = 'maximized'; }
    else if (layout.kind === 'maximized' && !PANEL_IDS.some((k) => layout.panels[k].maximized)) layout.kind = 'free';
    return true;
  },
  command(layout, id, name) {
    const p = layout.panels[id];
    const fn = COMMANDS[name];
    if (!p || !fn) return false;
    fn(p);
    layout.kind = 'free';
    return true;
  },
  // FR-017: 'tile' | 'focus' | 'maximize'。存在しないパネル・名前は false（レイアウトは変えない）。
  arrange(layout, name, id) {
    if (name === 'tile') {
      for (const k of PANEL_IDS) layout.panels[k].maximized = false;
      layout.kind = 'tile'; applyTile(layout);
      return true;
    }
    if (name !== 'focus' && name !== 'maximize') return false;
    const target = id ?? (name === 'focus' ? (layout.mainPanel ?? 'diagram') : (effectiveMain(layout) ?? 'diagram'));
    if (!layout.panels[target]) return false;
    for (const k of PANEL_IDS) layout.panels[k].maximized = false;
    layout.panels[target].visible = true;
    layout.mainPanel = target;
    if (name === 'focus') { layout.kind = 'focus'; applyFocus(layout); }
    else { layout.kind = 'maximized'; layout.panels[target].maximized = true; }
    return true;
  },
  workArea(layout, w, h) {
    if (!validArea({ w, h }) || (layout.workArea.w === w && layout.workArea.h === h)) return false;
    layout.workArea = { w, h };
    retile(layout);
    return true;
  },
};
