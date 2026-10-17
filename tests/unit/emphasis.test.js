// FR-052 AC-229 AC-230 AC-231 / FR-053 AC-232 AC-233 AC-234 / FR-055 AC-237 AC-238 の単体テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPoint, kindLabelOf, KINDS } from '../../web/src/diagram.js';
import { renderOutline } from '../../web/src/outline.js';
import { deriveRelations, labelRelations, causalEvidence } from '../../web/src/layoutkinds.js';

const pts = (...texts) => texts.map((text, i) => ({ id: `p${i}`, text }));

// FR-052 AC-229
test('FR-052 AC-229: 提案する発言は「提案」で結論ではない', () => {
  assert.equal(classifyPoint('案Aの採用を提案します。'), 'proposal');
  assert.equal(classifyPoint('We propose adopting A.'), 'proposal');
});

// FR-052 AC-230
test('FR-052 AC-230: 決定の否定・保留は「未決定」', () => {
  assert.equal(classifyPoint('We have not decided to adopt A.'), 'undecided');
  assert.equal(classifyPoint('Aを採用するかは未定です。'), 'undecided');
});

// FR-052 AC-231
test('FR-052 AC-231: 合意済みの決定だけが結論。種類は別のラベルと別の見た目', () => {
  assert.equal(classifyPoint('Aを採用すると決まりました。'), 'conclusion');
  assert.equal(classifyPoint('We agreed to adopt A.'), 'conclusion');
  assert.equal(kindLabelOf('undecided', 'ja'), '未決定');
  assert.equal(kindLabelOf('proposal', 'en'), 'Proposal');
  assert.equal(new Set(Object.values(KINDS).map((k) => k.color)).size, Object.keys(KINDS).length);
});

// FR-055 AC-237
test('FR-055 AC-237: 時間・起点の「から」「from」は因果にしない', () => {
  assert.deepEqual(deriveRelations(pts('納期が迫っている。', '来月から広報を始める。')), []);
  assert.deepEqual(deriveRelations(pts('The deadline is near.', 'We start the campaign from next month.')), []);
  assert.equal(causalEvidence('3時から会議です。'), null);
});

// FR-055 AC-238 / FR-053 AC-232
test('FR-055 AC-238 FR-053 AC-232: 理由の「から」・because は明示の原因→結果で根拠の語を持つ', () => {
  for (const [t, w] of [['雨が降っているから、中止にします。', 'から'], ['Because the server is down, we postponed the release.', 'Because']]) {
    const r = deriveRelations(pts('準備を始めます。', t));
    assert.equal(r.length, 1);
    assert.deepEqual([r[0].kind, r[0].basis, r[0].from, r[0].to, r[0].evidence], ['cause-effect', 'explicit', 'p0', 'p1', { type: 'word', text: w }]);
  }
});

// FR-053 AC-233 AC-234
test('FR-053 AC-233 AC-234: 話順だけの候補は推測（根拠なし）で、向きは課題→提案、決定的', () => {
  const seq = pts('コストが高くて困った', '予算を再配分するアイデアを出します。', 'コストが高くて困った', '中止にします。');
  const a = deriveRelations(seq);
  assert.deepEqual(a, deriveRelations(seq));
  assert.deepEqual(a.map((r) => [r.kind, r.from, r.to, r.basis]), [['problem-proposal', 'p0', 'p1', 'explicit'], ['problem-proposal', 'p2', 'p3', 'inferred']]);
  assert.equal(a[1].evidence, null);
  const l = labelRelations(a, 'ja');
  assert.equal(l[0].kindLabel, '課題→提案'); assert.equal(l[1].basisLabel, '推測'); assert.equal(l[0].basisLabel, '明示');
});

// FR-052 AC-231: 合意済みの決定はアイデアの語を含んでも結論
test('FR-052 AC-231: 「アイデアXを採用すると決まりました」は結論', () => {
  assert.equal(classifyPoint('アイデアXを採用すると決まりました'), 'conclusion');
  assert.equal(classifyPoint('アイデアを出しましょう'), 'idea');
});

// FR-054 AC-235 AC-236
test('FR-054 AC-235: 一覧の関係は種類・始点・終点・明示/推測を文字で出し、根拠は 40 文字以内。関係なしでは出ない', () => {
  const sc = [{ id: 's1', heading: 'h', points: [{ id: 'a', text: 'AAA' }, { id: 'b', text: 'BBB' }] }];
  const rel = { kind: 'cause-effect', from: 'a', to: 'b', basis: 'explicit', kindLabel: '原因→結果', basisLabel: '明示', evidence: { type: 'word', text: 'x'.repeat(60) } };
  const html = renderOutline(sc, 's1', (k) => k, null, null, { label: () => '', relations: [rel] });
  assert.ok(html.includes('原因→結果: AAA → BBB'));
  assert.ok(html.includes('明示: ' + 'x'.repeat(40) + '）'));
  assert.ok(!html.includes('x'.repeat(41)));
  assert.ok(!renderOutline(sc, 's1', (k) => k, null, null, { label: () => '', relations: [] }).includes('data-relation-from'));
});

