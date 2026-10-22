// FR-084 接続キー画面（最上部の「接続キー」と中央のモーダル）／FR-085 Microsoft Foundry のキー／NFR-SEC-006 キーの非露出
// （契約: tests/system/CONTRACT-API-KEYS.md）。DOM に依存しない（描画は apikeys-ui.js）。
// - Azure Speech の分類は speechsettings.js（FR-082）の状態・操作をそのまま使う（保管先は 1 つ。別の保管を作らない）。
// - Foundry のキーは書き込み専用。入力中の一時的な値はメモリの 1 か所（foundryInput）だけに持ち、保存の要求を送る前に空にする。
//   画面（fields）には伏せ字だけを出し、ブラウザ内の保存・ログ・メッセージ・セッションファイルには書かない。
//   中継サーバーの応答からは「keyConfigured」「keySource」だけを取り出す（キーらしい値が混ざっても使わない）。
// - モーダルが開いている間は、背景のコマンド・入力を受け付けない（{ ok:false, reason:'modal' }）。記録・音声認識・図は変えない。

import { matchKey } from './keymap.js';

const TIMEOUT_MS = 10_000; // PARAM-074（中継サーバーの操作の待機上限）
export const MAX_KEY_LENGTH = 512; // PARAM-094
const SOURCES = ['ui', 'env', 'file'];
const ICONS = { set: '●', unset: '○', unavailable: '▲', checking: '…' };
const CATEGORIES = ['foundry', 'azureSpeech'];
const ALLOWED_WHILE_OPEN = /^(apiKeys|foundry|azureSpeech)\./;
const ALERT_RE = /(invalid|failed|unavailable|envManaged|deleteFailed|empty|test\.(unconfigured|auth|network|timeout))/;
// 制御文字（NUL・C0・DEL）を含む値は拒否する
const hasControl = (s) => { for (const ch of s) { const c = ch.codePointAt(0); if (c < 0x20 || c === 0x7f) return true; } return false; };

