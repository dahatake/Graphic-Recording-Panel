// FR-016 AC-078 AC-079 AC-080 AC-081（契約: setDisplayMode / getArrangement / assignObject / describeObject / arrangeCommand、CONTRACT.md「意味のある配置」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, keyFor, toDetail } from './helpers.js';

// 手順: 詳細度の既定は「大項目」。要点の割り当て・移動（AC-079〜081）は「詳細」で行うため、arranged() で toDetail(app) により「詳細」へ切り替えてから整理の表示にする。
// 軸・区分の見出しは詳細度によらず表示される（AC-078）。大項目・中項目での配置は detail.test.js（AC-137）。

const PRESET = 'logical-physical_workflow';

async function arranged() {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  toDetail(app);
  app.setDisplayMode('arrange');
  return { app, env };
}
const firstPoint = (app) => app.getState().scenes[0].points[0];

// FR-016 AC-078
test('FR-016 AC-078: 整理の表示で縦軸・横軸の名前と各区分の見出しが図に出て、既定の組を選べ、軸の名前と区分を編集できる', async () => {
  const { app } = await arranged();
  app.setArrangePreset(PRESET);
  let a = app.getArrangement();
  assert.equal(a.mode, 'arrange');
  assert.ok(a.presets.some((p) => p.id === PRESET));
  for (const ax of [a.axes.vertical, a.axes.horizontal]) {
    assert.ok(ax.name.trim()); assert.ok(ax.sections.length >= 2);
  }
  assert.ok(a.axes.vertical.name.includes('論理') && a.axes.vertical.name.includes('物理'));
  const svg = app.renderSvg();
  for (const ax of [a.axes.vertical, a.axes.horizontal]) {
    assert.ok(svg.includes(ax.name), '軸の名前が図にある');
    for (const s of ax.sections) assert.ok(svg.includes(s.label), `区分「${s.label}」が図にある`);
  }
  assert.ok(app.setAxis('vertical', { name: '重要度', sections: ['高', '中', '低'] }).ok);
  a = app.getArrangement();
  assert.equal(a.axes.vertical.name, '重要度');
  assert.deepEqual(a.axes.vertical.sections.map((s) => s.label), ['高', '中', '低']);
  const svg2 = app.renderSvg();
  assert.ok(svg2.includes('重要度') && svg2.includes('低'));
});

test('FR-016 AC-078 異常系: 空の軸名・区分 0 件の編集は拒否され、軸は変わらない', async () => {
  const { app } = await arranged();
  const before = JSON.stringify(app.getArrangement().axes);
  let r1, r2;
  try { r1 = app.setAxis('vertical', { name: '', sections: ['a'] }); } catch { r1 = { ok: false }; }
  try { r2 = app.setAxis('horizontal', { name: 'x', sections: [] }); } catch { r2 = { ok: false }; }
  assert.equal(r1.ok, false); assert.equal(r2.ok, false);
  assert.equal(JSON.stringify(app.getArrangement().axes), before);
});

// FR-016 AC-079
test('FR-016 AC-079: 各オブジェクトは割り当てた区分の位置に出て、選ぶと割り当てが理由として表示され、未割り当ては「未分類」になる', async () => {
  const { app } = await arranged();
  const a0 = app.getArrangement();
  const p = firstPoint(app);
  const v = a0.axes.vertical.sections[1]; const h = a0.axes.horizontal.sections[0];
  assert.ok(app.assignObject(p.id, { v: v.id, h: h.id }).ok);
  const as = app.getArrangement().assignments.find((x) => x.objectId === p.id);
  assert.equal(as.v, v.id); assert.equal(as.h, h.id); assert.equal(as.unclassified, false);
  const d = app.describeObject(p.id);
  assert.equal(d.vertical, v.label); assert.equal(d.horizontal, h.label);
  assert.ok(d.text.includes(v.label) && d.text.includes(h.label));
  // 同じ縦区分の別オブジェクトを別の横区分に置くと、位置が異なる
  const q = app.getState().scenes[2].points[0];
  app.assignObject(q.id, { v: v.id, h: a0.axes.horizontal.sections[1].id });
  const pos = (id) => app.getArrangement().assignments.find((x) => x.objectId === id).position;
  assert.notDeepEqual(pos(p.id), pos(q.id));
  // 未割り当て
  const r = app.getState().scenes[1].points[0];
  app.assignObject(r.id, { v: null, h: null });
  const ar = app.getArrangement();
  assert.equal(ar.assignments.find((x) => x.objectId === r.id).unclassified, true);
  assert.ok(ar.unclassified.label.trim());
  assert.ok(app.describeObject(r.id).text.includes(ar.unclassified.label));
  assert.ok(app.renderSvg().includes(ar.unclassified.label));
});

