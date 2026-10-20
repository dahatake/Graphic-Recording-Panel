// FR-047 AC-214 / FR-048 AC-217 / FR-049 AC-219・AC-221 / FR-051 AC-226（System Test。契約: CONTRACT.md「RPG風の描画スタイル」）
// 期待値は受入基準だけから決める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from './helpers.js';
import { rpgApp, findPath, walk, plain, svgTexts, snap } from './rpg-util.js';

const colorsOf = (svg) => new Set((svg.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || []).map((c) => c.toLowerCase()));

// FR-047 AC-214
test('FR-047 AC-214: 描画スタイルの選択肢に「RPG風」が現れ、既定は手書き調のまま', async () => {
  const { app } = await newApp();
  const rpg = app.getDrawStyles().find((s) => s.id === 'rpg');
  assert.ok(rpg, '選択肢に rpg');
  assert.match(rpg.label, /RPG/);
  // 選択肢の総数は FR-029 AC-146（FR-076 の追加後は 13）で確かめる。ここでは既存の 3 つと並んで現れることだけを見る
  for (const id of ['handwritten', 'anime', 'simple']) assert.ok(app.getDrawStyles().some((s) => s.id === id), id);
  assert.equal(app.getDrawStyle(), 'handwritten');
});

test('FR-047 AC-214: 選ぶと 1 マス 16 ドット四方の格子・16 色以下のドット絵の俯瞰マップになり、トピック=街・城、要点=地点、関係線=道', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  toDetail(app);
  assert.equal(app.getRpgMap(), null, 'RPG風でないときは地図なし');
  assert.ok(app.setDrawStyle('rpg').ok);
  const svg = app.renderSvg();
  assert.match(svg, /data-draw-style="rpg"/);
  assert.match(svg, /data-rpg-tile="16"/);
  const map = app.getRpgMap();
  assert.equal(map.tile, 16);
  assert.ok(map.colors.length >= 2 && map.colors.length <= 16, `色数 ${map.colors.length}`);
  assert.ok(colorsOf(svg).size <= 16, `図に使われる色が 16 色以下（${colorsOf(svg).size}）`);
  assert.equal(map.cells.length, map.cols * map.rows, '格子の全マスが定義される');
  for (const c of map.cells) { assert.ok(Number.isInteger(c.x) && Number.isInteger(c.y)); assert.ok(c.x >= 0 && c.x < map.cols && c.y >= 0 && c.y < map.rows); }
  const kinds = new Set(map.places.map((p) => p.kind));
  assert.ok(map.places.some((p) => p.kind === 'town' || p.kind === 'castle'), 'トピックは街・城');
  for (const k of kinds) assert.ok(['town', 'castle', 'spot'].includes(k), k);
  const pts = app.getState().scenes.flatMap((s) => s.points);
  assert.equal(map.places.filter((p) => p.kind === 'spot').length, pts.length, '要点ごとに地点');
  assert.ok(map.roads.length >= 1, '関係線は道');
  const ids = new Set(map.places.map((p) => p.id));
  for (const r of map.roads) { assert.ok(ids.has(r.from) && ids.has(r.to), '道は地点・街・城を結ぶ'); }
});

test('FR-047 AC-214: 切り替えても内容・配置・選択・記録中の状態・図の文字は変わらず、他の 3 つのスタイルの見た目は変わらない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  toDetail(app);
  app.selectScene(app.getState().scenes[1].id);
  app.setDraft('入力中の文字');
  const base = { svg: app.renderSvg(), layout: JSON.stringify(app.getDiagramLayout()), out: app.renderOutline(), snap: snap(app) };
  const others = {};
  for (const id of ['anime', 'simple', 'handwritten']) { app.setDrawStyle(id); others[id] = app.renderSvg(); }
  assert.ok(app.setDrawStyle('rpg').ok);
  const svg = app.renderSvg();
  assert.notEqual(svg, base.svg, '見た目が変わる');
  assert.deepEqual(svgTexts(svg), svgTexts(base.svg), '図の文字は変わらない');
  assert.equal(JSON.stringify(app.getDiagramLayout()), base.layout, '配置・型は変わらない');
  assert.equal(app.renderOutline(), base.out);
  assert.equal(snap(app), base.snap, '内容・選択・記録中の状態は保たれる');
  for (const id of ['anime', 'simple', 'handwritten']) { app.setDrawStyle(id); assert.equal(app.renderSvg(), others[id], `${id} の見た目は変わらない`); }
  assert.equal(app.renderSvg(), base.svg, '手書き調（既定）は元のまま');
});

