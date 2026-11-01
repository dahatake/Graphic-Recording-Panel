// FR-094 AC-553〜557 の単体・結合テスト（議事項目。契約: tests/system/CONTRACT-MEETING.md）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { extractKinds, parseItems, minutesSections } from '../../web/src/minutes.js';

const say = (app, env, text) => { app.setDraft(text); assert.equal(app.submitDraft().ok, true, text); env.tick(1); };

// FR-094 AC-553（PARAM-126〜129）
test('FR-094 AC-553: 規則抽出は言い回しの部分一致・大文字小文字を区別せず、複数に当てはまる発話は該当する種類すべて', () => {
  assert.deepEqual(extractKinds('A案に決まりました'), ['decision']);
  assert.deepEqual(extractKinds('Price is PENDING'), ['pending']);
  assert.deepEqual(extractKinds('コストが心配です'), ['objection']);
  assert.deepEqual(extractKinds('Please add a TODO'), ['action']);
  assert.deepEqual(extractKinds('採用を決定しますが、予算が心配なので確認してください'), ['decision', 'objection', 'action']);
  assert.deepEqual(extractKinds('普通に進めます'), []);
});

test('FR-094 AC-553: 候補は利用者の確定・却下・編集だけで変わり、却下した候補は同じ発話から再び出ない。確定するまで出力に出ない', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  say(app, env, 'リリースはA案に決まりました');
  say(app, env, '価格は検討中ですが、スケジュールが心配です');
  let it = app.getMeetingItems();
  assert.equal(it.candidateCount, 3);
  assert.ok(it.decisions[0].state === 'candidate' && it.pendings.length === 1 && it.objections.length === 1);
  assert.equal(it.pendings[0].sourceUtteranceId, it.objections[0].sourceUtteranceId);
  assert.ok(app.renderOutline().includes('候補') && app.renderOutline().includes('data-candidate-mark'));
  assert.ok(!app.renderMinutes().includes('data-state="confirmed"'));
  // 却下 → 再び候補にならない
  assert.equal(app.rejectMeetingItem(it.objections[0].id).ok, true);
  assert.equal(app.getMeetingItems().objections.length, 0);
  env.tick(1); say(app, env, '別の発話です');
  assert.equal(app.getMeetingItems().objections.length, 0, '却下した候補は再び出ない');
  // 編集・確定
  const d = it.decisions[0];
  assert.equal(app.editMeetingItem(d.id, { text: '  A案で進める  ' }).ok, true);
  assert.equal(app.editMeetingItem(d.id, { text: '   ' }).ok, false);
  assert.equal(app.confirmMeetingItem(d.id).ok, true);
  it = app.getMeetingItems();
  assert.equal(it.decisions[0].state, 'confirmed');
  assert.equal(it.decisions[0].text, 'A案で進める');
  assert.equal(it.candidateCount, 1);
  assert.equal(app.confirmMeetingItem('nope').ok, false);
  assert.equal(app.rejectMeetingItem('nope').ok, false);
  assert.equal(app.editMeetingItem('nope', { text: 'x' }).ok, false);
});

// FR-094 AC-554 AC-555
test('FR-094 AC-554 AC-555: 理由・決定者・担当者・期限・完了条件は自動で補わず null、表示は「未定」。発話の日付の語は期限にならない', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  say(app, env, '来週までに見積もりの確認をお願いします');
  const a = app.getMeetingItems().actions[0];
  assert.equal(a.assignee, null); assert.equal(a.due, null); assert.equal(a.doneCriteria, null);
  app.confirmMeetingItem(a.id);
  assert.equal(app.getMeetingItems().actions[0].due, null);
  const h = app.renderOutline();
  assert.ok((h.match(/未定/g) ?? []).length >= 3);
  assert.equal(app.editMeetingItem(a.id, { assignee: '佐藤', due: '2026-11-10' }).ok, true);
  const b = app.getMeetingItems().actions[0];
  assert.deepEqual([b.assignee, b.due, b.doneCriteria], ['佐藤', '2026-11-10', null]);
  const dec = app.addMeetingItem('decision', { text: '予算を承認', reason: '', decider: '部長' });
  assert.equal(dec.ok, true);
  const d = app.getMeetingItems().decisions.find((x) => x.id === dec.id);
  assert.deepEqual([d.state, d.reason, d.decider], ['confirmed', null, '部長']);
  assert.equal(app.addMeetingItem('objection', { text: '懸念', relatedDecisionId: dec.id }).ok, true);
  assert.equal(app.addMeetingItem('objection', { text: '懸念', relatedDecisionId: 'zzz' }).ok, false);
  assert.equal(app.addMeetingItem('pending', { text: '  ' }).ok, false);
  assert.equal(app.addMeetingItem('bogus', { text: 'x' }).ok, false);
});

