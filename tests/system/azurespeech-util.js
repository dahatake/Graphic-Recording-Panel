// Azure Speech（FR-081・FR-082・NFR-SEC-005）の System Test 共通部品。契約: tests/system/CONTRACT-AZURE-SPEECH.md。
// 上流は常にこのファイルのモック。実際の Azure Speech へは通信しない（AC-447）。キー・エンドポイントはダミーだけ。
import http from 'node:http';
import path from 'node:path';
import { newApp, FakeSpeech } from './helpers.js';
import { startRelay, rawRequest, tmpDir } from './relay-util.js';

// テスト用のダミー（実キーではない。実行ごとに変わる。実キーの形＝32 桁の 16 進ではない）
export const dummySpeechKey = () => `DUMMY-SPEECH-KEY-${Math.random().toString(36).slice(2)}-${Date.now()}`;
// ダミーのエンドポイント（実在しない資源名。上流はモックへ向ける）
export const DUMMY_HOST = 'contoso-dummy-speech.cognitiveservices.azure.com';
export const DUMMY_ENDPOINT = `https://${DUMMY_HOST}`;
export const DUMMY_HOST2 = 'contoso-dummy-speech2.cognitiveservices.azure.com';
export const REGION = 'japaneast';

export const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// AzureSpeechSource の偽物。start〜stop の間だけ「音声を送っている」（active）。
export class FakeAzureSpeech {
  constructor() { this.startCalls = []; this.stopCalls = 0; this.active = false; this.onresult = null; this.onerror = null; this.onend = null; }
  start(opts) { this.startCalls.push(opts); this.active = true; }
  stop() { this.stopCalls++; this.active = false; }
  emit(text, isFinal = true, extra = {}) { if (this.onresult) this.onresult({ text, isFinal, ...extra }); }
  fail(code) { this.active = false; if (this.onerror) this.onerror({ code }); }
  end(reason) { this.active = false; if (this.onend) this.onend({ reason }); }
}

// 同一オリジンの中継サーバー（アプリ側から見たモック）。mode: 'ok' | 'offline' | 'hold' | 'auth' | 'network' | 'invalid'
// leakKey を与えると、状態の応答にキーらしい値を混ぜる（漏れの探針。アプリは表示・保存しないこと）。
export function makeSpeechRelay({ host = null, keyConfigured = false, mode = 'ok', leakKey = null } = {}) {
  const r = { calls: [], mode, host, keyConfigured, held: [] };
  const st = () => ({ endpointHost: r.host, keyConfigured: r.keyConfigured });
  r.fn = async ({ method = 'GET', path: p, body }) => {
    r.calls.push({ method, path: p, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) });
    if (p.startsWith('/api/llm/')) return { status: 200, body: { configured: { endpoint: false, deployment: false, credential: false }, endpointHost: '' } };
    if (r.mode === 'offline') throw new TypeError('Failed to fetch');
    if (p === '/api/speech/status') return { status: 200, body: leakKey ? { ...st(), key: leakKey, apiKey: leakKey } : st() };
    if (p === '/api/speech/settings' && method === 'POST') {
      if (r.mode === 'invalid') return { status: 400, body: { ok: false, result: 'invalid', reason: 'endpoint rejected' } };
      const ep = body && body.endpoint;
      if (typeof ep === 'string' && ep) r.host = /^https?:\/\//.test(ep) ? new URL(ep).hostname : `${ep}.stt.speech.microsoft.com`;
      if (body && typeof body.key === 'string' && body.key) r.keyConfigured = true;
      return { status: 200, body: { ok: true, result: 'saved', ...st() } };
    }
    if (p === '/api/speech/key' && method === 'DELETE') { r.keyConfigured = false; return { status: 200, body: { ok: true, result: 'deleted', ...st() } }; }
    if (p === '/api/speech/test') {
      if (r.mode === 'hold') return new Promise((res) => { r.held.push(() => res({ status: 200, body: { ok: true, result: 'success' } })); });
      if (!r.host || !r.keyConfigured) return { status: 200, body: { ok: false, result: 'unconfigured' } };
      if (r.mode === 'auth') return { status: 401, body: { ok: false, result: 'auth' } };
      if (r.mode === 'network') return { status: 502, body: { ok: false, result: 'network' } };
      return { status: 200, body: { ok: true, result: 'success' } };
    }
    return { status: 404, body: { ok: false, result: 'not_found' } };
  };
  r.speechCalls = () => r.calls.filter((c) => c.path.startsWith('/api/speech/'));
  return r;
}

// アプリを起動する。configured なら中継サーバーはエンドポイントとキーが設定済み。
export async function bootAzure({ configured = true, mode = 'ok', speech = { availability: { 'ja-JP': 'local', 'en-US': 'local' } }, leakKey = null, over = {} } = {}) {
  const relay = makeSpeechRelay({ host: configured ? DUMMY_HOST : null, keyConfigured: configured, mode, leakKey });
  const azure = new FakeAzureSpeech();
  const ctx = await newApp({ speech: new FakeSpeech(speech), ...over, options: { relay: relay.fn, azureSpeechSource: azure, ...(over.options || {}) } });
  await ctx.app.refreshAzureSpeechStatus();
  await flush();
  return { ...ctx, relay, azure };
}

// 再読込（同じ storage で createApp し直す）
export async function reloadAzure(ctx) {
  const azure = new FakeAzureSpeech();
  const app = await ctx.createApp({ ...ctx.env.options, azureSpeechSource: azure });
  await app.refreshAzureSpeechStatus();
  await flush();
  return { ...ctx, app, azure };
}

