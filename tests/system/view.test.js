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
