// FR-114 AC-664 AC-665 AC-666（unit・integration）/ FR-027 AC-139 AC-141 / FR-028 AC-142: 会議ボード型の配置・振り分け・部品・SVG の単体・結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, keyFor } from '../system/helpers.js';
import { assignSection, actionFields, boardLayout, boardSvg, boardColors, partKindsOf, normalizeSection, SECTIONS, SECTION_IDS, PART_KINDS, LABEL_MAX, GROUP_MAX, MOVE_MS, createBoardMotion } from '../../web/src/board.js';
import { parseSections } from '../../web/src/llmdraw.js';
import { selectLayoutTypes } from '../../web/src/autolayout.js';
import { createDrawStyleRegistry } from '../../web/src/drawstyles.js';
import { contrastRatio, boardFrameLook } from '../../web/src/stylepresets.js';
import { LAYOUT_TYPE_IDS, LAYOUT_TYPE_META } from '../../web/src/layouttypes.js';

const sec = (text, llm) => assignSection({ text }, { llm }).section;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r, o) => r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;
const weight = (s) => [...s].reduce((n, ch) => n + (ch.codePointAt(0) >= 0x2e80 ? 1 : 0.5), 0);

// 「TeamA との会議」を模した要点（トピック 4 つ・決定・未決・テーマ・目指す姿・次アクション・補足）
const MEETING = [
  ['今日の目的は新サービスの方向性をそろえることです', '背景として既存顧客の解約が増えています'],
  ['参加は営業の佐藤さん、開発の田中さん、デザイナーの鈴木さん'],
  ['まず市場の状況を整理しました'],
  ['次に顧客インタビューの結果を共有しました'],
  ['料金プランは月額制で合意しました', '初回リリースの範囲を確定'],
  ['価格の上限は保留', 'サポート体制はどうしますか？'],
  ['主要な論点は使いやすさと価格', 'もう一つのテーマは導入のしやすさ'],
  ['最終的には業界で一番使われるサービスを目指す'],
  ['来週の金曜日までに田中さんが見積を共有します', '画面案は鈴木担当でお願いします'],
  ['ちなみに競合は秋に新製品を出すそうです'],
  ['最後に全体の流れを振り返りました'],
];
const scenesOf = (groups) => groups.map((texts, i) => ({ id: `s${i + 1}`, heading: texts[0], status: 'confirmed', points: texts.map((t, j) => ({ id: `s${i + 1}p${j}`, text: t, uid: `u${i + 1}_${j}` })) }));
const TOPICS = [{ id: 't1', title: '導入', sceneIds: ['s1', 's2'] }, { id: 't2', title: '調査', sceneIds: ['s3', 's4'] }, { id: 't3', title: '結論', sceneIds: ['s5', 's6', 's7', 's8', 's9'] }, { id: 't4', title: '振り返り', sceneIds: ['s10', 's11'] }];
const allEls = (L) => L.board.sections.flatMap((s) => s.elements.map((el) => ({ ...el, frame: s.frame })));

// FR-114 AC-665: 振り分けの順（決定的・ちょうど 1 つの区画）
test('FR-114 AC-665: 要点は (2) 結論・決定の語→決定事項、(3) 行動→次アクション、(4) 未決定・質問→未決事項、(5) 区画の言い回し、(6) 根拠→メモ、(7) それ以外→議論の流れ', () => {
  assert.equal(sec('料金プランは月額制で合意しました'), 'decisions');
  assert.equal(sec('初回リリースの範囲を確定'), 'decisions');
  assert.equal(sec('来週の金曜日までに見積を共有します'), 'actions');
  assert.equal(sec('画面案は鈴木担当'), 'actions');
  assert.equal(sec('価格の上限は保留'), 'open');
  assert.equal(sec('サポート体制はどうしますか？'), 'open');
  assert.equal(sec('今日の目的は方向性をそろえること'), 'purpose');
  assert.equal(sec('業界で一番のサービスを目指す'), 'vision');
  assert.equal(sec('営業と開発のメンバー'), 'members');
  assert.equal(sec('主要な論点は使いやすさ'), 'themes');
  assert.equal(sec('ちなみに競合は秋に新製品'), 'memo');
  assert.equal(sec('なぜなら顧客の声が多いから'), 'memo');
  assert.equal(sec('市場の状況を整理'), 'flow');
  // 英語の区画の言い回しは単語単位（purposely は purpose に一致しない）
  assert.equal(sec('the background of this project'), 'purpose');
  assert.notEqual(sec('purposely left blank'), 'purpose');
  // 順の優先: 決定の語は区画の言い回しより先（「目的」を含んでも合意なら決定事項）
  assert.equal(sec('目的について合意しました'), 'decisions');
  for (const g of MEETING) for (const t of g) { assert.ok(SECTION_IDS.includes(sec(t))); assert.equal(sec(t), sec(t), '決定的'); }
});

// FR-114 AC-665 (1)（監査 S-01）: LLM の区画の指定が最優先。不正な指定は無視して規則で決める
test('FR-114 AC-665: LLM の応答の区画の指定（id・日英の区画名）が最優先で、不正な指定は無視して規則で振り分ける', () => {
  assert.equal(sec('市場の状況を整理', { section: 'vision' }), 'vision');
  assert.equal(sec('市場の状況を整理', { section: '決定事項' }), 'decisions');
  assert.equal(sec('市場の状況を整理', { section: 'Next actions' }), 'actions');
  for (const bad of ['nosuch', '', 3, null, '<script>', ['flow']]) assert.equal(sec('価格の上限は保留', { section: bad }), 'open', String(bad));
  assert.equal(normalizeSection(' memo '), 'memo');
  // 応答の sections: 形式に合う項目だけを使い、範囲外・重複・不正な区画は無視する
  const body = { objects: [], sections: [{ point: 1, section: 'decisions', emphasis: '<b>合意</b>' }, { point: 1, section: 'memo' }, { point: 2, section: 'x' }, { point: 9, section: 'flow' }, { point: 0, section: 'flow' }, 'bad', { point: 1.5, section: 'flow' }] };
  const m = parseSections(body, 3);
  assert.deepEqual([...m.keys()], [0]);
  assert.equal(m.get(0).section, 'decisions');
  assert.ok(!/[<>]/.test(m.get(0).emphasis[0]), '文字としてだけ扱う');
  assert.equal(parseSections({ objects: [] }, 3).size, 0, '区画の指定のない応答も有効（何も足さない）');
  assert.equal(parseSections({ output_text: JSON.stringify({ objects: [], sections: [{ point: 2, section: 'themes' }] }) }, 3).get(1).section, 'themes');
});

