// FR-006 FR-007 FR-026 AC-089（Q-029）/ AC-013 AC-014 AC-015 AC-047 AC-077 AC-419:
// 図の保存（PNG・SVG・PDF）の内容が、画面で選んでいる詳細度に従うことの単体・結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail, pdfTexts, makeCanvasFactory } from '../system/helpers.js';
import { scenesForDetail } from '../../web/src/export.js';

const SCENES = [
  { id: 's1', heading: '見出しA', points: [{ id: 'p1', text: '要点A1' }], relations: [] },
  { id: 's2', heading: '見出しB', points: [{ id: 'p2', text: '要点B1' }], relations: [] },
];
const TOPICS = [{ id: 't1', title: '話題1', sceneIds: ['s1', 's2'] }];

test('AC-089: scenesForDetail は大項目でトピック、中項目でシーンの見出しまで、詳細で要点までを返す', () => {
  assert.deepEqual(scenesForDetail(SCENES, 'major', TOPICS).map((s) => [s.heading, s.points.length]), [['話題1', 0]]);
  const mid = scenesForDetail(SCENES, 'middle', TOPICS);
  assert.deepEqual(mid[0].points.map((p) => p.text), ['見出しA', '見出しB']);
  assert.equal(scenesForDetail(SCENES, 'detail', TOPICS), SCENES);
  assert.equal(scenesForDetail(SCENES, 'major', []), SCENES); // トピックがなければそのまま
});

async function saveAll(level) {
  const factory = makeCanvasFactory();
  const { app, env } = await newApp({ canvasFactory: factory });
  const texts = await seedThreeScenes(app, env);
  toDetail(app, level);
  await app.commands['save.png']();
  await app.commands['save.svg']();
  await app.commands['save.pdf']();
  const [png, svg, pdf] = env.downloads;
  const st = app.getState();
  return { app, texts, st, png, pngTexts: factory.log.texts.join('\n'), svg: String(svg.data), pdf: pdfTexts(pdf.data), topics: app.getTopics() };
}

test('AC-089 AC-013 AC-015 AC-014: 詳細では PNG・SVG・PDF に全シーンの見出しと要点が含まれる', async () => {
  const r = await saveAll('detail');
  for (const s of r.st.scenes) {
    for (const out of [r.pngTexts, r.svg, r.pdf]) assert.ok(out.includes(s.heading), s.heading);
  }
  for (const t of r.texts) for (const out of [r.pngTexts, r.svg, r.pdf]) assert.ok(out.includes(t), t);
});

test('AC-089 AC-013 AC-015 AC-014: 中項目ではトピックとシーンの見出しまでで、要点は含まれない', async () => {
  const r = await saveAll('middle');
  for (const tp of r.topics) for (const out of [r.pngTexts, r.svg, r.pdf]) assert.ok(out.includes(tp.title), tp.title);
  for (const s of r.st.scenes) for (const out of [r.pngTexts, r.pdf]) assert.ok(out.includes(s.heading), s.heading);
  const pointOnly = r.st.scenes.flatMap((s) => s.points.map((p) => p.text)).filter((t) => !r.st.scenes.some((s) => s.heading.includes(t)) && !r.topics.some((tp) => tp.title.includes(t)));
  assert.ok(pointOnly.length > 0);
  for (const t of pointOnly) for (const out of [r.pngTexts, r.svg, r.pdf]) assert.ok(!out.includes(t), `要点が出ている: ${t}`);
});

test('AC-089 AC-013 AC-015 AC-014: 大項目ではトピックだけで、シーンの見出しと要点は含まれない', async () => {
  const r = await saveAll('major');
  for (const tp of r.topics) for (const out of [r.pngTexts, r.svg, r.pdf]) assert.ok(out.includes(tp.title), tp.title);
  const titles = r.topics.map((tp) => tp.title).join('\n');
  const hidden = r.st.scenes.flatMap((s) => [s.heading, ...s.points.map((p) => p.text)]).filter((t) => !titles.includes(t));
  assert.ok(hidden.length > 0);
  for (const t of hidden) for (const out of [r.pngTexts, r.pdf]) assert.ok(!out.includes(t), `大項目で出ている: ${t}`);
});

test('AC-047: 3D 表示中は PNG・SVG・PDF の 3 形式とも 2D の図（詳細では全シーンの見出しと要点）が得られ、その旨が表示される', async () => {
  const factory = makeCanvasFactory();
  const { app, env } = await newApp({ canvasFactory: factory });
  const texts = await seedThreeScenes(app, env);
  toDetail(app, 'detail');
  app.setViewMode('3d');
  const keys = [];
  for (const cmd of ['save.png', 'save.svg', 'save.pdf']) {
    const r = await app.commands[cmd]();
    assert.equal(r.ok, true, cmd);
    keys.push(app.getState().message.key);
  }
  assert.deepEqual(keys, ['msg.save3d', 'msg.save3d', 'msg.save3d']);
  const [png, svg, pdf] = env.downloads;
  assert.equal(png.mime, 'image/png'); assert.equal(svg.mime, 'image/svg+xml'); assert.equal(pdf.mime, 'application/pdf');
  assert.ok(String(svg.data).includes('<svg'));
  const outs = [factory.log.texts.join('\n'), String(svg.data), pdfTexts(pdf.data)];
  for (const s of app.getState().scenes) for (const out of outs) assert.ok(out.includes(s.heading), s.heading);
  for (const t of texts) for (const out of outs) assert.ok(out.includes(t), t);
  assert.equal(app.getState().viewMode, '3d'); // 保存しても表示は 3D のまま
});

test('AC-047: 3D 表示中の PNG・PDF も画面の詳細度に従った 2D の図で、その旨が表示される', async () => {
  const factory = makeCanvasFactory();
  const { app, env } = await newApp({ canvasFactory: factory });
  await seedThreeScenes(app, env);
  toDetail(app, 'major');
  app.setViewMode('3d');
  await app.commands['save.pdf']();
  assert.equal(app.getState().message.key, 'msg.save3d');
  await app.commands['save.png']();
  assert.equal(app.getState().message.key, 'msg.save3d');
  const pdf = pdfTexts(env.downloads[0].data);
  for (const tp of app.getTopics()) { assert.ok(pdf.includes(tp.title)); assert.ok(factory.log.texts.includes(tp.title)); }
  const pts = app.getState().scenes.flatMap((s) => s.points.map((p) => p.text)).filter((t) => !app.getTopics().some((tp) => tp.title.includes(t)));
  for (const t of pts) assert.ok(!pdf.includes(t));
});

test('AC-419 AC-077: 描画スタイルを反映した保存でも詳細度に従い、外部へのリクエストは 0 件', async () => {
  const factory = makeCanvasFactory();
  const { app, env } = await newApp({ canvasFactory: factory });
  await seedThreeScenes(app, env);
  toDetail(app, 'middle');
  app.setDrawStyle('anime');
  const realFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('外部通信をしない'); };
  try {
    await app.commands['save.png']();
    await app.commands['save.pdf']();
  } finally { globalThis.fetch = realFetch; }
  const pdf = pdfTexts(env.downloads[1].data);
  for (const s of app.getState().scenes) { assert.ok(pdf.includes(s.heading)); assert.ok(factory.log.texts.includes(s.heading)); }
  const pts = app.getState().scenes.flatMap((s) => s.points.map((p) => p.text)).filter((t) => !app.getState().scenes.some((s) => s.heading.includes(t)) && !app.getTopics().some((tp) => tp.title.includes(t)));
  for (const t of pts) assert.ok(!pdf.includes(t) && !factory.log.texts.includes(t));
  assert.equal(calls, 0);
});
