// FR-103 AC-599（System Test。契約: tests/system/CONTRACT-P1.md §2）
// AC-600〜602 は検証レベル integration / unit のため対象外。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, FakeStorage, keyFor } from './helpers.js';

const STEPS = ['mic', 'interval', 'save'];
const key = (app, c) => { const k = keyFor(app, c); assert.ok(k, `keymap に ${c}`); return app.handleKey(k); };

test('FR-103 AC-599: 初めて起動すると 3 ステップ（マイク・周期・保存）の案内が出て、次へ・戻るをキーボードだけで操作でき、完了で再び出ない', async () => {
  const storage = new FakeStorage();
  const { app } = await newApp({ storage });
  let o = app.getOnboarding();
  assert.ok(o && o.open === true, '記録がなければ起動時に出る');
  assert.equal(o.total, 3);
  assert.deepEqual(o.steps.map((s) => s.id), STEPS);
  assert.equal(o.step, 1); assert.equal(o.id, 'mic');
  assert.equal(o.canLoadSample, false, '最後のステップ以外では出さない');
  key(app, 'onboarding.back');
  assert.equal(app.getOnboarding().step, 1, '最初のステップで戻るは何もしない');
  assert.equal(key(app, 'onboarding.next'), 'onboarding.next');
  assert.equal(app.getOnboarding().id, 'interval');
  key(app, 'onboarding.back');
  assert.equal(app.getOnboarding().id, 'mic');
  key(app, 'onboarding.next'); key(app, 'onboarding.next');
  o = app.getOnboarding();
  assert.equal(o.step, 3); assert.equal(o.id, 'save'); assert.equal(o.canLoadSample, true);
  key(app, 'onboarding.next'); // 最後のステップの次＝完了
  assert.equal(app.getOnboarding(), null, '完了で閉じる');
  const rec = storage.dump().find(([k]) => k === 'grp.onboarding');
  assert.ok(rec && rec[1].length > 0, '完了の記録が grp.onboarding に残る');
  const again = (await newApp({ storage })).app;
  assert.equal(again.getOnboarding(), null, '再起動しても出ない');
});

test('FR-103 AC-599: スキップ（キーボード）でも閉じて記録され、再び出ない。ヘルプで 3 ステップを見直せる', async () => {
  const storage = new FakeStorage();
  const { app } = await newApp({ storage });
  assert.ok(app.getOnboarding());
  assert.equal(key(app, 'onboarding.skip'), 'onboarding.skip');
  assert.equal(app.getOnboarding(), null);
  assert.ok(storage.dump().some(([k, v]) => k === 'grp.onboarding' && v.length > 0), 'スキップの記録');
  assert.equal((await newApp({ storage })).app.getOnboarding(), null);
  key(app, 'help.open');
  const o = app.getOnboarding();
  assert.ok(o && o.open === true && o.step === 1 && o.total === 3, 'ヘルプから 3 ステップを再び見られる');
});

test('FR-103 AC-599: 最後のステップから練習用のサンプルを読み込むと、図とテキスト一覧に練習用の議論が出て、一時停止になる', async () => {
  const { app, env } = await newApp();
  assert.ok(app.getOnboarding());
  for (let i = 0; i < 2; i++) app.onboarding.next();
  assert.equal(app.getOnboarding().canLoadSample, true);
  assert.equal(app.getState().scenes.length, 0);
  assert.equal(app.onboarding.loadSample().ok, true);
  const st = app.getState();
  assert.equal(st.sample, true, '「サンプル」であることが状態に示される');
  assert.equal(st.session, 'paused');
  assert.ok(st.scenes.length > 0, '練習用の議論がある');
  const outline = app.renderOutline();
  for (const s of st.scenes) assert.ok(outline.includes(s.heading), `テキスト一覧に ${s.heading}`);
  assert.ok(app.renderSvg().length > 0);
  assert.equal(app.getOnboarding(), null, '読み込むと案内は閉じる');
  assert.equal(env.speech.startCalls.length, 0, '音声入力は使わない');
});

test('FR-103 AC-599 異常系: 最後のステップ以外ではサンプルを読み込めず、案内を終えた端末では起動時に出ない', async () => {
  const { app } = await newApp();
  assert.equal(app.onboarding.loadSample().ok, false, 'ステップ 1 では読み込めない');
  assert.equal(app.getState().scenes.length, 0);
  assert.equal(app.getState().sample === true, false);
  assert.ok(app.getOnboarding(), '案内は開いたまま');
  const storage = new FakeStorage();
  storage.setItem('grp.onboarding', 'done');
  assert.equal((await newApp({ storage })).app.getOnboarding(), null, '記録があれば出ない');
});
