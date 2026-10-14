// FR-022 AC-113（System Test。契約: tests/system/CONTRACT.md）
// 公開 API: app.importTextFile({ name, type, size, text }) を .vtt にも使う（.txt 取込の拡張。AC-005）
// .vtt のテストデータはテスト内で生成する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from './helpers.js';

const texts = (app) => app.getState().utterances.map((u) => u.text);
const file = (name, text, extra = {}) => ({
  name, type: extra.type ?? 'text/vtt', size: extra.size ?? Buffer.byteLength(text), text,
});

const teamsVtt = [
  'WEBVTT',
  '',
  'NOTE 会議の文字起こし',
  '',
  '3f2a1c9e-1111-4222-8333-444455556666/10-0',
  '00:00:01.000 --> 00:00:05.000',
  '<v 山田太郎>今日の議題は予算です</v>',
  '',
  '3f2a1c9e-1111-4222-8333-444455556666/20-0',
  '00:00:06.000 --> 00:00:09.500',
  '<v 佐藤花子>来月の発売時期を<v 佐藤花子>決めたい</v>',
  '',
  '3f2a1c9e-1111-4222-8333-444455556666/30-0',
  '00:00:10.000 --> 00:00:12.000',
  '<v 鈴木一郎>一行目の話題',
  '二行目の話題</v>',
  '',
].join('\n');

test('FR-022 AC-113: 記録中に Teams 形式の .vtt を取り込むと cue ごとの本文だけがファイルの順に発話になる', async () => {
  const { app } = await newApp();
  app.commands['session.start']();
  const r = await app.importTextFile(file('meeting.vtt', teamsVtt));
  assert.equal(r.ok, true);
  assert.deepEqual(texts(app), [
    '今日の議題は予算です',
    '来月の発売時期を決めたい',
    '一行目の話題 二行目の話題',
  ]);
});

test('FR-022 AC-113: 発話に話者名・タイムスタンプ・cue 識別子・WEBVTT・NOTE の文字列が含まれない', async () => {
  const { app } = await newApp();
  app.commands['session.start']();
  await app.importTextFile(file('meeting.vtt', teamsVtt));
  const all = texts(app).join('\n');
  for (const bad of ['山田太郎', '佐藤花子', '鈴木一郎', '-->', '00:00', '3f2a1c9e', 'WEBVTT', 'NOTE', '<v', '</v>']) {
    assert.ok(!all.includes(bad), `発話に "${bad}" が含まれている`);
  }
});

test('FR-022 AC-113: 拡張子の大文字小文字は区別しない（.VTT）', async () => {
  const { app } = await newApp();
  app.commands['session.start']();
  const r = await app.importTextFile(file('MEETING.VTT', teamsVtt));
  assert.equal(r.ok, true);
  assert.equal(app.getState().utterances.length, 3);
});

test('FR-022 AC-113: 既存の発話の後ろに追加され、.txt の取込（AC-005）は変わらない', async () => {
  const { app } = await newApp();
  app.commands['session.start']();
  app.setDraft('既存の発話'); app.submitDraft();
  await app.importTextFile(file('m.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v A>追加one</v>\n'));
  const t = 'x行\ny行\n';
  await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: Buffer.byteLength(t), text: t });
  assert.deepEqual(texts(app), ['既存の発話', '追加one', 'x行', 'y行']);
});

test('FR-022 AC-113 異常系: 記録中でないと .vtt は取り込まれず発話は追加されない', async () => {
  const { app } = await newApp();
  const r = await app.importTextFile(file('meeting.vtt', teamsVtt));
  assert.equal(r.ok, false);
  assert.equal(app.getState().utterances.length, 0);
});

test('FR-022 AC-113 異常系: 上限（1 MB）を超える .vtt・WEBVTT ではないファイル・発話になる cue がないファイルは取り込まれず既存の発話は不変', async () => {
  const { app } = await newApp();
  app.commands['session.start']();
  app.setDraft('既存'); app.submitDraft();
  const big = await app.importTextFile(file('big.vtt', teamsVtt, { size: 2_000_000 }));
  const notVtt = await app.importTextFile(file('fake.vtt', '一行目\n二行目\n'));
  const empty = await app.importTextFile(file('empty.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v 話者></v>\n'));
  assert.equal(big.ok, false);
  assert.equal(notVtt.ok, false);
  assert.equal(empty.ok, false);
  assert.deepEqual(texts(app), ['既存']);
});
