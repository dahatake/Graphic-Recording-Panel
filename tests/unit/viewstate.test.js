// FR-108 画面の状態の復元（AC-621〜623）の単体・結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, keyFor } from '../system/helpers.js';
import { normalizeViewState, planRestore } from '../../web/src/viewstate.js';

// FR-108 AC-622
test('FR-108 AC-622: 復元の判定は決定的で、対象シーンが消えていれば絞り込み解除＋最寄りのスクロール位置＋理由', () => {
  const rec = { filter: { sceneId: 's1', text: 'a' }, scroll: { x: 10, y: 500 }, zoom: 2, center: { x: 3, y: 4 } };
  const now = { sceneIds: ['s1', 's2'], maxScrollY: 300 };
  const a = planRestore(rec, now); const b = planRestore(rec, now);
  assert.deepEqual(a, b);
  assert.equal(a.reason, null);
  assert.deepEqual(a.filter, { sceneId: 's1', text: 'a' });
  assert.deepEqual(a.scroll, { x: 10, y: 300 });
  const gone = planRestore(rec, { sceneIds: ['s2'], maxScrollY: 300 });
  assert.equal(gone.reason, 'filterSceneGone');
  assert.deepEqual(gone.filter, { sceneId: null, text: '' });
  assert.equal(gone.scroll.y, 300);
  assert.equal(gone.zoom, 2);
  assert.deepEqual(normalizeViewState(null), normalizeViewState({}));
});

// FR-108 AC-621
test('FR-108 AC-621: 詳細を開く直前の状態を Esc で閉じて復元し、status で伝える。要点・手修正は変わらない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const id = app.getState().scenes[1].id;
  app.setViewFilter({ sceneId: id, text: 'x' }); app.setViewScroll(5, 120); app.setViewZoom(1.5); app.setViewCenter({ x: 7, y: 8 });
  const before = JSON.stringify(app.getState().scenes);
  app.selectScene(app.getState().scenes[0].id);
  app.setViewZoom(1); app.setViewScroll(0, 0); // 開いている間に動かす
  assert.equal(app.handleKey({ key: 'Escape' }), 'popup.close');
  const v = app.getViewState();
  assert.equal(v.zoom, 1.5); assert.deepEqual(v.scroll, { x: 5, y: 120 }); assert.deepEqual(v.filter, { sceneId: id, text: 'x' }); assert.deepEqual(v.center, { x: 7, y: 8 });
  assert.match(app.getState().message.text, /戻しました/);
  assert.equal(JSON.stringify(app.getState().scenes), before);
  assert.ok(keyFor(app, 'viewstate.restore'));
});

// FR-108 AC-622
test('FR-108 AC-622: 絞り込みの対象のシーンが戻った時点でなければ、解除して理由を文字で示す', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.setViewFilter({ sceneId: 'gone-scene', text: '' });
  app.selectScene(app.getState().scenes[0].id);
  app.popupOutside();
  assert.equal(app.getViewState().filter.sceneId, null);
  assert.match(app.getState().message.text, /なくなった/);
});

// FR-108 AC-623
test('FR-108 AC-623: 画面の状態は保存・出力に含まれず、初期化で破棄される', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.setViewFilter({ sceneId: 'zzz-marker', text: 'zzz-marker' }); app.setViewZoom(2);
  assert.ok(!JSON.stringify(app.exportExtras?.() ?? {}).includes('zzz-marker'));
  assert.ok(![...env.storage?.dump?.() ?? []].join('').includes('zzz-marker'));
  app.selectScene(app.getState().scenes[0].id);
  app.popupOutside();
  app.setViewFilter({ sceneId: 'zzz-marker', text: '' });
  app.selectScene(app.getState().scenes[0].id);
  app.commands['data.reset']?.(); await app.dialogAction('confirm');
  assert.equal(app.hasRecordedViewState(), false);
});
