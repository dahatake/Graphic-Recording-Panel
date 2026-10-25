// FR-088（AC-508・AC-509・AC-510 のクライアント側・AC-512）／NFR-SEC-006（AC-515 のクライアント側）／FR-084（AC-482・AC-483 の 3 分類）の単体・結合テスト。
// 中継サーバーはモックだけ（GitHub・Copilot CLI へは通信しない）。System Test: tests/system/copilot.test.js・tests/system/apikeys.test.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../web/src/app.js';
import { MAX_TOKEN_LENGTH, MAX_MODEL_LENGTH } from '../../web/src/copilotkeys.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, dump: () => [...m.entries()] }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const PROBE = 'PROBE-UNIT-GH-TOKEN-not-real';
const LEAK = 'PROBE-UNIT-LEAK-not-real';

function sched() {
  let now = 0; let id = 0; const q = new Map();
  return {
    setTimeout: (f, ms) => { id += 1; q.set(id, { f, at: now + ms }); return id; },
    clearTimeout: (i) => { q.delete(i); },
    advance(ms) { now += ms; for (const [i, x] of [...q]) if (x.at <= now) { q.delete(i); x.f(); } },
  };
}

function relayMock(copilot = {}, { signin } = {}) {
  const r = { calls: [], cp: { available: true, unavailableReason: null, authMethod: 'signin', authMethodSource: null, signedIn: false, account: null, tokenConfigured: false, tokenSource: null, model: '', modelSource: null, ...copilot }, flow: 'pending' };
  r.fn = async ({ method = 'GET', path: p, body }) => {
    r.calls.push({ method, path: p, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) });
    if (p === '/api/llm/status' || (p === '/api/llm/copilot' && method === 'GET')) return { status: 200, body: { configured: {}, copilot: { ...r.cp, token: LEAK, credential: LEAK }, token: LEAK } };
    if (p === '/api/llm/copilot' && method === 'POST') {
      r.cp.authMethod = body.authMethod; r.cp.authMethodSource = 'ui';
      if (body.token) { r.cp.tokenConfigured = true; r.cp.tokenSource = 'ui'; }
      return { status: 200, body: { ok: true, result: 'saved', copilot: { authMethod: r.cp.authMethod, authMethodSource: 'ui', tokenConfigured: r.cp.tokenConfigured, tokenSource: r.cp.tokenSource, model: body.model, modelSource: body.model ? 'ui' : null, token: LEAK } } };
    }
    if (p === '/api/llm/copilot/signin' && method === 'POST') return { status: 200, body: signin ?? { ok: true, state: 'pending', verificationUri: 'https://github.com/login/device', userCode: 'WXYZ-0987' } };
    if (p === '/api/llm/copilot/signin' && method === 'GET') return { status: 200, body: { state: r.flow, account: 'octo-unit', accessToken: LEAK } };
    if (p === '/api/speech/status') return { status: 200, body: { endpointHost: null, keyConfigured: false } };
    return { status: 404, body: null };
  };
  return r;
}
async function boot(m, extra = {}) {
  const storage = mem(); const scheduler = sched();
  const app = await createApp({ storage, relay: m.fn, scheduler, ...extra });
  await app.refreshCopilotKeysStatus();
  app.commands['apiKeys.open'](); await flush();
  app.selectApiKeysCategory('copilot'); await flush();
  return { app, storage, scheduler };
}
const field = (app, id) => app.getApiKeysDialog().fields.find((f) => f.id === `apiKeys.copilot.${id}`);
const visible = (app, storage) => JSON.stringify([app.getState(), app.getApiKeysDialog(), app.getDialog(), app.getCopilotSignin(), app.getCopilotKeysStatus(), storage.dump()]);

// FR-084 AC-483: 分類は Microsoft Foundry・GitHub Copilot・Azure Speech の順で、GitHub Copilot の分類の項目は apiKeys.copilot.* だけ
test('FR-084 AC-483: 接続キー画面の分類は foundry・copilot・azureSpeech の 3 つ', async () => {
  const { app } = await boot(relayMock());
  assert.deepEqual(app.getApiKeysDialog().categories.map((c) => c.id), ['foundry', 'copilot', 'azureSpeech']);
  assert.ok(app.getApiKeysDialog().fields.every((f) => f.id.startsWith('apiKeys.copilot.')));
});

