// FR-076 AC-670（暖色カード風・青見出し風・雲形の区画の枠・書体の名前）と、その 2 つの風での AC-409〜AC-413・AC-456・AC-467、
// FR-029 AC-146・FR-077 AC-414（15 の描画スタイル）の単体・結合テスト。System Test は tests/system/（test-designer）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newApp, seedThreeScenes, toDetail } from '../system/helpers.js';
import { BUILTIN_STYLES, validateStyle } from '../../web/src/drawstyles.js';
import {
  PRESET_STYLES, FONT_STACKS, JP_FONT, contrastRatio, isYellowish, isNeutralColor, presetOf, cloudFramePath, boardFrameLook, validatePresetFields,
} from '../../web/src/stylepresets.js';
import { buildLook, forcedLook, renderPresetDiagram, renderPresetTopics, toSystemColors } from '../../web/src/presetdiagram.js';
import { exportLook } from '../../web/src/export.js';

const WARM = ['#593c47', '#f2e63d', '#f2c53d', '#f25c05', '#f24405'];
const ORANGE_RED = ['#f25c05', '#f24405'];
const byId = (id) => PRESET_STYLES.find((p) => p.id === id);
const tags = (svg, re) => [...svg.matchAll(re)].map((m) => m[0]);
const attr = (tag, n) => (new RegExp(`\\s${n}="([^"]*)"`).exec(tag) ?? [])[1];
const boxOf = (s) => s.split(' ').map(Number);
const overlap = (a, b) => Math.min(a[0] + a[2], b[0] + b[2]) > Math.max(a[0], b[0]) && Math.min(a[1] + a[3], b[1] + b[3]) > Math.max(a[1], b[1]);
const hexes = (svg) => [...svg.matchAll(/\s(?:fill|stroke|stop-color|color)="(#[0-9a-fA-F]{3,6})"/g)].map((m) => m[1].toLowerCase());

async function seeded(styleId, layout = null) {
  const { app, env } = await newApp();
  app.setLang('ja');
  await seedThreeScenes(app, env); toDetail(app);
  if (layout) assert.equal(app.setLayoutTypes(layout).ok, true);
  assert.equal(app.setDrawStyle(styleId).ok, true);
  return { app, env };
}

// FR-076 AC-670 AC-409 / FR-029 AC-146: 計 15。2 つの風は 3.6 の表のとおり
test('FR-076 AC-670 AC-409 FR-029 AC-146: 暖色カード風と青見出し風が加わり計 15、紙面・書体・見出しの飾り・吹き出し・線・線画人物が 3.6 の表と一致する', async () => {
  assert.equal(BUILTIN_STYLES.length, 15);
  assert.deepEqual(PRESET_STYLES.slice(-2).map((p) => p.id), ['warmCards', 'blueHeadings']);
  const want = {
    warmCards: { ja: '暖色カード風', paper: 'plain', font: 'handwriting', heading: 'marker', balloon: 'rounded', wobble: true },
    blueHeadings: { ja: '青見出し風', paper: 'plain', font: 'roundGothic', heading: 'band', balloon: 'rounded', wobble: false },
  };
  const medium = PRESET_STYLES.filter((p) => ['stickyNotes', 'mintNote', 'kraftPaper'].includes(p.id)).map((p) => p.stroke.width);
  for (const [id, w] of Object.entries(want)) {
    const p = byId(id);
    assert.equal(validateStyle(p).ok, true, id);
    assert.equal(p.label.ja, w.ja);
    assert.ok([...p.label.ja].length <= 6 && p.label.en.length <= 12, `${id}: 名前は PARAM-011 以内`);
    assert.equal(p.paper, w.paper); assert.equal(p.font, w.font); assert.equal(p.headingDecoration, w.heading); assert.equal(p.balloon, w.balloon);
    assert.equal(p.stroke.wobble > 0, w.wobble, `${id}: 揺らぎ`);
    assert.ok(Math.min(...medium) <= p.stroke.width && p.stroke.width <= Math.max(...medium), `${id}: 線の太さは「中」`);
    assert.equal(p.figures, true); assert.equal(p.icons, true);
  }
  // 画面: 選べて図の見た目だけが変わる（文字の内容は同じ）
  const { app } = await seeded('handwritten');
  const texts = (svg) => [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).filter((t) => /予算|コスト|step|pilot/i.test(t)).sort();
  const base = texts(app.renderSvg());
  for (const id of ['warmCards', 'blueHeadings']) {
    assert.equal(app.setDrawStyle(id).ok, true);
    assert.equal(app.getDrawStyle(), id);
    const svg = app.renderSvg();
    assert.match(svg, new RegExp(`data-draw-style="${id}"`));
    assert.deepEqual(texts(svg), base, `${id}: 文字は変わらない`);
  }
});

