// FR-077 AC-414〜AC-419（System Test。契約: tests/system/CONTRACT-FR077-078.md「画面上部での画風の選択」）
// 期待値は受入基準だけから決める（PARAM-006=640px、PARAM-011=6 全角/半角 12、PARAM-012=1280px、PARAM-081=1 秒、PARAM-089=10 シーン、PARAM-090=50 要点）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { newApp, seedThreeScenes, toDetail, CJK, pdfTexts } from './helpers.js';

const OLD = ['handwritten', 'anime', 'simple', 'rpg']; // 既存の 4 つ（FR-029・FR-047）
const NARROW = 640; // PARAM-006
const WIDE = 1280; // PARAM-012
const LIMIT_MS = 1000; // PARAM-081
const weight = (s) => [...s].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.5), 0);
const pickItem = (app) => app.getCommandBar().items.find((i) => i.command === 'drawStyle.pick');
const picker = (app) => app.getDrawStylePicker();
const ids = (app) => app.getDrawStyles().map((s) => s.id);
const labelOf = (app, id) => app.getDrawStyles().find((s) => s.id === id).label;
const presets = (app) => ids(app).filter((id) => !OLD.includes(id));
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const keep = (app) => { const s = app.getState(); return JSON.stringify([s.utterances.map((u) => u.text), s.scenes, s.selectedSceneId, s.session, s.input.draft, app.getDetailLevel(), app.getLayoutInfo(), s.viewMode]); };

// PARAM-089 シーン・1 シーン 5 個（PARAM-090 / PARAM-089）の要点。40 文字以下の発話は 1 要点（CONTRACT.md）。
function seedScenes(app, env, nScenes = 10, perScene = 5) {
  app.commands['session.start']();
  for (let i = 0; i < nScenes; i++) {
    for (let j = 0; j < perScene; j++) { app.setDraft(`議題${i + 1}の論点${j + 1}を確認する`); assert.equal(app.submitDraft().ok, true); env.tick(1); }
    if (i < nScenes - 1) app.commands['session.nextScene']();
  }
}

// FR-077 AC-414
test('FR-077 AC-414: コマンドバーに画風を選ぶボタンがあり、常時表示のラベル（6 文字以内）・ツールチップ・現在の画風の表示を持つ', async () => {
  const { app } = await newApp();
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    const it = pickItem(app);
    assert.ok(it, `${lang}: drawStyle.pick のボタンがある`);
    assert.ok(it.label.trim(), 'ラベルは非空');
    if (lang === 'ja') assert.ok(weight(it.label.trim()) <= 6, `ラベル「${it.label}」は全角 6 文字以内`);
    else assert.ok([...it.label.trim()].length <= 12, `label "${it.label}" は半角 12 文字以内`);
    assert.equal(it.labelVisible, true, 'ラベルはホバー・フォーカスなしで常に見える');
    assert.equal(it.accessibleName, it.label);
    assert.ok(it.tooltip?.text?.trim(), 'ツールチップの説明文がある');
    assert.equal(it.describedBy, it.tooltip.id);
    const tip = app.showTooltip('drawStyle.pick', 'hover');
    assert.equal(tip.visible, true); assert.equal(tip.text, it.tooltip.text);
    app.hideTooltip('drawStyle.pick', 'leave');
    assert.equal(it.valueLabel, labelOf(app, app.getDrawStyle()), '上部に現在の画風の名前が出る');
  }
});

