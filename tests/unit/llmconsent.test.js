// FR-062 AC-311 AC-312 / FR-068 AC-354 AC-355 の単体・結合テスト（web/src/llm.js）。実 Foundry は呼ばず、中継サーバーはモック。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { maskSecrets } from '../../web/src/llm.js';

const ALL = { endpoint: true, deployment: true, credential: true };
function relayMock({ configured = ALL, post = { status: 200, body: { points: ['x'] } } } = {}) {
  const r = { calls: [], post, configured };
  r.fn = async ({ method = 'GET', path, body }) => {
    r.calls.push({ method, path, body });
    if (path === '/api/llm/status') return { status: 200, body: { configured: r.configured, endpointHost: 'foundry.example.test' } };
    if (r.post === 'throw') throw new TypeError('Failed to fetch');
    if (r.post === 'hang') return new Promise(() => {});
    return r.post;
  };
  return r;
}
const mk = async (o) => { const relay = relayMock(o); const ctx = await newApp({ options: { relay: relay.fn } }); return { ...ctx, relay }; };

// FR-062 AC-311: 直近に送った内容（マスキング後）を確認できる。キー・トークンを含まない
test('FR-062 AC-311: 有効時に直近に送った内容をマスキング後で確認でき、キー・トークンの形の文字列は含まれない', async () => {
  const { app, env } = await mk();
  await app.requestLlmEnable(); await app.answerLlmConsent(true);
  assert.equal(app.getLlmLastSent(), null);
  app.commands['session.start']();
  app.setDraft('予算 Bearer abc.def.ghi と sk-ABCDEFGH12345678 の件'); app.submitDraft(); env.tick(1);
  await app.flushLlm();
  const sent = app.getLlmLastSent();
  assert.ok(sent && sent.text.includes('予算'));
  assert.ok(!/abc\.def\.ghi|sk-ABCDEFGH/.test(sent.text));
  await app.disableLlm();
  assert.equal(app.getLlmLastSent(), null, '無効時は表示しない');
  assert.equal(maskSecrets('plain text'), 'plain text');
});

// FR-062 AC-312: 同意はそのセッションだけ。保存せず、再読込（新しいアプリ）では無効に戻る
test('FR-062 AC-312: 同意は保存されず、同じ保存領域で作り直したアプリは無効で再び同意が必要', async () => {
  const a = await mk();
  await a.app.requestLlmEnable(); await a.app.answerLlmConsent(true);
  assert.equal(a.app.getLlmState().enabled, true);
  // FR-062 AC-312・AC-366（Q-016 B）: 保存するのは同意の事実・版・日時だけ。再読込で有効のまま、無効化で撤回
  const rec = JSON.parse(a.env.storage.getItem('grp.llm.consent'));
  assert.deepEqual(Object.keys(rec).sort(), ['at', 'version']);
  const b = await a.createApp({ ...a.env.options, relay: a.relay.fn });
  assert.equal(b.getLlmState().enabled, true);
  assert.equal(b.getLlmConsent(), null);
  await b.disableLlm();
  assert.equal(a.env.storage.getItem('grp.llm.consent'), null);
  const c = await a.createApp({ ...a.env.options, relay: a.relay.fn });
  assert.equal(c.getLlmState().enabled, false);
  assert.equal((await c.requestLlmEnable()).pending, 'consent');
});

// FR-068 AC-354: 接続テストは最小の要求を中継経由で送り、成功/失敗（原因の分類）を示す。有効化の状態は変えない
test('FR-068 AC-354: 接続テストの成功・失敗の分類（未設定・認証・接続・タイムアウト）と、有効化の状態を変えないこと', async () => {
  const cases = [
    ['ok', { post: { status: 200, body: { ok: 1 } } }, true, null],
    ['unconfigured', { configured: { ...ALL, endpoint: false } }, false, 'unconfigured'],
    ['auth', { post: { status: 502, body: { error: { code: 'upstream_error', upstreamStatus: 401 } } } }, false, 'auth'],
    ['connection', { post: 'throw' }, false, 'connection'],
    ['timeout', { post: 'hang' }, false, 'timeout'],
  ];
  for (const [name, o, ok, cause] of cases) {
    const { app, env, relay } = await mk(name === 'unconfigured' ? {} : o);
    await app.requestLlmEnable(); await app.answerLlmConsent(true);
    if (name === 'unconfigured') relay.configured = o.configured; // 有効化の後に中継側が未設定になった場合
    relay.calls.length = 0;
    const p = app.testLlmConnection();
    if (name === 'timeout') { for (let i = 0; i < 50 && !relay.calls.some((c) => c.path === '/api/llm/responses'); i++) await new Promise((res) => setImmediate(res)); env.scheduler.advance(10_000); } // PARAM-074
    const r = await p;
    assert.deepEqual([r.ok, r.cause], [ok, cause], name);
    assert.equal(app.getLlmState().enabled, true, `${name}: 有効化の状態は変わらない`);
    assert.equal(app.getState().scenes.length, 0, `${name}: 図に影響しない`);
    if (name === 'ok') assert.equal(relay.calls.filter((c) => c.path === '/api/llm/responses').length, 1);
    if (name === 'unconfigured') assert.equal(relay.calls.filter((c) => c.path === '/api/llm/responses').length, 0);
    const f = app.getSettingsDialog?.() ?? null; assert.equal(f, null);
  }
});

// FR-068 AC-354: 未同意・無効のときは「先に同意が必要」と表示し、中継サーバーへの要求は 0 件
test('FR-068 AC-354: 無効（未同意）のときの接続テストは「先に同意が必要」を示し、中継への要求が 0 件', async () => {
  const { app, relay } = await mk();
  const r = await app.testLlmConnection();
  assert.deepEqual([r.ok, r.cause], [false, 'consent']);
  assert.equal(relay.calls.length, 0);
  assert.ok(app.getState().message.text.includes('先に同意が必要'));
  assert.equal(app.getLlmState().enabled, false);
  await app.requestLlmEnable(); // 同意ダイアログ待ち（未同意）
  relay.calls.length = 0;
  const r2 = await app.testLlmConnection();
  assert.equal(r2.cause, 'consent');
  assert.equal(relay.calls.length, 0);
});

// FR-068 AC-355: 実際の中継サーバーの形式（missing 配列）でも、キーの値を持たず「設定済み/未設定」だけを示す
test('FR-068 AC-355: 中継サーバーの status（state/missing）形式でも未設定の項目が示され、認証情報は設定済み/未設定の文字だけ', async () => {
  const relay = async ({ path }) => ({ status: 200, body: { state: 'unconfigured', missing: ['apiKey'], configured: false, reason: 'x' } });
  const { app } = await newApp({ options: { relay } });
  app.commands['settings.open']();
  const r = await app.requestLlmEnable();
  assert.deepEqual(r.missing, ['credential']);
  const cred = app.getSettingsDialog().fields.find((f) => f.id === 'llm.credential');
  assert.equal(cred.status.text, '未設定');
  assert.equal(cred.input, undefined);
});
