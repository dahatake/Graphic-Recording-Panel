// FR-020 AC-103 AC-104 AC-106（System Test。契約: CONTRACT.md「3D の評価軸」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes } from './helpers.js';

const BASE = ['time', 'pointCount', 'utterances', 'emotion', 'arrangeV', 'arrangeH'];
const cand = (app, id) => app.getAxes3D().candidates.find((c) => c.id === id);
const pos = (app) => new Map(app.get3D().nodes.map((n) => [n.sceneId, n.position]));

async function threeD() {
  const ctx = await newApp();
  await seedThreeScenes(ctx.app, ctx.env);
  ctx.app.setViewMode('3d');
  return ctx;
}

// FR-020 AC-103
test('FR-020 AC-103: 3D 表示に評価軸の候補 7 種類があり、既定の組は 横=要点の数・縦=感情の強さ・奥行き=時間', async () => {
  const { app } = await threeD();
  const g = app.getAxes3D();
  const ids = g.candidates.map((c) => c.id);
  for (const id of BASE) assert.ok(ids.includes(id), id);
  assert.ok(ids.some((i) => i.startsWith('kindCount')), '要点の種類ごとの数');
  assert.deepEqual(g.axes, { x: 'pointCount', y: 'emotion', z: 'time' });
  for (const c of g.candidates) assert.ok(c.label?.trim(), `${c.id} のラベル`);
});

test('FR-020 AC-103 異常系: 値が得られない候補（整理の割り当てなし）は選べず理由が示され、同じ軸を 2 方向には選べない', async () => {
  const { app } = await threeD();
  for (const id of ['arrangeV', 'arrangeH']) {
    assert.equal(cand(app, id).available, false, `${id}: 割り当てなしでは選べない`);
    assert.ok(cand(app, id).reason?.trim());
    const before = JSON.stringify(app.getAxes3D().axes);
    const r = app.setAxis3D('x', id);
    assert.equal(r.ok, false);
    assert.equal(JSON.stringify(app.getAxes3D().axes), before);
  }
  const r = app.setAxis3D('x', 'time'); // z が time
  assert.equal(r.ok, false, '同じ軸を 2 方向に選べない');
  assert.deepEqual(app.getAxes3D().axes, { x: 'pointCount', y: 'emotion', z: 'time' });
});

test('FR-020 AC-103: 整理の割り当てがあると整理の区分の軸が選べる', async () => {
  const { app } = await threeD();
  const st = app.getState();
  app.setDisplayMode('arrange');
  const arr = app.getArrangement();
  app.assignObject(st.scenes[0].id, { v: arr.axes.vertical.sections[0].id, h: arr.axes.horizontal.sections[0].id });
  app.assignObject(st.scenes[1].id, { v: arr.axes.vertical.sections[1].id, h: arr.axes.horizontal.sections[1].id });
  assert.equal(cand(app, 'arrangeV').available, true);
  assert.equal(app.setAxis3D('x', 'arrangeV').ok, true);
  assert.equal(app.getAxes3D().axes.x, 'arrangeV');
});

// FR-020 AC-104
test('FR-020 AC-104: 軸の値に従って配置され、軸を変更すると配置が更新され、選択中のシーンは保たれる', async () => {
  const { app } = await threeD();
  const sc = app.getState().scenes; // 1 つ目は要点 2 件、残りは 1 件
  app.selectScene(sc[1].id);
  let p = pos(app);
  assert.ok(sc[0].points.length > sc[1].points.length);
  assert.ok(p.get(sc[0].id).x > p.get(sc[1].id).x, '横=要点の数: 多いほど大きい');
  assert.equal(p.get(sc[1].id).x, p.get(sc[2].id).x, '値が同じなら同じ横位置');
  assert.ok(p.get(sc[0].id).z < p.get(sc[1].id).z && p.get(sc[1].id).z < p.get(sc[2].id).z, '奥行き=時間: 発生順');
  // 横=時間に変更（奥行きを発話量へ）
  assert.equal(app.setAxis3D('z', 'utterances').ok, true);
  assert.equal(app.setAxis3D('x', 'time').ok, true);
  p = pos(app);
  assert.ok(p.get(sc[0].id).x < p.get(sc[1].id).x && p.get(sc[1].id).x < p.get(sc[2].id).x, '横=時間に更新');
  assert.equal(app.getState().selectedSceneId, sc[1].id);
  assert.equal(app.get3D().selectedSceneId, sc[1].id);
});

test('FR-020 AC-104 異常系: 値が同じシーンどうしでも位置が重ならず識別できる', async () => {
  const { app } = await threeD();
  const sc = app.getState().scenes;
  assert.equal(app.setAxis3D('y', 'utterances').ok, true);
  assert.equal(app.setAxis3D('x', 'pointCount').ok, true);
  const cands = app.getAxes3D().candidates.filter((c) => c.available && !['pointCount', 'utterances', 'time'].includes(c.id));
  assert.equal(app.setAxis3D('z', cands[0]?.id ?? 'time').ok, true);
  const p = [...pos(app).values()].map((q) => `${q.x},${q.y},${q.z}`);
  assert.equal(new Set(p).size, sc.length, '3 シーンの位置が互いに異なる');
});

// FR-020 AC-106
test('FR-020 AC-106: 記録中でも軸を変更でき、記録中・受付・選択が保たれ、発話の追加後も軸が保たれ配置が更新される', async () => {
  const { app, env } = await threeD();
  const sel = app.getState().scenes[0].id;
  app.selectScene(sel);
  assert.equal(app.getState().session, 'recording');
  assert.equal(app.setAxis3D('x', 'utterances').ok, true);
  assert.equal(app.getState().session, 'recording');
  assert.equal(app.getState().selectedSceneId, sel);
  const before = JSON.stringify(app.get3D().nodes);
  const n = app.getState().utterances.length;
  app.commands['session.nextScene']();
  env.tick(1);
  app.setDraft('新しいシーンの発話'); assert.equal(app.submitDraft().ok, true);
  assert.equal(app.getState().utterances.length, n + 1);
  assert.equal(app.getAxes3D().axes.x, 'utterances');
  assert.notEqual(JSON.stringify(app.get3D().nodes), before, '配置が更新される');
  assert.equal(app.get3D().nodes.length, app.getState().scenes.length);
});

test('FR-020 AC-106: 軸の選択は再読込（FR-012）では復元されず既定に戻り、セッションファイルの読込（FR-019）で復元される', async () => {
  const { app, env, createApp } = await threeD();
  assert.equal(app.setAxis3D('x', 'utterances').ok, true);
  const again = await createApp(env.options);
  assert.deepEqual(again.getAxes3D().axes, { x: 'pointCount', y: 'emotion', z: 'time' }, '再読込では既定');
  await app.commands['file.save']();
  const d = env.downloads.at(-1);
  app.commands['data.reset'](); app.dialogAction('confirm');
  assert.deepEqual(app.getAxes3D().axes, { x: 'pointCount', y: 'emotion', z: 'time' });
  await app.loadSessionFile({ name: d.filename, type: d.mime, size: String(d.data).length, text: String(d.data) });
  assert.equal(app.getAxes3D().axes.x, 'utterances');
});

test('FR-020 AC-106 異常系: 保存がない場合の起動時は既定の軸の組', async () => {
  const { app } = await newApp();
  assert.deepEqual(app.getAxes3D().axes, { x: 'pointCount', y: 'emotion', z: 'time' });
});
