// FR-095 AC-560（全出力の表題・日付・議題・登壇者）／AC-166（タイトル情報の保存対象）／AC-559（保存・復元・初期化）／FR-036 AC-659（登壇者名）
// （System Test。契約: tests/system/CONTRACT-MEETING.md）
// 期待値は受入基準だけから決める。実装がなければ失敗するのが正常（not_run → 実装後に pass）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail, pdfTexts } from './helpers.js';

// 登壇者名（FR-036・AC-659）の契約は CONTRACT-MEETING.md の「登壇者名」
const INFO = { series: '月例レビュー', theme: '予算見直し会議', date: '2026-11-03', venue: '会議室A', speaker: '山田太郎' };
const descOfSvg = (svg) => (/<desc[^>]*>([\s\S]*?)<\/desc>/.exec(svg) ?? [])[1] ?? '';
async function withNetSpy(fn) {
  const calls = []; const saved = {};
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
  for (const k of names) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: function (...a) { calls.push({ k, a }); throw new Error('network blocked'); } });
  }
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { ...(nav?.value || {}), sendBeacon: (...a) => { calls.push({ k: 'sendBeacon', a }); return false; } } });
  try { await fn(); } finally {
    for (const k of names) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
  }
  return calls;
}
const CTX = { purpose: '来期予算の方針をそろえる', audience: '経営層と各部門長', agenda: [{ name: '現状の共有', minutes: 5 }, { name: '案の比較', minutes: 15 }] };
const DATE_RE = /\d{4}\s*[-/年.]\s*\d{1,2}\s*[-/月.]\s*\d{1,2}/;

// 5 形式の保存物を、検索できる文字列にして返す（PNG は描画した文字、PDF は取り出した文字）
async function saveAll(app, env) {
  const out = {};
  env.canvasFactory.log.texts.length = 0;
  env.downloads.length = 0; // 呼び出しごとに数え直す（累積させない）
  await app.commands['save.png'](); out.png = env.canvasFactory.log.texts.join('\n');
  await app.commands['save.pdf'](); out.pdf = pdfTexts(env.downloads.at(-1).data);
  await app.commands['save.svg'](); out.svg = String(env.downloads.at(-1).data);
  await app.commands['save.markdown'](); out.md = String(env.downloads.at(-1).data);
  await app.commands['save.html'](); out.html = String(env.downloads.at(-1).data);
  assert.equal(env.downloads.length, 5, '5 形式すべてが保存される');
  return out;
}

// FR-095 AC-560 / FR-095 AC-166 / FR-095 AC-559
test('FR-095 AC-560 AC-166: PNG・PDF・SVG・Markdown・HTML のすべてに、表題・日付・議題（入力順）が文字で載る', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  assert.ok(app.setTitleInfo(INFO).ok !== false);
  assert.equal(app.setMeetingContext(CTX).ok, true);
  const out = await saveAll(app, env);
  for (const [fmt, s] of Object.entries(out)) {
    for (const w of [INFO.theme, INFO.date, ...CTX.agenda.map((a) => a.name)]) assert.ok(s.includes(w), `${fmt}: 「${w}」を含む`);
    assert.ok(s.indexOf('現状の共有') < s.indexOf('案の比較'), `${fmt}: 議題は入力順`);
  }
  for (const fmt of ['svg', 'md', 'html']) for (const w of [INFO.series, INFO.venue]) assert.ok(out[fmt].includes(w), `${fmt}: タイトル情報「${w}」（AC-166）`);
});