export function apiKeysModule(ctx) {
  const { api, state } = ctx;
  const t = ctx.t;

  ctx.i18n.addStrings({
    ja: {
      'apikeys.title': '接続キー', 'apikeys.close': '閉じる', 'apikeys.categories': '分類',
      'apikeys.category.foundry': 'Microsoft Foundry', 'apikeys.category.azureSpeech': 'Azure Speech',
      'keys.opened': '接続キー画面を開きました', 'keys.closed': '接続キー画面を閉じました',
      'keys.label.key': 'キー', 'keys.label.status': '状態', 'keys.label.save': '保存', 'keys.label.delete': '削除',
      'keys.a11y.foundry': 'Microsoft Foundry の',
      'keys.key.placeholder': '新しいキーを入力（保存後は表示されません）',
      'keys.foundry.set': 'キー: 設定済み', 'keys.foundry.unset': 'キー: 未設定',
      'keys.src.ui': '画面で保存', 'keys.src.env': '環境変数', 'keys.src.file': '設定ファイル',
      'keys.foundry.envManaged': '環境変数・設定ファイルのキーは画面から削除できません',
      'keys.checking': '中継サーバーに確認しています',
      'keys.unavailable': '中継サーバーが応答しないため、キーを変更できません。中継サーバー（start.ps1 / start.sh）を起動してください',
      'keys.foundry.saved': 'Microsoft Foundry のキーを保存しました',
      'keys.foundry.invalid': '保存できませんでした。キーは空・空白だけ・制御文字を含む・長すぎる値にできません',
      'keys.foundry.failed': 'Microsoft Foundry のキーを保存できませんでした。もう一度お試しください',
      'keys.foundry.deleted': 'Microsoft Foundry のキーを削除しました', 'keys.foundry.deleteFailed': 'キーを削除できませんでした。もう一度お試しください',
      'keys.foundry.delete.text': 'Microsoft Foundry のキーを削除しますか？ 削除すると、LLM 連携は認証情報が未設定になります', 'keys.foundry.delete.confirm': 'キーを削除',
    },
    en: {
      'apikeys.title': 'API Keys', 'apikeys.close': 'Close', 'apikeys.categories': 'Categories',
      'apikeys.category.foundry': 'Microsoft Foundry', 'apikeys.category.azureSpeech': 'Azure Speech',
      'keys.opened': 'The API Keys dialog was opened', 'keys.closed': 'The API Keys dialog was closed',
      'keys.label.key': 'Key', 'keys.label.status': 'Status', 'keys.label.save': 'Save', 'keys.label.delete': 'Delete',
      'keys.a11y.foundry': 'Microsoft Foundry',
      'keys.key.placeholder': 'Enter a new key (it is not shown after saving)',
      'keys.foundry.set': 'Key: configured', 'keys.foundry.unset': 'Key: not configured',
      'keys.src.ui': 'saved in this screen', 'keys.src.env': 'environment variable', 'keys.src.file': 'config file',
      'keys.foundry.envManaged': 'A key from an environment variable or config file cannot be deleted here',
      'keys.checking': 'Checking with the relay server',
      'keys.unavailable': 'The relay server is not responding, so the keys cannot be changed. Start the relay server (start.ps1 / start.sh)',
      'keys.foundry.saved': 'The Microsoft Foundry key was saved',
      'keys.foundry.invalid': 'Not saved. The key cannot be empty, whitespace only, contain control characters, or be too long',
      'keys.foundry.failed': 'The Microsoft Foundry key could not be saved. Try again',
      'keys.foundry.deleted': 'The Microsoft Foundry key was deleted', 'keys.foundry.deleteFailed': 'The key could not be deleted. Try again',
      'keys.foundry.delete.text': 'Delete the Microsoft Foundry key? LLM integration will have no credential', 'keys.foundry.delete.confirm': 'Delete key',
    },
  });

  const relay = typeof ctx.options.relay === 'function' ? ctx.options.relay : null;
  const sched = ctx.options.scheduler ?? { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  const notify = () => ctx.emit('change', api);

  // ---- 状態（キーの値は持たない。foundryInput は入力中の一時的な値だけ） ----
  let open = false;
  let selected = 'foundry';
  let focusId = null;
  let fChecked = !relay; // 中継サーバーに一度でも問い合わせたか（中継サーバーなしは確認済みの扱い）
  let fStatus = { reachable: false, keyConfigured: false, source: null };
  let foundryInput = '';
  let busy = false;
  let foundryDlg = false; // Foundry のキーの削除の確認
  const say = (key) => ctx.change((s) => { s.message = { key, text: t(key) }; });

  // ---- 中継サーバーへの要求（タイムアウト・例外は分類にそろえる） ----
  async function send(method, path, body) {
    if (!relay) return { status: 0, error: 'unavailable', body: null };
    let timer = null;
    const timeout = new Promise((resolve) => { timer = sched.setTimeout(() => resolve({ status: 0, error: 'timeout', body: null }), TIMEOUT_MS); });
    try {
      const res = await Promise.race([(async () => relay(body === undefined ? { method, path } : { method, path, body }))(), timeout]);
      return res && typeof res === 'object' && 'status' in res ? res : { status: 0, error: 'network', body: null };
    } catch { return { status: 0, error: 'unavailable', body: null }; } finally { if (timer != null) sched.clearTimeout(timer); }
  }
  const ok2xx = (r) => r.status >= 200 && r.status < 300 && r.body && typeof r.body === 'object';
  // 応答から「設定済みか」と出どころだけを取り出す（ほかの項目は捨てる）
  const pick = (b) => ({ reachable: true, keyConfigured: b?.keyConfigured === true, source: b?.keyConfigured === true && SOURCES.includes(b?.keySource) ? b.keySource : null });
  const view = () => ({ reachable: fStatus.reachable, keyConfigured: fStatus.keyConfigured, source: fStatus.source });

  api.refreshFoundryKeyStatus = async () => {
    const r = await send('GET', '/api/llm/status');
    fChecked = true;
    fStatus = ok2xx(r) ? pick(r.body) : { reachable: false, keyConfigured: false, source: null };
    notify();
    return view();
  };
  api.getFoundryKeyStatus = () => view();
  api.setFoundryKeyInput = (text) => { foundryInput = String(text ?? ''); notify(); };

  // ---- 保存（AC-487・AC-489）: 成功・失敗によらず、送る前に入力欄を空にする ----
  api.saveFoundryKey = async () => {
    const key = foundryInput.trim();
    const bad = !key || key.length > MAX_KEY_LENGTH || hasControl(foundryInput.trim());
    foundryInput = '';
    notify();
    if (bad) { say('keys.foundry.invalid'); return { ok: false, result: 'invalid' }; }
    if (!relay || (fChecked && !fStatus.reachable)) {
      const r = relay ? await api.refreshFoundryKeyStatus() : null;
      if (!r || !r.reachable) { say('keys.unavailable'); return { ok: false, result: 'unavailable' }; }
    }
    busy = true; notify();
    const r = await send('POST', '/api/llm/key', { key });
    busy = false;
    if (ok2xx(r) && r.body.ok === true && r.body.result === 'saved') {
      fStatus = pick(r.body); say('keys.foundry.saved'); return { ok: true, result: 'saved' };
    }
    if (r.error === 'unavailable') { fStatus = { reachable: false, keyConfigured: false, source: null }; say('keys.unavailable'); return { ok: false, result: 'unavailable' }; }
    if (r.status === 400 || r.body?.result === 'invalid') { say('keys.foundry.invalid'); return { ok: false, result: 'invalid' }; }
    say('keys.foundry.failed');
    return { ok: false, result: 'failed' };
  };

  // ---- 削除（確認つき。環境変数・設定ファイルのキーは削除できない） ----
  const deletable = () => fStatus.reachable && fStatus.keyConfigured && fStatus.source === 'ui';
  ctx.registerCommand('foundry.deleteKey', () => {
    if (!fStatus.reachable) { say('keys.unavailable'); return { ok: false, reason: 'unavailable' }; }
    if (fStatus.keyConfigured && fStatus.source !== 'ui') { say('keys.foundry.envManaged'); return { ok: false, reason: 'env_managed' }; }
    if (!deletable()) return { ok: false, reason: 'unset' };
    if (!foundryDlg && !api.getDialog()) { foundryDlg = true; notify(); }
    return { ok: true, pending: true };
  });
  const baseGetDialog = api.getDialog;
  api.getDialog = () => (foundryDlg ? {
    kind: 'foundry-key-delete', text: t('keys.foundry.delete.text'),
    buttons: [{ id: 'confirm', label: t('keys.foundry.delete.confirm') }, { id: 'cancel', label: t('dialog.cancel') }],
    defaultFocus: 'cancel', keyboard: true,
  } : (baseGetDialog ? baseGetDialog() : null));
  const baseDialogAction = api.dialogAction;
  api.dialogAction = async (action) => {
    if (!foundryDlg) return baseDialogAction ? baseDialogAction(action) : { ok: false, reason: 'no_dialog' };
    foundryDlg = false;
    if (action !== 'confirm') { notify(); return { ok: false, reason: 'cancelled' }; }
    const r = await send('DELETE', '/api/llm/key');
    if (ok2xx(r) && r.body.ok === true) { fStatus = pick(r.body); say('keys.foundry.deleted'); return { ok: true }; }
    if (r.error === 'unavailable') { fStatus = { reachable: false, keyConfigured: false, source: null }; say('keys.unavailable'); return { ok: false, reason: 'unavailable' }; }
    if (ok2xx(r) && r.body.result === 'env_managed') { fStatus = pick(r.body); say('keys.foundry.envManaged'); return { ok: false, reason: 'env_managed' }; }
    say('keys.foundry.deleteFailed');
    return { ok: false, reason: 'failed' };
  };

  // ---- 画面の項目 ----
  const down = () => fChecked && !fStatus.reachable; // 中継サーバーが応答しない（Foundry の確認の失敗。Azure Speech の分類にも及ぼす）
  const lbl = (k) => t(`keys.label.${k}`);
  const a11y = (label) => `${t('keys.a11y.foundry')} ${label}`;
  const foundryStatus = () => {
    if (!fChecked) return { id: 'unavailable', source: null, text: t('keys.checking'), icon: ICONS.checking };
    if (!fStatus.reachable) return { id: 'unavailable', source: null, text: t('keys.unavailable'), icon: ICONS.unavailable };
    if (!fStatus.keyConfigured) return { id: 'unset', source: null, text: t('keys.foundry.unset'), icon: ICONS.unset };
    const managed = fStatus.source !== 'ui' ? ` ／ ${t('keys.foundry.envManaged')}` : '';
    return { id: 'set', source: fStatus.source, text: `${t('keys.foundry.set')}（${t(`keys.src.${fStatus.source ?? 'ui'}`)}）${managed}`, icon: ICONS.set };
  };
  const foundryFields = () => {
    const off = !fChecked || down() || busy;
    const reason = down() ? t('keys.unavailable') : null;
    const base = (id, k, extra) => ({ id: `apiKeys.foundry.${id}`, label: lbl(k), accessibleName: a11y(lbl(k)), disabled: off, focusable: !off, reason, ...extra });
    const delOff = off || !deletable();
    return [
      base('key', 'key', { role: 'textbox', input: { type: 'password', value: '•'.repeat(Math.min(foundryInput.length, 64)), autocomplete: 'new-password', writeOnly: true, reveal: false, placeholder: t('keys.key.placeholder') } }),
      { id: 'apiKeys.foundry.status', label: lbl('status'), accessibleName: a11y(lbl('status')), role: 'status', focusable: false, disabled: false, reason: null, status: foundryStatus() },
      base('save', 'save', { role: 'button' }),
      base('delete', 'delete', { role: 'button', disabled: delOff, focusable: !delOff, reason: down() ? reason : (fStatus.keyConfigured && fStatus.source !== 'ui' ? t('keys.foundry.envManaged') : null) }),
    ];
  };
  const azureFields = () => {
    const isDown = down();
    return (api.getAzureSpeechFields?.() ?? []).filter((f) => f.id !== 'speech.method').map((f) => {
      const disabled = isDown ? true : (f.disabled ?? false);
      const out = { ...f, id: `apiKeys.${f.id}`, disabled, focusable: !!f.focusable && !disabled, reason: isDown ? t('keys.unavailable') : f.reason };
      if (isDown && f.id === 'azureSpeech.status') out.status = { id: 'unavailable', text: t('keys.unavailable'), icon: ICONS.unavailable };
      return out;
    });
  };
  const fieldsOf = (cat) => (cat === 'foundry' ? foundryFields() : azureFields());
  const tabOrder = (fields) => ['apiKeys.close', ...CATEGORIES.map((c) => `apiKeys.category.${c}`), ...fields.filter((f) => f.focusable).map((f) => f.id)];
  const liveMessage = () => {
    const m = state.message;
    if (!m || !/^(keys|azs)\./.test(m.key)) return null;
    return { text: m.text, role: ALERT_RE.test(m.key) ? 'alert' : 'status' };
  };

  api.getApiKeysDialog = () => {
    if (!open) return null;
    const fields = fieldsOf(selected);
    const order = tabOrder(fields);
    const focus = order.includes(focusId) ? focusId : null;
    return {
      open: true, role: 'dialog', modal: true, heading: t('apikeys.title'), label: t('apikeys.title'),
      overlay: { visible: true, dismissOnClick: false }, backgroundInert: true, scrollLocked: true,
      categories: CATEGORIES.map((id) => ({ id, label: t(`apikeys.category.${id}`), selected: id === selected })), selected,
      fields, closeButton: { label: t('apikeys.close'), accessibleName: t('apikeys.close') },
      focus, focusInside: focus != null,
      motion: ctx.env.reducedMotion ? 'none' : 'animated',
      layout: api.getLayoutMode?.() === 'stacked' ? 'stacked' : 'side-by-side',
      forcedColors: true, // forced-colors の指定は web/styles/app.css（.apikeys-*）にある
      liveMessage: liveMessage(),
    };
  };

  // ---- 開閉・分類・フォーカス ----
  const baseFocusCommand = api.focusCommand;
  function openDialog() {
    if (open) return { ok: true };
    open = true; selected = 'foundry'; focusId = 'apiKeys.category.foundry'; foundryInput = '';
    ctx.change((s) => { delete s.focusReturn; });
    say('keys.opened');
    if (relay) { void api.refreshFoundryKeyStatus(); void api.refreshAzureSpeechStatus?.(); }
    return { ok: true };
  }
  function closeDialog() {
    if (!open) return { ok: false, reason: 'closed' };
    open = false; selected = 'foundry'; focusId = null; foundryInput = ''; foundryDlg = false;
    api.setAzureSpeechKeyInput?.(''); api.setAzureSpeechEndpointInput?.(''); // 保存していない入力は破棄する（AC-484・AC-491）
    baseFocusCommand?.('apiKeys.open');
    ctx.change((s) => { s.focusReturn = 'apiKeys.open'; });
    say('keys.closed');
    return { ok: true };
  }
  ctx.registerCommand('apiKeys.open', openDialog);
  ctx.registerCommand('apiKeys.close', closeDialog);
  ctx.registerKey({ key: 'h', ctrl: true, alt: true, shift: true, command: 'apiKeys.open' });
  ctx.registerKey({ key: 'o', ctrl: true, alt: true, shift: true, command: 'apiKeys.close' });
  ctx.registerKey({ key: 'n', ctrl: true, alt: true, shift: true, command: 'foundry.deleteKey' });
  api.selectApiKeysCategory = (id) => {
    if (!open || !CATEGORIES.includes(id)) return { ok: false, reason: 'invalid' };
    if (id !== selected) { selected = id; if (!String(focusId).startsWith('apiKeys.category.') && focusId !== 'apiKeys.close') focusId = `apiKeys.category.${id}`; notify(); }
    return { ok: true };
  };
  api.focusApiKeysField = (id) => {
    if (!open) return false;
    const d = api.getApiKeysDialog();
    if (!tabOrder(d.fields).includes(id)) return false;
    focusId = id; notify(); return true;
  };
  api.apiKeysClick = (where) => {
    if (!open) return { ok: false, reason: 'closed' };
    if (where === 'overlay') return { ok: true, closed: false }; // 入力中のキーを誤って失わないよう、オーバーレイのクリックでは閉じない
    if (where === 'close' || where === 'closeButton') { closeDialog(); return { ok: true, closed: true }; }
    return { ok: false, reason: 'unknown' };
  };
  const baseGetFocus = api.getFocus;
  api.getFocus = () => {
    const b = baseGetFocus?.();
    // 閉じた後は「接続キー」の操作へ戻る（コマンド名で観察できる。文字列としては従来と同じ）
    return b === 'command:apiKeys.open' ? { command: 'apiKeys.open', toString: () => b } : b;
  };

  // ---- キーボード ----
  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    if (!open) return baseKey(ev);
    const k = String(ev?.key);
    const plain = !ev?.ctrlKey && !ev?.altKey;
    if (api.getDialog() && k === 'Escape') return baseKey(ev); // 確認（Foundry・Azure Speech のキーの削除）の Esc はキャンセル
    if (api.getDialog()) return null;
    if (k === 'Escape' && plain && !ev.shiftKey) { closeDialog(); return 'apiKeys.close'; }
    const d = api.getApiKeysDialog();
    const order = tabOrder(d.fields);
    if (k === 'Tab' && plain) {
      const i = order.indexOf(focusId);
      const n = order.length;
      focusId = order[i < 0 ? 0 : (i + (ev.shiftKey ? n - 1 : 1)) % n];
      notify(); return 'apiKeys.focus';
    }
    if (plain && !ev.shiftKey && String(focusId).startsWith('apiKeys.category.') && ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(k)) {
      const dir = k === 'ArrowDown' || k === 'ArrowRight' ? 1 : CATEGORIES.length - 1;
      const next = CATEGORIES[(CATEGORIES.indexOf(selected) + dir) % CATEGORIES.length];
      selected = next; focusId = `apiKeys.category.${next}`; notify(); return 'apiKeys.category';
    }
    if (plain && !ev.shiftKey && (k === 'Enter' || k === ' ' || k === 'Space')) {
      const run = (name, fn) => { fn(); return name; };
      const f = d.fields.find((x) => x.id === focusId);
      if (focusId === 'apiKeys.close') { closeDialog(); return 'apiKeys.close'; }
      if (String(focusId).startsWith('apiKeys.category.')) return run('apiKeys.category', () => api.selectApiKeysCategory(focusId.slice('apiKeys.category.'.length)));
      if (f && !f.disabled) {
        if (focusId === 'apiKeys.foundry.save') return run('foundry.saveKey', () => { void api.saveFoundryKey(); });
        if (focusId === 'apiKeys.foundry.delete') return run('foundry.deleteKey', () => ctx.api.commands['foundry.deleteKey']());
        if (focusId === 'apiKeys.azureSpeech.save') return run('azureSpeech.save', () => { void api.saveAzureSpeech(); });
        if (focusId === 'apiKeys.azureSpeech.delete') return run('azureSpeech.deleteKey', () => ctx.api.commands['azureSpeech.deleteKey']());
        if (focusId === 'apiKeys.azureSpeech.test') return run('azureSpeech.test', () => { void api.testAzureSpeech(); });
      }
    }
    // 開いている間、背景向けのキーは効かない。接続キー画面のコマンド（キー割り当てがあるもの）だけ通す
    const hit = matchKey(ctx.api.keymap, ev);
    return hit && ALLOWED_WHILE_OPEN.test(hit.command) ? baseKey(ev) : null;
  };

  // ---- 背景の操作を止める（開いている間。記録・音声認識・図の状態は変えない） ----
  const guard = (name, fn) => (...a) => (open && !ALLOWED_WHILE_OPEN.test(name) ? { ok: false, reason: 'modal' } : fn(...a));
  for (const [name, fn] of Object.entries(ctx.api.commands)) ctx.api.commands[name] = guard(name, fn);
  ctx.registerCommand = (name, fn) => { ctx.api.commands[name] = guard(name, fn); };
  for (const name of ['setDraft', 'submitDraft']) {
    const base = api[name];
    if (typeof base === 'function') api[name] = (...a) => (open ? { ok: false, reason: 'modal' } : base(...a));
  }
}