test('FR-077 AC-414: 開くと既存の 4 つと 9 つの風の計 13 の描画スタイルが名前（6 文字以内）と短い説明で並び、選択中は色以外の印でも分かる', async () => {
  const { app } = await newApp();
  assert.equal(picker(app).open, false);
  app.commands['drawStyle.pick']();
  const p = picker(app);
  assert.equal(p.open, true);
  assert.ok(p.label.trim(), '一覧に名前がある');
  assert.ok(['listbox', 'menu'].includes(p.role));
  assert.deepEqual(p.options.map((o) => o.id), ids(app), '一覧は登録されたすべての描画スタイルで、並びも同じ');
  assert.equal(p.options.length, 13, '既存の 4 つ＋9 つの風');
  for (const id of OLD) assert.ok(p.options.some((o) => o.id === id), `${id} がある`);
  assert.equal(presets(app).length, 9);
  for (const o of p.options) {
    assert.equal(o.label, labelOf(app, o.id));
    assert.ok(o.label.trim() && weight(o.label.trim()) <= 6, `名前「${o.label}」は 6 文字以内`);
    assert.ok(typeof o.description === 'string' && o.description.trim(), `${o.id}: 短い説明がある`);
  }
  assert.equal(new Set(p.options.map((o) => o.label)).size, 13, '名前はそれぞれ異なる');
  const sel = p.options.filter((o) => o.selected);
  assert.equal(sel.length, 1); assert.equal(sel[0].id, app.getDrawStyle());
  assert.ok(typeof sel[0].selectedMark === 'string' && sel[0].selectedMark.trim(), '選択中は色以外の印・枠で識別できる');
  for (const o of p.options.filter((x) => !x.selected)) assert.equal(o.selectedMark, null);
  // 別の風を選ぶと、印は選んだものへ移る
  const target = presets(app)[0];
  assert.equal(app.pickDrawStyle(target).ok, true);
  const q = picker(app);
  assert.deepEqual(q.options.filter((o) => o.selected).map((o) => o.id), [target]);
  assert.ok(q.options.find((o) => o.id === target).selectedMark);
  assert.equal(pickItem(app).valueLabel, labelOf(app, target));
});

test('FR-077 AC-414 異常系: 登録にない・不正な値は選べず、現在の描画スタイル・図・印は変わらない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.pickDrawStyle('simple');
  const svg0 = app.renderSvg();
  for (const bad of ['', 'nosuch', null, undefined, 3, ['anime'], {}]) {
    app.commands['drawStyle.pick']();
    let r; try { r = app.pickDrawStyle(bad); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, String(bad));
    if (picker(app).open) app.commands['drawStyle.pick']();
  }
  assert.equal(app.getDrawStyle(), 'simple');
  assert.equal(app.renderSvg(), svg0);
  assert.deepEqual(picker(app).options.filter((o) => o.selected).map((o) => o.id), ['simple']);
});

// FR-077 AC-415
test('FR-077 AC-415: 10 シーン・要点 50 個・詳細度「詳細」で、一覧で選んでから図が描き替わるまで 1 秒以内（13 の描画スタイルすべて）', async () => {
  const { app, env } = await newApp();
  seedScenes(app, env);
  toDetail(app);
  const sc = app.getState().scenes;
  assert.equal(sc.length, 10, '前提: 10 シーン');
  assert.equal(sc.reduce((n, s) => n + s.points.length, 0), 50, '前提: 要点 50 個');
  app.renderSvg();
  const order = [...ids(app).filter((id) => id !== app.getDrawStyle()), app.getDrawStyle()];
  for (const id of order) {
    app.commands['drawStyle.pick']();
    assert.equal(picker(app).open, true);
    const t0 = performance.now();
    const r = app.pickDrawStyle(id);
    const svg = app.renderSvg();
    const ms = performance.now() - t0;
    assert.equal(r.ok, true, id);
    assert.match(svg, new RegExp(`data-draw-style="${id}"`), `${id}: 図がその描画スタイルで描き替わる`);
    assert.ok(ms <= LIMIT_MS, `${id}: ${ms.toFixed(0)} ms ≤ ${LIMIT_MS} ms`);
  }
});