// FR-114 AC-665: ラベル・強調語・担当と期限
test('FR-114 AC-665: ラベルは PARAM-165 以内、強調語（区画の言い回し・決定・行動の語）にマーカーか下線、担当・期限は文字から取り、なければ未定', () => {
  const a = assignSection({ text: '料金プランは月額制で合意しました' });
  assert.ok(a.emphasis.includes('合意'));
  assert.deepEqual(actionFields('来週の金曜日までに田中さんが見積を共有します'), { owner: '田中', due: '来週の金曜日' });
  assert.deepEqual(actionFields('画面案は鈴木担当でお願いします'), { owner: '鈴木', due: null });
  assert.deepEqual(actionFields('資料を確認します'), { owner: null, due: null });
  const long = 'あ'.repeat(60) + 'までに対応します';
  const L = boardLayout({ scenes: scenesOf([[long], ...MEETING]), topics: [], lang: 'ja' });
  for (const el of allEls(L)) {
    for (const t of [el.text, el.full, ...(el.lines ?? []).map((l) => l.full), ...(el.rows ?? []).map((r) => r.full)]) if (t != null) assert.ok([...t].length <= LABEL_MAX, t);
  }
  const table = allEls(L).find((e) => e.part === 'table');
  const rowOf = (s) => table.rows.find((r) => r.full.startsWith(s));
  assert.equal(rowOf('来週').owner, '田中'); assert.equal(rowOf('来週').due, '来週の金曜日');
  assert.equal(rowOf('画面案').due, null);
  const svg = boardSvg(L, {});
  assert.ok(/data-board-part="emphasis"/.test(svg));
  assert.ok(svg.includes('未定'), '期限のない行は「未定」で、自動で補わない');
});

// FR-114 AC-664: 発話 0 件でも骨格（タイトル帯・9 区画の枠と見出し。区画ごとに異なる絵記号・日英）が重ならずに描かれる
test('FR-114 AC-664: 発話 0 件で 9 つの区画の枠と見出しが重ならずに描かれ、タイトル帯は入力した項目だけを出す', () => {
  for (const lang of ['ja', 'en']) {
    const L = boardLayout({ scenes: [], topics: [], lang, titleInfo: { theme: 'TeamA との会議', series: '', date: '2026-11-04', venue: '' } });
    const ss = L.board.sections;
    assert.deepEqual(ss.map((s) => s.id).sort(), [...SECTION_IDS].sort());
    assert.equal(new Set(ss.map((s) => s.icon)).size, 9, '区画ごとに異なる絵記号');
    assert.deepEqual(ss.map((s) => s.name), ss.map((s) => SECTIONS.find((d) => d.id === s.id)[lang]));
    for (let i = 0; i < ss.length; i++) {
      assert.ok(inside(ss[i].frame, { x: 0, y: 0, w: L.canvas.w, h: L.canvas.h }));
      for (let j = i + 1; j < ss.length; j++) assert.ok(!overlap(ss[i].frame, ss[j].frame), `${ss[i].id} と ${ss[j].id}`);
      assert.ok(!overlap(L.board.band, ss[i].frame));
    }
    const svg = boardSvg(L, {});
    assert.equal((svg.match(/data-board-section=/g) || []).length, 9);
    assert.deepEqual(partKindsOf(svg).sort(), ['frame', 'title'], '要点のない区画には部品が現れない');
    assert.ok(svg.includes('TeamA との会議') && svg.includes('2026-11-04'));
  }
  const none = boardLayout({ scenes: [], topics: [], lang: 'ja', titleInfo: { theme: '', series: '', date: '', venue: '' } });
  assert.equal(none.board.band, null, '未入力ならタイトル帯の項目は出さない');
  assert.ok(!partKindsOf(boardSvg(none, {})).includes('title'));
});

// FR-114 AC-666: 区画ごとの部品・11 種類・要素は重ならず区画の枠からはみ出さない
test('FR-114 AC-666: 区画ごとに決まった部品で描かれ、会議の例では 11 種類の部品が現れ、要素は重ならず自分の区画の枠に収まる', () => {
  const L = boardLayout({ scenes: scenesOf(MEETING), topics: TOPICS, lang: 'ja', titleInfo: { theme: 'TeamA との会議', series: '新サービス検討', date: '2026-11-04' } });
  const by = Object.fromEntries(L.board.sections.map((s) => [s.id, s]));
  const parts = (id) => new Set(by[id].elements.map((e) => e.part));
  assert.ok(['badge', 'bubble', 'person', 'arrow'].every((p) => parts('flow').has(p)), '議論の流れ: 番号バッジ・吹き出し・人物・矢印');
  assert.deepEqual([...parts('decisions')], ['check']);
  assert.deepEqual([...parts('open')], ['question']);
  assert.deepEqual([...parts('actions')], ['table']);
  assert.ok(parts('themes').has('icon') && parts('themes').has('arrow'), '主要テーマ: 絵記号付きの項目と矢印');
  assert.ok(parts('vision').has('arrow') && parts('vision').has('person'), '目指す姿: 現状→目指す姿の矢印と人物');
  assert.deepEqual([...parts('members')], ['person']);
  assert.deepEqual([...parts('purpose')], ['icon']);
  // FR-114 AC-666: 議論の流れの番号は話順のステップで、トピックかシーンが前の要点と変わる位置で次の番号に区切る（s3・s4 は同じトピックの別のシーン）
  assert.deepEqual(by.flow.elements.filter((e) => e.part === 'badge').map((e) => e.n), [1, 2, 3]);
  const svg = boardSvg(L, {});
  assert.deepEqual(partKindsOf(svg).sort(), [...PART_KINDS].sort(), '11 種類');
  assert.ok(L.board.sections.filter((s) => s.count > 0).length >= 6, 'PARAM-179');
  const els = allEls(L);
  for (const e of els) assert.ok(inside(e, e.frame), `${e.id} は区画の枠に収まる`);
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) assert.ok(!overlap(els[i], els[j]), `${els[i].id} と ${els[j].id}`);
  // 各要点はちょうど 1 つの区画に（漏れ・重なりなし）
  const ids = L.board.assigned.map((a) => a.pointId);
  assert.equal(ids.length, MEETING.flat().length); assert.equal(new Set(ids).size, ids.length);
  // 次アクションの表は No・内容・担当・期限の 4 列で、議事項目の「候補」の印は付けない（AC-666）
  assert.ok(['No', '内容', '担当', '期限'].every((h) => svg.includes(`>${h}</text>`)));
  assert.ok(!/data-candidate-mark/.test(svg));
  assert.ok(!/<image|<foreignObject|https?:\/\/(?!www\.w3\.org)|url\(/.test(svg), '外部参照なし');
});

