// FR-110 AC-629〜631 の単体・結合テスト（人物の絵記号のバリエーション。PARAM-148・153）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { isAllowedPartSvg } from '../../web/src/parts.js';
import { renderDiagramSvg } from '../../web/src/diagram.js';
import { renderPresetDiagram, buildLook } from '../../web/src/presetdiagram.js';
import { personGroupFor } from '../../web/src/personvariants.js';
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

const SC = (id) => [{ id, status: 'done', heading: 'チーム', points: [{ id: `${id}-p`, text: 'メンバーで相談した' }], relations: [] }];
const wired = (svg, id) => svg.includes(personGroupFor(id));

test('FR-110 AC-629・631: 図（既定・プリセット＝保存 SVG・HTML の元）に personVariantFor の絵が入り、同じ id は同じ絵・再配置で変わらない', () => {
  for (const id of ['s1', 's2', 'scene-あ']) {
    const a = renderDiagramSvg(SC(id), { t: (k) => k });
    assert.ok(wired(a, id), `図 ${id}`);
    assert.equal(a, renderDiagramSvg(SC(id), { t: (k) => k }), '同じ入力は同じ');
    assert.match(a, /data-part-key="people-team"/);
    assert.ok(a.includes('<title>人物</title>'), '代替の文字');
    assert.doesNotMatch(a, /https?:\/\/(?!www\.w3\.org)|<image|href/);
    const look = buildLook({ id: 't', preset: true, paper: 'plain', font: 'gothic', headingDecoration: 'band', balloon: 'rounded', stroke: { wobble: 0, width: 2 }, figures: false, icons: true, palette: { background: '#ffffff', primary: '#1a1a1a', accent: ['#ffd400'], text: '#1a1a1a', secondary: '#757575' } });
    assert.ok(renderPresetDiagram(SC(id), { lang: 'ja' }, look).body.includes(personGroupFor(id).split('stroke="#15191f"').join(`stroke="${look.frame}"`)), `プリセット ${id}`);
  }
  // 識別子が違えば（12 種の範囲で）絵が変わりうる
  const set = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => personGroupFor(id)));
  assert.ok(set.size > 1);
  assert.equal(personGroupFor('s1'), personGroupFor('s1'));
});

test('FR-110 AC-630: 色だけに頼らない（年齢は眼鏡・線、性別は髪型の形）', () => {
  const vs = getPersonVariants();
  const senior = vs.filter((v) => v.age === 'senior'); const young = vs.filter((v) => v.age !== 'senior');
  assert.ok(senior.every((v) => /fill="none" stroke="#15191f" stroke-width="1"\/><circle/.test(v.svg)));
  assert.ok(young.every((v) => !/stroke-width="1"\/><circle/.test(v.svg)));
  assert.notEqual(vs.find((v) => v.gender === 'feminine' && v.age === 'young-middle').svg.length, vs.find((v) => v.gender === 'masculine' && v.age === 'young-middle').svg.length);
});
