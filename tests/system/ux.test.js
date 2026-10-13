// NFR-UX-001 AC-057 AC-060 AC-061（System Test。契約: tests/system/CONTRACT.md「コマンドバーとステータス」「見た目の資産」）
// 自動化できる範囲: CSS トークンの存在・コントラスト計算・ARIA・コマンドの到達性。見た目の最終確認は MANUAL-SUPPLEMENT.md。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newApp, FakeSpeech, WEB } from './helpers.js';

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
