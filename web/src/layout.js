// FR-011 AC-025 AC-026 AC-027 / AC-028: パネルのレイアウト（純粋関数）。DOM に依存しない。

export const PANEL_IDS = ['input', 'diagram', 'outline'];
export const STORAGE_KEY = 'grp.layout';
export const STEP = 20;
export const MIN_W = 160;
export const MIN_H = 120;
export const NARROW_PX = 768; // 画面幅がこれ未満ならパネルを積み重ねる（AC-028）

export function defaultLayout() {
  const mk = (x, y, w, h) => ({ x, y, w, h, visible: true, maximized: false });
  return {
    panels: {
      input: mk(0, 0, 360, 560),
      diagram: mk(380, 0, 560, 560),
      outline: mk(960, 0, 320, 560),
    },
  };
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

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
    return true;
  },
  resize(layout, id, size) {
    const p = layout.panels[id];
    if (!p || !size || !isNum(size.w) || !isNum(size.h)) return false;
    p.w = Math.max(MIN_W, size.w); p.h = Math.max(MIN_H, size.h);
    return true;
  },
  visible(layout, id, v) {
    const p = layout.panels[id];
    if (!p) return false;
    p.visible = !!v;
    if (!p.visible) p.maximized = false;
    return true;
  },
  maximized(layout, id, v) {
    const p = layout.panels[id];
    if (!p) return false;
    p.maximized = !!v;
    if (p.maximized) p.visible = true;
    return true;
  },
  command(layout, id, name) {
    const p = layout.panels[id];
    const fn = COMMANDS[name];
    if (!p || !fn) return false;
    fn(p);
    return true;
  },
};
