// FR-088 AC-511 / NFR-OFFLINE-001 AC-031（GitHub Copilot の分）— 中継サーバーの実プロセス（server/relay.py）と画面（createApp）をつないだ System Test。
// 契約: tests/system/CONTRACT-GITHUB-COPILOT.md「サインアウト（AC-511）」「中継サーバーの実プロセスとスタブ」。期待値は受入基準だけから決める。
// GitHub Copilot SDK（Python の `copilot` モジュール）と Copilot CLI（COPILOT_CLI_PATH）は、このファイルが一時フォルダーに書くスタブだけを使い、
// GitHub へは通信しない（中継サーバーのプロキシも到達しない宛先にする）。CLI の資格情報はスタブの保管（一時フォルダーのファイル）に置いたダミー。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { newApp } from './helpers.js';
import { startRelay, rawRequest, tmpDir, PYTHON } from './relay-util.js';
import { flush } from './azurespeech-util.js';

const ACCOUNT = 'octo-dummy-user';
const CLI_CRED_VALUE = 'PROBE-GH-CLI-CRED-0000-not-a-real-credential';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GitHub Copilot SDK のスタブ（CopilotClient・セッション）。呼び出しを JSON Lines で記録する。認証の状態は CLI の保管（ファイル）の有無。
const SDK_STUB = `
import os, json, types
LOG = os.environ["GRP_ST_SDK_LOG"]
CRED = os.environ["GRP_ST_CLI_CRED"]
def _log(ev, **kw):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(dict(ev=ev, **kw), ensure_ascii=False) + "\\n")
class _Session(object):
    def __init__(self, opts):
        self.opts = opts
    async def send_and_wait(self, prompt, timeout=60.0):
        _log("send", prompt=str(prompt)[:4000])
        return types.SimpleNamespace(type="assistant.message", data=types.SimpleNamespace(content='{"points":[]}'))
    async def disconnect(self):
        pass
    def __getattr__(self, name):
        _log("unknown", name="Session." + name)
        raise AttributeError(name)
class CopilotClient(object):
    def __init__(self, **kwargs):
        _log("client")
    async def start(self):
        _log("start")
    async def stop(self):
        _log("stop")
    async def get_auth_status(self):
        ok = os.path.exists(CRED)
        _log("auth_status", signedIn=ok)
        return types.SimpleNamespace(is_authenticated=ok, isAuthenticated=ok, login="${ACCOUNT}" if ok else None)
    async def create_session(self, **opts):
        _log("session")
        return _Session(opts)
    def __getattr__(self, name):
        _log("unknown", name=name)
        raise AttributeError(name)
`;
const SDK_SESSION_STUB = `
class PermissionDecisionReject(object):
    def __init__(self, feedback=None):
        self.kind = "reject"
        self.feedback = feedback
`;
// Copilot CLI のスタブ。引数を記録する。login は、保管に資格情報があれば確認コードなしに終わり、なければ確認コードを出して待つ。
const CLI_STUB = `
import os, sys, json, time
with open(os.environ["GRP_ST_CLI_LOG"], "a", encoding="utf-8") as f:
    f.write(json.dumps(sys.argv[1:]) + "\\n")
cred = os.environ["GRP_ST_CLI_CRED"]
if sys.argv[1:2] == ["login"]:
    if os.path.exists(cred):
        print("Already logged in as ${ACCOUNT}", flush=True)
        sys.exit(0)
    print("To authenticate, visit https://github.com/login/device and enter code TEST-0000", flush=True)
    for _ in range(200):
        if os.path.exists(cred + ".approve"):
            with open(cred, "w") as f:
                f.write("${CLI_CRED_VALUE}")
            sys.exit(0)
        time.sleep(0.05)
    sys.exit(3)
sys.exit(0)
`;

