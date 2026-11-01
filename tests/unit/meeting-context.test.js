// FR-095 AC-558・AC-559・AC-560・AC-578 / FR-096 AC-561・AC-562・AC-563 の単体・結合テスト。
// 全出力の表題・日付・議題の通し（AC-560）は tests/system/meeting-context.test.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail, bytesToLatin1 } from '../system/helpers.js';
import { buildFigureDescription } from '../../web/src/figuredesc.js';
import { addPngText, readPngText } from '../../web/src/pngmeta.js';
import { decorateSvg, headerModel, markdownHead } from '../../web/src/meetingout.js';
import { buildMarkdown, buildHtml } from '../../web/src/presentexport.js';
import { buildPdf } from '../../web/src/export.js';

const EVIL = '<script>alert(1)</script><img src=x onerror="y">';

// FR-096 AC-563: 説明は決定的で、該当がない項目は「なし」。議題の語は使わない
test('FR-096 AC-561 AC-563: buildFigureDescription は同じ入力から同じ文章を作り、該当がない項目は「なし」と書く', () => {
  const a = buildFigureDescription({ title: '予算会議', purpose: '方針', audience: '部長', topics: ['T1', 'T2'], relations: ['原因→結果: A → B'], conclusions: [], unresolved: [] });
  const b = buildFigureDescription({ title: '予算会議', purpose: '方針', audience: '部長', topics: ['T1', 'T2'], relations: ['原因→結果: A → B'], conclusions: [], unresolved: [] });
  assert.deepEqual(a, b);
  assert.match(a.text, /主なテーマ: T1、T2/);
  assert.match(a.text, /関係: 原因→結果: A → B/);
  assert.match(a.text, /結論: なし/);
  assert.match(a.text, /未解決事項: なし/);
  assert.match(a.text, /目的: 方針/);
  assert.match(a.text, /対象読者: 部長/);
  assert.ok(!/議題/.test(a.text));
  assert.match(buildFigureDescription({ lang: 'en' }).text, /Conclusions: None/);
});

// FR-096 AC-562: iTXt（UTF-8）で Title・Description が付く
test('FR-096 AC-562: addPngText は iTXt チャンク（UTF-8）の Title・Description を差し込み、元の IDAT・IEND は残る', () => {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunk = (type, data) => [0, 0, 0, data.length, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  const png = Uint8Array.from([...sig, ...chunk('IHDR', new Array(13).fill(0)), ...chunk('IDAT', [1, 2]), ...chunk('IEND', [])]);
  const out = addPngText(png, [['Title', '予算見直し'], ['Description', '主なテーマ: A\n結論: なし']]);
  const r = readPngText(out);
  assert.equal(r.Title, '予算見直し');
  assert.equal(r.Description, '主なテーマ: A\n結論: なし');
  assert.ok(out.length > png.length);
  assert.ok(Buffer.from(out).includes(Buffer.from('IDAT')) && Buffer.from(out).includes(Buffer.from('IEND')));
  // PNG でないバイト列は変えない
  const raw = Uint8Array.from([1, 2, 3]);
  assert.equal(addPngText(raw, [['Title', 'x']]), raw);
});

// FR-095 AC-560 AC-578 / FR-096 AC-563: SVG の title・desc は文字としてだけ（エスケープ）。許可リスト外の要素を足さない
test('FR-096 AC-561 AC-563 AC-578: decorateSvg は <title>・<desc> を足し、会議の文字列を escape する。見出しの帯は高さだけを広げる', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="400" height="200"><title>old</title><rect width="100%" height="100%" fill="#fff"/></svg>';
  const header = headerModel({ title: EVIL, date: '', series: '', venue: '', agenda: [EVIL] }, 'ja');
  const out = decorateSvg(svg, { title: EVIL, desc: `目的: ${EVIL}`, header });
  assert.ok(!out.includes('<script>') && !/<img/.test(out) && !out.includes('old'));
  assert.ok(out.includes('&lt;script&gt;'));
  assert.match(out, /<title>[^<]*<\/title><desc>[^<]*<\/desc>/);
  const vb = /viewBox="0 0 400 (\d+(?:\.\d+)?)"/.exec(out);
  assert.ok(vb && Number(vb[1]) > 200, '見出しの分だけ高くなる');
  assert.equal([...out.matchAll(/<svg\b/g)].length, 1);
  // 見出しがなければ高さは変わらない
  assert.match(decorateSvg(svg, { title: 'T', desc: 'D', header: null }), /viewBox="0 0 400 200"/);
});

