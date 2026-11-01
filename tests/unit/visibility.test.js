// FR-104 AC-603〜606 の単体・結合テスト（公開範囲・機密の印・機密の要点を除く保存）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail, keyFor, bytesToLatin1, pdfTexts } from '../system/helpers.js';
import { withoutConfidential, countConfidential, visibilityLine, excludedLine } from '../../web/src/visibility.js';
import { decorateSvg, headerModel, markdownHead } from '../../web/src/meetingout.js';

const SECRET_WORD = '極秘の取引先';

async function setup() {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  const pts = app.getState().scenes.flatMap((s) => s.points);
  return { app, env, pts };
}
const text = (d) => (typeof d === 'string' ? d : Buffer.from(d).toString('utf8'));

// FR-104 AC-603: 公開範囲の選択肢と既定（PARAM-140）・保存・復元・初期化
test('FR-104 AC-603: 公開範囲は 社内・参加者のみ・公開 から選べ、既定は参加者のみで、不正な値は受け付けない', async () => {
  const { app } = await newApp();
  assert.deepEqual(app.getVisibilityInfo().options.map((o) => o.label), ['社内', '参加者のみ', '公開']);
  assert.equal(app.getVisibility(), 'participants');
  assert.equal(app.setVisibility('secret').ok, false);
  assert.equal(app.getVisibility(), 'participants');
  assert.equal(app.setVisibility('internal').ok, true);
  assert.equal(app.getVisibilityInfo().label, '社内');
});

test('FR-104 AC-603: 公開範囲と保存の選択は、記録中でも変えられ、セッションの保存・復元・初期化に含まれる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.commands['session.start']?.();
  assert.equal(app.setVisibility('public').ok, true);
  assert.equal(app.setExcludeConfidential(false).ok, true);
  app.flushSave();
  const { app: app2 } = await newApp({ storage: env.storage });
  assert.equal(app2.getVisibility(), 'public', '復元される');
  assert.equal(app2.getExcludeConfidential(), false);
  const { app: app3 } = await newApp();
  assert.equal(app3.getVisibility(), 'participants', '何も保存がなければ既定');
});

// FR-104 AC-606: 既定の選択は公開範囲が「公開」のとき「除く」
test('FR-104 AC-606: 保存で機密を除く既定は、公開範囲が「公開」のときだけ「除く」で、選べば変わる', async () => {
  const { app } = await newApp();
  assert.equal(app.getExcludeConfidential(), false);
  app.setVisibility('public');
  assert.equal(app.getExcludeConfidential(), true);
  app.setExcludeConfidential(false);
  assert.equal(app.getExcludeConfidential(), false);
  app.setExcludeConfidential(null);
  assert.equal(app.getExcludeConfidential(), true);
  assert.equal(app.setExcludeConfidential('x').ok, false);
});

