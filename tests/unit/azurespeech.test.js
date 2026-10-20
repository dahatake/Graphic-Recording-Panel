// FR-081 AC-441 AC-442 AC-443 AC-444 AC-445 AC-446 AC-447 AC-458 の単体・結合テスト
// （web/src/azurespeech.js・web/src/speech.js・web/src/relayclient.js・web/src/ui.js と、中継サーバー server/relay.py の実プロセス）。
// 実際の Azure Speech へは通信しない。上流は tests/system/azurespeech-util.js のモック、キー・エンドポイントはダミーだけ（AC-447）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newApp, FakeSpeech } from '../system/helpers.js';
import {
  DUMMY_HOST, DUMMY_ENDPOINT, dummySpeechKey, FakeAzureSpeech, makeSpeechRelay, startSpeechUpstream, startSpeechRelay, speechReq, saveSettings,
} from '../system/azurespeech-util.js';
import {
  createRelayAzureSpeechSource, encodeWav, downsample, createSegmenter, classifyRecognize, AZURE_STRINGS,
} from '../../web/src/azurespeech.js';
import { relayRequest } from '../../web/src/relayclient.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const tick = () => new Promise((r) => setImmediate(r));
const LOCAL = { availability: { 'ja-JP': 'local', 'en-US': 'local' } };

// マイクと AudioContext の偽物（音声は合成した正弦波。実データではない）
function fakeAudio({ denied = false, rate = 48_000 } = {}) {
  const st = { nodes: [], tracks: [], contexts: [], gum: 0 };
  class Track { constructor() { this.stopped = false; this.onended = null; } stop() { this.stopped = true; } }
  const g = {
    navigator: { mediaDevices: { getUserMedia: async () => {
      st.gum++;
      if (denied) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      const t = new Track(); st.tracks.push(t);
      return { getTracks: () => [t], getAudioTracks: () => [t] };
    } } },
    AudioContext: class {
      constructor() { this.sampleRate = rate; this.destination = {}; this.closed = false; st.contexts.push(this); }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createScriptProcessor() { const n = { onaudioprocess: null, connect() {}, disconnect() { n.off = true; } }; st.nodes.push(n); return n; }
      close() { this.closed = true; return Promise.resolve(); }
    },
  };
  // amp の正弦波を frames 個（1 個 4096 サンプル）流す
  st.feed = (amp, frames) => {
    const n = st.nodes.at(-1);
    for (let i = 0; i < frames; i++) {
      const d = new Float32Array(4096);
      for (let j = 0; j < d.length; j++) d[j] = amp * Math.sin(j / 3);
      n?.onaudioprocess?.({ inputBuffer: { getChannelData: () => d } });
    }
  };
  st.utter = () => { st.feed(0.3, 8); st.feed(0, 10); }; // 発話 → 無音（区切り）
  return { g, st };
}
function fakeRelayFn(reply = () => ({ status: 200, body: { ok: true, result: 'success', text: 'ダミーの認識結果' } })) {
  const calls = [];
  const fn = async (req) => { calls.push(req); return reply(req, calls.length); };
  return { calls, fn };
}

// ---------------- 単体: 音声の形・区切り・応答の分類 ----------------
// FR-081 AC-446: 音声は 16 kHz・16 bit・モノラルの WAV にして送るだけ（保存しない）
test('FR-081 AC-446: encodeWav は 16 kHz・16 bit・モノラルの WAV を作り、downsample は 16 kHz の Int16 に変える', () => {
  const pcm = downsample(new Float32Array(4800).fill(0.5), 48_000);
  assert.equal(pcm.length, 1600);
  assert.ok(pcm.every((x) => x > 16_000 && x < 16_400));
  const wav = encodeWav([pcm]);
  const v = new DataView(wav.buffer);
  assert.equal(Buffer.from(wav.slice(0, 4)).toString('ascii'), 'RIFF');
  assert.equal(Buffer.from(wav.slice(8, 12)).toString('ascii'), 'WAVE');
  assert.equal(v.getUint16(22, true), 1, 'モノラル');
  assert.equal(v.getUint32(24, true), 16_000, '16 kHz');
  assert.equal(v.getUint16(34, true), 16, '16 bit');
  assert.equal(v.getUint32(40, true), pcm.length * 2);
  assert.equal(wav.length, 44 + pcm.length * 2);
});