// FR-094 AC-556
test('FR-094 AC-556: Markdown・HTML に確定した項目だけが節として出る（候補は出ず「未確定の候補 n 件」）', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  say(app, env, 'A案に決まりました'); say(app, env, '価格は検討中です');
  env.scheduler.advance(3000);
  app.confirmMeetingItem(app.getMeetingItems().decisions[0].id);
  await app.commands['save.markdown']();
  const md = String(env.downloads.at(-1).data);
  assert.match(md, /## 決定事項\n\n- A案に決まりました（理由: 未定 \/ 決定者: 未定）/);
  assert.match(md, /## 保留事項\n\n- なし/);
  assert.match(md, /未確定の候補 1 件/);
  assert.ok(!md.includes('価格は検討中です'));
  await app.commands['save.html']();
  const html = String(env.downloads.at(-1).data);
  assert.match(html, /<h2>決定事項<\/h2><ul><li>A案に決まりました/);
  assert.match(html, /<h2>保留事項<\/h2><p>なし<\/p>/);
  assert.match(html, /未確定の候補 1 件/);
  assert.ok(!html.match(/<div class="minutes" data-minutes>[\s\S]*?<\/div>/)[0].includes('価格は検討中です'), '候補は議事項目の節に出ない');
});

test('FR-094 AC-556: minutesSections は確定した項目だけを節にする', () => {
  const items = { decisions: [{ id: 'd', state: 'confirmed', text: 'X', reason: null, decider: null }, { id: 'c', state: 'candidate', text: 'Y' }], pendings: [], objections: [{ id: 'o', state: 'confirmed', text: 'Z', relatedDecisionId: 'd' }], actions: [], candidateCount: 1 };
  const s = minutesSections(items, { decisions: 'D', pendings: 'P', objections: 'O', actions: 'A', undecided: '未定', reason: 'r', decider: 'd', related: 'rel', assignee: 'a', due: 'u', doneCriteria: 'c' });
  assert.deepEqual(s[0].lines, ['X（r: 未定 / d: 未定）']);
  assert.deepEqual(s[2].lines, ['Z（rel: X）']);
});

// FR-094 AC-557
test('FR-094 AC-557: 議事項目は保存・復元・ファイル・初期化の対象で、生成 AI への送信には含まれない', async () => {
  const { app, env, createApp } = await newApp();
  app.commands['session.start']();
  say(app, env, 'A案に決まりました'); say(app, env, '価格は検討中です');
  const it = app.getMeetingItems();
  app.confirmMeetingItem(it.decisions[0].id);
  app.rejectMeetingItem(it.pendings[0].id);
  app.addMeetingItem('action', { text: '資料作成', assignee: '田中' });
  app.flushSave?.();
  const app2 = await createApp(env.options);
  const r = app2.getMeetingItems();
  assert.equal(r.decisions[0].state, 'confirmed');
  assert.equal(r.pendings.length, 0, '却下は復元後も残る');
  assert.equal(r.actions[0].assignee, '田中');
  assert.equal((await app.commands['file.save']()).ok, true);
  const dl = env.downloads.at(-1);
  assert.equal(app.commands['data.reset']().ok, true);
  assert.equal((await app.dialogAction('confirm')).ok, true);
  const e = app.getMeetingItems();
  assert.deepEqual([e.decisions.length, e.actions.length, e.candidateCount], [0, 0, 0]);
  assert.equal((await app.loadSessionFile({ name: dl.filename, type: dl.mime, size: String(dl.data).length, text: String(dl.data) })).ok, true);
  assert.equal(app.getMeetingItems().actions[0].text, '資料作成');
  assert.ok(app.renderOutline().includes('アクション項目') && app.renderOutline().includes('決定事項'));
  assert.deepEqual(parseItems({ items: [{ id: 'x', kind: 'bogus', state: 'confirmed', text: 't' }, { id: 'y', kind: 'pending', state: 'candidate', text: 't' }] }).items.map((i) => i.id), ['y']);
});