// FR-114 AC-666: 1 つの区画の要素が PARAM-088 を超えたら下位のまとまりに分け、省略しない
test('FR-114 AC-666: 区画の要素が PARAM-088 を超えると下位のまとまりに分かれ、すべての要点が残る', () => {
  const many = Array.from({ length: 17 }, (_, i) => [`第${i + 1}案で合意しました`]);
  const L = boardLayout({ scenes: scenesOf(many), topics: [], lang: 'ja' });
  const dec = L.board.sections.find((s) => s.id === 'decisions');
  assert.equal(dec.elements.length, 17);
  assert.equal(dec.subgroups.length, Math.ceil(17 / GROUP_MAX));
  for (const e of dec.elements) assert.ok(inside(e, dec.frame) && dec.subgroups.some((g) => inside(e, g)));
  for (let i = 0; i < dec.subgroups.length - 1; i++) assert.ok(!overlap(dec.subgroups[i], dec.subgroups[i + 1]));
});

// FR-114 AC-666・AC-667 (e): すべての描画スタイルで、文字とその直下の背景のコントラスト比が PARAM-007 以上。枠の形の拡張点（boardFrame）
test('FR-114 AC-666: どの描画スタイルでも見出し・ラベル・表の文字と背景のコントラスト比が 4.5 以上で、boardFrame: cloud なら雲形の枠', () => {
  const reg = createDrawStyleRegistry();
  const L = boardLayout({ scenes: scenesOf(MEETING), topics: TOPICS, lang: 'ja', titleInfo: { theme: 'TeamA との会議' } });
  for (const id of reg.ids()) {
    const spec = reg.spec(id);
    const C = boardColors(spec);
    assert.ok(contrastRatio(C.ink, C.bg) >= 4.5, `${id}: 本文`);
    assert.ok(contrastRatio(C.bandInk, C.bandFill) >= 4.5, `${id}: タイトル帯`);
    assert.ok(contrastRatio(C.badgeInk, C.line) >= 4.5, `${id}: 番号バッジ`);
    if (C.marker) assert.ok(contrastRatio(C.ink, C.marker) >= 4.5, `${id}: マーカー`);
    const svg = boardSvg(L, { style: spec, drawStyle: id });
    // FR-076 AC-670: boardFrame: 'cloud' の組み込みの描画スタイル（青見出し風など）は雲形、それ以外は角丸
    const look = boardFrameLook(spec);
    assert.match(svg, new RegExp(`data-board-frame="${look ? 'cloud' : 'rounded'}"`), `${id}: 区画の枠の形`);
    if (look) assert.ok(contrastRatio(look.text, look.fill) >= 4.5, `${id}: 雲形の枠の上の文字`);
  }
  assert.ok(reg.ids().some((id) => boardFrameLook(reg.spec(id))), '雲形の枠を持つ組み込みの描画スタイルがある（AC-670）');
  const cloud = boardSvg(L, { style: { ...reg.spec('stickyNotes'), boardFrame: 'cloud' } });
  assert.match(cloud, /data-board-frame="cloud"/);
  assert.ok((cloud.match(/<path d="M[^"]*A[^"]*Z" fill=/g) || []).length >= 9, '9 つの区画が雲形の枠');
});

// FR-114 AC-664 / FR-027 AC-139 / FR-028: 7 つ目の型として他の型と同じ扱いで選べ、自動選択では選ばれない
test('FR-114 AC-664: 会議ボード型はアイコン・キー・コマンドの検索・設定の既定で選べ、ラベルは PARAM-011 以内、切り替えで記録中の状態を失わない', async () => {
  assert.equal(LAYOUT_TYPE_IDS.length, 7);
  assert.equal(LAYOUT_TYPE_IDS.at(-1), 'board');
  for (const lang of ['ja', 'en']) assert.ok(weight(LAYOUT_TYPE_META.board[lang].label) <= 6);
  assert.notEqual(LAYOUT_TYPE_META.board.ja.label, LAYOUT_TYPE_META.workshop.ja.label);
  const { app, env } = await newApp();
  const item = app.getCommandBar().items.find((i) => i.command === 'layoutType.board');
  assert.ok(item && item.tooltip?.text);
  assert.ok(app.searchCommands(item.label).some((x) => x.command === 'layoutType.board'));
  assert.equal(app.handleKey(keyFor(app, 'layoutType.board')), 'layoutType.board');
  assert.deepEqual(app.getLayoutInfo().selected, ['board']);
  // 0 件で骨格
  const svg0 = app.renderSvg();
  assert.match(svg0, /data-layout-head="board"/);
  assert.equal((svg0.match(/data-board-section=/g) || []).length, 9);
  // 記録中に描き足す
  app.commands['session.start']();
  for (const t of ['今日の目的は方向性をそろえることです', '料金プランは月額制で合意しました']) { app.setDraft(t); app.submitDraft(); env.tick(1); }
  const before = JSON.stringify([app.getState().session, app.getState().utterances.length]);
  const m = app.getBoardModel();
  assert.equal(m.sections.find((s) => s.id === 'decisions').count, 1);
  assert.equal(m.sections.find((s) => s.id === 'purpose').count, 1);
  assert.ok(app.setLayoutTypes(['timeline']).ok);
  assert.equal(app.getBoardModel(), null);
  assert.ok(app.setLayoutTypes(['board']).ok);
  assert.equal(JSON.stringify([app.getState().session, app.getState().utterances.length]), before, '記録中の状態は失われない');
  // 設定の既定のレイアウトにも選べる
  assert.ok(app.setSettings({ layout: { mode: 'fixed', types: ['board'] } }).ok);
  // 保存（SVG）にも反映される
  await app.commands['save.svg']();
  assert.match(env.downloads.at(-1).data, /data-board-section="decisions"/);
  // AC-141（監査 S-05）: テキスト一覧は型の影響を受けない
  app.setLayoutTypes(['board']); const a = app.renderOutline();
  app.setLayoutTypes(['timeline']); assert.equal(app.renderOutline(), a);
});

