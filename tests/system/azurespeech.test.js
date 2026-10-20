// FR-081 AC-441 AC-442 AC-443 AC-444 AC-445 AC-446 AC-447 AC-458 / FR-082 AC-448 AC-449 AC-450 / NFR-SEC-005 AC-452 AC-457
// アプリ（createApp）を通した System Test。契約: tests/system/CONTRACT-AZURE-SPEECH.md。期待値は受入基準だけから決める。
// Azure Speech は注入した偽物（FakeAzureSpeech）と同一オリジンの中継サーバーのモック（makeSpeechRelay）だけを使い、ネットワークに出ない。
// AC-443・445・446・447・449・450・458 は検証レベル integration だが、同じ契約の app で確かめられる部分をここに置く（中継サーバー側は azurespeech-relay.test.js）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FakeVisibility, PARAM, CJK, WEB, ROOT, bytesToLatin1, pdfTexts } from './helpers.js';
import {
  DUMMY_HOST, DUMMY_HOST2, DUMMY_ENDPOINT, dummySpeechKey, flush, bootAzure, reloadAzure, startAzureRecording, settingsField,
} from './azurespeech-util.js';

const LOCAL = { availability: { 'ja-JP': 'local', 'en-US': 'local' } };
const REMOTE = { processLocally: false, availability: { 'ja-JP': 'remote', 'en-US': 'remote' } };
const PARAM_074_MS = 10_000; // PARAM-074 接続テストの待機上限
const PARAM_008_MS = 2_000; // PARAM-008 音声認識の自動再開までの上限
const weight = (s) => [...String(s)].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.5), 0);
const type = (app, env, ...texts) => { for (const t of texts) { app.setDraft(t); app.submitDraft(); env.tick(1); } };
const texts = (app) => app.getState().utterances.map((u) => u.text);
const cmd = async (app, name) => { const r = app.commands[name](); await flush(); return r; };
const openSettings = async (app) => { app.commands['settings.open'](); await flush(); await app.refreshAzureSpeechStatus(); await flush(); };
async function saveKeyViaSettings(app, { endpoint = DUMMY_ENDPOINT, key } = {}) {
  await openSettings(app);
  app.setAzureSpeechEndpointInput(endpoint);
  if (key !== undefined) app.setAzureSpeechKeyInput(key);
  const r = await app.saveAzureSpeech(); await flush();
  return r;
}
async function confirmDeleteKey(app) {
  await cmd(app, 'azureSpeech.deleteKey');
  assert.equal(app.getDialog()?.kind, 'azure-key-delete', '削除は確認つき');
  await app.dialogAction('confirm'); await flush();
}

// ======================= FR-081 =======================
// FR-081 AC-441
test('FR-081 AC-441: 設定画面に方式（ブラウザ標準／Azure Speech）の選択があり初期値はブラウザ標準。未設定では Azure Speech を選べず理由が示される（異常系）', async () => {
  const { app } = await bootAzure({ configured: false });
  assert.equal(app.getSpeechMethod(), 'browser', '初期値はブラウザ標準');
  await openSettings(app);
  const f = settingsField(app, 'speech.method');
  assert.ok(f, '設定画面に speech.method がある');
  assert.equal(f.value, 'browser');
  const ids = f.options.map((o) => o.id);
  assert.deepEqual([...ids].sort(), ['azure', 'browser']);
  const az = f.options.find((o) => o.id === 'azure');
  assert.equal(az.enabled, false, '未設定では選べない');
  assert.ok(typeof az.reason === 'string' && az.reason.trim().length > 0, '選べない理由が示される');
  const r = app.setSpeechMethod('azure');
  assert.equal(r.ok, false);
  assert.equal(app.getSpeechMethod(), 'browser', '方式は変わらない');
  assert.equal(app.setSpeechMethod('nope').ok, false, '未知の方式は拒否');
  assert.equal(app.getSpeechMethod(), 'browser');
});

test('FR-081 AC-441: 設定済みなら Azure Speech を選べ、方式はブラウザ内に保存されて再読込後に復元。初期化では変わらず、セッションファイルに含まれない', async () => {
  const ctx = await bootAzure({ configured: true });
  const { app, env } = ctx;
  await openSettings(app);
  assert.equal(settingsField(app, 'speech.method').options.find((o) => o.id === 'azure').enabled, true);
  assert.equal(app.setSpeechMethod('azure').ok, true);
  assert.equal(app.getSpeechMethod(), 'azure');
  assert.equal(settingsField(app, 'speech.method').value, 'azure');
  // 再読込（同じ storage）
  const re = await reloadAzure(ctx);
  assert.equal(re.app.getSpeechMethod(), 'azure', '再読込後に復元');
  // データの初期化では変わらない
  re.app.commands['session.start'](); type(re.app, env, '初期化の前の発話');
  await cmd(re.app, 'data.reset'); await re.app.dialogAction('confirm'); await flush();
  assert.equal(re.app.getState().utterances.length, 0, '初期化は行われた');
  assert.equal(re.app.getSpeechMethod(), 'azure', '初期化で方式は変わらない');
  assert.equal(ctx.relay.calls.filter((c) => c.method === 'DELETE').length, 0, '初期化でキーを消さない');
  // セッションファイルに方式を含めない
  re.app.commands['session.start'](); type(re.app, env, 'セッションファイルの発話');
  env.downloads.length = 0;
  await re.app.commands['file.save']();
  const json = env.downloads.find((d) => d.mime === 'application/json');
  assert.ok(json, 'セッションファイルを保存');
  assert.ok(!/azure/i.test(String(json.data)), 'セッションファイルに方式（Azure Speech）の情報がない');
  const other = await bootAzure({ configured: true });
  assert.equal(other.app.getSpeechMethod(), 'browser');
  const lr = await other.app.loadSessionFile({ name: 's.json', type: 'application/json', size: String(json.data).length, text: String(json.data) });
  if (lr && lr.pending) await other.app.dialogAction('confirm');
  await flush();
  assert.equal(other.app.getSpeechMethod(), 'browser', '読込で方式は変わらない');
});

test('FR-081 AC-441: キーを保存すると方式が Azure Speech に切り替わりその旨が表示され、キーを削除するとブラウザ標準に戻る（Q-025 A）', async () => {
  const { app } = await bootAzure({ configured: false });
  const r = await saveKeyViaSettings(app, { key: dummySpeechKey() });
  assert.equal(r.ok, true);
  assert.equal(app.getSpeechMethod(), 'azure', 'キーの保存で Azure Speech に切り替わる');
  assert.match(app.getState().message?.text ?? '', /Azure Speech/, '切り替わった旨が表示される');
  await confirmDeleteKey(app);
  assert.equal(app.getAzureSpeechSettings().keyConfigured, false);
  assert.equal(app.getSpeechMethod(), 'browser', 'キーの削除でブラウザ標準に戻る');
});

