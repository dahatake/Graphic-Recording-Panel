// FR-081 AC-443 AC-446 AC-447 AC-458 / FR-082 AC-449 AC-450 / NFR-SEC-005 AC-452 AC-453 AC-454 AC-455
// 中継サーバー（server/relay.py の実プロセス）を通した System Test。契約: tests/system/CONTRACT-AZURE-SPEECH.md の「2. 中継サーバー」。
// 上流は常に azurespeech-util.js のモック（RELAY_SPEECH_UPSTREAM で宛先の解決だけを差し替える）。実際の Azure Speech へは通信しない（AC-447）。
// キー・トークンはすべて実行ごとに作るダミー。保管先は一時ディレクトリ（RELAY_SPEECH_STORE）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { ROOT } from './helpers.js';
import {
  DUMMY_HOST, DUMMY_ENDPOINT, REGION, dummySpeechKey, startSpeechUpstream, startSpeechRelay, speechReq, getStatus, saveSettings, deleteKey, connTest,
  recognize, fakeWav, ALLOWED_TOP,
} from './azurespeech-util.js';

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN_HOST = `${REGION}.api.cognitive.microsoft.com`;
const STT_HOST = `${REGION}.stt.speech.microsoft.com`;
const hasKey = (c, key) => Object.values(c.headers).some((v) => String(v).includes(key)) || c.url.includes(key) || c.body.toString('latin1').includes(key);
const audioCalls = (up) => up.calls.filter((c) => c.body.includes(Buffer.from('AUDIO-MARKER-ZZ')));

async function withRelay(opts, fn) {
  const key = opts.key ?? dummySpeechKey();
  const up = await startSpeechUpstream({ key, ...(opts.up || {}) });
  const relay = await startSpeechRelay(up, opts.relay || {});
  try { return await fn({ key, up, relay }); } finally { await relay.stop(); await up.close(); }
}

// FR-081 AC-443
test('FR-081 AC-443: カスタムドメインで設定したとき、中継サーバーは音声を設定されたエンドポイントのホストだけへ送る', async () => {
  await withRelay({}, async ({ key, up, relay }) => {
    assert.equal((await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key })).status, 200);
    const r = await recognize(relay, 'ja-JP');
    assert.equal(r.json?.ok, true, r.text);
    assert.equal(r.json.text, up.m.text, '上流の確定結果を返す');
    const a = audioCalls(up);
    assert.ok(a.length >= 1, '音声が上流に届く');
    for (const c of up.calls) assert.equal(c.host, DUMMY_HOST, `上流の宛先は設定されたホストだけ（${c.host}）`);
    assert.ok(a.every((c) => /language=ja-JP/.test(c.url)), '認識の言語を付ける');
  });
});

test('FR-081 AC-443: リージョン名で設定したとき、音声はそのリージョンの認識のホストだけへ送られる', async () => {
  await withRelay({}, async ({ key, up, relay }) => {
    assert.equal((await saveSettings(relay, { endpoint: REGION, key })).status, 200);
    const r = await recognize(relay, 'en-US');
    assert.equal(r.json?.ok, true, r.text);
    const a = audioCalls(up);
    assert.ok(a.length >= 1);
    for (const c of a) assert.equal(c.host, STT_HOST, '音声は認識のホストだけ');
    for (const c of up.calls) assert.ok([TOKEN_HOST, STT_HOST].includes(c.host), `想定外の宛先 ${c.host}`);
    assert.ok(a.every((c) => /language=en-US/.test(c.url)));
  });
});

test('FR-081 AC-443 異常系: 状態の取得・設定の保存・キーの削除では、Azure Speech へ音声を送らない（送信 0 件）', async () => {
  await withRelay({}, async ({ key, up, relay }) => {
    await getStatus(relay);
    await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key });
    await getStatus(relay);
    await deleteKey(relay);
    assert.equal(audioCalls(up).length, 0);
    assert.equal(up.calls.filter((c) => c.url.includes('/speech/recognition/')).length, 0);
    // キーの削除後の認識の要求は上流へ送らず、未設定を返す
    const r = await recognize(relay);
    assert.equal(r.json?.result, 'unconfigured');
    assert.equal(audioCalls(up).length, 0);
  });
});

