// FR-089 AC-524・AC-525・AC-526・AC-532・AC-533、FR-062 AC-534（System Test。契約: tests/system/CONTRACT-LIVE-EXPORT.md「予算・使用額・導入の案内」）
// 期待値は受入基準と PARAM-101（10,000 円）・PARAM-102（入力 400 円/100 万トークン）・PARAM-103（出力 1,600 円/100 万トークン）だけから決める。
// 生成 AI は同一オリジンの中継のモック（実 Foundry は呼ばない）。使用トークンは応答の usage で渡す。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, PARAM } from './helpers.js';

const PRICE = { inputPer1M: 400, outputPer1M: 1600 }; // PARAM-102・PARAM-103
const CONFIGURED = { configured: { endpoint: true, deployment: true, credential: true }, endpointHost: 'example.invalid' };
const yenOf = (inTok, outTok) => (inTok * PRICE.inputPer1M + outTok * PRICE.outputPer1M) / 1_000_000;

function makeRelay(usage = { inputTokens: 100_000, outputTokens: 50_000 }) {
  const log = [];
  const relay = async (req) => {
    log.push(req);
    if (req.path.startsWith('/api/llm/status')) return { status: 200, body: CONFIGURED };
    if (req.path === '/api/llm/extract') return { status: 200, body: { objects: [], people: [], emotions: [], metaphors: [], usage } };
    return { status: 404, body: {} };
  };
  return { relay, log, llmReqs: () => log.filter((r) => !r.path.startsWith('/api/llm/status')) };
}

async function enabledApp(h, { budget } = {}) {
  const ctx = await newApp({ options: { relay: h.relay } });
  const { app } = ctx;
  if (budget !== undefined) assert.equal(app.setBudget(budget).ok, true);
  assert.equal((await app.requestLlmEnable()).ok, true);
  await app.answerLlmConsent(true);
  assert.equal(app.getLlmState().enabled, true);
  app.commands['session.start']();
  return ctx;
}
const say = async (app, env, text) => { app.setDraft(text); app.submitDraft(); env.tick(1); await app.flushLlm(); };
const field = (app, id) => app.getSettingsDialog().fields.find((f) => f.id === id);

// FR-089 AC-524
test('FR-089 AC-524: 初めて開いた状態で、予算 10,000 円・単価 入力 400 円／出力 1,600 円（100 万トークンあたり）が［設定］画面に表示される', async () => {
  const { app } = await newApp();
  assert.equal(PARAM.BUDGET_DEFAULT_YEN, 10000);
  app.commands['settings.open']();
  assert.equal(field(app, 'budget.yen').value, 10000);
  assert.equal(field(app, 'budget.priceIn').value, 400);
  assert.equal(field(app, 'budget.priceOut').value, 1600);
  assert.deepEqual(app.getPricing(), { inputPer1M: 400, outputPer1M: 1600, default: { inputPer1M: 400, outputPer1M: 1600 } });
  assert.ok(app.getSettingsView().fields.some((f) => f.id === 'budget.priceIn') && app.getSettingsView().fields.some((f) => f.id === 'budget.priceOut'));
});

// FR-089 AC-525
test('FR-089 AC-525: 予算と単価を 0 以上の整数に変更して再起動後も保たれる。負・非整数は理由つきで拒否し直前の値を保つ。保存は設定値だけ（キー・トークン・セッションに含まない）', async () => {
  const first = await newApp();
  const { app, env } = first;
  app.commands['settings.open']();
  assert.equal(app.setBudget(0).ok, true);
  assert.equal(app.setBudget('3000').ok, true);
  assert.equal(app.setPricing({ inputPer1M: 500, outputPer1M: 0 }).ok, true);
  const again = await newApp({ storage: env.storage });
  assert.equal(again.app.getBudget().yen, 3000);
  assert.deepEqual({ i: again.app.getPricing().inputPer1M, o: again.app.getPricing().outputPer1M }, { i: 500, o: 0 });
  for (const bad of [-1, '-100', '12.5', 'abc', '']) {
    assert.equal(app.setBudget(bad).ok, false, `予算 ${bad}`);
    assert.ok(app.getState().message.text.length > 0, '理由が表示される');
    assert.equal(app.getBudget().yen, 3000);
    assert.equal(app.setPricing({ inputPer1M: bad, outputPer1M: 1 }).ok, false, `単価 ${bad}`);
    assert.ok(app.getState().message.text.length > 0);
    assert.deepEqual({ i: app.getPricing().inputPer1M, o: app.getPricing().outputPer1M }, { i: 500, o: 0 }, '直前の値が保たれる');
  }
  // 保存されるのは設定値だけ。キー・トークン・使用額の類を持たない
  const dump = JSON.stringify(env.storage.dump());
  assert.doesNotMatch(dump, /apiKey|api_key|token|secret|credential|password/i);
  const saved = JSON.parse(app.commands['file.save'] ? (await app.commands['file.save'](), String(env.downloads.at(-1)?.data ?? '{}')) : '{}');
  assert.doesNotMatch(JSON.stringify(saved), /budgetYen|apiKey|token|secret/i, 'セッションファイルに予算・キーを含めない');
});

