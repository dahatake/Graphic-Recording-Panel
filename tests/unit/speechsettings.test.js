// FR-082 AC-448 AC-449 AC-450 AC-451 / NFR-SEC-005 AC-452 AC-457 の単体・結合テスト（web/src/speechsettings.js・web/src/ui.js・users-guide）。
// 実際の Azure Speech・中継サーバーは使わず、同一オリジンの中継サーバーのモック（options.relay）だけを使う。キーはダミーだけ。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newApp } from '../system/helpers.js';
import { METHOD_KEY } from '../../web/src/speechsettings.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dummyKey = () => `DUMMY-UNIT-KEY-${Math.random().toString(36).slice(2)}`;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const field = (app, id) => app.getSettingsDialog()?.fields.find((f) => f.id === id);

function relayMock({ host = null, key = false, mode = 'ok', extra = {} } = {}) {
  const r = { calls: [], host, key, mode };
  r.fn = async ({ method = 'GET', path: p, body }) => {
    r.calls.push({ method, path: p, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) });
    if (r.mode === 'throw') throw new TypeError('Failed to fetch');
    if (p.startsWith('/api/llm/')) return { status: 200, body: { configured: { endpoint: false, deployment: false, credential: false } } };
    const st = { endpointHost: r.host, keyConfigured: r.key, ...extra };
    if (p === '/api/speech/status') return { status: 200, body: st };
    if (p === '/api/speech/settings') {
      if (r.mode === 'invalid') return { status: 400, body: { ok: false, result: 'invalid', reason: 'x' } };
      if (body.endpoint) r.host = 'unit-dummy.cognitiveservices.azure.com';
      if (body.key) r.key = true;
      return { status: 200, body: { ok: true, result: 'saved', endpointHost: r.host, keyConfigured: r.key, ...extra } };
    }
    if (p === '/api/speech/key') { r.key = false; return { status: 200, body: { ok: true, result: 'deleted', endpointHost: r.host, keyConfigured: false } }; }
    if (p === '/api/speech/test') {
      if (r.mode === 'hang') return new Promise(() => {});
      if (r.mode === 'status401') return { status: 401, body: null };
      return { status: 200, body: { ok: r.mode === 'ok', result: r.mode === 'ok' ? 'success' : r.mode } };
    }
    return { status: 404, body: null };
  };
  return r;
}
async function boot(o = {}) {
  const relay = relayMock(o);
  const ctx = await newApp({ options: { relay: relay.fn } });
  ctx.app.commands['settings.open']();
  await ctx.app.refreshAzureSpeechStatus();
  return { ...ctx, relay };
}

// FR-082 AC-448
test('FR-082 AC-448: 設定画面の項目（方式・接続先・書き込み専用のキー・状態・保存・削除・接続テスト）と、伏せ字・状態の文', async () => {
  const { app } = await boot();
  const ids = app.getSettingsDialog().fields.map((f) => f.id);
  for (const id of ['speech.method', 'azureSpeech.endpoint', 'azureSpeech.key', 'azureSpeech.status', 'azureSpeech.save', 'azureSpeech.delete', 'azureSpeech.test']) assert.ok(ids.includes(id), id);
  const key = dummyKey();
  app.setAzureSpeechKeyInput(key);
  const k = field(app, 'azureSpeech.key');
  assert.equal(k.input.type, 'password'); assert.equal(k.input.writeOnly, true);
  assert.ok(!JSON.stringify(app.getSettingsDialog()).includes(key), '伏せ字だけ');
  assert.match(field(app, 'azureSpeech.status').status.text, /未設定/);
  assert.equal(field(app, 'azureSpeech.delete').disabled, true, '未設定のときは削除できない');
});

test('FR-082 AC-448: 保存の本文は入力された項目だけ（キー欄が空ならキーを送らない）、成功で状態と方式が変わる', async () => {
  const { app, relay, env } = await boot();
  const key = dummyKey();
  app.setAzureSpeechEndpointInput(' https://unit-dummy.cognitiveservices.azure.com ');
  app.setAzureSpeechKeyInput(key);
  const r = await app.saveAzureSpeech();
  assert.deepEqual(r, { ok: true, result: 'saved' });
  const sent = relay.calls.filter((c) => c.path === '/api/speech/settings');
  assert.deepEqual(sent[0].body, { endpoint: 'https://unit-dummy.cognitiveservices.azure.com', key });
  assert.equal(field(app, 'azureSpeech.key').input.value, '');
  assert.equal(field(app, 'azureSpeech.endpoint').input.value, '', '成功したら接続先の欄も空に戻す');
  assert.match(field(app, 'azureSpeech.status').status.text, /unit-dummy\.cognitiveservices\.azure\.com/);
  assert.equal(app.getSpeechMethod(), 'azure');
  assert.equal(env.storage.getItem(METHOD_KEY), 'azure', '方式だけをブラウザ内に保存する');
  // 何も入力せずに保存すると送らない
  const n = relay.calls.length;
  assert.equal((await app.saveAzureSpeech()).result, 'empty');
  assert.equal(relay.calls.length, n);
});