test('FR-016 AC-079 異常系: 存在しない区分・オブジェクトへの割り当ては拒否され、既存の割り当てを変えない', async () => {
  const { app } = await arranged();
  const a0 = app.getArrangement();
  const p = firstPoint(app);
  app.assignObject(p.id, { v: a0.axes.vertical.sections[0].id, h: a0.axes.horizontal.sections[0].id });
  const before = JSON.stringify(app.getArrangement().assignments);
  let r1, r2;
  try { r1 = app.assignObject(p.id, { v: 'nope', h: 'nope' }); } catch { r1 = { ok: false }; }
  try { r2 = app.assignObject('nope', { v: null, h: null }); } catch { r2 = { ok: false }; }
  assert.equal(r1.ok, false); assert.equal(r2.ok, false);
  assert.equal(JSON.stringify(app.getArrangement().assignments), before);
});

// FR-016 AC-080
test('FR-016 AC-080: 記録中に別の区分へ移動しても、記録中の状態・発話の受付・ほかの割り当てが失われず、以後の自動処理で戻されない', async () => {
  const { app, env } = await arranged();
  const a0 = app.getArrangement();
  const [p, q] = [firstPoint(app), app.getState().scenes[1].points[0]];
  const [v0, v1] = a0.axes.vertical.sections; const h0 = a0.axes.horizontal.sections[0];
  app.assignObject(q.id, { v: v0.id, h: h0.id });
  app.assignObject(p.id, { v: v0.id, h: h0.id });
  const nUtt = app.getState().utterances.length;
  assert.ok(app.assignObject(p.id, { v: v1.id, h: h0.id }).ok);
  const find = (id) => app.getArrangement().assignments.find((x) => x.objectId === id);
  assert.equal(find(p.id).v, v1.id);
  assert.equal(find(q.id).v, v0.id, 'ほかのオブジェクトの割り当てが保たれる');
  assert.equal(app.getState().session, 'recording');
  app.setDraft('新しい発話です'); assert.ok(app.submitDraft().ok);
  env.scheduler.advance(3000);
  assert.equal(app.getState().utterances.length, nUtt + 1, '発話の受付が続く');
  assert.equal(find(p.id).v, v1.id, '自動処理で元の区分に戻されない');
  assert.equal(find(q.id).v, v0.id);
});

test('FR-016 AC-080 異常系: 一時停止中の移動でも割り当ては更新され、状態は変わらない', async () => {
  const { app } = await arranged();
  app.commands['session.pause']();
  const a0 = app.getArrangement(); const p = firstPoint(app);
  app.assignObject(p.id, { v: a0.axes.vertical.sections[1].id, h: null });
  assert.equal(app.getState().session, 'paused');
  assert.equal(app.getArrangement().assignments.find((x) => x.objectId === p.id).v, a0.axes.vertical.sections[1].id);
});

// FR-016 AC-081
test('FR-016 AC-081: ドラッグなしで、メニュー（arrangeCommand）とキーボードのコマンドで別の区分へ移動できる', async () => {
  const { app } = await arranged();
  const a0 = app.getArrangement(); const p = firstPoint(app);
  const [v0, v1] = a0.axes.vertical.sections; const [h0, h1] = a0.axes.horizontal.sections;
  app.assignObject(p.id, { v: v0.id, h: h0.id });
  const cur = () => app.getArrangement().assignments.find((x) => x.objectId === p.id);
  assert.ok(app.arrangeCommand(p.id, 'section-down').ok); assert.equal(cur().v, v1.id);
  assert.ok(app.arrangeCommand(p.id, 'section-up').ok); assert.equal(cur().v, v0.id);
  assert.ok(app.arrangeCommand(p.id, 'section-right').ok); assert.equal(cur().h, h1.id);
  assert.ok(app.arrangeCommand(p.id, 'section-left').ok); assert.equal(cur().h, h0.id);
  for (const c of ['arrange.up', 'arrange.down', 'arrange.left', 'arrange.right']) assert.ok(keyFor(app, c), `${c} のキー割り当て`);
  app.selectScene(app.getState().scenes[0].id);
  app.highlightPoint?.(p.id, 'keyboard');
  app.handleKey(keyFor(app, 'arrange.down'));
  assert.equal(cur().v, v1.id, 'キーボードのコマンドで移動');
});

test('FR-016 AC-081 異常系: 端の区分からさらに外へは移動せず、割り当てを変えない', async () => {
  const { app } = await arranged();
  const a0 = app.getArrangement(); const p = firstPoint(app);
  app.assignObject(p.id, { v: a0.axes.vertical.sections[0].id, h: a0.axes.horizontal.sections[0].id });
  const before = JSON.stringify(app.getArrangement().assignments);
  let r; try { r = app.arrangeCommand(p.id, 'section-up'); } catch { r = { ok: false }; }
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(app.getArrangement().assignments), before);
});
