// FR-066 / FR-067 / NFR-SEC-003 の System Test。上流は常にモック（実 Foundry へは通信しない）。
// 契約: tests/system/RELAY-CONTRACT.md。キーはすべてテスト用のダミー。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { ROOT, WEB } from './helpers.js';
import {
  PYTHON, RELAY, dummyKey, startUpstream, startRelay, rawRequest, llmPost, status, baseEnv, tmpDir, writeAzMock,
} from './relay-util.js';

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });

// NFR-SEC-003 AC-339: ダミーのキーで使った後、ブラウザへ渡るもの（応答・静的ファイル・設定画面向けの状態）に値が含まれない
test('NFR-SEC-003 AC-339 ダミーのキーを設定して使っても、ブラウザへ届くどの応答にもキーが含まれない（成功・失敗とも）', async () => {
  const key = dummyKey();
  let n = 0;
  const up = await startUpstream((req, body, res) => {
    n++;
    if (n === 2) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"error":"boom"}'); }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"output":[]}');
  });
  const relay = await startRelay(baseEnv(up, { LLM_API_KEY: key }));
  try {
    const seen = [];
    for (let i = 0; i < 3; i++) { const r = await llmPost(relay); seen.push(r.text, JSON.stringify(r.headers)); }
    const st = await status(relay); seen.push(st.text);
    for (const p of ['/', '/index.html', '/src/app.js']) { const r = await rawRequest(relay.port, { path: p, headers: { host: `127.0.0.1:${relay.port}` } }); seen.push(r.text, JSON.stringify(r.headers)); }
    for (const s of seen) assert.ok(!s.includes(key), 'キーの値が応答に含まれる');
    assert.ok(!relay.logs().includes(key), 'キーの値がログに含まれる');
    assert.ok(up.calls.length >= 3 && up.calls.every((c) => JSON.stringify(c.headers).includes(key)), '上流へはキーが付く');
  } finally { await relay.stop(); await up.close(); }
});

// NFR-SEC-003 AC-339: 保存物（セッションファイル・SVG 等）の入口にキーが出ない: web/ 配下のソースにダミー値・実値らしい文字列を持たない
test('NFR-SEC-003 AC-339 web/ のソースと同梱物に、キーの実値らしい文字列がない（異常系: localStorage 等への書き込み経路にキーを渡さない）', () => {
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } })(WEB);
  const pat = /(sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|DUMMY-KEY-)/;
  for (const f of files) if (/\.(js|html|css|json|svg)$/.test(f)) assert.ok(!pat.test(fs.readFileSync(f, 'utf8')), `${f} に実値らしい文字列`);
});

// NFR-SEC-003 AC-340
test('NFR-SEC-003 AC-340 中継サーバーのログ・エラーメッセージに、キー・トークンの値が出ない（上流の失敗・az の失敗でも）', async () => {
  const key = dummyKey();
  const up = await startUpstream((req, b, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: `bad key ${req.headers['api-key'] ?? ''}` })); });
  const relay = await startRelay(baseEnv(up, { LLM_API_KEY: key }));
  const dir = tmpDir();
  const az = writeAzMock(dir, { mode: 'fail' });
  const relay2 = await startRelay({ LLM_ENDPOINT: up.baseUrl, LLM_DEPLOYMENT: 'd', LLM_AUTH_METHOD: 'entra', RELAY_AZ_COMMAND: az.file, RELAY_ALLOW_LOOPBACK_UPSTREAM: '1' });
  try {
    const r = await llmPost(relay);
    assert.ok(r.status >= 400);
    assert.ok(!r.text.includes(key));
    const r2 = await llmPost(relay2); assert.ok(r2.status >= 400);
    assert.ok(!relay.logs().includes(key), 'ログにキー');
    assert.ok(!relay2.logs().includes('DUMMY-TOKEN'));
  } finally { await relay.stop(); await relay2.stop(); await up.close(); }
});

