// FR-077 AC-414 AC-416 AC-417 AC-418 AC-419 の単体・結合テスト（画面上部での画風の選択。stylepicker.js・settings.js・commandbar.js）。
// FR-076 の 9 つの風に依存しないよう、テスト用の描画スタイルを options.drawStyles で足して確かめる（一覧は登録簿から作る）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail, pdfTexts, CJK } from '../system/helpers.js';
import { exportLook, buildPdf, renderPng, paperTexture, PAPERS } from '../../web/src/export.js';
import { BUILTIN_STYLES } from '../../web/src/drawstyles.js';

// テスト用の画風プリセット（FR-075 の見た目の項目を持つ定義）と、見た目の項目を持たない定義
const CHALK_LOOK = {
  palette: { background: '#1f3a2e', primary: '#f5f5f0', accent: ['#ffd84d'], text: '#fafafa', secondary: '#9ad1ff' },
  paper: 'chalkboard', font: 'handwriting', headingDecoration: 'marker', balloon: 'cloud', stroke: { wobble: 1, width: 2.5 }, figures: false, icons: true,
  description: { ja: { color: '深緑の地に白と黄', drawing: '黒板にチョークで描いた線', font: '手書き風', mood: '授業のよう' }, en: { color: 'White and yellow on green', drawing: 'Chalk lines on a blackboard', font: 'Handwriting', mood: 'Like a class' } },
};
const CHALK = { id: 'chalk', label: { ja: 'チョーク風', en: 'Chalk' }, line: { width: 1.3, jitter: 0.6 }, fill: { mode: 'tint' }, text: { decor: 'bold', icons: true }, ...CHALK_LOOK };
const INK = { id: 'ink', label: { ja: '墨絵風', en: 'Ink wash' }, line: { width: 0.9, jitter: 0.2 }, fill: { mode: 'paper' }, text: { decor: 'plain', icons: false } };
const CHALK_SPEC = { id: 'chalk', preset: true, ...CHALK_LOOK };
const opts = (extra = {}) => ({ ...extra, options: { drawStyles: [CHALK, INK], ...(extra.options ?? {}) } });
const styleItems = (app) => app.getCommandBar().items.filter((i) => i.group === 'drawStyle');
const pressedIds = (app) => styleItems(app).filter((i) => i.pressed).map((i) => i.command.slice('drawStyle.set:'.length));
const labelOf = (app, id) => app.getDrawStyles().find((s) => s.id === id).label;

// FR-077 AC-414: 「画風」グループは登録簿のすべて（後から足した定義を含む）を同じ並びで常時出す。説明は定義の description ＞ 組込みの説明 ＞ 名前
test('FR-077 AC-414: 画風グループは登録されたすべての描画スタイルを同じ並びで出し、説明は定義の description を使う', async () => {
  const { app } = await newApp(opts());
  const ids = () => styleItems(app).map((i) => i.command.slice('drawStyle.set:'.length));
  assert.deepEqual(ids(), app.getDrawStyles().map((s) => s.id));
  assert.deepEqual(ids().slice(-2), ['chalk', 'ink']);
  const item = (id) => styleItems(app).find((i) => i.command === `drawStyle.set:${id}`);
  assert.equal(item('chalk').description, '黒板にチョークで描いた線', '画風の記述の描画の文');
  assert.equal(item('chalk').tooltip.text, item('chalk').description);
  assert.equal(item('ink').description, '墨絵風', '説明がない定義は名前');
  assert.ok(item('anime').description.trim() !== 'アニメ調', '組込みには短い説明がある');
  assert.equal(app.getCommandBar().groups.find((g) => g.id === 'drawStyle').commands.join(), styleItems(app).map((i) => i.command).join());
  app.setLang('en');
  assert.equal(item('chalk').description, 'Chalk lines on a blackboard');
  for (const i of styleItems(app)) assert.ok(!CJK.test(i.description) && !CJK.test(i.label), `${i.command}: ${i.label} / ${i.description}`);
  // 後から登録した描画スタイルもグループ・コマンドの検索に現れる
  assert.equal(app.registerDrawStyle({ ...INK, id: 'later', label: { ja: '後付け風', en: 'Later' } }).ok, true);
  assert.equal(ids().at(-1), 'later');
  assert.ok(app.searchCommands('Later').some((c) => c.command === 'drawStyle.set:later'));
});

