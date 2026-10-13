// FR-001 AC-001 / FR-002 AC-004 AC-005（System Test。契約: tests/system/CONTRACT.md）
// 公開 API: createApp(options) の app.startSpeech / setDraft / submitDraft / importTextFile / commands['session.*']
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from './helpers.js';

const texts = (app) => app.getState().utterances.map((u) => u.text);

test('FR-001 AC-001: 記録中に疑似音声認識の確定結果 1 件が発話として 1 件追加される', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  app.startSpeech();
  assert.equal(env.speech.startCalls.length, 1);
  env.speech.emit('今日の議題は予算です', true);
  assert.deepEqual(texts(app), ['今日の議題は予算です']);
});

test('FR-001 AC-001 異常系: 記録中でない（準備中・一時停止）の確定結果は発話にならない', async () => {
  const { app, env } = await newApp();
  app.startSpeech();
  env.speech.emit('準備中の声', true);
  assert.equal(app.getState().utterances.length, 0);
  app.commands['session.start']();
  app.commands['session.pause']();
  env.speech.emit('一時停止中の声', true);
  assert.equal(app.getState().utterances.length, 0);
});

test('FR-001 AC-001 異常系: 暫定結果（isFinal:false）は発話にならない', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  app.startSpeech();
  env.speech.emit('途中の', false);
  assert.equal(app.getState().utterances.length, 0);
  env.speech.emit('途中の結果が確定', true);
  assert.deepEqual(texts(app), ['途中の結果が確定']);
});

test('FR-002 AC-004: 記録中に手入力を送信すると発話が 1 件追加され入力欄が空に戻る', async () => {
  const { app } = await newApp();
  app.commands['session.start']();
  app.setDraft('新製品の発売時期を相談したい');
  const r = app.submitDraft();
  assert.equal(r.ok, true);
  assert.deepEqual(texts(app), ['新製品の発売時期を相談したい']);
  assert.equal(app.getState().input.draft, '');
});

test('FR-002 AC-004 異常系: 空白だけの送信は発話にならない', async () => {
  const { app } = await newApp();
  app.commands['session.start']();
  app.setDraft('   ');
  const r = app.submitDraft();
  assert.equal(r.ok, false);
  assert.equal(app.getState().utterances.length, 0);
});

test('FR-002 AC-004 異常系: 記録中でないと送信されず、入力欄は保たれる', async () => {
  const { app } = await newApp();
  app.setDraft('まだ記録前');
  const r = app.submitDraft();
  assert.equal(r.ok, false);
  assert.equal(app.getState().utterances.length, 0);
  assert.equal(app.getState().input.draft, 'まだ記録前');
});

test('FR-002 AC-005: 記録中に .txt を取り込むと行ごとに発話が順に追加される', async () => {
  const { app } = await newApp();
  app.commands['session.start']();
  const text = '一行目の話題\n二行目の話題\n三行目の話題\n';
  const r = await app.importTextFile({ name: 'memo.txt', type: 'text/plain', size: Buffer.byteLength(text), text });
  assert.equal(r.ok, true);
  assert.deepEqual(texts(app), ['一行目の話題', '二行目の話題', '三行目の話題']);
});

test('FR-002 AC-005 異常系: 上限（1 MB）を超える .txt は取り込まれず既存の発話は不変', async () => {
  const { app } = await newApp();
  app.commands['session.start']();
  app.setDraft('既存'); app.submitDraft();
  const r = await app.importTextFile({ name: 'big.txt', type: 'text/plain', size: 2_000_000, text: 'a\nb\n' });
  assert.equal(r.ok, false);
  assert.deepEqual(texts(app), ['既存']);
});

test('FR-002 AC-005 異常系: 空ファイルとテキストでないファイルは取り込まれない', async () => {
  const { app } = await newApp();
  app.commands['session.start']();
  const e = await app.importTextFile({ name: 'empty.txt', type: 'text/plain', size: 0, text: '' });
  const b = await app.importTextFile({ name: 'a.png', type: 'image/png', size: 100, text: '\u0000PNG' });
  assert.equal(e.ok, false);
  assert.equal(b.ok, false);
  assert.equal(app.getState().utterances.length, 0);
});

test('FR-002 AC-005 異常系: 記録中でないと取り込まれない', async () => {
  const { app } = await newApp();
  const r = await app.importTextFile({ name: 'm.txt', type: 'text/plain', size: 3, text: 'a\nb' });
  assert.equal(r.ok, false);
  assert.equal(app.getState().utterances.length, 0);
});
