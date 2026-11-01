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
test('FR-090 AC-528: Markdown 保存で、会議タイトル(#)→トピック(##)→要点(###)→詳細(箇条書き)の階層、末尾の決定事項・アクション項目の節、関係の種類・向きが、図の詳細度に従って保存される', async () => {
  for (const level of ['detail', 'middle', 'major']) {
    const { app, env } = await newApp();
    await seedThreeScenes(app, env); toDetail(app, level);
    app.setTitleInfo({ theme: '予算見直し会議', date: '2026-11-03' });
    app.setMeetingContext({ purpose: '来期予算の方針をそろえる', audience: '経営層と各部門長', agenda: [{ name: '現状の共有', minutes: 5 }, { name: '案の比較', minutes: 15 }] });
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
    assert.equal(lines.filter((l) => /^# [^#]/.test(l)).length, 1, '# の見出しは会議タイトルの 1 つだけ');
    assert.ok(lines.some((l) => /^# [^#]/.test(l) && l.includes('予算見直し会議')), '会議タイトルが # の見出し');
    // 冒頭（最初の ## の前）に表題・日付・議題（入力順）・目的・対象読者（FR-095）
    const head = lines.slice(0, lines.findIndex((l) => /^##\s/.test(l))).join('\n');
    for (const w of ['予算見直し会議', '2026-11-03', '現状の共有', '案の比較', '来期予算の方針をそろえる', '経営層と各部門長']) assert.ok(head.includes(w), `${level}: 冒頭に「${w}」`);
    assert.ok(head.indexOf('現状の共有') < head.indexOf('案の比較'), `${level}: 議題は入力順`);
    // 末尾の節: 決定事項 → 保留事項 → 異論・懸念 → アクション項目 → 要確認（この順。詳細度によらず常に出る）
    const sec = ['決定事項', '保留事項', '異論・懸念', 'アクション項目', '要確認'].map((n) => lines.findIndex((l) => new RegExp(`^#{2,3}\\s*${n}`).test(l)));
    assert.ok(sec.every((i) => i >= 0), `${level}: 5 つの節がある`);
    assert.deepEqual([...sec].sort((a, b) => a - b), sec, `${level}: 節はこの順`);
    const decisionsAt = sec[0];
    const actionsAt = sec[3];
    let last = lines.findIndex((l) => /^# [^#]/.test(l));
    for (const t of topics) {
      const i = lines.findIndex((l, k) => k > last && /^## [^#]/.test(l) && l.includes(t.title));
      assert.ok(i >= 0, `${level}: トピック「${t.title}」が ## の見出し（出現順）`); last = i;
    }
    assert.ok(decisionsAt > last && actionsAt > decisionsAt, `${level}: 末尾に「決定事項」「アクション項目」の節（この順）`);
    if (level === 'major') assert.ok(!lines.some((l) => /^###\s/.test(l) && !/決定事項|保留事項|異論・懸念|アクション項目|要確認/.test(l)), '大項目では要点の見出し（###）を含まない');
    if (level === 'detail') {
      const body = lines.slice(0, decisionsAt);
      for (const t of topics) {
        const h = body.findIndex((l) => /^## [^#]/.test(l) && l.includes(t.title));
        const next = body.findIndex((l, k) => k > h && /^## [^#]/.test(l));
        const block = body.slice(h + 1, next < 0 ? undefined : next);
        for (const pid of t.pointIds) {
          const text = scenes.flatMap((s) => s.points).find((p) => p.id === pid).text;
          assert.ok(block.some((l) => /^### [^#]/.test(l) && l.includes(text)), `要点「${text}」がトピック「${t.title}」の下の ###`);
        }
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
        assert.ok(!lines.slice(0, sec[4]).join('\n').includes(p.text), `${level}: 画面に出ない要点「${p.text}」を含まない（「要確認」の節は詳細度によらず列挙するため除く）`);
      }
    }
  }
});

// FR-090 AC-528（FR-094 AC-556 の節。契約: tests/system/CONTRACT-MEETING.md）
test('FR-090 AC-528: 末尾の決定事項・保留事項・異論・懸念・アクション項目は確定した項目だけ（0 件は「なし」・未定の欄は「未定」・候補は「未確定の候補 n 件」）、「要確認」の節は未確認の要点を常に列挙する', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  const D = 'リリースはA案に決まりました', P = '価格は検討中です', O = 'スケジュールが心配です', A = '来週までに見積もりの確認をお願いします';
  for (const t of [D, P, O, A]) { app.setDraft(t); assert.equal(app.submitDraft().ok, true, t); env.tick(1); }
  env.scheduler.advance(3000); toDetail(app, 'major');
  const items = app.getMeetingItems();
  const cand = (list, s) => list.find((i) => i.state === 'candidate' && i.text.includes(s));
  const dec = cand(items.decisions, 'A案に決まりました'), act = cand(items.actions, '見積もりの確認');
  assert.ok(dec && act && cand(items.pendings, '検討中') && cand(items.objections, '心配'), '前提: 4 種類の候補が抽出される');
  assert.equal(items.candidateCount, 4);
  assert.equal(app.confirmMeetingItem(dec.id).ok, true);
  assert.equal(app.confirmMeetingItem(act.id).ok, true);
  await app.commands['save.markdown']();
  const lines = String(env.downloads.at(-1).data).split(/\r?\n/);
  const at = (n) => lines.findIndex((l) => new RegExp(`^#{2,3}\\s*${n}`).test(l));
  const section = (n) => { const i = at(n); const j = lines.findIndex((l, k) => k > i && /^#{1,3}\s/.test(l)); return lines.slice(i + 1, j < 0 ? undefined : j).join('\n'); };
  const md = lines.join('\n');
  assert.ok(section('決定事項').includes(dec.text), '確定した決定事項が節に出る');
  assert.ok(!section('保留事項').includes('検討中') && /なし/.test(section('保留事項')), '候補の保留事項は出ず、0 件は「なし」');
  assert.ok(!section('異論・懸念').includes('心配') && /なし/.test(section('異論・懸念')), '候補の異論は出ず、0 件は「なし」');
  const act1 = section('アクション項目');
  assert.ok(act1.includes('見積もりの確認'), '確定したアクション項目が節に出る');
  assert.ok((act1.match(/未定/g) ?? []).length >= 3, '担当者・期限・完了条件が「未定」（発話の「来週」は期限にならない）');
  assert.match(md, /未確定の候補\s*2\s*件/, '未確定の候補 n 件');
  // 要確認の節: 図の詳細度（大項目）によらず、未確認の要点を列挙する。最後の節
  const unconfirmed = app.getState().scenes.flatMap((s) => s.points).filter((p) => app.getPointReview(p.id).needsReview);
  assert.ok(unconfirmed.length >= 1, '前提: 「来週」を含む要点は要確認');
  for (const p of unconfirmed) assert.ok(section('要確認').includes(p.text), `要確認の節に「${p.text}」`);
  assert.ok(at('要確認') > at('アクション項目') && !lines.some((l, k) => k > at('要確認') && /^#{1,3}\s/.test(l)), '要確認は最後の節');

  // 異常系: 項目も要確認の要点も 0 件 → すべての節が見出しと「なし」
  const b = await newApp();
  b.app.commands['session.start'](); b.app.setDraft('普通に進めます'); b.app.submitDraft(); b.env.tick(1); b.env.scheduler.advance(3000); toDetail(b.app);
  await b.app.commands['save.markdown']();
  const l2 = String(b.env.downloads.at(-1).data).split(/\r?\n/);
  for (const n of ['決定事項', '保留事項', '異論・懸念', 'アクション項目', '要確認']) {
    const i = l2.findIndex((l) => new RegExp(`^#{2,3}\\s*${n}`).test(l));
    assert.ok(i >= 0, `0 件でも「${n}」の見出しがある`);
    const j = l2.findIndex((l, k) => k > i && /^#{1,3}\s/.test(l));
    assert.match(l2.slice(i + 1, j < 0 ? undefined : j).join('\n'), /なし/, `${n}: 0 件は「なし」`);
  }
});

// FR-090 AC-528 AC-547（1789078 の改訂: 要点の行の「[要確認]」・確認の状況の行・HTML の「未確認 k 件」。契約: CONTRACT-REVIEW.md）
test('FR-090 AC-528: 未確認の要点の見出し行の行末に「 [要確認]」・冒頭に「確認の状況: 確認済み m 件／全体 n 件」・HTML 概要に同じ行と「未確認 k 件」（詳細度によらず件数が変わらない）', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  for (const t of ['予算は 300 万円です', '発注は来週の月曜までです', '普通に進めます']) { app.setDraft(t); assert.equal(app.submitDraft().ok, true, t); env.tick(1); }
  env.scheduler.advance(3000);
  const all = () => app.getState().scenes.flatMap((s) => s.points);
  const needs = all().filter((p) => app.getPointReview(p.id).needsReview);
  assert.ok(needs.length >= 2, '前提: 要確認の要点が 2 件以上');
  assert.equal(app.confirmPoint(needs[0].id).ok, true);
  const n = all().length;
  const m = all().filter((p) => app.getPointReview(p.id).status === 'confirmed').length;
  const unconfirmed = all().filter((p) => app.getPointReview(p.id).needsReview);
  const k = unconfirmed.length;
  assert.ok(m >= 1 && k >= 1 && m <= n && k <= n - m, '前提: m>=1・k>=1・k は n−m 以下');
  for (const level of ['detail', 'major']) {
    toDetail(app, level);
    await app.commands['save.markdown']();
    const lines = String(env.downloads.at(-1).data).split(/\r?\n/);
    const firstSec = lines.findIndex((l) => /^##\s/.test(l));
    const head = lines.slice(0, firstSec).join('\n');
    assert.ok(head.includes(`確認の状況: 確認済み ${m} 件／全体 ${n} 件`), `${level}: 冒頭に確認の状況（n は詳細度によらず全要点）`);
    const tail = lines.findIndex((l) => /^#{2,3}\s*要確認/.test(l));
    const reviewSec = lines.slice(tail + 1).join('\n');
    for (const p of unconfirmed) assert.ok(reviewSec.includes(p.text), `${level}: 「要確認」の節に「${p.text}」（${k} 件すべて）`);
    const body = lines.slice(0, lines.findIndex((l) => /^#{2,3}\s*決定事項/.test(l)));
    if (level === 'detail') {
      for (const p of all()) {
        const row = body.find((l) => /^### [^#]/.test(l) && l.includes(p.text));
        assert.ok(row, `要点「${p.text}」の ### 行`);
        if (app.getPointReview(p.id).needsReview) assert.ok(/ \[要確認\]$/.test(row), `未確認「${p.text}」は行末が「 [要確認]」`);
        else assert.ok(!row.includes('[要確認]'), `確認済み・対象外「${p.text}」には付かない`);
      }
      assert.ok(!body.some((l) => /^\s*[-*]\s/.test(l) && l.includes('[要確認]')), '詳細の箇条書きには付かない');
    } else {
      assert.ok(!body.some((l) => l.includes('[要確認]')), 'major: 要点を出さないので行への印は付かない');
    }
    await app.commands['save.html']();
    const html = String(env.downloads.at(-1).data);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const page = await ctx.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      const ov = await page.locator('section[data-slide-kind="overview"]').first().innerText();
      assert.ok(ov.includes(`確認の状況: 確認済み ${m} 件／全体 ${n} 件`), `${level}: HTML 概要に確認の状況`);
      assert.ok(ov.includes(`未確認 ${k} 件`), `${level}: HTML 概要に「未確認 ${k} 件」`);
      if (level === 'detail') {
        const items = await page.locator('section[data-slide] li').allInnerTexts();
        for (const p of unconfirmed) assert.ok(items.some((t) => t.includes(p.text) && t.includes('[要確認]')), `HTML の要点「${p.text}」の要素に [要確認]`);
      }
    } finally { await ctx.close(); }
  }
  // 異常系: 未確認 0 件でも HTML は「未確認 0 件」、Markdown は確認の状況の行と「要確認」の節（なし）
  const b = await newApp();
  b.app.commands['session.start'](); b.app.setDraft('普通に進めます'); b.app.submitDraft(); b.env.tick(1); b.env.scheduler.advance(3000); toDetail(b.app);
  await b.app.commands['save.html']();
  const h0 = String(b.env.downloads.at(-1).data);
  assert.ok(/未確認\s*0\s*件/.test(h0), '未確認 0 件でも「未確認 0 件」と書く');
  assert.ok(h0.includes('確認の状況: 確認済み 0 件／全体 1 件'), 'HTML 概要の確認の状況（0／全体 1）');
});

test('FR-090 AC-528 異常系: シーン 0 件では Markdown は保存されない', async () => {
  const { app, env } = await newApp();
  await app.commands['save.markdown']();
  assert.equal(env.downloads.length, 0);
});

// FR-090 AC-530（AC-531 の外部リクエスト 0・文字として扱う、も同じ保存物で確かめる）
test('FR-090 AC-530: HTML 保存で概要 1 枚＋トピックごとに 1 枚のスライド（見出し・要点・図）の 1 ファイルが得られ、矢印キーで前後に移り、自動送りは 8 秒ごと。外部リクエスト 0・会議の文字列は文字としてだけ扱われる', async () => {
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
    const topics = app.getTopics();
    const pts = new Map(scenes.flatMap((s) => s.points).map((p) => [p.id, p.text]));
    assert.equal(await slides.count(), topics.length + 1, '概要 1 枚＋トピックごとに 1 枚');
    assert.equal(await slides.nth(0).getAttribute('data-slide-kind'), 'overview', '最初は概要');
    assert.ok((await slides.nth(0).locator('h1,h2,h3').first().innerText()).length > 0, '概要の見出し');
    for (let i = 0; i < topics.length; i++) {
      const s = slides.nth(i + 1);
      assert.equal(await s.getAttribute('data-topic-id'), topics[i].id);
      assert.ok((await s.locator('h1,h2,h3').first().innerText()).includes(topics[i].title), `スライド ${i + 1} の見出し（トピック）`);
      const items = await s.locator('li').allInnerTexts();
      for (const pid of topics[i].pointIds) assert.ok(items.some((t) => t.includes(pts.get(pid))) || (await s.innerText()).includes(pts.get(pid)), `スライド ${i + 1} の要点`);
      assert.ok((await s.locator('svg').count()) >= 1, `スライド ${i + 1} の図`);
    }
    const last = topics.length;
    const active = () => page.evaluate(() => [...document.querySelectorAll('section[data-slide]')].findIndex((e) => e.getAttribute('data-active') === 'true'));
    assert.equal(await active(), 0, '初期は 1 枚目');
    for (let i = 1; i <= last; i++) { await page.keyboard.press('ArrowRight'); assert.equal(await active(), i); }
    await page.keyboard.press('ArrowRight'); assert.equal(await active(), last, '末尾で止まる');
    await page.keyboard.press('ArrowLeft'); assert.equal(await active(), last - 1);
    for (let i = 0; i < last; i++) await page.keyboard.press('ArrowLeft');
    assert.equal(await active(), 0, '先頭で止まる');
    await page.locator('[data-autoplay]').first().click();
    await page.clock.runFor((PARAM.DWELL_SEC - 1) * 1000);
    assert.equal(await active(), 0, '8 秒たつまで 1 枚目');
    await page.clock.runFor(1500);
    assert.equal(await active(), 1, '8 秒で次へ');
    await page.clock.runFor(PARAM.DWELL_SEC * 1000);
    assert.equal(await active(), 2);
    await page.clock.runFor(PARAM.DWELL_SEC * 1000 * (last + 1));
    assert.equal(await active(), last, '最後で止まる');
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