// FR-077 AC-416: コマンド drawStyle.set:<id>（実 DOM では項目のクリック・Enter・Space）で選ぶ。旧一覧・キーは廃止
test('FR-077 AC-416: drawStyle.set:<id> で選ぶと現在値・pressed・読み上げメッセージが変わる。旧 drawStyle.pick・一覧・専用キーはない', async () => {
  const { app } = await newApp(opts());
  for (const name of ['drawStyle.pick', 'drawStyle.select.chalk']) assert.equal(typeof app.commands[name], 'undefined', name);
  assert.ok(!app.keymap.some((k) => k.command.startsWith('drawStyle.')), '画風の専用キーはない');
  for (const n of ['getDrawStylePicker', 'getDrawStylePickerView', 'pickDrawStyle']) assert.equal(app[n], undefined, n);
  assert.equal(app.commands['drawStyle.set:nosuch'], undefined, '登録された ID だけ');
  assert.deepEqual(pressedIds(app), ['handwritten']);
  assert.ok(styleItems(app).every((i) => i.tabbable && i.tabIndex === 0 && i.labelVisible && i.accessibleName === i.label && i.describedBy === i.tooltip.id));
  for (const id of ['chalk', 'ink', 'anime']) {
    app.commands[`drawStyle.set:${id}`]();
    assert.equal(app.getDrawStyle(), id);
    assert.match(app.renderSvg(), new RegExp(`data-draw-style="${id}"`));
    assert.deepEqual(pressedIds(app), [id]);
    assert.ok(styleItems(app).every((i) => (i.selectedMark !== null) === i.pressed), '現在のものだけ色以外の印');
    assert.ok(app.getState().message.text.includes(labelOf(app, id)), '名前つきで読み上げ');
    assert.equal(app.getCommandBar().status.role, 'status');
  }
  assert.equal(app.operateBarItem('drawStyle.set:chalk').ok, true);
  assert.equal(app.getDrawStyle(), 'chalk');
  assert.equal(app.setDrawStyle('nosuch').ok, false);
  assert.equal(app.getDrawStyle(), 'chalk', '未知の ID は不変');
  // コマンドの検索
  assert.ok(app.searchCommands('墨絵').some((c) => c.command === 'drawStyle.set:ink'));
});

// FR-077 AC-417: 13 項目（テストでは登録を足した数）すべてが狭い画面でも省かれず、折り返して重ならない
test('FR-077 AC-417: 画風グループの全項目は省かれず、外形は重ならず画面幅の内側に収まる（横スクロールなし）', async () => {
  const { app } = await newApp(opts());
  const n = app.getDrawStyles().length;
  for (const w of [320, 640, 1280]) {
    const lay = app.getCommandBarLayout({ viewportWidth: w });
    assert.equal(lay.scrollsHorizontally, false);
    assert.equal(lay.items.filter((i) => i.command.startsWith('drawStyle.set:')).length, n, `${w}px: 全項目`);
    for (const [i, a] of lay.items.entries()) {
      assert.ok(a.rect.x >= 0 && a.rect.x + a.rect.w <= Math.max(w, a.rect.w + 16), `${w}px: ${a.command} は画面の内側`);
      for (const b of lay.items.slice(i + 1)) {
        const hit = a.rect.x < b.rect.x + b.rect.w && b.rect.x < a.rect.x + a.rect.w && a.rect.y < b.rect.y + b.rect.h && b.rect.y < a.rect.y + a.rect.h;
        assert.ok(!hit, `${w}px: ${a.command} と ${b.command} が重ならない`);
      }
    }
  }
  assert.ok(app.getCommandBarLayout({ viewportWidth: 1280 }).items.filter((i) => i.command.startsWith('drawStyle.set:')).every((i) => i.labelLines === 1));
  // 「表示」の直後の 10 グループ目（AC-459）。設定グループは描画スタイル・レイアウト型を持たない
  assert.deepEqual(app.getCommandBar().groups.map((g) => g.id).slice(0, 5), ['inputMode', 'import', 'session', 'view', 'drawStyle']); // FR-117: 入力モードのグループが先頭
  assert.ok(!app.getCommandBar().groups.find((g) => g.id === 'settings').commands.some((c) => c.startsWith('drawStyle.') || c.startsWith('layoutType.')));
});

