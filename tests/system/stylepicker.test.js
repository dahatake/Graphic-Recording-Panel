// FR-077 AC-414〜AC-419（System Test。契約: tests/system/CONTRACT-2026-11-04.md「2.」（AC-414〜417。2026-11-04 に一覧から常時表示のグループへ変更）と CONTRACT-FR077-078.md（AC-418・419））
// 期待値は受入基準だけから決める（PARAM-006=640px、PARAM-011=6 全角/半角 12、PARAM-012=1280px、PARAM-081=1 秒、PARAM-089=10 シーン、PARAM-090=50 要点）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { newApp, seedThreeScenes, toDetail, CJK, pdfTexts } from './helpers.js';
import { serveWeb, launch, openApp } from './perf-util.js';

const OLD = ['handwritten', 'anime', 'simple', 'rpg']; // 既存の 4 つ（FR-029・FR-047）
const NARROW = 640; // PARAM-006
const WIDE = 1280; // PARAM-012
const LIMIT_MS = 1000; // PARAM-081
const weight = (s) => [...s].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.5), 0);
const styleItems = (app) => app.getCommandBar().items.filter((i) => i.group === 'drawStyle');
const setItem = (app, id) => app.getCommandBar().items.find((i) => i.command === `drawStyle.set:${id}`);
const pickStyle = (app, id) => app.commands[`drawStyle.set:${id}`]();
const pressedIds = (app) => styleItems(app).filter((i) => i.pressed === true).map((i) => i.command.replace('drawStyle.set:', ''));
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

// FR-077 AC-414（2026-11-04 の依頼で、画風は常時表示の「画風」グループの項目。ドロップダウン・一覧の開閉はない。契約: CONTRACT-2026-11-04.md「2.」）
test('FR-077 AC-414: 「画風」グループに 13 の描画スタイルが、開く操作なしに最初から常時、項目として表示され、各項目に常時表示のラベル（6 文字以内）とツールチップ（短い説明）がある', async () => {
  const { app } = await newApp();
  const grp = app.getCommandBar().groups.find((g) => g.id === 'drawStyle');
  assert.ok(grp, '「画風」グループがある');
  assert.equal(grp.name, '画風');
  assert.equal(app.getCommandBar().items.some((i) => i.command === 'drawStyle.pick'), false, '旧 drawStyle.pick（ドロップダウン）は廃止');
  assert.equal(app.commands['drawStyle.pick'], undefined);
  assert.equal(app.getDrawStylePicker, undefined, '開閉する一覧はない');
  assert.deepEqual(grp.commands, ids(app).map((id) => `drawStyle.set:${id}`), '登録されたすべての描画スタイルが、同じ並びで最初から項目として出ている');
  assert.equal(grp.commands.length, 13, '既存の 4 つ＋9 つの風');
  for (const id of OLD) assert.ok(setItem(app, id), `${id} がある`);
  assert.equal(presets(app).length, 9);
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    for (const id of ids(app)) {
      const it = setItem(app, id);
      assert.equal(it.group, 'drawStyle');
      assert.equal(it.label, labelOf(app, id));
      assert.ok(it.label.trim(), `${lang} ${id}: ラベルは非空`);
      if (lang === 'ja') assert.ok(weight(it.label.trim()) <= 6, `${id}: 「${it.label}」は全角 6 文字以内`);
      else assert.ok([...it.label.trim()].length <= 12, `${id}: "${it.label}" は半角 12 文字以内`);
      assert.equal(it.labelVisible, true, 'ラベルはホバー・フォーカスなしで常に見える');
      assert.equal(it.accessibleName, it.label);
      assert.ok(typeof it.description === 'string' && it.description.trim(), `${lang} ${id}: 短い説明がある`);
      assert.equal(it.tooltip?.text, it.description);
      assert.equal(it.describedBy, it.tooltip.id);
      const tip = app.showTooltip(it.command, 'hover');
      assert.equal(tip.visible, true); assert.equal(tip.text, it.tooltip.text);
      app.hideTooltip(it.command, 'leave');
    }
    assert.equal(new Set(styleItems(app).map((i) => i.label)).size, 13, `${lang}: 名前はそれぞれ異なる`);
  }
});

