// FR-062 AC-309 AC-310 AC-313 AC-314 AC-315 AC-316 / FR-068 AC-353 AC-355 AC-356（System Test。契約: tests/system/CONTRACT-LLM-FR062.md）
// 期待値は受入基準だけから決める。実 Foundry は呼ばず、同一オリジンの中継サーバーをモックで差し込む（決定的）。
// AC-312・AC-360 は BLOCKED（Q-016・Q-017）のためここでは扱わない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes } from './helpers.js';

const HOST = 'foundry.example.test';
const LEAK_PROBE = 'PROBE-KEY-0000-not-a-real-secret';
const ALL_SET = { endpoint: true, deployment: true, credential: true };

// 中継サーバーのモック。mode: 'ok' | 'timeout' | 'error' | 'malformed' | 'offline' | 'hold'
function makeRelay({ configured = ALL_SET, mode = 'ok' } = {}) {
  const r = { calls: [], mode, held: [], configured: { ...configured } };
  r.fn = async ({ method = 'GET', path, body }) => {
    r.calls.push({ method, path, body });
    if (path === '/api/llm/status') {
      // 漏れの探針: 中継が誤ってキーを返しても、アプリは表示・保存しない（AC-355）
      return { status: 200, body: { configured: r.configured, endpointHost: HOST, apiKey: LEAK_PROBE } };
    }
    if (r.mode === 'offline') throw new TypeError('Failed to fetch');
    if (r.mode === 'timeout') return new Promise(() => {});
    if (r.mode === 'error') return { status: 500, body: { error: 'upstream' } };
    if (r.mode === 'malformed') return { status: 200, body: '<<not json>>' };
    if (r.mode === 'hold') return new Promise((resolve) => { r.held.push(() => resolve({ status: 200, body: { points: ['LLM-ONLY-POINT'] } })); });
    return { status: 200, body: { points: ['LLM-ONLY-POINT'] } };
  };
  r.llmCalls = () => r.calls.filter((c) => c.path.startsWith('/api/llm/') && c.path !== '/api/llm/status');
  return r;
}

async function appWith(relayOpts) {
  const relay = makeRelay(relayOpts);
  const ctx = await newApp({ options: { relay: relay.fn } });
  return { ...ctx, relay };
}

async function enable(app) {
  const r1 = await app.requestLlmEnable();
  assert.equal(r1.ok, true, 'consent へ進める');
  await app.answerLlmConsent(true);
  assert.equal(app.getLlmState().enabled, true);
}

const type = (app, env, ...texts) => { for (const t of texts) { app.setDraft(t); app.submitDraft(); env.tick(1); } };

// FR-062 AC-309
test('FR-062 AC-309: 初めて開いた状態では LLM 連携は無効で、会話を入力しても LLM 向けの要求は 0 件・図はルールベースと同じ', async () => {
  const a = await appWith(); const b = await newApp(); // b は中継なしの基準
  assert.equal(a.app.getLlmState().enabled, false);
  assert.equal(a.app.getLlmState().status, 'disabled');
  a.app.commands['session.start'](); b.app.commands['session.start']();
  type(a.app, a.env, '予算の見直しが必要です', 'コストが高くて困った');
  type(b.app, b.env, '予算の見直しが必要です', 'コストが高くて困った');
  await a.app.flushLlm();
  assert.equal(a.relay.llmCalls().length, 0);
  assert.equal(a.app.renderSvg(), b.app.renderSvg());
});

test('FR-062 AC-309 異常系: 同意の途中（同意の表示を出しただけ）でも会話の入力は LLM 向けの要求を 0 件にする', async () => {
  const { app, env, relay } = await appWith();
  app.commands['settings.open']();
  await app.requestLlmEnable();
  assert.ok(app.getLlmConsent());
  app.commands['session.start']();
  type(app, env, '要点の入力');
  await app.flushLlm();
  assert.equal(relay.llmCalls().length, 0);
  assert.equal(app.getLlmState().enabled, false);
});

