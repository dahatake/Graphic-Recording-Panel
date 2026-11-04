// NFR-UX-003 AC-641（System Test。実ブラウザ＝Chromium 系を playwright-core で起動して測る。perf.test.js と同じ方式）
// 変更（依頼 2026-11-04）: PARAM-155（リボンを折りたたんで起動する窓の高さの上限）が 900 → 0 になった。
// 期待値は受入基準だけから決める:
//  (a) PARAM-155 が 0 の間は「該当する窓」がなく、保存された開閉状態がなければリボンは開いて始まる（AC-660 の 1 段）。
//      窓の高さが 900 px 未満（1024×768・1280×720）でも折りたたんで始まらない（旧挙動＝折りたたみ起動の否定）。
//  (b) 窓 1024×768 で、リボンを開いた状態・折りたたんだ状態のどちらでも、作業領域（#workspace）の高さは窓の高さの PARAM-156（55）% 以上。
//  (c) 折りたたむ機能は維持され、開閉ボタン #ribbon-toggle のラベルは常に表示され、1 操作で開閉できる（AC-579）。
//      折りたたんだ後は上部と作業領域が 1 画面に収まる。上部が高いときは縦スクロールで上部の全項目へ到達できる。
// 要求 ID: NFR-UX-003（AC-641）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PERF, serveWeb, launch } from './perf-util.js';

let srv; let browser;
before(async () => { srv = await serveWeb(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.close(); });

async function open(size) {
  const ctx = await browser.newContext({ viewport: size });
  const page = await ctx.newPage();
  await page.goto(srv.url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!globalThis.__app && document.querySelectorAll('#toolbar button').length > 0);
  return { ctx, page };
}
const rect = (page, sel) => page.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom, height: r.height, width: r.width } : null; }, sel);
const expanded = (page) => page.locator('#ribbon-toggle').getAttribute('aria-expanded');

for (const size of [{ width: 1024, height: 768 }, { width: 1280, height: 720 }]) {
  const name = `${size.width}×${size.height}`;

  // NFR-UX-003 AC-641 PARAM-155=0: 高さによる既定の折りたたみがない（開いて始まる）。開いたまま作業領域は窓の PARAM-156 % 以上。
  test(`AC-641 PARAM-155=0: 窓 ${name}（高さ ${size.height} < 旧値 900）でも、保存された開閉状態がなければリボンは開いて始まり（折りたたまない）、作業領域は窓の高さの ${PERF.PANEL_MIN_PCT}% 以上`, async () => {
    assert.equal(PERF.WINDOW_H_MAX, 0, 'PARAM-155 は 0（高さによる既定の折りたたみなし）');
    const { ctx, page } = await open(size);
    try {
      const btn = page.locator('#ribbon-toggle');
      assert.equal(await expanded(page), 'true', '起動時はリボンが開いている（aria-expanded=true。高さ 900 未満でも折りたたまない）');
      assert.ok(await page.locator('#toolbar').isVisible(), '開いて始まるのでリボンの項目が表示される');
      assert.ok((await btn.innerText()).trim().length > 0, '開閉ボタンのラベルは常に表示される');
      const ws = await rect(page, '#workspace');
      assert.ok(ws, '作業領域 #workspace がある');
      assert.ok(ws.height >= size.height * PERF.PANEL_MIN_PCT / 100, `リボンを開いた状態の作業領域 ${ws.height}px < 窓の高さ ${size.height}px の ${PERF.PANEL_MIN_PCT}%`);
    } finally { await ctx.close(); }
  });

  // NFR-UX-003 AC-641 異常系・維持: 折りたたむ機能（1 操作）は維持される。折りたたんだ後は 1 画面に収まり作業領域は 55% 以上。再び 1 操作で開ける。
  test(`AC-641 異常系: 窓 ${name} でリボンを 1 操作で折りたためて（ラベルは表示のまま）、1 画面に収まり作業領域は ${PERF.PANEL_MIN_PCT}% 以上、再び 1 操作で開き、上部の全項目へスクロールで到達できる`, async () => {
    const { ctx, page } = await open(size);
    try {
      const btn = page.locator('#ribbon-toggle');
      const buttons = page.locator('#toolbar button:not([disabled])');
      const n = await buttons.count();
      assert.ok(n > 0, 'リボンに操作できる項目がある');
      for (const i of [0, n - 1]) { // 先頭と末尾の項目へ、ページ全体のスクロールで到達できる
        const b = buttons.nth(i);
        await b.scrollIntoViewIfNeeded();
        const r = await b.boundingBox();
        assert.ok(r && r.y >= 0 && r.y + r.height <= size.height + 1, `項目 ${i} がスクロール後に窓の中に入る`);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await btn.click(); // 1 操作で折りたためる
      assert.equal(await expanded(page), 'false', '1 回の操作でリボンが折りたたまれる');
      assert.ok(await btn.isVisible(), '折りたたみ中も開閉ボタンが表示される');
      assert.ok((await btn.innerText()).trim().length > 0, '折りたたみ中も開閉ボタンのラベルは常に表示される');
      assert.ok(!(await page.locator('#toolbar').isVisible()), '折りたたみ中はリボンの項目が表示範囲を占めない');
      await page.evaluate(() => window.scrollTo(0, 0));
      const ws = await rect(page, '#workspace');
      assert.ok(ws.height >= size.height * PERF.PANEL_MIN_PCT / 100, `折りたたんだ状態の作業領域 ${ws.height}px < 窓の高さの ${PERF.PANEL_MIN_PCT}%`);
      assert.ok(ws.bottom <= size.height + 1, `折りたたんだ後は上部と作業領域が 1 画面に収まる（作業領域の下端 ${ws.bottom}px > 窓 ${size.height}px）`);
      const top = await rect(page, '#ribbon-toggle');
      assert.ok(top.top >= 0 && top.bottom <= ws.top + 1, '開閉ボタンは作業領域の上にあり、重ならない');
      await btn.click();
      assert.equal(await expanded(page), 'true', '再び 1 操作で開ける');
      assert.ok(await page.locator('#toolbar').isVisible());
    } finally { await ctx.close(); }
  });
}
