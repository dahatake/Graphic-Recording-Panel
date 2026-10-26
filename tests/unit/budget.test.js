// FR-089 AC-524・AC-525・AC-527 の単体・結合テスト（1 回の会議の予算）。AC-526 は Q-035 の回答待ち（BLOCKED）で対象外。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { BUDGET_KEY, BUDGET_DEFAULT_YEN, isValidBudget } from '../../web/src/budget.js';

const field = (app) => app.getSettingsDialog().fields.find((x) => x.id === 'budget.yen');

test('FR-089 AC-525: isValidBudget は 0 以上の整数だけを受け付ける', () => {
  for (const ok of [0, 1, 10000]) assert.equal(isValidBudget(ok), true);
  for (const bad of [-1, 1.5, '5', NaN, null, Infinity]) assert.equal(isValidBudget(bad), false);
});

test('FR-089 AC-524: 初めて開いた状態で予算は 10,000 円（PARAM-101）と［設定］画面に表示される', async () => {
  const { app } = await newApp();
  assert.equal(BUDGET_DEFAULT_YEN, 10000);
  app.commands['settings.open']();
  assert.equal(field(app).value, 10000);
  assert.match(field(app).text, /10000/);
  assert.ok(app.getSettingsView().fields.some((f) => f.id === 'budget.yen'));
});

test('FR-089 AC-525: 変更でき、保存され（予算の数値だけ）、再起動後も保たれる', async () => {
  const first = await newApp();
  first.app.commands['settings.open']();
  assert.equal(first.app.setBudget('2500').ok, true);
  assert.equal(first.app.setBudget(0).ok, true);
  assert.equal(first.app.setBudget('3000').ok, true);
  assert.equal(field(first.app).value, 3000);
  assert.deepEqual(JSON.parse(first.env.storage.getItem(BUDGET_KEY)), { budgetYen: 3000 });
  const second = await newApp({ storage: first.env.storage });
  assert.equal(second.app.getBudget().yen, 3000);
});

test('FR-089 AC-525: 負の数・整数でない値・空は理由を示して拒否し、直前の値を保つ', async () => {
  const { app, env } = await newApp();
  app.commands['settings.open']();
  assert.equal(app.setBudget(5000).ok, true);
  for (const bad of [-1, '-100', '12.5', 'abc', '', ' ']) {
    const r = app.setBudget(bad);
    assert.equal(r.ok, false, String(bad));
    assert.equal(app.getState().message.key, 'budget.invalid');
    assert.ok(app.getState().message.text.length > 0);
    assert.equal(field(app).value, 5000);
    assert.equal(field(app).input.value, '5000');
  }
  assert.deepEqual(JSON.parse(env.storage.getItem(BUDGET_KEY)), { budgetYen: 5000 });
});

test('FR-089 AC-525: ブラウザ内の保存にキー・トークンを含めない', async () => {
  const { app, env } = await newApp();
  app.setBudget(1234);
  const dump = env.storage.dump().filter(([k]) => k === BUDGET_KEY);
  assert.equal(dump.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(dump[0][1])), ['budgetYen']);
});

test('FR-089 AC-527: データの初期化と新しいセッションの開始で使用額はゼロに戻り、予算は保たれる', async () => {
  const { app } = await newApp();
  app.setBudget(7000);
  app.addBudgetUsage(120);
  assert.equal(app.getBudgetUsage().yen, 120);
  app.commands['data.reset']();
  await app.dialogAction('confirm');
  assert.equal(app.getBudgetUsage().yen, 0);
  assert.equal(app.getBudget().yen, 7000);
  app.addBudgetUsage(50);
  app.commands['session.start']();
  assert.equal(app.getBudgetUsage().yen, 0);
  assert.equal(app.getBudget().yen, 7000);
});