// 方式を Azure Speech にして（設定済み前提）、記録を開始し、必要なら同意する
export async function startAzureRecording(app, { consent = true } = {}) {
  const r = app.setSpeechMethod('azure');
  if (!r || r.ok !== true) throw new Error(`方式を Azure Speech にできない: ${JSON.stringify(r)}`);
  app.commands['session.start'](); await flush();
  if (consent) { app.setSpeechConsent(true); await flush(); }
}

export const settingsField = (app, id) => (app.getSettingsDialog()?.fields ?? []).find((f) => f.id === id);

// ---------------- 中継サーバー（実プロセス）＋ Azure Speech の上流モック ----------------

// Azure Speech を模す上流モック。到達した要求は calls（host・path・headers・body の長さと先頭）に残る。
// opts.key: 正しいキー。opts.mode: 'ok' | 'auth' | 'hang' | 'error500'。opts.echoSecrets: エラー本文にキー・トークンを混ぜる（漏えいの探針）。
export async function startSpeechUpstream({ key, mode = 'ok', text = 'MOCK-RECOGNIZED-TEXT-0001', echoSecrets = false } = {}) {
  const calls = [];
  const tokens = new Set();
  const expired = new Set();
  let n = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      calls.push({ method: req.method, host, url: req.url, headers: req.headers, bodyLength: body.length, body });
      if (m.mode === 'hang') return; // 応答しない
      const deny = (extra = '') => { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: '401', message: `denied ${echoSecrets ? extra : ''}` } })); };
      if (m.mode === 'error500') { res.writeHead(500, { 'content-type': 'text/plain' }); return res.end(echoSecrets ? `boom ${req.headers['ocp-apim-subscription-key'] ?? ''} ${req.headers.authorization ?? ''}` : 'boom'); }
      const subKey = req.headers['ocp-apim-subscription-key'];
      const auth = String(req.headers.authorization || '');
      if (/\/issueToken$/i.test(req.url.split('?')[0])) {
        if (m.mode === 'auth' || subKey !== m.key) return deny(`${subKey ?? ''}`);
        const tok = `DUMMY-SPEECH-TOKEN-${++n}-${Math.random().toString(36).slice(2)}`;
        tokens.add(tok);
        res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(tok);
      }
      if (req.url.includes('/speech/recognition/')) {
        const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : null;
        const okAuth = m.mode !== 'auth' && ((bearer && tokens.has(bearer) && !expired.has(bearer)) || (subKey && subKey === m.key));
        if (!okAuth) return deny(`${subKey ?? ''} ${auth}`);
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ RecognitionStatus: 'Success', DisplayText: m.text, Offset: 0, Duration: 1 }));
      }
      res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
    });
  });
  const m = { key, mode, text };
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    calls, tokens, expired, port, m,
    url: `http://127.0.0.1:${port}`,
    setMode: (x) => { m.mode = x; },
    expireAll: () => { for (const t of tokens) expired.add(t); },
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

// 中継サーバーを起動する（保管先は一時ディレクトリ、上流はモックへ）
export async function startSpeechRelay(up, { store = null, extra = {} } = {}) {
  const dir = store ? path.dirname(store) : tmpDir();
  const storeFile = store ?? path.join(dir, 'azure-speech.store.json');
  const env = { RELAY_SPEECH_STORE: storeFile, RELAY_ALLOW_LOOPBACK_UPSTREAM: '1', ...(up ? { RELAY_SPEECH_UPSTREAM: up.url } : {}), ...extra };
  const relay = await startRelay(env);
  return Object.assign(relay, { storeFile, dir });
}

// 同一オリジンの要求（Origin・Host は既定で自分）。body が Buffer ならそのまま送る。
export function speechReq(relay, method, p, body = null, { origin = relay.origin, host = `127.0.0.1:${relay.port}`, contentType = null } = {}) {
  const headers = { host };
  if (origin !== null) headers.origin = origin;
  let payload = null;
  if (body !== null) {
    if (Buffer.isBuffer(body)) { payload = body; headers['content-type'] = contentType ?? 'audio/wav'; } else { payload = JSON.stringify(body); headers['content-type'] = contentType ?? 'application/json'; }
    headers['content-length'] = Buffer.byteLength(payload);
  }
  return rawRequest(relay.port, { method, path: p, headers, body: payload }).then((r) => ({ ...r, json: (() => { try { return JSON.parse(r.text); } catch { return null; } })() }));
}

export const getStatus = (relay) => speechReq(relay, 'GET', '/api/speech/status');
export const saveSettings = (relay, body, o) => speechReq(relay, 'POST', '/api/speech/settings', body, o);
export const deleteKey = (relay, o) => speechReq(relay, 'DELETE', '/api/speech/key', null, o);
export const connTest = (relay, o) => speechReq(relay, 'POST', '/api/speech/test', {}, o);

// 合成した音声（無音の WAV。識別用の印を末尾に入れる。実データではない）
export function fakeWav(marker = 'AUDIO-MARKER-ZZ') {
  const pcm = Buffer.alloc(3200);
  const tail = Buffer.from(marker, 'ascii');
  const data = Buffer.concat([pcm, tail]);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
export const recognize = (relay, lang = 'ja-JP', o) => speechReq(relay, 'POST', `/api/speech/recognize?language=${lang}`, fakeWav(), o);

export const ALLOWED_TOP = new Set(['ok', 'result', 'reason', 'endpointHost', 'keyConfigured']);
