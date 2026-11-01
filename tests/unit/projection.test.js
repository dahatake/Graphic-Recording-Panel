// FR-100 AC-589〜AC-591 の単体・結合テスト（投影のプリセットと、最小文字サイズを下回る要素の警告。プレゼンテーションの文字の下限）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from '../system/helpers.js';
import { PROJECTION_PRESETS, PRESENTATION_MIN_PX, findSmallText, presentationFontPx, toFigureWidthPx, presetById, PROJECTION_KEY } from '../../web/src/projection.js';
import { buildHtml, SLIDE_ITEM_MAX } from '../../web/src/presentexport.js';

// FR-100 AC-591: 判定は決定的（同じ入力から同じ警告）。プリセットの最小文字サイズは換算しない（PARAM-138）
test('FR-100 AC-591: findSmallText は決定的で、プリセットの最小文字サイズ（18・28・40）を下回る要素だけを返す', () => {
  assert.deepEqual(PROJECTION_PRESETS.map((p) => [p.id, p.widthPx, p.distanceM, p.minPx]), [['meeting-small', 1280, 3, 18], ['meeting-large', 1920, 8, 28], ['hall', 1920, 15, 40]]);
  const els = [{ id: 'a', name: 'A', size: 14 }, { id: 'b', name: 'B', size: 20 }, { id: 'c', name: 'C', size: 28 }, { id: 'd', name: 'D', size: 40 }];
  const ids = (p) => findSmallText(els, presetById(p)).map((w) => w.id);
  assert.deepEqual(ids('meeting-small'), ['a']);
  assert.deepEqual(ids('meeting-large'), ['a', 'b']);
  assert.deepEqual(ids('hall'), ['a', 'b', 'c']);
  assert.deepEqual(findSmallText(els, null), [], 'プリセットを使わないときは警告が出ない');
  assert.deepEqual(findSmallText(els, presetById('hall')), findSmallText(els, presetById('hall')));
  assert.equal(toFigureWidthPx(12, 960, 1920), 24, '表示される文字は図の幅に換算して比べる');
});

// FR-100 AC-590: プレゼンテーションの文字は 24 px を下回らず、プリセットを選んでいても下限は変わらない（警告だけがプリセットの最小を使う）
test('FR-100 AC-590: プレゼンテーションの下限は 24 px のまま。プリセット（28・40）の警告は 24 px の表示にも出てよい', () => {
  assert.equal(PRESENTATION_MIN_PX, 24);
  assert.equal(presentationFontPx(14), 24);
  assert.equal(presentationFontPx(30), 30, '大きい文字は縮めない');
  const w = findSmallText([{ id: 'a', name: 'A', size: 14 }, { id: 'b', name: 'B', size: 30 }], presetById('meeting-large'), { presenting: true });
  assert.deepEqual(w.map((x) => [x.id, x.size, x.min]), [['a', 24, 28]]);
  assert.deepEqual(findSmallText([{ id: 'a', name: 'A', size: 14 }], presetById('meeting-small'), { presenting: true }), [], '24 px は 18 px 以上');
});

test('FR-100 AC-590: HTML プレゼンテーションの文字は 1.25vw（1920 px で 24 px）以上で、項目が多いときは縮めず次のスライドへ分ける（要点は省かない）', () => {
  const pts = Array.from({ length: SLIDE_ITEM_MAX + 3 }, (_, i) => ({ id: `p${i}`, text: `要点${i}` }));
  const html = buildHtml({ scenes: [{ id: 's1', heading: 'H', points: pts }], topics: [{ id: 't1', title: 'T', sceneIds: ['s1'] }], title: 'M', svgOf: () => '<svg></svg>', labels: { auto: 'A', hint: 'h' } });
  assert.match(html, /html\{font-size:max\(1\.25vw,16px\)\}/);
  for (const m of html.matchAll(/font-size:([\d.]+)rem/g)) assert.ok(Number(m[1]) >= 1, `rem は 1 以上: ${m[1]}`);
  assert.equal((html.match(/data-topic-id=/g) || []).length, 1, 'トピックの枚数は変わらない');
  assert.equal((html.match(/data-slide-continued=/g) || []).length, 1, '続きのスライドへ分ける');
  for (const p of pts) assert.ok(html.includes(`<li>${p.text}</li>`), p.text);
});

// FR-100 AC-589: 設定で選ぶ → 小さい文字の要素に警告（図・テキスト一覧・状態）。保存物は変えない。端末ごとに保存
test('FR-100 AC-589: プリセットを選ぶと小さい文字の要素に警告が付き、テキスト一覧に同じ語・名前・現在の大きさ・最小の大きさが出る。既定は使わない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  assert.equal(app.getProjectionPreset().id, null, '既定は使わない');
  assert.equal(app.getProjectionWarnings().count, 0);
  const savedBefore = app.renderSvg();
  const outlineBefore = app.renderOutline();
  assert.doesNotMatch(outlineBefore, /小さい文字/);

  assert.deepEqual(app.setProjectionPreset('hall'), { ok: true });
  const w = app.getProjectionWarnings();
  assert.equal(w.minPx, 40);
  assert.ok(w.count > 0);
  const first = w.items.find((x) => x.kind === 'point');
  const outline = app.renderOutline();
  assert.ok(outline.includes('小さい文字'));
  assert.ok(outline.includes(`現在 ${first.size} px／最小 40 px`));
  assert.ok(outline.includes('data-projection-warn="1"'));
  assert.ok(app.getState().message.text.includes('40 px'), '状態の読み上げ（メッセージ）');
  assert.equal(app.renderSvg(), savedBefore, '警告は保存物の図（PNG・SVG・PDF の元）を変えない');

  assert.deepEqual(app.setProjectionPreset('bogus'), { ok: false, reason: 'unknown' });
  assert.equal(app.getProjectionPreset().id, 'hall', '不正な値は直前の値を保つ');
  assert.deepEqual(app.setProjectionPreset('none'), { ok: true });
  assert.equal(app.getProjectionWarnings().count, 0);
  assert.equal(app.renderOutline(), outlineBefore);
});

test('FR-100 AC-589: 設定画面の項目に選択肢があり、選んだプリセットは端末ごとに保存されて再起動後も残る', async () => {
  const ctx = await newApp();
  const { app } = ctx;
  app.commands['settings.open']?.();
  const f = app.getSettingsDialog()?.fields.find((x) => x.id === 'projection.preset');
  if (f) assert.deepEqual(f.options.map((o) => o.value), ['none', 'meeting-small', 'meeting-large', 'hall']);
  app.setProjectionPreset('meeting-large');
  assert.equal(JSON.parse(ctx.env.storage.getItem(PROJECTION_KEY)).presetId, 'meeting-large');
  const again = await newApp({ storage: ctx.env.storage });
  assert.equal(again.app.getProjectionPreset().id, 'meeting-large');
});
