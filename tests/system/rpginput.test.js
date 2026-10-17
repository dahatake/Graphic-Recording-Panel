// FR-050 AC-223 / AC-224 / AC-225（System Test。契約: CONTRACT.md「RPG風の描画スタイル」）
// 期待値は受入基準だけから決める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpgApp, findPath, walk, plain, cellAt, isWalkableType, DIRS } from './rpg-util.js';

const pos = (app) => { const h = app.getRpgMap().hero; return `${h.x},${h.y}`; };
const KEYSETS = { up: ['ArrowUp', 'w', 'W'], down: ['ArrowDown', 's', 'S'], left: ['ArrowLeft', 'a', 'A'], right: ['ArrowRight', 'd', 'D'] };

// FR-050 AC-223
test('FR-050 AC-223: 矢印キー・W/A/S/D の各押下で勇者が 1 マスだけ移動する', async () => {
  const { app } = await rpgApp();
  for (const [dir, keys] of Object.entries(KEYSETS)) {
    for (const key of keys) {
      // その向きに通れるマスがある位置まで移動してから押す
      const map0 = app.getRpgMap();
      const [dx, dy] = DIRS[dir];
      const path = findPath(map0, (x, y) => isWalkableType(cellAt(map0, x + dx, y + dy)) && !map0.residents.some((r) => r.x === x + dx && r.y === y + dy));
      assert.ok(path, `${dir} に進める位置がある`);
      walk(app, path);
      const b = app.getRpgMap().hero;
      assert.equal(app.handleKey({ key }), `rpg.${dir}`, key);
      const a = app.getRpgMap().hero;
      assert.deepEqual([a.x, a.y], [b.x + dx, b.y + dy], `${key}: ちょうど 1 マス`);
      assert.equal(a.dir, dir);
    }
  }
});

test('FR-050 AC-223: Z・Enter は A ボタン、X・Esc は B ボタンの動作になる', async () => {
  const { app } = await rpgApp();
  for (const key of ['z', 'Z', 'Enter']) assert.equal(app.handleKey({ key }), 'rpg.a', key);
  for (const key of ['x', 'X', 'Escape']) assert.equal(app.handleKey({ key }), 'rpg.b', key);
});

test('FR-050 AC-223 異常系: 壁・水・建物の外壁・地図の範囲外へは移動せず、勇者の位置は変わらない', async () => {
  const { app } = await rpgApp();
  const map = app.getRpgMap();
  const blockedTypes = new Set(map.cells.filter((c) => !isWalkableType(c)).map((c) => c.type));
  assert.ok(blockedTypes.size >= 1, '通れないマスが描かれている');
  const outOfRange = (x, y) => !cellAt(map, x, y);
  const targets = [];
  for (const t of ['wall', 'water', 'building']) targets.push({ name: t, test: (x, y) => cellAt(map, x, y)?.type === t });
  targets.push({ name: '範囲外', test: outOfRange });
  let checked = 0;
  for (const tg of targets) {
    for (const [dir, [dx, dy]] of Object.entries(DIRS)) {
      const m = app.getRpgMap();
      const path = findPath(m, (x, y, c) => isWalkableType(c) && tg.test(x + dx, y + dy) && !m.residents.some((r) => r.x === x + dx && r.y === y + dy));
      if (!path) continue;
      walk(app, path);
      const before = pos(app);
      app.handleKey({ key: KEYSETS[dir][0] });
      assert.equal(pos(app), before, `${tg.name} へ ${dir} には進めない`);
      checked++;
      break;
    }
  }
  assert.ok(checked >= 1, '少なくとも 1 種類の通れないマスで確かめた');
});

test('FR-050 AC-223 異常系: テキスト入力欄にフォーカスがある間は、これらのキーを奪わない', async () => {
  const { app } = await rpgApp();
  const before = pos(app);
  for (const key of ['ArrowUp', 'ArrowLeft', 'w', 'a', 's', 'd', 'z', 'x', 'Enter']) {
    const r = app.handleKey({ key, inTextInput: true });
    assert.ok(!String(r ?? '').startsWith('rpg.'), `${key} は RPG の操作にならない`);
  }
  assert.equal(pos(app), before);
  assert.equal(app.getRpgDialog(), null);
  assert.equal(app.getRpgAudio().started, false, '文字入力は RPG の操作ではない');
});