// FR-077 AC-418
test('FR-077 AC-418: 上部で選んだ値はセッションファイルで復元され、［設定］の既定・grp.* は変えない', async () => {
  const { app, env } = await newApp(opts());
  await seedThreeScenes(app, env);
  const before = env.storage.dump().filter(([k]) => k === 'grp.settings');
  assert.equal(app.setDrawStyle('chalk').ok, true);
  assert.equal(app.getSettings().drawStyle, 'handwritten');
  assert.deepEqual(env.storage.dump().filter(([k]) => k === 'grp.settings'), before);
  assert.ok(!env.storage.dump().some(([k, v]) => k.startsWith('grp.') && k !== 'grp.session' && v.includes('"chalk"')), 'grp.*（自動保存のセッション以外）に現在値を書かない');
  await app.commands['file.save']();
  const data = env.downloads.at(-1).data;
  assert.equal(JSON.parse(data).drawStyle, 'chalk');
  const { app: b } = await newApp(opts());
  assert.equal((await b.loadSessionFile({ name: 's.json', type: 'application/json', size: Buffer.byteLength(data), text: data })).ok, true);
  assert.equal(b.getDrawStyle(), 'chalk');
  assert.equal(pressedIds(b).join(), 'chalk');
  // 登録にない名前（この端末に chalk がない）: ［設定］の既定で表示し、内容は失わない
  const { app: c } = await newApp();
  c.setSettings({ drawStyle: 'simple' });
  assert.equal((await c.loadSessionFile({ name: 's.json', type: 'application/json', size: Buffer.byteLength(data), text: data })).ok, true);
  assert.equal(c.getDrawStyle(), 'simple');
  assert.match(c.renderSvg(), /data-draw-style="simple"/);
  assert.equal(c.renderOutline(), app.renderOutline());
});

test('FR-077 AC-418: 上部と［設定］は後から操作した方が現在値になり、［設定］の選択肢は上部の一覧と同じ（後から足した定義を含む）', async () => {
  const { app, env, createApp } = await newApp(opts());
  await seedThreeScenes(app, env);
  app.setDrawStyle('chalk');
  app.setSettings({ drawStyle: 'ink' });
  assert.equal(app.getDrawStyle(), 'ink'); assert.equal(pressedIds(app).join(), 'ink');
  app.setDrawStyle('anime');
  assert.equal(app.getDrawStyle(), 'anime'); assert.equal(app.getSettings().drawStyle, 'ink');
  assert.match(app.renderSvg(), /data-draw-style="anime"/);
  app.registerDrawStyle({ ...INK, id: 'later', label: { ja: '後付け風', en: 'Later' } });
  app.commands['settings.open']();
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    const f = app.getSettingsDialog().fields.find((x) => x.id === 'drawStyle');
    assert.deepEqual(f.options.map((o) => [o.value, o.label]), app.getCommandBar().items.filter((i) => i.group === 'drawStyle').map((i) => [i.command.slice('drawStyle.set:'.length), i.label]), lang);
  }
  const again = await createApp(env.options);
  assert.equal(again.getDrawStyle(), 'ink', '再読込後は［設定］の既定');
});

// FR-077 AC-419
function recordingCanvas() {
  const ops = [];
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44]);
  const f = (w, h) => {
    const ctx = new Proxy({}, {
      get(t, p) {
        if (p === 'measureText') return (s) => ({ width: String(s).length * 8 });
        if (p === 'canvas') return canvas;
        if (p in t) return t[p];
        return (...a) => { ops.push([String(p), ...a.map((x) => (typeof x === 'number' ? Math.round(x) : String(x)))]); };
      },
      set(t, p, v) { t[p] = v; ops.push(['set', String(p), String(v)]); return true; },
    });
    const canvas = { width: w, height: h, getContext: () => ctx, toBytes: async () => png };
    return canvas;
  };
  return Object.assign(f, { ops });
}

