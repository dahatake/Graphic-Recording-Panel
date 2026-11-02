// FR-009 AC-020 / FR-010 AC-022 AC-023 / NFR-A11Y-001 AC-036（契約: get3D / presentation.* / keymap / handleKey）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, keyFor, PARAM } from './helpers.js';

test('FR-009 AC-020: 2D→3D で全シーンが奥行きのある空間に配置され、選択シーンが保たれる（3D→2D も同様）', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const ids = app.getState().scenes.map((s) => s.id);
  app.selectScene(ids[1]);
  app.setViewMode('3d');
  assert.equal(app.getState().viewMode, '3d');
  const g = app.get3D();
  assert.deepEqual(g.nodes.map((n) => n.sceneId).sort(), [...ids].sort());
  for (const n of g.nodes) for (const k of ['x', 'y', 'z']) assert.ok(Number.isFinite(n.position[k]));
  assert.ok(new Set(g.nodes.map((n) => n.position.z)).size > 1, 'z が全て同一ではない（奥行き）');
  assert.equal(app.getState().selectedSceneId, ids[1]);
  assert.equal(g.selectedSceneId, ids[1]);
  app.setViewMode('2d');
  assert.equal(app.getState().viewMode, '2d');
  assert.equal(app.getState().selectedSceneId, ids[1]);
});

test('FR-009 AC-020 異常系: 存在しないシーンの選択は無視され、選択は変わらない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const ids = app.getState().scenes.map((s) => s.id);
  app.selectScene(ids[2]);
  app.selectScene('no-such-scene');
  assert.equal(app.getState().selectedSceneId, ids[2]);
});

test(`FR-010 AC-022: プレゼンは各シーンを時系列順に ${PARAM.DWELL_SEC} 秒ずつ映し、最後の次で終了する`, async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const ids = app.getState().scenes.map((s) => s.id);
  app.setViewMode('3d');
  const sec = env.scheduler;
  app.commands['presentation.start']();
  assert.equal(app.getState().presentation.status, 'playing');
  assert.equal(app.get3D().camera.targetSceneId, ids[0]);
  sec.advance(PARAM.DWELL_SEC * 1000 - 1);
  assert.equal(app.get3D().camera.targetSceneId, ids[0]);
  sec.advance(1);
  assert.equal(app.get3D().camera.targetSceneId, ids[1]);
  sec.advance(PARAM.DWELL_SEC * 1000);
  assert.equal(app.get3D().camera.targetSceneId, ids[2]);
  assert.equal(app.getState().presentation.status, 'playing');
  sec.advance(PARAM.DWELL_SEC * 1000);
  assert.equal(app.getState().presentation.status, 'finished');
});

test('FR-010 AC-022 異常系: シーン 0 件ではプレゼンは開始されない', async () => {
  const { app } = await newApp();
  app.commands['presentation.start']();
  assert.notEqual(app.getState().presentation.status, 'playing');
});

test('FR-010 AC-023: 一時停止・再開・停止・前後移動がボタン（commands）でできる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const ids = app.getState().scenes.map((s) => s.id);
  const c = app.commands;
  c['presentation.start']();
  c['presentation.next']();
  assert.equal(app.getState().presentation.sceneId, ids[1]);
  c['presentation.prev']();
  assert.equal(app.getState().presentation.sceneId, ids[0]);
  c['presentation.prev']();
  assert.equal(app.getState().presentation.sceneId, ids[0], '先頭より前へは行かない');
  c['presentation.pause']();
  assert.equal(app.getState().presentation.status, 'paused');
  env.scheduler.advance(PARAM.DWELL_SEC * 5000);
  assert.equal(app.getState().presentation.sceneId, ids[0], '一時停止中は進まない');
  c['presentation.resume']();
  assert.equal(app.getState().presentation.status, 'playing');
  c['presentation.stop']();
  assert.equal(app.getState().presentation.status, 'idle');
});

