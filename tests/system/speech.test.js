// FR-001 AC-040 AC-066 AC-067 AC-068 AC-069 / NFR-PRIV-001 AC-034 / NFR-OFFLINE-001 AC-031 / NFR-BG-001 AC-064
// 音声認識の日本語対応（契約: tests/system/CONTRACT.md「音声認識の日本語対応」）。期待値は受入基準だけから決める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newApp, FakeSpeech, CJK, WEB } from './helpers.js';

const boot = (opts = {}, over = {}) => newApp({ speech: new FakeSpeech(opts), ...over });
const rec = (app) => app.commands['session.start']();
const hasProcLocally = (o) => Object.prototype.hasOwnProperty.call(o ?? {}, 'processLocally');
const REMOTE = { processLocally: false, availability: { 'ja-JP': 'remote', 'en-US': 'remote' } };

// FR-001 AC-040
test('FR-001 AC-040: API 非対応では開始されず、理由（api）と代替入力への誘導が出る', async () => {
  const { app, env } = await boot({ supported: false });
  rec(app);
  const st = app.getSpeechStatus();
  assert.equal(st.state, 'unavailable'); assert.equal(st.reason, 'api');
  assert.equal(st.startEnabled, false); assert.equal(st.alternative, true);
  const r = await app.startSpeech();
  assert.equal(r.ok, false); assert.equal(r.reason, 'api_missing');
  assert.equal(env.speech.startCalls.length, 0);
  assert.ok(app.getState().message?.text.trim());
});

test('FR-001 AC-040: 選択中の言語（ja）が未対応なら不可。判定は選択中の言語だけで、en が使えても開始されない', async () => {
  const { app, env } = await boot({ availability: { 'ja-JP': 'unsupported', 'en-US': 'local' } });
  app.setLang('ja'); rec(app);
  assert.equal(app.getSpeechStatus().state, 'unavailable');
  assert.equal(app.getSpeechStatus().reason, 'language');
  const r = await app.startSpeech();
  assert.equal(r.ok, false); assert.equal(r.reason, 'language_unsupported');
  assert.equal(env.speech.startCalls.length, 0);
});

test('FR-001 AC-040: 選択言語を en に替えると en の可否だけで判定され、ja が未対応でも開始できる（逆も同じ）', async () => {
  const { app, env } = await boot({ availability: { 'ja-JP': 'unsupported', 'en-US': 'local' } });
  rec(app); app.setLang('en');
  assert.equal(app.getSpeechStatus().state, 'local');
  assert.equal((await app.startSpeech()).ok, true);
  assert.equal(env.speech.startCalls.at(-1).lang, 'en-US');
  const b = await boot({ availability: { 'ja-JP': 'local', 'en-US': 'unsupported' } });
  rec(b.app); b.app.setLang('en');
  assert.equal(b.app.getSpeechStatus().reason, 'language');
  b.app.setLang('ja');
  assert.equal(b.app.getSpeechStatus().state, 'local');
  assert.equal((await b.app.startSpeech()).ok, true);
  assert.equal(b.env.speech.startCalls.at(-1).lang, 'ja-JP');
});

test('FR-001 AC-040 異常系: デバイス内不可で API があり未同意の間は開始されない', async () => {
  const { app, env } = await boot(REMOTE);
  rec(app);
  const r = await app.startSpeech();
  assert.equal(r.ok, false); assert.equal(r.reason, 'consent_required');
  assert.equal(env.speech.startCalls.length, 0);
});

// FR-001 AC-066
test('FR-001 AC-066: デバイス内処理が使える（local）ときは同意なしで processLocally を真にして開始する', async () => {
  const { app, env } = await boot({ availability: { 'ja-JP': 'local' } });
  rec(app);
  assert.equal(app.getSpeechConsent(), false);
  assert.equal(app.getConsentUi().visible, false, 'local では同意を求めない');
  const r = await app.startSpeech();
  assert.equal(r.ok, true);
  assert.equal(env.speech.startCalls.length, 1);
  assert.equal(env.speech.startCalls[0].lang, 'ja-JP');
  assert.equal(env.speech.startCalls[0].processLocally, true);
});