// FR-081 AC-443 AC-446: 無音だけの区間は送らない。発話の後の無音で区切り、長い発話は上限で区切る
test('FR-081 AC-443: 区切りは無音だけでは出さず、発話＋無音で 1 区間、長い発話は 15 秒の上限で区切る', () => {
  const s = createSegmenter();
  const frame = (amp) => { const d = new Float32Array(4096); for (let j = 0; j < d.length; j++) d[j] = amp * Math.sin(j / 3); return d; };
  for (let i = 0; i < 200; i++) assert.equal(s.push(frame(0), 48_000), null, '無音だけは送らない');
  for (let i = 0; i < 5; i++) assert.equal(s.push(frame(0.3), 48_000), null);
  let out = null;
  for (let i = 0; i < 20 && !out; i++) out = s.push(frame(0), 48_000);
  assert.ok(Array.isArray(out) && out.length > 5, '発話の後の無音で区切る');
  let long = null, n = 0;
  while (!long && n < 1000) { long = s.push(frame(0.3), 48_000); n++; }
  const ms = long.reduce((a, p) => a + p.length, 0) / 16;
  assert.ok(ms >= 15_000 && ms < 15_200, `上限で区切る（${ms} ms）`);
});

// FR-081 AC-444: 応答の分類（未設定・認証・接続）
test('FR-081 AC-444: 中継サーバーの応答を 成功・未設定・認証・接続 に分類する', () => {
  assert.deepEqual(classifyRecognize({ status: 200, body: { ok: true, result: 'success', text: 'あ' } }), { ok: true, text: 'あ' });
  assert.deepEqual(classifyRecognize({ status: 200, body: { ok: false, result: 'unconfigured' } }), { ok: false, code: 'unconfigured' });
  assert.deepEqual(classifyRecognize({ status: 200, body: { ok: false, result: 'auth' } }), { ok: false, code: 'auth' });
  assert.deepEqual(classifyRecognize({ status: 200, body: { ok: false, result: 'network' } }), { ok: false, code: 'network' });
  assert.deepEqual(classifyRecognize({ status: 200, body: { ok: false, result: 'timeout' } }), { ok: false, code: 'network' });
  assert.deepEqual(classifyRecognize({ status: 403, body: null }), { ok: false, code: 'auth' });
  assert.deepEqual(classifyRecognize({ status: 502, body: null }), { ok: false, code: 'network' });
  assert.deepEqual(classifyRecognize(null), { ok: false, code: 'network' });
});