test('FR-077 AC-414: 項目をクリックすると描画スタイルが切り替わり、現在の項目だけ aria-pressed が真で色以外の印がある（ほかは偽）', async () => {
  const { app } = await newApp();
  assert.deepEqual(pressedIds(app), [app.getDrawStyle()], '最初から現在の描画スタイルの項目だけ押されている');
  for (const id of ids(app)) {
    const it = setItem(app, id);
    assert.equal(it.pressed, id === app.getDrawStyle());
    if (it.pressed) assert.ok(typeof it.selectedMark === 'string' && it.selectedMark.trim(), '現在の項目は色以外の印・枠で識別できる');
    else assert.equal(it.selectedMark, null);
  }
  for (const target of [...presets(app), 'simple', 'handwritten']) {
    pickStyle(app, target);
    assert.equal(app.getDrawStyle(), target);
    assert.match(app.renderSvg(), new RegExp(`data-draw-style="${target}"`));
    assert.deepEqual(pressedIds(app), [target], '印は選んだ項目へ移る');
    assert.ok(setItem(app, target).selectedMark);
    assert.equal(styleItems(app).filter((i) => i.pressed === false && i.selectedMark === null).length, 12);
    assert.ok(app.getState().message.text.includes(labelOf(app, target)), '選んだ結果が読み上げ対象のメッセージで示される');
    assert.equal(app.getCommandBar().status.role, 'status');
  }
});

test('FR-077 AC-414 異常系: 登録にない・不正な値は選べず、現在の描画スタイル・図・押下の表示は変わらない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  pickStyle(app, 'simple');
  const svg0 = app.renderSvg();
  for (const bad of ['', 'nosuch', null, undefined, 3, ['anime'], {}]) {
    let r; try { r = app.setDrawStyle(bad); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, String(bad));
  }
  assert.equal(app.commands['drawStyle.set:nosuch'], undefined, '登録にない ID の項目・コマンドはない');
  assert.equal(app.getDrawStyle(), 'simple');
  assert.equal(app.renderSvg(), svg0);
  assert.deepEqual(pressedIds(app), ['simple']);
});

// FR-077 AC-415
test('FR-077 AC-415: 10 シーン・要点 50 個・詳細度「詳細」で、項目を選んでから図が描き替わるまで 1 秒以内（13 の描画スタイルすべて）', async () => {
  const { app, env } = await newApp();
  seedScenes(app, env);
  toDetail(app);
  const sc = app.getState().scenes;
  assert.equal(sc.length, 10, '前提: 10 シーン');
  assert.equal(sc.reduce((n, s) => n + s.points.length, 0), 50, '前提: 要点 50 個');
  app.renderSvg();
  const order = [...ids(app).filter((id) => id !== app.getDrawStyle()), app.getDrawStyle()];
  for (const id of order) {
    const t0 = performance.now();
    pickStyle(app, id);
    const svg = app.renderSvg();
    const ms = performance.now() - t0;
    assert.equal(app.getDrawStyle(), id);
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
    pickStyle(app, id);
    assert.equal(app.getDrawStyle(), id);
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
test('FR-077 AC-416: キーボードだけで、画風の項目への移動（Tab）・決定（Enter・Space 相当のコマンド）ができ、結果が読み上げ対象のメッセージで示される', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const items = styleItems(app);
  assert.equal(items.length, 13);
  for (const it of items) { assert.equal(it.tabbable, true, `${it.command}: Tab で移動できる`); assert.equal(it.tabIndex, 0); }
  const order = app.getCommandBar().focusOrder;
  const first = order.indexOf(items[0].command);
  assert.ok(first >= 0);
  assert.deepEqual(order.slice(first, first + 13), items.map((i) => i.command), '画風の 13 項目は Tab で連続して巡る（DOM 順）');
  for (const id of [ids(app).at(-1), ids(app)[0], presets(app)[3]]) {
    pickStyle(app, id); // 実 DOM の項目は <button>。Enter・Space はクリックと同じ
    assert.equal(app.getDrawStyle(), id);
    assert.match(app.renderSvg(), new RegExp(`data-draw-style="${id}"`));
    assert.ok(app.getState().message.text.includes(labelOf(app, id)), '選んだ結果がメッセージで示される');
    assert.equal(app.getCommandBar().status.role, 'status');
    assert.deepEqual(pressedIds(app), [id]);
  }
});

test('FR-077 AC-416 実ブラウザ: 画風の項目は <button> で Tab で到達でき、Enter・Space で選べて aria-pressed が移り、結果が role=status に出る', async () => {
  const srv = await serveWeb(); const browser = await launch();
  try {
    const { ctx, page } = await openApp(browser, srv.url, { width: 1280, height: 1000 });
    try {
      const sel = (id) => `[data-command="drawStyle.set:${id}"]`;
      const all = await page.evaluate(() => globalThis.__app.getDrawStyles().map((s) => s.id));
      assert.equal(all.length, 13);
      for (const id of all) {
        assert.equal(await page.locator(sel(id)).first().evaluate((e) => e.tagName), 'BUTTON', `${id}: button`);
        assert.ok(await page.locator(sel(id)).first().isVisible(), `${id}: 開く操作なしに最初から見える`);
      }
      const a = all[1]; const b = all[2];
      await page.locator(sel(a)).first().focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction((id) => globalThis.__app.getDrawStyle() === id, a);
      assert.equal(await page.locator(sel(a)).first().getAttribute('aria-pressed'), 'true');
      await page.locator(sel(b)).first().focus();
      await page.keyboard.press('Space');
      await page.waitForFunction((id) => globalThis.__app.getDrawStyle() === id, b);
      assert.equal(await page.locator(sel(b)).first().getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator(sel(a)).first().getAttribute('aria-pressed'), 'false');
      const label = await page.evaluate((id) => globalThis.__app.getDrawStyles().find((s) => s.id === id).label, b);
      await page.waitForFunction((l) => [...document.querySelectorAll('[role="status"]')].some((e) => e.textContent.includes(l)), label);
    } finally { await ctx.close(); }
  } finally { await browser.close(); await srv.close(); }
});

test('FR-077 AC-416: コマンドの検索から描画スタイルの名前で選べ（日本語・英語）、存在しない名前では選ばれない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    for (const id of [...presets(app), 'simple', 'handwritten']) {
      const label = labelOf(app, id);
      const hit = app.searchCommands(label).find((c) => c.command === `drawStyle.set:${id}`);
      assert.ok(hit, `${lang}: 「${label}」で drawStyle.set:${id} が見つかる`);
      app.commands[hit.command]();
      assert.equal(app.getDrawStyle(), id);
      assert.match(app.renderSvg(), new RegExp(`data-draw-style="${id}"`));
      assert.ok(app.getState().message.text.includes(label));
    }
  }
  assert.equal(app.searchCommands('存在しない画風ZZQ').filter((c) => c.command.startsWith('drawStyle.')).length, 0);
  assert.equal(app.getDrawStyle(), 'handwritten');
});

