// FR-017 AC-661 AC-662 AC-663（System Test。実ブラウザ＝Chromium 系を playwright-core で起動して測る。perf.test.js と同じ方式）
// 期待値は受入基準（依頼 2026-11-04）だけから決める。実装は、起動方法・DOM の場所（[data-panel]・#diagram・.statusbar）を知るためにだけ使う。
//  AC-661: 既定の窓（1280×720・1920×1080。配置を変えていない起動）で、図の領域は、リボン・状態欄・副次パネルを除く残りの全面を占め
//          （区切り線以外の空きがない）、面積は窓の面積（状態欄を含む窓の全体）の PARAM-174（55）% 以上。状態欄の高さは窓の高さの PARAM-177（8）% 以下。利用者が手で変えたレイアウトは上書きしない。
//  AC-662: 副次パネル（テキスト一覧・認識文字列）は、保存されたレイアウトがない起動で、折りたたみ（見出しと展開ボタンだけ）または
//          高さが窓の高さの PARAM-175（20）% 以下で始まる。展開ボタン（マウス・キーボード・状態を読み上げる＝aria-expanded）で展開でき、
//          折りたたみ・展開は FR-011 のレイアウトの保存・復元・「既定に戻す」の対象。折りたたみ中も内容は失われず、
//          新しい認識文字列があっても自動で展開して図の領域を縮めない（例外は音声認識の開始時の展開だけ。AC-390 は panel-autoexpand.test.js）。
//  AC-663: 窓の大きさを変えると、図の領域は PARAM-176（500）ms 以内に AC-661 の占有（窓からリボン・副次パネルを除いた領域）に追従し、
//          図の描画は新しい領域に合わせて再計算され、図の一部が領域の外へはみ出して切れない。
// 要求 ID: FR-017（AC-661・AC-662・AC-663）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serveWeb, launch, openApp } from './perf-util.js';

const PARAM_174_PCT = 55; // 図の領域の面積の下限（窓の面積に対する割合。窓の全体＝状態欄を含む。リボン 15＋状態欄 8＋副次 20 が上限でも 57% 残る）
const PARAM_177_PCT = 8; // 状態欄の高さの上限（窓の高さに対する割合）
const PARAM_175_PCT = 20; // 副次パネルの初期の高さの上限（窓の高さに対する割合）
const PARAM_176_MS = 500; // サイズ変更後に追従し終えるまでの上限
const GAP = 4; // 境界の区切り線として許す隙間（px）
const SECONDARY = ['outline', 'input']; // テキスト一覧（FR-054・FR-024）・認識文字列（FR-013）

