// NFR-BG-001 AC-064（自動終了後の再開・上限）と AC-063/065（非表示中の記録）の単体・結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';
import { createBrowserSpeechSource } from '../../web/src/speech.js';

function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
class Sched {
  constructor() { this.q = []; this.n = 1; }
  setTimeout(fn, ms) { const id = this.n++; this.q.push({ id, ms, fn }); return id; }
  clearTimeout(id) { this.q = this.q.filter((e) => e.id !== id); }
  flush() { const q = this.q; this.q = []; q.forEach((e) => e.fn()); return q.map((e) => e.ms); }
}
class Fake {
  constructor() { this.processLocally = true; this.startCalls = []; this.stopCalls = 0; this.onresult = null; this.onerror = null; this.onend = null; }
  start(o) { this.startCalls.push(o); }
  stop() { this.stopCalls++; }
  emit(text, isFinal = true) { this.onresult?.({ text, isFinal }); }
}
async function mk() {
  const sp = new Fake(); const sched = new Sched(); const vis = { hidden: false, onchange: null };
  let t = 1_000_000;
  const app = await createApp({ storage: mem(), speechSource: sp, scheduler: sched, visibility: vis, now: () => (t += 1000) });
  app.commands['session.start'](); app.startSpeech();
  return { app, sp, sched, vis };
}

test('NFR-BG-001 AC-064: 自動終了から 2 秒以内（PARAM-008）に再開され、結果が来ると失敗回数が戻る', async () => {
  const { sp, sched } = await mk();
  for (let i = 0; i < 20; i++) {
    sp.onend();
    const ms = sched.flush();
    assert.ok(ms.length === 1 && ms[0] <= 2000);
    sp.emit(`発話${i}`); // 結果が届けば上限に達しない
  }
  assert.equal(sp.startCalls.length, 21);
});

test('NFR-BG-001 AC-064: 結果が得られないまま再開が続くと上限で止まり、無限に再開しない', async () => {
  const { app, sp, sched } = await mk();
  for (let i = 0; i < 50; i++) { sp.onend?.(); sched.flush(); }
  assert.ok(sp.startCalls.length <= 7);
  assert.equal(app.getState().speech.active, false);
  assert.equal(app.getState().session, 'recording');
});

test('NFR-BG-001 AC-064: 再開待ちの間に停止すると再開しない・二重に予約しない', async () => {
  const { app, sp, sched } = await mk();
  sp.onend(); sp.onend();
  assert.equal(sched.q.length, 1);
  app.stopSpeech();
  const n = sp.startCalls.length;
  sched.flush();
  assert.equal(sp.startCalls.length, n);
});

test('NFR-BG-001 AC-063 AC-065: 非表示の間も確定結果は欠落・重複なく記録され、stop は呼ばれない', async () => {
  const { app, sp, vis } = await mk();
  const stops = sp.stopCalls;
  vis.hidden = true; vis.onchange();
  ['a', 'b', 'b', 'c'].forEach((t) => sp.emit(t));
  vis.hidden = false; vis.onchange();
  assert.deepEqual(app.getState().utterances.map((u) => u.text), ['a', 'b', 'b', 'c']);
  assert.equal(sp.stopCalls, stops);
});

test('NFR-BG-001 AC-064: 実ブラウザ実装は rec.onend を src.onend へ中継する', async () => {
  let inst;
  class SR { constructor() { inst = this; } start() {} stop() {} }
  const src = createBrowserSpeechSource({ SpeechRecognition: SR });
  src.processLocally = true;
  let ended = 0; src.onend = () => ended++;
  src.start({ lang: 'ja-JP' });
  inst.onend();
  assert.equal(ended, 1);
  src.stop();
  assert.equal(inst.onend, null);
});
