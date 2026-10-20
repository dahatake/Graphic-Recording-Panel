// FR-075 AC-404 AC-405 AC-406 AC-407 / FR-076 AC-409 AC-410 AC-411 AC-412 AC-425 AC-456 の単体・結合テスト
// （画風プリセットの定義・検証・配色の役割・描画・後処理。System Test は tests/system/stylepreset.test.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from '../system/helpers.js';
import { createDrawStyleRegistry, validateStyle, BUILTIN_STYLES } from '../../web/src/drawstyles.js';
import {
  PRESET_STYLES, FONT_STACKS, fontFamilyOf, validatePresetFields, presetOf, contrastRatio, isYellowish, isNeutralColor, mix, grayOf,
  PAPERS, FONT_KINDS, HEADING_DECORATIONS, BALLOON_SHAPES,
} from '../../web/src/stylepresets.js';
import { buildLook, forcedLook, toSystemColors, finishPresetSvg, renderPresetDiagram } from '../../web/src/presetdiagram.js';
import { exportLook } from '../../web/src/export.js';

const PRESET = {
  id: 'ocean', label: { ja: '海風', en: 'Ocean' }, line: { width: 1, jitter: 0 }, fill: { mode: 'paper' }, text: { decor: 'bold', icons: true },
  palette: { background: '#f4fbff', primary: '#0b4f6c', accent: ['#ffd23f', '#3bceac'], text: '#102a43', secondary: '#9fb3c8' },
  paper: 'grid', font: 'roundGothic', headingDecoration: 'sticky', balloon: 'cloud', stroke: { wobble: 0.5, width: 2 }, figures: true, icons: true,
  description: { ja: { color: '青', drawing: '線', font: '丸', mood: '爽やか' }, en: { color: 'blue', drawing: 'lines', font: 'round', mood: 'fresh' } },
};
const attrsOf = (svg, role) => [...svg.matchAll(new RegExp(`<(\\w+)[^>]*data-style-role="${role}"[^>]*>`, 'g'))].map((m) => m[0]);

// FR-075 AC-404
test('FR-075 AC-404: 見た目の項目を持つ定義を 1 つ登録すると選択肢に現れ、選ぶとその配色・紙面・書体・見出しの飾り・吹き出しで図が描かれる', async () => {
  const { app, env } = await newApp({ options: { drawStyles: [PRESET] } });
  assert.ok(app.getDrawStyles().some((s) => s.id === 'ocean' && s.label === '海風'));
  await seedThreeScenes(app, env); toDetail(app);
  assert.equal(app.setDrawStyle('ocean').ok, true);
  const spec = app.getDrawStyleSpec('ocean');
  assert.equal(spec.preset, true);
  assert.deepEqual(spec.palette, PRESET.palette);
  const svg = app.renderSvg();
  assert.match(svg, /<svg [^>]*data-draw-style="ocean"[^>]*data-paper="grid"[^>]*data-font-kind="roundGothic"/);
  assert.ok(svg.includes(`font-family="${fontFamilyOf('roundGothic').replace(/'/g, "'")}"`));
  assert.match(svg, /data-style-role="paper-bg"[^>]*fill="#f4fbff"/);
  assert.ok(attrsOf(svg, 'heading-sticky').length >= 3, '見出しは付箋');
  assert.ok(attrsOf(svg, 'balloon').every((a) => /data-shape="cloud"/.test(a)) && attrsOf(svg, 'balloon').length >= 3, '雲形の吹き出し');
  assert.ok(attrsOf(svg, 'figure').length >= 3, '線画人物');
  // 既存の処理（設定・セッションの現在値）はそのまま使える
  assert.equal(app.setSettings({ drawStyle: 'ocean' }).ok, true);
  assert.equal(app.getSettings().drawStyle, 'ocean');
});