// NFR-SEC-003 AC-342
test('NFR-SEC-003 AC-342 応答（成功・失敗）に、キー・上流への認証ヘッダ・設定ファイルの内容が含まれない', async () => {
  const key = dummyKey(); const dir = tmpDir(); const marker = `CONFIG-MARKER-${Date.now()}`;
  const cfg = path.join(dir, 'llm.local.json');
  const up = await startUpstream((req, b, res) => {
    // 上流が認証ヘッダをそのまま応答に混ぜても、中継サーバーはそれを返さない（少なくとも値を含めない）
    res.writeHead(200, { 'content-type': 'application/json', 'x-echo-auth': String(req.headers['api-key']) });
    res.end(JSON.stringify({ output: [], echo: String(req.headers['api-key']) }));
  });
  fs.writeFileSync(cfg, JSON.stringify({ endpoint: up.baseUrl, deployment: 'd', authMethod: 'apiKey', apiKey: key, note: marker }));
  const relay = await startRelay({ LLM_CONFIG_PATH: cfg, RELAY_ALLOW_LOOPBACK_UPSTREAM: '1' });
  const relayBad = await startRelay({ LLM_ENDPOINT: 'https://example.invalid/openai/v1', LLM_DEPLOYMENT: 'd', LLM_AUTH_METHOD: 'apiKey', LLM_API_KEY: key });
  try {
    const all = [];
    for (const rl of [relay, relayBad]) { const r = await llmPost(rl); all.push(r.text, JSON.stringify(r.headers)); const s = await status(rl); all.push(s.text); }
    const forbidden = await llmPost(relay, {}, { origin: 'http://evil.example' }); all.push(forbidden.text);
    for (const s of all) { assert.ok(!s.includes(key), 'キー'); assert.ok(!s.includes(marker), '設定ファイルの内容'); assert.ok(!/api-key/i.test(s) || !s.includes(key)); }
  } finally { await relay.stop(); await relayBad.stop(); await up.close(); }
});

