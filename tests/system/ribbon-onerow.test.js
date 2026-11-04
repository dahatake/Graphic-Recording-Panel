// NFR-UX-011 AC-660（System Test。実ブラウザ＝Chromium 系を playwright-core で起動して測る。ribbon-viewport.test.js・perf.test.js と同じ方式）
// 期待値は受入基準（依頼 2026-11-04）だけから決める:
//  - 幅が PARAM-006（640）px を超える窓（1280×720・1920×1080）で、リボン（#toolbar の全グループ）は既定で縦 1 段:
//    全グループの上端が同じ帯の中にあり、リボンの高さは窓の高さの PARAM-173（15）% 以下。
//  - 幅が足りないときは、ラベルを省いたアイコンのみ → グループ 1 つのドロップダウンへ段階的に縮退し、折り返して段を増やさない
//    （縮退中もボタンの機能・コマンド ID・アクセシブルな名前・ツールチップは変わらない）。
//  - 縮退した状態も含めて、既存の全ボタン（コマンド ID の集合）がマウスとキーボードだけで到達できる。
//  - 窓を広げると縮退したグループは元の表示に戻る。折りたたみ（#ribbon-toggle）の機能は維持される。
// 要求 ID: NFR-UX-011（AC-660）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serveWeb, launch } from './perf-util.js';

const PARAM_006_PX = 640; // 縮退（積み重ね・タブ化）に切り替える画面幅
const PARAM_173_PCT = 15; // 既定の窓でのリボンの高さの上限（窓の高さに対する割合）
const TOP_TOL = 2; // 上端がそろっているとみなす許容（px）

