// FR-077 AC-414 AC-416 AC-417 AC-418 AC-419 の単体・結合テスト（画面上部での画風の選択。stylepicker.js・settings.js・commandbar.js）。
// FR-076 の 9 つの風に依存しないよう、テスト用の描画スタイルを options.drawStyles で足して確かめる（一覧は登録簿から作る）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail, pdfTexts, CJK } from '../system/helpers.js';
import { exportLook, buildPdf } from '../../web/src/export.js';
import { BUILTIN_STYLES } from '../../web/src/drawstyles.js';

const CHALK = { id: 'chalk', label: { ja: 'チョーク風', en: 'Chalk' }, description: { ja: '黒板にチョークで描いた線', en: 'Chalk lines on a blackboard' }, line: { width: 1.3, jitter: 0.6 }, fill: { mode: 'tint' }, text: { decor: 'bold', icons: true } };
const INK = { id: 'ink', label: { ja: '墨絵風', en: 'Ink wash' }, line: { width: 0.9, jitter: 0.2 }, fill: { mode: 'paper' }, text: { decor: 'plain', icons: false } };
const opts = () => ({ options: { drawStyles: [CHALK, INK] } });
const pickItem = (app) => app.getCommandBar().items.find((i) => i.command === 'drawStyle.pick');
const labelOf = (app, id) => app.getDrawStyles().find((s) => s.id === id).label;

// FR-077 AC-414: 一覧は登録簿のすべて（後から足した定義を含む）。説明は定義の description ＞ 組込みの説明 ＞ 名前
test('FR-077 AC-414: 一覧は登録されたすべての描画スタイルを同じ並びで出し、説明は定義の description を使う', async () => {
  const { app } = await newApp(opts());
  app.commands['drawStyle.pick']();
  const p = app.getDrawStylePicker();
  assert.deepEqual(p.options.map((o) => o.id), app.getDrawStyles().map((s) => s.id));
  assert.deepEqual(p.options.map((o) => o.id).slice(-2), ['chalk', 'ink']);
  assert.equal(p.options.find((o) => o.id === 'chalk').description, '黒板にチョークで描いた線');
  assert.equal(p.options.find((o) => o.id === 'ink').description, '墨絵風', '説明がない定義は名前');
  assert.ok(p.options.find((o) => o.id === 'anime').description.trim() !== 'アニメ調', '組込みには短い説明がある');
  app.setLang('en');
  assert.equal(app.getDrawStylePicker().options.find((o) => o.id === 'chalk').description, 'Chalk lines on a blackboard');
  for (const o of app.getDrawStylePicker().options) assert.ok(!CJK.test(o.description), `${o.id}: ${o.description}`);
  // 後から登録した描画スタイルも一覧・コマンドの検索に現れる
  assert.equal(app.registerDrawStyle({ ...INK, id: 'later', label: { ja: '後付け風', en: 'Later' } }).ok, true);
  assert.equal(app.getDrawStylePicker().options.at(-1).id, 'later');
  assert.ok(app.searchCommands('Later').some((c) => c.command === 'drawStyle.select.later'));
});

// FR-077 AC-416: 候補の移動は端で止まり、Enter・Space で決定、Esc で取り消す。一覧が閉じているときは通常のキー処理
test('FR-077 AC-416: 一覧のキー操作（端で止まる・Space で決定・閉じているときは素通し）', async () => {
  const { app } = await newApp(opts());
  assert.equal(app.handleKey({ key: 'ArrowDown' }), null, '一覧が閉じているときは何もしない');
  const k = app.keymap.find((b) => b.command === 'drawStyle.pick');
  assert.deepEqual([k.key, !!k.alt, !!k.shift, !!k.ctrl], ['s', true, true, false]);
  app.handleKey({ key: 'S', altKey: true, shiftKey: true });
  assert.equal(app.getDrawStylePicker().open, true);
  app.handleKey({ key: 'ArrowUp' });
  assert.equal(app.getDrawStylePicker().activeId, 'handwritten', '先頭より上へは行かない');
  app.handleKey({ key: 'End' }); app.handleKey({ key: 'ArrowDown' });
  assert.equal(app.getDrawStylePicker().activeId, 'ink', '末尾より下へは行かない');
  app.handleKey({ key: 'ArrowUp' });
  assert.equal(app.handleKey({ key: ' ' }), 'drawStyle.pick.choose');
  assert.equal(app.getDrawStyle(), 'chalk');
  assert.deepEqual([app.getDrawStylePicker().open, app.getDrawStylePicker().focus], [false, 'button']);
  assert.ok(app.getState().message.text.includes('チョーク風'));
  // 同じコマンドでもう一度押すと閉じる（トグル）
  app.commands['drawStyle.pick'](); app.commands['drawStyle.pick']();
  assert.equal(app.getDrawStylePicker().open, false);
  // 一覧の外へフォーカスが移ったら閉じる（ボタンへは戻さない）
  app.commands['drawStyle.pick'](); app.closeDrawStylePicker(null);
  assert.deepEqual([app.getDrawStylePicker().open, app.getDrawStylePicker().focus], [false, null]);
  assert.equal(app.getDrawStyle(), 'chalk');
});