// NFR-SEC-003 AC-341
test('NFR-SEC-003 AC-341 リポジトリ（追跡ファイル）に、キー・トークンの実値らしい文字列が 0 件', () => {
  const files = git('ls-files').split('\n').filter(Boolean).filter((f) => !/\.(png|jpg|jpeg|gif|ico|woff2?|pdf|zip|mp3|ogg|wav)$/i.test(f));
  const pats = [/sk-[A-Za-z0-9]{32,}/, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
    /(api[-_]?key|apikey|token)["']?\s*[:=]\s*["'][A-Za-z0-9+/=_-]{32,}["']/i, /\b[0-9a-f]{32}\b(?=["'])/];
  const hits = [];
  for (const f of files) {
    let t; try { t = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
    for (const p of pats) { const m = t.match(p); if (m) hits.push(`${f}: ${m[0].slice(0, 12)}…`); }
  }
  assert.deepEqual(hits, []);
});

// FR-066 AC-343
test('FR-066 AC-343 中継サーバーは 127.0.0.1 だけで待ち受け、ほかのアドレスからは接続できない', async () => {
  const relay = await startRelay({});
  try {
    const ok = await rawRequest(relay.port, { path: '/', headers: { host: `127.0.0.1:${relay.port}` } });
    assert.equal(ok.status, 200);
    const others = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    for (const addr of others) {
      const connected = await new Promise((r) => { const s = net.connect({ host: addr, port: relay.port, timeout: 1500 }, () => { s.destroy(); r(true); }); s.on('error', () => r(false)); s.on('timeout', () => { s.destroy(); r(false); }); });
      assert.equal(connected, false, `${addr} から接続できてしまう`);
    }
  } finally { await relay.stop(); }
});

// FR-066 AC-344
test('FR-066 AC-344 同一オリジンでない Origin・Host、Origin なしの LLM 向け要求は 403 で拒否し、上流へ送らない', async () => {
  const up = await startUpstream();
  const relay = await startRelay(baseEnv(up));
  try {
    assert.equal((await llmPost(relay, { input: 'x' }, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await llmPost(relay, { input: 'x' }, { origin: `http://127.0.0.1:${relay.port + 1}` })).status, 403);
    assert.equal((await llmPost(relay, { input: 'x' }, { host: 'evil.example' })).status, 403);
    assert.equal((await llmPost(relay, { input: 'x' }, { origin: null })).status, 403);
    assert.equal(up.calls.length, 0, '拒否した要求が上流へ届いた');
    const good = await llmPost(relay, { input: 'x' }, { origin: `http://localhost:${relay.port}`, host: `localhost:${relay.port}` });
    assert.equal(good.status, 200);
    assert.equal(up.calls.length, 1);
  } finally { await relay.stop(); await up.close(); }
});

// FR-066 AC-345
test('FR-066 AC-345 start.ps1・start.sh が同じ中継サーバーを起動し、標準ライブラリだけで動き、設定なしでも静的配信できる', async () => {
  for (const f of ['start.ps1', 'start.sh']) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(/server[\\/]relay\.py/.test(t), `${f} が server/relay.py を起動しない`);
    assert.ok(!/pip\s+install/i.test(t), `${f} が追加の導入を要する`);
  }
  assert.ok(fs.existsSync(RELAY), 'server/relay.py がない');
  const code = "import ast,sys\nt=ast.parse(open(sys.argv[1],encoding='utf8').read())\nm=set()\nfor n in ast.walk(t):\n  if isinstance(n,ast.Import): m|={a.name.split('.')[0] for a in n.names}\n  if isinstance(n,ast.ImportFrom) and n.level==0: m.add(n.module.split('.')[0])\nbad=[x for x in m if x not in sys.stdlib_module_names]\nprint(','.join(bad)); sys.exit(1 if bad else 0)";
  let out = ''; try { execFileSync(PYTHON, ['-c', code, RELAY], { encoding: 'utf8' }); } catch (e) { out = e.stdout || String(e); }
  assert.equal(out, '', `標準ライブラリ以外を import: ${out}`);
  const relay = await startRelay({});
  try {
    const r = await rawRequest(relay.port, { path: '/index.html', headers: { host: `127.0.0.1:${relay.port}` } });
    assert.equal(r.status, 200);
    assert.ok(r.text.length > 100);
    const st = await status(relay); assert.equal(st.json?.state, 'unconfigured');
  } finally { await relay.stop(); }
});

// FR-066 AC-346
test('FR-066 AC-346 上流が時間超過・サイズ超過のとき接続を打ち切り、秘密を含まないエラーを返す', async () => {
  const key = dummyKey();
  const slow = await startUpstream((req, b, res) => { setTimeout(() => { try { res.writeHead(200); res.end('{}'); } catch {} }, 4000); });
  const big = await startUpstream((req, b, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ pad: 'x'.repeat(262144 + 10) })); });
  const r1 = await startRelay(baseEnv(slow, { LLM_API_KEY: key, RELAY_TIMEOUT_SEC: '1' }));
  const r2 = await startRelay(baseEnv(big, { LLM_API_KEY: key }));
  try {
    const t0 = Date.now(); const a = await llmPost(r1);
    assert.ok(a.status >= 400 && Date.now() - t0 < 3500, `時間超過で打ち切られない: ${a.status}`);
    const b = await llmPost(r2);
    assert.ok(b.status >= 400, `サイズ超過が通る: ${b.status}`);
    assert.ok(!b.text.includes('xxxxxxxxxx'));
    for (const s of [a.text, b.text, r1.logs(), r2.logs()]) assert.ok(!s.includes(key));
  } finally { await r1.stop(); await r2.stop(); await slow.close(); await big.close(); }
});

// FR-066 AC-347
test('FR-066 AC-347 上流の <endpoint>/responses へ model=デプロイ名で送り、認証（キー／Entra トークン）は上流への要求にだけ付く', async () => {
  const key = dummyKey();
  const up = await startUpstream();
  const relay = await startRelay(baseEnv(up, { LLM_API_KEY: key }));
  const dir = tmpDir(); const az = writeAzMock(dir, { token: 'DUMMY-TOKEN-entra' });
  const up2 = await startUpstream();
  const relay2 = await startRelay({ LLM_ENDPOINT: up2.baseUrl, LLM_DEPLOYMENT: 'deploy-e', LLM_AUTH_METHOD: 'entra', RELAY_AZ_COMMAND: az.file, RELAY_ALLOW_LOOPBACK_UPSTREAM: '1' });
  try {
    const r = await llmPost(relay, { input: 'こんにちは' });
    assert.equal(r.status, 200);
    const c = up.calls[0];
    assert.equal(c.method, 'POST'); assert.equal(c.url, '/openai/v1/responses');
    assert.equal(JSON.parse(c.body).model, 'deploy-mock');
    assert.ok(c.headers['api-key'] === key || c.headers.authorization === `Bearer ${key}`);
    assert.ok(!JSON.stringify(r.headers).includes(key) && !r.text.includes(key));
    // 異常系: 認証が付かない状態（キー未設定）では上流へ送らない
    const none = await startRelay({ LLM_ENDPOINT: up.baseUrl, LLM_DEPLOYMENT: 'd', LLM_AUTH_METHOD: 'apiKey', RELAY_ALLOW_LOOPBACK_UPSTREAM: '1' });
    const before = up.calls.length; const rn = await llmPost(none); assert.ok(rn.status >= 400); assert.equal(up.calls.length, before); await none.stop();
    // Entra
    const e = await llmPost(relay2, { input: 'x' });
    assert.equal(e.status, 200);
    assert.equal(up2.calls[0].headers.authorization, 'Bearer DUMMY-TOKEN-entra');
    assert.equal(JSON.parse(up2.calls[0].body).model, 'deploy-e');
    assert.ok(!e.text.includes('DUMMY-TOKEN'));
  } finally { await relay.stop(); await relay2.stop(); await up.close(); await up2.close(); }
});

// FR-066 AC-348
test('FR-066 AC-348 テストはモック上流だけで決定的に実行でき、同じ入力で同じ応答になる（実エンドポイントが設定されていても上流モックに向く）', async () => {
  const up = await startUpstream((req, b, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"output":[{"k":1}]}'); });
  const relay = await startRelay(baseEnv(up));
  try {
    const a = await llmPost(relay, { input: 'same' }); const b = await llmPost(relay, { input: 'same' });
    assert.equal(a.status, 200); assert.equal(a.text, b.text);
    assert.equal(up.calls.length, 2);
    assert.ok(new URL(baseEnv(up).LLM_ENDPOINT).hostname === '127.0.0.1');
  } finally { await relay.stop(); await up.close(); }
});

// FR-067 AC-349
test('FR-067 AC-349 環境変数と config/llm.local.json のどちらでも設定でき、両方にあるときは環境変数が優先', async () => {
  const dir = tmpDir(); const cfg = path.join(dir, 'llm.local.json');
  const upCfg = await startUpstream(); const upEnv = await startUpstream();
  fs.writeFileSync(cfg, JSON.stringify({ endpoint: upCfg.baseUrl, deployment: 'dep-cfg', authMethod: 'apiKey', apiKey: 'DUMMY-KEY-cfg' }));
  const onlyCfg = await startRelay({ LLM_CONFIG_PATH: cfg, RELAY_ALLOW_LOOPBACK_UPSTREAM: '1' });
  const onlyEnv = await startRelay({ LLM_ENDPOINT: upEnv.baseUrl, LLM_DEPLOYMENT: 'dep-env', LLM_AUTH_METHOD: 'apiKey', LLM_API_KEY: 'DUMMY-KEY-env', RELAY_ALLOW_LOOPBACK_UPSTREAM: '1' });
  const both = await startRelay({ LLM_CONFIG_PATH: cfg, LLM_ENDPOINT: upEnv.baseUrl, LLM_DEPLOYMENT: 'dep-env', LLM_API_KEY: 'DUMMY-KEY-env', RELAY_ALLOW_LOOPBACK_UPSTREAM: '1' });
  try {
    assert.equal((await llmPost(onlyCfg)).status, 200); assert.equal(upCfg.calls.length, 1);
    assert.equal(JSON.parse(upCfg.calls[0].body).model, 'dep-cfg');
    assert.equal((await llmPost(onlyEnv)).status, 200); assert.equal(upEnv.calls.length, 1);
    const n = upCfg.calls.length;
    assert.equal((await llmPost(both)).status, 200);
    assert.equal(upCfg.calls.length, n, '環境変数が優先されない（config の上流へ届いた）');
    assert.equal(upEnv.calls.length, 2);
    assert.equal(JSON.parse(upEnv.calls[1].body).model, 'dep-env');
    assert.equal(upEnv.calls[1].headers['api-key'] ?? upEnv.calls[1].headers.authorization.replace('Bearer ', ''), 'DUMMY-KEY-env');
  } finally { for (const r of [onlyCfg, onlyEnv, both]) await r.stop(); await upCfg.close(); await upEnv.close(); }
});

// FR-067 AC-350
test('FR-067 AC-350 Entra ID は az account get-access-token をスコープ https://ai.azure.com/.default で実行。az なし・未ログインは理由を示し有効にならない', async () => {
  const up = await startUpstream(); const dir = tmpDir();
  const ok = writeAzMock(dir, { token: 'DUMMY-TOKEN-ok' });
  const dirFail = tmpDir(); const fail = writeAzMock(dirFail, { mode: 'fail', token: 'DUMMY-TOKEN-never' });
  const env = (az) => ({ LLM_ENDPOINT: up.baseUrl, LLM_DEPLOYMENT: 'd', LLM_AUTH_METHOD: 'entra', RELAY_AZ_COMMAND: az, RELAY_ALLOW_LOOPBACK_UPSTREAM: '1' });
  const rOk = await startRelay(env(ok.file)); const rFail = await startRelay(env(fail.file)); const rMissing = await startRelay(env(path.join(dir, 'no-such-az.py')));
  try {
    assert.equal((await llmPost(rOk)).status, 200);
    const args = JSON.parse(fs.readFileSync(ok.argsFile, 'utf8')).join(' ');
    assert.ok(/get-access-token/.test(args) && args.includes('https://ai.azure.com/.default'), `az の引数: ${args}`);
    const before = up.calls.length;
    for (const rl of [rFail, rMissing]) {
      const s = await status(rl); assert.notEqual(s.json?.state, 'ready'); assert.ok(s.json?.reason && s.json.reason.length > 0, '理由が示されない');
      assert.ok(!s.text.includes('DUMMY-TOKEN'));
      assert.ok((await llmPost(rl)).status >= 400);
    }
    assert.equal(up.calls.length, before, '取得失敗なのに上流へ送られた');
  } finally { for (const r of [rOk, rFail, rMissing]) await r.stop(); await up.close(); }
});

// FR-067 AC-351
test('FR-067 AC-351 config/llm.example.json があり、全項目の例を持ち、キー・トークンの実値を含まない', () => {
  const f = path.join(ROOT, 'config', 'llm.example.json');
  assert.ok(fs.existsSync(f), 'config/llm.example.json がない');
  const t = fs.readFileSync(f, 'utf8'); const j = JSON.parse(t);
  for (const k of ['endpoint', 'deployment', 'authMethod', 'apiKey']) assert.ok(k in j, `${k} がない`);
  assert.ok(String(j.endpoint).includes('<your-resource>'));
  assert.ok(!/sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}|\b[0-9a-f]{32}\b/.test(t), '実値らしい文字列');
  assert.ok(String(j.apiKey).length < 32 && /^(|<.*>|YOUR.*|your.*)$/i.test(String(j.apiKey)) , 'apiKey は空かプレースホルダ');
});

// FR-067 AC-352
test('FR-067 AC-352 config/llm.local.json は .gitignore に載り、リポジトリに実ファイルが含まれない', () => {
  let ignored = true; try { git('check-ignore', '-q', 'config/llm.local.json'); } catch { ignored = false; }
  assert.ok(ignored, 'config/llm.local.json が git の管理外でない');
  assert.equal(git('ls-files', 'config/llm.local.json').trim(), '');
});

// FR-067 AC-363（BLOCKED: Q-019。仮定: https の公開ホストだけ受け付ける）
test('FR-067 AC-363 エンドポイントは https の公開ホストだけ。http・localhost・ループバック・プライベート・リンクローカルは拒否される', async () => {
  const bad = ['http://example.com/openai/v1', 'https://localhost/openai/v1', 'https://127.0.0.1/openai/v1', 'https://10.0.0.5/openai/v1',
    'https://192.168.1.10/openai/v1', 'https://172.16.0.1/openai/v1', 'https://169.254.169.254/openai/v1', 'https://[::1]/openai/v1'];
  for (const ep of bad) {
    const rl = await startRelay({ LLM_ENDPOINT: ep, LLM_DEPLOYMENT: 'd', LLM_AUTH_METHOD: 'apiKey', LLM_API_KEY: dummyKey() });
    try { const s = await status(rl); assert.notEqual(s.json?.state, 'ready', `${ep} が受け付けられた`); assert.ok((await llmPost(rl)).status >= 400); } finally { await rl.stop(); }
  }
  const good = await startRelay({ LLM_ENDPOINT: 'https://res.services.ai.azure.com/openai/v1', LLM_DEPLOYMENT: 'd', LLM_AUTH_METHOD: 'apiKey', LLM_API_KEY: dummyKey() });
  try { assert.equal((await status(good)).json?.state, 'ready'); } finally { await good.stop(); }
});

// FR-067 AC-364（BLOCKED: Q-019）
test('FR-067 AC-364 ループバック許可フラグがオンのときだけループバックの上流が受け付けられる（既定オフ・設定画面から変更不可）', async () => {
  const up = await startUpstream();
  const off = await startRelay({ LLM_ENDPOINT: up.baseUrl, LLM_DEPLOYMENT: 'd', LLM_AUTH_METHOD: 'apiKey', LLM_API_KEY: dummyKey() });
  const on = await startRelay(baseEnv(up));
  try {
    assert.notEqual((await status(off)).json?.state, 'ready'); assert.ok((await llmPost(off)).status >= 400); assert.equal(up.calls.length, 0);
    assert.equal((await llmPost(on)).status, 200); assert.equal(up.calls.length, 1);
    // フラグは HTTP 経由では変えられない
    const r = await rawRequest(off.port, { method: 'POST', path: '/api/llm/config', headers: { host: `127.0.0.1:${off.port}`, origin: off.origin, 'content-type': 'application/json' }, body: JSON.stringify({ allowLoopbackUpstream: true }) });
    assert.ok(r.status >= 400); assert.notEqual((await status(off)).json?.state, 'ready');
    // フラグがオンでも、公開ホストへの http は拒否される
    const http = await startRelay({ LLM_ENDPOINT: 'http://example.com/openai/v1', LLM_DEPLOYMENT: 'd', LLM_AUTH_METHOD: 'apiKey', LLM_API_KEY: dummyKey(), RELAY_ALLOW_LOOPBACK_UPSTREAM: '1' });
    try { assert.notEqual((await status(http)).json?.state, 'ready'); } finally { await http.stop(); }
  } finally { await off.stop(); await on.stop(); await up.close(); }
});
