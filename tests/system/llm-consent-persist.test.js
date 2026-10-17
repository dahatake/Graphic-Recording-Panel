// FR-062 AC-311 AC-312 AC-366 AC-367 / NFR-PRIV-003 AC-358 AC-359 AC-360 / FR-065 AC-334（System Test。契約: CONTRACT-LLM-FR062.md と CONTRACT-LLM-CONSENT.md）
// 期待値は受入基準だけから決める。実 Foundry は呼ばず、同一オリジンの中継サーバーをモックで差し込む。キーの実値は書かない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes } from './helpers.js';

const CONFIGURED = { configured: { endpoint: true, deployment: true, credential: true }, endpointHost: 'foundry.example.test' };
const CONSENT_KEY = 'grp.llm.consent'; // CONTRACT-LLM-CONSENT.md: { version: string, at: number } だけを持つ（存在＝同意済み）
const PROBE = 'PROBE-KEY-0000-not-a-real-secret';
const SVG_OK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

function makeRelay({ configured = CONFIGURED.configured, extract = { objects: [], people: [], emotions: [], metaphors: [] }, svg = { svg: SVG_OK } } = {}) {
  const r = { calls: [], configured };
  r.fn = async ({ method = 'GET', path, body }) => {
    r.calls.push({ method, path, body });
    if (path === '/api/llm/status') return { status: 200, body: { configured: r.configured, endpointHost: CONFIGURED.endpointHost, apiKey: PROBE } };
    if (path === '/api/llm/extract') return { status: 200, body: typeof extract === 'function' ? extract({ method, path, body }) : extract };
    if (path === '/api/llm/svg') return { status: 200, body: svg };
    return { status: 200, body: {} };
  };
  r.llmCalls = () => r.calls.filter((c) => c.path.startsWith('/api/llm/') && c.path !== '/api/llm/status');
  r.extractCalls = () => r.calls.filter((c) => c.path === '/api/llm/extract');
  return r;
}
async function appWith(relayOpts) { const relay = makeRelay(relayOpts); const ctx = await newApp({ options: { relay: relay.fn } }); return { ...ctx, relay }; }
async function enable(app) { assert.equal((await app.requestLlmEnable()).ok, true); await app.answerLlmConsent(true); assert.equal(app.getLlmState().enabled, true); }
// 再読込 = 同じ storage で createApp をやり直す（relay は新しいモック）
async function reload(ctx, relayOpts) { const relay = makeRelay(relayOpts); const app = await ctx.createApp({ ...ctx.env.options, relay: relay.fn }); return { app, relay }; }
const type = (app, env, ...texts) => { for (const t of texts) { app.setDraft(t); app.submitDraft(); env.tick(1); } };
const consentRecord = (env) => { const v = env.storage.getItem(CONSENT_KEY); return v == null ? null : JSON.parse(v); };
const deepKeys = (o, acc = []) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { acc.push(k); deepKeys(v, acc); } return acc; };

// FR-062 AC-312
test('FR-062 AC-312: 同意した後に再読込（同じ storage で再生成）しても同意が保たれ、再同意を求められず LLM 連携が有効のまま', async () => {
  const a = await appWith();
  assert.equal(consentRecord(a.env), null, '同意前は記録がない');
  await enable(a.app);
  const rec = consentRecord(a.env);
  assert.ok(rec && typeof rec.version === 'string' && rec.version.length > 0 && Number.isFinite(rec.at), '同意の事実・版・日時が記録される');
  const b = await reload(a);
  assert.equal(b.app.getLlmState().enabled, true);
  assert.equal(b.app.getLlmState().status, 'enabled');
  assert.equal(b.app.getLlmConsent(), null, '再同意を求められない');
  b.app.commands['session.start'](); type(b.app, a.env, '再読込後の要点');
  await b.app.flushLlm();
  assert.ok(b.relay.extractCalls().length >= 1, '再読込後も LLM 向けの要求が出る');
});

