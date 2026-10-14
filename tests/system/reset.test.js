// FR-018 AC-093 AC-094 AC-095 AC-096（System Test。契約: CONTRACT.md「データの初期化」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes } from './helpers.js';

// 発話・シーン・手修正・整理の割り当て・表示設定・3D 軸・選択中シーンがある状態にする
async function populated(over = {}) {
  const ctx = await newApp(over);
  const { app, env } = ctx;
  await seedThreeScenes(app, env);
  const st = app.getState();
  const pid = st.scenes[0].points[0].id;
  app.editPoint(pid, '手で直した要点');
  app.setDisplayMode('arrange');
  const arr = app.getArrangement();
  app.assignObject(pid, { v: arr.axes.vertical.sections[0].id, h: arr.axes.horizontal.sections[0].id });
  app.setViewMode('3d');
  app.setAxis3D('x', 'utterances');
  app.selectScene(st.scenes[1].id);
  app.commands['session.start']();
  return { ...ctx, pid };
}
const snap = (app) => JSON.stringify({ s: app.getState(), m: app.getManualEdits(), a: app.getArrangement().assignments, ax: app.getAxes3D().axes, d: app.getDisplayMode() });

// FR-018 AC-093
test('FR-018 AC-093: 初期化を実行するとまず確認が出て（初期化する／キャンセル）、確認中はデータが変わらず、既定のフォーカスはキャンセル', async () => {
  const { app } = await populated();
  const before = snap(app);
  const r = app.commands['data.reset']();
  assert.equal(r.pending, true);
  const d = app.getDialog();
  assert.equal(d.kind, 'reset');
  assert.deepEqual(d.buttons.map((b) => b.id).sort(), ['cancel', 'confirm']);
  assert.equal(d.buttons.find((b) => b.id === 'confirm').label, '初期化する');
  assert.equal(d.buttons.find((b) => b.id === 'cancel').label, 'キャンセル');
  assert.ok(/元に戻せ/.test(d.text), '元に戻せない旨がある');
  assert.equal(d.defaultFocus, 'cancel');
  assert.equal(d.keyboard, true);
  assert.equal(snap(app), before, '確認が出ている間は何も変わらない');
});

test('FR-018 AC-093 異常系: 確認を経ずに内容が消えることはなく、確認中に再度実行しても確認は 1 つだけ', async () => {
  const { app } = await populated();
  app.commands['data.reset']();
  app.commands['data.reset']();
  assert.equal(app.getDialog().kind, 'reset');
  assert.ok(app.getState().utterances.length > 0);
  assert.ok(app.getState().scenes.length > 0);
});

// FR-018 AC-094
test('FR-018 AC-094: 「初期化する」で全データが 0 件になり、準備中・既定の表示・軸・選択なしに戻り、結果が読み上げ対象のメッセージで示される', async () => {
  const { app, env } = await populated();
  assert.equal(app.getState().session, 'recording');
  app.commands['data.reset']();
  app.dialogAction('confirm');
  const st = app.getState();
  assert.equal(st.utterances.length, 0);
  assert.equal(st.scenes.length, 0);
  assert.equal(st.selectedSceneId, null);
  assert.equal(st.session, 'preparing');
  assert.equal(st.viewMode, '2d');
  assert.equal(app.getDisplayMode(), 'timeline');
  assert.deepEqual(app.getManualEdits(), []);
  assert.deepEqual(app.getArrangement().assignments, []);
  assert.deepEqual(app.getAxes3D().axes, { x: 'pointCount', y: 'emotion', z: 'time' });
  assert.ok(env.speech.stopCalls >= 1, '音声認識は先に停止される');
  assert.ok(st.message?.text?.trim(), '結果のメッセージ');
  assert.equal(app.getCommandBar().status.role, 'status');
  assert.equal(app.getDialog(), null);
  assert.ok(!/予算の見直し/.test(app.renderSvg() + app.renderOutline()), '図・テキスト一覧が空');
});

test('FR-018 AC-094 異常系: データが何もない状態で初期化しても失敗せず初期状態のまま', async () => {
  const { app } = await newApp();
  app.commands['data.reset']();
  app.dialogAction('confirm');
  assert.equal(app.getState().session, 'preparing');
  assert.equal(app.getState().scenes.length, 0);
  assert.equal(app.getDialog(), null);
});

// FR-018 AC-095
test('FR-018 AC-095: 「キャンセル」で確認を閉じるとデータ・記録中・選択中のシーンが変わらない', async () => {
  const { app } = await populated();
  const before = snap(app);
  app.commands['data.reset']();
  app.dialogAction('cancel');
  assert.equal(app.getDialog(), null);
  assert.equal(snap(app), before);
  assert.equal(app.getState().session, 'recording');
});

test('FR-018 AC-095: Esc でも同じく変わらない（異常系: Esc の後に confirm は無効）', async () => {
  const { app } = await populated();
  const before = snap(app);
  app.commands['data.reset']();
  assert.equal(app.handleKey({ key: 'Escape' }), 'dialog.cancel');
  assert.equal(app.getDialog(), null);
  assert.equal(snap(app), before);
  app.dialogAction('confirm');
  assert.equal(snap(app), before, '確認が閉じた後の confirm では消えない');
});

// FR-018 AC-096
test('FR-018 AC-096: 初期化後に再読込してもセッションは復元されず、レイアウト・言語は保たれ、自動保存は空のまま', async () => {
  const { app, env, createApp } = await populated();
  app.setLang('en');
  app.movePanel('diagram', { x: 40, y: 30 });
  const layout = JSON.stringify(app.getLayout());
  app.commands['data.reset']();
  app.dialogAction('confirm');
  assert.equal(JSON.stringify(app.getLayout()), layout, 'レイアウトは対象外');
  assert.equal(app.getState().lang, 'en', '表示言語は対象外');
  app.setViewMode('2d'); // 状態の変化で自動保存を促す
  const dump = JSON.stringify(env.storage.dump());
  assert.ok(!dump.includes('予算の見直し') && !dump.includes('手で直した'), '初期化前の内容を書き戻さない');
  const again = await createApp(env.options);
  assert.equal(again.getState().utterances.length, 0);
  assert.equal(again.getState().scenes.length, 0);
});

test('FR-018 AC-096: 初期化の後も記録・手入力・取込が通常どおり行える', async () => {
  const { app, env } = await populated();
  app.commands['data.reset']();
  app.dialogAction('confirm');
  app.commands['session.start']();
  assert.equal(app.getState().session, 'recording');
  app.setDraft('新しい議論を始める');
  assert.equal(app.submitDraft().ok, true);
  const r = await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: 9, text: '行1\n行2' });
  assert.equal(r.ok, true);
  assert.ok(app.getState().utterances.length >= 3);
  env.speech.emit('音声からの発話', true);
  assert.ok(app.getState().utterances.some((u) => u.text.includes('音声からの発話')));
});
