// FR-011 AC-025 AC-026 AC-027（契約: getLayout / movePanel / resizePanel / setPanelVisible / setPanelMaximized / resetLayout / panelCommand、保存キー grp.layout）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes } from './helpers.js';

const panels = ['input', 'diagram', 'outline'];

test('FR-011 AC-025: パネルの移動・大きさ変更・表示/非表示・最大化ができ、その間に入力中の文字列・選択シーン・記録中の状態が失われない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const sid = app.getState().scenes[1].id;
  app.selectScene(sid);
  app.setDraft('入力途中の文字列');
  const lay0 = app.getLayout();
  assert.deepEqual(Object.keys(lay0.panels).sort(), [...panels].sort());
  app.movePanel('diagram', { x: 123, y: 45 });
  app.resizePanel('diagram', { w: 640, h: 360 });
  app.setPanelVisible('outline', false);
  app.setPanelMaximized('diagram', true);
  const p = app.getLayout().panels;
  assert.equal(p.diagram.x, 123); assert.equal(p.diagram.y, 45);
  assert.equal(p.diagram.w, 640); assert.equal(p.diagram.h, 360);
  assert.equal(p.outline.visible, false);
  assert.equal(p.diagram.maximized, true);
  app.setPanelVisible('outline', true);
  assert.equal(app.getLayout().panels.outline.visible, true);
  assert.equal(app.getState().input.draft, '入力途中の文字列');
  assert.equal(app.getState().selectedSceneId, sid);
  assert.equal(app.getState().session, 'recording');
  assert.equal(app.getState().utterances.length, 4);
});

test('FR-011 AC-025 異常系: 存在しないパネルの操作はレイアウトを変えない', async () => {
  const { app } = await newApp();
  const before = JSON.stringify(app.getLayout());
  try { app.movePanel('nope', { x: 1, y: 1 }); app.setPanelVisible('nope', false); } catch { /* 例外でも可 */ }
  assert.equal(JSON.stringify(app.getLayout()), before);
});

test('FR-011 AC-026: 変更したレイアウトが再読込後に復元され、「既定に戻す」で初期に戻る（保存先は同じ storage だけ）', async () => {
  const { app, env, createApp } = await newApp();
  const initial = JSON.stringify(app.getLayout());
  app.movePanel('input', { x: 77, y: 88 });
  app.setPanelVisible('outline', false);
  const changed = JSON.stringify(app.getLayout());
  assert.notEqual(changed, initial);
  assert.ok(env.storage.dump().length > 0 && env.storage.dump().every(([k]) => k.startsWith('grp.')));
  const app2 = await createApp(env.options);
  assert.equal(JSON.stringify(app2.getLayout()), changed);
  app2.resetLayout();
  assert.equal(JSON.stringify(app2.getLayout()), initial);
  const app3 = await createApp(env.options);
  assert.equal(JSON.stringify(app3.getLayout()), initial, '既定に戻した結果も保存される');
});

test('FR-011 AC-026 異常系: 保存済みレイアウトが壊れていても起動し、既定のレイアウトになる', async () => {
  const { app, env, createApp } = await newApp();
  const initial = JSON.stringify(app.getLayout());
  env.storage.setItem('grp.layout', '{壊れた');
  const app2 = await createApp(env.options);
  assert.equal(JSON.stringify(app2.getLayout()), initial);
});

test('FR-011 AC-027: ドラッグ相当の移動・大きさ変更をメニュー/キーボードのコマンド（panelCommand）でも行える', async () => {
  const { app } = await newApp();
  const g = (id = 'diagram') => app.getLayout().panels[id];
  const x0 = g().x, y0 = g().y, w0 = g().w, h0 = g().h;
  app.panelCommand('diagram', 'move-right'); assert.ok(g().x > x0);
  app.panelCommand('diagram', 'move-left'); assert.equal(g().x, x0);
  app.panelCommand('diagram', 'move-down'); assert.ok(g().y > y0);
  app.panelCommand('diagram', 'move-up'); assert.equal(g().y, y0);
  app.panelCommand('diagram', 'grow'); assert.ok(g().w > w0 && g().h > h0);
  app.panelCommand('diagram', 'shrink'); assert.equal(g().w, w0); assert.equal(g().h, h0);
});
