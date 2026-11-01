// FR-094 AC-553〜555 の画面部分（ブラウザ専用）。mountUI の後に呼ぶ。契約: tests/system/CONTRACT-MEETING.md
// 議事項目の一覧（テキスト一覧のパネルの下）。候補（文字「候補」＋枠つき記号）に確定・却下・編集、項目の追加。
// ・すべてキーボードで操作できる（Tab・Enter で保存、Esc で取り消し）。入力欄の中の Enter・Esc は keymap に渡さない。
// ・会議の文字列は textContent / value でだけ入れる（innerHTML に入れない。XSS 対策）。
// ・動きは使わない（reduced motion に従う）。空欄は「未定」と表示し、自動で補わない。
import { coalesceFrame } from './frame.js';
import { KINDS, KIND_LIST } from './minutes.js';

// 種類ごとの追加の欄（minutes.js の FIELDS と同じ。objection の relatedDecisionId は選択肢で示す）
export const KIND_FIELDS = { decision: ['reason', 'decider'], pending: [], objection: [], action: ['assignee', 'due', 'doneCriteria'] };

export function mountMinutesUI(app, doc = document) {
  const panel = doc.querySelector('.panel[data-panel="outline"]');
  if (!panel || !app.getMeetingItems) return null;
  let root = null; let list = null; let addForm = null;
  let editing = null; // 編集中の項目 ID
  let listSig = null;
  const t = (k) => app.t(k);

  const el = (tag, attrs = {}, text) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); }
    if (text != null) e.textContent = text;
    return e;
  };
  const labeled = (text, input) => { const l = el('label'); l.append(el('span', {}, text), input); return l; };
  const fieldInput = (f) => { const i = el('input', { type: 'text', autocomplete: 'off', 'data-f': f, placeholder: t('minutes.undecided') }); return i; };
  const kindTitle = (k) => t(`minutes.${KIND_LIST[k]}`);

  function build() {
    root = el('section', { class: 'minutes-editor edit-form', role: 'group', 'data-minutes-editor': '' });
    root.append(el('h3', { 'data-k': 'heading', id: 'minutes-editor-title' }));
    list = el('div', { class: 'minutes-editor-list', tabindex: '-1' });
    root.append(list);
    buildAddForm();
    root.addEventListener('keydown', onKey);
    panel.append(root);
  }

  // Enter（入力欄の中）= 保存・追加、Esc = 取り消し。ここで処理したキーは keymap に渡さない
  function onKey(e) {
    const tg = e.target; const tag = String(tg?.tagName ?? '').toUpperCase();
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Escape') {
      const edit = tg.closest?.('[data-minutes-edit]');
      if (edit) { editing = null; listSig = null; sync(true); focusItemButton(edit.dataset.minutesEdit, 'edit'); e.stopPropagation(); e.preventDefault(); return; }
      if (tg.closest?.('[data-minutes-add]')) { resetAdd(); e.stopPropagation(); e.preventDefault(); return; }
    }
    if (e.key === 'Enter' && tag === 'INPUT') {
      const edit = tg.closest?.('[data-minutes-edit]');
      if (edit) { saveEdit(edit); e.stopPropagation(); e.preventDefault(); return; }
      if (tg.closest?.('[data-minutes-add]')) { submitAdd(); e.stopPropagation(); e.preventDefault(); return; }
    }
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') e.stopPropagation(); // 入力欄の中の単独キーは無効（既存の仕組みと同じ向き）
  }

  function focusItemButton(id, act) {
    const b = [...list.querySelectorAll('[data-minutes-act]')].find((x) => x.dataset.minutesId === id && x.dataset.minutesAct === act);
    (b ?? list).focus?.();
  }

  // ---- 追加 ----
  function buildAddForm() {
    addForm = el('div', { class: 'minutes-add', role: 'group', 'data-minutes-add': '' });
    addForm.append(el('h4', { 'data-k': 'add' }));
    const kind = el('select', { 'data-f': 'kind' });
    for (const k of KINDS) { const o = el('option'); o.value = k; kind.append(o); }
    kind.addEventListener('change', syncAddFields);
    addForm.append(labeled('', kind));
    const text = el('input', { type: 'text', autocomplete: 'off', 'data-f': 'text' });
    addForm.append(labeled('', text));
    for (const f of new Set(Object.values(KIND_FIELDS).flat())) addForm.append(labeled('', fieldInput(f)));
    const rel = el('select', { 'data-f': 'relatedDecisionId' });
    addForm.append(labeled('', rel));
    const btn = el('button', { type: 'button', class: 'btn btn-sm', 'data-minutes-act': 'add' });
    btn.addEventListener('click', submitAdd);
    addForm.append(btn);
    root.append(addForm);
  }
  const addValue = (f) => addForm.querySelector(`[data-f="${f}"]`)?.value ?? '';
  function syncAddFields() {
    const k = addValue('kind');
    for (const f of new Set(Object.values(KIND_FIELDS).flat())) {
      const lab = addForm.querySelector(`[data-f="${f}"]`).parentElement;
      lab.hidden = !KIND_FIELDS[k].includes(f);
    }
    addForm.querySelector('[data-f="relatedDecisionId"]').parentElement.hidden = k !== 'objection';
  }
  function resetAdd() {
    for (const i of addForm.querySelectorAll('input')) i.value = '';
    addForm.querySelector('[data-f="relatedDecisionId"]').value = '';
  }
  function submitAdd() {
    const k = addValue('kind');
    const fields = { text: addValue('text') };
    for (const f of KIND_FIELDS[k]) fields[f] = addValue(f);
    if (k === 'objection') fields.relatedDecisionId = addValue('relatedDecisionId');
    const r = app.addMeetingItem(k, fields);
    if (r?.ok) { resetAdd(); addForm.querySelector('[data-f="text"]').focus?.(); } else addForm.querySelector('[data-f="text"]').focus?.();
    return r;
  }

  // ---- 一覧 ----
  function saveEdit(form) {
    const id = form.dataset.minutesEdit;
    const fields = { text: form.querySelector('[data-f="text"]').value };
    for (const i of form.querySelectorAll('[data-f]')) if (i.dataset.f !== 'text') fields[i.dataset.f] = i.value;
    const r = app.editMeetingItem(id, fields);
    if (r?.ok) { editing = null; listSig = null; sync(true); focusItemButton(id, 'edit'); }
    else form.querySelector('[data-f="text"]').focus?.();
    return r;
  }

  function relatedOptions(sel, decisions, selfId) {
    sel.textContent = '';
    const none = el('option', {}, t('minutes.undecided')); none.value = ''; sel.append(none);
    for (const d of decisions) if (d.id !== selfId) { const o = el('option', {}, d.text); o.value = d.id; sel.append(o); }
  }

  function itemEditForm(it, decisions) {
    const form = el('div', { class: 'minutes-item-edit', role: 'group', 'aria-label': `${t('minutes.ui.edit')}: ${it.text}`, 'data-minutes-edit': it.id });
    const text = el('input', { type: 'text', autocomplete: 'off', 'data-f': 'text' }); text.value = it.text;
    form.append(labeled(t('minutes.ui.text'), text));
    for (const f of KIND_FIELDS[it.kind]) { const i = fieldInput(f); i.value = it[f] ?? ''; form.append(labeled(t(`minutes.${f}`), i)); }
    if (it.kind === 'objection') {
      const rel = el('select', { 'data-f': 'relatedDecisionId' }); relatedOptions(rel, decisions, it.id); rel.value = it.relatedDecisionId ?? '';
      form.append(labeled(t('minutes.related'), rel));
    }
    const save = el('button', { type: 'button', class: 'btn btn-sm', 'data-minutes-act': 'save', 'data-minutes-id': it.id }, t('minutes.ui.save'));
    save.addEventListener('click', () => saveEdit(form));
    const cancel = el('button', { type: 'button', class: 'btn btn-sm', 'data-minutes-act': 'cancel', 'data-minutes-id': it.id }, t('minutes.ui.cancel'));
    cancel.addEventListener('click', () => { editing = null; listSig = null; sync(true); focusItemButton(it.id, 'edit'); });
    form.append(save, cancel);
    return form;
  }

  function itemRow(it, decisions) {
    const li = el('li', { 'data-minutes-id': it.id, 'data-state': it.state, class: 'minutes-item' });
    const head = el('div', { class: 'minutes-item-head' });
    if (it.state === 'candidate') {
      const badge = el('span', { class: 'badge badge-candidate', 'data-candidate-mark': '' });
      badge.append(el('span', { 'aria-hidden': 'true' }, '□ '), doc.createTextNode(t('minutes.candidate')));
      head.append(badge, doc.createTextNode(' '));
    }
    head.append(el('span', { class: 'minutes-text' }, it.text));
    const und = t('minutes.undecided');
    const fld = (label, v) => { const s = el('span', { class: 'minutes-field' }, `${label}: `); s.append(el('span', { class: 'minutes-undecided' }, v == null || v === '' ? und : v)); return s; };
    const details = [];
    for (const f of KIND_FIELDS[it.kind]) details.push(fld(t(`minutes.${f}`), it[f]));
    if (it.kind === 'objection' && it.relatedDecisionId) details.push(fld(t('minutes.related'), decisions.find((d) => d.id === it.relatedDecisionId)?.text ?? ''));
    li.append(head);
    if (details.length) { const d = el('div', { class: 'minutes-item-fields' }); details.forEach((x, i) => { if (i) d.append(doc.createTextNode(' / ')); d.append(x); }); li.append(d); }
    if (editing === it.id) { li.append(itemEditForm(it, decisions)); return li; }
    const acts = el('div', { class: 'minutes-item-actions' });
    const btn = (act, label, fn) => {
      const b = el('button', { type: 'button', class: 'btn btn-sm', 'data-minutes-act': act, 'data-minutes-id': it.id, 'aria-label': `${label}: ${it.text}` }, label);
      b.addEventListener('click', fn); acts.append(b);
    };
    if (it.state === 'candidate') btn('confirm', t('minutes.ui.confirm'), () => app.confirmMeetingItem(it.id));
    if (it.state === 'candidate') btn('reject', t('minutes.ui.reject'), () => app.rejectMeetingItem(it.id));
    btn('edit', t('minutes.ui.edit'), () => { editing = it.id; listSig = null; sync(true); const f = list.querySelector(`[data-minutes-edit="${it.id}"] [data-f="text"]`); f?.focus?.(); });
    if (it.state === 'confirmed') btn('delete', t('minutes.ui.delete'), () => app.rejectMeetingItem(it.id));
    li.append(acts);
    return li;
  }

  function renderList(items) {
    const hadFocus = !!list.contains(doc.activeElement) && doc.activeElement !== list;
    list.textContent = '';
    const decisions = items.decisions;
    for (const k of KINDS) {
      const sec = el('section', { class: `minutes-editor-${k}`, 'aria-label': kindTitle(k) });
      sec.append(el('h4', {}, kindTitle(k)));
      const arr = items[KIND_LIST[k]];
      if (!arr.length) sec.append(el('p', {}, t('minutes.none')));
      else { const ul = el('ul', { class: 'minutes-item-list' }); for (const it of arr) ul.append(itemRow(it, decisions)); sec.append(ul); }
      list.append(sec);
    }
    if (hadFocus && !list.contains(doc.activeElement)) list.focus?.(); // 操作した項目が消えたら一覧へフォーカスを戻す
  }

  let syncedKey;
  function sync(force = false) {
    if (!panel) return;
    if (!root) build();
    const ver = app.getRenderVersion?.();
    const lang = app.getState?.().lang;
    const key = `${ver}|${lang}`;
    if (!force && ver !== undefined && key === syncedKey) return;
    syncedKey = key;
    const items = app.getMeetingItems();
    const total = items.decisions.length + items.pendings.length + items.objections.length + items.actions.length;
    root.setAttribute('aria-label', t('minutes.heading'));
    root.querySelector('[data-k="heading"]').textContent = `${t('minutes.heading')}${total ? ` (${total}${t('minutes.count')})` : ''}`;
    const sig = JSON.stringify([lang, editing, KINDS.map((k) => items[KIND_LIST[k]])]);
    const typing = editing && list.contains(doc.activeElement) && /^(INPUT|SELECT)$/i.test(doc.activeElement.tagName);
    if (sig !== listSig && !typing) { listSig = sig; renderList(items); }
    // 追加フォームの文言と選択肢
    addForm.setAttribute('aria-label', t('minutes.ui.add'));
    addForm.querySelector('[data-k="add"]').textContent = t('minutes.ui.add');
    const kindSel = addForm.querySelector('[data-f="kind"]');
    [...kindSel.options].forEach((o) => { o.textContent = kindTitle(o.value); });
    kindSel.parentElement.firstChild.textContent = `${t('minutes.ui.kind')} `;
    addForm.querySelector('[data-f="text"]').parentElement.firstChild.textContent = `${t('minutes.ui.text')} `;
    for (const f of new Set(Object.values(KIND_FIELDS).flat())) addForm.querySelector(`[data-f="${f}"]`).parentElement.firstChild.textContent = `${t(`minutes.${f}`)} `;
    const relSel = addForm.querySelector('[data-f="relatedDecisionId"]');
    relSel.parentElement.firstChild.textContent = `${t('minutes.related')} `;
    const cur = relSel.value;
    const rsig = JSON.stringify([lang, items.decisions.map((d) => [d.id, d.text])]);
    if (relSel._sig !== rsig) { relSel._sig = rsig; relatedOptions(relSel, items.decisions, null); if ([...relSel.options].some((o) => o.value === cur)) relSel.value = cur; }
    addForm.querySelector('[data-minutes-act="add"]').textContent = t('minutes.ui.addButton');
    syncAddFields();
  }

  app.subscribe(coalesceFrame(() => sync(), doc.defaultView?.requestAnimationFrame?.bind(doc.defaultView), doc.defaultView?.cancelAnimationFrame?.bind(doc.defaultView)));
  sync();
  return { sync, getRoot: () => root };
}
