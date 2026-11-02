// FR-095 AC-611（AC-568・AC-569 と整合）議題の画面の状態と操作（契約: tests/system/CONTRACT-P2.md「議題」）。DOM に依存しない。
// - 議題の追加・編集・削除・並べ替え。持ち時間は 1 以上の整数（分）。上限は PARAM-152（30 件）。登録しない持ち時間は PARAM-124（10 分）で動く。
// - 議題の保存・復元は meeting.js（セッションの保存）が持つ。ここは meeting.js の replaceAgenda を通して置き換えるだけ（id は保つ）。
// - 進行中の議題は id で追従する（agendatimer.js）。進行中の議題の削除は確認（getDialog().kind === 'agenda-delete-current'）を挟み、確定で次の議題へ進む。
// - 画面は議題の画面だけで完結する（タイマーの現在の議題・残り時間・次の議題も同じ語で出す）。外部へは何も送らない。
import { AGENDA_MAX, DEFAULT_MINUTES } from './meeting.js';

export const AGENDA_LIMIT = AGENDA_MAX; // PARAM-152

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 持ち時間の入力（文字列でも数でも）を 1 以上の整数にする。正の整数でなければ null。
export function parseMinutes(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 ? v : null;
  const s = String(v ?? '').normalize('NFKC').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && Number.isSafeInteger(n) ? n : null;
}

