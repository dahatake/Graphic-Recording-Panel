// FR-020 / FR-021 の単体・結合テスト（System Test は tests/system/axes3d.test.js, view3dhelp.test.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, keyFor } from '../system/helpers.js';
import { buildCandidates, placeScenes, parseAxes, DEFAULT_AXES } from '../../web/src/axes3d.js';
import { applyViewOp, INITIAL_VIEWPOINT } from '../../web/src/view3d.js';

async function threeD(over) {
  const ctx = await newApp(over);
  await seedThreeScenes(ctx.app, ctx.env);
  ctx.app.setViewMode('3d');
  return ctx;
}
const SLOTS = ['x', 'y', 'z'];

// FR-020 AC-105
test('FR-020 AC-105: 3 軸の名前・目盛りと、各シーンの 3 軸の値が文字で得られ、DOM 相当の get3D にも含まれる', async () => {
  const { app } = await threeD();
  const g = app.get3D();
  const ax = app.getAxes3D();
  for (const s of SLOTS) {
    assert.ok(ax.candidates.find((c) => c.id === ax.axes[s]).label.trim());
    assert.ok(ax.ticks[s].length >= 1 && ax.ticks[s].every((t) => t.label.trim()));
  }
  for (const n of g.nodes) for (const s of SLOTS) assert.ok(String(n.values[s].text).length > 0, `${n.sceneId}.${s}`);
});

// FR-020 AC-103 AC-104（純関数）
test('FR-020 AC-103 AC-104: 全シーンで値が同じ候補は選べず、位置は値の大きい順で、同じ組でも重ならない', () => {
  const t = (k) => k;
  const mk = (id, n) => ({ id, heading: id, points: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, text: 'メモ' })) });
  const scenes = [mk('a', 1), mk('b', 1), mk('c', 1)];
  const cands = buildCandidates(scenes, null, t);
  const pc = cands.find((c) => c.id === 'pointCount');
  assert.equal(pc.available, false);
  assert.ok(pc.reason);
  const placed = placeScenes(scenes, DEFAULT_AXES, cands);
  assert.equal(new Set(placed.map((p) => `${p.position.x},${p.position.y},${p.position.z}`)).size, 3);
  assert.deepEqual(parseAxes({ x: 'time', y: 'time', z: 'emotion' }), DEFAULT_AXES);
});

// FR-020 AC-107
test('FR-020 AC-107: 軸の選択はキーボードから呼ぶコマンド経路と同じ API で行え、プレゼンは軸にかかわらず時系列でカメラが現在の位置へ向く', async () => {
  const { app } = await threeD();
  const ids = app.getState().scenes.map((s) => s.id);
  assert.equal(app.setAxis3D('x', 'utterances').ok, true);
  app.commands['session.pause']();
  app.commands['presentation.start']();
  assert.equal(app.get3D().camera.targetSceneId, ids[0]);
  app.commands['presentation.next']();
  assert.equal(app.get3D().camera.targetSceneId, ids[1]);
  const node = app.get3D().nodes.find((n) => n.sceneId === ids[1]);
  assert.ok(Number.isFinite(node.position.x));
});

test('FR-020 AC-107 異常系: 3D が使えない環境でも軸の選択結果が文字（values）で確認できる', async () => {
  const { app, env } = await newApp({ options: { env: { webgl: false, reducedMotion: false, viewportWidth: 1280 } } });
  await seedThreeScenes(app, env);
  app.setViewMode('3d');
  assert.equal(app.setAxis3D('x', 'utterances').ok, true);
  assert.ok(app.get3D().nodes.every((n) => n.values.x.text !== undefined));
  assert.equal(app.getAxes3D().axes.x, 'utterances');
});

// FR-021 AC-110
test('FR-021 AC-110: 言語の切替で操作説明の文言が切替後の言語になる（再読込なし）。支援技術向けの role と名前がある', async () => {
  const { app } = await threeD();
  const ja = JSON.stringify(app.getViewControls().operations);
  app.setLang('en');
  const en = app.getViewControls();
  assert.notEqual(JSON.stringify(en.operations), ja);
  assert.ok(!/[\u3040-\u30ff\u4e00-\u9fff]/.test(JSON.stringify(en.operations)), '英語に日本語が残らない');
  app.setLang('ja');
  assert.equal(JSON.stringify(app.getViewControls().operations), ja);
  assert.ok(app.getViewControls().role);
});

// FR-021 AC-111
test('FR-021 AC-111: 再生中は手動の視点操作が受け付けられず、一時停止中は操作でき、再開後もカメラは次のシーンへ向かう', async () => {
  const { app, env } = await threeD();
  const ids = app.getState().scenes.map((s) => s.id);
  app.commands['presentation.start']();
  const before = JSON.stringify(app.getViewpoint());
  assert.equal(app.viewControl('zoom-in', 'pointer').ok, false);
  assert.equal(JSON.stringify(app.getViewpoint()), before);
  app.commands['presentation.pause']();
  assert.equal(app.viewControl('zoom-in', 'pointer').ok, true);
  app.commands['presentation.resume']();
  env.scheduler.advance(8000);
  assert.equal(app.get3D().camera.targetSceneId, ids[1]);
  app.commands['presentation.stop']();
  assert.equal(app.viewControl('rotate-left', 'keyboard').ok, true);
});

test('FR-021 AC-111: 動きの軽減が有効ならアニメーションなし、WebGL なしでは操作説明は非表示で操作も不可', async () => {
  const a = await threeD({ options: { env: { webgl: true, reducedMotion: true, viewportWidth: 1280 } } });
  assert.equal(a.app.get3D().camera.animated, false);
  const b = await newApp({ options: { env: { webgl: false, reducedMotion: false, viewportWidth: 1280 } } });
  b.app.setViewMode('3d');
  assert.equal(b.app.getViewControls().visible, false);
  assert.equal(b.app.viewControl('zoom-in', 'pointer').ok, false);
});

// FR-021 AC-108
test('FR-021 AC-108: 視点の操作は純関数で境界を超えず、reset で初期に戻る。キー割り当てがある', async () => {
  let v = { ...INITIAL_VIEWPOINT };
  for (let i = 0; i < 50; i++) v = applyViewOp(v, 'rotate-up');
  assert.equal(v.elevation, 80);
  for (let i = 0; i < 50; i++) v = applyViewOp(v, 'zoom-in');
  assert.ok(v.distance >= 120);
  assert.deepEqual(applyViewOp(v, 'reset'), INITIAL_VIEWPOINT);
  const { app } = await threeD();
  for (const op of ['rotate-left', 'zoom-out', 'pan-up', 'reset']) assert.ok(keyFor(app, `view.${op}`), op);
});

// FR-020 AC-103: シーン 1 件では時間も値が得られず選べない（理由つき）。2 件以上なら選べる
test('FR-020 AC-103 異常系: シーン 1 件の時間は選べず理由が示され、2 件以上では選べる', () => {
  const t = (k) => k;
  const sc = (id) => ({ id, heading: id, points: [{ text: 'a' }] });
  const one = buildCandidates([sc('s1')], null, t).find((c) => c.id === 'time');
  assert.equal(one.available, false);
  assert.ok(one.reason);
  assert.equal(buildCandidates([sc('s1'), sc('s2')], null, t).find((c) => c.id === 'time').available, true);
});