// FR-089 AC-526（正常系: 使用額 = トークン × 単価。表示。予算到達で停止）／AC-532／AC-533
test('FR-089 AC-526: 使用額（推定）は トークン数×単価 の合計で記録中に確認でき、予算に達すると以降の生成 AI 呼び出しは行われず警告が出て、図の描画は続く', async () => {
  const h = makeRelay({ inputTokens: 100_000, outputTokens: 50_000 }); // 40 + 80 = 120 円
  const { app, env } = await enabledApp(h, { budget: 200 });
  await say(app, env, '予算の見直しが必要です');
  assert.equal(h.llmReqs().length, 1);
  assert.equal(app.getBudget().usedYen, yenOf(100_000, 50_000));
  assert.equal(app.getBudgetUsage().yen, 120);
  assert.equal(app.getBudgetWarning(), null, '予算未満なら警告なし');
  assert.ok(app.getBudgetStatus().text.includes('120'), '記録中の画面で使用額が確認できる');
  await say(app, env, '来月のリリース計画を決める'); // 120 + 120 = 240 >= 200
  assert.equal(h.llmReqs().length, 2);
  assert.equal(app.getBudgetUsage().yen, 240);
  assert.equal(app.getBudgetWarning()?.key, 'budget.reached');
  const before = h.llmReqs().length;
  await say(app, env, '担当者の割り当てを確認する');
  assert.equal(h.llmReqs().length, before, '予算到達後は LLM 向けの要求が増えない');
  assert.ok(app.renderSvg().includes('担当者の割り当てを確認する') || JSON.stringify(app.getState().scenes).includes('担当者の割り当てを確認する'), '図の描画（生成 AI なし）は続く');
  // 単価を変えると使用額の計算も変わる（設定された単価を使う）
  const h2 = makeRelay({ inputTokens: 1_000_000, outputTokens: 0 });
  const c2 = await enabledApp(h2, { budget: 100000 });
  assert.equal(c2.app.setPricing({ inputPer1M: 1000, outputPer1M: 0 }).ok, true);
  await say(c2.app, c2.env, '単価を変更した後の発話です');
  assert.equal(c2.app.getBudgetUsage().yen, 1000);
});

