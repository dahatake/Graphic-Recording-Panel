// NFR-PERF-003 AC-539 の結合テスト: 自動保存を入力の処理から分離して PARAM-108（500 ミリ秒）以内に間引く。
// 非表示・ページを閉じる・再読込の契機では直ちに保存し、消去・初期化の前の変更は書き戻さない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, FakeVisibility, FakeSpeech } from '../system/helpers.js';
import { SAVE_DELAY_MS_DEFAULT } from '../../web/src/app.js';

const PARAM_108 = 500;

// grp.session への書き込みを、スケジューラーの時刻つきで記録する
function trackWrites(env) {
  const writes = [];
  const orig = env.storage.setItem.bind(env.storage);
  env.storage.setItem = (k, v) => { if (k === 'grp.session') writes.push({ at: env.scheduler.t, value: String(v) }); orig(k, v); };
  return writes;
}
function fakeWindow() {
  const target = new EventTarget();
  return { addEventListener: target.addEventListener.bind(target), fire: (type) => target.dispatchEvent(new Event(type)) };
}
async function setup(over = {}) {
  const vis = new FakeVisibility();
  const win = fakeWindow();
  const r = await newApp({ options: { visibility: vis, window: win, ...(over.options || {}) } });
  r.env.scheduler.advance(PARAM_108); // 起動時の保留を片付ける
  const writes = trackWrites(r.env);
  return { ...r, vis, win, writes };
}
const add = (app, text) => { app.setDraft(text); return app.submitDraft(); };
const texts = (app) => app.getState().utterances.map((u) => u.text);

test('NFR-PERF-003 AC-539: PARAM-108 の既定は 500 ミリ秒', () => {
  assert.equal(SAVE_DELAY_MS_DEFAULT, PARAM_108);
});

test('NFR-PERF-003 AC-539: 500 ミリ秒以内に連続した変更は、入力の処理の中では保存されず、最後の変更から 500 ミリ秒以内に 1 回にまとめて保存される', async () => {
  const { app, env, writes } = await setup();
  app.commands['session.start']();
  assert.equal(writes.length, 0, '操作の処理の中では保存しない');
  const sent = [];
  for (let i = 0; i < 8; i++) {
    const t = `連続の発話${i}`; sent.push(t);
    assert.equal(add(app, t).ok, true);
    assert.equal(writes.length, 0, `入力 ${i} の処理の中では保存しない`);
    env.scheduler.advance(50);
  }
  const lastChangeAt = env.scheduler.t - 50;
  env.scheduler.advance(PARAM_108);
  assert.equal(writes.length, 1, '1 回にまとめて保存');
  assert.ok(writes[0].at - lastChangeAt <= PARAM_108, '最後の変更から 500 ミリ秒以内');
  const saved = JSON.parse(writes[0].value);
  assert.deepEqual(saved.utterances.map((u) => u.text), sent, '最後の変更までが含まれる');
});

test('NFR-PERF-003 AC-539: 変更が続いても、最初の未保存の変更から 500 ミリ秒以内に必ず保存される（保存が無期限に遅れない）', async () => {
  const { app, env, writes } = await setup();
  app.commands['session.start']();
  const firstAt = env.scheduler.t;
  for (let i = 0; i < 30; i++) { // 100 ミリ秒ごとに 3 秒間変更し続ける
    env.scheduler.advance(100);
    add(app, `続く発話${i}`);
  }
  assert.ok(writes.length >= 5, `3 秒間に繰り返し保存される（${writes.length} 回）`);
  let prev = firstAt;
  for (const w of writes) { assert.ok(w.at - prev <= PARAM_108, `前の保存から ${w.at - prev}ms`); prev = w.at; }
  env.scheduler.advance(PARAM_108);
  assert.equal(JSON.parse(writes.at(-1).value).utterances.length, 30);
});

