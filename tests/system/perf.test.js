// NFR-PERF-002 / NFR-PERF-003 / NFR-PERF-004（System Test。実ブラウザで計測。PARAM-076〜080）
// integration の AC（AC-400・AC-403）はここでは扱わない。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PERF, serveWeb, launch, openApp, p95, measureStart, measureStop, settle, clickHoverRounds, dragAndScroll, startRecording, emit, emitMany } from './perf-util.js';

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