test('FR-077 AC-415: 描き替えの前後で、シーン・要点・配置・型・詳細度・選択中のオブジェクト・記録中の状態・入力中の内容・テキスト一覧は保たれる', async () => {
  const { app, env } = await newApp();
  seedScenes(app, env);
  toDetail(app);
  app.selectScene(app.getState().scenes[3].id);
  app.setDraft('入力中の文字');
  const base = { keep: keep(app), layout: JSON.stringify(app.getDiagramLayout()), outline: app.renderOutline(), svg: app.renderSvg() };
  const svgs = new Set([base.svg]);
  for (const id of [...presets(app), ...OLD.filter((x) => x !== 'handwritten'), 'handwritten']) {
    assert.equal(app.pickDrawStyle(id).ok, true, id);
    const svg = app.renderSvg();
    assert.equal(keep(app), base.keep, `${id}: 内容・型・詳細度・選択・記録中・入力中は保たれる`);
    assert.equal(JSON.stringify(app.getDiagramLayout()), base.layout, `${id}: 配置は変わらない`);
    assert.equal(app.renderOutline(), base.outline, `${id}: テキスト一覧の内容・順序は変わらない`);
    for (const s of app.getState().scenes) { assert.ok(svg.includes(s.heading), `${id}: 見出し`); for (const p of s.points) assert.ok(svg.includes(p.text), `${id}: 要点「${p.text}」`); }
    svgs.add(svg);
  }
  assert.equal(svgs.size, 13, '13 の描画スタイルで図の見た目が異なる');
  assert.equal(app.getState().session, 'recording');
  assert.equal(app.submitDraft().ok, true, '描き替えの後も記録を続けられる');
});

// FR-077 AC-416
test('FR-077 AC-416: キーボードだけで、ボタンへの移動・一覧を開く・候補の移動・決定ができ、結果が読み上げ対象のメッセージで示される', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  assert.equal(pickItem(app).tabbable, true, 'Tab でボタンへ移動できる');
  const k = app.keymap.find((b) => b.command === 'drawStyle.pick');
  assert.ok(k, 'drawStyle.pick にキーの割り当てがある');
  assert.equal(app.handleKey({ key: k.key, ctrlKey: !!k.ctrl, altKey: !!k.alt, shiftKey: !!k.shift }), 'drawStyle.pick');
  let p = picker(app);
  assert.equal(p.open, true); assert.equal(p.focus, 'list'); assert.equal(p.activeId, app.getDrawStyle());
  const start = p.activeId;
  assert.ok(app.handleKey({ key: 'ArrowDown' }));
  assert.notEqual(picker(app).activeId, start, '下で次の候補へ');
  assert.ok(app.handleKey({ key: 'ArrowUp' }));
  assert.equal(picker(app).activeId, start, '上で前の候補へ');
  assert.ok(app.handleKey({ key: 'End' }));
  const last = ids(app).at(-1);
  assert.equal(picker(app).activeId, last, 'End で末尾');
  assert.ok(app.handleKey({ key: 'Home' }));
  assert.equal(picker(app).activeId, ids(app)[0], 'Home で先頭');
  // 末尾の候補を決定する
  app.handleKey({ key: 'End' });
  assert.ok(app.handleKey({ key: 'Enter' }));
  p = picker(app);
  assert.equal(app.getDrawStyle(), last);
  assert.equal(p.open, false); assert.equal(p.focus, 'button');
  assert.match(app.renderSvg(), new RegExp(`data-draw-style="${last}"`));
  assert.ok(app.getState().message.text.includes(labelOf(app, last)), '選んだ結果がメッセージで示される');
  assert.equal(app.getCommandBar().status.role, 'status');
});

test('FR-077 AC-416 異常系: Esc で一覧を閉じるとボタンにフォーカスが戻り、描画スタイル・図は変わらない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.pickDrawStyle('anime');
  const svg0 = app.renderSvg();
  app.commands['drawStyle.pick']();
  app.handleKey({ key: 'ArrowDown' }); app.handleKey({ key: 'ArrowDown' });
  assert.notEqual(picker(app).activeId, 'anime');
  assert.equal(app.handleKey({ key: 'Escape' }), 'drawStyle.pick.cancel');
  const p = picker(app);
  assert.equal(p.open, false); assert.equal(p.focus, 'button');
  assert.equal(app.getDrawStyle(), 'anime');
  assert.equal(app.renderSvg(), svg0);
});

