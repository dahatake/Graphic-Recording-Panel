// NFR-UX-012 AC-465 AC-466 / NFR-UX-001 AC-061 / FR-075 AC-406 AC-407 の単体・結合テスト
// （日本語の文字の書体 Yu Gothic UI。System Test は tests/system/jpfont.test.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newApp, seedThreeScenes, toDetail } from '../system/helpers.js';
import { makeRecordingCanvas, familiesOfFont } from '../system/jpfont-util.js';
import {
  JP_FONT, LATIN_ONLY_FONTS, isLatinOnlyFont, jpFontOrder, fontFamilyValue, LEGACY_FONT_NAMES, LEGACY_FONT_FAMILY, FONT_STACKS, fontFamilyOf,
} from '../../web/src/stylepresets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const names = (s) => s.split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, ''));

// NFR-UX-012 AC-466: 並べ替えの規則（欧文専用の書体は従来の順のまま → Yu Gothic UI → 残りは従来の順のまま）
test('NFR-UX-012 AC-466: jpFontOrder は欧文専用の書体（PARAM-093）→ Yu Gothic UI → 残りの順にし、足さず抜かない', () => {
  assert.deepEqual(LATIN_ONLY_FONTS, ['Segoe UI', 'Segoe UI Variable', 'Segoe Print', 'Ink Free', 'Arial Rounded MT Bold']);
  assert.equal(isLatinOnlyFont(' segoe ui '), true);
  assert.equal(isLatinOnlyFont('system-ui'), false);
  assert.deepEqual(jpFontOrder(['A', 'Ink Free', 'Yu Gothic UI', 'B', 'Segoe Print']), ['Ink Free', 'Segoe Print', JP_FONT, 'A', 'B']);
  // 従来の並びに Yu Gothic UI がなくても 1 つだけ置く
  assert.deepEqual(jpFontOrder(['Klee One', 'sans-serif']), [JP_FONT, 'Klee One', 'sans-serif']);
  // 欧文専用の書体がない並びは Yu Gothic UI が先頭
  assert.deepEqual(LEGACY_FONT_NAMES, [JP_FONT, 'system-ui', 'Hiragino Sans', 'Meiryo', 'sans-serif']);
  assert.equal(LEGACY_FONT_FAMILY, "'Yu Gothic UI', system-ui, 'Hiragino Sans', Meiryo, sans-serif");
  assert.equal(fontFamilyValue(['Segoe UI', 'sans-serif']), "'Segoe UI', sans-serif");
});

// NFR-UX-012 AC-466 / FR-075 AC-407: 書体の系統の並び
test('NFR-UX-012 AC-466 FR-075 AC-407: 書体の系統の並びは欧文専用の書体の次に Yu Gothic UI、系統の順は保つ', () => {
  const n = (k) => FONT_STACKS[k].map((f) => f.name);
  assert.deepEqual(n('handwriting'), ['Segoe Print', 'Ink Free', 'Arial Rounded MT Bold', JP_FONT, 'Klee One', 'Klee', 'Yomogi', 'Zen Kurenaido',
    'Zen Maru Gothic', 'M PLUS Rounded 1c', 'Kosugi Maru', 'Hiragino Maru Gothic ProN', 'sans-serif']);
  assert.deepEqual(n('roundGothic'), ['Arial Rounded MT Bold', JP_FONT, 'Zen Maru Gothic', 'M PLUS Rounded 1c', 'Kosugi Maru', 'Hiragino Maru Gothic ProN', 'sans-serif']);
  assert.deepEqual(n('gothic'), [JP_FONT, 'BIZ UDPGothic', 'Hiragino Sans', 'Meiryo', 'Noto Sans JP', 'sans-serif']);
  for (const k of Object.keys(FONT_STACKS)) {
    assert.equal(FONT_STACKS[k].filter((f) => f.name === JP_FONT).length, 1, k);
    assert.equal(FONT_STACKS[k].at(-1).kind, 'generic', k);
    assert.deepEqual(names(fontFamilyOf(k)), n(k), `${k}: SVG の値も同じ並び`);
  }
});

// NFR-UX-012 AC-465 / NFR-UX-001 AC-061: 画面の書体の指定
test('NFR-UX-012 AC-465 NFR-UX-001 AC-061: 画面の --font-sans は Segoe UI 系 → Yu Gothic UI → システムの書体・日本語の書体', () => {
  const css = fs.readFileSync(path.join(ROOT, 'web', 'styles', 'tokens.css'), 'utf8');
  const m = /--font-sans\s*:\s*([^;]+);/.exec(css);
  assert.ok(m);
  assert.deepEqual(names(m[1]), ['Segoe UI', 'Segoe UI Variable', JP_FONT, 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Hiragino Sans', 'Meiryo', 'sans-serif']);
  assert.ok(!/@font-face|url\(/i.test(css), '書体を同梱・取得しない');
});

// NFR-UX-012 AC-466 / FR-075 AC-406: 既存の 4 つの描画スタイルの図・PNG・PDF・RPG風の地図
test('NFR-UX-012 AC-466 FR-075 AC-406: 既存の 4 つの図（SVG）と PNG・PDF の Canvas の書体は Yu Gothic UI が先頭の並び', async () => {
  const canvas = makeRecordingCanvas();
  const { app, env } = await newApp({ options: { canvasFactory: canvas } });
  await seedThreeScenes(app, env);
  toDetail(app);
  for (const id of ['handwritten', 'anime', 'simple', 'rpg']) {
    assert.equal(app.setDrawStyle(id).ok, true, id);
    const svg = app.renderSvg();
    for (const ff of svg.matchAll(/font-family="([^"]*)"/g)) assert.deepEqual(names(ff[1]), LEGACY_FONT_NAMES, `${id}: SVG`);
    const n = canvas.log.fonts.length;
    await app.commands['save.png'](); await app.commands['save.pdf']();
    const fonts = canvas.log.fonts.slice(n);
    assert.ok(fonts.length >= 1, `${id}: Canvas に文字の書体の指定`);
    for (const f of fonts) assert.deepEqual(familiesOfFont(f), LEGACY_FONT_NAMES, `${id}: Canvas「${f}」`);
  }
});
