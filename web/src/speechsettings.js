// FR-082 Azure Speech の設定（エンドポイント・キーの設定・変更・削除と接続テスト）／NFR-SEC-005 キーの非露出
// （契約: tests/system/CONTRACT-AZURE-SPEECH.md「1. アプリ」）。DOM に依存しない。
// - 要求は options.relay（同一オリジンの中継サーバー /api/speech/...）だけを通す。省略時は「中継サーバーなし」扱い。
// - キーは書き込み専用。入力中の一時的な値はメモリの 1 か所（keyInput）だけに持ち、保存の要求を送った直後に
//   成功・失敗によらず空にする（AC-457）。画面（fields）には伏せ字だけを出し、ブラウザ内の保存・ログ・メッセージには書かない。
// - 中継サーバーの応答からは「endpointHost」「keyConfigured」と結果の分類だけを取り出す（キーらしい値が混ざっても使わない: AC-452）。
// - 認識の方式（ブラウザ標準／Azure Speech）の選択の土台（FR-081 AC-441 の方式の保存・選べる条件・キーの保存での切替と削除での戻り）。
//   方式の切替に伴う音声認識の開始・停止・同意は FR-081 の項目が 'speech:method' を購読して扱う。

const TIMEOUT_MS = 10_000; // PARAM-074（接続テスト・設定の操作の待機上限）
export const METHOD_KEY = 'grp.speech.method';
const METHODS = ['browser', 'azure'];
const TEST_RESULTS = ['success', 'unconfigured', 'auth', 'network', 'timeout'];
const ICONS = { set: '●', unset: '○', unavailable: '▲', ok: '✔', fail: '✖', checking: '…' };
export const AZURE_FIELD_IDS = ['speech.method', 'azureSpeech.endpoint', 'azureSpeech.key', 'azureSpeech.status', 'azureSpeech.save', 'azureSpeech.delete', 'azureSpeech.test'];
const HOST_RE = /^[A-Za-z0-9.:[\]-]{1,253}$/;

