// NFR-PERF-003 AC-538（integration）: 手描き（FR-112）の操作のうち、発話・シーン・線を変えないもの（モード・道具・色・全消去の確認の開閉・拒否の通知・線のない間の表示切替）は、
// データの版数を上げず、図・文字列・アウトラインの再生成と自動保存を起こさない。線を変える操作と、線があるときの表示切替は版数を上げて図を作り直す（対照）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';

async function setup() {
  let ctx;
  const r = await newApp({ options: { modules: [(c) => { ctx = c; }] } });
  const { app, env } = r;
  app.commands['session.start']();
  ctx.addUtterances(Array.from({ length: 300 }, (_, i) => `発話${i} 予算とリリース計画について確認する`));
  app.commands['session.pause']();
  env.scheduler.advance(1000);
  return r;
}

test('NFR-PERF-003 AC-538: 手描きのモード・道具・色・確認の開閉・拒否・（線なしの）表示切替では、版数・自動保存・図の再生成が動かない', async () => {
  const { app, env } = await setup();
  let svg = 0; const base = app.renderSvg; app.renderSvg = (...a) => { svg++; return base(...a); };
  let writes = 0; const set = env.storage.setItem.bind(env.storage); env.storage.setItem = (k, v) => { if (k === 'grp.session') writes++; set(k, v); };
  const ver = app.getRenderVersion(); const calls = app.getCallCounts().autosave ?? 0;
  let notified = 0; app.subscribe(() => { notified++; });
  for (let i = 0; i < 10; i++) {
    app.toggleDraw(); app.toggleDrawEraser(); app.setDrawColor(i % 2 ? 'red' : 'blue');
    app.drawPointer('down', { x: 1, y: 1 }); // 線を引ける状態でも down だけでは版数を変えない
    app.drawPointer('cancel');
    app.requestDrawClear(); // 線がない → 通知だけ
    app.undoDraw(); app.redoDraw();
    app.toggleDrawVisibility(); app.toggleDrawVisibility();
  }
  env.scheduler.advance(2000);
  assert.ok(notified > 0, '画面への通知は行われる（操作が無視されていない）');
  assert.equal(app.getRenderVersion(), ver, 'データの版数が変わった');
  assert.equal(writes, 0, '自動保存の書き込み');
  assert.equal((app.getCallCounts().autosave ?? 0) - calls, 0, '自動保存の直列化');
  assert.equal(svg, 0, '図の SVG の再生成');
});

test('NFR-PERF-003 AC-538（対照）: 線を足す・線があるときの表示切替は版数を上げ、図を作り直す。出力は従来どおり', async () => {
  const { app } = await setup();
  app.toggleDraw();
  const v0 = app.getRenderVersion();
  app.drawPointer('down', { x: 10, y: 10 }); app.drawPointer('move', { x: 30, y: 30 }); app.drawPointer('up', { x: 40, y: 40 });
  assert.ok(app.getRenderVersion() > v0, '線を足したのに版数が変わらない');
  const v1 = app.getRenderVersion();
  app.toggleDrawVisibility();
  assert.ok(app.getRenderVersion() > v1, '線があるときの表示切替で版数が変わらない');
  assert.match(app.renderSvg(), /data-role="draw-layer"[^>]*display="none"/);
  app.toggleDrawVisibility();
  assert.match(app.renderSvg(), /data-role="draw-layer"/);
});