test('FR-081 AC-441: 記録中に方式を変えると前の方式は停止し、条件（同意）を満たせば新しい方式で開始。記録中の状態と発話・図は失われない', async () => {
  const { app, env, azure } = await bootAzure({ configured: true, speech: LOCAL });
  app.commands['session.start'](); await flush();
  assert.equal(env.speech.startCalls.length, 1, 'ブラウザ標準（デバイス内）で開始');
  type(app, env, '予算の見直しが必要です', 'コストが高くて困った');
  env.scheduler.advance(3000);
  const svg = app.renderSvg(); const before = texts(app);
  const stops0 = env.speech.stopCalls;
  assert.equal(app.setSpeechMethod('azure').ok, true); await flush();
  assert.ok(env.speech.stopCalls > stops0, 'それまでの方式（ブラウザ標準）は停止する');
  assert.equal(azure.startCalls.length, 0, '未同意なので Azure Speech は開始しない（音声の送信 0 件）');
  assert.equal(app.getState().session, 'recording', '記録中のまま');
  assert.equal(app.getSpeechStatus().state, 'consent', '同意待ち');
  assert.match(app.getState().message?.text ?? '', /同意/);
  assert.deepEqual(texts(app), before); assert.equal(app.renderSvg(), svg, '図は失われない');
  app.setSpeechConsent(true); await flush();
  assert.equal(azure.startCalls.length, 1, '同意すると Azure Speech で開始');
  // ブラウザ標準へ戻す
  const starts = env.speech.startCalls.length;
  assert.equal(app.setSpeechMethod('browser').ok, true); await flush();
  assert.ok(azure.stopCalls >= 1 && azure.active === false, 'Azure Speech は停止する');
  assert.equal(app.getSpeechConsent(), false, '同意は引き継がない');
  assert.equal(env.speech.startCalls.length, starts + 1, 'デバイス内処理のブラウザ標準は同意なしで開始');
  assert.equal(app.getState().session, 'recording');
  assert.deepEqual(texts(app), before);
});

test('FR-081 AC-441 異常系: 方式の切替（選択・キーの保存・キーの削除）とエンドポイントのホストの変更で、同意は引き継がれず未同意に戻る', async () => {
  // (1) ブラウザ標準（外部送信の可能性）で同意済み → 選択で Azure Speech
  {
    const { app, env, azure } = await bootAzure({ configured: true, speech: REMOTE });
    app.commands['session.start'](); app.setSpeechConsent(true); await flush();
    assert.equal(env.speech.startCalls.length, 1);
    app.setSpeechMethod('azure'); await flush();
    assert.equal(app.getSpeechConsent(), false, '選択による切替で未同意');
    assert.equal(azure.startCalls.length, 0, '改めて同意するまで開始しない');
    assert.equal(app.getConsentUi().visible, true);
    assert.match(app.getConsentUi().notice, new RegExp(DUMMY_HOST.replace(/\./g, '\\.')), '切替後の送信先のホスト名が示される');
    // (2) Azure Speech で同意済み → エンドポイントのホストが変わる
    app.setSpeechConsent(true); await flush();
    assert.equal(azure.startCalls.length, 1);
    await saveKeyViaSettings(app, { endpoint: `https://${DUMMY_HOST2}` });
    assert.equal(app.getSpeechConsent(), false, 'ホストの変更で未同意');
    assert.equal(azure.active, false, '変更前の同意で送り続けない');
    assert.equal(azure.startCalls.length, 1, '改めて同意するまで開始しない');
    assert.match(app.getConsentUi().notice, new RegExp(DUMMY_HOST2.replace(/\./g, '\\.')), '新しいホスト名が示される');
    assert.equal(app.getState().session, 'recording');
    // (3) キーの削除でブラウザ標準へ戻る（同意済みでも未同意に戻り、外部送信の可能性があるので開始しない）
    app.setSpeechConsent(true); await flush();
    const bStarts = env.speech.startCalls.length;
    await confirmDeleteKey(app);
    assert.equal(app.getSpeechMethod(), 'browser');
    assert.equal(app.getSpeechConsent(), false, 'キーの削除による戻りで未同意');
    assert.equal(env.speech.startCalls.length, bStarts, '未同意なのでブラウザ標準も開始しない');
    assert.equal(app.getConsentUi().visible, true, '同意のチェックと説明が表示される');
    assert.equal(app.getSpeechStatus().state, 'consent', '同意待ち');
  }
  // (4) キーの保存による自動の切替
  {
    const { app, env, azure } = await bootAzure({ configured: false, speech: REMOTE });
    app.commands['session.start'](); app.setSpeechConsent(true); await flush();
    await saveKeyViaSettings(app, { key: dummySpeechKey() });
    assert.equal(app.getSpeechMethod(), 'azure');
    assert.equal(app.getSpeechConsent(), false, 'キーの保存による切替で未同意');
    assert.equal(azure.startCalls.length, 0);
    assert.ok(env.speech.stopCalls >= 1, 'ブラウザ標準は停止');
  }
});

// FR-081 AC-442
test('FR-081 AC-442: Azure Speech では、デバイス内処理が使えても [記録開始] の直近に同意のチェックと送信先のホスト名の説明が出る', async () => {
  const { app } = await bootAzure({ configured: true, speech: LOCAL });
  app.setSpeechMethod('azure'); await flush();
  const c = app.getConsentUi();
  assert.equal(c.visible, true, 'デバイス内処理の可否によらず表示');
  assert.equal(c.nearCommand, 'session.start');
  assert.equal(c.region, 'top');
  assert.match(c.label, /Azure Speech/); assert.match(c.label, /同意/);
  assert.ok(c.notice.includes(DUMMY_HOST), '送信先のホスト名を表示');
  assert.equal(c.checked, false, '既定は未同意');
  // 方式がブラウザ標準（デバイス内）に戻ると、この同意は出ない（ブラウザ標準の挙動は変えない）
  app.setSpeechMethod('browser'); await flush();
  assert.equal(app.getConsentUi().visible, false);
});

