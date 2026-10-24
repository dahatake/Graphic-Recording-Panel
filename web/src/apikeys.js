// FR-084 接続キー画面（最上部の「接続キー」と中央のモーダル）／FR-085 Microsoft Foundry のキー／NFR-SEC-006 キーの非露出
// （契約: tests/system/CONTRACT-API-KEYS.md）。DOM に依存しない（描画は apikeys-ui.js）。
// - 分類は Microsoft Foundry・GitHub Copilot・Azure Speech の 3 つ。GitHub Copilot の分類の状態・操作は copilotkeys.js（FR-088）。
// - Azure Speech の分類は speechsettings.js（FR-082）の状態・操作をそのまま使う（保管先は 1 つ。別の保管を作らない）。
// - Foundry のキーは書き込み専用。入力中の一時的な値はメモリの 1 か所（foundryInput）だけに持ち、保存の要求を送る前に空にする。
//   画面（fields）には伏せ字だけを出し、ブラウザ内の保存・ログ・メッセージ・セッションファイルには書かない。
//   中継サーバーの応答からは「keyConfigured」「keySource」だけを取り出す（キーらしい値が混ざっても使わない）。
// - モーダルが開いている間は、背景のコマンド・入力を受け付けない（{ ok:false, reason:'modal' }）。記録・音声認識・図は変えない。

import { matchKey } from './keymap.js';

