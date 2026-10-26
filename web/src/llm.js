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
const PROVIDER_PATH = '/api/llm/provider';
const MISSING_ALL = ['endpoint', 'deployment', 'credential'];
const ICONS = { disabled: '○', enabled: '●', unconfigured: '▲', error: '✖' };

export const maskSecrets = (text) => String(text ?? '')
  .replace(/Bearer\s+\S+/gi, '[masked]')
  .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[masked]')
  .replace(/[A-Za-z0-9_+/=-]{32,}/g, '[masked]');

// FR-062 AC-312・AC-367: 同意の記録（ブラウザのローカル設定だけ）。送信内容（種類・項目）を変えたら版を上げて再同意を求める。
// FR-062 AC-513: 同意は LLMのプロバイダーごとに別の記録。Microsoft Foundry は従来のキーと形（{version, at}。provider を持たない）、
// GitHub Copilot は CONSENT_KEY_COPILOT に {version, at, provider:'copilot'}。一方の作成・削除は他方を変えない。
export const CONSENT_KEY = 'grp.llm.consent';
export const CONSENT_KEY_COPILOT = 'grp.llm.consent.copilot';
export const CONSENT_VERSION = 'send-v2:points+scene+drawStyle+partKeys';
// FR-068 AC-514: LLMのプロバイダー（既定は Microsoft Foundry）。選択の保存先は中継サーバー（POST /api/llm/provider）
export const PROVIDERS = ['foundry', 'copilot'];
export const DEFAULT_PROVIDER = 'foundry';
// FR-087 AC-506: GitHub Copilot を使えない原因（中継サーバーの relay_copilot.readiness と同じ順で 1 つだけ返す）
export function copilotMissing(cp) {
  // SDK は導入済みでも、SDK が使う Copilot CLI を起動できないときは 'cli'（SDK 未導入と区別する）
  if (!cp || typeof cp !== 'object' || cp.available !== true) return [cp && typeof cp === 'object' && cp.unavailableReason === 'cli_unavailable' ? 'cli' : 'sdk'];
  if (cp.authMethod === 'token') return cp.tokenConfigured === true ? [] : ['token'];
  return cp.signedIn === true ? [] : ['signin'];
}
// FR-087 AC-506: LLM 向けの要求の失敗の原因の分類（秘密を含む本文は見ない）
export function classifyLlmFailure(res) {
  if (!res || res.error === 'timeout') return 'timeout';
  const code = String(res.body?.error?.code ?? '');
  if (res.status >= 200 && res.status < 300) return 'invalid'; // 不正な応答（AC-506）
  // 要求の途中で Copilot CLI を起動できなかった（中継サーバーの 503・cli_unavailable。AC-505・AC-518 (3)）。「接続」とは区別する
  if (code === 'cli_unavailable') return 'cli';
  // 中継サーバーが PARAM-069 で打ち切った（CLI の起動・SDK の初期化を含む。AC-518）もタイムアウト
  if (res.status === 504 || code === 'upstream_timeout') return 'timeout';
  if (res.status === 401 || res.status === 403 || code === 'auth' || [401, 403].includes(res.body?.error?.upstreamStatus)) return 'auth';
  if (res.status === 429 || code === 'rate_limit' || res.body?.error?.upstreamStatus === 429) return 'rateLimit';
  return 'connection';
}

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
      'llm.provider': 'プロバイダー', 'llm.provider.foundry': 'Microsoft Foundry', 'llm.provider.copilot': 'GitHub Copilot',
      'llm.provider.changed': 'LLM のプロバイダーを変更しました: ', 'llm.provider.failed': 'LLM のプロバイダーを変更できませんでした。中継サーバーを確認してください',
      'llm.provider.envManaged': 'LLM のプロバイダーは環境変数／設定ファイルで指定されているため、画面からは変更できません',
      'llm.missing.sdk': 'GitHub Copilot SDK が導入されていない', 'llm.missing.cli': 'Copilot CLI を起動できない', 'llm.missing.signin': 'GitHub にサインインしていない', 'llm.missing.token': 'トークンが未設定',
      'llm.unconfigured.copilot': 'GitHub Copilot を使えません。原因: ',
      'llm.action.installGuide': '導入の手順', 'llm.action.openApiKeys': '接続キーを開く',
      'llm.installGuide.text': '中継サーバーの Python 環境で pip install -r server/requirements-copilot.txt を実行し、中継サーバーを起動し直してください',
            'llm.installGuide.cli': 'Copilot CLI を起動できません。中継サーバーの Python 環境で pip install --force-reinstall -r server/requirements-copilot.txt を実行して SDK と同梱の Copilot CLI を導入し直すか、Copilot CLI（npm install -g @github/copilot）を導入・再導入して copilot が PATH にある（または環境変数 COPILOT_CLI_PATH で指定する）ことを確かめ、中継サーバーを起動し直してください',      'llm.consent.hostCopilot': 'GitHub Copilot（GitHub のサービス）', 'llm.consent.model': '使うモデル', 'llm.consent.modelDefault': 'GitHub Copilot SDK の既定のモデル',
      'llm.failed.auth': 'LLM 連携に失敗しました（認証）。通常の描画で表示しています', 'llm.failed.rateLimit': 'LLM 連携に失敗しました（利用の上限）。通常の描画で表示しています',
      'llm.failed.connection': 'LLM 連携に失敗しました（接続）。通常の描画で表示しています', 'llm.failed.timeout': 'LLM 連携に失敗しました（タイムアウト）。通常の描画で表示しています',
      'llm.failed.invalid': 'LLM 連携に失敗しました（不正な応答）。通常の描画で表示しています',
      'llm.guide.text': '生成 AI を使うと、発話の要点から図を描けます（既定はオフ）。使うには［設定］画面で LLM 連携を有効にし、送信内容を確認して同意してください。閉じても生成 AI なしの描画は続きます', 'llm.guide.dismiss': '閉じる', 'llm.guide.open': '設定を開く',
      'llm.failed.cli': 'LLM 連携に失敗しました（Copilot CLI を起動できない）。LLM 連携を無効にし、通常の描画で表示しています',
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
      'llm.provider': 'Provider', 'llm.provider.foundry': 'Microsoft Foundry', 'llm.provider.copilot': 'GitHub Copilot',
      'llm.provider.changed': 'LLM provider changed: ', 'llm.provider.failed': 'The LLM provider could not be changed. Check the relay server',
      'llm.provider.envManaged': 'The LLM provider is set by an environment variable or config file, so it cannot be changed here',
      'llm.missing.sdk': 'GitHub Copilot SDK is not installed', 'llm.missing.cli': 'Copilot CLI cannot be started', 'llm.missing.signin': 'Not signed in to GitHub', 'llm.missing.token': 'Token is not set',
      'llm.unconfigured.copilot': 'GitHub Copilot cannot be used. Cause: ',
      'llm.action.installGuide': 'Setup steps', 'llm.action.openApiKeys': 'Open API Keys',
      'llm.installGuide.text': 'Run pip install -r server/requirements-copilot.txt in the relay server\'s Python environment, then restart the relay server',
            'llm.installGuide.cli': 'Copilot CLI cannot be started. Reinstall the SDK and its bundled Copilot CLI with pip install --force-reinstall -r server/requirements-copilot.txt in the relay server\'s Python environment, or install/reinstall Copilot CLI (npm install -g @github/copilot) and make sure copilot is on PATH (or set COPILOT_CLI_PATH), then restart the relay server',      'llm.consent.hostCopilot': 'GitHub Copilot (a GitHub service)', 'llm.consent.model': 'Model', 'llm.consent.modelDefault': 'The default model of GitHub Copilot SDK',
      'llm.failed.auth': 'LLM integration failed (authentication); showing the normal drawing', 'llm.failed.rateLimit': 'LLM integration failed (usage limit); showing the normal drawing',
      'llm.failed.connection': 'LLM integration failed (connection); showing the normal drawing', 'llm.failed.timeout': 'LLM integration failed (timeout); showing the normal drawing',
      'llm.failed.invalid': 'LLM integration failed (invalid response); showing the normal drawing',
      'llm.guide.text': 'With generative AI, the diagram can be drawn from the key points of what is said (off by default). To use it, enable LLM integration in Settings, check what is sent and consent. Drawing without generative AI continues even if you close this', 'llm.guide.dismiss': 'Close', 'llm.guide.open': 'Open Settings',
      'llm.failed.cli': 'LLM integration failed (Copilot CLI cannot be started); disabled it and showing the normal drawing',
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
  let provider = DEFAULT_PROVIDER; // FR-068 AC-514（中継サーバーの保存に従う）
  let cp = null; // GitHub Copilot の状態（GET /api/llm/status の copilot。トークンの値は持たない）
  let providerEpoch = 0; // 画面でプロバイダーを選ぶたびに増やす
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
  // プロバイダーの選択（provider。無いときは foundry）と GitHub Copilot の状態（copilot）も読み、選ばれたプロバイダーの未設定の項目を返す。
  const pickCopilot = (c) => (c && typeof c === 'object' ? {
    available: c.available === true, unavailableReason: typeof c.unavailableReason === 'string' ? c.unavailableReason : null,
    authMethod: c.authMethod === 'token' ? 'token' : 'signin', signedIn: c.signedIn === true,
    account: typeof c.account === 'string' ? c.account : null, tokenConfigured: c.tokenConfigured === true,
    model: typeof c.model === 'string' ? c.model : '',
  } : null);
  async function readStatus() {
    const epoch = providerEpoch;
    const res = await send('GET', STATUS_PATH, undefined, TEST_TIMEOUT_MS);
    const b = res.status >= 200 && res.status < 300 && res.body && typeof res.body === 'object' ? res.body : null;
    if (!b) { credentialSet = false; return { missing: provider === 'copilot' ? copilotMissing(cp) : [...MISSING_ALL], host: '', provider }; }
    let missing;
    if (b.configured && typeof b.configured === 'object') missing = MISSING_ALL.filter((k) => !b.configured[k]);
    else if (Array.isArray(b.missing)) missing = [...new Set(b.missing.map((k) => (k === 'apiKey' ? 'credential' : k)).filter((k) => MISSING_ALL.includes(k)))];
    else missing = b.state === 'ready' ? [] : [...MISSING_ALL];
    credentialSet = !missing.includes('credential');
    if ('copilot' in b) cp = pickCopilot(b.copilot);
    // 読んでいる間に画面で選択を変えたときは、古い応答のプロバイダーで上書きしない
    const p = epoch !== providerEpoch ? provider : (PROVIDERS.includes(b.provider) ? b.provider : DEFAULT_PROVIDER);
    const switched = p !== provider;
    if (switched) switchTo(p);
    const r = provider === 'copilot'
      ? { missing: copilotMissing(cp), host: '', reason: null, provider }
      : { missing, host: typeof b.endpointHost === 'string' ? b.endpointHost : '', reason: b.state === 'error' ? 'error' : null, provider };
    if (switched) { enabled = consentValid(provider) && !r.missing.length && !r.reason; notify(); }
    return r;
  }

  // ---- 同意の保存（事実・版・日時だけ。AC-312・366・367。プロバイダーごとに別の記録: AC-513） ----
  const consentKey = (p) => (p === 'copilot' ? CONSENT_KEY_COPILOT : CONSENT_KEY);
  const writeConsent = (p) => {
    const rec = p === 'copilot' ? { version: CONSENT_VERSION, at: ctx.now(), provider: 'copilot' } : { version: CONSENT_VERSION, at: ctx.now() };
    try { ctx.storage.setItem(consentKey(p), JSON.stringify(rec)); } catch { /* 保存できなくても動作は続ける */ }
  };
  const clearConsent = (p) => { try { ctx.storage.removeItem(consentKey(p)); } catch { /* 同上 */ } };
  // Foundry の記録は provider を持たない（2026-10-24 より前の記録も同じ形で Foundry への同意）。Copilot の記録は provider:'copilot' を持つ
  const consentValid = (p = provider) => {
    try {
      const r = JSON.parse(ctx.storage.getItem(consentKey(p)));
      if (!r || typeof r !== 'object' || typeof r.version !== 'string' || r.version !== CONSENT_VERSION) return false;
      return p === 'copilot' ? r.provider === 'copilot' : (r.provider === undefined || r.provider === 'foundry');
    } catch { return false; }
  };

  // ---- プロバイダーの切替（AC-513・AC-514）: 有効かどうかは、そのプロバイダーへの同意と設定で決まる ----
  // 処理中の要求の結果は反映しない。状態を読み直すまでは、同意だけで仮に決め、読み直した後に設定でも確かめる。
  function switchTo(p) {
    provider = p; generation++;
    failed = false; unconfigured = null; consent = null; testResult = null; lastSent = null;
    enabled = consentValid(p) && (p !== 'copilot' || !copilotMissing(cp).length);
  }

  // ---- 有効化・同意・無効化 ----
  api.getLlmState = () => ({ status: statusId(), enabled, missing: enabled ? [] : [...(unconfigured ?? [])] });
  const missingText = (items) => items.map((k) => t(`llm.missing.${k}`)).join(' / ');
  api.requestLlmEnable = () => track((async () => {
    if (enabled) return { ok: true, enabled: true };
    const st = await readStatus();
    if (st.missing.length || st.reason) {
      unconfigured = st.missing.length ? st.missing : [];
      consent = null;
      const head = st.provider === 'copilot' ? t('llm.unconfigured.copilot') : t('llm.unconfigured');
      ctx.change(() => { state.message = { key: 'llm.unconfigured', text: `${head}${missingText(unconfigured) || t('llm.status.error')}` }; });
      return { ok: false, missing: [...unconfigured] };
    }
    unconfigured = null;
    if (consentValid(st.provider)) { // 同意済みのプロバイダー（AC-513: 再同意なしに有効）
      enabled = true; failed = false; generation++;
      say('llm.enabledMsg');
      return { ok: true, enabled: true };
    }
    consent = { host: st.host, provider: st.provider, model: st.provider === 'copilot' ? (cp?.model ?? '') : null };
    notify();
    return { ok: true, pending: 'consent' };
  })());
  api.getLlmConsent = () => (consent ? {
    open: true, role: 'alertdialog', label: t('llm.consent.title'),
    kinds: [t('llm.consent.kind.points')],
    host: consent.provider === 'copilot' ? t('llm.consent.hostCopilot') : (consent.host || t('llm.consent.hostUnknown')),
    ...(consent.provider === 'copilot' ? { provider: 'copilot', model: consent.model || t('llm.consent.modelDefault') } : { provider: 'foundry' }),
    notSent: [t('llm.consent.notSent.audio'), t('llm.consent.notSent.secret'), t('llm.consent.notSent.other')],
    note: t('llm.consent.note'),
    actions: [{ id: 'decline', label: t('llm.consent.decline'), focusable: true }, { id: 'accept', label: t('llm.consent.accept'), focusable: true }],
  } : null);
  api.answerLlmConsent = async (accept) => {
    if (!consent) return { ok: false };
    const forProvider = consent.provider ?? provider;
    consent = null;
    if (accept === true && forProvider === provider) {
      enabled = true; failed = false; unconfigured = null; generation++; writeConsent(provider);
      say('llm.enabledMsg');
    }
    notify();
    return { ok: true, enabled };
  };
  api.disableLlm = async () => {
    generation++; // 処理中の要求の結果は反映しない（AC-315）
    const was = enabled;
    enabled = false; failed = false; unconfigured = null; consent = null; lastSent = null; clearConsent(provider); // 選ばれたプロバイダーの記録だけを取り消す（AC-513）
    if (was) say('llm.disabledMsg'); else notify();
    return { ok: true };
  };

  // ---- LLMのプロバイダー（FR-068 AC-514）。保存先は中継サーバー。もう一方の設定は消さない ----
  api.getLlmProvider = () => provider;
  api.setLlmProvider = (id) => track((async () => {
    if (!PROVIDERS.includes(id)) return { ok: false, reason: 'invalid' };
    if (!relay) { say('llm.provider.failed'); return { ok: false, reason: 'unavailable' }; }
    const prev = provider;
    providerEpoch++;
    if (id !== prev) { switchTo(id); notify(); } // 画面はすぐに切り替える（保存に失敗したら戻す）
    const res = await send('POST', PROVIDER_PATH, { provider: id }, TEST_TIMEOUT_MS);
    const ok = res.status >= 200 && res.status < 300 && res.body?.ok !== false;
    if (!ok) {
      if (provider !== prev) switchTo(prev);
      await readStatus();
      const key = res.body?.result === 'env_managed' ? 'llm.provider.envManaged' : 'llm.provider.failed';
      say(key);
      return { ok: false, reason: res.body?.result === 'env_managed' ? 'env_managed' : 'failed' };
    }
    const st = await readStatus();
    if (provider === id) enabled = consentValid(id) && !st.missing.length && !st.reason;
    ctx.change(() => { state.message = { key: 'llm.provider.changed', text: `${t('llm.provider.changed')}${t(`llm.provider.${provider}`)}` }; });
    return { ok: provider === id, provider };
  })());
  // 状態を読み直して、プロバイダーの選択と GitHub Copilot の状態を画面に反映する（AC-506・AC-514）
  api.refreshLlmStatus = () => readStatus().then(async (st) => {
    // 有効なまま GitHub Copilot を使えなくなった（このアプリでのサインアウトなど。AC-511）ときは無効にし、AC-506 の原因を示す
    if (enabled && provider === 'copilot' && st.missing.length) { enabled = false; unconfigured = [...st.missing]; generation++; }
    await api.refreshCopilotKeysStatus?.();  // 接続キー画面の GitHub Copilot の分類の状態（FR-088。copilotkeys.js）も読み直す
    notify();
    return { provider, missing: [...st.missing] };
  });
  api.refreshCopilotStatus = api.refreshLlmStatus;
  // FR-087 AC-506（監査 A-240・A-242・D-1）/ FR-062 AC-312（例外）: 有効なまま Copilot CLI を起動できなかったとき。
  // 自動で無効に戻し、「有効にできない」状態（原因 cli）を示す。同意の記録は消さない。状態は中継サーバーの原因から導き、保存しない。
  function enterCliUnavailable() {
    enabled = false; failed = false; consent = null; lastSent = null; generation++; // 処理中の要求の結果は反映しない
    cp = { ...(cp ?? {}), available: false, unavailableReason: 'cli_unavailable' };
    unconfigured = ['cli'];
  }
  // 確かめ直し（状態の取得）。契機は［設定］を開く・接続テスト・再読込だけ（周期的にはしない）。
  // GitHub Copilot への同意の記録があり、使えない原因がなくなっていれば、再同意なしで有効に戻す（AC-513。AC-366 の撤回とは別）。
  async function recheck() {
    const st = await readStatus();
    if (provider === 'copilot') {
      if (!enabled && consentValid('copilot') && !st.missing.length && !st.reason) {
        enabled = true; failed = false; unconfigured = null; consent = null; generation++;
      } else if (enabled && st.missing.length) {
        enabled = false; unconfigured = [...st.missing]; generation++;
      } else if (!enabled && unconfigured && st.missing.length) {
        unconfigured = [...st.missing];
      }
    }
    return st;
  }
  api.getCopilotStatus = () => (cp ? { ...cp, missing: copilotMissing(cp) } : null);
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
      if (!ok) {
        const cause = classifyLlmFailure(res);
        if (cause === 'cli') enterCliUnavailable(); else failed = true;
        say(`llm.failed.${cause}`);
        return { ok: false, reason: 'failed' };
      }
      const recovered = failed; failed = false;
      if (recovered) notify();
      ctx.emit('llm:result', { path, body: res.body, sentChars: [...text].length }); // sentChars: 使用額の概算用（AC-526）
      return { ok: true, body: res.body };
    })();
    return track(p);
  };
  // ---- 初回の導入の案内（FR-062 AC-534）: 同意の記録がなく有効でないあいだ表示する。閉じても無効のまま（保存しない。再読込で再び出る） ----
  let guideDismissed = false;
  const anyConsentRecord = () => { try { return !!(ctx.storage.getItem(CONSENT_KEY) || ctx.storage.getItem(CONSENT_KEY_COPILOT)); } catch { return false; } };
  api.getLlmGuide = () => ({ visible: !guideDismissed && !enabled && !anyConsentRecord(), text: t('llm.guide.text'), dismissLabel: t('llm.guide.dismiss'), openLabel: t('llm.guide.open') });
  api.dismissLlmGuide = async () => { if (!guideDismissed) { guideDismissed = true; notify(); } return { ok: true }; };
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
    // 「有効にできない」状態（同意の記録はある）では、接続テストを確かめ直しの契機にする（AC-506）
    // 起動時から原因があり、有効にする操作をしていない（unconfigured が null）ときも、状態の取得の結果で判断する（AC-354 の例外）
    const st = !enabled && provider === 'copilot' && consentValid('copilot') ? await recheck() : null;
    const blocked = !enabled && (st?.missing.length ? [...st.missing] : null);
    if (blocked && !unconfigured?.length) unconfigured = blocked; // ［設定］の状態に原因と次の行動を示す（AC-506）
    // 有効かつ同意済み（有効化は同意の後にだけ成立する）のときだけ中継へ送る。それ以外は中継への要求を 0 件にする
    if (!enabled) { testResult = { ok: false, cause: blocked ? 'unconfigured' : 'consent' }; }
    else if ((await readStatus()).missing.length) { testResult = { ok: false, cause: 'unconfigured' }; }
    else {
      const res = await send('POST', RESPONSES_PATH, { input: 'ping' }, TEST_TIMEOUT_MS);
      const ok = res.status >= 200 && res.status < 300 && res.body && typeof res.body === 'object';
      if (!ok && res.body?.error?.code === 'cli_unavailable') enterCliUnavailable();
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
    // GitHub Copilot を選んで使えないとき（AC-506）: 原因と次の行動を状態に示す
    const causes = !enabled && provider === 'copilot' ? (unconfigured?.length ? unconfigured : (cp ? copilotMissing(cp) : [])) : [];
    const actions = causes.map((k) => (k === 'sdk' || k === 'cli'
      ? { id: 'installGuide', label: t('llm.action.installGuide'), text: t(k === 'cli' ? 'llm.installGuide.cli' : 'llm.installGuide.text'), focusable: true }
      : { id: 'openApiKeys', label: t('llm.action.openApiKeys'), focusable: true }));
    const stText = causes.length ? `${t(`llm.status.${id === 'disabled' ? 'unconfigured' : id}`)}: ${missingText(causes)}` : t(`llm.status.${id}`);
    return [
      { id: 'llm.provider', label: t('llm.provider'), role: 'radiogroup', value: provider, focusable: true,
        options: PROVIDERS.map((p) => ({ value: p, label: t(`llm.provider.${p}`), selected: p === provider })) },
      { id: 'llm.enabled', label: t('llm.enabled'), role: 'switch', value: enabled, focusable: true, status: { id, text: stText, icon: ICONS[causes.length ? 'unconfigured' : id], ...(causes.length ? { causes: [...causes], actions } : {}) } },
      { id: 'llm.credential', label: t('llm.credential'), focusable: false, status: credentialSet == null ? { id: 'unknown', text: t('llm.credential.unset'), icon: ICONS.unconfigured } : { id: credentialSet ? 'set' : 'unset', text: t(credentialSet ? 'llm.credential.set' : 'llm.credential.unset'), icon: credentialSet ? ICONS.enabled : ICONS.unconfigured } },
      { id: 'llm.test', label: t('llm.test'), role: 'button', focusable: true, status: testResult ? { id: testResult.ok ? 'ok' : 'fail', text: t(testResult.ok ? 'llm.test.ok' : `llm.test.fail.${testResult.cause}`), icon: testResult.ok ? ICONS.enabled : ICONS.error } : { id: 'idle', text: '', icon: '' } },
    ];
  };
  api.getSettingsDialog = () => {
    const d = baseDialog();
    return d ? { ...d, fields: [...d.fields, ...llmFields()] } : null;
  };
  const baseView = api.getSettingsView;
  api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, ...['llm.provider', 'llm.enabled', 'llm.credential', 'llm.test'].map((id) => ({ id, visible: true }))] }; };
  api.focusSettingsField = (id) => {
    if (!baseDialog()) return false;
    const f = llmFields().find((x) => x.id === id) ?? baseDialog().fields.find((x) => x.id === id);
    if (!f) { focusId = null; return false; }
    focusId = id; return true;
  };
  // ［設定］の LLM 連携の状態に示した次の行動（AC-506）
  api.runSettingsAction = (id) => {
    if (id === 'installGuide') { // 原因が Copilot CLI を起動できないときは、SDK・Copilot CLI の導入・再導入の案内（AC-506）
      const guide = llmFields().find((f) => f.id === 'llm.enabled')?.status?.actions?.find((a) => a.id === 'installGuide');
      return { ok: true, text: guide?.text ?? t('llm.installGuide.text') };
    }
    if (id === 'openApiKeys') { // 接続キー画面の GitHub Copilot の分類を開く
      ctx.api.commands['settings.close']?.();
      const r = ctx.api.commands['apiKeys.open']?.();
      api.selectApiKeysCategory?.('copilot');
      return { ok: !!r?.ok };
    }
    return { ok: false, reason: 'unknown' };
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
    // プロバイダーの選択（radiogroup）: 矢印キーで次・前の選択肢（AC-514）
    if (baseDialog() && !consent && plain && focusId === 'llm.provider' && ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(k)) {
      const dir = k === 'ArrowDown' || k === 'ArrowRight' ? 1 : PROVIDERS.length - 1;
      void api.setLlmProvider(PROVIDERS[(PROVIDERS.indexOf(provider) + dir) % PROVIDERS.length]);
      return 'llm.provider';
    }
    return baseKey(ev);
  };
  // 設定画面を開いたときに、認証情報の「設定済み／未設定」とプロバイダーを中継サーバーから読む（LLM 向けの要求には数えない）。
  // ［設定］を開くことは AC-506 の確かめ直しの契機でもある（GitHub Copilot を選んでいるときは毎回読み直す）
  const baseOpen = ctx.api.commands['settings.open'];
  ctx.registerCommand('settings.open', () => {
    baseOpen();
    if (!relay) return;
    if (provider === 'copilot') track(recheck().then(notify));
    else if (credentialSet == null) track(readStatus().then(notify));
  });

  // 起動時: 選ばれたプロバイダーへの同意が現在の版と一致し、設定（AC-313・AC-506）が揃っているときだけ有効に復帰する。それ以外は無効（再同意が必要）。
  if (relay && (consentValid('foundry') || consentValid('copilot'))) {
    const st = await readStatus();
    enabled = consentValid(provider) && !st.missing.length && !st.reason;
  }
}