test('FR-001 AC-066: 言語モデルが導入可能（downloadable）なら導入が完了してから開始する', async () => {
  const { app, env } = await boot({ availability: { 'ja-JP': 'downloadable' } });
  let release;
  const gate = new Promise((res) => { release = res; });
  const orig = env.speech.install.bind(env.speech);
  env.speech.install = async (o) => { await gate; return orig(o); };
  rec(app);
  const p = app.startSpeech();
  await Promise.resolve();
  assert.equal(env.speech.startCalls.length, 0, '導入が終わるまで start しない');
  release();
  const r = await p;
  assert.equal(r.ok, true);
  assert.equal(env.speech.installCalls.length, 1);
  assert.equal(env.speech.installCalls[0].lang, 'ja-JP');
  assert.equal(env.speech.startCalls.length, 1);
  assert.equal(env.speech.startCalls[0].processLocally, true);
});

test('FR-001 AC-066 異常系: 導入に失敗したら開始せず、理由（モデル未導入）と代替入力への誘導を示す', async () => {
  const { app, env } = await boot({ availability: { 'ja-JP': 'downloadable' }, installOk: false });
  rec(app);
  const r = await app.startSpeech();
  assert.equal(r.ok, false); assert.equal(r.reason, 'model_missing');
  assert.equal(env.speech.startCalls.length, 0);
  const st = app.getSpeechStatus();
  assert.equal(st.state, 'unavailable'); assert.equal(st.reason, 'model'); assert.equal(st.alternative, true);
  assert.ok(app.getState().message?.text.trim());
});

// FR-001 AC-067 / NFR-PRIV-001 AC-034
test('FR-001 AC-067 NFR-PRIV-001 AC-034: 既定は未同意で、同意前は開始せず、同意後に開始する。processLocally は設定しない', async () => {
  const { app, env } = await boot(REMOTE);
  rec(app);
  assert.equal(app.getSpeechConsent(), false);
  assert.equal((await app.startSpeech()).ok, false);
  assert.equal(env.speech.startCalls.length, 0);
  app.setSpeechConsent(true);
  assert.equal(app.getSpeechConsent(), true);
  const r = await app.startSpeech();
  assert.equal(r.ok, true);
  assert.equal(env.speech.startCalls.length, 1);
  assert.equal(env.speech.startCalls[0].lang, 'ja-JP');
  assert.equal(hasProcLocally(env.speech.startCalls[0]), false, '同意による開始で processLocally を設定しない');
});

test('FR-001 AC-067: 外部送信の可能性の説明が表示言語（ja/en）に合わせて示される', async () => {
  const { app } = await boot(REMOTE);
  rec(app);
  app.setLang('ja');
  const ja = app.getConsentUi();
  assert.equal(ja.visible, true);
  assert.equal(ja.notice, app.t('speech.consent.notice'));
  assert.ok(CJK.test(ja.notice) && ja.notice.includes('外部'), `ja: ${ja.notice}`);
  app.setLang('en');
  const en = app.getConsentUi();
  assert.ok(/external/i.test(en.notice) && !CJK.test(en.notice), `en: ${en.notice}`);
  assert.notEqual(ja.notice, en.notice);
});

test('FR-001 AC-067 NFR-PRIV-001 AC-034: 同意を取り消すと認識が停止し、以後は開始できない', async () => {
  const { app, env } = await boot(REMOTE);
  rec(app); app.setSpeechConsent(true);
  await app.startSpeech();
  const stops = env.speech.stopCalls;
  app.setSpeechConsent(false);
  assert.equal(app.getSpeechConsent(), false);
  assert.ok(env.speech.stopCalls > stops, '取り消しで stop を呼ぶ');
  const n = env.speech.startCalls.length;
  const r = await app.startSpeech();
  assert.equal(r.ok, false); assert.equal(r.reason, 'consent_required');
  assert.equal(env.speech.startCalls.length, n);
});