test('FR-010 AC-023: 同じ操作がキーボード（keymap / handleKey）でもできる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const ids = app.getState().scenes.map((s) => s.id);
  const press = (cmd) => { const k = keyFor(app, cmd); assert.ok(k, `${cmd} にキー割り当て`); return app.handleKey(k); };
  assert.equal(press('presentation.start'), 'presentation.start');
  assert.equal(app.getState().presentation.status, 'playing');
  assert.equal(press('presentation.next'), 'presentation.next');
  assert.equal(app.getState().presentation.sceneId, ids[1]);
  assert.equal(press('presentation.prev'), 'presentation.prev');
  assert.equal(app.getState().presentation.sceneId, ids[0]);
  press('presentation.pause');
  assert.equal(app.getState().presentation.status, 'paused');
  press('presentation.resume');
  assert.equal(app.getState().presentation.status, 'playing');
  press('presentation.stop');
  assert.equal(app.getState().presentation.status, 'idle');
});

test('NFR-A11Y-001 AC-036: 入力・保存・言語・2D/3D・プレゼンの全操作にキー割り当てがあり、キーだけで実行できる', async () => {
  const { app, env } = await newApp();
  const required = ['session.start', 'session.pause', 'session.resume', 'session.stop', 'session.nextScene', 'input.focus',
    'save.png', 'save.svg', 'save.pdf', 'lang.ja', 'lang.en', 'view.2d', 'view.3d',
    'presentation.start', 'presentation.pause', 'presentation.resume', 'presentation.stop', 'presentation.next', 'presentation.prev'];
  for (const c of required) {
    assert.equal(typeof app.commands[c], 'function', `commands[${c}]`);
    assert.ok(keyFor(app, c), `keymap に ${c}`);
  }
  const combos = app.keymap.map((k) => `${!!k.ctrl}${!!k.alt}${!!k.shift}${k.key}`);
  assert.equal(new Set(combos).size, combos.length, 'キーの割り当てが重複しない');
  const press = (c) => app.handleKey(keyFor(app, c));
  press('session.start');
  assert.equal(app.getState().session, 'recording');
  app.setDraft('キーボードだけで記録'); app.submitDraft();
  press('session.nextScene');
  app.setDraft('次のシーンの話'); app.submitDraft();
  press('lang.en'); assert.equal(app.getState().lang, 'en');
  press('lang.ja'); assert.equal(app.getState().lang, 'ja');
  press('view.3d'); assert.equal(app.getState().viewMode, '3d');
  press('view.2d'); assert.equal(app.getState().viewMode, '2d');
  press('save.png'); press('save.svg'); press('save.pdf');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(env.downloads.map((d) => d.mime).sort(), ['application/pdf', 'image/png', 'image/svg+xml']);
  press('session.pause'); assert.equal(app.getState().session, 'paused');
  press('session.resume'); assert.equal(app.getState().session, 'recording');
  press('session.stop'); assert.equal(app.getState().session, 'stopped');
});

test('NFR-A11Y-001 AC-036 異常系: 割り当てのないキーは何も実行しない', async () => {
  const { app } = await newApp();
  assert.equal(app.handleKey({ key: 'F24', ctrlKey: true, altKey: true, shiftKey: true }), null);
});

// NFR-A11Y-001 AC-036（FR-092〜094・099・101・102・104 の追加分。契約: tests/system/CONTRACT-P1.md §3）
test('NFR-A11Y-001 AC-036: 用語集・議事・プレビュー・地図・対立の組・機密の印の操作にキー割り当てがあり、キーだけで実行できる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const added = ['glossary.open', 'agenda.open', 'preview.show', 'map.focusNext', 'map.focusPrev', 'map.activate', 'conflict.group', 'conflict.ungroup', 'point.confidential'];
  for (const c of added) {
    assert.equal(typeof app.commands[c], 'function', `commands[${c}]`);
    assert.ok(keyFor(app, c), `keymap に ${c}`);
  }
  const combos = app.keymap.map((k) => `${!!k.ctrl}${!!k.alt}${!!k.shift}${k.key}`);
  assert.equal(new Set(combos).size, combos.length, 'キーの割り当てが重複しない');
  for (const c of added) assert.equal(app.handleKey(keyFor(app, c)), c, `handleKey が ${c} を実行して名前を返す`);
  // 機密の印: 選択した要点へキーだけで付け・外せる（AC-605 の入口）
  const p = app.getState().scenes[0].points[0];
  assert.equal(app.selectPoint(p.id).ok, true);
  const mark = () => app.getState().scenes[0].points.find((q) => q.id === p.id).confidential === true;
  const before = mark();
  app.handleKey(keyFor(app, 'point.confidential'));
  assert.equal(mark(), !before, 'キーで機密の印が切り替わる');
  app.handleKey(keyFor(app, 'point.confidential'));
  assert.equal(mark(), before, 'もう一度で元に戻る');
});