test('FR-062 AC-312 異常系: 同意の記録はあっても、設定（エンドポイント等）が揃っていなければ有効にならず、同意しない限り記録は作られない', async () => {
  const a = await appWith();
  await a.app.requestLlmEnable(); await a.app.answerLlmConsent(false);
  assert.equal(consentRecord(a.env), null, '拒否では記録を作らない');
  await enable(a.app);
  const b = await reload(a, { configured: { endpoint: true, deployment: false, credential: true } });
  assert.equal(b.app.getLlmState().enabled, false, '未設定なら記録があっても有効にならない');
  b.app.commands['session.start'](); type(b.app, a.env, '未設定の要点');
  await b.app.flushLlm();
  assert.equal(b.relay.llmCalls().length, 0);
});

test('FR-062 AC-312 異常系: 保存されるのは同意の事実・版・日時だけ。キー・会話内容・要点・有効フラグは保存されず、セッションファイル・エクスポートにも含まれない', async () => {
  const { app, env } = await appWith();
  await enable(app);
  app.commands['session.start'](); type(app, env, '秘密の会話内容ABC', '二つ目の要点DEF');
  await app.flushLlm();
  const rec = consentRecord(env);
  assert.deepEqual(Object.keys(rec).sort(), ['at', 'version'], '同意の記録の項目');
  const raw = env.storage.getItem(CONSENT_KEY);
  for (const s of [PROBE, '秘密の会話内容ABC', '二つ目の要点DEF']) assert.ok(!raw.includes(s), '同意の記録に含まれてはならない値');
  for (const [k, v] of env.storage.dump()) {
    if (k === CONSENT_KEY) continue;
    assert.ok(!v.includes(PROBE), `${k} にキー`);
    assert.ok(!/"?(llm|consent)[A-Za-z.]*"?\s*:\s*(true|"enabled")/i.test(v), `${k} に有効フラグ`);
    assert.ok(!k.toLowerCase().includes('llm'), `${k}: 同意の記録以外の LLM の保存はない`);
  }
  const saved = await app.commands['file.save'](); assert.equal(saved.ok, true);
  const data = env.downloads.at(-1).data;
  assert.ok(!data.includes(rec.version) && !/consent/i.test(data) && !data.includes(PROBE), 'セッションファイルに同意が含まれる');
  assert.ok(!/consent/i.test(app.renderSvg()), 'SVG に同意が含まれる');
});

// FR-062 AC-366
test('FR-062 AC-366: 無効化で保存された同意が取り消され、再読込後も無効のまま。再び有効にするには同意が必要', async () => {
  const a = await appWith();
  await enable(a.app);
  assert.ok(consentRecord(a.env));
  await a.app.disableLlm();
  assert.equal(consentRecord(a.env), null, '同意の記録が消える');
  const b = await reload(a);
  assert.equal(b.app.getLlmState().enabled, false);
  b.app.commands['session.start'](); type(b.app, a.env, '無効化後の要点');
  await b.app.flushLlm();
  assert.equal(b.relay.llmCalls().length, 0);
  const r = await b.app.requestLlmEnable();
  assert.deepEqual([r.ok, r.pending], [true, 'consent'], '再有効化は同意の手順を経る');
  assert.equal(b.app.getLlmState().enabled, false, '同意するまで有効にならない');
});

test('FR-062 AC-366 異常系: 再有効化の同意を拒否すると無効のままで、記録は作られない', async () => {
  const a = await appWith();
  await enable(a.app); await a.app.disableLlm();
  await a.app.requestLlmEnable(); await a.app.answerLlmConsent(false);
  assert.equal(a.app.getLlmState().enabled, false);
  assert.equal(consentRecord(a.env), null);
  const b = await reload(a);
  assert.equal(b.app.getLlmState().enabled, false);
});