test('FR-077 AC-419: 上部で選んだ描画スタイルで PNG・SVG・PDF を保存し、画風プリセットは見た目が変わり、既存の定義は従来の出力のまま。外部へ要求しない', async () => {
  const cv = recordingCanvas();
  const relay = [];
  const { app, env } = await newApp(opts({ canvasFactory: cv, options: { relay: async (r) => { relay.push(r); return { status: 404, body: {} }; } } }));
  await seedThreeScenes(app, env);
  toDetail(app);
  const strings = app.getState().scenes.flatMap((s) => [s.heading, ...s.points.map((p) => p.text)]);
  const outs = {};
  for (const id of ['handwritten', 'anime', 'simple', 'rpg', 'ink', 'chalk']) {
    assert.equal(app.setDrawStyle(id).ok, true);
    const n = env.downloads.length; cv.ops.length = 0;
    await app.commands['save.png'](); const ops = JSON.stringify(cv.ops);
    await app.commands['save.svg'](); await app.commands['save.pdf']();
    const [png, svg, pdf] = env.downloads.slice(n);
    assert.equal(png.mime, 'image/png'); assert.equal(pdf.mime, 'application/pdf');
    assert.equal(svg.data.replace(/<desc>[\s\S]*?<\/desc>/, ''), app.renderSvg(), `${id}: 保存した SVG は画面の図と同じ（FR-096: <desc> の説明だけが加わる）`);
    assert.match(svg.data, new RegExp(`data-draw-style="${id}"`));
    const texts = [...svg.data.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, '')).join('');
    for (const s of strings) { assert.ok(texts.includes(s), `${id}: SVG に「${s}」`); assert.ok(pdfTexts(pdf.data).includes(s), `${id}: PDF に「${s}」`); assert.ok(cv.ops.some((o) => o[0] === 'fillText' && o[1] === s), `${id}: PNG に「${s}」`); }
    outs[id] = { ops, pdf: Buffer.from(pdf.data).toString('latin1') };
  }
  // FR-047 AC-227・FR-029 AC-147: 既存の定義（プリセットでない）の PNG・PDF は従来の出力（描画スタイルに依らない出力）と同じ
  for (const id of ['anime', 'simple', 'rpg', 'ink']) {
    assert.equal(outs[id].ops, outs.handwritten.ops, `${id}: PNG は従来の出力`);
    assert.equal(outs[id].pdf, outs.handwritten.pdf, `${id}: PDF は従来の出力`);
  }
  assert.notEqual(outs.chalk.ops, outs.handwritten.ops, '画風プリセット: PNG の描画が変わる');
  assert.notEqual(outs.chalk.pdf, outs.handwritten.pdf, '画風プリセット: PDF が変わる');
  assert.match(outs.chalk.ops, /"set","fillStyle","#1f3a2e"\],\["fillRect",0,0/, '紙面の背景色');
  assert.match(outs.chalk.pdf, /0\.122 0\.227 0\.180 rg 0 0 595 842 re f/, 'PDF の紙面の背景色');
  assert.equal(relay.length, 0, '選択・描き替え・保存で中継へ要求しない');
});

// FR-077 AC-419: 保存用の見た目は画風プリセット（契約の preset:true）だけに効き、紙面の質感（6 種）を線分で描く
test('FR-077 AC-419: exportLook は画風プリセットだけに効き、既存の定義（4 つ・preset:false）は従来の出力（null）', () => {
  for (const d of BUILTIN_STYLES) assert.equal(exportLook(d), null, `${d.id}: 生の定義`);
  for (const id of ['handwritten', 'anime', 'simple', 'rpg']) assert.equal(exportLook({ id, preset: false }), null, `${id}: 契約の形`);
  assert.equal(exportLook(null), null);
  const look = exportLook(CHALK_SPEC);
  assert.deepEqual([look.background, look.text, look.paper, look.headingDecoration, look.balloon, look.lineWidth, look.accent], ['#1f3a2e', '#fafafa', 'chalkboard', 'marker', 'cloud', 2.5, '#ffd84d']);
  assert.equal(exportLook({ ...CHALK_SPEC, paper: 'nosuch' }).paper, 'plain');
});

