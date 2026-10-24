// FR-006 AC-013 / FR-007 AC-015 AC-016（Q-029: 保存物は画面の詳細度に従う。契約: tests/system/CONTRACT.md「保存ファイル」）
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

// 保存物の文字列 out が、画面の詳細度 level と同じ内容か（期待値は AC-013・AC-015・AC-089 から）。
// 詳細: 全シーンの見出しと要点。中項目: シーンの見出しまで（要点は含まない）。大項目: トピックまで（シーンの見出し・要点は含まない）。
function assertLevelContent(app, out, level, fmt) {
  const scenes = app.getState().scenes;
  const heads = scenes.map((x) => x.heading);
  const points = scenes.flatMap((x) => x.points.map((p) => p.text));
  const topics = app.getTopics().map((t) => t.title);
  assert.ok(scenes.length === 3 && points.length >= 1, `${fmt}/${level}: 前提（3 シーン・要点あり）`);
  const shown = level === 'detail' ? [...heads, ...points] : level === 'middle' ? heads : topics;
  for (const t of shown) assert.ok(out.includes(t), `${fmt}/${level}: 「${t}」を含む`);
  const hidden = level === 'detail' ? [] : level === 'middle' ? points : [...heads, ...points];
  for (const t of hidden) {
    if (shown.some((x) => x.includes(t))) continue; // 画面に出る文字列の一部と同じ文字列は判定できない
    assert.ok(!out.includes(t), `${fmt}/${level}: 画面に出ない「${t}」を含まない`);
  }
}

// FR-006 AC-013（Q-029）: 詳細のときは全シーンの見出しと要点、中項目はシーンの見出しまで、大項目はトピックまで（画面と同じ。AC-089）
test('FR-006 AC-013: PNG 保存で PNG が得られ、画面の詳細度（詳細・中項目・大項目）と同じ内容を含む', async () => {
  for (const level of ['detail', 'middle', 'major']) {
    const { app, env } = await newApp();
    await seedThreeScenes(app, env); toDetail(app, level);
    env.canvasFactory.log.texts.length = 0;
    await app.commands['save.png']();
    assert.equal(env.downloads.length, 1, level);
    const d = env.downloads[0];
    assert.equal(d.mime, 'image/png');
    assert.match(d.filename, /\.png$/i);
    assert.deepEqual([...d.data.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${level}: 画像として開ける`);
    assertLevelContent(app, env.canvasFactory.log.texts.join('\n'), level, 'PNG');
  }
});

test('FR-006 AC-013 異常系: シーン 0 件では PNG は保存されない', async () => {
  const { app, env } = await newApp();
  await app.commands['save.png']();
  assert.equal(env.downloads.length, 0);
});

// FR-007 AC-015（Q-029）: 詳細のときは全シーンの見出しと要点、中項目・大項目は画面と同じ内容（AC-089）
test('FR-007 AC-015: PDF 保存で PDF として開ける構造のファイルが得られ、画面の詳細度（詳細・中項目・大項目）と同じ内容を含む', async () => {
  for (const level of ['detail', 'middle', 'major']) {
    const { app, env } = await newApp();
    await seedThreeScenes(app, env); toDetail(app, level);
    await app.commands['save.pdf']();
    assert.equal(env.downloads.length, 1, level);
    const d = env.downloads[0];
    assert.equal(d.mime, 'application/pdf');
    assert.match(d.filename, /\.pdf$/i);
    const s = bytesToLatin1(d.data);
    assert.ok(s.startsWith('%PDF-'));
    assert.ok(/%%EOF\s*$/.test(s));
    assert.ok(/\bxref\b/.test(s) && /\btrailer\b/.test(s) && /startxref/.test(s));
    assert.ok(/\/Type\s*\/Page\b/.test(s));
    assertLevelContent(app, pdfTexts(d.data), level, 'PDF');
  }
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
