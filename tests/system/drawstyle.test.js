// FR-029 AC-146（System Test。契約: tests/system/CONTRACT.md「レイアウト型・描画スタイル・設定画面」）
// 期待値は受入基準だけから決める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from './helpers.js';

const STYLES = ['anime', 'handwritten', 'simple'];
const svgTexts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).sort();
const snap = (app) => { const s = app.getState(); return JSON.stringify([s.utterances.map((u) => u.text), s.scenes, s.selectedSceneId, s.session, s.input.draft, app.getDetailLevel(), s.viewMode, app.getDisplayMode()]); };

// FR-029 AC-146
test('FR-029 AC-146: 描画スタイルとしてアニメ調・手書き調・シンプルの 3 つが選べ、初期は手書き調', async () => {
  const { app } = await newApp();
  assert.deepEqual(app.getDrawStyles().map((s) => s.id).sort(), [...STYLES].sort());
  assert.ok(app.getDrawStyles().every((s) => s.label.trim()));
  assert.equal(new Set(app.getDrawStyles().map((s) => s.label)).size, 3);
  assert.equal(app.getDrawStyle(), 'handwritten');
});

test('FR-029 AC-146: 切り替えると図の見た目だけが変わり、文字・配置・内容・選択中のオブジェクト・記録中の状態・テキスト一覧は保たれる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  toDetail(app);
  app.selectScene(app.getState().scenes[1].id);
  app.setDraft('入力中の文字');
  const base = { svg: app.renderSvg(), layout: JSON.stringify(app.getDiagramLayout()), out: app.renderOutline(), snap: snap(app) };
  const seen = new Set([base.svg]);
  for (const id of ['anime', 'simple', 'handwritten']) {
    assert.ok(app.setDrawStyle(id).ok, id);
    assert.equal(app.getDrawStyle(), id);
    const svg = app.renderSvg();
    assert.match(svg, new RegExp(`data-draw-style="${id}"`));
    assert.deepEqual(svgTexts(svg), svgTexts(base.svg), `${id}: 文字は変わらない`);
    assert.equal(JSON.stringify(app.getDiagramLayout()), base.layout, `${id}: 配置は変わらない`);
    assert.equal(app.renderOutline(), base.out, `${id}: テキスト一覧は変わらない`);
    assert.equal(snap(app), base.snap, `${id}: 内容・選択・記録中の状態は保たれる`);
    seen.add(svg);
  }
  assert.equal(seen.size, 3, '3 つのスタイルで図の見た目（SVG）が異なる');
  assert.equal(app.renderSvg(), base.svg, '手書き調に戻すと元の図');
});

test('FR-029 AC-146: どのスタイルでも文字が判読でき、白黒でも要点の種類を見分けられる（色だけに頼らない）', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  toDetail(app);
  for (const id of STYLES) {
    app.setDrawStyle(id);
    const svg = app.renderSvg();
    for (const s of app.getState().scenes) { assert.ok(svg.includes(s.heading), `${id}: 見出し`); for (const p of s.points) assert.ok(svg.includes(p.text), `${id}: 要点「${p.text}」`); }
    const pts = app.getDiagramStyle().scenes.flatMap((s) => s.points);
    const kinds = new Map();
    for (const p of pts) if (!kinds.has(p.kind)) kinds.set(p.kind, p);
    assert.ok(kinds.size >= 2, '種類が 2 つ以上');
    const list = [...kinds.values()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      assert.notEqual(list[i].color, list[j].color, `${id}: 色が異なる`);
      assert.ok(list[i].shape !== list[j].shape || list[i].icon !== list[j].icon, `${id}: 色以外（形・絵記号）でも異なる`);
    }
    for (const p of pts) assert.ok(p.fontSize > 0, `${id}: 文字の大きさ`);
  }
});

test('FR-029 AC-146 異常系: 未知・不正なスタイルは選べず、現在のスタイル・図は変わらない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.setDrawStyle('simple');
  const before = app.renderSvg();
  for (const bad of ['', 'nosuch', null, undefined, 3, ['anime']]) {
    let r; try { r = app.setDrawStyle(bad); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, String(bad));
  }
  assert.equal(app.getDrawStyle(), 'simple');
  assert.equal(app.renderSvg(), before);
});

test('FR-029 AC-146: 整理の表示・3D 表示でもスタイルの切替で内容が失われず、3D は影響を受けない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const d3 = JSON.stringify(app.get3D());
  const s0 = snap(app);
  app.setDisplayMode('arrange');
  app.setDrawStyle('anime');
  assert.equal(JSON.stringify(app.get3D()), d3);
  app.setDisplayMode('timeline');
  assert.equal(snap(app), s0);
});