// FR-075 AC-404: 画風の記述は見た目を変えない（FR-078 が定義から取り出せる）
test('FR-075 AC-404: 画風の記述（4 軸・日本語と英語）は定義から取り出せ、記述だけを変えても図は同じ', async () => {
  const other = { ...PRESET, id: 'ocean2', label: { ja: '海風2', en: 'Ocean2' }, description: { ja: { color: 'x', drawing: 'y', font: 'z', mood: 'w' }, en: { color: 'x', drawing: 'y', font: 'z', mood: 'w' } } };
  const { app, env } = await newApp({ options: { drawStyles: [PRESET, other] } });
  await seedThreeScenes(app, env); toDetail(app);
  app.setDrawStyle('ocean'); const a = app.renderSvg();
  app.setDrawStyle('ocean2'); const b = app.renderSvg();
  assert.equal(a.replace(/ocean2?/g, ''), b.replace(/ocean2?/g, ''));
  for (const p of PRESET_STYLES) {
    const d = app.getDrawStyleSpec(p.id).description;
    for (const lang of ['ja', 'en']) for (const ax of ['color', 'drawing', 'font', 'mood']) assert.ok(d[lang][ax].trim(), `${p.id} ${lang}.${ax}`);
  }
  assert.equal(app.getDrawStyleSpec('nosuch'), null);
  assert.equal(app.getDrawStyleSpec(3), null);
  assert.equal(app.getDrawStyleSpec().id, 'ocean2', '引数なしは現在の描画スタイル');
});

// FR-075 AC-405
test('FR-075 AC-405: 値が不正な見た目の項目を持つ定義は理由とともに拒否され、既存の登録と選択は影響を受けない', () => {
  const reg = createDrawStyleRegistry();
  const before = JSON.stringify(reg.list());
  const cases = [
    [{ palette: { ...PRESET.palette, primary: undefined } }, 'invalid_palette'],
    [{ palette: { ...PRESET.palette, text: 'blue' } }, 'invalid_palette'],
    [{ palette: { ...PRESET.palette, accent: [] } }, 'invalid_palette'],
    [{ palette: { ...PRESET.palette, accent: ['#12345'] } }, 'invalid_palette'],
    [{ palette: 'x' }, 'invalid_palette'],
    [{ palette: { ...PRESET.palette, text: '#cccccc' } }, 'low_contrast'],
    [{ paper: 'canvas' }, 'invalid_paper'],
    [{ font: 'mincho' }, 'invalid_font'],
    [{ headingDecoration: 'ribbon' }, 'invalid_heading'],
    [{ balloon: 'square' }, 'invalid_balloon'],
    [{ stroke: { wobble: -1, width: 1 } }, 'invalid_stroke'],
    [{ stroke: { wobble: 0, width: 0 } }, 'invalid_stroke'],
    [{ figures: 'yes' }, 'invalid_figures'],
    [{ icons: 1 }, 'invalid_icons'],
    [{ description: { ja: { color: 'a' } } }, 'invalid_description'],
  ];
  for (const [over, reason] of cases) {
    const r = reg.register({ ...PRESET, id: `bad-${reason}`, ...over });
    assert.deepEqual(r, { ok: false, reason }, JSON.stringify(over));
  }
  assert.equal(JSON.stringify(reg.list()), before, '既存の登録は変わらない');
  assert.deepEqual(reg.register(PRESET), { ok: true });
  // AC-148 の検証（線・塗り・文字の飾りが欠けた定義は加えられない）はそのまま適用される
  assert.equal(validateStyle({ ...PRESET, id: 'x', line: undefined }).reason, 'missing_line');
  assert.deepEqual(validatePresetFields({ id: 'y' }), { ok: true }, '見た目の項目を持たない定義は対象外');
});