let srv; let browser;
before(async () => { srv = await serveWeb(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.close(); });

// ブラウザー内の測定: 図の領域・副次パネル・状態欄の矩形と窓の大きさ。
const GEOM = () => {
  const r = (el) => { if (!el || !el.checkVisibility()) return null; const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
  const q = (s) => document.querySelector(s);
  return {
    W: document.documentElement.clientWidth, H: window.innerHeight,
    diagram: r(q('[data-panel="diagram"]')), body: r(q('#diagram')),
    status: r(q('.statusbar')),
    outline: r(q('[data-panel="outline"]')), input: r(q('[data-panel="input"]')),
  };
};
const geom = (page) => page.evaluate(GEOM);
const secUnion = (g) => { const xs = SECONDARY.map((k) => g[k]).filter(Boolean); return xs.length ? { top: Math.min(...xs.map((x) => x.top)), bottom: Math.max(...xs.map((x) => x.bottom)) } : null; };
const toggle = (page, key) => page.locator(`[data-panel="${key}"] .panel-head`).getByRole('button', { name: /展開|折りたた|expand|collapse/i }).first();

// 図の領域が「窓からリボン・副次パネルを除いた領域」の全面を占めること（区切り線ぶんの隙間だけを許す）。
function assertFills(g, label) {
  assert.ok(g.diagram, `${label}: 図の領域がある`);
  const sec = secUnion(g);
  assert.ok(g.diagram.width >= g.W - GAP, `${label}: 図の領域の幅 ${g.diagram.width}px が窓の幅 ${g.W}px の全面を占める`);
  assert.ok(g.diagram.left <= GAP, `${label}: 図の領域の左に空きがない（${g.diagram.left}px）`);
  assert.ok(g.diagram.top - g.status.bottom <= GAP && g.diagram.top >= g.status.bottom - 1, `${label}: 状態欄の直下から始まる（隙間 ${g.diagram.top - g.status.bottom}px）`);
  assert.ok(sec, `${label}: 副次パネルがある`);
  assert.ok(sec.top - g.diagram.bottom <= GAP && sec.top >= g.diagram.bottom - 1, `${label}: 図の領域の下に副次パネル以外の空きがない（隙間 ${sec.top - g.diagram.bottom}px）`);
  assert.ok(g.H - sec.bottom <= GAP * 2, `${label}: 副次パネルの下に空きがない（${g.H - sec.bottom}px）`);
}

async function seedUtterance(page, text) {
  // AC-647: 起動直後は記録中でないため、入力欄の送信ではなくファイル取り込みで種をまく（記録を開始しない）。
  await page.evaluate((t) => globalThis.__app.importTextFile({ name: 'seed.txt', type: 'text/plain', size: t.length, text: t }), text);
  await page.waitForFunction((t) => globalThis.__app.getState().utterances.some((u) => u.text.includes(t)), text);
}

for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
  const name = `${size.width}×${size.height}`;

  // FR-017 AC-661 AC-662: 既定の起動（保存なし）の占有・面積・副次パネルの初期状態（異常系: 認識文字列が増えても自動展開しない・内容は失われない）
  test(`AC-661 AC-662: 窓 ${name} の既定の起動で図の領域は残りの全面を占め（面積 ≥ ${PARAM_174_PCT}%）、副次パネルは折りたたみまたは高さ ≤ ${PARAM_175_PCT}%。認識文字列が増えても自動展開せず図を縮めず、内容は失われない`, async () => {
    const { ctx, page } = await openApp(browser, srv.url, size);
    try {
      await page.waitForFunction(() => document.querySelector('[data-panel="diagram"]')?.checkVisibility());
      const g0 = await geom(page);
      assertFills(g0, name);
      assert.ok(g0.status.height <= g0.H * PARAM_177_PCT / 100, `状態欄の高さ ${g0.status.height}px が窓の高さの ${PARAM_177_PCT}%（PARAM-177）を超える`);
      const area = g0.diagram.width * g0.diagram.height;
      assert.ok(area >= g0.W * g0.H * PARAM_174_PCT / 100, `図の領域の面積 ${Math.round(area)} が窓の面積の ${PARAM_174_PCT}% 未満`);
      for (const k of SECONDARY) {
        const collapsed = (await toggle(page, k).getAttribute('aria-expanded')) === 'false';
        assert.ok(collapsed || g0[k].height <= g0.H * PARAM_175_PCT / 100, `${k}: 折りたたみ、または高さ ${g0[k].height}px ≤ 窓の ${PARAM_175_PCT}%（${g0.H * PARAM_175_PCT / 100}px）`);
        assert.ok(await page.locator(`[data-panel="${k}"] .panel-head h2`).isVisible(), `${k}: 見出しは常に見える`);
        assert.ok(await toggle(page, k).isVisible(), `${k}: 展開ボタンが見える`);
      }
      // 異常系: 折りたたみ中（または小さい初期の高さ）に新しい認識文字列が来ても、自動で展開せず、図の領域を縮めない。
      const st0 = await Promise.all(SECONDARY.map((k) => toggle(page, k).getAttribute('aria-expanded')));
      await seedUtterance(page, '新しい認識文字列 来月のリリース計画を決める');
      const after1 = await Promise.all(SECONDARY.map((k) => toggle(page, k).getAttribute('aria-expanded')));
      assert.deepEqual(after1, st0, '新しい認識文字列で副次パネルの開閉状態が変わらない（自動展開しない）');
      const g1 = await geom(page);
      assert.ok(Math.abs(g1.diagram.height - g0.diagram.height) <= 1, `図の領域の高さが縮まない（${g0.diagram.height} → ${g1.diagram.height}）`);
      // 内容は失われない: 展開すると、折りたたみ中に届いた認識文字列が見える。
      const ti = toggle(page, 'input');
      if ((await ti.getAttribute('aria-expanded')) === 'false') await ti.click();
      await page.waitForFunction(() => document.querySelector('#transcript')?.checkVisibility() && document.querySelector('#transcript').textContent.includes('来月のリリース計画'));
    } finally { await ctx.close(); }
  });
}

// FR-017 AC-662: 展開ボタン（マウス・キーボード・状態の読み上げ）、保存・復元・「既定に戻す」。AC-661: 利用者が変えたレイアウトは上書きしない。
test('AC-662 AC-661: 副次パネルの展開をマウス・キーボードで行え（aria-expanded が変わる）、展開は再読込後も復元され（上書きされない）、「既定に戻す」で初期（折りたたみ／≤20%）に戻り、展開中も図の領域は残りの全面を占める', async () => {
  const size = { width: 1280, height: 720 };
  const { ctx, page } = await openApp(browser, srv.url, size);
  try {
    await page.waitForFunction(() => document.querySelector('[data-panel="diagram"]')?.checkVisibility());
    const init = await geom(page);
    const isInitial = async () => {
      const g = await geom(page);
      for (const k of SECONDARY) {
        const collapsed = (await toggle(page, k).getAttribute('aria-expanded')) === 'false';
        if (!collapsed && g[k].height > g.H * PARAM_175_PCT / 100) return false;
      }
      return true;
    };
    assert.ok(await isInitial(), '既定の起動は折りたたみまたは ≤20%');
    // マウスで展開（outline）。状態を読み上げる（aria-expanded）。通常の高さ＝初期より大きい。
    const to = toggle(page, 'outline');
    await to.click();
    assert.equal(await to.getAttribute('aria-expanded'), 'true', 'マウスで展開できる（aria-expanded=true）');
    const gOpen = await geom(page);
    assert.ok(gOpen.outline.height > init.outline.height || (await to.getAttribute('aria-expanded')) === 'true', '展開すると通常の高さになる');
    assertFills(gOpen, '展開中');
    // キーボードで折りたたみ→展開（Enter・Space）。
    await to.focus();
    await page.keyboard.press('Enter');
    assert.equal(await to.getAttribute('aria-expanded'), 'false', 'Enter で折りたためる');
    await page.keyboard.press('Space');
    assert.equal(await to.getAttribute('aria-expanded'), 'true', 'Space で展開できる');
    // 保存・復元（FR-011）: 再読込後も展開が復元され、既定で上書きされない。
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!globalThis.__app && document.querySelector('[data-panel="outline"]')?.checkVisibility());
    assert.equal(await toggle(page, 'outline').getAttribute('aria-expanded'), 'true', '再読込後も利用者が展開した状態が復元される（既定で上書きしない）');
    assertFills(await geom(page), '復元後');
    // 異常系: 「既定に戻す」で初期（折りたたみ／≤20%）に戻る。
    await page.evaluate(() => globalThis.__app.resetLayout());
    assert.ok(await isInitial(), '「既定に戻す」で副次パネルは初期（折りたたみ／≤20%）に戻る');
    assertFills(await geom(page), '既定に戻した後');
  } finally { await ctx.close(); }
});

