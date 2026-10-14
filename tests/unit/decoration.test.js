// FR-015 図の演出の単体・結合テスト（AC-074〜077）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDiagramSvg, classifyPoint, KINDS } from '../../web/src/diagram.js';

const scenes = [{
  id: 's1', heading: '予算の相談', status: 'confirmed',
  points: [{ id: 'p1', text: 'コストが高くて困った' }, { id: 'p2', text: '来月のリリース計画を決める' }, { id: 'p3', text: '新しいアイデアを出す' }],
  relations: [{ from: 'p1', to: 'p2' }, { from: 'p2', to: 'p3' }],
}];
const t = (k) => k;

// FR-015 AC-074
test('FR-015 AC-074: 種類の判定は決定的で、4 種類は色・形・絵記号がすべて異なる', () => {
  assert.equal(classifyPoint('コストが高くて困った'), 'issue');
  assert.equal(classifyPoint('来月のリリース計画を決める'), 'conclusion');
  assert.equal(classifyPoint('新しいアイデアを出す'), 'idea');
  assert.equal(classifyPoint('予算の見直し'), 'note');
  const v = Object.values(KINDS);
  for (const k of ['color', 'shape', 'icon']) assert.equal(new Set(v.map((x) => x[k])).size, v.length);
});

// FR-015 AC-075
test('FR-015 AC-075: 手描き風の線は同じ入力から毎回同じ図形になり、文字は図形の後ろに置かれて隠れない', () => {
  const a = renderDiagramSvg(scenes, { t });
  assert.equal(a, renderDiagramSvg(scenes, { t }));
  assert.match(a, /data-role="scene-frame"/);
  assert.match(a, /data-relation=/);
  const i = a.indexOf('data-point-id="p1"');
  assert.ok(a.indexOf('<path', i) < a.indexOf('<text', i), '枠線の後に文字');
  const b = renderDiagramSvg([{ ...scenes[0], points: [{ id: 'p1', text: 'コストが高くて困った' }, ...scenes[0].points.slice(1)] }], { t });
  assert.equal(a, b);
  const c = renderDiagramSvg([{ ...scenes[0], points: scenes[0].points.map((p) => ({ ...p, id: p.id + 'x' })), relations: [] }], { t });
  assert.notEqual(c.match(/data-point-id="p1x"[^]*?<path d="([^"]+)"/)[1], a.match(/data-point-id="p1"[^]*?<path d="([^"]+)"/)[1], 'id が違えば揺らぎも変わる');
});

// FR-015 AC-077
test('FR-015 AC-077: 演出（強調を含む）を加えても SVG に見出しと要点の文字列がテキストとして残り、外部参照を持たない', () => {
  for (const opts of [{ t }, { t, highlightPointId: 'p2' }]) {
    const svg = renderDiagramSvg(scenes, opts);
    for (const s of ['予算の相談', 'コストが高くて困った', '来月のリリース計画を決める', '新しいアイデアを出す']) assert.ok(new RegExp(`<text[^>]*>[^<]*${s}`).test(svg), s);
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(svg) && !/<image|href=/.test(svg));
  }
  assert.match(renderDiagramSvg(scenes, { t, highlightPointId: 'p2' }), /data-highlight="1"/);
});
