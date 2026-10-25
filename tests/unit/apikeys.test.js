// FR-084（AC-482〜AC-486・AC-495）／FR-085（AC-487・AC-489 のクライアント側）／NFR-SEC-006（AC-490・AC-491）の単体・結合テスト。
// 中継サーバーはモックだけ（ネットワークに出ない）。System Test: tests/system/apikeys.test.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../web/src/app.js';
import { MAX_KEY_LENGTH } from '../../web/src/apikeys.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } }; };
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

function relayMock({ keyConfigured = false, keySource = null } = {}) {
  const r = { calls: [], keyConfigured, keySource };
  r.fn = async ({ method = 'GET', path: p, body }) => {
    r.calls.push({ method, path: p, body });
    const st = () => ({ keyConfigured: r.keyConfigured, keySource: r.keySource });
    if (p === '/api/llm/status') return { status: 200, body: { configured: {}, endpointHost: '', ...st() } };
    if (p === '/api/llm/key' && method === 'POST') { r.keyConfigured = true; r.keySource = 'ui'; return { status: 200, body: { ok: true, result: 'saved', ...st() } }; }
    if (p === '/api/llm/key' && method === 'DELETE') {
      if (r.keySource !== 'ui') return { status: 409, body: { ok: false, result: 'env_managed', ...st() } };
      r.keyConfigured = false; r.keySource = null; return { status: 200, body: { ok: true, result: 'deleted', ...st() } };
    }
    if (p === '/api/speech/status') return { status: 200, body: { endpointHost: null, keyConfigured: false } };
    return { status: 404, body: null };
  };
  return r;
}
const boot = async (m) => { const app = await createApp({ storage: mem(), relay: m.fn }); await app.refreshFoundryKeyStatus(); await app.refreshAzureSpeechStatus(); return app; };

// FR-084 AC-483: 開いている間は背景のコマンド・キー・入力が効かず、接続キー画面のコマンドだけ通る
test('FR-084 AC-483: モーダルが開いている間、背景のコマンドは {ok:false, reason:modal}。閉じると戻る', async () => {
  const app = await boot(relayMock());
  app.commands['apiKeys.open'](); await flush();
  assert.equal(app.commands['session.start']().reason, 'modal');
  assert.equal(app.setDraft('x').reason, 'modal');
  assert.equal(app.getState().session, 'preparing');
  assert.equal(app.handleKey({ key: 'Escape' }), 'apiKeys.close');
  app.commands['session.start'](); assert.equal(app.getState().session, 'recording');
  assert.equal(app.getState().focusReturn, 'settings.open', 'AC-484: フォーカスは開く前の［設定］の操作へ戻る');
});

// FR-085 AC-487・AC-489: キーの形式の検査（空・空白だけ・制御文字・長さ超過）は送らずに拒否し、保存済みの状態は変えない
test('FR-085 AC-489: 形式の誤りは送らずに拒否する（長さの上限 PARAM-094）', async () => {
  const m = relayMock({ keyConfigured: true, keySource: 'ui' });
  const app = await boot(m);
  for (const bad of ['', '  ', 'a\u0007b', 'x'.repeat(MAX_KEY_LENGTH + 1)]) {
    app.setFoundryKeyInput(bad);
    assert.deepEqual(await app.saveFoundryKey(), { ok: false, result: 'invalid' });
  }
  assert.equal(m.calls.filter((c) => c.method === 'POST').length, 0);
  assert.equal(app.getFoundryKeyStatus().keyConfigured, true, '拒否しても保存済みのキーは変わらない');
  app.setFoundryKeyInput('x'.repeat(MAX_KEY_LENGTH));
  assert.equal((await app.saveFoundryKey()).ok, true);
});

// FR-085 AC-487: 環境変数・設定ファイルのキーは画面から削除できない（要求を送らない）
test('FR-085 AC-487: 画面で保存したキーだけ削除できる', async () => {
  const m = relayMock({ keyConfigured: true, keySource: 'env' });
  const app = await boot(m);
  app.commands['foundry.deleteKey'](); await flush();
  assert.equal(app.getDialog(), null);
  assert.equal(m.calls.filter((c) => c.method === 'DELETE').length, 0);
  const m2 = relayMock({ keyConfigured: true, keySource: 'ui' });
  const app2 = await boot(m2);
  app2.commands['foundry.deleteKey'](); await app2.dialogAction('confirm'); await flush();
  assert.equal(app2.getFoundryKeyStatus().keyConfigured, false);
});

// NFR-SEC-006 AC-490: 応答にキーらしい値が混ざっても使わない（keyConfigured・keySource だけを取り出す）
test('NFR-SEC-006 AC-490: 応答のキーらしい値は表示・保持しない', async () => {
  const probe = 'PROBE-UNIT-FOUNDRY-KEY';
  const relay = async () => ({ status: 200, body: { keyConfigured: true, keySource: 'ui', key: probe, apiKey: probe } });
  const app = await createApp({ storage: mem(), relay });
  await app.refreshFoundryKeyStatus();
  app.commands['apiKeys.open']();
  await flush();
  assert.ok(!JSON.stringify([app.getFoundryKeyStatus(), app.getApiKeysDialog(), app.getState()]).includes(probe));
});

// FR-084 AC-495: users-guide に接続キー画面の説明がある（日本語・［設定］とは別・実値を含まない）
test('FR-084 AC-495: users-guide/10-api-keys.md に開き方・閉じ方・Azure Speech の使い方があり、プレースホルダだけ', () => {
  const t = fs.readFileSync(path.join(ROOT, 'users-guide', '10-api-keys.md'), 'utf8');
  for (const w of ['［接続キー］', 'Esc', 'Azure Speech', '［設定］', '［設定］の中']) assert.ok(t.includes(w), w);
  assert.ok(t.includes('<キー>') && t.includes('<リソース名>'));
  assert.ok(!/[0-9a-f]{32}/i.test(t), 'キーらしい 32 桁の値を含まない');
});