// FR-036 AC-659 AC-560 AC-166: 登壇者名（Q-041 A）。入力があるときだけ「登壇者」の項として載る
test('FR-036 AC-560 AC-659 AC-166: 登壇者名は PNG・PDF・SVG の右上の文字、Markdown・HTML の「登壇者」の項として載り、画像の説明には載らない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  assert.ok(app.setTitleInfo(INFO).ok !== false);
  assert.equal(app.getTitleInfo().speaker, INFO.speaker);
  const out = await saveAll(app, env);
  for (const [fmt, s] of Object.entries(out)) assert.ok(s.includes(INFO.speaker), `${fmt}: 登壇者名を含む`);
  // SVG: 右上（図の右半分）の文字
  const svg = out.svg;
  const m = /<text\b[^>]*data-role="speaker"[^>]*>([^<]*)<\/text>/.exec(svg);
  assert.ok(m && m[1].includes(INFO.speaker), 'svg: data-role="speaker" の文字');
  const vbW = Number(/viewBox="[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+[\d.]+"/.exec(svg)?.[1]);
  const x = Number(/\bx="([-\d.]+)"/.exec(m[0])?.[1]);
  assert.ok(vbW > 0 && x > vbW / 2, `右上（x=${x} が幅 ${vbW} の右半分）`);
  // Markdown: 最初の ## の前の冒頭に「登壇者」の項、HTML にもラベルと名前
  const head = out.md.split(/^##/m)[0];
  assert.ok(/登壇者/.test(head) && head.includes(INFO.speaker), 'md: 冒頭に「登壇者」の項');
  assert.ok(/登壇者/.test(out.html), 'html: 「登壇者」のラベル');
  // 画像の説明（AC-561・AC-562）には載せない
  assert.ok(!descOfSvg(svg).includes(INFO.speaker), 'svg: <desc> に名前を含めない');
  assert.ok(!app.getFigureDescription().text.includes(INFO.speaker), '説明（getFigureDescription）に名前を含めない');
  // 異常系: 文字としてだけ出る（<script> などを入れても要素にならない）
  // 出力 HTML には、名前と無関係なスライド動作用の <script> が入り得る。よって全体ではなく、固有マーカーで挟んだ名前の部分だけを判定する
  app.setTitleInfo({ speaker: 'SPK_BEGIN<script>alert(1)</script><img src=x onerror=alert(2)>SPK_END' });
  const out2 = await saveAll(app, env);
  for (const fmt of ['svg', 'html']) {
    const s = out2[fmt];
    const i = s.indexOf('SPK_BEGIN'), j = s.indexOf('SPK_END');
    assert.ok(i >= 0 && j > i, `${fmt}: 名前が文字として載る`);
    const region = s.slice(i, j + 'SPK_END'.length);
    assert.ok(!/</.test(region), `${fmt}: 名前の部分に生の < が無い（要素として解釈されない）: ${region}`);
    assert.ok(/&lt;|&#0*60;|&#x0*3c;/i.test(region), `${fmt}: 名前の < はエスケープ済みの形で載る: ${region}`);
  }
});

test('FR-036 AC-659 AC-560 異常系: 登壇者名が空のときは匿名の汎用アイコンだけで、5 形式のどこにも名前も「登壇者」の項も載らない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  assert.equal(app.getTitleInfo().speaker, '', '既定は空');
  app.setTitleInfo({ theme: '演題だけ', speaker: '' });
  const out = await saveAll(app, env);
  assert.ok(/data-role="anon-icon"/.test(out.svg), 'svg: 匿名の汎用アイコン');
  assert.ok(!/data-role="speaker"/.test(out.svg), 'svg: 名前の要素なし');
  for (const fmt of ['md', 'html']) assert.ok(!/登壇者/.test(out[fmt]), `${fmt}: 「登壇者」の項を出さない`);
  // 入力して消すと、また匿名のアイコンだけに戻る
  app.setTitleInfo({ speaker: INFO.speaker }); app.setTitleInfo({ speaker: '' });
  const out2 = await saveAll(app, env);
  for (const fmt of ['png', 'pdf', 'svg', 'md', 'html']) assert.ok(!out2[fmt].includes(INFO.speaker), `${fmt}: 消した名前が残らない`);
});

// FR-036 AC-659(f) AC-606: 自由入力の文字として「機密の要点を除く」保存でも残り、保存の画面で警告する。外部へのリクエストは 0 件（AC-659 e）
test('FR-036 AC-659 AC-606: 機密の要点を除く保存でも登壇者名はそのまま残り、保存の警告に「登壇者名」が示される。入力・表示・保存で外部リクエストは 0 件', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  const ext = await withNetSpy(async () => {
    app.setTitleInfo(INFO);
    app.setExcludeConfidential(true);
    const out = await saveAll(app, env);
    for (const [fmt, s] of Object.entries(out)) assert.ok(s.includes(INFO.speaker), `${fmt}: 除く保存でも名前が残る`);
    const warn = (app.getSaveWarnings?.() ?? []).join('\n');
    assert.ok(warn.includes('登壇者名'), `保存の警告に「登壇者名」: ${warn}`);
    await app.commands['file.save']();
  });
  assert.deepEqual(ext, [], '外部へのリクエストは 0 件');
});

test('FR-095 AC-560 AC-166 異常系: 日付が未入力なら日付を載せず出力日も補わない。議題 0 件なら議題欄を出さない。表題が未入力なら従来の表題', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  app.setTitleInfo({ series: '', theme: '', date: '', venue: '', speaker: '' });
  app.setMeetingContext({ agenda: [] });
  const out = await saveAll(app, env);
  for (const fmt of ['svg', 'md', 'html']) {
    assert.ok(!DATE_RE.test(out[fmt]), `${fmt}: 日付（出力日を含む）を載せない`);
    assert.ok(!/議題/.test(out[fmt]), `${fmt}: 議題欄を出さない`);
  }
  assert.ok(!DATE_RE.test(out.pdf), 'pdf: 日付を載せない');
  assert.ok(/^# \S/m.test(out.md), 'Markdown の # 見出し（従来の表題）は空でない');
  // 表題だけの入力: 日付は載らず、表題は載る
  app.setTitleInfo({ theme: '演題だけ' });
  const out2 = await saveAll(app, env);
  for (const fmt of ['png', 'pdf', 'svg', 'md', 'html']) assert.ok(out2[fmt].includes('演題だけ'), `${fmt}: 表題`);
  for (const fmt of ['svg', 'md', 'html']) assert.ok(!DATE_RE.test(out2[fmt]), `${fmt}: 日付なし`);
});