// ---------------- 単体: 実ブラウザ用の AzureSpeechSource（偽のマイク・偽の中継） ----------------
// FR-081 AC-443: 音声は同一オリジンの中継サーバー（/api/speech/recognize）だけへ、start〜stop の間だけ送る
test('FR-081 AC-443: AzureSpeechSource は start〜stop の間だけ、同一オリジンの /api/speech/recognize に言語つきで WAV を送る', async () => {
  const { g, st } = fakeAudio();
  const relay = fakeRelayFn();
  const src = createRelayAzureSpeechSource({ relay: relay.fn, g });
  const got = [];
  src.onresult = (e) => got.push(e);
  st.utter(); // 開始前の音は送らない
  assert.equal(relay.calls.length, 0);
  src.start({ lang: 'ja-JP' }); await flush();
  assert.equal(st.gum, 1);
  st.utter(); await flush();
  assert.equal(relay.calls.length, 1);
  const c = relay.calls[0];
  assert.equal(c.method, 'POST');
  assert.equal(c.path, '/api/speech/recognize?language=ja-JP');
  assert.equal(c.contentType, 'audio/wav');
  assert.ok(c.body instanceof Uint8Array && Buffer.from(c.body.slice(0, 4)).toString('ascii') === 'RIFF');
  assert.deepEqual(got, [{ text: 'ダミーの認識結果', isFinal: true }], '確定結果として渡す');
  src.stop();
  assert.ok(st.tracks.every((t) => t.stopped), '停止でマイクを解放する');
  assert.ok(st.contexts.every((x) => x.closed));
  st.utter(); await flush();
  assert.equal(relay.calls.length, 1, '停止後は送らない');
  // 言語を変えて開始し直すと、次の認識からその言語（AC-445）
  src.start({ lang: 'en-US' }); await flush();
  st.utter(); await flush();
  assert.equal(relay.calls.at(-1).path, '/api/speech/recognize?language=en-US');
  src.stop();
});

// FR-081 AC-444: 失敗の分類を onerror で伝え、それ以上は送らない
for (const [result, code] of [['unconfigured', 'unconfigured'], ['auth', 'auth'], ['network', 'network'], ['timeout', 'network']]) {
  test(`FR-081 AC-444 異常系(${result}): AzureSpeechSource は失敗を onerror({code:'${code}'}) で伝え、以後は送らない`, async () => {
    const { g, st } = fakeAudio();
    const relay = fakeRelayFn(() => ({ status: 200, body: { ok: false, result } }));
    const src = createRelayAzureSpeechSource({ relay: relay.fn, g });
    const errs = [];
    src.onerror = (e) => errs.push(e.code);
    src.start({ lang: 'ja-JP' }); await flush();
    st.utter(); await flush();
    assert.deepEqual(errs, [code]);
    assert.ok(st.tracks.every((t) => t.stopped), '失敗でマイクを解放する');
    st.utter(); await flush();
    assert.equal(relay.calls.length, 1);
  });
}

test('FR-081 AC-444 異常系: 中継サーバーが応答しない（例外）は接続、マイクの拒否は mic、relay がなければ作らない', async () => {
  {
    const { g, st } = fakeAudio();
    const src = createRelayAzureSpeechSource({ relay: async () => { throw new TypeError('Failed to fetch'); }, g });
    const errs = []; src.onerror = (e) => errs.push(e.code);
    src.start({ lang: 'ja-JP' }); await flush(); st.utter(); await flush();
    assert.deepEqual(errs, ['network']);
  }
  {
    const { g } = fakeAudio({ denied: true });
    const relay = fakeRelayFn();
    const src = createRelayAzureSpeechSource({ relay: relay.fn, g });
    const errs = []; src.onerror = (e) => errs.push(e.code);
    src.start({ lang: 'ja-JP' }); await flush();
    assert.deepEqual(errs, ['mic']);
    assert.equal(relay.calls.length, 0);
  }
  {
    const src = createRelayAzureSpeechSource({ relay: fakeRelayFn().fn, g: {} });
    const errs = []; src.onerror = (e) => errs.push(e.code);
    src.start({ lang: 'ja-JP' }); await flush();
    assert.deepEqual(errs, ['mic'], 'マイクの API がない');
  }
  assert.equal(createRelayAzureSpeechSource({ relay: null }), null);
});

// FR-081 AC-446: 停止で、送っていない音声も捨てる（遅れて届いた結果も使わない）
test('FR-081 AC-446: 停止の後に届いた認識結果は使わず、未送信の音声は捨てる', async () => {
  const { g, st } = fakeAudio();
  let release;
  const relay = fakeRelayFn(() => new Promise((r) => { release = () => r({ status: 200, body: { ok: true, result: 'success', text: '遅れた結果' } }); }));
  const src = createRelayAzureSpeechSource({ relay: relay.fn, g });
  const got = []; src.onresult = (e) => got.push(e);
  src.start({ lang: 'ja-JP' }); await flush();
  st.utter(); st.utter(); await flush();
  assert.equal(relay.calls.length, 1, '1 件ずつ順に送る');
  src.stop();
  release(); await flush();
  assert.deepEqual(got, [], '停止後の結果は使わない');
  assert.equal(relay.calls.length, 1, '未送信の音声は送らずに捨てる');
});