test('FR-047 AC-214 異常系: 小文字違い・空・不正値の ID では RPG風にならず、現在のスタイルは変わらない', async () => {
  const { app } = await newApp();
  for (const bad of ['RPG', 'Rpg', ' rpg', 'rpg ', '', null, undefined, 4, ['rpg']]) {
    let r; try { r = app.setDrawStyle(bad); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, String(bad));
  }
  assert.equal(app.getDrawStyle(), 'handwritten');
  assert.equal(app.getRpgMap(), null);
});

// FR-048 AC-217
test('FR-048 AC-217: 勇者 1 体と、村人・兵士の住人が街・城に配置されて描かれる', async () => {
  const { app } = await rpgApp();
  const map = app.getRpgMap();
  assert.ok(map.hero && Number.isInteger(map.hero.x) && Number.isInteger(map.hero.y), '勇者は 1 体');
  assert.ok(map.residents.length >= 1);
  const kinds = new Set(map.residents.map((r) => r.kind));
  for (const k of kinds) assert.ok(['villager', 'soldier'].includes(k), k);
  for (const r of map.residents) {
    const c = map.cells.find((c) => c.x === r.x && c.y === r.y);
    assert.ok(c && (c.area === 'town' || c.area === 'castle'), '住人は街・城のマスにいる');
  }
  const svg = app.renderSvg();
  assert.equal((svg.match(/data-rpg-hero/g) || []).length, 1, '描かれる勇者は 1 体');
  assert.equal((svg.match(/data-rpg-resident/g) || []).length, map.residents.length, '住人の数だけ描かれる');
  assert.match(svg, /data-rpg-resident[^>]*data-kind="(villager|soldier)"/);
});

