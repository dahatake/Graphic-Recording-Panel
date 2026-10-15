// FR-016 AC-082 AC-089 の結合テスト、ほか AC-078〜081 の単体テスト（意味のある配置による 2D 整理）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, FakeSpeech, pdfTexts } from '../system/helpers.js';
import { parseArrange, presetArrange } from '../../web/src/arrange.js';
import { renderOutline } from '../../web/src/outline.js';

const ids = (app) => app.getState().scenes.flatMap((s) => [s.id, ...s.points.map((p) => p.id)]);

// FR-016 AC-082: 表示を切り替えても内容・割り当て・選択が保たれ、テキスト一覧は常に時系列で、文字で割り当てを示す
test('FR-016 AC-082: 時系列と整理を切り替えても内容・割り当て・選択が保たれ、一覧の順序は変わらず文字で示される', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  assert.equal(app.getDisplayMode(), 'timeline');
  const before = app.getState();
  const p = before.scenes[0].points[0];
  const a = app.getArrangement();
  app.assignObject(p.id, { v: a.axes.vertical.sections[3].id, h: a.axes.horizontal.sections[2].id });
  app.selectScene(before.scenes[1].id);
  const listBefore = app.renderOutline();
  const order = (html) => [...html.matchAll(/data-(?:scene|point)-id="([^"]+)"/g)].map((m) => m[1]);
  app.setDisplayMode('arrange');
  assert.equal(app.getState().selectedSceneId, before.scenes[1].id);
  assert.deepEqual(ids(app), ids({ getState: () => before }));
  const html = app.renderOutline();
  assert.deepEqual(order(html), order(listBefore), '一覧の順序は時系列のまま');
  assert.ok(html.includes(a.axes.vertical.sections[3].label) && html.includes(a.axes.horizontal.sections[2].label), '割り当てが文字で出る');
  assert.ok(html.includes(a.unclassified.label), '未分類も文字で出る');
  app.setDisplayMode('timeline');
  assert.deepEqual(order(app.renderOutline()), order(listBefore));
  assert.ok(!app.renderOutline().includes(a.axes.vertical.sections[3].label));
  assert.equal(app.getArrangement().assignments.find((x) => x.objectId === p.id).v, a.axes.vertical.sections[3].id);
  assert.equal(app.setDisplayMode('bogus'), false);
});

// FR-016 AC-082: セッションの保存で割り当てと選んでいる表示が復元される
test('FR-016 AC-082: 割り当て・軸の編集・表示の選択がセッションの保存で復元され、保存がなければ時系列で起動する', async () => {
  const { app, env, createApp } = await newApp();
  assert.equal((await createApp({ ...env.options, speechSource: new FakeSpeech() })).getDisplayMode(), 'timeline');
  await seedThreeScenes(app, env);
  app.setAxis('horizontal', { name: '工程', sections: ['設計', '製造', '検査'] });
  const p = app.getState().scenes[0].points[0];
  const a = app.getArrangement();
  app.assignObject(p.id, { v: a.axes.vertical.sections[1].id, h: a.axes.horizontal.sections[2].id });
  app.setDisplayMode('arrange');
  const app2 = await createApp({ ...env.options, speechSource: new FakeSpeech() });
  assert.equal(app2.getDisplayMode(), 'arrange');
  const b = app2.getArrangement();
  assert.equal(b.axes.horizontal.name, '工程');
  assert.deepEqual(b.axes.horizontal.sections.map((s) => s.label), ['設計', '製造', '検査']);
  const as = b.assignments.find((x) => x.objectId === p.id);
  assert.equal(as.v, a.axes.vertical.sections[1].id); assert.equal(as.h, a.axes.horizontal.sections[2].id);
});

test('FR-016 AC-082 異常系: 壊れた保存内容は既定の軸に戻り、存在しない区分への割り当ては捨てられる', () => {
  assert.deepEqual(parseArrange({ axes: 1 }), presetArrange());
  assert.deepEqual(parseArrange(null), presetArrange());
  const r = parseArrange({ ...presetArrange(), assignments: { x: { v: 'zzz', h: 'h1' }, y: { v: 'nope', h: 'nope' } } });
  assert.deepEqual(r.assignments, { x: { v: null, h: 'h1' } });
});

