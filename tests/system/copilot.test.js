// FR-087 AC-506 / FR-088 AC-508 AC-509 / FR-062 AC-513 / FR-068 AC-514（System Test。契約: tests/system/CONTRACT-GITHUB-COPILOT.md）
// 期待値は受入基準だけから決める。GitHub Copilot SDK・Copilot CLI・GitHub へは通信せず、同一オリジンの中継サーバーをモックで差し込む（決定的）。
// AC-503・504・505・507・510・515 は検証レベル integration、AC-512 は unit のため、ここには置かない。
// AC-511（Q-033）の画面側はここ、中継サーバーの実プロセスと Copilot CLI・SDK のスタブでの確認は copilot-relay.test.js。
// トークン・資格情報は実値らしくない探針（PROBE-...）だけを使う。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, CJK } from './helpers.js';
import { flush, makeSpeechRelay } from './azurespeech-util.js';

const PARAM_011 = 6;
const weight = (s) => [...String(s)].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.5), 0);
const FOUNDRY_HOST = 'foundry.example.test';
const TOKEN_PROBE = 'PROBE-GH-TOKEN-0000-not-a-real-token';
const CRED_PROBE = 'PROBE-GH-CRED-0000-not-a-real-credential';
const PATH_PROBE = 'C:\\PROBE-PATH-0000\\copilot-cli\\copilot.exe'; // ファイルのパスの漏れの探針
const VERIFY_URI = 'https://github.com/login/device';
const USER_CODE = 'TEST-0000';
const ACCOUNT = 'octo-dummy-user';
const MODEL = 'dummy-model-x';
const SIGNED_IN = { signedIn: true, account: ACCOUNT, model: MODEL, modelSource: 'ui' };
const SIGNOUT = '/api/llm/copilot/signout';
const SETTINGS_PATHS = new Set(['/api/llm/status', '/api/llm/provider', '/api/llm/key', '/api/llm/config', '/api/llm/copilot', '/api/llm/copilot/signin', SIGNOUT]);
const SIGNIN = '/api/llm/copilot/signin';

// 同一オリジンの中継サーバーのモック。mode（LLM 向けの要求の結果）: 'ok' | 'auth' | 'rate_limit' | 'connection' | 'timeout' | 'malformed'。
// 'cli_unavailable'（503 {error:{code:'cli_unavailable'}}。以後の状態も copilot.unavailableReason:'cli_unavailable'）。
// 'offline' はすべての要求を失敗させる。要求ごとに「その時点のプロバイダー」（body.provider か保存済みの provider）を記録する。
function makeRelay({ provider, foundry = true, copilot = {}, mode = 'ok' } = {}) {
  const r = { calls: [], mode, provider, flow: null, signinStarts: 0, signouts: 0 };
  r.foundry = { endpoint: foundry, deployment: foundry, credential: foundry };
  r.cp = { available: true, unavailableReason: null, authMethod: 'signin', authMethodSource: null, signedIn: false, account: null, tokenConfigured: false, tokenSource: null, model: '', modelSource: null, ...copilot };
  // 同じ PC の Copilot CLI の資格情報の有無（AC-509・AC-511）。このアプリでのサインアウトは中継サーバーに保存され、CLI の資格情報は残る
  r.cliCred = r.cp.signedIn;
  const speech = makeSpeechRelay();
  const ok = (body) => ({ status: 200, body });
  const st = () => ({
    ...(r.provider ? { provider: r.provider } : {}),
    configured: { ...r.foundry }, endpointHost: FOUNDRY_HOST, keyConfigured: r.foundry.credential, keySource: r.foundry.credential ? 'env' : null,
    copilot: { ...r.cp }, token: TOKEN_PROBE, authorization: `Bearer ${TOKEN_PROBE}`, // 漏れの探針
  });
  const upper = (s) => s === 'env' || s === 'file';
  const badText = (s) => typeof s !== 'string' || /[\u0000-\u001f\u007f]/.test(s);
  r.fn = async ({ method = 'GET', path: p, body }) => {
    const b = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
    r.calls.push({ method, path: p, body: b, provider: (b && typeof b === 'object' && b.provider) || r.provider || 'foundry' });
    if (p.startsWith('/api/speech/')) return speech.fn({ method, path: p, body });
    if (r.mode === 'offline') throw new TypeError('Failed to fetch');
    if (p === '/api/llm/status') return ok(st());
    if (p === '/api/llm/provider') {
      if (method === 'GET') return ok({ provider: r.provider ?? 'foundry' });
      if (!['foundry', 'copilot'].includes(b?.provider)) return { status: 400, body: { ok: false, result: 'invalid' } };
      r.provider = b.provider;
      return ok({ ok: true, result: 'saved', ...st() });
    }
    if (p === '/api/llm/copilot') {
      if (method === 'POST') {
        const am = b?.authMethod; const model = b?.model ?? ''; const token = b?.token;
        if (!['signin', 'token'].includes(am) || badText(model) || (model !== '' && !model.trim())
          || (token !== undefined && (badText(token) || !token.trim() || am !== 'token'))) return { status: 400, body: { ok: false, result: 'invalid' } };
        if ((am !== r.cp.authMethod && upper(r.cp.authMethodSource)) || (token !== undefined && upper(r.cp.tokenSource)) || (model !== r.cp.model && upper(r.cp.modelSource))) {
          return { status: 409, body: { ok: false, result: 'env_managed', copilot: { ...r.cp } } };
        }
        r.cp.authMethod = am; r.cp.authMethodSource = 'ui'; r.cp.model = model; r.cp.modelSource = model ? 'ui' : null;
        if (token !== undefined) { r.cp.tokenConfigured = true; r.cp.tokenSource = 'ui'; }
        return ok({ ok: true, result: 'saved', copilot: { ...r.cp } });
      }
      if (method === 'DELETE') {
        const locked = [r.cp.authMethodSource, r.cp.tokenSource, r.cp.modelSource].some(upper);
        if (r.cp.authMethodSource === 'ui') { r.cp.authMethod = 'signin'; r.cp.authMethodSource = null; }
        if (r.cp.tokenSource === 'ui') { r.cp.tokenConfigured = false; r.cp.tokenSource = null; }
        if (r.cp.modelSource === 'ui') { r.cp.model = ''; r.cp.modelSource = null; }
        return locked ? { status: 409, body: { ok: false, result: 'env_managed', copilot: { ...r.cp } } } : ok({ ok: true, result: 'deleted', copilot: { ...r.cp } });
      }
      return ok({ copilot: { ...r.cp } });
    }
    if (p === SIGNOUT && method === 'POST') { // AC-511: このアプリで使わない状態にするだけ（CLI の資格情報は残す）
      r.signouts++; r.cp.signedIn = false; r.cp.account = null;
      return ok({ ok: true, result: 'signed_out', copilot: { ...r.cp } });
    }
    if (p === SIGNIN) {
      if (method === 'POST') {
        if (!r.cp.available) return { status: 409, body: { ok: false, result: 'sdk_missing' } };
        if (r.cliCred) { // CLI の資格情報が残っている: 確認コードなしにサインイン済み（AC-511）
          r.flow = { state: 'completed' }; r.signinStarts++; r.cp.signedIn = true; r.cp.account = ACCOUNT;
          return ok({ ok: true, state: 'completed' });
        }
        r.flow = { state: 'pending' }; r.signinStarts++;
        return ok({ ok: true, state: 'pending', verificationUri: VERIFY_URI, userCode: USER_CODE });
      }
      if (method === 'DELETE') { if (r.flow) r.flow.state = 'cancelled'; return ok({ ok: true, state: 'cancelled' }); }
      const s = r.flow?.state ?? 'none';
      if (s === 'pending' || s === 'none') return ok({ state: s });
      return ok({ state: s, ...(s === 'completed' ? { account: ACCOUNT } : {}), credential: CRED_PROBE, accessToken: CRED_PROBE }); // 漏れの探針
    }
    if (p === '/api/llm/key' || p === '/api/llm/config') return ok({ ok: true, result: 'saved', ...st() });
    // ここから LLM 向けの要求（抽出・SVG・接続テストなど）
    const leak = `Bad credentials: Authorization: Bearer ${TOKEN_PROBE}`;
    if (r.mode === 'timeout') return new Promise(() => {});
    if (r.mode === 'cli_unavailable') { // AC-506（A-240）: 要求の途中で Copilot CLI を起動できなかった。以後の状態もそれを返す（AC-505）
      r.cp.available = false; r.cp.unavailableReason = 'cli_unavailable';
      return { status: 503, body: { ok: false, error: { code: 'cli_unavailable', message: `${leak} spawn ${PATH_PROBE} ENOENT` } } };
    }
    if (r.mode === 'auth') return { status: 401, body: { ok: false, error: { code: 'auth', message: leak } } };
    if (r.mode === 'rate_limit') return { status: 429, body: { ok: false, error: { code: 'rate_limit', message: leak } } };
    if (r.mode === 'connection') return { status: 502, body: { ok: false, error: { code: 'connection', message: leak } } };
    if (r.mode === 'malformed') return ok('<<not json>>');
    return ok({ objects: [], people: [], emotions: [], metaphors: [], points: [], output: [{ type: 'message', content: [{ type: 'output_text', text: '{"points":[]}' }] }] });
  };
  r.finishSignin = (state) => { r.flow.state = state; if (state === 'completed') { r.cp.signedIn = true; r.cp.account = ACCOUNT; r.cliCred = true; } };
  r.llmCalls = () => r.calls.filter((c) => c.path.startsWith('/api/llm/') && !SETTINGS_PATHS.has(c.path));
  return r;
}

