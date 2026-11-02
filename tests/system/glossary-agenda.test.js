// FR-093 AC-610（用語集の画面の主要な流れ）／FR-095 AC-611（議題の画面）
// （System Test。契約: tests/system/CONTRACT-P2.md）
// 期待値は受入基準だけから決める。実装がなければ失敗するのが正常（not_run → 実装後に pass）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, toDetail, keyFor, PARAM } from './helpers.js';

const GLOSSARY_LIMIT = 500; // PARAM-122
const AGENDA_LIMIT = 30; // PARAM-152

async function settle(app, env) { env.scheduler.advance(PARAM.UPPER_SEC * 1000); app.flushSave(); }

// FR-093 AC-610（AC-549・AC-550 を通しで確かめる）
test('FR-093 AC-610: 用語集の画面で「Azure」（別表記「アジュール」）を登録し、手入力の発話で「Azure」が要点・図・テキスト一覧に使われ、元の発話は残り、保存・読込で登録と規則が残る', async () => {
  const { app, env, createApp } = await newApp();
  // キーだけで開く（Alt+Shift+,）。画面は登録の一覧・入力欄・件数を持つ
  assert.equal(app.handleKey(keyFor(app, 'glossary.open')), 'glossary.open');
  let v = app.getGlossaryView();
  assert.ok(v && v.open === true && v.role === 'dialog', '用語集の画面が開く');
  assert.ok(v.countText.includes(`${GLOSSARY_LIMIT}`) && /0/.test(v.countText), '「0／500 件」が文字で示される');

  // 異常系: 空の語は追加されず理由が文字で示される
  app.setGlossaryInput({ term: '  ', variants: '' });
  let r = app.submitGlossaryInput();
  assert.equal(r.ok, false); assert.ok(String(r.reason || '').length > 0, '理由');
  assert.ok(String(app.getGlossaryView().error || '').length > 0, '画面にも理由が文字で出る');
  assert.equal(app.getGlossaryView().count, 0);

  // 登録（正しい表記と別表記）
  app.setGlossaryInput({ term: 'Azure', variants: 'アジュール' });
  r = app.submitGlossaryInput();
  assert.equal(r.ok, true);
  v = app.getGlossaryView();
  assert.equal(v.items.length, 1);
  assert.equal(v.items[0].term, 'Azure');
  assert.deepEqual(v.items[0].variants, ['アジュール']);
  assert.ok(/1\s*[／/]\s*500/.test(v.countText), '「1／500 件」');
  assert.ok(app.renderGlossary().includes('Azure') && app.renderGlossary().includes('アジュール'), '画面の一覧に文字で出る');

  // 異常系: 重複（前後の空白・全角半角の違いを除く）は追加されない
  app.setGlossaryInput({ term: ' Ａｚｕｒｅ ', variants: '' });
  r = app.submitGlossaryInput();
  assert.equal(r.ok, false, '重複は追加されない');
  assert.ok(String(r.reason || '').length > 0);
  assert.equal(app.getGlossaryView().count, 1);

  // 閉じる（Esc）
  assert.equal(app.handleKey({ key: 'Escape' }), 'glossary.close');
  assert.equal(app.getGlossaryView(), null);

  // 手入力の発話: 記録時に置き換わる。要点・図・テキスト一覧は「Azure」、元の発話は「アジュール」
  app.commands['session.start']();
  app.setDraft('アジュールの契約を見直します');
  assert.equal(app.submitDraft().ok, true);
  env.tick(1);
  await settle(app, env);
  toDetail(app);
  const st = app.getState();
  const u = st.utterances.at(-1);
  assert.ok(u.text.includes('Azure') && !u.text.includes('アジュール'), '記録時に正しい表記へ');
  assert.equal(u.rawText, 'アジュールの契約を見直します', '元の発話は別表記のまま残る');
  const pts = st.scenes.flatMap((s) => s.points);
  assert.ok(pts.length > 0 && pts.every((p) => !p.text.includes('アジュール')) && pts.some((p) => p.text.includes('Azure')), '要点に正しい表記');
  assert.ok(app.renderSvg().includes('Azure') && !app.renderSvg().includes('アジュール'), '図に正しい表記');
  assert.ok(app.renderOutline().includes('Azure'), 'テキスト一覧に正しい表記');
  assert.ok(pts.some((p) => p.sources.some((s) => s.rawText.includes('アジュール'))), '元の発話（rawText）が要点から辿れる');

  // 保存 → 再読込（同じ storage）で登録が残り、重複の規則が働く
  const app2 = await createApp(env.options);
  assert.deepEqual(app2.getGlossary().terms.map((t) => [t.term, t.variants]), [['Azure', ['アジュール']]], '再読込の後に登録が残る');
  assert.equal(app2.addGlossaryTerm({ term: 'Ａｚｕｒｅ', variants: [] }).ok, false, '再読込の後も重複は追加されない');

  // セッションファイル（保存 → 初期化 → 読込）でも残る
  assert.equal((await app.commands['file.save']()).ok, true);
  const dl = env.downloads.at(-1);
  assert.equal(app.commands['data.reset']().ok, true);
  assert.equal((await app.dialogAction('confirm')).ok, true);
  const l = await app.loadSessionFile({ name: dl.filename, type: dl.mime, size: String(dl.data).length, text: String(dl.data) });
  assert.equal(l.ok, true);
  assert.deepEqual(app.getGlossary().terms.map((t) => [t.term, t.variants]), [['Azure', ['アジュール']]], '読込の後に登録が残る');

  // 上限（読込後も同じ規則）: 500 件まで。超えると追加できず件数と上限が文字で示される
  const g = app.getGlossary();
  for (let i = g.count; i < GLOSSARY_LIMIT; i++) assert.equal(app.addGlossaryTerm({ term: `語${i}`, variants: [] }).ok, true);
  app.commands['glossary.open']();
  assert.ok(/500\s*[／/]\s*500/.test(app.getGlossaryView().countText), '「500／500 件」');
  app.setGlossaryInput({ term: '超過の語', variants: '' });
  r = app.submitGlossaryInput();
  assert.equal(r.ok, false, '上限を超えると追加できない');
  assert.ok(/500/.test(String(r.reason || '') + String(app.getGlossaryView().error || '')), '上限の件数が示される');
  assert.equal(app.getGlossary().count, GLOSSARY_LIMIT);
});

