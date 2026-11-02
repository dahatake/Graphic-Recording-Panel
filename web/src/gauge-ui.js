// FR-109 AC-626: ゲージ・棒をポインタでホバーするか、キーボードでフォーカスすると、数値（現在値・目標・単位・望ましい方向）を示し、Esc で閉じる。
// 画面の DOM にだけ足す（保存物の SVG の文字列は変えない）。値は文字で出す（色だけに頼らない）。動きはなく、reduced motion でも同じ。
let activeTip = null;
const bound = new WeakSet();
const hide = () => { if (activeTip) { activeTip.remove(); activeTip = null; } };
const onKey = (ev) => { if (activeTip && ev.key === 'Escape') { hide(); ev.stopPropagation?.(); } };

export function enhanceGaugeDom(svgEl, host, app) {
  if (!svgEl?.querySelectorAll) return 0;
  const doc = svgEl.ownerDocument;
  const cells = [...svgEl.querySelectorAll('[data-gauge-point]')];
  if (!cells.length) return 0;
  const show = (cell) => {
    const info = app.getGaugeTip?.(cell.getAttribute('data-gauge-point'));
    if (!info) return;
    hide();
    const tip = doc.createElement('div');
    tip.className = 'gauge-tip'; tip.setAttribute('role', 'tooltip'); tip.setAttribute('data-gauge-tip', info.pointId);
    const h = doc.createElement('strong'); h.textContent = info.title; tip.append(h);
    const ul = doc.createElement('ul');
    for (const l of info.lines) { const li = doc.createElement('li'); li.textContent = l; ul.append(li); }
    tip.append(ul);
    (doc.body ?? host).append(tip);
    const r = cell.getBoundingClientRect?.();
    if (r) { tip.style.left = `${Math.max(4, Math.round(r.left))}px`; tip.style.top = `${Math.round(r.bottom + 4)}px`; }
    activeTip = tip;
  };
  for (const cell of cells) {
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('role', 'group');
    cell.addEventListener('pointerenter', () => show(cell));
    cell.addEventListener('pointerleave', hide);
    cell.addEventListener('focus', () => show(cell));
    cell.addEventListener('blur', hide);
    cell.addEventListener('keydown', onKey);
  }
  if (!bound.has(doc)) { bound.add(doc); doc.addEventListener('keydown', onKey); }
  return cells.length;
}