const TIMEOUT_MS = 10_000; // PARAM-074（中継サーバーの操作の待機上限）
export const MAX_KEY_LENGTH = 512; // PARAM-094
export const MAX_ENDPOINT_LENGTH = 2048; // PARAM-095
export const MAX_DEPLOYMENT_LENGTH = 64; // PARAM-096
const SOURCES = ['ui', 'env', 'file'];
const ICONS = { set: '●', unset: '○', unavailable: '▲', checking: '…' };
const CATEGORIES = ['foundry', 'copilot', 'azureSpeech']; // FR-084 AC-483: Foundry・GitHub Copilot・Azure Speech の順
const ALLOWED_WHILE_OPEN = /^(apiKeys|foundry|azureSpeech|copilot)\./;
const ALERT_RE = /(invalid|failed|unavailable|envManaged|deleteFailed|empty|blocked|expired|denied|copyFailed|test\.(unconfigured|auth|network|timeout))/;
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
      'keys.label.endpoint': 'エンドポイント', 'keys.label.deployment': 'デプロイ名', 'keys.label.authMethod': '認証方式',
      'keys.label.configSave': '設定保存', 'keys.label.configDelete': '設定削除',
      'keys.auth.apiKey': 'API キー', 'keys.auth.entra': 'Microsoft Entra ID',
      'keys.endpoint.placeholder': 'https://（保存後はホスト名だけ表示されます）', 'keys.deployment.placeholder': 'デプロイ名',
      'keys.cfg.set': '設定済み', 'keys.cfg.unset': '未設定', 'keys.cfg.locked': '環境変数／設定ファイルで設定されているため画面からは変更できない',
      'keys.cfg.entraNoKey': '認証方式が Microsoft Entra ID のときは API キーを入力できません',
      'keys.cfg.saved': 'Microsoft Foundry の接続設定を保存しました', 'keys.cfg.deleted': '画面で保存した接続設定を削除しました',
      'keys.cfg.invalid': '保存できませんでした。エンドポイントは https の URL、デプロイ名は空・制御文字なし・64 文字以内、認証方式は API キーか Microsoft Entra ID にしてください',
      'keys.cfg.failed': '接続設定を保存できませんでした。もう一度お試しください', 'keys.cfg.deleteFailed': '接続設定を削除できませんでした。もう一度お試しください',
      'keys.cfg.envManaged': '環境変数／設定ファイルで設定されている項目は、画面からは変更できません',
      'keys.cfg.delete.text': '画面で保存したエンドポイント・デプロイ名・認証方式を削除しますか？ 削除すると、環境変数・設定ファイルに値がなければ LLM 連携は未設定になります', 'keys.cfg.delete.confirm': '設定を削除',
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
      'keys.label.endpoint': 'Endpoint', 'keys.label.deployment': 'Deployment', 'keys.label.authMethod': 'Auth method',
      'keys.label.configSave': 'Save setup', 'keys.label.configDelete': 'Clear setup',
      'keys.auth.apiKey': 'API key', 'keys.auth.entra': 'Microsoft Entra ID',
      'keys.endpoint.placeholder': 'https:// (only the host name is shown after saving)', 'keys.deployment.placeholder': 'Deployment name',
      'keys.cfg.set': 'configured', 'keys.cfg.unset': 'not configured', 'keys.cfg.locked': 'Set by an environment variable or config file, so it cannot be changed here',
      'keys.cfg.entraNoKey': 'An API key cannot be entered when the auth method is Microsoft Entra ID',
      'keys.cfg.saved': 'The Microsoft Foundry connection settings were saved', 'keys.cfg.deleted': 'The connection settings saved in this screen were deleted',
      'keys.cfg.invalid': 'Not saved. The endpoint must be an https URL, the deployment name must be non-empty, free of control characters and at most 64 characters, and the auth method must be API key or Microsoft Entra ID',
      'keys.cfg.failed': 'The connection settings could not be saved. Try again', 'keys.cfg.deleteFailed': 'The connection settings could not be deleted. Try again',
      'keys.cfg.envManaged': 'Items set by an environment variable or config file cannot be changed here',
      'keys.cfg.delete.text': 'Delete the endpoint, deployment name and auth method saved in this screen? Without an environment variable or config file value, LLM integration will be unconfigured', 'keys.cfg.delete.confirm': 'Delete setup',
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
  let foundryDlg = null; // 確認の種類: 'key'（キーの削除）| 'config'（接続設定の削除）| null
  // 接続設定（FR-086）: 中継サーバーの状態（秘密を含まない）と、入力中の一時的な値
  const EMPTY_CFG = () => ({ configured: { endpoint: false, deployment: false, authMethod: false, key: false }, endpointHost: '', authMethod: 'apiKey', sources: { endpoint: null, deployment: null, authMethod: null, key: null } });
  let fCfg = EMPTY_CFG();
  let endpointInput = '';
  let deploymentInput = '';
  let authInput = null; // null のときは中継サーバーの値に従う
  const clearCfgInputs = () => { endpointInput = ''; deploymentInput = ''; authInput = null; };
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
  // 応答から接続設定の状態だけを取り出す（ホスト名はホスト名の文字だけ通し、URL のパス・クエリは持たない）
  const pickCfg = (b) => {
    const c = b?.configured && typeof b.configured === 'object' ? b.configured : {};
    const s = b?.sources && typeof b.sources === 'object' ? b.sources : {};
    const host = typeof b?.endpointHost === 'string' && /^[A-Za-z0-9.-]{1,253}$/.test(b.endpointHost) ? b.endpointHost : '';
    const src = (v) => (SOURCES.includes(v) ? v : null);
    return {
      configured: { endpoint: c.endpoint === true, deployment: c.deployment === true, authMethod: c.authMethod === true, key: c.key === true },
      endpointHost: c.endpoint === true ? host : '', authMethod: b?.authMethod === 'entra' ? 'entra' : 'apiKey',
      sources: { endpoint: c.endpoint === true ? src(s.endpoint) : null, deployment: c.deployment === true ? src(s.deployment) : null, authMethod: c.authMethod === true ? src(s.authMethod) : null, key: src(s.key) },
    };
  };
  const apply = (b) => { fStatus = pick(b); if (b?.sources && typeof b.sources === 'object') fCfg = pickCfg(b); };

  api.refreshFoundryKeyStatus = async () => {
    const r = await send('GET', '/api/llm/status');
    fChecked = true;
    fStatus = ok2xx(r) ? pick(r.body) : { reachable: false, keyConfigured: false, source: null };
    fCfg = ok2xx(r) ? pickCfg(r.body) : EMPTY_CFG();
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
      apply(r.body); say('keys.foundry.saved'); return { ok: true, result: 'saved' };
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
    if (!foundryDlg && !api.getDialog()) { foundryDlg = 'key'; notify(); }
    return { ok: true, pending: true };
  });
  // ---- 接続設定（FR-086）----
  const CFG_NAMES = ['endpoint', 'deployment', 'authMethod'];
  const lockedSrc = (n) => fCfg.sources[n] === 'env' || fCfg.sources[n] === 'file';
  const effAuth = () => authInput ?? fCfg.authMethod;
  const endpointOk = (v) => {
    if (!v || v.length > MAX_ENDPOINT_LENGTH || hasControl(v)) return false;
    try { const u = new URL(v); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch { return false; }
  };
  const deploymentOk = (v) => !!v && v.length <= MAX_DEPLOYMENT_LENGTH && !hasControl(v);
  api.setFoundryEndpointInput = (text) => { endpointInput = String(text ?? ''); notify(); };
  api.setFoundryDeploymentInput = (text) => { deploymentInput = String(text ?? ''); notify(); };
  api.setFoundryAuthMethod = (v) => { authInput = String(v ?? ''); notify(); };
  api.saveFoundryConfig = async () => {
    const vals = { endpoint: endpointInput.trim(), deployment: deploymentInput.trim(), authMethod: effAuth() };
    const provided = { endpoint: endpointInput !== '', deployment: deploymentInput !== '', authMethod: authInput !== null };
    if (CFG_NAMES.some((n) => lockedSrc(n) && provided[n])) { clearCfgInputs(); notify(); say('keys.cfg.envManaged'); return { ok: false, result: 'env_managed' }; }
    const names = CFG_NAMES.filter((n) => !lockedSrc(n));
    const bad = names.length === 0 || names.some((n) => !(n === 'endpoint' ? endpointOk(vals.endpoint) : n === 'deployment' ? deploymentOk(vals.deployment) : (vals.authMethod === 'apiKey' || vals.authMethod === 'entra')));
    if (bad) { say('keys.cfg.invalid'); return { ok: false, result: 'invalid' }; }
    if (!relay || (fChecked && !fStatus.reachable)) {
      const r = relay ? await api.refreshFoundryKeyStatus() : null;
      if (!r || !r.reachable) { say('keys.unavailable'); return { ok: false, result: 'unavailable' }; }
    }
    const body = {}; for (const n of names) body[n] = vals[n];
    clearCfgInputs(); busy = true; notify(); // 送る前に入力欄を空にする（全体の URL を画面に残さない）
    const r = await send('POST', '/api/llm/config', body);
    busy = false;
    if (ok2xx(r) && r.body.ok === true && r.body.result === 'saved') { apply(r.body); say('keys.cfg.saved'); return { ok: true, result: 'saved' }; }
    if (r.error === 'unavailable') { fStatus = { reachable: false, keyConfigured: false, source: null }; say('keys.unavailable'); return { ok: false, result: 'unavailable' }; }
    if (r.body?.result === 'env_managed') { apply(r.body); say('keys.cfg.envManaged'); return { ok: false, result: 'env_managed' }; }
    if (r.status === 400 || r.body?.result === 'invalid') { say('keys.cfg.invalid'); return { ok: false, result: 'invalid' }; }
    say('keys.cfg.failed');
    return { ok: false, result: 'failed' };
  };
  const cfgDeletable = () => fStatus.reachable && CFG_NAMES.some((n) => fCfg.sources[n] === 'ui');
  ctx.registerCommand('foundry.deleteConfig', () => {
    if (!fStatus.reachable) { say('keys.unavailable'); return { ok: false, reason: 'unavailable' }; }
    if (!cfgDeletable()) {
      if (CFG_NAMES.some(lockedSrc)) { say('keys.cfg.envManaged'); return { ok: false, reason: 'env_managed' }; }
      return { ok: false, reason: 'unset' };
    }
    if (!foundryDlg && !api.getDialog()) { foundryDlg = 'config'; notify(); }
    return { ok: true, pending: true };
  });
  const baseGetDialog = api.getDialog;
  api.getDialog = () => (foundryDlg ? {
    kind: foundryDlg === 'config' ? 'foundry-config-delete' : 'foundry-key-delete', text: t(foundryDlg === 'config' ? 'keys.cfg.delete.text' : 'keys.foundry.delete.text'),
    buttons: [{ id: 'confirm', label: t(foundryDlg === 'config' ? 'keys.cfg.delete.confirm' : 'keys.foundry.delete.confirm') }, { id: 'cancel', label: t('dialog.cancel') }],
    defaultFocus: 'cancel', keyboard: true,
  } : (baseGetDialog ? baseGetDialog() : null));
  const baseDialogAction = api.dialogAction;
  api.dialogAction = async (action) => {
    if (!foundryDlg) return baseDialogAction ? baseDialogAction(action) : { ok: false, reason: 'no_dialog' };
    const which = foundryDlg;
    foundryDlg = null;
    if (action !== 'confirm') { notify(); return { ok: false, reason: 'cancelled' }; }
    const isCfg = which === 'config';
    const r = await send('DELETE', isCfg ? '/api/llm/config' : '/api/llm/key');
    const pre = isCfg ? 'keys.cfg' : 'keys.foundry';
    if (ok2xx(r) && r.body.ok === true) { apply(r.body); say(`${pre}.deleted`); return { ok: true }; }
    if (r.error === 'unavailable') { fStatus = { reachable: false, keyConfigured: false, source: null }; say('keys.unavailable'); return { ok: false, reason: 'unavailable' }; }
    if (ok2xx(r) && r.body.result === 'env_managed') { apply(r.body); say(`${pre}.envManaged`); return { ok: false, reason: 'env_managed' }; }
    say(`${pre}.deleteFailed`);
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
  const cfgStatus = (n) => {
    const src = fCfg.sources[n];
    const set = fCfg.configured[n] === true;
    if (!set) return { id: 'unset', source: null, text: t('keys.cfg.unset'), icon: ICONS.unset };
    const where = t(`keys.src.${src ?? 'ui'}`);
    let what = t('keys.cfg.set');
    if (n === 'endpoint' && fCfg.endpointHost) what = fCfg.endpointHost; // ホスト名だけ（全体の URL・パス・クエリは再表示しない）
    if (n === 'authMethod') what = t(`keys.auth.${fCfg.authMethod}`);
    const locked = src === 'env' || src === 'file' ? ` ／ ${t('keys.cfg.locked')}` : '';
    return { id: 'set', source: src, text: `${what}（${where}）${locked}`, icon: ICONS.set };
  };
  const foundryFields = () => {
    const off = !fChecked || down() || busy;
    const reason = down() ? t('keys.unavailable') : null;
    const base = (id, k, extra) => ({ id: `apiKeys.foundry.${id}`, label: lbl(k), accessibleName: a11y(lbl(k)), disabled: off, focusable: !off, reason, ...extra });
    const delOff = off || !deletable();
    const entra = effAuth() === 'entra';
    const keyOff = off || entra;
    const cfgIn = (n, input) => {
      const lk = lockedSrc(n); const dis = off || lk;
      return base(n, n, { role: 'textbox', input: { autocomplete: 'off', ...input }, disabled: dis, focusable: !dis, reason: reason ?? (lk ? t('keys.cfg.locked') : null), status: down() || !fChecked ? { id: 'unset', source: null, text: reason ?? t('keys.checking'), icon: ICONS.unavailable } : cfgStatus(n) });
    };
    const cfgDelOff = off || !cfgDeletable();
    return [
      cfgIn('endpoint', { type: 'url', value: endpointInput, placeholder: t('keys.endpoint.placeholder') }),
      cfgIn('deployment', { type: 'text', value: deploymentInput, placeholder: t('keys.deployment.placeholder') }),
      cfgIn('authMethod', { type: 'select', value: effAuth() === 'entra' ? 'entra' : 'apiKey', options: ['apiKey', 'entra'].map((v) => ({ value: v, label: t(`keys.auth.${v}`) })) }),
      base('configSave', 'configSave', { role: 'button' }),
      base('configDelete', 'configDelete', { role: 'button', disabled: cfgDelOff, focusable: !cfgDelOff, reason: down() ? reason : (CFG_NAMES.some(lockedSrc) && !cfgDeletable() ? t('keys.cfg.envManaged') : null) }),
      base('key', 'key', { role: 'textbox', disabled: keyOff, focusable: !keyOff, reason: reason ?? (entra ? t('keys.cfg.entraNoKey') : null), input: { type: 'password', value: '•'.repeat(Math.min(foundryInput.length, 64)), autocomplete: 'new-password', writeOnly: true, reveal: false, placeholder: t('keys.key.placeholder') } }),
      { id: 'apiKeys.foundry.status', label: lbl('status'), accessibleName: a11y(lbl('status')), role: 'status', focusable: false, disabled: false, reason: null, status: foundryStatus() },
      base('save', 'save', { role: 'button', disabled: keyOff, focusable: !keyOff, reason: reason ?? (entra ? t('keys.cfg.entraNoKey') : null) }),
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
  const fieldsOf = (cat) => (cat === 'foundry' ? foundryFields() : cat === 'copilot' ? (api.getCopilotFields?.() ?? []) : azureFields());
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
    open = true; selected = 'foundry'; focusId = 'apiKeys.category.foundry'; foundryInput = ''; clearCfgInputs(); api.resetCopilotInputs?.();
    ctx.change((s) => { delete s.focusReturn; });
    say('keys.opened');
    if (relay) { void api.refreshFoundryKeyStatus(); void api.refreshAzureSpeechStatus?.(); void api.refreshCopilotKeysStatus?.(); }
    return { ok: true };
  }
  function closeDialog() {
    if (!open) return { ok: false, reason: 'closed' };
    open = false; selected = 'foundry'; focusId = null; foundryInput = ''; foundryDlg = null; clearCfgInputs(); api.resetCopilotInputs?.();
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
  ctx.registerKey({ key: 'm', ctrl: true, alt: true, shift: true, command: 'foundry.deleteConfig' });
  api.selectApiKeysCategory = (id) => {
    if (!open || !CATEGORIES.includes(id)) return { ok: false, reason: 'invalid' };
    if (id !== selected) {
      selected = id; if (!String(focusId).startsWith('apiKeys.category.') && focusId !== 'apiKeys.close') focusId = `apiKeys.category.${id}`; notify();
      // GitHub Copilot の分類を開いたときだけ、Copilot CLI でサインインの状態を確かめる（AC-507。Q-034）
      if (id === 'copilot' && relay) void api.refreshCopilotKeysStatus?.({ check: true });
    }
    return { ok: true };
  };
  api.isCopilotCategoryOpen = () => open && selected === 'copilot';
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
        if (focusId === 'apiKeys.foundry.configSave') return run('foundry.saveConfig', () => { void api.saveFoundryConfig(); });
        if (focusId === 'apiKeys.foundry.configDelete') return run('foundry.deleteConfig', () => ctx.api.commands['foundry.deleteConfig']());
        if (focusId === 'apiKeys.foundry.delete') return run('foundry.deleteKey', () => ctx.api.commands['foundry.deleteKey']());
        if (focusId === 'apiKeys.azureSpeech.save') return run('azureSpeech.save', () => { void api.saveAzureSpeech(); });
        if (focusId === 'apiKeys.azureSpeech.delete') return run('azureSpeech.deleteKey', () => ctx.api.commands['azureSpeech.deleteKey']());
        if (focusId === 'apiKeys.azureSpeech.test') return run('azureSpeech.test', () => { void api.testAzureSpeech(); });
        if (String(focusId).startsWith('apiKeys.copilot.')) { const done = api.runCopilotField?.(focusId); if (done) return done; }
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