test('FR-001 AC-067 異常系: 同意はそのページ利用中だけ有効で保存されず、再読込（同じ storage で再生成）後は未同意に戻り開始できない', async () => {
  const { app, createApp, env } = await boot(REMOTE);
  rec(app); app.setSpeechConsent(true);
  assert.equal(app.getSpeechConsent(), true);
  assert.equal(env.storage.dump().some(([k, v]) => /consent/i.test(k) && /true|1/.test(v)), false, '同意は保存されない');
  const sp = new FakeSpeech(REMOTE);
  const fresh = await createApp({ ...env.options, speechSource: sp });
  assert.equal(fresh.getSpeechConsent(), false, '再読込後の既定は未同意');
  rec(fresh);
  const r = await fresh.startSpeech();
  assert.equal(r.ok, false); assert.equal(r.reason, 'consent_required');
  assert.equal(sp.startCalls.length, 0);
});

test('NFR-PRIV-001 AC-034 異常系: デバイス内処理が判定できない（availabilityFor が例外・未知の値）ときも「使えない」扱いで、同意前は開始されず、同意後に開始する', async () => {
  for (const mode of ['throw', 'unknown']) {
    const { app, env } = await boot(REMOTE);
    env.speech.availabilityFor = () => { if (mode === 'throw') throw new Error('判定不能'); return 'unknown'; };
    rec(app);
    const r = await app.startSpeech();
    assert.equal(r.ok, false, mode); assert.equal(r.reason, 'consent_required', mode);
    assert.equal(env.speech.startCalls.length, 0, mode);
    app.setSpeechConsent(true);
    assert.equal((await app.startSpeech()).ok, true, mode);
    assert.equal(hasProcLocally(env.speech.startCalls.at(-1)), false, mode);
  }
});

test('NFR-PRIV-001 AC-034: 同意があっても音声は保存されない（保存内容に音声・認識結果の余分な項目がない）', async () => {
  const { app, env } = await boot(REMOTE);
  rec(app); app.setSpeechConsent(true); await app.startSpeech();
  env.speech.emit('同意後の発話です', true, { audio: 'RAW-AUDIO-MARKER-9f3a', audioBytes: [1, 2, 3] });
  assert.equal(app.getState().utterances.length, 1);
  const dump = JSON.stringify(env.storage.dump());
  assert.ok(!dump.includes('RAW-AUDIO-MARKER-9f3a'));
  assert.ok(!/audio/i.test(dump));
  assert.ok(env.storage.dump().every(([k]) => k.startsWith('grp.')));
});

// FR-001 AC-068
test('FR-001 AC-068: 同意の操作はキーボードだけで切り替えられ、状態が文字（と role/checked）で伝わる', async () => {
  const { app } = await boot(REMOTE);
  rec(app);
  const b = app.keymap.find((k) => k.command === 'speech.consent');
  assert.ok(b, 'keymap に speech.consent がある');
  assert.equal(typeof app.commands['speech.consent'], 'function');
  const u0 = app.getConsentUi();
  assert.ok(['switch', 'checkbox'].includes(u0.role));
  assert.equal(u0.tabbable, true); assert.equal(u0.colorOnly, false);
  assert.ok(u0.label.trim()); assert.equal(u0.checked, false);
  const hit = app.handleKey({ key: b.key, ctrlKey: !!b.ctrl, altKey: !!b.alt, shiftKey: !!b.shift });
  assert.equal(hit, 'speech.consent');
  const u1 = app.getConsentUi();
  assert.equal(u1.checked, true); assert.equal(app.getSpeechConsent(), true);
  assert.notEqual(u1.stateText, u0.stateText, '色以外（文字）で状態が変わる');
  assert.ok(u0.stateText.trim() && u1.stateText.trim());
  app.commands['speech.consent']();
  assert.equal(app.getSpeechConsent(), false);
});