export function speechSettingsModule(ctx) {
  const { api, state } = ctx;
  const t = ctx.t;

  ctx.i18n.addStrings({
    ja: {
      'azs.label.method': '認識方式', 'azs.label.endpoint': '接続先', 'azs.label.key': 'キー', 'azs.label.status': '設定状態',
      'azs.label.save': '保存', 'azs.label.delete': '削除', 'azs.label.test': '接続テスト',
      'azs.method.browser': 'ブラウザ標準', 'azs.method.azure': 'Azure Speech', 'azs.method.reason': 'Azure Speech のエンドポイントとキーを保存すると選べます',
      'azs.a11y': 'Azure Speech の', 'azs.section': 'Azure Speech（音声認識）',
      'azs.endpoint.placeholder': 'https://<リソース名>.cognitiveservices.azure.com または リージョン名',
      'azs.key.placeholder': '新しいキーを入力（保存後は表示されません）',
      'azs.key.set': 'キー: 設定済み', 'azs.key.unset': 'キー: 未設定', 'azs.host.unset': '接続先: 未設定', 'azs.host': '接続先: ',
      'azs.unavailable': '中継サーバーが応答しないため、Azure Speech の設定を変更できません。中継サーバー（start.ps1 / start.sh）を起動してください',
      'azs.checking': '中継サーバーに確認しています',
      'azs.saved': 'Azure Speech の設定を保存しました', 'azs.switched': 'キーを保存しました。音声認識の方式を Azure Speech に切り替えました',
      'azs.invalid': '保存できませんでした。エンドポイントは https の Azure Speech のドメイン（*.cognitiveservices.azure.com など）か、リージョン名（英小文字と数字）にしてください',
      'azs.failed': 'Azure Speech の設定を保存できませんでした。もう一度お試しください', 'azs.empty': 'エンドポイントかキーを入力してください',
      'azs.delete.text': 'Azure Speech のキーを削除しますか？ 削除すると、音声認識の方式はブラウザ標準に戻ります。エンドポイントは残ります',
      'azs.delete.confirm': 'キーを削除', 'azs.deleted': 'Azure Speech のキーを削除しました。音声認識の方式をブラウザ標準に戻しました',
      'azs.deletedOnly': 'Azure Speech のキーを削除しました', 'azs.deleteFailed': 'キーを削除できませんでした。もう一度お試しください',
      'azs.test.ok': '接続テスト: 成功', 'azs.test.unconfigured': '接続テスト: 失敗（未設定。エンドポイントとキーを保存してください）',
      'azs.test.auth': '接続テスト: 失敗（認証。キーを確認してください）', 'azs.test.network': '接続テスト: 失敗（接続。エンドポイントとネットワークを確認してください）',
      'azs.test.timeout': '接続テスト: 失敗（タイムアウト）',
      'azs.methodChanged': '音声認識の方式: ', 'azs.methodUnconfigured': 'Azure Speech は未設定のため選べません',
    },
    en: {
      'azs.label.method': 'Method', 'azs.label.endpoint': 'Endpoint', 'azs.label.key': 'Key', 'azs.label.status': 'Status',
      'azs.label.save': 'Save', 'azs.label.delete': 'Delete', 'azs.label.test': 'Test',
      'azs.method.browser': 'Browser', 'azs.method.azure': 'Azure Speech', 'azs.method.reason': 'Save the Azure Speech endpoint and key to select it',
      'azs.a11y': 'Azure Speech', 'azs.section': 'Azure Speech (speech recognition)',
      'azs.endpoint.placeholder': 'https://<resource-name>.cognitiveservices.azure.com or a region name',
      'azs.key.placeholder': 'Enter a new key (it is not shown after saving)',
      'azs.key.set': 'Key: configured', 'azs.key.unset': 'Key: not configured', 'azs.host.unset': 'Endpoint: not configured', 'azs.host': 'Endpoint: ',
      'azs.unavailable': 'The relay server is not responding, so the Azure Speech settings cannot be changed. Start the relay server (start.ps1 / start.sh)',
      'azs.checking': 'Checking with the relay server',
      'azs.saved': 'The Azure Speech settings were saved', 'azs.switched': 'The key was saved. Speech recognition now uses Azure Speech',
      'azs.invalid': 'Not saved. Use an https Azure Speech domain (such as *.cognitiveservices.azure.com) or a region name (lowercase letters and digits)',
      'azs.failed': 'The Azure Speech settings could not be saved. Try again', 'azs.empty': 'Enter an endpoint or a key',
      'azs.delete.text': 'Delete the Azure Speech key? Speech recognition returns to the browser method. The endpoint is kept',
      'azs.delete.confirm': 'Delete key', 'azs.deleted': 'The Azure Speech key was deleted. Speech recognition returned to the browser method',
      'azs.deletedOnly': 'The Azure Speech key was deleted', 'azs.deleteFailed': 'The key could not be deleted. Try again',
      'azs.test.ok': 'Connection test: succeeded', 'azs.test.unconfigured': 'Connection test: failed (not configured; save an endpoint and key)',
      'azs.test.auth': 'Connection test: failed (authentication; check the key)', 'azs.test.network': 'Connection test: failed (connection; check the endpoint and network)',
      'azs.test.timeout': 'Connection test: failed (timeout)',
      'azs.methodChanged': 'Speech recognition method: ', 'azs.methodUnconfigured': 'Azure Speech is not configured, so it cannot be selected',
    },
  });

  const relay = typeof ctx.options.relay === 'function' ? ctx.options.relay : null;
  const sched = ctx.options.scheduler ?? { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  const notify = () => ctx.emit('change', api);

  // ---- 状態（キーの値は持たない。keyInput は入力中の一時的な値だけ） ----
  let checked = false; // 中継サーバーに一度でも問い合わせたか
  let status = { reachable: false, endpointHost: null, keyConfigured: false };
  let endpointInput = '';
  let keyInput = '';
  let busy = false;
  let testResult = null; // null | 'success' | 'unconfigured' | 'auth' | 'network' | 'timeout'
  let dialog = null; // null | { kind: 'azure-key-delete' }
  let focusId = null;
  let msg = null; // 直近のメッセージのキー（言語の切替で訳し直す）

  const configured = () => status.reachable && !!status.endpointHost && status.keyConfigured;
  const say = (key) => { msg = key; ctx.change((s) => { s.message = { key, text: t(key) }; }); };
  ctx.on('lang', () => { if (msg && state.message?.key === msg) ctx.change((s) => { s.message.text = t(msg); }); });

  // ---- 方式（FR-081 AC-441 の土台）。ブラウザ内の保存は options.storage の grp.speech.method だけ ----
  let method = (() => { try { const v = ctx.storage.getItem(METHOD_KEY); return METHODS.includes(v) ? v : 'browser'; } catch { return 'browser'; } })();
  const writeMethod = () => { try { ctx.storage.setItem(METHOD_KEY, method); } catch { /* 保存できなくても動作は続ける */ } };
  const applyMethod = (next, reason) => {
    if (next === method) return;
    const prev = method;
    method = next; writeMethod();
    ctx.emit('speech:method', { method, prev, reason });
  };
  api.getSpeechMethod = () => method;
  api.setSpeechMethod = (id) => {
    if (!METHODS.includes(id)) return { ok: false, reason: 'unknown' };
    if (id === 'azure' && !configured()) { say('azs.methodUnconfigured'); return { ok: false, reason: 'unconfigured' }; }
    if (id !== method) {
      // 切替の旨を先に出す。方式の切替を購読する音声認識（speech.js）が、同意待ちなどの表示で上書きできるようにする（FR-081 AC-441）
      msg = 'azs.methodChanged';
      ctx.change((s) => { s.message = { key: 'azs.methodChanged', text: `${t('azs.methodChanged')}${t(`azs.method.${id}`)}` }; });
      applyMethod(id, 'select');
    }
    return { ok: true };
  };
  ctx.on('lang', () => { if (state.message?.key === 'azs.methodChanged') ctx.change((s) => { s.message.text = `${t('azs.methodChanged')}${t(`azs.method.${method}`)}`; }); });

  // ---- 中継サーバーへの要求（タイムアウト・例外は分類にそろえる） ----
  async function send(method_, path, body) {
    if (!relay) return { status: 0, error: 'unavailable', body: null };
    let timer = null;
    const timeout = new Promise((resolve) => { timer = sched.setTimeout(() => resolve({ status: 0, error: 'timeout', body: null }), TIMEOUT_MS); });
    try {
      const res = await Promise.race([(async () => relay(body === undefined ? { method: method_, path } : { method: method_, path, body }))(), timeout]);
      return res && typeof res === 'object' && 'status' in res ? res : { status: 0, error: 'network', body: null };
    } catch { return { status: 0, error: 'unavailable', body: null }; } finally { if (timer != null) sched.clearTimeout(timer); }
  }
  // 応答から状態だけを取り出す（ほかの項目は捨てる: AC-452）
  const pickStatus = (b) => ({
    reachable: true,
    endpointHost: typeof b?.endpointHost === 'string' && HOST_RE.test(b.endpointHost) ? b.endpointHost : null,
    keyConfigured: b?.keyConfigured === true,
  });
  const ok2xx = (r) => r.status >= 200 && r.status < 300 && r.body && typeof r.body === 'object';
  const adopt = (next) => {
    const prevHost = status.endpointHost;
    status = next;
    // キーが消えた（ほかの画面・中継サーバー側の削除を含む）ときはブラウザ標準に戻す
    if (method === 'azure' && status.reachable && !configured()) applyMethod('browser', 'unconfigured');
    // 未取得→取得も「ホストの変更」とする（取得前に示していないホストへの同意を残さない: FR-081 AC-441 AC-442）
    else if (status.endpointHost && prevHost !== status.endpointHost) ctx.emit('speech:endpointHost', { host: status.endpointHost, prev: prevHost });
  };
  // 中継サーバーが応答しない: 送信先のホストは未取得に戻る。取得済みだったなら、そのホストへの同意を残さない
  const unreachable = () => {
    const prevHost = status.endpointHost;
    status = { reachable: false, endpointHost: null, keyConfigured: false };
    if (prevHost) ctx.emit('speech:endpointHost', { host: null, prev: prevHost });
  };

  api.refreshAzureSpeechStatus = async () => {
    const r = await send('GET', '/api/speech/status');
    checked = true;
    if (ok2xx(r)) adopt(pickStatus(r.body));
    else unreachable();
    notify();
    return { ...status };
  };
  api.getAzureSpeechSettings = () => ({ ...status });

  // ---- 入力（入力中の一時的な値。画面には伏せ字だけを出す） ----
  api.setAzureSpeechEndpointInput = (text) => { endpointInput = String(text ?? ''); notify(); };
  api.setAzureSpeechKeyInput = (text) => { keyInput = String(text ?? ''); notify(); };

  // ---- 保存（AC-448・AC-457） ----
  api.saveAzureSpeech = async () => {
    const body = {};
    const ep = endpointInput.trim();
    if (ep) body.endpoint = ep;
    const key = keyInput.trim();
    if (key) body.key = key;
    keyInput = ''; // 送る前に入力欄を空にする（成功・失敗によらない）
    notify();
    if (!relay || (checked && !status.reachable)) {
      const r = relay ? await api.refreshAzureSpeechStatus() : null;
      if (!r || !r.reachable) { say('azs.unavailable'); return { ok: false, result: 'unavailable' }; }
    }
    if (!('endpoint' in body) && !('key' in body)) { say('azs.empty'); return { ok: false, result: 'empty' }; }
    busy = true; notify();
    const r = await send('POST', '/api/speech/settings', body);
    busy = false;
    if (ok2xx(r) && r.body.ok === true) {
      endpointInput = '';
      adopt(pickStatus(r.body));
      if ('key' in body && configured()) { applyMethod('azure', 'key-saved'); say('azs.switched'); } else say('azs.saved'); // Q-025 A
      return { ok: true, result: 'saved' };
    }
    if (r.error === 'unavailable') { unreachable(); say('azs.unavailable'); return { ok: false, result: 'unavailable' }; }
    if (r.status === 400 || r.body?.result === 'invalid') { say('azs.invalid'); return { ok: false, result: 'invalid' }; }
    say('azs.failed');
    return { ok: false, result: r.error === 'timeout' ? 'timeout' : 'error' };
  };

  // ---- 削除（確認つき） ----
  const baseGetDialog = api.getDialog;
  api.getDialog = () => (dialog ? {
    kind: 'azure-key-delete', text: t('azs.delete.text'),
    buttons: [{ id: 'confirm', label: t('azs.delete.confirm') }, { id: 'cancel', label: t('dialog.cancel') }],
    defaultFocus: 'cancel', keyboard: true,
  } : (baseGetDialog ? baseGetDialog() : null));
  const baseDialogAction = api.dialogAction;
  api.dialogAction = async (action) => {
    if (!dialog) return baseDialogAction ? baseDialogAction(action) : { ok: false, reason: 'no_dialog' };
    dialog = null;
    if (action !== 'confirm') { notify(); return { ok: false, reason: 'cancelled' }; }
    const r = await send('DELETE', '/api/speech/key');
    if (ok2xx(r) && r.body.ok === true) {
      const wasAzure = method === 'azure';
      adopt(pickStatus(r.body));
      applyMethod('browser', 'key-deleted');
      say(wasAzure ? 'azs.deleted' : 'azs.deletedOnly');
      return { ok: true };
    }
    if (r.error === 'unavailable') { unreachable(); say('azs.unavailable'); } else say('azs.deleteFailed');
    return { ok: false, reason: 'failed' };
  };
  ctx.registerCommand('azureSpeech.deleteKey', () => {
    if (!dialog && !api.getDialog()) { dialog = { kind: 'azure-key-delete' }; notify(); }
    return { ok: true, pending: true };
  });

  // ---- 接続テスト（AC-450）: 方式・同意・図は変えない ----
  api.testAzureSpeech = async () => {
    testResult = null; notify();
    const r = await send('POST', '/api/speech/test', {});
    let result;
    if (r.error === 'timeout') result = 'timeout';
    else if (r.error === 'unavailable') { result = 'network'; status = { ...status, reachable: false }; } else if (r.body && TEST_RESULTS.includes(r.body.result)) result = r.body.result;
    else if (r.status === 401 || r.status === 403) result = 'auth';
    else result = 'network';
    testResult = result;
    say(result === 'success' ? 'azs.test.ok' : `azs.test.${result}`);
    return { ok: result === 'success', result };
  };
  ctx.registerCommand('azureSpeech.save', () => { void api.saveAzureSpeech(); });
  ctx.registerCommand('azureSpeech.test', () => { void api.testAzureSpeech(); });
  // キー割り当て（NFR-A11Y-001。名称は i18n.js の基本辞書の cmd.azureSpeech.*）: Ctrl+Alt+Shift+V 保存・T 接続テスト・Z キーの削除（確認つき）
  ctx.registerKey({ key: 'v', ctrl: true, alt: true, shift: true, command: 'azureSpeech.save' });
  ctx.registerKey({ key: 't', ctrl: true, alt: true, shift: true, command: 'azureSpeech.test' });
  ctx.registerKey({ key: 'z', ctrl: true, alt: true, shift: true, command: 'azureSpeech.deleteKey' });

  // ---- 設定画面の項目 ----
  const a11y = (label) => `${t('azs.a11y')} ${label}`;
  const unavailable = () => checked && !status.reachable;
  const statusOf = () => {
    if (!checked) return { id: 'unavailable', text: t('azs.checking'), icon: ICONS.checking };
    if (!status.reachable) return { id: 'unavailable', text: t('azs.unavailable'), icon: ICONS.unavailable };
    const host = status.endpointHost ? `${t('azs.host')}${status.endpointHost}` : t('azs.host.unset');
    return { id: configured() ? 'set' : 'unset', text: `${host} / ${t(status.keyConfigured ? 'azs.key.set' : 'azs.key.unset')}`, icon: configured() ? ICONS.set : ICONS.unset };
  };
  const fields = () => {
    const off = !checked || unavailable() || busy;
    const reason = unavailable() ? t('azs.unavailable') : null;
    const lbl = (k) => t(`azs.label.${k}`);
    const base = (id, k, extra) => ({ id, label: lbl(k), accessibleName: a11y(lbl(k)), focusable: true, disabled: off, reason, ...extra });
    const tr = testResult;
    return [
      { id: 'speech.method', label: lbl('method'), accessibleName: a11y(lbl('method')), role: 'radiogroup', focusable: true, value: method,
        options: [
          { id: 'browser', label: t('azs.method.browser'), enabled: true, reason: null },
          { id: 'azure', label: t('azs.method.azure'), enabled: configured(), reason: configured() ? null : t('azs.method.reason') },
        ] },
      base('azureSpeech.endpoint', 'endpoint', { input: { type: 'text', value: endpointInput, autocomplete: 'off', placeholder: t('azs.endpoint.placeholder') } }),
      base('azureSpeech.key', 'key', {
        input: { type: 'password', value: '•'.repeat(Math.min(keyInput.length, 64)), autocomplete: 'new-password', writeOnly: true, placeholder: t('azs.key.placeholder') },
        status: { id: status.keyConfigured ? 'set' : 'unset', text: t(status.keyConfigured ? 'azs.key.set' : 'azs.key.unset'), icon: status.keyConfigured ? ICONS.set : ICONS.unset },
      }),
      { id: 'azureSpeech.status', label: lbl('status'), accessibleName: a11y(lbl('status')), focusable: false, role: 'status', status: statusOf() },
      base('azureSpeech.save', 'save', { role: 'button' }),
      base('azureSpeech.delete', 'delete', { role: 'button', disabled: off || !status.keyConfigured }),
      base('azureSpeech.test', 'test', { role: 'button',
        status: tr ? { id: tr === 'success' ? 'ok' : tr, text: t(tr === 'success' ? 'azs.test.ok' : `azs.test.${tr}`), icon: tr === 'success' ? ICONS.ok : ICONS.fail } : { id: 'idle', text: '', icon: '' } }),
    ];
  };
  api.getAzureSpeechFields = () => fields(); // FR-084: 接続キー画面の Azure Speech の分類が、同じ状態・同じ項目を使う（保管先は 1 つ）
  const baseDialog = api.getSettingsDialog;
  api.getSettingsDialog = () => {
    const d = baseDialog();
    return d ? { ...d, fields: [...d.fields, ...fields()] } : null;
  };
  const baseView = api.getSettingsView;
  api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, ...AZURE_FIELD_IDS.map((id) => ({ id, visible: true }))] }; };
  const baseFocus = api.focusSettingsField;
  api.focusSettingsField = (id) => {
    if (AZURE_FIELD_IDS.includes(id)) { if (!baseDialog()) return false; focusId = id; return true; }
    focusId = null; return baseFocus ? baseFocus(id) : false;
  };
  ctx.on('change', () => { if (!baseDialog()) focusId = null; });

  // キーボード: 設定画面の保存・削除・接続テストは Enter / Space。確認の Esc はキャンセル
  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    const k = String(ev?.key);
    const plain = !ev?.ctrlKey && !ev?.altKey && !ev?.shiftKey;
    if (dialog && plain && k === 'Escape') { void api.dialogAction('cancel'); return 'dialog.cancel'; }
    if (!dialog && focusId && baseDialog() && plain && (k === 'Enter' || k === ' ' || k === 'Space')) {
      const f = fields().find((x) => x.id === focusId);
      if (f && !f.disabled) {
        if (focusId === 'azureSpeech.save') { void api.saveAzureSpeech(); return 'azureSpeech.save'; }
        if (focusId === 'azureSpeech.delete') { ctx.api.commands['azureSpeech.deleteKey'](); return 'azureSpeech.deleteKey'; }
        if (focusId === 'azureSpeech.test') { void api.testAzureSpeech(); return 'azureSpeech.test'; }
      }
    }
    return baseKey(ev);
  };

  // 設定画面を開いたら、中継サーバーから状態（設定済み／未設定とホスト名）を読み直す
  const baseOpen = ctx.api.commands['settings.open'];
  ctx.registerCommand('settings.open', () => { baseOpen(); if (relay) void api.refreshAzureSpeechStatus(); else { checked = true; notify(); } });
  if (!relay) checked = true;
}