test('FR-028 AC-142 FR-114: 自動選択は会議ボード型を選ばない（会議らしい発話でも）', () => {
  const sc = scenesOf(MEETING);
  const r = selectLayoutTypes({ scenes: sc, utterances: MEETING.flat().map((text, i) => ({ id: `u${i}`, text })), topics: TOPICS });
  assert.ok(Array.isArray(r) && r.length >= 1 && !r.includes('board'));
});

// FR-114 AC-666（監査 S-05）: 次アクションの表の行は図の表示で、議事項目（FR-094）の候補・確定とは別。「候補」の印は付けない
test('FR-114 AC-666: 次アクションの表の行に「候補」の印は付かず、議事項目の確定で表は変わらない', async () => {
  const { app, env } = await newApp();
  app.setLayoutTypes(['board']);
  app.commands['session.start']();
  app.setDraft('来週の金曜日までに田中さんが見積を共有します'); app.submitDraft(); env.tick(1);
  const table = () => JSON.stringify(app.getBoardModel().sections.find((s) => s.id === 'actions').elements);
  const before = table();
  assert.equal(JSON.parse(before)[0].rows[0].owner, '田中');
  assert.equal(JSON.parse(before)[0].rows[0].due, '来週の金曜日');
  assert.ok(!/data-candidate-mark/.test(app.renderSvg()));
  const item = app.getMeetingItems().actions[0];
  if (item) { app.confirmMeetingItem(item.id); assert.equal(table(), before); }
});

// FR-063 AC-317・FR-114 AC-665 (1): 9 つの区画名は固定の指示文にあり、LLM 連携が有効で応答が区画を指定すると最優先。不正な区画だけ無視
const CONF = { configured: { endpoint: true, deployment: true, credential: true }, endpointHost: 'example.invalid' };
async function llmApp(answer) {
  const calls = [];
  const relay = async ({ method = 'GET', path, body }) => {
    calls.push({ method, path, body });
    if (path.startsWith('/api/llm/status')) return { status: 200, body: CONF };
    return { status: 200, body: answer };
  };
  const ctx = await newApp({ options: { relay } });
  await ctx.app.requestLlmEnable(); await ctx.app.answerLlmConsent(true);
  ctx.app.setLayoutTypes(['board']);
  ctx.app.commands['session.start']();
  return { ...ctx, calls };
}
test('FR-114 AC-665: LLM の応答の区画の指定で振り分け、不正な区画は区画だけ無視して規則で決める。指示文は固定で、送信の項目は変わらない', async () => {
  const answer = { objects: [], people: [], emotions: [], metaphors: [], sections: [{ point: 1, section: 'vision', emphasis: '整理' }] };
  const { app, calls } = await llmApp(answer);
  app.setDraft('市場の状況を整理'); app.submitDraft(); await app.flushLlm();
  const sent = calls.filter((c) => c.path === '/api/llm/extract');
  assert.equal(sent.length, 1);
  assert.ok(sent[0].body.instructions.includes('purpose|members|flow|decisions|open|themes|vision|actions|memo'));
  assert.deepEqual(Object.keys(sent[0].body).sort(), ['drawStyle', 'input', 'instructions', 'partKeys', 'scene', 'text']);
  const m = app.getBoardModel();
  assert.equal(m.assigned[0].section, 'vision');
  assert.equal(m.assigned[0].rule, 1);
  assert.ok(/data-board-part="emphasis"/.test(app.renderSvg()), 'LLM が返した強調語にマーカーか下線');
  // 不正な区画: 区画だけ無視（規則で 議論の流れ）。応答のほかの項目は有効のまま
  const bad = await llmApp({ objects: [], people: [], emotions: [], metaphors: [], sections: [{ point: 1, section: 'nosuch' }] });
  bad.app.setDraft('市場の状況を整理'); bad.app.submitDraft(); await bad.app.flushLlm();
  assert.equal(bad.app.getBoardModel().assigned[0].section, 'flow');
  // LLM 連携が無効になったら規則だけ
  app.disableLlm();
  assert.equal(app.getLlmState().enabled, false);
  assert.equal(app.getBoardModel().assigned[0].section, 'flow');
});

// FR-114 AC-667 (f)・FR-079 AC-669: 描き足しで位置が変わる要素は MOVE_MS（PARAM-181 の 600ms 以内）で途中を経由して移り、動きを減らす設定では直ちに移る
test('FR-114 AC-667: 位置が変わる要素は 600ms 以内に途中の位置を経由して移り、動きを減らす設定では移動なし', () => {
  assert.ok(MOVE_MS <= 600);
  const board = (y) => ({ sections: [{ id: 'memo', frame: { x: 0, y, w: 100, h: 50 }, elements: [{ id: 'p:a', x: 10, y: y + 10, w: 20, h: 20 }] }] });
  for (const reduced of [false, true]) {
    const mo = createBoardMotion();
    mo.apply(board(0), 0, reduced);
    const mid = board(100); const moving = mo.apply(mid, 1000, reduced);
    const half = board(100); mo.apply(half, 1000 + MOVE_MS / 2, reduced);
    const end = board(100); mo.apply(end, 1000 + 600, reduced);
    if (reduced) { assert.equal(moving, false); assert.equal(mid.sections[0].elements[0].y, 110); }
    else { assert.equal(moving, true); assert.equal(mid.sections[0].elements[0].y, 10); const y = half.sections[0].elements[0].y; assert.ok(y > 10 && y < 110, String(y)); }
    assert.equal(end.sections[0].elements[0].y, 110); assert.equal(end.sections[0].elements[0].dy, 0);
  }
});

