// FR-095 AC-560（全出力の表題・日付・議題）／AC-166（タイトル情報の保存対象）／AC-559（保存・復元・初期化）
// （System Test。契約: tests/system/CONTRACT-MEETING.md）
// 期待値は受入基準だけから決める。実装がなければ失敗するのが正常（not_run → 実装後に pass）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail, pdfTexts } from './helpers.js';

const INFO = { series: '月例レビュー', theme: '予算見直し会議', date: '2026-11-03', venue: '会議室A' };
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

test('FR-095 AC-560 AC-166 異常系: 日付が未入力なら日付を載せず出力日も補わない。議題 0 件なら議題欄を出さない。表題が未入力なら従来の表題', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  app.setTitleInfo({ series: '', theme: '', date: '', venue: '' });
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
  assert.deepEqual(app.getTitleInfo(), { series: '', theme: '', date: '', venue: '' }, 'データの初期化でタイトル情報が消える');
  assert.deepEqual(app.getMeetingContext(), { purpose: '', audience: '', agenda: [] }, 'データの初期化で会議の文脈が消える');
  const l = await app.loadSessionFile({ name: dl.filename, type: dl.mime, size: String(dl.data).length, text: String(dl.data) });
  assert.equal(l.ok, true);
  assert.deepEqual(want(), expected, 'セッションファイルの読込で復元される');
});
