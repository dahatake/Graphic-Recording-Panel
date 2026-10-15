// FR-005 AC-012 / FR-006 AC-013 AC-014 AC-046 / FR-007 AC-015 AC-016 の単体・結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, visibleTexts, pdfTexts } from '../system/helpers.js';
import { buildPdf, wrapLines } from '../../web/src/export.js';

test('FR-005 AC-012: 要点の編集・削除・追加が表示に反映され、以後の発話で上書きされない', async () => {
  const { app, env } = await newApp();
  app.setDetailLevel('detail'); // FR-026: 要点を図で確かめるため「詳細」にする
  app.commands['session.start']();
  app.setDraft('最初の要点です'); app.submitDraft();
  const sc = app.getState().scenes[0];
  const pid = sc.points[0].id;
  assert.equal(app.editPoint(pid, '直した要点').ok, true);
  assert.ok(app.renderSvg().includes('直した要点'));
  const add = app.addPoint(sc.id, '追加した要点');
  assert.ok(add.ok && app.renderOutline().includes('追加した要点'));
  env.tick(1); app.setDraft('次の発話'); app.submitDraft();
  const pts = app.getState().scenes[0].points.map((p) => p.text);
  assert.deepEqual(pts, ['直した要点', '追加した要点', '次の発話']);
  assert.equal(app.deletePoint(pid).ok, true);
  const after = app.getState().scenes[0];
  assert.ok(!after.points.some((p) => p.id === pid));
  assert.ok(after.relations.every((r) => r.from !== pid && r.to !== pid));
  assert.equal(app.editPoint(add.pointId, '  ').ok, false);
  assert.equal(app.getState().message.key, 'msg.editEmpty');
});

test('FR-005 AC-012: シーンの結合・分割が表示に反映される', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const [a, b] = app.getState().scenes;
  assert.equal(app.mergeScenes(a.id).ok, true);
  let st = app.getState();
  assert.equal(st.scenes.length, 2);
  assert.deepEqual(st.scenes[0].points.map((p) => p.text), [...a.points, ...b.points].map((p) => p.text));
  assert.ok(st.scenes[0].relations.length >= 2);
  const r = app.splitScene(st.scenes[0].id, st.scenes[0].points[2].id);
  assert.ok(r.ok);
  st = app.getState();
  assert.equal(st.scenes.length, 3);
  assert.equal(st.scenes[1].points[0].text, b.points[0].text);
  assert.equal(app.splitScene(st.scenes[0].id, st.scenes[0].points[0].id).ok, false);
  assert.equal(app.mergeScenes(st.scenes[2].id).ok, false);
});

test('FR-005 AC-012: 手修正は再読み込み（復元）後も残る', async () => {
  const { app, env, createApp } = await newApp();
  app.commands['session.start']();
  app.setDraft('元の文'); app.submitDraft();
  app.editPoint(app.getState().scenes[0].points[0].id, '手で直した');
  const again = await createApp(env.options);
  assert.equal(again.getState().scenes[0].points[0].text, '手で直した');
  assert.equal(again.getState().scenes[0].points[0].manual, true);
});

test('FR-006 AC-014: 3D 表示中に保存しても 2D の SVG が出力され、その旨が表示される', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.setViewMode('3d');
  await app.commands['save.svg']();
  assert.equal(env.downloads[0].data, app.renderSvg());
  assert.equal(app.getState().message.key, 'msg.save3d');
});

test('FR-006 AC-046 FR-007: シーン 0 件では保存が無効で理由が表示される', async () => {
  const { app, env } = await newApp();
  assert.equal(app.getSaveState().enabled, false);
  assert.ok(app.getSaveState().reason.length > 0);
  for (const c of ['save.png', 'save.svg', 'save.pdf']) await app.commands[c]();
  assert.equal(env.downloads.length, 0);
  assert.equal(app.getState().message.key, 'msg.saveNone');
});

test('FR-007 AC-015 AC-016: PDF は 1 ページ超でも構造が正しく、日本語・長文・BMP 外文字を ActualText に保つ', () => {
  const long = 'あ'.repeat(120);
  const scenes = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, heading: `見出し${i}`, points: [{ id: 'p', text: long }, { id: 'q', text: 'abc 😀' }], relations: [] }));
  const u8 = buildPdf(scenes);
  const s = Buffer.from(u8).toString('latin1');
  assert.ok((s.match(/\/Type \/Page\b/g) ?? []).length >= 2);
  assert.ok(!/https?:|\/URI/.test(s));
  const t = pdfTexts(u8);
  assert.ok(t.includes(long) && t.includes('abc 😀') && t.includes('見出し11'));
  assert.deepEqual(wrapLines('abcd', 10, 12), ['ab', 'cd'].map((x) => x));
});

test('FR-006 AC-013: 保存ファイル名は拡張子つき', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  await app.commands['save.png'](); await app.commands['save.svg'](); await app.commands['save.pdf']();
  assert.deepEqual(env.downloads.map((d) => d.filename.split('.').pop()), ['png', 'svg', 'pdf']);
  assert.ok(visibleTexts(app.getState()).length > 0);
});