// FR-076 AC-670: 暖色カード風の配色は 5 色と白（文字の代わりの黒を含む）に限り、要点・吹き出しは白いカード（角の丸み 12 px）
test('FR-076 AC-670: 暖色カード風は 5 色と白・黒だけで描かれ、要点・吹き出しは角の丸み 12 px の白いカード、文字は #593C47 か黒', async () => {
  for (const layout of [null, ['bubble']]) {
    const { app } = await seeded('warmCards', layout);
    const svg = app.renderSvg();
    for (const c of hexes(svg)) assert.ok([...WARM, '#ffffff', '#000000'].includes(c), `許可の色だけ: ${c}`);
    const cards = tags(svg, /<rect [^>]*data-style-role="card"[^>]*>/g);
    assert.ok(cards.length >= 3, '要点は白いカード');
    for (const c of cards) { assert.equal(attr(c, 'rx'), '12'); assert.equal(attr(c, 'fill'), '#ffffff'); }
    const balloons = tags(svg, /<(?:rect|path|polygon) [^>]*data-style-role="balloon"[^>]*>/g);
    assert.ok(balloons.length >= 1);
    for (const b of balloons.filter((t) => /data-shape="rounded"/.test(t))) { assert.match(b, /^<rect /); assert.equal(attr(b, 'rx'), '12'); assert.equal(attr(b, 'fill'), '#ffffff'); }
    // 文字は #593C47 か黒。橙・赤は文字の背景にしない（線・マーカー・下線・絵記号の塗りだけ）
    for (const t of tags(svg, /<text [^>]*>/g)) {
      assert.ok(['#593c47', '#000000'].includes(String(attr(t, 'fill')).toLowerCase()), `文字の色: ${t}`);
      assert.ok(!ORANGE_RED.includes(String(attr(t, 'data-back')).toLowerCase()), `橙・赤を文字の背景にしない: ${t}`);
    }
    const textBoxes = tags(svg, /<text [^>]*data-box="[^"]+"[^>]*>/g).map((t) => boxOf(attr(t, 'data-box')));
    for (const el of tags(svg, /<(?:rect|path|polygon|circle|ellipse)\b[^>]*>/g)) {
      const f = String(attr(el, 'fill')).toLowerCase();
      if (!ORANGE_RED.includes(f)) continue;
      const role = attr(el, 'data-style-role');
      assert.ok(role === undefined || ['icon', 'heading-marker', 'part'].includes(role), `橙・赤の塗りは絵記号・マーカーだけ: ${el}`);
    }
    assert.ok(textBoxes.length > 0);
    // 黄の面は黒の輪郭線、黄の上の文字は黒（AC-410。監査の未決: 黄の面の輪郭線は #593C47 ではなく黒かグレー）
    for (const el of tags(svg, /<[a-z]+ [^>]*fill="#f2(?:e63d|c53d)"[^>]*>/g)) assert.ok(isNeutralColor(attr(el, 'stroke')) && contrastRatio(attr(el, 'stroke'), '#ffffff') >= 3, `黄の面の輪郭線: ${el}`);
    for (const t of tags(svg, /<text [^>]*data-back="#f2(?:e63d|c53d)"[^>]*>/g)) assert.equal(attr(t, 'fill'), '#000000');
  }
  // 見出しの飾りはマーカーの下線（橙）
  const L = buildLook(byId('warmCards'));
  assert.ok(ORANGE_RED.includes(L.marker));
  assert.equal(L.neutral, '#000000');
  assert.equal(L.balloonFill, '#ffffff');
  // PNG・PDF の保存の配色（exportLook）も白いカードの角の丸みを持つ
  assert.equal(exportLook({ ...byId('warmCards'), preset: true }).cardRadius, 12);
});

