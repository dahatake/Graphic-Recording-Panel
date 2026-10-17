// FR-047 AC-214 AC-215 AC-216 / FR-048 AC-217 AC-218 の単体・結合テスト（RPG風の地図・スプライト）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from '../system/helpers.js';
import { createDrawStyleRegistry } from '../../web/src/drawstyles.js';
import { buildRpgMap, stepHero, renderRpgSvg, isWalkable } from '../../web/src/rpgmap.js';
import { spriteRows, spritePaths, RPG_PALETTE, SPRITE_KINDS, DIRS, TILE } from '../../web/src/rpgsprites.js';
import { classifyPoint } from '../../web/src/diagram.js';

const scenes = [
  { id: 's1', heading: 'A', status: 'confirmed', points: [{ id: 'p1', text: '困った' }, { id: 'p2', text: '決める' }], relations: [{ from: 'p1', to: 'p2' }] },
  { id: 's2', heading: 'B', status: 'in_progress', points: [{ id: 'p3', text: 'アイデア' }], relations: [] },
];
const colorsOf = (svg) => new Set((svg.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || []).map((c) => c.toLowerCase()));

// FR-047 AC-214 AC-215: 地図の構造・決定性・色数
test('FR-047 AC-214 AC-215: 地図は決定的で、街・城・地点・道・16 ドット・16 色以下', () => {
  const a = buildRpgMap(scenes, { kindOf: classifyPoint }); const b = buildRpgMap(scenes, { kindOf: classifyPoint });
  assert.deepEqual(a, b);
  assert.equal(a.tile, 16); assert.equal(TILE, 16);
  assert.ok(RPG_PALETTE.length <= 16);
  assert.equal(a.cells.length, a.cols * a.rows);
  assert.deepEqual(a.places.filter((p) => p.kind !== 'spot').map((p) => p.kind), ['castle', 'town']);
  assert.equal(a.places.filter((p) => p.kind === 'spot').length, 3);
  assert.deepEqual(a.places.filter((p) => p.kind === 'spot').map((p) => p.mark), ['issue', 'conclusion', 'idea']);
  const ids = new Set(a.places.map((p) => p.id));
  assert.ok(a.roads.length >= 3 && a.roads.every((r) => ids.has(r.from) && ids.has(r.to)));
  assert.ok(a.places.every((p) => isWalkable(a, p.x, p.y)), '場所は通れるマス');
  const svg = renderRpgSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50"><text x="5" y="20" font-size="14" fill="#fff">A&amp;B</text></svg>', a);
  assert.ok(colorsOf(svg).size <= 16);
  assert.match(svg, /<text x="5" y="20" font-size="14" fill="#0f1020">A&amp;B<\/text>/, '文字は変えない');
});

test('FR-047 AC-214: 空の議論でも地図ができ、勇者は通れるマスにいる', () => {
  const m = buildRpgMap([], {});
  assert.ok(m.cols >= 20 && m.rows >= 14 && m.places.length === 0);
  assert.ok(isWalkable(m, m.hero.x, m.hero.y));
});

// FR-048 AC-217: 勇者の向き・歩行・衝突
test('FR-048 AC-217: 勇者は向きが変わり、通れるマスで歩行の絵が切り替わり、壁・水・住人には進めない', () => {
  const m = buildRpgMap(scenes, { kindOf: classifyPoint });
  let h = m.hero;
  let r = stepHero(m, h, 'up'); assert.equal(r.hero.dir, 'up'); assert.equal(r.moved, true); assert.notEqual(r.hero.frame, h.frame);
  const f1 = r.hero.frame; r = stepHero(m, r.hero, 'down'); assert.notEqual(r.hero.frame, f1);
  // 左端の水へは進めない
  h = { x: 1, y: 1, dir: 'down', frame: 0 };
  r = stepHero(m, h, 'left'); assert.equal(r.moved, false); assert.equal(r.hero.dir, 'left'); assert.equal(r.hero.x, 1);
  const res = m.residents[0];
  r = stepHero(m, { x: res.x - 1, y: res.y, dir: 'down', frame: 0 }, 'right');
  if (isWalkable(m, res.x - 1, res.y)) assert.equal(r.moved, false, '住人のマスには進めない');
  assert.equal(stepHero(m, h, 'x').moved, false);
});