// FR-062 AC-367
test('FR-062 AC-367: 保存された同意の版が現在と異なると無効として扱われ、LLM 向けの要求は 0 件・図はルールベースのまま。再同意で有効になる', async () => {
  const a = await appWith();
  await enable(a.app);
  const current = consentRecord(a.env);
  a.env.storage.setItem(CONSENT_KEY, JSON.stringify({ ...current, version: 'OLD-VERSION-0' }));
  const b = await reload(a);
  const plain = await newApp();
  assert.equal(b.app.getLlmState().enabled, false, '版が違えば無効');
  b.app.commands['session.start'](); plain.app.commands['session.start']();
  type(b.app, a.env, '版違いの要点'); type(plain.app, plain.env, '版違いの要点');
  await b.app.flushLlm();
  assert.equal(b.relay.llmCalls().length, 0);
  assert.equal(b.app.renderSvg(), plain.app.renderSvg());
  const r = await b.app.requestLlmEnable();
  assert.deepEqual([r.ok, r.pending], [true, 'consent']);
  const c = b.app.getLlmConsent();
  assert.ok(c && c.kinds.length > 0 && c.host && c.notSent.length > 0, '新しい送信内容を表示する');
  assert.equal(b.app.getLlmState().enabled, false);
  await b.app.answerLlmConsent(true);
  assert.equal(b.app.getLlmState().enabled, true);
  assert.equal(consentRecord(a.env).version, current.version, '現在の版で記録し直される');
  const d = await reload(a);
  assert.equal(d.app.getLlmState().enabled, true);
});

test('FR-062 AC-367 異常系: 版が欠けた・壊れた同意の記録も無効として扱われ（再同意を求める）、例外で落ちない', async () => {
  for (const bad of [JSON.stringify({ at: 1 }), '{not json', JSON.stringify({ version: '', at: 1 }), 'null']) {
    const a = await appWith();
    await enable(a.app);
    a.env.storage.setItem(CONSENT_KEY, bad);
    const b = await reload(a);
    assert.equal(b.app.getLlmState().enabled, false, bad);
    b.app.commands['session.start'](); type(b.app, a.env, '壊れた記録');
    await b.app.flushLlm();
    assert.equal(b.relay.llmCalls().length, 0, bad);
  }
});

// FR-062 AC-311
test('FR-062 AC-311: 有効のとき直近 1 回分の送信内容（マスキング後・キーなし）を確認でき、無効化・再読込で消え、保存されない', async () => {
  const { app, env, relay, createApp } = await appWith();
  assert.equal(app.getLlmLastSent(), null, '送信前はなし');
  await enable(app);
  app.setLlmMaskWords(['極秘案件']);
  app.commands['session.start'](); type(app, env, '極秘案件の見積り');
  await app.flushLlm();
  const last = app.getLlmLastSent();
  assert.ok(last && last.text.includes('見積り'), '直近の送信内容が見える');
  assert.ok(!last.text.includes('極秘案件'), 'マスキング後の内容');
  assert.ok(!JSON.stringify(last).includes(PROBE));
  type(app, env, '二回目の要点');
  await app.flushLlm();
  const last2 = app.getLlmLastSent();
  assert.ok(last2.text.includes('二回目の要点') && last2.at >= last.at, '直近 1 回分に更新される');
  assert.ok(!(env.storage.getItem(CONSENT_KEY) ?? '').includes('二回目の要点'), '送信内容を同意の記録に保存しない');
  const re = await createApp({ ...env.options, relay: makeRelay().fn });
  assert.equal(re.getLlmLastSent(), null, '再読込で消える');
  await app.disableLlm();
  assert.equal(app.getLlmLastSent(), null, '無効化で消える');
  assert.ok(relay.llmCalls().length >= 2);
});

