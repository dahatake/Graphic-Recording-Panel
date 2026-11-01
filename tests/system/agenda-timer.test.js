// FR-098 AC-569（議題タイマーの表示・キーボード操作・時刻差・復元後は待機）
// （System Test。契約: tests/system/CONTRACT-TIMER.md）
// 期待値は受入基準だけから決める。実装がなければ失敗するのが正常（not_run → 実装後に pass）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, keyFor, FakeVisibility } from './helpers.js';

const CTX = { agenda: [{ name: '現状の共有', minutes: 5 }, { name: '案の比較', minutes: 15 }] };

// FR-098 AC-569
test('FR-098 AC-569: 開始で現在の議題・残り（mm:ss）・次の議題が画面とテキスト一覧に出る。最後は「次の議題なし」。キーボードで操作でき、非表示でもずれず、復元後は待機に戻る', async () => {
  const vis = new FakeVisibility();
  const { app, env, createApp } = await newApp({ options: { visibility: vis } });
  await seedThreeScenes(app, env);

  // 異常系: 議題 0 件では開始できず、理由が示される
  const none = app.commands['timer.start']();
  assert.equal(none.ok, false, '議題 0 件は開始できない');
  assert.ok(String(none.reason || '').length > 0, '理由が示される');
  assert.equal(app.getAgendaTimer().state, 'idle');

  assert.equal(app.setMeetingContext(CTX).ok, true);
  assert.equal(app.commands['timer.start']().ok, true);
  let t = app.getAgendaTimer();
  assert.equal(t.state, 'running');
  assert.equal(t.currentName, '現状の共有');
  assert.equal(t.remainingText, '05:00');
  assert.equal(t.nextName, '案の比較');
  for (const html of [app.renderAgendaTimer(), app.renderOutline()]) {
    for (const w of ['現状の共有', '05:00', '案の比較']) assert.ok(html.includes(w), `画面・テキスト一覧に「${w}」`);
  }

  // 1 秒ごとの更新（scheduler）。時刻の差で求める
  env.tick(1); env.scheduler.advance(1000);
  assert.equal(app.getAgendaTimer().remainingText, '04:59');
  assert.ok(app.renderAgendaTimer().includes('04:59'), '表示も 1 秒ごとに更新');

  // 非表示（最小化）の間に時計だけ進んでもずれない
  vis.set(true);
  env.tick(60);
  vis.set(false);
  env.scheduler.advance(1000); env.tick(1);
  assert.equal(app.getAgendaTimer().remainingText, '03:58', '非表示の 60 秒を含めて時刻の差で求める');

  // キーボード: 一時停止・再開・次の議題
  for (const c of ['timer.pause', 'timer.resume', 'timer.next']) assert.ok(keyFor(app, c), `${c} がキーに割り当てられる`);
  assert.equal(app.handleKey(keyFor(app, 'timer.pause')), 'timer.pause');
  assert.equal(app.getAgendaTimer().state, 'paused');
  env.tick(30); env.scheduler.advance(30000);
  assert.equal(app.getAgendaTimer().remainingText, '03:58', '一時停止中は減らない');
  assert.equal(app.handleKey(keyFor(app, 'timer.resume')), 'timer.resume');
  assert.equal(app.getAgendaTimer().state, 'running');
  assert.equal(app.handleKey(keyFor(app, 'timer.next')), 'timer.next');
  t = app.getAgendaTimer();
  assert.equal(t.currentName, '案の比較');
  assert.equal(t.remainingText, '15:00');
  assert.equal(t.nextName, '次の議題なし', '最後の議題');
  assert.ok(app.renderAgendaTimer().includes('次の議題なし') && app.renderOutline().includes('次の議題なし'));

  // 復元後は進行中・一時停止も待機に戻る
  app.commands['timer.pause']();
  const app2 = await createApp(env.options);
  assert.equal(app2.getAgendaTimer().state, 'idle', '再読込の後は待機');
  const r = await app.commands['file.save']();
  assert.equal(r.ok, true);
  const dl = env.downloads.at(-1);
  assert.equal(app.commands['data.reset']().ok, true);
  assert.equal((await app.dialogAction('confirm')).ok, true);
  const l = await app.loadSessionFile({ name: dl.filename, type: dl.mime, size: String(dl.data).length, text: String(dl.data) });
  assert.equal(l.ok, true);
  assert.equal(app.getAgendaTimer().state, 'idle', 'セッションファイルの読込の後は待機');
});