// FR-096 AC-561 AC-562: 説明の対象は画面の詳細度（FR-026）に従う。その詳細度で図に出ない要点は、結論・未解決事項にも含めない。
const descOf = (svg) => (/<desc[^>]*>([\s\S]*?)<\/desc>/.exec(svg) ?? [])[1] ?? '';
test('FR-096 AC-561 AC-562: SVG・PNG・PDF の説明は画面の詳細度に従い、大項目・中項目では出ない要点を含まず、詳細では含む', async () => {
  const { app, env } = await newApp();
  const texts = await seedThreeScenes(app, env);
  const points = texts.filter((t) => /決める/.test(t) || /確認する/.test(t)); // 結論・未解決になりうる要点
  assert.ok(points.length > 0);
  const shownAt = (level) => {
    toDetail(app, level);
    const titles = app.getTopics().map((tp) => tp.title);
    const heads = level === 'middle' ? app.getState().scenes.map((s) => s.heading) : [];
    return [...titles, ...heads];
  };
  const out = {};
  for (const level of ['major', 'middle', 'detail']) {
    const shown = shownAt(level).join('\n');
    env.canvasFactory.log.texts.length = 0; env.downloads.length = 0;
    await app.commands['save.svg'](); const svg = String(env.downloads.at(-1).data);
    await app.commands['save.png'](); const png = env.canvasFactory.log.texts.join('\n');
    await app.commands['save.pdf'](); const pdf = pdfTexts(env.downloads.at(-1).data);
    const desc = descOf(svg);
    assert.ok(desc.length > 0, `${level}: <desc> がある`);
    out[level] = desc;
    for (const t of points) {
      if (level === 'detail') assert.ok(desc.includes(t), `detail: 要点「${t}」を説明に含む`);
      else if (!shown.includes(t)) assert.ok(!desc.includes(t), `${level}: 図に出ない要点「${t}」を説明に含めない`);
    }
    assert.ok(/なし/.test(out[level]) || level === 'detail', `${level}: 該当のない項目は「なし」`);
    // PDF の「図の説明」の項は SVG の説明と同じ対象（出ない要点を含まない）
    for (const t of points) if (level !== 'detail' && !shown.includes(t)) assert.ok(!pdf.includes(t), `${level}: PDF に図に出ない要点「${t}」がない`);
    void png;
  }
  assert.notEqual(out.major, out.detail, '大項目と詳細で説明が異なる');
});

test('FR-095 AC-559 AC-166: タイトル情報・目的・対象読者・議題は再読込・セッションファイルの読込で復元され、データの初期化で消える。空白だけの議題は拒否', async () => {
  const { app, env, createApp } = await newApp();
  await seedThreeScenes(app, env);
  app.setTitleInfo(INFO);
  assert.equal(app.setMeetingContext(CTX).ok, true);
  const bad = app.setMeetingContext({ agenda: [{ name: '   ' }] });
  assert.equal(bad.ok, false, '空白だけの議題は拒否');
  assert.deepEqual(app.getMeetingContext().agenda.map((a) => a.name), ['現状の共有', '案の比較'], '拒否のとき不変');
  const want = () => ({ ti: app.getTitleInfo(), purpose: app.getMeetingContext().purpose, audience: app.getMeetingContext().audience, agenda: app.getMeetingContext().agenda.map((a) => [a.name, a.minutes]) });
  const expected = { ti: { ...INFO }, purpose: CTX.purpose, audience: CTX.audience, agenda: [['現状の共有', 5], ['案の比較', 15]] };
  assert.deepEqual(want(), expected);

  // ブラウザ内の保存 → 再読込（同じ storage）
  const app2 = await createApp(env.options);
  const w2 = { ti: app2.getTitleInfo(), purpose: app2.getMeetingContext().purpose, audience: app2.getMeetingContext().audience, agenda: app2.getMeetingContext().agenda.map((a) => [a.name, a.minutes]) };
  assert.deepEqual(w2, expected, '再読込の後に復元される');

  // セッションファイル（file.save → 初期化 → 読込）
  const r = await app.commands['file.save']();
  assert.equal(r.ok, true);
  const dl = env.downloads.at(-1);
  assert.equal(app.commands['data.reset']().ok, true);
  assert.equal((await app.dialogAction('confirm')).ok, true);
  assert.deepEqual(app.getTitleInfo(), { series: '', theme: '', date: '', venue: '', speaker: '' }, 'データの初期化でタイトル情報（登壇者名 AC-659 d を含む）が消える');
  assert.deepEqual(app.getMeetingContext(), { purpose: '', audience: '', agenda: [] }, 'データの初期化で会議の文脈が消える');
  const l = await app.loadSessionFile({ name: dl.filename, type: dl.mime, size: String(dl.data).length, text: String(dl.data) });
  assert.equal(l.ok, true);
  assert.deepEqual(want(), expected, 'セッションファイルの読込で復元される');
});