// FR-081 AC-446
test('FR-081 AC-446: 中継サーバーは音声と認識した文字列を保存・ログ出力しない（成功・認証の失敗とも）', async () => {
  await withRelay({}, async ({ key, up, relay }) => {
    await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key });
    for (let i = 0; i < 3; i++) assert.equal((await recognize(relay)).json?.ok, true);
    up.setMode('auth');
    const bad = await recognize(relay);
    assert.equal(bad.json?.result, 'auth');
    const logs = relay.logs();
    assert.ok(!logs.includes(up.m.text), 'ログに認識した文字列が出ない');
    assert.ok(!logs.includes('AUDIO-MARKER-ZZ'), 'ログに音声が出ない');
    for (const f of fs.readdirSync(relay.dir)) {
      const b = fs.readFileSync(path.join(relay.dir, f));
      assert.ok(!b.includes(Buffer.from('AUDIO-MARKER-ZZ')) && !b.includes(Buffer.from(up.m.text)), `${f} に音声・文字列を保存しない`);
    }
  });
});

// FR-081 AC-447
test('FR-081 AC-447: 実在しそうなエンドポイントを設定しても上流はモックに向き、同じ入力で同じ結果になる（決定的）', async () => {
  await withRelay({}, async ({ key, up, relay }) => {
    await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key });
    const a = await recognize(relay); const b = await recognize(relay);
    assert.deepEqual([a.status, a.json], [b.status, b.json]);
    assert.ok(up.calls.length >= 2, 'すべての上流への要求がモックに届く');
    assert.equal((await connTest(relay)).json?.result, 'success');
  });
});

// FR-082 AC-449
test('FR-082 AC-449: https の Azure Speech のドメインとリージョン名（英小文字と数字）だけを受け付ける', async () => {
  await withRelay({}, async ({ key, relay }) => {
    for (const ep of ['https://contoso-dummy.cognitiveservices.azure.com', 'https://contoso-dummy.cognitiveservices.azure.com/', `https://${TOKEN_HOST}`, `https://${STT_HOST}`, 'japaneast', 'westus2']) {
      const r = await saveSettings(relay, { endpoint: ep, key });
      assert.equal(r.status, 200, `${ep} は受け付ける: ${r.text}`);
      assert.equal(r.json.ok, true);
    }
  });
});

test('FR-082 AC-449 異常系: http・他のドメイン・IP・localhost・ループバック・プライベート・リンクローカル・不正なリージョン名は理由とともに拒否され、保存済みの設定は変わらない', async () => {
  await withRelay({ relay: { extra: { RELAY_ALLOW_LOOPBACK_UPSTREAM: '' } } }, async ({ key, relay }) => {
    assert.equal((await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key })).status, 200);
    const before = (await getStatus(relay)).json;
    const bad = [
      'http://contoso-dummy.cognitiveservices.azure.com', 'https://evil.example.com', 'https://cognitiveservices.azure.com.evil.example.com',
      'https://contoso-dummy.cognitiveservices.azure.com.evil.example.com', 'https://203.0.113.10', 'https://127.0.0.1', 'https://localhost',
      'https://[::1]', 'https://10.0.0.5', 'https://192.168.1.10', 'https://172.16.0.1', 'https://169.254.169.254', 'http://127.0.0.1:9',
      'Japan East', 'JAPANEAST', 'japan-east', 'japaneast.evil', '../etc', '', 'ftp://contoso-dummy.cognitiveservices.azure.com',
    ];
    for (const ep of bad) {
      const r = await saveSettings(relay, { endpoint: ep, key: dummySpeechKey() });
      assert.equal(r.status, 400, `${JSON.stringify(ep)} は拒否: ${r.status}`);
      assert.equal(r.json?.ok, false); assert.equal(r.json?.result, 'invalid');
      assert.ok(typeof r.json.reason === 'string' && r.json.reason.trim().length > 0, '理由を示す');
      assert.deepEqual((await getStatus(relay)).json, before, '保存済みの設定は変わらない');
    }
  });
});

test('FR-082 AC-449 異常系: ループバックのモックは、テスト専用の設定がオンのときだけ受け付けられ、要求の本文からはオンにできない', async () => {
  const key = dummySpeechKey();
  const up = await startSpeechUpstream({ key });
  const off = await startSpeechRelay(null, { extra: { RELAY_ALLOW_LOOPBACK_UPSTREAM: '' } });
  const on = await startSpeechRelay(null, { extra: { RELAY_ALLOW_LOOPBACK_UPSTREAM: '1' } });
  try {
    const r1 = await saveSettings(off, { endpoint: up.url, key, allowLoopback: true, allowLoopbackUpstream: true, RELAY_ALLOW_LOOPBACK_UPSTREAM: '1' });
    assert.equal(r1.status, 400, '既定オフではループバックを拒否（本文の指定は無視）');
    assert.equal((await getStatus(off)).json.endpointHost, null);
    const r2 = await saveSettings(on, { endpoint: up.url, key });
    assert.equal(r2.status, 200, 'オンのときだけループバックのモックを受け付ける');
    assert.equal((await connTest(on)).json?.result, 'success');
  } finally { await off.stop(); await on.stop(); await up.close(); }
});