// FR-076 AC-409
test('FR-076 AC-409: 組込みは既存の 4 つの後に 9 つの風が並び、すべて検証に通り、候補の値だけを使う', () => {
  assert.deepEqual(BUILTIN_STYLES.slice(0, 4).map((s) => s.id), ['handwritten', 'anime', 'simple', 'rpg']);
  assert.equal(BUILTIN_STYLES.length, 13);
  for (const p of PRESET_STYLES) {
    assert.equal(validateStyle(p).ok, true, p.id);
    assert.ok(PAPERS.includes(p.paper) && FONT_KINDS.includes(p.font) && HEADING_DECORATIONS.includes(p.headingDecoration) && BALLOON_SHAPES.includes(p.balloon), p.id);
    assert.ok([...p.label.ja].length <= 6 && p.label.en.length <= 12, `${p.id}: 名前の長さ`);
  }
  for (const k of FONT_KINDS) assert.equal(FONT_STACKS[k].at(-1).kind, 'generic');
  assert.equal(fontFamilyOf('handwriting').split(',')[0], "'Klee One'");
  assert.ok(!fontFamilyOf('gothic').includes('url('));
});

// FR-076 AC-410: 配色の役割の判読性（文字 4.5:1・輪郭 3:1・黄の面は黒かグレーの輪郭・黄の上は黒）
test('FR-076 AC-410: 9 つの風の配色の役割は、面の上の文字が 4.5:1 以上、枠・面の輪郭と紙面が 3:1 以上になる', () => {
  for (const p of PRESET_STYLES) {
    const L = buildLook(p);
    const surfaces = [L.bg, L.frameFill, L.emph, L.headSticky, ...(L.stickyFills ?? []), L.iconFill(0), L.iconFill(1), L.iconFill(2)];
    if (L.balloonFill !== 'none') surfaces.push(L.balloonFill);
    for (const s of surfaces) {
      assert.ok(contrastRatio(L.textOn(s), s) >= 4.5, `${p.id}: ${L.textOn(s)} on ${s}`);
      assert.ok(contrastRatio(L.outlineOf(s), L.bg) >= 3, `${p.id}: 輪郭 ${L.outlineOf(s)}`);
      if (isYellowish(s)) { assert.ok(isNeutralColor(L.outlineOf(s)), `${p.id}: 黄の面の輪郭は無彩色`); assert.ok(isNeutralColor(L.textOn(s)) && contrastRatio(L.textOn(s), '#000000') < 1.5, `${p.id}: 黄の上は黒`); }
    }
    assert.ok(contrastRatio(L.bandText, L.band) >= 4.5, `${p.id}: 帯の文字`);
    assert.ok(contrastRatio(L.frame, L.bg) >= 3, `${p.id}: 枠`);
  }
  // 色の計算
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(grayOf('#ff0000'), '#4c4c4c');
  assert.equal(isYellowish('#ffd400'), true); assert.equal(isYellowish('#c8a27a'), false); assert.equal(isYellowish('#1e3d2f'), false);
});