test('FR-050 AC-223 異常系: 既存のポップアップ・ダイアログが開いている間は、既存の動作（Esc で閉じる）を優先する', async () => {
  const { app } = await rpgApp();
  const before = pos(app);
  app.commands['settings.open']();
  assert.ok(app.getSettingsDialog());
  for (const key of ['ArrowUp', 'ArrowRight', 'w', 'd', 'Enter', 'z']) {
    const r = app.handleKey({ key });
    assert.ok(!String(r ?? '').startsWith('rpg.'), `${key} は RPG の操作にならない`);
  }
  assert.equal(pos(app), before);
  assert.equal(app.handleKey({ key: 'Escape' }), 'settings.close');
  assert.equal(app.getSettingsDialog(), null);
  assert.equal(app.handleKey({ key: 'ArrowDown' }) != null, true, '閉じた後は RPG の操作が効く');
});

test('FR-050 AC-223 異常系: 地図にフォーカスがないときは RPG の操作にならない', async () => {
  const { app } = await rpgApp();
  app.setRpgFocus(false);
  const before = pos(app);
  for (const key of ['ArrowUp', 'w', 'Enter']) assert.ok(!String(app.handleKey({ key }) ?? '').startsWith('rpg.'), key);
  assert.equal(pos(app), before);
});

// FR-050 AC-224
test('FR-050 AC-224: 仮想の十字キーと A・B ボタンがあり、大きさは 44 px 以上', async () => {
  const { app } = await rpgApp();
  const pad = app.getRpgPad();
  assert.deepEqual(pad.buttons.map((b) => b.id).sort(), ['a', 'b', 'down', 'left', 'right', 'up']);
  for (const b of pad.buttons) {
    assert.ok(b.label && b.label.trim(), `${b.id} にラベル`);
    assert.ok(b.width >= 44 && b.height >= 44, `${b.id}: ${b.width}x${b.height}`);
  }
});

test('FR-050 AC-224: タッチ・マウスで AC-223 と同じ操作ができる（キー操作と同じ結果）', async () => {
  const k = await rpgApp();
  const p = await rpgApp();
  for (const dir of ['right', 'down', 'left', 'up', 'down', 'right']) {
    k.app.handleKey({ key: KEYSETS[dir][0] });
    const r = p.app.rpgPress(dir);
    assert.equal(r.ok, true);
    assert.deepEqual(p.app.getRpgMap().hero, k.app.getRpgMap().hero, dir);
  }
  const f = await rpgApp();
  const g = await rpgApp();
  f.app.handleKey({ key: 'Enter' }); g.app.rpgPress('a');
  f.app.handleKey({ key: 'Escape' }); g.app.rpgPress('b');
  assert.deepEqual(g.app.getRpgDialog(), f.app.getRpgDialog());
});

test('FR-050 AC-224 異常系: 未知のボタン名は何も変えない', async () => {
  const { app } = await rpgApp();
  const before = JSON.stringify(app.getRpgMap().hero);
  for (const bad of ['', 'start', 'UP', null, undefined, 1]) {
    let r; try { r = app.rpgPress(bad); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, String(bad));
  }
  assert.equal(JSON.stringify(app.getRpgMap().hero), before);
});

// FR-050 AC-225
async function talkSetup() {
  const ctx = await rpgApp();
  const { app } = ctx;
  const map = app.getRpgMap();
  let found = null;
  for (const r of map.residents) {
    for (const [dir, [dx, dy]] of Object.entries(DIRS)) {
      const gx = r.x - dx, gy = r.y - dy;
      const c = cellAt(map, gx, gy);
      if (!isWalkableType(c) || map.residents.some((o) => o.x === gx && o.y === gy)) continue;
      const path = findPath(map, (x, y) => x === gx && y === gy);
      if (path) { found = { r, dir, path }; break; }
    }
    if (found) break;
  }
  assert.ok(found, '話しかけられる住人がいる');
  walk(app, found.path);
  app.rpgPress(found.dir); // 住人に向かう（進めなくても向きは変わる）
  assert.equal(app.getRpgMap().hero.dir, found.dir);
  return { ...ctx, resident: found.r };
}

