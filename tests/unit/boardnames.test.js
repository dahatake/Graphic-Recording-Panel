// FR-114 AC-668・AC-680（FR-022 AC-117、NFR-PRIV AC-359、AC-630）: 会議ボード型の人物に添える名前の単体・結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { parseVttCues, cueSpeaker } from '../../web/src/vtt.js';
import { boardLayout, boardSvg } from '../../web/src/board.js';
import { clipName, parseRoster, memberNames, textHash, NAME_MAX, boardNamesOutline } from '../../web/src/boardnames.js';

const VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v 山田太郎>画面の色について話しました</v>\n\n00:00:02.500 --> 00:00:03.000\n<v.loud 佐藤花子>文字の大きさも話しました</v>\n\n00:00:03.200 --> 00:00:03.500\n説明の順番も話しました\n';
const file = (text) => ({ name: 'm.vtt', type: 'text/vtt', size: Buffer.byteLength(text), text });
const allNames = (m) => m.sections.flatMap((s) => s.elements).filter((e) => e.name).map((e) => e.name);
const storageDump = (st) => JSON.stringify([...Array(st.length).keys()].map((i) => [st.key(i), st.getItem(st.key(i))]));

// AC-668 (a)(c): 話者タグの名前は本文から除き、speaker として別に返す。名前は PARAM-165 文字以内・文字だけ
test('FR-022 AC-668: parseVttCues は cue の話者タグ（<v 名前>・<v.class 名前>）を speaker として返し、本文に含めない', () => {
  const cues = parseVttCues(VTT);
  assert.deepEqual(cues.map((c) => c.text), ['画面の色について話しました', '文字の大きさも話しました', '説明の順番も話しました']);
  assert.deepEqual(cues.map((c) => c.speaker ?? null), ['山田太郎', '佐藤花子', null]);
  assert.equal(cueSpeaker(['<v A &amp; B>x</v>']), 'A & B');
  assert.equal(cueSpeaker(['<c>x</c>']), null);
});

test('FR-114 AC-668 (b)(c): 名簿は 1 行に 1 名・空と重複を除き入力順、名前は PARAM-165 文字に切り詰め、並びは名簿→名簿にない話者タグ（最初に現れた順）', () => {
  assert.deepEqual(parseRoster(' 鈴木 \n\n田中\r\n鈴木\n'), ['鈴木', '田中']);
  assert.deepEqual(parseRoster(['A', ' B ', '']), ['A', 'B']);
  assert.equal([...clipName('あ'.repeat(40))].length, NAME_MAX);
  assert.equal(clipName('a\u0000<b>\n c'), 'a <b> c');
  assert.deepEqual(memberNames(['鈴木', '山田太郎'], [null, '佐藤花子', '山田太郎', '佐藤花子']), ['鈴木', '山田太郎', '佐藤花子']);
  assert.notEqual(textHash('a'), textHash('b'));
});