// ---- FR-079 AC-669・AC-432 (b)(c)・AC-434・AC-439: 会議ボード型の描き足し（収まる間は不動・あふれたときだけ詰め直し・出現の演出） ----
const secsOf = (L) => new Map(L.board.sections.map((s) => [s.id, { frame: { ...s.frame }, els: s.elements.map((e) => [e.id, e.x, e.y]) }]));
function checkBoard(L, where) {
  const els = allEls(L);
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) assert.ok(!overlap(els[i], els[j]), `${where}: ${els[i].id} と ${els[j].id} が重ならない`);
  for (const e of els) assert.ok(inside(e, e.frame), `${where}: ${e.id} は自分の区画の枠からはみ出さない`);
  for (const s of L.board.sections) assert.ok(inside(s.frame, { x: 0, y: 0, w: L.canvas.w, h: L.canvas.h }), `${where}: ${s.id} の枠は図の領域内`);
  const fr = L.board.sections.map((s) => s.frame);
  for (let i = 0; i < fr.length; i++) for (let j = i + 1; j < fr.length; j++) assert.ok(!overlap(fr[i], fr[j]), `${where}: 区画の枠が重ならない`);
}

// FR-079 AC-669 AC-432: 区画の中身が枠に収まる間はほかの区画の枠・要素は動かず、あふれたときだけ枠を決め直して詰め直し、図の領域は縦に伸びる
// （PARAM-186: 並びの中で最も中身の高い区画の空きは 1 行以下なので、収まる追加は並びの中で中身の低い区画への追加で起きる）
test('FR-079 AC-669 AC-432: 収まる間はほかの区画は不動、あふれたときだけ詰め直し、重なり 0・はみ出し 0・図の領域を縦に伸ばす', () => {
  // 議論の流れ（同じ並びの決定事項より高い）を先に作り、決定事項に 1 件ずつ足す
  const groups = ['まず市場の状況を整理しました', '次に顧客の声を共有しました', '続いて試作を見せました', '最後に費用を話しました', 'さらに体制を話しました', 'そして日程を話しました'].map((t) => [t]);
  let prev = boardLayout({ scenes: scenesOf(groups), topics: [] });
  checkBoard(prev, '最初');
  let overflowed = 0; let stayed = 0;
  for (let k = 1; k <= 24; k++) {
    groups.push([`案その${k}に決めました`]);
    const L = boardLayout({ scenes: scenesOf(groups), topics: [] });
    checkBoard(L, `追加 ${k}`);
    const a = secsOf(prev); const b = secsOf(L);
    const dec = (m) => m.get('decisions');
    assert.equal(dec(b).els.at(-1)[0], `p:s${groups.length}p0`, `追加 ${k}: 末尾に加わる`);
    assert.equal(dec(b).els.length, k, `追加 ${k}: 全要点が図にある`);
    const grew = dec(b).frame.h !== dec(a).frame.h;
    const others = [...b.keys()].filter((id) => id !== 'decisions');
    if (!grew) {
      stayed++;
      for (const id of others) assert.deepEqual(b.get(id), a.get(id), `追加 ${k}: 収まる間は ${id} の枠と要素は動かない`);
      assert.equal(L.canvas.h, prev.canvas.h, `追加 ${k}: 図の領域も変わらない`);
    } else {
      overflowed++;
      assert.ok(L.canvas.h > prev.canvas.h, `追加 ${k}: あふれたら図の領域を縦に伸ばす`);
      assert.ok(others.some((id) => b.get(id).frame.y !== a.get(id).frame.y), `追加 ${k}: ほかの区画を詰め直す`);
    }
    prev = L;
  }
  assert.ok(stayed >= 3 && overflowed >= 3, `収まる追加（${stayed}）とあふれ（${overflowed}）の両方を確かめた`);
  // AC-434・AC-432 (c): 同じ入力からは毎回同じ配置、新しい要素がなければ配置は変わらない
  const again = boardLayout({ scenes: scenesOf(groups), topics: [] });
  assert.deepEqual(secsOf(again), secsOf(prev));
  assert.deepEqual(again.canvas, prev.canvas);
});

// FR-079 AC-669 PARAM-186: 区画の高さは中身に合わせ、並びの中で最も中身の高い区画の最後の要素の下の空き（見出し・枠の内側の余白を除く）は 1 行以下。
// 要点が 0 件の区画は見出しと 1 行分の空きだけ
test('FR-079 AC-669 PARAM-186: 各並びの最も中身の高い区画の空きは 1 行以下、0 件の区画は見出しと 1 行分', () => {
  const HEAD_AND_GAP = 36 + 8; const PAD = 12; // 見出しと枠の内側の余白（空きに含めない）
  const cases = [[], MEETING, MEETING.slice(0, 3), [...MEETING, ...MEETING.slice(2, 4)]];
  for (const [ci, g] of cases.entries()) {
    for (let n = 0; n <= g.length; n++) {
      const L = boardLayout({ scenes: scenesOf(g.slice(0, n)), topics: [], lang: 'ja' });
      const line = L.board.line;
      assert.ok(line > 0 && line <= 26, '1 行は区画のラベルの 1 行の高さ');
      const rows = new Map();
      for (const s of L.board.sections) (rows.get(s.frame.y) ?? rows.set(s.frame.y, []).get(s.frame.y)).push(s);
      for (const [y, secs] of rows) {
        assert.equal(new Set(secs.map((s) => s.frame.h)).size, 1, `${ci}/${n}: 同じ並びの枠の高さは揃う`);
        const body = (s) => s.frame.h - HEAD_AND_GAP - PAD;
        const bottom = (s) => (s.elements.length ? Math.max(...s.elements.map((e) => e.y + e.h)) - (s.frame.y + HEAD_AND_GAP) : 0);
        const tallest = secs.reduce((m, s) => (bottom(s) > bottom(m) ? s : m), secs[0]);
        const spare = body(tallest) - bottom(tallest);
        assert.ok(spare >= 0 && spare <= line, `${ci}/${n} y=${y}: ${tallest.id} の空き ${spare} は 1 行（${line}）以下`);
        for (const s of secs) if (!s.count && secs.every((t) => !t.count)) assert.equal(body(s), line, `${ci}/${n}: 0 件の並びは見出しと 1 行分`);
      }
    }
  }
});

