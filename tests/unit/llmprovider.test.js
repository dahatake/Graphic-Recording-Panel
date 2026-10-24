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

// FR-087 AC-506（監査 A-240・A-242）: 中継サーバーの cli_unavailable は「接続」ではなく cli、不正な応答は invalid に分類する
test('FR-087 AC-506: classifyLlmFailure は cli_unavailable（503）を cli、2xx の不正な応答を invalid に分類する', () => {
  assert.equal(classifyLlmFailure({ status: 503, body: { ok: false, error: { code: 'cli_unavailable', message: 'spawn C:\\x\\copilot.exe ENOENT' } } }), 'cli');
  assert.equal(classifyLlmFailure({ status: 503, body: { ok: false, error: { code: 'not_ready' } } }), 'connection');
  assert.equal(classifyLlmFailure({ status: 200, body: null }), 'invalid');
});

// FR-087 AC-506 / FR-062 AC-312（例外。監査 D-1）: 有効なまま cli_unavailable で失敗すると自動で無効（同意の記録は残す）、
// 確かめ直し（［設定］を開く・接続テスト）で解消が分かれば再同意なしで有効に戻る。周期的な確かめ直しはしない
test('FR-087 AC-506 FR-062 AC-312: cli_unavailable で自動で無効・同意は残る。［設定］を開く／接続テストで確かめ直して再同意なしで戻る', async () => {
  for (const trigger of ['settings', 'test']) {
    const relay = relayMock({ provider: 'copilot' });
    const base = relay.fn;
    let broken = false;
    relay.fn = async (q) => {
      if (q.path === '/api/llm/status') {
        relay.copilot = broken ? { ...READY_CP, available: false, unavailableReason: 'cli_unavailable' } : { ...READY_CP };
        return base(q);
      }
      if (broken && !['/api/llm/provider'].includes(q.path)) { relay.calls.push(q); return { status: 503, body: { ok: false, error: { code: 'cli_unavailable', message: 'SECRET-PROBE C:\\PATH-PROBE\\copilot.exe' } } }; }
      return base(q);
    };
    const { app, env } = await newApp({ options: { relay: relay.fn } });
    await app.refreshCopilotStatus();
    await app.requestLlmEnable(); await app.answerLlmConsent(true);
    const rec = env.storage.getItem(CONSENT_KEY_COPILOT);
    broken = true;
    const r = await app.llmCall('/api/llm/extract', { input: 'x' });
    assert.equal(r.ok, false);
    const m = app.getState().message;
    assert.match(m.text, /Copilot CLI を起動できない/); assert.doesNotMatch(m.text, /接続/);
    assert.ok(m.text.length <= 80 && !m.text.includes('SECRET-PROBE') && !m.text.includes('PATH-PROBE'));
    assert.equal(app.getLlmState().enabled, false, '自動で無効');
    assert.equal(env.storage.getItem(CONSENT_KEY_COPILOT), rec, '同意の記録は残る');
    const n = relay.llm().length;
    assert.deepEqual(await app.llmCall('/api/llm/extract', { input: 'y' }), { ok: false, reason: 'disabled' });
    assert.equal(relay.llm().length, n, '以後の要求は 0 件');
    // まだ起動できない間の確かめ直しでは有効にならない
    if (trigger === 'settings') { app.commands['settings.open'](); await app.flushLlm(); } else await app.testLlmConnection();
    assert.equal(app.getLlmState().enabled, false);
    assert.equal(app.getLlmConsent(), null);
    if (trigger === 'settings') assert.match(field(app, 'llm.enabled').status.text, /Copilot CLI を起動できない/);
    // 解消後の確かめ直しで再同意なしに有効へ
    broken = false;
    if (trigger === 'settings') { app.commands['settings.close']?.(); app.commands['settings.open'](); await app.flushLlm(); } else await app.testLlmConnection();
    assert.equal(app.getLlmState().enabled, true, `${trigger}: 再同意なしで有効に戻る`);
    assert.equal(app.getLlmConsent(), null);
    assert.equal(env.storage.getItem(CONSENT_KEY_COPILOT), rec, '同意の記録は作り直さない');
  }
});

