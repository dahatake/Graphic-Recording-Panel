// FR-068 AC-514 / FR-062 AC-513 AC-313 / FR-087 AC-506（画面側）の単体・結合テスト（web/src/llm.js のプロバイダーの選択）。
// 中継サーバーはモック。GitHub Copilot SDK・GitHub・Foundry へは通信しない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { copilotMissing, classifyLlmFailure, CONSENT_KEY, CONSENT_KEY_COPILOT, CONSENT_VERSION } from '../../web/src/llm.js';

const ALL = { endpoint: true, deployment: true, credential: true };
const READY_CP = { available: true, unavailableReason: null, authMethod: 'signin', signedIn: true, account: 'dummy-user', tokenConfigured: false, model: 'dummy-model' };
function relayMock({ provider, configured = ALL, copilot = READY_CP, postProvider } = {}) {
  const r = { calls: [], provider, configured, copilot: { ...copilot } };
  r.fn = async ({ method = 'GET', path, body }) => {
    r.calls.push({ method, path, body, provider: r.provider ?? 'foundry' });
    if (path === '/api/llm/status') return { status: 200, body: { ...(r.provider ? { provider: r.provider } : {}), configured: r.configured, endpointHost: 'foundry.example.test', copilot: { ...r.copilot } } };
    if (path === '/api/llm/provider') {
      if (postProvider) return postProvider;
      r.provider = body.provider; return { status: 200, body: { ok: true, result: 'saved', provider: r.provider } };
    }
    return { status: 200, body: { points: ['x'] } };
  };
  r.llm = () => r.calls.filter((c) => c.path.startsWith('/api/llm/') && !['/api/llm/status', '/api/llm/provider'].includes(c.path));
  return r;
}
const mk = async (o) => { const relay = relayMock(o); const ctx = await newApp({ options: { relay: relay.fn } }); await ctx.app.refreshCopilotStatus(); return { ...ctx, relay }; };
const field = (app, id) => app.getSettingsDialog().fields.find((f) => f.id === id);

// FR-087 AC-506: 原因の分類（SDK 未導入 → サインイン／トークンの順で 1 つ）
test('FR-087 AC-506: copilotMissing は SDK・サインイン・トークンの原因を 1 つだけ返す', () => {
  assert.deepEqual(copilotMissing(null), ['sdk']);
  assert.deepEqual(copilotMissing({ available: false, authMethod: 'signin', signedIn: false }), ['sdk']);
  assert.deepEqual(copilotMissing({ available: true, authMethod: 'signin', signedIn: false }), ['signin']);
  assert.deepEqual(copilotMissing({ available: true, authMethod: 'token', signedIn: true, tokenConfigured: false }), ['token']);
  assert.deepEqual(copilotMissing({ available: true, authMethod: 'token', tokenConfigured: true }), []);
  assert.deepEqual(copilotMissing(READY_CP), []);
});

// FR-087 AC-506 AC-505: SDK は導入済みで Copilot CLI を起動できないときは 'cli'（SDK 未導入の 'sdk' と区別する）
test('FR-087 AC-506: copilotMissing は CLI を起動できない（cli_unavailable）を SDK 未導入と区別して cli を返す', () => {
  assert.deepEqual(copilotMissing({ available: false, unavailableReason: 'cli_unavailable', authMethod: 'signin', signedIn: false }), ['cli']);
  assert.deepEqual(copilotMissing({ available: false, unavailableReason: 'sdk_missing' }), ['sdk']);
});

// FR-087 AC-506: CLI を起動できないときの［設定］の状態と、SDK・Copilot CLI の導入・再導入の案内
test('FR-087 AC-506: 原因が cli のとき［設定］に「Copilot CLI を起動できない」と導入・再導入の案内を示し、有効にできない', async () => {
  const a = await mk({ provider: 'copilot', copilot: { ...READY_CP, available: false, unavailableReason: 'cli_unavailable', signedIn: false } });
  const r = await a.app.requestLlmEnable();
  assert.equal(r.ok, false); assert.deepEqual(r.missing, ['cli']);
  a.app.commands['settings.open']();
  const f = field(a.app, 'llm.enabled');
  assert.match(f.status.text, /Copilot CLI を起動できない/);
  assert.ok(!f.status.text.includes('GitHub Copilot SDK が導入されていない'));
  const act = f.status.actions.find((x) => x.id === 'installGuide');
  assert.ok(act && /Copilot CLI/.test(act.text) && /再導入|導入し直/.test(act.text));
  assert.match(a.app.runSettingsAction('installGuide').text, /Copilot CLI/);
  assert.equal(a.relay.llm().length, 0, 'LLM 向けの要求は 0 件');
});