// NFR-PRIV-003 AC-358
test('NFR-PRIV-003 AC-358: 送信は要点の文字・シーン番号・描画スタイル名・部品キーの候補一覧だけで、原文・識別情報・セッションを含まない', async () => {
  const { app, env, relay } = await appWith();
  await enable(app);
  assert.equal(app.setDrawStyle('rpg').ok, true);
  await seedThreeScenes(app, env);
  await app.flushLlm();
  const calls = relay.extractCalls(); assert.ok(calls.length >= 3);
  const body = calls.at(-1).body;
  assert.equal(body.scene, 3, 'シーン番号（1 始まり）');
  assert.equal(body.drawStyle, 'rpg', '描画スタイル名');
  const keys = app.getPartKeys();
  assert.ok(Array.isArray(body.partKeys) && body.partKeys.length > 0 && body.partKeys.every((k) => keys.includes(k)), '部品キーの候補一覧');
  assert.equal(typeof body.input, 'string');
  assert.ok(body.input.includes('担当者の割り当てを確認する'), '要点の文字');
  const text = JSON.stringify(body);
  const forbidden = ['utterance', 'transcript', 'audio', 'session', 'file', 'userAgent', 'user-agent', 'device', 'browser', 'storage'];
  for (const k of deepKeys(body)) assert.ok(!forbidden.some((f) => k.toLowerCase().includes(f)), `送ってはならない項目 ${k}`);
  assert.ok(!/Mozilla|Chrome\/|Node\.js|node:/i.test(text), '端末・ブラウザの識別情報');
  assert.ok(!text.includes('"scenes"') && !text.includes('grp.session'), 'セッションファイル');
  assert.ok(!text.includes(PROBE));
});

// NFR-PRIV-003 AC-359
test('NFR-PRIV-003 AC-359: 簡易マスキングで登録語・敬称付き人名・メール・電話番号が伏せ字になって送られ、応答の伏せ字は図で元に戻されない', async () => {
  const { app, env, relay } = await appWith({ extract: ({ body }) => ({ objects: [{ key: 'other', label: String(body.input).slice(0, 24) }], people: [], emotions: [], metaphors: [] }) });
  await enable(app);
  assert.equal(app.getLlmMasking(), true);
  app.setLlmMaskWords(['極秘案件']);
  app.commands['session.start']();
  type(app, env, '極秘案件を山田様と相談 taro@example.com 090-1234-5678');
  await app.flushLlm();
  const sent = JSON.stringify(relay.extractCalls().at(-1).body);
  for (const s of ['極秘案件', '山田様', 'taro@example.com', '090-1234-5678']) assert.ok(!sent.includes(s), `${s} が送信に含まれる`);
  assert.ok(relay.extractCalls().at(-1).body.input.length > 0);
  // 応答に伏せ字が含まれても、図・一覧で登録語に戻らない（基準: LLM なしの同じ入力での出現数）
  app.setLlmSvgGeneration(true);
  type(app, env, '追加の要点');
  await app.flushLlm();
  const plain = await newApp(); plain.app.commands['session.start'](); type(plain.app, plain.env, '極秘案件を山田様と相談 taro@example.com 090-1234-5678', '追加の要点');
  const count = (s, w) => s.split(w).length - 1;
  for (const w of ['極秘案件', '山田様']) assert.ok(count(app.renderSvg() + app.renderOutline(), w) <= count(plain.app.renderSvg() + plain.app.renderOutline(), w), `${w} が伏せ字から復元された`);
});

test('NFR-PRIV-003 AC-359 異常系: 設定画面に、検出は簡易で完全な個人情報の除去は保証しない旨が示される', async () => {
  const { app } = await appWith();
  app.commands['settings.open']();
  const f = app.getSettingsDialog().fields.find((x) => x.id === 'llm.mask');
  assert.ok(f, '簡易マスキングの項目がある');
  assert.ok(/保証し(ない|ません)|not guarantee|does not guarantee/i.test(f.note ?? ''), '保証しない旨');
});