// FR-114 AC-666: 議論の流れはトピックかシーンが前の要点と変わる位置でステップに区切り（異なるトピック・シーンを 1 つの吹き出しにまとめない）、
// 1 ステップが PARAM-088 を超えると同じ番号の続きに分け、各ステップに番号バッジ・吹き出し・人物が 1 組、隣り合うステップの間ごとに ⇒
test('FR-114 AC-666: 議論の流れはトピック・シーンの変わり目ごとの ①②③… のステップで、ステップの間ごとに矢印', () => {
  const flow = (L) => L.board.sections.find((s) => s.id === 'flow').elements;
  // 同じシーンの続く要点は 1 つのステップ、シーンが変われば（同じトピックでも）次のステップ、前のトピックに戻っても新しい番号
  const g = [['まず市場の状況を整理しました', '市場の規模も見ました'], ['次に顧客の声を共有しました'], ['続いて試作を見せました'], ['改めて市場の話に戻りました']];
  const L = boardLayout({ scenes: scenesOf(g), topics: [{ id: 'tA', sceneIds: ['s1', 's2', 's4'] }, { id: 'tB', sceneIds: ['s3'] }] });
  const els = flow(L);
  const bubbles = els.filter((e) => e.part === 'bubble');
  assert.deepEqual(els.filter((e) => e.part === 'badge').map((e) => e.n), [1, 2, 3, 4]);
  assert.deepEqual(bubbles.map((b) => b.pointIds), [['s1p0', 's1p1'], ['s2p0'], ['s3p0'], ['s4p0']]);
  for (const b of bubbles) assert.equal(new Set(b.sceneIds).size, 1, '1 つの吹き出しに 1 つのシーン');
  assert.equal(els.filter((e) => e.part === 'person').length, 4, '各ステップに人物');
  assert.equal(els.filter((e) => e.part === 'arrow').length, 3, '隣り合うステップの間ごとに矢印');
  // 1 ステップの要点が PARAM-088 を超えると同じ番号の続きのステップ
  const many = [Array.from({ length: GROUP_MAX + 2 }, (_, i) => `話題その${i + 1}を話しました`)];
  const M2 = flow(boardLayout({ scenes: scenesOf(many), topics: [] }));
  assert.deepEqual(M2.filter((e) => e.part === 'badge').map((e) => e.n), [1, 1]);
  // 要素の id は取込の前後で同じ（後ろにステップが加わっても前のステップの id は変わらない）
  const before = flow(boardLayout({ scenes: scenesOf(g.slice(0, 2)), topics: [] })).map((e) => e.id);
  const after = flow(boardLayout({ scenes: scenesOf(g), topics: [] })).map((e) => e.id);
  assert.deepEqual(after.slice(0, before.length), before);
});

