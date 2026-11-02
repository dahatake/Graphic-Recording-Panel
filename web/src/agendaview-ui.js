// FR-095 AC-611 の画面部分（ブラウザ専用）。状態・操作は app（agendaview.js）が持ち、ここは描くだけ。
// <dialog> の showModal() で、背景の inert とフォーカスの閉じ込めをブラウザに任せる。閉じるとフォーカスは開く前の要素へ戻す。
// 議題の名前は textContent / value でだけ入れる（innerHTML に入れない）。タイマーの欄は agendatimer.js が escape 済みの HTML を返す。
// 進行中の議題の削除の確認は、この画面（モーダル）の中に出す（背後の確認は inert で操作できないため）。動き・アニメーションは使わない（reduced motion を守る）。
export function mountAgendaUI(app, doc = globalThis.document) {
  if (!doc?.body || !app.getAgendaView) return null;
  const dlg = doc.createElement('dialog');
  dlg.id = 'agenda-dialog'; dlg.className = 'glossary-dialog agenda-dialog';
  doc.body.append(dlg);
  let before = null; let sig = null; let tsig = null; let csig = null; let timerBox = null; let confirmBox = null;
  const el = (tag, attrs = {}, text) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };
  const activeId = () => dlg.contains(doc.activeElement) ? doc.activeElement.dataset?.id ?? doc.activeElement.dataset?.command ?? null : null;

  function build(v) {
    dlg.replaceChildren();
    dlg.setAttribute('aria-labelledby', 'agenda-title');
    dlg.append(el('h2', { id: 'agenda-title' }, v.label));
    dlg.append(el('p', { role: 'status', 'data-id': 'agenda.count' }, v.countText));
    dlg.append(el('p', { role: 'alert', 'data-id': 'agenda.error' }, v.error ?? ''));
    const nl = el('label', {}, app.t('agenda.name')); const ni = el('input', { type: 'text', autocomplete: 'off', 'data-id': 'agenda.name' }); ni.value = v.input.name; nl.append(ni);
    const ml = el('label', {}, app.t('agenda.minutes')); const mi = el('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', 'data-id': 'agenda.minutes' }); mi.value = v.input.minutes; ml.append(mi);
    const add = el('button', { type: 'button', class: 'btn btn-primary', 'data-id': 'agenda.add' }, app.t(v.editingId ? 'agenda.update' : 'agenda.add'));
    const close = el('button', { type: 'button', class: 'btn', 'data-id': 'agenda.close' }, app.t('agenda.close'));
    const push = () => app.setAgendaInput({ name: ni.value, minutes: mi.value });
    ni.addEventListener('input', push); mi.addEventListener('input', push);
    for (const i of [ni, mi]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); push(); app.submitAgendaInput(); } });
    add.addEventListener('click', () => { push(); app.submitAgendaInput(); });
    close.addEventListener('click', () => app.closeAgenda());
    const actions = el('div', { class: 'glossary-actions' }); actions.append(add, close);
    dlg.append(nl, ml, actions, el('p', { class: 'hint' }, app.t('agenda.hint')));
    const ul = el('ul', { 'aria-label': v.label });
    if (!v.items.length) ul.append(el('li', {}, app.t('agenda.none')));
    v.items.forEach((it, i) => {
      const li = el('li', { 'data-id': `agenda.item.${it.id}`, tabindex: '0' });
      const mins = `${it.minutes} ${app.t('agenda.minutesUnit')}${it.custom ? '' : `（${app.t('agenda.default')}）`}`;
      li.append(el('span', {}, `${i + 1}. ${it.name} — ${mins}`));
      const btn = (key, fn, disabled) => {
        const b = el('button', { type: 'button', class: 'btn btn-subtle', 'aria-label': `${app.t(key)}: ${it.name}` }, app.t(key));
        if (disabled) b.disabled = true;
        b.addEventListener('click', fn); li.append(b);
      };
      btn('agenda.up', () => { app.moveAgendaItem(it.id, 'up'); }, i === 0);
      btn('agenda.down', () => { app.moveAgendaItem(it.id, 'down'); }, i === v.items.length - 1);
      btn('agenda.edit', () => { app.beginEditAgendaItem(it.id); });
      btn('agenda.delete', () => { app.removeAgendaItem(it.id); });
      ul.append(li);
    });
    dlg.append(ul);
    timerBox = el('div', { 'data-id': 'agenda.timer' });
    // タイマーの操作ボタン（data-command）はコマンドへ渡す
    timerBox.addEventListener('click', (e) => { const b = e.target.closest?.('button[data-command]'); if (b && !b.disabled) app.commands[b.dataset.command]?.(); });
    confirmBox = el('div', { 'data-id': 'agenda.confirm' });
    dlg.append(timerBox, confirmBox);
    tsig = null; csig = null;
  }

  function syncTimer(v) {
    const t = JSON.stringify([v.timer, v.items.length, app.getLang?.()]);
    if (t === tsig) return;
    tsig = t;
    const keep = activeId();
    timerBox.innerHTML = app.renderAgendaTimer?.() || ''; // escape 済み（agendatimer.js）
    if (!timerBox.innerHTML) timerBox.append(el('p', {}, app.t('agenda.timerNone')));
    if (keep && keep.startsWith('timer.')) timerBox.querySelector(`[data-command="${keep}"]`)?.focus?.();
  }

  function syncConfirm() {
    const d = app.getDialog?.();
    const c = d?.kind === 'agenda-delete-current' ? d : null;
    const s = JSON.stringify(c);
    if (s === csig) return;
    csig = s;
    confirmBox.replaceChildren();
    if (!c) return;
    const box = el('div', { role: 'alertdialog', 'aria-label': c.text });
    box.append(el('p', { role: 'alert' }, `⚠ ${c.text}`));
    for (const b of c.buttons) {
      const bt = el('button', { type: 'button', class: b.id === 'confirm' ? 'btn btn-primary' : 'btn', 'data-id': `agenda.confirm.${b.id}` }, b.label);
      bt.addEventListener('click', () => { void app.dialogAction(b.id); });
      box.append(bt);
    }
    confirmBox.append(box);
    confirmBox.querySelector(`[data-id="agenda.confirm.${c.defaultFocus}"]`)?.focus?.();
  }

  function sync() {
    const v = app.getAgendaView();
    if (!v) { if (dlg.open) { dlg.close(); before?.focus?.(); before = null; } sig = null; return; }
    const s = JSON.stringify([v.items, v.countText, v.error, v.editingId, v.label]);
    const fresh = !dlg.open;
    if (fresh) before = doc.activeElement;
    let rebuilt = false;
    if (s !== sig) { sig = s; const keep = activeId(); build(v); rebuilt = true; if (keep && !fresh) dlg.querySelector(`[data-id="${keep}"]`)?.focus?.(); }
    if (fresh) dlg.showModal();
    syncTimer(v); syncConfirm();
    if (fresh || (rebuilt && (v.error || v.editingId))) (dlg.querySelector(`[data-id="${v.focus}"]`) ?? dlg.querySelector('[data-id="agenda.name"]'))?.focus?.();
    // 追加・更新の後は入力欄を空に戻す
    const ni = dlg.querySelector('[data-id="agenda.name"]'); const mi = dlg.querySelector('[data-id="agenda.minutes"]');
    if (ni && ni.value !== v.input.name) ni.value = v.input.name;
    if (mi && mi.value !== v.input.minutes) mi.value = v.input.minutes;
  }
  // Esc（<dialog> の cancel）は app へ渡す（確認中は確認のキャンセル、編集中は編集の取り消し、それ以外は閉じる）
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); app.handleKey({ key: 'Escape' }); });
  // 一覧の項目での Delete（削除）・矢印（移動）・Shift+矢印（並べ替え）は app のキー処理へ渡す
  dlg.addEventListener('keydown', (e) => {
    const li = e.target.closest?.('li[data-id]');
    if (li && e.target === li && ['Delete', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation(); app.focusAgenda(li.dataset.id); app.handleKey({ key: e.key, shiftKey: e.shiftKey });
      const f = app.getAgendaView()?.focus; dlg.querySelector(`[data-id="${f}"]`)?.focus?.();
    }
  });
  app.on?.('change', sync);
  sync();
  return { sync };
}
