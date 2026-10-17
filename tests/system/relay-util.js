// 中継サーバーの System Test 共通部品（契約: tests/system/RELAY-CONTRACT.md）。
// 上流は常にこのファイルのモック。実際の Foundry へは通信しない（FR-066 AC-348）。
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ROOT } from './helpers.js';

export const PYTHON = process.env.PYTHON || 'python';
export const RELAY = path.join(ROOT, 'server', 'relay.py');
// テスト用のダミー（実キーではない。実行ごとに変わる）
export const dummyKey = () => `DUMMY-KEY-${Math.random().toString(36).slice(2)}-${Date.now()}`;

export function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    s.on('error', rej);
  });
}

// 上流モック。handler(req, bodyText, res) を差し替えられる。到達した要求は calls に残る。
export async function startUpstream(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      calls.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (handler) return handler(req, body, res);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'resp_mock', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"points":[]}' }] }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    calls, port,
    baseUrl: `http://127.0.0.1:${port}/openai/v1`,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

// 作業用の一時ディレクトリ（設定ファイル・az モック用）
export function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'relay-st-')); }

// az のモック（Python スクリプト）。引数を args.json に残し、mode に応じて応答する。
export function writeAzMock(dir, { mode = 'ok', token = 'DUMMY-TOKEN-xyz' } = {}) {
  const file = path.join(dir, 'az_mock.py');
  const argsFile = path.join(dir, 'az_args.json').replace(/\\/g, '/');
  fs.writeFileSync(file, [
    'import sys, json',
    `open(${JSON.stringify(argsFile)}, 'w').write(json.dumps(sys.argv[1:]))`,
    `mode = ${JSON.stringify(mode)}`,
    "if mode == 'fail':",
    "    sys.stderr.write('Please run az login to setup account.'); sys.exit(1)",
    `print(json.dumps({'accessToken': ${JSON.stringify(token)}, 'tokenType': 'Bearer'}))`,
  ].join('\n'));
  return { file, argsFile: path.join(dir, 'az_args.json') };
}

// 中継サーバーを起動する。env は LLM_* と RELAY_*。logs() で標準出力・標準エラーの全文を得る。
export async function startRelay(env = {}, { waitReady = true } = {}) {
  const port = await freePort();
  const cleanEnv = { ...process.env };
  for (const k of Object.keys(cleanEnv)) if (k.startsWith('LLM_') || k.startsWith('RELAY_')) delete cleanEnv[k];
  const child = spawn(PYTHON, [RELAY, '--port', String(port), '--web', path.join(ROOT, 'web')],
    { cwd: ROOT, env: { ...cleanEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const relay = {
    port, origin: `http://127.0.0.1:${port}`, logs: () => out,
    stop: () => new Promise((r) => { if (child.exitCode !== null) return r(); child.on('exit', r); child.kill(); setTimeout(r, 2000); }),
  };
  if (waitReady) {
    const t0 = Date.now();
    for (;;) {
      try { await rawRequest(port, { path: '/', headers: { host: `127.0.0.1:${port}` } }); break; } catch {
        if (child.exitCode !== null) throw new Error(`中継サーバーが起動できない: ${out}`);
        if (Date.now() - t0 > 15000) { child.kill(); throw new Error('中継サーバーが 15 秒以内に待ち受けない'); }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
  return relay;
}

// Host / Origin を自由に指定できる低水準の要求（fetch は Host を変えられないため）
export function rawRequest(port, { method = 'GET', path: p = '/', headers = {}, body = null, host = '127.0.0.1', timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, method, path: p, headers, timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body !== null) req.write(body);
    req.end();
  });
}

// LLM 向けの要求（契約: POST /api/llm/responses。同一オリジンの Origin を付ける）
export function llmPost(relay, payload = { input: 'テスト' }, { origin = relay.origin, host } = {}) {
  const headers = { host: host ?? `127.0.0.1:${relay.port}`, 'content-type': 'application/json' };
  if (origin !== null) headers.origin = origin;
  return rawRequest(relay.port, { method: 'POST', path: '/api/llm/responses', headers, body: JSON.stringify(payload) });
}

export async function status(relay) {
  const r = await rawRequest(relay.port, { path: '/api/llm/status', headers: { host: `127.0.0.1:${relay.port}` } });
  return { http: r.status, text: r.text, json: (() => { try { return JSON.parse(r.text); } catch { return null; } })() };
}

export const baseEnv = (upstream, extra = {}) => ({
  LLM_ENDPOINT: upstream.baseUrl, LLM_DEPLOYMENT: 'deploy-mock', LLM_AUTH_METHOD: 'apiKey',
  LLM_API_KEY: dummyKey(), RELAY_ALLOW_LOOPBACK_UPSTREAM: '1', ...extra,
});