test('FR-081 AC-442: 未同意の間は開始されず同意待ちと同意すれば始まる旨を示し、同意後に上流の確定結果が発話として 1 件追加され PARAM-001 秒以内に図に反映される', async () => {
  const { app, env, azure } = await bootAzure({ configured: true });
  app.setSpeechMethod('azure');
  await cmd(app, 'session.start');
  assert.equal(app.getState().session, 'recording');
  assert.equal(azure.startCalls.length, 0, '未同意では送信 0 件');
  assert.equal(app.getSpeechStatus().state, 'consent');
  assert.equal(app.getSpeechStatus().reason, 'consent');
  assert.match(app.getState().message?.text ?? '', /同意/, '同意すれば始まる旨');
  azure.emit('未同意の間に届いた結果'); await flush();
  assert.equal(app.getState().utterances.length, 0, '未同意の間の結果は発話にならない');
  app.setSpeechConsent(true); await flush();
  assert.equal(azure.startCalls.length, 1);
  assert.equal(azure.startCalls[0].lang, 'ja-JP');
  azure.emit('予算の見直しが必要です'); await flush();
  assert.deepEqual(texts(app), ['予算の見直しが必要です'], '確定結果が発話として 1 件');
  env.scheduler.advance(PARAM.UPPER_SEC * 1000);
  assert.ok(app.renderSvg().includes('予算の見直しが必要です'), 'PARAM-001 秒以内に図へ反映');
});

test('FR-081 AC-442 異常系: 同意は保存されず、再読込後は未同意に戻り開始されない。同意を外すと停止する', async () => {
  const ctx = await bootAzure({ configured: true });
  await startAzureRecording(ctx.app);
  assert.equal(ctx.azure.startCalls.length, 1);
  ctx.app.setSpeechConsent(false); await flush();
  assert.equal(ctx.azure.active, false, '同意を外すと停止');
  assert.equal(ctx.app.getState().session, 'recording');
  ctx.app.setSpeechConsent(true); await flush();
  const re = await reloadAzure(ctx);
  assert.equal(re.app.getSpeechMethod(), 'azure');
  assert.equal(re.app.getSpeechConsent(), false, '再読込後は未同意');
  assert.equal(re.app.getConsentUi().checked, false);
  await cmd(re.app, 'session.resume');
  assert.equal(re.azure.startCalls.length, 0, '復元後の再開も未同意なら開始しない');
});

// FR-081 AC-443（integration。アプリ側: 要求は同一オリジンの中継サーバーだけ・送信 0 件の条件）
test('FR-081 AC-443: Azure Speech で認識中も、アプリはネットワーク API を直接使わず、要求は同一オリジンの中継サーバー（/api/...）だけ', async () => {
  const orig = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, XMLHttpRequest: globalThis.XMLHttpRequest };
  const direct = [];
  globalThis.fetch = async (...a) => { direct.push(['fetch', String(a[0])]); throw new Error('direct fetch'); };
  globalThis.WebSocket = class { constructor(u) { direct.push(['ws', String(u)]); throw new Error('direct ws'); } };
  globalThis.XMLHttpRequest = class { constructor() { direct.push(['xhr']); throw new Error('direct xhr'); } };
  try {
    const { app, env, relay, azure } = await bootAzure({ configured: true });
    await startAzureRecording(app);
    azure.emit('中継の確認'); env.scheduler.advance(3000);
    await openSettings(app); await app.testAzureSpeech(); await flush();
    assert.deepEqual(direct, [], 'アプリ自身は fetch・WebSocket・XHR を使わない（中継は options.relay だけ）');
    assert.ok(relay.calls.length > 0);
    for (const c of relay.calls) assert.match(c.path, /^\/api\//, '同一オリジンの中継サーバーの相対パスだけ');
  } finally { Object.assign(globalThis, orig); }
});

test('FR-081 AC-443 異常系: ブラウザ標準・未同意・準備中・一時停止・停止のときは Azure Speech の音声の送信が 0 件', async () => {
  const { app, env, azure } = await bootAzure({ configured: true });
  // ブラウザ標準
  app.commands['session.start'](); app.setSpeechConsent(true); await flush();
  assert.equal(azure.startCalls.length, 0, 'ブラウザ標準では 0 件');
  await cmd(app, 'session.stop');
  // 準備中（Azure Speech・同意済みでも記録前）
  const b = await bootAzure({ configured: true });
  b.app.setSpeechMethod('azure'); b.app.setSpeechConsent(true); await flush();
  assert.equal(b.app.getState().session, 'preparing');
  assert.equal(b.azure.startCalls.length, 0, '準備中は 0 件');
  await cmd(b.app, 'session.start');
  assert.equal(b.azure.startCalls.length, 1);
  await cmd(b.app, 'session.pause');
  assert.equal(b.azure.active, false, '一時停止で送信を止める');
  b.env.scheduler.advance(10_000);
  assert.equal(b.azure.startCalls.length, 1, '一時停止の間は開始しない');
  await cmd(b.app, 'session.resume');
  assert.equal(b.azure.startCalls.length, 2, '同意済みなら再開で開始');
  await cmd(b.app, 'session.stop');
  assert.equal(b.azure.active, false, '停止で送信を止める');
  b.env.scheduler.advance(10_000);
  assert.equal(b.azure.startCalls.length, 2, '停止の後は開始しない');
  // 未同意
  const c = await bootAzure({ configured: true });
  await startAzureRecording(c.app, { consent: false });
  c.env.scheduler.advance(10_000);
  assert.equal(c.azure.startCalls.length, 0, '未同意は 0 件');
  assert.ok(env);
});

