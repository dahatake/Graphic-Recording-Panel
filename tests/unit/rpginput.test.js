// FR-050 AC-223 AC-224 AC-225 AC-293 AC-294 / FR-051 AC-226 AC-227 AC-228 AC-296 の単体・結合テスト（RPG風の操作・会話・設定・保存）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpgApp, findPath, walk, cellAt, isWalkableType, DIRS } from '../system/rpg-util.js';
import { newApp } from '../system/helpers.js';

async function talk(over) {
  const ctx = await rpgApp(over);
  const { app } = ctx;
  const map = app.getRpgMap();
  for (const r of map.residents) {
    for (const [dir, [dx, dy]] of Object.entries(DIRS)) {
      const gx = r.x - dx, gy = r.y - dy;
      if (!isWalkableType(cellAt(map, gx, gy)) || map.residents.some((o) => o.x === gx && o.y === gy)) continue;
      const path = findPath(map, (x, y) => x === gx && y === gy);
      if (path) { walk(app, path); app.rpgPress(dir); return { ...ctx, resident: r }; }
    }
  }
  throw new Error('話しかけられる住人がいない');
}

// FR-050 AC-223: Shift つき（大文字）の W も十字キー。Ctrl・Alt つきは奪わない
test('FR-050 AC-223: Shift 付きの大文字は十字キー、Ctrl・Alt 付きは奪わない', async () => {
  const { app } = await rpgApp();
  assert.equal(app.handleKey({ key: 'W', shiftKey: true }), 'rpg.up');
  assert.ok(!String(app.handleKey({ key: 'z', ctrlKey: true }) ?? '').startsWith('rpg.'));
  assert.ok(!String(app.handleKey({ key: 'x', altKey: true, shiftKey: false }) ?? '').startsWith('rpg.'));
});

// FR-050 AC-224: 仮想ボタンは 44px 以上・名前つき
test('FR-050 AC-224: 仮想パッドは 6 ボタンで 44px 以上、言語で名前が変わる', async () => {
  const { app } = await rpgApp();
  const ja = app.getRpgPad().buttons;
  assert.equal(ja.length, 6);
  assert.ok(ja.every((b) => b.width >= 44 && b.height >= 44));
  app.setLang('en');
  assert.equal(app.getRpgPad().buttons.find((b) => b.id === 'up').label, 'Up');
});

// FR-050 AC-225 AC-293: 文字送り中の A で全文、その後の A で次の文、B で閉じる
test('FR-050 AC-293: 文字送り中に A で全文表示、B で閉じる', async () => {
  const { app, env } = await talk();
  app.rpgPress('a');
  env.scheduler.advance(100);
  const d0 = app.getRpgDialog();
  assert.ok(d0.shown.length >= 1 && d0.shown.length < d0.sentences[0].length);
  app.rpgPress('a');
  const d1 = app.getRpgDialog();
  assert.equal(d1.index, 0);
  assert.equal(d1.shown, d1.sentences[0]);
  env.scheduler.advance(1000);
  assert.equal(app.getRpgDialog().shown, d1.sentences[0], '全文表示後に変わらない');
  app.rpgPress('b');
  assert.equal(app.getRpgDialog(), null);
});

test('FR-050 AC-225: 会話中は十字キーで動かず、RPG風でなくなると会話は閉じる', async () => {
  const { app } = await talk();
  app.rpgPress('a');
  const before = JSON.stringify(app.getRpgMap().hero);
  assert.equal(app.rpgPress('left').moved, false);
  assert.equal(JSON.stringify(app.getRpgMap().hero), before);
  app.setDrawStyle('anime');
  assert.equal(app.getRpgDialog(), null);
});

// FR-050 AC-294: 動きを減らす設定では即時に全文
test('FR-050 AC-294: prefers-reduced-motion では文字送りせず全文を即時に表示する', async () => {
  const { app, env } = await talk({ options: { env: { webgl: true, reducedMotion: true, viewportWidth: 1280 } } });
  app.rpgPress('a');
  const d = app.getRpgDialog();
  assert.equal(d.shown, d.sentences[0]);
  app.rpgPress('a');
  if (app.getRpgDialog()) assert.equal(app.getRpgDialog().shown, app.getRpgDialog().sentences[app.getRpgDialog().index]);
  env.scheduler.advance(500);
});

// FR-051 AC-296: 既定の描画スタイルに RPG風を選べ、初めて図を開くと RPG風
test('FR-051 AC-296: 設定で既定の描画スタイルを rpg にすると、次に開いた図は RPG風', async () => {
  const a = await newApp();
  assert.ok(a.app.getDrawStyles().some((s) => s.id === 'rpg'));
  assert.equal(a.app.setSettings({ drawStyle: 'rpg' }).ok, true);
  const b = await a.createApp(a.env.options);
  assert.equal(b.getDrawStyle(), 'rpg');
  assert.ok(b.renderSvg().includes('data-draw-style="rpg"'));
});

// FR-051 AC-228: ミュート・音量は端末ごとに保存され、データの初期化では変わらない。初期値 50
test('FR-051 AC-228: 音量の初期値は 50、ミュート・音量は再読込後に復元される', async () => {
  const a = await newApp();
  assert.equal(a.app.getRpgAudio().volume, 50);
  assert.equal(a.app.setRpgVolume(30).ok, true);
  assert.equal(a.app.setRpgMuted(true).ok, true);
  const b = await a.createApp(a.env.options);
  assert.deepEqual([b.getRpgAudio().volume, b.getRpgAudio().muted], [30, true]);
});

// FR-051 AC-228 AC-227: 描画スタイルはセッションファイルで復元され、保存物は RPG風の見た目を反映する
test('FR-051 AC-227 AC-228: セッションファイルで描画スタイルが復元され、SVG 保存に RPG風が反映され外部リクエストがない', async () => {
  const { app, env, createApp } = await rpgApp();
  env.downloads.length = 0;
  await app.commands['file.save']();
  const file = env.downloads[0];
  env.downloads.length = 0;
  await app.commands['save.svg']();
  const svg = String(env.downloads[0].data);
  assert.ok(svg.includes('data-draw-style="rpg"'));
  assert.ok(!/(href|src)\s*=\s*["']https?:/i.test(svg) && !/url\(\s*["']?https?:/i.test(svg));
  const other = await createApp({ ...env.options, storage: new (env.storage.constructor)() });
  const r = await other.loadSessionFile({ name: file.filename, type: file.mime, size: Buffer.byteLength(String(file.data)), text: String(file.data) });
  assert.equal(r.ok, true);
  assert.equal(other.getDrawStyle(), 'rpg');
});