// AC-668 (b)(c)・AC-630: 配置（純関数）。名前がないときは従来どおり。人物の絵記号の選び方は名前と結びつかない
test('FR-114 AC-668 AC-630: boardLayout は名前を参加メンバーの人物と名前の組、各ステップの最初の発話の話者タグの名前で添え、名前がなければ従来どおり', () => {
  const scenes = [{ id: 's1', status: 'confirmed', points: [{ id: 'p1', text: '画面の色について話しました', uid: 'u1' }, { id: 'p2', text: '文字の大きさも話しました', uid: 'u2' }] }];
  const input = { scenes, topics: [], lang: 'ja' };
  const plain = boardLayout(input).board;
  assert.deepEqual(allNames(plain), []);
  assert.equal(plain.sections.find((s) => s.id === 'members').elements.length, 0);
  const speakerOf = (uid) => ({ u1: '山田太郎' }[uid] ?? null);
  const a = boardLayout(input, { names: { members: ['鈴木', '山田太郎'], speakerOf } }).board;
  const mem = a.sections.find((s) => s.id === 'members').elements;
  assert.deepEqual(mem.map((e) => [e.part, e.name]), [['person', '鈴木'], ['person', '山田太郎']]);
  const flowPerson = a.sections.find((s) => s.id === 'flow').elements.find((e) => e.part === 'person');
  assert.equal(flowPerson.name, '山田太郎');
  assert.equal(flowPerson.firstPointId, 'p1');
  const svg = boardSvg({ board: a, canvas: a.canvas }, {});
  assert.match(svg, /data-board-name[^>]*>鈴木</);
  assert.match(svg, /data-board-name[^>]*>山田太郎</);
  // AC-630: 名前を変えても人物の絵記号の種（seed）は同じ
  const b = boardLayout(input, { names: { members: ['別人A', '別人B'], speakerOf: () => '別人C' } }).board;
  const seeds = (m) => m.sections.flatMap((s) => s.elements).filter((e) => e.part === 'person').map((e) => e.seed);
  assert.deepEqual(seeds(b), seeds(a));
  // 話者タグのない発話（手入力など）には名簿の名前を結びつけない
  const c = boardLayout(input, { names: { members: ['鈴木'], speakerOf: () => null } }).board;
  assert.equal(c.sections.find((s) => s.id === 'flow').elements.find((e) => e.part === 'person').name, undefined);
  // 名前は文字として escape される
  const d = boardLayout(input, { names: { members: ['<script>'], speakerOf: () => null } }).board;
  assert.ok(!boardSvg({ board: d, canvas: d.canvas }, {}).includes('<script>'));
});

test('FR-114 AC-668 (d): テキスト一覧に「参加メンバー: 名前、…」の 1 行と、ステップの最初の要点の行に「（発言: 名前）」を足す', () => {
  const board = { sections: [{ elements: [{ part: 'person', member: true, name: 'A' }, { part: 'person', member: true, name: 'B' }] }, { elements: [{ part: 'person', speaker: true, name: '山田', firstPointId: 'p1' }] }] };
  const html = boardNamesOutline('<ol><li data-point-id="p1" tabindex="0">x</li><li data-point-id="p2" tabindex="0">y</li></ol>', board, { members: '参加メンバー', said: '発言' });
  assert.match(html, /^<p class="outline-members" data-board-members>参加メンバー: A、B<\/p>/);
  assert.match(html, /<li data-point-id="p1" tabindex="0">x <span class="outline-speaker" data-speaker-of="p1">（発言: 山田）<\/span><\/li><li data-point-id="p2" tabindex="0">y<\/li>/);
});