// FR-062 AC-310
test('FR-062 AC-310: 有効化の操作で送信内容（種類・送信先ホスト名・送らないもの）が表示され、同意するまで有効にならない', async () => {
  const { app, env, relay } = await appWith();
  app.commands['settings.open']();
  const r = await app.requestLlmEnable();
  assert.deepEqual([r.ok, r.pending], [true, 'consent']);
  assert.equal(app.getLlmState().enabled, false, '同意前は無効');
  const c = app.getLlmConsent();
  assert.ok(c && c.open === true);
  assert.ok(c.kinds.length > 0 && c.kinds.every((k) => String(k).trim()), '送る項目の種類');
  assert.equal(c.host, HOST, '送信先のホスト名');
  assert.ok(c.notSent.length > 0 && c.notSent.every((k) => String(k).trim()), '送らないもの');
  assert.ok(c.actions.some((x) => x.id === 'accept') && c.actions.some((x) => x.id === 'decline'));
  app.commands['session.start']();
  type(app, env, '同意前の発話');
  await app.flushLlm();
  assert.equal(relay.llmCalls().length, 0);
  await app.answerLlmConsent(true);
  assert.equal(app.getLlmState().enabled, true);
  assert.equal(app.getLlmConsent(), null);
});

test('FR-062 AC-310 異常系: 同意せずに閉じる（拒否・Esc）と無効のままで LLM 向けの要求は 0 件', async () => {
  for (const how of ['decline', 'escape']) {
    const { app, env, relay } = await appWith();
    app.commands['settings.open']();
    await app.requestLlmEnable();
    if (how === 'decline') await app.answerLlmConsent(false); else app.handleKey({ key: 'Escape' });
    assert.equal(app.getLlmConsent(), null, how);
    assert.equal(app.getLlmState().enabled, false, how);
    app.commands['session.start']();
    type(app, env, '拒否後の発話');
    await app.flushLlm();
    assert.equal(relay.llmCalls().length, 0, how);
  }
});

// FR-062 AC-313
test('FR-062 AC-313: エンドポイント・デプロイ名・認証情報のいずれかが未設定なら有効にできず、未設定の項目が示され、図はルールベースのまま', async () => {
  for (const miss of ['endpoint', 'deployment', 'credential']) {
    const { app, env, relay } = await appWith({ configured: { ...ALL_SET, [miss]: false } });
    const base = await newApp();
    app.commands['settings.open']();
    const r = await app.requestLlmEnable();
    assert.equal(r.ok, false, miss);
    assert.deepEqual(r.missing, [miss], miss);
    assert.equal(app.getLlmConsent(), null, `${miss}: 同意の表示へ進まない`);
    const st = app.getLlmState();
    assert.equal(st.enabled, false, miss);
    assert.equal(st.status, 'unconfigured', miss);
    assert.deepEqual(st.missing, [miss], miss);
    app.commands['session.start'](); base.app.commands['session.start']();
    type(app, env, '未設定での発話'); type(base.app, base.env, '未設定での発話');
    await app.flushLlm();
    assert.equal(relay.llmCalls().length, 0, miss);
    assert.equal(app.renderSvg(), base.app.renderSvg(), miss);
  }
});

test('FR-062 AC-313 異常系: 3 項目すべて未設定のとき、未設定の項目がすべて示される', async () => {
  const { app } = await appWith({ configured: { endpoint: false, deployment: false, credential: false } });
  const r = await app.requestLlmEnable();
  assert.equal(r.ok, false);
  assert.deepEqual([...r.missing].sort(), ['credential', 'deployment', 'endpoint']);
});

// FR-062 AC-314
test('FR-062 AC-314: 有効時にタイムアウト・エラー応答・不正な応答・オフラインで失敗しても、ルールベース描画で表示され、短く通知され、入力・選択・レイアウトは失われず他の機能は使える', async () => {
  for (const mode of ['timeout', 'error', 'malformed', 'offline']) {
    const { app, env, relay } = await appWith();
    const base = await newApp();
    await enable(app);
    relay.mode = mode;
    app.commands['session.start'](); base.app.commands['session.start']();
    type(app, env, '予算の見直しが必要です'); type(base.app, base.env, '予算の見直しが必要です');
    app.setLayoutTypes(['zone']); base.app.setLayoutTypes(['zone']);
    app.setDraft('入力中の文字');
    assert.ok(relay.llmCalls().length >= 1, `${mode}: 有効なので LLM 向けの要求が出る`);
    if (mode === 'timeout') env.scheduler.advance(30_000); // PARAM-069
    await app.flushLlm();
    assert.equal(app.renderSvg(), base.app.renderSvg(), `${mode}: ルールベース描画と同じ`);
    const msg = app.getState().message;
    assert.ok(msg && msg.text.trim() && msg.text.length <= 80, `${mode}: 失敗の通知は短い`);
    assert.equal(app.getState().input.draft, '入力中の文字', `${mode}: 入力中の内容`);
    assert.deepEqual(app.getLayoutInfo().selected, ['zone'], `${mode}: レイアウト`);
    assert.equal(app.getState().session, 'recording', `${mode}: 記録は続く`);
    relay.mode = 'ok';
    app.submitDraft(); env.tick(1); // ほかの機能は使い続けられる
    assert.ok(app.getState().utterances.some((u) => u.text === '入力中の文字'), `${mode}: 入力を続けられる`);
    assert.ok(app.setViewMode('3d')); app.setViewMode('2d');
  }
});