test('FR-077 AC-416: コマンドの検索から描画スタイルの名前で選べ（日本語・英語）、存在しない名前では選ばれない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    for (const id of [...presets(app), 'simple', 'handwritten']) {
      const label = labelOf(app, id);
      const hit = app.searchCommands(label).find((c) => c.command === `drawStyle.select.${id}`);
      assert.ok(hit, `${lang}: 「${label}」で drawStyle.select.${id} が見つかる`);
      app.commands[hit.command]();
      assert.equal(app.getDrawStyle(), id);
      assert.match(app.renderSvg(), new RegExp(`data-draw-style="${id}"`));
      assert.ok(app.getState().message.text.includes(label));
    }
  }
  assert.equal(app.searchCommands('存在しない画風ZZQ').filter((c) => c.command.startsWith('drawStyle.select.')).length, 0);
  assert.equal(app.getDrawStyle(), 'handwritten');
});

// FR-077 AC-417
test('FR-077 AC-417: 画面幅 640px 以下でも選ぶボタンとラベルは省かれず、一覧の全候補へ横スクロールなしで到達できる', async () => {
  const { app } = await newApp();
  for (const w of [NARROW, 480, 320]) {
    const it = app.getCommandBarLayout({ viewportWidth: w }).items.find((i) => i.command === 'drawStyle.pick');
    assert.ok(it, `${w}px: ボタンが省かれない`);
    assert.ok(it.labelLines >= 1, `${w}px: ラベルが省かれない`);
    const v = app.getDrawStylePickerView({ viewportWidth: w });
    assert.deepEqual(v.options.map((o) => o.id), ids(app), `${w}px: 全候補がある`);
    assert.ok(v.options.every((o) => o.reachable === true), `${w}px: 全候補へ到達できる`);
    assert.equal(v.scrollsHorizontally, false, `${w}px: 横スクロールなし`);
  }
});

test('FR-077 AC-417: 画面幅 1280px で、ボタンのラベルは 1 行に収まりほかのボタンと重ならない（日本語・英語）', async () => {
  const { app } = await newApp();
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    const lay = app.getCommandBarLayout({ viewportWidth: WIDE });
    const me = lay.items.find((i) => i.command === 'drawStyle.pick');
    assert.ok(me, `${lang}: ボタンがある`);
    assert.equal(me.labelLines, 1, `${lang}: 1 行`);
    assert.ok(me.rect && me.rect.w > 0 && me.rect.h > 0, `${lang}: 外形がある`);
    for (const o of lay.items.filter((i) => i.command !== 'drawStyle.pick')) assert.ok(!overlaps(me.rect, o.rect), `${lang}: ${o.command} と重ならない`);
  }
});

test('FR-077 AC-417: 表示言語を日本語と英語の間で切り替えると、ボタンのラベル・一覧の名前と説明が切替後の言語になる', async () => {
  const { app } = await newApp();
  app.commands['drawStyle.pick']();
  const ja = { label: pickItem(app).label, opts: picker(app).options.map((o) => [o.id, o.label, o.description]) };
  app.setLang('en');
  const enItem = pickItem(app);
  assert.ok(!CJK.test(enItem.label), `英語のラベル "${enItem.label}" に日本語が残らない`);
  assert.notEqual(enItem.label, ja.label);
  assert.ok(!CJK.test(enItem.tooltip.text));
  const en = picker(app).options;
  assert.deepEqual(en.map((o) => o.id), ja.opts.map((o) => o[0]), '並びは変わらない');
  for (const o of en) {
    assert.ok(o.label.trim() && !CJK.test(o.label), `${o.id}: 名前 "${o.label}" が英語`);
    assert.ok([...o.label.trim()].length <= 12, `${o.id}: 半角 12 文字以内`);
    assert.ok(o.description.trim() && !CJK.test(o.description), `${o.id}: 説明 "${o.description}" が英語`);
  }
  app.setLang('ja');
  assert.equal(pickItem(app).label, ja.label);
  assert.deepEqual(picker(app).options.map((o) => [o.id, o.label, o.description]), ja.opts, '日本語に戻る');
});

