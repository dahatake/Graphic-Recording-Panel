// FR-088 GitHub Copilot の認証（サインイン・トークン）とモデル名の、接続キー画面での設定／NFR-SEC-006 トークンの非露出
// （契約: tests/system/CONTRACT-GITHUB-COPILOT.md の「接続キー画面の GitHub Copilot の分類」）。DOM に依存しない（描画は apikeys-ui.js）。
// - 状態は中継サーバー（GET /api/llm/status の copilot）から、許可した項目・形の値だけを取り出す。トークン・資格情報らしい値が混ざっても使わない。
// - トークンは書き込み専用。入力中の一時的な値はメモリの 1 か所（tokenInput）だけに持ち、保存の要求を送る前に空にする。
//   画面（fields）には伏せ字だけを出し、ブラウザ内の保存・ログ・メッセージ・セッションファイルには書かない。
// - サインイン（AC-509）は中継サーバーが Copilot CLI のデバイスフローを始め、画面は確認のページの URL・確認コードと状態の分類だけを持つ。
//   GitHub の資格情報は受け取らず、保存・表示しない。
// - Copilot CLI でサインインの有無を確かめるのは、この分類を開いたとき（GET /api/llm/copilot）とプロバイダーが GitHub Copilot のときだけ。
//   それ以外の状態の取得（GET /api/llm/status）では signedIn が null（未確認）で返り、「未確認」と示す（AC-507・AC-510。Q-034）。
// - サインアウト（AC-511。Q-033）は確認つきで、このアプリでの状態だけを未サインインにする（Copilot CLI の資格情報は消さない）。
// - 接続キー画面の枠（分類・Tab の順・Enter の操作・確認の表示）は apikeys.js が持ち、ここは GitHub Copilot の分類の状態と操作だけ。

const TIMEOUT_MS = 10_000; // PARAM-074（中継サーバーの操作の待機上限）
const POLL_MS = 5_000; // サインインの完了の確認の間隔（10 秒以内）
export const MAX_TOKEN_LENGTH = 512; // PARAM-094
export const MAX_MODEL_LENGTH = 64; // PARAM-096
const SOURCES = ['ui', 'env', 'file'];
const ICONS = { ok: '●', none: '○', warn: '▲', checking: '…' };
const FLOW_STATES = ['pending', 'completed', 'expired', 'denied', 'cancelled', 'failed'];
const ACCOUNT_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/; // GitHub のアカウント名の形だけ通す
const CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const hasControl = (s) => { for (const ch of s) { const c = ch.codePointAt(0); if (c < 0x20 || c === 0x7f) return true; } return false; };
const verifyUriOk = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && /^(github\.com|[A-Za-z0-9-]+\.ghe\.com)$/.test(x.hostname) && x.pathname === '/login/device' && !x.search && !x.username; } catch { return false; } };