let srv; let browser;
before(async () => { srv = await serveWeb(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.close(); });

async function open(size) {
  const ctx = await browser.newContext({ viewport: size });
  const page = await ctx.newPage();
  await page.goto(srv.url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!globalThis.__app && document.querySelectorAll('#toolbar [data-command]').length > 0);
  return { ctx, page };
}

// 窓の大きさを変え、レイアウトが落ち着くまで条件で待つ（固定の待ちは使わない）。
async function resize(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForFunction(([w, h]) => window.innerWidth === w && window.innerHeight === h, [width, height]);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// ブラウザー内で測る: 見えている（表示されて大きさがある）コマンドのボタンと、その名前・ツールチップ・ラベルの有無。
const SNAP = () => {
  const vis = (el) => el.checkVisibility({ checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
  const bar = document.querySelector('#toolbar');
  const br = bar.getBoundingClientRect();
  const all = [...bar.querySelectorAll('[data-command]')];
  const shown = all.filter(vis).map((el) => ({ id: el.dataset.command, name: name(el), title: el.getAttribute('title') || '', label: (el.innerText || '').trim().length > 0 }));
  const groups = [...bar.querySelectorAll('[role="group"]')].filter(vis).map((g) => g.getBoundingClientRect());
  return {
    ids: [...new Set(all.map((e) => e.dataset.command))].sort(),
    shown,
    groupTops: groups.map((r) => r.top),
    groupBottoms: groups.map((r) => r.bottom),
    bar: { top: br.top, bottom: br.bottom, height: br.height },
    hOverflow: bar.scrollWidth - bar.clientWidth,
    pageHOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};
const snap = (page) => page.evaluate(SNAP);

// マウスとキーボードだけで到達できるコマンド ID の集合: 直接見えるものと、ドロップダウンのトリガーを開いて見えるもの。
async function reachable(page, how) {
  const seen = new Map();
  const add = (s) => { for (const c of s.shown) if (!seen.has(c.id)) seen.set(c.id, c); };
  add(await snap(page));
  const triggers = page.locator('#toolbar button[aria-haspopup], #toolbar button[aria-expanded][aria-controls]:not(#ribbon-toggle)');
  const n = await triggers.count();
  for (let i = 0; i < n; i++) {
    const t = triggers.nth(i);
    if (!(await t.isVisible())) continue;
    if (how === 'mouse') await t.click(); else { await t.focus(); await page.keyboard.press('Enter'); }
    add(await snap(page));
    await page.keyboard.press('Escape');
    if ((await t.getAttribute('aria-expanded')) === 'true') await t.click(); // Escape で閉じなかったときは閉じる
  }
  return seen;
}

const cases = [{ w: 1920, h: 1080 }, { w: 1280, h: 720 }];
const WIDTHS = [1000, 800, 660];

for (const base of cases) {
  const name = `${base.w}×${base.h}`;

  // NFR-UX-011 AC-660 正常系: 既定の窓でリボンは縦 1 段（上端がそろい、高さは窓の PARAM-173 % 以下）。折り返しも横あふれもない。
  test(`AC-660: 窓 ${name} でリボンの全グループは縦 1 段に収まり（上端が同じ帯・高さ ≤ ${PARAM_173_PCT}%）、折り返さず横にあふれず、折りたたみ機能が維持される`, async () => {
    assert.ok(base.w > PARAM_006_PX);
    const { ctx, page } = await open(base);
    try {
      const s = await snap(page);
      assert.ok(s.groupTops.length >= 2, 'リボンに複数のグループがある');
      const spread = Math.max(...s.groupTops) - Math.min(...s.groupTops);
      assert.ok(spread <= TOP_TOL, `全グループの上端が同じ 1 本の帯の中にある（ばらつき ${spread}px）`);
      assert.ok(s.groupBottoms.every((b) => b <= s.bar.bottom + 1), '全グループがリボンの帯の内側に収まる（段が増えていない）');
      assert.ok(s.bar.height <= base.h * PARAM_173_PCT / 100, `リボンの高さ ${s.bar.height}px が窓の高さ ${base.h}px の ${PARAM_173_PCT}% を超える`);
      assert.ok(s.hOverflow <= 1 && s.pageHOverflow <= 1, `横にあふれない（リボン ${s.hOverflow}px・ページ ${s.pageHOverflow}px）`);
      // 折りたたみ機能の維持（AC-579・AC-642）
      const tg = page.locator('#ribbon-toggle');
      await tg.click();
      assert.equal(await tg.getAttribute('aria-expanded'), 'false', '1 操作で折りたためる');
      await tg.click();
      assert.equal(await tg.getAttribute('aria-expanded'), 'true', '1 操作で開ける');
    } finally { await ctx.close(); }
  });
}

// NFR-UX-011 AC-660 縮退・異常系: 幅を狭めても段を増やさず（高さ・上端そろいを保つ）、縮退してもコマンド集合・名前・ツールチップは不変で、
// 全コマンドがマウスとキーボードで到達でき、窓を広げると元の表示に戻る。
test('AC-660 縮退: 幅 1280→1000→800→660（高さ 720）で縦 1 段のまま、全コマンドがマウス・キーボードで到達でき、名前・ツールチップ不変、広げると元に戻る', async () => {
  const { ctx, page } = await open({ width: 1280, height: 720 });
  try {
    await resize(page, 1920, 1080);
    const wide = await snap(page);
    const wideMouse = await reachable(page, 'mouse');
    const baseIds = [...wideMouse.keys()].sort();
    assert.ok(baseIds.length >= 10, `基準（幅 1920）で多数のコマンドが到達できる（${baseIds.length}）`);
    assert.deepEqual(baseIds, wide.ids, '基準では DOM のコマンド集合と到達できる集合が一致する');
    const wideLabelled = wide.shown.filter((c) => c.label).length;
    const byId = new Map(wide.shown.map((c) => [c.id, c]));

    for (const w of WIDTHS) {
      await resize(page, w, 720);
      const s = await snap(page);
      const spread = Math.max(...s.groupTops) - Math.min(...s.groupTops);
      assert.ok(spread <= TOP_TOL, `幅 ${w}: 折り返して段を増やさない（上端のばらつき ${spread}px）`);
      assert.ok(s.bar.height <= 720 * PARAM_173_PCT / 100, `幅 ${w}: リボンの高さ ${s.bar.height}px は窓の高さの ${PARAM_173_PCT}% 以下のまま`);
      assert.ok(s.hOverflow <= 1 && s.pageHOverflow <= 1, `幅 ${w}: 横にあふれない`);
      for (const mode of ['mouse', 'keyboard']) {
        const r = await reachable(page, mode);
        assert.deepEqual([...r.keys()].sort(), baseIds, `幅 ${w}: 縮退後も（${mode}）全コマンドに到達できる（機能・コマンド ID は変わらない）`);
        for (const [id, c] of r) {
          const b = byId.get(id);
          assert.ok(c.name.length > 0, `幅 ${w}: ${id} のアクセシブルな名前が空でない`);
          assert.equal(c.name, b.name, `幅 ${w}: ${id} の名前は変わらない`);
          if (b.title) assert.equal(c.title, b.title, `幅 ${w}: ${id} のツールチップは変わらない`);
        }
      }
    }
    // 幅 660（> 640）では、1920 に比べ、ラベル付きで直接見えるボタンが減る（アイコンのみ／ドロップダウンへ縮退している）。
    const narrow = await snap(page);
    assert.ok(narrow.shown.filter((c) => c.label).length < wideLabelled, `幅 660 で縮退が起きている（ラベル付きで直接見えるボタン ${narrow.shown.filter((c) => c.label).length} < ${wideLabelled}）`);

    // 窓を広げると、縮退したグループは元の表示に戻る。
    await resize(page, 1920, 1080);
    const back = await snap(page);
    assert.equal(back.shown.filter((c) => c.label).length, wideLabelled, '広げるとラベル付きの表示が元に戻る');
    assert.deepEqual(back.shown.map((c) => c.id), wide.shown.map((c) => c.id), '広げると直接見えるボタンの集合と順が元に戻る');
  } finally { await ctx.close(); }
});

// NFR-UX-011 AC-660 縮退中の見出し・DOM 順・フォーカス順: 縮退中も各グループの見出しが表示され、グループの順（左→右）と DOM 順・Tab の順が一致し、
// ドロップダウン内の項目の順は、縮退前（幅 1920）のグループ内の順と同じである。
test('AC-660 縮退中の見出し・DOM 順・フォーカス順: 幅 1000・800・660 で全グループの見出しが表示され、DOM 順・Tab 順が視覚上の順と一致し、ドロップダウン内の順もグループ内の順と同じ', async () => {
  const { ctx, page } = await open({ width: 1920, height: 1080 });
  const GROUPS = () => {
    const vis = (el) => el.checkVisibility({ checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0;
    const bar = document.querySelector('#toolbar');
    const headings = [...bar.querySelectorAll('.toolbar-group-heading')].map((h) => h.textContent.trim()).filter(Boolean);
    const groups = [...bar.querySelectorAll('[role="group"]')].map((g) => ({ vis: vis(g), left: g.getBoundingClientRect().left, ids: [...g.querySelectorAll('[data-command]')].map((e) => e.dataset.command), text: (g.innerText || '').trim() }));
    return { headings, groups, barText: bar.innerText };
  };
  try {
    const wide = await page.evaluate(GROUPS);
    assert.ok(wide.headings.length >= 2, '基準（幅 1920）で見出しが複数ある');
    const orderOf = new Map(); // コマンド ID → 縮退前のグループの順・グループ内の順
    wide.groups.forEach((g, gi) => g.ids.forEach((id, ii) => { if (!orderOf.has(id)) orderOf.set(id, gi * 1000 + ii); }));
    for (const w of [1000, 800, 660]) {
      await resize(page, w, 720);
      const s = await page.evaluate(GROUPS);
      for (const h of wide.headings) assert.ok(s.barText.includes(h), `幅 ${w}: 見出し「${h}」が縮退中も表示される`);
      const lefts = s.groups.filter((g) => g.vis).map((g) => g.left);
      assert.deepEqual(lefts, [...lefts].sort((a, b) => a - b), `幅 ${w}: DOM 順のグループが視覚上の順（左→右）と一致する`);
      // Tab で巡る順（トリガーを含む）: ツールバー内で左から右へ進み、コマンドの縮退前の順（グループの順）を逆戻りしない。
      await page.locator('#toolbar').evaluate((el) => { el.ownerDocument.activeElement?.blur?.(); });
      await page.evaluate(() => document.body.focus());
      const seq = [];
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press('Tab');
        const f = await page.evaluate(() => { const a = document.activeElement; if (!a || !a.closest('#toolbar')) return null; const r = a.getBoundingClientRect(); return { left: r.left, id: a.dataset.command || null }; });
        if (f) seq.push(f); else if (seq.length) break;
      }
      assert.ok(seq.length >= 3, `幅 ${w}: Tab でリボンの項目を巡れる`);
      const fl = seq.map((x) => x.left);
      assert.ok(fl.every((x, i) => i === 0 || x >= fl[i - 1] - 1), `幅 ${w}: Tab 順が視覚上の順（左→右）と一致する`);
      const ids = seq.map((x) => orderOf.get(x.id)).filter((x) => x !== undefined);
      assert.deepEqual(ids, [...ids].sort((a, b) => a - b), `幅 ${w}: Tab 順がグループの順→グループ内の順（縮退前）と一致する`);
      // ドロップダウン内の順: 開いたメニューの項目の順は、縮退前のグループ内の順と同じ。
      const triggers = page.locator('#toolbar button[aria-haspopup], #toolbar button[aria-expanded][aria-controls]:not(#ribbon-toggle)');
      for (let i = 0; i < await triggers.count(); i++) {
        const t = triggers.nth(i);
        if (!(await t.isVisible())) continue;
        await t.click();
        const menu = await page.evaluate(() => [...document.querySelectorAll('[role="menu"] [data-command], [role="menu"] [role="menuitem"][data-command], #toolbar [data-command]')]
          .filter((e) => e.checkVisibility({ checkVisibilityCSS: true }) && e.closest('[role="menu"]')).map((e) => e.dataset.command));
        const o = menu.map((id) => orderOf.get(id)).filter((x) => x !== undefined);
        assert.deepEqual(o, [...o].sort((a, b) => a - b), `幅 ${w}: ドロップダウン内の項目の順がグループ内の順と同じ`);
        await page.keyboard.press('Escape');
        if ((await t.getAttribute('aria-expanded')) === 'true') await t.click();
      }
    }
  } finally { await ctx.close(); }
});