// FR-082 AC-450
test('FR-082 AC-450: 接続テストは音声・文字を含まない最小の要求（キーの検証）だけを送り、PARAM-074 秒以内に成功を返す', async () => {
  await withRelay({}, async ({ key, up, relay }) => {
    await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key });
    const n = up.calls.length;
    const t0 = Date.now();
    const r = await connTest(relay);
    assert.ok(Date.now() - t0 <= 10_000);
    assert.deepEqual([r.json?.ok, r.json?.result], [true, 'success']);
    const sent = up.calls.slice(n);
    assert.ok(sent.length >= 1, 'キーの検証を送る');
    for (const c of sent) assert.equal(c.bodyLength, 0, '会議の音声・文字を含まない（本文なし）');
    assert.equal(sent.filter((c) => c.url.includes('/speech/recognition/')).length, 0, '認識の要求は送らない');
  });
});

test('FR-082 AC-450 異常系: 未設定（送信 0 件）・認証・接続・タイムアウトの分類を PARAM-074 秒以内に返す', async () => {
  // 未設定
  await withRelay({}, async ({ up, relay }) => {
    const r = await connTest(relay);
    assert.equal(r.json?.result, 'unconfigured'); assert.equal(r.json?.ok, false);
    assert.equal(up.calls.length, 0, '未設定のときは送信 0 件');
  });
  // 認証
  await withRelay({ up: { mode: 'auth' } }, async ({ key, relay }) => {
    await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key });
    assert.equal((await connTest(relay)).json?.result, 'auth');
  });
  // 誤ったキー
  await withRelay({}, async ({ relay }) => {
    await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key: dummySpeechKey() });
    assert.equal((await connTest(relay)).json?.result, 'auth');
  });
  // 接続（上流が停止）
  await withRelay({}, async ({ key, up, relay }) => {
    await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key });
    await up.close();
    const r = await connTest(relay);
    assert.equal(r.json?.result, 'network');
  });
  // タイムアウト（応答なし）
  await withRelay({ up: { mode: 'hang' } }, async ({ key, relay }) => {
    await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key });
    const t0 = Date.now();
    const r = await connTest(relay);
    assert.ok(Date.now() - t0 <= 10_000 + 1_500, `PARAM-074（10 秒）以内に応答（${Date.now() - t0} ms）`);
    assert.equal(r.json?.result, 'timeout');
  });
});

// NFR-SEC-005 AC-452（中継サーバー側: ブラウザが受け取る応答は設定済み／未設定・ホスト名・結果の分類だけ）
test('NFR-SEC-005 AC-452: 状態の取得・保存・削除の応答は「設定済み／未設定」とホスト名と結果の分類だけで、キーの値を含まない', async () => {
  await withRelay({}, async ({ key, relay }) => {
    const rs = [await getStatus(relay), await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key }), await getStatus(relay), await deleteKey(relay), await getStatus(relay)];
    for (const r of rs) {
      assert.ok(r.json && typeof r.json === 'object', r.text);
      for (const k of Object.keys(r.json)) assert.ok(ALLOWED_TOP.has(k), `応答に想定外の項目 ${k}`);
      assert.ok(!r.text.includes(key) && !JSON.stringify(r.headers).includes(key), 'キーの値を含まない');
      if ('keyConfigured' in r.json) assert.equal(typeof r.json.keyConfigured, 'boolean');
    }
    assert.equal(rs[2].json.keyConfigured, true); assert.equal(rs[2].json.endpointHost, DUMMY_HOST);
    assert.equal(rs[4].json.keyConfigured, false);
  });
});