// FR-077 AC-417（例外: ユーザーの明示操作によるリボンの折りたたみ中（AC-579）は除く。ここは折りたたまない状態で省かれないことを検証し、折りたたみ中は AC-579 のケースで検証する）
test('FR-077 AC-417: 画面幅 640px 以下でも画風の全 13 項目とラベルは省かれず（あふれメニューへも移さない）、横スクロールなしで全項目へ到達できる', async () => {
  const { app } = await newApp();
  for (const w of [NARROW, 480, 320]) {
    const lay = app.getCommandBarLayout({ viewportWidth: w });
    for (const id of ids(app)) {
      const it = lay.items.find((i) => i.command === `drawStyle.set:${id}`);
      assert.ok(it, `${w}px: ${id} が省かれない`);
      assert.ok(it.labelLines >= 1, `${w}px: ${id} のラベルが省かれない`);
      assert.ok(it.rect.w > 0 && it.rect.h > 0, `${w}px: ${id} に外形がある`);
    }
    assert.equal(lay.overflowMenu?.commands?.some((c) => c.startsWith('drawStyle.set:')) ?? false, false, `${w}px: あふれメニューへ移さない`);
    assert.equal(lay.scrollsHorizontally, false, `${w}px: 横スクロールなし`);
  }
});

test('FR-077 AC-417: 画面幅 1280px で、項目のラベルは 1 行に収まりほかのボタンと重ならない（日本語・英語）', async () => {
  const { app } = await newApp();
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    const lay = app.getCommandBarLayout({ viewportWidth: WIDE });
    for (const id of ids(app)) {
      const me = lay.items.find((i) => i.command === `drawStyle.set:${id}`);
      assert.ok(me, `${lang}: ${id} の項目がある`);
      assert.equal(me.labelLines, 1, `${lang}: ${id} は 1 行`);
      assert.ok(me.rect && me.rect.w > 0 && me.rect.h > 0, `${lang}: 外形がある`);
      for (const o of lay.items.filter((i) => i.command !== me.command)) assert.ok(!overlaps(me.rect, o.rect), `${lang}: ${id} と ${o.command} は重ならない`);
    }
  }
});