test('FR-001 AC-068: index.html に名前・説明・状態を持つ同意の操作要素があり、正の tabindex がない', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const m = html.match(/<(input|button|div|span)\b[^>]*\bid="speech-consent"[^>]*>/i);
  assert.ok(m, 'id="speech-consent" の要素');
  const tag = m[0];
  const native = /^<input\b/i.test(tag) && /type="checkbox"/i.test(tag);
  const aria = /role="(switch|checkbox)"/i.test(tag) && /aria-checked=/i.test(tag) && /tabindex="0"/i.test(tag);
  assert.ok(native || aria, 'checkbox か、aria-checked と tabindex=0 を持つ switch/checkbox');
  assert.ok(/aria-describedby=/i.test(tag), '外部送信の説明に結び付く');
  assert.ok(/aria-label=/i.test(tag) || /<label\b[^>]*for="speech-consent"/i.test(html), '名前');
  assert.ok(!/tabindex="[1-9]/.test(html));
});

test('FR-001 AC-068 異常系: 同意の保存は同意したか否かだけで、発話・認識結果を含まない', async () => {
  const { app, env } = await boot(REMOTE);
  rec(app); app.setSpeechConsent(true); await app.startSpeech();
  env.speech.emit('秘密の発話テキスト', true);
  const consentEntries = env.storage.dump().filter(([k]) => /consent/i.test(k));
  for (const [, v] of consentEntries) assert.match(v, /^(true|false|1|0)$/);
  assert.ok(consentEntries.every(([, v]) => !v.includes('秘密')));
});

// FR-001 AC-069
test('FR-001 AC-069: 状態表示が 3 状態（デバイス内／要同意・外部送信の可能性／使えません）を区別する', async () => {
  const a = await boot({ availability: { 'ja-JP': 'local' } }); rec(a.app);
  const b = await boot(REMOTE); rec(b.app);
  const c = await boot({ supported: false }); rec(c.app);
  const sa = a.app.getSpeechStatus(), sb = b.app.getSpeechStatus(), sc = c.app.getSpeechStatus();
  assert.deepEqual([sa.state, sb.state, sc.state], ['local', 'consent', 'unavailable']);
  assert.ok(sa.text.includes('使えます（デバイス内）'), sa.text);
  assert.ok(sb.text.includes('使えます（要同意・外部送信の可能性）'), sb.text);
  assert.ok(sc.text.includes('使えません'), sc.text);
  assert.equal(new Set([sa.text, sb.text, sc.text]).size, 3);
  assert.deepEqual([a, b, c].map((x) => x.app.getCommandBar().status.speech), ['available', 'consent', 'unavailable']);
  for (const x of [a, b, c]) assert.ok(x.app.getCommandBar().status.text.includes(x.app.getSpeechStatus().text));
  assert.equal(sb.reason, 'consent');
  b.app.setSpeechConsent(true);
  assert.equal(b.app.getSpeechStatus().state, 'consent', '同意後も外部送信の可能性の表示は保つ');
  assert.equal(b.app.getSpeechStatus().reason, null);
  assert.equal(b.app.getSpeechStatus().startEnabled, true);
  b.app.setLang('en');
  assert.ok(b.app.getSpeechStatus().text.trim() && !CJK.test(b.app.getSpeechStatus().text));
});

test('FR-001 AC-069: 使えない・開始できない理由（API 非対応／言語未対応／モデル未導入／同意待ち／マイク拒否）が区別して示される', async () => {
  const texts = new Map();
  const cases = {
    api: async () => { const r = await boot({ supported: false }); rec(r.app); return r; },
    language: async () => { const r = await boot({ availability: { 'ja-JP': 'unsupported' } }); rec(r.app); return r; },
    model: async () => { const r = await boot({ availability: { 'ja-JP': 'downloadable' }, installOk: false }); rec(r.app); await r.app.startSpeech(); return r; },
    consent: async () => { const r = await boot(REMOTE); rec(r.app); await r.app.startSpeech(); return r; },
    mic: async () => { const r = await boot({ availability: { 'ja-JP': 'local' } }); rec(r.app); await r.app.startSpeech(); r.env.speech.fail('not-allowed'); return r; },
  };
  for (const [reason, mk] of Object.entries(cases)) {
    const { app } = await mk();
    const st = app.getSpeechStatus();
    assert.equal(st.reason, reason);
    assert.equal(st.startEnabled, false, `${reason}: 開始は無効`);
    const msg = app.getState().message?.text ?? '';
    assert.ok(st.text.trim());
    if (reason !== 'consent') assert.ok(st.text.includes('使えません') && st.alternative === true, reason);
    texts.set(reason, `${st.text}|${msg}`);
  }
  assert.equal(new Set(texts.values()).size, 5, '理由ごとに表示が異なる');
});

