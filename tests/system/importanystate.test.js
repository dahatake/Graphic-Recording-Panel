// FR-039 AC-180 AC-181（System Test。契約: tests/system/CONTRACT.md）
// ファイル取込はセッションの状態（準備中・記録中・一時停止・停止）によらず可能。取込で状態は変わらない。
// AC-182 は検証レベル integration のため対象外。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, toDetail } from './helpers.js';

const texts = (app) => app.getState().utterances.map((u) => u.text);
const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v A>一件目</v>\n\n00:00:03.000 --> 00:00:04.000\n<v B>二件目</v>\n';
const vttFile = { name: 'm.vtt', type: 'text/vtt', size: vtt.length, text: vtt };
const txt = '一行目\n二行目\n';
const txtFile = { name: 'm.txt', type: 'text/plain', size: Buffer.byteLength(txt), text: txt };
const STATES = {
  preparing: [],
  recording: ['session.start'],
  paused: ['session.start', 'session.pause'],
  stopped: ['session.start', 'session.stop'],
};

// FR-039 AC-180
test('FR-039 AC-180: 準備中（記録開始を押していない）に .txt を取り込むと発話が追加され、「記録を開始・再開してください」は出ない', async () => {
  const { app } = await newApp();
  assert.equal(app.getState().session, 'preparing');
  const r = await app.importTextFile(txtFile);
  assert.equal(r.ok, true);
  assert.deepEqual(texts(app), ['一行目', '二行目']);
  assert.doesNotMatch(app.getState().message?.text ?? '', /記録を開始・再開してください/);
  assert.doesNotMatch(app.getImportStatus().text ?? '', /記録を開始・再開してください/);
});

test('FR-039 AC-180: 準備中に Teams 形式の .vtt を取り込むと cue ごとの本文が発話として追加される', async () => {
  const { app } = await newApp();
  const r = await app.importTextFile(vttFile);
  assert.equal(r.ok, true);
  assert.deepEqual(texts(app), ['一件目', '二件目']);
  assert.doesNotMatch(app.getState().message?.text ?? '', /記録を開始・再開してください/);
});

test('FR-039 AC-180 異常系: 準備中でも手入力の送信は受け付けられず、「記録を開始・再開してください」が出て入力欄は保たれる（AC-042）', async () => {
  const { app } = await newApp();
  app.setDraft('手入力');
  assert.equal(app.submitDraft().ok, false);
  assert.match(app.getState().message.text, /記録を開始・再開してください/);
  assert.equal(app.getState().input.draft, '手入力');
  assert.equal(app.getState().utterances.length, 0);
});

// FR-039 AC-181
test('FR-039 AC-181: 準備中・記録中・一時停止・停止のどれでも .txt・.vtt の取込で発話が追加され、取込の前後でセッションの状態は変わらない', async () => {
  for (const [name, steps] of Object.entries(STATES)) {
    const { app } = await newApp();
    for (const c of steps) app.commands[c]();
    assert.equal(app.getState().session, { preparing: 'preparing', recording: 'recording', paused: 'paused', stopped: 'stopped' }[name]);
    const before = app.getState().session;
    const a = await app.importTextFile(txtFile);
    const b = await app.importTextFile(vttFile);
    assert.equal(a.ok, true, `${name}: .txt`);
    assert.equal(b.ok, true, `${name}: .vtt`);
    assert.deepEqual(texts(app), ['一行目', '二行目', '一件目', '二件目'], name);
    assert.equal(app.getState().session, before, `${name}: 状態は変わらない`);
  }
});

test('FR-039 AC-181: 記録中の取込でも記録は止まらず、その後の手入力は引き続き受け付けられる', async () => {
  const { app } = await newApp();
  app.commands['session.start']();
  await app.importTextFile(txtFile);
  assert.equal(app.getState().session, 'recording');
  app.setDraft('取込後の手入力');
  assert.equal(app.submitDraft().ok, true);
  assert.equal(texts(app).at(-1), '取込後の手入力');
});

test('FR-039 AC-181: 一時停止・停止中に取り込んだ発話は認識文字列の一覧・図・テキスト一覧にも反映される', async () => {
  for (const steps of [STATES.paused, STATES.stopped, STATES.preparing]) {
    const { app, env } = await newApp(); toDetail(app);
    for (const c of steps) app.commands[c]();
    const r = await app.importTextFile(vttFile);
    assert.equal(r.ok, true);
    env.scheduler.advance(3000);
    assert.deepEqual(app.getTranscript().finals.map((f) => f.text), ['一件目', '二件目']);
    const svg = app.renderSvg(); const outline = app.renderOutline();
    assert.ok(app.getState().scenes.length >= 1);
    for (const s of app.getState().scenes) {
      assert.ok(svg.includes(`data-scene-id="${s.id}"`));
      assert.ok(outline.includes(s.heading));
    }
  }
});

test('FR-039 AC-181 異常系: 一時停止・停止中でも音声認識の結果と手入力は追加されない（取込だけが可能）', async () => {
  for (const steps of [STATES.paused, STATES.stopped]) {
    const { app, env } = await newApp();
    for (const c of steps) app.commands[c]();
    await app.importTextFile(txtFile);
    const n = app.getState().utterances.length;
    env.speech.emit('停止中の声', true);
    app.setDraft('停止中の入力');
    assert.equal(app.submitDraft().ok, false);
    assert.equal(app.getState().utterances.length, n);
  }
});

test('FR-039 AC-181 異常系: 復元・読込直後（一時停止）でもファイル取込は受け付けられ、状態は一時停止のまま（AC-043・AC-099）', async () => {
  const { app, env, createApp } = await newApp();
  app.commands['session.start']();
  await app.importTextFile(txtFile);
  const app2 = await createApp({ ...env.options });
  assert.equal(app2.getState().session, 'paused');
  const n = app2.getState().utterances.length;
  const r = await app2.importTextFile(vttFile);
  assert.equal(r.ok, true);
  assert.equal(app2.getState().utterances.length, n + 2);
  assert.equal(app2.getState().session, 'paused');
});
