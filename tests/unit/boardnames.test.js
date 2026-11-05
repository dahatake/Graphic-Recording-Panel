// FR-114 AC-668・AC-680（FR-022 AC-117、NFR-PRIV AC-359、AC-630）: 会議ボード型の人物に添える名前の単体・結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { parseVttCues, cueSpeaker } from '../../web/src/vtt.js';
import { boardLayout, boardSvg } from '../../web/src/board.js';
import { clipName, parseRoster, parseRosterDetail, memberNames, textHash, NAME_MAX, boardNamesOutline, maskNames } from '../../web/src/boardnames.js';

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

test('FR-114 AC-668 (b)(c): 名簿は 1 行に 1 名・空と重複を除き入力順、名前は PARAM-197（20）文字に切り詰め、並びは名簿→名簿にない話者タグ（最初に現れた順）', () => {
  assert.deepEqual(parseRoster(' 鈴木 \n\n田中\r\n鈴木\n'), ['鈴木', '田中']);
  assert.deepEqual(parseRoster(['A', ' B ', '']), ['A', 'B']);
  assert.equal(NAME_MAX, 20);
  assert.equal([...clipName('あ'.repeat(40))].length, NAME_MAX);
  assert.equal(clipName('あ'.repeat(40)), `${'あ'.repeat(19)}…`);
  assert.equal(clipName('あ'.repeat(20)), 'あ'.repeat(20));
  assert.equal(clipName('a\u0000<b>\n c'), 'a <b> c');
  assert.deepEqual(memberNames(['鈴木', '山田太郎'], [null, '佐藤花子', '山田太郎', '佐藤花子']), ['鈴木', '山田太郎', '佐藤花子']);
  assert.notEqual(textHash('a'), textHash('b'));
});

// AC-681 (a)(b): 長さ → 重複の除去（切り詰め後の文字列）→ 件数（PARAM-196 = 20）の順
test('FR-114 AC-681 (a)(b): 名簿は 20 名まで・上限を超えた行は取り込まず over を立て、重複は切り詰め後の文字列で 1 名と数え、全文を別に返す', () => {
  const n = (i) => `N${String(i).padStart(2, '0')}`;
  const d20 = parseRosterDetail(Array.from({ length: 20 }, (_, i) => n(i)));
  assert.equal(d20.names.length, 20); assert.equal(d20.over, false);
  const d25 = parseRosterDetail(Array.from({ length: 25 }, (_, i) => n(i)).join('\n'));
  assert.deepEqual(d25.names, Array.from({ length: 20 }, (_, i) => n(i))); assert.equal(d25.over, true);
  assert.equal(parseRosterDetail([...Array.from({ length: 20 }, (_, i) => n(i)), n(3)]).over, false, '重複は件数に数えない');
  // 先頭 19 文字が同じ別の名前は、切り詰め後に同じ文字列なので 1 名（全文は先に現れたほう）
  const p = 'あ'.repeat(19); const d = parseRosterDetail([`${p}いい`, `${p}うう`, '短い']);
  assert.deepEqual(d.names, [`${p}…`, '短い']); assert.deepEqual(d.fulls, [`${p}いい`, '短い']);
});

// AC-681 (b)・AC-668 (g)・(h): アプリ結合
test('FR-114 AC-681 AC-668 (g)(h): 名簿の上限の理由（上限で落としたときだけ notice）・名簿は「名前を隠す」で消えない・話者タグも 20 名まで・担当の列の名前は隠す・伏せ字は全文を使う', async () => {
  const { app } = await newApp();
  const names = (k) => Array.from({ length: k }, (_, i) => `名簿${String(i + 1).padStart(2, '0')}`);
  assert.equal(app.getMeetingFormSpec().fields.find((f) => f.id === 'participants').label, '参加者名簿');
  assert.equal(app.setTitleInfo({ participants: names(20).join('\n') }).notice, undefined);
  const r = app.setTitleInfo({ participants: names(21).join('\n') });
  assert.equal(r.notice.text, '参加者は 20 名までです'); assert.equal(r.notice.role, 'status');
  assert.equal(app.getParticipants().length, 20);
  app.setLang('en'); assert.equal(app.setTitleInfo({ participants: names(21).join('\n') }).notice.text, 'Up to 20 participants'); app.setLang('ja');
  assert.equal(app.setHideNames(true).ok, true);
  assert.equal(app.getParticipants().length, 20, '名前を隠すでも名簿は消えない');
  // 伏せ字の辞書は切り詰める前の全文（と切り詰めた形）
  const long = 'あ'.repeat(25);
  app.setTitleInfo({ participants: long });
  assert.equal(app.maskPersonNames(`${long}と${'あ'.repeat(19)}…が来た`), '●●●と●●●が来た');
});

