// FR-076 AC-467 / FR-032 AC-156（System Test。検証レベル integration の参考。契約: tests/system/CONTRACT-STYLE-PRESET.md「感情語を含むトピックの吹き出し（AC-467）」）
// 期待値は要求定義書（AC-467・AC-156・AC-410・3.6 の表）だけから決める。感情語は FR-004 AC-011 の例（「困った」「モヤモヤ」）を使う。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, toDetail } from './helpers.js';
import {
  PRESETS, BALLOONS, PARAM_007, PARAM_083, contrast, isYellow, isBlackOrGray, parseSvg, box, overlapArea, presetIds, stateTexts,
} from './stylepreset-util.js';

const EMO = [['予算の見直しが必要です', 'コストが高くて困った'], ['来月のリリース計画を決める'], ['担当者の割り当てを確認する']];
const CALM = [['予算の見直しが必要です', 'コストの内訳を確かめる'], ['来月のリリース計画を決める'], ['担当者の割り当てを確認する']];
const EMOTION_WORDS = ['困った', 'モヤモヤ'];
const lc = (c) => String(c ?? '').toLowerCase();

async function bubbleApp(groups = EMO, over = {}) {
  const ctx = await newApp(over);
  const { app, env } = ctx;
  app.setLang('ja');
  app.commands['session.start']();
  groups.forEach((g, i) => { for (const t of g) { app.setDraft(t); app.submitDraft(); env.tick(1); } if (i < groups.length - 1) app.commands['session.nextScene'](); });
  toDetail(app);
  assert.equal(app.setLayoutTypes(['bubble']).ok, true, '吹き出し型（FR-032）');
  return ctx;
}
// 感情語を含むトピックの、シーンの id の集合
function emotionalScenes(app) {
  const scenes = new Map(app.getState().scenes.map((s) => [s.id, s]));
  const out = new Set(); const calm = new Set();
  for (const t of app.getTopics()) {
    const texts = t.sceneIds.flatMap((id) => [scenes.get(id).heading, ...scenes.get(id).points.map((p) => p.text)]);
    const emo = texts.some((x) => EMOTION_WORDS.some((w) => x.includes(w)));
    for (const id of t.sceneIds) (emo ? out : calm).add(id);
  }
  return { emo: out, calm };
}
const sceneOf = (n) => { for (let q = n; q; q = q.parent) if (q.attrs['data-scene-id']) return q.attrs['data-scene-id']; return null; };
// 色を取り除いた形の手がかり（要素の種類・角丸・パスの命令の種類と数・頂点の数）
function shapeSig(n) {
  if (n.tag === 'path') { const cmds = String(n.attrs.d ?? '').match(/[MLHVCSQTAZ]/gi) || []; return `path:${[...new Set(cmds.map((c) => c.toUpperCase()))].sort().join('')}:${cmds.length}`; }
  if (n.tag === 'polygon' || n.tag === 'polyline') return `${n.tag}:${String(n.attrs.points ?? '').trim().split(/[\s,]+/).length / 2}`;
  if (n.tag === 'rect') return `rect:${Number(n.attrs.rx ?? 0) > 0 ? 'round' : 'square'}`;
  return n.tag;
}
function balloonsOf(app) {
  const doc = parseSvg(app.renderSvg());
  const all = doc.role('balloon');
  return { doc, all, emo: all.filter((b) => b.attrs['data-balloon-kind'] === 'emotion'), normal: all.filter((b) => b.attrs['data-balloon-kind'] !== 'emotion') };
}
const REG = (id, balloon) => ({
  id, label: { ja: `試験の吹き出し${balloon}`, en: `Test balloon ${balloon}` }, line: { width: 1, jitter: 0 }, fill: { mode: 'paper' }, text: { decor: 'standard', icons: true },
  paper: 'plain', font: 'gothic', headingDecoration: 'band', balloon, stroke: { wobble: 0, width: 2 }, figures: false, icons: true,
  palette: { background: '#ffffff', primary: '#1a1a1a', accent: ['#ffd400'], text: '#1a1a1a', secondary: '#757575' },
  description: { ja: { color: '白と黒と黄', drawing: '細い線', font: 'ゴシック', mood: '落ち着いた' }, en: { color: 'White, black and yellow', drawing: 'Thin lines', font: 'Gothic', mood: 'Calm' } },
});
function assertEmotionBalloons(app, id, where, { nine }) {
  const spec = app.getDrawStyleSpec(id);
  assert.ok(spec && spec.preset === true, `${where}: 画風プリセット`);
  const { doc, emo, normal } = balloonsOf(app);
  const { emo: emoScenes, calm } = emotionalScenes(app);
  assert.ok(emoScenes.size >= 1 && calm.size >= 1, '前提: 感情語を含むトピックと含まないトピックがある');
  assert.ok(emo.some((b) => emoScenes.has(sceneOf(b))), `${where}: 感情語を含むトピックの吹き出しは通常と異なる形`);
  for (const b of emo) assert.ok(emoScenes.has(sceneOf(b)), `${where}: 感情語を含まないトピックの吹き出しは通常の形（${sceneOf(b)}）`);
  assert.ok(normal.length >= 1, `${where}: 通常の吹き出しがある`);
  for (const b of normal) assert.equal(b.attrs['data-shape'], spec.balloon, `${where}: 通常の吹き出しはその画風の形（${spec.balloon}）`);
  const normalSigs = new Set(normal.map(shapeSig));
  const paper = doc.role('paper-bg')[0]?.attrs.fill ?? spec.palette.background;
  const palette = new Set([spec.palette.background, spec.palette.primary, spec.palette.text, spec.palette.secondary, ...spec.palette.accent].map(lc));
  for (const b of emo) {
    assert.ok(b.attrs['data-shape'] && b.attrs['data-shape'] !== spec.balloon, `${where}: 形の名前が通常（${spec.balloon}）と異なる: ${b.attrs['data-shape']}`);
    assert.ok(!normalSigs.has(shapeSig(b)), `${where}: 色を取り除いても形で見分けられる（${shapeSig(b)} と 通常 ${[...normalSigs].join(' / ')}）`);
    // 配色と輪郭線の規定（9 つの風は AC-410）
    assert.ok(b.attrs.stroke && b.attrs.stroke !== 'none' && Number(b.attrs['stroke-width']) > 0, `${where}: 輪郭線がある`);
    if (b.attrs.fill && b.attrs.fill !== 'none') assert.ok(palette.has(lc(b.attrs.fill)) || normal.some((x) => lc(x.attrs.fill) === lc(b.attrs.fill)), `${where}: 塗りはその画風の配色: ${b.attrs.fill}`);
    if (nine) {
      assert.ok(contrast(b.attrs.stroke, paper) >= PARAM_083, `${where}: 輪郭と紙面のコントラスト ${contrast(b.attrs.stroke, paper).toFixed(2)} >= ${PARAM_083}`);
      if (isYellow(b.attrs.fill)) assert.ok(isBlackOrGray(b.attrs.stroke), `${where}: 黄の面に黒かグレーの輪郭線`);
    }
    // 文字は判読できる（吹き出しの上の文字と直下の背景のコントラスト）
    const bb = box(b);
    if (bb) for (const t of doc.texts()) {
      const tb = box(t);
      if (!tb || overlapArea(tb, bb) <= 0 || lc(t.attrs['data-back']) !== lc(b.attrs.fill)) continue;
      assert.ok(contrast(t.attrs.fill, t.attrs['data-back']) >= PARAM_007, `${where}: 吹き出しの上の文字「${t.text.trim()}」のコントラスト >= ${PARAM_007}`);
    }
  }
  return { emo, normal };
}