export function agendaViewModule(ctx) {
  const { api } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'msg.agendaClosed': '議題を閉じました',
      'agenda.title': '議題', 'agenda.name': '議題の名前', 'agenda.minutes': '持ち時間（分）', 'agenda.add': '追加', 'agenda.update': '更新', 'agenda.close': '閉じる',
      'agenda.edit': '編集', 'agenda.delete': '削除', 'agenda.up': '上へ', 'agenda.down': '下へ', 'agenda.count': '件', 'agenda.none': '（登録なし）', 'agenda.minutesUnit': '分', 'agenda.default': '既定',
      'agenda.err.empty': '議題の名前が空のため追加できません', 'agenda.err.minutes': '持ち時間は 1 以上の整数（分）で入力してください',
      'agenda.err.limit': '上限（{n} 件）に達しているため追加できません', 'agenda.err.not_found': '対象の議題が見つかりません', 'agenda.err.edge': 'これ以上動かせません',
      'agenda.hint': 'Tab で移動、Enter で追加・編集、Shift+上下矢印で並べ替え、Delete で削除、Esc で閉じる',
      'agenda.timerNone': '議題を登録するとタイマーを開始できます',
      'agenda.delete.text': '進行中の議題を削除します。タイマーは次の議題へ進みます。よろしいですか？', 'agenda.delete.confirm': '削除して次の議題へ',
    },
    en: {
      'msg.agendaClosed': 'The agenda was closed',
      'agenda.title': 'Agenda', 'agenda.name': 'Item name', 'agenda.minutes': 'Time (minutes)', 'agenda.add': 'Add', 'agenda.update': 'Update', 'agenda.close': 'Close',
      'agenda.edit': 'Edit', 'agenda.delete': 'Delete', 'agenda.up': 'Up', 'agenda.down': 'Down', 'agenda.count': 'items', 'agenda.none': '(none registered)', 'agenda.minutesUnit': 'min', 'agenda.default': 'default',
      'agenda.err.empty': 'The item name is empty, so it was not added', 'agenda.err.minutes': 'Enter the time as an integer of 1 or more (minutes)',
      'agenda.err.limit': 'The limit ({n} items) is reached, so it was not added', 'agenda.err.not_found': 'The agenda item was not found', 'agenda.err.edge': 'It cannot be moved any further',
      'agenda.hint': 'Tab to move, Enter to add or edit, Shift+Up/Down to reorder, Delete to remove, Esc to close',
      'agenda.timerNone': 'Register an agenda item to start the timer',
      'agenda.delete.text': 'Delete the running agenda item? The timer will move on to the next item.', 'agenda.delete.confirm': 'Delete and go to the next item',
    },
  });

  let open = false; let focusId = null; let outerFocus = null; let editingId = null; let error = null; let pending = null; // pending: 進行中の議題の削除の確認
  let input = { name: '', minutes: '' };
  const list = () => api.getMeetingContext().agenda;
  const notify = () => ctx.emit('change', api);
  const errText = (reason) => ctx.t(`agenda.err.${reason}`).replace('{n}', String(AGENDA_LIMIT));
  const countText = () => `${list().length}／${AGENDA_LIMIT} ${ctx.t('agenda.count')}`;
  const order = () => ['agenda.name', 'agenda.minutes', 'agenda.add', 'agenda.close', ...list().map((x) => `agenda.item.${x.id}`)];
  const itemId = (f) => (String(f).startsWith('agenda.item.') ? String(f).slice('agenda.item.'.length) : null);
  const fail = (reason) => ({ ok: false, reason: errText(reason), code: reason });
  const resetInput = () => { input = { name: '', minutes: '' }; editingId = null; };

  const baseFocused = api.getFocusedElement;
  api.getFocusedElement = () => (open ? focusId : (baseFocused ? baseFocused() : outerFocus));

  const timerView = () => {
    const tv = api.getAgendaTimer?.() ?? { state: 'idle', currentName: null, remainingText: '00:00', nextName: null };
    return { state: tv.state, stateText: ctx.t(`timer.state.${tv.state}`), currentName: tv.currentName, remainingText: tv.remainingText, nextName: tv.nextName, warning: !!tv.warning, expired: !!tv.expired };
  };

  api.getAgendaView = () => (!open ? null : {
    open: true, role: 'dialog', label: ctx.t('agenda.title'),
    items: list().map((x) => ({ id: x.id, name: x.name, minutes: api.agendaMinutes(x), custom: x.minutes != null })),
    count: list().length, limit: AGENDA_LIMIT, countText: countText(), error,
    input: { ...input }, editingId, focus: focusId, tabOrder: order(), timer: timerView(),
  });
  api.setAgendaInput = ({ name, minutes } = {}) => {
    if (name !== undefined) input.name = String(name);
    if (minutes !== undefined) input.minutes = String(minutes);
    notify();
  };
  const validate = (name, minutes) => {
    if (!String(name ?? '').trim()) return fail('empty');
    if (parseMinutes(minutes) == null) return fail('minutes');
    return null;
  };
  api.editAgendaItem = (id, { name, minutes } = {}) => {
    const cur = list();
    if (!cur.some((x) => x.id === id)) { error = errText('not_found'); notify(); return fail('not_found'); }
    const bad = validate(name, minutes);
    if (bad) { error = bad.reason; notify(); return bad; }
    api.replaceAgenda(cur.map((x) => (x.id === id ? { id, name: String(name).trim(), minutes: parseMinutes(minutes) } : x)));
    error = null; notify();
    return { ok: true };
  };
  api.submitAgendaInput = () => {
    if (editingId) {
      const r = api.editAgendaItem(editingId, { name: input.name, minutes: input.minutes });
      if (r.ok) { resetInput(); focusId = 'agenda.name'; notify(); }
      return r;
    }
    const cur = list();
    const bad = validate(input.name, input.minutes) ?? (cur.length >= AGENDA_LIMIT ? fail('limit') : null);
    if (bad) { error = bad.reason; notify(); return bad; }
    api.replaceAgenda([...cur, { id: api.agendaNewId(), name: input.name.trim(), minutes: parseMinutes(input.minutes) }]);
    error = null; resetInput(); focusId = 'agenda.name'; notify();
    return { ok: true };
  };
  // 画面の「編集」: 入力欄に値を入れる（確定は submitAgendaInput）
  api.beginEditAgendaItem = (id) => {
    const cur = list().find((x) => x.id === id);
    if (!cur) return fail('not_found');
    editingId = id; input = { name: cur.name, minutes: String(api.agendaMinutes(cur)) }; error = null; focusId = 'agenda.name'; notify();
    return { ok: true };
  };
  api.moveAgendaItem = (id, dir) => {
    const cur = list(); const i = cur.findIndex((x) => x.id === id);
    if (i < 0) return fail('not_found');
    const j = dir === 'up' ? i - 1 : dir === 'down' ? i + 1 : -1;
    if (j < 0 || j >= cur.length) return fail('edge');
    const next = cur.slice(); [next[i], next[j]] = [next[j], next[i]];
    api.replaceAgenda(next);
    return { ok: true };
  };
  api.removeAgendaItem = (id) => {
    const cur = list();
    if (!cur.some((x) => x.id === id)) return fail('not_found');
    if (api.agendaTimerIsCurrent?.(id)) { pending = id; notify(); return { ok: false, pending: true }; } // 進行中の議題は確認してから
    if (editingId === id) resetInput();
    api.replaceAgenda(cur.filter((x) => x.id !== id));
    return { ok: true };
  };

  // 進行中の議題の削除の確認（既存の確認の仕組み: getDialog・dialogAction）
  const baseGetDialog = api.getDialog;
  api.getDialog = () => (pending ? {
    kind: 'agenda-delete-current', text: ctx.t('agenda.delete.text'),
    buttons: [{ id: 'confirm', label: ctx.t('agenda.delete.confirm') }, { id: 'cancel', label: ctx.t('dialog.cancel') }],
    defaultFocus: 'cancel', keyboard: true,
  } : (baseGetDialog ? baseGetDialog() : null));
  const baseDialogAction = api.dialogAction;
  api.dialogAction = async (action) => {
    if (!pending) return baseDialogAction ? baseDialogAction(action) : { ok: false, reason: 'no_dialog' };
    const id = pending; pending = null;
    if (action !== 'confirm') { notify(); return { ok: true, cancelled: true }; } // 取り消しは正常な操作（議題は変わらない）
    const cur = list(); const at = cur.findIndex((x) => x.id === id);
    if (at < 0) { notify(); return { ok: false, reason: 'not_found' }; }
    if (editingId === id) resetInput();
    api.replaceAgenda(cur.filter((x) => x.id !== id));
    api.agendaTimerAfterRemoved?.(id, at);
    return { ok: true };
  };

  api.renderAgendaView = () => {
    if (!open) return '';
    const e = esc;
    const items = list().map((x) => `<li data-id="${e(x.id)}">${e(x.name)}（${api.agendaMinutes(x)} ${e(ctx.t('agenda.minutesUnit'))}${x.minutes == null ? `・${e(ctx.t('agenda.default'))}` : ''}）</li>`).join('');
    const timer = api.renderAgendaTimer?.() || `<p>${e(ctx.t('agenda.timerNone'))}</p>`;
    return `<section role="dialog" aria-modal="true" aria-label="${e(ctx.t('agenda.title'))}"><h2>${e(ctx.t('agenda.title'))}</h2>`
      + `<p role="status">${e(countText())}</p>${error ? `<p role="alert">${e(error)}</p>` : ''}`
      + `<label>${e(ctx.t('agenda.name'))} <input type="text" value="${e(input.name)}"></label>`
      + `<label>${e(ctx.t('agenda.minutes'))} <input type="text" inputmode="numeric" value="${e(input.minutes)}"></label>`
      + `<button type="button">${e(ctx.t(editingId ? 'agenda.update' : 'agenda.add'))}</button><button type="button">${e(ctx.t('agenda.close'))}</button>`
      + `<ul aria-label="${e(ctx.t('agenda.title'))}">${items || `<li>${e(ctx.t('agenda.none'))}</li>`}</ul>${timer}</section>`;
  };

  const openView = () => {
    if (!open) { outerFocus = baseFocused ? baseFocused() : outerFocus; }
    open = true; focusId = 'agenda.name'; error = null; resetInput();
    ctx.change(() => ctx.setMessage('msg.agendaOpen'));
    return { ok: true, count: list().length };
  };
  const closeView = () => {
    if (!open) return { ok: true };
    open = false; focusId = null; error = null; pending = null; resetInput();
    api.setFocusedElement?.(outerFocus);
    ctx.change(() => ctx.setMessage('msg.agendaClosed'));
    return { ok: true };
  };
  ctx.registerCommand('agenda.open', openView); // meeting.js の簡易な開く操作を、画面を開く操作に置き換える
  api.closeAgenda = closeView; // 閉じる操作のキーは Esc（handleKey）。コマンドにはしない（全コマンドにキー割り当てが要るため）
  api.focusAgenda = (id) => { if (!open || !order().includes(id)) return false; focusId = id; notify(); return true; };

  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    const k = String(ev?.key);
    if (pending && k === 'Escape' && !ev?.ctrlKey && !ev?.altKey) { void api.dialogAction('cancel'); return 'dialog.cancel'; }
    if (!open || pending || ev?.ctrlKey || ev?.altKey || ev?.metaKey) return baseKey(ev);
    if (k === 'Escape') {
      if (editingId) { resetInput(); error = null; focusId = 'agenda.name'; notify(); return 'agenda.cancelEdit'; }
      closeView(); return 'agenda.close';
    }
    const ord = order();
    if (k === 'Tab') { const i = ord.indexOf(focusId); focusId = ord[(i < 0 ? 0 : i + (ev.shiftKey ? ord.length - 1 : 1)) % ord.length]; notify(); return 'agenda.focus'; }
    const cur = itemId(focusId);
    if (cur && (k === 'ArrowDown' || k === 'ArrowUp')) {
      if (ev.shiftKey) { api.moveAgendaItem(cur, k === 'ArrowDown' ? 'down' : 'up'); notify(); return 'agenda.move'; }
      const items = ord.filter((x) => x.startsWith('agenda.item.')); const i = items.indexOf(focusId);
      focusId = items[Math.max(0, Math.min(items.length - 1, i + (k === 'ArrowDown' ? 1 : -1)))]; notify(); return 'agenda.focus';
    }
    if (cur && k === 'Delete') {
      const items = ord.filter((x) => x.startsWith('agenda.item.')); const i = items.indexOf(focusId);
      const r = api.removeAgendaItem(cur);
      if (!r.pending) { const rest = order().filter((x) => x.startsWith('agenda.item.')); focusId = rest.length ? rest[Math.min(i, rest.length - 1)] : 'agenda.name'; }
      notify(); return 'agenda.delete';
    }
    if (k === 'Enter') {
      if (cur) { api.beginEditAgendaItem(cur); return 'agenda.edit'; }
      if (focusId === 'agenda.close') { closeView(); return 'agenda.close'; }
      api.submitAgendaInput(); return 'agenda.submit';
    }
    return baseKey(ev);
  };
}