test('FR-077 AC-417: 表示言語を日本語と英語の間で切り替えると、項目のラベル・名前と説明が切替後の言語になる', async () => {
  const { app } = await newApp();
  const snap = () => styleItems(app).map((i) => [i.command, i.label, i.description, i.tooltip.text]);
  const ja = snap();
  app.setLang('en');
  const en = styleItems(app);
  assert.deepEqual(en.map((o) => o.command), ja.map((o) => o[0]), '並びは変わらない');
  for (const o of en) {
    assert.ok(o.label.trim() && !CJK.test(o.label), `${o.command}: 名前 "${o.label}" が英語`);
    assert.ok([...o.label.trim()].length <= 12, `${o.command}: 半角 12 文字以内`);
    assert.ok(o.description.trim() && !CJK.test(o.description), `${o.command}: 説明 "${o.description}" が英語`);
    assert.ok(!CJK.test(o.tooltip.text));
  }
  assert.notDeepEqual(en.map((o) => o.label), ja.map((o) => o[1]));
  assert.equal(app.getCommandBar().groups.find((g) => g.id === 'drawStyle').name === '画風', false, 'グループ名も英語になる');
  app.setLang('ja');
  assert.deepEqual(snap(), ja, '日本語に戻る');
});

// FR-077 AC-418
test('FR-077 AC-418: 上部で選んだ値はセッションファイルの保存と読込で復元される', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const target = presets(app)[1];
  pickStyle(app, target);
  assert.equal((await app.commands['file.save']()).ok, true);
  const data = env.downloads.at(-1).data;
  const { app: b } = await newApp();
  const r = await b.loadSessionFile({ name: 'session.json', type: 'application/json', size: Buffer.byteLength(data), text: data });
  assert.equal(r.ok, true);
  assert.equal(b.getDrawStyle(), target);
  assert.deepEqual(b.getCommandBar().items.filter((i) => i.group === 'drawStyle' && i.pressed).map((i) => i.command), [`drawStyle.set:${target}`]);
  assert.match(b.renderSvg(), new RegExp(`data-draw-style="${target}"`));
});

test('FR-077 AC-418: 再読込後と保存がない起動時は［設定］の既定の描画スタイルになり、上部での選択は［設定］の既定を変えない', async () => {
  const { app, createApp, env } = await newApp();
  assert.equal(app.getDrawStyle(), app.getSettings().drawStyle, '保存がない起動時は［設定］の既定');
  assert.equal(app.getDrawStyle(), 'handwritten');
  assert.equal(app.setSettings({ drawStyle: 'simple' }).ok, true);
  const saved = env.storage.getItem('grp.settings');
  pickStyle(app, presets(app)[2]);
  assert.equal(app.getSettings().drawStyle, 'simple', '上部での選択で［設定］の既定は変わらない');
  assert.equal(env.storage.getItem('grp.settings'), saved);
  const again = await createApp(env.options);
  assert.equal(again.getDrawStyle(), 'simple', '再読込後は［設定］の既定');
  assert.deepEqual(pressedIds(again), ['simple']);
});

test('FR-077 AC-418: ［設定］の既定の描画スタイルの選択肢は、「画風」グループの項目と同じ描画スタイル・同じ名前・同じ並び（日本語・英語）', async () => {
  const { app } = await newApp();
  app.commands['settings.open']();
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    const f = app.getSettingsDialog().fields.find((x) => x.id === 'drawStyle');
    assert.ok(Array.isArray(f.options), '選択肢がある');
    assert.deepEqual(f.options.map((o) => [o.value, o.label]), styleItems(app).map((o) => [o.command.replace('drawStyle.set:', ''), o.label]), lang);
  }
});

test('FR-077 AC-418: 「画風」グループと［設定］は同じ 1 つの現在の描画スタイルを変え、後から操作した方が図と項目の押下の表示になる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const [p1, p2] = presets(app);
  pickStyle(app, p1);
  assert.equal(app.setSettings({ drawStyle: 'simple' }).ok, true);
  assert.equal(app.getDrawStyle(), 'simple', '［設定］が後');
  assert.match(app.renderSvg(), /data-draw-style="simple"/);
  assert.deepEqual(pressedIds(app), ['simple']);
  pickStyle(app, p2);
  assert.equal(app.getDrawStyle(), p2, '上部が後');
  assert.match(app.renderSvg(), new RegExp(`data-draw-style="${p2}"`));
  assert.deepEqual(pressedIds(app), [p2]);
  assert.equal(app.getSettings().drawStyle, 'simple', '［設定］の既定は変わらない');
});

test('FR-077 AC-418 異常系: 読み込んだセッションファイルの描画スタイルが登録にない名前のときは［設定］の既定で表示され、議論の内容は失われない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  pickStyle(app, 'anime');
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
  pickStyle(app, id);
  assert.equal(app.getDrawStyle(), id, id);
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
      pickStyle(app, id);
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