function pythonExe() {
  try { return execFileSync(PYTHON, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim(); } catch { return PYTHON; }
}

// スタブ一式（SDK・CLI・CLI の資格情報の保管）と中継サーバーの保管先を一時フォルダーに作る。
function makeStubs({ cliSignedIn }) {
  const dir = tmpDir();
  const sdkRoot = path.join(dir, 'sdk');
  fs.mkdirSync(path.join(sdkRoot, 'copilot'), { recursive: true });
  fs.writeFileSync(path.join(sdkRoot, 'copilot', '__init__.py'), SDK_STUB);
  fs.writeFileSync(path.join(sdkRoot, 'copilot', 'session.py'), SDK_SESSION_STUB);
  const cliPy = path.join(dir, 'copilot_cli_stub.py');
  fs.writeFileSync(cliPy, CLI_STUB);
  let cli;
  if (process.platform === 'win32') {
    cli = path.join(dir, 'copilot.cmd');
    fs.writeFileSync(cli, `@"${pythonExe()}" "${cliPy}" %*\r\n`);
  } else {
    cli = path.join(dir, 'copilot');
    fs.writeFileSync(cli, `#!/bin/sh\nexec "${pythonExe()}" "${cliPy}" "$@"\n`);
    fs.chmodSync(cli, 0o755);
  }
  const cred = path.join(dir, 'cli-credential.txt');
  if (cliSignedIn) fs.writeFileSync(cred, CLI_CRED_VALUE);
  const sdkLog = path.join(dir, 'sdk-log.jsonl');
  const cliLog = path.join(dir, 'cli-log.jsonl');
  const env = {
    PYTHONPATH: [sdkRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    COPILOT_CLI_PATH: cli,
    GRP_ST_SDK_LOG: sdkLog, GRP_ST_CLI_LOG: cliLog, GRP_ST_CLI_CRED: cred,
    RELAY_LLM_STORE: path.join(dir, 'llm-ui.local.json'), LLM_CONFIG_PATH: path.join(dir, 'llm.local.json'),
    COPILOT_GITHUB_TOKEN: '', GH_TOKEN: '', GITHUB_TOKEN: '', COPILOT_AUTH_METHOD: '', COPILOT_MODEL: '',
    // GitHub へ通信しない（万一の外向きの通信も到達しない宛先へ）
    HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost',
  };
  const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return {
    dir, env, cred,
    sdk: () => lines(sdkLog), cli: () => lines(cliLog),
    credText: () => (fs.existsSync(cred) ? fs.readFileSync(cred, 'utf8') : null),
  };
}

// 画面（createApp）の options.relay を、中継サーバーの実プロセスへの同一オリジンの要求にする。要求はすべて log に残す。
function bridge(ref, log) {
  return async ({ method = 'GET', path: p, body }) => {
    log.push({ method, path: p });
    const rel = ref.current;
    const headers = { host: `127.0.0.1:${rel.port}`, origin: rel.origin };
    let data = null;
    if (body !== undefined) { data = typeof body === 'string' ? body : JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const r = await rawRequest(rel.port, { method, path: p, headers, body: data, timeout: 60000 });
    let parsed = r.text;
    try { parsed = JSON.parse(r.text); } catch { /* 文字列のまま */ }
    return { status: r.status, body: parsed };
  };
}

async function settle(app) { await app.refreshCopilotStatus(); for (let i = 0; i < 4; i++) { await sleep(20); await flush(); } }
async function pumpReal(env, until, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (until()) return true;
    env.scheduler.advance(5000);
    await sleep(100); await flush();
  }
  return until();
}
const field = (app, id) => (app.getApiKeysDialog()?.fields ?? []).find((f) => f.id === id);
async function openCopilot(app) {
  app.commands['apiKeys.open'](); await flush();
  await settle(app);
  app.selectApiKeysCategory('copilot'); await flush();
  await settle(app);
}
const type = (app, env, ...texts) => { for (const t of texts) { app.setDraft(t); app.submitDraft(); env.tick(1); } };
const SIGNOUT_LIKE = /log.?out|sign.?out|delete|remove|clear|forget|revoke/i;

async function bootReal({ cliSignedIn = true } = {}) {
  const stubs = makeStubs({ cliSignedIn });
  const ref = { current: await startRelay(stubs.env) };
  const log = [];
  const ctx = await newApp({ options: { relay: bridge(ref, log), clipboard: { writeText: async () => {} } } });
  await settle(ctx.app);
  return { ...ctx, stubs, ref, log, restart: async () => { await ref.current.stop(); ref.current = await startRelay(stubs.env); } };
}

// FR-088 AC-511（Q-033）
test('FR-088 AC-511 中継サーバー: サインアウトで Copilot CLI の資格情報は消えず、CLI のサインアウトも SDK の削除の呼び出しも 0 回。中継サーバーの再起動後も CLI のサインインが残っていても未サインインのままで、再び「GitHub でサインイン」を操作すると確認コードなしにサインイン済み。GitHub へは通信しない', async () => {
  const b = await bootReal({ cliSignedIn: true });
  try {
    const { app, env, stubs } = b;
    assert.equal((await app.setLlmProvider('copilot')).ok, true);
    await openCopilot(app);
    assert.ok(await pumpReal(env, () => field(app, 'apiKeys.copilot.signinStatus')?.status.id === 'signedIn'), '前提: 同じ PC の Copilot CLI でサインイン済み（操作なし）');
    assert.equal(stubs.cli().length, 0, '前提: サインインの操作はしていない');
    // サインアウト（確認つき）
    app.commands['copilot.signout'](); await flush();
    assert.equal(app.getDialog()?.kind, 'copilot-signout');
    await app.dialogAction('confirm'); await settle(app);
    assert.ok(await pumpReal(env, () => field(app, 'apiKeys.copilot.signinStatus')?.status.id === 'signedOut'), 'このアプリでは未サインイン');
    assert.equal(stubs.credText(), CLI_CRED_VALUE, 'Copilot CLI の保存済みの資格情報は消えない');
    assert.equal(stubs.cli().filter((a) => SIGNOUT_LIKE.test(a.join(' '))).length, 0, 'Copilot CLI のサインアウトを呼ばない');
    assert.equal(stubs.sdk().filter((e) => e.ev === 'unknown' && SIGNOUT_LIKE.test(e.name)).length, 0, 'SDK の資格情報の削除・サインアウトを呼ばない');
    const st1 = JSON.parse((await rawRequest(b.ref.current.port, { path: '/api/llm/status', headers: { host: `127.0.0.1:${b.ref.current.port}` } })).text);
    assert.equal(st1.copilot?.signedIn, false, 'GET /api/llm/status も未サインイン');
    const r = await app.requestLlmEnable();
    assert.equal(r.ok, false, 'GitHub Copilot を有効にできない（AC-506 の未サインイン）'); assert.deepEqual(r.missing, ['signin']);
    // 中継サーバーの再起動後も保たれる（CLI の資格情報は残ったまま）
    await b.restart();
    const app2 = await b.createApp({ ...env.options }); await settle(app2);
    await openCopilot(app2);
    await pumpReal(env, () => false, 1500);
    assert.equal(field(app2, 'apiKeys.copilot.signinStatus')?.status.id, 'signedOut', '再起動後も、操作なしにサインイン済みとは示されない');
    const st2 = JSON.parse((await rawRequest(b.ref.current.port, { path: '/api/llm/status', headers: { host: `127.0.0.1:${b.ref.current.port}` } })).text);
    assert.equal(st2.copilot?.signedIn, false, '再起動後の GET /api/llm/status も未サインイン');
    assert.equal(stubs.credText(), CLI_CRED_VALUE);
    // 再び「GitHub でサインイン」: CLI の資格情報が残っているので確認コードの入力なしにサインイン済み
    await app2.startCopilotSignin(); await settle(app2);
    assert.ok(await pumpReal(env, () => field(app2, 'apiKeys.copilot.signinStatus')?.status.id === 'signedIn'), '再び操作するとサインイン済み');
    assert.ok(field(app2, 'apiKeys.copilot.signinStatus').status.text.includes(ACCOUNT), 'アカウント名');
    const s = app2.getCopilotSignin();
    assert.ok(!s || !s.userCode, '確認コードの入力を求めない');
    // 全体を通して: CLI のサインアウト 0 回・資格情報は残る・画面と応答に資格情報を出さない・GitHub への通信なし（スタブだけ）
    assert.equal(stubs.cli().filter((a) => SIGNOUT_LIKE.test(a.join(' '))).length, 0);
    assert.equal(stubs.credText(), CLI_CRED_VALUE);
    assert.ok(!JSON.stringify([app2.getState(), app2.getApiKeysDialog(), app2.getCopilotSignin(), env.storage.dump()]).includes(CLI_CRED_VALUE), '資格情報を表示・保存しない');
    assert.ok(!fs.readFileSync(stubs.env.RELAY_LLM_STORE, { encoding: 'utf8', flag: 'a+' }).includes(CLI_CRED_VALUE), '中継サーバーの保管先に資格情報を保存しない');
    assert.ok(b.log.every((c) => c.path.startsWith('/api/') && !c.path.startsWith('//')), '画面の要求は同一オリジンの中継サーバーだけ');
  } finally {
    await b.ref.current.stop();
  }
});

// NFR-OFFLINE-001 AC-031（プロバイダーが GitHub Copilot のとき）
test('NFR-OFFLINE-001 AC-031 GitHub Copilot: アプリの要求は同一オリジンの中継サーバーだけで、中継サーバーが GitHub Copilot へ送るのは有効・同意済みのときだけ。無効・未同意では 0 件で、ほかに CLI を起動するのはサインイン・状態の確認だけ', async () => {
  const saved = {};
  const external = [];
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: function (...a) { external.push([k, String(a[0])]); throw new Error('network ' + k); } });
  }
  let b;
  try {
    b = await bootReal({ cliSignedIn: true });
    const { app, env, stubs } = b;
    assert.equal((await app.setLlmProvider('copilot')).ok, true);
    await openCopilot(app);
    assert.ok(await pumpReal(env, () => field(app, 'apiKeys.copilot.signinStatus')?.status.id === 'signedIn'), '前提: サインイン済み');
    app.commands['apiKeys.close'](); await flush();
    const sends = () => stubs.sdk().filter((e) => e.ev === 'send').length;
    const said = (t) => app.getState().utterances.some((u) => u.text === t);
    // 未同意（無効）: GitHub Copilot への送信 0 件
    app.commands['session.start']();
    type(app, env, '予算の見直しが必要です', 'コストが高くて困った'); await app.flushLlm(); await sleep(300);
    assert.ok(said('コストが高くて困った'), '前提: 発話が記録される');
    assert.equal(sends(), 0, '無効・未同意では GitHub Copilot へ送らない');
    // 同意を拒否: 0 件のまま
    const r0 = await app.requestLlmEnable();
    if (r0.ok && r0.pending === 'consent') await app.answerLlmConsent(false);
    app.commands['session.nextScene']();
    type(app, env, '来月のリリース計画を決める'); await app.flushLlm(); await sleep(300);
    assert.equal(sends(), 0, '同意を拒否したときも GitHub Copilot へ送らない');
    // 有効・同意済み: 送信がある（FR-062 の例外条件）
    const r1 = await app.requestLlmEnable();
    assert.deepEqual([r1.ok, r1.pending], [true, 'consent'], `同意へ進める: ${JSON.stringify(r1)}`);
    await app.answerLlmConsent(true);
    assert.equal(app.getLlmState().enabled, true);
    app.commands['session.nextScene']();
    type(app, env, '担当者の割り当てを確認する'); await app.flushLlm();
    assert.ok(await pumpReal(env, () => sends() >= 1, 15000), '有効・同意済みでは中継サーバーが GitHub Copilot へ送る');
    // 無効に戻す: 以降 0 件
    await app.disableLlm(); await flush();
    const n = sends();
    app.commands['session.nextScene']();
    type(app, env, '次回の会議の日程を決める'); await app.flushLlm(); await sleep(300);
    assert.equal(sends(), n, '無効にした後は GitHub Copilot へ送らない');
    // アプリ自身の要求: 同一オリジン以外は 0 件
    assert.deepEqual(external, [], '同一オリジン以外への要求は 0 件');
    assert.ok(b.log.length >= 1 && b.log.every((c) => c.path.startsWith('/api/') && !c.path.startsWith('//')), '要求は同一オリジンの中継サーバーだけ');
    // 中継サーバーが CLI を起動したのはサインイン以外にない（このテストではサインインの操作なし → 0 回）
    assert.equal(stubs.cli().length, 0, 'サインインの操作をしない限り CLI のコマンドは呼ばれない');
  } finally {
    for (const k of Object.keys(saved)) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
    if (b) await b.ref.current.stop();
  }
});