// FR-081 AC-443: relayclient は音声を同一オリジンの /api/speech/ にだけ、そのまま本文にして送る
test('FR-081 AC-443: relayRequest は音声（Uint8Array）をそのまま本文にし content-type を付けて同一オリジンへ送る。外部の URL は拒否', async () => {
  const orig = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return { status: 200, json: async () => ({ ok: true, result: 'success', text: 'x' }) }; };
  try {
    const wav = encodeWav([new Int16Array(16)]);
    const r = await relayRequest({ method: 'POST', path: '/api/speech/recognize?language=ja-JP', body: wav, contentType: 'audio/wav' });
    assert.equal(r.status, 200);
    assert.equal(seen[0].url, '/api/speech/recognize?language=ja-JP');
    assert.equal(seen[0].init.body, wav, '音声をそのまま送る（JSON にしない）');
    assert.equal(seen[0].init.headers['content-type'], 'audio/wav');
    assert.equal(seen[0].init.credentials, 'same-origin');
    await relayRequest({ method: 'POST', path: '/api/speech/settings', body: { endpoint: 'x' } });
    assert.equal(seen[1].init.body, '{"endpoint":"x"}');
    assert.equal(seen[1].init.headers['content-type'], 'application/json');
    await assert.rejects(relayRequest({ method: 'POST', path: `https://${DUMMY_HOST}/speech/recognition/`, body: wav }));
    assert.equal(seen.length, 2);
  } finally { globalThis.fetch = orig; }
});

// ---------------- 結合: アプリ（createApp）と AzureSpeechSource の偽物 ----------------
async function bootApp({ configured = true, speech = LOCAL } = {}) {
  const relay = makeSpeechRelay({ host: configured ? DUMMY_HOST : null, keyConfigured: configured });
  const azure = new FakeAzureSpeech();
  const ctx = await newApp({ speech: new FakeSpeech(speech), options: { relay: relay.fn, azureSpeechSource: azure } });
  await ctx.app.refreshAzureSpeechStatus(); await flush();
  return { ...ctx, relay, azure };
}
async function recordAzure(app) { assert.equal(app.setSpeechMethod('azure').ok, true); app.commands['session.start'](); app.setSpeechConsent(true); await flush(); }

// FR-081 AC-441: 方式がブラウザ標準のときの挙動は変えない
test('FR-081 AC-441: 方式がブラウザ標準（既定）なら従来どおりブラウザの音声認識で開始し、Azure Speech は使わない', async () => {
  const { app, env, azure } = await bootApp();
  assert.equal(app.getSpeechMethod(), 'browser');
  assert.equal(app.getSpeechStatus().method, 'browser');
  assert.equal(app.getSpeechStatus().state, 'local');
  assert.equal(app.getConsentUi().visible, false);
  app.commands['session.start'](); await flush();
  assert.equal(env.speech.startCalls.length, 1);
  assert.equal(azure.startCalls.length, 0);
  env.speech.emit('ブラウザの結果'); await flush();
  assert.deepEqual(app.getState().utterances.map((u) => u.text), ['ブラウザの結果']);
});

