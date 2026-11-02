// FR-079 AC-426・AC-427・AC-580・AC-581・AC-564: 要点の種類 9 種（質問・根拠・行動の追加）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPointRule, classifyPoint, KINDS, KIND_LABELS, kindLabelOf, outline, kindExtraSvg, ICON_GLYPHS } from '../../web/src/diagram.js';
import { KIND_ORDER, kindOf, kindRank } from '../../web/src/infodesign.js';
import { EXTRA_KIND_IDS, KIND_IDS } from '../../web/src/kindstyles.js';

const NINE = ['conclusion', 'issue', 'proposal', 'idea', 'undecided', 'question', 'evidence', 'action', 'note'];

// AC-427: 重なりなし・漏れなし（どの文もちょうど 1 つの種類。どれにも当てはまらなければ補足）
test('AC-427: 分類は常に 9 種のうち 1 つ（漏れなし）で、決定的（重なりなし）', () => {
  const samples = ['', 'こんにちは', 'どの講師に依頼しますか', 'たとえば昨年は二十名でした', '鈴木さんが明日連絡します', 'Aを採用すると決まりました。', 'Why now', 'because of cost', 'x'];
  for (const s of samples) {
    const k = classifyPoint(s);
    assert.ok(NINE.includes(k), `${s} → ${k}`);
    assert.equal(classifyPoint(s), k);
  }
  assert.equal(classifyPoint('こんにちは'), 'note');
});

test('AC-427: 判定順は 既存 5 種 → 質問 → 根拠 → 行動 → 補足', () => {
  assert.equal(classifyPointRule('Aを採用すると決まりました。'), 'conclusion');
  assert.equal(classifyPointRule('案Aの採用を提案します。'), 'proposal');
  assert.equal(classifyPointRule('納期が遅れていますか'), 'issue'); // 既存 5 種が先
  assert.equal(classifyPointRule('まだ未定ですか'), 'undecided');
  assert.equal(classifyPointRule('どの講師に依頼しますか'), 'question');
  assert.equal(classifyPointRule('たとえば昨年は二十名でした'), 'evidence');
  assert.equal(classifyPointRule('鈴木さんが明日連絡します'), 'action');
  assert.equal(classifyPointRule('こんにちは'), null);
  // 質問が根拠・行動より先
  assert.equal(classifyPointRule('たとえば誰が連絡しますか'), 'question');
  assert.equal(classifyPointRule('根拠は田中さんが共有します'), 'evidence');
});

// PARAM-131〜132 と PARAM-129 の語の境界
test('PARAM-131: 質問の語（日本語は部分一致・英語は語境界）', () => {
  for (const s of ['できますか', '誰でしょうか', '行きませんか', '本当でしょう', '本当？', 'really?', 'Why', 'how to go', 'WHAT is it']) assert.equal(classifyPointRule(s), 'question', s);
  for (const s of ['however it works', 'show the list', 'whatever']) assert.notEqual(classifyPointRule(s), 'question', s);
});
test('PARAM-132: 根拠の語（英語は語境界）', () => {
  for (const s of ['たとえば 3 件', '例えば A', '根拠は数字', '理由は価格', 'データでは増加', '実績あり', 'Because of cost', 'for example A', 'e.g. A']) assert.equal(classifyPointRule(s), 'evidence', s);
  for (const s of ['unbecause', 'forexample']) assert.notEqual(classifyPointRule(s), 'evidence', s);
});
test('PARAM-129: 行動の語（部分一致。「までに」「担当」単独でも一致）', () => {
  for (const s of ['金曜までに', '担当は鈴木', '資料を共有します', 'TODO item', 'action item A']) assert.equal(classifyPointRule(s), 'action', s);
});

// AC-426: 並べ替えの順
test('AC-426: 種類の順は 9 種（結論・課題・提案・アイデア・未決定・質問・根拠・行動・補足）', () => {
  assert.deepEqual(KIND_ORDER, ['conclusion', 'issue', 'proposal', 'idea', 'undecided', 'question', 'evidence', 'action', 'note']);
  assert.ok(kindRank('question') < kindRank('evidence') && kindRank('evidence') < kindRank('action') && kindRank('action') < kindRank('note'));
  assert.equal(kindOf('どの講師に依頼しますか'), 'question');
});

// AC-580: 形・絵記号・ラベルが 9 種で互いに異なる（色だけに頼らない）、AC-581: 同じ語
test('AC-580: 9 種の形・絵記号・ラベルがすべて異なる', () => {
  const ks = NINE.map((k) => KINDS[k]);
  assert.equal(new Set(ks.map((k) => k.shape)).size, 9);
  assert.equal(new Set(ks.map((k) => k.icon)).size, 9);
  for (const l of ['ja', 'en']) assert.equal(new Set(NINE.map((k) => kindLabelOf(k, l))).size, 9);
  assert.equal(new Set(ks.map((k) => `${k.shape}/${k.icon}`)).size, 9);
  for (const k of EXTRA_KIND_IDS) assert.ok(ICON_GLYPHS[KINDS[k].icon]);
});
test('AC-580: 質問＝二重の枠・根拠＝左の太い縦線・行動＝角の丸い枠', () => {
  assert.match(kindExtraSvg(KINDS.question.shape, 0, 0, 100, 38, '#000'), /kind-inner-frame/);
  assert.match(kindExtraSvg(KINDS.evidence.shape, 0, 0, 100, 38, '#000'), /kind-bar/);
  assert.equal(kindExtraSvg(KINDS.note.shape, 0, 0, 100, 38, '#000'), '');
  assert.ok(outline(KINDS.action.shape, 0, 0, 100, 38).length > 4);
});
test('AC-581: ラベルは 9 種で ja・en とも定義済み', () => {
  assert.deepEqual([KIND_LABELS.ja.question, KIND_LABELS.ja.evidence, KIND_LABELS.ja.action], ['質問', '根拠', '行動']);
  assert.deepEqual(Object.keys(KIND_LABELS.ja).sort(), [...NINE].sort());
  assert.deepEqual(Object.keys(KIND_LABELS.en).sort(), [...NINE].sort());
});

// AC-564: 割り当て可能なのは従来の 6 種のまま。新しい 3 種は補足のスタイル
test('AC-564: 種類別スタイルの割り当ては 6 種のまま、質問・根拠・行動は補足に従う', () => {
  assert.equal(KIND_IDS.length, 6);
  assert.deepEqual(EXTRA_KIND_IDS, ['question', 'evidence', 'action']);
});
