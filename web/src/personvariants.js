// FR-110 AC-629〜631: 人物の絵記号のバリエーション（バストアップ）。契約: tests/system/CONTRACT-P2.md §6（getPersonVariants／personVariantFor）、PARAM-148・153。
// - 年齢区分（若〜中年・高年）× 性別表現（男性的・女性的）の 4 つの組に、それぞれ 3 種類（計 12 種類）。特定の属性を既定にしない。
// - 割り当ては決定的: 要点の識別子（UTF-8）の FNV-1a 32 ビットのハッシュ値 % バリエーション数。話者・発話者は使わない（装飾。AC-554・FR-022 の対象外）。
// - SVG はコード生成。許可リスト（parts.js の isAllowedPartSvg）の要素・属性だけ。外部の画像・参照なし。装飾なので aria-hidden（代替の文字は一覧側の「人物」）。
// - 色だけに頼らない: 年齢は白髪の色に加えて眉・しわの線と眼鏡、性別表現は髪型の形（短髪・長髪）で区別する。

const INK = '#15191f';
export const PERSON_AGES = ['young-middle', 'senior'];
export const PERSON_GENDERS = ['masculine', 'feminine'];
export const PERSON_LABEL = { ja: '人物', en: 'person' };

const SKINS = ['#ffd9b8', '#e0ac7e', '#a8714a'];
const HAIRS = { 'young-middle': ['#3a2a20', '#7a4a22', '#1d1d24'], senior: ['#d5d8de', '#b9bec8', '#e8e8ec'] };
const OUTFITS = ['#4c8bf5', '#e8590c', '#2f9e6a'];

// 1 つのバリエーションの SVG（viewBox 48x48 のバストアップ）。k = 組の中の 0〜2。
function build(age, gender, k) {
  const skin = SKINS[k]; const hair = HAIRS[age][k]; const cloth = OUTFITS[(k + (gender === 'feminine' ? 1 : 0)) % 3];
  const fem = gender === 'feminine'; const old = age === 'senior';
  const parts = [];
  // 長髪は顔の後ろ
  if (fem) parts.push(`<path d="M12 22q0-14 12-14t12 14v14q-4 2-6 0V24H18v12q-2 2-6 0z" fill="${hair}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>`);
  // 胴体（服）。襟の形: 男性的 = 襟とネクタイ線、女性的 = 丸い襟ぐり
  parts.push(`<path d="M6 48c0-9 7-13 18-13s18 4 18 13z" fill="${cloth}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>`);
  parts.push(fem ? `<path d="M18 36q6 6 12 0" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>` : `<path d="M20 36l4 6 4-6M24 42v6" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`);
  parts.push(`<rect x="21" y="29" width="6" height="7" rx="2" fill="${skin}" stroke="${INK}" stroke-width="1.5"/>`);
  // 顔
  parts.push(`<ellipse cx="24" cy="21" rx="9" ry="10" fill="${skin}" stroke="${INK}" stroke-width="1.5"/>`);
  // 前髪・短髪
  parts.push(fem ? `<path d="M14 21q0-12 10-12t10 12q-6-1-10-7-3 5-10 7z" fill="${hair}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>` : `<path d="M15 19q0-10 9-10t9 10q-5-3-9-3t-9 3z" fill="${hair}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"/>`);
  // 目・口
  parts.push(`<circle cx="20.5" cy="22" r="1.2" fill="${INK}"/><circle cx="27.5" cy="22" r="1.2" fill="${INK}"/><path d="M21 27q3 2 6 0" fill="none" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/>`);
  if (old) {
    // 高年: 眼鏡とほうれい線（色以外の手がかり）
    parts.push(`<circle cx="20.5" cy="22" r="3" fill="none" stroke="${INK}" stroke-width="1"/><circle cx="27.5" cy="22" r="3" fill="none" stroke="${INK}" stroke-width="1"/><path d="M23.5 22h1M20 25.5q-1 2 0 3.5M28 25.5q1 2 0 3.5" fill="none" stroke="${INK}" stroke-width="1" stroke-linecap="round"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">${parts.join('')}</svg>`;
}

const VARIANTS = [];
// 組が交互に並ぶ順（index % 4 が組、index / 4 が組の中の番号）。割り当ての偏りが組の間に出にくい。
for (let k = 0; k < 3; k++) for (const age of PERSON_AGES) for (const gender of PERSON_GENDERS) VARIANTS.push({ index: VARIANTS.length, age, gender, svg: build(age, gender, k) });
Object.freeze(VARIANTS);

// FNV-1a 32 ビット（UTF-8 のバイト列）
export function fnv1a32(str) {
  const bytes = new TextEncoder().encode(String(str ?? ''));
  let h = 0x811c9dc5;
  for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export const getPersonVariants = () => VARIANTS.map((v) => ({ ...v }));
export const personVariantFor = (id) => ({ ...VARIANTS[fnv1a32(id) % VARIANTS.length] });

// 偏りの測り方（AC-629）: 識別子 prefix+0..n-1 の割り当ての比率が、均等の比率との差（百分率の点）の最大値で返す。
export function measureBias(n = 1000, idOf = (i) => `p${i}`) {
  const byVariant = new Array(VARIANTS.length).fill(0); const byAge = {}; const byGender = {};
  for (let i = 0; i < n; i++) { const v = personVariantFor(idOf(i)); byVariant[v.index]++; byAge[v.age] = (byAge[v.age] ?? 0) + 1; byGender[v.gender] = (byGender[v.gender] ?? 0) + 1; }
  const dev = (count, groups) => Math.abs((count / n) * 100 - 100 / groups);
  return {
    variant: Math.max(...byVariant.map((c) => dev(c, VARIANTS.length))),
    age: Math.max(...PERSON_AGES.map((a) => dev(byAge[a] ?? 0, PERSON_AGES.length))),
    gender: Math.max(...PERSON_GENDERS.map((g) => dev(byGender[g] ?? 0, PERSON_GENDERS.length))),
  };
}

export function personVariantsModule(ctx) {
  const { api } = ctx;
  api.getPersonVariants = getPersonVariants;
  api.personVariantFor = personVariantFor;
}