test('FR-082 AC-448: 削除は確認つきで Esc はキャンセル。確定でキーが消え方式はブラウザ標準に戻る', async () => {
  const { app, relay } = await boot({ host: 'unit-dummy.cognitiveservices.azure.com', key: true });
  assert.equal(app.setSpeechMethod('azure').ok, true);
  app.commands['azureSpeech.deleteKey']();
  assert.equal(app.getDialog().kind, 'azure-key-delete');
  assert.equal(app.getDialog().defaultFocus, 'cancel');
  assert.equal(app.handleKey({ key: 'Escape' }), 'dialog.cancel');
  await flush();
  assert.equal(app.getDialog(), null);
  assert.equal(relay.calls.filter((c) => c.method === 'DELETE').length, 0);
  app.commands['azureSpeech.deleteKey']();
  await app.dialogAction('confirm');
  assert.equal(relay.calls.filter((c) => c.method === 'DELETE').length, 1);
  assert.equal(field(app, 'azureSpeech.key').status.id, 'unset');
  assert.equal(app.getSpeechMethod(), 'browser');
  assert.match(app.getState().message.text, /削除/);
});

test('FR-082 AC-448 異常系: 中継サーバーなし（options.relay 省略）では項目を操作できず、理由が示される', async () => {
  const { app } = await newApp({});
  app.commands['settings.open']();
  for (const id of ['azureSpeech.endpoint', 'azureSpeech.key', 'azureSpeech.save', 'azureSpeech.delete', 'azureSpeech.test']) assert.equal(field(app, id).disabled, true, id);
  assert.equal(field(app, 'azureSpeech.status').status.id, 'unavailable');
  assert.ok(field(app, 'azureSpeech.endpoint').reason.length > 0);
  assert.equal(app.setSpeechMethod('azure').ok, false);
  assert.equal(app.setSpeechMethod('x').reason, 'unknown');
});

test('FR-082 AC-448: 表示言語の切替でラベル・状態の文・メッセージが英語になる', async () => {
  const { app } = await boot();
  const ja = field(app, 'azureSpeech.save').label;
  app.setAzureSpeechKeyInput(dummyKey()); await app.saveAzureSpeech();
  const jaMsg = app.getState().message.text;
  app.setLang('en');
  assert.notEqual(field(app, 'azureSpeech.save').label, ja);
  assert.match(field(app, 'azureSpeech.key').status.text, /Key/);
  assert.notEqual(app.getState().message.text, jaMsg, 'メッセージも訳し直す');
});

// FR-082 AC-449
test('FR-082 AC-449 異常系: 中継サーバーが拒否（400）したら理由を示し、状態と方式は変わらない', async () => {
  const { app } = await boot({ host: 'unit-dummy.cognitiveservices.azure.com', key: true, mode: 'invalid' });
  app.setAzureSpeechEndpointInput('http://evil.example.com');
  const r = await app.saveAzureSpeech();
  assert.deepEqual(r, { ok: false, result: 'invalid' });
  assert.match(app.getState().message.text, /https/);
  assert.equal(app.getAzureSpeechSettings().endpointHost, 'unit-dummy.cognitiveservices.azure.com');
  assert.equal(app.getSpeechMethod(), 'browser');
});

