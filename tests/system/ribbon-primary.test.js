// NFR-UX-003 AC-645 / AC-646（System Test。実ブラウザ＝Chromium 系を playwright-core で起動して測る。ribbon-viewport.test.js・perf.test.js と同じ方式）
// 期待値は受入基準だけから決める（実装は読まない。要素の場所は既存のテストが使う #toolbar [data-command="session.start"]・#ribbon-toggle・#diagram だけ）。
//  AC-645: リボンを折りたたんだ状態（起動時の既定・利用者の操作）でも、開始（session.start）と停止（session.stop）の主操作ボタンは
//          窓の内側に見え、ほかの要素に隠れず、操作できる。複製があるときも状態と名前は元と一致する。
//  AC-646: 窓 1024×768 の既定のタイルで、図の中の文字の画面上の高さが PARAM-163（10）px 以上。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serveWeb, launch, openApp, startRecording, emit, settle } from './perf-util.js';

const PARAM_163 = 10; // PARAM-163: 図の中の文字の画面上の高さの下限（px）
const WIN = { width: 1024, height: 768 }; // E2E-280（AC-641）と同じ窓

let srv; let browser;
before(async () => { srv = await serveWeb(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.close(); });

async function withApp(fn, viewport = WIN) {
  const { ctx, page } = await openApp(browser, srv.url, viewport);
  try { return await fn(page, ctx); } finally { await ctx.close(); }
}

// コマンド名ごとに、窓の内側にあり、中心点でヒットするのが自身（か子孫）である＝隠れていないボタンを探す。
async function visibleUnhidden(page, cmd) {
  return page.evaluate(({ cmd, w, h }) => {
    const out = [];
    for (const el of document.querySelectorAll(`[data-command="${cmd}"]`)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const shown = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
      const inside = r.left >= 0 && r.top >= 0 && r.right <= w && r.bottom <= h;
      let top = null;
      if (shown && inside) top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const hit = !!top && (el === top || el.contains(top) || top.contains(el));
      out.push({ shown, inside, hit, disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        name: (el.getAttribute('aria-label') || el.innerText || '').trim() });
    }
    return out;
  }, { cmd, w: WIN.width, h: WIN.height });
}

async function assertPrimaryVisible(page, label) {
  for (const cmd of ['session.start', 'session.stop']) {
    const all = await visibleUnhidden(page, cmd);
    assert.ok(all.length > 0, `${label}: ${cmd} のボタンが存在しない`);
    const ok = all.filter((b) => b.shown && b.inside && b.hit);
    assert.ok(ok.length > 0, `${label}: ${cmd} のボタンが窓の内側に見えない／ほかの要素に隠れている ${JSON.stringify(all)}`);
    // 複製があるときも、名前は元のボタンと一致する
    const names = new Set(all.map((b) => b.name));
    assert.equal(names.size, 1, `${label}: ${cmd} の複製どうしで名前が食い違う ${JSON.stringify([...names])}`);
    const states = new Set(all.map((b) => b.disabled));
    assert.equal(states.size, 1, `${label}: ${cmd} の複製どうしで有効・無効の状態が食い違う`);
  }
}

// リボンの開閉を利用者の操作（トグルのクリック）で目的の状態にする。PARAM-155 が 0 の間は起動時に折りたたまれないため、折りたたみは起動後の操作で作る。
async function setRibbon(page, expanded) {
  const toggle = page.locator('#ribbon-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== String(expanded)) await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), String(expanded));
}

// NFR-UX-003 AC-645（利用者の操作での折りたたみ。起動時の既定では折りたたまれない）
test('NFR-UX-003 AC-645: 窓 1024×768 で起動後にリボンを折りたたんだ状態で、開始と停止の主操作ボタンが窓の内側に見えて隠れず、開始を押せる', async () => {
  await withApp(async (page) => {
    await setRibbon(page, false);
    await assertPrimaryVisible(page, '折りたたみ（起動時の既定）');
    // 操作できる: 見えている開始ボタンを実際に押すと、セッションの状態表示が変わる。
    const start = (await page.$$('[data-command="session.start"]'));
    let clicked = false;
    const before = await page.locator('#session-status').innerText();
    for (const h of start) { if (await h.isVisible()) { await h.click({ timeout: 3000 }); clicked = true; break; } }
    assert.ok(clicked, '見えている開始ボタンがない');
    await page.waitForFunction((s) => (document.querySelector('#session-status')?.textContent ?? '') !== s, before, { timeout: 3000 });
  });
});

// NFR-UX-003 AC-645 異常系: 利用者の操作（開く→閉じる）で折りたたんだ後も同じ。記録中は停止が押せて、停止すると状態が変わる。
test('NFR-UX-003 AC-645 異常系: 開いてから折りたたみ直した状態でも主操作ボタンが見え、記録中に折りたたんだままで停止の操作ができる', async () => {
  await withApp(async (page) => {
    await setRibbon(page, true);
    await setRibbon(page, false); // 利用者の操作で折りたたまれた
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertPrimaryVisible(page, '折りたたみ（利用者の操作）');
    await startRecording(page);
    await page.waitForFunction(() => globalThis.__app.getState().session === 'recording');
    await assertPrimaryVisible(page, '記録中の折りたたみ');
    const stops = await page.$$('[data-command="session.stop"]');
    let clicked = false;
    for (const h of stops) { if (await h.isVisible() && await h.isEnabled()) { await h.click({ timeout: 3000 }); clicked = true; break; } }
    assert.ok(clicked, '記録中に見えて押せる停止ボタンがない');
    await page.waitForFunction(() => globalThis.__app.getState().session === 'stopped', null, { timeout: 5000 });
  });
});

// NFR-UX-003 AC-646: 窓 1024×768 の既定のタイルで、図の中の文字の画面上の高さ（縮小表示を含む）が PARAM-163 以上。
async function diagramTextSizes(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#diagram');
    const res = [];
    for (const t of host.querySelectorAll('svg text, svg tspan')) {
      if (t.tagName.toLowerCase() === 'tspan' && t.parentElement?.tagName.toLowerCase() === 'text') continue;
      const txt = (t.textContent ?? '').trim();
      if (!txt) continue;
      const cs = getComputedStyle(t);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const m = t.getScreenCTM();
      const scale = m ? Math.hypot(m.a, m.b) : 1;
      const fs = parseFloat(cs.fontSize) || 0;
      res.push({ text: txt.slice(0, 20), px: fs * scale });
    }
    return res;
  });
}