// FR-084 AC-482: ［設定］の「接続キー」の分類の説明に GitHub Copilot の認証を含み、「設定」の語を使わない（日英）
test('FR-084 AC-482: 接続キーの説明は Foundry・Azure Speech・GitHub Copilot を含み、「設定」「Settings」を含まない', async () => {
  const app = await createApp({ storage: mem() });
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    app.commands['settings.open']();
    const it = app.getSettingsDialog().categories.find((x) => x.id === 'apiKeys'); // 2026-10-25: ［設定］の「接続キー」の分類
    app.commands['settings.close']();
    for (const w of ['Foundry', 'Azure Speech', 'GitHub Copilot']) assert.ok(it.description.includes(w), `${lang}: ${w}`);
    assert.ok(!/設定|Settings/i.test(it.description));
  }
});

// FR-088 AC-508 / NFR-SEC-006 AC-515: 中継サーバーの応答に混ざったトークン・資格情報らしい値は画面・保存に出ない。トークンは伏せ字で、送った後は空
test('FR-088 AC-508 / NFR-SEC-006 AC-515: トークンは書き込み専用で、入力・応答の値は画面・ブラウザ内の保存に現れない', async () => {
  const m = relayMock();
  const { app, storage } = await boot(m);
  app.setCopilotAuthMethod('token');
  app.setCopilotTokenInput(PROBE);
  assert.equal(field(app, 'token').input.value, '•'.repeat(PROBE.length));
  assert.ok(!visible(app, storage).includes(PROBE));
  const r = await app.saveCopilotSettings();
  assert.deepEqual(r, { ok: true, result: 'saved' });
  assert.equal(m.calls.find((c) => c.path === '/api/llm/copilot' && c.method === 'POST').body.token, PROBE, '中継サーバーへは送る');
  assert.equal(field(app, 'token').input.value, '');
  const s = visible(app, storage);
  assert.ok(!s.includes(PROBE) && !s.includes(LEAK), 'トークン・漏れの探針は表示・保存されない');
  assert.equal(field(app, 'tokenStatus').status.id, 'set');
});

// FR-088 AC-508: サインインのときはトークンを入力できず、理由が示され、トークンを送らない
test('FR-088 AC-508: 認証方式がサインインのときトークン欄は無効で、入力は捨てられ送られない', async () => {
  const m = relayMock();
  const { app } = await boot(m);
  assert.equal(field(app, 'authMethod').input.value, 'signin');
  assert.equal(field(app, 'token').disabled, true);
  assert.ok(field(app, 'token').reason.trim());
  app.setCopilotTokenInput(PROBE);
  assert.equal(field(app, 'token').input.value, '');
  await app.saveCopilotSettings();
  assert.ok(!('token' in m.calls.find((c) => c.path === '/api/llm/copilot' && c.method === 'POST').body));
  // 認証方式をトークンにしてから戻すと、入力中のトークンは捨てられる
  app.setCopilotAuthMethod('token'); app.setCopilotTokenInput(PROBE); app.setCopilotAuthMethod('signin');
  app.setCopilotAuthMethod('token');
  assert.equal(field(app, 'token').input.value, '');
});

// FR-088 AC-510（クライアント側の検査）: 長さの上限（PARAM-094・PARAM-096）を超える値は送らない
test('FR-088 AC-510: トークンは PARAM-094、モデル名は PARAM-096 を超えると invalid で送らない。上限ちょうどは送る', async () => {
  assert.equal(MAX_TOKEN_LENGTH, 512); assert.equal(MAX_MODEL_LENGTH, 64);
  const m = relayMock();
  const { app } = await boot(m);
  app.setCopilotAuthMethod('token');
  app.setCopilotTokenInput('x'.repeat(513)); assert.equal((await app.saveCopilotSettings()).result, 'invalid');
  app.setCopilotModelInput('m'.repeat(65)); assert.equal((await app.saveCopilotSettings()).result, 'invalid');
  assert.equal(m.calls.filter((c) => c.path === '/api/llm/copilot' && c.method === 'POST').length, 0);
  assert.equal(app.getApiKeysDialog().liveMessage.role, 'alert');
  app.setCopilotModelInput('m'.repeat(64)); app.setCopilotTokenInput('x'.repeat(512));
  assert.equal((await app.saveCopilotSettings()).result, 'saved');
});