test('FR-062 AC-314 異常系: タイムアウトの境界 — 30 秒より前は待ち続け（通知なし）、30 秒で失敗として扱う', async () => {
  const { app, env, relay } = await appWith();
  await enable(app);
  relay.mode = 'timeout';
  app.commands['session.start']();
  type(app, env, '待つ発話');
  const before = app.getState().message?.text ?? '';
  env.scheduler.advance(29_000);
  assert.equal(app.getState().message?.text ?? '', before, '29 秒では失敗の通知は出ない');
  env.scheduler.advance(1_000);
  await app.flushLlm();
  assert.notEqual(app.getState().message?.text ?? '', before, '30 秒で失敗が通知される');
});

// FR-062 AC-315
test('FR-062 AC-315: 無効化すると以降の LLM 向けの要求は 0 件で、処理中の要求の結果は図に反映されない', async () => {
  const { app, env, relay } = await appWith({ mode: 'hold' });
  const base = await newApp();
  await enable(app);
  app.commands['session.start'](); base.app.commands['session.start']();
  type(app, env, '処理中の発話'); type(base.app, base.env, '処理中の発話');
  assert.ok(relay.llmCalls().length >= 1 && relay.held.length >= 1, '要求が処理中');
  await app.disableLlm();
  assert.equal(app.getLlmState().enabled, false);
  const n = relay.llmCalls().length;
  relay.held.forEach((release) => release()); // 処理中の要求が無効化の後に完了する
  await app.flushLlm();
  assert.ok(!app.renderSvg().includes('LLM-ONLY-POINT'), '無効化後の結果は図に出ない');
  type(app, env, '無効化後の発話'); type(base.app, base.env, '無効化後の発話');
  await app.flushLlm();
  assert.equal(relay.llmCalls().length, n, '無効化後は新しい要求が 0 件');
  assert.equal(app.renderSvg(), base.app.renderSvg());
});

// FR-062 AC-316
test('FR-062 AC-316: LLM 有効でネットワーク遮断でも、起動・手入力・図の表示・2D/3D 切替・保存（PNG/SVG/PDF）が動き、同一オリジン以外へのリクエストは 0 件', async () => {
  const calls = []; const saved = {};
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
  for (const k of names) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: function (...a) { calls.push({ k, a }); throw new Error('network blocked'); } });
  }
  try {
    const { app, env, relay } = await appWith();
    await enable(app);
    relay.mode = 'offline'; // 遮断: 中継への要求も失敗する
    await seedThreeScenes(app, env);
    await app.flushLlm();
    assert.ok(app.renderSvg().includes('予算'), '図が表示される');
    assert.ok(app.setViewMode('3d')); app.setViewMode('2d');
    await app.commands['save.png'](); await app.commands['save.svg'](); await app.commands['save.pdf']();
    assert.equal(env.downloads.length, 3, '3 形式で保存できる');
    assert.equal(relay.calls.every((c) => c.path.startsWith('/')), true, '中継への要求は同一オリジンのパスだけ');
    assert.deepEqual(calls.filter((c) => !String(c.a[0] ?? '').startsWith('/')), [], '同一オリジン以外へのリクエストは 0 件');
  } finally {
    for (const k of names) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
  }
});

