// NFR-UX-003 AC-579: 窓の高さが小さい（PARAM-130 = 600px 以下）ときの、リボン（#toolbar）の開閉。
// リボンは高さが窓を超えることがあり、下のパネル領域を押し出す・隠すため、(1) 高さを窓の 40% までにして中でスクロールし、
// (2) 開閉ボタンで折りたためる。開閉の状態は文字（開く／閉じる）・形（▼／▲）・aria-expanded で示す。色だけに頼らない。
// 高さの境は styles/app.css の @media (max-height: 600px) と同じ値（tests/unit/ribbontoggle.test.js で一致を確かめる）。
export const RIBBON_COMPACT_MAX_HEIGHT = 600; // PARAM-130

export function isCompactHeight(height) { return Number.isFinite(height) && height <= RIBBON_COMPACT_MAX_HEIGHT; }

// AC-641・AC-642: 窓の高さがこれ未満ならリボンを折りたたんで起動する（保存がないときだけ）。保存は端末ごと（localStorage）。
export const RIBBON_COLLAPSE_BELOW_HEIGHT = 900; // PARAM-155
export const RIBBON_STORAGE_KEY = 'grp.ribbon.collapsed'; // '1' = 折りたたみ、'0' = 開く。それ以外（壊れた値）は無視して既定へ
export function initialCollapsed(stored, height) {
  if (stored === '1') return true;
  if (stored === '0') return false;
  return Number.isFinite(height) && height < RIBBON_COLLAPSE_BELOW_HEIGHT;
}

// 状態（折りたたみか）から、ボタンの見た目と aria を決める。DOM に依存しない。
export function ribbonToggleView(collapsed, t) {
  return {
    expanded: !collapsed,
    ariaExpanded: collapsed ? 'false' : 'true',
    shape: collapsed ? '▼' : '▲',
    text: t(collapsed ? 'ribbon.toggle.show' : 'ribbon.toggle.hide'),
  };
}

// ボタン #ribbon-toggle と対象（#toolbar）を結ぶ。折りたたみは data-collapsed で示し、CSS が低い窓でだけ効かせる。
export function mountRibbonToggle(app, doc = document, storage = null) {
  const btn = doc.querySelector('#ribbon-toggle');
  const target = doc.querySelector('#toolbar');
  if (!btn || !target) return null;
  let store = storage;
  if (!store) { try { store = globalThis.localStorage ?? null; } catch { store = null; } }
  let stored = null;
  try { stored = store?.getItem?.(RIBBON_STORAGE_KEY) ?? null; } catch { stored = null; }
  let collapsed = initialCollapsed(stored, doc.defaultView?.innerHeight);
  const sync = () => {
    const v = ribbonToggleView(collapsed, (k) => app.t(k));
    btn.setAttribute('aria-expanded', v.ariaExpanded);
    btn.setAttribute('aria-controls', 'toolbar');
    const shape = btn.querySelector('.ribbon-toggle-shape');
    const text = btn.querySelector('.ribbon-toggle-text');
    if (shape) shape.textContent = v.shape;
    if (text) text.textContent = v.text;
    target.dataset.collapsed = collapsed ? 'true' : 'false';
  };
  btn.addEventListener('click', () => {
    collapsed = !collapsed; sync();
    try { store?.setItem?.(RIBBON_STORAGE_KEY, collapsed ? '1' : '0'); } catch { /* 端末の設定が書けなくても動く */ }
  });
  app.subscribe?.(sync);
  sync();
  return { sync, isCollapsed: () => collapsed };
}