async function settle(app) { await app.refreshFoundryKeyStatus(); await app.refreshCopilotStatus(); await flush(); }
async function boot({ relay: ro = {}, over = {} } = {}) {
  const relay = makeRelay(ro);
  const copied = [];
  const clipboard = { writeText: async (t) => { copied.push(String(t)); } };
  const ctx = await newApp({ ...over, options: { relay: relay.fn, clipboard, ...(over.options || {}) } });
  await settle(ctx.app);
  return { ...ctx, relay, copied };
}
// 再読込・再起動 = 同じ storage・同じ中継サーバー（の保存）で createApp し直す
async function reload(ctx) { const app = await ctx.createApp({ ...ctx.env.options }); await settle(app); return { ...ctx, app }; }
async function enable(app) {
  const r = await app.requestLlmEnable();
  assert.deepEqual([r.ok, r.pending], [true, 'consent'], `同意へ進める: ${JSON.stringify(r)}`);
  await app.answerLlmConsent(true);
  assert.equal(app.getLlmState().enabled, true);
}
const type = (app, env, ...texts) => { for (const t of texts) { app.setDraft(t); app.submitDraft(); env.tick(1); } };
const sfield = (app, id) => (app.getSettingsDialog()?.fields ?? []).find((f) => f.id === id);
const dlg = (app) => app.getApiKeysDialog();
const field = (app, id) => (dlg(app)?.fields ?? []).find((f) => f.id === id);
async function openCopilot(app) {
  app.commands['apiKeys.open'](); await flush();
  await settle(app);
  app.selectApiKeysCategory('copilot'); await flush();
  return dlg(app);
}
async function pump(env, until, max = 24) {
  for (let i = 0; i < max; i++) { if (until()) return true; env.scheduler.advance(5000); for (let j = 0; j < 4; j++) await flush(); }
  return until();
}
function surface(app, env) {
  const parts = [];
  const add = (f) => { try { const v = f(); parts.push(typeof v === 'string' ? v : JSON.stringify(v)); } catch { /* 未実装の観察点はほかのアサーションが検出する */ } };
  for (const f of [() => app.getState(), () => app.getApiKeysDialog(), () => app.getSettingsDialog(), () => app.getDialog(), () => app.getCommandBar(),
    () => app.getCopilotSignin(), () => app.getLlmConsent(), () => app.getLlmState(), () => app.renderSvg(), () => app.getStrings()]) add(f);
  parts.push(JSON.stringify(env.storage.dump()));
  return parts.join('\n');
}
const consentRecords = (env) => env.storage.dump().filter(([k]) => k.startsWith('grp.llm.consent')).map(([k, v]) => [k, JSON.parse(v)]);
const statusCalls = (relay) => relay.calls.filter((c) => c.path === '/api/llm/status').length;
// 有効にした後、要求が Copilot CLI を起動できないことで失敗し、「有効にできない」状態になったところまで進める（AC-506）
async function brokenCli() {
  const ctx = await boot({ relay: { provider: 'copilot', copilot: SIGNED_IN } });
  const { app, env, relay } = ctx;
  await enable(app);
  const consentBefore = consentRecords(env).filter(([k]) => k === 'grp.llm.consent.copilot');
  relay.mode = 'cli_unavailable';
  app.commands['session.start']();
  type(app, env, '予算の見直しが必要です');
  await app.flushLlm();
  assert.equal(app.getLlmState().enabled, false, '自動で無効に戻る（前提）');
  return { ...ctx, consentBefore };
}

