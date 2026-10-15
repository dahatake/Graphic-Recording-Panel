// FR-023 AC-121: 処理中に同じ取込を重ねても重複して追加されない。処理中の取込でも他の操作は止まらない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';

const vttOf = (n) => ['WEBVTT', '', ...Array.from({ length: n }, (_, i) => [
  `00:00:${String(i % 60).padStart(2, '0')}.000 --> 00:00:${String(i % 60).padStart(2, '0')}.500`, `発話${i}`, '']).flat()].join('\n');
const file = (text) => ({ name: 'a.vtt', type: 'text/vtt', size: Buffer.byteLength(text), text });

test('FR-023 AC-121: 処理中の重ねた取込は受け付けず、発話は重複しない', async () => {
  const waiters = [];
  const app = await createApp({ storage: { getItem: () => null, setItem() {}, removeItem() {} }, importYield: () => new Promise((r) => waiters.push(r)) });
  app.commands['session.start']();
  const f = file(vttOf(120));
  const p1 = app.importTextFile(f);
  const second = await app.importTextFile(f);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'busy');
  assert.equal(app.getImportStatus().state, 'processing');
  // 処理中も他の操作（レイアウト変更）は止まらない
  assert.doesNotThrow(() => app.commands['layout.tile']());
  while (waiters.length || app.getImportStatus().state === 'processing') {
    const w = waiters.shift(); if (w) w(); await new Promise((r) => setImmediate(r));
  }
  assert.equal((await p1).ok, true);
  assert.equal(app.getState().utterances.length, 120);
  assert.equal(app.getImportStatus().state, 'done');
});