test('FR-001 AC-069 異常系: マイク拒否（not-allowed / service-not-allowed）では記録しても発話が増えず、理由が mic になる', async () => {
  for (const code of ['not-allowed', 'service-not-allowed']) {
    const { app, env } = await boot({ availability: { 'ja-JP': 'local' } });
    rec(app); await app.startSpeech();
    env.speech.fail(code);
    assert.equal(app.getSpeechStatus().reason, 'mic', code);
    assert.equal(app.getState().utterances.length, 0);
  }
});

// NFR-OFFLINE-001 AC-031
test('NFR-OFFLINE-001 AC-031: 同意による外部送信可の認識を使っても、アプリ自身は同一オリジン以外へリクエストしない', async () => {
  const calls = [];
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
  const saved = Object.fromEntries(names.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of names) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: (...a) => { calls.push(k); throw new Error('network blocked'); } });
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { sendBeacon: () => { calls.push('sendBeacon'); return false; } } });
  try {
    const { app, env } = await boot(REMOTE);
    rec(app); app.setSpeechConsent(true); await app.startSpeech();
    env.speech.emit('外部送信可の環境での発話', true);
    env.speech.end(); env.scheduler.advance(3000);
    app.setSpeechConsent(false);
    assert.equal(app.getState().utterances.length, 1);
  } finally {
    for (const k of names) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
  }
  assert.deepEqual(calls, []);
});

// NFR-BG-001 AC-064
test('NFR-BG-001 AC-064: 同意済みの外部送信可の環境でも、自動終了後 2 秒以内に再開される（processLocally は設定しない）', async () => {
  const { app, env } = await boot(REMOTE);
  rec(app); app.setSpeechConsent(true); await app.startSpeech();
  const n = env.speech.startCalls.length;
  env.speech.end(); env.scheduler.advance(2000);
  assert.equal(env.speech.startCalls.length, n + 1);
  assert.equal(hasProcLocally(env.speech.startCalls.at(-1)), false);
  assert.equal(env.speech.startCalls.at(-1).lang, 'ja-JP');
});

test('NFR-BG-001 AC-064 異常系: 同意が得られていない・取り消した後の自動終了では再開されない', async () => {
  const { app, env } = await boot(REMOTE);
  rec(app); app.setSpeechConsent(true); await app.startSpeech();
  app.setSpeechConsent(false);
  const n = env.speech.startCalls.length;
  env.speech.end(); env.scheduler.advance(10 * 1000);
  assert.equal(env.speech.startCalls.length, n);
});

test('NFR-BG-001 AC-064 異常系: 同意を取り消して停止した後は、自動終了・時間経過でも再開されず、再度同意するまで再開しない', async () => {
  const { app, env } = await boot(REMOTE);
  rec(app); app.setSpeechConsent(true); await app.startSpeech();
  app.setSpeechConsent(false);
  const n = env.speech.startCalls.length;
  env.speech.end(); env.scheduler.advance(60 * 1000);
  assert.equal(env.speech.startCalls.length, n, '取り消し後は自動再開しない');
  app.setSpeechConsent(true);
  env.scheduler.advance(60 * 1000);
  assert.equal(env.speech.startCalls.length, n, '再同意しただけでは自動再開せず、利用者の開始操作を待つ');
});

test('NFR-BG-001 AC-064 異常系: 選択言語が未対応になった（言語を替えた）後の自動終了では再開されない', async () => {
  const { app, env } = await boot({ availability: { 'ja-JP': 'local', 'en-US': 'unsupported' } });
  rec(app); await app.startSpeech();
  app.setLang('en');
  const n = env.speech.startCalls.length;
  env.speech.end(); env.scheduler.advance(10 * 1000);
  assert.equal(env.speech.startCalls.length, n);
});