// FR-077 AC-418
test('FR-077 AC-418: 上部で選んだ値はセッションファイルの保存と読込で復元される', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const target = presets(app)[1];
  assert.equal(app.pickDrawStyle(target).ok, true);
  assert.equal((await app.commands['file.save']()).ok, true);
  const data = env.downloads.at(-1).data;
  const { app: b } = await newApp();
  const r = await b.loadSessionFile({ name: 'session.json', type: 'application/json', size: Buffer.byteLength(data), text: data });
  assert.equal(r.ok, true);
  assert.equal(b.getDrawStyle(), target);
  assert.equal(b.getDrawStylePicker().current, target);
  assert.equal(b.getCommandBar().items.find((i) => i.command === 'drawStyle.pick').valueLabel, labelOf(b, target));
  assert.match(b.renderSvg(), new RegExp(`data-draw-style="${target}"`));
});

test('FR-077 AC-418: 再読込後と保存がない起動時は［設定］の既定の描画スタイルになり、上部での選択は［設定］の既定を変えない', async () => {
  const { app, createApp, env } = await newApp();
  assert.equal(app.getDrawStyle(), app.getSettings().drawStyle, '保存がない起動時は［設定］の既定');
  assert.equal(app.getDrawStyle(), 'handwritten');
  assert.equal(app.setSettings({ drawStyle: 'simple' }).ok, true);
  const saved = env.storage.getItem('grp.settings');
  assert.equal(app.pickDrawStyle(presets(app)[2]).ok, true);
  assert.equal(app.getSettings().drawStyle, 'simple', '上部での選択で［設定］の既定は変わらない');
  assert.equal(env.storage.getItem('grp.settings'), saved);
  const again = await createApp(env.options);
  assert.equal(again.getDrawStyle(), 'simple', '再読込後は［設定］の既定');
  assert.equal(again.getDrawStylePicker().current, 'simple');
});

test('FR-077 AC-418: ［設定］の既定の描画スタイルの選択肢は、上部の一覧と同じ描画スタイル・同じ名前・同じ並び（日本語・英語）', async () => {
  const { app } = await newApp();
  app.commands['settings.open']();
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    const f = app.getSettingsDialog().fields.find((x) => x.id === 'drawStyle');
    assert.ok(Array.isArray(f.options), '選択肢がある');
    assert.deepEqual(f.options.map((o) => [o.value, o.label]), picker(app).options.map((o) => [o.id, o.label]), lang);
  }
});

test('FR-077 AC-418: 上部と［設定］は同じ 1 つの現在の描画スタイルを変え、後から操作した方が図と上部の表示になる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const [p1, p2] = presets(app);
  app.pickDrawStyle(p1);
  assert.equal(app.setSettings({ drawStyle: 'simple' }).ok, true);
  assert.equal(app.getDrawStyle(), 'simple', '［設定］が後');
  assert.match(app.renderSvg(), /data-draw-style="simple"/);
  assert.equal(picker(app).current, 'simple');
  assert.equal(pickItem(app).valueLabel, labelOf(app, 'simple'));
  app.pickDrawStyle(p2);
  assert.equal(app.getDrawStyle(), p2, '上部が後');
  assert.match(app.renderSvg(), new RegExp(`data-draw-style="${p2}"`));
  assert.equal(pickItem(app).valueLabel, labelOf(app, p2));
  assert.equal(app.getSettings().drawStyle, 'simple', '［設定］の既定は変わらない');
});

