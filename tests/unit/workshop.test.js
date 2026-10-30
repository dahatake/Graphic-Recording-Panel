// FR-091 AC-541 AC-542（integration）: ワークショップホワイトボード型の配置・SVG・テキスト一覧の単体・結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workshopLayout, workshopSvg, workshopOutlineHtml, stageGroups, LENSES } from '../../web/src/workshop.js';

const sc = (id, status, ...texts) => ({ id, heading: texts[0], status, points: texts.map((t, i) => ({ id: `${id}p${i}`, text: t })) });
const scenes = (n) => Array.from({ length: n }, (_, i) => sc(`s${i + 1}`, 'confirmed', `話題${i + 1} 確認`));

// FR-091 AC-541: ステージは 5〜6 個（シーンが 5 未満ならシーンの数）で、全シーンをちょうど 1 回ずつ含む
test('FR-091 AC-541: ステージ数は min(6, シーン数) で、すべてのシーンを順に 1 回ずつ含む', () => {
  for (const [n, k] of [[0, 0], [1, 1], [4, 4], [5, 5], [6, 6], [7, 6], [40, 6]]) {
    const g = stageGroups(scenes(n));
    assert.equal(g.length, k, `シーン ${n}`);
    assert.deepEqual(g.flat().map((s) => s.id), scenes(n).map((s) => s.id));
  }
});

// FR-091 AC-541: 英語は大文字のラベル。ラベルは発話の語で、会話にない語は入らない
test('FR-091 AC-541: 英語のラベルは大文字で、発話の語だけから作られる', () => {
  const L = workshopLayout({ scenes: [sc('a', 'confirmed', 'budget review'), sc('b', 'confirmed', 'release plan')], lang: 'en' });
  assert.deepEqual(L.workshop.stages.map((s) => s.label), ['BUDGET REVIEW', 'RELEASE PLAN']);
  assert.equal(workshopLayout({ scenes: [], lang: 'ja' }).workshop.stages.length, 0);
});

// FR-091 AC-542: 問いは「？」を含む発話・未決定・課題を優先し、1 ステージにつき最大 1 つ
test('FR-091 AC-542: 未解決の問いは 1 ステージ最大 1 つで、？の発話が優先される', () => {
  const L = workshopLayout({ scenes: [sc('a', 'confirmed', '遅れが心配です', 'どうしますか？', '別の問題もある'), sc('b', 'confirmed', '方針に決定します')], lang: 'ja' });
  assert.equal(L.workshop.stages[0].question.full, 'どうしますか？');
  assert.equal(L.workshop.stages[1].question, null);
});

// FR-091 AC-541 AC-542: 7 つのレンズの注記は SVG とテキスト一覧の両方に文字で出て、色は意味色と紙・白だけ
test('FR-091 AC-541 AC-542: 注記・問い・ラベルが SVG とテキスト一覧の両方にあり、色は意味色だけで外部参照がない', () => {
  assert.equal(LENSES.length, 7);
  const input = { scenes: [sc('a', 'confirmed', 'ふりかえり <計画>'), sc('b', 'in_progress', '次はどうする？')], lang: 'ja' };
  const notes = LENSES.map((l, i) => ({ sceneId: 'a', lens: l.id, text: `注記${i}` }));
  const L = workshopLayout(input, notes);
  const svg = workshopSvg(L, { types: ['workshop'] });
  const outline = workshopOutlineHtml(L);
  for (const m of svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)) assert.ok(outline.includes(m[1]), `一覧に図の文字がある: ${m[1]}`);
  assert.equal((svg.match(/data-ws-note=/g) || []).length, 7);
  assert.equal((svg.match(/data-ws-question/g) || []).length, 1);
  const hex = [...svg.matchAll(/\b(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g)].map((m) => m[1].toUpperCase());
  const allowed = ['#0F2A43', '#0E7490', '#14B8A6', '#1F7A54', '#E2632B', '#F3F7FA', '#FBF3E0', '#FFFFFF'];
  assert.deepEqual(hex.filter((c) => !allowed.includes(c)), []);
  assert.equal(hex.filter((c) => c === '#1F7A54').length, 1);
  assert.ok(!/<image|<foreignObject|https?:\/\/(?!www\.w3\.org)|url\(/.test(svg));
  assert.ok(svg.includes('&lt;計画&gt;') && !svg.includes('<計画>'), '文字は escape される');
});

// NFR-PERF-003: 発話が多くても算出は軽い（5000 発話相当のシーン数）
test('FR-091 NFR-PERF-003: 5000 発話の配置の算出は 100ms 以内', () => {
  const big = Array.from({ length: 50 }, (_, i) => sc(`s${i}`, 'confirmed', ...Array.from({ length: 100 }, (_, j) => `発話 ${i} ${j} 確認します`)));
  workshopLayout({ scenes: big, lang: 'ja' });
  const t0 = performance.now();
  const L = workshopLayout({ scenes: big, lang: 'ja' });
  workshopSvg(L, {});
  assert.ok(performance.now() - t0 < 100, `${performance.now() - t0}ms`);
});