// FR-088 AC-509: 確認のページの URL は GitHub のデバイス認証のページだけを示す（ほかの URL・不正な確認コードは示さない）
test('FR-088 AC-509: 中継サーバーが GitHub 以外の URL を返しても、リンクとして示さず失敗にする', async () => {
  for (const bad of [{ verificationUri: 'https://evil.example/login/device', userCode: 'ABCD-1234' }, { verificationUri: 'javascript:alert(1)', userCode: 'ABCD-1234' }, { verificationUri: 'https://github.com/login/device', userCode: `<b>${LEAK}</b>` }]) {
    const { app } = await boot(relayMock({}, { signin: { ok: true, state: 'pending', ...bad } }));
    const r = await app.startCopilotSignin();
    assert.equal(r.ok, false);
    assert.equal(app.getCopilotSignin().state, 'failed');
    assert.equal(app.getCopilotSignin().link, null);
    assert.ok(!JSON.stringify(app.getApiKeysDialog()).includes('evil.example') && !JSON.stringify(app.getApiKeysDialog()).includes(LEAK));
  }
});

// FR-088 AC-509: 待機中はキーボードで操作できるリンク・コピー・取り消しがあり、完了で再読込なしにサインイン済み。資格情報は持たない
test('FR-088 AC-509: 待機中の操作（リンク・コピー・取り消し）がキーボードで届き、承認で signedIn', async () => {
  const m = relayMock();
  const copied = [];
  const { app, scheduler, storage } = await boot(m, { clipboard: { writeText: async (x) => { copied.push(x); } } });
  app.focusApiKeysField('apiKeys.copilot.signin');
  app.handleKey({ key: 'Enter' }); await flush();
  assert.equal(app.getCopilotSignin().state, 'pending');
  const ids = app.getApiKeysDialog().fields.map((f) => f.id);
  for (const id of ['verifyLink', 'copyCode', 'cancelSignin']) assert.ok(ids.includes(`apiKeys.copilot.${id}`));
  assert.equal(field(app, 'verifyLink').target, '_blank');
  assert.equal(field(app, 'signin').disabled, true, '待機中は二重に始めない');
  app.focusApiKeysField('apiKeys.copilot.copyCode'); app.handleKey({ key: 'Enter' }); await flush();
  assert.deepEqual(copied, ['WXYZ-0987']);
  m.flow = 'completed'; m.cp.signedIn = true; m.cp.account = 'octo-unit';
  scheduler.advance(5000); await flush(); await flush();
  assert.equal(field(app, 'signinStatus').status.id, 'signedIn');
  assert.ok(field(app, 'signinStatus').status.text.includes('octo-unit'));
  assert.ok(!visible(app, storage).includes(LEAK));
});

// FR-088 AC-509: 取り消しは中継サーバーへ送り、待機の確認を止める
test('FR-088 AC-509: 取り消しの後は確認の要求を送らない', async () => {
  const m = relayMock();
  const { app, scheduler } = await boot(m);
  await app.startCopilotSignin();
  await app.cancelCopilotSignin();
  assert.equal(app.getCopilotSignin().state, 'cancelled');
  const n = m.calls.length;
  scheduler.advance(30_000); await flush();
  assert.equal(m.calls.filter((c, i) => i >= n && c.path === '/api/llm/copilot/signin' && c.method === 'GET').length, 0);
});

// FR-088 AC-512: users-guide に、プロバイダーの選び方・SDK の導入・サインインの手順・トークンの種類と環境変数・利用権と利用量が日本語で書かれ、実値を含まない
test('FR-088 AC-512: users-guide に GitHub Copilot の導入・サインイン・トークン・利用権の説明があり、トークンの実値を含まない', () => {
  const guide = fs.readdirSync(path.join(ROOT, 'users-guide')).filter((f) => f.endsWith('.md')).map((f) => fs.readFileSync(path.join(ROOT, 'users-guide', f), 'utf8')).join('\n');
  for (const w of ['LLM のプロバイダー', '［設定］', 'requirements-copilot.txt', 'GitHub Copilot SDK', '確認のページ', '確認コード', 'fine-grained personal access token', 'classic の personal access token', 'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', '利用権', '利用量']) {
    assert.ok(guide.includes(w), `users-guide に「${w}」`);
  }
  assert.ok(!/(github_pat_[A-Za-z0-9_]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,})/.test(guide), 'トークンの実値らしい文字列がない');
});