// FR-081 AC-441: 方式の切替の旨は残し、記録中で同意が要るときは同意待ちの表示にする
test('FR-081 AC-441: 記録していないときの方式の切替は「音声認識の方式」の表示を出し、記録中なら同意待ちの表示で上書きする', async () => {
  const { app } = await bootApp();
  app.setSpeechMethod('azure'); await flush();
  assert.match(app.getState().message.text, /音声認識の方式: Azure Speech/);
  app.setSpeechMethod('browser'); await flush();
  app.commands['session.start'](); await flush();
  app.setSpeechMethod('azure'); await flush();
  assert.match(app.getState().message.text, /同意/);
  app.setLang('en'); await flush();
  assert.match(app.getState().message.text, /Consent/, '表示言語に従って訳し直す');
});

// FR-081 AC-445: 状態表示の文言は ja/en で互いに異なり、Azure Speech を文字で示す
test('FR-081 AC-445: Azure Speech の状態表示の文言は ja/en にそろい、6 状態が互いに異なり、英語でも Azure Speech を示す', () => {
  for (const lang of ['ja', 'en']) {
    const s = AZURE_STRINGS[lang];
    const keys = ['available', 'consent', 'unconfigured', 'auth', 'network', 'mic'].map((k) => `speech.status.azure.${k}`);
    const texts = keys.map((k) => s[k]);
    assert.ok(texts.every((x) => typeof x === 'string' && x.includes('Azure Speech')), lang);
    assert.equal(new Set(texts).size, 6, lang);
  }
  assert.deepEqual(Object.keys(AZURE_STRINGS.ja).sort(), Object.keys(AZURE_STRINGS.en).sort(), 'ja と en の鍵がそろう');
});

// FR-081 AC-445: 言語の切替は、記録中なら次の認識から切替後の言語で開始し直す
test('FR-081 AC-445: 記録中に表示言語を切り替えると、Azure Speech を切替後の言語で開始し直す', async () => {
  const { app, azure } = await bootApp();
  await recordAzure(app);
  assert.equal(azure.startCalls.at(-1).lang, 'ja-JP');
  app.setLang('en'); await flush();
  assert.equal(azure.startCalls.at(-1).lang, 'en-US');
  assert.equal(azure.active, true);
});

// FR-081 AC-458: 自動の再開は PARAM-008（2 秒）以内。何度でも続く（無言の長い会議で止まらない）
test('FR-081 AC-458 (a): 上流の正常な終了が続いても、そのたびに PARAM-008 秒以内に再開し、停止の表示をしない', async () => {
  const { app, env, azure } = await bootApp();
  await recordAzure(app);
  for (let i = 0; i < 12; i++) {
    azure.end(i % 2 ? 'token_expired' : 'upstream_end'); await flush();
    assert.equal(app.getSpeechStatus().state, 'available');
    env.scheduler.advance(1999);
    assert.equal(azure.startCalls.length, i + 2, `${i + 1} 回目の終了の後も再開する`);
  }
  assert.equal(app.getState().message, null, '停止・失敗の表示をしない');
});

// FR-081 AC-458 (c): 再開の待ちの間に一時停止・方式の切替をしたら、再開しない
test('FR-081 AC-458 (c) 異常系: 再開を待つ間に一時停止・同意を外す・方式を切り替えると、自動の再開をしない', async () => {
  for (const op of [(app) => app.commands['session.pause'](), (app) => app.setSpeechConsent(false), (app) => app.setSpeechMethod('browser'), (app) => app.commands['session.stop']()]) {
    const { app, env, azure } = await bootApp({ speech: { processLocally: false, availability: { 'ja-JP': 'remote', 'en-US': 'remote' } } });
    await recordAzure(app);
    azure.end('upstream_end'); await flush();
    op(app); await flush();
    env.scheduler.advance(10_000);
    assert.equal(azure.startCalls.length, 1);
  }
});