// FR-076 AC-411 AC-425: 同梱部品などの黄の面にも輪郭線を付け、単色の風は無彩色に寄せる
test('FR-076 AC-411: 後処理は黄の面に無彩色の輪郭線と役割を付け、単色の風では色を無彩色にする', () => {
  const yb = buildLook(PRESET_STYLES.find((p) => p.id === 'yellowBlack'));
  const out = finishPresetSvg('<svg><circle cx="1" cy="1" r="1" fill="#ffe066"/><rect fill="#ffffff"/></svg>', yb);
  assert.match(out, /<circle cx="1" cy="1" r="1" fill="#ffe066" stroke="#1a1a1a" stroke-width="1.5" data-style-role="part"\/>/);
  assert.match(out, /<rect fill="#ffffff"\/>/);
  const mono = buildLook(PRESET_STYLES.find((p) => p.id === 'minimal'));
  assert.equal(mono.mono, true);
  const m = finishPresetSvg('<svg><path fill="#e03131" stroke="#1971c2"/></svg>', mono);
  for (const c of m.match(/#[0-9a-f]{6}/g)) assert.ok(isNeutralColor(c), c);
});

// FR-076 AC-456
test('FR-076 AC-456: 強制カラーの変換は、すべての色の属性と style をシステム色にし、明暗の関係を保つ', () => {
  const svg = '<svg><rect fill="#ffffff" stroke="#1346a8"/><text fill="#ffffff">a</text><text fill="#15191f">b</text><path data-x="p>q" fill="#0b5d2a" style="fill:#ffe066;stroke:#000"/><stop stop-color="#123456"/><g color="white" fill="none" stroke="currentColor"/><rect fill="url(#p)"/></svg>';
  const out = toSystemColors(svg);
  assert.match(out, /<rect fill="Canvas" stroke="CanvasText"\/>/);
  assert.match(out, /<text fill="Canvas">a<\/text><text fill="CanvasText">b<\/text>/);
  assert.match(out, /<path data-x="p>q" fill="CanvasText" style="fill:Canvas;stroke:CanvasText"\/>/);
  assert.match(out, /<stop stop-color="CanvasText"\/>/);
  assert.match(out, /<g color="Canvas" fill="none" stroke="currentColor"\/>/);
  assert.match(out, /<rect fill="Canvas"\/>/);
  const f = forcedLook(PRESET_STYLES[1]);
  assert.equal(f.bg, 'Canvas'); assert.equal(f.textOn('CanvasText'), 'Canvas');
});

// FR-076 AC-412 AC-425: 決定的で、絵記号・線画人物は文字に重ならない
test('FR-076 AC-412 AC-425: 描画は決定的で、絵記号・線画人物の外接矩形は文字の外接矩形と重ならない', () => {
  const scenes = [
    { id: 'a', status: 'confirmed', heading: '予算を決める', points: [{ id: 'a1', text: '予算を決めました' }, { id: 'a2', text: 'コストが高くて困った' }], relations: [{ from: 'a1', to: 'a2' }] },
    { id: 'b', status: 'in_progress', heading: 'Next step', points: [{ id: 'b1', text: 'How about a pilot?' }], relations: [] },
  ];
  const rel = [{ from: 'a2', to: 'b1', kind: 'problem-proposal', kindLabel: '課題→提案', basis: 'inferred', basisLabel: '推測' }];
  for (const p of PRESET_STYLES) {
    const look = buildLook(p);
    const a = renderPresetDiagram(scenes, { lang: 'ja', relations: rel }, look);
    const b = renderPresetDiagram(JSON.parse(JSON.stringify(scenes)), { lang: 'ja', relations: rel }, look);
    assert.equal(a.body, b.body, `${p.id}: 決定的`);
    const boxOf = (s) => s.split(' ').map(Number);
    const texts = [...a.body.matchAll(/<text [^>]*data-box="([^"]+)"/g)].map((m) => boxOf(m[1]));
    const blocks = [...a.body.matchAll(/data-style-role="(?:icon|figure)"[^>]*data-box="([^"]+)"/g)].map((m) => boxOf(m[1]));
    assert.ok(texts.length > 0 && blocks.length > 0);
    for (const q of blocks) for (const t of texts) {
      const ov = Math.min(q[0] + q[2], t[0] + t[2]) > Math.max(q[0], t[0]) && Math.min(q[1] + q[3], t[1] + t[3]) > Math.max(q[1], t[1]);
      assert.equal(ov, false, `${p.id}: ${q} / ${t}`);
    }
  }
  assert.equal(presetOf({ id: 'x' }), null);
  assert.equal(presetOf({ id: 'x', paper: 'kraft', line: { width: 1, jitter: 0.5 } }).stroke.wobble, 0.5);
});

// FR-075 AC-407: PNG の保存も風の配色を使い、外部の書体を取得しない
test('FR-075 AC-407: 風を選んでいるとき PNG の保存は風の紙面と文字の色を使う', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  app.setDrawStyle('chalkboard');
  // 保存の配色は export.js の exportLook（契約の getDrawStyleSpec(id) と buildLook から。FR-077 で PNG・PDF の描画を 1 つにまとめた）
  const look = exportLook(app.getDrawStyleSpec('chalkboard'));
  assert.equal(look.background, '#1e3d2f');
  assert.match(look.fontFamily, /sans-serif$/);
  await app.commands['save.png']();
  assert.equal(env.downloads.at(-1).mime, 'image/png');
  assert.ok(env.canvasFactory.log.texts.length > 0);
  app.setDrawStyle('handwritten');
  assert.equal(exportLook(app.getDrawStyleSpec('handwritten')), null);
});