// FR-068 AC-353
test('FR-068 AC-353: 設定画面に LLM 連携の切替と現在の状態（無効・有効・未設定・エラー）が表示され、有効化は同意の手順を経る', async () => {
  const field = (app) => app.getSettingsDialog().fields.find((f) => f.id === 'llm.enabled');
  const { app, env, relay } = await appWith();
  app.commands['settings.open']();
  assert.ok(field(app), '切替がある');
  assert.equal(field(app).value, false);
  assert.equal(field(app).status.id, 'disabled');
  const r = await app.requestLlmEnable(); // 設定画面の切替。同意なしには有効にならない
  assert.equal(r.pending, 'consent', '同意の手順に進む');
  assert.ok(app.getLlmConsent());
  assert.equal(app.getLlmState().enabled, false);
  await app.answerLlmConsent(true);
  assert.equal(field(app).value, true);
  assert.equal(field(app).status.id, 'enabled');
  relay.mode = 'error';
  app.commands['session.start'](); type(app, env, '失敗させる発話');
  await app.flushLlm();
  assert.equal(field(app).status.id, 'error', 'エラーの状態');
  const un = await appWith({ configured: { ...ALL_SET, credential: false } });
  un.app.commands['settings.open']();
  await un.app.requestLlmEnable();
  assert.equal(un.app.getSettingsDialog().fields.find((f) => f.id === 'llm.enabled').status.id, 'unconfigured');
  for (const f of [field(app)]) assert.ok(f.status.text.trim(), '状態は文字で示される');
});

// FR-068 AC-355
test('FR-068 AC-355: 設定画面は API キー・トークンの値を表示せず「設定済み」「未設定」だけを示し、入力欄がなく、DOM・保存領域にキーは置かれない', async () => {
  for (const credential of [true, false]) {
    const { app, env } = await appWith({ configured: { ...ALL_SET, credential } });
    app.commands['settings.open']();
    await app.requestLlmEnable();
    if (app.getLlmConsent()) await app.answerLlmConsent(true);
    app.commands['session.start'](); type(app, env, '発話');
    await app.flushLlm();
    const dlg = app.getSettingsDialog();
    const cred = dlg.fields.find((f) => f.id === 'llm.credential');
    assert.ok(cred, '認証情報の状態の行がある');
    assert.equal(cred.status.text, credential ? '設定済み' : '未設定');
    assert.equal(cred.input, undefined, '入力欄がない');
    assert.ok(dlg.fields.every((f) => !/^(password|secret)$/.test(String(f.type ?? '')) && !/key|token/i.test(String(f.id).replace('credential', ''))), '鍵・トークン用の入力項目がない');
    const everything = JSON.stringify([app.getSettingsDialog(), app.getSettingsView?.({ viewportWidth: 1280 }), app.getState(), app.getStrings(), env.storage.dump(), app.renderSvg()]);
    assert.ok(!everything.includes(LEAK_PROBE), 'キーの値が画面・状態・保存領域のどこにもない');
  }
});

// FR-068 AC-356
test('FR-068 AC-356: LLM 連携の操作はキーボードだけででき、読み上げの対象で、状態を色だけで示さない', async () => {
  const { app } = await appWith();
  app.commands['settings.open']();
  const f = app.getSettingsDialog().fields.find((x) => x.id === 'llm.enabled');
  assert.ok(f.label.trim());
  assert.ok(['switch', 'checkbox'].includes(f.role), 'role が読み上げ可能');
  assert.equal(f.focusable, true);
  assert.ok(f.status.text.trim() && String(f.status.icon ?? '').trim(), '状態は文字とアイコンで示す（色だけでない）');
  app.focusSettingsField('llm.enabled');
  app.handleKey({ key: 'Enter' }); // キーボードだけで有効化の操作
  await app.flushLlm();
  const c = app.getLlmConsent();
  assert.ok(c && c.role && c.label.trim(), '同意の表示も役割とラベルを持つ');
  assert.ok(c.actions.every((a) => a.focusable === true && a.label.trim()));
  app.handleKey({ key: 'Escape' }); // キーボードだけで拒否
  assert.equal(app.getLlmConsent(), null);
  assert.equal(app.getLlmState().enabled, false);
  assert.equal(app.getCommandBar().status.role, 'status');
});

test('FR-068 AC-356 異常系: 設定画面を Esc で閉じても LLM 連携の状態は意図せず有効にならない', async () => {
  const { app } = await appWith();
  app.commands['settings.open']();
  app.focusSettingsField('llm.enabled');
  app.handleKey({ key: 'Escape' });
  assert.equal(app.getSettingsDialog(), null);
  assert.equal(app.getLlmState().enabled, false);
});