// FR-077 AC-417: ボタンの外形は重ならず、狭い画面では折り返して画面の内側に収まる
test('FR-077 AC-417: コマンドバーの外形は重ならず画面幅の内側に収まり、画風のボタンは一覧（listbox）を開くことを示す', async () => {
  const { app } = await newApp(opts());
  for (const w of [320, 640, 1280]) {
    const lay = app.getCommandBarLayout({ viewportWidth: w });
    assert.equal(lay.scrollsHorizontally, false);
    for (const [i, a] of lay.items.entries()) {
      assert.ok(a.rect.x >= 0 && a.rect.x + a.rect.w <= Math.max(w, a.rect.w + 16), `${w}px: ${a.command} は画面の内側`);
      for (const b of lay.items.slice(i + 1)) {
        const hit = a.rect.x < b.rect.x + b.rect.w && b.rect.x < a.rect.x + a.rect.w && a.rect.y < b.rect.y + b.rect.h && b.rect.y < a.rect.y + a.rect.h;
        assert.ok(!hit, `${w}px: ${a.command} と ${b.command} が重ならない`);
      }
    }
    const v = app.getDrawStylePickerView({ viewportWidth: w });
    assert.ok(v.width <= w, `${w}px: 一覧の幅は画面の内側`);
  }
  assert.equal(pickItem(app).valueLabel, '手書き調');
  assert.equal(pickItem(app).hasPopup, 'listbox');
});

