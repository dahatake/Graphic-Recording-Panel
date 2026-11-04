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
export const DIAGRAM_MIN_RATIO = 0.5; // PARAM-157: 既定のタイルで図のパネルが占める幅の下限
export const WORK_AREA_MIN_PCT = 55; // PARAM-156: 作業領域の高さの下限（窓の高さに対する %）
// FR-017 AC-661・AC-662（依頼 2026-11-04）: 既定のタイルは、図が幅の全面（上）、副次パネル（テキスト一覧・認識文字列）が図の下に横並び。
// 副次パネルは初期は折りたたみ（見出しと展開ボタンだけ）。展開したときの高さは作業領域の SECONDARY_EXPANDED_RATIO。
export const SECONDARY_IDS = ['outline', 'input']; // 副次パネル（折りたたみの対象）
export const COLLAPSED_H = 44; // 折りたたんだ副次パネルの高さ（見出し行。styles/app.css の .panel-head と同じ）
export const SECONDARY_EXPANDED_RATIO = 0.3; // 展開した副次パネルの高さ（作業領域の高さに対する割合）
const isSecondary = (id) => SECONDARY_IDS.includes(id);

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
  const others = ids.filter((id) => id !== 'diagram');
  if (!ids.includes('diagram')) { // 図がないときは、表示中のパネルが領域を横に等分する
    let x = 0;
    ids.forEach((id, i) => { const w = i === ids.length - 1 ? W - x : Math.round(W / ids.length); setRect(layout.panels[id], x, 0, w, H); x += w; });
    return;
  }
  if (!others.length) { setRect(layout.panels.diagram, 0, 0, W, H); return; }
  // AC-661: 図は幅の全面（PARAM-157 の下限を満たす）。AC-662: 副次パネルは図の下に横並び。すべて折りたたみなら見出しの高さだけ。
  const open = others.some((id) => !layout.panels[id].collapsed);
  const rowH = open ? Math.min(Math.max(MIN_H, Math.round(H * SECONDARY_EXPANDED_RATIO)), Math.floor(H / 2)) : Math.min(COLLAPSED_H, H);
  setRect(layout.panels.diagram, 0, 0, W, H - rowH);
  let x = 0;
  others.forEach((id, i) => {
    const w = i === others.length - 1 ? W - x : Math.round(W / others.length);
    setRect(layout.panels[id], x, H - rowH, w, rowH);
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

export function retile(layout) {
  if (layout.kind === 'tile') applyTile(layout);
  else if (layout.kind === 'focus') applyFocus(layout);
}

export function defaultLayout(workArea = DEFAULT_WORK_AREA) {
  const mk = (id) => ({ x: 0, y: 0, w: MIN_W, h: MIN_H, visible: true, maximized: false, collapsed: isSecondary(id) });
  const layout = {
    panels: { diagram: mk('diagram'), outline: mk('outline'), input: mk('input') },
    kind: 'tile', mainPanel: null, workArea: { w: workArea.w, h: workArea.h },
  };
  applyTile(layout);
  return layout;
}

// 保存内容を検証して正規化する。壊れていれば既定のレイアウトを返す。
export function normalizeLayout(raw) {
  const base = defaultLayout();
  if (!raw || typeof raw !== 'object' || !raw.panels || typeof raw.panels !== 'object') return base;
  let legacyTile = false; // collapsed を持たない古い保存のタイルは、新しい既定（副次パネルは折りたたみ）で復元する
  for (const id of PANEL_IDS) {
    const p = raw.panels[id];
    if (!p || ![p.x, p.y, p.w, p.h].every(isNum)) return defaultLayout();
    if (typeof p.visible !== 'boolean' || typeof p.maximized !== 'boolean') return defaultLayout();
    if (typeof p.collapsed !== 'boolean') legacyTile = legacyTile || raw.kind === 'tile';
    const collapsed = isSecondary(id) && (typeof p.collapsed === 'boolean' ? p.collapsed : legacyTile);
    base.panels[id] = {
      x: Math.max(0, p.x), y: Math.max(0, p.y),
      w: Math.max(MIN_W, p.w), h: Math.max(collapsed ? COLLAPSED_H : MIN_H, p.h), // 折りたたんだ副次パネルは見出しの高さでよい
      visible: p.visible, maximized: p.maximized,
      collapsed,
    };
  }
  // FR-017 AC-087: 種類・メイン・作業領域も復元する（古い保存内容は kind なし = 自由配置）
  base.kind = KINDS.includes(raw.kind) ? raw.kind : 'free';
  base.mainPanel = PANEL_IDS.includes(raw.mainPanel) ? raw.mainPanel : null;
  base.workArea = validArea(raw.workArea) ? { w: raw.workArea.w, h: raw.workArea.h } : { ...DEFAULT_WORK_AREA };
  if (legacyTile) { for (const id of SECONDARY_IDS) base.panels[id].collapsed = true; applyTile(base); }
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
  collapsed(layout, id, v) {
    const p = layout.panels[id];
    if (!p || !isSecondary(id)) return false;
    const next = !!v;
    if (p.collapsed === next) return false;
    p.collapsed = next;
    retile(layout); // AC-662: 折りたたみ・展開で、図の領域が副次パネルの残りの全面を占め直す
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
      for (const k of SECONDARY_IDS) layout.panels[k].collapsed = true; // 元のタイル配置（既定）へ戻す（AC-662）
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