export function copilotKeysModule(ctx) {
  const { api } = ctx;
  const t = ctx.t;

  ctx.i18n.addStrings({
    ja: {
      'apikeys.category.copilot': 'GitHub Copilot',
      'keys.a11y.copilot': 'GitHub Copilot の',
      'keys.cp.label.authMethod': '認証方式', 'keys.cp.label.model': 'モデル名', 'keys.cp.label.token': 'トークン',
      'keys.cp.label.sdk': 'SDK', 'keys.cp.label.signinStatus': 'サインイン', 'keys.cp.label.tokenStatus': 'トークンの状態',
      'keys.cp.label.signin': 'サインイン', 'keys.cp.label.save': '保存', 'keys.cp.label.delete': '削除',
      'keys.cp.label.copy': 'コピー', 'keys.cp.label.cancel': '取り消し', 'keys.cp.label.link': '確認のページ',
      'keys.cp.a11y.signin': 'GitHub でサインイン', 'keys.cp.a11y.copy': '確認コードをコピー', 'keys.cp.a11y.cancel': 'サインインを取り消す', 'keys.cp.a11y.link': 'GitHub の確認のページを新しいタブで開く',
      'keys.cp.auth.signin': 'GitHub アカウントでサインイン（既定）', 'keys.cp.auth.token': 'トークン',
      'keys.cp.model.placeholder': '空のときは SDK の既定のモデル', 'keys.cp.model.note': '空のときは GitHub Copilot SDK の既定のモデルを使います',
      'keys.cp.token.placeholder': '新しいトークンを入力（保存後は表示されません）',
      'keys.cp.token.signinOnly': '認証方式が「サインイン」のときはトークンを入力できません。トークンを使うときは認証方式を「トークン」にしてください',
      'keys.cp.locked': '環境変数／設定ファイルで設定されているため画面からは変更できない',
      'keys.cp.sdk.available': 'GitHub Copilot SDK: 導入済み', 'keys.cp.sdk.missing': 'GitHub Copilot SDK が導入されていません',
      'keys.cp.sdk.cli': 'Copilot CLI を起動できません',
      'keys.cp.sdk.guide': '導入の手順: 中継サーバーの Python で「pip install -r server/requirements-copilot.txt」を実行し、中継サーバーを起動し直してください（users-guide の「LLM 連携」を参照）',
      'keys.cp.signedIn': 'サインイン済み（{account}）', 'keys.cp.signedOut': '未サインイン', 'keys.cp.signinUnknown': '未確認',
      'keys.cp.label.signout': 'サインアウト', 'keys.cp.a11y.signout': 'このアプリで GitHub Copilot からサインアウト',
      'keys.cp.signout.text': 'このアプリでの GitHub Copilot のサインインを解除しますか？ Copilot CLI に保存されたサインインの資格情報は消さず、このアプリで使わない状態にするだけです。もう一度使うときは「GitHub でサインイン」を押してください',
      'keys.cp.signout.confirm': 'サインアウト', 'keys.cp.signout.done': 'このアプリで GitHub Copilot からサインアウトしました',
      'keys.cp.signout.failed': 'サインアウトできませんでした。もう一度お試しください', 'keys.cp.signout.notSignedIn': 'サインインしていません',
      'keys.cp.token.set': 'トークン: 設定済み', 'keys.cp.token.unset': 'トークン: 未設定',
      'keys.cp.saved': 'GitHub Copilot の設定を保存しました',
      'keys.cp.invalid': '保存できませんでした。トークンは空・空白だけ・制御文字を含む・長すぎる値にできず、モデル名は空白だけ・制御文字を含む・64 文字を超える値にできません',
      'keys.cp.failed': 'GitHub Copilot の設定を保存できませんでした。もう一度お試しください',
      'keys.cp.envManaged': '環境変数・設定ファイルで設定されている項目は、画面から変更・削除できません',
      'keys.cp.deleted': '画面で保存した GitHub Copilot の設定を削除しました', 'keys.cp.deleteFailed': 'GitHub Copilot の設定を削除できませんでした。もう一度お試しください',
      'keys.cp.delete.text': '画面で保存した GitHub Copilot の認証方式・モデル名・トークンを削除しますか？ 削除すると、認証方式はサインインに戻ります', 'keys.cp.delete.confirm': '設定を削除',
      'keys.cp.signin.notSignin': '認証方式が「サインイン」のときだけ、GitHub でサインインできます',
      'keys.cp.signin.already': 'すでにサインインしています',
      'keys.cp.signin.pending': 'GitHub の確認のページを開き、確認コードを入力して承認してください。承認を待っています',
      'keys.cp.signin.completed': 'GitHub にサインインしました',
      'keys.cp.signin.expired': '確認コードの期限が切れました。もう一度サインインしてください',
      'keys.cp.signin.denied': 'GitHub で承認されませんでした。もう一度サインインできます',
      'keys.cp.signin.cancelled': 'サインインを取り消しました。もう一度サインインできます',
      'keys.cp.signin.failed': 'サインインできませんでした。もう一度お試しください',
      'keys.cp.signin.copied': '確認コードをコピーしました', 'keys.cp.signin.copyFailed': '確認コードをコピーできませんでした。表示されたコードを手で入力してください',
    },
    en: {
      'apikeys.category.copilot': 'GitHub Copilot',
      'keys.a11y.copilot': 'GitHub Copilot',
      'keys.cp.label.authMethod': 'Auth method', 'keys.cp.label.model': 'Model', 'keys.cp.label.token': 'Token',
      'keys.cp.label.sdk': 'SDK', 'keys.cp.label.signinStatus': 'Sign-in', 'keys.cp.label.tokenStatus': 'Token status',
      'keys.cp.label.signin': 'Sign in', 'keys.cp.label.save': 'Save', 'keys.cp.label.delete': 'Delete',
      'keys.cp.label.copy': 'Copy', 'keys.cp.label.cancel': 'Cancel', 'keys.cp.label.link': 'Verify page',
      'keys.cp.a11y.signin': 'Sign in with GitHub', 'keys.cp.a11y.copy': 'Copy the verification code', 'keys.cp.a11y.cancel': 'Cancel the sign-in', 'keys.cp.a11y.link': 'Open the GitHub verification page in a new tab',
      'keys.cp.auth.signin': 'Sign in with a GitHub account (default)', 'keys.cp.auth.token': 'Token',
      'keys.cp.model.placeholder': 'Empty uses the SDK default model', 'keys.cp.model.note': 'When empty, the default model of the GitHub Copilot SDK is used',
      'keys.cp.token.placeholder': 'Enter a new token (it is not shown after saving)',
      'keys.cp.token.signinOnly': 'A token cannot be entered when the auth method is sign-in. Choose "Token" to use a token',
      'keys.cp.locked': 'Set by an environment variable or config file, so it cannot be changed here',
      'keys.cp.sdk.available': 'GitHub Copilot SDK: installed', 'keys.cp.sdk.missing': 'The GitHub Copilot SDK is not installed',
      'keys.cp.sdk.cli': 'The Copilot CLI cannot be started',
      'keys.cp.sdk.guide': 'To install: run "pip install -r server/requirements-copilot.txt" with the relay server\'s Python, then restart the relay server (see "LLM" in the users-guide)',
      'keys.cp.signedIn': 'Signed in ({account})', 'keys.cp.signedOut': 'Not signed in', 'keys.cp.signinUnknown': 'Not checked',
      'keys.cp.label.signout': 'Sign out', 'keys.cp.a11y.signout': 'Sign out of GitHub Copilot in this app',
      'keys.cp.signout.text': 'Sign out of GitHub Copilot in this app? The sign-in credential saved by the Copilot CLI is not deleted; this app just stops using it. To use it again, choose "Sign in with GitHub"',
      'keys.cp.signout.confirm': 'Sign out', 'keys.cp.signout.done': 'Signed out of GitHub Copilot in this app',
      'keys.cp.signout.failed': 'Could not sign out. Try again', 'keys.cp.signout.notSignedIn': 'Not signed in',
      'keys.cp.token.set': 'Token: configured', 'keys.cp.token.unset': 'Token: not configured',
      'keys.cp.saved': 'The GitHub Copilot settings were saved',
      'keys.cp.invalid': 'Not saved. The token cannot be empty, whitespace only, contain control characters or be too long, and the model name cannot be whitespace only, contain control characters or exceed 64 characters',
      'keys.cp.failed': 'The GitHub Copilot settings could not be saved. Try again',
      'keys.cp.envManaged': 'Items set by an environment variable or config file cannot be changed or deleted here',
      'keys.cp.deleted': 'The GitHub Copilot settings saved in this screen were deleted', 'keys.cp.deleteFailed': 'The GitHub Copilot settings could not be deleted. Try again',
      'keys.cp.delete.text': 'Delete the GitHub Copilot auth method, model name and token saved in this screen? The auth method returns to sign-in', 'keys.cp.delete.confirm': 'Delete setup',
      'keys.cp.signin.notSignin': 'Signing in with GitHub is available only when the auth method is sign-in',
      'keys.cp.signin.already': 'Already signed in',
      'keys.cp.signin.pending': 'Open the GitHub verification page, enter the code and approve. Waiting for approval',
      'keys.cp.signin.completed': 'Signed in to GitHub',
      'keys.cp.signin.expired': 'The verification code expired. Sign in again',
      'keys.cp.signin.denied': 'The sign-in was not approved on GitHub. You can sign in again',
      'keys.cp.signin.cancelled': 'The sign-in was cancelled. You can sign in again',
      'keys.cp.signin.failed': 'The sign-in failed. Try again',
      'keys.cp.signin.copied': 'The verification code was copied', 'keys.cp.signin.copyFailed': 'The code could not be copied. Type the code shown',
    },
  });

  const relay = typeof ctx.options.relay === 'function' ? ctx.options.relay : null;
  const sched = ctx.options.scheduler ?? { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  const clipboard = () => ('clipboard' in ctx.options ? ctx.options.clipboard : (globalThis.navigator?.clipboard ?? null));
  const notify = () => ctx.emit('change', api);
  const say = (key, vars) => ctx.change((s) => { s.message = { key, text: fmt(t(key), vars) }; });
  const fmt = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : s);

  // ---- 状態（トークンの値は持たない。tokenInput は入力中の一時的な値だけ） ----
  const EMPTY = () => ({ reachable: false, available: false, unavailableReason: null, authMethod: 'signin', authMethodSource: null, signedIn: false, account: null, tokenConfigured: false, tokenSource: null, model: '', modelSource: null });
  let checked = !relay;
  let cp = EMPTY();
  let tokenInput = '';
  let modelInput = null; // null のときは中継サーバーの値
  let authInput = null; // null のときは中継サーバーの値
  let busy = false;
  let dlg = false; // 削除の確認
  let outDlg = false; // サインアウトの確認（AC-511）
  let flow = null; // { state, verificationUri, userCode }
  let pollTimer = null;
  const src = (v) => (SOURCES.includes(v) ? v : null);
  const textOk = (v, max) => typeof v === 'string' && v.length <= max && !hasControl(v);
  // 応答から許可した項目だけを取り出す（ない項目は前の値を保つ）
  function pick(c, base) {
    const o = { ...base, reachable: true };
    if (!c || typeof c !== 'object') return o;
    if (typeof c.available === 'boolean') o.available = c.available;
    if ('unavailableReason' in c) o.unavailableReason = ['sdk_missing', 'cli_unavailable'].includes(c.unavailableReason) ? c.unavailableReason : null;
    if (c.authMethod === 'signin' || c.authMethod === 'token') o.authMethod = c.authMethod;
    if ('authMethodSource' in c) o.authMethodSource = src(c.authMethodSource);
    if (typeof c.signedIn === 'boolean' || c.signedIn === null) o.signedIn = c.signedIn; // null = 未確認（Q-034）
    if ('account' in c) o.account = typeof c.account === 'string' && ACCOUNT_RE.test(c.account) ? c.account : null;
    if (typeof c.tokenConfigured === 'boolean') o.tokenConfigured = c.tokenConfigured;
    if ('tokenSource' in c) o.tokenSource = o.tokenConfigured ? src(c.tokenSource) : null;
    if ('model' in c) o.model = textOk(c.model, MAX_MODEL_LENGTH) ? c.model : '';
    if ('modelSource' in c) o.modelSource = o.model ? src(c.modelSource) : null;
    if (!o.signedIn) o.account = null;
    return o;
  }

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
  const down = () => checked && !cp.reachable;

  // ---- 状態の取得（接続キー画面を開いたとき・サインインの完了のとき） ----
  // GitHub Copilot の分類を開いているとき（または check: true）だけ、CLI で確かめる経路（GET /api/llm/copilot）を使う（AC-507。Q-034）
  api.refreshCopilotKeysStatus = async (opts) => {
    const deep = opts?.check === true || api.isCopilotCategoryOpen?.() === true;
    const r = await send('GET', deep ? '/api/llm/copilot' : '/api/llm/status');
    checked = true;
    cp = ok2xx(r) ? pick(r.body.copilot, EMPTY()) : EMPTY();
    notify();
    return api.getCopilotKeysStatus();
  };
  // FR-068 側（llm.js）の refreshCopilotStatus（= refreshLlmStatus）がこの状態も読み直す。llm.js がないときだけ自前で持つ
  if (typeof api.refreshCopilotStatus !== 'function') api.refreshCopilotStatus = api.refreshCopilotKeysStatus;
  api.getCopilotKeysStatus = () => ({ ...cp });

  // ---- 入力 ----
  const lockedSrc = (s) => s === 'env' || s === 'file';
  const effAuth = () => authInput ?? cp.authMethod;
  const effModel = () => modelInput ?? cp.model;
  api.setCopilotAuthMethod = (v) => {
    if (v !== 'signin' && v !== 'token') return false;
    authInput = v === cp.authMethod ? null : v;
    if (v !== 'token') tokenInput = ''; // サインインのときはトークンを持たない
    notify(); return true;
  };
  api.setCopilotModelInput = (text) => { modelInput = String(text ?? ''); notify(); };
  api.setCopilotTokenInput = (text) => { tokenInput = effAuth() === 'token' ? String(text ?? '') : ''; notify(); };

  // ---- 保存（AC-508・AC-510）: 送る前にトークン欄を空にする ----
  api.saveCopilotSettings = async () => {
    const am = effAuth();
    const rawToken = am === 'token' ? tokenInput : '';
    const hasToken = rawToken !== '';
    const model = effModel();
    tokenInput = '';
    notify();
    const tokenBad = hasToken && (!rawToken.trim() || rawToken.trim().length > MAX_TOKEN_LENGTH || hasControl(rawToken));
    const modelBad = model.length > MAX_MODEL_LENGTH || hasControl(model) || (model !== '' && !model.trim());
    if (tokenBad || modelBad) { say('keys.cp.invalid'); return { ok: false, result: 'invalid' }; }
    if ((lockedSrc(cp.authMethodSource) && am !== cp.authMethod) || (hasToken && lockedSrc(cp.tokenSource)) || (lockedSrc(cp.modelSource) && model.trim() !== cp.model)) {
      authInput = null; modelInput = null; notify(); say('keys.cp.envManaged'); return { ok: false, result: 'env_managed' };
    }
    if (!relay || !checked || !cp.reachable) {
      const s = relay ? await api.refreshCopilotKeysStatus() : null;
      if (!s || !s.reachable) { say('keys.unavailable'); return { ok: false, result: 'unavailable' }; }
    }
    const body = { authMethod: am, model: model.trim() };
    if (hasToken) body.token = rawToken.trim();
    busy = true; notify();
    const r = await send('POST', '/api/llm/copilot', body);
    busy = false;
    if (ok2xx(r) && r.body.ok === true && r.body.result === 'saved') {
      cp = pick(r.body.copilot, cp); authInput = null; modelInput = null; say('keys.cp.saved'); return { ok: true, result: 'saved' };
    }
    if (r.error === 'unavailable') { cp = EMPTY(); say('keys.unavailable'); return { ok: false, result: 'unavailable' }; }
    if (r.body?.result === 'env_managed') { cp = pick(r.body.copilot, cp); say('keys.cp.envManaged'); return { ok: false, result: 'env_managed' }; }
    if (r.status === 400 || r.body?.result === 'invalid') { say('keys.cp.invalid'); return { ok: false, result: 'invalid' }; }
    say('keys.cp.failed');
    return { ok: false, result: 'failed' };
  };

  // ---- 削除（確認つき。環境変数・設定ファイルの値は削除できない） ----
  const uiSaved = () => [cp.authMethodSource, cp.tokenSource, cp.modelSource].includes('ui');
  const anyLocked = () => [cp.authMethodSource, cp.tokenSource, cp.modelSource].some(lockedSrc);
  ctx.registerCommand('copilot.delete', () => {
    if (!cp.reachable) { say('keys.unavailable'); return { ok: false, reason: 'unavailable' }; }
    if (!uiSaved()) {
      if (anyLocked()) { say('keys.cp.envManaged'); return { ok: false, reason: 'env_managed' }; }
      return { ok: false, reason: 'unset' };
    }
    if (!dlg && !api.getDialog()) { dlg = true; notify(); }
    return { ok: true, pending: true };
  });
  ctx.registerKey({ key: 'p', ctrl: true, alt: true, shift: true, command: 'copilot.delete' }); // NFR-A11Y-001: 全コマンドにキー割り当て
  // ---- サインアウト（AC-511。確認つき。このアプリでの状態だけを未サインインにする） ----
  const canSignOut = () => cp.reachable && cp.signedIn === true && cp.authMethod === 'signin' && effAuth() === 'signin' && flow?.state !== 'pending';
  ctx.registerCommand('copilot.signout', () => {
    if (!cp.reachable) { say('keys.unavailable'); return { ok: false, reason: 'unavailable' }; }
    if (!canSignOut()) { say('keys.cp.signout.notSignedIn'); return { ok: false, reason: 'not_signed_in' }; }
    if (!outDlg && !dlg && !api.getDialog()) { outDlg = true; notify(); }
    return { ok: true, pending: true };
  });
  ctx.registerKey({ key: 'f', ctrl: true, alt: true, shift: true, command: 'copilot.signout' }); // NFR-A11Y-001
  const baseGetDialog = api.getDialog;
  api.getDialog = () => (outDlg ? {
    kind: 'copilot-signout', text: t('keys.cp.signout.text'),
    buttons: [{ id: 'confirm', label: t('keys.cp.signout.confirm') }, { id: 'cancel', label: t('dialog.cancel') }],
    defaultFocus: 'cancel', keyboard: true,
  } : dlg ? {
    kind: 'copilot-delete', text: t('keys.cp.delete.text'),
    buttons: [{ id: 'confirm', label: t('keys.cp.delete.confirm') }, { id: 'cancel', label: t('dialog.cancel') }],
    defaultFocus: 'cancel', keyboard: true,
  } : (baseGetDialog ? baseGetDialog() : null));
  const baseDialogAction = api.dialogAction;
  api.dialogAction = async (action) => {
    if (outDlg) {
      outDlg = false;
      if (action !== 'confirm') { notify(); return { ok: false, reason: 'cancelled' }; }
      busy = true; notify();
      const r = await send('POST', '/api/llm/copilot/signout');
      busy = false;
      if (ok2xx(r) && r.body.ok === true && r.body.result === 'signed_out') {
        cp = { ...pick(r.body.copilot, cp), signedIn: false, account: null };
        flow = null;
        say('keys.cp.signout.done');
        if (api.refreshCopilotStatus !== api.refreshCopilotKeysStatus) void api.refreshCopilotStatus?.(); // AC-506 の表示（llm.js）も読み直す
        return { ok: true };
      }
      if (r.error === 'unavailable') { cp = EMPTY(); say('keys.unavailable'); return { ok: false, reason: 'unavailable' }; }
      say('keys.cp.signout.failed'); notify();
      return { ok: false, reason: 'failed' };
    }
    if (!dlg) return baseDialogAction ? baseDialogAction(action) : { ok: false, reason: 'no_dialog' };
    dlg = false;
    if (action !== 'confirm') { notify(); return { ok: false, reason: 'cancelled' }; }
    const r = await send('DELETE', '/api/llm/copilot');
    authInput = null; modelInput = null; tokenInput = '';
    if (ok2xx(r) && r.body.ok === true) { cp = pick(r.body.copilot, cp); say('keys.cp.deleted'); return { ok: true }; }
    if (r.error === 'unavailable') { cp = EMPTY(); say('keys.unavailable'); return { ok: false, reason: 'unavailable' }; }
    if (r.body?.result === 'env_managed') { cp = pick(r.body.copilot, cp); say('keys.cp.envManaged'); return { ok: false, reason: 'env_managed' }; }
    say('keys.cp.deleteFailed');
    return { ok: false, reason: 'failed' };
  };

  // ---- サインイン（AC-509） ----
  const stopPoll = () => { if (pollTimer != null) { sched.clearTimeout(pollTimer); pollTimer = null; } };
  const finish = (state) => {
    stopPoll();
    flow = { state, verificationUri: null, userCode: null };
    if (state === 'completed') { say('keys.cp.signin.completed'); void api.refreshCopilotKeysStatus(); } else say(`keys.cp.signin.${state}`);
    notify();
  };
  function schedulePoll() {
    stopPoll();
    pollTimer = sched.setTimeout(async () => {
      pollTimer = null;
      if (flow?.state !== 'pending') return;
      const r = await send('GET', '/api/llm/copilot/signin');
      if (flow?.state !== 'pending') return;
      const st = ok2xx(r) ? r.body.state : null;
      if (st === 'completed' && typeof r.body.account === 'string' && ACCOUNT_RE.test(r.body.account)) { cp = { ...cp, signedIn: true, account: r.body.account }; }
      if (FLOW_STATES.includes(st) && st !== 'pending') finish(st);
      else schedulePoll(); // 待機中・一時的な失敗は確認を続ける（期限切れは中継サーバーが判定する）
    }, POLL_MS);
  }
  const signinBlocked = () => {
    if (!cp.reachable) return t('keys.unavailable');
    if (!cp.available) return t(cp.unavailableReason === 'cli_unavailable' ? 'keys.cp.sdk.cli' : 'keys.cp.sdk.missing');
    if (effAuth() !== 'signin') return t('keys.cp.signin.notSignin');
    if (cp.signedIn) return t('keys.cp.signin.already');
    return null;
  };
  api.startCopilotSignin = async () => {
    if (!checked && relay) await api.refreshCopilotKeysStatus();
    const why = signinBlocked();
    if (why) { ctx.change((s) => { s.message = { key: 'keys.cp.signin.blocked', text: why }; }); return { ok: false, reason: 'blocked' }; }
    if (flow?.state === 'pending') return { ok: true, state: 'pending' };
    busy = true; notify();
    const r = await send('POST', '/api/llm/copilot/signin', {});
    busy = false;
    const b = ok2xx(r) ? r.body : null;
    if (b && b.ok === true && b.state === 'pending' && verifyUriOk(b.verificationUri) && typeof b.userCode === 'string' && CODE_RE.test(b.userCode)) {
      flow = { state: 'pending', verificationUri: new URL(b.verificationUri).href, userCode: b.userCode };
      say('keys.cp.signin.pending');
      schedulePoll();
      return { ok: true, state: 'pending' };
    }
    if (b && b.state === 'completed') { finish('completed'); return { ok: true, state: 'completed' }; }
    if (r.error === 'unavailable') { cp = EMPTY(); say('keys.unavailable'); notify(); return { ok: false, reason: 'unavailable' }; }
    if (r.body?.result === 'sdk_missing' || r.body?.result === 'cli_unavailable') { cp = { ...cp, available: false, unavailableReason: r.body.result }; }
    finish('failed');
    return { ok: false, reason: 'failed' };
  };
  api.cancelCopilotSignin = async () => {
    if (flow?.state !== 'pending') return { ok: false, reason: 'not_pending' };
    stopPoll();
    await send('DELETE', '/api/llm/copilot/signin');
    finish('cancelled');
    return { ok: true };
  };
  api.copyCopilotUserCode = async () => {
    const code = flow?.state === 'pending' ? flow.userCode : null;
    const clip = clipboard();
    if (!code) return { ok: false, reason: 'no_code' };
    try {
      if (!clip || typeof clip.writeText !== 'function') throw new Error('clipboard');
      await clip.writeText(code);
      say('keys.cp.signin.copied'); return { ok: true };
    } catch { say('keys.cp.signin.copyFailed'); return { ok: false, reason: 'clipboard' }; }
  };
  api.getCopilotSignin = () => {
    if (!flow) return null;
    const pending = flow.state === 'pending';
    return {
      state: flow.state,
      verificationUri: pending ? flow.verificationUri : null,
      link: pending ? { href: flow.verificationUri, target: '_blank', rel: 'noopener noreferrer', label: t('keys.cp.label.link') } : null,
      userCode: pending ? flow.userCode : null,
      copy: pending ? { label: t('keys.cp.label.copy') } : null,
      cancel: pending ? { label: t('keys.cp.label.cancel') } : null,
      text: t(`keys.cp.signin.${flow.state}`),
    };
  };

  // ---- 接続キー画面の項目（apikeys.js が分類「copilot」で使う） ----
  const a11y = (label) => `${t('keys.a11y.copilot')} ${label}`;
  const lbl = (k) => t(`keys.cp.label.${k}`);
  const sdkStatus = () => {
    if (!checked) return { id: 'unavailable', text: t('keys.checking'), icon: ICONS.checking };
    if (!cp.reachable) return { id: 'unavailable', text: t('keys.unavailable'), icon: ICONS.warn };
    if (cp.available) return { id: 'available', text: t('keys.cp.sdk.available'), icon: ICONS.ok };
    return { id: 'missing', text: t(cp.unavailableReason === 'cli_unavailable' ? 'keys.cp.sdk.cli' : 'keys.cp.sdk.missing'), icon: ICONS.warn };
  };
  const signinStatus = () => {
    if (!cp.reachable) return { id: 'signedOut', text: checked ? t('keys.unavailable') : t('keys.checking'), account: null, icon: ICONS.warn };
    if (cp.signedIn && cp.account) return { id: 'signedIn', text: fmt(t('keys.cp.signedIn'), { account: cp.account }), account: cp.account, icon: ICONS.ok };
    if (cp.signedIn) return { id: 'signedIn', text: fmt(t('keys.cp.signedIn'), { account: '-' }), account: null, icon: ICONS.ok };
    if (cp.signedIn === null) return { id: 'unknown', text: t('keys.cp.signinUnknown'), account: null, icon: ICONS.none }; // Q-034
    return { id: 'signedOut', text: t('keys.cp.signedOut'), account: null, icon: ICONS.none };
  };
  const tokenStatus = () => {
    if (!cp.reachable) return { id: 'unset', text: checked ? t('keys.unavailable') : t('keys.checking'), source: null, icon: ICONS.warn };
    if (!cp.tokenConfigured) return { id: 'unset', text: t('keys.cp.token.unset'), source: null, icon: ICONS.none };
    const s = cp.tokenSource ?? 'ui';
    const locked = lockedSrc(s) ? ` ／ ${t('keys.cp.locked')}` : '';
    return { id: 'set', text: `${t('keys.cp.token.set')}（${t(`keys.src.${s}`)}）${locked}`, source: cp.tokenSource, icon: ICONS.ok };
  };
  api.getCopilotFields = () => {
    const off = !checked || down() || busy;
    const reason = down() ? t('keys.unavailable') : null;
    const base = (id, k, extra) => ({ id: `apiKeys.copilot.${id}`, label: lbl(k), accessibleName: a11y(lbl(k)), disabled: off, focusable: !off, reason, ...extra });
    const st = (id, k, status, extra) => ({ id: `apiKeys.copilot.${id}`, label: lbl(k), accessibleName: a11y(lbl(k)), role: 'status', focusable: false, disabled: false, reason: null, status, ...extra });
    const am = effAuth();
    const amLocked = lockedSrc(cp.authMethodSource);
    const amOff = off || amLocked;
    const modelLocked = lockedSrc(cp.modelSource);
    const modelOff = off || modelLocked;
    const tokLocked = lockedSrc(cp.tokenSource);
    const tokOff = off || am !== 'token' || tokLocked;
    const tokWhy = reason ?? (am !== 'token' ? t('keys.cp.token.signinOnly') : (tokLocked ? t('keys.cp.locked') : null));
    const siWhy = off ? (reason ?? (busy ? null : t('keys.checking'))) : signinBlocked();
    const siOff = off || !!siWhy || flow?.state === 'pending';
    const delOff = off || !uiSaved();
    const sdk = sdkStatus();
    const soOff = off || !canSignOut();
    const out = [
      base('authMethod', 'authMethod', { role: 'combobox', disabled: amOff, focusable: !amOff, reason: reason ?? (amLocked ? t('keys.cp.locked') : null), input: { type: 'select', value: am, options: ['signin', 'token'].map((v) => ({ value: v, label: t(`keys.cp.auth.${v}`) })) } }),
      base('model', 'model', { role: 'textbox', disabled: modelOff, focusable: !modelOff, reason: reason ?? (modelLocked ? t('keys.cp.locked') : null), note: t('keys.cp.model.note'), input: { type: 'text', value: effModel(), autocomplete: 'off', placeholder: t('keys.cp.model.placeholder') } }),
      base('token', 'token', { role: 'textbox', disabled: tokOff, focusable: !tokOff, reason: tokWhy, input: { type: 'password', value: '•'.repeat(Math.min(tokenInput.length, 64)), autocomplete: 'new-password', writeOnly: true, reveal: false, placeholder: t('keys.cp.token.placeholder') } }),
      st('sdkStatus', 'sdk', sdk, { guide: sdk.id === 'missing' ? t('keys.cp.sdk.guide') : null }),
      st('signinStatus', 'signinStatus', signinStatus()),
      st('tokenStatus', 'tokenStatus', tokenStatus()),
      base('signin', 'signin', { role: 'button', accessibleName: a11y(t('keys.cp.a11y.signin')), disabled: siOff, focusable: !siOff, reason: siWhy }),
    ];
    const sf = api.getCopilotSignin();
    if (cp.signedIn === true && cp.authMethod === 'signin') {
      out.push(base('signout', 'signout', { role: 'button', accessibleName: a11y(t('keys.cp.a11y.signout')), disabled: soOff, focusable: !soOff }));
    }
    if (sf?.state === 'pending') {
      out.push({ id: 'apiKeys.copilot.verifyLink', label: lbl('link'), accessibleName: t('keys.cp.a11y.link'), role: 'link', href: sf.link.href, target: '_blank', text: sf.userCode, disabled: false, focusable: true, reason: null, status: { id: 'pending', text: sf.text, icon: ICONS.checking } });
      out.push({ id: 'apiKeys.copilot.copyCode', label: lbl('copy'), accessibleName: t('keys.cp.a11y.copy'), role: 'button', disabled: false, focusable: true, reason: null, code: sf.userCode });
      out.push({ id: 'apiKeys.copilot.cancelSignin', label: lbl('cancel'), accessibleName: t('keys.cp.a11y.cancel'), role: 'button', disabled: false, focusable: true, reason: null });
    } else if (sf) {
      out.push({ id: 'apiKeys.copilot.signinResult', label: lbl('signinStatus'), accessibleName: a11y(lbl('signinStatus')), role: 'status', focusable: false, disabled: false, reason: null, status: { id: sf.state, text: sf.text, icon: sf.state === 'completed' ? ICONS.ok : ICONS.warn } });
    }
    out.push(
      base('save', 'save', { role: 'button' }),
      base('delete', 'delete', { role: 'button', disabled: delOff, focusable: !delOff, reason: reason ?? (!uiSaved() && anyLocked() ? t('keys.cp.envManaged') : null) }),
    );
    return out;
  };
  // Enter・Space で実行する操作（apikeys.js のキーボードの処理から呼ぶ）
  api.runCopilotField = (id) => {
    if (id === 'apiKeys.copilot.save') { void api.saveCopilotSettings(); return 'copilot.save'; }
    if (id === 'apiKeys.copilot.delete') { ctx.api.commands['copilot.delete'](); return 'copilot.delete'; }
    if (id === 'apiKeys.copilot.signin') { void api.startCopilotSignin(); return 'copilot.signin'; }
    if (id === 'apiKeys.copilot.signout') { ctx.api.commands['copilot.signout'](); return 'copilot.signout'; }
    if (id === 'apiKeys.copilot.copyCode') { void api.copyCopilotUserCode(); return 'copilot.copyCode'; }
    if (id === 'apiKeys.copilot.cancelSignin') { void api.cancelCopilotSignin(); return 'copilot.cancelSignin'; }
    if (id === 'apiKeys.copilot.verifyLink') { const h = flow?.verificationUri; if (h && typeof globalThis.open === 'function') globalThis.open(h, '_blank', 'noopener,noreferrer'); return 'copilot.verifyLink'; }
    return null;
  };
  // 接続キー画面を開いた・閉じたとき（apikeys.js から呼ぶ）。閉じると保存していない入力を破棄する
  api.resetCopilotInputs = () => { tokenInput = ''; modelInput = null; authInput = null; dlg = false; outDlg = false; if (flow && flow.state !== 'pending') flow = null; };
}
