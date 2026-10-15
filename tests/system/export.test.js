// FR-006 AC-013 / FR-007 AC-015 AC-016（契約: tests/system/CONTRACT.md「保存ファイル」）
// 公開 API: await app.commands['save.png'|'save.pdf'|'save.svg']() → options.download({filename,mime,data})
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, visibleTexts, pdfTexts, bytesToLatin1, toDetail } from './helpers.js';

async function withNetSpy(fn) {
  const calls = [];
  const saved = {};
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: function () { calls.push(k); throw new Error('network ' + k); } });
  }
  try { await fn(); } finally {
    for (const k of Object.keys(saved)) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
  }
  return calls;
}

test('FR-006 AC-013: PNG 保存で全シーンの見出しと要点を含む PNG が得られる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  await app.commands['save.png']();
  assert.equal(env.downloads.length, 1);
  const d = env.downloads[0];
  assert.equal(d.mime, 'image/png');
  assert.match(d.filename, /\.png$/i);
  assert.deepEqual([...d.data.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const drawn = env.canvasFactory.log.texts.join('\n');
  for (const t of visibleTexts(app.getState())) assert.ok(drawn.includes(t), `PNG に「${t}」が描かれる`);
});

test('FR-006 AC-013 異常系: シーン 0 件では PNG は保存されない', async () => {
  const { app, env } = await newApp();
  await app.commands['save.png']();
  assert.equal(env.downloads.length, 0);
});

test('FR-007 AC-015: PDF 保存で PDF として開ける構造のファイルが得られ、全シーンの見出しと要点を含む', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  await app.commands['save.pdf']();
  assert.equal(env.downloads.length, 1);
  const d = env.downloads[0];
  assert.equal(d.mime, 'application/pdf');
  assert.match(d.filename, /\.pdf$/i);
  const s = bytesToLatin1(d.data);
  assert.ok(s.startsWith('%PDF-'));
  assert.ok(/%%EOF\s*$/.test(s));
  assert.ok(/\bxref\b/.test(s) && /\btrailer\b/.test(s) && /startxref/.test(s));
  assert.ok(/\/Type\s*\/Page\b/.test(s));
  const text = pdfTexts(d.data);
  for (const t of visibleTexts(app.getState())) assert.ok(text.includes(t), `PDF に「${t}」`);
});

test('FR-007 AC-015 異常系: シーン 0 件では PDF は保存されない', async () => {
  const { app, env } = await newApp();
  await app.commands['save.pdf']();
  assert.equal(env.downloads.length, 0);
});

test('FR-007 AC-016: PDF 生成中の外部リクエストが 0 件で、PDF に外部参照もない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const calls = await withNetSpy(async () => { await app.commands['save.pdf'](); });
  assert.deepEqual(calls, []);
  const s = bytesToLatin1(env.downloads[0].data);
  assert.ok(!/\/URI|https?:\/\//i.test(s));
});

test('FR-007 AC-015 補助: SVG 保存（FR-006）の文字列に全シーンの見出しと要点が含まれる', async () => {
  const { app, env } = await newApp(); toDetail(app);
  await seedThreeScenes(app, env);
  await app.commands['save.svg']();
  const d = env.downloads[0];
  assert.equal(d.mime, 'image/svg+xml');
  for (const t of visibleTexts(app.getState())) assert.ok(d.data.includes(t));
});