// FR-089 AC-526 警告（PARAM-105=80%）・概算表示
test('FR-089 AC-526: 使用額が予算の 80%（PARAM-105）に達すると警告が出て（到達前は出ず、まだ呼び出しは続く）、usage の無い応答は文字数から概算し「概算」と表示する', async () => {
  assert.equal(PARAM.WARN_PCT, 80);
  const h = makeRelay({ inputTokens: 100_000, outputTokens: 50_000 }); // 120 円
  const { app, env } = await enabledApp(h, { budget: 200 }); // 80% = 160 円
  await say(app, env, '一つ目の発話です');
  assert.equal(app.getBudgetUsage().yen, 120);
  assert.equal(app.getBudgetWarning(), null, '80% 未満（60%）では警告なし');
  assert.ok(!/概算/.test(app.getBudgetStatus().text), 'usage があるときは概算と表示しない');
  await say(app, env, '二つ目の発話です'); // 240 円 >= 200
  assert.equal(app.getBudgetWarning()?.key, 'budget.reached');
  const h2 = makeRelay({ inputTokens: 100_000, outputTokens: 40_000 }); // 40 + 64 = 104 円（52%）
  const c2 = await enabledApp(h2, { budget: 130 }); // 80% = 104 円ちょうど
  await say(c2.app, c2.env, '境界の発話です');
  assert.equal(c2.app.getBudgetUsage().yen, 104);
  assert.equal(c2.app.getBudgetWarning()?.key, 'budget.near', '予算の 80% に達したときの警告（到達前）');
  assert.equal(h2.llmReqs().length, 1);
  await say(c2.app, c2.env, '警告後も呼び出しは続く');
  assert.equal(h2.llmReqs().length, 2, '80% 警告だけでは停止しない');
  // usage の無いモデル: 文字数から概算し、「概算」と表示する
  const h3 = makeRelay(undefined); h3.relay = async (req) => { h3.log.push(req); return req.path.startsWith('/api/llm/status') ? { status: 200, body: CONFIGURED } : { status: 200, body: { objects: [], people: [], emotions: [], metaphors: [] } }; };
  const c3 = await enabledApp(h3, { budget: 10000 });
  await say(c3.app, c3.env, '使用トークン数の無い応答でも概算します');
  assert.ok(c3.app.getBudgetUsage().yen > 0, '送受信の文字数から概算した使用額が加わる');
  assert.ok(/概算/.test(c3.app.getBudgetStatus().text), '「概算」と表示する');
});

// FR-089 AC-527
test('FR-089 AC-527: 使用額は再読込後も保たれ（0 に戻らず、到達後の停止も保たれる）、データの初期化・新しいセッションで 0 に戻り予算の設定値は保たれる', async () => {
  const h = makeRelay({ inputTokens: 100_000, outputTokens: 50_000 }); // 120 円
  const first = await enabledApp(h, { budget: 200 });
  await say(first.app, first.env, '再読込の前の発話です');
  assert.equal(first.app.getBudgetUsage().yen, 120);
  const again = await newApp({ storage: first.env.storage, options: { relay: h.relay } });
  assert.equal(again.app.getBudgetUsage().yen, 120, '再読込で 0 に戻らない');
  assert.equal(again.app.getBudget().yen, 200);
  // 到達後の停止も保たれる
  await say(first.app, first.env, '到達させる発話です'); // 240
  assert.equal(first.app.getBudgetWarning()?.key, 'budget.reached');
  const reloaded = await newApp({ storage: first.env.storage, options: { relay: h.relay } });
  assert.equal(reloaded.app.getBudgetUsage().yen, 240);
  assert.equal(reloaded.app.getBudgetWarning()?.key, 'budget.reached', '予算到達の状態が保たれる');
  const n = h.llmReqs().length;
  // データの初期化（FR-018）: 使用額 0・予算の設定値は保つ
  assert.equal(h.llmReqs().length, n, '再読込だけでは LLM 向けの要求は増えない');
  const r = await newApp({ storage: first.env.storage, options: { relay: h.relay } });
  assert.equal(r.app.getBudgetUsage().yen, 240);
  await r.app.commands['data.reset']();
  await r.app.dialogAction('confirm');
  assert.equal(r.app.getBudgetUsage().yen, 0, 'データの初期化で使用額は 0 に戻る');
  assert.equal(r.app.getBudget().yen, 200, '予算の設定値は保たれる');
  assert.equal(r.app.getBudgetWarning(), null);
  // 新しい会議（セッション）の開始
  const s = await newApp({ storage: first.env.storage, options: { relay: h.relay } });
  s.app.commands['session.start']();
  assert.equal(s.app.getBudgetUsage().yen, 0, '新しいセッションの開始で使用額は 0');
  assert.equal(s.app.getBudget().yen, 200);
});

// FR-089 AC-532
test('FR-089 AC-532: 予算が 0 円のとき LLM 向けの要求は 0 件で、使えない旨が表示され、図の描画は続く', async () => {
  const h = makeRelay();
  const { app, env } = await enabledApp(h, { budget: 0 });
  await say(app, env, '予算の見直しが必要です');
  await say(app, env, 'リリース計画を決める');
  assert.equal(h.llmReqs().length, 0);
  assert.equal(app.getBudgetWarning()?.key, 'budget.zero');
  assert.ok(app.getBudgetWarning().text.length > 0);
  assert.ok(JSON.stringify(app.getState().scenes).includes('リリース計画を決める'), '図の描画は続く');
});

