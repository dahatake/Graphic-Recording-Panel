// FR-062 LLM 連携の既定オフ・明示同意・自動復帰／FR-068 設定画面での有効/無効と接続テスト
// （契約: tests/system/CONTRACT-LLM-FR062.md）。DOM に依存しない。
// - アプリ自身のリクエストは options.relay（同一オリジンの中継サーバー /api/llm/...）だけを通す。省略時は未設定扱い。
// - 既定は無効。同意（送信内容の表示後）のときだけ有効になる。同意はメモリだけに持ち、保存しない（AC-312: タブを開いている間だけ有効）。
// - API キー・トークンは扱わない（中継サーバーが持つ）。設定済みかどうかの真偽だけを表示する（AC-355）。
// - 失敗（タイムアウト・エラー・不正な応答・オフライン）は、ルールベース描画のまま短く通知する（AC-314）。
// 後続の LLM 機能（FR-063・FR-065）は api.llmCall(path, body) で要求を出し、'llm:result' を購読する。

const REQUEST_TIMEOUT_MS = 30_000; // PARAM-069
const TEST_TIMEOUT_MS = 10_000; // PARAM-074
const RESPONSES_PATH = '/api/llm/responses';
const STATUS_PATH = '/api/llm/status';
const MISSING_ALL = ['endpoint', 'deployment', 'credential'];
const ICONS = { disabled: '○', enabled: '●', unconfigured: '▲', error: '✖' };

export const maskSecrets = (text) => String(text ?? '')
  .replace(/Bearer\s+\S+/gi, '[masked]')
  .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[masked]')
  .replace(/[A-Za-z0-9_+/=-]{32,}/g, '[masked]');

// FR-062 AC-312・AC-367: 同意の記録（ブラウザのローカル設定だけ）。送信内容（種類・項目）を変えたら版を上げて再同意を求める。
export const CONSENT_KEY = 'grp.llm.consent';
export const CONSENT_VERSION = 'send-v2:points+scene+drawStyle+partKeys';