test('FR-095 AC-560: 日付が空なら日付の行を出さず、議題が 0 件なら議題の行を出さない', () => {
  assert.deepEqual(headerModel({ title: 'T', date: '', series: '', venue: '', agenda: [] }, 'ja').lines, []);
  assert.deepEqual(headerModel({ title: 'T', date: '2026-11-03', series: 'S', venue: 'V', agenda: ['a', 'b'] }, 'ja').lines, ['2026-11-03', 'S / V', '議題:', '1. a', '2. b']);
  assert.deepEqual(markdownHead({ date: '', agenda: [] }), []);
});

// FR-095 AC-578: Markdown・HTML の冒頭に目的・対象読者。会議の文字列は文字としてだけ
test('FR-095 AC-560 AC-578: buildMarkdown・buildHtml の冒頭に日付・議題・目的・対象読者が載り、タグは文字になる', () => {
  const scenes = [{ id: 's1', heading: 'H', points: [{ id: 'p1', text: 'x' }] }];
  const topics = [{ id: 't1', title: 'T', sceneIds: ['s1'] }];
  const meta = { title: 'タイトル', date: '2026-11-03', series: '', venue: '', agenda: ['一つ目', EVIL], purpose: EVIL, audience: '部長' };
  const md = buildMarkdown({ scenes, topics, title: 'タイトル', meta });
  const head = md.split('\n').slice(0, md.split('\n').findIndex((l) => /^## /.test(l))).join('\n');
  for (const w of ['2026-11-03', '一つ目', '部長', '目的']) assert.ok(head.includes(w), w);
  assert.ok(!md.includes('<script>') && head.includes('&lt;script&gt;'));
  const html = buildHtml({ scenes, topics, title: 'タイトル', meta, svgOf: () => '<svg></svg>' });
  assert.ok(html.includes('2026-11-03') && html.includes('一つ目') && html.includes('部長'));
  assert.equal((html.match(/<script>/g) ?? []).length, 1, '実行されるスクリプトは同梱の 1 つだけ');
  assert.ok(!/<img[^>]*onerror/i.test(html));
  // 未入力: 欄を出さない
  const bare = buildHtml({ scenes, topics, title: 'タイトル', meta: { title: 'タイトル', date: '', agenda: [] }, svgOf: () => '' });
  assert.ok(!bare.includes('data-meeting='));
});

// FR-096 AC-562: PDF の Title・Subject（UTF-16BE）と末尾の「図の説明」
test('FR-096 AC-562: buildPdf は /Info の Title・Subject を UTF-16BE の文字列で持ち、末尾に「図の説明」の項を出す', () => {
  const scenes = [{ id: 's1', heading: 'H', points: [{ id: 'p1', text: 'x' }] }];
  const pdf = bytesToLatin1(buildPdf(scenes, { title: '表題', desc: '結論: なし', descLabel: '図の説明', infoTitle: '表題' }));
  const hex = (s) => `FEFF${[...s].map((c) => c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join('')}`;
  assert.ok(pdf.includes(`/Title <${hex('表題')}>`));
  assert.ok(pdf.includes(`/Subject <${hex('結論: なし')}>`));
  assert.match(pdf, /\/Info \d+ 0 R/);
  assert.ok(pdf.includes(hex('図の説明').slice(4)), '図の説明の項');
});

// FR-095 AC-558・AC-559・AC-578 / FR-096 AC-561〜563: アプリを通した結合
test('FR-095 AC-558 AC-559: 目的・対象読者・議題を入力でき、未入力の目的は出力に出ない。不正な型は全体を変えない', async () => {
  const { app } = await newApp();
  assert.equal(app.setMeetingContext({ purpose: '  方針  ', audience: '部長', agenda: [{ name: 'A', minutes: 5 }] }).ok, true);
  const c = app.getMeetingContext();
  assert.equal(c.purpose, '方針'); assert.equal(c.audience, '部長'); assert.equal(c.agenda[0].minutes, 5);
  assert.equal(app.setMeetingContext({ purpose: 3 }).ok, false);
  assert.equal(app.getMeetingContext().purpose, '方針');
  assert.equal(app.setMeetingContext({ purpose: 'x', agenda: [{ name: ' ' }] }).ok, false);
  assert.equal(app.getMeetingContext().purpose, '方針', '議題が不正なら目的も変えない');
  // 入力欄の文字（1 行 1 項目「名前 | 分」）
  assert.equal(app.setMeetingAgendaText('現状 | 5\n比較\n').ok, true);
  assert.deepEqual(app.getMeetingContext().agenda.map((a) => [a.name, a.minutes]), [['現状', 5], ['比較', null]]);
  assert.equal(app.getMeetingFormValues().agenda, '現状 | 5\n比較');
  assert.ok(app.getMeetingFormSpec().fields.some((f) => f.id === 'agenda'));
});

// FR-096 AC-561 AC-562: 説明の対象は画面の詳細度（FR-026）に従い、その詳細度で出ない要点は含めない
test('FR-096 AC-561 AC-562: 説明は詳細度ごとに絞られ、大項目・中項目では要点の文字を含まず、詳細では含む。保存物も同じ', async () => {
  const { app, env } = await newApp();
  const texts = await seedThreeScenes(app, env);
  const heads = app.getState().scenes.map((s) => s.heading);
  toDetail(app, 'detail');
  const full = app.getFigureDescription().text;
  assert.ok(full.includes('コストが高くて困った'), '詳細では要点を含む');
  for (const lvl of ['major', 'middle']) {
    toDetail(app, lvl);
    const d = app.getFigureDescription().text;
    assert.ok(!d.includes('コストが高くて困った'), `${lvl}: 画面に出ない要点を含まない`);
    assert.ok(d.includes('主なテーマ') && d.includes('結論') && d.includes('未解決事項'), `${lvl}: 4 項目の見出しは残る`);
    await app.commands['save.svg']();
    const svg = String(env.downloads.at(-1).data);
    assert.ok(!svg.includes('コストが高くて困った'), `${lvl}: SVG の説明にも出ない`);
  }
  toDetail(app, 'middle');
  const mid = app.getFigureDescription().text;
  assert.ok(mid.length > 0 && heads.length === 3);
});

test('FR-096 AC-561 AC-562 AC-563 AC-578: 保存した SVG・PNG・PDF に同じ説明が付き、詳細度（詳細）の内容で、会議の文字は escape される', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.setTitleInfo({ theme: EVIL });
  app.setMeetingContext({ purpose: EVIL, audience: '経営層', agenda: [{ name: EVIL }] });
  const descAt = (lvl) => { toDetail(app, lvl); return app.getFigureDescription().text; };
  const full = descAt('detail');
  assert.equal(descAt('detail'), full, '決定的');
  for (const w of ['主なテーマ', '関係', '結論', '未解決事項', '目的', '対象読者']) assert.ok(full.includes(w), w);
  await app.commands['save.svg']();
  const svg = String(env.downloads.at(-1).data);
  assert.match(svg, /<title>[^<]*<\/title><desc>[^<]*<\/desc>/);
  assert.ok(!svg.includes('<script>') && !/<img[^>]*onerror/i.test(svg));
  await app.commands['save.png']();
  assert.ok(env.downloads.at(-1).data.length > 0);
  const pt = readPngText(env.downloads.at(-1).data);
  assert.equal(pt.Title, EVIL); assert.equal(pt.Description, full, 'PNG の iTXt は SVG の説明と同じ内容');
  assert.ok(svg.includes(full.split('\n')[1].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')), 'SVG の説明も同じ内容');
  await app.commands['save.pdf']();
  const pdf = bytesToLatin1(env.downloads.at(-1).data);
  assert.match(pdf, /\/Info \d+ 0 R/);
  assert.match(pdf, /\/Subject <FEFF[0-9A-F]+>/);
});

test('FR-095 AC-559: タイトル情報だけでも保存・復元され、初期化で消える（AC-166）', async () => {
  const { app, env, createApp } = await newApp();
  await seedThreeScenes(app, env);
  app.setTitleInfo({ series: 'S', theme: 'T', date: '2026-11-03', venue: 'V' });
  const app2 = await createApp(env.options);
  assert.deepEqual(app2.getTitleInfo(), { series: 'S', theme: 'T', date: '2026-11-03', venue: 'V' });
});