// FR-076 AC-670: 青見出し風の帯は #1e40af を基調とする青のグラデーション。最も明るい位置でも白抜きの文字は 4.5:1 以上。帯に絵記号
test('FR-076 AC-670: 青見出し風のタイトル帯・見出しは青のグラデーションの帯に白抜きの文字と絵記号で、最も明るい位置でも 4.5:1 以上', async () => {
  const p = byId('blueHeadings');
  assert.equal(p.headingBand.gradient[0].toLowerCase(), '#1e40af');
  for (const s of p.headingBand.gradient) assert.ok(contrastRatio('#ffffff', s) >= 4.5, `${s}: 白との比 ${contrastRatio('#ffffff', s).toFixed(2)}`);
  for (const level of ['detail', 'major']) {
    const { app } = await seeded('blueHeadings');
    toDetail(app, level);
    const svg = app.renderSvg();
    const grad = /<linearGradient id="preset-band-grad"[^>]*>(.*?)<\/linearGradient>/.exec(svg);
    assert.ok(grad, 'グラデーションの定義');
    const stops = [...grad[1].matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1].toLowerCase());
    assert.ok(stops.length >= 2 && stops.includes('#1e40af'));
    for (const s of stops) assert.ok(contrastRatio('#ffffff', s) >= 4.5, s);
    const bands = tags(svg, /<[a-z]+ [^>]*data-style-role="heading-band"[^>]*>/g);
    assert.ok(bands.length >= 1);
    for (const b of bands) assert.equal(attr(b, 'fill'), 'url(#preset-band-grad)');
    // AC-670（AC-410）: グラデーションを描けない描画系向けに、帯ごとに最も明るい位置の色の単色の下地があり、文字の data-back はその塗り
    const bases = tags(svg, /<rect [^>]*data-style-role="heading-band-base"[^>]*>/g);
    assert.equal(bases.length, bands.length, '帯ごとに単色の下地');
    const baseFills = new Set(bases.map((b) => attr(b, 'fill').toLowerCase()));
    assert.equal(baseFills.size, 1);
    const heads = tags(svg, /<text [^>]*data-role="(?:heading|topic-title)"[^>]*>/g);
    assert.ok(heads.length >= 1);
    for (const h of heads) {
      assert.equal(attr(h, 'fill'), '#ffffff', '白抜きの文字');
      assert.ok(contrastRatio('#ffffff', attr(h, 'data-back')) >= 4.5, '最も明るい位置で測る');
      assert.ok(baseFills.has(attr(h, 'data-back').toLowerCase()), '文字の直下の背景は下地の塗り');
    }
    const icons = tags(svg, /<g [^>]*data-style-role="heading-icon"[^>]*>/g);
    assert.equal(icons.length, bands.length, '帯ごとに絵記号');
    for (const ic of icons) assert.equal(attr(ic, 'stroke'), '#ffffff');
    const textBoxes = tags(svg, /<text [^>]*data-box="[^"]+"[^>]*>/g).map((t) => boxOf(attr(t, 'data-box')));
    for (const ic of icons) for (const t of textBoxes) assert.equal(overlap(boxOf(attr(ic, 'data-box')), t), false, '絵記号は文字に重ならない');
  }
  const L = buildLook(p);
  assert.equal(L.bandText, '#ffffff');
  assert.ok(contrastRatio(L.bandText, L.bandBack) >= 4.5);
  // 帯の文字が白でも黒でも 4.5:1 に届かないグラデーションの定義は拒否される（AC-405 の扱い）
  assert.deepEqual(validatePresetFields({ ...p, headingBand: { gradient: ['#1e40af', '#8fa8ff'] } }), { ok: false, reason: 'low_contrast' });
  assert.deepEqual(validatePresetFields({ ...p, headingBand: { gradient: ['#1e40af'] } }), { ok: false, reason: 'invalid_heading' });
});