// ======================= FR-087 =======================
// FR-087 AC-506
// 2026-10-24（監査 A-235）: 原因「Copilot CLI を起動できない」と、SDK・Copilot CLI の導入・再導入の手順の案内を追加
test('FR-087 AC-506: GitHub Copilot を選び SDK 未導入・Copilot CLI を起動できない・未サインイン・トークン未設定のときは、［設定］に原因と次の行動が示され、有効にできず、図はルールベースのまま・LLM 向けの要求は 0 件', async () => {
  const cases = [
    { miss: 'sdk', copilot: { available: false, unavailableReason: 'sdk_missing' }, text: 'GitHub Copilot SDK が導入されていない', action: 'installGuide' },
    { miss: 'cli', copilot: { available: false, unavailableReason: 'cli_unavailable' }, text: 'Copilot CLI を起動できない', action: 'installGuide', guide: /Copilot CLI/ },
    { miss: 'signin', copilot: { authMethod: 'signin', signedIn: false }, text: 'GitHub にサインインしていない', action: 'openApiKeys' },
    { miss: 'token', copilot: { authMethod: 'token', authMethodSource: 'ui', tokenConfigured: false }, text: 'トークンが未設定', action: 'openApiKeys' },
  ];
  for (const c of cases) {
    const { app, env, relay } = await boot({ relay: { provider: 'copilot', copilot: c.copilot } });
    const base = await newApp();
    assert.equal(app.getLlmProvider(), 'copilot', c.miss);
    app.commands['settings.open'](); await flush();
    const r = await app.requestLlmEnable();
    assert.equal(r.ok, false, `${c.miss}: 有効にできない`);
    assert.deepEqual(r.missing, [c.miss], c.miss);
    assert.equal(app.getLlmConsent(), null, `${c.miss}: 同意の表示へ進まない`);
    assert.equal(app.getLlmState().enabled, false, c.miss);
    assert.equal(app.getLlmState().status, 'unconfigured', c.miss);
    const f = sfield(app, 'llm.enabled');
    assert.ok(f.status.text.includes(c.text), `${c.miss}: 原因「${c.text}」が示される: ${f.status.text}`);
    const act = (f.status.actions ?? []).find((a) => a.id === c.action);
    assert.ok(act && String(act.label ?? '').trim(), `${c.miss}: 次の行動 ${c.action}`);
    if (c.action === 'installGuide') assert.ok(String(act.href ?? act.text ?? '').trim(), '導入の手順の案内');
    if (c.guide) {
      // Copilot CLI を起動できないとき: SDK・Copilot CLI の導入・再導入の手順の案内（SDK 未導入の文だけではない）
      assert.ok(!f.status.text.includes('GitHub Copilot SDK が導入されていない'), `${c.miss}: SDK 未導入とは区別される: ${f.status.text}`);
      const shown = await app.runSettingsAction(c.action);
      const guide = [act.text, act.label, shown?.text].filter(Boolean).join(' ');
      assert.match(guide, c.guide, `${c.miss}: Copilot CLI の導入・再導入の案内: ${guide}`);
    }
    app.commands['session.start'](); base.app.commands['session.start']();
    type(app, env, '予算の見直しが必要です'); type(base.app, base.env, '予算の見直しが必要です');
    await app.flushLlm();
    assert.equal(relay.llmCalls().length, 0, `${c.miss}: LLM 向けの要求は 0 件`);
    assert.equal(app.renderSvg(), base.app.renderSvg(), `${c.miss}: ルールベース描画のまま`);
    if (c.action === 'openApiKeys') {
      app.runSettingsAction('openApiKeys'); await flush();
      assert.equal(dlg(app)?.selected, 'copilot', '接続キー画面の GitHub Copilot の分類が開く');
    }
  }
});

// 2026-10-24（監査 A-240・A-242）: 不正な応答にも原因の分類「不正な応答」の通知を確かめる
test('FR-087 AC-506 異常系: 有効なまま認証・利用の上限・接続・タイムアウト・不正な応答で失敗すると、ルールベース描画で表示され、原因の分類が短く通知され、トークン・認証の情報は表示されない', async () => {
  for (const [mode, re] of [['auth', /認証/], ['rate_limit', /上限/], ['connection', /接続/], ['timeout', /タイムアウト/], ['malformed', /不正な応答/]]) {
    const { app, env, relay } = await boot({ relay: { provider: 'copilot', copilot: SIGNED_IN } });
    const base = await newApp();
    await enable(app);
    relay.mode = mode;
    app.commands['session.start'](); base.app.commands['session.start']();
    type(app, env, '予算の見直しが必要です'); type(base.app, base.env, '予算の見直しが必要です');
    assert.ok(relay.llmCalls().length >= 1, `${mode}: 有効なので LLM 向けの要求が出る`);
    assert.ok(relay.llmCalls().every((x) => x.provider === 'copilot'), `${mode}: 選んだプロバイダーへの要求`);
    if (mode === 'timeout') env.scheduler.advance(30_000); // PARAM-069
    await app.flushLlm();
    assert.equal(app.renderSvg(), base.app.renderSvg(), `${mode}: 該当のシーンはルールベース描画`);
    const msg = app.getState().message;
    assert.ok(msg && msg.text.trim() && msg.text.length <= 80, `${mode}: 短く通知される`);
    if (re) assert.match(msg.text, re, `${mode}: 原因の分類`);
    const s = surface(app, env);
    assert.ok(!s.includes(TOKEN_PROBE), `${mode}: トークン・認証の情報は表示されない`);
    assert.equal(app.getState().session, 'recording', `${mode}: 記録は続く`);
  }
});