// FR-081 AC-444
for (const code of ['unconfigured', 'auth', 'network']) {
  test(`FR-081 AC-444 異常系(${code}): 失敗で音声認識は停止し理由が示され、記録中のまま発話・図・入力中の内容は失われず、手入力・取込は使え、方式は自動で切り替わらない`, async () => {
    const { app, env, azure } = await bootAzure({ configured: true });
    await startAzureRecording(app);
    type(app, env, '予算の見直しが必要です');
    azure.emit('コストが高くて困った'); await flush();
    env.scheduler.advance(3000);
    app.setDraft('入力中の文字');
    const svg = app.renderSvg(); const before = texts(app);
    azure.fail(code); await flush();
    const s = app.getSpeechStatus();
    assert.equal(s.method, 'azure');
    assert.equal(s.state, 'unavailable', '音声認識は停止');
    assert.equal(s.reason, code, '理由（未設定／認証／接続）');
    assert.ok(s.text.trim().length > 0);
    assert.equal(app.getState().session, 'recording', 'セッションは記録中のまま');
    assert.deepEqual(texts(app), before); assert.equal(app.renderSvg(), svg);
    assert.equal(app.getState().input.draft, '入力中の文字', '入力中の内容は失われない');
    assert.equal(app.getSpeechMethod(), 'azure', 'ブラウザ標準へ自動で切り替えない');
    env.scheduler.advance(30_000);
    assert.equal(azure.startCalls.length, 1, '自動で再試行しない');
    assert.equal(env.speech.startCalls.length, 0, 'ブラウザ標準も自動では開始しない');
    assert.equal(app.submitDraft().ok, true, '手入力は使える');
    const imp = await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: 12, text: '取込の行\n' });
    assert.equal(imp.ok, true, 'ファイル取込は使える');
    assert.ok(texts(app).includes('入力中の文字') && texts(app).includes('取込の行'));
    const cmds = (s.actions ?? []).map((a) => a.command);
    assert.ok(cmds.includes('speech.retryAzure') && cmds.includes('speech.useBrowser'), '状態表示から再試行・ブラウザ標準への切替ができる');
    for (const a of s.actions) assert.ok(a.label && a.label.trim().length > 0);
  });
}

test('FR-081 AC-444: 理由ごとに状態表示の文が異なり、1 回の操作で Azure Speech の再試行ができる', async () => {
  const seen = new Set();
  for (const code of ['unconfigured', 'auth', 'network']) {
    const { app, azure } = await bootAzure({ configured: true });
    await startAzureRecording(app);
    azure.fail(code); await flush();
    seen.add(app.getSpeechStatus().text);
    await cmd(app, 'speech.retryAzure');
    assert.equal(azure.startCalls.length, 2, `再試行で Azure Speech を開始（${code}）`);
  }
  assert.equal(seen.size, 3, '未設定・認証・接続の表示は互いに異なる');
});

test('FR-081 AC-444: 状態表示から 1 回の操作でブラウザ標準へ切り替えられ、切替後は FR-001・FR-072 の条件（同意など）に従う', async () => {
  // デバイス内処理のブラウザ標準 → 同意なしで開始
  {
    const { app, env, azure } = await bootAzure({ configured: true, speech: LOCAL });
    await startAzureRecording(app);
    azure.fail('network'); await flush();
    await cmd(app, 'speech.useBrowser');
    assert.equal(app.getSpeechMethod(), 'browser');
    assert.equal(env.speech.startCalls.length, 1, 'デバイス内なら開始');
    assert.equal(app.getState().session, 'recording');
  }
  // 外部送信の可能性があるブラウザ標準 → 同意待ち（Azure Speech の同意は引き継がない）
  {
    const { app, env, azure } = await bootAzure({ configured: true, speech: REMOTE });
    await startAzureRecording(app);
    azure.fail('auth'); await flush();
    await cmd(app, 'speech.useBrowser');
    assert.equal(app.getSpeechMethod(), 'browser');
    assert.equal(app.getSpeechConsent(), false);
    assert.equal(env.speech.startCalls.length, 0, '未同意なので開始しない');
    assert.equal(app.getSpeechStatus().state, 'consent');
  }
});

// FR-081 AC-445（integration）
test('FR-081 AC-445: 認識の言語は表示言語に一致し、切り替えると次の認識から切替後の言語。途中の結果は暫定で、確定結果だけが発話になる', async () => {
  const { app, env, azure } = await bootAzure({ configured: true });
  await startAzureRecording(app);
  assert.equal(azure.startCalls.at(-1).lang, 'ja-JP');
  azure.emit('予算の見', false); await flush();
  assert.equal(app.getTranscript().interim, '予算の見', '途中の結果は暫定');
  assert.equal(app.getState().utterances.length, 0, '暫定は発話にならない');
  azure.emit('予算の見直し', true); await flush();
  assert.equal(app.getTranscript().interim, null);
  assert.deepEqual(texts(app), ['予算の見直し']);
  const n = azure.startCalls.length;
  app.setLang('en'); await flush();
  await cmd(app, 'session.pause'); await cmd(app, 'session.resume');
  assert.ok(azure.startCalls.length > n);
  for (const c of azure.startCalls.slice(n)) assert.equal(c.lang, 'en-US', '切替後の認識は en-US');
  assert.ok(env);
});

test('FR-081 AC-445: 状態表示は方式を区別し、Azure Speech では 使えます（要同意）・同意待ち・使えません（未設定／認証／接続／マイク拒否）を文字で区別する', async () => {
  const { app } = await bootAzure({ configured: true, speech: LOCAL });
  const browserText = app.getSpeechStatus().text;
  assert.equal(app.getSpeechStatus().method, 'browser');
  assert.ok(!/Azure/.test(browserText), 'ブラウザ標準の表示は Azure Speech と区別される');
  app.setSpeechMethod('azure'); await flush();
  const waiting = app.getSpeechStatus();
  assert.equal(waiting.method, 'azure');
  assert.equal(waiting.state, 'consent');
  assert.match(waiting.text, /同意待ち/);
  app.setSpeechConsent(true); await flush();
  const ok = app.getSpeechStatus();
  assert.equal(ok.state, 'available');
  assert.match(ok.text, /使えます/); assert.match(ok.text, /Azure Speech/);
  assert.equal(app.getCommandBar().status.speech, 'available');
  const fails = {};
  for (const [code, word] of [['unconfigured', '未設定'], ['auth', '認証'], ['network', '接続'], ['mic', 'マイク']]) {
    const b = await bootAzure({ configured: true });
    await startAzureRecording(b.app);
    b.azure.fail(code); await flush();
    const s = b.app.getSpeechStatus();
    assert.equal(s.state, 'unavailable'); assert.equal(s.reason, code);
    assert.match(s.text, /使えません/); assert.ok(s.text.includes(word), `${code} の表示に「${word}」`);
    assert.equal(b.app.getCommandBar().status.speech, 'unavailable');
    fails[code] = s.text;
    b.app.setLang('en'); await flush();
    assert.notEqual(b.app.getSpeechStatus().text, s.text, '表示言語に従う');
  }
  assert.equal(new Set([waiting.text, ok.text, ...Object.values(fails)]).size, 6, '状態の文は互いに異なる');
});