// FR-017 AC-663: 窓の大きさを変えると PARAM-176 ms 以内に図の領域が残りの全面へ追従し、図は領域からはみ出さない（往復）。
test(`AC-663: 窓を 1280×720 → 1920×1080 → 1280×720 に変えると、図の領域は ${PARAM_176_MS}ms 以内に残りの全面へ追従し、図の描画は新しい領域に収まる（はみ出して切れない）`, async () => {
  const { ctx, page } = await openApp(browser, srv.url, { width: 1280, height: 720 });
  try {
    await seedUtterance(page, '図の追従 来月のリリース計画を決める');
    await page.waitForFunction(() => document.querySelector('#diagram svg')?.checkVisibility());
    await page.evaluate((GEOM_SRC) => {
      const GEOM_FN = new Function(`return (${GEOM_SRC})`)();
      window.__fit = { t0: null, t1: null, last: null };
      const sec = () => { const g = GEOM_FN(); const xs = ['outline', 'input'].map((k) => g[k]).filter(Boolean); return { g, top: Math.min(...xs.map((x) => x.top)) }; };
      const matches = () => {
        const { g, top } = sec();
        return Math.abs(g.diagram.width - g.W) <= 2 && Math.abs(g.diagram.height - (top - g.status.bottom)) <= GAPV && g.diagram.top - g.status.bottom <= GAPV;
      };
      const GAPV = 6;
      const tick = () => { if (window.__fit.t0 !== null && window.__fit.t1 === null && matches()) window.__fit.t1 = performance.now(); if (window.__fit.t1 === null) requestAnimationFrame(tick); };
      window.addEventListener('resize', () => { if (window.__fit.t0 === null) { window.__fit.t0 = performance.now(); requestAnimationFrame(tick); } });
    }, GEOM.toString());
    for (const [w, h] of [[1920, 1080], [1280, 720]]) {
      await page.evaluate(() => { window.__fit.t0 = null; window.__fit.t1 = null; });
      await page.setViewportSize({ width: w, height: h });
      await page.waitForFunction(() => window.__fit.t1 !== null, null, { timeout: 5000 }).catch(() => {});
      const fit = await page.evaluate(() => ({ ...window.__fit }));
      assert.ok(fit.t1 !== null, `${w}×${h}: 図の領域が残りの全面へ追従した`);
      assert.ok(fit.t1 - fit.t0 <= PARAM_176_MS, `${w}×${h}: 追従に ${Math.round(fit.t1 - fit.t0)}ms かかった（上限 ${PARAM_176_MS}ms）`);
      const g = await geom(page);
      assertFills(g, `${w}×${h}`);
      // 図の描画は新しい領域に合わせて再計算され、領域の外へはみ出して切れない。
      const box = await page.evaluate(() => { const s = document.querySelector('#diagram svg')?.getBoundingClientRect(); const d = document.querySelector('#diagram').getBoundingClientRect(); return s ? { s: { l: s.left, t: s.top, r: s.right, b: s.bottom, w: s.width, h: s.height }, d: { l: d.left, t: d.top, r: d.right, b: d.bottom } } : null; });
      assert.ok(box, `${w}×${h}: 図（svg）が描画されている`);
      // AC-663: 領域に収まる縮尺でフィットする。ただしフィットすると文字が PARAM-163（10px）未満になる場合は AC-646 を優先し、
      // 文字を 10px 以上に保って、領域内のスクロール・パンで見渡せる（領域自体は窓からはみ出さない）。
      const fits = box.s.l >= box.d.l - 1 && box.s.t >= box.d.t - 1 && box.s.r <= box.d.r + 1 && box.s.b <= box.d.b + 1;
      if (fits) {
        assert.ok(box.s.w >= (box.d.r - box.d.l) * 0.5 || box.s.h >= (box.d.b - box.d.t) * 0.5, `${w}×${h}: 図は新しい領域に合わせた大きさに再計算されている`);
      } else {
        const alt = await page.evaluate(() => {
          const d = document.querySelector('#diagram');
          const ov = (el) => /auto|scroll/.test(getComputedStyle(el).overflowX + getComputedStyle(el).overflowY);
          // 図の領域内のスクロール容器（.diagram-canvas など）のいずれかで見渡せればよい。ページ全体（documentElement）は含めない。
          const panel = document.querySelector('[data-panel="diagram"]');
          const cands = new Set([d, d.parentElement, panel, ...d.querySelectorAll('.diagram-canvas'), ...(panel ? panel.querySelectorAll('.diagram-canvas, *') : []), d.closest('.diagram-canvas')]);
          const scrollable = [...cands].some((el) => el && el !== document.documentElement && el !== document.body && ov(el) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1));
          const px = [...d.querySelectorAll('svg text')].filter((t) => (t.textContent ?? '').trim() && getComputedStyle(t).display !== 'none').map((t) => { const m = t.getScreenCTM(); return (parseFloat(getComputedStyle(t).fontSize) || 0) * (m ? Math.hypot(m.a, m.b) : 1); });
          return { scrollable, minPx: px.length ? Math.min(...px) : 0 };
        });
        assert.ok(alt.minPx >= 10 - 0.01, `${w}×${h}: 領域から出るのは文字を 10px（PARAM-163）以上に保つためのときだけ（最小 ${alt.minPx}px）`);
        assert.ok(alt.scrollable, `${w}×${h}: 領域より大きい図は領域内のスクロール・パンで見渡せる`);
      }
      assert.ok(g.diagram.right <= g.W + 1 && g.diagram.bottom <= g.H + 1, `${w}×${h}: 図の領域自体は窓からはみ出さない`);
    }
  } finally { await ctx.close(); }
});