// NFR-PRIV-003 AC-360
test('NFR-PRIV-003 AC-360: 簡易マスキングの初期値は有効で、設定画面から無効にでき、無効にするとマスキングされずに送られる', async () => {
  const { app, env, relay } = await appWith();
  await enable(app);
  assert.equal(app.getLlmMasking(), true, '初期値は有効');
  app.commands['settings.open']();
  assert.equal(app.getSettingsDialog().fields.find((x) => x.id === 'llm.mask').value, true);
  app.setLlmMaskWords(['極秘案件']);
  app.commands['session.start'](); type(app, env, '極秘案件の一回目');
  await app.flushLlm();
  assert.ok(!JSON.stringify(relay.extractCalls().at(-1).body).includes('極秘案件'));
  app.focusSettingsField('llm.mask'); app.handleKey({ key: 'Enter' });
  assert.equal(app.getLlmMasking(), false, '設定画面で無効にできる');
  type(app, env, '極秘案件の二回目');
  await app.flushLlm();
  assert.ok(JSON.stringify(relay.extractCalls().at(-1).body).includes('極秘案件'), '無効ならマスキングされない');
});

test('NFR-PRIV-003 AC-360 異常系: 無効にした後に有効へ戻すと再びマスキングされる', async () => {
  const { app, env, relay } = await appWith();
  await enable(app);
  app.setLlmMaskWords(['極秘案件']);
  app.setLlmMasking(false); app.setLlmMasking(true);
  app.commands['session.start'](); type(app, env, '極秘案件の要点');
  await app.flushLlm();
  assert.ok(!JSON.stringify(relay.extractCalls().at(-1).body).includes('極秘案件'));
});

// FR-065 AC-334
test('FR-065 AC-334: サニタイズ済みの生成 SVG がセッションファイルに保存され、LLM 連携なしの読込後も同じ絵が再描画される', async () => {
  const a = await appWith({ extract: { objects: [{ key: 'other', label: 'ゾウ' }], people: [], emotions: [], metaphors: [] } });
  await enable(a.app); a.app.setLlmSvgGeneration(true);
  a.app.commands['session.start'](); type(a.app, a.env, '動物園の話');
  await a.app.flushLlm();
  const before = a.app.renderSvg();
  assert.ok(before.includes('<circle cx="5" cy="5" r="4"'), '生成 SVG が描かれている');
  assert.equal((await a.app.commands['file.save']()).ok, true);
  const file = a.env.downloads.at(-1);
  const b = await newApp({ options: { relay: makeRelay().fn } }); // LLM 連携は無効（同意なし）
  const r = await b.app.loadSessionFile({ name: file.filename, type: 'application/json', size: file.data.length, text: file.data });
  assert.equal(r.ok, true);
  assert.equal(b.app.getLlmState().enabled, false);
  assert.ok(b.app.renderSvg().includes('<circle cx="5" cy="5" r="4"'), '同じ絵が再描画される');
  assert.equal(b.app.getLlmState().svgGeneration, false);
});

test('FR-065 AC-334 異常系: 保存された SVG に危険な要素が混ざっていても、読込時に再サニタイズされて描かれない', async () => {
  const a = await appWith({ extract: { objects: [{ key: 'other', label: 'ゾウ' }], people: [], emotions: [], metaphors: [] } });
  await enable(a.app); a.app.setLlmSvgGeneration(true);
  a.app.commands['session.start'](); type(a.app, a.env, '動物園の話');
  await a.app.flushLlm();
  await a.app.commands['file.save']();
  const file = a.env.downloads.at(-1);
  const j = JSON.parse(file.data);
  assert.ok(Array.isArray(j.generatedSvgs) && j.generatedSvgs.length >= 1, 'セッションファイルに生成 SVG がある');
  j.generatedSvgs[0].svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(1)</script><circle cx="5" cy="5" r="4"/></svg>';
  const tampered = JSON.stringify(j);
  const b = await newApp();
  const r = await b.app.loadSessionFile({ name: 'x.json', type: 'application/json', size: tampered.length, text: tampered });
  assert.equal(r.ok, true);
  const svg = b.app.renderSvg();
  assert.ok(!/<script|onload=|alert\(/i.test(svg), '再サニタイズされていない');
});