// FR-076 AC-670 AC-410 AC-411: 2 つの風の配色の役割の判読性
test('FR-076 AC-670 AC-410 AC-411: 2 つの風でも、面の上の文字 4.5:1・枠と区切り線と紙面 3:1・黄の面は黒かグレーの輪郭と黒の文字', () => {
  for (const id of ['warmCards', 'blueHeadings']) {
    const L = buildLook(byId(id));
    for (const s of [L.bg, L.frameFill, L.emph, L.balloonFill, L.iconFill(0), L.iconFill(1), L.iconFill(2), L.iconFill(3)]) {
      assert.ok(contrastRatio(L.textOn(s), s) >= 4.5, `${id}: ${s}`);
      assert.ok(contrastRatio(L.outlineOf(s), L.bg) >= 3, `${id}: 輪郭 ${s}`);
      if (isYellowish(s)) { assert.ok(isNeutralColor(L.outlineOf(s))); assert.ok(contrastRatio(L.textOn(s), '#000000') < 1.5); }
    }
    assert.ok(contrastRatio(L.divider, L.bg) >= 3, `${id}: 区切り線`);
    assert.ok(contrastRatio(L.frame, L.bg) >= 3, `${id}: 枠`);
    assert.ok(contrastRatio(L.ink, L.bg) >= 4.5, `${id}: 文字`);
  }
});

