// FR-053 AC-582 AC-583 AC-584 の単体・結合テスト（関係の種類 対立・根拠・次の段階、線のラベル、1 要素あたりの本数の上限）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRelations, labelRelations, phraseEvidence } from '../../web/src/layoutkinds.js';
import { limitRelations, REL_MAX_PER_ELEMENT, renderDiagramSvg } from '../../web/src/diagram.js';
import { renderOutline } from '../../web/src/outline.js';
import { buildMarkdown } from '../../web/src/presentexport.js';
import { createI18n } from '../../web/src/i18n.js';

const pts = (...texts) => texts.map((text, i) => ({ id: `p${i}`, text }));
const sum = (r) => r.map((x) => [x.kind, x.from, x.to, x.basis, !!x.bidirectional]);

// FR-053 AC-583
test('FR-053 AC-583: 根拠は根拠が始点・主張が終点、対立は双方向、次の段階は前→後。明示で根拠の語を持つ', () => {
  assert.deepEqual(sum(deriveRelations(pts('案Aを採る方針です。', 'たとえば先月の実績では黒字でした。'))), [['evidence', 'p1', 'p0', 'explicit', false]]);
  assert.deepEqual(sum(deriveRelations(pts('案Aは速い。', '一方、案Bは安い。'))), [['opposition', 'p0', 'p1', 'explicit', true]]);
  assert.deepEqual(sum(deriveRelations(pts('設計をします。', '次に実装をします。'))), [['next-step', 'p0', 'p1', 'explicit', false]]);
  assert.deepEqual(sum(deriveRelations(pts('Plan it.', 'Then build it.'))), [['next-step', 'p0', 'p1', 'explicit', false]]);
  assert.equal(deriveRelations(pts('案Aは速い。', '一方、案Bは安い。'))[0].evidence.text, '一方');
});
test('FR-053 AC-583: 英語の語は語境界あり・大文字小文字を区別しない。言い回しがなければ関係は作らない', () => {
  assert.equal(phraseEvidence('Nextcloud is fine', 'next-step'), null);
  assert.equal(phraseEvidence('NEXT we go', 'next-step'), 'next');
  assert.equal(phraseEvidence('A vs B', 'opposition'), 'vs');
  assert.deepEqual(deriveRelations(pts('案Aを採る。', '会議を続けます。')), []);
});
test('FR-053 AC-583 AC-233: 既存の原因→結果・課題→提案は変わらず、推測は推測のまま。決定的', () => {
  const seq = pts('コストが高くて困った', '予算を再配分するアイデアを出します。', 'コストが高くて困った', '中止にします。');
  assert.deepEqual(sum(deriveRelations(seq)), [['problem-proposal', 'p0', 'p1', 'explicit', false], ['problem-proposal', 'p2', 'p3', 'inferred', false]]);
  assert.deepEqual(deriveRelations(seq), deriveRelations(seq));
  assert.equal(deriveRelations(pts('準備', '雨が降っているから、中止にします。'))[0].kind, 'cause-effect');
});

// FR-053 AC-582
test('FR-053 AC-582: 種類の語のラベル（日英）が付く', () => {
  const r = deriveRelations(pts('A', '一方 B', 'なぜなら C', '次に D'));
  assert.deepEqual(labelRelations(r, 'ja').map((x) => x.kindLabel), ['対立', '根拠', '次の段階']);
  assert.deepEqual(labelRelations(r, 'en').map((x) => x.kindLabel), ['Opposition', 'Evidence', 'Next step']);
});

const scenesOf = (n) => [{ id: 's1', heading: 'S', status: 'done', points: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, text: `要点${i}` })), relations: [] }];
const t = (k) => (k === 'diagram.relMore' ? '他 {n} 件' : k);
const rel = (from, to, extra = {}) => ({ kind: 'next-step', from, to, basis: 'explicit', evidence: null, kindLabel: '次の段階', basisLabel: '明示', ...extra });

test('FR-053 AC-582: 図の線にラベル・線種があり、対立は両端が矢印', () => {
  const rels = [rel('p0', 'p1', { kind: 'opposition', kindLabel: '対立', bidirectional: true }), rel('p1', 'p2', { kind: 'evidence', kindLabel: '根拠' }), rel('p2', 'p3', { basis: 'inferred', basisLabel: '推測' })];
  const svg = renderDiagramSvg(scenesOf(4), { t, relations: rels });
  assert.match(svg, /data-relation-kind="opposition"[^>]*marker-start="url\(#arrow-flow\)"/);
  assert.match(svg, /data-relation-kind="evidence"[^>]*stroke-dasharray="2 4"/);
  assert.match(svg, /data-relation-label[^>]*>対立（明示）</);
  assert.match(svg, /data-relation-label[^>]*>次の段階（推測）</);
  assert.match(svg, /data-relation-kind="next-step"[^>]*data-relation-basis="inferred"[^>]*stroke-dasharray="5 4"/);
});

// FR-053 AC-584
test('FR-053 AC-584: 1 要素 4 本まで。明示を先、同じなら話順。残らない関係は hidden へ（省かれない）', () => {
  assert.equal(REL_MAX_PER_ELEMENT, 4);
  const rels = [rel('p0', 'p1', { basis: 'inferred' }), ...[2, 3, 4, 5, 6].map((i) => rel('p0', `p${i}`))];
  const r = limitRelations(rels);
  assert.deepEqual(r.drawn.map((x) => x.to), ['p2', 'p3', 'p4', 'p5']);
  assert.deepEqual(r.hidden.map((x) => x.to), ['p1', 'p6']);
  assert.equal(r.drawn.length + r.hidden.length, rels.length);
  assert.equal(r.moreCount.get('p0'), 2);
  assert.deepEqual(limitRelations(rels), r);
});
test('FR-053 AC-584: 図には上限までを描き「他 n 件」の文字を要素に付ける。一覧（outline）には全部ある', () => {
  const rels = [1, 2, 3, 4, 5].map((i) => rel('p0', `p${i}`));
  const svg = renderDiagramSvg(scenesOf(6), { t, relations: rels });
  assert.equal((svg.match(/data-role="point-relation"/g) ?? []).length, 4);
  assert.match(svg, /data-relation-more-for="p0"[^>]*>他 1 件</);
  assert.match(svg, /data-relation-more-for="p5"[^>]*>他 1 件</);
  const html = renderOutline(scenesOf(6), 's1', (k) => k, null, null, { label: () => "k", relations: rels });
  assert.equal((html.match(/data-relation-kind="next-step"/g) ?? []).length, 5);
});
test('FR-053 AC-582: 一覧（outline・Markdown）の同じ関係に同じ語の種類が出る。対立は ↔', () => {
  const rels = [rel('p0', 'p1', { kind: 'opposition', kindLabel: '対立', bidirectional: true })];
  const html = renderOutline(scenesOf(2), 's1', (k) => k, null, null, { label: () => "k", relations: rels });
  assert.match(html, /対立: 要点0 ↔ 要点1/);
  const md = buildMarkdown({ scenes: scenesOf(2), topics: [], relations: rels, level: 'detail', title: 'T' });
  assert.match(md, /- 対立 ↔ 要点1/);
});
test('FR-053 AC-584: 「他 n 件」の文言が日英にある', () => {
  assert.ok(createI18n('ja').getStrings()['diagram.relMore'].includes('{n}'));
  assert.ok(createI18n('en').getStrings()['diagram.relMore'].includes('{n}'));
});
