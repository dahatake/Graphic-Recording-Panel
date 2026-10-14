// FR-021 AC-108 AC-109（System Test。契約: CONTRACT.md「3D の画面操作と操作説明」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, keyFor } from './helpers.js';

const OPS = {
  rotate: ['rotate-left', 'rotate-right', 'rotate-up', 'rotate-down'],
  zoom: ['zoom-in', 'zoom-out'],
  pan: ['pan-left', 'pan-right', 'pan-up', 'pan-down'],
};
async function threeD(over = {}) {
  const ctx = await newApp(over);
  await seedThreeScenes(ctx.app, ctx.env);
  ctx.app.setViewMode('3d');
  return ctx;
}
const vp = (app) => JSON.stringify(app.getViewpoint());

// FR-021 AC-108
test('FR-021 AC-108: 回転・拡大縮小・移動が、ポインタとキーボードの両方でできて、視点が変わる', async () => {
  const { app } = await threeD();
  for (const source of ['pointer', 'keyboard']) {
    for (const [kind, ops] of Object.entries(OPS)) {
      for (const op of ops) {
        const b = app.getViewpoint();
        const r = app.viewControl(op, source);
        assert.equal(r.ok, true, `${source} ${op}`);
        const a = app.getViewpoint();
        const keys = { rotate: ['azimuth', 'elevation'], zoom: ['distance'], pan: ['panX', 'panY'] }[kind];
        assert.ok(keys.some((k) => a[k] !== b[k]), `${source} ${op}: 視点が変わる`);
        app.viewControl('reset', source);
      }
    }
  }
});

test('FR-021 AC-108: キーボード（keymap・handleKey）で視点を操作できる', async () => {
  const { app } = await threeD();
  for (const op of [...OPS.rotate, ...OPS.zoom, ...OPS.pan, 'reset']) {
    const k = keyFor(app, `view.${op}`);
    assert.ok(k, `view.${op} にキー割り当て`);
  }
  const b = vp(app);
  assert.equal(app.handleKey(keyFor(app, 'view.zoom-in')), 'view.zoom-in');
  assert.notEqual(vp(app), b);
});

test('FR-021 AC-108: 「視点を初期に戻す」で初期の視点になり、操作の前後で選択中のシーンと軸の選択は変わらない', async () => {
  const { app } = await threeD();
  const init = vp(app);
  app.selectScene(app.getState().scenes[1].id);
  app.setAxis3D('x', 'utterances');
  const sel = app.getState().selectedSceneId; const axes = JSON.stringify(app.getAxes3D().axes);
  app.viewControl('rotate-left', 'pointer'); app.viewControl('zoom-in', 'keyboard'); app.viewControl('pan-up', 'pointer');
  assert.notEqual(vp(app), init);
  assert.equal(app.getState().selectedSceneId, sel);
  assert.equal(JSON.stringify(app.getAxes3D().axes), axes);
  assert.equal(app.viewControl('reset', 'keyboard').ok, true);
  assert.equal(vp(app), init);
  assert.equal(app.getState().selectedSceneId, sel);
  assert.equal(JSON.stringify(app.getAxes3D().axes), axes);
});

test('FR-021 AC-108 異常系: 2D 表示では視点の操作は受け付けられず、視点は変わらない', async () => {
  const { app } = await threeD();
  app.setViewMode('2d');
  const b = vp(app);
  assert.equal(app.viewControl('rotate-left', 'pointer').ok, false);
  assert.equal(vp(app), b);
});

// FR-021 AC-109
test('FR-021 AC-109: 3D 表示の間だけ操作説明が下部に表示され、各操作にマウス・タッチ・キーボードの方法がある', async () => {
  const { app } = await threeD();
  const c = app.getViewControls();
  assert.equal(c.visible, true);
  assert.equal(c.region, 'bottom');
  assert.deepEqual(c.operations.map((o) => o.id).sort(), ['pan', 'reset', 'rotate', 'zoom']);
  for (const o of c.operations) for (const k of ['mouse', 'touch', 'keyboard']) assert.ok(o[k]?.trim(), `${o.id}.${k}`);
  app.setViewMode('2d');
  assert.equal(app.getViewControls().visible, false, '2D では表示されない');
  app.setViewMode('3d');
  assert.equal(app.getViewControls().visible, true, '3D に戻すと再び表示');
});

test('FR-021 AC-109: 幅が 640px 以下でも操作説明は省かれず、他の表示を隠さない', async () => {
  const { app } = await threeD({ options: { env: { webgl: true, reducedMotion: false, viewportWidth: 600 } } });
  const c = app.getViewControls();
  assert.equal(c.visible, true);
  assert.ok(['wrap', 'collapsible'].includes(c.wrap));
  assert.equal(c.hidesOthers, false);
  assert.equal(c.operations.length, 4);
});

test('FR-021 AC-109 異常系: 3D が使えない環境（WebGL なし）や、シーンなしの 2D では操作説明は表示されない', async () => {
  const { app } = await newApp({ options: { env: { webgl: false, reducedMotion: false, viewportWidth: 1280 } } });
  app.setViewMode('3d');
  assert.equal(app.getViewControls().visible, false);
});