test('FR-048 AC-217: 勇者は上下左右の向きが見分けられ、移動するとき歩行の絵が切り替わる', async () => {
  const { app } = await rpgApp();
  const seenDirs = new Map();
  const frames = [];
  for (let i = 0; i < 40 && seenDirs.size < 4; i++) {
    const map = app.getRpgMap();
    for (const d of ['up', 'down', 'left', 'right']) {
      const before = app.getRpgMap().hero;
      const r = app.rpgPress(d);
      const h = app.getRpgMap().hero;
      assert.equal(h.dir, d, `${d} を押すと勇者はその向き`);
      const m = app.renderSvg().match(/data-rpg-hero[^>]*/)[0];
      assert.match(m, new RegExp(`data-dir="${d}"`), '図の勇者も向きを示す');
      if (!seenDirs.has(d)) seenDirs.set(d, m.replace(/data-(x|y|frame)="[^"]*"/g, ''));
      if (h.x !== before.x || h.y !== before.y) frames.push(h.frame);
      assert.ok(r && typeof r.ok === 'boolean');
    }
    void map;
  }
  assert.equal(new Set([...seenDirs.values()]).size, 4, '4 方向の絵が互いに異なる');
  assert.ok(frames.length >= 2, '移動できた');
  assert.ok(new Set(frames).size >= 2, `歩行の絵が切り替わる（${frames.join(',')}）`);
});

// FR-049 AC-219
test('FR-049 AC-219: 操作前は音が始まらず、操作の後に勇者のいる場所に応じた BGM が鳴り、場所が変わると切り替わる', async () => {
  const { app } = await rpgApp();
  let a = app.getRpgAudio();
  assert.equal(a.started, false, '操作前は始まらない');
  assert.equal(a.bgm, null);
  app.rpgPress('b');
  a = app.getRpgAudio();
  assert.equal(a.started, true, '操作の後に始まる');
  let map = app.getRpgMap();
  const area0 = cellArea(map, map.hero);
  assert.ok(['field', 'town', 'castle'].includes(area0));
  assert.equal(a.bgm, area0, '勇者のいる場所の BGM');
  const path = findPath(map, (x, y, c) => c && c.area !== area0);
  assert.ok(path, '別の場所へ行ける');
  walk(app, path);
  map = app.getRpgMap();
  const area1 = cellArea(map, map.hero);
  assert.notEqual(area1, area0);
  assert.equal(app.getRpgAudio().bgm, area1, '場所が変わると BGM が切り替わる');
});

test('FR-049 AC-219 異常系: 描画スタイルが RPG風でないとき、操作しても音は始まらない', async () => {
  const { app } = await newApp();
  assert.equal(app.getRpgAudio().started, false);
  app.handleKey({ key: 'ArrowUp' });
  app.rpgPress('a');
  assert.equal(app.getRpgAudio().started, false);
  assert.equal(app.getRpgAudio().bgm, null);
});

// FR-049 AC-221
test('FR-049 AC-221: ミュートと音量の変更ができ、ミュート中は音が出ない。音量の初期値は 50 %', async () => {
  const { app } = await rpgApp();
  let a = app.getRpgAudio();
  assert.equal(a.volume, 50);
  assert.equal(a.muted, false);
  app.rpgPress('b');
  assert.equal(app.getRpgAudio().audible, true, '操作後は音が出る');
  assert.ok(app.setRpgVolume(80).ok);
  assert.equal(app.getRpgAudio().volume, 80);
  assert.ok(app.setRpgMuted(true).ok);
  a = app.getRpgAudio();
  assert.equal(a.muted, true);
  assert.equal(a.audible, false, 'ミュート中は音が出ない');
  app.rpgPress('a'); app.rpgPress('b');
  assert.equal(app.getRpgAudio().audible, false);
  assert.ok(app.setRpgMuted(false).ok);
  assert.equal(app.getRpgAudio().audible, true);
  assert.equal(app.getRpgAudio().volume, 80, 'ミュートの解除で音量は保たれる');
});

test('FR-049 AC-221 異常系: 範囲外・不正な音量・真偽以外のミュートは受け付けず、状態は変わらない', async () => {
  const { app } = await rpgApp();
  for (const bad of [-1, 101, NaN, 'loud', null, undefined, [50]]) {
    let r; try { r = app.setRpgVolume(bad); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, String(bad));
  }
  assert.equal(app.getRpgAudio().volume, 50);
  for (const bad of ['yes', 1, null, undefined]) {
    let r; try { r = app.setRpgMuted(bad); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, String(bad));
  }
  assert.equal(app.getRpgAudio().muted, false);
  assert.ok(app.setRpgVolume(0).ok && app.setRpgVolume(100).ok, '境界値 0・100 は受け付ける');
});

// FR-051 AC-226
test('FR-051 AC-226: RPG風を選んでいるときも、テキスト一覧に図と同じ内容が示され、キーボードだけで確認できる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  toDetail(app);
  const before = app.renderOutline();
  app.setDrawStyle('rpg');
  const out = app.renderOutline();
  assert.equal(out, before, 'テキスト一覧は他のスタイルと同じ内容・順序');
  const text = plain(out);
  let last = -1;
  for (const s of app.getState().scenes) {
    const i = text.indexOf(s.heading);
    assert.ok(i > last, `見出し「${s.heading}」が時系列順にある`); last = i;
    for (const p of s.points) assert.ok(text.includes(p.text), `要点「${p.text}」`);
  }
  const svg = app.renderSvg();
  for (const s of app.getState().scenes) { assert.ok(svg.includes(s.heading)); for (const p of s.points) assert.ok(svg.includes(p.text)); }
  assert.equal(app.getRpgMap().hero != null, true);
});

test('FR-051 AC-226: 地図・音・仮想パッドを使わなくても（ミュート・操作なし）テキスト一覧は変わらず、色だけで要点の種類を示さない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  toDetail(app);
  app.setDrawStyle('rpg');
  const out = app.renderOutline();
  app.setRpgMuted(true);
  assert.equal(app.renderOutline(), out);
  const kinds = new Map();
  for (const p of app.getDiagramStyle().scenes.flatMap((s) => s.points)) if (!kinds.has(p.kind)) kinds.set(p.kind, p);
  const list = [...kinds.values()];
  assert.ok(list.length >= 2);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(list[i].shape !== list[j].shape || list[i].icon !== list[j].icon, '色以外（形・絵記号）でも異なる');
});

function cellArea(map, h) { const c = map.cells.find((c) => c.x === h.x && c.y === h.y); return c && c.area; }