// FR-081 AC-446（integration。アプリ側: 音声を保存しない・非表示でも続く）
test('FR-081 AC-446: Azure Speech でも音声はブラウザ内の保存・セッションファイル・PNG・SVG・PDF に含まれない', async () => {
  const { app, env, azure } = await bootAzure({ configured: true });
  await startAzureRecording(app);
  const MARK = 'AUDIO-BYTES-MARK-7781';
  azure.emit('音声の確認の発話', true, { audio: new Uint8Array(Buffer.from(MARK)), audioBase64: Buffer.from(MARK).toString('base64') });
  await flush(); env.scheduler.advance(3000);
  assert.deepEqual(texts(app), ['音声の確認の発話']);
  await app.commands['file.save'](); await app.commands['save.png'](); await app.commands['save.svg'](); await app.commands['save.pdf']();
  const blobs = [JSON.stringify(env.storage.dump()), ...env.downloads.map((d) => (typeof d.data === 'string' ? d.data : bytesToLatin1(d.data))), env.canvasFactory.log.texts.join('\n')];
  for (const b of blobs) {
    assert.ok(!b.includes(MARK) && !b.includes(Buffer.from(MARK).toString('base64')), '音声の内容が保存物に含まれない');
  }
  const session = env.downloads.find((d) => d.mime === 'application/json');
  assert.ok(session && !/"audio/i.test(session.data), 'セッションファイルに音声の項目がない');
  assert.ok(pdfTexts(env.downloads.find((d) => d.mime === 'application/pdf').data).includes('音声の確認の発話'));
});

test('FR-081 AC-446: 画面が非表示でも記録中かつ同意済みなら Azure Speech の音声認識は続く（NFR-BG-001 は方式によらない）', async () => {
  const visibility = new FakeVisibility();
  const { app, env, azure } = await bootAzure({ configured: true, over: { options: { visibility } } });
  await startAzureRecording(app);
  const stops = azure.stopCalls;
  visibility.set(true); await flush();
  assert.equal(azure.stopCalls, stops, '非表示を理由に止めない');
  assert.equal(azure.active, true);
  azure.emit('非表示の間の発話'); await flush();
  assert.deepEqual(texts(app), ['非表示の間の発話'], '非表示の間も取り込む');
  azure.end('upstream_end'); env.scheduler.advance(PARAM_008_MS);
  assert.equal(azure.startCalls.length, 2, '非表示の間の上流の終了でも再開する');
  visibility.set(false); env.scheduler.advance(2000);
  assert.ok(app.renderSvg().includes('非表示の間の発話'));
});

// FR-081 AC-447（integration。テストのコードがダミーだけを使うことの検査。中継サーバー側は azurespeech-relay.test.js）
test('FR-081 AC-447: Azure Speech のテストのコードは、ダミーのキー・エンドポイントだけを使い、実際の Azure Speech の資源を指さない', () => {
  const dir = path.join(ROOT, 'tests', 'system');
  const files = fs.readdirSync(dir).filter((f) => /^azurespeech.*\.js$/.test(f));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/\b[0-9a-f]{32}\b/i.test(t), `${f} に 32 桁の 16 進（キーの実値らしい文字列）がない`);
    for (const m of t.matchAll(/([a-z0-9-]+)\.cognitiveservices\.azure\.com/gi)) assert.match(m[1], /dummy|example|contoso|your|mock|test|evil/i, `${f}: ${m[0]} はダミーの名前`);
  }
});

// FR-081 AC-458（integration）
for (const reason of ['upstream_end', 'token_expired']) {
  test(`FR-081 AC-458 (a): 上流の正常な終了・トークンの期限切れ（${reason}）では停止の表示をせず、PARAM-008 秒以内に自動で再開し、発話・図・記録中は失われない`, async () => {
    const { app, env, azure } = await bootAzure({ configured: true });
    await startAzureRecording(app);
    azure.emit('予算の見直しが必要です'); await flush(); env.scheduler.advance(3000);
    const svg = app.renderSvg(); const before = texts(app);
    azure.end(reason); await flush();
    assert.notEqual(app.getSpeechStatus().state, 'unavailable', '停止（失敗）の表示をしない');
    env.scheduler.advance(PARAM_008_MS);
    assert.equal(azure.startCalls.length, 2, 'PARAM-008（2 秒）以内に自動で再開');
    assert.equal(azure.startCalls[1].lang, 'ja-JP');
    assert.equal(app.getState().session, 'recording');
    assert.deepEqual(texts(app), before); assert.equal(app.renderSvg(), svg);
    assert.equal(app.getSpeechStatus().state, 'available');
  });
}

test('FR-081 AC-458 (b) 異常系: 再開の試みで認証・接続の失敗が起きたときだけ停止し、それ以上は自動で再試行しない', async () => {
  for (const code of ['auth', 'network']) {
    const { app, env, azure } = await bootAzure({ configured: true });
    await startAzureRecording(app);
    azure.end('token_expired'); env.scheduler.advance(2000);
    assert.equal(azure.startCalls.length, 2);
    azure.fail(code); await flush();
    assert.equal(app.getSpeechStatus().state, 'unavailable');
    assert.equal(app.getSpeechStatus().reason, code);
    azure.end('upstream_end'); env.scheduler.advance(60_000);
    assert.equal(azure.startCalls.length, 2, `失敗（${code}）の後は自動で再試行しない`);
  }
});

test('FR-081 AC-458 (c) 異常系: 停止・一時停止・同意を外した後・方式の切替後には自動の再開をしない', async () => {
  const cases = [
    ['停止', async (app) => cmd(app, 'session.stop')],
    ['一時停止', async (app) => cmd(app, 'session.pause')],
    ['同意を外す', async (app) => { app.setSpeechConsent(false); await flush(); }],
    ['方式の切替', async (app) => { app.setSpeechMethod('browser'); await flush(); }],
  ];
  for (const [name, op] of cases) {
    const { app, env, azure } = await bootAzure({ configured: true, speech: REMOTE });
    await startAzureRecording(app);
    await op(app);
    azure.end('upstream_end'); env.scheduler.advance(10_000);
    assert.equal(azure.startCalls.length, 1, `${name}の後は自動で再開しない`);
  }
});