// FR-016 AC-082: 一覧は注釈なしなら従来どおり
test('FR-016 AC-082: 注釈のない一覧は従来と同じ（時系列の表示）', () => {
  const sc = [{ id: 's1', heading: '見出し', status: 'confirmed', points: [{ id: 'p1', text: '要点' }], relations: [] }];
  const html = renderOutline(sc, 's1', (k) => k);
  assert.ok(!html.includes('outline-arrange'));
  assert.ok(renderOutline(sc, 's1', (k) => k, { header: 'H', of: () => 'R' }).includes('[R]'));
});

// FR-016 AC-089: 保存（SVG・PNG・PDF）は画面で選んでいる表示と同じ配置で出力される
test('FR-016 AC-089: 整理の表示で保存すると軸・区分・未分類を含む配置で、時系列の表示では時系列の配置で出力される', async () => {
  const { app, env } = await newApp();
  app.setDetailLevel('detail'); // FR-026: 要点を図で確かめるため「詳細」にする
  await seedThreeScenes(app, env);
  const a = app.getArrangement();
  const labels = [a.axes.vertical.name, a.axes.horizontal.name, a.unclassified.label, ...a.axes.vertical.sections.map((s) => s.label), ...a.axes.horizontal.sections.map((s) => s.label)];
  const svgOf = async (cmd, mime) => { env.downloads.length = 0; await app.commands[cmd](); const d = env.downloads.at(-1); assert.equal(d.mime, mime); return d; };

  const tl = await svgOf('save.svg', 'image/svg+xml');
  const tlText = Buffer.from(tl.data).toString('utf8');
  assert.ok(!tlText.includes('data-display-mode="arrange"'));
  assert.ok(!tlText.includes(a.axes.vertical.name));

  app.setDisplayMode('arrange');
  const ar = await svgOf('save.svg', 'image/svg+xml');
  const arText = Buffer.from(ar.data).toString('utf8');
  assert.equal(arText, app.renderSvg(), '保存内容は画面と同じ描画');
  for (const l of labels) assert.ok(arText.includes(l), `SVG に「${l}」`);

  env.canvasFactory.log.texts.length = 0;
  await svgOf('save.png', 'image/png');
  const drawn = env.canvasFactory.log.texts.join('\n');
  for (const l of labels) assert.ok(drawn.includes(l), `PNG に「${l}」`);

  const pdf = await svgOf('save.pdf', 'application/pdf');
  const pdfText = [].concat(pdfTexts(pdf.data)).join('\n');
  for (const l of labels) assert.ok(pdfText.includes(l), `PDF に「${l}」`);

  app.setDisplayMode('timeline');
  assert.ok(!Buffer.from((await svgOf('save.svg', 'image/svg+xml')).data).toString('utf8').includes(a.axes.vertical.name));
});

// FR-016 AC-080: 新しい発話の取込（自動処理）の後も割り当てが保たれ、軸の編集で消えた区分は未分類に戻る
test('FR-016 AC-080: 区分を削る軸の編集では、消えた区分の割り当てだけが未分類になる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const [p, q] = [app.getState().scenes[0].points[0], app.getState().scenes[1].points[0]];
  const a = app.getArrangement();
  app.assignObject(p.id, { v: a.axes.vertical.sections[3].id, h: a.axes.horizontal.sections[0].id });
  app.assignObject(q.id, { v: a.axes.vertical.sections[0].id, h: a.axes.horizontal.sections[0].id });
  app.setAxis('vertical', { name: '層', sections: ['上', '下'] });
  const b = app.getArrangement();
  const get = (id) => b.assignments.find((x) => x.objectId === id);
  assert.equal(get(p.id).v, null);
  assert.equal(get(p.id).h, a.axes.horizontal.sections[0].id);
  assert.equal(get(q.id).v, a.axes.vertical.sections[0].id);
});