test('FR-077 AC-419: 紙面の質感は白紙以外の 5 種すべてで図形を持ち、PNG・PDF に描かれ、種類ごとに異なる（毎回同じ）', async () => {
  const scenes = [{ heading: '見出しA', points: [{ text: '要点1' }, { text: '要点2' }] }];
  const seen = new Map();
  assert.deepEqual(PAPERS, ['plain', 'grid', 'ruled', 'chalkboard', 'whiteboard', 'kraft']);
  for (const paper of PAPERS) {
    const look = exportLook({ ...CHALK_SPEC, paper });
    const tex = paperTexture(look, 400, 300);
    if (paper === 'plain') { assert.equal(tex.length, 0); continue; }
    assert.ok(tex.length >= 3, `${paper}: 質感の図形がある`);
    assert.ok(tex.every((t) => /^#[0-9a-f]{6}$/.test(t.color) && t.width > 0), `${paper}: 色・太さ`);
    assert.deepEqual(paperTexture(look, 400, 300), tex, `${paper}: 決定的`);
    seen.set(paper, JSON.stringify(tex));
    const cv = recordingCanvas();
    await renderPng(scenes, cv, { look });
    const bg = cv.ops.findIndex((o) => o[0] === 'fillRect' && o[1] === 0 && o[2] === 0);
    const firstText = cv.ops.findIndex((o) => o[0] === 'fillText');
    const strokes = cv.ops.slice(bg, firstText).filter((o) => o[0] === 'lineTo').length;
    assert.ok(bg >= 0 && strokes >= 3, `${paper}: PNG で背景の後・文字の前に質感の線 ${strokes}`);
    const pdf = Buffer.from(buildPdf(scenes, { look })).toString('latin1');
    assert.ok((pdf.match(/ m \d+(\.\d+)? \d+(\.\d+)? l S/g) ?? []).length >= 3, `${paper}: PDF に質感の線`);
    for (const s of ['見出しA', '要点1', '要点2']) assert.ok(pdfTexts(Buffer.from(pdf, 'latin1')).includes(s));
  }
  assert.equal(new Set(seen.values()).size, 5, '質感は種類ごとに異なる');
  assert.doesNotMatch(Buffer.from(buildPdf(scenes)).toString('latin1'), / re f/, '従来の PDF は図形を描かない');
});

// FR-077 AC-417: 画風の項目は狭い・低い画面でも一覧（開閉）を持たず、常時表示のボタンとして並ぶ（旧一覧の配置の計算はない）
test('FR-077 AC-417: 画風の項目は開閉する一覧を持たず、どの幅でも全項目のボタンが縦横スクロールなしで並ぶ', async () => {
  const { app } = await newApp(opts());
  for (const w of [320, 480, 767, 1280]) {
    const lay = app.getCommandBarLayout({ viewportWidth: w });
    const own = lay.items.filter((i) => i.command.startsWith('drawStyle.set:'));
    assert.equal(own.length, app.getDrawStyles().length, `${w}px`);
    assert.ok(own.every((i) => i.rect.w > 0 && i.rect.h > 0 && i.labelLines >= 1), `${w}px`);
    assert.equal(lay.overflowMenu, undefined, `${w}px: 画風は溢れメニューに入れない`);
  }
  assert.ok(styleItems(app).every((i) => !('expanded' in i) && !('hasPopup' in i) && !('valueLabel' in i)));
});

// AC-456 の指摘: 強制カラーのシステム色への変換は画面の表示だけ。保存する SVG・PNG・PDF は風の配色
test('FR-077 AC-419: 強制カラーの間も、保存する SVG・PNG・PDF は風の配色で、画面の図だけがシステム色になる', async () => {
  const cv = recordingCanvas();
  const { app, env } = await newApp(opts({ canvasFactory: cv }));
  await seedThreeScenes(app, env);
  app.setDrawStyle('chalk');
  const before = { svg: app.renderSvg() };
  await app.commands['save.png'](); before.png = JSON.stringify(cv.ops); cv.ops.length = 0;
  await app.commands['save.pdf'](); before.pdf = Buffer.from(env.downloads.at(-1).data).toString('latin1');
  assert.equal(app.setForcedColors(true).ok, true);
  assert.notEqual(app.renderSvg(), before.svg, '画面の図はシステム色');
  assert.match(app.renderSvg(), /CanvasText/);
  await app.commands['save.svg']();
  const svg = env.downloads.at(-1).data;
  assert.equal(svg.replace(/<desc>[\s\S]*?<\/desc>/, ''), before.svg.replace(/<desc>[\s\S]*?<\/desc>/, ''), '保存する SVG は風の配色（強制カラーでないときの図と同じ。FR-096 の <desc> を除く）');
  assert.doesNotMatch(svg, /CanvasText|ButtonText/);
  await app.commands['save.png'](); assert.equal(JSON.stringify(cv.ops), before.png, 'PNG は風の配色');
  await app.commands['save.pdf'](); assert.equal(Buffer.from(env.downloads.at(-1).data).toString('latin1'), before.pdf, 'PDF は風の配色');
  assert.equal(app.getForcedColors(), true, '保存の後も画面の強制カラーは保たれる');
  assert.match(app.renderSvg(), /CanvasText/);
});
