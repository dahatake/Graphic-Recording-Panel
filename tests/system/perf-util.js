// 性能の System Test 用ヘルパー（実ブラウザ。NFR-PERF-002〜004）。
// 依存: playwright-core（import できないときはテストが失敗する＝実装前は想定どおり）と Chromium 系ブラウザ（Edge/Chrome。PERF_BROWSER で実行ファイルを指定可）。
// 期待値は要求定義書の PARAM だけ。web/ は静的ファイルとして配信して開くだけ（実装は読まない）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WEB } from './helpers.js';

// PARAM-076..080（docs/requirements-definition.md の PARAM 表）
export const PERF = { RESPONSE_MS: 100, MIN_FPS: 30, BIG_UTTERANCES: 500, IDLE_CPU_PCT: 5, FIRST_SEC: 2, UPPER_SEC: 15 /* PARAM-001（2026-10-26 に 3 から変更） */ };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };

export function serveWeb() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(WEB, path.normalize(p));
      if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}/`, close: () => new Promise((r) => srv.close(r)) }));
  });
}

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
];

// playwright-core を tests/system 内に 1 回だけ導入する（mkdir の原子的ロック。並行実行でも 1 プロセスだけが npm を走らせる）。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCK = path.join(HERE, '.npm-lock');
const STALE_MS = 5 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function resolvePw() {
  try { return createRequire(path.join(HERE, 'x.js')).resolve('playwright-core'); } catch { return null; }
}
async function ensureDeps() {
  if (resolvePw()) return;
  const deadline = Date.now() + STALE_MS + 60_000;
  while (!resolvePw()) {
    let got = false;
    try { fs.mkdirSync(LOCK); got = true; } catch {
      try { if (Date.now() - fs.statSync(LOCK).mtimeMs > STALE_MS) fs.rmSync(LOCK, { recursive: true, force: true }); } catch { /* 競合は無視 */ }
    }
    if (got) {
      try {
        if (!resolvePw()) {
          const run = (args) => spawnSync('npm', args, { cwd: HERE, shell: true, stdio: 'pipe', encoding: 'utf8' });
          let r = run(['ci', '--no-audit', '--no-fund']);
          if (r.status !== 0) r = run(['install', '--no-audit', '--no-fund']);
          if (r.status !== 0) console.error(`[perf-util] npm 失敗: ${(r.stderr || '').slice(-500)}`);
        }
      } finally { fs.rmSync(LOCK, { recursive: true, force: true }); }
      break;
    }
    if (Date.now() > deadline) break;
    await sleep(500);
  }
  if (!resolvePw()) throw new Error('playwright-core を導入できない。tests/system で `npm ci`（または `npm install`）を実行すること（Node と npm が必要）。');
}

export async function launch() {
  await ensureDeps();
  const { chromium } = createRequire(path.join(HERE, 'x.js'))('playwright-core');
  const exe = process.env.PERF_BROWSER || CANDIDATES.find((c) => fs.existsSync(c));
  if (!exe) throw new Error('Chromium 系ブラウザが見つからない（PERF_BROWSER で指定する）');
  return chromium.launch({ executablePath: exe, headless: true });
}

// 疑似の音声認識（Web Speech API の代用）。ページの起動前に注入する。window.__emit(text, isFinal) で認識結果を流す。
const INIT = `
(() => {
  let cur = null;
  class FakeSR {
    constructor() { this.onresult = null; this.onerror = null; this.onend = null; }
    start() { cur = this; }
    stop() { if (cur === this) cur = null; }
    abort() { this.stop(); }
    static async available() { return 'available'; }
    static async install() { return true; }
    get processLocally() { return true; }
    set processLocally(v) {}
  }
  window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  window.__emit = (text, isFinal = true) => {
    if (!cur || !cur.onresult) return false;
    const r = [{ transcript: text }]; r.isFinal = isFinal;
    cur.onresult({ resultIndex: 0, results: [r] });
    return true;
  };
  // 計測: 入力 → 次の描画までの時間、フレーム、長いタスク
  const m = window.__perf = { lat: [], frames: 0, t0: 0, long: [], on: false };
  const onInput = (e) => {
    if (!m.on) return;
    const t = e.timeStamp;
    requestAnimationFrame(() => { const ch = new MessageChannel(); ch.port1.onmessage = () => m.lat.push(performance.now() - t); ch.port2.postMessage(0); });
  };
  for (const ev of ['click', 'mouseover', 'pointerover']) document.addEventListener(ev, onInput, true);
  const loop = () => { if (m.on) m.frames++; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => { if (m.on) for (const e of l.getEntries()) m.long.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch {}
})();
`;

export async function openApp(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!globalThis.__app);
  return { ctx, page };
}

export const p95 = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] : 0; };

export const measureStart = (page) => page.evaluate(() => { const m = window.__perf; m.lat = []; m.frames = 0; m.long = []; m.t0 = performance.now(); m.on = true; });
export const measureStop = (page) => page.evaluate(() => {
  const m = window.__perf; m.on = false;
  const sec = (performance.now() - m.t0) / 1000;
  return { lat: m.lat.slice(), fps: m.frames / sec, long: m.long.slice(), sec };
});
// 後続の描画（遅れて届く計測）を待つ
export const settle = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 150)));

export async function box(page, sel) {
  const el = page.locator(sel).first();
  const b = await el.boundingBox();
  if (!b) throw new Error(`${sel} が表示されていない`);
  return b;
}

// コマンドバー・パネル・図に対するクリックとホバーを各 n 回
export async function clickHoverRounds(page, n = 20) {
  const targets = ['#toolbar button:not([disabled])', '.panel-head', '#diagram'];
  for (const sel of targets) {
    const b = await box(page, sel);
    for (let i = 0; i < n; i++) {
      const x = b.x + Math.min(b.width - 2, 4 + ((i * 7) % Math.max(4, Math.floor(b.width / 2))));
      const y = b.y + b.height / 2;
      await page.mouse.move(x, y, { steps: 2 });
      await page.waitForTimeout(30);
      if (sel === '#toolbar button:not([disabled])') { await page.mouse.move(x, y); } // ホバーのみ（ボタンの副作用を避ける）
      else await page.mouse.click(x, y);
      await page.waitForTimeout(30);
    }
  }
}

// パネルのドラッグ（移動・大きさ変更）と図のスクロール・ホイール
export async function dragAndScroll(page) {
  const head = await box(page, '[data-panel="input"] .panel-head');
  await page.mouse.move(head.x + 20, head.y + head.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) { await page.mouse.move(head.x + 20 + i * 4, head.y + head.height / 2 + i * 2); await page.waitForTimeout(8); }
  await page.mouse.up();
  const grip = page.locator('.resize-grip').first();
  if (await grip.count()) {
    const g = await grip.boundingBox();
    if (g) {
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 40; i++) { await page.mouse.move(g.x + g.width / 2 + i * 3, g.y + g.height / 2 + i * 2); await page.waitForTimeout(8); }
      await page.mouse.up();
    }
  }
  const d = await box(page, '#diagram');
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, i % 2 ? -120 : 120); await page.waitForTimeout(8); }
}

export async function startRecording(page) {
  await page.evaluate(() => { globalThis.__app.commands['session.start'](); return globalThis.__app.startSpeech(); });
}

export const emit = (page, text) => page.evaluate((t) => window.__emit(t, true), text);

export async function emitMany(page, n, prefix = '発話') {
  await page.evaluate(async ({ n, prefix }) => {
    for (let i = 0; i < n; i++) { window.__emit(`${prefix}${i} 予算とリリース計画について確認する`, true); if (i % 50 === 49) await new Promise((r) => setTimeout(r, 0)); }
  }, { n, prefix });
}