// FR-062 AC-312（例外）: 同意の記録があり版が一致しても、起動時に中継サーバーが cli_unavailable を返す間は有効にしない
test('FR-062 AC-312: 同意の記録があっても cli_unavailable の間は起動時に有効にならず、解消後の起動では有効', async () => {
  for (const [cp, want] of [[{ ...READY_CP, available: false, unavailableReason: 'cli_unavailable' }, false], [READY_CP, true]]) {
    const a = await mk({ provider: 'copilot', copilot: cp });
    a.env.storage.setItem(CONSENT_KEY_COPILOT, JSON.stringify({ version: CONSENT_VERSION, at: 1, provider: 'copilot' }));
    const b = await a.createApp({ ...a.env.options, relay: a.relay.fn });
    assert.equal(b.getLlmState().enabled, want);
    if (!want) { const r = await b.requestLlmEnable(); assert.deepEqual([r.ok, r.missing], [false, ['cli']]); assert.equal(b.getLlmConsent(), null); }
  }
});

// FR-068 AC-354（例外。AC-506）: 起動時から「有効にできない」原因があり、有効にする操作をしていない（unconfigured が null）ときの接続テスト
test('FR-068 AC-354 FR-087 AC-506: 同意の記録あり・起動時から有効にできないときの接続テストは状態の取得だけで「失敗（未設定）」、解消後は再同意なしに有効にしてから送る', async () => {
  const cases = [
    ['signin', { ...READY_CP, signedIn: false, account: null }],
    ['token', { ...READY_CP, authMethod: 'token', tokenConfigured: false }],
    ['cli', { ...READY_CP, available: false, unavailableReason: 'cli_unavailable' }],
  ];
  for (const [cause, cp] of cases) {
    const a = await mk({ provider: 'copilot', copilot: cp });
    a.env.storage.setItem(CONSENT_KEY_COPILOT, JSON.stringify({ version: CONSENT_VERSION, at: 1, provider: 'copilot' }));
    const rec = a.env.storage.getItem(CONSENT_KEY_COPILOT);
    const b = await a.createApp({ ...a.env.options, relay: a.relay.fn });
    await b.flushLlm();
    assert.equal(b.getLlmState().enabled, false);
    a.relay.calls.length = 0;
    const r = await b.testLlmConnection();
    assert.deepEqual(r, { ok: false, cause: 'unconfigured' }, `${cause}: 失敗（未設定）`);
    assert.deepEqual(a.relay.calls.map((c) => `${c.method} ${c.path}`), ['GET /api/llm/status'], `${cause}: 状態の取得だけ`);
    assert.equal(a.relay.llm().length, 0, `${cause}: 送信 0 件`);
    const m = b.getState().message;
    assert.equal(m.key, 'llm.test.fail.unconfigured');
    assert.doesNotMatch(m.text, /同意/, `${cause}: 「先に同意が必要」ではない`);
    assert.equal(b.getLlmConsent(), null);
    b.commands['settings.open'](); await b.flushLlm();
    const st = field(b, 'llm.enabled').status;
    assert.deepEqual(st.causes, [cause], `${cause}: 原因を示す`);
    assert.ok(st.actions.length >= 1, `${cause}: 次の行動を示す`);
    b.commands['settings.close']?.();
    // 原因が解けたら、再同意なしに有効に戻してから通常の接続テストを行う
    a.relay.copilot = { ...READY_CP };
    a.relay.calls.length = 0;
    const r2 = await b.testLlmConnection();
    assert.deepEqual(r2, { ok: true, cause: null }, `${cause}: 解消後は成功`);
    assert.equal(b.getLlmState().enabled, true, `${cause}: 再同意なしに有効`);
    assert.equal(b.getLlmConsent(), null);
    assert.deepEqual(a.relay.llm().map((c) => `${c.method} ${c.path}`), ['POST /api/llm/responses']);
    assert.equal(a.env.storage.getItem(CONSENT_KEY_COPILOT), rec, '同意の記録は作り直さない');
  }
});

// FR-068 AC-354: 同意の記録がないときは従来どおり「先に同意が必要」で中継への要求は 0 件
test('FR-068 AC-354: Copilot で同意の記録がなく有効にできない原因があるときは「先に同意が必要」で中継への要求 0 件', async () => {
  const a = await mk({ provider: 'copilot', copilot: { ...READY_CP, signedIn: false } });
  a.relay.calls.length = 0;
  const r = await a.app.testLlmConnection();
  assert.deepEqual(r, { ok: false, cause: 'consent' });
  assert.equal(a.relay.calls.length, 0);
});
