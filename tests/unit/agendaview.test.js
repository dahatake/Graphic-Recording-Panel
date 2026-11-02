// FR-095 AC-611（AC-568: 持ち時間の既定と保存・復元、AC-569: 議題の表示とキー操作）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, keyFor } from '../system/helpers.js';
import { parseMinutes, AGENDA_LIMIT } from '../../web/src/agendaview.js';

const add = (app, name, minutes) => { app.setAgendaInput({ name, minutes: String(minutes) }); return app.submitAgendaInput(); };

// FR-095 AC-611: 持ち時間の入力は 1 以上の整数だけ
test('FR-095 AC-611: parseMinutes は正の整数だけを受け付け、上限は 30 件（PARAM-152）', () => {
  for (const ok of [1, 10, '5', ' 7 ', '１２']) assert.ok(parseMinutes(ok) >= 1, String(ok));
  for (const ng of [0, -1, 2.5, '2.5', 'abc', '', null, '0']) assert.equal(parseMinutes(ng), null, String(ng));
  assert.equal(AGENDA_LIMIT, 30);
});

// FR-095 AC-611 / FR-098 AC-568: 登録しない持ち時間は既定（10 分）で、画面の項目に既定と示される
test('FR-098 AC-568: 持ち時間なしの議題は既定の 10 分で動き、保存値は null のまま', async () => {
  const { app } = await newApp();
  app.setMeetingContext({ agenda: [{ name: '既定の議題' }] });
  app.commands['agenda.open']();
  const it = app.getAgendaView().items[0];
  assert.equal(it.minutes, 10);
  assert.equal(it.custom, false);
  assert.equal(app.getMeetingContext().agenda[0].minutes, null);
  assert.ok(app.renderAgendaView().includes('既定'));
});

// FR-095 AC-611: Tab・Enter・矢印・Delete・Esc だけで操作できる。閉じるとフォーカスが戻る
test('FR-095 AC-611: キーだけで追加・編集・並べ替え・削除・閉じるができる', async () => {
  const { app } = await newApp();
  const before = app.getFocusedElement();
  assert.equal(app.handleKey(keyFor(app, 'agenda.open')), 'agenda.open');
  assert.equal(app.getFocusedElement(), 'agenda.name');
  assert.deepEqual(app.getAgendaView().tabOrder.slice(0, 4), ['agenda.name', 'agenda.minutes', 'agenda.add', 'agenda.close']);
  app.setAgendaInput({ name: 'A', minutes: '5' });
  assert.equal(app.handleKey({ key: 'Enter' }), 'agenda.submit');
  add(app, 'B', 6);
  const [a, b] = app.getAgendaView().items.map((i) => i.id);
  while (app.getFocusedElement() !== `agenda.item.${b}`) app.handleKey({ key: 'Tab' });
  assert.equal(app.handleKey({ key: 'ArrowUp', shiftKey: true }), 'agenda.move');
  assert.deepEqual(app.getAgendaView().items.map((i) => i.name), ['B', 'A']);
  assert.equal(app.handleKey({ key: 'Enter' }), 'agenda.edit');
  assert.equal(app.getAgendaView().input.name, 'B');
  app.setAgendaInput({ name: 'B2', minutes: '9' });
  assert.equal(app.handleKey({ key: 'Enter' }), 'agenda.submit');
  assert.deepEqual(app.getAgendaView().items.map((i) => [i.name, i.minutes]), [['B2', 9], ['A', 5]]);
  assert.equal(app.getAgendaView().items[0].id, b, '編集で id は変わらない');
  app.focusAgenda(`agenda.item.${a}`);
  assert.equal(app.handleKey({ key: 'Delete' }), 'agenda.delete');
  assert.deepEqual(app.getAgendaView().items.map((i) => i.name), ['B2']);
  assert.equal(app.handleKey({ key: 'Escape' }), 'agenda.close');
  assert.equal(app.getFocusedElement(), before);
});

// FR-098 AC-569: 並べ替えても進行中の議題を id で追い、最後の議題の削除の確定でタイマーは待機に戻る
test('FR-098 AC-569: 進行中の議題の並べ替えに追従し、最後の議題を削除すると待機に戻る', async () => {
  const { app } = await newApp();
  app.commands['agenda.open']();
  add(app, 'X', 3); add(app, 'Y', 4);
  const [x, y] = app.getAgendaView().items.map((i) => i.id);
  assert.equal(app.commands['timer.start']().ok, true);
  assert.equal(app.moveAgendaItem(x, 'down').ok, true); // 進行中の X が 2 番目へ動く
  let t = app.getAgendaTimer();
  assert.equal(t.currentName, 'X'); assert.equal(t.nextName, '次の議題なし');
  assert.equal(app.moveAgendaItem(x, 'down').ok, false, '端では動かない');
  assert.equal(app.moveAgendaItem(x, 'up').ok, true);
  assert.equal(app.removeAgendaItem(x).pending, true);
  await app.dialogAction('confirm');
  t = app.getAgendaTimer();
  assert.equal(t.currentName, 'Y');
  assert.equal(t.state, 'running');
  assert.equal(app.getMeetingContext().agenda.length, 1);
  assert.equal(app.removeAgendaItem(y).pending, true);
  await app.dialogAction('confirm');
  assert.equal(app.getAgendaTimer().state, 'idle');
});

// FR-095 AC-611: 画面の文字列は escape される
test('FR-095 AC-611: 議題の名前は escape して描く', async () => {
  const { app } = await newApp();
  app.commands['agenda.open']();
  add(app, '<img src=x onerror=alert(1)>', 5);
  const html = app.renderAgendaView();
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});