// FR-087 AC-506（監査 A-240・A-242・D-1）/ FR-062 AC-312（例外）: 有効なまま Copilot CLI を起動できない（中継サーバーの 503・cli_unavailable）
test('FR-087 AC-506 FR-062 AC-312 異常系: 有効なまま Copilot CLI を起動できないと、ルールベース描画で表示され「Copilot CLI を起動できない」と通知され（接続ではない）、トークン・パスは表示されず、LLM 連携は自動で無効（同意の記録は残る）・以後の要求は 0 件。［設定］を開くと確かめ直し、再読込しても cli_unavailable の間は同意の記録があっても有効にならず、周期的な確かめ直しはなく、解消後に［設定］を開くと再同意なしで戻る', async () => {
  const ctx0 = await boot({ relay: { provider: 'copilot', copilot: SIGNED_IN } });
  const { app, env, relay } = ctx0;
  const base = await newApp();
  await enable(app);
  const consentBefore = consentRecords(env).filter(([k]) => k === 'grp.llm.consent.copilot');
  assert.equal(consentBefore.length, 1, '同意の記録がある');
  relay.mode = 'cli_unavailable';
  app.commands['session.start'](); base.app.commands['session.start']();
  type(app, env, '予算の見直しが必要です'); type(base.app, base.env, '予算の見直しが必要です');
  assert.ok(relay.llmCalls().length >= 1, '有効なので LLM 向けの要求が出る');
  await app.flushLlm();
  assert.equal(app.renderSvg(), base.app.renderSvg(), '該当のシーンはルールベース描画');
  const msg = app.getState().message;
  assert.ok(msg && msg.text.trim() && msg.text.length <= 80, `短く通知される: ${JSON.stringify(msg)}`);
  assert.match(msg.text, /Copilot CLI を起動できない/, `原因の分類: ${msg.text}`);
  assert.doesNotMatch(msg.text, /接続/, `「接続」として通知しない: ${msg.text}`);
  assert.equal(app.getState().session, 'recording', '記録は続く');
  // LLM 連携は自動で無効に戻り、同意の記録は消さない
  assert.equal(app.getLlmState().enabled, false, '自動で無効に戻る');
  assert.deepEqual(consentRecords(env).filter(([k]) => k === 'grp.llm.consent.copilot'), consentBefore, '同意の記録は残る');
  // ［設定］を開くことが確かめ直しの契機（状態の取得）。まだ cli_unavailable なので「有効にできない」のまま
  const st0 = statusCalls(relay);
  app.commands['settings.open'](); await flush(); await flush();
  assert.ok(statusCalls(relay) > st0, '［設定］を開くと状態の取得（GET /api/llm/status）で確かめ直す');
  assert.equal(app.getLlmState().enabled, false, 'まだ起動できないので無効のまま');
  const f = sfield(app, 'llm.enabled');
  assert.ok(f.status.text.includes('Copilot CLI を起動できない'), `［設定］の原因: ${f.status.text}`);
  const act = (f.status.actions ?? []).find((a) => a.id === 'installGuide');
  assert.ok(act && String(act.label ?? '').trim(), '次の行動 installGuide');
  const shown = await app.runSettingsAction('installGuide');
  assert.match([act.text, act.label, shown?.text].filter(Boolean).join(' '), /Copilot CLI/, 'Copilot CLI の導入・再導入の案内');
  const s = surface(app, env);
  assert.ok(!s.includes(TOKEN_PROBE), 'トークン・認証の情報は表示されない');
  assert.ok(!s.includes('PROBE-PATH-0000'), 'ファイルのパスは表示されない');
  // 以後の LLM 向けの要求は 0 件
  const n = relay.llmCalls().length;
  type(app, env, '次の四半期の計画を立てます'); type(base.app, base.env, '次の四半期の計画を立てます');
  await app.flushLlm();
  assert.equal(relay.llmCalls().length, n, '以後の LLM 向けの要求は 0 件');
  assert.equal(app.renderSvg(), base.app.renderSvg(), '以後もルールベース描画');
  // 再読込しても、中継サーバーがまだ cli_unavailable を返す間は、同意の記録があり版が一致していても有効にならない（AC-312 の例外）
  const v = await reload(ctx0);
  assert.deepEqual(consentRecords(env).filter(([k]) => k === 'grp.llm.consent.copilot'), consentBefore, '再読込後も同意の記録は残り、版は一致');
  assert.equal(v.app.getLlmState().enabled, false, '再読込後も「有効にできない」（同意の記録だけでは有効にならない）');
  const rv = await v.app.requestLlmEnable();
  assert.equal(rv.ok, false, `再読込後も有効にできない: ${JSON.stringify(rv)}`);
  assert.deepEqual(rv.missing, ['cli'], '原因は Copilot CLI を起動できない');
  assert.equal(v.app.getLlmConsent(), null, '同意の表示へ進まない');
  v.app.commands['session.start']();
  const n2 = relay.llmCalls().length;
  type(v.app, env, '担当者を決めましょう');
  await v.app.flushLlm();
  assert.equal(relay.llmCalls().length, n2, '再読込後も LLM 向けの要求は 0 件');
  // 原因が解消しても、自動での周期的な確かめ直しはしない
  relay.mode = 'ok'; relay.cp.available = true; relay.cp.unavailableReason = null;
  const st1 = statusCalls(relay);
  for (let i = 0; i < 60; i++) { env.scheduler.advance(30_000); await flush(); } // 30 分
  assert.equal(statusCalls(relay), st1, '利用者の操作なしに状態の取得（確かめ直し）をしない');
  assert.equal(v.app.getLlmState().enabled, false, '確かめ直すまでは無効のまま');
  type(v.app, env, '次の会議で決めます');
  await v.app.flushLlm();
  assert.equal(relay.llmCalls().length, n2, '確かめ直すまでは LLM 向けの要求は 0 件');
  // 原因が解消した後に［設定］を開くと、再同意なしで有効に戻る（AC-513）
  v.app.commands['settings.open'](); await flush(); await flush();
  assert.ok(statusCalls(relay) > st1, '［設定］を開くと確かめ直す');
  assert.equal(v.app.getLlmConsent(), null, '同意の表示は出ない（再同意を求めない）');
  assert.equal(v.app.getLlmState().enabled, true, '再同意なしで有効に戻る');
  assert.ok(!sfield(v.app, 'llm.enabled').status?.text?.includes('Copilot CLI を起動できない'), '原因の表示は消える');
  assert.deepEqual(consentRecords(env).filter(([k]) => k === 'grp.llm.consent.copilot'), consentBefore, '同意の記録は作り直さない');
  type(v.app, env, '担当者を決めましょう');
  await v.app.flushLlm();
  assert.ok(relay.llmCalls().length > n2, '有効に戻った後は LLM 向けの要求が出る');
  assert.ok(relay.llmCalls().slice(n2).every((x) => x.provider === 'copilot'), 'GitHub Copilot への要求');
});

// FR-087 AC-506 / FR-062 AC-312（監査 D-1）: 確かめ直しの契機のうち、接続テストと再読込。原因が解消していれば再同意なしで有効に戻る
test('FR-087 AC-506 FR-062 AC-312 異常系: 「有効にできない」状態は接続テスト・再読込で確かめ直され、cli_unavailable の間は同意の記録があっても有効にならず、解消していれば再同意なしで有効に戻る', async () => {
  for (const trigger of ['connectionTest', 'reload']) {
    const ctx = await brokenCli();
    const { env, relay, consentBefore } = ctx;
    let app = ctx.app;
    if (trigger === 'connectionTest') {
      // まだ起動できない間の接続テストでは有効にならない
      const st0 = statusCalls(relay);
      await app.testLlmConnection(); await flush();
      assert.equal(app.getLlmState().enabled, false, `${trigger}: cli_unavailable の間は無効のまま`);
      assert.equal(app.getLlmConsent(), null, `${trigger}: 同意の表示へ進まない`);
      relay.mode = 'ok'; relay.cp.available = true; relay.cp.unavailableReason = null;
      await app.testLlmConnection(); await flush(); await flush();
      assert.ok(statusCalls(relay) > st0, `${trigger}: 接続テストで状態の取得により確かめ直す`);
    } else {
      relay.mode = 'ok'; relay.cp.available = true; relay.cp.unavailableReason = null;
      app = (await reload(ctx)).app;
    }
    assert.equal(app.getLlmConsent(), null, `${trigger}: 再同意を求めない`);
    assert.equal(app.getLlmState().enabled, true, `${trigger}: 再同意なしで有効に戻る`);
    assert.deepEqual(consentRecords(env).filter(([k]) => k === 'grp.llm.consent.copilot'), consentBefore, `${trigger}: 同意の記録は変わらない`);
    if (trigger === 'reload') app.commands['session.start']();
    const n = relay.llmCalls().length;
    type(app, env, '担当者を決めましょう');
    await app.flushLlm();
    assert.ok(relay.llmCalls().length > n, `${trigger}: 有効に戻った後は LLM 向けの要求が出る`);
  }
});