// FR-076 AC-467
test('FR-076 AC-467: 9 つの風のすべてで、吹き出し型の感情語を含むトピックの吹き出しは通常の形と異なり、色を取り除いても形で見分けられ、配色・輪郭線の規定に従う', async () => {
  const { app } = await bubbleApp();
  const ids = presetIds(app);
  for (const p of PRESETS) {
    assert.equal(app.setDrawStyle(ids[p.ja]).ok, true, p.ja);
    assertEmotionBalloons(app, ids[p.ja], p.ja, { nine: true });
  }
});

test('FR-076 AC-467: 拡張点で追加した画風プリセットの定義（吹き出しの形が雲形・角丸・付箋）でも、感情語を含むトピックの吹き出しはその定義の形と異なる', async () => {
  const { app } = await bubbleApp();
  for (const b of BALLOONS) {
    const id = `test-emo-${b}`;
    assert.equal(app.registerDrawStyle(REG(id, b)).ok, true, id);
    assert.equal(app.setDrawStyle(id).ok, true);
    assert.equal(app.getDrawStyleSpec(id).balloon, b);
    assertEmotionBalloons(app, id, id, { nine: false });
  }
});

test('FR-076 AC-467 異常系: 色を取り除いた表示（強制カラー）でも、感情語を含むトピックの吹き出しは形だけで通常のものと見分けられる', async () => {
  const { app } = await bubbleApp(EMO, { options: { env: { webgl: true, reducedMotion: false, viewportWidth: 1280, forcedColors: true } } });
  const ids = presetIds(app);
  assert.equal(app.getForcedColors(), true);
  for (const p of PRESETS) {
    assert.equal(app.setDrawStyle(ids[p.ja]).ok, true);
    const { emo, normal } = balloonsOf(app);
    assert.ok(emo.length >= 1, `${p.ja}: 感情語の吹き出しがある`);
    const sigs = new Set(normal.map(shapeSig));
    for (const b of emo) assert.ok(!sigs.has(shapeSig(b)), `${p.ja}: 形だけで見分けられる`);
  }
});

