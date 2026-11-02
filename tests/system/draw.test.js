// FR-112 AC-639（手描きの主要な流れ。AC-635〜638 を通しで確かめる）。次の run で実装する（台帳は blocked）。
// （System Test。契約: tests/system/CONTRACT-P2.md）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from './helpers.js';

function drawLine(app, from, to) {
  app.drawPointer('down', from); app.drawPointer('move', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }); app.drawPointer('move', to); app.drawPointer('up', to);
}
const strokes = (app) => app.getStrokes().map((s) => ({ id: s.id, color: s.color, points: s.points }));

test('FR-112 AC-639: 2 色で 2 本描き、1 本を消しゴムで消して取り消しで戻し、再配置・保存・読込・SVG でも同じ位置のまま', async () => {
  const { app, env, createApp } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  const colors = app.getDrawColors();
  assert.ok(colors.length >= 2 && colors.every((c) => c.name.length > 0), '名前つきの色の一覧');
  app.commands['draw.toggle']();
  assert.equal(app.getDrawState().mode, true);
  assert.equal(app.setDrawColor(colors[0].id).ok, true);
  drawLine(app, { x: 100, y: 120 }, { x: 400, y: 160 });
  assert.equal(app.setDrawColor(colors[1].id).ok, true);
  assert.ok(app.getDrawState().colorName.length > 0, '選んだ色の名前が文字で示される');
  drawLine(app, { x: 150, y: 300 }, { x: 500, y: 340 });
  const two = strokes(app);
  assert.equal(two.length, 2);
  assert.notEqual(two[0].color, two[1].color);

  // 消しゴム（1 本ずつ）→ 取り消しで戻る
  assert.equal(app.eraseStroke(two[0].id).ok, true);
  assert.equal(app.getStrokes().length, 1);
  assert.equal(app.commands['draw.undo']().ok, true);
  assert.deepEqual(strokes(app), two, '取り消しで同じ線が同じ位置に戻る');

  // 自動の再配置（新しい発話）でも消えず、位置が変わらない
  app.commands['session.nextScene']();
  for (const t of ['新しい議題として人員計画を決める', '採用の時期を確認する']) { app.setDraft(t); app.submitDraft(); env.tick(1); }
  env.scheduler.advance(15000);
  assert.deepEqual(strokes(app), two, '再配置で線は消えず同じ位置');

  // 保存・再読込・ファイル読込で復元。保存した SVG に含まれる
  const svg = app.renderSvgForSave();
  for (const s of two) assert.ok(svg.includes(`data-stroke-id="${s.id}"`), '保存した SVG に線が含まれる');
  app.flushSave();
  const app2 = await createApp(env.options);
  assert.deepEqual(strokes(app2).map((s) => s.points), two.map((s) => s.points), '再読込で同じ位置に復元');
  assert.equal((await app.commands['file.save']()).ok, true);
  const dl = env.downloads.at(-1);
  assert.equal(app.commands['data.reset']().ok, true);
  assert.equal((await app.dialogAction('confirm')).ok, true);
  assert.equal(app.getStrokes().length, 0, 'データの初期化で消える');
  assert.equal((await app.loadSessionFile({ name: dl.filename, type: dl.mime, size: String(dl.data).length, text: String(dl.data) })).ok, true);
  assert.deepEqual(strokes(app).map((s) => s.points), two.map((s) => s.points), '読込で同じ位置に復元');
  assert.ok(app.renderSvgForSave().includes('data-stroke-id'), '読込後の SVG にも含まれる');
});