// ======================= FR-088 =======================
// FR-088 AC-508
test('FR-088 AC-508: 接続キー画面に「GitHub Copilot」の分類があり、認証方式（既定サインイン）・モデル名・書き込み専用のトークン欄・状態・保存・削除（確認つき）がある。トークンは保存後に二度と表示されない', async () => {
  const { app, env, relay } = await boot({ relay: { provider: 'copilot' } });
  app.commands['apiKeys.open'](); await flush(); await settle(app);
  const d0 = dlg(app);
  assert.ok(d0.categories.some((c) => c.id === 'copilot' && c.label === 'GitHub Copilot'), '分類の一覧に GitHub Copilot');
  app.focusApiKeysField('apiKeys.category.foundry');
  app.handleKey({ key: 'ArrowDown' }); await flush();
  assert.equal(dlg(app).selected, 'copilot', 'キーボードだけで選べる');
  for (const id of ['authMethod', 'model', 'token', 'sdkStatus', 'signinStatus', 'tokenStatus', 'signin', 'save', 'delete']) {
    const f = field(app, `apiKeys.copilot.${id}`);
    assert.ok(f, `apiKeys.copilot.${id} がある`);
    assert.ok(String(f.accessibleName ?? '').trim(), `${id} に名前`);
  }
  const am = field(app, 'apiKeys.copilot.authMethod');
  assert.deepEqual(am.input.options.map((o) => o.value), ['signin', 'token']);
  assert.equal(am.input.value, 'signin', '既定はサインイン');
  assert.ok(String(field(app, 'apiKeys.copilot.model').note ?? '').trim(), '空のときは SDK の既定のモデルを使う旨');
  const tk = field(app, 'apiKeys.copilot.token');
  assert.equal(tk.input.type, 'password'); assert.equal(tk.input.writeOnly, true); assert.equal(tk.input.reveal, false, '表示に切り替える操作がない');
  assert.equal(tk.disabled, true, 'サインインのときはトークンを入力できない');
  assert.ok(String(tk.reason ?? '').trim(), '入力できない理由');
  assert.equal(field(app, 'apiKeys.copilot.sdkStatus').status.id, 'available');
  assert.equal(field(app, 'apiKeys.copilot.signinStatus').status.id, 'signedOut');
  assert.ok(field(app, 'apiKeys.copilot.signinStatus').status.text.trim(), '「未サインイン」が文字で示される');
  assert.equal(field(app, 'apiKeys.copilot.tokenStatus').status.id, 'unset');
  // トークンで保存
  app.setCopilotAuthMethod('token'); await flush();
  assert.equal(field(app, 'apiKeys.copilot.token').disabled, false, 'トークンのときだけ入力できる');
  const token = `${TOKEN_PROBE}-${Date.now()}`;
  app.setCopilotTokenInput(token); app.setCopilotModelInput(MODEL);
  assert.ok(!surface(app, env).includes(token), '入力中の値は画面に現れない');
  const r = await app.saveCopilotSettings(); await flush();
  assert.equal(r.ok, true); assert.equal(r.result, 'saved');
  assert.deepEqual(relay.calls.filter((c) => c.path === '/api/llm/copilot' && c.method === 'POST').map((c) => c.body), [{ authMethod: 'token', model: MODEL, token }]);
  assert.equal(field(app, 'apiKeys.copilot.token').input.value, '', 'トークン欄は空に戻る');
  const ts = field(app, 'apiKeys.copilot.tokenStatus').status;
  assert.equal(ts.id, 'set'); assert.equal(ts.source, 'ui'); assert.match(ts.text, /画面/, '出どころ（画面で保存）');
  assert.ok(!surface(app, env).includes(token), 'トークンの値は二度と表示されない');
  const lm = dlg(app).liveMessage;
  assert.ok(lm && lm.text.trim() && ['status', 'alert'].includes(lm.role), '結果が読み上げ対象のメッセージで示される');
  // ラベルの長さと表示言語
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    for (const id of ['signin', 'save', 'delete']) assert.ok(weight(field(app, `apiKeys.copilot.${id}`).label) <= PARAM_011, `${lang} ${id} のラベルは ${PARAM_011} 文字以内`);
  }
  const en = field(app, 'apiKeys.copilot.save').label; app.setLang('ja');
  assert.notEqual(field(app, 'apiKeys.copilot.save').label, en, 'ラベルは表示言語に従う');
  // 削除は確認つき
  app.commands['copilot.delete'](); await flush();
  assert.equal(app.getDialog()?.kind, 'copilot-delete');
  assert.deepEqual(app.getDialog().buttons.map((x) => x.id).sort(), ['cancel', 'confirm']);
  await app.dialogAction('cancel'); await flush();
  assert.equal(relay.calls.filter((c) => c.path === '/api/llm/copilot' && c.method === 'DELETE').length, 0, 'キャンセルでは消えない');
  app.commands['copilot.delete'](); await app.dialogAction('confirm'); await flush();
  assert.equal(relay.calls.filter((c) => c.path === '/api/llm/copilot' && c.method === 'DELETE').length, 1);
  assert.equal(field(app, 'apiKeys.copilot.tokenStatus').status.id, 'unset', '削除で未設定');
  // サインイン済みのときはアカウント名
  const si = await boot({ relay: { provider: 'copilot', copilot: SIGNED_IN } });
  await openCopilot(si.app);
  const ss = field(si.app, 'apiKeys.copilot.signinStatus').status;
  assert.equal(ss.id, 'signedIn'); assert.ok(ss.text.includes(ACCOUNT), 'サインイン済み（アカウント名）');
});

test('FR-088 AC-508 異常系: SDK がないと導入の案内、環境変数のトークンは画面から変更・削除できない、不正なトークン・モデル名は送らない、中継サーバーが応答しないと操作できず理由が示される', async () => {
  // SDK 未導入
  const ns = await boot({ relay: { provider: 'copilot', copilot: { available: false, unavailableReason: 'sdk_missing' } } });
  await openCopilot(ns.app);
  const sdk = field(ns.app, 'apiKeys.copilot.sdkStatus');
  assert.equal(sdk.status.id, 'missing'); assert.ok(sdk.status.text.trim());
  assert.ok(String(sdk.guide ?? '').trim(), '導入の手順の案内');
  // 環境変数のトークン
  const ev = await boot({ relay: { provider: 'copilot', copilot: { authMethod: 'token', authMethodSource: 'env', tokenConfigured: true, tokenSource: 'env' } } });
  await openCopilot(ev.app);
  const ts = field(ev.app, 'apiKeys.copilot.tokenStatus');
  assert.equal(ts.status.id, 'set'); assert.equal(ts.status.source, 'env'); assert.match(ts.status.text, /環境変数/);
  assert.equal(field(ev.app, 'apiKeys.copilot.token').disabled, true, '環境変数のトークンは画面から変更できない');
  ev.app.commands['copilot.delete'](); await flush();
  if (ev.app.getDialog()?.kind === 'copilot-delete') await ev.app.dialogAction('confirm');
  await flush(); await settle(ev.app);
  assert.equal(ev.relay.cp.tokenSource, 'env'); assert.equal(ev.relay.cp.tokenConfigured, true);
  assert.equal(field(ev.app, 'apiKeys.copilot.tokenStatus').status.id, 'set', '削除できない');
  // 不正な値・サインインのときのトークン
  const { app, relay } = await boot({ relay: { provider: 'copilot' } });
  await openCopilot(app);
  app.setCopilotAuthMethod('token'); await flush();
  for (const [tok, model] of [['   ', ''], ['abc\u0000def', ''], ['', '   '], ['', 'm\u0007x']]) {
    if (tok) app.setCopilotTokenInput(tok);
    app.setCopilotModelInput(model);
    const r = await app.saveCopilotSettings(); await flush();
    assert.equal(r.ok, false, `拒否: ${JSON.stringify([tok, model])}`); assert.equal(r.result, 'invalid');
  }
  assert.equal(relay.calls.filter((c) => c.path === '/api/llm/copilot' && c.method === 'POST').length, 0, '拒否した値は送らない');
  app.setCopilotAuthMethod('signin'); await flush();
  app.setCopilotTokenInput(`${TOKEN_PROBE}-signin`); app.setCopilotModelInput('');
  await app.saveCopilotSettings(); await flush();
  assert.ok(relay.calls.filter((c) => c.path === '/api/llm/copilot' && c.method === 'POST').every((c) => !('token' in (c.body ?? {}))), 'サインインのときはトークンを送らない');
  // 中継サーバーが応答しない
  const off = await boot({ relay: { provider: 'copilot', mode: 'offline' } });
  off.app.commands['apiKeys.open'](); await flush(); off.app.selectApiKeysCategory('copilot'); await flush();
  for (const id of ['authMethod', 'model', 'token', 'signin', 'save', 'delete']) assert.equal(field(off.app, `apiKeys.copilot.${id}`).disabled, true, `${id} は操作できない`);
  const why = [field(off.app, 'apiKeys.copilot.sdkStatus'), field(off.app, 'apiKeys.copilot.signinStatus')].map((f) => String(f?.status?.text ?? '')).join('');
  assert.ok(why.trim(), '理由が示される');
});