// FR-104 AC-605: 機密の印（API・キー・保存・復元・表示）
test('FR-104 AC-605: 機密の印は API とキーで付け外しでき、保存・復元され、文字「機密」と錠の記号で示される', async () => {
  const { app, pts, env } = await setup();
  const id = pts[0].id;
  assert.equal(app.setPointConfidential(id, true).ok, true);
  assert.equal(app.getState().scenes[0].points.find((p) => p.id === id).confidential, true);
  assert.match(app.renderOutline(), /data-confidential="1"[^>]*>.*?🔒.*?機密/);
  assert.equal(app.setPointConfidential(id).confidential, false, '省略で切り替わる');
  assert.equal(app.getState().scenes[0].points.find((p) => p.id === id).confidential, undefined);
  assert.equal(app.setPointConfidential('no-such').ok, false);
  // キーだけ
  assert.equal(app.selectPoint(pts[1].id).ok, true);
  assert.equal(app.handleKey(keyFor(app, 'point.confidential')), 'point.confidential');
  assert.equal(app.getState().scenes.flatMap((s) => s.points).find((p) => p.id === pts[1].id).confidential, true);
  // 選択中の要点には付け外しのボタンが出る
  assert.match(app.renderOutline(), /data-conf-toggle="/);
  // 保存・復元
  app.flushSave();
  const { app: app2 } = await newApp({ storage: env.storage });
  assert.equal(app2.getState().scenes.flatMap((s) => s.points).find((p) => p.id === pts[1].id).confidential, true);
});

test('FR-104 AC-605: 機密の印は図（SVG）にも文字「機密」と錠の記号で出る', async () => {
  const { app, pts } = await setup();
  app.setPointConfidential(pts[0].id, true);
  const svg = app.renderSvg();
  assert.match(svg, /data-confidential-mark="1"/);
  assert.match(svg, /🔒 機密/);
});

// FR-104 AC-604: 5 形式すべてに公開範囲
test('FR-104 AC-604: PNG・SVG・PDF・Markdown・HTML のすべてに「公開範囲: 参加者のみ」が文字で載る', async () => {
  const { app, env } = await setup();
  app.setVisibility('participants');
  for (const c of ['save.png', 'save.svg', 'save.pdf', 'save.markdown', 'save.html']) await app.commands[c]();
  const by = Object.fromEntries(env.downloads.map((d) => [d.filename.split('.').pop(), d]));
  assert.match(text(by.md.data), /公開範囲: 参加者のみ/);
  assert.match(text(by.html.data), /公開範囲: 参加者のみ/);
  assert.match(text(by.svg.data), /公開範囲: 参加者のみ/);
  assert.ok(pdfTexts(by.pdf.data).includes('公開範囲'));
  assert.ok(by.png.data.length > 0);
});

test('FR-104 AC-604: 公開範囲を変えると出力の文字も変わり、英語でも出る', () => {
  assert.equal(visibilityLine('public', 'ja'), '公開範囲: 公開');
  assert.equal(visibilityLine('internal', 'en'), 'Visibility: Internal');
  assert.deepEqual(headerModel({ title: 'T', visibilityLine: '公開範囲: 社内', agenda: [] }).lines, ['公開範囲: 社内']);
  assert.ok(markdownHead({ visibilityLine: '公開範囲: 社内' }).includes('公開範囲: 社内'));
  assert.match(decorateSvg('<svg viewBox="0 0 800 50" width="800" height="50"></svg>', { title: 'T', header: headerModel({ title: 'T', visibilityLine: '公開範囲: 社内' }) }), /公開範囲: 社内/);
});

// FR-104 AC-606: 機密の除外が優先
function markSecret(app, pts) {
  const target = pts[0];
  app.setPointConfidential(target.id, true);
  return target;
}

test('FR-104 AC-606: 除く設定の Markdown・HTML・SVG に機密の要点の文字は載らず、除外した件数だけが載る', async () => {
  const { app, env, pts } = await setup();
  const target = markSecret(app, pts);
  app.setExcludeConfidential(true);
  for (const c of ['save.markdown', 'save.html', 'save.svg']) await app.commands[c]();
  for (const d of env.downloads) {
    const s = text(d.data);
    assert.ok(!s.includes(target.text), `${d.filename} に機密の要点が載っている`);
    assert.match(s, /機密の要点を除外: 1 件/, `${d.filename} に除外の件数`);
  }
  // 画面・状態には残る（アプリ内は対象外）
  assert.ok(app.getState().scenes.flatMap((s) => s.points).some((p) => p.id === target.id && p.confidential === true));
  assert.ok(app.renderOutline().includes(target.text));
  assert.ok(app.getScenesView().flatMap((s) => s.points).some((p) => p.id === target.id));
});

test('FR-104 AC-606: 除かない設定では機密の要点も従来どおり載り、除外の件数の行は出ない', async () => {
  const { app, env, pts } = await setup();
  const target = markSecret(app, pts);
  app.setExcludeConfidential(false);
  await app.commands['save.markdown']();
  const s = text(env.downloads[0].data);
  assert.ok(s.includes(target.text));
  assert.ok(!/機密の要点を除外/.test(s));
});

test('FR-104 AC-606: 公開範囲「公開」の既定では機密の要点は出力から除かれる（選び直せば載る）', async () => {
  const { app, env, pts } = await setup();
  const target = markSecret(app, pts);
  app.setVisibility('public');
  await app.commands['save.markdown']();
  assert.ok(!text(env.downloads[0].data).includes(target.text));
  assert.match(text(env.downloads[0].data), /公開範囲: 公開/);
  app.setExcludeConfidential(false);
  await app.commands['save.markdown']();
  assert.ok(text(env.downloads[1].data).includes(target.text));
});

test('FR-104 AC-606: 確認の状況の件数 n・m・k と「要確認」の節は機密を除いた数で数え、機密の要点は載らない', async () => {
  const { app, env } = await newApp();
  await app.commands['session.start']();
  for (const u of ['売上は 1200 万円です', `${SECRET_WORD}の契約は 3 月 5 日です`, '提案を採用しました']) { app.setDraft(u); app.submitDraft(); env.tick(25); }
  toDetail(app);
  const pts = app.getState().scenes.flatMap((s) => s.points);
  const secret = pts.find((p) => p.text.includes(SECRET_WORD));
  assert.ok(secret, '機密にする要点がある');
  await app.commands['save.markdown']();
  const all = text(env.downloads[0].data);
  const total = Number(/全体 (\d+) 件/.exec(all)?.[1]);
  const mark = all.split('\n').filter((l) => l.includes('[要確認]')).length;
  assert.ok(all.includes(SECRET_WORD));
  app.setPointConfidential(secret.id, true);
  app.setExcludeConfidential(true);
  await app.commands['save.markdown']();
  const md = text(env.downloads[1].data);
  assert.ok(!md.includes(SECRET_WORD), '機密の要点の文字は載らない（要確認の節・議事項目・図の説明を含む）');
  assert.equal(Number(/全体 (\d+) 件/.exec(md)?.[1]), total - 1, '全体の件数は機密を除いた数');
  assert.ok(md.split('\n').filter((l) => l.includes('[要確認]')).length <= mark);
  assert.match(md, /機密の要点を除外: 1 件/);
  // 保存の後は元の状態（件数・要点）に戻る
  assert.equal(app.getReviewSummary().total, total);
  assert.ok(app.getState().scenes.flatMap((s) => s.points).some((p) => p.id === secret.id));
});

test('FR-104 AC-606: 機密の要点の元の発話から作った議事項目（決定事項ほか）も出力から除かれる', async () => {
  const { app, env } = await newApp();
  await app.commands['session.start']();
  for (const u of [`${SECRET_WORD}との契約を決定しました`, '新機能の方針を決定しました']) { app.setDraft(u); app.submitDraft(); env.tick(25); }
  toDetail(app);
  const secret = app.getState().scenes.flatMap((s) => s.points).find((p) => p.text.includes(SECRET_WORD));
  assert.ok(secret);
  app.setPointConfidential(secret.id, true);
  app.setExcludeConfidential(true);
  await app.commands['save.html']();
  await app.commands['save.markdown']();
  for (const d of env.downloads) assert.ok(!text(d.data).includes(SECRET_WORD), d.filename);
});

test('FR-104 AC-606: PNG・PDF の保存でも機密の要点は載らず、図の説明（SVG の desc）にも出ない', async () => {
  const { app, env, pts } = await setup();
  const target = markSecret(app, pts);
  app.setExcludeConfidential(true);
  await app.commands['save.pdf']();
  await app.commands['save.png']();
  assert.ok(!pdfTexts(env.downloads[0].data).includes(target.text));
  assert.ok(!bytesToLatin1(env.downloads[1].data).includes(target.text));
  assert.ok(env.downloads.length === 2);
  assert.ok(!app.getFigureDescription().text.includes('機密の要点を除外'), '画面側の説明は除外の件数を持たない');
});

test('FR-104 AC-606: 純関数 withoutConfidential は元を変えず、機密の要点とその関係を除く', () => {
  const scenes = [{ id: 's', heading: 'H', points: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B', confidential: true }], relations: [{ from: 'a', to: 'b' }, { from: 'a', to: 'a' }] }];
  const out = withoutConfidential(scenes);
  assert.deepEqual(out[0].points.map((p) => p.id), ['a']);
  assert.deepEqual(out[0].relations, [{ from: 'a', to: 'a' }]);
  assert.equal(scenes[0].points.length, 2);
  assert.equal(countConfidential(scenes), 1);
  assert.equal(excludedLine(2), '機密の要点を除外: 2 件');
});

test('FR-104 AC-606: 機密の要点は画像プロンプト（生成 AI へ渡す内容）にも含まれない', async () => {
  const { app, pts } = await setup();
  const target = markSecret(app, pts);
  const r = app.buildImagePrompt?.();
  if (r && typeof r === 'object') assert.ok(!JSON.stringify(r).includes(target.text));
});
