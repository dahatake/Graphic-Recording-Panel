// NFR-UX-001 AC-057 AC-060 AC-061（System Test。契約: tests/system/CONTRACT.md「コマンドバーとステータス」「見た目の資産」）
// 自動化できる範囲: CSS トークンの存在・コントラスト計算・ARIA・コマンドの到達性。見た目の最終確認は MANUAL-SUPPLEMENT.md。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newApp, FakeSpeech, WEB } from './helpers.js';
import { P } from './batch-util.js';

const REQUIRED = ['session.start', 'session.pause', 'session.resume', 'session.stop', 'save.png', 'save.svg', 'save.pdf',
  'lang.ja', 'lang.en', 'view.2d', 'view.3d', 'presentation.start', 'presentation.pause', 'presentation.resume', 'presentation.stop'];
const read = (...p) => fs.readFileSync(path.join(WEB, ...p), 'utf8');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

function lum(hex) {
  const h = hex.replace('#', '');
  const v = [0, 2, 4].map((i) => parseInt(h.length === 3 ? h[i / 2] + h[i / 2] : h.substr(i, 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function tokens(css, theme) {
  const out = {};
  const re = /([^{}]+)\{([^}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const sel = m[1].trim();
    const isDark = /data-theme="dark"/.test(sel);
    if (!/:root/.test(sel)) continue;
    if (isDark && theme !== 'dark') continue; // dark は light の値の上に重ねる
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  }
  return out;
}

// NFR-UX-001 AC-057
test('NFR-UX-001 AC-057: すべての操作部品がキーボードで到達でき、マウスで開く機能はコマンドバーのボタンとキーボードの両方で開ける', async () => {
  const { app } = await newApp();
  const bar = app.getCommandBar();
  const byCmd = new Map(bar.items.map((i) => [i.command, i]));
  for (const c of REQUIRED) {
    assert.ok(byCmd.has(c), `コマンドバーに ${c} のボタンがある`);
    assert.equal(byCmd.get(c).tabbable, true, `${c} はキーボードで到達できる`);
    assert.equal(typeof app.commands[c], 'function');
    assert.ok(app.keymap.some((k) => k.command === c), `${c} にキー割り当てがある`);
    assert.ok(byCmd.get(c).label && byCmd.get(c).label.trim(), `${c} に名前がある`);
  }
  assert.ok(!/tabindex\s*=\s*"?[1-9]/.test(read('index.html')), '正の tabindex を使わない');
});

test('NFR-UX-001 AC-057: フォーカス中の部品は背景に対し識別できる輪郭（非テキスト 3:1 以上）で示される（ライト・ダーク）', () => {
  const css = fs.readdirSync(path.join(WEB, 'styles')).filter((f) => f.endsWith('.css')).map((f) => read('styles', f)).join('\n');
  const rule = css.match(/:focus-visible\s*\{([^}]*)\}/);
  assert.ok(rule, ':focus-visible の規則がある');
  const o = rule[1].match(/outline\s*:\s*([^;]+);/);
  assert.ok(o, 'outline を指定している');
  assert.ok(!/\bnone\b|\b0(px)?\s+(solid|none)/.test(o[1]), 'outline を消していない');
  const w = o[1].match(/(\d+(?:\.\d+)?)px/);
  assert.ok(w && parseFloat(w[1]) >= 2, '輪郭の太さが 2px 以上');
  const v = o[1].match(/var\((--[\w-]+)\)/);
  assert.ok(v, '輪郭の色は名前付きトークンを参照する');
  const tcss = read('styles', 'tokens.css');
  for (const theme of ['light', 'dark']) {
    const t = tokens(tcss, theme);
    const focus = t[v[1]]; const bg = t['--color-bg']; const surface = t['--color-surface'];
    assert.ok(focus && bg && surface, `${theme}: ${v[1]}・--color-bg・--color-surface がある`);
    assert.ok(ratio(focus, bg) >= 3, `${theme}: 背景とのコントラスト ${ratio(focus, bg).toFixed(2)} >= 3`);
    assert.ok(ratio(focus, surface) >= 3, `${theme}: 面とのコントラスト ${ratio(focus, surface).toFixed(2)} >= 3`);
  }
});

// NFR-UX-001 AC-060
test('NFR-UX-001 AC-060: 画面上部のコマンドバーに主要操作が集まり、ステータス表示が状態と音声認識の可否を示し読み上げ対象になる', async () => {
  const { app } = await newApp();
  const bar = app.getCommandBar();
  assert.equal(bar.position, 'top');
  const cmds = bar.items.map((i) => i.command);
  for (const c of ['session.start', 'session.stop', 'lang.ja', 'lang.en', 'view.2d', 'view.3d', 'save.png', 'presentation.start']) assert.ok(cmds.includes(c), c);
  const s0 = app.getCommandBar().status;
  assert.equal(s0.role, 'status');
  assert.ok(['polite', 'assertive'].includes(s0.live), '状態変化が読み上げ対象（aria-live）');
  assert.equal(s0.speech, 'available');
  app.commands['session.start']();
  const s1 = app.getCommandBar().status;
  assert.equal(s1.session, 'recording');
  assert.notEqual(s1.text, s0.text, '状態の変化が表示文言に出る');
  app.commands['session.pause']();
  const s2 = app.getCommandBar().status;
  assert.equal(s2.session, 'paused');
  assert.notEqual(s2.text, s1.text);
});

test('NFR-UX-001 AC-060 異常系: 音声認識がデバイス内で使えず API がある（要同意）とき、ステータスは可否を区別して示す（FR-001 AC-069）', async () => {
  const { app } = await newApp({ speech: new FakeSpeech({ processLocally: false }) });
  assert.equal(app.getCommandBar().status.speech, 'consent');
  assert.ok(app.getCommandBar().status.text.trim().length > 0);
});

test('NFR-UX-001 AC-060 異常系: 音声認識 API が使えないとき、ステータスは不可を示す', async () => {
  const { app } = await newApp({ speech: new FakeSpeech({ supported: false }) });
  assert.equal(app.getCommandBar().status.speech, 'unavailable');
  assert.ok(app.getCommandBar().status.text.trim().length > 0);
});

test('NFR-UX-001 AC-060: 静的な画面（index.html）で、コマンドバーとステータスは主領域より前（上部）にあり、ステータスは role=status', () => {
  const html = read('index.html');
  const main = html.search(/<main\b/);
  const status = html.search(/role="status"/);
  const toolbar = html.search(/id="toolbar"|role="toolbar"/);
  assert.ok(main > 0 && status > 0 && toolbar > 0);
  assert.ok(status < main && toolbar < main, 'ステータスとコマンドバーは main より前');
  assert.ok(/aria-live="(polite|assertive)"/.test(html.slice(0, main)));
});

// NFR-UX-001 AC-061
test('NFR-UX-001 AC-061: 外部オリジンのフォント・スタイル・スクリプトの取得が 0 件で、書体指定の先頭はシステムフォント（Segoe UI を含む並び）', () => {
  const files = walk(WEB).filter((f) => /\.(html|css|js|svg)$/.test(f));
  const bad = [];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/(?:href|src)\s*=\s*"([^"]+)"/gi)) if (/^(https?:)?\/\//i.test(m[1])) bad.push(`${path.relative(WEB, f)}: ${m[1]}`);
    for (const m of s.matchAll(/@import\s+[^;]+;/g)) if (/(https?:)?\/\//.test(m[0])) bad.push(`${path.relative(WEB, f)}: ${m[0]}`);
    for (const m of s.matchAll(/url\(\s*['"]?((?:https?:)?\/\/[^)'"]+)/gi)) bad.push(`${path.relative(WEB, f)}: ${m[1]}`);
    if (/@font-face/.test(s) && /url\(/.test(s.slice(s.indexOf('@font-face')))) bad.push(`${path.relative(WEB, f)}: @font-face の url`);
  }
  assert.deepEqual(bad, []);
  const t = tokens(read('styles', 'tokens.css'), 'light');
  const ff = t['--font-sans'];
  assert.ok(ff, '--font-sans トークンがある');
  const list = ff.split(',').map((x) => x.trim().replace(/^["']|["']$/g, ''));
  assert.ok(list.includes('Segoe UI'), 'Segoe UI を含む');
  assert.ok(['Segoe UI', 'system-ui', '-apple-system', 'BlinkMacSystemFont'].includes(list[0]), `先頭がシステムフォント: ${list[0]}`);
});

test('NFR-UX-001 AC-061 異常系: 実行時（全操作）に外部取得系の API を使わない', async () => {
  const calls = [];
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
  const saved = Object.fromEntries(names.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of names) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: () => { calls.push(k); throw new Error('blocked'); } });
  try {
    const { app } = await newApp();
    app.commands['session.start'](); app.setLang('en'); app.setViewMode('3d'); app.setViewMode('2d');
    for (const c of REQUIRED.filter((x) => x.startsWith('save.'))) await app.commands[c]();
    assert.deepEqual(calls, []);
  } finally {
    for (const k of names) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
  }
});

// NFR-UX-001 AC-696（契約: tests/system/CONTRACT-BATCH.md。入力モード・バッチのスタイルのボタンが、既存の画風のメニューと同じデザイン基盤で、画面全体で統一したデザインになる。PARAM-006=640px、PARAM-007=4.5、PARAM-162=300ms）
test('NFR-UX-001 AC-696: 入力モード（FR-117）とスタイルのボタン（FR-118）は画風のメニュー（AC-414）と同じ項目の形で、独自の色・書体・角丸の直指定を持たず、アイコンだけに頼らず名称の文字とアクセシブルな名前を持つ', async () => {
  const { app } = await newApp();
  await app.importTextFile({ name: 'm.txt', type: 'text/plain', size: 12, text: '予算の見直し\n' });
  const items = app.getCommandBar().items;
  const ref = Object.keys(items.find((i) => i.group === 'drawStyle')).sort();
  for (const g of ['inputMode', 'batchStyle']) {
    const gi = items.filter((i) => i.group === g);
    assert.ok(gi.length >= 2, `${g} の項目`);
    for (const it of gi) {
      for (const k of ref.filter((k) => !['selectedMark', 'pressed'].includes(k))) assert.ok(k in it, `${g}: 画風の項目と同じ項目の形（${k}）`);
      assert.ok(it.label.trim() && it.accessibleName === it.label && it.labelVisible === true, `${g}: 名称の文字とアクセシブルな名前`);
    }
  }
  // 見た目の定義: 入力モード・スタイルのボタンを対象にした規則は、色・書体・角丸を名前付きのトークン（var(--…)）から参照する
  const css = fs.readdirSync(path.join(WEB, 'styles')).filter((f) => f.endsWith('.css')).map((f) => read('styles', f)).join('\n');
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/inputMode|input-mode|batchStyle|batch-style/.test(m[1])) continue;
    for (const d of m[2].matchAll(/(color|background(?:-color)?|border(?:-[a-z]+)?-color|border|font-family|border-radius|outline)\s*:\s*([^;]+);/g)) {
      const v = d[2];
      assert.ok(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(v), `色の直指定がない（${m[1].trim()} { ${d[1]}: ${v} }）`);
      if (/font-family|border-radius/.test(d[1])) assert.match(v, /var\(--|inherit/, `${d[1]} はトークンまたは継承（${m[1].trim()}）`);
    }
  }
});

test('NFR-UX-001 AC-696 実ブラウザ: ライト・ダーク・ハイコントラストで文字と枠のコントラスト比が 4.5 以上（ハイコントラストは枠が見える）、幅 640px 以下でも欠けず、キーボードで操作でき焦点が見え、動きの軽減で遷移が省かれる', async () => {
  const { serveWeb, launch, openApp } = await import('./perf-util.js');
  const srv = await serveWeb(); const browser = await launch();
  const probe = () => {
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const parse = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
    const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const ratio = (x, y) => { const [p, q] = [L(x), L(y)].sort((a, b) => b - a); return (p + 0.05) / (q + 0.05); };
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.99) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
    return [...document.querySelectorAll('button[data-command^="inputMode.set:"], button[data-command^="batchStyle.set:"]')].map((el) => {
      const cs = getComputedStyle(el); const bg = bgOf(el); const fg = parse(cs.color); const bc = parse(cs.borderTopColor);
      const r = el.getBoundingClientRect();
      return { cmd: el.dataset.command, text: ratio(fg, bg), border: parseFloat(cs.borderTopWidth) > 0 && bc && bc.a > 0 ? ratio(bc, bgOf(el.parentElement ?? el)) : null, borderW: parseFloat(cs.borderTopWidth), rect: { x: r.x, w: r.width, h: r.height, y: r.y }, name: (el.innerText || '').trim(), aria: el.getAttribute('aria-label'), transition: cs.transitionDuration };
    });
  };
  try {
    const { ctx, page } = await openApp(browser, srv.url, { width: 1280, height: 1000 });
    try {
      await page.evaluate(async () => { await globalThis.__app.importTextFile({ name: 'm.txt', type: 'text/plain', size: 24, text: '予算の見直し\nコストが高い\n' }); });
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme, forcedColors: 'none' });
        const rows = await page.evaluate(probe);
        assert.equal(rows.length, 10, '入力モード 2 ＋ スタイル 8');
        for (const r of rows) {
          assert.ok(r.text >= P.CONTRAST, `${scheme} ${r.cmd}: 文字のコントラスト ${r.text.toFixed(2)} >= ${P.CONTRAST}`);
          if (r.border !== null) assert.ok(r.border >= P.CONTRAST, `${scheme} ${r.cmd}: 枠のコントラスト ${r.border.toFixed(2)} >= ${P.CONTRAST}`);
          assert.ok(r.name, `${r.cmd}: 名称の文字がある（アイコンだけに頼らない）`);
        }
      }
      await page.emulateMedia({ forcedColors: 'active' });
      const hc = await page.evaluate(probe);
      for (const r of hc) assert.ok(r.borderW > 0 && r.rect.w > 0, `ハイコントラスト ${r.cmd}: 枠が表示される`);
      await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
      for (const r of await page.evaluate(probe)) for (const t of r.transition.split(',')) assert.ok(parseFloat(t) * (/ms$/.test(t.trim()) ? 1 : 1000) <= P.TRANSITION_MS, `${r.cmd}: 遷移は ${P.TRANSITION_MS}ms 以内`);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const r of await page.evaluate(probe)) for (const t of r.transition.split(',')) assert.equal(parseFloat(t), 0, `${r.cmd}: 動きの軽減で遷移なし`);
      // キーボード: Tab で到達でき、焦点の輪郭が見える
      await page.locator('button[data-command="inputMode.set:live"]').first().focus();
      await page.keyboard.press('Tab');
      const f = await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { ok: !!e.matches('button'), outline: cs.outlineStyle, w: parseFloat(cs.outlineWidth) }; });
      assert.ok(f.ok && f.outline !== 'none' && f.w > 0, '焦点の表示がある');
    } finally { await ctx.close(); }
    // 幅 640px 以下（積み重ねまたは折り返し。欠けない・横スクロールなし・重ならない）
    for (const width of [P.NARROW, 480]) {
      const { ctx, page } = await openApp(browser, srv.url, { width, height: 900 });
      try {
        await page.evaluate(async () => { await globalThis.__app.importTextFile({ name: 'm.txt', type: 'text/plain', size: 24, text: '予算の見直し\nコストが高い\n' }); });
        const rows = await page.evaluate(probe);
        assert.equal(rows.length, 10);
        for (const r of rows) assert.ok(r.rect.x >= 0 && r.rect.x + r.rect.w <= width + 1 && r.rect.w > 0 && r.rect.h > 0, `${width}px: ${r.cmd} が欠けない（x=${r.rect.x}, w=${r.rect.w}）`);
        for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
          const a = rows[i].rect; const b = rows[j].rect;
          assert.ok(!(a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1), `${width}px: ${rows[i].cmd} と ${rows[j].cmd} が重ならない`);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${width}px: ページ全体の横スクロールがない`);
      } finally { await ctx.close(); }
    }
  } finally { await browser.close(); await srv.close(); }
});