// FR-088 AC-509
test('FR-088 AC-509: 「GitHub でサインイン」で確認のページの URL（新しいタブ）・確認コード（コピー）・待機中・取り消しが示され、承認すると再読込なしでサインイン済み（アカウント名）になる。資格情報は保存・表示しない', async () => {
  const { app, env, relay, copied } = await boot({ relay: { provider: 'copilot' } });
  await openCopilot(app);
  assert.equal(field(app, 'apiKeys.copilot.signinStatus').status.id, 'signedOut');
  await app.startCopilotSignin(); await flush();
  assert.equal(relay.calls.filter((c) => c.path === SIGNIN && c.method === 'POST').length, 1, '中継サーバーがサインインを始める');
  const s = app.getCopilotSignin();
  assert.equal(s.state, 'pending');
  assert.equal(s.verificationUri, VERIFY_URI); assert.equal(s.link.href, VERIFY_URI); assert.equal(s.link.target, '_blank', '新しいタブで開く');
  assert.equal(s.userCode, USER_CODE);
  assert.ok(String(s.copy?.label ?? '').trim() && String(s.cancel?.label ?? '').trim(), 'コピーと取り消しの操作');
  assert.ok(String(s.text ?? '').trim(), '待機中であることが示される');
  await app.copyCopilotUserCode();
  assert.deepEqual(copied, [USER_CODE], '確認コードをコピーできる');
  relay.finishSignin('completed');
  assert.ok(await pump(env, () => field(app, 'apiKeys.copilot.signinStatus')?.status.id === 'signedIn'), '再読込なしでサインイン済みになる');
  assert.ok(field(app, 'apiKeys.copilot.signinStatus').status.text.includes(ACCOUNT), 'アカウント名');
  const sf = surface(app, env);
  assert.ok(!sf.includes(CRED_PROBE), 'サインインで得た資格情報を表示・保存しない');
  // 同じ PC ですでにサインイン済み
  const pre = await boot({ relay: { provider: 'copilot', copilot: SIGNED_IN } });
  await openCopilot(pre.app);
  assert.equal(field(pre.app, 'apiKeys.copilot.signinStatus').status.id, 'signedIn', '操作なしにサインイン済み');
  assert.equal(pre.relay.signinStarts, 0);
});

test('FR-088 AC-509 異常系: 確認コードの期限切れ・拒否・失敗・取り消しでは秘密を含まない原因が示され、未サインインのままで、もう一度始められる', async () => {
  for (const [outcome, state] of [['expired', 'expired'], ['denied', 'denied'], ['failed', 'failed'], ['cancel', 'cancelled']]) {
    const { app, env, relay } = await boot({ relay: { provider: 'copilot' } });
    await openCopilot(app);
    await app.startCopilotSignin(); await flush();
    if (outcome === 'cancel') {
      await app.cancelCopilotSignin(); await flush();
      assert.equal(relay.calls.filter((c) => c.path === SIGNIN && c.method === 'DELETE').length, 1, '取り消しを中継サーバーへ送る');
    } else relay.finishSignin(outcome);
    assert.ok(await pump(env, () => app.getCopilotSignin()?.state === state), `${outcome}: 状態 ${state}`);
    assert.ok(String(app.getCopilotSignin().text ?? '').trim(), `${outcome}: 原因が示される`);
    assert.ok(!surface(app, env).includes(CRED_PROBE), `${outcome}: 秘密を含まない`);
    assert.equal(field(app, 'apiKeys.copilot.signinStatus').status.id, 'signedOut', `${outcome}: 未サインインのまま`);
    await app.startCopilotSignin(); await flush();
    assert.equal(relay.signinStarts, 2, `${outcome}: もう一度始められる`);
    assert.equal(app.getCopilotSignin().state, 'pending');
  }
});

// FR-088 AC-511（Q-033）
test('FR-088 AC-511: サインアウト（確認つき・Copilot CLI の資格情報は消さない旨）で、このアプリでは未サインインになり、以降 GitHub Copilot への要求は 0 件で AC-506 の表示になる。再読込後も CLI のサインインが残っていても未サインインのままで、再び「GitHub でサインイン」を操作すると確認コードなしにサインイン済み', async () => {
  const ctx = await boot({ relay: { provider: 'copilot', copilot: SIGNED_IN } });
  const { app, env, relay } = ctx;
  await enable(app);
  app.commands['session.start']();
  type(app, env, '予算の見直しが必要です'); await app.flushLlm();
  assert.ok(relay.llmCalls().length >= 1, '前提: サインイン済みで有効なので GitHub Copilot への要求が出る');
  await openCopilot(app);
  assert.equal(field(app, 'apiKeys.copilot.signinStatus').status.id, 'signedIn');
  const so = field(app, 'apiKeys.copilot.signout');
  assert.ok(so && so.role === 'button' && String(so.label ?? '').trim() && String(so.accessibleName ?? '').trim() && !so.disabled, '「サインアウト」の操作がある');
  // 確認つき（取り消しでは何も変わらない）
  app.commands['copilot.signout'](); await flush();
  const d = app.getDialog();
  assert.equal(d?.kind, 'copilot-signout');
  assert.deepEqual(d.buttons.map((x) => x.id).sort(), ['cancel', 'confirm']);
  assert.ok(String(d.text ?? '').includes('Copilot CLI') && /資格情報/.test(d.text), `確認に、Copilot CLI の資格情報は消さずこのアプリで使わないだけである旨: ${d.text}`);
  await app.dialogAction('cancel'); await flush();
  assert.equal(relay.signouts, 0, '取り消しではサインアウトしない');
  assert.equal(field(app, 'apiKeys.copilot.signinStatus').status.id, 'signedIn');
  app.commands['copilot.signout'](); await app.dialogAction('confirm'); await flush(); await settle(app);
  assert.equal(relay.calls.filter((c) => c.path === SIGNOUT && c.method === 'POST').length, 1, '中継サーバーへサインアウトを送る');
  assert.equal(relay.calls.filter((c) => c.method === 'DELETE' && (c.path === '/api/llm/copilot' || c.path === SIGNIN)).length, 0, '保存済みの設定の削除・サインインの取り消しは送らない');
  assert.equal(field(app, 'apiKeys.copilot.signinStatus').status.id, 'signedOut', 'このアプリでは未サインイン');
  // 以降 GitHub Copilot への要求は送られず、AC-506 の未サインインの表示
  app.commands['apiKeys.close'](); await flush(); // 接続キー画面（モーダル）を閉じてから入力・［設定］を開く
  const n = relay.llmCalls().length;
  type(app, env, '来月のリリース計画を決める'); await app.flushLlm();
  assert.ok(app.getState().utterances.some((u) => u.text === '来月のリリース計画を決める'), '前提: 発話が記録される');
  assert.equal(relay.llmCalls().length, n, 'サインアウト後の GitHub Copilot への要求は 0 件');
  app.commands['settings.open'](); await flush();
  const f = sfield(app, 'llm.enabled');
  assert.ok(f.status.text.includes('GitHub にサインインしていない'), `AC-506 の原因: ${f.status.text}`);
  assert.ok((f.status.actions ?? []).some((a) => a.id === 'openApiKeys'), 'AC-506 の次の行動');
  const r = await app.requestLlmEnable();
  assert.equal(r.ok, false); assert.deepEqual(r.missing, ['signin']);
  assert.equal(relay.llmCalls().length, n);
  // 再読込・再起動の後も、CLI のサインインが残っていても操作なしにサインイン済みとは示されない（AC-509 の例外）
  assert.equal(relay.cliCred, true, '前提: CLI の資格情報は残っている');
  const re = await reload(ctx);
  await openCopilot(re.app);
  assert.equal(field(re.app, 'apiKeys.copilot.signinStatus').status.id, 'signedOut', '再読込後も未サインイン');
  assert.equal(relay.signinStarts, 0, '操作なしにサインインを始めない');
  // 再び「GitHub でサインイン」: CLI の資格情報が残っているので確認コードの入力なしにサインイン済み
  await re.app.startCopilotSignin(); await flush();
  assert.equal(relay.signinStarts, 1);
  assert.ok(await pump(env, () => field(re.app, 'apiKeys.copilot.signinStatus')?.status.id === 'signedIn'), '再び操作するとサインイン済み');
  assert.ok(field(re.app, 'apiKeys.copilot.signinStatus').status.text.includes(ACCOUNT));
  const s = re.app.getCopilotSignin();
  assert.ok(!s || !s.userCode, '確認コードの入力を求めない');
  assert.ok(!surface(re.app, env).includes(CRED_PROBE), '資格情報を表示・保存しない');
});