test('NFR-PERF-003 AC-539: 要点だけの変更も自動保存の契機になる', async () => {
  const { app, env, writes } = await setup();
  app.commands['session.start']();
  add(app, '予算の見直しが必要です');
  env.scheduler.advance(PARAM_108);
  const n = writes.length;
  const pt = app.getState().scenes[0].points[0];
  assert.equal(app.editPoint(pt.id, '手で直した要点').ok, true);
  assert.equal(writes.length, n);
  env.scheduler.advance(PARAM_108);
  assert.equal(writes.length, n + 1);
  assert.ok(writes.at(-1).value.includes('手で直した要点'));
});

test('NFR-PERF-003 AC-539: 非表示になったとき・ページを閉じるとき（pagehide・beforeunload）は保留中の保存を直ちに行い、再読込後に最後の変更まで復元される', async () => {
  const { app, env, vis, win, writes, createApp } = await setup();
  app.commands['session.start']();
  add(app, '非表示の直前の発話');
  assert.equal(writes.length, 0);
  vis.set(true);
  assert.equal(writes.length, 1, '非表示で直ちに保存');
  vis.set(false);
  add(app, 'pagehide の直前の発話');
  win.fire('pagehide');
  assert.equal(writes.length, 2, 'pagehide で直ちに保存');
  add(app, 'beforeunload の直前の発話');
  win.fire('beforeunload');
  assert.equal(writes.length, 3, 'beforeunload で直ちに保存');
  win.fire('pagehide');
  assert.equal(writes.length, 3, '保留がなければ保存しない');
  const app2 = await createApp({ ...env.options, speechSource: new FakeSpeech(), visibility: new FakeVisibility(), window: fakeWindow() });
  assert.deepEqual(texts(app2), ['非表示の直前の発話', 'pagehide の直前の発話', 'beforeunload の直前の発話']);
});

test('NFR-PERF-003 AC-539: 保存の完了を待たずに同じ保存先で作り直しても（再読込）、最後の変更までが欠落なく復元される', async () => {
  const { app, env, createApp } = await setup();
  app.commands['session.start']();
  for (let i = 0; i < 5; i++) add(app, `再読込前の発話${i}`);
  assert.equal(app.hasPendingSave(), true);
  const app2 = await createApp({ ...env.options, speechSource: new FakeSpeech(), visibility: new FakeVisibility(), window: fakeWindow() });
  assert.deepEqual(texts(app2), texts(app));
  assert.equal(app.hasPendingSave(), false);
});

test('NFR-PERF-003 AC-539（FR-012 AC-030）: 消去の直前の変更は、保留中の保存で消去後に書き戻されない', async () => {
  const { app, env, win } = await setup();
  app.commands['session.start']();
  add(app, '消去の直前の機密XYZ');
  app.clearSavedSession();
  assert.equal(app.hasPendingSave(), false);
  env.scheduler.advance(PARAM_108 * 4);
  win.fire('pagehide');
  assert.equal(env.storage.getItem('grp.session'), null);
  assert.ok(!env.storage.dump().some(([, v]) => v.includes('XYZ')));
});

test('NFR-PERF-003 AC-539（FR-018 AC-096）: 初期化の直前の変更は、保留中の保存で初期化後に書き戻されない', async () => {
  const { app, env, win, createApp } = await setup();
  app.commands['session.start']();
  add(app, '初期化の直前の発話XYZ');
  app.commands['data.reset']();
  assert.equal((await app.dialogAction('confirm')).ok, true);
  env.scheduler.advance(PARAM_108 * 4);
  win.fire('pagehide');
  assert.ok(!env.storage.dump().some(([, v]) => v.includes('XYZ')));
  const app2 = await createApp({ ...env.options, speechSource: new FakeSpeech(), visibility: new FakeVisibility(), window: fakeWindow() });
  assert.equal(app2.getState().utterances.length, 0);
});

test('NFR-PERF-003 AC-539: PARAM-108 が 0 なら変更のたびに即時保存に戻る', async () => {
  const { app, writes } = await setup({ options: { saveDelayMs: 0 } });
  app.commands['session.start']();
  add(app, '即時保存の発話');
  assert.ok(writes.length >= 1, '変更の中で保存される');
  assert.ok(writes.at(-1).value.includes('即時保存の発話'));
  assert.equal(app.hasPendingSave(), false);
  assert.equal(app.flushSave(), false);
});