// FR-087 AC-506: 失敗の原因の分類（認証・利用の上限・接続・タイムアウト・不正な応答）
test('FR-087 AC-506: classifyLlmFailure は秘密を見ずに原因の分類を返す', () => {
  assert.equal(classifyLlmFailure({ status: 0, error: 'timeout' }), 'timeout');
  assert.equal(classifyLlmFailure({ status: 401, body: { error: { code: 'auth', message: 'token=xyz' } } }), 'auth');
  assert.equal(classifyLlmFailure({ status: 502, body: { error: { upstreamStatus: 403 } } }), 'auth');
  assert.equal(classifyLlmFailure({ status: 429, body: {} }), 'rateLimit');
  assert.equal(classifyLlmFailure({ status: 502, body: { error: { code: 'connection' } } }), 'connection');
  assert.equal(classifyLlmFailure({ status: 0, error: 'connection' }), 'connection');
  assert.equal(classifyLlmFailure({ status: 200, body: '<<not json>>' }), 'invalid');
  // AC-518: 中継サーバーが CLI の起動を含めて PARAM-069 で打ち切ったときもタイムアウト
  assert.equal(classifyLlmFailure({ status: 504, body: { error: { code: 'upstream_timeout' } } }), 'timeout');
});

// FR-068 AC-514: 初期値は Microsoft Foundry。選択は中継サーバーへ保存し、もう一方の設定を消す要求は送らない
test('FR-068 AC-514: 既定は foundry。setLlmProvider は POST /api/llm/provider だけを送り、再作成後も中継サーバーの値に従う', async () => {
  const a = await mk();
  assert.equal(a.app.getLlmProvider(), 'foundry');
  a.app.commands['settings.open']();
  const f = field(a.app, 'llm.provider');
  assert.equal(f.value, 'foundry'); assert.equal(f.role, 'radiogroup');
  assert.deepEqual(f.options.map((o) => [o.value, o.label]), [['foundry', 'Microsoft Foundry'], ['copilot', 'GitHub Copilot']]);
  const r = await a.app.setLlmProvider('copilot');
  assert.equal(r.ok, true); assert.equal(a.app.getLlmProvider(), 'copilot');
  assert.deepEqual(a.relay.calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path, c.body]), [['POST', '/api/llm/provider', { provider: 'copilot' }]]);
  assert.equal((await a.app.setLlmProvider('openai')).ok, false, '不正な値は送らない');
  const b = await a.createApp({ ...a.env.options, relay: a.relay.fn }); await b.refreshCopilotStatus();
  assert.equal(b.getLlmProvider(), 'copilot');
  assert.ok(a.app.getSettingsView().fields.some((x) => x.id === 'llm.provider'), '狭い画面でも項目が欠けない');
});

// FR-068 AC-514: キーボード（矢印キー）だけで選べる
test('FR-068 AC-514: llm.provider にフォーカスして矢印キーで次・前の選択肢を選べる', async () => {
  const { app } = await mk();
  app.commands['settings.open']();
  assert.equal(app.focusSettingsField('llm.provider'), true);
  assert.equal(app.handleKey({ key: 'ArrowRight' }), 'llm.provider');
  await app.flushLlm();
  assert.equal(app.getLlmProvider(), 'copilot');
  app.handleKey({ key: 'ArrowLeft' }); await app.flushLlm();
  assert.equal(app.getLlmProvider(), 'foundry');
});

// FR-068 AC-514 異常系: 保存に失敗したら元の選択に戻し、理由を示す（環境変数で指定されているときを含む）
test('FR-068 AC-514 異常系: 保存できないときは元に戻り、環境変数で指定されている旨・失敗が示される', async () => {
  const env = await mk({ postProvider: { status: 409, body: { ok: false, result: 'env_managed' } } });
  const r = await env.app.setLlmProvider('copilot');
  assert.deepEqual([r.ok, r.reason], [false, 'env_managed']);
  assert.equal(env.app.getLlmProvider(), 'foundry');
  assert.equal(env.app.getState().message.key, 'llm.provider.envManaged');
  const down = await mk({ postProvider: { status: 0, error: 'connection', body: null } });
  assert.equal((await down.app.setLlmProvider('copilot')).ok, false);
  assert.equal(down.app.getLlmProvider(), 'foundry');
  assert.equal(down.app.getState().message.key, 'llm.provider.failed');
});

