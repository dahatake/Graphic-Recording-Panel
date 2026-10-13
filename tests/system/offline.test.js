// NFR-OFFLINE-001 AC-031 AC-032（契約: 「外部通信」）
// 公開 API: createApp(options)（fetch 等のグローバルを使わない）、web/ 配下の静的資産に外部 URL を書かない
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newApp, seedThreeScenes, WEB } from './helpers.js';

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

async function allFlows({ blockNetwork }) {
  const calls = [];
  const saved = {};
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
  for (const k of names) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: function (...a) { calls.push({ k, a }); throw new Error('network blocked'); } });
  }
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { ...(nav?.value || {}), sendBeacon: (...a) => { calls.push({ k: 'sendBeacon', a }); return false; } } });
  try {
    const { app, env } = await newApp();
    await seedThreeScenes(app, env);
    app.startSpeech();
    env.speech.emit('声での発話', true);
    await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: 5, text: '行1\n行2' });
    app.setViewMode('3d'); app.setViewMode('2d');
    app.setLang('en'); app.setLang('ja');
    app.commands['presentation.start'](); env.scheduler.advance(30_000); app.commands['presentation.stop']();
    await app.commands['save.png'](); await app.commands['save.svg'](); await app.commands['save.pdf']();
    app.commands['session.pause'](); app.commands['session.stop']();
    return { app, env, calls };
  } finally {
    for (const k of names) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
  }
}

test('NFR-OFFLINE-001 AC-031: 全機能の操作中（音声認識を含む）に同一オリジン以外へのリクエストが 0 件', async () => {
  const { calls, env } = await allFlows({ blockNetwork: false });
  assert.deepEqual(calls.filter((c) => !String(c.a[0] ?? '').startsWith('/')), []);
  assert.equal(env.downloads.length, 3);
});

test('NFR-OFFLINE-001 AC-031: web/ の静的資産に外部 URL・CDN・外部 import がない', async () => {
  const files = walk(WEB).filter((f) => /\.(html|js|mjs|css|svg|json|webmanifest)$/i.test(f));
  assert.ok(files.some((f) => f.endsWith('index.html')), 'web/index.html が必要');
  assert.ok(files.length >= 2);
  const bad = [];
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8').replace(/xmlns(:\w+)?\s*=\s*["'][^"']*["']/g, '');
    for (const m of s.matchAll(/(https?:)?\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^\s"'`)]*/g)) {
      if (/^\/\/\s/.test(m[0])) continue;
      bad.push(`${path.relative(WEB, f)}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('NFR-OFFLINE-001 AC-032: ネットワーク遮断（fetch 等が全て失敗）でも起動・手入力・図・2D/3D・保存が動く', async () => {
  const { app, env, calls } = await allFlows({ blockNetwork: true });
  assert.ok(app.getState().scenes.length >= 3);
  assert.deepEqual(env.downloads.map((d) => d.mime), ['image/png', 'image/svg+xml', 'application/pdf']);
  assert.equal(calls.length, 0);
});

test('NFR-OFFLINE-001 AC-032 異常系: 音声認識がデバイス内処理でないとき開始されず、外部へ音声を送る経路がない', async () => {
  const { app, env } = await newApp({ speech: Object.assign(new (await import('./helpers.js')).FakeSpeech(), { processLocally: false }) });
  app.commands['session.start']();
  const r = app.startSpeech();
  assert.equal(r.ok, false);
  assert.equal(env.speech.startCalls.length, 0);
});
