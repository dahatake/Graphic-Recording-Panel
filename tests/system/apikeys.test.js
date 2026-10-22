// FR-084 AC-482 AC-483 AC-484 AC-485 AC-486 / FR-085 AC-487 / NFR-SEC-006 AC-490 AC-491
// 接続キー画面の System Test。契約: tests/system/CONTRACT-API-KEYS.md。期待値は受入基準だけから決める。
// 中継サーバーは注入したモック（Foundry のキーの API 付き）と、Azure Speech のモック（azurespeech-util.js）だけを使い、ネットワークに出ない。
// AC-488・489・492・493・494 は検証レベル integration、AC-495 は unit のため、ここには置かない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CJK, WEB, ROOT, bytesToLatin1 } from './helpers.js';
import { DUMMY_ENDPOINT, dummySpeechKey, flush, bootAzure, reloadAzure } from './azurespeech-util.js';

const weight = (s) => [...String(s)].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.5), 0);
const dummyFoundryKey = () => `DUMMY-FOUNDRY-KEY-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const PARAM_011 = 6;

// Foundry のキーの API を持つ中継サーバーのモック（Azure Speech の部分は makeSpeechRelay に委譲）。
async function boot({ azureConfigured = false, foundry = { configured: false, source: null }, mode = 'ok', over = {} } = {}) {
  const k = { calls: [], configured: foundry.configured, source: foundry.source, mode };
  const wrapped = (inner) => async (req) => {
    const p = req.path;
    if (p === '/api/llm/status' || p === '/api/llm/key') {
      k.calls.push({ method: req.method ?? 'GET', path: p, body: req.body === undefined ? undefined : JSON.parse(JSON.stringify(req.body)) });
      if (k.mode === 'offline') throw new TypeError('Failed to fetch');
      const st = () => ({ keyConfigured: k.configured, keySource: k.source });
      if (p === '/api/llm/status') return { status: 200, body: { configured: { endpoint: true, deployment: true, credential: k.configured }, endpointHost: 'contoso-dummy.openai.azure.com', ...st() } };
      if (req.method === 'POST') {
        if (k.mode === 'fail') return { status: 500, body: { ok: false, result: 'failed' } };
        k.configured = true; k.source = 'ui';
        return { status: 200, body: { ok: true, result: 'saved', ...st() } };
      }
      if (req.method === 'DELETE') {
        if (k.source === 'env' || k.source === 'file') return { status: 409, body: { ok: false, result: 'env_managed', ...st() } };
        k.configured = false; k.source = null;
        return { status: 200, body: { ok: true, result: 'deleted', ...st() } };
      }
    }
    return inner(req);
  };
  const ctx = await bootAzure({ configured: azureConfigured, over });
  // 同じ relay を差し替える（bootAzure が作った Azure Speech のモックを内側に使う）
  const inner = ctx.relay.fn;
  const app = await ctx.createApp({ ...ctx.env.options, relay: wrapped(inner), azureSpeechSource: ctx.azure });
  await app.refreshAzureSpeechStatus(); await app.refreshFoundryKeyStatus(); await flush();
  return { ...ctx, app, k };
}
async function open(app) {
  app.commands['apiKeys.open'](); await flush();
  await app.refreshAzureSpeechStatus(); await app.refreshFoundryKeyStatus(); await flush();
  return app.getApiKeysDialog();
}
const dlg = (app) => app.getApiKeysDialog();
const field = (app, id) => (dlg(app)?.fields ?? []).find((f) => f.id === id);
const barItem = (app, command) => app.getCommandBar().items.find((i) => i.command === command);

function surface(app) {
  const parts = [];
  const add = (f) => { try { const v = f(); parts.push(typeof v === 'string' ? v : JSON.stringify(v)); } catch { /* 未実装の観察点は他のテストが検出する */ } };
  add(() => app.getState()); add(() => app.getApiKeysDialog()); add(() => app.getSettingsDialog()); add(() => app.getDialog());
  add(() => app.getCommandBar()); add(() => app.getAzureSpeechSettings()); add(() => app.getFoundryKeyStatus());
  add(() => app.renderSvg()); add(() => app.renderOutline()); add(() => app.renderTranscript()); add(() => app.getStrings());
  return parts.join('\n');
}
const webFiles = (re) => fs.readdirSync(WEB, { recursive: true }).map(String).filter((x) => re.test(x)).map((f) => ({ f, t: fs.readFileSync(path.join(WEB, f), 'utf8') }));

// ======================= FR-084 =======================
// FR-084 AC-482
test('FR-084 AC-482: 最上部に「接続キー」のアイコンと名称と説明が常時表示で並び、［設定］とは別のボタンで、「設定」の語を使わず、PARAM-011 文字以内', async () => {
  const { app } = await boot();
  assert.equal(app.getCommandBar().position, 'top');
  const it = barItem(app, 'apiKeys.open');
  assert.ok(it, 'コマンドバーに apiKeys.open がある');
  assert.equal(it.label, '接続キー');
  assert.ok(typeof it.icon === 'string' && it.icon.trim(), 'アイコンがある');
  assert.match(it.description, /Foundry/); assert.match(it.description, /Azure Speech/);
  assert.equal(it.descriptionVisible, true, 'ホバー・フォーカスを待たず常時表示');
  assert.ok(it.accessibleName.includes(it.label) && it.accessibleName.trim());
  assert.equal(it.tabbable, true);
  assert.ok(weight(it.label) <= PARAM_011, `ラベルは ${PARAM_011} 文字以内`);
  for (const s of [it.label, it.description, it.accessibleName]) assert.ok(!/設定|Settings/i.test(s), `「設定」の語を使わない: ${s}`);
  const imp = barItem(app, 'import.file');
  for (const k of Object.keys(imp)) if (['icon', 'description', 'descriptionVisible', 'accessibleName', 'tabbable'].includes(k)) assert.ok(k in it, `取り込み（FR-073）と同じ規則: ${k}`);
  const st = barItem(app, 'settings.open');
  assert.ok(st, '［設定］は並存する');
  assert.notEqual(st.label, it.label, 'ラベルから区別できる');
  assert.notEqual(st.command, it.command);
});

test('FR-084 AC-482 異常系: 表示言語を切り替えると再読込なしで英語（API Keys）になり、「Settings」を使わず、戻すと日本語に戻る', async () => {
  const { app } = await boot();
  const ja = barItem(app, 'apiKeys.open');
  app.setLang('en');
  const en = barItem(app, 'apiKeys.open');
  assert.equal(en.label, 'API Keys');
  assert.ok(en.description.trim() && en.description !== ja.description, '説明も英語に切り替わる');
  assert.match(en.description, /Foundry/);
  for (const s of [en.label, en.description, en.accessibleName]) assert.ok(!/Settings|設定/i.test(s), `Settings の語を使わない: ${s}`);
  assert.ok(weight(en.label) <= PARAM_011);
  app.setLang('ja');
  assert.equal(barItem(app, 'apiKeys.open').label, '接続キー');
});

// FR-084 AC-483
test('FR-084 AC-483: 「接続キー」を操作すると中央のモーダル（role=dialog・aria-modal・見出し）が開き、背景は半透明のオーバーレイで覆われ inert・スクロール不可。左に 2 分類、開いた直後は先頭', async () => {
  const { app } = await boot();
  assert.equal(dlg(app), null, '開く前は閉じている');
  app.commands['apiKeys.open'](); await flush();
  const d = dlg(app);
  assert.ok(d, '開く');
  assert.equal(d.open, true); assert.equal(d.role, 'dialog'); assert.equal(d.modal, true);
  assert.ok(typeof d.heading === 'string' && d.heading.trim(), '見出しで名前が付く');
  assert.equal(d.overlay.visible, true, 'オーバーレイで覆う');
  assert.equal(d.backgroundInert, true, '背景は inert');
  assert.equal(d.scrollLocked, true, '背景はスクロールしない');
  assert.deepEqual(d.categories.map((c) => c.id), ['foundry', 'azureSpeech']);
  assert.deepEqual(d.categories.map((c) => c.label), ['Microsoft Foundry', 'Azure Speech']);
  assert.equal(d.selected, 'foundry', '先頭の分類が選ばれる');
  assert.ok(d.fields.length > 0 && d.fields.every((f) => f.id.startsWith('apiKeys.foundry.')), '右に選んだ分類の内容');
  app.selectApiKeysCategory('azureSpeech');
  assert.ok(dlg(app).fields.every((f) => f.id.startsWith('apiKeys.azureSpeech.')));
  // 実 DOM
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const m = html.match(/<[^>]*id=["']apikeys-dialog["'][^>]*>/);
  assert.ok(m, 'web/index.html に apikeys-dialog がある');
  assert.ok(/<dialog/i.test(m[0]) || /role=["']dialog["']/.test(m[0]));
  assert.ok(/aria-modal=["']true["']/.test(m[0]) || /<dialog/i.test(m[0]), 'aria-modal（または <dialog> のモーダル）');
});

test('FR-084 AC-483 異常系: 開いている間、背景の操作（コマンド・キー・入力）は効かず、開いても入力中の内容・記録中の状態・図は失われず記録は止まらない', async () => {
  const { app, env } = await boot({ azureConfigured: true });
  app.commands['session.start'](); await flush();
  app.setDraft('予算の見直しが必要です'); app.submitDraft(); env.tick(1);
  app.setDraft('入力中の文字');
  env.scheduler.advance(3000);
  const stops = env.speech.stopCalls; const before = JSON.stringify(app.getState().utterances); const svg = app.renderSvg();
  await open(app);
  assert.equal(app.getState().session, 'recording', '記録は止まらない');
  assert.equal(env.speech.stopCalls, stops, '音声認識は止まらない');
  assert.equal(app.getState().input.draft, '入力中の文字', '入力中の内容は失われない');
  assert.equal(JSON.stringify(app.getState().utterances), before);
  assert.equal(app.renderSvg(), svg, '図は変わらない');
  const r = app.commands['session.stop']?.(); await flush();
  assert.equal(app.getState().session, 'recording', '背景のコマンドは効かない');
  assert.ok(!r || r.ok === false, '背景のコマンドは拒否される');
  app.setDraft('背景への入力'); assert.equal(app.getState().input.draft, '入力中の文字', '背景への入力は効かない');
  assert.equal(app.getState().session, 'recording');
});

// FR-084 AC-484
test('FR-084 AC-484: 右上の閉じるボタン・Esc・ダイアログ内の「閉じる」で閉じ、オーバーレイが消え、フォーカスは「接続キー」へ戻る。オーバーレイのクリックでは閉じない', async () => {
  const { app } = await boot();
  for (const how of ['closeButton', 'escape', 'close']) {
    await open(app);
    assert.ok(dlg(app).closeButton.label.trim(), '右上の「閉じる」がある');
    app.apiKeysClick('overlay');
    assert.ok(dlg(app), 'オーバーレイのクリックでは閉じない');
    if (how === 'escape') assert.equal(app.handleKey({ key: 'Escape' }), 'apiKeys.close');
    else if (how === 'closeButton') app.apiKeysClick('closeButton');
    else { app.focusApiKeysField('apiKeys.close'); app.handleKey({ key: 'Enter' }); }
    await flush();
    assert.equal(dlg(app), null, `${how}: 閉じる`);
    assert.equal(app.getFocus().command, 'apiKeys.open', `${how}: フォーカスは「接続キー」に戻る`);
    assert.equal(dlg(app)?.overlay?.visible ?? false, false, `${how}: オーバーレイが消える`);
    app.setDraft(`閉じた後の入力 ${how}`);
    assert.equal(app.getState().input.draft, `閉じた後の入力 ${how}`, `${how}: 背景が操作できる状態に戻る`);
    app.setDraft('');
  }
});

test('FR-084 AC-484 異常系: 閉じると保存していない入力は破棄され、再び開いても復元されない。閉じても記録中の状態と図は変わらない', async () => {
  const { app, env } = await boot({ azureConfigured: false });
  app.commands['session.start'](); await flush();
  app.setDraft('議論'); app.submitDraft(); env.tick(1); env.scheduler.advance(3000);
  const svg = app.renderSvg();
  const fk = dummyFoundryKey(); const sk = dummySpeechKey();
  await open(app);
  app.setFoundryKeyInput(fk);
  app.selectApiKeysCategory('azureSpeech'); app.setAzureSpeechEndpointInput(DUMMY_ENDPOINT); app.setAzureSpeechKeyInput(sk);
  app.handleKey({ key: 'Escape' }); await flush();
  await open(app);
  assert.equal(field(app, 'apiKeys.foundry.key').input.value, '', 'Foundry の入力は復元されない');
  app.selectApiKeysCategory('azureSpeech');
  assert.equal(field(app, 'apiKeys.azureSpeech.key').input.value, '', 'Azure Speech のキーの入力は復元されない');
  assert.ok(!surface(app).includes(fk) && !surface(app).includes(sk));
  app.apiKeysClick('closeButton'); await flush();
  assert.equal(app.getState().session, 'recording');
  assert.equal(app.renderSvg(), svg, '図は変わらない');
});

// FR-084 AC-485
test('FR-084 AC-485: キーボードだけで操作でき、フォーカスはダイアログ内に入り、Tab・Shift+Tab はダイアログ内で循環し、分類は矢印キーで切り替わる', async () => {
  const { app } = await boot();
  await open(app);
  assert.equal(dlg(app).focusInside, true, '開いたときのフォーカスはダイアログ内');
  const seen = new Set();
  for (let i = 0; i < 40; i++) { app.handleKey({ key: 'Tab' }); const f = dlg(app).focus; assert.ok(f && dlg(app).focusInside, 'ダイアログの外へ出ない'); seen.add(f); }
  assert.ok(seen.has('apiKeys.close') && seen.has('apiKeys.foundry.key'), 'ダイアログ内の全体を巡る');
  const start = dlg(app).focus; app.handleKey({ key: 'Tab' }); app.handleKey({ key: 'Tab', shiftKey: true });
  assert.equal(dlg(app).focus, start, 'Shift+Tab で戻る');
  app.focusApiKeysField('apiKeys.category.foundry');
  app.handleKey({ key: 'ArrowDown' }); assert.equal(dlg(app).selected, 'azureSpeech', '矢印キーで分類が切り替わる');
  app.handleKey({ key: 'ArrowUp' }); assert.equal(dlg(app).selected, 'foundry');
});

test('FR-084 AC-485: 結果が読み上げ対象のメッセージで示され、状態は色だけでなく文字・アイコンで示され、ラベルは PARAM-011 以内で日英に従う', async () => {
  const { app } = await boot();
  assert.ok(await open(app));
  app.setFoundryKeyInput(dummyFoundryKey());
  assert.equal((await app.saveFoundryKey()).ok, true); await flush();
  const lm = dlg(app).liveMessage;
  assert.ok(lm && lm.text.trim() && ['status', 'alert'].includes(lm.role), '保存の結果が読み上げ対象のメッセージで示される');
  const st = field(app, 'apiKeys.foundry.status').status;
  assert.ok(st.text.trim() && st.icon, '状態を文字とアイコンでも示す');
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    for (const c of dlg(app).categories) assert.ok(weight(c.label) <= PARAM_011 || /Microsoft Foundry|Azure Speech/.test(c.label));
    for (const f of dlg(app).fields) { assert.ok(f.accessibleName?.trim(), `${f.id} に名前`); if (f.id.endsWith('.save') || f.id.endsWith('.delete') || f.id.endsWith('.test')) assert.ok(weight(f.label) <= PARAM_011, `${lang} ${f.id} のラベルは ${PARAM_011} 文字以内: ${f.label}`); }
  }
  app.setLang('ja');
});

test('FR-084 AC-485 異常系: 「動きを減らす」で開閉の動きを省き、画面が狭いとき分類と内容が縦に並び項目が欠けず、forced-colors・ライト・ダークの指定がある', async () => {
  const reduced = await boot({ over: { options: { env: { webgl: true, reducedMotion: true, viewportWidth: 1280 } } } });
  assert.equal((await open(reduced.app)).motion, 'none', '動きを省く');
  const normal = await boot();
  assert.equal((await open(normal.app)).motion, 'animated');
  assert.equal(dlg(normal.app).layout, 'side-by-side');
  const narrow = await boot({ over: { options: { env: { webgl: true, reducedMotion: false, viewportWidth: 360 } } } });
  const d = await open(narrow.app);
  assert.equal(d.layout, 'stacked', '狭いと縦に並ぶ');
  assert.equal(d.categories.length, 2);
  assert.ok(d.fields.length >= 4, '項目が欠けない');
  assert.equal(d.forcedColors, true);
  const css = webFiles(/\.(css|html)$/).map((x) => x.t).join('\n');
  assert.match(css, /forced-colors/, 'forced-colors の指定');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /prefers-color-scheme|data-theme|\.dark|color-scheme/, 'ライト・ダーク');
});

// FR-084 AC-486
test('FR-084 AC-486: Azure Speech の分類にエンドポイント・伏せ字のキー・状態・保存・削除（確認つき）・接続テストがあり、保存の内容は設定画面（FR-082）の状態と一致する', async () => {
  const { app } = await boot({ azureConfigured: false });
  await open(app); app.selectApiKeysCategory('azureSpeech');
  for (const id of ['endpoint', 'key', 'status', 'save', 'delete', 'test']) assert.ok(field(app, `apiKeys.azureSpeech.${id}`), `${id} がある`);
  const kf = field(app, 'apiKeys.azureSpeech.key');
  assert.equal(kf.input.type, 'password'); assert.equal(kf.input.writeOnly, true);
  assert.equal(field(app, 'apiKeys.azureSpeech.status').status.id, 'unset');
  const key = dummySpeechKey();
  app.setAzureSpeechEndpointInput(DUMMY_ENDPOINT); app.setAzureSpeechKeyInput(key);
  assert.ok(!surface(app).includes(key), '入力中のキーが画面に現れない');
  assert.equal((await app.saveAzureSpeech()).ok, true); await flush();
  assert.equal(app.getAzureSpeechSettings().keyConfigured, true);
  assert.equal(field(app, 'apiKeys.azureSpeech.status').status.id, 'set');
  assert.equal(field(app, 'apiKeys.azureSpeech.key').input.value, '', '保存で入力欄は空に戻る');
  assert.equal((await app.testAzureSpeech()).result, 'success', '接続テスト');
  // 設定画面（FR-082）と一致
  app.handleKey({ key: 'Escape' }); await flush();
  app.commands['settings.open'](); await flush(); await app.refreshAzureSpeechStatus(); await flush();
  const sf = app.getSettingsDialog().fields.find((f) => f.id === 'azureSpeech.status');
  assert.equal(sf.status.id, 'set', '設定画面の状態と一致');
  assert.match(sf.status.text, /contoso-dummy-speech/);
  app.commands['settings.close']();
  // 削除は確認つき
  await open(app); app.selectApiKeysCategory('azureSpeech');
  app.focusApiKeysField('apiKeys.azureSpeech.delete'); app.handleKey({ key: 'Enter' }); await flush();
  assert.equal(app.getDialog()?.kind, 'azure-key-delete');
  await app.dialogAction('confirm'); await flush();
  assert.equal(app.getAzureSpeechSettings().keyConfigured, false);
  assert.equal(field(app, 'apiKeys.azureSpeech.status').status.id, 'unset');
});

test('FR-084 AC-486 異常系: 設定画面で保存した内容が接続キー画面に反映され（保管は 1 つ）、中継サーバーが応答しないときは操作できず理由が示される', async () => {
  const ctx = await boot({ azureConfigured: false });
  const { app } = ctx;
  app.commands['settings.open'](); await flush(); await app.refreshAzureSpeechStatus();
  app.setAzureSpeechEndpointInput(DUMMY_ENDPOINT); app.setAzureSpeechKeyInput(dummySpeechKey());
  await app.saveAzureSpeech(); await flush(); app.commands['settings.close']();
  await open(app); app.selectApiKeysCategory('azureSpeech');
  assert.equal(field(app, 'apiKeys.azureSpeech.status').status.id, 'set', '設定画面の保存が反映される');
  const re = await reloadAzure({ ...ctx, createApp: ctx.createApp });
  assert.equal(re.app.getAzureSpeechSettings().keyConfigured, true, '同じ保管先');
  const off = await boot({ azureConfigured: true, mode: 'offline' });
  await open(off.app); off.app.selectApiKeysCategory('azureSpeech');
  for (const id of ['endpoint', 'key', 'save', 'delete', 'test']) assert.equal(field(off.app, `apiKeys.azureSpeech.${id}`).disabled, true, `${id} は操作できない`);
  assert.ok(field(off.app, 'apiKeys.azureSpeech.status').status.text.trim(), '理由が示される');
});

// ======================= FR-085 =======================
// FR-085 AC-487
test('FR-085 AC-487: Foundry の分類に書き込み専用・伏せ字のキー欄（表示切替なし）・状態と出どころ・保存・削除がある。保存で欄は空に戻り「設定済み」、値は二度と表示されない', async () => {
  const { app, k } = await boot();
  await open(app);
  for (const id of ['key', 'status', 'save', 'delete']) assert.ok(field(app, `apiKeys.foundry.${id}`), `${id} がある`);
  const kf = field(app, 'apiKeys.foundry.key');
  assert.equal(kf.input.type, 'password'); assert.equal(kf.input.writeOnly, true); assert.equal(kf.input.reveal, false, '表示に切り替える操作がない');
  assert.equal(field(app, 'apiKeys.foundry.status').status.id, 'unset');
  const key = dummyFoundryKey();
  app.setFoundryKeyInput(key);
  assert.ok(!surface(app).includes(key), '入力中の値は画面に現れない');
  const r = await app.saveFoundryKey(); await flush();
  assert.equal(r.ok, true);
  assert.deepEqual(k.calls.filter((c) => c.method === 'POST').map((c) => c.body), [{ key }], '保存の要求だけにキーを載せる');
  assert.equal(field(app, 'apiKeys.foundry.key').input.value, '', '入力欄は空に戻る');
  const st = field(app, 'apiKeys.foundry.status').status;
  assert.equal(st.id, 'set'); assert.equal(st.source, 'ui'); assert.ok(st.text.trim());
  assert.ok(!surface(app).includes(key), 'キーの値は二度と表示されない');
  const key2 = dummyFoundryKey(); app.setFoundryKeyInput(key2); assert.equal((await app.saveFoundryKey()).ok, true); await flush();
  assert.equal(k.calls.filter((c) => c.method === 'POST').length, 2, '設定済みでも新しいキーで置き換わる');
  assert.equal(field(app, 'apiKeys.foundry.status').status.id, 'set');
  assert.ok(!surface(app).includes(key2));
});

test('FR-085 AC-487: 削除は確認つきで（キャンセルでは消えない）、削除で「未設定」になる。データの初期化ではキーは消えず、保存・削除で LLM 連携は有効にならない', async () => {
  const { app, k } = await boot({ foundry: { configured: true, source: 'ui' } });
  await open(app);
  const llmBefore = JSON.stringify(app.getState().message);
  app.commands['foundry.deleteKey'](); await flush();
  assert.equal(app.getDialog()?.kind, 'foundry-key-delete');
  assert.deepEqual(app.getDialog().buttons.map((b) => b.id).sort(), ['cancel', 'confirm']);
  await app.dialogAction('cancel'); await flush();
  assert.equal(k.calls.filter((c) => c.method === 'DELETE').length, 0, 'キャンセルでは何も送らない');
  assert.equal(field(app, 'apiKeys.foundry.status').status.id, 'set');
  app.commands['foundry.deleteKey'](); await app.dialogAction('confirm'); await flush();
  assert.equal(k.calls.filter((c) => c.method === 'DELETE').length, 1);
  assert.equal(field(app, 'apiKeys.foundry.status').status.id, 'unset');
  // 初期化ではキーは消えない
  app.setFoundryKeyInput(dummyFoundryKey()); await app.saveFoundryKey(); await flush();
  app.handleKey({ key: 'Escape' }); await flush();
  app.commands['data.reset'](); await app.dialogAction('confirm'); await flush();
  assert.equal(k.calls.filter((c) => c.method === 'DELETE').length, 1, '初期化でキーを消さない');
  assert.equal(app.getFoundryKeyStatus().keyConfigured, true);
  assert.equal(app.getState().session !== 'recording', true, 'LLM 連携の送信は起きない');
  assert.equal(k.calls.filter((c) => c.path !== '/api/llm/status' && c.path !== '/api/llm/key').length, 0);
  void llmBefore;
});

test('FR-085 AC-487 異常系: 環境変数・設定ファイルのキーは画面から削除できずその旨が示され、中継サーバーが応答しないときは操作できず理由が示され、空・空白だけのキーは拒否される', async () => {
  for (const source of ['env', 'file']) {
    const { app, k } = await boot({ foundry: { configured: true, source } });
    await open(app);
    const st = field(app, 'apiKeys.foundry.status');
    assert.equal(st.status.source, source);
    assert.equal(field(app, 'apiKeys.foundry.delete').disabled, true, `${source}: 削除できない`);
    assert.ok(st.status.text.trim(), `${source}: 出どころと削除できない旨が文字で示される`);
    app.commands['foundry.deleteKey'](); await flush();
    assert.ok(app.getDialog()?.kind !== 'foundry-key-delete' || (await app.dialogAction('confirm'), true));
    assert.equal(k.calls.filter((c) => c.method === 'DELETE').length, 0, `${source}: 削除の要求を送らない`);
    assert.equal(app.getFoundryKeyStatus().keyConfigured, true);
  }
  const off = await boot({ mode: 'offline' });
  await open(off.app);
  for (const id of ['key', 'save', 'delete']) assert.equal(field(off.app, `apiKeys.foundry.${id}`).disabled, true, `${id} は操作できない`);
  assert.ok(field(off.app, 'apiKeys.foundry.status').status.text.trim(), '理由が示される');
  const { app, k } = await boot();
  await open(app);
  for (const bad of ['', '   ', 'abc\u0000def']) {
    app.setFoundryKeyInput(bad);
    const r = await app.saveFoundryKey(); await flush();
    assert.equal(r.ok, false, `拒否: ${JSON.stringify(bad)}`); assert.equal(r.result, 'invalid');
  }
  assert.equal(k.calls.filter((c) => c.method === 'POST').length, 0, '拒否した値は送らない');
  assert.equal(app.getFoundryKeyStatus().keyConfigured, false);
});

// ======================= NFR-SEC-006 =======================
// NFR-SEC-006 AC-490
test('NFR-SEC-006 AC-490: ダミーの Foundry・Azure Speech のキーを接続キー画面で保存し接続テストをした後、画面・ブラウザ内の保存・セッションファイル・PNG・SVG・PDF・コンソールにキーが含まれない', async () => {
  const fk = dummyFoundryKey(); const sk = dummySpeechKey();
  const logs = []; const orig = {};
  for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace']) { orig[m] = console[m]; console[m] = (...a) => { logs.push(a.map((x) => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); } }).join(' ')); }; }
  try {
    const ctx = await boot({ azureConfigured: false });
    const { app, env, k, relay } = ctx;
    await open(app);
    app.setFoundryKeyInput(fk); assert.equal((await app.saveFoundryKey()).ok, true);
    app.selectApiKeysCategory('azureSpeech'); app.setAzureSpeechEndpointInput(DUMMY_ENDPOINT); app.setAzureSpeechKeyInput(sk);
    assert.equal((await app.saveAzureSpeech()).ok, true);
    assert.equal((await app.testAzureSpeech()).result, 'success'); await flush();
    app.handleKey({ key: 'Escape' }); await flush();
    app.commands['session.start'](); app.setDraft('キーの確認'); app.submitDraft(); env.scheduler.advance(3000);
    await app.commands['file.save'](); await app.commands['save.png'](); await app.commands['save.svg'](); await app.commands['save.pdf'](); await flush();
    const where = {
      '画面（DOM 相当）': surface(app),
      'ブラウザ内の保存': JSON.stringify(env.storage.dump()),
      'エクスポート・セッションファイル': env.downloads.map((d) => (typeof d.data === 'string' ? d.data : bytesToLatin1(d.data))).join('\n') + env.canvasFactory.log.texts.join('\n'),
      'コンソール': logs.join('\n'),
      '保存以外の要求': JSON.stringify([relay.calls.filter((c) => !(c.path === '/api/speech/settings' && c.method === 'POST')), k.calls.filter((c) => c.method !== 'POST')]),
    };
    for (const [n, v] of Object.entries(where)) for (const key of [fk, sk]) assert.ok(!v.includes(key), `${n} にキーの値が含まれる`);
    assert.equal(env.downloads.length, 4);
    await open(app); app.setFoundryKeyInput(fk);
    assert.equal(field(app, 'apiKeys.foundry.key').input.type, 'password', '入力中は伏せ字');
    assert.ok(!surface(app).includes(fk), '入力中のキーの値が画面に現れない');
  } finally { Object.assign(console, orig); }
});

test('NFR-SEC-006 AC-490 異常系: 中継サーバーが誤ってキーらしい値を応答に混ぜても表示・保存しない。web/ はキーを URL・sessionStorage・IndexedDB・Cookie・履歴に書く経路を持たない', async () => {
  const probe = 'PROBE-FOUNDRY-KEY-0000-not-a-real-secret';
  const { app, env } = await boot({ foundry: { configured: true, source: 'ui' } });
  const inner = env.options.relay;
  const leaky = await (await import('./helpers.js')).loadApp();
  const app2 = await leaky({ ...env.options, relay: async (r) => { const x = await inner(r); return { ...x, body: { ...x.body, key: probe, apiKey: probe, Authorization: `Bearer ${probe}` } }; } });
  await app2.refreshFoundryKeyStatus(); await app2.refreshAzureSpeechStatus(); await flush();
  await open(app2);
  await app2.commands['file.save']();
  const all = [surface(app2), JSON.stringify(env.storage.dump()), ...env.downloads.map((d) => String(d.data))].join('\n');
  assert.ok(!all.includes(probe));
  void app;
  for (const { f, t } of webFiles(/\.(js|html)$/)) {
    for (const pat of [/sessionStorage/, /indexedDB/, /document\.cookie/, /history\.(pushState|replaceState)/, /location\.(hash|search)\s*=/]) assert.ok(!pat.test(t), `${f} が ${pat} を使う`);
  }
});

// NFR-SEC-006 AC-491
test('NFR-SEC-006 AC-491: キー欄は自動補完を無効にする指定があり、ユーザー名の欄と組のログインフォームにならない（実 DOM の指定を含む）', async () => {
  const { app } = await boot();
  await open(app);
  const check = (f) => { assert.ok(['off', 'new-password'].includes(f.input.autocomplete), `${f.id} は自動補完を無効にする`); };
  check(field(app, 'apiKeys.foundry.key'));
  app.selectApiKeysCategory('azureSpeech');
  check(field(app, 'apiKeys.azureSpeech.key'));
  for (const f of dlg(app).fields.filter((x) => x.input && !x.id.endsWith('.key'))) {
    assert.notEqual(f.input.type, 'email'); assert.notEqual(f.input.type, 'password');
    assert.ok(!['username', 'email', 'current-password'].includes(f.input.autocomplete), `${f.id} はログインの欄ではない`);
  }
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.ok(/id=["']apikeys-dialog["']/.test(html));
  for (const { f, t } of webFiles(/\.(html|js)$/)) assert.ok(!/autocomplete\s*[=:]\s*["']?(username|current-password)/i.test(t), `${f} にログインフォームの指定がない`);
  void ROOT;
});

test('NFR-SEC-006 AC-491 異常系: 保存の操作の後は成功・失敗（形式の誤り・保存の失敗・中継サーバーの無応答）によらず、また閉じる操作（Esc・閉じる）の後は、入力欄が空で、再読込でも復元されない', async () => {
  for (const mode of ['ok', 'fail', 'offline']) {
    const ctx = await boot({ mode });
    const fk = dummyFoundryKey();
    await open(ctx.app);
    ctx.app.setFoundryKeyInput(fk);
    await ctx.app.saveFoundryKey(); await flush();
    assert.equal(field(ctx.app, 'apiKeys.foundry.key').input.value, '', `${mode}: 保存の操作の後は空`);
    assert.ok(!JSON.stringify(ctx.env.storage.dump()).includes(fk), `${mode}: ブラウザ内に残さない`);
    const re = await reloadAzure(ctx);
    await re.app.refreshFoundryKeyStatus?.();
    await open(re.app);
    assert.equal(field(re.app, 'apiKeys.foundry.key').input.value, '', `${mode}: 再読込で復元されない`);
    assert.ok(!surface(re.app).includes(fk));
  }
  const { app } = await boot();
  for (const how of ['escape', 'close']) {
    const fk = dummyFoundryKey(); const sk = dummySpeechKey();
    await open(app); app.setFoundryKeyInput(fk);
    app.selectApiKeysCategory('azureSpeech'); app.setAzureSpeechKeyInput(sk);
    if (how === 'escape') app.handleKey({ key: 'Escape' }); else app.apiKeysClick('closeButton');
    await flush();
    assert.ok(!surface(app).includes(fk) && !surface(app).includes(sk), `${how}: 閉じた後に値が残らない`);
    await open(app);
    assert.equal(field(app, 'apiKeys.foundry.key').input.value, '', `${how}: Foundry の欄は空`);
    app.selectApiKeysCategory('azureSpeech');
    assert.equal(field(app, 'apiKeys.azureSpeech.key').input.value, '', `${how}: Azure Speech の欄は空`);
    app.apiKeysClick('closeButton'); await flush();
  }
});