const expectedFor = (state, refId) => {
  const sc = state.scenes.find((s) => s.id === refId);
  if (sc) return [sc.heading, ...sc.points.map((p) => p.text)];
  for (const s of state.scenes) { const p = s.points.find((q) => q.id === refId); if (p) return [p.text]; }
  return null;
};

test('FR-050 AC-225: 住人に向かって A ボタンを押すと、黒地に白枠のコマンドウィンドウが開く', async () => {
  const { app } = await talkSetup();
  assert.equal(app.getRpgDialog(), null, '話しかける前は開いていない');
  app.rpgPress('a');
  const d = app.getRpgDialog();
  assert.ok(d && d.open === true);
  assert.equal(d.theme.bg, '#000000');
  assert.equal(d.theme.frame, '#ffffff');
});

test('FR-050 AC-225: 対応するオブジェクトの見出し・要点が 1 文字 50 ms で 1 文字ずつ表示され、A で会話送り、最後の文の後で閉じる。内容はテキスト一覧と同じ', async () => {
  const { app, env, resident } = await talkSetup();
  const expected = expectedFor(app.getState(), resident.refId);
  assert.ok(expected && expected.length >= 1, '住人は図のオブジェクトに対応する');
  app.rpgPress('a');
  let d = app.getRpgDialog();
  assert.deepEqual(d.sentences, expected, '見出しと要点');
  assert.equal(d.shown, '', '開いた直後は 0 文字');
  env.scheduler.advance(49);
  assert.equal(app.getRpgDialog().shown, '', '50 ms 未満では増えない');
  env.scheduler.advance(1);
  assert.equal(app.getRpgDialog().shown, [...expected[0]][0], '50 ms で 1 文字');
  env.scheduler.advance(150);
  assert.equal(app.getRpgDialog().shown, [...expected[0]].slice(0, 4).join(''), '以後 1 文字ずつ');
  const outline = plain(app.renderOutline());
  for (let i = 0; i < expected.length; i++) {
    env.scheduler.advance(50 * ([...expected[i]].length + 2));
    d = app.getRpgDialog();
    assert.equal(d.index, i);
    assert.equal(d.shown, expected[i], `文 ${i} が全部表示される`);
    assert.ok(outline.includes(expected[i]), `「${expected[i]}」はテキスト一覧にもある`);
    app.rpgPress('a');
    if (i < expected.length - 1) { d = app.getRpgDialog(); assert.equal(d.index, i + 1, 'A で次の文へ'); assert.equal(d.shown, '', '次の文は 0 文字から'); }
  }
  assert.equal(app.getRpgDialog(), null, '最後の文の後で閉じる');
});

test('FR-050 AC-225: B ボタンで途中でも閉じる', async () => {
  const { app, env } = await talkSetup();
  app.rpgPress('a');
  env.scheduler.advance(100);
  assert.ok(app.getRpgDialog());
  app.rpgPress('b');
  assert.equal(app.getRpgDialog(), null);
  env.scheduler.advance(1000);
  assert.equal(app.getRpgDialog(), null, '閉じた後に文字が出続けない');
});

test('FR-050 AC-225 異常系: 住人のいない方向に A ボタンを押してもコマンドウィンドウは開かない', async () => {
  const { app } = await rpgApp();
  const map = app.getRpgMap();
  const path = findPath(map, (x, y, c) => c && c.area === 'field' && ![...Object.values(DIRS)].some(([dx, dy]) => map.residents.some((r) => r.x === x + dx && r.y === y + dy)));
  assert.ok(path);
  walk(app, path);
  app.rpgPress('a');
  assert.equal(app.getRpgDialog(), null);
});