// AC-668・AC-680・AC-117・AC-359: 結合（アプリ全体）
test('FR-114 AC-668 AC-680 AC-117 AC-359: 名簿と .vtt の話者タグの名前が会議ボードの図・テキスト一覧・SVG に載り、セッションファイルには載らず、「名前を表示しない」で消え、初期化で名前が消える', async () => {
  const { app, env, createApp } = await newApp();
  app.setLayoutTypes(['board']);
  assert.equal(app.getShowNames(), true, 'AC-680: 既定は表示');
  assert.deepEqual(app.setTitleInfo({ participants: '鈴木一郎\n田中次郎' }), { ok: true });
  assert.deepEqual(app.getParticipants(), ['鈴木一郎', '田中次郎']);
  assert.equal(app.getMeetingFormValues().participants, '鈴木一郎\n田中次郎');
  assert.equal('participants' in app.getTitleInfo(), false, 'タイトル情報（セッションファイルに入る）には含めない');
  const r = await app.importTextFile(file(VTT));
  assert.equal(r.ok, true);
  const m = app.getBoardModel();
  assert.deepEqual(m.sections.find((s) => s.id === 'members').elements.filter((e) => e.member).map((e) => e.name), ['鈴木一郎', '田中次郎', '山田太郎', '佐藤花子']);
  const svg = app.renderSvg();
  for (const n of ['鈴木一郎', '田中次郎', '山田太郎', '佐藤花子']) assert.ok(svg.includes(n), n);
  const outline = app.renderOutline();
  assert.match(outline, /参加メンバー: 鈴木一郎、田中次郎、山田太郎、佐藤花子/);
  assert.match(outline, /（発言: 山田太郎）/);
  // 認識文字列（発話）には名前が入らない
  assert.ok(!JSON.stringify(app.getState().utterances).includes('山田太郎'));
  // PNG・SVG・PDF は図をそのまま書き出す（SVG で確認）
  await app.commands['save.svg']();
  assert.ok(env.downloads.at(-1).data.includes('山田太郎'));
  // セッションファイル（FR-019）・grp.session（FR-012 の発話の保存）には載らない
  await app.commands['file.save']();
  const sess = env.downloads.at(-1).data;
  assert.ok(!sess.includes('山田太郎') && !sess.includes('鈴木一郎'));
  app.flushSave?.();
  assert.ok(!String(env.storage.getItem('grp.session')).includes('山田太郎'));
  // AC-359: 簡易マスキングの対象語に名簿と話者タグの名前が加わる
  assert.ok(!app.applyLlmMask('山田太郎と鈴木一郎の案').includes('山田太郎'));
  assert.ok(!app.applyLlmMask('山田太郎と鈴木一郎の案').includes('鈴木一郎'));
  // 再読込後も保たれる（ブラウザ内の保存）
  const app2 = await createApp(env.options);
  app2.setLayoutTypes(['board']);
  assert.ok(app2.renderSvg().includes('山田太郎'));
  // AC-680: 名前を表示しない → 図・テキスト一覧・書き出しのどれにも出ない。名簿と話者タグは消えない
  assert.deepEqual(app.setShowNames(false), { ok: true, show: false });
  const hidden = app.renderSvg();
  for (const n of ['鈴木一郎', '山田太郎', '佐藤花子']) assert.ok(!hidden.includes(n), n);
  assert.ok(!app.renderOutline().includes('山田太郎') && !app.renderOutline().includes('鈴木一郎'));
  await app.commands['save.svg']();
  assert.ok(!env.downloads.at(-1).data.includes('山田太郎'));
  assert.deepEqual(app.getParticipants(), ['鈴木一郎', '田中次郎']);
  assert.equal(app.getSettingsField?.('names.hide') ?? app.getHideNames(), true);
  const app3 = await createApp(env.options);
  assert.equal(app3.getShowNames(), false, '端末ごとの設定として保たれる');
  assert.equal(app.setShowNames('x').ok, false);
  app.setShowNames(true);
  assert.ok(app.renderSvg().includes('山田太郎'));
  // データの初期化（FR-018）で名前は消え、「名前を表示しない」は変わらない
  app.setShowNames(false);
  app.commands['data.reset'](); await app.dialogAction('confirm');
  assert.deepEqual(app.getParticipants(), []);
  assert.ok(!storageDump(env.storage).includes('山田太郎') && !storageDump(env.storage).includes('鈴木一郎'));
  assert.equal(app.getShowNames(), false);
});

test('FR-114 AC-668 (c): 手入力の発話のステップには名前を添えず、名簿の名前を発話に結びつけない', async () => {
  const { app, env } = await newApp();
  app.setLayoutTypes(['board']);
  app.setTitleInfo({ participants: ['鈴木一郎'] });
  app.commands['session.start']();
  app.setDraft('画面の色について話しました'); app.submitDraft(); env.tick(1);
  const m = app.getBoardModel();
  assert.equal(m.sections.find((s) => s.id === 'flow').elements.find((e) => e.part === 'person').name, undefined);
  assert.ok(!app.renderOutline().includes('（発言'));
  assert.match(app.renderOutline(), /参加メンバー: 鈴木一郎/);
  // 会議ボード以外の型では、テキスト一覧に名前を足さない
  app.setLayoutTypes(['timeline']);
  assert.ok(!app.renderOutline().includes('鈴木一郎'));
});

test('FR-022 AC-671 AC-668: 再生取込でも話者タグの名前が保持される', async () => {
  const { app, env } = await newApp();
  app.setLayoutTypes(['board']);
  assert.ok(app.setVttImportMode({ mode: 'replay', speed: app.getVttImportMode().speeds.at(-1) }).ok);
  const r = await app.importTextFile(file(VTT));
  assert.equal(r.ok, true);
  for (let i = 0; i < 20 && app.getVttReplay()?.running; i++) { env.tick(5); env.scheduler.advance(5000); }
  assert.equal(app.getVttReplay().running, false);
  assert.deepEqual(app.getPersonNames(), ['山田太郎', '佐藤花子']);
});