// ======================= FR-062 =======================
// FR-062 AC-513
test('FR-062 AC-513: 同意はプロバイダーごとで、未同意の GitHub Copilot を選ぶと無効・要求 0 件。送信先「GitHub Copilot」とモデル名を示す同意で有効になり、同意済みのプロバイダーへ戻すと再同意なしに有効', async () => {
  const a = await boot({ relay: { copilot: SIGNED_IN } });
  assert.equal(a.app.getLlmProvider(), 'foundry');
  await enable(a.app); // Microsoft Foundry へ同意
  assert.equal((await a.app.setLlmProvider('copilot')).ok, true); await flush();
  assert.equal(a.app.getLlmState().enabled, false, '未同意のプロバイダーは無効');
  a.app.commands['session.start'](); type(a.app, a.env, '同意前の要点');
  await a.app.flushLlm();
  assert.equal(a.relay.llmCalls().length, 0, '未同意のプロバイダーへの要求は 0 件');
  const r = await a.app.requestLlmEnable();
  assert.deepEqual([r.ok, r.pending], [true, 'consent']);
  const c = a.app.getLlmConsent();
  assert.match(String(c.host), /GitHub Copilot/, '送信先は GitHub Copilot（GitHub のサービス）');
  assert.ok(!String(c.host).includes(FOUNDRY_HOST));
  assert.ok(String(c.model ?? '').includes(MODEL), '使うモデル名');
  assert.ok(c.kinds.length > 0, '送信内容');
  assert.equal(a.app.getLlmState().enabled, false, '同意するまで有効にならない');
  await a.app.answerLlmConsent(true);
  assert.equal(a.app.getLlmState().enabled, true);
  type(a.app, a.env, '同意後の要点'); await a.app.flushLlm();
  assert.ok(a.relay.llmCalls().length >= 1 && a.relay.llmCalls().every((x) => x.provider === 'copilot'));
  const recs = consentRecords(a.env);
  assert.equal(recs.length, 2, 'プロバイダーごとに別の記録として保存される');
  for (const [k, v] of recs) {
    for (const s of [TOKEN_PROBE, MODEL, ACCOUNT, '要点']) assert.ok(!JSON.stringify(v).includes(s), `${k} に ${s} を含めない`);
  }
  const fRecs = recs.filter(([, v]) => !('provider' in v));
  const cRecs = recs.filter(([, v]) => v.provider === 'copilot');
  assert.equal(fRecs.length, 1, 'Microsoft Foundry の記録は従来の形（プロバイダーの名前を持たない）');
  assert.deepEqual(Object.keys(fRecs[0][1]).sort(), ['at', 'version'], 'Foundry の記録は版・同意日時だけ');
  assert.equal(cRecs.length, 1, 'GitHub Copilot の記録はプロバイダーの名前を持つ');
  assert.deepEqual(Object.keys(cRecs[0][1]).sort(), ['at', 'provider', 'version'], 'GitHub Copilot の記録は版・同意日時・プロバイダーの名前だけ');
  assert.ok(typeof cRecs[0][1].version === 'string' && cRecs[0][1].version.length > 0 && Number.isFinite(cRecs[0][1].at));
  assert.equal((await a.app.commands['file.save']()).ok, true);
  const saved = a.env.downloads.at(-1).data;
  assert.ok(!/consent/i.test(saved) && !saved.includes(TOKEN_PROBE), 'セッションファイルに同意の記録を含めない（AC-312）');
  assert.equal((await a.app.setLlmProvider('foundry')).ok, true); await flush();
  assert.equal(a.app.getLlmState().enabled, true, 'Foundry へ戻すと再同意なしに有効'); assert.equal(a.app.getLlmConsent(), null);
  await a.app.setLlmProvider('copilot'); await flush();
  assert.equal(a.app.getLlmState().enabled, true, 'GitHub Copilot へ戻しても再同意なし');
  const b = await reload(a);
  assert.equal(b.app.getLlmProvider(), 'copilot'); assert.equal(b.app.getLlmState().enabled, true, '再読込後も保たれる');
});

test('FR-062 AC-513 異常系: プロバイダーの記録がない従来の同意は Foundry への同意として有効のまま。GitHub Copilot の同意を拒否すると無効で記録は作られず、Copilot だけの同意では Foundry は有効にならない。一方の記録の作成・削除は他方の記録を変えない', async () => {
  const a = await boot({ relay: { copilot: SIGNED_IN } });
  await enable(a.app);
  const rec = JSON.parse(a.env.storage.getItem('grp.llm.consent'));
  for (const [k] of a.env.storage.dump()) if (k.startsWith('grp.llm.consent')) a.env.storage.removeItem(k);
  a.env.storage.setItem('grp.llm.consent', JSON.stringify({ version: rec.version, at: rec.at })); // 2026-10-24 より前の形
  const b = await reload(a);
  assert.equal(b.app.getLlmProvider(), 'foundry');
  assert.equal(b.app.getLlmState().enabled, true, '再同意なしに有効のまま'); assert.equal(b.app.getLlmConsent(), null);
  await b.app.setLlmProvider('copilot'); await flush();
  assert.equal(b.app.getLlmState().enabled, false, '従来の同意は GitHub Copilot への同意ではない');
  await b.app.requestLlmEnable(); await b.app.answerLlmConsent(false);
  assert.equal(b.app.getLlmState().enabled, false);
  assert.ok(!consentRecords(a.env).some(([, v]) => v.provider === 'copilot'), '拒否では記録を作らない');
  b.app.commands['session.start'](); type(b.app, a.env, '拒否後の要点'); await b.app.flushLlm();
  assert.equal(b.relay.llmCalls().filter((x) => x.provider === 'copilot').length, 0);
  await b.app.setLlmProvider('foundry'); await flush();
  assert.equal(b.app.getLlmState().enabled, true, 'Foundry の同意は残る');
  // Copilot だけに同意
  const c = await boot({ relay: { provider: 'copilot', copilot: SIGNED_IN } });
  await enable(c.app);
  await c.app.setLlmProvider('foundry'); await flush();
  assert.equal(c.app.getLlmState().enabled, false, 'Copilot の同意で Foundry は有効にならない');
  c.app.commands['session.start'](); type(c.app, c.env, '要点'); await c.app.flushLlm();
  assert.equal(c.relay.llmCalls().filter((x) => x.provider === 'foundry').length, 0);
  // 一方の記録の作成・削除は他方の記録を変えない
  const d = await boot({ relay: { copilot: SIGNED_IN } });
  await enable(d.app);
  const fRaw = d.env.storage.getItem('grp.llm.consent');
  assert.ok(fRaw, 'Foundry の記録');
  await d.app.setLlmProvider('copilot'); await flush();
  await enable(d.app);
  assert.equal(d.env.storage.getItem('grp.llm.consent'), fRaw, 'GitHub Copilot の記録の作成で Foundry の記録は変わらない');
  await d.app.disableLlm(); await flush();
  assert.ok(!consentRecords(d.env).some(([, v]) => v.provider === 'copilot'), 'GitHub Copilot の記録は取り消される');
  assert.equal(d.env.storage.getItem('grp.llm.consent'), fRaw, 'GitHub Copilot の記録の削除で Foundry の記録は変わらない');
  await d.app.setLlmProvider('foundry'); await flush();
  assert.equal(d.app.getLlmState().enabled, true, 'Foundry は再同意なしに有効のまま'); assert.equal(d.app.getLlmConsent(), null);
});

