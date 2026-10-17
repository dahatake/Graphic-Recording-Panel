// FR-064 同梱部品の拡充と汎用キャラのビルダーの単体・結合テスト（AC-324〜329）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as parts from '../../web/src/parts.js';
import { renderDiagramSvg } from '../../web/src/diagram.js';
import { EMOTIONS } from '../../web/src/emotion.js';

const MIN_PARTS = 120; // PARAM-073
const t = (k) => k;
const scene = (text) => [{ id: 's1', heading: '相談', status: 'confirmed', points: [{ id: 'p1', text }], relations: [] }];

// FR-064 AC-324
test('FR-064 AC-324: 汎用物体の部品が PARAM-073 点以上あり、キーは一意で SVG を持つ', () => {
  const keys = parts.getPartKeys();
  assert.ok(keys.length >= MIN_PARTS, `${keys.length} 点`);
  assert.equal(new Set(keys).size, keys.length);
  const svgs = new Set();
  for (const k of keys) {
    assert.ok(parts.isPartKey(k));
    const svg = parts.getPartSvg(k);
    assert.match(svg, /^<svg /);
    svgs.add(svg);
    assert.ok(parts.getPartInfo(k, 'ja').label && parts.getPartInfo(k, 'en').label);
  }
  assert.equal(svgs.size, keys.length, 'すべての部品の SVG が異なる');
  assert.equal(parts.isPartKey('no-such-key'), false);
  assert.equal(parts.getPartSvg('no-such-key'), null);
});

// FR-064 AC-325
test('FR-064 AC-325: すべての部品・キャラの SVG が許可リストを通り、外部参照を含まない', () => {
  for (const k of parts.getPartKeys()) {
    const svg = parts.getPartSvg(k);
    assert.ok(parts.isAllowedPartSvg(svg), k);
    assert.doesNotMatch(svg.replace(' xmlns="http://www.w3.org/2000/svg"', ''), /href|https?:|url\(|<script|<image|<use|on\w+=/i);
  }
  assert.ok(parts.isAllowedPartSvg(parts.buildCharacter({})));
  for (const bad of ['<svg><script>1</script></svg>', '<svg><image href="http://x/a.png"/></svg>', '<svg onload="x()"></svg>', '<svg><path d="M0 0" fill="url(#a)"/></svg>', '<svg><use href="#a"/></svg>', '<svg><foreignObject/></svg>', 'x']) {
    assert.equal(parts.isAllowedPartSvg(bad), false, bad);
  }
});

// FR-064 AC-326
test('FR-064 AC-326: LLM なしで、辞書の語（日本語・英語）に対応する部品が図に現れる', () => {
  const ja = renderDiagramSvg(scene('コーヒーを飲みながら見積書を確認した'), { t });
  assert.match(ja, /data-part-key="cup-coffee"/);
  const en = renderDiagramSvg(scene('We need a rocket launch plan'), { t });
  assert.match(en, /data-part-key="rocket-launch"/);
  assert.doesNotMatch(renderDiagramSvg(scene('ふつうの話'), { t }), /data-part-key/);
  assert.equal(renderDiagramSvg(scene('コーヒー'), { t }), renderDiagramSvg(scene('コーヒー'), { t }));
  // 辞書の語がどの部品にも対応づく
  for (const k of parts.getPartKeys()) {
    const w = parts.getPartWords(k);
    assert.ok(w.ja.length && w.en.length, k);
    assert.ok(parts.matchParts(w.ja[0]).some((m) => m.key === k), `${k} ja`);
    assert.ok(parts.matchParts(w.en[0]).some((m) => m.key === k), `${k} en`);
  }
  assert.deepEqual(parts.matchParts('coffee and BOOK').map((m) => m.key), ['cup-coffee', 'book-text']);
});

// FR-064 AC-327
test('FR-064 AC-327: 同じ属性なら同じ SVG、属性が違えば違う SVG（決定的）', () => {
  const a = { hair: 'bob', hairColor: 'blue', outfit: 'suit', expression: 'happy' };
  assert.equal(parts.buildCharacter(a), parts.buildCharacter({ ...a }));
  for (const key of ['hair', 'hairColor', 'outfit', 'expression']) {
    const other = parts.CHARACTER_OPTIONS[key].find((v) => v !== a[key]);
    assert.notEqual(parts.buildCharacter({ ...a, [key]: other }), parts.buildCharacter(a), key);
  }
});

// FR-064 AC-328
test('FR-064 AC-328: 感情 8 種の語が表情に反映され、表情が文字（ラベル）でも識別できる', () => {
  const words = { confused: 'モヤモヤする', trouble: '困った', anxious: '不安だ', angry: 'イライラ', happy: '嬉しい', idea: 'ひらめいた', surprised: 'びっくり', tired: '疲れた' };
  assert.equal(EMOTIONS.length, 8);
  const labels = new Set(); const faces = new Set();
  for (const e of EMOTIONS) {
    const ex = parts.expressionForText(words[e.id]);
    assert.equal(ex, e.id);
    const svg = parts.buildCharacter({ expression: ex });
    assert.match(svg, new RegExp(`data-expression="${e.id}"`));
    const label = parts.EXPRESSION_LABELS[e.id].ja;
    assert.ok(svg.includes(`<text `) && svg.includes(`>${label}</text>`), 'ラベルの文字');
    assert.ok(parts.buildCharacter({ expression: ex }, { lang: 'en' }).includes(`>${parts.EXPRESSION_LABELS[e.id].en}</text>`));
    labels.add(label); faces.add(svg);
  }
  assert.equal(labels.size, 8); assert.equal(faces.size, 8);
  assert.equal(parts.expressionForText('ふつうの話'), 'neutral');
});

// FR-064 AC-329
test('FR-064 AC-329: 属性は汎用の候補からだけ選ばれ、画像・名前・話者との対応づけの入力を持たない', () => {
  const a = parts.buildCharacter({ hair: 'ロン毛の実在人物', hairColor: '#123456', outfit: '<script>', expression: 'x' });
  assert.equal(a, parts.buildCharacter({}), '候補にない値は既定の候補に置き換わる');
  // 名前・画像・話者の入力は描画に影響しない
  const base = parts.buildCharacter({ hair: 'bun' });
  assert.equal(parts.buildCharacter({ hair: 'bun', name: '山田太郎', photo: 'data:image/png;base64,AAAA', speaker: 'A' }), base);
  assert.doesNotMatch(base, /山田|image|data:/);
  assert.deepEqual(Object.keys(parts.CHARACTER_OPTIONS).sort(), ['expression', 'hair', 'hairColor', 'outfit']);
  const names = Object.keys(parts).join(' ');
  assert.doesNotMatch(names, /photo|face(?!t)|portrait|speaker|likeness|name/i);
});
