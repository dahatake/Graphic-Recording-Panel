// FR-018 AC-093 AC-094 AC-095 AC-096（System Test。契約: CONTRACT.md「データの初期化」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from './helpers.js';
import { makeRelay, bootApp, enableLlm, TXT, MEETING_LINES } from './batch-util.js';

// 手順（AC-094）: 詳細度の既定は「大項目」。初期化で詳細度が変わらないことを確かめるため、populated() で toDetail(app, 'middle') により既定以外へ切り替えてから初期化する。

// 発話・シーン・手修正・整理の割り当て・表示設定・3D 軸・選択中シーンがある状態にする
async function populated(over = {}) {
  const ctx = await newApp(over);
  const { app, env } = ctx;
  await seedThreeScenes(app, env);
  toDetail(app, 'middle');
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
  assert.equal(app.getDetailLevel(), 'middle', '図の詳細度は初期化の対象外で変わらない');
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

// FR-018 AC-096（・AC-094 の初期状態）回帰（2026-11-07。reviewer P1: バッチの LLM 要求が未応答のまま初期化を確定すると、後着の応答で消去前の内容が戻る）。
// 期待値は受入基準だけから実行前に固定する: 初期化の後は AC-094 の初期状態（発話・シーン 0 件・図とテキスト一覧が空・準備中）で、
// 後着の成功・失敗の応答のどちらでもそれが変わらない（図・発話・状態）。自動保存は空のままで、再読込で消去前の内容が復元されない（AC-096）。
// 要求が未応答の状態を作れないときは合格にせず前提不成立で失敗する。
test('FR-018 AC-096 回帰: バッチの LLM 要求が未応答のまま初期化を確定すると、後着の成功・失敗の応答が届いても図・発話・状態は初期化のままで、消去前の内容は自動保存・再読込で戻らない', async () => {
  const OK = { status: 200, body: { objects: [{ key: 'person', label: '人' }], people: [], emotions: [], metaphors: [], points: ['後着の要点ZQXLATE'] } };
  const FAIL = { status: 500, body: { error: 'mock' } };
  for (const [label, outcome] of [['後着の成功', OK], ['後着の失敗', FAIL]]) {
    const h = makeRelay({ mode: 'manual' });
    const { app, env, createApp } = await bootApp(h);
    await enableLlm(app);
    assert.equal((await app.importTextFile(TXT)).ok, true, `${label}: 取り込める`);
    const style = app.getBatchStyles()[0];
    let settled = false;
    const running = app.runBatch(style.id).then((r) => { settled = true; return r; }, () => { settled = true; });
    assert.ok(await h.waitOpen(1), `${label}: 前提不成立: バッチの LLM 要求が未応答の状態にならない`);
    assert.equal(settled, false, `${label}: 前提不成立: 応答の前に実行が終わった`);
    app.commands['data.reset']();
    app.dialogAction('confirm');
    const initial = () => {
      const st = app.getState();
      assert.equal(st.utterances.length, 0, `${label}: 発話は 0 件`);
      assert.equal(app.getTranscript().finals.length, 0, `${label}: 認識文字列は 0 件`);
      assert.equal(st.scenes.length, 0, `${label}: シーンは 0 件`);
      assert.equal(st.session, 'preparing', `${label}: セッションは準備中`);
      assert.equal(st.selectedSceneId, null, `${label}: 選択中のシーンはない`);
      const svg = app.renderSvg();
      assert.ok(!/data-scene-id=/.test(svg) && !svg.includes('ZQXLATE'), `${label}: 図は空の初期状態`);
      assert.ok(!/data-point-id=/.test(app.renderOutline()), `${label}: テキスト一覧は空`);
      assert.notEqual(app.getBatchState().state, 'running', `${label}: バッチは実行中でない`);
    };
    initial();
    const before = JSON.stringify({ s: app.getState(), svg: app.renderSvg(), o: app.renderOutline(), b: app.getBatchState().state });
    // 後着の応答: 未応答の要求すべてに同じ結果を返す（初期化の後に新しく出る要求にも応答し、待ちを残さない）
    for (let i = 0; i < 50 && h.open().length; i++) { h.respond(outcome); await new Promise((r) => setTimeout(r, 0)); await h.waitOpen(1, 50); }
    await Promise.race([running, new Promise((r) => setTimeout(r, 2000))]);
    await app.flushLlm();
    initial();
    assert.equal(JSON.stringify({ s: app.getState(), svg: app.renderSvg(), o: app.renderOutline(), b: app.getBatchState().state }), before, `${label}: 後着の応答の前後で図・発話・状態が同じ`);
    // AC-096: 自動保存は空のまま（消去前の内容を書き戻さない）。状態の変化で自動保存を促してから確かめる
    app.setViewMode('2d');
    const dump = JSON.stringify(env.storage.dump());
    for (const line of MEETING_LINES) assert.ok(!dump.includes(line), `${label}: 自動保存に消去前の発話「${line}」がない`);
    assert.ok(!dump.includes('ZQXLATE'), `${label}: 自動保存に後着の要点がない`);
    const again = await createApp(env.options);
    assert.equal(again.getState().utterances.length, 0, `${label}: 再読込で発話は復元されない`);
    assert.equal(again.getState().scenes.length, 0, `${label}: 再読込でシーンは復元されない`);
  }
});
