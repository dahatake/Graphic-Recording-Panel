// FR-009 AC-021 / FR-010 AC-041 AC-024 の単体・結合テスト（WebGL なし・動きの軽減の環境）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, PARAM } from '../system/helpers.js';
import { layout3D } from '../../web/src/view3d.js';

// FR-009 AC-021: WebGL がない環境では 3D の代替（2D）で、その旨が表示される
test('FR-009 AC-021: WebGL なしで 3D に切り替えると、代替表示の旨のメッセージが出る', async () => {
  const { app, env } = await newApp({ options: { env: { webgl: false, reducedMotion: false, viewportWidth: 1280 } } });
  await seedThreeScenes(app, env);
  app.setViewMode('3d');
  assert.equal(app.getState().message.key, 'msg.no3d');
  assert.ok(app.getState().message.text.length > 0);
  assert.equal(app.get3D().camera.animated, false);
  app.setViewMode('2d');
  assert.equal(app.getState().message, null);
});

// FR-010 AC-041: 3D 非対応でも開始・一時停止・停止・前後移動と、時系列順の PARAM-004 秒ずつの提示ができる
test('FR-010 AC-041: WebGL なしでもプレゼンが同じ操作で、時系列順に 8 秒ずつ進む', async () => {
  const { app, env } = await newApp({ options: { env: { webgl: false, reducedMotion: false, viewportWidth: 1280 } } });
  await seedThreeScenes(app, env);
  const ids = app.getState().scenes.map((s) => s.id);
  app.setViewMode('3d');
  const c = app.commands;
  c['presentation.start']();
  assert.equal(app.getState().presentation.sceneId, ids[0]);
  env.scheduler.advance(PARAM.DWELL_SEC * 1000);
  assert.equal(app.getState().presentation.sceneId, ids[1]);
  c['presentation.next'](); c['presentation.next']();
  assert.equal(app.getState().presentation.sceneId, ids[2], '末尾で止まる');
  c['presentation.pause']();
  env.scheduler.advance(PARAM.DWELL_SEC * 3000);
  assert.equal(app.getState().presentation.status, 'paused');
  c['presentation.resume'](); env.scheduler.advance(PARAM.DWELL_SEC * 1000);
  assert.equal(app.getState().presentation.status, 'finished');
  c['presentation.stop']();
  assert.equal(app.getState().presentation.status, 'idle');
});

// FR-010 AC-024: 動きの軽減が有効なら、カメラ移動のアニメーションは省かれる
test('FR-010 AC-024: reducedMotion で camera.animated が偽、通常は真', async () => {
  const a = await newApp({ options: { env: { webgl: true, reducedMotion: true, viewportWidth: 1280 } } });
  await seedThreeScenes(a.app, a.env);
  a.app.commands['presentation.start']();
  assert.equal(a.app.get3D().camera.animated, false);
  const b = await newApp();
  assert.equal(b.app.get3D().camera.animated, true);
});

test('FR-009 AC-020: layout3D は z がシーンごとに異なる', () => {
  const n = layout3D([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  assert.equal(new Set(n.map((x) => x.position.z)).size, 3);
});
