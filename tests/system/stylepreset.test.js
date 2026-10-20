// FR-075 AC-406 AC-407 / FR-076 AC-408 AC-409 AC-410 AC-411 AC-412 AC-413 AC-425 AC-456 / NFR-UX-001 AC-061
// （System Test。契約: tests/system/CONTRACT-STYLE-PRESET.md）
// 期待値は要求定義書（FR-075・FR-076・3.6 の表）の受入基準だけから決める。実装がなければ失敗するのが正常（not_run → 実装後に pass）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newApp, seedThreeScenes, toDetail, WEB, ROOT, pdfTexts, bytesToLatin1 } from './helpers.js';
import {
  LEGACY, PRESETS, PAPERS, FONTS, HEADINGS, BALLOONS, SYSTEM_COLORS, PARAM_007, PARAM_083,
  rgb, lum, contrast, isYellow, isBlack, isGray, isBlackOrGray, isWhite, isNeutral,
  parseSvg, box, overlapArea, descendants, median, fontList, svgTextSet, presetIds, seededApp, usePreset, pointsOf, stateTexts,
} from './stylepreset-util.js';
import { YU, TRADITIONAL, expectedStack, assertJpOrder } from './jpfont-util.js';

const YB = '黄黒手書き風';
// 通常の吹き出し（感情語を含むトピックの吹き出し data-balloon-kind="emotion" は AC-467 で確かめる）
const normalBalloons = (doc) => doc.role('balloon').filter((b) => b.attrs['data-balloon-kind'] !== 'emotion');
// 書体の系統の並び（AC-407・AC-408）: Yu Gothic UI の前（欧文専用の書体）と後（日本語の字形を持ち得る書体）のそれぞれで系統の順を保つ（AC-466）
function assertKindOrder(stack, family, where) {
  const i = assertJpOrder(stack.map((f) => f.name), where);
  const latin = stack.slice(0, i).map((f) => `${f.kind} `).join('');
  const jp = stack.slice(i + 1).map((f) => f.kind).join(' ');
  if (family === 'handwriting') {
    assert.match(latin, /^(handwriting )*(roundGothic )*$/, `${where}: 欧文専用の書体の中で手書き風→丸ゴシック: ${latin}`);
    assert.match(jp, /^(handwriting )+(roundGothic )+generic$/, `${where}: 手書き風→丸ゴシック→標準: ${jp}`);
  } else if (family === 'roundGothic') {
    assert.match(latin, /^(roundGothic )*$/, `${where}: 欧文専用の書体は丸ゴシック: ${latin}`);
    assert.match(jp, /^(roundGothic )+generic$/, `${where}: 丸ゴシック→標準: ${jp}`);
  }
  assert.deepEqual(stack.map((f) => f.name), expectedStack(TRADITIONAL[family]), `${where}: 従来の並びの欧文専用の書体→Yu Gothic UI→残り（NFR-UX-012）`);
}
const GOLDEN = path.join(ROOT, 'tests', 'system', 'golden', 'fr075-legacy');
const nl = (s) => String(s).replace(/\r\n/g, '\n');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const num = (v) => Number.parseFloat(v);
const weightOf = (n) => num(n.attrs['font-weight']);

async function withNetSpy(fn) {
  const calls = []; const saved = {};
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: function (...a) { calls.push({ k, a }); throw new Error('network ' + k); } });
  }
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { ...(nav?.value || {}), sendBeacon: (...a) => { calls.push({ k: 'sendBeacon', a }); return false; } } });
  try { await fn(); } finally {
    for (const k of Object.keys(saved)) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
  }
  return calls;
}

