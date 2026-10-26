// FR-089 AC-524・AC-525・AC-526・AC-532・AC-533、FR-062 AC-534 の単体・結合テスト（単価・使用額の加算・停止と再開・導入の案内・ラベルの字数）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { BUDGET_KEY, PRICE_IN_DEFAULT, PRICE_OUT_DEFAULT } from '../../web/src/budget.js';

const OK = { configured: { endpoint: true, deployment: true, credential: true }, endpointHost: 'example.invalid' };
const relayOf = (usage) => { const log = []; return { log, calls: () => log.filter((r) => !r.path.startsWith('/api/llm/status')), relay: async (req) => { log.push(req); if (req.path.startsWith('/api/llm/status')) return { status: 200, body: OK }; return { status: 200, body: { objects: [], people: [], emotions: [], metaphors: [], ...(usage ? { usage } : {}) } }; } }; };
async function enabled(h) { const c = await newApp({ options: { relay: h.relay } }); await c.app.requestLlmEnable(); await c.app.answerLlmConsent(true); c.app.commands['session.start'](); return c; }

test('FR-089 AC-524: 既定の単価は PARAM-102・103、設定画面の項目ラベルは PARAM-011（全角 6 字）以内', async () => {
  assert.deepEqual([PRICE_IN_DEFAULT, PRICE_OUT_DEFAULT], [400, 1600]);
  const { app } = await newApp();
  app.commands['settings.open']();
  for (const id of ['budget.yen', 'budget.priceIn', 'budget.priceOut']) assert.ok([...app.getSettingsDialog().fields.find((f) => f.id === id).label].length <= 6, id);
});

test('FR-089 AC-525: 単価の保存は数値だけで、片方だけ不正でも両方とも直前の値を保つ', async () => {
  const { app, env } = await newApp();
  assert.equal(app.setPricing({ inputPer1M: 10, outputPer1M: 20 }).ok, true);
  assert.equal(app.setPricing({ inputPer1M: 30, outputPer1M: 1.5 }).ok, false);
  assert.deepEqual([app.getPricing().inputPer1M, app.getPricing().outputPer1M], [10, 20]);
  assert.deepEqual(JSON.parse(env.storage.getItem(BUDGET_KEY)), { budgetYen: 10000, priceIn: 10, priceOut: 20 });
});

test('FR-089 AC-526: usage の無い応答は加算せず、あれば設定単価で加算する', async () => {
  const none = relayOf(null); const a = await enabled(none);
  a.app.llmCall('/api/llm/extract', { input: 'x' }); await a.app.flushLlm();
  assert.equal(a.app.getBudgetUsage().yen, 0);
  const h = relayOf({ inputTokens: 1_000_000, outputTokens: 500_000 }); const b = await enabled(h);
  await b.app.llmCall('/api/llm/extract', { input: 'x' });
  assert.equal(b.app.getBudgetUsage().yen, 400 + 800);
  assert.match(b.app.getBudgetStatus().text, /1200/);
});

test('FR-089 AC-532・AC-533: 予算 0 円は呼ばず、使用額以下への変更では再開せず、超える値で再開する', async () => {
  const h = relayOf({ inputTokens: 1_000_000, outputTokens: 0 }); const { app } = await enabled(h);
  app.setBudget(0);
  assert.equal((await app.llmCall('/api/llm/extract', { input: 'x' })).reason, 'budget');
  assert.equal(h.calls().length, 0);
  assert.equal(app.getBudgetWarning().key, 'budget.zero');
  app.setBudget(300); await app.llmCall('/api/llm/extract', { input: 'x' }); // 使用額 400 >= 300
  assert.equal(app.getBudgetWarning().key, 'budget.reached');
  app.setBudget(400); assert.notEqual(app.getBudgetWarning(), null);
  app.setBudget(401); assert.equal(app.getBudgetWarning(), null);
  assert.equal((await app.llmCall('/api/llm/extract', { input: 'x' })).ok, true);
});

test('FR-062 AC-534: 案内は同意の記録があれば出ず、有効化で消える', async () => {
  const h = relayOf(null); const c = await newApp({ options: { relay: h.relay } });
  assert.equal(c.app.getLlmGuide().visible, true);
  await c.app.requestLlmEnable(); await c.app.answerLlmConsent(true);
  assert.equal(c.app.getLlmGuide().visible, false);
  const again = await newApp({ storage: c.env.storage, options: { relay: h.relay } });
  assert.equal(again.app.getLlmGuide().visible, false, '同意の記録があるときは案内を出さない');
});