test('NFR-A11Y-001 AC-036 異常系: 存在しない要点は選べず、機密の印は変わらない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  assert.equal(app.selectPoint('no-such-point').ok, false);
  app.handleKey(keyFor(app, 'point.confidential'));
  assert.ok(app.getState().scenes.flatMap((s) => s.points).every((q) => q.confidential !== true), '選択がないので印は付かない');
});

// NFR-A11Y-001 AC-036（5c05a4e の改訂: 用語集・議題の観察点、案内・ヘルプ・投影・読み順の型・種類別スタイルの設定もキー対象。契約: CONTRACT-P1.md §3）
test('NFR-A11Y-001 AC-036: glossary.open（Alt+Shift+,）・agenda.open（Alt+Shift+.）がキーだけで実行でき、状態メッセージで受け付けが分かる', async () => {
  const { app } = await newApp();
  const g = app.keymap.find((k) => k.command === 'glossary.open');
  const a = app.keymap.find((k) => k.command === 'agenda.open');
  assert.deepEqual([g.key, !!g.alt, !!g.shift, !!g.ctrl], [',', true, true, false], 'glossary.open は Alt+Shift+,');
  assert.deepEqual([a.key, !!a.alt, !!a.shift, !!a.ctrl], ['.', true, true, false], 'agenda.open は Alt+Shift+.');
  assert.equal(app.handleKey({ key: ',', altKey: true, shiftKey: true, ctrlKey: false }), 'glossary.open');
  assert.equal(app.getState().message?.key, 'msg.glossaryOpen');
  assert.ok(String(app.getState().message?.text ?? '').length > 0, '読み上げる文字がある');
  assert.equal(app.handleKey({ key: '.', altKey: true, shiftKey: true, ctrlKey: false }), 'agenda.open');
  assert.equal(app.getState().message?.key, 'msg.agendaOpen');
  assert.ok(String(app.getState().message?.text ?? '').length > 0);
});

test('NFR-A11Y-001 AC-036: 案内・ヘルプ・サンプル・読み順の型・種類別スタイル・設定（投影のプリセット）がキーだけで操作できる', async () => {
  const { app } = await newApp();
  const cmds = ['help.open', 'sample.load', 'onboarding.next', 'onboarding.back', 'onboarding.skip',
    'layoutType.timeline', 'layoutType.add.timeline', 'layoutType.clear', 'kindStyle.toggle', 'kindStyle.recommend', 'settings.open'];
  for (const c of cmds) { assert.equal(typeof app.commands[c], 'function', `commands[${c}]`); assert.ok(keyFor(app, c), `keymap に ${c}`); }
  const combos = app.keymap.map((k) => `${!!k.ctrl}${!!k.alt}${!!k.shift}${k.key}`);
  assert.equal(new Set(combos).size, combos.length, 'キーの割り当てが重複しない');
  assert.equal(app.handleKey(keyFor(app, 'help.open')), 'help.open');
  assert.equal(app.getOnboarding()?.step, 1, 'ヘルプのキーで案内が開く');
  assert.equal(app.handleKey(keyFor(app, 'onboarding.skip')), 'onboarding.skip');
  assert.equal(app.getOnboarding(), null);
  const before = app.getState().kindStyles?.enabled ?? app.getState().kindStyles;
  app.handleKey(keyFor(app, 'kindStyle.toggle'));
  assert.notDeepEqual(app.getState().kindStyles?.enabled ?? app.getState().kindStyles, before, '種類別スタイルの有効・無効がキーで切り替わる');
  app.handleKey(keyFor(app, 'settings.open'));
  assert.ok(app.getSettingsDialog(), 'キーで設定が開く');
  assert.ok(app.getSettingsView().fields.some((f) => /projection/i.test(f.id)), '投影のプリセットの項目が設定にある（キーで選べる combobox）');
  assert.equal(app.setProjectionPreset('hall').ok, true);
  assert.equal(app.getProjectionPreset().id, 'hall');
});
