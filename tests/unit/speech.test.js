// FR-001 AC-001 AC-002 AC-003 AC-040 AC-039 / NFR-PRIV-001 AC-033 AC-034 / NFR-PERF-001 AC-038 / FR-012 AC-029 AC-043 AC-030 の単体・結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';
import { createBrowserSpeechSource, speechLang } from '../../web/src/speech.js';

function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, dump: () => [...m.values()].join('\n') };
}
class Fake {
  constructor(processLocally = true) { this.processLocally = processLocally; this.startCalls = []; this.stopCalls = 0; this.onresult = null; this.onerror = null; }
  start(o) { this.startCalls.push(o); }
  stop() { this.stopCalls++; }
  emit(text, isFinal = true) { this.onresult?.({ text, isFinal }); }
}
async function mk(sp = new Fake(), storage = mem()) {
  let t = 1_000_000;
  const app = await createApp({ storage, speechSource: sp, now: () => (t += 1000) });
  return { app, sp, storage };
}

test('FR-001 AC-003: 暫定結果は interim に出て発話にならず、確定で発話になり interim が消える', async () => {
  const { app, sp } = await mk();
  app.commands['session.start']();
  app.startSpeech();
  sp.emit('途中', false);
  assert.equal(app.getState().speech.interim, '途中');
  assert.equal(app.getState().utterances.length, 0);
  sp.emit('確定した発話', true);
  assert.equal(app.getState().speech.interim, '');
  assert.equal(app.getState().utterances.length, 1);
});

test('FR-001 AC-040 AC-034 NFR-PRIV-001: デバイス内処理が確認できないと開始せず理由を出す', async () => {
  const { app, sp } = await mk(new Fake(false));
  app.commands['session.start']();
  const r = app.startSpeech();
  assert.equal(r.ok, false);
  assert.equal(sp.startCalls.length, 0);
  assert.match(app.getState().message.text, /テキスト入力/);
  app.commands['session.pause'](); app.commands['session.resume']();
  assert.equal(sp.startCalls.length, 0);
});

test('FR-001 AC-002: マイク拒否のエラーで理由と代替手段を表示し、記録済みの内容は残る', async () => {
  const { app, sp } = await mk();
  app.commands['session.start']();
  app.startSpeech();
  sp.emit('残るべき発話', true);
  sp.onerror({ code: 'not-allowed' });
  assert.match(app.getState().message.text, /マイク/);
  assert.equal(app.getState().utterances.length, 1);
});

test('FR-001 AC-002: Web Speech API が無い環境では無効で、代替手段を案内する', async () => {
  const app = await createApp({ storage: mem() });
  assert.equal(createBrowserSpeechSource({}), null);
  app.commands['session.start']();
  assert.equal(app.startSpeech().ok, false);
  assert.match(app.getState().message.text, /テキスト/);
});

test('FR-001 AC-039: 認識言語は表示言語に一致し、切替後は次の認識から切替後の言語', async () => {
  const { app, sp } = await mk();
  app.commands['session.start']();
  app.startSpeech();
  assert.equal(sp.startCalls[0].lang, 'ja-JP');
  app.setLang('en');
  assert.equal(sp.startCalls.at(-1).lang, 'en-US');
  assert.equal(speechLang('ja'), 'ja-JP');
});

test('FR-012 AC-043: 一時停止で停止し、再開で改めて開始する', async () => {
  const { app, sp } = await mk();
  app.commands['session.start']();
  app.startSpeech();
  app.commands['session.pause']();
  assert.equal(sp.stopCalls >= 1, true);
  app.commands['session.resume']();
  assert.equal(sp.startCalls.length, 2);
});

test('NFR-PRIV-001 AC-033 FR-012 AC-029 AC-030: 保存内容に音声・暫定結果を含まず、消去で取り除かれる', async () => {
  const { app, sp, storage } = await mk();
  app.commands['session.start']();
  app.startSpeech();
  sp.emit('暫定だけの語', false);
  sp.emit('保存される発話', true);
  const dump = storage.dump();
  assert.ok(dump.includes('保存される発話'));
  assert.ok(!dump.includes('暫定だけの語'));
  assert.ok(!/audio|blob|wav|base64/i.test(dump));
  app.clearSavedSession();
  assert.equal(storage.getItem('grp.session'), null);
});

test('NFR-PERF-001 AC-038: 100 件の後の 1 件が同期的に反映され {PARAM-001}=3 秒以内', async () => {
  const { app, sp } = await mk();
  app.commands['session.start']();
  app.startSpeech();
  for (let i = 0; i < 100; i++) sp.emit(`発話${i}`, true);
  const t0 = performance.now();
  sp.emit('最後の発話', true);
  const svg = app.renderSvg();
  assert.ok(performance.now() - t0 < 3000);
  assert.ok(svg.includes('最後の発話'));
});
