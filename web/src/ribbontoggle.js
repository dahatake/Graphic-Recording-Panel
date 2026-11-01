// NFR-UX-003 AC-579: 窓の高さが小さい（PARAM-130 = 600px 以下）ときの、リボン（#toolbar）の開閉。
// リボンは高さが窓を超えることがあり、下のパネル領域を押し出す・隠すため、(1) 高さを窓の 40% までにして中でスクロールし、
// (2) 開閉ボタンで折りたためる。開閉の状態は文字（開く／閉じる）・形（▼／▲）・aria-expanded で示す。色だけに頼らない。
// 高さの境は styles/app.css の @media (max-height: 600px) と同じ値（tests/unit/ribbontoggle.test.js で一致を確かめる）。
export const RIBBON_COMPACT_MAX_HEIGHT = 600; // PARAM-130

export function isCompactHeight(height) { return Number.isFinite(height) && height <= RIBBON_COMPACT_MAX_HEIGHT; }

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
export function mountRibbonToggle(app, doc = document) {
  const btn = doc.querySelector('#ribbon-toggle');
  const target = doc.querySelector('#toolbar');
  if (!btn || !target) return null;
  let collapsed = false;
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
  btn.addEventListener('click', () => { collapsed = !collapsed; sync(); });
  app.subscribe?.(sync);
  sync();
  return { sync, isCollapsed: () => collapsed };
}
