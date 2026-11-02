// NFR-UX-003 AC-641（System Test。実ブラウザ＝Chromium 系を playwright-core で起動して測る。perf.test.js と同じ方式）
// 期待値は受入基準だけから決める: 窓の高さが PARAM-155（900 px）未満（1024×768・1280×720）で起動すると、
//  (a) リボンは折りたたんだ状態で始まり（開閉ボタン #ribbon-toggle のラベルは常に表示され、1 操作で開ける。AC-579）、
//  (b) 作業領域（#workspace）の高さは窓の高さの PARAM-156（55）% 以上、
//  (c) 上部が高いときはページ全体を縦にスクロールして上部の全項目へ到達でき、折りたたんだ後は上部と作業領域が 1 画面に収まる。
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

for (const size of [{ width: 1024, height: 768 }, { width: 1280, height: 720 }]) {
  const name = `${size.width}×${size.height}`;

  // NFR-UX-003 AC-641
  test(`AC-641: 窓 ${name} で起動すると、リボンは折りたたみ（開閉ボタンのラベルは表示され、1 操作で開ける）、作業領域は窓の高さの ${PERF.PANEL_MIN_PCT}% 以上で、上部と作業領域が 1 画面に収まる`, async () => {
    assert.ok(size.height < PERF.WINDOW_H_MAX, `窓の高さ ${size.height} は PARAM-155（${PERF.WINDOW_H_MAX}）未満`);
    const { ctx, page } = await open(size);
    try {
      const btn = page.locator('#ribbon-toggle');
      assert.equal(await btn.getAttribute('aria-expanded'), 'false', '起動時はリボンが折りたたまれている（aria-expanded=false）');
      assert.ok(await btn.isVisible(), '折りたたみ中も開閉ボタンが表示される');
      const label = (await btn.innerText()).trim();
      assert.ok(label.length > 0, '開閉ボタンのラベルは常に表示される（文字）');
      const bar = await rect(page, '#toolbar');
      assert.ok(!bar || bar.height < 1 || !(await page.locator('#toolbar').isVisible()), '折りたたみ中はリボンの項目が表示範囲を占めない');
      const ws = await rect(page, '#workspace');
      assert.ok(ws, '作業領域 #workspace がある');
      assert.ok(ws.height >= size.height * PERF.PANEL_MIN_PCT / 100, `作業領域の高さ ${ws.height}px < 窓の高さ ${size.height}px の ${PERF.PANEL_MIN_PCT}%`);
      assert.ok(ws.bottom <= size.height + 1, `折りたたんだ後は上部と作業領域が 1 画面に収まる（作業領域の下端 ${ws.bottom}px > 窓 ${size.height}px）`);
      const top = await rect(page, '#ribbon-toggle');
      assert.ok(top.top >= 0 && top.bottom <= ws.top + 1, '開閉ボタンは作業領域の上にあり、重ならない');
    } finally { await ctx.close(); }
  });

  // NFR-UX-003 AC-641 異常系: 開いたとき上部が高くても、ページ全体の縦スクロールで上部の全項目に到達できる。閉じると 1 画面に戻る。
  test(`AC-641 異常系: 窓 ${name} でリボンを 1 操作で開くと上部の全項目へスクロールで到達でき、再び折りたたむと 1 画面に収まり、作業領域は ${PERF.PANEL_MIN_PCT}% 以上に戻る`, async () => {
    const { ctx, page } = await open(size);
    try {
      const btn = page.locator('#ribbon-toggle');
      await btn.click(); // 1 操作で開ける
      assert.equal(await btn.getAttribute('aria-expanded'), 'true', '1 回の操作でリボンが開く');
      assert.ok(await page.locator('#toolbar').isVisible());
      const label = (await btn.innerText()).trim();
      assert.ok(label.length > 0, '開いているときもラベルが表示される');
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
      await btn.click();
      assert.equal(await btn.getAttribute('aria-expanded'), 'false', '再び折りたためる');
      await page.evaluate(() => window.scrollTo(0, 0));
      const ws = await rect(page, '#workspace');
      assert.ok(ws.height >= size.height * PERF.PANEL_MIN_PCT / 100, `折りたたみ後の作業領域 ${ws.height}px`);
      assert.ok(ws.bottom <= size.height + 1, '折りたたみ後は 1 画面に収まる');
    } finally { await ctx.close(); }
  });
}