// FR-081 AC-444: 失敗の後の 1 回の操作。記録中でないときの再試行は失敗の表示だけを消し、送らない
test('FR-081 AC-444: 失敗の後、記録の再開・再試行で改めて開始し、記録中でないときの再試行は送らない。理由のメッセージは表示言語に従う', async () => {
  const { app, azure } = await bootApp();
  await recordAzure(app);
  azure.fail('auth'); await flush();
  assert.match(app.getState().message.text, /認証/);
  app.setLang('en'); await flush();
  assert.match(app.getState().message.text, /authentication/);
  app.commands['session.pause'](); await flush();
  assert.equal(app.getSpeechStatus().state, 'unavailable', '一時停止しても理由は残る');
  app.commands['speech.retryAzure'](); await flush();
  assert.equal(azure.startCalls.length, 1, '記録中でなければ送らない');
  assert.equal(app.getSpeechStatus().state, 'available');
  app.commands['session.resume'](); await flush();
  assert.equal(azure.startCalls.length, 2, '再開で開始');
  azure.fail('unknown-code'); await flush();
  assert.equal(app.getSpeechStatus().reason, 'network', '未知の失敗は接続として扱う');
});

// FR-081 AC-444: 再試行・ブラウザ標準への切替は、キーボードとコマンドの検索からも 1 回で行える
test('FR-081 AC-444: 再試行・ブラウザ標準への切替にキー割り当てとコマンド名（ja/en）がある', async () => {
  const { app, azure } = await bootApp();
  await recordAzure(app);
  azure.fail('network'); await flush();
  const key = (cmd) => app.keymap.find((k) => k.command === cmd);
  for (const c of ['speech.retryAzure', 'speech.useBrowser']) assert.ok(key(c), c);
  const k = key('speech.retryAzure');
  assert.equal(app.handleKey({ key: k.key, ctrlKey: !!k.ctrl, altKey: !!k.alt, shiftKey: !!k.shift }), 'speech.retryAzure');
  await flush();
  assert.equal(azure.startCalls.length, 2);
  assert.ok(app.searchCommands('再試行').some((c) => c.command === 'speech.retryAzure'));
  app.setLang('en');
  assert.ok(app.searchCommands('browser').some((c) => c.command === 'speech.useBrowser'));
});

// FR-081 AC-444: 状態表示の直後に、1 回の操作のボタンを置く（ui.js・index.html）
test('FR-081 AC-444: 画面は状態表示の actions を #speech-actions のボタンにし、失敗のないときは隠す', () => {
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'web', 'src', 'ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'web', 'styles', 'app.css'), 'utf8');
  assert.match(html, /<p id="interim"[^>]*><\/p>\s*<div id="speech-actions" class="speech-actions" hidden><\/div>/);
  assert.match(ui, /getSpeechStatus\(\)\.actions/);
  assert.match(ui, /actEl\.hidden = acts\.length === 0/);
  assert.match(css, /\.speech-actions \{[^}]*gap: var\(--space-2\)/);
});

// ---------------- 結合: 実ブラウザ用の AzureSpeechSource → 中継サーバー（実プロセス）→ 上流モック ----------------
// relay は ブラウザの relayRequest と同じ形（{method, path, body, contentType} → {status, body}）で、同一オリジンの中継サーバーへ送る
function relayOver(relay) {
  return async ({ method = 'GET', path: p, body, contentType }) => {
    const payload = body === undefined ? null : (body instanceof Uint8Array ? Buffer.from(body.buffer, body.byteOffset, body.byteLength) : body);
    const r = await speechReq(relay, method, p, payload, { contentType: contentType ?? null });
    return { status: r.status, body: r.json };
  };
}
async function withStack(fn, { mode = 'ok' } = {}) {
  const key = dummySpeechKey();
  const up = await startSpeechUpstream({ key, mode, text: 'モックの確定結果' });
  const relay = await startSpeechRelay(up, { extra: { RELAY_SPEECH_TOKEN_TTL_SEC: '1' } });
  try { return await fn({ key, up, relay }); } finally { await relay.stop(); await up.close(); }
}
const until = async (cond, ms = 20_000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) return false; await tick(); await new Promise((r) => setTimeout(r, 20)); } return true; };