// FR-114 AC-667 (h) PARAM-187: 強調のある文字は強調語ごとの tspan に分け、tspan の始まり・幅をマーカー・下線の左端・幅と同じにする
// （描いた書体の字幅が見積もりと違っても、強調語の最初の文字の左端・最後の文字の右端が強調の左端・右端に重なる）
test('FR-114 AC-667 (h) PARAM-187: 強調語は自分の tspan に入り、その x・textLength はマーカー（下線）の x・幅と一致する', () => {
  const L = boardLayout({ scenes: scenesOf([['本日はTeamAから五名が参加しています'], ['受付窓口を一本化することに決めました'], ['佐藤さんが金曜までに要件を共有します']]), topics: [] });
  {
    const svg = boardSvg(L, {});
    const texts = [...svg.matchAll(/((?:<rect data-board-part="emphasis"[^>]*\/>|<path data-board-part="emphasis"[^>]*\/>)+)<text [^>]*>(.*?)<\/text>/g)];
    assert.ok(texts.length >= 3, '強調のある文字');
    for (const [, ems, body] of texts) {
      const marks = [...ems.matchAll(/(?:x="([\d.]+)"[^>]*width="([\d.]+)"|d="M([\d.]+) [\d.]+h([\d.]+)")/g)].map((m) => ({ x: Number(m[1] ?? m[3]), w: Number(m[2] ?? m[4]) }));
      const words = [...body.matchAll(/<tspan x="([\d.]+)" textLength="([\d.]+)" lengthAdjust="spacingAndGlyphs" data-emph-word="">/g)].map((m) => ({ x: Number(m[1]), w: Number(m[2]) }));
      assert.equal(words.length, marks.length, '強調ごとに 1 つの tspan');
      marks.forEach((mk, i) => { assert.ok(Math.abs(mk.x - words[i].x) <= 0.05 && Math.abs(mk.w - words[i].w) <= 0.05, `${JSON.stringify(mk)} と ${JSON.stringify(words[i])}`); });
      const all = [...body.matchAll(/<tspan x="([\d.]+)" textLength="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
      for (let i = 1; i < all.length; i++) assert.ok(Math.abs(all[i - 1][0] + all[i - 1][1] - all[i][0]) <= 0.15, 'tspan は隙間・重なりなく続く');
      assert.equal(body.replace(/<[^>]+>/g, '').length > 0, true);
    }
  }
  // 文字は分けても、描かれる文字列は元のラベルと同じ
  const svg = boardSvg(L, {});
  assert.ok(svg.replace(/<\/?tspan[^>]*>/g, '').includes('本日はTeamAから五名が参加しています'));
});

// FR-079 AC-669 AC-439: 新しい要素は MOVE_MS（PARAM-181 以内）でフェードと拡大で現れ、動きを減らす設定・最初の描画では演出なし
test('FR-079 AC-669 AC-439: 新しい要点は PARAM-181 以内のフェードと拡大で現れ、動きを減らす設定では演出なし', () => {
  const L1 = () => boardLayout({ scenes: scenesOf([['今日の目的は方向性をそろえることです']]), topics: [] });
  const L2 = () => boardLayout({ scenes: scenesOf([['今日の目的は方向性をそろえることです'], ['今日の目的は品質の底上げです'], ['料金プランは月額制で合意しました', 'まず市場の状況を整理しました']]), topics: [] });
  const elOf = (L, id) => allEls(L).find((e) => e.id === id);
  for (const reduced of [false, true]) {
    const mo = createBoardMotion();
    const a = L1(); mo.apply(a.board, 0, reduced);
    assert.equal(elOf(a, 'p:s1p0').appear, undefined, '最初の描画は演出なし');
    const b = L2(); const busy = mo.apply(b.board, 1000, reduced);
    const c = L2(); mo.apply(c.board, 1000 + MOVE_MS / 2, reduced);
    const d = L2(); mo.apply(d.board, 1000 + 600, reduced);
    const svgMid = boardSvg(c);
    assert.equal(elOf(b, 'p:s1p0').appear, undefined, '既存の要素は演出なし');
    if (reduced) {
      assert.equal(busy, false);
      for (const L of [b, c]) assert.ok(allEls(L).every((e) => e.appear == null));
      assert.ok(!/data-board-appear/.test(svgMid));
    } else {
      assert.equal(busy, true);
      assert.equal(elOf(b, 'p:s2p0').appear, 0, '出現の始まりは透明');
      const m = elOf(c, 'p:s2p0').appear; assert.ok(m > 0 && m < 1, String(m));
      // 吹き出しの中の 1 行（議論の流れ）も現れる
      assert.ok(c.board.sections.find((s) => s.id === 'flow').elements.some((e) => e.part === 'bubble'));
      const op = [...svgMid.matchAll(/data-board-appear opacity="([\d.]+)" transform="translate\([^)]*\) scale\(([\d.]+)\)/g)];
      assert.ok(op.length >= 1 && op.every((x) => Number(x[1]) > 0 && Number(x[1]) < 1 && Number(x[2]) < 1), 'フェードと拡大の途中');
    }
    assert.ok(allEls(d).every((e) => e.appear == null), `${MOVE_MS}ms（PARAM-181 の 600ms 以内）で演出が終わる`);
    assert.ok(!/data-board-appear/.test(boardSvg(d)));
    assert.equal(mo.moving(), false);
  }
});

// FR-079 AC-669 AC-432 (b)(c) AC-439: アプリで、再配置の周期をまたいでも新しい要素がなければ位置は変わらず、演出の途中も記録中の状態・選択を保つ
test('FR-079 AC-669 AC-432 AC-439: 会議ボード型では周期の再配置で位置が変わらず（冪等）、演出の途中も記録中の状態が保たれる', async () => {
  const { app, env } = await newApp();
  app.setLang('ja');
  app.setLayoutTypes(['board']);
  app.commands['session.start']();
  const pos = () => JSON.stringify(app.getBoardModel().sections.map((s) => [s.id, s.frame, s.elements.map((e) => [e.id, e.x, e.y])]));
  for (const t of ['今日の目的は方向性をそろえることです', '料金プランは月額制で合意しました']) { app.setDraft(t); app.submitDraft(); }
  env.tick(1); env.scheduler?.advance?.(1000); app.renderSvg(); // 描画済み（画面は変更のたびに描き直す）
  const session = JSON.stringify(app.getState().session);
  // 出現の途中（同じ時刻）でも記録中の状態は変わらない
  app.setDraft('価格の上限は保留'); app.submitDraft();
  assert.match(app.renderSvg(), /data-board-appear/);
  assert.equal(JSON.stringify(app.getState().session), session, '演出の途中も記録中');
  for (let i = 0; i < 4; i++) { env.tick(0.2); env.scheduler?.advance?.(200); app.renderSvg(); }
  assert.ok(!/data-board-appear/.test(app.renderSvg()), '演出は終わる');
  const before = pos();
  for (let i = 0; i < 3; i++) { env.tick(10); env.scheduler?.advance?.(10000); app.renderSvg(); }
  assert.equal(pos(), before, '新しい要素がなければ周期の再配置で位置は変わらない（AC-432 (c)）');
  assert.equal(JSON.stringify(app.getState().session), session);
});

// ---- FR-076 AC-670 × FR-114: 会議ボード型を暖色カード風・青見出し風・雲形の枠で描いたときの配色 ----
const colorsOf = (svg) => new Set([...svg.matchAll(/(?:fill|stroke|stop-color)="(#[0-9a-fA-F]{3,6})"/g)].map((m) => m[1].toLowerCase()));
const boardSvgOf = (id) => { const reg = createDrawStyleRegistry(); const spec = reg.spec(id); return { spec, svg: boardSvg(boardLayout({ scenes: scenesOf(MEETING), topics: TOPICS, lang: 'ja', titleInfo: { theme: 'TeamA との会議' } }), { style: spec }) }; };

// FR-076 AC-670 FR-114: 暖色カード風（paletteOnly）は配色の 5 色と白・黒・グレーだけ（マーカーは混色しない黄）。要点の行と吹き出しは角丸 12px の白いカード
test('FR-076 AC-670 FR-114: 会議ボード型×暖色カード風の色は配色の 5 色＋白・黒・グレー以内で、マーカーは配色の黄、行と吹き出しは白いカード', () => {
  const { spec, svg } = boardSvgOf('warmCards');
  const allowed = new Set([spec.palette.background, spec.palette.primary, spec.palette.text, spec.palette.secondary, ...spec.palette.accent, '#ffffff', '#000000', '#9e9e9e'].map((c) => c.toLowerCase()));
  const extra = [...colorsOf(svg)].filter((c) => !allowed.has(c));
  assert.deepEqual(extra, [], `配色の外の色がない（${[...colorsOf(svg)]}）`);
  const C = boardColors(spec);
  assert.ok(['#f2e63d', '#f2c53d'].includes(C.marker), `マーカーは配色の黄（${C.marker}）`);
  assert.ok(contrastRatio(C.ink, C.marker) >= 4.5);
  assert.match(svg, /data-emph="marker"[^>]*fill="#f2e63d"/);
  const cards = [...svg.matchAll(/<rect data-board-(?:part="bubble" data-board-)?card [^>]*rx="(\d+)" fill="(#[0-9a-f]+)"/g)];
  assert.ok(cards.length >= 5 && cards.every((m) => m[1] === '12' && m[2] === '#ffffff'), `白いカード（角丸 12px）: ${cards.length}`);
  assert.match(svg, /data-board-part="bubble" data-board-card/);
});

// FR-076 AC-670 FR-114: 青見出し風（headingBand）はタイトル帯と 9 区画の見出しを青のグラデーションの帯で描き、白抜きの文字と絵記号は最も明るい位置で 4.5 以上
test('FR-076 AC-670 FR-114: 会議ボード型×青見出し風はグラデーションの帯に白抜きの見出しで、最も明るい位置で 4.5:1 以上', () => {
  const { spec, svg } = boardSvgOf('blueHeadings');
  const stops = [...svg.matchAll(/<stop offset="[\d.]+" stop-color="(#[0-9a-f]+)"/g)].map((m) => m[1]);
  assert.deepEqual(stops, spec.headingBand.gradient);
  assert.match(svg, /<linearGradient id="board-head-band"/);
  assert.match(svg, /<g data-board-part="title"><rect [^>]*fill="url\(#board-head-band\)"/);
  assert.equal((svg.match(/data-board-heading-band /g) || []).length, 9, '9 区画の見出しが帯の上');
  const ink = boardColors(spec).headBand.ink;
  const heads = [...svg.matchAll(/<text data-board-heading [^>]*fill="(#[0-9a-f]+)"/g)].map((m) => m[1]);
  assert.ok(heads.length === 9 && heads.every((c) => c === ink), '見出しの文字は白抜き');
  assert.ok([...svg.matchAll(/data-board-heading-icon="[a-z]+" [^>]*>(.*?)<\/g>/g)].every((m) => !/stroke="#(?!ffffff)/.test(m[1])), '見出しの絵記号も白抜き');
  const brightest = stops.reduce((a, c) => (contrastRatio(c, '#000000') > contrastRatio(a, '#000000') ? c : a));
  assert.ok(contrastRatio(ink, brightest) >= 4.5, `最も明るい位置 ${brightest} で ${contrastRatio(ink, brightest).toFixed(2)}`);
  // 帯のない定義では従来どおり（帯もグラデーションもない）
  assert.ok(!/linearGradient/.test(boardSvgOf('yellowBlack').svg));
});

// FR-076 AC-670 FR-114: 雲形の枠（黄の面）の上の文字とマーカーのコントラストが 4.5 以上
test('FR-076 AC-670 FR-114: 雲形の枠の上のマーカーと文字のコントラストは 4.5 以上', () => {
  const reg = createDrawStyleRegistry();
  let n = 0;
  for (const id of reg.ids()) {
    const spec = reg.spec(id); const look = boardFrameLook(spec); if (!look) continue;
    n++;
    const C = boardColors(spec);
    assert.ok(contrastRatio(look.text, look.fill) >= 4.5, `${id}: 黄の面と文字`);
    if (C.marker) assert.ok(contrastRatio(look.text, C.marker) >= 4.5, `${id}: マーカー ${C.marker} と文字 ${look.text}`);
  }
  assert.ok(n >= 1, '雲形の枠の定義がある');
});

// FR-114 AC-665（最終監査）: 否定・先送りの言い回しは「決定」「確認」の部分一致より先に判定して未決事項へ
test('FR-114 AC-665: 否定・先送り（未決定・未定・保留・決まらない・次回まで）は決定・行動の語より先に未決事項へ', () => {
  for (const t of ['決定は次回まで保留します', 'この件は未決定です', '担当はまだ決まらない', '承認は未定です', '確認は次回までに持ち越し', 'The scope is TBD', 'The scope is undecided', '採用するかは未定', '次回まで持ち越しです']) assert.equal(sec(t), 'open', t);
  // 否定のない決定・行動は従来どおり
  assert.equal(sec('料金プランは月額制で決定しました'), 'decisions');
  assert.equal(sec('明日までに確認します'), 'actions');
  // LLM の区画の指定は引き続き最優先
  assert.equal(sec('この件は未決定です', { section: 'decisions' }), 'decisions');
});

// FR-114 AC-664 AC-666: 会議ボード型は詳細度（初期値「大項目」を含むどの値）に関わらず区画に要点を描き、発話 0 件でも全区画の枠と見出しを描く
test('FR-114 AC-664 AC-666: 詳細度に関わらず区画に要点を描き、発話 0 件でも 9 区画の骨格の枠と見出しを描く', async () => {
  const { app, env } = await newApp();
  app.setLang('ja');
  const initial = app.getDetailLevel();
  app.setLayoutTypes(['board']);
  const svg0 = app.renderSvg();
  assert.equal((svg0.match(/data-board-section=/g) || []).length, 9, '発話 0 件: 9 区画の枠');
  assert.equal((svg0.match(/data-board-heading /g) || []).length, 9, '発話 0 件: 9 区画の見出し');
  app.commands['session.start']();
  const texts = ['今日の目的は方向性をそろえることです', '料金プランは月額制で合意しました', 'この件は未決定です'];
  for (const t of texts) { app.setDraft(t); app.submitDraft(); env.tick(1); }
  assert.equal(initial, 'major', '詳細度の初期値は大項目');
  for (const lv of ['major', 'middle', 'detail']) {
    if (lv !== initial) assert.equal(app.setDetailLevel(lv).ok, true, lv);
    const svg = app.renderSvg();
    assert.match(svg, /data-layout-head="board"/, `${lv}: 会議ボード型`);
    const ids = new Set([...svg.matchAll(/data-point-id="([^"]+)"/g)].map((m) => m[1]));
    assert.ok(ids.size >= texts.length, `${lv}: 要点が区画に描かれる（${ids.size}）`);
    assert.equal((svg.match(/data-board-heading /g) || []).length, 9, `${lv}: 9 区画の見出し`);
    const m = app.getBoardModel();
    assert.equal(m.sections.find((s) => s.id === 'open').count, 1, `${lv}: 未決定は未決事項`);
  }
});