// FR-095 AC-611（AC-568・AC-569 と整合）
test('FR-095 AC-611: 議題の画面で議題を追加・編集・削除・並べ替えでき、件数の上限・不正な入力は拒否され、進行中の議題を壊さず、保存・再読込で復元される', async () => {
  const { app, env, createApp } = await newApp();
  const focusBefore = app.getFocusedElement();
  assert.equal(app.handleKey(keyFor(app, 'agenda.open')), 'agenda.open');
  let v = app.getAgendaView();
  assert.ok(v && v.open === true && v.role === 'dialog', '議題の画面が開く');
  assert.ok(/0\s*[／/]\s*30/.test(v.countText), '「0／30 件」が文字で示される');

  const add = (name, minutes) => { app.setAgendaInput({ name, minutes: String(minutes) }); return app.submitAgendaInput(); };
  // 異常系: 名前が空・持ち時間が正の整数でない
  for (const [n, m] of [['', '5'], ['   ', '5'], ['名前あり', '0'], ['名前あり', '-3'], ['名前あり', '2.5'], ['名前あり', 'abc'], ['名前あり', '']]) {
    const r = add(n, m);
    assert.equal(r.ok, false, `追加されない: name=「${n}」minutes=「${m}」`);
    assert.ok(String(r.reason || '').length > 0, '理由が文字で示される');
    assert.ok(String(app.getAgendaView().error || '').length > 0, '画面にも理由が出る');
  }
  assert.equal(app.getAgendaView().count, 0);

  // 追加
  for (const [n, m] of [['現状の共有', 5], ['案の比較', 15], ['決定事項の確認', 10]]) assert.equal(add(n, m).ok, true);
  const names = () => app.getAgendaView().items.map((i) => i.name);
  const ctxNames = () => app.getMeetingContext().agenda.map((a) => a.name);
  assert.deepEqual(names(), ['現状の共有', '案の比較', '決定事項の確認']);
  assert.ok(/3\s*[／/]\s*30/.test(app.getAgendaView().countText));
  // 並べ替え（上へ）: 順が議題の順（getMeetingContext）になる
  const id = (n) => app.getAgendaView().items.find((i) => i.name === n).id;
  assert.equal(app.moveAgendaItem(id('決定事項の確認'), 'up').ok, true);
  assert.deepEqual(names(), ['現状の共有', '決定事項の確認', '案の比較']);
  assert.deepEqual(ctxNames(), names(), '並べた順が議題の順（出力・タイマーの「次の議題」）');
  assert.equal(app.moveAgendaItem(id('現状の共有'), 'down').ok, true);
  assert.equal(app.moveAgendaItem(id('現状の共有'), 'up').ok, true);
  assert.deepEqual(names(), ['現状の共有', '決定事項の確認', '案の比較']);
  // 編集（不正な編集は不変）
  assert.equal(app.editAgendaItem(id('現状の共有'), { name: '現状の共有と課題', minutes: 7 }).ok, true);
  assert.equal(app.editAgendaItem(id('案の比較'), { name: '', minutes: 15 }).ok, false);
  assert.equal(app.editAgendaItem(id('案の比較'), { name: '案の比較', minutes: 0 }).ok, false);
  assert.deepEqual(app.getAgendaView().items.map((i) => [i.name, i.minutes]), [['現状の共有と課題', 7], ['決定事項の確認', 10], ['案の比較', 15]]);

  // 上限 30 件: 超えると追加できず件数と上限が文字で示される
  for (let i = 3; i < AGENDA_LIMIT; i++) assert.equal(add(`議題${i}`, 1).ok, true);
  assert.ok(/30\s*[／/]\s*30/.test(app.getAgendaView().countText), '「30／30 件」');
  const over = add('超過', 1);
  assert.equal(over.ok, false);
  assert.ok(/30/.test(String(over.reason || '') + String(app.getAgendaView().error || '')), '上限が示される');
  assert.equal(app.getAgendaView().count, AGENDA_LIMIT);
  for (let i = AGENDA_LIMIT - 1; i >= 3; i--) assert.equal(app.removeAgendaItem(id(`議題${i}`)).ok, true, '進行していない議題は確認なしで削除できる');
  assert.equal(app.getAgendaView().count, 3);

  // タイマー進行中: 画面に現在の議題・残り・次の議題が文字で出る。進行していない議題の操作で進行中は変わらない
  assert.equal(app.commands['timer.start']().ok, true);
  const html = app.renderAgendaView();
  for (const w of ['現状の共有と課題', '07:00', '決定事項の確認']) assert.ok(html.includes(w), `画面に「${w}」`);
  assert.equal(app.moveAgendaItem(id('案の比較'), 'up').ok, true);
  assert.equal(app.moveAgendaItem(id('案の比較'), 'down').ok, true);
  assert.equal(app.getAgendaTimer().currentName, '現状の共有と課題', '進行中の議題は壊れない');
  assert.equal(app.getAgendaTimer().state, 'running');

  // 進行中の議題の削除は確認が出る（取り消せる）。確定で次の議題へ進む
  const cur = id('現状の共有と課題');
  let d = app.removeAgendaItem(cur);
  assert.equal(d.ok, false); assert.equal(d.pending, true);
  assert.equal(app.getDialog()?.kind, 'agenda-delete-current');
  assert.equal((await app.dialogAction('cancel')).ok ?? true, true);
  assert.equal(app.getAgendaView().count, 3, '取り消しで不変');
  d = app.removeAgendaItem(cur);
  assert.equal((await app.dialogAction('confirm')).ok, true);
  assert.deepEqual(names(), ['決定事項の確認', '案の比較']);
  const t = app.getAgendaTimer();
  assert.equal(t.state, 'running');
  assert.equal(t.currentName, '決定事項の確認', '次の議題へ進む');
  assert.equal(t.nextName, '案の比較');

  // 閉じるとフォーカスが開く前の位置に戻る（Esc）
  assert.equal(app.handleKey({ key: 'Escape' }), 'agenda.close');
  assert.equal(app.getAgendaView(), null);
  assert.equal(app.getFocusedElement(), focusBefore, 'フォーカスが開く前の位置に戻る');

  // 保存 → 再読込で議題の順・持ち時間が復元される
  env.scheduler.advance(PARAM.SAVE_DEBOUNCE_MS); app.flushSave();
  const app2 = await createApp(env.options);
  assert.deepEqual(app2.getMeetingContext().agenda.map((a) => [a.name, a.minutes]), [['決定事項の確認', 10], ['案の比較', 15]]);
});