test('FR-114 AC-668 (g): .vtt の話者タグの名前の保持は 20 名まで（超えた分の発話は名前なし）・同じ名前は 1 名・先頭 19 文字が同じ名前は 1 名', async () => {
  const { app } = await newApp();
  const cues = Array.from({ length: 23 }, (_, i) => `00:00:${String(i).padStart(2, '0')}.000 --> 00:00:${String(i).padStart(2, '0')}.500\n<v S${String(i).padStart(2, '0')}>話者${i}の発言を足します</v>`);
  const vtt = `WEBVTT\n\n${cues.join('\n\n')}\n\n00:00:30.000 --> 00:00:30.500\n<v S00>もう一度の発言です</v>\n`;
  assert.equal((await app.importTextFile(file(vtt))).ok, true);
  const named = app.getPersonNames();
  assert.equal(named.length, 20, `話者タグの名前は 20 名まで（${named.length}）`);
  assert.ok(named.includes('S00') && !named.includes('S20'));
});

// AC-668 (b)(c)・AC-630: 配置（純関数）。名前がないときは従来どおり。人物の絵記号の選び方は名前と結びつかない
// AC-668 (c)・AC-666: 続きのステップの名前は最初のステップと同じ。AC-668 (h)・AC-665: 担当の列の名前は「名前を隠す」で伏せる
test('FR-114 AC-668 (c) AC-666: PARAM-088 を超えて分けた続きのステップは分ける前と同じ名前を添える（続きの最初の要点の話者では決め直さない）', () => {
  const points = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, text: `alpha beta item${i} word${i}`, uid: `u${i}` }));
  const input = { scenes: [{ id: 's1', status: 'confirmed', points }], topics: [], lang: 'ja' };
  const speakerOf = (uid) => ({ u0: '山田太郎', u7: '佐藤花子' }[uid] ?? null);
  const b = boardLayout(input, { names: { members: ['山田太郎', '佐藤花子'], speakerOf } }).board;
  const steps = b.sections.find((s) => s.id === 'flow').elements.filter((e) => e.speaker || e.part === 'bubble' || e.name);
  const named = b.sections.find((s) => s.id === 'flow').elements.filter((e) => e.speaker).map((e) => e.name);
  assert.deepEqual(named, ['山田太郎', '山田太郎'], `続きのステップも同じ名前（${JSON.stringify(named)} / ${steps.length}）`);
});

test('FR-114 AC-668 (h) AC-665: 次アクションの担当の列が名簿・話者タグの名前と一致するとき、名前を隠すのオンでは「未定」と同じ扱い（一致しない文字は変えない）', () => {
  const pts = [{ id: 'p1', text: '資料は田中さんが担当して来週までに作成する', uid: 'u1' }, { id: 'p2', text: '見積は鈴木さんが担当して来週までに作成する', uid: 'u2' }];
  const input = { scenes: [{ id: 's1', status: 'confirmed', points: pts }], topics: [], lang: 'ja' };
  const owners = (names) => boardLayout(input, { names }).board.sections.find((s) => s.id === 'actions').elements.flatMap((e) => e.rows ?? []).map((r) => r.owner);
  assert.deepEqual(owners({ members: ['田中'], speakerOf: () => null }), ['田中', '鈴木'], '表示のときは変えない');
  assert.deepEqual(owners({ members: ['田中'], speakerOf: () => null, anonymous: true, matchWords: ['田中'] }), [null, '鈴木'], '一致する名前だけ伏せる（null は「未定」と同じ扱い）');
});

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
  assert.match(html, /^<p class="outline-members" data-board-members>\n参加メンバー: A、B\n<\/p>\n/); // AC-529: 行単位で Markdown と比べられる 1 行
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
  assert.equal(app.getTitleInfo().participants, '鈴木一郎\n田中次郎', '契約: getTitleInfo().participants は入力した文字列（セッションファイルには入れない。下で確認）');
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
  assert.equal(app.getHideNames(), true);
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

// 決定 2026-11-05（最終監査）(1): 名前は簡易マスキングの設定に関わらず LLM へ送る前に必ず伏せる（AC-358・AC-359・AC-668 (e)）
test('FR-114 AC-358 AC-668: maskNames は長い名前から伏せ字にし、名前のない文字は変えない', () => {
  assert.equal(maskNames('山田太郎と山田が話す', ['山田', '山田太郎']), '●●●と●●●が話す');
  assert.equal(maskNames('名前なし', []), '名前なし');
  assert.equal(maskNames('a.b*c', ['.b*']), 'a●●●c');
});

const llmRelay = (calls) => async ({ method = 'GET', path: p, body }) => {
  calls.push({ method, path: p, body });
  if (p === '/api/llm/status') return { status: 200, body: { configured: { endpoint: true, deployment: true, credential: true }, endpointHost: 'foundry.example.test' } };
  if (p === '/api/llm/extract') return { status: 200, body: { objects: [], people: [], emotions: [], metaphors: [] } };
  return { status: 200, body: {} };
};
test('FR-114 AC-358 AC-668 (e): 簡易マスキングを無効にしても、参加者名簿と話者タグの名前は LLM への送信の前に伏せる', async () => {
  const calls = [];
  const { app, env } = await newApp({ options: { relay: llmRelay(calls) } });
  app.setLayoutTypes(['board']);
  app.setTitleInfo({ participants: '鈴木一郎' });
  app.commands['session.start']();
  assert.equal((await app.importTextFile(file(VTT))).ok, true);
  assert.equal((await app.requestLlmEnable()).ok, true); await app.answerLlmConsent(true);
  app.setLlmMasking(false);
  app.setDraft('鈴木一郎と山田太郎の案を比べました'); app.submitDraft(); env.tick(1);
  await app.flushLlm();
  const sent = calls.filter((c) => c.path === '/api/llm/extract');
  assert.ok(sent.length >= 1, 'LLM への送信が行われた');
  const body = JSON.stringify(sent);
  for (const n of ['鈴木一郎', '山田太郎', '佐藤花子']) assert.ok(!body.includes(n), `送信に「${n}」を含まない`);
  assert.ok(body.includes('●●●'), '名前は伏せ字になる');
});