// ======================= FR-068 =======================
// FR-068 AC-514
test('FR-068 AC-514: ［設定］にプロバイダーの選択（初期値 Microsoft Foundry）があり、キーボードで選べ、再読込・初期化の後も保たれ、もう一方の設定は消えず、接続テストは選んだプロバイダーへ', async () => {
  const a = await boot({ relay: { copilot: SIGNED_IN } });
  a.app.commands['settings.open'](); await flush();
  const f = sfield(a.app, 'llm.provider');
  assert.ok(f, '［設定］にプロバイダーの選択がある');
  assert.equal(f.value, 'foundry', '初期値は Microsoft Foundry');
  assert.deepEqual(f.options.map((o) => o.value), ['foundry', 'copilot']);
  assert.ok(['radiogroup', 'combobox', 'listbox'].includes(f.role)); assert.equal(f.focusable, true);
  for (const lang of ['ja', 'en']) { a.app.setLang(lang); assert.ok(weight(sfield(a.app, 'llm.provider').label) <= PARAM_011, `${lang}: ラベルは ${PARAM_011} 文字以内`); }
  const enLabel = sfield(a.app, 'llm.provider').label; a.app.setLang('ja');
  assert.notEqual(sfield(a.app, 'llm.provider').label, enLabel, 'ラベルは表示言語に従う');
  a.app.focusSettingsField('llm.provider');
  a.app.handleKey({ key: 'ArrowDown' }); await flush();
  assert.equal(a.app.getLlmProvider(), 'copilot', 'キーボードだけで選べる');
  assert.equal(sfield(a.app, 'llm.provider').value, 'copilot');
  a.app.handleKey({ key: 'ArrowUp' }); await flush();
  assert.equal(a.app.getLlmProvider(), 'foundry');
  a.app.handleKey({ key: 'ArrowDown' }); await flush();
  a.app.handleKey({ key: 'Escape' }); await flush();
  const b = await reload(a);
  assert.equal(b.app.getLlmProvider(), 'copilot', '再読込・再起動の後も保たれる');
  b.app.commands['data.reset'](); await b.app.dialogAction('confirm'); await flush(); await settle(b.app);
  assert.equal(b.app.getLlmProvider(), 'copilot', 'データの初期化で変わらない');
  assert.equal(a.relay.calls.filter((c) => c.method === 'DELETE' && ['/api/llm/key', '/api/llm/config', '/api/llm/copilot'].includes(c.path)).length, 0, 'もう一方の設定を消さない');
  assert.equal(a.relay.foundry.credential, true); assert.equal(a.relay.cp.signedIn, true);
  // 接続テストは選んだプロバイダーへ
  await enable(b.app);
  const n = a.relay.llmCalls().length;
  await b.app.testLlmConnection(); await flush();
  const t = a.relay.llmCalls().slice(n);
  assert.ok(t.length >= 1 && t.every((x) => x.provider === 'copilot'), '接続テストは GitHub Copilot に対して行われる');
});

test('FR-068 AC-514 異常系: 従来から Foundry を使う利用者は更新後も Foundry・同意・有効・図が変わらない。選んだプロバイダーが未設定ならその項目が示され、未同意のプロバイダーへの接続テストは送らない', async () => {
  // 従来の利用者（プロバイダーの記録がない同意）
  const a = await boot({ relay: { copilot: SIGNED_IN } });
  await enable(a.app);
  const rec = JSON.parse(a.env.storage.getItem('grp.llm.consent'));
  for (const [k] of a.env.storage.dump()) if (k.startsWith('grp.llm.consent')) a.env.storage.removeItem(k);
  a.env.storage.setItem('grp.llm.consent', JSON.stringify({ version: rec.version, at: rec.at }));
  const b = await reload(a);
  const ctl = await boot({ relay: { copilot: SIGNED_IN } }); await enable(ctl.app);
  assert.equal(b.app.getLlmProvider(), 'foundry'); assert.equal(b.app.getLlmState().enabled, true); assert.equal(b.app.getLlmConsent(), null);
  b.app.commands['session.start'](); ctl.app.commands['session.start']();
  type(b.app, a.env, '予算の見直しが必要です'); type(ctl.app, ctl.env, '予算の見直しが必要です');
  await b.app.flushLlm(); await ctl.app.flushLlm();
  assert.equal(b.app.renderSvg(), ctl.app.renderSvg(), '図の結果が変わらない');
  assert.ok(a.relay.llmCalls().length >= 1 && a.relay.llmCalls().every((x) => x.provider === 'foundry'), 'Foundry への要求のまま');
  // 選んだプロバイダーが未設定
  const u = await boot({ relay: { foundry: false, copilot: SIGNED_IN } });
  const r1 = await u.app.requestLlmEnable();
  assert.equal(r1.ok, false); assert.ok(r1.missing.length > 0 && !r1.missing.includes('signin'), 'Foundry の未設定の項目');
  await u.app.setLlmProvider('copilot'); await flush();
  const r2 = await u.app.requestLlmEnable();
  assert.deepEqual([r2.ok, r2.pending], [true, 'consent'], 'GitHub Copilot は設定済みなので同意へ進む');
  await u.app.answerLlmConsent(false);
  const v = await boot({ relay: { provider: 'copilot' } });
  const r3 = await v.app.requestLlmEnable();
  assert.equal(r3.ok, false); assert.deepEqual(r3.missing, ['signin'], 'GitHub Copilot の未設定の項目');
  // 未同意のプロバイダーへの接続テスト
  await v.app.testLlmConnection(); await flush();
  await u.app.testLlmConnection(); await flush();
  assert.equal(v.relay.llmCalls().length + u.relay.llmCalls().length, 0, '同意前の接続テストは送らない');
});
