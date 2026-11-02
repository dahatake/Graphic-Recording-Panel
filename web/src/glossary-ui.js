// FR-093 AC-549 の画面部分（ブラウザ専用）。状態・操作は app（glossary.js）が持ち、ここは描くだけ。
// <dialog> の showModal() で、背景の inert とフォーカスの閉じ込めをブラウザに任せる。閉じるとフォーカスは開く前の要素へ戻す。
// 語は textContent / value でだけ入れる（innerHTML に入れない）。動き・アニメーションは使わない（reduced motion を守る）。
export function mountGlossaryUI(app, doc = globalThis.document) {
  if (!doc?.body || !app.getGlossaryView) return null;
  const dlg = doc.createElement('dialog');
  dlg.id = 'glossary-dialog'; dlg.className = 'glossary-dialog';
  doc.body.append(dlg);
  let before = null; let sig = null;
  const el = (tag, attrs = {}, text) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };

  function build(v) {
    dlg.replaceChildren();
    dlg.setAttribute('aria-labelledby', 'glossary-title');
    dlg.append(el('h2', { id: 'glossary-title' }, v.label));
    dlg.append(el('p', { role: 'status', 'data-id': 'glossary.count' }, v.countText));
    const err = el('p', { role: 'alert', 'data-id': 'glossary.error' }, v.error ?? '');
    dlg.append(err);
    const tl = el('label', {}, app.t('glossary.term')); const ti = el('input', { type: 'text', autocomplete: 'off', 'data-id': 'glossary.term' }); ti.value = v.input.term; tl.append(ti);
    const vl = el('label', {}, app.t('glossary.variants')); const vi = el('input', { type: 'text', autocomplete: 'off', 'data-id': 'glossary.variants' }); vi.value = v.input.variants; vl.append(vi);
    const add = el('button', { type: 'button', class: 'btn btn-primary', 'data-id': 'glossary.add' }, app.t(v.editingId ? 'glossary.update' : 'glossary.add'));
    const close = el('button', { type: 'button', class: 'btn', 'data-id': 'glossary.close' }, app.t('glossary.close'));
    const sync = () => app.setGlossaryInput({ term: ti.value, variants: vi.value });
    ti.addEventListener('input', sync); vi.addEventListener('input', sync);
    for (const i of [ti, vi]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); sync(); app.submitGlossaryInput(); } });
    add.addEventListener('click', () => { sync(); app.submitGlossaryInput(); });
    close.addEventListener('click', () => app.closeGlossary());
    dlg.append(tl, vl, el('div', { class: 'glossary-actions' }), el('p', { class: 'hint' }, app.t('glossary.hint')));
    dlg.querySelector('.glossary-actions').append(add, close);
    const ul = el('ul', { 'aria-label': v.label });
    if (!v.items.length) ul.append(el('li', {}, app.t('glossary.none')));
    for (const it of v.items) {
      const li = el('li', { 'data-id': `glossary.item.${it.id}`, tabindex: '0' });
      li.append(el('span', {}, it.variants.length ? `${it.term} — ${app.t('glossary.variantsLabel')}: ${it.variants.join('、')}` : it.term));
      const eb = el('button', { type: 'button', class: 'btn btn-subtle' }, app.t('glossary.edit'));
      eb.setAttribute('aria-label', `${app.t('glossary.edit')}: ${it.term}`);
      eb.addEventListener('click', () => { app.editGlossaryItem(it.id); });
      const db = el('button', { type: 'button', class: 'btn btn-subtle' }, app.t('glossary.delete'));
      db.setAttribute('aria-label', `${app.t('glossary.delete')}: ${it.term}`);
      db.addEventListener('click', () => { app.removeGlossaryTerm(it.id); });
      li.append(eb, db); ul.append(li);
    }
    dlg.append(ul);
  }

  function sync() {
    const v = app.getGlossaryView();
    if (!v) { if (dlg.open) { dlg.close(); before?.focus?.(); before = null; } sig = null; return; }
    const s = JSON.stringify([v.items, v.countText, v.error, v.editingId, v.label]);
    const fresh = !dlg.open;
    if (fresh) { before = doc.activeElement; }
    if (s !== sig) { sig = s; build(v); }
    if (fresh) dlg.showModal();
    const target = dlg.querySelector(`[data-id="${v.focus}"]`) ?? dlg.querySelector('[data-id="glossary.term"]');
    if (fresh || v.error || v.editingId) target?.focus?.();
    if (v.input && !dlg.querySelector('[data-id="glossary.term"]')?.value && v.input.term) dlg.querySelector('[data-id="glossary.term"]').value = v.input.term;
  }
  // Esc（<dialog> の cancel）は app へ渡して閉じる（編集中は編集の取り消し）
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); app.handleKey({ key: 'Escape' }); });
  // 一覧の語での Delete（削除）・矢印（移動）は app のキー処理へ渡す
  dlg.addEventListener('keydown', (e) => {
    const li = e.target.closest?.('li[data-id]');
    if (li && e.target === li && ['Delete', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation(); app.focusGlossary(li.dataset.id); app.handleKey({ key: e.key });
      const f = app.getGlossaryView()?.focus; dlg.querySelector(`[data-id="${f}"]`)?.focus?.();
    }
  });
  app.on?.('change', sync);
  sync();
  return { sync };
}