// NFR-SEC-005 AC-453
test('NFR-SEC-005 AC-453: 応答（成功・失敗）とログ・エラーメッセージに、キー・上流への認証ヘッダ・アクセストークンが含まれない', async () => {
  await withRelay({ up: { echoSecrets: true } }, async ({ key, up, relay }) => {
    await saveSettings(relay, { endpoint: REGION, key });
    const seen = [];
    const keep = (r) => { seen.push(r.text, JSON.stringify(r.headers)); return r; };
    keep(await getStatus(relay)); keep(await connTest(relay)); keep(await recognize(relay));
    up.setMode('auth'); keep(await connTest(relay)); keep(await recognize(relay));
    up.setMode('error500'); keep(await connTest(relay)); keep(await recognize(relay));
    up.setMode('ok'); keep(await saveSettings(relay, { endpoint: 'http://bad.example.com', key })); keep(await deleteKey(relay)); keep(await recognize(relay));
    keep(await speechReq(relay, 'POST', '/api/speech/settings', { endpoint: DUMMY_ENDPOINT, key }, { origin: 'http://evil.example.com' }));
    assert.ok(up.tokens.size >= 1, '上流からトークンを得ている');
    const secrets = [key, ...up.tokens];
    for (const s of seen) for (const x of secrets) assert.ok(!s.includes(x), '応答に秘密（キー・トークン）が含まれる');
    for (const s of seen) assert.ok(!/Ocp-Apim-Subscription-Key|Bearer\s+DUMMY/i.test(s), '応答に上流への認証ヘッダが含まれる');
    const logs = relay.logs();
    for (const x of secrets) assert.ok(!logs.includes(x), 'ログに秘密（キー・トークン）が含まれる');
    assert.ok(!/Bearer\s+DUMMY/.test(logs));
  });
});

// NFR-SEC-005 AC-454
test('NFR-SEC-005 AC-454: キーは保管先に OS の保護つきで保存され（Windows: 平文を含まない／他: 0600）、再起動後も設定済みのまま', async () => {
  const key = dummySpeechKey();
  const up = await startSpeechUpstream({ key });
  let relay = await startSpeechRelay(up);
  const store = relay.storeFile;
  try {
    assert.equal((await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key })).status, 200);
    assert.ok(fs.existsSync(store), '保管先のファイルに保存する');
    const bytes = fs.readFileSync(store);
    if (process.platform === 'win32') {
      for (const form of [Buffer.from(key, 'utf8'), Buffer.from(key, 'utf16le'), Buffer.from(Buffer.from(key).toString('base64')), Buffer.from(Buffer.from(key).toString('hex'))]) {
        assert.ok(!bytes.includes(form), '保管先にキーがそのまま（平文・単純な符号化で）含まれない（DPAPI）');
      }
    } else {
      assert.equal(fs.statSync(store).mode & 0o777, 0o600, '所有者だけの読み書き');
    }
    await relay.stop();
    relay = await startSpeechRelay(up, { store });
    const st = (await getStatus(relay)).json;
    assert.deepEqual([st.keyConfigured, st.endpointHost], [true, DUMMY_HOST], '再起動後も設定済み');
    assert.equal((await connTest(relay)).json?.result, 'success', '再起動後も保存したキーで使える');
    assert.ok(up.calls.some((c) => hasKey(c, key)));
    await deleteKey(relay);
    await relay.stop();
    relay = await startSpeechRelay(up, { store });
    assert.equal((await getStatus(relay)).json.keyConfigured, false, '削除は再起動後も保たれる');
  } finally { await relay.stop(); await up.close(); }
});

test('NFR-SEC-005 AC-454: 既定の保管先（リポジトリ内）は .gitignore に載り、git の追跡の対象にならない', () => {
  const rel = 'config/azure-speech.local.json';
  const r = spawnSync('git', ['check-ignore', '-q', rel], { cwd: ROOT });
  assert.equal(r.status, 0, `${rel} が .gitignore に載っている`);
  assert.ok(!git('ls-files', 'config').split('\n').includes(rel), '追跡されていない');
});

// NFR-SEC-005 AC-455
test('NFR-SEC-005 AC-455 異常系: 同一オリジンでない・Origin なし・Host 違いの保存・削除・接続テスト・音声の中継は 403 で、設定は変わらず上流へ何も送らない', async () => {
  await withRelay({}, async ({ key, up, relay }) => {
    await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key });
    const before = (await getStatus(relay)).json;
    const storeBefore = fs.readFileSync(relay.storeFile);
    const n = up.calls.length;
    const variants = [
      { origin: 'http://evil.example.com' }, { origin: null }, { origin: `http://127.0.0.1:${relay.port + 1}` },
      { host: `evil.example.com:${relay.port}`, origin: `http://evil.example.com:${relay.port}` },
    ];
    for (const v of variants) {
      const rs = [
        await saveSettings(relay, { endpoint: 'https://other-dummy.cognitiveservices.azure.com', key: dummySpeechKey() }, v),
        await deleteKey(relay, v), await connTest(relay, v),
        await speechReq(relay, 'POST', '/api/speech/recognize?language=ja-JP', fakeWav(), v),
      ];
      for (const r of rs) assert.equal(r.status, 403, `${JSON.stringify(v)} は 403`);
    }
    assert.deepEqual((await getStatus(relay)).json, before, '設定は変わらない');
    assert.ok(fs.readFileSync(relay.storeFile).equals(storeBefore), '保管されたキーは変わらない');
    assert.equal(up.calls.length, n, 'Azure Speech へは何も送られない');
    // 同一オリジンなら受け付ける（正常系）
    assert.equal((await connTest(relay)).status < 400, true);
  });
});

