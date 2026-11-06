// FR-117（AC-683・AC-684・AC-685）と FR-014 AC-054・AC-521・AC-523（ファイル取込は図を更新しない）の単体・結合テスト。
// 期待値は受入基準から決める。入力モード（音声取込＝リアルタイム／ファイル読込＝バッチ）の保存・切替の可否・音声入力の無効・自動の切替を確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, FakeSpeech } from '../system/helpers.js';
import { INPUT_MODE_KEY } from '../../web/src/inputmode.js';

const SEC = 1000;
const adv = (env, ms) => { env.tick(ms / SEC); env.scheduler.advance(ms); };
const txt = (text, name = 'm.txt') => ({ name, type: 'text/plain', size: Buffer.byteLength(text), text });
const items = (app) => app.getCommandBar().items.filter((i) => i.group === 'inputMode');
const startRec = (app) => { app.commands['session.start'](); app.startSpeech(); };

// FR-117 AC-683
test('FR-117 AC-683: 初期値は音声取込で、2 項目（音声取込・ファイル読込）が先頭のグループに常時表示の説明・キーつきで並ぶ', async () => {
  const { app } = await newApp({ speech: new FakeSpeech() });
  assert.equal(app.getInputMode().mode, 'live');
  assert.equal(app.getCommandBar().groups[0].id, 'inputMode');
  assert.deepEqual(items(app).map((i) => i.command), ['inputMode.set:live', 'inputMode.set:batch']);
  assert.ok(items(app).every((i) => i.descriptionVisible === true && i.description.trim() && i.labelVisible && i.tabbable));
  for (const i of items(app)) assert.ok(app.keymap.some((k) => k.command === i.command), `${i.command}: キー割り当て`);
});

test('FR-117 AC-683: 選んだモードは端末ごとに保存され、壊れた値・未知の値は初期値で、不正な値の設定は直前を保つ', async () => {
  const first = await newApp();
  assert.equal(first.app.setInputMode('batch').ok, true);
  assert.deepEqual(JSON.parse(first.env.storage.getItem(INPUT_MODE_KEY)), { mode: 'batch' });
  assert.equal((await newApp({ storage: first.env.storage })).app.getInputMode().mode, 'batch');
  for (const bad of ['{', '{"mode":"stream"}', '{"mode":3}']) {
    first.env.storage.setItem(INPUT_MODE_KEY, bad);
    assert.equal((await newApp({ storage: first.env.storage })).app.getInputMode().mode, 'live', bad);
  }
  for (const bad of ['', 'stream', null, undefined, 3]) assert.deepEqual(first.app.setInputMode(bad), { ok: false, reason: 'invalid' });
});

test('FR-117 AC-683: 切替では発話・シーン・選択中のシーンは変わらず、選択項目だけが pressed・印つきになる', async () => {
  const { app } = await newApp();
  app.commands['session.start'](); app.setDraft('予算を決める'); app.submitDraft(); app.commands['session.pause']();
  const keep = () => JSON.stringify([app.getState().utterances, app.getState().scenes, app.getState().selectedSceneId]);
  const before = keep();
  await app.commands['inputMode.set:batch']();
  assert.equal(keep(), before);
  assert.deepEqual(items(app).map((i) => [i.pressed, i.selectedMark]), [[false, null], [true, 'check']]);
  app.commands['inputMode.set:live']();
  assert.deepEqual(items(app).map((i) => i.pressed), [true, false]);
  assert.equal(keep(), before);
  assert.ok(app.searchCommands('ファイル読込').some((c) => c.command === 'inputMode.set:batch'), 'コマンドの検索から選べる');
});

// FR-117 AC-685 (a)
test('FR-117 AC-685: 記録中は切り替えられず理由が示され、モードも記録も変わらない。停止後は切り替えられる', async () => {
  const { app } = await newApp({ speech: new FakeSpeech() });
  startRec(app);
  assert.equal(app.getInputMode().canSwitch, false);
  const r = app.setInputMode('batch');
  assert.equal(r.ok, false);
  assert.match(r.reason, /記録を停止してから切り替えてください/);
  assert.match(app.getState().message.text, /記録を停止してから切り替えてください/);
  assert.equal(app.getInputMode().mode, 'live'); assert.equal(app.getState().session, 'recording');
  app.commands['session.stop']();
  assert.equal(app.setInputMode('batch').ok, true);
});

