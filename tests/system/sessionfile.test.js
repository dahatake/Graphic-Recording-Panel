// FR-019 AC-097 AC-098 AC-099 AC-100 AC-102（System Test。契約: CONTRACT.md「セッションファイル」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, FakeSpeech, keyFor } from './helpers.js';

const toFile = (d) => ({ name: d.filename, type: d.mime, size: Buffer.byteLength(String(d.data)), text: String(d.data) });

async function populated(over = {}) {
  const ctx = await newApp(over);
  const { app, env } = ctx;
  await seedThreeScenes(app, env);
  const st = app.getState();
  const pid = st.scenes[0].points[0].id;
  app.editPoint(pid, '手で直した要点');
  app.setDisplayMode('arrange');
  const arr = app.getArrangement();
  app.assignObject(pid, { v: arr.axes.vertical.sections[1].id, h: arr.axes.horizontal.sections[0].id });
  app.setViewMode('3d');
  app.setAxis3D('x', 'utterances');
  app.selectScene(st.scenes[1].id);
  return { ...ctx, pid };
}
const content = (app) => JSON.stringify({ u: app.getState().utterances.map((u) => u.text), s: app.getState().scenes, m: app.getManualEdits(), a: app.getArrangement().assignments.map((x) => [x.objectId, x.v, x.h]) });
const resetAll = (app) => { app.commands['data.reset'](); app.dialogAction('confirm'); };

// FR-019 AC-097
test('FR-019 AC-097: シーンがある状態で保存すると、外部リクエストなしにセッションファイルが 1 つダウンロードされ、音声を含まない', async () => {
  const calls = [];
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
  const saved = names.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  for (const k of names) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (...a) => { calls.push(k); throw new Error('blocked'); } });
  try {
    const { app, env } = await populated();
    env.downloads.length = 0;
    const r = await app.commands['file.save']();
    assert.equal(r.ok, true);
    assert.equal(env.downloads.length, 1);
    const d = env.downloads[0];
    assert.ok(d.filename && /\.json$/.test(d.filename));
    assert.equal(typeof d.data, 'string');
    const parsed = JSON.parse(d.data);
    assert.ok(!/audio|blob|wav|mp3/i.test(JSON.stringify(Object.keys(parsed)) + d.data.replace(/"text":"[^"]*"/g, '')), '音声データを含まない');
    assert.deepEqual(calls, [], '外部へのリクエストなし');
  } finally {
    for (const [k, desc] of saved) { if (desc) Object.defineProperty(globalThis, k, desc); else delete globalThis[k]; }
  }
});

test('FR-019 AC-097 異常系: シーンも発話もないときは保存できない旨が示され、ダウンロードされない', async () => {
  const { app, env } = await newApp();
  const r = await app.commands['file.save']();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty');
  assert.equal(env.downloads.length, 0);
  assert.ok(app.getState().message?.text?.trim());
});

// FR-019 AC-098
test('FR-019 AC-098: 保存→初期化→読込で、内容・手修正・割り当て・表示設定・軸・選択中のシーンが保存時と同じに復元される', async () => {
  const { app, env } = await populated();
  const svg = app.renderSvg(); const outline = app.renderOutline();
  const before = content(app);
  const view = { vm: app.getState().viewMode, dm: app.getDisplayMode(), ax: app.getAxes3D().axes, sel: app.getState().selectedSceneId, g: app.get3D().nodes };
  env.downloads.length = 0;
  await app.commands['file.save']();
  const file = toFile(env.downloads[0]);
  resetAll(app);
  assert.equal(app.getState().scenes.length, 0);
  const r = await app.loadSessionFile(file);
  assert.equal(r.ok, true, 'データなしでは確認なしで読み込める');
  assert.equal(content(app), before);
  assert.equal(app.getState().viewMode, view.vm);
  assert.equal(app.getDisplayMode(), view.dm);
  assert.deepEqual(app.getAxes3D().axes, view.ax);
  assert.equal(app.getState().selectedSceneId, view.sel);
  assert.deepEqual(app.get3D().nodes, view.g, '3D の配置が保存時と同じ');
  assert.equal(app.renderSvg(), svg);
  assert.equal(app.renderOutline(), outline);
});

test('FR-019 AC-098: 2D 時系列で保存した場合は 2D 時系列で復元される（異常系: 別の表示のまま読み込んでも上書きされる）', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  await app.commands['file.save']();
  const file = toFile(env.downloads[0]);
  app.setViewMode('3d'); app.setDisplayMode('arrange');
  await app.loadSessionFile(file);
  await app.dialogAction('confirm');
  assert.equal(app.getState().viewMode, '2d');
  assert.equal(app.getDisplayMode(), 'timeline');
});

