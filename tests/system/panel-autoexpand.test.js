// FR-074 AC-390 AC-393（System Test。実ブラウザ＝Chromium 系を playwright-core で起動して測る。diagram-fill.test.js と同じ方式）
// 期待値は受入基準（依頼 2026-11-04）だけから決める。実装は、起動方法・DOM の場所（[data-panel]・.panel-head の展開ボタン）を知るためにだけ使う。
//  AC-390: 認識文字列パネルが非表示、または副次パネル（AC-662）が折りたたまれているとき（既定・利用者の折りたたみのどちらも）、
//          音声認識の開始（[記録開始]・再開）で、パネルが表示され副次パネルが展開されて認識文字列パネルの内容が見える。
//          展開は音声認識の開始時の 1 回だけで、新しい認識文字列だけでは展開しない。すでに表示・展開されているときは変わらない。
//  AC-393: 自動表示・自動展開は保存された利用者のレイアウト（grp.layout）を書き換えない。開始せずに再読込すると保存済みのとおり
//          （非表示なら非表示、折りたたみなら折りたたみ）に復元される。
// 要求 ID: FR-074（AC-390・AC-393）。AC-662 の例外（図の領域は AC-661 の下限を下回ってよい）なので、展開後の図の面積は測らない。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serveWeb, launch, openApp, startRecording, emit, command } from './perf-util.js';

const LAYOUT_KEY = 'grp.layout';
let srv; let browser;
before(async () => { srv = await serveWeb(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.close(); });

const toggle = (page, key) => page.locator(`[data-panel="${key}"] .panel-head`).getByRole('button', { name: /展開|折りたた|expand|collapse/i }).first();
const expanded = async (page, key) => (await toggle(page, key).getAttribute('aria-expanded')) === 'true';
const inputVisible = (page) => page.evaluate(() => globalThis.__app.getLayout().panels.input.visible);
const saved = (page) => page.evaluate((k) => localStorage.getItem(k), LAYOUT_KEY);
const transcriptSeen = (page) => page.evaluate(() => { const el = document.querySelector('#transcript'); return !!el && el.checkVisibility() && el.getBoundingClientRect().height > 0; });
async function ready(page) { await page.waitForFunction(() => document.querySelector('[data-panel="input"]')?.checkVisibility()); }
// 利用者の操作で折りたたむ（保存される）。
async function userCollapse(page, key) { if (await expanded(page, key)) await toggle(page, key).click(); assert.equal(await expanded(page, key), false); }

// FR-074 AC-390 AC-393: 折りたたみ中の音声認識の開始で展開（1 回だけ）、保存は書き換えない。再読込で保存済みの折りたたみに復元される。
test('AC-390 AC-393: 折りたたみ中の音声認識の開始で副次パネルが展開され認識文字列が見える。新しい認識文字列だけでは再展開せず、再開の開始で再び展開される。保存済みのレイアウトは書き換えず、開始せず再読込すると折りたたみに復元される', async () => {
  const { ctx, page } = await openApp(browser, srv.url, { width: 1280, height: 720 });
  try {
    await ready(page);
    await userCollapse(page, 'input');
    await userCollapse(page, 'outline');
    const before = await saved(page);
    await startRecording(page);
    await page.waitForFunction(() => document.querySelector('[data-panel="input"] .panel-head button[aria-expanded]')?.getAttribute('aria-expanded') === 'true');
    assert.equal(await expanded(page, 'input'), true, '音声認識の開始で認識文字列パネルを含む副次パネルが展開される');
    assert.equal(await transcriptSeen(page), true, '認識文字列パネルの内容が見える');
    assert.equal(await saved(page), before, '自動展開は保存済みのレイアウトを書き換えない（AC-393）');
    // 展開は開始時の 1 回だけ: 利用者が折りたたんだ後、新しい認識文字列だけでは展開しない。
    await userCollapse(page, 'input');
    await emit(page, '新しい認識文字列 来月のリリース計画');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert.equal(await expanded(page, 'input'), false, '新しい認識文字列だけでは展開しない（見出しの印で通知する）');
    // 次の開始（一時停止→再開）で、再び展開される。
    await command(page, 'session.pause');
    await userCollapse(page, 'input');
    await command(page, 'session.resume');
    await page.waitForFunction(() => document.querySelector('[data-panel="input"] .panel-head button[aria-expanded]')?.getAttribute('aria-expanded') === 'true');
    // 保存済み（利用者の折りたたみ）のとおりに再読込で復元される（音声認識を開始しない）。
    const userSaved = await saved(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!globalThis.__app);
    await ready(page);
    assert.equal(await saved(page), userSaved, '再読込でも保存値は変わらない');
    assert.equal(await expanded(page, 'input'), false, '音声認識を開始せずに再読込すると、保存済みのとおり折りたたみで復元される');
  } finally { await ctx.close(); }
});

// FR-074 AC-390 AC-393: 非表示かつ折りたたみの状態からの開始で、表示と展開の両方。すでに表示・展開済みなら変わらない。保存は非表示のまま。
test('AC-390 AC-393: パネルが非表示（かつ折りたたみ）でも音声認識の開始で表示・展開され、保存値は非表示のまま。再読込で非表示に復元される。表示・展開済みの開始では状態が変わらない', async () => {
  const { ctx, page } = await openApp(browser, srv.url, { width: 1920, height: 1080 });
  try {
    await ready(page);
    await userCollapse(page, 'input');
    await page.evaluate(() => globalThis.__app.setPanelVisible('input', false));
    assert.equal(await inputVisible(page), false);
    const before = await saved(page);
    assert.ok(before, '利用者の非表示は保存されている');
    await startRecording(page);
    await page.waitForFunction(() => document.querySelector('[data-panel="input"]')?.checkVisibility());
    assert.equal(await inputVisible(page), true, '非表示でも音声認識の開始で表示される');
    assert.equal(await expanded(page, 'input'), true, '同時に展開される');
    assert.equal(await transcriptSeen(page), true, '認識文字列パネルの内容が見える');
    assert.equal(await saved(page), before, '自動表示・自動展開は保存値を書き換えない');
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!globalThis.__app);
    assert.equal(await inputVisible(page), false, '音声認識を開始せずに再読込すると保存済みのとおり非表示に復元される');
  } finally { await ctx.close(); }
});

test('AC-390 異常系: すでに表示・展開されているときは、音声認識の開始でそのまま変わらない（レイアウトも保存値も変わらない）', async () => {
  const { ctx, page } = await openApp(browser, srv.url, { width: 1280, height: 720 });
  try {
    await ready(page);
    if (!(await expanded(page, 'input'))) await toggle(page, 'input').click();
    assert.equal(await expanded(page, 'input'), true);
    const layout = await page.evaluate(() => JSON.stringify(globalThis.__app.getLayout()));
    const before = await saved(page);
    await startRecording(page);
    await command(page, 'session.pause');
    await command(page, 'session.resume');
    assert.equal(await expanded(page, 'input'), true);
    assert.equal(await page.evaluate(() => JSON.stringify(globalThis.__app.getLayout())), layout, 'レイアウトは変わらない');
    assert.equal(await saved(page), before, '保存値は変わらない');
  } finally { await ctx.close(); }
});