// FR-062 AC-513: 同意はプロバイダーごとの別の記録。従来の記録は Foundry への同意
test('FR-062 AC-513: Foundry は {version, at}、Copilot は {version, at, provider}。切替で同意済みのプロバイダーは再同意なしに有効', async () => {
  const a = await mk();
  await a.app.requestLlmEnable(); await a.app.answerLlmConsent(true);
  assert.deepEqual(Object.keys(JSON.parse(a.env.storage.getItem(CONSENT_KEY))).sort(), ['at', 'version']);
  await a.app.setLlmProvider('copilot');
  assert.equal(a.app.getLlmState().enabled, false);
  const r = await a.app.requestLlmEnable();
  assert.equal(r.pending, 'consent');
  const c = a.app.getLlmConsent();
  assert.match(c.host, /GitHub Copilot/); assert.equal(c.model, 'dummy-model');
  await a.app.answerLlmConsent(true);
  const cRec = JSON.parse(a.env.storage.getItem(CONSENT_KEY_COPILOT));
  assert.deepEqual(Object.keys(cRec).sort(), ['at', 'provider', 'version']);
  assert.equal(cRec.provider, 'copilot'); assert.equal(cRec.version, CONSENT_VERSION);
  await a.app.setLlmProvider('foundry');
  assert.equal(a.app.getLlmState().enabled, true);
  // モデル名が空のときは SDK の既定である旨
  a.relay.copilot.model = '';
  await a.app.setLlmProvider('copilot'); await a.app.disableLlm();
  await a.app.requestLlmEnable();
  assert.ok(a.app.getLlmConsent().model.trim() && a.app.getLlmConsent().model !== '');
  await a.app.answerLlmConsent(false);
  assert.equal(a.env.storage.getItem(CONSENT_KEY_COPILOT), null, '拒否・無効化で Copilot の記録だけ消える');
  assert.ok(a.env.storage.getItem(CONSENT_KEY), 'Foundry の記録は残る');
});

// FR-062 AC-513 異常系: provider の値が違う記録・版の違う記録は同意として扱わない
test('FR-062 AC-513 異常系: Copilot のキーに provider のない記録、Foundry のキーに provider:copilot の記録は無効', async () => {
  const a = await mk({ provider: 'copilot' });
  a.env.storage.setItem(CONSENT_KEY_COPILOT, JSON.stringify({ version: CONSENT_VERSION, at: 1 }));
  const b = await a.createApp({ ...a.env.options, relay: a.relay.fn });
  assert.equal(b.getLlmState().enabled, false);
  a.relay.provider = 'foundry';
  a.env.storage.setItem(CONSENT_KEY, JSON.stringify({ version: CONSENT_VERSION, at: 1, provider: 'copilot' }));
  const c = await a.createApp({ ...a.env.options, relay: a.relay.fn });
  assert.equal(c.getLlmState().enabled, false);
});

// FR-087 AC-506（画面側）・AC-313: 選んだプロバイダーの未設定の項目と次の行動
test('FR-087 AC-506: Copilot が使えないときは状態に原因と次の行動、Foundry のときは Foundry の項目で判定（AC-313）', async () => {
  const a = await mk({ provider: 'copilot', copilot: { ...READY_CP, signedIn: false } });
  a.app.commands['settings.open']();
  const st = field(a.app, 'llm.enabled').status;
  assert.match(st.text, /GitHub にサインインしていない/);
  assert.deepEqual(st.actions.map((x) => x.id), ['openApiKeys']);
  const r = await a.app.requestLlmEnable();
  assert.deepEqual([r.ok, r.missing], [false, ['signin']]);
  assert.match(a.app.getState().message.text, /GitHub Copilot/);
  assert.equal(a.relay.llm().length, 0);
  const g = a.app.runSettingsAction('installGuide');
  assert.ok(g.ok && g.text.includes('pip install'));
  assert.equal(a.app.runSettingsAction('nope').ok, false);
  a.app.runSettingsAction('openApiKeys');
  assert.ok(a.app.getApiKeysDialog(), '接続キー画面が開く');
  assert.equal(a.app.getSettingsDialog(), null, '［設定］は閉じる');
  const f = await mk({ configured: { ...ALL, deployment: false }, copilot: { ...READY_CP, available: false } });
  const rf = await f.app.requestLlmEnable();
  assert.deepEqual(rf.missing, ['deployment']);
  f.app.commands['settings.open']();
  assert.equal(field(f.app, 'llm.enabled').status.actions, undefined, 'Foundry のときは Copilot の行動を出さない');
});

// FR-087 AC-506 異常系: 有効なまま失敗したら原因の分類を短く通知する
test('FR-087 AC-506 異常系: 失敗の通知は 80 文字以内で原因の分類を含み、秘密を含まない', async () => {
  for (const [res, re] of [[{ status: 401, body: { ok: false, error: { code: 'auth', message: 'Bearer SECRET-PROBE' } } }, /認証/], [{ status: 429, body: { ok: false, error: { code: 'rate_limit' } } }, /上限/], [{ status: 502, body: { ok: false, error: { code: 'connection' } } }, /接続/]]) {
    const relay = relayMock({ provider: 'copilot' });
    const base = relay.fn;
    relay.fn = async (q) => (['/api/llm/status', '/api/llm/provider'].includes(q.path) ? base(q) : (relay.calls.push(q), res));
    const { app } = await newApp({ options: { relay: relay.fn } });
    await app.refreshCopilotStatus();
    await app.requestLlmEnable(); await app.answerLlmConsent(true);
    await app.llmCall('/api/llm/extract', { input: 'x' });
    const m = app.getState().message;
    assert.match(m.text, re); assert.ok(m.text.length <= 80); assert.ok(!m.text.includes('SECRET-PROBE'));
  }
});