// FR-019 AC-099
test('FR-019 AC-099: 読込後は一時停止で、再開するまで発話は追加されず、再開後の追加・手修正は通常どおり行える', async () => {
  const { app, env } = await populated();
  await app.commands['file.save']();
  const file = toFile(env.downloads.at(-1));
  resetAll(app);
  await app.loadSessionFile(file);
  assert.equal(app.getState().session, 'paused');
  const n = app.getState().utterances.length;
  env.speech.emit('一時停止中の声', true);
  app.setDraft('一時停止中の入力');
  assert.equal(app.submitDraft().ok, false);
  env.tick(60);
  assert.equal(app.getState().utterances.length, n, '再開まで追加されない');
  app.commands['session.resume']();
  app.setDraft('再開後の入力');
  assert.equal(app.submitDraft().ok, true);
  assert.equal(app.getState().utterances.length, n + 1);
  assert.equal(app.editPoint(app.getState().scenes[0].points[0].id, '読込後の手修正').ok, true);
});

test('FR-019 AC-099 異常系: 外部送信の同意が必要な環境では、再開時に同意を得るまで音声認識が開始されない', async () => {
  const speech = new FakeSpeech({ processLocally: false });
  const { app, env } = await populated({ speech, options: { speechSource: speech } });
  await app.commands['file.save']();
  const file = toFile(env.downloads.at(-1));
  resetAll(app);
  await app.loadSessionFile(file);
  speech.startCalls.length = 0;
  await app.commands['session.resume']();
  assert.equal(speech.startCalls.length, 0, '同意なしでは開始しない');
  app.setSpeechConsent(true);
  await app.commands['session.resume']();
  assert.ok(speech.startCalls.length >= 1, '同意後に開始する');
});

// FR-019 AC-100
test('FR-019 AC-100: 現在のデータがあるとき、読込は置換の確認を出し、キャンセルすると現在のデータは変わらない', async () => {
  const { app, env } = await populated();
  await app.commands['file.save']();
  const file = toFile(env.downloads.at(-1));
  app.commands['session.pause']();
  app.setDisplayMode('timeline');
  const before = content(app);
  const r = await app.loadSessionFile(file);
  assert.equal(r.pending, true);
  assert.equal(app.getDialog().kind, 'load-replace');
  assert.ok(/置き換|消え/.test(app.getDialog().text));
  assert.equal(content(app), before, '確認中は変わらない');
  await app.dialogAction('cancel');
  assert.equal(app.getDialog(), null);
  assert.equal(content(app), before);
  assert.equal(app.getDisplayMode(), 'timeline');
});

test('FR-019 AC-100: 置換を確認すると読込される。異常系: データがないときは確認が出ない', async () => {
  const { app, env } = await populated();
  await app.commands['file.save']();
  const file = toFile(env.downloads.at(-1));
  const saved = content(app);
  app.editPoint(app.getState().scenes[0].points[0].id, '別の手修正');
  await app.loadSessionFile(file);
  await app.dialogAction('confirm');
  assert.equal(content(app), saved);
  resetAll(app);
  const r = await app.loadSessionFile(file);
  assert.equal(r.ok, true);
  assert.equal(app.getDialog(), null, 'データなしでは確認なし');
});

// FR-019 AC-102
test('FR-019 AC-102: 保存・読込はキーボード（keymap）とコマンドの検索から行え、完了・失敗が読み上げ対象のメッセージで示される', async () => {
  const { app, env } = await populated();
  for (const c of ['file.save', 'file.load']) {
    assert.ok(keyFor(app, c), `${c} にキー割り当て`);
    const label = app.getCommandBar().items.find((i) => i.command === c).label;
    assert.ok(app.searchCommands(label).some((x) => x.command === c), `${c} をコマンド検索で見つけられる`);
  }
  env.downloads.length = 0;
  assert.equal(app.handleKey(keyFor(app, 'file.save')), 'file.save');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(env.downloads.length, 1, 'キーボードで保存できる');
  const file = toFile(env.downloads[0]);
  resetAll(app);
  await app.loadSessionFile(file);
  const ok = app.getState().message;
  assert.ok(ok?.text?.trim(), '完了のメッセージ');
  assert.equal(app.getCommandBar().status.role, 'status');
  await app.loadSessionFile({ name: 'x.json', type: 'application/json', size: 3, text: '{ざ' });
  assert.notEqual(app.getState().message?.key, ok.key, '失敗は完了と異なるメッセージ');
  assert.ok(app.getState().message.text.trim());
});

test('FR-019 AC-102: テキスト取込（.txt）とは別の操作で、互いのファイルを受け付けない（異常系）', async () => {
  const { app, env } = await populated();
  await app.commands['file.save']();
  const file = toFile(env.downloads.at(-1));
  const before = content(app);
  const a = await app.importTextFile(file);
  assert.equal(a.ok, false, 'セッションファイルは .txt 取込で受け付けない');
  const b = await app.loadSessionFile({ name: 'memo.txt', type: 'text/plain', size: 12, text: '行1\n行2' });
  assert.equal(b.ok, false, '.txt はセッションファイルとして読めない');
  assert.equal(content(app), before);
});
