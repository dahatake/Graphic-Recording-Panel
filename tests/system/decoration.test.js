// FR-015 AC-074 AC-076（契約: getDiagramStyle / highlightPoint / clearHighlight / getHighlight、CONTRACT.md「図の演出」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, keyFor } from './helpers.js';

async function seed() {
  const { app, env } = await newApp();
  app.commands['session.start']();
  for (const t of ['コストが高くて困った', '来月のリリース計画を決める', '予算の見直しが必要です']) {
    app.setDraft(t); app.submitDraft(); env.tick(1);
  }
  return { app, env };
}

// FR-015 AC-074
test('FR-015 AC-074: 見出しは要点より目立ち、種類が異なる要点は色に加え形か絵記号が異なる（白黒でも見分けられる）', async () => {
  const { app } = await seed();
  const st = app.getDiagramStyle();
  assert.ok(st.scenes.length >= 1);
  const all = [];
  for (const s of st.scenes) {
    assert.ok(s.points.length >= 1);
    const maxPt = Math.max(...s.points.map((p) => p.fontSize));
    const bigger = s.heading.fontSize > maxPt && s.heading.fontWeight > Math.max(...s.points.map((p) => p.fontWeight));
    assert.ok(bigger || s.heading.framed === true, '見出しは大きく太い、または囲み・色帯');
    all.push(...s.points);
  }
  const kinds = new Set(all.map((p) => p.kind));
  assert.ok(kinds.size >= 2, '入力に応じて 2 種類以上の種類に分かれる');
  for (const a of all) for (const b of all) {
    if (a.kind === b.kind) continue;
    assert.notEqual(a.color, b.color, '種類が異なれば色が異なる');
    assert.ok(a.shape !== b.shape || a.icon !== b.icon, '色を取り除いても形か絵記号で見分けられる');
  }
});

test('FR-015 AC-074 異常系: 同じ種類の要点は同じ表現で、要点 0 件（記録前）でも例外にならない', async () => {
  const { app } = await newApp();
  assert.deepEqual(app.getDiagramStyle().scenes, []);
  const s = await seed();
  const pts = s.app.getDiagramStyle().scenes.flatMap((x) => x.points);
  for (const a of pts) for (const b of pts) if (a.kind === b.kind) { assert.equal(a.color, b.color); assert.equal(a.shape, b.shape); assert.equal(a.icon, b.icon); }
});

// FR-015 AC-076
test('FR-015 AC-076: ポインタで要点を選ぶと、その要点とつながる関係線が強調され、色以外（太さ・枠・絵記号）でも示され、解除で戻り、文字は判読できる', async () => {
  const { app } = await seed();
  const sc = app.getState().scenes.find((s) => s.points.length >= 2);
  assert.ok(sc, '要点 2 件以上のシーン');
  const target = sc.points[0];
  const svg0 = app.renderSvg();
  app.highlightPoint(target.id, 'pointer');
  const h = app.getHighlight();
  assert.equal(h.pointId, target.id);
  const expected = sc.relations.filter((r) => r.from === target.id || r.to === target.id);
  assert.ok(expected.length >= 1);
  for (const r of expected) assert.ok(h.relations.some((x) => x.from === r.from && x.to === r.to), 'つながる関係線が強調される');
  assert.ok(h.point.strokeWidth > h.others.strokeWidth, '太さで示される');
  assert.ok(h.point.framed === true && h.others.framed !== true, '枠でも示される');
  assert.ok(h.point.icon, '絵記号でも示される');
  assert.notEqual(h.point.color, h.others.color);
  assert.equal(h.textLegible, true);
  const svg = app.renderSvg();
  for (const p of sc.points) assert.ok(svg.includes(p.text), '強調中も文字が <text> に残る');
  app.clearHighlight();
  assert.equal(app.getHighlight(), null);
  assert.equal(app.renderSvg(), svg0, '解除で元に戻る');
});

test('FR-015 AC-076: キーボードでも要点を選んで強調し、解除できる', async () => {
  const { app } = await seed();
  for (const c of ['highlight.next', 'highlight.prev', 'highlight.clear']) assert.ok(keyFor(app, c), `${c} のキー割り当て`);
  app.handleKey(keyFor(app, 'highlight.next'));
  const h = app.getHighlight();
  assert.ok(h && h.pointId);
  assert.ok(app.getState().scenes.flatMap((s) => s.points).some((p) => p.id === h.pointId));
  app.handleKey(keyFor(app, 'highlight.clear'));
  assert.equal(app.getHighlight(), null);
});

test('FR-015 AC-076 異常系: 存在しない要点の強調は何も変えない', async () => {
  const { app } = await seed();
  const before = app.renderSvg();
  try { app.highlightPoint('nope', 'pointer'); } catch { /* 例外でも可 */ }
  assert.equal(app.getHighlight(), null);
  assert.equal(app.renderSvg(), before);
});
