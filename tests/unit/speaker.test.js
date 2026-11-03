// FR-036 AC-166・AC-659・AC-559・AC-560・AC-606 の単体・結合テスト（登壇者名。Q-041 A）。
// 全出力の通しは tests/system/meeting-context.test.js、送信に含まれないこと（AC-358）は E2E-176。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from '../system/helpers.js';
import { decorateSvg, headerModel, markdownHead, htmlHead, layoutHeader } from '../../web/src/meetingout.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="800" height="400"><rect width="800" height="400"/></svg>';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// FR-036 AC-659 (a)(b): 既定は空で、タイトル欄の項目として入力できる。推測しない
test('FR-036 AC-659 AC-166: getTitleInfo の既定は speaker 空で、入力欄（kind:title）が 1 つ増える', async () => {
  const { app } = await newApp();
  assert.equal(app.getTitleInfo().speaker, '');
  const f = app.getMeetingFormSpec().fields.find((x) => x.id === 'speaker');
  assert.ok(f && f.kind === 'title' && f.label);
  assert.equal(app.setTitleInfo({ speaker: '  山田太郎  ' }).ok, true);
  assert.equal(app.getTitleInfo().speaker, '山田太郎');
  assert.equal(app.setTitleInfo({ speaker: 5 }).ok, false);
});

// FR-036 AC-659 (c): SVG は右上に data-role="speaker"、空なら匿名アイコンだけ
test('FR-036 AC-659 AC-560: decorateSvg は名前があれば右半分に speaker の文字、空なら anon-icon だけ', () => {
  const withName = decorateSvg(SVG, { header: headerModel({ title: 'T', speaker: '山田<太郎>' }) });
  const m = /<text\b[^>]*data-role="speaker"[^>]*>([^<]*)<\/text>/.exec(withName);
  assert.ok(m && m[1] === '山田&lt;太郎&gt;');
  assert.ok(Number(/\bx="([\d.]+)"/.exec(m[0])[1]) > 400);
  assert.ok(!/anon-icon/.test(withName));
  const empty = decorateSvg(SVG, { header: headerModel({ title: 'T', speaker: '' }) });
  assert.ok(/data-role="anon-icon"/.test(empty) && !/data-role="speaker"/.test(empty));
  assert.equal(layoutHeader(headerModel({ title: 'T' }), 800).speaker, null);
});

// FR-036 AC-659 (c): Markdown・HTML は「登壇者」の項。空なら出さない
test('FR-036 AC-659: markdownHead・htmlHead は名前があるときだけ「登壇者」の項を出し、HTML はエスケープする', () => {
  assert.ok(markdownHead({ speaker: '山田' }).join('\n').includes('登壇者') && markdownHead({ speaker: '山田' }, 'en').join('\n').includes('Speaker'));
  assert.ok(!markdownHead({ speaker: '' }).join('\n').includes('登壇者'));
  const h = htmlHead({ speaker: '<b>x</b>' }, 'ja', esc);
  assert.ok(h.includes('登壇者') && h.includes('&lt;b&gt;') && !h.includes('<b>'));
  assert.equal(htmlHead({ speaker: '' }, 'ja', esc), '');
});

// FR-036 AC-559 AC-659 (d): 保存・復元・初期化。画像の説明には載らない
test('FR-036 AC-559 AC-659: セッションの保存物に titleInfo.speaker が入り、復元され、データの初期化で消える。説明に載らない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  app.setTitleInfo({ speaker: '山田太郎' });
  assert.ok(!app.getFigureDescription().text.includes('山田太郎'));
  assert.equal(app.getMeetingOutput().speaker, '山田太郎');
  assert.ok(app.getSaveWarnings().some((w) => w.includes('登壇者名')));
  app.setTitleInfo({ speaker: '' });
  assert.ok(!app.getSaveWarnings().some((w) => w.includes('登壇者名')));
});