// FR-082 AC-450
test('FR-082 AC-450: 接続テストの分類（応答の result・401・例外・タイムアウト）', async () => {
  for (const [mode, expect] of [['ok', 'success'], ['auth', 'auth'], ['network', 'network'], ['unconfigured', 'unconfigured'], ['status401', 'auth']]) {
    const { app } = await boot({ host: 'mock-h.cognitiveservices.azure.com', key: true, mode });
    const r = await app.testAzureSpeech();
    assert.deepEqual([r.ok, r.result], [expect === 'success', expect], mode);
  }
  // 状態の取得は成功させてから、接続テストだけ中継サーバーが応答しない（例外）
  const t = await boot({ host: 'mock-h.cognitiveservices.azure.com', key: true });
  t.relay.mode = 'throw';
  assert.equal((await t.app.testAzureSpeech()).result, 'network');
  const h = await boot({ host: 'mock-h.cognitiveservices.azure.com', key: true, mode: 'hang' });
  const p = h.app.testAzureSpeech(); await flush();
  h.env.scheduler.advance(10_000);
  assert.equal((await p).result, 'timeout');
  assert.equal(field(h.app, 'azureSpeech.test').status.id, 'timeout');
});

// NFR-SEC-005 AC-452
test('NFR-SEC-005 AC-452: 応答に混ざった余計な項目（キーらしい値）や不正なホスト名は取り込まない', async () => {
  const probe = 'PROBE-UNIT-KEY-not-a-secret';
  const { app, env } = await boot({ host: 'mock-h.cognitiveservices.azure.com', key: true, extra: { key: probe, apiKey: probe } });
  assert.deepEqual(app.getAzureSpeechSettings(), { reachable: true, endpointHost: 'mock-h.cognitiveservices.azure.com', keyConfigured: true });
  assert.ok(!JSON.stringify(app.getSettingsDialog()).includes(probe));
  assert.ok(!JSON.stringify(env.storage.dump()).includes(probe));
  const bad = await boot({ host: '<img src=x onerror=1>', key: true });
  assert.equal(bad.app.getAzureSpeechSettings().endpointHost, null);
});

// NFR-SEC-005 AC-457
test('NFR-SEC-005 AC-457: 保存の要求を送る前にキーの入力欄を空にする（応答待ちの間も値を持たない）', async () => {
  const relay = relayMock();
  let release;
  const fn = async (req) => { if (req.path === '/api/speech/settings') { await new Promise((r) => { release = r; }); } return relay.fn(req); };
  const { app } = await newApp({ options: { relay: fn } });
  app.commands['settings.open'](); await app.refreshAzureSpeechStatus();
  const key = dummyKey();
  app.setAzureSpeechKeyInput(key);
  const p = app.saveAzureSpeech(); await flush();
  assert.equal(field(app, 'azureSpeech.key').input.value, '', '応答待ちの間も空');
  assert.equal(field(app, 'azureSpeech.save').disabled, true, '応答待ちの間は二重に保存できない');
  release(); await p;
  assert.equal(field(app, 'azureSpeech.save').disabled, false);
});

test('NFR-SEC-005 AC-457: ui.js のキーの欄は password・new-password で、<form> に入れず、保存・pagehide・pageshow で値を空にする', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'web', 'src', 'ui.js'), 'utf8');
  const block = ui.slice(ui.indexOf('function buildAzureSpeech'), ui.indexOf('function syncAzureSpeech'));
  assert.match(block, /azKeyEl\.type = 'password'/);
  assert.match(block, /\['autocomplete', 'new-password'\]/);
  assert.ok(!/createElement\('form'\)/.test(block), '<form> に入れない');
  assert.match(block, /const save = \(\) => \{ const p = app\.saveAzureSpeech\(\); if \(azKeyEl\) azKeyEl\.value = '';/, '保存の操作の直後に（応答を待たずに）DOM の値を空にする');
  assert.match(ui, /addEventListener\?\.\('pagehide', clearAzureKey\)/);
  assert.match(ui, /addEventListener\?\.\('pageshow', clearAzureKey\)/);
});

// FR-082 AC-451
test('FR-082 AC-451: users-guide の Azure Speech の文書は目次から辿れ、キー・エンドポイントの例はプレースホルダだけ', () => {
  const guide = fs.readFileSync(path.join(ROOT, 'users-guide', '09-azure-speech.md'), 'utf8');
  assert.match(fs.readFileSync(path.join(ROOT, 'users-guide', 'README.md'), 'utf8'), /09-azure-speech\.md/);
  for (const w of ['エンドポイント', 'キー', '保存', '変更', '削除', '接続テスト', '方式', '同意', '対処', '再配置']) assert.ok(guide.includes(w), w);
  for (const m of guide.matchAll(/([^\s/"'`(]+)\.cognitiveservices\.azure\.com/g)) assert.match(m[1], /<|\*/, m[0]);
  assert.ok(!/\b[0-9a-f]{32}\b/.test(guide));
});
