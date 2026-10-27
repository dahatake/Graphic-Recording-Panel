// NFR-PERF-003 AC-400 / NFR-PERF-004 AC-403（integration）と、NFR-PERF-002/003 の描画合流の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';
import { coalesceFrame } from '../../web/src/frame.js';

const LIMIT_MS = 100; // PARAM-076
const BIG = 500; // PARAM-078
const HUGE = 5000; // PARAM-106

const timeIt = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };

async function mk() {
  let ctx; const app = await createApp({ now: () => 1_700_000_000_000, modules: [(c) => { ctx = c; }] });
  await app.commands['session.start']();
  return { app, ctx };
}

async function bigApp() {
  const { app, ctx } = await mk();
  for (let i = 0; i < BIG; i++) ctx.addUtterance(`発話${i} 予算とリリース計画について確認する`);
  return app;
}

// NFR-PERF-003 AC-400: 500 件と 5000 件（PARAM-078・PARAM-106）に対する図の更新計算（シーン・要点・トピック分類・配置）の 1 回の連続実行が 100ms を超えない
for (const N of [BIG, HUGE]) {
  test(`NFR-PERF-003 AC-400: 発話 ${N} 件で、1 回の発話追加・図・トピック分類・配置・アウトラインの算出が各 100ms 以内`, async () => {
    const { app, ctx } = await mk();
    const adds = [];
    for (let i = 0; i < N; i++) {
      const ms = timeIt(() => ctx.addUtterance(`発話${i} 予算とリリース計画について確認する`));
      adds.push(ms);
    }
    assert.equal(app.getState().utterances.length, N);
    // 並列実行する他のテストによる OS のスケジューリングの揺らぎ（実測の中央値は約 0.1ms）を除くため、99 パーセンタイルで判定する
    const p99 = [...adds].sort((a, b) => a - b)[Math.ceil(adds.length * 0.99) - 1];
    assert.ok(p99 <= LIMIT_MS, `発話追加 1 回の p99 ${p99.toFixed(1)}ms > ${LIMIT_MS}ms`);
    // 各算出は、直前にデータを変えて（キャッシュを無効にして）から 1 回の呼び出しの時間を測る。揺らぎを除くため 2 回の小さい方
    const fresh = (fn) => () => { app.selectScene(app.getState().scenes[0].id); return timeIt(fn); };
    for (const [name, fn] of [
      ['renderSvg', () => app.renderSvg()], ['renderOutline', () => app.renderOutline()], ['renderTranscript', () => app.renderTranscript()],
      ['getTopics', () => app.getTopics()], ['getTopicRelations', () => app.getTopicRelations()],
      ['getArrangeView', () => app.getArrangeView()], ['getDiagramLayout', () => app.getDiagramLayout()],
    ]) {
      const once = fresh(fn);
      const ms = Math.min(once(), once());
      assert.ok(ms <= LIMIT_MS, `${N} 件: ${name} 1 回 ${ms.toFixed(1)}ms > ${LIMIT_MS}ms`);
    }
  });
}

// NFR-PERF-003 AC-400（異常系）: 描画合流を入れても、状態は同期で正しく更新される（描画だけが遅れる）
test('NFR-PERF-003 AC-400: 描画の合流は状態の更新を遅らせない（発話は追加の呼び出しが返った時点で状態に入る）', async () => {
  const app = await bigApp();
  assert.equal(app.getState().utterances.length, BIG);
});

// NFR-PERF-004 AC-403: 変更・状態遷移の契機がなければ、再描画も予約も起きない
test('NFR-PERF-004 AC-403: 契機がない間は描画も予約も 0 回', () => {
  let rafCalls = 0; let renders = 0; const q = [];
  const s = coalesceFrame(() => { renders++; }, (f) => { rafCalls++; q.push(f); return rafCalls; }, () => {});
  assert.equal(rafCalls, 0); assert.equal(renders, 0); assert.equal(s.pending(), false);
  q.splice(0).forEach((f) => f());
  assert.equal(renders, 0);
});

// NFR-PERF-002 AC-396 / NFR-PERF-003 AC-399: 変更が続いても描画は 1 フレームに 1 回
test('NFR-PERF-002 AC-396 / NFR-PERF-003 AC-399: 連続した変更の通知は 1 フレームの描画 1 回に合流する', () => {
  let renders = 0; const q = [];
  const s = coalesceFrame(() => { renders++; }, (f) => { q.push(f); return q.length; }, () => {});
  for (let i = 0; i < 50; i++) s();
  assert.equal(q.length, 1); assert.equal(renders, 0); assert.equal(s.pending(), true);
  q.splice(0).forEach((f) => f());
  assert.equal(renders, 1); assert.equal(s.pending(), false);
  s(); assert.equal(q.length, 1); // 次の変更は次のフレームで
});

test('NFR-PERF-002 AC-396: flush は予約中の描画をその場で 1 回だけ実行する。raf がなければ同期に実行する', () => {
  let renders = 0; let cancelled = 0; const q = [];
  const s = coalesceFrame(() => { renders++; }, (f) => { q.push(f); return 1; }, () => { cancelled++; });
  s(); s.flush(); s.flush();
  assert.equal(renders, 1); assert.equal(cancelled, 1);
  let sync = 0; const d = coalesceFrame(() => { sync++; }, null, null);
  d(); d(); assert.equal(sync, 2);
});
