// NFR-PERF-002 / NFR-PERF-003 / NFR-PERF-004（System Test。実ブラウザで計測。PARAM-076〜080）
// integration の AC（AC-400・AC-403・AC-538〜540）はここでは扱わない。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PERF, serveWeb, launch, openApp, p95, measureStart, measureStop, settle, clickHoverRounds, dragAndScroll, startRecording, emit, emitMany, growTo, sessionOf, command } from './perf-util.js';

let srv; let browser;
before(async () => { srv = await serveWeb(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.close(); });

async function withApp(fn) {
  const { ctx, page } = await openApp(browser, srv.url);
  try { return await fn(page, ctx); } finally { await ctx.close(); }
}
// 揺らぎ対策: 計測前に 1 巡の予行をして JIT・初回レイアウトを済ませる。
const warm = async (page) => { await clickHoverRounds(page, 3); await settle(page); };

function assertResponsive(r, label) {
  assert.ok(r.lat.length > 0, `${label}: 入力 → 描画の計測が 0 件`);
  assert.ok(p95(r.lat) <= PERF.RESPONSE_MS, `${label}: 95 パーセンタイル ${p95(r.lat).toFixed(1)}ms > ${PERF.RESPONSE_MS}ms`);
}
function assertSmooth(r, label) {
  assert.ok(r.fps >= PERF.MIN_FPS, `${label}: 平均 ${r.fps.toFixed(1)}fps < ${PERF.MIN_FPS}fps`);
  const worst = Math.max(0, ...r.long);
  assert.ok(worst <= PERF.RESPONSE_MS, `${label}: 長いタスク ${worst.toFixed(1)}ms > ${PERF.RESPONSE_MS}ms`);
}

// NFR-PERF-002 AC-395
test('NFR-PERF-002 AC-395: 読み込み完了から 2 秒以内に、コマンドバーのボタンのクリックが画面に反映される（準備中）', async () => {
  const { ctx, page } = await openApp(browser, srv.url);
  try {
    const before = await page.evaluate(() => ({ s: document.querySelector('#session-status')?.textContent ?? '', t: performance.now() }));
    await page.locator('#toolbar [data-command="session.start"]').click();
    await page.waitForFunction((s) => (document.querySelector('#session-status')?.textContent ?? '') !== s, before.s, { timeout: PERF.FIRST_SEC * 1000 });
    const elapsed = await page.evaluate(() => performance.now() - (performance.getEntriesByType('navigation')[0]?.loadEventEnd ?? 0));
    assert.ok(elapsed <= PERF.FIRST_SEC * 1000, `読み込み完了から ${(elapsed / 1000).toFixed(2)} 秒 > ${PERF.FIRST_SEC} 秒`);
  } finally { await ctx.close(); }
});

// NFR-PERF-002 AC-395（異常系: 反応しないボタン＝無反応は許されない。押せるボタンが 1 つもない状態を失敗とする）
test('NFR-PERF-002 AC-395: 準備中でコマンドバーに押せるボタンが存在し、読み込み完了直後に操作できる', async () => {
  await withApp(async (page) => {
    const n = await page.locator('#toolbar button:not([disabled])').count();
    assert.ok(n > 0, '押せるコマンドバーのボタンがない');
  });
});

// NFR-PERF-002 AC-396
test('NFR-PERF-002 AC-396: 準備中でコマンドバー・パネル・図へのクリックとホバー各 20 回の入力 → 次の描画が 95 パーセンタイルで 100ms 以内', async () => {
  await withApp(async (page) => {
    await warm(page);
    await measureStart(page);
    await clickHoverRounds(page, 20);
    await settle(page);
    assertResponsive(await measureStop(page), 'クリック・ホバー');
  });
});

// NFR-PERF-002 AC-397
test('NFR-PERF-002 AC-397: パネルのドラッグ・図のスクロール・ホイールの間、平均 30fps 以上で、100ms を超える長いタスクがない', async () => {
  await withApp(async (page) => {
    await warm(page);
    await measureStart(page);
    await dragAndScroll(page);
    assertSmooth(await measureStop(page), 'ドラッグ・スクロール');
  });
});

// NFR-PERF-003 AC-398
test('NFR-PERF-003 AC-398: 記録中に発話を連続して追加している間も、クリック・ホバーの入力 → 次の描画が 95 パーセンタイルで 100ms 以内', async () => {
  await withApp(async (page) => {
    await startRecording(page);
    await page.waitForFunction(() => globalThis.__app.getState().session === 'recording');
    await warm(page);
    const feeder = page.evaluate(async () => { for (let i = 0; i < 120; i++) { window.__emit(`連続発話${i} 来月のリリース計画を決める`, true); await new Promise((r) => setTimeout(r, 40)); } });
    await measureStart(page);
    await clickHoverRounds(page, 20);
    const r = await measureStop(page);
    await feeder;
    assertResponsive(r, '記録中のクリック・ホバー');
    const n = await page.evaluate(() => globalThis.__app.getState().utterances.length);
    assert.ok(n > 20, `記録中に発話が追加され続けていない（${n} 件）`);
  });
});

// NFR-PERF-003 AC-399
test('NFR-PERF-003 AC-399: 500 件の発話の状態で、スクロール・ホイール・ドラッグが平均 30fps 以上、クリック・ホバーが 95 パーセンタイル 100ms 以内', async () => {
  await withApp(async (page) => {
    await startRecording(page);
    await emitMany(page, PERF.BIG_UTTERANCES);
    await page.waitForFunction((n) => globalThis.__app.getState().utterances.length >= n, PERF.BIG_UTTERANCES, { timeout: 30000 });
    await settle(page);
    await warm(page);
    await measureStart(page);
    await dragAndScroll(page);
    assertSmooth(await measureStop(page), '500 件のドラッグ・スクロール');
    await measureStart(page);
    await clickHoverRounds(page, 20);
    await settle(page);
    assertResponsive(await measureStop(page), '500 件のクリック・ホバー');
  });
});

// NFR-PERF-003 AC-401（NFR-PERF-001 AC-038: 要点の表示が発話から 3 秒以内）
test('NFR-PERF-003 AC-401: 記録中・500 件でも、新しい発話の要点が 3 秒以内に図へ表示される（AC-038）', async () => {
  await withApp(async (page) => {
    await startRecording(page);
    await emitMany(page, PERF.BIG_UTTERANCES);
    await page.waitForFunction((n) => globalThis.__app.getState().utterances.length >= n, PERF.BIG_UTTERANCES, { timeout: 30000 });
    const text = '最後に追加する検証用の発言です';
    const t0 = Date.now();
    await emit(page, text);
    await page.waitForFunction((t) => globalThis.__app.getState().scenes.some((s) => s.points.some((p) => p.text.includes(t))) || globalThis.__app.renderSvg().includes(t), text, { timeout: PERF.UPPER_SEC * 1000 });
    assert.ok(Date.now() - t0 <= PERF.UPPER_SEC * 1000 + 500, `要点の表示に ${(Date.now() - t0)}ms`);
  });
});

// NFR-PERF-003 AC-401（NFR-BG-001 AC-063・AC-065: 非表示中の発話が欠落しない）
test('NFR-PERF-003 AC-401: 記録中・500 件で非表示にしても、非表示中の発話が欠落せず記録中のまま保たれる（AC-063・AC-065）', async () => {
  await withApp(async (page) => {
    await startRecording(page);
    await emitMany(page, PERF.BIG_UTTERANCES);
    await page.waitForFunction((n) => globalThis.__app.getState().utterances.length >= n, PERF.BIG_UTTERANCES, { timeout: 30000 });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const words = ['非表示中その一', '非表示中その二', '非表示中その三'];
    for (const w of words) await emit(page, w);
    await page.waitForFunction((n) => globalThis.__app.getState().utterances.length >= n + 3, PERF.BIG_UTTERANCES, { timeout: 10000 });
    const st = await page.evaluate(() => { const s = globalThis.__app.getState(); return { session: s.session, texts: s.utterances.map((u) => u.text) }; });
    assert.equal(st.session, 'recording');
    for (const w of words) assert.ok(st.texts.includes(w), `${w} が欠落`);
  });
});

// NFR-PERF-003 AC-536: 一時停止のセッションで、PARAM-005 件と PARAM-106 件の操作応答を比べる（データ量に比例しない）。
// 計測 1 回分: クリック・ホバー（コマンドバー・パネル・図に各 20 回）と、ドラッグ・スクロール・ホイール。
async function measurePaused(page, n) {
  if ((await sessionOf(page)) === 'paused') await command(page, 'session.resume');
  await growTo(page, n);
  await command(page, 'session.pause');
  await page.waitForFunction(() => globalThis.__app.getState().session === 'paused');
  await settle(page);
  await warm(page);
  await measureStart(page);
  await clickHoverRounds(page, 20);
  await settle(page);
  const ch = await measureStop(page);
  await measureStart(page);
  await dragAndScroll(page);
  const dr = await measureStop(page);
  const after = await page.evaluate(() => { const s = globalThis.__app.getState(); return { n: s.utterances.length, session: s.session }; });
  return { ch, dr, after };
}
test('NFR-PERF-003 AC-536: 一時停止のセッションで、5000 件のクリック・ホバーが 95 パーセンタイル 100ms 以内かつ 100 件からの増分 20% 以内（16ms 未満は合格）、ドラッグ・スクロール 30fps 以上、100ms 超の長いタスク 0 件', async () => {
  await withApp(async (page) => {
    await startRecording(page);
    const base = await measurePaused(page, PERF.BASE_UTTERANCES);
    const huge = await measurePaused(page, PERF.HUGE_UTTERANCES);
    // 計測の前提（異常系: 計測が 0 件・件数が足りない・操作でデータや状態が変わるなら判定しない＝失敗）
    for (const [label, r, n] of [['基準', base, PERF.BASE_UTTERANCES], ['大量', huge, PERF.HUGE_UTTERANCES]]) {
      assert.ok(r.ch.lat.length >= 40, `${label}: クリック・ホバーの計測が ${r.ch.lat.length} 件しかない`);
      assert.ok(r.after.n >= n, `${label}: 発話が ${r.after.n} 件（${n} 件に達していない）`);
      assert.equal(r.after.session, 'paused', `${label}: 操作の後に一時停止のままでない`);
      assertSmooth(r.dr, `${label}（${n} 件）のドラッグ・スクロール`);
      const worstClick = Math.max(0, ...r.ch.long);
      assert.ok(worstClick <= PERF.RESPONSE_MS, `${label}（${n} 件）のクリック・ホバー中に長いタスク ${worstClick.toFixed(1)}ms > ${PERF.RESPONSE_MS}ms`);
    }
    assertResponsive(huge.ch, `${PERF.HUGE_UTTERANCES} 件のクリック・ホバー`);
    const b = p95(base.ch.lat); const h = p95(huge.ch.lat); const inc = h - b;
    assert.ok(inc < PERF.GROWTH_FLOOR_MS || inc <= b * PERF.GROWTH_PCT / 100,
      `データ量で応答が遅くなる: ${PERF.BASE_UTTERANCES} 件 ${b.toFixed(1)}ms → ${PERF.HUGE_UTTERANCES} 件 ${h.toFixed(1)}ms（増分 ${inc.toFixed(1)}ms > ${PERF.GROWTH_PCT}% かつ ≥ ${PERF.GROWTH_FLOOR_MS}ms）`);
  });
});

// NFR-PERF-003 AC-537: 5000 件のセッションを保存して再読込 → 読み込み完了から 2 秒以内にコマンドバーのクリックが反映、内容は AC-029 と同じく復元。
// 異常系: 再読込の直前に追加・一時停止した最後の発話も欠落しない。
test('NFR-PERF-003 AC-537: 5000 件のセッションを再読込しても、読み込み完了から 2 秒以内にコマンドバーのクリックが反映され、発話・シーン・要点が復元される', async () => {
  await withApp(async (page) => {
    const core = () => page.evaluate(() => { const s = globalThis.__app.getState(); return { u: s.utterances.map((x) => x.text), s: s.scenes.map((x) => ({ h: x.heading, p: x.points.map((q) => q.text) })) }; });
    await startRecording(page);
    await growTo(page, PERF.HUGE_UTTERANCES - 1);
    const last = '再読込の直前に追加した最後の発言';
    await emit(page, last);
    await page.waitForFunction((t) => globalThis.__app.getState().scenes.some((s) => s.points.some((p) => p.text.includes(t))) || globalThis.__app.renderSvg().includes(t), last, { timeout: PERF.UPPER_SEC * 1000 });
    await command(page, 'session.pause');
    await page.waitForFunction(() => globalThis.__app.getState().session === 'paused');
    const saved = await core();
    assert.equal(saved.u.length, PERF.HUGE_UTTERANCES);
    await page.reload({ waitUntil: 'load' }); // 保存の完了を待たずに再読込する
    await page.waitForFunction(() => !!globalThis.__app);
    const restored = await core();
    const st = await page.evaluate(() => document.querySelector('#session-status')?.textContent ?? '');
    await page.locator('#toolbar [data-command="session.resume"]').click({ timeout: PERF.FIRST_SEC * 1000 });
    await page.waitForFunction((s) => (document.querySelector('#session-status')?.textContent ?? '') !== s, st, { timeout: PERF.FIRST_SEC * 1000 });
    const elapsed = await page.evaluate(() => performance.now() - (performance.getEntriesByType('navigation')[0]?.loadEventEnd ?? 0));
    assert.ok(elapsed <= PERF.FIRST_SEC * 1000, `読み込み完了から ${(elapsed / 1000).toFixed(2)} 秒 > ${PERF.FIRST_SEC} 秒`);
    assert.equal(restored.u.length, PERF.HUGE_UTTERANCES, `復元された発話が ${restored.u.length} 件`);
    assert.ok(restored.u.includes(last), '再読込の直前の発話が欠落した');
    assert.deepEqual(restored, saved, '発話・シーン・要点が保存前と一致しない');
  });
});

// NFR-PERF-004 AC-402
test('NFR-PERF-004 AC-402: 準備中のまま 10 秒間操作せず置いたとき、メインスレッドの稼働率の平均が 5% 以下', async () => {
  await withApp(async (page, ctx) => {
    await settle(page);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const task = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;
    await page.waitForTimeout(500);
    const a = await task(); const t0 = Date.now();
    await page.waitForTimeout(10000);
    const b = await task(); const sec = (Date.now() - t0) / 1000;
    const pct = ((b - a) / sec) * 100;
    assert.ok(pct <= PERF.IDLE_CPU_PCT, `アイドル稼働率 ${pct.toFixed(2)}% > ${PERF.IDLE_CPU_PCT}%`);
  });
});