test('FR-081 AC-458 (d): 一時停止・停止・復元からの再開は AC-394 と同じ（同意済みなら Azure Speech で開始、未同意なら同意待ち）', async () => {
  const ctx = await bootAzure({ configured: true });
  await startAzureRecording(ctx.app);
  ctx.azure.emit('復元の確認'); await flush();
  await cmd(ctx.app, 'session.pause');
  await cmd(ctx.app, 'session.resume');
  assert.equal(ctx.azure.startCalls.length, 2, '同意済みの再開は Azure Speech で開始');
  await cmd(ctx.app, 'session.stop');
  await cmd(ctx.app, 'session.start');
  assert.equal(ctx.azure.startCalls.length, 3, '停止後の再記録も同意済みなら開始');
  const re = await reloadAzure(ctx);
  assert.equal(re.app.getState().session, 'paused', '復元は一時停止');
  await cmd(re.app, 'session.resume');
  assert.equal(re.azure.startCalls.length, 0, '復元直後は未同意なので開始しない');
  assert.equal(re.app.getSpeechStatus().state, 'consent');
  assert.match(re.app.getState().message?.text ?? '', /同意/, '同意すれば始まる旨');
  re.app.setSpeechConsent(true); await flush();
  assert.equal(re.azure.startCalls.length, 1, '同意で開始');
  assert.ok(texts(re.app).includes('復元の確認'));
});

// ======================= FR-082 =======================
// FR-082 AC-448
test('FR-082 AC-448: 設定画面にエンドポイント・書き込み専用のキー（伏せ字）・状態（ホスト名・設定済み／未設定）・保存・削除がある', async () => {
  const { app } = await bootAzure({ configured: false });
  await openSettings(app);
  for (const id of ['azureSpeech.endpoint', 'azureSpeech.key', 'azureSpeech.status', 'azureSpeech.save', 'azureSpeech.delete']) assert.ok(settingsField(app, id), `${id} がある`);
  const key = settingsField(app, 'azureSpeech.key');
  assert.equal(key.input.type, 'password', '入力中の文字は伏せ字');
  assert.equal(key.input.writeOnly, true, '書き込み専用');
  assert.equal(key.status.id, 'unset');
  assert.match(key.status.text, /未設定/);
  assert.match(settingsField(app, 'azureSpeech.status').status.text, /未設定/);
});

test('FR-082 AC-448: 保存でキー欄は空に戻り「設定済み」とホスト名が示され、値は二度と表示されない。新しいキーの保存で置き換わる', async () => {
  const { app, relay } = await bootAzure({ configured: false });
  const k1 = dummySpeechKey();
  await openSettings(app);
  app.setAzureSpeechEndpointInput(DUMMY_ENDPOINT);
  app.setAzureSpeechKeyInput(k1);
  assert.ok(!JSON.stringify(app.getSettingsDialog()).includes(k1), '入力中も値そのものは表示されない（伏せ字）');
  const r = await app.saveAzureSpeech(); await flush();
  assert.equal(r.ok, true);
  const save = relay.calls.filter((c) => c.path === '/api/speech/settings' && c.method === 'POST');
  assert.equal(save.length, 1); assert.equal(save[0].body.key, k1); assert.equal(save[0].body.endpoint, DUMMY_ENDPOINT);
  const key = settingsField(app, 'azureSpeech.key');
  assert.equal(key.input.value, '', 'キー欄は空に戻る');
  assert.equal(key.status.id, 'set'); assert.match(key.status.text, /設定済み/);
  const st = settingsField(app, 'azureSpeech.status').status.text;
  assert.ok(st.includes(DUMMY_HOST) && /設定済み/.test(st), 'ホスト名と設定済み');
  await app.refreshAzureSpeechStatus(); app.commands['settings.close']?.(); await openSettings(app);
  assert.ok(!JSON.stringify(app.getSettingsDialog()).includes(k1), 'キーの値は二度と表示されない');
  // 変更（置き換え）
  const k2 = dummySpeechKey();
  app.setAzureSpeechKeyInput(k2);
  assert.equal((await app.saveAzureSpeech()).ok, true); await flush();
  const save2 = relay.calls.filter((c) => c.path === '/api/speech/settings' && c.method === 'POST');
  assert.equal(save2.length, 2); assert.equal(save2[1].body.key, k2, '新しいキーで置き換える');
  assert.equal(settingsField(app, 'azureSpeech.key').status.id, 'set');
  // エンドポイントだけの保存はキーを送らない
  app.setAzureSpeechEndpointInput(DUMMY_ENDPOINT);
  await app.saveAzureSpeech(); await flush();
  const save3 = relay.calls.filter((c) => c.path === '/api/speech/settings' && c.method === 'POST');
  assert.ok(!('key' in save3[2].body) || save3[2].body.key === undefined, 'キー欄が空ならキーを送らない');
});

test('FR-082 AC-448: 削除は確認つきで（キャンセルでは消えない）、キーが消えて「未設定」になる。データの初期化ではエンドポイントとキーは消えない', async () => {
  const { app, env, relay } = await bootAzure({ configured: true });
  await openSettings(app);
  await cmd(app, 'azureSpeech.deleteKey');
  assert.equal(app.getDialog()?.kind, 'azure-key-delete');
  await app.dialogAction('cancel'); await flush();
  assert.equal(relay.calls.filter((c) => c.method === 'DELETE').length, 0, 'キャンセルでは消えない');
  assert.equal(settingsField(app, 'azureSpeech.key').status.id, 'set');
  // データの初期化
  app.commands['session.start'](); type(app, env, '初期化の対象');
  await cmd(app, 'data.reset'); await app.dialogAction('confirm'); await flush();
  assert.equal(relay.calls.filter((c) => c.method === 'DELETE' || (c.method === 'POST' && c.path === '/api/speech/settings')).length, 0, '初期化は中継サーバーの設定を変えない');
  await app.refreshAzureSpeechStatus(); await openSettings(app);
  assert.equal(settingsField(app, 'azureSpeech.key').status.id, 'set', '初期化後も設定済み');
  assert.ok(settingsField(app, 'azureSpeech.status').status.text.includes(DUMMY_HOST));
  // 削除
  await confirmDeleteKey(app);
  assert.equal(relay.calls.filter((c) => c.method === 'DELETE' && c.path === '/api/speech/key').length, 1);
  assert.equal(settingsField(app, 'azureSpeech.key').status.id, 'unset');
  assert.match(settingsField(app, 'azureSpeech.key').status.text, /未設定/);
});

test('FR-082 AC-448 異常系: 中継サーバーが応答しないときは項目を操作できず、理由が示される', async () => {
  const { app, relay } = await bootAzure({ configured: false, mode: 'offline' });
  await openSettings(app);
  for (const id of ['azureSpeech.endpoint', 'azureSpeech.key', 'azureSpeech.save', 'azureSpeech.delete']) assert.equal(settingsField(app, id).disabled, true, `${id} は操作できない`);
  const st = settingsField(app, 'azureSpeech.status');
  assert.equal(st.status.id, 'unavailable');
  assert.ok(st.status.text.trim().length > 0, '理由が示される');
  const n = relay.calls.length;
  app.setAzureSpeechKeyInput(dummySpeechKey());
  const r = await app.saveAzureSpeech(); await flush();
  assert.equal(r.ok, false);
  assert.equal(settingsField(app, 'azureSpeech.key').input.value, '', '失敗でもキー欄は空');
  assert.ok(relay.calls.length >= n);
  assert.equal(app.getSpeechMethod(), 'browser');
});