// FR-077 AC-418
test('FR-077 AC-418: 上部で選んだ値はセッションファイルで復元され、［設定］の既定・grp.* は変えない', async () => {
  const { app, env } = await newApp(opts());
  await seedThreeScenes(app, env);
  const before = env.storage.dump().filter(([k]) => k === 'grp.settings');
  assert.equal(app.pickDrawStyle('chalk').ok, true);
  assert.equal(app.getSettings().drawStyle, 'handwritten');
  assert.deepEqual(env.storage.dump().filter(([k]) => k === 'grp.settings'), before);
  assert.ok(!env.storage.dump().some(([k, v]) => k.startsWith('grp.') && k !== 'grp.session' && v.includes('"chalk"')), 'grp.*（自動保存のセッション以外）に現在値を書かない');
  await app.commands['file.save']();
  const data = env.downloads.at(-1).data;
  assert.equal(JSON.parse(data).drawStyle, 'chalk');
  const { app: b } = await newApp(opts());
  assert.equal((await b.loadSessionFile({ name: 's.json', type: 'application/json', size: Buffer.byteLength(data), text: data })).ok, true);
  assert.equal(b.getDrawStyle(), 'chalk');
  assert.equal(b.getDrawStylePicker().current, 'chalk');
  assert.equal(pickItem(b).valueLabel, 'チョーク風');
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
  app.pickDrawStyle('chalk');
  app.setSettings({ drawStyle: 'ink' });
  assert.equal(app.getDrawStyle(), 'ink'); assert.equal(pickItem(app).valueLabel, '墨絵風');
  app.pickDrawStyle('anime');
  assert.equal(app.getDrawStyle(), 'anime'); assert.equal(app.getSettings().drawStyle, 'ink');
  assert.match(app.renderSvg(), /data-draw-style="anime"/);
  app.registerDrawStyle({ ...INK, id: 'later', label: { ja: '後付け風', en: 'Later' } });
  app.commands['settings.open']();
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    const f = app.getSettingsDialog().fields.find((x) => x.id === 'drawStyle');
    assert.deepEqual(f.options.map((o) => [o.value, o.label]), app.getDrawStylePicker().options.map((o) => [o.id, o.label]), lang);
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

test('FR-077 AC-419: 上部で選んだ描画スタイルで PNG・SVG・PDF を保存し、SVG は画面の図と同じで文字列を <text> に含む。外部へ要求しない', async () => {
  const cv = recordingCanvas();
  const relay = [];
  const { app, env } = await newApp({ canvasFactory: cv, options: { drawStyles: [CHALK, INK], relay: async (r) => { relay.push(r); return { status: 404, body: {} }; } } });
  await seedThreeScenes(app, env);
  toDetail(app);
  const strings = app.getState().scenes.flatMap((s) => [s.heading, ...s.points.map((p) => p.text)]);
  const outs = {};
  for (const id of ['handwritten', 'chalk', 'ink']) {
    assert.equal(app.pickDrawStyle(id).ok, true);
    const n = env.downloads.length; cv.ops.length = 0;
    await app.commands['save.png'](); const ops = JSON.stringify(cv.ops);
    await app.commands['save.svg'](); await app.commands['save.pdf']();
    const [png, svg, pdf] = env.downloads.slice(n);
    assert.equal(png.mime, 'image/png'); assert.equal(pdf.mime, 'application/pdf');
    assert.equal(svg.data, app.renderSvg(), `${id}: 保存した SVG は画面の図と同じ`);
    assert.match(svg.data, new RegExp(`data-draw-style="${id}"`));
    const texts = [...svg.data.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, '')).join('');
    for (const s of strings) { assert.ok(texts.includes(s), `${id}: SVG に「${s}」`); assert.ok(pdfTexts(pdf.data).includes(s), `${id}: PDF に「${s}」`); }
    outs[id] = { ops, svg: svg.data, pdf: Buffer.from(pdf.data).toString('latin1') };
  }
  for (const id of ['chalk', 'ink']) {
    assert.notEqual(outs[id].svg, outs.handwritten.svg, `${id}: SVG が手書き調と異なる`);
    assert.notEqual(outs[id].ops, outs.handwritten.ops, `${id}: PNG の描画が手書き調と異なる`);
    assert.notEqual(outs[id].pdf, outs.handwritten.pdf, `${id}: PDF が手書き調と異なる`);
  }
  assert.equal(relay.length, 0, '選択・描き替え・保存で中継へ要求しない');
});

// FR-077 AC-419: 保存用の見た目は定義から決まる。従来の手書き調は従来の出力（null）、FR-075 の見た目の項目（紙面・配色・見出しの飾り・吹き出し）は PDF にも描く
test('FR-077 AC-419: 保存用の見た目（exportLook）は手書き調で従来どおり、画風の項目（配色・紙面・見出しの飾り・吹き出し）を PDF に反映する', () => {
  assert.equal(exportLook(BUILTIN_STYLES.find((d) => d.id === 'handwritten')), null, '手書き調は従来の出力');
  assert.equal(exportLook(null), null);
  for (const id of ['anime', 'simple']) assert.ok(exportLook(BUILTIN_STYLES.find((d) => d.id === id)), `${id} は従来と異なる見た目`);
  const preset = { ...CHALK, id: 'board', palette: { background: '#1f3a2e', primary: '#f5f5f0', accent: ['#ffd84d'], text: '#fafafa', secondary: '#9ad1ff' }, paper: 'grid', headingDecoration: 'marker', balloon: 'cloud', stroke: { wobble: 1, width: 2.5 } };
  const look = exportLook(preset);
  assert.deepEqual([look.background, look.text, look.paper, look.headingDecoration, look.balloon, look.lineWidth, look.accent], ['#1f3a2e', '#fafafa', 'grid', 'marker', 'cloud', 2.5, '#ffd84d']);
  assert.equal(exportLook({ ...preset, palette: { ...preset.palette, background: 'not-a-color' } }).background, '#ffffff', '色でない値は使わない');
  const scenes = [{ heading: '見出しA', points: [{ text: '要点1' }, { text: '要点2' }] }];
  const base = Buffer.from(buildPdf(scenes)).toString('latin1');
  const styled = Buffer.from(buildPdf(scenes, { look })).toString('latin1');
  assert.match(styled, /0\.122 0\.227 0\.180 rg 0 0 595 842 re f/, '紙面の背景色');
  assert.match(styled, / m \d+ 792 l S/, '方眼の縦線');
  assert.match(styled, /1\.000 0\.847 0\.302 rg/, 'マーカーの強調色');
  assert.doesNotMatch(base, / re f/, '従来の PDF は図形を描かない');
  for (const s of ['見出しA', '要点1', '要点2']) assert.ok(pdfTexts(Buffer.from(styled, 'latin1')).includes(s));
});
