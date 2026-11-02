// FR-110 AC-629〜631 の単体・結合テスト（人物の絵記号のバリエーション。PARAM-148・153）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { isAllowedPartSvg } from '../../web/src/parts.js';
import { getPersonVariants, personVariantFor, fnv1a32, measureBias, PERSON_AGES, PERSON_GENDERS } from '../../web/src/personvariants.js';

const PARAM_148 = 8; const PARAM_153 = 10;

test('FR-110 AC-629: 8 種類以上で、4 つの組のそれぞれに 2 種類以上。見た目はすべて異なる', () => {
  const vs = getPersonVariants();
  assert.ok(vs.length >= PARAM_148);
  for (const age of PERSON_AGES) for (const gender of PERSON_GENDERS) assert.ok(vs.filter((v) => v.age === age && v.gender === gender).length >= 2, `${age}/${gender}`);
  assert.equal(new Set(vs.map((v) => v.svg)).size, vs.length);
  assert.deepEqual(vs.map((v) => v.index), vs.map((_, i) => i));
});

test('FR-110 AC-629: 割り当ては FNV-1a 32 ビット（UTF-8）% 数。同じ識別子は毎回同じ', () => {
  assert.equal(fnv1a32(''), 0x811c9dc5);
  assert.equal(fnv1a32('a'), 0xe40c292c);
  assert.equal(fnv1a32('foobar'), 0xbf9cf968);
  const n = getPersonVariants().length;
  for (const id of ['p1', '要点-あ', 'scene-3:pt-2']) {
    assert.equal(personVariantFor(id).index, fnv1a32(id) % n);
    assert.deepEqual(personVariantFor(id), personVariantFor(id));
  }
  assert.notEqual(fnv1a32('é'), fnv1a32('e'), 'UTF-8 のバイト列で計算する');
});

test('FR-110 AC-629 PARAM-153: 連番 1000 件の割り当ての偏りが 10 点以内（バリエーション・年齢区分・性別表現）', () => {
  for (const idOf of [(i) => `p${i}`, (i) => String(i), (i) => `point-${i}`]) {
    const b = measureBias(1000, idOf);
    assert.ok(b.variant <= PARAM_153 && b.age <= PARAM_153 && b.gender <= PARAM_153, JSON.stringify(b));
  }
});

test('FR-110 AC-631: SVG は許可リストを満たし、外部参照・画像を持たない', () => {
  for (const v of getPersonVariants()) {
    assert.ok(isAllowedPartSvg(v.svg), `index ${v.index}`);
    assert.doesNotMatch(v.svg, /https?:\/\/(?!www\.w3\.org\/2000\/svg)|<image|href|url\(/);
  }
});

test('FR-110 AC-630: 装飾（aria-hidden）で、話者・発話者は割り当てに使わない（引数は識別子だけ）', async () => {
  for (const v of getPersonVariants()) assert.match(v.svg, /^<svg [^>]*aria-hidden="true"/);
  assert.equal(personVariantFor.length, 1);
  const { app } = await newApp();
  assert.equal(app.getPersonVariants().length, getPersonVariants().length);
  assert.equal(app.personVariantFor('x').index, personVariantFor('x').index);
  assert.equal(app.personVariantFor('x', 'speaker-A').index, app.personVariantFor('x', 'speaker-B').index);
});

test('FR-110 AC-630: 色だけに頼らない（年齢は眼鏡・線、性別は髪型の形）', () => {
  const vs = getPersonVariants();
  const senior = vs.filter((v) => v.age === 'senior'); const young = vs.filter((v) => v.age !== 'senior');
  assert.ok(senior.every((v) => /fill="none" stroke="#15191f" stroke-width="1"\/><circle/.test(v.svg)));
  assert.ok(young.every((v) => !/stroke-width="1"\/><circle/.test(v.svg)));
  assert.notEqual(vs.find((v) => v.gender === 'feminine' && v.age === 'young-middle').svg.length, vs.find((v) => v.gender === 'masculine' && v.age === 'young-middle').svg.length);
});
