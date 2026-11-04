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
  // 議論の流れの番号はトピックごとの話順
  assert.deepEqual(by.flow.elements.filter((e) => e.part === 'badge').map((e) => e.n), [1, 2]);
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
