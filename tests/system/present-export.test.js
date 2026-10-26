// FR-090 AC-528（構造化 Markdown）・AC-530（HTML プレゼンテーション）（System Test。契約: tests/system/CONTRACT-LIVE-EXPORT.md）
// HTML の実行時の挙動（矢印キー・自動送り）は実ブラウザ（perf-util と同じ playwright-core ＋ Edge/Chrome）で確かめる。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail, PARAM } from './helpers.js';
import { launch } from './perf-util.js';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

// FR-090 AC-528
test('FR-090 AC-528: Markdown 保存で、トピック(#)→シーン(##)→要点(### か箇条書き)の階層と関係の種類・向きが、図の詳細度に従って保存される', async () => {
  for (const level of ['detail', 'middle', 'major']) {
    const { app, env } = await newApp();
    await seedThreeScenes(app, env); toDetail(app, level);
    app.setDraft('案Aの採用を提案します。'); app.submitDraft(); env.tick(1); // 課題（コストが高くて困った）→ 提案の関係が付く（FR-053）
    await app.commands['save.markdown']();
    assert.equal(env.downloads.length, 1, level);
    const d = env.downloads[0];
    assert.match(d.filename, /\.md$/i);
    assert.match(d.mime, /markdown/);
    const md = String(d.data);
    const lines = md.split(/\r?\n/);
    const topics = app.getTopics();
    const scenes = app.getState().scenes;
    const idx = (s) => lines.findIndex((l) => l.includes(s));
    let last = -1;
    for (const t of topics) {
      const i = lines.findIndex((l, k) => k > last && /^# [^#]/.test(l) && l.includes(t.title));
      assert.ok(i >= 0, `${level}: トピック「${t.title}」が # の見出し（出現順）`); last = i;
    }
    if (level !== 'major') {
      last = -1;
      for (const s of scenes) {
        const i = lines.findIndex((l, k) => k > last && /^## [^#]/.test(l) && l.includes(s.heading));
        assert.ok(i >= 0, `${level}: シーン「${s.heading}」が ## の見出し（出現順）`); last = i;
      }
    } else {
      assert.ok(!lines.some((l) => /^##\s/.test(l)), '大項目ではシーンの見出しを含まない');
    }
    if (level === 'detail') {
      for (const s of scenes) {
        const h = lines.findIndex((l) => /^## [^#]/.test(l) && l.includes(s.heading));
        const next = lines.findIndex((l, k) => k > h && /^#{1,2} [^#]/.test(l));
        const block = lines.slice(h + 1, next < 0 ? undefined : next);
        for (const p of s.points) assert.ok(block.some((l) => /^\s*(-|\*|#{3}) /.test(l) && l.includes(p.text)), `要点「${p.text}」が ${s.heading} の下の ### または箇条書き`);
      }
      const rels = app.getOutlineRelations();
      assert.ok(rels.length >= 1, '前提: 関係がある（課題→提案 など）');
      const textOf = (id) => scenes.flatMap((s) => s.points).find((p) => p.id === id).text;
      for (const r of rels) {
        const row = lines.find((l) => l.includes(r.kindLabel) && l.includes(textOf(r.from)) || (l.includes(r.kindLabel) && l.includes(textOf(r.to))));
        assert.ok(row, `関係「${r.kindLabel}」（${textOf(r.from)} → ${textOf(r.to)}）が要点の行に書かれる`);
        assert.ok(md.includes(textOf(r.to)) && idx(textOf(r.from)) >= 0);
      }
    } else {
      for (const s of scenes) for (const p of s.points) {
        if (level === 'major' && (s.heading.includes(p.text) || topics.some((t) => t.title.includes(p.text)))) continue;
        if (s.heading.includes(p.text)) continue;
        assert.ok(!md.includes(p.text), `${level}: 画面に出ない要点「${p.text}」を含まない`);
      }
    }
  }
});

test('FR-090 AC-528 異常系: シーン 0 件では Markdown は保存されない', async () => {
  const { app, env } = await newApp();
  await app.commands['save.markdown']();
  assert.equal(env.downloads.length, 0);
});

// FR-090 AC-530（AC-531 の外部リクエスト 0・文字として扱う、も同じ保存物で確かめる）
test('FR-090 AC-530: HTML 保存でシーンごとに 1 枚のスライド（見出し・要点・図）の 1 ファイルが得られ、矢印キーで前後に移り、自動送りは 8 秒ごと。外部リクエスト 0・会議の文字列は文字としてだけ扱われる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  app.setDraft('<script>window.__x=1</script><img src=x onerror="window.__x=2">'); app.submitDraft();
  await app.commands['save.html']();
  assert.equal(env.downloads.length, 1);
  const d = env.downloads[0];
  assert.match(d.filename, /\.html?$/i); assert.match(d.mime, /text\/html/);
  const html = String(d.data);
  const scenes = app.getState().scenes;
  assert.equal(scenes.length, 3);
  assert.ok(!/(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html), '外部の URL を参照しない');
  assert.ok(!/url\(\s*["']?(https?:)?\/\//i.test(html) && !/@import/i.test(html), 'CSS から外部を読まない');
  assert.ok(!html.includes('<script>window.__x=1</script>') && !/<img[^>]*onerror/i.test(html), '会議の文字列がタグとして入らない');

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const external = [];
  await ctx.route('**/*', (route) => { const u = route.request().url(); if (!/^(data|blob|about):/.test(u)) external.push(u); route.abort(); });
  const page = await ctx.newPage();
  try {
    await page.clock.install();
    await page.setContent(html, { waitUntil: 'load' });
    const slides = page.locator('section[data-slide]');
    assert.equal(await slides.count(), scenes.length + 0, 'シーンごとに 1 枚');
    for (let i = 0; i < scenes.length; i++) {
      const s = slides.nth(i);
      assert.equal(await s.getAttribute('data-scene-id'), scenes[i].id);
      assert.ok((await s.locator('h1,h2,h3').first().innerText()).includes(scenes[i].heading), `スライド ${i} の見出し`);
      const items = await s.locator('li').allInnerTexts();
      for (const p of scenes[i].points) assert.ok(items.some((t) => t.includes(p.text)) || (await s.innerText()).includes(p.text), `スライド ${i} の要点`);
      assert.ok((await s.locator('svg').count()) >= 1, `スライド ${i} の図`);
    }
    const active = () => page.evaluate(() => [...document.querySelectorAll('section[data-slide]')].findIndex((e) => e.getAttribute('data-active') === 'true'));
    assert.equal(await active(), 0, '初期は 1 枚目');
    await page.keyboard.press('ArrowRight'); assert.equal(await active(), 1);
    await page.keyboard.press('ArrowRight'); assert.equal(await active(), 2);
    await page.keyboard.press('ArrowRight'); assert.equal(await active(), 2, '末尾で止まる');
    await page.keyboard.press('ArrowLeft'); assert.equal(await active(), 1);
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); assert.equal(await active(), 0, '先頭で止まる');
    await page.locator('[data-autoplay]').first().click();
    await page.clock.runFor((PARAM.DWELL_SEC - 1) * 1000);
    assert.equal(await active(), 0, '8 秒たつまで 1 枚目');
    await page.clock.runFor(1500);
    assert.equal(await active(), 1, '8 秒で次へ');
    await page.clock.runFor(PARAM.DWELL_SEC * 1000);
    assert.equal(await active(), 2);
    await page.clock.runFor(PARAM.DWELL_SEC * 3000);
    assert.equal(await active(), 2, '最後で止まる');
    // AC-531: 外部リクエスト 0・文字としてだけ扱う
    assert.deepEqual(external, [], '外部のオリジンへのリクエスト 0 件');
    assert.equal(await page.evaluate(() => window.__x), undefined, '会議の文字列はスクリプトとして実行されない');
    assert.equal(await page.locator('section[data-slide] script, section[data-slide] img').count(), 0, '会議の文字列が要素にならない');
    assert.ok((await page.locator('body').innerText()).includes('window.__x=1'), '文字列は文字として表示される');
  } finally { await ctx.close(); }
});

test('FR-090 AC-530 異常系: シーン 0 件では HTML は保存されない', async () => {
  const { app, env } = await newApp();
  await app.commands['save.html']();
  assert.equal(env.downloads.length, 0);
});