export async function llmModule(ctx) {
  const { api, state } = ctx;
  const t = ctx.t;

  ctx.i18n.addStrings({
    ja: {
      'llm.title': 'LLM 連携', 'llm.enabled': 'LLM 連携を使う', 'llm.credential': '認証情報（API キー・トークン）', 'llm.test': '接続テスト',
      'llm.status.disabled': '無効', 'llm.status.enabled': '有効', 'llm.status.unconfigured': '未設定', 'llm.status.error': 'エラー',
      'llm.credential.set': '設定済み', 'llm.credential.unset': '未設定',
      'llm.missing.endpoint': 'エンドポイント', 'llm.missing.deployment': 'デプロイ名', 'llm.missing.credential': '認証情報',
      'llm.unconfigured': 'LLM 連携を有効にできません。未設定: ', 'llm.failed': 'LLM 連携に失敗したため、通常の描画で表示しています',
      'llm.enabledMsg': 'LLM 連携を有効にしました', 'llm.disabledMsg': 'LLM 連携を無効にしました',
      'llm.consent.title': 'LLM 連携の送信内容の確認', 'llm.consent.accept': '同意して有効にする', 'llm.consent.decline': '同意しない',
      'llm.consent.kind.points': '会話の要点の文字（マスキング後）', 'llm.consent.sent': '送る内容:', 'llm.consent.to': '送信先', 'llm.consent.notSentLabel': '送らないもの:',
      'llm.consent.notSent.audio': '音声', 'llm.consent.notSent.secret': 'API キー・トークン', 'llm.consent.notSent.other': '要点の文字以外の内容',
      'llm.consent.hostUnknown': '中継サーバーに設定された Foundry のエンドポイント', 'llm.consent.note': 'この同意はこのブラウザに保存されます（同意の事実・送信内容の版・同意日時だけ）。無効にすると取り消されます。',
      'llm.test.ok': '接続テスト: 成功', 'llm.test.running': '接続テスト中', 'llm.test.fail.unconfigured': '接続テスト: 失敗（未設定）', 'llm.test.fail.consent': '先に同意が必要です（LLM 連携を有効にして同意してください）',
      'llm.test.fail.auth': '接続テスト: 失敗（認証）', 'llm.test.fail.connection': '接続テスト: 失敗（接続）', 'llm.test.fail.timeout': '接続テスト: 失敗（タイムアウト）',
      'llm.lastSent': '直近に送った内容',
    },
    en: {
      'llm.title': 'LLM integration', 'llm.enabled': 'Use LLM integration', 'llm.credential': 'Credential (API key / token)', 'llm.test': 'Connection test',
      'llm.status.disabled': 'Disabled', 'llm.status.enabled': 'Enabled', 'llm.status.unconfigured': 'Not configured', 'llm.status.error': 'Error',
      'llm.credential.set': 'Configured', 'llm.credential.unset': 'Not configured',
      'llm.missing.endpoint': 'Endpoint', 'llm.missing.deployment': 'Deployment name', 'llm.missing.credential': 'Credential',
      'llm.unconfigured': 'LLM integration cannot be enabled. Not configured: ', 'llm.failed': 'LLM integration failed; showing the normal drawing',
      'llm.enabledMsg': 'LLM integration enabled', 'llm.disabledMsg': 'LLM integration disabled',
      'llm.consent.title': 'Confirm what LLM integration sends', 'llm.consent.accept': 'Agree and enable', 'llm.consent.decline': 'Do not agree',
      'llm.consent.kind.points': 'Key-point text of the conversation (after masking)', 'llm.consent.sent': 'What is sent:', 'llm.consent.to': 'Destination', 'llm.consent.notSentLabel': 'What is not sent:',
      'llm.consent.notSent.audio': 'Audio', 'llm.consent.notSent.secret': 'API keys and tokens', 'llm.consent.notSent.other': 'Anything other than the key-point text',
      'llm.consent.hostUnknown': 'The Foundry endpoint configured on the relay server', 'llm.consent.note': 'This consent is saved in this browser (only the fact of consent, the version of what is sent, and the date). Disabling revokes it.',
      'llm.test.ok': 'Connection test: succeeded', 'llm.test.running': 'Testing the connection', 'llm.test.fail.unconfigured': 'Connection test: failed (not configured)', 'llm.test.fail.consent': 'Consent is required first (enable LLM integration and agree)',
      'llm.test.fail.auth': 'Connection test: failed (authentication)', 'llm.test.fail.connection': 'Connection test: failed (connection)', 'llm.test.fail.timeout': 'Connection test: failed (timeout)',
      'llm.lastSent': 'Last content sent',
    },
  });

  const relay = typeof ctx.options.relay === 'function' ? ctx.options.relay : null;
  const sched = ctx.options.scheduler ?? { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };

  // ---- 状態（保存しない。再読込で無効に戻る: AC-312） ----
  let enabled = false;
  let failed = false;
  let unconfigured = null; // null | string[]（直近の有効化の操作で未設定だった項目）
  let consent = null; // null | { host }
  let credentialSet = null; // null（未確認）| boolean
  let lastSent = null;
  let generation = 0;
  let testResult = null; // null | { ok, cause }
  const pending = new Set();
  const track = (p) => { pending.add(p); const done = () => pending.delete(p); p.then(done, done); return p; };

  const statusId = () => (enabled ? (failed ? 'error' : 'enabled') : (unconfigured ? 'unconfigured' : 'disabled'));
  const notify = () => ctx.emit('change', api);
  const say = (key) => ctx.change(() => ctx.setMessage(key));

  // 中継サーバーへ 1 回要求する。タイムアウト・例外は { status: 0, error } にそろえる。
  async function send(method, path, body, timeoutMs) {
    if (!relay) return { status: 0, error: 'unavailable', body: null };
    let timer = null;
    const timeout = new Promise((resolve) => { timer = sched.setTimeout(() => resolve({ status: 0, error: 'timeout', body: null }), timeoutMs); });
    try {
      const res = await Promise.race([(async () => relay({ method, path, body }))(), timeout]);
      return res && typeof res === 'object' && 'status' in res ? res : { status: 0, error: 'connection', body: null };
    } catch { return { status: 0, error: 'connection', body: null }; } finally { if (timer != null) sched.clearTimeout(timer); }
  }

  // 状態の取得（LLM 向けの要求には数えない）。両方の形式（configured オブジェクト／missing 配列）を受け付ける。
  async function readStatus() {
    const res = await send('GET', STATUS_PATH, undefined, TEST_TIMEOUT_MS);
    const b = res.status >= 200 && res.status < 300 && res.body && typeof res.body === 'object' ? res.body : null;
    if (!b) { credentialSet = false; return { missing: [...MISSING_ALL], host: '' }; }
    let missing;
    if (b.configured && typeof b.configured === 'object') missing = MISSING_ALL.filter((k) => !b.configured[k]);
    else if (Array.isArray(b.missing)) missing = [...new Set(b.missing.map((k) => (k === 'apiKey' ? 'credential' : k)).filter((k) => MISSING_ALL.includes(k)))];
    else missing = b.state === 'ready' ? [] : [...MISSING_ALL];
    credentialSet = !missing.includes('credential');
    return { missing, host: typeof b.endpointHost === 'string' ? b.endpointHost : '', reason: b.state === 'error' ? 'error' : null };
  }

  // ---- 同意の保存（事実・版・日時だけ。AC-312・366・367） ----
  const writeConsent = () => { try { ctx.storage.setItem(CONSENT_KEY, JSON.stringify({ version: CONSENT_VERSION, at: ctx.now() })); } catch { /* 保存できなくても動作は続ける */ } };
  const clearConsent = () => { try { ctx.storage.removeItem(CONSENT_KEY); } catch { /* 同上 */ } };
  const consentValid = () => {
    try {
      const r = JSON.parse(ctx.storage.getItem(CONSENT_KEY));
      return !!r && typeof r === 'object' && typeof r.version === 'string' && r.version.length > 0 && r.version === CONSENT_VERSION;
    } catch { return false; }
  };

  // ---- 有効化・同意・無効化 ----
  api.getLlmState = () => ({ status: statusId(), enabled, missing: enabled ? [] : [...(unconfigured ?? [])] });
  api.requestLlmEnable = () => track((async () => {
    if (enabled) return { ok: true, enabled: true };
    const st = await readStatus();
    if (st.missing.length || st.reason) {
      unconfigured = st.missing.length ? st.missing : [];
      consent = null;
      ctx.change(() => { state.message = { key: 'llm.unconfigured', text: `${t('llm.unconfigured')}${unconfigured.map((k) => t(`llm.missing.${k}`)).join(' / ') || t('llm.status.error')}` }; });
      return { ok: false, missing: [...unconfigured] };
    }
    unconfigured = null;
    consent = { host: st.host };
    notify();
    return { ok: true, pending: 'consent' };
  })());
  api.getLlmConsent = () => (consent ? {
    open: true, role: 'alertdialog', label: t('llm.consent.title'),
    kinds: [t('llm.consent.kind.points')],
    host: consent.host || t('llm.consent.hostUnknown'),
    notSent: [t('llm.consent.notSent.audio'), t('llm.consent.notSent.secret'), t('llm.consent.notSent.other')],
    note: t('llm.consent.note'),
    actions: [{ id: 'decline', label: t('llm.consent.decline'), focusable: true }, { id: 'accept', label: t('llm.consent.accept'), focusable: true }],
  } : null);
  api.answerLlmConsent = async (accept) => {
    if (!consent) return { ok: false };
    consent = null;
    if (accept === true) {
      enabled = true; failed = false; unconfigured = null; generation++; writeConsent();
      say('llm.enabledMsg');
    }
    notify();
    return { ok: true, enabled };
  };
  api.disableLlm = async () => {
    generation++; // 処理中の要求の結果は反映しない（AC-315）
    const was = enabled;
    enabled = false; failed = false; unconfigured = null; consent = null; lastSent = null; clearConsent();
    if (was) say('llm.disabledMsg'); else notify();
    return { ok: true };
  };
  api.flushLlm = async () => { while (pending.size) await Promise.allSettled([...pending]); };
  api.getLlmLastSent = () => (enabled && lastSent ? { ...lastSent } : null); // AC-311（マスキング後。キー・トークンを含まない）

  // ---- LLM 向けの要求（有効なときだけ出す。失敗はルールベース描画のまま通知する） ----
  api.llmCall = (path, body) => {
    if (!enabled) return Promise.resolve({ ok: false, reason: 'disabled' });
    const gen = generation;
    const text = maskSecrets(typeof body === 'string' ? body : (body?.input ?? ''));
    lastSent = { path, kind: 'points', text, at: ctx.now() };
    const p = (async () => {
      const res = await send('POST', path, { ...(body && typeof body === 'object' ? body : { input: text }), input: text }, REQUEST_TIMEOUT_MS);
      if (gen !== generation || !enabled) return { ok: false, reason: 'stale' };
      const ok = res.status >= 200 && res.status < 300 && res.body && typeof res.body === 'object';
      if (!ok) { failed = true; say('llm.failed'); return { ok: false, reason: 'failed' }; }
      const recovered = failed; failed = false;
      if (recovered) notify();
      ctx.emit('llm:result', { path, body: res.body });
      return { ok: true, body: res.body };
    })();
    return track(p);
  };
  // 発話からの要求は llmdraw.js（FR-063）が、要点だけを最小化・マスキングして出す。

  // ---- 接続テスト（FR-068 AC-354）: 有効化の状態・図には影響しない ----
  function classify(res) {
    if (res.error === 'timeout') return 'timeout';
    const code = res.body?.error?.code;
    if (res.status === 503 || code === 'not_ready') return 'unconfigured';
    if (res.status === 401 || res.status === 403 || [401, 403].includes(res.body?.error?.upstreamStatus)) return 'auth';
    return 'connection';
  }
  api.testLlmConnection = () => track((async () => {
    // 有効かつ同意済み（有効化は同意の後にだけ成立する）のときだけ中継へ送る。それ以外は中継への要求を 0 件にする
    if (!enabled) { testResult = { ok: false, cause: 'consent' }; }
    else if ((await readStatus()).missing.length) { testResult = { ok: false, cause: 'unconfigured' }; }
    else {
      const res = await send('POST', RESPONSES_PATH, { input: 'ping' }, TEST_TIMEOUT_MS);
      const ok = res.status >= 200 && res.status < 300 && res.body && typeof res.body === 'object';
      testResult = ok ? { ok: true, cause: null } : { ok: false, cause: classify(res) };
    }
    const mk = testResult.ok ? 'llm.test.ok' : `llm.test.fail.${testResult.cause}`;
    ctx.change(() => { state.message = { key: mk, text: t(mk) }; });
    return { ...testResult };
  })());
  api.getLlmTestResult = () => (testResult ? { ...testResult } : null);

  // ---- 設定画面（FR-068）: 切替・状態・認証情報の有無（入力欄なし）・接続テスト ----
  let focusId = null;
  const baseDialog = api.getSettingsDialog;
  const llmFields = () => {
    const id = statusId();
    return [
      { id: 'llm.enabled', label: t('llm.enabled'), role: 'switch', value: enabled, focusable: true, status: { id, text: t(`llm.status.${id}`), icon: ICONS[id] } },
      { id: 'llm.credential', label: t('llm.credential'), focusable: false, status: credentialSet == null ? { id: 'unknown', text: t('llm.credential.unset'), icon: ICONS.unconfigured } : { id: credentialSet ? 'set' : 'unset', text: t(credentialSet ? 'llm.credential.set' : 'llm.credential.unset'), icon: credentialSet ? ICONS.enabled : ICONS.unconfigured } },
      { id: 'llm.test', label: t('llm.test'), role: 'button', focusable: true, status: testResult ? { id: testResult.ok ? 'ok' : 'fail', text: t(testResult.ok ? 'llm.test.ok' : `llm.test.fail.${testResult.cause}`), icon: testResult.ok ? ICONS.enabled : ICONS.error } : { id: 'idle', text: '', icon: '' } },
    ];
  };
  api.getSettingsDialog = () => {
    const d = baseDialog();
    return d ? { ...d, fields: [...d.fields, ...llmFields()] } : null;
  };
  const baseView = api.getSettingsView;
  api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, ...['llm.enabled', 'llm.credential', 'llm.test'].map((id) => ({ id, visible: true }))] }; };
  api.focusSettingsField = (id) => {
    if (!baseDialog()) return false;
    const f = llmFields().find((x) => x.id === id) ?? baseDialog().fields.find((x) => x.id === id);
    if (!f) return false;
    focusId = id; return true;
  };
  api.toggleLlm = () => (enabled ? api.disableLlm() : api.requestLlmEnable());
  ctx.registerCommand('llm.toggle', () => { void api.toggleLlm(); });
  ctx.registerCommand('llm.test', () => { void api.testLlmConnection(); });
  ctx.registerKey({ key: 'g', ctrl: true, alt: true, shift: true, command: 'llm.toggle' });
  ctx.registerKey({ key: 'x', ctrl: true, alt: true, shift: true, command: 'llm.test' });
  ctx.on('change', () => { if (!baseDialog()) focusId = null; });

  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    const k = String(ev?.key);
    const plain = !ev?.ctrlKey && !ev?.altKey && !ev?.shiftKey;
    if (consent && plain && k === 'Escape') { void api.answerLlmConsent(false); return 'llm.consent.decline'; }
    if (baseDialog() && !consent && plain && (k === 'Enter' || k === ' ' || k === 'Space') && focusId === 'llm.enabled') { void api.toggleLlm(); return 'llm.toggle'; }
    if (baseDialog() && !consent && plain && (k === 'Enter' || k === ' ' || k === 'Space') && focusId === 'llm.test') { void api.testLlmConnection(); return 'llm.test'; }
    return baseKey(ev);
  };
  // 設定画面を開いたときに、認証情報の「設定済み／未設定」を中継サーバーから読む（LLM 向けの要求には数えない）
  const baseOpen = ctx.api.commands['settings.open'];
  ctx.registerCommand('settings.open', () => { baseOpen(); if (credentialSet == null && relay) track(readStatus().then(notify)); });

  // 起動時: 保存された同意が現在の版と一致し、設定（AC-313）が揃っているときだけ有効に復帰する。それ以外は無効（再同意が必要）。
  if (relay && consentValid()) {
    const st = await readStatus();
    if (!st.missing.length && !st.reason) { enabled = true; }
  }
}