// FR-117 AC-684
test('FR-117 AC-684: ファイル読込モードでは [記録開始]・[再開] が無効で理由が示され、押しても記録は始まらない。音声取込へ戻すと使える', async () => {
  const { app } = await newApp({ speech: new FakeSpeech() });
  app.setInputMode('batch');
  for (const c of ['session.start', 'session.resume']) {
    const it = app.getCommandBar().items.find((i) => i.command === c);
    assert.equal(it.enabled, false); assert.match(it.disabledReason, /音声取込モードで使えます/);
  }
  app.commands['session.start']();
  assert.equal(app.getState().session, 'preparing');
  assert.match(app.getState().message.text, /音声取込モードで使えます/);
  app.setInputMode('live');
  assert.equal(app.getCommandBar().items.find((i) => i.command === 'session.start').enabled, true);
  app.commands['session.start']();
  assert.equal(app.getState().session, 'recording');
});

// FR-117 AC-685 (b)
test('FR-117 AC-685 (b): 音声取込で記録中でないときにファイルを取り込むと自動でファイル読込モードになり、記録中ならモードは変わらず案内が示される', async () => {
  const a = await newApp({ speech: new FakeSpeech() });
  assert.equal((await a.app.importTextFile(txt('一行目\n二行目\n'))).ok, true);
  assert.equal(a.app.getInputMode().mode, 'batch');
  assert.equal(a.app.getState().utterances.length, 2);
  const b = await newApp({ speech: new FakeSpeech() });
  startRec(b.app);
  assert.equal((await b.app.importTextFile(txt('一行目\n'))).ok, true);
  assert.equal(b.app.getInputMode().mode, 'live'); assert.equal(b.app.getState().session, 'recording');
  assert.match(b.app.getState().message.text, /記録を停止してファイル読込モードで図式化できます/);
  const c = await newApp();
  assert.equal((await c.app.importTextFile({ name: 'x.png', type: 'image/png', size: 1, text: 'x' })).ok, false);
  assert.equal(c.app.getInputMode().mode, 'live', '失敗した取込では切り替えない');
});

// FR-014 AC-054・AC-521・AC-523（依頼 2026-11-06）: ファイル由来の発話は図に加わらず、ライブの待ちの発話にも影響しない
test('FR-014 AC-054 AC-523: ファイルの取込は図・描き足しの回数を変えず、記録中でも待ちのライブの発話は更新間隔で 1 回に描き足される', async () => {
  const { app, env } = await newApp({ speech: new FakeSpeech() });
  startRec(app);
  env.speech.emit('予算の見直しが必要です', true);
  const before = JSON.stringify([app.getState().scenes, app.renderOutline(), app.getLiveRefresh().count]);
  const held = app.getLiveRefresh().held;
  assert.equal((await app.importTextFile(txt('取込の一行目\n取込の二行目\n'))).ok, true);
  assert.equal(JSON.stringify([app.getState().scenes, app.renderOutline(), app.getLiveRefresh().count]), before, '取込は図を変えない');
  assert.equal(app.getLiveRefresh().held, held, '待ちのライブの発話の数も変わらない');
  assert.equal(app.getState().utterances.length, 3);
  assert.ok(app.getTranscript().finals.some((f) => f.text === '取込の一行目'), '確定結果の一覧には並ぶ');
  const n0 = app.getLiveRefresh().count;
  adv(env, app.getLiveInterval().sec * SEC + 1);
  assert.equal(app.getLiveRefresh().count, n0 + 1, '待ちのライブの発話は更新間隔で 1 回に描き足される');
  const pts = app.getState().scenes.flatMap((s) => s.points.map((p) => p.text)).join('|');
  assert.ok(pts.includes('予算の見直しが必要です')); assert.ok(!pts.includes('取込の'), 'ファイル由来の発話は図に加わらない');
  assert.equal(app.getLiveRefresh().held, 0);
});

test('FR-014 AC-054: ファイル由来の発話の印はセッションの保存・復元でも保たれ、再読込後もその発話は図に加わらない', async () => {
  const { app, env, createApp } = await newApp();
  assert.equal((await app.importTextFile(txt('保存される取込行\n'))).ok, true);
  app.flushSave?.();
  const again = await createApp({ ...env.options });
  assert.equal(again.getState().utterances.length, 1);
  assert.equal(again.getState().utterances[0].fromFile, true);
  assert.equal(again.getState().scenes.length, 0);
});