test('FR-082 AC-448: キーボードだけで保存・削除・接続テストを行え、ラベルは PARAM-011 以内で表示言語に従い、状態は文字でも示される', async () => {
  const { app, relay } = await bootAzure({ configured: false });
  await openSettings(app);
  app.setAzureSpeechEndpointInput(DUMMY_ENDPOINT); app.setAzureSpeechKeyInput(dummySpeechKey());
  app.focusSettingsField('azureSpeech.save'); app.handleKey({ key: 'Enter' }); await flush(); await flush();
  assert.equal(relay.calls.filter((c) => c.path === '/api/speech/settings').length, 1, 'Enter で保存');
  app.focusSettingsField('azureSpeech.test'); app.handleKey({ key: 'Enter' }); await flush(); await flush();
  assert.equal(relay.calls.filter((c) => c.path === '/api/speech/test').length, 1, 'Enter で接続テスト');
  app.focusSettingsField('azureSpeech.delete'); app.handleKey({ key: 'Enter' }); await flush();
  assert.equal(app.getDialog()?.kind, 'azure-key-delete', 'Enter で削除の確認');
  await app.dialogAction('cancel'); await flush();
  const ids = ['speech.method', 'azureSpeech.endpoint', 'azureSpeech.key', 'azureSpeech.status', 'azureSpeech.save', 'azureSpeech.delete', 'azureSpeech.test'];
  const ja = {};
  for (const id of ids) {
    const f = settingsField(app, id);
    assert.ok(f.label && f.label.trim().length > 0, `${id} にラベル`);
    assert.ok(weight(f.label) <= 6, `${id} のラベル ${f.label} は PARAM-011 以内`);
    assert.ok(f.accessibleName && f.accessibleName.includes(f.label), `${id} は読み上げの対象（アクセシブルな名前）`);
    ja[id] = f.label;
  }
  const setText = settingsField(app, 'azureSpeech.key').status.text;
  app.setLang('en'); await flush();
  for (const id of ids) {
    const f = settingsField(app, id);
    assert.ok(weight(f.label) <= 6, `${id} の英語ラベル ${f.label} は半角 12 文字以内`);
    assert.notEqual(f.label, ja[id], `${id} は表示言語に従う`);
  }
  assert.notEqual(settingsField(app, 'azureSpeech.key').status.text, setText, '状態の文も表示言語に従う');
  for (const id of ['azureSpeech.endpoint', 'azureSpeech.key', 'azureSpeech.save', 'azureSpeech.delete', 'azureSpeech.test']) assert.equal(settingsField(app, id).focusable, true, `${id} はキーボードで到達できる`);
});

// FR-082 AC-449（integration。アプリ側: 拒否の理由を示し、設定は変わらない）
test('FR-082 AC-449 異常系: 中継サーバーがエンドポイントを拒否したとき、理由が示され、保存済みの設定と方式は変わらない', async () => {
  const { app, relay } = await bootAzure({ configured: true, mode: 'invalid' });
  await openSettings(app);
  app.setAzureSpeechEndpointInput('http://evil.example.com');
  app.setAzureSpeechKeyInput(dummySpeechKey());
  const r = await app.saveAzureSpeech(); await flush();
  assert.equal(r.ok, false); assert.equal(r.result, 'invalid');
  assert.ok((app.getState().message?.text ?? '').trim().length > 0, '理由が示される');
  assert.equal(settingsField(app, 'azureSpeech.key').input.value, '', '失敗でもキー欄は空');
  await app.refreshAzureSpeechStatus();
  assert.equal(app.getAzureSpeechSettings().endpointHost, DUMMY_HOST, '保存済みの設定は変わらない');
  assert.equal(relay.host, DUMMY_HOST);
});

// FR-082 AC-450（integration。アプリ側）
test('FR-082 AC-450: 接続テストの成功・失敗の分類が表示され、方式・同意・図は変わらない', async () => {
  for (const [mode, configured, expect] of [['ok', true, 'success'], ['auth', true, 'auth'], ['network', true, 'network'], ['ok', false, 'unconfigured']]) {
    const { app, env } = await bootAzure({ configured, mode });
    app.commands['session.start'](); type(app, env, '接続テストの前');
    env.scheduler.advance(3000);
    const before = [app.getSpeechMethod(), app.getSpeechConsent(), app.renderSvg()];
    await openSettings(app);
    const r = await app.testAzureSpeech(); await flush();
    assert.equal(r.result, expect, `${mode}/${configured} → ${expect}`);
    assert.equal(r.ok, expect === 'success');
    const f = settingsField(app, 'azureSpeech.test');
    assert.equal(f.status.id, expect === 'success' ? 'ok' : expect);
    assert.ok(f.status.text.trim().length > 0);
    assert.deepEqual([app.getSpeechMethod(), app.getSpeechConsent(), app.renderSvg()], before, '方式・同意・図は変わらない');
  }
});

test('FR-082 AC-450 異常系: 中継サーバーが応答しないまま PARAM-074 秒たつとタイムアウトを表示する', async () => {
  const { app, env, relay } = await bootAzure({ configured: true, mode: 'hold' });
  await openSettings(app);
  let done = null;
  const p = app.testAzureSpeech().then((r) => { done = r; });
  await flush();
  env.scheduler.advance(PARAM_074_MS);
  await p; await flush();
  assert.equal(done.result, 'timeout');
  assert.equal(settingsField(app, 'azureSpeech.test').status.id, 'timeout');
  assert.equal(relay.calls.filter((c) => c.path === '/api/speech/test').length, 1);
});

// ======================= NFR-SEC-005 =======================
function surface(app) {
  const parts = [];
  const add = (f) => { try { const v = f(); parts.push(typeof v === 'string' ? v : JSON.stringify(v)); } catch { /* 未実装の観察点は他のテストが検出する */ } };
  add(() => app.getState()); add(() => app.getSettingsDialog()); add(() => app.getSettingsView?.()); add(() => app.getSpeechStatus());
  add(() => app.getConsentUi()); add(() => app.getCommandBar()); add(() => app.getAzureSpeechSettings()); add(() => app.getDialog());
  add(() => app.renderSvg()); add(() => app.renderOutline()); add(() => app.renderTranscript()); add(() => app.getStrings());
  return parts.join('\n');
}

