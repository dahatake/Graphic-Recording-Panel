// FR-012 AC-029 AC-043 AC-030（契約: 保存キー grp.session、createApp が復元、clearSavedSession、復元後は paused）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, FakeSpeech } from './helpers.js';

const core = (app) => { const s = app.getState(); return JSON.stringify({ u: s.utterances.map((x) => x.text), s: s.scenes.map((x) => ({ h: x.heading, p: x.points.map((q) => q.text) })) }); };

test('FR-012 AC-029: 再読込で発話・シーン・要点が復元される（音声は含まれない）', async () => {
  const { app, env, createApp } = await newApp();
  const texts = await seedThreeScenes(app, env);
  const before = core(app);
  assert.ok(env.storage.getItem('grp.session'), 'grp.session に保存される');
  assert.ok(!/audio|blob|wav|pcm/i.test(env.storage.getItem('grp.session')));
  const app2 = await createApp({ ...env.options, speechSource: new FakeSpeech() });
  assert.equal(core(app2), before);
  assert.deepEqual(app2.getState().utterances.map((u) => u.text), texts);
});

test('FR-012 AC-029 異常系: 保存されたセッションがないとき、また保存内容が壊れているとき、空の状態で起動する', async () => {
  const { app, env, createApp } = await newApp();
  assert.equal(app.getState().utterances.length, 0);
  env.storage.setItem('grp.session', '}{壊れている');
  const app2 = await createApp(env.options);
  assert.equal(app2.getState().utterances.length, 0);
  assert.equal(app2.getState().scenes.length, 0);
});

test('FR-012 AC-043: 復元したセッションは一時停止で、再開操作まで発話は追加されず、再開時に音声認識を改めて開始する', async () => {
  const { app, env, createApp } = await newApp();
  await seedThreeScenes(app, env);
  assert.equal(app.getState().session, 'recording');
  const sp2 = new FakeSpeech();
  const app2 = await createApp({ ...env.options, speechSource: sp2 });
  assert.equal(app2.getState().session, 'paused');
  assert.equal(sp2.startCalls.length, 0, '復元だけでは音声認識を開始しない');
  const n = app2.getState().utterances.length;
  app2.setDraft('復元直後の入力');
  assert.equal(app2.submitDraft().ok, false);
  sp2.emit('復元直後の声', true);
  assert.equal(app2.getState().utterances.length, n);
  app2.commands['session.resume']();
  assert.equal(app2.getState().session, 'recording');
  assert.equal(sp2.startCalls.length, 1, '再開時に音声認識を開始');
  assert.equal(app2.submitDraft().ok, true);
  assert.equal(app2.getState().utterances.length, n + 1);
});

// FR-012 AC-043 異常系（外部送信の同意が必要な環境）
test('FR-012 AC-043 異常系: 同意が必要な環境では、復元後の再開時に改めて同意するまで音声認識は開始されない', async () => {
  const remote = { processLocally: false, availability: { 'ja-JP': 'remote', 'en-US': 'remote' } };
  const { app, env, createApp } = await newApp({ speech: new FakeSpeech(remote) });
  app.commands['session.start']();
  app.setSpeechConsent(true);
  app.setDraft('同意環境の発話'); app.submitDraft();
  const sp2 = new FakeSpeech(remote);
  const app2 = await createApp({ ...env.options, speechSource: sp2 });
  assert.equal(app2.getState().session, 'paused');
  assert.equal(app2.getSpeechConsent(), false, '同意は復元されない');
  app2.commands['session.resume']();
  assert.equal(sp2.startCalls.length, 0, '同意前は音声認識を開始しない');
  const n = app2.getState().utterances.length;
  assert.equal(app2.getState().utterances.length, n);
  app2.setSpeechConsent(true);
  assert.equal((await app2.startSpeech()).ok, true);
  assert.ok(sp2.startCalls.length >= 1, '同意後に音声認識が開始される');
});

test('FR-012 AC-030: 保存内容を消去すると取り除かれ、再読込後に復元されない。消去まで保持される', async () => {
  const { app, env, createApp } = await newApp();
  app.commands['session.start']();
  app.setDraft('消去されるべき機密の発話XYZ'); app.submitDraft();
  env.tick(60 * 60 * 24 * 30);
  const kept = await createApp(env.options);
  assert.equal(kept.getState().utterances.length, 1, '30 日後も保持される');
  kept.clearSavedSession();
  assert.equal(env.storage.getItem('grp.session'), null);
  assert.ok(!env.storage.dump().some(([, v]) => v.includes('XYZ')), 'ブラウザに内容が残らない');
  const after = await createApp(env.options);
  assert.equal(after.getState().utterances.length, 0);
  assert.equal(after.getState().scenes.length, 0);
});

test('FR-012 AC-030 異常系: 保存内容がないときの消去は何も壊さず例外も出さない', async () => {
  const { app } = await newApp();
  app.clearSavedSession();
  assert.equal(app.getState().utterances.length, 0);
});
