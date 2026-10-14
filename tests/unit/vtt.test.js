// FR-022 AC-113 AC-114 AC-115 AC-116 AC-117 の単体・結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';
import { parseVtt, parseCueStart, isWebVtt } from '../../web/src/vtt.js';

function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
async function mk() {
  const storage = mem();
  return { app: await createApp({ storage, now: () => 1_000_000 }), storage };
}
const f = (name, text, size) => ({ name, type: 'text/vtt', size: size ?? Buffer.byteLength(text), text });
const texts = (app) => app.getState().utterances.map((u) => u.text);

// FR-022 AC-114（純関数）
test('FR-022 AC-114: BOM・ヘッダ・NOTE/STYLE/REGION・識別子・cue 設定・タグ・文字参照・複数行・空 cue', () => {
  const vtt = [
    '\uFEFFWEBVTT - Teams', '', 'NOTE x', 'メモ', '', 'STYLE', '::cue {}', '', 'REGION', 'id:a', '',
    'guid-1/10-0', '00:00:01.000 --> 00:00:05.000 align:start position:10%',
    '<v 山田><c>A &amp; B</c> &lt;i&gt;<00:00:03.000>x&nbsp;y</v>', '',
    '00:00:06.000 --> 00:00:07.000', '<i>一</i>', '<b>二</b>', '', 
    '00:00:08.000 --> 00:00:09.000', '<v 話者></v>', '   ', '',
  ].join('\r\n');
  assert.deepEqual(parseVtt(vtt), ['A & B <i>x\u00a0y', '一 二']);
});

test('FR-022 AC-116: WEBVTT 判定', () => {
  assert.equal(isWebVtt('WEBVTT'), true);
  assert.equal(isWebVtt('\uFEFFWEBVTT\n'), true);
  assert.equal(isWebVtt('WEBVTTX\n'), false);
  assert.equal(isWebVtt('一行目'), false);
});

const sample = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n<v 山田太郎>一つ目</v>\n\n2\n00:00:03.000 --> 00:00:04.000\n<v 佐藤花子>二つ目</v>\n';

// FR-022 AC-113 AC-117
test('FR-022 AC-113 AC-117: 記録中の取込は本文だけが順に追加され、話者名はどこにも残らない', async () => {
  const { app, storage } = await mk();
  app.commands['session.start']();
  const r = await app.importTextFile(f('M.VTT', sample));
  assert.equal(r.ok, true);
  assert.deepEqual(texts(app), ['一つ目', '二つ目']);
  const dump = JSON.stringify(app.getState()) + JSON.stringify([...Array(storage.length).keys()].map((i) => storage.getItem(storage.key(i))));
  assert.ok(!dump.includes('山田太郎') && !dump.includes('佐藤花子') && !dump.includes('00:00:01'));
});

// FR-022 AC-115
test('FR-022 AC-115: 記録中でないと取り込まれず案内が出る', async () => {
  const { app } = await mk();
  for (const prep of [() => {}, () => { app.commands['session.start'](); app.commands['session.pause'](); }]) {
    prep();
    const r = await app.importTextFile(f('a.vtt', sample));
    assert.equal(r.reason, 'not_recording');
    assert.equal(app.getState().message.text, '記録を開始・再開してください');
    assert.equal(app.getState().utterances.length, 0);
  }
});

// FR-022 AC-116
test('FR-022 AC-116: 上限超過・WebVTT でない・読めない・cue なしは原因のメッセージ、発話は不変', async () => {
  const { app } = await mk();
  app.commands['session.start']();
  app.setDraft('既存'); app.submitDraft();
  const cases = [
    [f('big.vtt', sample, 1024 * 1024 + 1), 'too_large', 'msg.importTooLarge'],
    [f('fake.vtt', '一行目\n二行目'), 'not_vtt', 'msg.importNotVtt'],
    [f('bin.vtt', 'WEBVTT\n\u0000'), 'not_text', 'msg.importNotText'],
    [f('none.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v A></v>\n'), 'empty', 'msg.importEmpty'],
  ];
  for (const [file, reason, key] of cases) {
    const r = await app.importTextFile(file);
    assert.equal(r.reason, reason);
    assert.equal(app.getState().message.key, key);
    assert.deepEqual(texts(app), ['既存']);
  }
});

// FR-013 AC-050 / FR-022 AC-113: .txt は不変
test('FR-022 AC-113: .txt の取込は従来どおり行ごと', async () => {
  const { app } = await mk();
  app.commands['session.start']();
  await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: 8, text: 'WEBVTT\n甲' });
  assert.deepEqual(texts(app), ['WEBVTT', '甲']);
});

// FR-022 AC-113: cue 開始時刻の解析
test('FR-022 AC-113: parseCueStart は hh:mm:ss.mmm と mm:ss.mmm を読み、読めなければ null', () => {
  assert.equal(parseCueStart('01:02:03.004 --> 01:02:05.000 align:start'), 3723004);
  assert.equal(parseCueStart('02:03.500 --> 02:05.000'), 123500);
  assert.equal(parseCueStart('xx --> yy'), null);
});

// FR-022 AC-113: 受付時刻は開始時刻の差で相対的に与える
test('FR-022 AC-113: 受付時刻は最初の cue が取込時刻、以降は差分、読めない・戻る cue は直前の時刻、シーンは差で分かれる', async () => {
  const { app } = await mk();
  app.commands['session.start']();
  const v = ['WEBVTT', '', '00:10.000 --> 00:12.000', '<v A>予算の話をする</v>', '',
    '00:14.500 --> 00:16.000', '<v A>予算の見積もり</v>', '', '00:05.000 --> 00:06.000', '<v A>戻る</v>', '',
    'bad --> x', '<v A>読めない</v>', '', '01:20.000 --> 01:21.000', '<v A>発売時期の話</v>', ''].join('\n');
  await app.importTextFile(f('t.vtt', v));
  assert.deepEqual(app.getState().utterances.map((u) => u.receivedAt - 1_000_000), [0, 4500, 4500, 4500, 70000]);
  assert.equal(app.getState().scenes.length, 2);
});