test('FR-076 AC-467 異常系: 感情語を含むトピックがないときは、どの画風プリセットでも吹き出しはすべて通常の形', async () => {
  const { app } = await bubbleApp(CALM);
  const ids = presetIds(app);
  for (const p of PRESETS) {
    assert.equal(app.setDrawStyle(ids[p.ja]).ok, true);
    const { all, emo } = balloonsOf(app);
    assert.equal(emo.length, 0, `${p.ja}: 感情語の吹き出しはない`);
    for (const b of all) assert.equal(b.attrs['data-shape'], p.balloon, `${p.ja}: 通常の形`);
  }
});

test('FR-076 AC-467: PNG・SVG・PDF の保存でも同じ形で、文字は欠けない', async () => {
  const { app, env } = await bubbleApp();
  const ids = presetIds(app);
  for (const p of PRESETS) {
    assert.equal(app.setDrawStyle(ids[p.ja]).ok, true);
    const want = balloonsOf(app).all.map((b) => [b.attrs['data-balloon-kind'] ?? 'normal', b.attrs['data-shape'], shapeSig(b)]);
    assert.ok(want.some((w) => w[0] === 'emotion'), `${p.ja}: 前提: 感情語の吹き出しがある`);
    const n = env.downloads.length;
    for (const c of ['save.png', 'save.svg', 'save.pdf']) await app.commands[c]();
    const dl = env.downloads.slice(n);
    assert.deepEqual(dl.map((d) => d.mime), ['image/png', 'image/svg+xml', 'application/pdf'], `${p.ja}: 3 形式で保存`);
    const saved = parseSvg(String(dl[1].data)).role('balloon').map((b) => [b.attrs['data-balloon-kind'] ?? 'normal', b.attrs['data-shape'], shapeSig(b)]);
    assert.deepEqual(saved, want, `${p.ja}: 保存した SVG も同じ形`);
    const drawn = env.canvasFactory.log.texts.join('\n');
    for (const s of stateTexts(app)) assert.ok(drawn.includes(s), `${p.ja}: PNG に「${s}」`);
  }
});