test('NFR-UX-003 AC-646: 窓 1024×768 の既定のタイルで、図の中の文字の画面上の高さが PARAM-163（10px）以上', async () => {
  await withApp(async (page) => {
    await startRecording(page);
    await page.waitForFunction(() => globalThis.__app.getState().session === 'recording');
    for (const t of ['来月のリリース計画を決める', '予算は先に確認する必要がある', 'テストの担当者を割り当てる', '課題は人手が足りないことだ', '次回の会議で進み具合を確認する']) await emit(page, t);
    await page.waitForFunction(() => globalThis.__app.getState().scenes.length > 0, null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#diagram svg text').length > 0, null, { timeout: 15000 });
    await settle(page);
    const sizes = await diagramTextSizes(page);
    assert.ok(sizes.length > 0, '図の中に文字がない（計測できない）');
    const small = sizes.filter((s) => s.px < PARAM_163 - 0.01);
    assert.equal(small.length, 0, `画面上の高さが ${PARAM_163}px 未満の文字がある: ${JSON.stringify(small.slice(0, 5))}`);
  });
});

// NFR-UX-003 AC-646 異常系: 図が多いとき（要点が増えて縮小表示になりやすい）でも下回らない。
test('NFR-UX-003 AC-646 異常系: 発話が増えて図が大きくなっても、窓 1024×768 の既定のタイルで文字の画面上の高さが PARAM-163 以上', async () => {
  await withApp(async (page) => {
    await startRecording(page);
    await page.waitForFunction(() => globalThis.__app.getState().session === 'recording');
    await page.evaluate(() => { for (let i = 0; i < 30; i++) window.__emit(`議題${i} 担当と期限を決めて進める`, true); });
    await page.waitForFunction(() => globalThis.__app.getState().utterances.length >= 30, null, { timeout: 15000 });
    await settle(page);
    await page.waitForFunction(() => document.querySelectorAll('#diagram svg text').length > 0, null, { timeout: 15000 });
    const sizes = await diagramTextSizes(page);
    assert.ok(sizes.length > 0, '図の中に文字がない（計測できない）');
    const small = sizes.filter((s) => s.px < PARAM_163 - 0.01);
    assert.equal(small.length, 0, `画面上の高さが ${PARAM_163}px 未満の文字がある: ${JSON.stringify(small.slice(0, 5))}`);
  });
});