test('NFR-SEC-005 AC-455: カスタムドメインではそのホストだけにキーを付け、リージョン名ではトークンの発行のホストだけにキー・認識のホストにはトークンだけを付ける', async () => {
  await withRelay({}, async ({ key, up, relay }) => {
    await saveSettings(relay, { endpoint: DUMMY_ENDPOINT, key });
    await connTest(relay); await recognize(relay);
    const withKey = up.calls.filter((c) => hasKey(c, key));
    assert.ok(withKey.length >= 1);
    for (const c of withKey) assert.equal(c.host, DUMMY_HOST);
  });
  await withRelay({}, async ({ key, up, relay }) => {
    await saveSettings(relay, { endpoint: REGION, key });
    await connTest(relay); await recognize(relay); await recognize(relay);
    for (const c of up.calls.filter((x) => hasKey(x, key))) assert.equal(c.host, TOKEN_HOST, `キーはトークンの発行のホストだけ（${c.host}）`);
    const stt = up.calls.filter((c) => c.host === STT_HOST);
    assert.ok(stt.length >= 2, '認識のホストへ送る');
    for (const c of stt) {
      assert.ok(!hasKey(c, key), '認識のホストへはキーを付けない');
      const auth = String(c.headers.authorization || '');
      assert.ok(auth.startsWith('Bearer ') && up.tokens.has(auth.slice(7)), '発行したアクセストークンだけを付ける');
    }
  });
});

test('NFR-SEC-005 AC-455: リポジトリに Azure Speech のキーの実値らしい文字列と、利用者のリソースのエンドポイントの実値が 0 件', () => {
  const files = git('ls-files').split('\n').filter(Boolean).filter((f) => !/\.(png|jpg|jpeg|gif|ico|woff2?|pdf|zip|mp3|ogg|wav)$/i.test(f));
  const keyPats = [
    /Ocp-Apim-Subscription-Key["']?\s*[:=]\s*["']?[0-9a-f]{32}\b/i,
    /(speech|subscription|azure)[-_ ]?key["']?\s*[:=]\s*["'][0-9a-f]{32}["']/i,
    /(speech|subscription|azure)[-_ ]?key["']?\s*[:=]\s*["'][A-Za-z0-9]{84}["']/i,
  ];
  const placeholder = /<|\*|\{|dummy|example|contoso|your|mock|test|evil|sample|placeholder|xxx|name|resource|other/i;
  const hits = [];
  for (const f of files) {
    let t; try { t = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
    for (const p of keyPats) { const m = t.match(p); if (m) hits.push(`${f}: ${m[0].slice(0, 24)}…`); }
    for (const m of t.matchAll(/([^\s/"'`(]+)\.cognitiveservices\.azure\.com/g)) if (!placeholder.test(m[1])) hits.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(hits, []);
});

// FR-081 AC-458（中継サーバー側: アクセストークンの期限が来たら中継サーバーが取り直す）
test('FR-081 AC-458: アクセストークンの期限が来たら中継サーバーがトークンを取り直し、認識を続けられる', async () => {
  await withRelay({ relay: { extra: { RELAY_SPEECH_TOKEN_TTL_SEC: '1' } } }, async ({ key, up, relay }) => {
    await saveSettings(relay, { endpoint: REGION, key });
    assert.equal((await recognize(relay)).json?.ok, true);
    const first = up.calls.filter((c) => c.host === STT_HOST).at(-1).headers.authorization;
    await sleep(1600);
    up.expireAll(); // 期限の来たトークンは上流が拒む
    const r = await recognize(relay);
    assert.equal(r.json?.ok, true, `取り直したトークンで認識できる: ${r.text}`);
    const issued = up.calls.filter((c) => /issueToken/.test(c.url));
    assert.ok(issued.length >= 2, 'トークンを取り直す');
    const second = up.calls.filter((c) => c.host === STT_HOST).at(-1).headers.authorization;
    assert.notEqual(second, first, '新しいトークンを使う');
  });
});