// FR-076 AC-670 AC-412 AC-456 AC-467: 決定的・強制カラー・感情語の吹き出し
test('FR-076 AC-670 AC-412 AC-456 AC-467: 2 つの風の図は決定的で、強制カラーではシステム色、感情語のトピックの吹き出しはギザギザ', async () => {
  const scenes = [
    { id: 'a', status: 'confirmed', heading: '予算を決める', points: [{ id: 'a1', text: '予算を決めました' }, { id: 'a2', text: 'コストが高くて困った' }], relations: [] },
    { id: 'b', status: 'in_progress', heading: 'Next step', points: [{ id: 'b1', text: 'How about a pilot?' }], relations: [] },
  ];
  for (const id of ['warmCards', 'blueHeadings']) {
    const look = buildLook(byId(id));
    const a = renderPresetDiagram(scenes, { lang: 'ja' }, look); const b = renderPresetDiagram(JSON.parse(JSON.stringify(scenes)), { lang: 'ja' }, look);
    assert.equal(a.body, b.body, `${id}: 決定的`);
    const emo = renderPresetDiagram(scenes, { lang: 'ja', emotionScenes: new Set(['a']) }, look);
    const jag = tags(emo.body, /<polygon [^>]*data-style-role="balloon"[^>]*>/g);
    assert.equal(jag.length, 1); assert.match(jag[0], /data-shape="jagged"/);
    const normal = tags(emo.body, /<[a-z]+ [^>]*data-style-role="balloon"[^>]*data-shape="rounded"[^>]*>/g);
    assert.ok(normal.length >= 1, `${id}: 通常の吹き出しは角丸`);
    const t = renderPresetTopics([{ id: 't1', title: '予算', sceneIds: ['a'] }], [], scenes, { lang: 'ja', level: 'middle' }, look);
    assert.ok(t.body.includes('data-topic-id="t1"'));
    // 強制カラー: 風の配色ではなく OS のシステム色（グラデーション・白いカードの色を使わない。同梱部品の色は renderSvg の toSystemColors が変える）
    const f = forcedLook(byId(id));
    const fb = renderPresetDiagram(scenes, { lang: 'ja' }, f).body;
    assert.ok(!fb.includes('preset-band-grad'));
    for (const c of tags(fb, /<rect [^>]*data-style-role="card"[^>]*>/g)) assert.equal(attr(c, 'fill'), 'Canvas', `${id}: カードはシステム色`);
    for (const t of tags(fb, /<text [^>]*>/g)) assert.ok(['CanvasText', 'Canvas'].includes(attr(t, 'fill')), `${id}: 文字はシステム色 ${t}`);
    for (const c of [...WARM, '#1e40af', '#3b5bdb']) assert.ok(!toSystemColors(fb).toLowerCase().includes(c), `${id}: ${c} を使わない`);
  }
  const { app } = await seeded('blueHeadings');
  app.setForcedColors(true);
  const svg = app.renderSvg();
  assert.equal(hexes(svg).length, 0, '強制カラーの画面の図に風の配色がない');
  assert.equal(app.getDrawStyle(), 'blueHeadings', '選択は変わらない');
  app.setForcedColors(false);
  assert.match(app.renderSvg(), /url\(#preset-band-grad\)/, '戻すと風の配色');
});

// FR-076 AC-670 / FR-114: 黄黒手書き風の会議ボード型の区画の枠は雲形（黄・黒・グレー）
test('FR-076 AC-670: 黄黒手書き風は区画の枠を雲形で描く項目を持ち、雲形の枠のパスは決定的で中の矩形を囲む（黄・黒・グレーの 3 色）', () => {
  const yb = byId('yellowBlack');
  assert.equal(yb.boardFrame, 'cloud');
  assert.equal(presetOf(yb).boardFrame, 'cloud');
  const look = boardFrameLook(yb);
  assert.equal(look.shape, 'cloud');
  assert.ok(isYellowish(look.fill), '黄');
  assert.ok(isNeutralColor(look.stroke) && contrastRatio(look.stroke, '#ffffff') >= 3 && contrastRatio(look.text, look.fill) >= 4.5, '黒');
  assert.ok(isNeutralColor(look.shadow) && look.shadow !== look.stroke, 'グレー');
  for (const p of PRESET_STYLES.filter((x) => x.id !== 'yellowBlack')) assert.equal(boardFrameLook(p), null, `${p.id} は雲形の区画を持たない`);
  assert.equal(boardFrameLook({ id: 'handwritten' }), null);
  const a = cloudFramePath(10, 20, 300, 160, { seed: 'r1' }); const b = cloudFramePath(10, 20, 300, 160, { seed: 'r1' });
  assert.deepEqual(a, b, '決定的');
  assert.match(a.d, /^M[\d.]+ [\d.]+(A[\d.]+ [\d.]+ 0 0 1 [\d.]+ [\d.]+)+Z$/);
  assert.deepEqual(a.inner, [10, 20, 300, 160]);
  assert.ok(a.box[0] < 10 && a.box[1] < 20 && a.box[0] + a.box[2] > 310 && a.box[1] + a.box[3] > 180, '外接矩形は弧のふくらみを含む');
  // 弧の端点はすべて中の矩形の周の上（文字を置く中の矩形を枠がまたがない）
  for (const [, x, y] of a.d.matchAll(/A[\d.]+ [\d.]+ 0 0 1 ([\d.]+) ([\d.]+)/g)) {
    const px = Number(x); const py = Number(y);
    assert.ok(Math.abs(px - 10) < 0.2 || Math.abs(px - 310) < 0.2 || Math.abs(py - 20) < 0.2 || Math.abs(py - 180) < 0.2, `${px},${py}`);
  }
  assert.notEqual(cloudFramePath(10, 20, 300, 160, { seed: 'r2' }).d, a.d, '種が違えば揺らぎが違う');
  assert.deepEqual(validatePresetFields({ ...yb, boardFrame: 'star' }), { ok: false, reason: 'invalid_board_frame' });
});

// FR-076 AC-670 / NFR-UX-012 AC-466 / FR-075 AC-407: 書体の名前と並び、同梱しない
test('FR-076 AC-670 AC-407: Yomogi・Zen Kurenaido・Kaisei Decol は欧文専用の書体の直後・Yu Gothic UI の直前に並び、書体のファイルを同梱しない', () => {
  const names = FONT_STACKS.handwriting.map((f) => f.name);
  const yu = names.indexOf(JP_FONT);
  assert.deepEqual(names.slice(yu - 3, yu), ['Yomogi', 'Zen Kurenaido', 'Kaisei Decol'], 'Q-046 の回答 B（PARAM-185）');
  assert.ok(names.slice(0, yu - 3).every((n) => ['Segoe Print', 'Ink Free', 'Arial Rounded MT Bold'].includes(n)), 'その前は欧文専用の書体だけ');
  assert.ok(names.slice(yu + 1).every((n) => !['Yomogi', 'Zen Kurenaido', 'Kaisei Decol'].includes(n)), '3 書体は 1 回だけ');
  assert.equal(names.at(-1), 'sans-serif', '端末にないときは並びの次の書体（最後は総称の書体）');
  const web = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  assert.equal(walk(web).filter((p) => /\.(woff2?|ttf|otf|eot)$/i.test(p)).length, 0, '書体のファイルを同梱しない');
});

// FR-076 AC-670 AC-407: 2 つの風の PNG・PDF の保存は外部へのリクエストなしに行える
test('FR-076 AC-670 AC-407: 2 つの風で PNG・PDF を保存でき、外部へのリクエストは 0 件', async () => {
  for (const id of ['warmCards', 'blueHeadings']) {
    const { app, env } = await seeded(id);
    const calls = [];
    const saved = globalThis.fetch; globalThis.fetch = (...a) => { calls.push(a); throw new Error('network'); };
    try {
      await app.commands['save.png'](); await app.commands['save.pdf']();
    } finally { globalThis.fetch = saved; }
    assert.deepEqual(env.downloads.slice(-2).map((d) => d.mime), ['image/png', 'application/pdf']);
    assert.equal(calls.length, 0);
  }
});

// FR-077 AC-414: コマンドバーの「画風」グループに 15 の描画スタイルが常時表示され、2 つの風も名前・短い説明を持ち、押すと切り替わる
test('FR-077 AC-414 FR-076 AC-670: 「画風」グループに 2 つの風が常時表示され、ラベル・短い説明（40 文字以内）を持ち、押すと切り替わる', async () => {
  const { app } = await seeded('handwritten');
  const bar = app.getCommandBar();
  const g = bar.groups.find((x) => x.id === 'drawStyle');
  assert.equal(g.commands.length, 15);
  for (const [id, label] of [['warmCards', '暖色カード風'], ['blueHeadings', '青見出し風']]) {
    const it = bar.items.find((i) => i.command === `drawStyle.set:${id}`);
    assert.ok(it, id);
    assert.equal(it.label, label); assert.equal(it.labelVisible, true);
    assert.ok(it.tooltip.text && [...it.tooltip.text].length <= 40, `${id}: 短い説明 ${it.tooltip.text}`);
    await app.commands[`drawStyle.set:${id}`]();
    assert.equal(app.getDrawStyle(), id);
    const now = app.getCommandBar().items.filter((i) => i.group === 'drawStyle');
    assert.deepEqual(now.filter((i) => i.pressed).map((i) => i.command), [`drawStyle.set:${id}`]);
  }
  const icons = bar.items.map((i) => i.icon);
  assert.equal(new Set(icons).size, icons.length, 'アイコンの重複なし');
});

// FR-076 AC-413: LLM へ送る描画スタイル名は識別子（getDrawStyle の値。llmdraw.js の drawStyle）だけで、送信内容の版は変わらない
test('FR-076 AC-670 AC-413: 2 つの風を選んでも送る描画スタイル名は識別子だけで、送信内容の版（再同意の要否）は変わらない', async () => {
  const { CONSENT_VERSION } = await import('../../web/src/llm.js');
  assert.equal(CONSENT_VERSION, 'send-v2:points+scene+drawStyle+partKeys');
  for (const id of ['warmCards', 'blueHeadings']) {
    const { app } = await seeded(id);
    const sent = app.getDrawStyle();
    assert.equal(sent, id);
    assert.ok(!/#|[\u3000-\u9fff]/.test(sent), '配色・画風の記述を含まない');
  }
});