test('FR-077 AC-418 異常系: 読み込んだセッションファイルの描画スタイルが登録にない名前のときは［設定］の既定で表示され、議論の内容は失われない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.pickDrawStyle('anime');
  await app.commands['file.save']();
  const data = env.downloads.at(-1).data;
  const broken = data.split('"anime"').join('"nosuch-style-zz"');
  assert.notEqual(broken, data, '前提: セッションファイルに描画スタイルの名前が入っている');
  const { app: b } = await newApp();
  assert.equal(b.setSettings({ drawStyle: 'simple' }).ok, true);
  const r = await b.loadSessionFile({ name: 'session.json', type: 'application/json', size: Buffer.byteLength(broken), text: broken });
  assert.equal(r.ok, true, '読込は失敗しない');
  assert.equal(b.getDrawStyle(), 'simple');
  assert.match(b.renderSvg(), /data-draw-style="simple"/);
  const pick = (x) => x.getState().scenes.map((s) => [s.heading, s.points.map((p) => p.text)]);
  assert.deepEqual(pick(b), pick(app), '議論の内容は失われない');
  assert.equal(b.renderOutline(), app.renderOutline());
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

async function saveAll(app, env, cv, id) {
  assert.equal(app.pickDrawStyle(id).ok, true, id);
  const n = env.downloads.length;
  cv.ops.length = 0;
  await app.commands['save.png']();
  const pngOps = JSON.stringify(cv.ops);
  const texts = cv.ops.filter((o) => o[0] === 'fillText' || o[0] === 'strokeText').map((o) => o[1]);
  await app.commands['save.svg']();
  await app.commands['save.pdf']();
  const [png, svg, pdf] = env.downloads.slice(n);
  return { png, svg, pdf, pngOps, texts, screen: app.renderSvg() };
}

test('FR-077 AC-419: 上部で選んだ描画スタイルが PNG・SVG・PDF の保存に反映され、SVG に見出しと要点の文字列がテキストとして含まれる', async () => {
  const cv = recordingCanvas();
  const { app, env } = await newApp({ canvasFactory: cv });
  await seedThreeScenes(app, env);
  toDetail(app);
  const base = await saveAll(app, env, cv, 'handwritten');
  const strings = app.getState().scenes.flatMap((s) => [s.heading, ...s.points.map((p) => p.text)]);
  for (const id of presets(app)) {
    const r = await saveAll(app, env, cv, id);
    assert.equal(r.svg.mime, 'image/svg+xml');
    assert.equal(r.svg.data, r.screen, `${id}: 保存した SVG は画面の図と同じ（紙面・配色・見出しの飾り・吹き出しを含む）`);
    assert.match(r.svg.data, new RegExp(`data-draw-style="${id}"`));
    assert.notEqual(r.svg.data, base.svg.data, `${id}: 手書き調と異なる SVG`);
    const svgTexts = [...r.svg.data.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, '')).join('');
    for (const s of strings) assert.ok(svgTexts.includes(s), `${id}: SVG の <text> に「${s}」`);
    assert.equal(r.png.mime, 'image/png');
    assert.notEqual(r.pngOps, base.pngOps, `${id}: PNG の描画が手書き調と異なる`);
    const drawn = r.texts.join('\n');
    for (const s of strings) assert.ok(drawn.includes(s), `${id}: PNG に「${s}」`);
    assert.equal(r.pdf.mime, 'application/pdf');
    assert.notDeepEqual(Buffer.from(r.pdf.data), Buffer.from(base.pdf.data), `${id}: PDF が手書き調と異なる`);
    const pt = pdfTexts(r.pdf.data);
    for (const s of strings) assert.ok(pt.includes(s), `${id}: PDF に「${s}」`);
  }
});

test('FR-077 AC-419: 選択・描き替え・保存の間の外部へのリクエストは 0 件', async () => {
  const calls = [];
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
  const saved = {};
  for (const k of names) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: function (...a) { calls.push({ k, a }); throw new Error('network blocked'); } });
  }
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { ...(nav?.value || {}), sendBeacon: (...a) => { calls.push({ k: 'sendBeacon', a }); return false; } } });
  const relayLog = [];
  try {
    const { app, env } = await newApp({ options: { relay: async (req) => { relayLog.push(req); return { status: 404, body: {} }; } } });
    await seedThreeScenes(app, env);
    const n = relayLog.length;
    for (const id of ids(app)) {
      app.commands['drawStyle.pick']();
      app.pickDrawStyle(id);
      app.renderSvg();
      await app.commands['save.png'](); await app.commands['save.svg'](); await app.commands['save.pdf']();
    }
    assert.equal(env.downloads.length, ids(app).length * 3);
    assert.equal(relayLog.length, n, '選択・描き替え・保存で中継（外部の LLM）へ要求しない');
  } finally {
    for (const k of names) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
  }
  assert.deepEqual(calls.filter((c) => !String(c.a[0] ?? '').startsWith('/')), [], '同一オリジン以外へのリクエストは 0 件');
});