// 決定 (2): 画像生成プロンプト（FR-078）には名前を常に含めない（伏せ字の選択によらない）
test('FR-078 AC-420 AC-668 (e): 画像生成プロンプトには参加者名簿と話者タグの名前を含めない（伏せ字の選択がオフでも）', async () => {
  const { app, env } = await newApp();
  app.setLayoutTypes(['board']);
  app.setTitleInfo({ participants: '鈴木一郎' });
  app.commands['session.start']();
  assert.equal((await app.importTextFile(file(VTT))).ok, true);
  app.setDraft('鈴木一郎と山田太郎の案を比べました'); app.submitDraft(); env.tick(1);
  for (const mask of [false, true]) {
    const text = app.getImagePrompt({ mask }).text;
    for (const n of ['鈴木一郎', '山田太郎']) assert.ok(!text.includes(n), `mask=${mask}: 「${n}」を含まない`);
    assert.ok(text.includes('案を比べました'), `mask=${mask}: 名前以外の要点の文字は残る`);
  }
});

// 決定 (3): Markdown の保存はテキスト一覧と一致（名前を表示するときは載り、名前を隠すときは載らない）
test('FR-114 AC-668 (d) AC-680: Markdown の保存はテキスト一覧と同じ名前を載せ、名前を隠すときは載せない', async () => {
  const { app, env } = await newApp();
  app.setLayoutTypes(['board']);
  app.setTitleInfo({ participants: '鈴木一郎' });
  app.commands['session.start']();
  assert.equal((await app.importTextFile(file(VTT))).ok, true);
  assert.equal(app.setDetailLevel('detail').ok ?? true, true); // Markdown は詳細度に従う（要点の行は「詳細」で出る）
  const md = async () => { await app.commands['save.markdown'](); return String(env.downloads.at(-1).data); };
  const shown = await md();
  assert.match(app.renderOutline(), /参加メンバー: 鈴木一郎、山田太郎、佐藤花子/);
  assert.match(shown, /\n参加メンバー: 鈴木一郎、山田太郎、佐藤花子\n/);
  assert.match(shown, /\n- 画面の色について話しました （発言: 山田太郎）\n/); // AC-529: 冒頭の「- 要点 （発言: 名前）」の行
  // AC-529: 名前の行はテキスト一覧の行と同じ文字（行単位）で、「（発言: 名前）」は一覧と同じ順・同じ数（要点の行への添え書きはしない）
  const memberLine = (s) => s.split(/\r?\n/).map((l) => l.replace(/^[\s>*\-#]+/, '').trim()).find((l) => /^参加メンバー\s*[:：]/.test(l)) ?? null;
  const said = (s) => [...s.matchAll(/[（(]発言\s*[:：]\s*([^）)]+)[）)]/g)].map((m) => m[1].trim());
  assert.equal(memberLine(shown), memberLine(app.renderOutline()));
  assert.deepEqual(said(shown), said(app.renderOutline()));
  assert.equal(app.setDetailLevel('major').ok ?? true, true); // 詳細度によらず載る
  const brief = await md();
  assert.equal(memberLine(brief), memberLine(app.renderOutline()));
  assert.deepEqual(said(brief), said(app.renderOutline()));
  app.setDetailLevel('detail');
  assert.equal(app.setHideNames(true).ok, true);
  const hidden = await md();
  for (const n of ['鈴木一郎', '山田太郎', '佐藤花子']) { assert.ok(!hidden.includes(n), `隠す: Markdown に「${n}」なし`); assert.ok(!app.renderOutline().includes(n)); }
  // 会議ボード以外の型ではテキスト一覧にも Markdown にも名前は載らない
  app.setHideNames(false); app.setLayoutTypes(['timeline']);
  assert.ok(!(await md()).includes('山田太郎'));
});
// AC-680: ラベルは ja「名前を隠す」/ en "Hide names"、説明は「名前を表示しない」（PARAM-011 以内）
test('FR-114 AC-680: ［設定］の項目ラベルとツールチップ', async () => {
  const { app } = await newApp();
  const l = app.getBoardNamesLabels();
  assert.equal(l.hide, '名前を隠す');
  assert.equal(l.hideTip, '名前を表示しない');
  assert.ok([...l.hide].length <= 20);
  app.setLang?.('en');
  if (app.setLang) assert.equal(app.getBoardNamesLabels().hide, 'Hide names');
});