// 図の中に外部の素材・外部の参照がない（AC-407・AC-425・AC-061）
function assertNoExternal(svg, where) {
  const s = svg.replace(/xmlns(:\w+)?\s*=\s*["'][^"']*["']/g, '');
  assert.ok(!/<image\b/i.test(s), `${where}: <image> がない`);
  assert.ok(!/<foreignObject\b/i.test(s), `${where}: <foreignObject> がない`);
  assert.ok(!/@import|@font-face/i.test(s), `${where}: @import・@font-face がない`);
  for (const m of s.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)) assert.ok(m[1].startsWith('#'), `${where}: 局所参照だけ ${m[1]}`);
  for (const m of s.matchAll(/url\(\s*['"]?([^)'"]*)/gi)) assert.ok(m[1].startsWith('#'), `${where}: url(#...) だけ ${m[1]}`);
  assert.ok(!/(https?:)?\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s), `${where}: 外部 URL がない`);
}

// ---------------------------------------------------------------- FR-076 AC-408（黄黒手書き風。依頼の Prompt の画風）
// FR-076 AC-408
test('FR-076 AC-408: 黄黒手書き風は白い紙面に黒の文字と枠、黄の吹き出し・アイコン・強調（黒かグレーの輪郭線つき）、グレーの区切り線と影で描かれる', async () => {
  const { app, ids } = await seededApp();
  const { doc, spec } = usePreset(app, ids, YB);
  assert.equal(spec.preset, true);
  // 白い紙面
  const bg = doc.role('paper-bg');
  assert.equal(bg.length, 1, '紙面の背景が 1 つ');
  assert.ok(isWhite(bg[0].attrs.fill), `紙面は白: ${bg[0].attrs.fill}`);
  // 文字は黒（帯の中の白抜き文字を除く）、黄の上の文字も黒
  const bandFills = new Set(doc.role('heading-band').map((n) => String(n.attrs.fill).toLowerCase()));
  const texts = doc.texts();
  assert.ok(texts.length > 0);
  for (const t of texts) {
    const back = String(t.attrs['data-back']).toLowerCase();
    if (bandFills.has(back)) continue;
    assert.ok(isBlack(t.attrs.fill), `文字「${t.text}」は黒: ${t.attrs.fill}`);
    if (isYellow(back)) assert.ok(isBlack(t.attrs.fill), `黄の上の文字「${t.text}」は黒`);
  }
  // 枠は黒
  const frames = doc.role('point-frame');
  assert.ok(frames.length > 0, '要点の枠がある');
  for (const f of frames) assert.ok(isBlack(f.attrs.stroke), `要点の枠は黒: ${f.attrs.stroke}`);
  // 強調・吹き出し・アイコンの塗りは黄、すべて黒かグレーの輪郭線つき
  for (const role of ['balloon', 'icon', 'emphasis']) {
    const els = doc.role(role);
    assert.ok(els.length > 0, `${role} がある`);
    for (const e of els) assert.ok(isYellow(e.attrs.fill), `${role} の塗りは黄: ${e.attrs.fill}`);
  }
  const yellows = doc.all.filter((n) => isYellow(n.attrs.fill));
  assert.ok(yellows.length > 0);
  for (const y of yellows) {
    assert.ok(isBlackOrGray(y.attrs.stroke), `黄の面（${y.attrs['data-style-role'] ?? y.tag}）に黒かグレーの輪郭線: ${y.attrs.stroke}`);
    assert.ok(num(y.attrs['stroke-width']) > 0, '輪郭線の太さ > 0');
  }
  // 区切り線と影はグレー
  const lines = [...doc.role('divider'), ...doc.role('shadow')];
  assert.ok(lines.length > 0, '区切り線か影がある');
  for (const l of lines) {
    const c = l.attrs.stroke && l.attrs.stroke !== 'none' ? l.attrs.stroke : l.attrs.fill;
    assert.ok(isGray(c), `区切り線・影はグレー: ${c}`);
  }
});

test('FR-076 AC-408: 黄黒手書き風の見出しは黒い帯に白抜き、吹き出しは黒の輪郭線の黄色の雲形、各シーンに丸い頭と細い線の線画人物', async () => {
  const { app, ids } = await seededApp();
  const { doc } = usePreset(app, ids, YB);
  const scenes = app.getState().scenes;
  const bands = doc.role('heading-band');
  assert.ok(bands.length >= scenes.length, '各シーンの見出しに帯');
  for (const b of bands) assert.ok(isBlack(b.attrs.fill), `帯は黒: ${b.attrs.fill}`);
  for (const s of scenes) {
    const t = doc.texts().find((n) => n.text.trim() === s.heading);
    assert.ok(t, `見出し「${s.heading}」が図にある`);
    assert.ok(isBlack(t.attrs['data-back']), '見出しの直下は黒い帯');
    assert.ok(isWhite(t.attrs.fill), `見出しは白抜き: ${t.attrs.fill}`);
  }
  const balloons = doc.role('balloon');
  assert.ok(balloons.length >= scenes.length, '各シーンに吹き出し');
  assert.ok(normalBalloons(doc).length >= 1, '通常の吹き出しがある');
  for (const b of normalBalloons(doc)) {
    assert.equal(b.attrs['data-shape'], 'cloud', '雲形');
    assert.ok(isYellow(b.attrs.fill), '黄色');
    assert.ok(isBlack(b.attrs.stroke), '黒の輪郭線');
  }
  const frameW = median(doc.role('point-frame').map((f) => num(f.attrs['stroke-width'])));
  const figs = doc.role('figure');
  for (const s of scenes) assert.ok(figs.some((g) => g.attrs['data-scene-id'] === s.id), `シーン ${s.id} に線画人物`);
  for (const g of figs) {
    const kids = descendants(doc, g);
    assert.ok(kids.some((k) => k.tag === 'circle'), '丸い頭');
    const strokes = kids.filter((k) => ['line', 'path', 'polyline'].includes(k.tag));
    assert.ok(strokes.length > 0, '線の体');
    for (const k of strokes) assert.ok(num(k.attrs['stroke-width']) < frameW, `細い線（${k.attrs['stroke-width']} < 枠 ${frameW}）`);
  }
});

test('FR-076 AC-408: 黄黒手書き風の文字は太めで、書体の指定は手書き風→丸ゴシック→端末の標準の書体の順の並び（日本語の字形は Yu Gothic UI を先に）', async () => {
  const { app, ids } = await seededApp();
  const { doc } = usePreset(app, ids, YB);
  for (const t of doc.texts()) assert.ok(weightOf(t) >= 600, `文字「${t.text}」は太め: ${t.attrs['font-weight']}`);
  const stack = app.getFontStacks().handwriting;
  assertKindOrder(stack, 'handwriting', '黄黒手書き風の書体の並び');
  assert.ok(stack.findIndex((f) => f.name === YU) < stack.findIndex((f) => f.kind === 'handwriting' && !['Segoe Print', 'Ink Free'].includes(f.name)), '日本語の字形は Yu Gothic UI が手書き風の日本語の書体より先');
  assert.equal(doc.root.attrs['data-font-kind'], 'handwriting');
  assert.deepEqual(fontList(doc.root.attrs['font-family']), stack.map((f) => f.name), '図の書体の指定はその並び');
});

test('FR-076 AC-408 異常系: 端末に手書き風の書体がなくても、太めの文字と黒い帯に白抜きの見出しで黄黒手書き風と分かり、エラーにならない', async () => {
  const look = async (fontCheck) => {
    const { app, ids } = await seededApp({ options: { fontCheck } });
    const { doc } = usePreset(app, ids, YB);
    return { app, doc, texts: doc.texts().map((t) => [t.text.trim(), weightOf(t), t.attrs.fill]).sort(), bands: doc.role('heading-band').map((b) => b.attrs.fill) };
  };
  const have = await look(() => true);
  const none = await look(() => false);
  assert.deepEqual(none.texts, have.texts, '文字・太さ・色は同じ');
  assert.deepEqual(none.bands, have.bands, '黒い帯は同じ');
  for (const [, w] of none.texts) assert.ok(w >= 600, '太め');
  for (const s of none.app.getState().scenes) assert.ok(none.doc.texts().some((t) => t.text.trim() === s.heading && isWhite(t.attrs.fill)), '白抜きの見出し');
  assert.equal(none.app.getDrawStyle(), have.app.getDrawStyle());
});

// ---------------------------------------------------------------- FR-076 AC-409（13 の選択肢と 3.6 の表との一致）
// FR-076 AC-409
test('FR-076 AC-409: 描画スタイルの選択肢は既存の 4 つと 9 つの風の計 13 で、名前は 3.6 の表のとおり（日本語・英語）、既定は手書き調', async () => {
  const { app } = await newApp();
  app.setLang('ja');
  const list = app.getDrawStyles();
  assert.equal(list.length, 13);
  for (const id of LEGACY) assert.ok(list.some((s) => s.id === id), `既存の ${id}`);
  assert.deepEqual(list.filter((s) => !LEGACY.includes(s.id)).map((s) => s.label).sort(), PRESETS.map((p) => p.ja).sort());
  assert.equal(new Set(list.map((s) => s.label)).size, 13, '名前は互いに異なる');
  assert.equal(new Set(list.map((s) => s.id)).size, 13);
  assert.equal(app.getDrawStyle(), 'handwritten', '既定は手書き調のまま');
  const ids = presetIds(app);
  app.setLang('en');
  const en = new Map(app.getDrawStyles().map((s) => [s.id, s.label]));
  for (const p of PRESETS) assert.equal(en.get(ids[p.ja]), p.en, `${p.ja} の英語名`);
});

test('FR-076 AC-409: 9 つの風の紙面の質感・書体の系統・見出しの飾り・吹き出しの形・線（揺らぎの有無・太さ）・線画人物と絵記号の有無が 3.6 の表と一致する', async () => {
  const { app } = await newApp();
  app.setLang('ja');
  const ids = presetIds(app);
  const widths = { thick: [], medium: [], thin: [] };
  for (const p of PRESETS) {
    const s = app.getDrawStyleSpec(ids[p.ja]);
    assert.ok(s && s.preset === true, `${p.ja} は画風プリセット`);
    assert.equal(s.paper, p.paper, `${p.ja} 紙面`);
    assert.equal(s.font, p.font, `${p.ja} 書体の系統`);
    assert.equal(s.headingDecoration, p.heading, `${p.ja} 見出しの飾り`);
    assert.equal(s.balloon, p.balloon, `${p.ja} 吹き出し`);
    assert.equal(s.stroke.wobble > 0, p.wobble, `${p.ja} 揺らぎの有無`);
    assert.ok(s.stroke.width > 0);
    widths[p.width].push(s.stroke.width);
    assert.equal(s.figures, p.figures, `${p.ja} 線画人物`);
    assert.equal(s.icons, true, `${p.ja} 絵記号あり`);
    const pal = s.palette;
    for (const k of ['background', 'primary', 'text', 'secondary']) assert.ok(rgb(pal[k]), `${p.ja} 配色 ${k}`);
    assert.ok(Array.isArray(pal.accent) && pal.accent.length >= 1 && pal.accent.every((c) => rgb(c)), `${p.ja} 強調色 1 色以上`);
    for (const lang of ['ja', 'en']) for (const ax of ['color', 'drawing', 'font', 'mood']) assert.ok(typeof s.description?.[lang]?.[ax] === 'string' && s.description[lang][ax].trim(), `${p.ja} 画風の記述 ${lang}.${ax}`);
  }
  assert.ok(Math.min(...widths.thick) > Math.max(...widths.medium), '太め・太い > 中');
  assert.ok(Math.min(...widths.medium) > Math.max(...widths.thin), '中 > 細め・細い');
  for (const id of LEGACY) assert.equal(app.getDrawStyleSpec(id).preset, false, `${id} は見た目の項目を持たない`);
});

test('FR-076 AC-409: 9 つの風を選ぶと、図がその紙面・配色・書体・見出しの飾り・吹き出し・線・線画人物で描かれる', async () => {
  const { app, ids } = await seededApp();
  const scenes = app.getState().scenes;
  const frameW = { thick: [], medium: [], thin: [] };
  for (const p of PRESETS) {
    const { id, doc, spec } = usePreset(app, ids, p.ja);
    const r = doc.root.attrs;
    assert.equal(r['data-draw-style'], id);
    assert.equal(r['data-paper'], p.paper, `${p.ja} 紙面`);
    assert.equal(r['data-font-kind'], p.font, `${p.ja} 書体`);
    assert.deepEqual(fontList(r['font-family']), app.getFontStacks()[p.font].map((f) => f.name), `${p.ja} 書体の並び`);
    assert.equal(String(doc.role('paper-bg')[0]?.attrs.fill).toLowerCase(), spec.palette.background.toLowerCase(), `${p.ja} 紙面の色は配色の背景`);
    const deco = { band: 'heading-band', marker: 'heading-marker', sticky: 'heading-sticky' };
    for (const [k, role] of Object.entries(deco)) {
      if (k === p.heading) assert.ok(doc.role(role).length >= scenes.length, `${p.ja} 見出しの飾り ${role}`);
      else assert.equal(doc.role(role).length, 0, `${p.ja} は ${role} を持たない`);
    }
    const balloons = doc.role('balloon');
    assert.ok(balloons.length >= scenes.length, `${p.ja} 各シーンに吹き出し`);
    assert.ok(normalBalloons(doc).length >= 1, `${p.ja} 通常の吹き出しがある`);
    for (const b of normalBalloons(doc)) assert.equal(b.attrs['data-shape'], p.balloon, `${p.ja} 通常の吹き出しの形`);
    const figs = doc.role('figure');
    if (p.figures) for (const s of scenes) assert.ok(figs.some((g) => g.attrs['data-scene-id'] === s.id), `${p.ja} シーン ${s.id} に線画人物`);
    else assert.equal(figs.length, 0, `${p.ja} は線画人物なし`);
    assert.ok(doc.role('icon').length > 0, `${p.ja} 絵記号あり`);
    const frames = doc.role('point-frame');
    assert.ok(frames.length > 0, `${p.ja} 要点の枠`);
    for (const f of frames) assert.equal(f.tag, p.wobble ? 'path' : 'rect', `${p.ja} 揺らぎ${p.wobble ? 'あり' : 'なし'}の枠`);
    frameW[p.width].push(median(frames.map((f) => num(f.attrs['stroke-width']))));
    // 配色: 紙面＝背景（上で確認）、見出し・要点の文字に文字色、主色と強調色（1 色以上）が図に使われる
    const lc = (c) => String(c ?? '').toLowerCase();
    const used = new Set(doc.all.flatMap((n) => [lc(n.attrs.fill), lc(n.attrs.stroke)]));
    const own = new Set(stateTexts(app));
    assert.ok(doc.texts().some((t) => own.has(t.text.trim()) && lc(t.attrs.fill) === lc(spec.palette.text)), `${p.ja} 見出し・要点の文字に文字色`);
    assert.ok(used.has(lc(spec.palette.primary)), `${p.ja} 主色が使われる`);
    assert.ok(spec.palette.accent.some((c) => used.has(lc(c))), `${p.ja} 強調色が使われる`);
  }
  assert.ok(Math.min(...frameW.thick) > Math.max(...frameW.medium), '図の線: 太め > 中');
  assert.ok(Math.min(...frameW.medium) > Math.max(...frameW.thin), '図の線: 中 > 細め');
});

test('FR-076 AC-409: 紙面の質感はアプリが描く図形で、方眼は縦横の線・ノート罫線は横線・黒板とクラフト紙は質感の図形を持ち、紙面の色は 3.6 の色名に合う', async () => {
  const { app, ids } = await seededApp();
  for (const p of PRESETS) {
    const { doc, spec } = usePreset(app, ids, p.ja);
    const paper = doc.role('paper')[0];
    assert.ok(paper && paper.tag === 'g', `${p.ja} 紙面のグループ`);
    const firstText = doc.texts()[0];
    assert.ok(paper.index < firstText.index, `${p.ja} 紙面は文字より先（下）に描かれる`);
    const tex = doc.role('paper-texture');
    for (const t of tex) assert.ok(['line', 'path', 'rect', 'circle', 'ellipse', 'polyline', 'polygon'].includes(t.tag), `${p.ja} 質感は図形: ${t.tag}`);
    const lines = tex.filter((t) => t.tag === 'line');
    const vert = lines.filter((l) => num(l.attrs.x1) === num(l.attrs.x2)).length;
    const horz = lines.filter((l) => num(l.attrs.y1) === num(l.attrs.y2)).length;
    if (p.paper === 'grid') assert.ok(vert > 0 && horz > 0, `${p.ja} 方眼は縦横の線`);
    if (p.paper === 'ruled') assert.ok(horz >= 3, `${p.ja} 罫線は横線 3 本以上`);
    if (p.paper === 'chalkboard' || p.paper === 'kraft') assert.ok(tex.length > 0, `${p.ja} 質感の図形`);
    const [r, g, b] = rgb(spec.palette.background);
    if (['plain', 'whiteboard', 'ruled'].includes(p.paper)) assert.ok(isWhite(spec.palette.background), `${p.ja} 紙面は白`);
    if (p.paper === 'chalkboard') assert.ok(g > r && g >= b && lum(spec.palette.background) < 0.15, `${p.ja} 濃い緑`);
    if (p.paper === 'grid') assert.ok(g >= r && g >= b && lum(spec.palette.background) > 0.4, `${p.ja} ミントグリーン`);
    if (p.paper === 'kraft') assert.ok(r > g && g > b && lum(spec.palette.background) > 0.1 && lum(spec.palette.background) < 0.6, `${p.ja} 茶（暖色）`);
  }
});

test('FR-076 AC-409 異常系: 未知の描画スタイルは選べず定義もなく、現在の風と図は変わらない', async () => {
  const { app, ids } = await seededApp();
  const { svg } = usePreset(app, ids, YB);
  for (const bad of ['', 'nosuch', 'Yellow Black', '黄黒手書き風', null, undefined, 3, [ids[YB]], { id: ids[YB] }]) {
    let r; try { r = app.setDrawStyle(bad); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, String(bad));
  }
  assert.equal(app.getDrawStyleSpec('nosuch'), null);
  assert.equal(app.getDrawStyle(), ids[YB]);
  assert.equal(app.renderSvg(), svg);
});

// ---------------------------------------------------------------- FR-076 AC-410（コントラスト）
function assertContrast(doc, p, spec) {
  const fills = new Set(doc.all.map((n) => String(n.attrs.fill).toLowerCase()).filter((c) => rgb(c)));
  for (const t of doc.texts()) {
    const back = t.attrs['data-back'];
    assert.ok(rgb(back), `${p.ja} 文字「${t.text}」の直下の背景が分かる`);
    assert.ok(fills.has(String(back).toLowerCase()), `${p.ja} 直下の背景 ${back} は図の塗り（紙面・帯・付箋・吹き出し）のどれか`);
    assert.ok(contrast(t.attrs.fill, back) >= PARAM_007, `${p.ja} 文字「${t.text}」${t.attrs.fill}/${back} = ${contrast(t.attrs.fill, back).toFixed(2)} >= ${PARAM_007}`);
    if (isYellow(back)) assert.ok(isBlack(t.attrs.fill), `${p.ja} 黄の上の文字は黒`);
  }
  const paper = spec.palette.background;
  for (const role of ['point-frame', 'balloon', 'sticky']) for (const e of doc.role(role)) {
    assert.ok(e.attrs.stroke && e.attrs.stroke !== 'none' && num(e.attrs['stroke-width']) > 0, `${p.ja} ${role} は輪郭を持つ`);
    assert.ok(contrast(e.attrs.stroke, paper) >= PARAM_083, `${p.ja} ${role} の輪郭 ${e.attrs.stroke}/紙面 ${paper} = ${contrast(e.attrs.stroke, paper).toFixed(2)} >= ${PARAM_083}`);
  }
  for (const y of doc.all.filter((n) => isYellow(n.attrs.fill))) {
    assert.ok(isBlackOrGray(y.attrs.stroke) && num(y.attrs['stroke-width']) > 0, `${p.ja} 黄の面（${y.attrs['data-style-role'] ?? y.tag}）に黒かグレーの輪郭線`);
    assert.ok(contrast(y.attrs.stroke, paper) >= PARAM_083, `${p.ja} 黄の面の輪郭線と紙面 >= ${PARAM_083}`);
  }
}
// FR-076 AC-410
test('FR-076 AC-410: 9 つの風のすべてで、文字と直下の背景が 4.5:1 以上、要点の枠・吹き出しの輪郭と紙面が 3:1 以上、黄の面に輪郭線・黄の上の文字は黒', async () => {
  const { app, ids } = await seededApp();
  for (const p of PRESETS) { const { doc, spec } = usePreset(app, ids, p.ja); assertContrast(doc, p, spec); }
});

test('FR-076 AC-410 異常系: 要点を強調表示している間・英語表示でも、コントラストの基準を下回らない', async () => {
  const { app, ids } = await seededApp();
  const target = pointsOf(app).find((q) => q.kind === 'issue') ?? pointsOf(app)[0];
  app.highlightPoint(target.id, 'keyboard');
  for (const p of PRESETS) { const { doc, spec } = usePreset(app, ids, p.ja); assertContrast(doc, p, spec); }
  app.clearHighlight();
  app.setLang('en');
  for (const p of PRESETS) { const { doc, spec } = usePreset(app, ids, p.ja); assertContrast(doc, p, spec); }
});

// ---------------------------------------------------------------- FR-076 AC-411（色だけに頼らない）
// FR-076 AC-411
test('FR-076 AC-411: 9 つの風のすべて（単色のミニマル風を含む）で、要点の種類が形・絵記号・文字で見分けられ、強調表示は色以外でも識別できる', async () => {
  const { app, ids } = await seededApp();
  for (const p of PRESETS) {
    usePreset(app, ids, p.ja);
    const kinds = new Map();
    for (const q of pointsOf(app)) if (!kinds.has(q.kind)) kinds.set(q.kind, q);
    assert.ok(kinds.size >= 2, `${p.ja} 種類が 2 つ以上`);
    const list = [...kinds.values()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      assert.ok(list[i].shape !== list[j].shape || list[i].icon !== list[j].icon, `${p.ja} ${list[i].kind}/${list[j].kind} は形か絵記号で異なる`);
      assert.notEqual(list[i].kindLabel, list[j].kindLabel, `${p.ja} 種類の文字が異なる`);
    }
    const target = pointsOf(app).find((q) => q.kind === 'issue') ?? pointsOf(app)[0];
    app.highlightPoint(target.id, 'pointer');
    const h = app.getHighlight();
    assert.ok(h && h.pointId === target.id, `${p.ja} 強調表示`);
    assert.ok(h.point.strokeWidth > h.others.strokeWidth || (h.point.framed && !h.others.framed) || !!h.point.icon, `${p.ja} 強調は太さ・枠・アイコンでも示す`);
    app.clearHighlight();
  }
});

test('FR-076 AC-411: 白い紙面でも白黒の表示でも、黄の面は形と輪郭線で見え、黄の色だけで示す情報はない', async () => {
  const { app, ids } = await seededApp();
  for (const p of PRESETS) {
    const { doc, spec } = usePreset(app, ids, p.ja);
    for (const y of doc.all.filter((n) => isYellow(n.attrs.fill))) {
      // 白黒にしても紙面と区別できる輪郭（輝度のコントラスト）
      assert.ok(isNeutral(y.attrs.stroke) && contrast(y.attrs.stroke, spec.palette.background) >= PARAM_083, `${p.ja} 黄の面の輪郭線は白黒でも見える`);
      // 黄の面の役割は文字・形（data-style-role）でも示される
      assert.ok(y.attrs['data-style-role'], `${p.ja} 黄の面は役割（形）を持つ`);
    }
    // 種類は文字（種類のラベル）でも図に示される（単色のミニマル風を含む）
    for (const q of pointsOf(app)) assert.ok(doc.texts().some((t) => t.text.includes(q.kindLabel)), `${p.ja} 種類の文字「${q.kindLabel}」が図にある`);
  }
});

test('FR-076 AC-411 異常系: ミニマル風は単色（無彩色）だけで描かれても、種類・強調を色以外で見分けられる', async () => {
  const { app, ids } = await seededApp();
  const { doc } = usePreset(app, ids, 'ミニマル風');
  const colors = doc.all.flatMap((n) => [n.attrs.fill, n.attrs.stroke]).filter((c) => rgb(c));
  assert.ok(colors.length > 0);
  for (const c of colors) assert.ok(isNeutral(c), `ミニマル風は無彩色: ${c}`);
  const pts = pointsOf(app);
  const concl = pts.find((q) => q.kind === 'conclusion');
  assert.ok(concl && concl.emphasized === true, '結論は強調');
  const other = pts.find((q) => q.kind !== 'conclusion');
  assert.ok(concl.fontWeight > other.fontWeight || concl.fontSize > other.fontSize, '強調は太さ・大きさで示す');
});

// ---------------------------------------------------------------- FR-076 AC-412（決定的）
// FR-076 AC-412
test('FR-076 AC-412: 同じ入力と同じ風からは毎回同じ図（線の揺らぎ・紙面の質感・線画人物の配置を含む）になり、再描画・切替で形が変わらない', async () => {
  const a = await seededApp();
  const b = await seededApp();
  for (const p of PRESETS) {
    const sa = usePreset(a.app, a.ids, p.ja).svg;
    const sb = usePreset(b.app, b.ids, p.ja).svg;
    assert.equal(sa, sb, `${p.ja}: 同じ入力から同じ図`);
    assert.equal(a.app.renderSvg(), sa, `${p.ja}: 再描画で同じ`);
    a.app.setDrawStyle('handwritten'); a.app.setDrawStyle(a.ids[p.ja]);
    assert.equal(a.app.renderSvg(), sa, `${p.ja}: 切り替えて戻しても同じ`);
  }
});

test('FR-076 AC-412 異常系: 乱数や時刻が変わっても、同じ入力・同じ風の図は変わらない', async () => {
  const base = await seededApp();
  const want = Object.fromEntries(PRESETS.map((p) => [p.ja, usePreset(base.app, base.ids, p.ja).svg]));
  const rnd = Math.random;
  let k = 0;
  Math.random = () => ((k = (k * 9301 + 49297) % 233280) / 233280);
  try {
    base.env.tick(3600);
    for (const p of PRESETS) assert.equal(usePreset(base.app, base.ids, p.ja).svg, want[p.ja], `${p.ja}: 乱数・時刻に依存しない`);
  } finally { Math.random = rnd; }
});

// ---------------------------------------------------------------- FR-076 AC-413（LLM 連携の送信内容）
const CONFIGURED = { endpoint: true, deployment: true, credential: true };
function makeRelay() {
  const r = { calls: [] };
  r.fn = async ({ method = 'GET', path: p, body }) => {
    r.calls.push({ method, path: p, body });
    if (p === '/api/llm/status') return { status: 200, body: { configured: CONFIGURED, endpointHost: 'foundry.example.test' } };
    if (p === '/api/llm/extract') return { status: 200, body: { objects: [], people: [], emotions: [], metaphors: [] } };
    if (p === '/api/llm/svg') return { status: 200, body: { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' } };
    return { status: 200, body: {} };
  };
  r.llm = () => r.calls.filter((c) => c.path.startsWith('/api/llm/') && c.path !== '/api/llm/status');
  r.extract = () => r.calls.filter((c) => c.path === '/api/llm/extract');
  return r;
}
async function llmApp() {
  const relay = makeRelay();
  const ctx = await newApp({ options: { relay: relay.fn } });
  ctx.app.setLang('ja');
  assert.equal((await ctx.app.requestLlmEnable()).ok, true);
  await ctx.app.answerLlmConsent(true);
  assert.equal(ctx.app.getLlmState().enabled, true);
  return { ...ctx, relay, ids: presetIds(ctx.app) };
}
const keysOf = (o) => Object.keys(o ?? {}).sort();
// FR-076 AC-413
test('FR-076 AC-413: LLM 連携が有効なとき、送る項目は従来どおりで、描画スタイル名として風の識別子だけが送られ、配色・画風の記述は送られない', async () => {
  const legacy = await llmApp();
  await seedThreeScenes(legacy.app, legacy.env);
  await legacy.app.flushLlm();
  const legacyKeys = keysOf(legacy.relay.extract().at(-1).body);
  assert.equal(legacy.relay.extract().at(-1).body.drawStyle, 'handwritten');
  for (const p of PRESETS) {
    const ctx = await llmApp();
    const id = ctx.ids[p.ja];
    assert.equal(ctx.app.setDrawStyle(id).ok, true);
    await seedThreeScenes(ctx.app, ctx.env);
    await ctx.app.flushLlm();
    const calls = ctx.relay.extract();
    assert.ok(calls.length >= 1, `${p.ja}: 送信がある`);
    const body = calls.at(-1).body;
    assert.equal(body.drawStyle, id, `${p.ja}: 描画スタイル名は風の識別子`);
    assert.deepEqual(keysOf(body), legacyKeys, `${p.ja}: 送る項目は従来どおり`);
    const spec = ctx.app.getDrawStyleSpec(id);
    const secrets = [spec.palette.background, spec.palette.primary, spec.palette.text, spec.palette.secondary, ...spec.palette.accent,
      ...['ja', 'en'].flatMap((l) => Object.values(spec.description[l]))].map((s) => String(s).toLowerCase());
    for (const c of ctx.relay.llm()) {
      const text = JSON.stringify(c.body ?? {}).toLowerCase();
      for (const s of secrets) assert.ok(!text.includes(s), `${p.ja}: ${c.path} に配色・画風の記述「${s}」を含まない`);
    }
  }
});

test('FR-076 AC-413 異常系: 風の追加・切替で送信内容の版は変わらず、再同意は求められず、再読込後も LLM 連携は有効のまま', async () => {
  const ctx = await llmApp();
  const before = ctx.env.storage.getItem('grp.llm.consent');
  assert.ok(before, '同意の記録がある');
  ctx.app.commands['session.start']();
  for (const p of PRESETS) {
    assert.equal(ctx.app.setDrawStyle(ctx.ids[p.ja]).ok, true);
    ctx.app.setDraft(`${p.ja}の要点`); ctx.app.submitDraft(); ctx.env.tick(1);
    await ctx.app.flushLlm();
    assert.equal(ctx.relay.extract().at(-1).body.drawStyle, ctx.ids[p.ja], `${p.ja}: 切替後の識別子`);
    assert.equal(ctx.app.getLlmConsent(), null, `${p.ja}: 再同意を求めない`);
    assert.equal(ctx.app.getLlmState().enabled, true);
  }
  assert.equal(JSON.parse(ctx.env.storage.getItem('grp.llm.consent')).version, JSON.parse(before).version, '送信内容の版は変わらない');
  const relay2 = makeRelay();
  const re = await ctx.createApp({ ...ctx.env.options, relay: relay2.fn });
  assert.equal(re.getLlmState().enabled, true, '再読込後も有効');
  assert.equal(re.getLlmConsent(), null, '再読込後も再同意は不要');
});

// ---------------------------------------------------------------- FR-076 AC-425（判読・図形で描く）
// FR-076 AC-425
test('FR-076 AC-425: どの風でも、見出し・要点の文字は飾り・吹き出し・線画人物・絵記号・紙面の質感に隠れない', async () => {
  const { app, ids } = await seededApp();
  for (const p of PRESETS) {
    const { doc } = usePreset(app, ids, p.ja);
    const texts = doc.texts();
    for (const s of stateTexts(app)) assert.ok(texts.some((t) => t.text.includes(s)), `${p.ja}: 「${s}」が図にある`);
    const tb = texts.map((t) => ({ t, b: box(t) }));
    for (const { t, b } of tb) assert.ok(b && b.w > 0 && b.h > 0, `${p.ja}: 文字「${t.text}」の外接矩形`);
    // 線画人物・絵記号は文字と重ならない
    for (const role of ['figure', 'icon']) for (const e of doc.role(role)) {
      const eb = box(e);
      assert.ok(eb, `${p.ja}: ${role} の外接矩形`);
      for (const { t, b } of tb) assert.equal(overlapArea(eb, b), 0, `${p.ja}: ${role} が文字「${t.text}」に重ならない`);
    }
    // 帯・付箋・吹き出し・マーカーは、重なる文字より先（下）に描かれる。紙面（罫線・方眼・チョークの質感）はすべての文字より先
    const firstText = Math.min(...texts.map((t) => t.index));
    for (const e of [...doc.role('paper'), ...doc.role('paper-texture')]) assert.ok(e.index < firstText, `${p.ja}: 紙面の質感は文字の下`);
    for (const role of ['heading-band', 'heading-marker', 'heading-sticky', 'balloon', 'sticky']) {
      for (const e of doc.role(role)) {
        const eb = box(e);
        assert.ok(eb, `${p.ja}: ${role} の外接矩形`);
        for (const { t, b } of tb) if (overlapArea(eb, b) > 0) assert.ok(e.index < t.index, `${p.ja}: ${role} は文字「${t.text}」の下に描かれる`);
      }
    }
  }
});

test('FR-076 AC-425: 線画人物と絵記号はアプリが図形で描き、文字（名前）・画像・外部の素材を使わない', async () => {
  const { app, ids } = await seededApp();
  for (const p of PRESETS) {
    const { doc, svg } = usePreset(app, ids, p.ja);
    assertNoExternal(svg, p.ja);
    for (const g of doc.role('figure')) {
      const desc = doc.all.filter((n) => { for (let q = n.parent; q; q = q.parent) if (q === g) return true; return false; });
      assert.ok(desc.length > 0);
      for (const n of desc) assert.ok(['circle', 'line', 'path', 'polyline', 'g', 'ellipse'].includes(n.tag), `${p.ja}: 線画人物は図形だけ（${n.tag}）`);
      assert.ok(!desc.some((n) => ['text', 'image', 'use'].includes(n.tag)), `${p.ja}: 線画人物に名前・画像・素材の参照がない`);
    }
    for (const e of doc.role('icon')) assert.ok(!['image', 'use', 'foreignObject'].includes(e.tag), `${p.ja}: 絵記号は図形`);
  }
});

// ---------------------------------------------------------------- FR-076 AC-456（ハイコントラスト）
const COLOR_ATTRS = ['fill', 'stroke', 'stop-color', 'color'];
function colorValues(svg) {
  const doc = parseSvg(svg);
  const out = [];
  for (const n of doc.all) {
    for (const a of COLOR_ATTRS) if (n.attrs[a] != null) out.push(n.attrs[a]);
    for (const m of String(n.attrs.style ?? '').matchAll(/(?:^|;)\s*(fill|stroke|stop-color|color)\s*:\s*([^;]+)/g)) out.push(m[2]);
  }
  return out.map((v) => v.trim());
}
const isSystemColor = (v) => ['none', 'transparent', 'currentcolor'].includes(v.toLowerCase()) || SYSTEM_COLORS.includes(v.toLowerCase());
// FR-076 AC-456
test('FR-076 AC-456: ハイコントラストが有効なとき、どの描画スタイルでも図は OS のシステム色で描かれ、見出し・要点・吹き出し・枠・帯の文字が表示される', async () => {
  const { app, ids } = await seededApp({ options: { env: { webgl: true, reducedMotion: false, viewportWidth: 1280, forcedColors: true } } });
  assert.equal(app.getForcedColors(), true);
  const all = app.getDrawStyles().map((s) => s.id);
  assert.equal(all.length, 13);
  for (const id of all) {
    assert.equal(app.setDrawStyle(id).ok, true);
    const svg = app.renderSvg();
    const bad = colorValues(svg).filter((v) => !isSystemColor(v));
    assert.deepEqual(bad, [], `${id}: システム色以外の色がない`);
    const doc = parseSvg(svg);
    for (const s of stateTexts(app)) assert.ok(doc.texts().some((t) => t.text.includes(s)), `${id}: 「${s}」が表示される`);
    for (const q of pointsOf(app)) assert.ok(typeof q.kindLabel === 'string' && q.kindLabel.trim(), `${id}: 種類の文字`);
    const kinds = new Map(); for (const q of pointsOf(app)) if (!kinds.has(q.kind)) kinds.set(q.kind, q);
    const list = [...kinds.values()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) assert.ok(list[i].shape !== list[j].shape || list[i].icon !== list[j].icon, `${id}: 種類は形・絵記号で見分けられる`);
  }
  for (const p of PRESETS) {
    usePreset(app, ids, p.ja);
    const doc = parseSvg(app.renderSvg());
    for (const role of ['balloon', 'point-frame']) assert.ok(doc.role(role).length > 0, `${p.ja}: ${role} が表示される`);
    for (const e of [...doc.role('balloon'), ...doc.role('point-frame')]) assert.ok(isSystemColor(String(e.attrs.stroke)) && e.attrs.stroke !== 'none', `${p.ja}: 輪郭線がシステム色で表示される`);
    const target = pointsOf(app).find((q) => q.kind === 'issue') ?? pointsOf(app)[0];
    app.highlightPoint(target.id, 'keyboard');
    const h = app.getHighlight();
    assert.ok(h.point.strokeWidth > h.others.strokeWidth || (h.point.framed && !h.others.framed) || !!h.point.icon, `${p.ja}: 強調は太さ・枠・アイコンで見分けられる`);
    app.clearHighlight();
  }
});

test('FR-076 AC-456: ハイコントラストの切替で描画スタイルの選択・図の内容・配置は変わらず、無効に戻すと選んでいる風の配色で描かれる', async () => {
  const { app, ids } = await seededApp();
  assert.equal(app.getForcedColors(), false);
  for (const p of PRESETS) {
    const { id, svg, spec } = usePreset(app, ids, p.ja);
    const layout = JSON.stringify(app.getDiagramLayout()); const outline = app.renderOutline();
    assert.equal(app.setForcedColors(true).ok, true);
    assert.equal(app.getDrawStyle(), id, `${p.ja}: 選択は変わらない`);
    assert.equal(JSON.stringify(app.getDiagramLayout()), layout, `${p.ja}: 配置は変わらない`);
    assert.equal(app.renderOutline(), outline, `${p.ja}: 内容は変わらない`);
    const forced = app.renderSvg();
    assert.ok(!forced.toLowerCase().includes(spec.palette.background.toLowerCase()), `${p.ja}: 風の紙面の色を使わない`);
    assert.deepEqual(svgTextSet(forced), svgTextSet(svg), `${p.ja}: 文字は同じ`);
    assert.equal(app.setForcedColors(false).ok, true);
    assert.equal(app.renderSvg(), svg, `${p.ja}: 無効に戻すと風の配色`);
  }
});

test('FR-076 AC-456 異常系: 真偽値でない指定は拒否され、強制カラーの状態と図は変わらない', async () => {
  const { app, ids } = await seededApp();
  const { svg } = usePreset(app, ids, YB);
  for (const bad of ['true', 1, null, undefined, {}]) {
    let r; try { r = app.setForcedColors(bad); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, String(bad));
  }
  assert.equal(app.getForcedColors(), false);
  assert.equal(app.renderSvg(), svg);
});

// ---------------------------------------------------------------- FR-075 AC-406（既存の 4 つは拡張の前と同じ図）
const CONFIGS = { 'timeline-detail': { level: 'detail' }, 'timeline-major': { level: 'major' }, 'bubble-detail': { level: 'detail', types: ['bubble'] } };
async function legacySvg(style, c) {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  if (c.types) app.setLayoutTypes(c.types);
  toDetail(app, c.level);
  assert.equal(app.setDrawStyle(style).ok, true);
  return { app, svg: app.renderSvg() };
}
// FR-075 AC-406: 変わってよいのは書体の指定の並び（NFR-UX-012。AC-466）と、それによる日本語の字形・文字幅、
// 文字幅から決まる文字を囲む枠の幅・文字の折り返しの位置だけ。配色・線・図形の種類・配置の規則・文字の内容は同じ。
// （欧文の字形が参照の環境で変わらないことは、書体の並びで欧文専用の書体を足さないことで確かめる。10.3 の [ASSUMPTION] NFR-UX-012）
const GEOM = new Set(['x', 'y', 'width', 'height', 'd', 'points', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'rx', 'ry', 'r', 'transform', 'viewBox', 'data-box', 'textLength', 'dx', 'dy']);
function assertSameAsLegacy(actual, golden, where) {
  const want = expectedStack(TRADITIONAL.legacy);
  const fams = parseSvg(actual).all.filter((n) => n.attrs['font-family'] !== undefined);
  assert.ok(fams.length >= 1, `${where}: 書体の指定がある`);
  for (const n of fams) assert.deepEqual(fontList(n.attrs['font-family']), want, `${where}: 書体の指定の並びは NFR-UX-012 のとおり`);
  for (const n of parseSvg(golden).all.filter((x) => x.attrs['font-family'] !== undefined)) assert.deepEqual(fontList(n.attrs['font-family']), TRADITIONAL.legacy, `${where}: 記録の書体の指定は従来の並び`);
  const strip = (s) => nl(s).replace(/\s+font-family="[^"]*"/g, '');
  if (strip(actual) === strip(golden)) return; // 書体の指定の並び以外は同じ
  // 文字幅の違いによる枠の幅・折り返しの位置の違いだけを許す
  const a = parseSvg(actual); const g = parseSvg(golden);
  const isText = (n) => n.tag === 'text' || n.tag === 'tspan' || a.within(n, ['text']);
  const shapes = (d) => d.all.filter((n) => !isText(n) && n.tag !== 'title' && n.tag !== 'desc');
  const sa = shapes(a); const sg = shapes(g);
  assert.deepEqual(sa.map((n) => n.tag), sg.map((n) => n.tag), `${where}: 図形の種類と順序は同じ`);
  const look = (n) => Object.fromEntries(Object.entries(n.attrs).filter(([k]) => !GEOM.has(k) && k !== 'font-family'));
  sa.forEach((n, i) => assert.deepEqual(look(n), look(sg[i]), `${where}: ${n.tag}[${i}] の配色・線・役割は同じ`));
  const flat = (d) => d.all.filter((n) => n.tag === 'text' && !d.within(n, ['text'])).map((n) => n.text).join('').replace(/\s+/g, '');
  assert.equal(flat(a), flat(g), `${where}: 文字の内容と順序は同じ（折り返しの位置だけ違ってよい）`);
  const textLook = (d) => [...new Set(d.all.filter((n) => n.tag === 'text').map((n) => JSON.stringify(look(n))))].sort();
  assert.deepEqual(textLook(a), textLook(g), `${where}: 文字の色・大きさ・太さは同じ`);
}
// FR-075 AC-406
test('FR-075 AC-406: 見た目の項目を持たない既存の 4 つ（手書き調・アニメ調・シンプル・RPG風）は、同じ入力に対して拡張の前と同じ図になる（書体の指定の並びと文字幅による違いだけを許す）', async () => {
  const files = fs.readdirSync(GOLDEN).filter((f) => f.endsWith('.svg'));
  assert.ok(files.length >= 10, '拡張の前の図の記録がある');
  for (const f of files) {
    const [style, ...rest] = f.replace(/\.svg$/, '').split('-');
    const c = CONFIGS[rest.join('-')];
    assert.ok(LEGACY.includes(style) && c, f);
    const { svg } = await legacySvg(style, c);
    assertSameAsLegacy(svg, fs.readFileSync(path.join(GOLDEN, f), 'utf8'), `${f}: 図形・線・色・文字が拡張の前と同じ`);
  }
});

test('FR-075 AC-406 異常系: 風を選んでから既存の 4 つに戻しても、拡張の前と同じ図になり、風の観察点は現れない', async () => {
  for (const style of LEGACY) {
    const { app } = await legacySvg(style, CONFIGS['timeline-detail']);
    const ids = presetIds(app);
    for (const p of PRESETS) { assert.equal(app.setDrawStyle(ids[p.ja]).ok, true); app.renderSvg(); }
    assert.equal(app.setDrawStyle(style).ok, true);
    const svg = app.renderSvg();
    assertSameAsLegacy(svg, fs.readFileSync(path.join(GOLDEN, `${style}-timeline-detail.svg`), 'utf8'), `${style}: 戻すと拡張の前と同じ`);
    assert.ok(!/data-style-role=|data-paper=|data-font-kind=/.test(svg), `${style}: 画風プリセットの観察点がない`);
    assert.equal(app.getDrawStyleSpec(style).preset, false);
  }
});

// ---------------------------------------------------------------- FR-075 AC-407（外部へのリクエスト 0・書体の並び・代わりの書体・UI の書体）
// FR-075 AC-407
test('FR-075 AC-407: 画風プリセットの図の表示と PNG・SVG・PDF の保存の間に外部へのリクエストは 0 件で、紙面の質感は図形で表される', async () => {
  for (const p of PRESETS) {
    const { app, env, ids } = await seededApp();
    const calls = await withNetSpy(async () => {
      usePreset(app, ids, p.ja);
      await app.commands['save.png'](); await app.commands['save.svg'](); await app.commands['save.pdf']();
    });
    assert.deepEqual(calls, [], `${p.ja}: 外部へのリクエスト 0 件`);
    assert.deepEqual(env.downloads.map((d) => d.mime), ['image/png', 'image/svg+xml', 'application/pdf'], `${p.ja}: 3 形式で保存`);
    const svgFile = env.downloads[1].data;
    assertNoExternal(String(svgFile), `${p.ja} SVG`);
    assert.match(String(svgFile), new RegExp(`data-paper="${p.paper}"`), `${p.ja}: 保存した SVG も紙面の質感を持つ`);
    const pdf = bytesToLatin1(env.downloads[2].data);
    assert.ok(!/\/URI|https?:\/\//i.test(pdf), `${p.ja}: PDF に外部参照がない`);
    const text = pdfTexts(env.downloads[2].data);
    const drawn = env.canvasFactory.log.texts.join('\n');
    for (const s of stateTexts(app)) { assert.ok(text.includes(s), `${p.ja}: PDF に「${s}」`); assert.ok(drawn.includes(s), `${p.ja}: PNG に「${s}」`); }
  }
});

test('FR-075 AC-407: 図の文字の書体の指定は、手書き風は手書き風→丸ゴシック→標準、丸ゴシックは丸ゴシック→標準の並びで、書体のファイルを同梱しない', async () => {
  const { app, ids } = await seededApp();
  const st = app.getFontStacks();
  for (const k of FONTS) {
    assert.ok(Array.isArray(st[k]) && st[k].length >= 1, `${k} の並び`);
    assert.equal(st[k].at(-1).kind, 'generic', `${k}: 末尾は端末の標準の書体`);
    assert.equal(st[k].filter((f) => f.kind === 'generic').length, 1);
    for (const f of st[k]) assert.ok(typeof f.name === 'string' && f.name.trim() && !/url\(|\/\//.test(f.name), `${k}: 書体名 ${f.name}`);
  }
  // 手書き風→丸ゴシック→標準、丸ゴシック→標準。日本語の字形は各並びの欧文専用の書体の次に Yu Gothic UI（AC-466）
  assertKindOrder(st.handwriting, 'handwriting', '手書き風の系統');
  assertKindOrder(st.roundGothic, 'roundGothic', '丸ゴシックの系統');
  for (const p of PRESETS) {
    const { doc } = usePreset(app, ids, p.ja);
    assert.deepEqual(fontList(doc.root.attrs['font-family']), st[p.font].map((f) => f.name), `${p.ja}: 図の書体の指定`);
    for (const t of doc.texts()) if (t.attrs['font-family']) assert.deepEqual(fontList(t.attrs['font-family']), st[p.font].map((f) => f.name), `${p.ja}: 文字ごとの書体の指定も同じ並び`);
  }
  const fontFiles = walk(WEB).filter((f) => /\.(woff2?|ttf|otf|eot)$/i.test(f));
  assert.deepEqual(fontFiles, [], '書体のファイルを同梱しない');
});

test('FR-075 AC-407 異常系: 系統に合う書体が端末にないとき、文字は欠けずエラーにならず、文字の太さと見出しの飾りは変わらない', async () => {
  const sig = async (fontCheck) => {
    const { app, env, ids } = await seededApp({ options: { fontCheck } });
    const out = {};
    for (const p of PRESETS) {
      const { doc } = usePreset(app, ids, p.ja);
      out[p.ja] = {
        texts: doc.texts().map((t) => [t.text.trim(), weightOf(t)]).sort(),
        deco: ['heading-band', 'heading-marker', 'heading-sticky'].map((r) => doc.role(r).map((n) => [n.tag, n.attrs.fill, n.attrs.stroke])),
        font: doc.root.attrs['font-family'],
      };
      for (const s of stateTexts(app)) assert.ok(doc.texts().some((t) => t.text.includes(s)), `${p.ja}: 「${s}」は欠けない`);
    }
    await app.commands['save.png']();
    assert.equal(env.downloads.length, 1, 'PNG の保存もエラーにならない');
    return out;
  };
  const have = await sig(() => true);
  const none = await sig(() => false);
  const broken = await sig(() => { throw new Error('fonts unavailable'); });
  assert.deepEqual(none, have, '書体がなくても太さ・飾り・書体の指定は同じ');
  assert.deepEqual(broken, have, '書体の判定が失敗しても同じ');
});

test('FR-075 AC-407: アプリの画面（UI）の書体の指定は、どの描画スタイルを選んでも変わらない', async () => {
  const css = walk(WEB).filter((f) => /\.css$/i.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (/draw-?style/i.test(m[1])) assert.ok(!/font-family|--font-sans/.test(m[2]), `描画スタイルで UI の書体を変える規則がない: ${m[1].trim()}`);
  }
  // スクリプトが実行時に UI の書体（--font-sans・文書の font-family）を書き換えない
  const js = walk(path.join(WEB, 'src')).filter((f) => /\.m?js$/i.test(f));
  for (const f of js) {
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(!/setProperty\(\s*['"]--font-sans/.test(s), `${path.relative(WEB, f)}: --font-sans を書き換えない`);
    assert.ok(!/(document\.(body|documentElement)|\broot)\.style\.fontFamily\s*=/.test(s), `${path.relative(WEB, f)}: 画面の書体を書き換えない`);
  }
  const tokens = fs.readFileSync(path.join(WEB, 'styles', 'tokens.css'), 'utf8');
  const ff = tokens.match(/--font-sans\s*:\s*([^;]+);/);
  assert.ok(ff && fontList(ff[1]).includes('Segoe UI'), 'UI の書体はシステムフォントの並び（Segoe UI を含む）のまま');
  const { app, ids } = await seededApp();
  for (const p of PRESETS) usePreset(app, ids, p.ja);
});

// ---------------------------------------------------------------- NFR-UX-001 AC-061（図の書体の範囲・外部取得なし）
// NFR-UX-001 AC-061
test('NFR-UX-001 AC-061: 2D の図の書体は描画スタイルの書体の系統に従い、どの描画スタイルの図も外部のオリジンから書体・スタイル・スクリプトを取得しない', async () => {
  const { app } = await seededApp();
  const st = app.getFontStacks();
  for (const s of app.getDrawStyles()) {
    let svg;
    const calls = await withNetSpy(async () => { assert.equal(app.setDrawStyle(s.id).ok, true); svg = app.renderSvg(); });
    assert.deepEqual(calls, [], `${s.id}: 外部取得 0 件`);
    assertNoExternal(svg, s.id);
    assert.ok(!/<script\b|<link\b|<style[^>]*>[^<]*@import/i.test(svg), `${s.id}: 図にスクリプト・外部スタイルがない`);
    const spec = app.getDrawStyleSpec(s.id);
    if (spec.preset) assert.deepEqual(fontList(parseSvg(svg).root.attrs['font-family']), st[spec.font].map((f) => f.name), `${s.id}: 図の書体は系統に従う`);
  }
  const tokens = fs.readFileSync(path.join(WEB, 'styles', 'tokens.css'), 'utf8');
  const ff = tokens.match(/--font-sans\s*:\s*([^;]+);/);
  assert.ok(ff, '--font-sans');
  const head = fontList(ff[1])[0];
  assert.ok(['Segoe UI', 'system-ui', '-apple-system', 'BlinkMacSystemFont'].includes(head), `UI の書体の先頭はシステムフォント: ${head}`);
});