// FR-089 AC-533
test('FR-089 AC-533: 到達後も警告は表示され続け呼び出しは再開されない。予算を使用額より大きくする／新しいセッションで警告が消え再開される（異常系: 使用額以下への変更では再開しない）', async () => {
  const h = makeRelay({ inputTokens: 100_000, outputTokens: 50_000 }); // 1 回 120 円
  const { app, env } = await enabledApp(h, { budget: 100 });
  await say(app, env, '一つ目の発話です');
  assert.equal(h.llmReqs().length, 1);
  assert.equal(app.getBudgetWarning()?.key, 'budget.reached');
  await say(app, env, '二つ目の発話です');
  assert.equal(h.llmReqs().length, 1);
  assert.equal(app.getBudgetWarning()?.key, 'budget.reached', '警告は表示され続ける');
  app.setBudget(120); // 使用額（120）以下 → 再開しない
  await say(app, env, '三つ目の発話です');
  assert.equal(h.llmReqs().length, 1);
  assert.notEqual(app.getBudgetWarning(), null);
  app.setBudget(1000); // 使用額より大きい → 再開
  assert.equal(app.getBudgetWarning(), null, '警告が消える');
  await say(app, env, '四つ目の発話です');
  assert.equal(h.llmReqs().length, 2, '呼び出しが再開される');
  // 新しいセッション
  const h2 = makeRelay({ inputTokens: 100_000, outputTokens: 50_000 });
  const c2 = await enabledApp(h2, { budget: 100 });
  await say(c2.app, c2.env, '最初の発話です');
  assert.equal(c2.app.getBudgetWarning()?.key, 'budget.reached');
  c2.app.commands['session.stop']?.();
  c2.app.commands['session.start']();
  assert.equal(c2.app.getBudgetUsage().yen, 0);
  assert.equal(c2.app.getBudgetWarning(), null);
  await say(c2.app, c2.env, '新しいセッションの発話です');
  assert.equal(h2.llmReqs().length, 2);
});

// FR-062 AC-534
test('FR-062 AC-534: 初めて開くと有効化の案内が出る。閉じる・無視しても同意まで LLM 向け要求は 0 件で、何度でも閉じられ、設定画面から有効化できる', async () => {
  const h = makeRelay();
  const { app, env } = await newApp({ options: { relay: h.relay } });
  const g = app.getLlmGuide();
  assert.equal(g.visible, true, '初回は案内が表示される');
  assert.ok(g.text.length > 0);
  assert.equal(app.getLlmState().enabled, false);
  await app.dismissLlmGuide();
  assert.equal(app.getLlmGuide().visible, false);
  assert.equal(app.getLlmState().enabled, false, '閉じても無効のまま');
  await say(app, env, '案内を閉じた後の発話です');
  assert.equal(h.llmReqs().length, 0, '同意するまで LLM 向け要求は 0 件');
  // 無視（閉じない）でも同様
  const h2 = makeRelay();
  const c2 = await newApp({ options: { relay: h2.relay } });
  c2.app.commands['session.start']();
  await say(c2.app, c2.env, '案内を無視した発話です');
  assert.equal(h2.llmReqs().length, 0);
  // 何度でも閉じられる（再読込で再表示 → 再び閉じられる）
  const c3 = await newApp({ storage: env.storage, options: { relay: h.relay } });
  assert.equal(c3.app.getLlmGuide().visible, true);
  await c3.app.dismissLlmGuide();
  assert.equal(c3.app.getLlmGuide().visible, false);
  // 閉じた後も設定画面からいつでも有効化できる
  c3.app.commands['settings.open']();
  assert.ok(field(c3.app, 'llm.enabled'));
  assert.equal((await c3.app.requestLlmEnable()).ok, true, '同意の表示へ進める');
  assert.ok(c3.app.getLlmConsent(), '送信内容の表示と同意（AC-310）');
});