// NFR-SEC-005 AC-452
test('NFR-SEC-005 AC-452: ダミーのキーを保存し、Azure Speech での認識と接続テストの後、DOM 相当・ブラウザ内の保存・セッションファイル・PNG・SVG・PDF・コンソールにキーが含まれない', async () => {
  const key = dummySpeechKey();
  const logs = [];
  const orig = {};
  for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace']) { orig[m] = console[m]; console[m] = (...a) => { logs.push(a.map((x) => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); } }).join(' ')); }; }
  try {
    const ctx = await bootAzure({ configured: false });
    const { app, env, relay, azure } = ctx;
    const r = await saveKeyViaSettings(app, { key });
    assert.equal(r.ok, true);
    assert.equal(app.getSpeechMethod(), 'azure');
    app.commands['session.start'](); app.setSpeechConsent(true); await flush();
    azure.emit('予算の見直しが必要です'); azure.emit('次のリリース計画'); await flush(); env.scheduler.advance(3000);
    assert.equal((await app.testAzureSpeech()).result, 'success');
    await app.commands['file.save'](); await app.commands['save.png'](); await app.commands['save.svg'](); await app.commands['save.pdf']();
    await flush();
    const where = {
      'DOM 相当（画面の状態・設定画面・図・一覧）': surface(app),
      'ブラウザ内の保存': JSON.stringify(env.storage.dump()),
      'エクスポート・セッションファイル': env.downloads.map((d) => (typeof d.data === 'string' ? d.data : bytesToLatin1(d.data))).join('\n') + env.canvasFactory.log.texts.join('\n'),
      'コンソール': logs.join('\n'),
      '保存以外の中継サーバーへの要求': JSON.stringify(relay.calls.filter((c) => !(c.path === '/api/speech/settings' && c.method === 'POST'))),
      'SpeechSource への引数': JSON.stringify([azure.startCalls, env.speech.startCalls]),
    };
    for (const [k, v] of Object.entries(where)) assert.ok(!v.includes(key), `${k} にキーの値が含まれる`);
    assert.equal(env.downloads.length, 4);
    // 再読込後も
    const re = await reloadAzure(ctx);
    await openSettings(re.app);
    assert.ok(!surface(re.app).includes(key), '再読込後の画面にキーが含まれない');
    assert.ok(!logs.join('\n').includes(key), '再読込後もコンソールにキーが出ない');
  } finally { Object.assign(console, orig); }
});

test('NFR-SEC-005 AC-452 異常系: 中継サーバーが誤ってキーらしい値を状態の応答に混ぜても、アプリは表示・保存しない', async () => {
  const probe = 'PROBE-SPEECH-KEY-0000-not-a-real-secret';
  const { app, env } = await bootAzure({ configured: true, leakKey: probe });
  await openSettings(app);
  app.setSpeechMethod('azure'); app.commands['session.start'](); await flush();
  app.setDraft('漏えいの確認'); app.submitDraft(); env.scheduler.advance(3000);
  await app.commands['file.save']();
  const all = [surface(app), JSON.stringify(env.storage.dump()), ...env.downloads.map((d) => String(d.data))].join('\n');
  assert.ok(!all.includes(probe));
});

test('NFR-SEC-005 AC-452: web/ はキーを URL・sessionStorage・IndexedDB・Cookie・履歴に書く経路を持たない（ブラウザ内の保存は options.storage だけ）', () => {
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : files.push(p); } })(WEB);
  for (const f of files.filter((x) => /\.(js|html)$/.test(x))) {
    const t = fs.readFileSync(f, 'utf8');
    for (const pat of [/sessionStorage/, /indexedDB/, /document\.cookie/, /history\.(pushState|replaceState)/, /location\.(hash|search)\s*=/]) assert.ok(!pat.test(t), `${path.relative(ROOT, f)} が ${pat} を使う`);
  }
});

// NFR-SEC-005 AC-457
test('NFR-SEC-005 AC-457: キーの入力欄は自動補完を無効にする指定があり、ユーザー名の欄と組のログインフォームとして構成されない', async () => {
  const { app } = await bootAzure({ configured: false });
  await openSettings(app);
  const key = settingsField(app, 'azureSpeech.key');
  assert.ok(['off', 'new-password'].includes(key.input.autocomplete), '自動補完を無効にする指定');
  const others = app.getSettingsDialog().fields.filter((f) => f.id !== 'azureSpeech.key' && f.input);
  for (const f of others) {
    assert.notEqual(f.input.type, 'email', `${f.id} はユーザー名の欄ではない`);
    assert.ok(!['username', 'email', 'current-password'].includes(f.input.autocomplete), `${f.id} はログインの欄ではない`);
    assert.notEqual(f.input.type, 'password', 'パスワードの欄はキーの 1 つだけ');
  }
  for (const f of fs.readdirSync(WEB, { recursive: true }).map(String).filter((x) => /\.(html|js)$/.test(x))) {
    const t = fs.readFileSync(path.join(WEB, f), 'utf8');
    assert.ok(!/autocomplete\s*[=:]\s*["']?(username|current-password)/i.test(t), `${f} にログインフォームの指定がない`);
  }
});

test('NFR-SEC-005 AC-457 異常系: 保存の操作の後は成功・失敗（拒否・中継サーバーの無応答）によらず入力欄が空に戻り、再読込でも復元されない', async () => {
  for (const mode of ['ok', 'invalid', 'offline']) {
    const ctx = await bootAzure({ configured: false, mode });
    const key = dummySpeechKey();
    await openSettings(ctx.app);
    ctx.app.setAzureSpeechEndpointInput(DUMMY_ENDPOINT);
    ctx.app.setAzureSpeechKeyInput(key);
    await ctx.app.saveAzureSpeech(); await flush();
    assert.equal(settingsField(ctx.app, 'azureSpeech.key').input.value, '', `${mode}: 保存の操作の後は空`);
    assert.ok(!JSON.stringify(ctx.env.storage.dump()).includes(key), `${mode}: ブラウザ内に残さない`);
    const re = await reloadAzure(ctx);
    await openSettings(re.app);
    assert.equal(settingsField(re.app, 'azureSpeech.key').input.value, '', `${mode}: 再読込で復元されない`);
    assert.ok(!surface(re.app).includes(key));
  }
});