test('FR-081 AC-442 AC-443 AC-458: 同意後の発話は中継サーバー経由で設定されたホストだけへ送られ、確定結果が発話になる。トークンの期限が来ても続く', { timeout: 60_000 }, async () => {
  await withStack(async ({ key, up, relay }) => {
    assert.equal((await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key })).status, 200);
    const { g, st } = fakeAudio();
    const rf = relayOver(relay);
    const azure = createRelayAzureSpeechSource({ relay: rf, g });
    const { app } = await newApp({ speech: new FakeSpeech(LOCAL), options: { relay: rf, azureSpeechSource: azure } });
    await app.refreshAzureSpeechStatus();
    assert.equal(app.getAzureSpeechSettings().keyConfigured, true);
    assert.equal(app.setSpeechMethod('azure').ok, true);
    app.commands['session.start'](); await flush();
    st.utter(); await tick();
    assert.equal(st.gum, 0, '未同意ではマイクを開かず、送信 0 件');
    assert.equal(up.calls.filter((c) => c.url.includes('/speech/recognition/')).length, 0);
    app.setSpeechConsent(true); await until(() => st.nodes.length > 0);
    st.utter();
    assert.ok(await until(() => app.getState().utterances.length === 1), '確定結果が発話になる');
    assert.equal(app.getState().utterances[0].text, 'モックの確定結果');
    const rec = up.calls.filter((c) => c.url.includes('/speech/recognition/'));
    assert.equal(rec.length, 1);
    assert.ok(up.calls.every((c) => c.host === DUMMY_HOST), '上流の宛先は設定されたホストだけ');
    assert.match(rec[0].url, /language=ja-JP/);
    // AC-458: アクセストークンの期限が来ても、中継サーバーが取り直して認識を続ける（失敗の表示をしない）
    up.expireAll();
    await new Promise((r) => setTimeout(r, 1100));
    st.utter();
    assert.ok(await until(() => app.getState().utterances.length === 2), 'トークンの期限の後も続く');
    assert.equal(app.getSpeechStatus().state, 'available');
    // AC-446・NFR-SEC-005: キーはアプリのどこにも来ない
    assert.ok(!JSON.stringify(app.getState()).includes(key));
    assert.ok(!JSON.stringify(app.getSettingsDialog?.() ?? {}).includes(key));
    app.commands['session.stop'](); await flush();
    const n = up.calls.length;
    st.utter(); await new Promise((r) => setTimeout(r, 200));
    assert.equal(up.calls.length, n, '停止の後は送らない');
  });
});

test('FR-081 AC-444 異常系: 上流が認証を拒むと、音声認識は止まり理由（認証）が示され、記録中のまま発話は失われない', { timeout: 60_000 }, async () => {
  await withStack(async ({ key, up, relay }) => {
    assert.equal((await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key })).status, 200);
    const { g, st } = fakeAudio();
    const rf = relayOver(relay);
    const azure = createRelayAzureSpeechSource({ relay: rf, g });
    const { app } = await newApp({ speech: new FakeSpeech(LOCAL), options: { relay: rf, azureSpeechSource: azure } });
    await app.refreshAzureSpeechStatus();
    await recordAzure(app);
    await until(() => st.nodes.length > 0);
    app.setDraft('手入力の発話'); app.submitDraft();
    up.setMode('auth');
    st.utter();
    assert.ok(await until(() => app.getSpeechStatus().state === 'unavailable'));
    assert.equal(app.getSpeechStatus().reason, 'auth');
    assert.equal(app.getState().session, 'recording');
    assert.deepEqual(app.getState().utterances.map((u) => u.text), ['手入力の発話']);
    assert.equal(app.getSpeechMethod(), 'azure', 'ブラウザ標準へ自動では切り替えない');
    const n = up.calls.length;
    st.utter(); await new Promise((r) => setTimeout(r, 200));
    assert.equal(up.calls.length, n, '失敗の後は自動で送り直さない');
  });
});