// FR-048 AC-217 AC-218: スプライトはコード生成・決定的・種類と向きで異なる
test('FR-048 AC-217 AC-218: スプライトは 16x16 の型紙から決定的に作られ、種類・向き・歩行で異なり、パレット内の色だけを使う', () => {
  const seen = new Set();
  for (const k of SPRITE_KINDS) for (const d of DIRS) for (const f of [0, 1]) {
    const rows = spriteRows(k, d, f);
    assert.equal(rows.length, 16); assert.ok(rows.every((r) => r.length === 16));
    assert.deepEqual(rows, spriteRows(k, d, f));
    seen.add(rows.join('/'));
    for (const p of spritePaths(k, d, f)) assert.ok(RPG_PALETTE.includes(p.color));
  }
  assert.equal(seen.size, SPRITE_KINDS.length * DIRS.length * 2, 'すべて異なる絵');
  assert.equal(spriteRows('dragon', 'up'), null);
  assert.equal(spriteRows('hero', 'north'), null);
});

// FR-047 AC-216: 拡張点の定義の追加で、既存 3 つは変わらない
test('FR-047 AC-216: RPG風は登録簿の定義として加わり、既存 3 つの定義は変わらず、重複は拒否される', () => {
  const reg = createDrawStyleRegistry();
  assert.deepEqual(reg.ids(), ['handwritten', 'anime', 'simple', 'rpg']);
  assert.deepEqual(reg.get('anime'), { id: 'anime', label: { ja: 'アニメ調', en: 'Anime' }, line: { width: 1.6, jitter: 0 }, fill: { mode: 'tint' }, text: { decor: 'bold', icons: true } });
  assert.equal(reg.register({ ...reg.get('rpg') }).ok, false);
  assert.equal(reg.label('rpg', 'ja'), 'RPG風'); assert.equal(reg.label('rpg', 'en'), 'RPG');
});

// FR-047 AC-215 AC-216 / FR-048 AC-218: アプリ統合（保存・外部リクエスト 0・テキスト一覧不変）
test('FR-047 AC-215 AC-216 / FR-048 AC-218: SVG 保存・PNG 保存に RPG風が反映され、外部参照がなく、テキスト一覧は変わらない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  const outline = app.renderOutline();
  app.setDrawStyle('rpg');
  const svg = app.renderSvg();
  assert.equal(svg, app.renderSvg(), '決定的');
  assert.ok(!/(href|src)\s*=\s*"(?!#)|url\(|<image|<script/i.test(svg), '外部ファイル・外部参照なし');
  assert.equal(app.renderOutline(), outline);
  await app.commands['save.svg']();
  assert.match(env.downloads.at(-1).data, /data-rpg-tile="16"/);
  const nPng = env.downloads.length; await app.commands['save.png']();
  assert.equal(env.downloads.length, nPng + 1, 'PNG も保存できる');
  const sp = app.getRpgMap().places.filter((p) => p.kind === 'spot');
  assert.ok(sp.every((p) => ['issue', 'conclusion', 'idea', 'note'].includes(p.mark)), '要点の種類は形でも区別（色だけにしない）');
  assert.ok(new Set(sp.map((p) => p.mark)).size >= 2);
  // 勇者の移動は地図に反映される
  const h0 = app.getRpgMap().hero; app.rpgPress('up');
  assert.notDeepEqual(app.getRpgMap().hero, h0);
  app.setDrawStyle('handwritten');
  assert.equal(app.getRpgMap(), null);
  assert.deepEqual(app.rpgPress('up'), { ok: false, reason: 'not_rpg' });
});
