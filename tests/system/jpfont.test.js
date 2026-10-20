// NFR-UX-012 AC-465 AC-466（System Test。契約: tests/system/CONTRACT-STYLE-PRESET.md「日本語の字形の書体（NFR-UX-012）」）
// 期待値は要求定義書（NFR-UX-012・PARAM-093・AC-465・AC-466）だけから決める。判定は書体の指定の並びで行い、
// Yu Gothic UI がない検証環境でも同じ判定で合否を決める（AC-465・AC-466）。実装がなければ失敗するのが正常。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newApp, seedThreeScenes, toDetail, WEB } from './helpers.js';
import { LEGACY, PRESETS, FONTS, parseSvg, fontList, presetIds, stateTexts } from './stylepreset-util.js';
import { YU, PARAM_093, TRADITIONAL, expectedStack, assertJpOrder, familiesOfFont, makeRecordingCanvas, withNetSpy, cssFontStacks } from './jpfont-util.js';

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const read = (f) => fs.readFileSync(f, 'utf8');
const cssAll = () => walk(WEB).filter((f) => /\.css$/i.test(f)).map(read).join('\n')
  + walk(WEB).filter((f) => /\.html?$/i.test(f)).map((f) => [...read(f).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n')).join('\n');

// ---------------------------------------------------------------- NFR-UX-012 AC-465（画面の書体の指定）
// NFR-UX-012 AC-465
test('NFR-UX-012 AC-465: 画面の書体の指定は 欧文専用の書体（Segoe UI を含む）→ Yu Gothic UI → 日本語の字形を持ち得る書体 の順', () => {
  const { stacks, vars } = cssFontStacks(cssAll());
  assert.ok(vars['--font-sans'], '画面の書体の指定（--font-sans）がある');
  const ui = fontList(vars['--font-sans'].value);
  const i = assertJpOrder(ui, '--font-sans');
  assert.ok(ui.slice(0, i).includes('Segoe UI'), 'Yu Gothic UI より前に Segoe UI（AC-061。欧文は従来どおり Segoe UI）');
  assert.ok(['Segoe UI', 'system-ui', '-apple-system', 'BlinkMacSystemFont'].includes(ui[0]), `先頭はシステムフォント（AC-061）: ${ui[0]}`);
  // NFR-UX-012 本文: 従来の並びの欧文専用の書体（従来の順。足さず抜かない）→ Yu Gothic UI → 従来の並びの残り（従来の順）
  assert.deepEqual(ui, expectedStack(TRADITIONAL.ui), `並び: ${ui.join(', ')}`);
  // 総称の書体・システムの書体のキーワードは Yu Gothic UI より後
  for (const k of ['system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif', 'serif', 'ui-sans-serif']) {
    const at = ui.indexOf(k);
    if (at >= 0) assert.ok(at > i, `${k} は Yu Gothic UI より後`);
  }
  // 画面のすべての書体の指定（パネル・操作部品・メッセージ。CSS の font-family・font の一括指定・書体のトークン）が同じ規則
  assert.ok(stacks.length >= 1);
  for (const s of stacks) assertJpOrder(s.list, s.where);
});

test('NFR-UX-012 AC-465: 表示言語（日本語・英語）で書体の指定は変わらない（英語の表示で日本語の要点・トピック・テキスト一覧を表示する要素も同じ）', async () => {
  const css = cssAll().replace(/\/\*[\s\S]*?\*\//g, '');
  // 言語ごとの書体の切り替えの規則がない（あっても同じ規則に従う）
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/:lang\(|\[lang|\[data-lang|\.lang-|\ben\b/.test(m[1])) continue;
    for (const d of m[2].matchAll(/(?:^|[;\s])font(?:-family)?\s*:\s*([^;]+)/g)) {
      if (/^(inherit|initial|unset|revert)$/i.test(d[1].trim())) continue;
      assertJpOrder(familiesOfFont(d[1]), `${m[1].trim()}（言語別の規則）`);
    }
  }
  // スクリプトが表示言語に応じて画面の書体を書き換えない
  for (const f of walk(path.join(WEB, 'src')).filter((x) => /\.m?js$/i.test(x))) {
    const s = read(f);
    for (const m of s.matchAll(/\.style\.(?:fontFamily|font)\s*=\s*(['"`])([^'"`]+)\1/g)) assertJpOrder(familiesOfFont(m[2]), `${path.relative(WEB, f)} の画面の書体の代入`);
    for (const m of s.matchAll(/setProperty\(\s*['"](?:--font-sans|font-family)['"]\s*,\s*(['"`])([^'"`]+)\1/g)) assertJpOrder(fontList(m[2]), `${path.relative(WEB, f)} の画面の書体の書き換え`);
  }
  // 英語の表示で日本語の文字列（要点・トピック・テキスト一覧）を表示しても、画面の書体の指定は同じ（言語で書体を選ぶ口がない）
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const before = cssFontStacks(cssAll()).vars['--font-sans'].value;
  app.setLang('en');
  assert.ok(app.renderOutline().includes(app.getState().scenes[0].points[0].text), '英語の表示でも日本語の要点がテキスト一覧にある');
  assert.equal(cssFontStacks(cssAll()).vars['--font-sans'].value, before);
});

test('NFR-UX-012 AC-465 異常系: Yu Gothic UI がない・書体の判定が失敗する端末でも、書体の指定は同じで、書体の外部取得は 0 件（同梱もしない）', async () => {
  const ui = cssFontStacks(cssAll()).vars['--font-sans'].value;
  for (const fontCheck of [() => false, (n) => n !== YU, () => { throw new Error('fonts unavailable'); }]) {
    let app;
    const calls = await withNetSpy(async () => {
      ({ app } = await newApp({ options: { fontCheck } }));
      app.commands['session.start'](); app.setDraft('予算の見直しが必要です'); app.submitDraft();
      app.setLang('en'); app.setLang('ja');
      for (const c of ['save.png', 'save.svg', 'save.pdf']) await app.commands[c]();
    });
    assert.deepEqual(calls, [], '外部への取得 0 件');
    assert.equal(cssFontStacks(cssAll()).vars['--font-sans'].value, ui, '書体の指定は変わらない（端末の書体の有無で選ばない）');
    assert.ok(app.renderOutline().includes('予算の見直しが必要です'), '文字は欠けない');
  }
  const files = walk(WEB);
  assert.deepEqual(files.filter((f) => /\.(woff2?|ttf|otf|eot|ttc)$/i.test(f)), [], '書体のファイルを同梱しない');
  for (const f of files.filter((x) => /\.(css|html?|m?js)$/i.test(x))) {
    const s = read(f);
    assert.ok(!/@font-face/i.test(s), `${path.relative(WEB, f)}: @font-face がない`);
    assert.ok(!/new\s+FontFace\s*\(|fonts\.(?:load|add)\s*\(/.test(s), `${path.relative(WEB, f)}: 書体を読み込まない`);
    assert.ok(!/<link[^>]+(?:fonts\.googleapis|as\s*=\s*["']?font)/i.test(s), `${path.relative(WEB, f)}: 書体の取得のリンクがない`);
  }
});

// ---------------------------------------------------------------- NFR-UX-012 AC-466（図と保存の書体の指定。検証レベル integration の参考）
async function seeded(over = {}) {
  const canvas = makeRecordingCanvas();
  const ctx = await newApp({ ...over, options: { canvasFactory: canvas, ...(over.options || {}) } });
  ctx.app.setLang('ja');
  await seedThreeScenes(ctx.app, ctx.env);
  toDetail(ctx.app);
  return { ...ctx, canvas };
}
const ffAll = (svg) => parseSvg(svg).all.filter((n) => n.attrs['font-family'] !== undefined).map((n) => fontList(n.attrs['font-family']));
const REG = (id, font, balloon) => ({
  id, label: { ja: `試験の画風${id.slice(-1)}`, en: `Test look ${id.slice(-1)}` }, line: { width: 1, jitter: 0 }, fill: { mode: 'paper' }, text: { decor: 'standard', icons: true },
  paper: 'plain', font, headingDecoration: 'marker', balloon, stroke: { wobble: 0, width: 2 }, figures: false, icons: true,
  palette: { background: '#ffffff', primary: '#1a1a1a', accent: ['#ffd400'], text: '#1a1a1a', secondary: '#757575' },
  description: { ja: { color: '白と黒', drawing: '細い線', font: '標準の書体', mood: '落ち着いた' }, en: { color: 'White and black', drawing: 'Thin lines', font: 'Standard type', mood: 'Calm' } },
});

// NFR-UX-012 AC-466
test('NFR-UX-012 AC-466: 書体の系統の並びは 欧文専用の書体（従来の順）→ Yu Gothic UI → 従来の並びの残り（従来の順）', async () => {
  const { app } = await newApp();
  const st = app.getFontStacks();
  for (const k of FONTS) {
    const names = st[k].map((f) => f.name);
    assertJpOrder(names, k);
    assert.deepEqual(names, expectedStack(TRADITIONAL[k]), `${k}: ${names.join(', ')}`);
  }
  // 例: ゴシックの系統は Yu Gothic UI が先頭、手書き風の系統は欧文専用の書体の次に Yu Gothic UI
  assert.equal(st.gothic[0].name, YU);
  assert.deepEqual(st.handwriting.slice(0, 4).map((f) => f.name), ['Segoe Print', 'Ink Free', 'Arial Rounded MT Bold', YU]);
  assert.deepEqual(st.roundGothic.slice(0, 2).map((f) => f.name), ['Arial Rounded MT Bold', YU]);
  for (const k of FONTS) assert.ok(st[k].every((f) => f.name === YU || PARAM_093.includes(f.name) || TRADITIONAL[k].includes(f.name)), `${k}: 書体を足さない`);
});

test('NFR-UX-012 AC-466: 13 の描画スタイルと拡張点で追加した画風プリセットのすべてで、図（SVG）の書体の指定は NFR-UX-012 の並び', async () => {
  const { app } = await seeded();
  const st = app.getFontStacks();
  for (const d of [REG('test-jp-a', 'handwriting', 'cloud'), REG('test-jp-b', 'roundGothic', 'rounded'), REG('test-jp-c', 'gothic', 'sticky')]) assert.equal(app.registerDrawStyle(d).ok, true, d.id);
  const styles = app.getDrawStyles();
  assert.equal(styles.length, 16, '13 + 追加した 3');
  for (const s of styles) {
    assert.equal(app.setDrawStyle(s.id).ok, true, s.id);
    const svg = app.renderSvg();
    const spec = app.getDrawStyleSpec(s.id);
    const want = spec && spec.preset ? expectedStack(TRADITIONAL[spec.font]) : expectedStack(TRADITIONAL.legacy);
    const lists = ffAll(svg);
    assert.ok(lists.length >= 1, `${s.id}: 図に書体の指定がある`);
    assert.deepEqual(fontList(parseSvg(svg).root.attrs['font-family']), want, `${s.id}: ルートの書体の指定`);
    for (const l of lists) { assertJpOrder(l, `${s.id} の図`); assert.deepEqual(l, want, `${s.id}: 図の中の書体の指定も同じ並び`); }
    if (spec && spec.preset) assert.deepEqual(st[spec.font].map((f) => f.name), want);
  }
  for (const id of LEGACY) assert.equal(fontList(parseSvg((app.setDrawStyle(id), app.renderSvg())).root.attrs['font-family'])[0], YU, `${id}: 既存の 4 つは Yu Gothic UI が先頭`);
});

test('NFR-UX-012 AC-466: PNG・SVG・PDF の保存と RPG風の地図など Canvas に描く文字の書体の指定も NFR-UX-012 の並びで、外部へのリクエストは 0 件', async () => {
  const { app, env, canvas } = await seeded();
  const ids = presetIds(app);
  const targets = [...LEGACY, ...PRESETS.map((p) => ids[p.ja])];
  for (const id of targets) {
    assert.equal(app.setDrawStyle(id).ok, true, id);
    const spec = app.getDrawStyleSpec(id);
    const want = spec && spec.preset ? expectedStack(TRADITIONAL[spec.font]) : expectedStack(TRADITIONAL.legacy);
    const nFonts = canvas.log.fonts.length; const nDl = env.downloads.length;
    const calls = await withNetSpy(async () => { for (const c of ['save.png', 'save.svg', 'save.pdf']) await app.commands[c](); });
    assert.deepEqual(calls, [], `${id}: 書体・画像のための外部へのリクエスト 0 件`);
    const dl = env.downloads.slice(nDl);
    assert.deepEqual(dl.map((d) => d.mime), ['image/png', 'image/svg+xml', 'application/pdf'], `${id}: 3 形式で保存`);
    for (const l of ffAll(String(dl[1].data))) assert.deepEqual(l, want, `${id}: 保存した SVG の書体の指定`);
    const fonts = canvas.log.fonts.slice(nFonts);
    assert.ok(fonts.length >= 1, `${id}: PNG・PDF の文字に書体の指定がある`);
    for (const f of fonts) { const l = familiesOfFont(f); assertJpOrder(l, `${id} の Canvas の書体「${f}」`); assert.deepEqual(l, want, `${id}: Canvas の書体の並び`); }
  }
  // RPG風の地図（キャンバスに描く文字）
  assert.equal(app.setDrawStyle('rpg').ok, true);
  assert.ok(app.getRpgMap(), 'RPG風の地図');
  const n = canvas.log.fonts.length;
  await app.commands['save.png']();
  for (const f of canvas.log.fonts.slice(n)) assert.deepEqual(familiesOfFont(f), expectedStack(TRADITIONAL.legacy), `RPG風の Canvas の書体「${f}」`);
});

test('NFR-UX-012 AC-466 異常系: Yu Gothic UI がない・書体の判定が失敗する端末でも、文字は欠けずエラーにならず、書体の指定・文字の太さ・見出しの飾りは変わらない', async () => {
  const look = async (fontCheck) => {
    const { app, env } = await seeded({ options: { fontCheck } });
    const out = {};
    for (const s of app.getDrawStyles()) {
      assert.equal(app.setDrawStyle(s.id).ok, true);
      const doc = parseSvg(app.renderSvg());
      out[s.id] = {
        ff: ffAll(app.renderSvg()).map((l) => l.join(',')),
        texts: doc.texts().map((t) => [t.text.trim(), t.attrs['font-weight'] ?? '']).sort(),
        deco: ['heading-band', 'heading-marker', 'heading-sticky'].map((r) => doc.role(r).length),
      };
      for (const t of stateTexts(app)) if (s.id !== 'rpg') assert.ok(doc.texts().some((x) => x.text.includes(t)) || app.renderOutline().includes(t), `${s.id}: 「${t}」は欠けない`);
    }
    await app.commands['save.png'](); await app.commands['save.pdf']();
    assert.equal(env.downloads.length, 2, '保存もエラーにならない');
    return out;
  };
  const have = await look(() => true);
  assert.deepEqual(await look((n) => n !== YU), have, 'Yu Gothic UI がなくても同じ');
  assert.deepEqual(await look(() => false), have, '書体がなくても同じ');
  assert.deepEqual(await look(() => { throw new Error('fonts unavailable'); }), have, '判定が失敗しても同じ');
});

test('NFR-UX-012 AC-466: 図・Canvas（RPG風の地図を含む）を描くスクリプトに書いた書体の指定の文字列も、すべて NFR-UX-012 の規則に従う', () => {
  const found = [];
  for (const f of walk(path.join(WEB, 'src')).filter((x) => /\.m?js$/i.test(x))) {
    const s = read(f);
    const lits = [
      ...[...s.matchAll(/font-family="([^"]+)"/g)].map((m) => m[1]),
      ...[...s.matchAll(/\.font\s*=\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2]),
      ...[...s.matchAll(/(['"`])((?:\d+ |\$\{[^}]*\} )?(?:\d+|\$\{[^}]*\})px [^'"`]+)\1/g)].map((m) => m[2]),
    ];
    for (const raw of lits) {
      const v = raw.replace(/\$\{[^}]*\}(?=px)/g, '0');
      if (/\$\{/.test(familiesOfFont(v).join(','))) continue; // 書体の並びを変数から得るもの（getFontStacks などで確かめる）
      const list = familiesOfFont(v);
      if (!list.some((n) => /sans-serif|serif|system-ui|monospace|cursive/.test(n))) continue;
      found.push(path.relative(WEB, f));
      assertJpOrder(list, `${path.relative(WEB, f)}「${raw}」`);
    }
  }
  assert.ok(found.length >= 1, '図・Canvas の書体の指定が見つかる');
});
