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

test('FR-001 AC-040: デバイス内不可で API がある環境は、同意待ちで止まらず（口頭で得たものとして扱う）そのまま開始できる', async () => {
  const { app, env } = await boot(REMOTE);
  assert.equal(env.speech.startCalls.length, 0, '準備中は押すまで開始されない');
  rec(app);
  assert.equal(env.speech.startCalls.length, 1, '[記録開始] で同意の操作なしに開始される');
  const r = await app.startSpeech();
  assert.equal(r.ok, true); assert.notEqual(r.reason, 'consent_required');
  assert.notEqual(app.getSpeechStatus().reason, 'consent', '同意待ちの理由は生じない');
});

// FR-001 AC-066
test('FR-001 AC-066: デバイス内処理が使える（local）ときは同意なしで processLocally を真にして開始する', async () => {
  const { app, env } = await boot({ availability: { 'ja-JP': 'local' } });
  rec(app);
  assert.equal(app.getSpeechConsent(), true, '同意状態は常に同意済み');
  assert.equal(app.getConsentUi().visible, false, 'local では注意文も出ない');
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
test('FR-001 AC-067 NFR-PRIV-001 AC-034: 同意は常に同意済みで、同意の操作は存在せず、準備中は開始せず [記録開始] で開始する。processLocally は設定しない', async () => {
  const { app, env } = await boot(REMOTE);
  assert.equal(app.getSpeechConsent(), true);
  assert.equal(app.setSpeechConsent, undefined, '同意を切り替える API はない');
  assert.equal(app.commands['speech.consent'], undefined);
  assert.equal(env.speech.startCalls.length, 0, '準備中は何もしなくても開始されない');
  rec(app);
  assert.equal(env.speech.startCalls.length, 1);
  assert.equal(env.speech.startCalls[0].lang, 'ja-JP');
  assert.equal(hasProcLocally(env.speech.startCalls[0]), false, '外部送信可の開始で processLocally を設定しない');
});

test('FR-001 AC-067: 外部送信の可能性の説明が表示言語（ja/en）に合わせて示される', async () => {
  const { app } = await boot(REMOTE);
  rec(app);
  app.setLang('ja');
  const ja = app.getConsentUi();
  assert.equal(ja.visible, true);
  assert.equal(ja.notice, app.t('speech.consent.notice'));
  assert.ok(CJK.test(ja.notice) && ja.notice.includes('外部') && ja.notice.includes('口頭'), `ja: ${ja.notice}`);
  app.setLang('en');
  const en = app.getConsentUi();
  assert.ok(/external/i.test(en.notice) && /verbal/i.test(en.notice) && !CJK.test(en.notice), `en: ${en.notice}`);
  assert.notEqual(ja.notice, en.notice);
});

test('FR-001 AC-067 NFR-PRIV-001 AC-034: 注意文のほかに同意の操作（チェック・ボタン）はなく、取り消す操作もない（API・コマンド・キー割り当て・画面）', async () => {
  const { app, env } = await boot(REMOTE);
  rec(app);
  const u = app.getConsentUi();
  for (const k of ['checked', 'stateText', 'tabbable', 'label']) assert.equal(u[k], undefined, `getConsentUi().${k} はない`);
  assert.equal(u.interactive, false);
  assert.equal(app.setSpeechConsent, undefined);
  assert.equal(app.commands['speech.consent'], undefined);
  assert.deepEqual(app.keymap.filter((k) => /consent/.test(k.command)), []);
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /id="speech-consent"/);
  assert.doesNotMatch(html, /id="speech-consent-state"/);
  assert.equal(app.getSpeechConsent(), true);
  assert.equal(env.speech.startCalls.length, 1);
});

test('FR-001 AC-067 異常系: 同意状態は保存されず（常に同意済みで、メモリにも持たない）、再読込（同じ storage で再生成）後も常に同意済みで、準備中は開始されず、何も操作しなくても [記録開始] で開始する', async () => {
  const { app, createApp, env } = await boot(REMOTE);
  rec(app);
  assert.equal(app.getSpeechConsent(), true);
  assert.equal(env.storage.dump().some(([k, v]) => /consent/i.test(k) || /consent/i.test(v)), false, '同意は保存されない');
  const sp = new FakeSpeech(REMOTE);
  const fresh = await createApp({ ...env.options, speechSource: sp });
  assert.equal(fresh.getSpeechConsent(), true, '再読込後も同意済み');
  assert.equal(sp.startCalls.length, 0, '再読込後の準備中（または復元直後の一時停止）は開始されない');
  fresh.commands[fresh.getState().session === 'paused' ? 'session.resume' : 'session.start']();
  assert.equal(sp.startCalls.length, 1, '何も操作しなくても開始される（同意は口頭で得たもの）');
  assert.equal(hasProcLocally(sp.startCalls[0]), false);
});

test('NFR-PRIV-001 AC-034 異常系: デバイス内処理が判定できない（availabilityFor が例外・未知の値）ときも「使えない」扱いで、外部送信の注意文を示し、同意の操作なしに [記録開始] で開始する', async () => {
  for (const mode of ['throw', 'unknown']) {
    const { app, env } = await boot(REMOTE);
    env.speech.availabilityFor = () => { if (mode === 'throw') throw new Error('判定不能'); return 'unknown'; };
    assert.equal(app.getConsentUi().visible, true, `${mode}: 注意文が出る`);
    rec(app);
    assert.equal(env.speech.startCalls.length, 1, mode);
    assert.equal(hasProcLocally(env.speech.startCalls.at(-1)), false, mode);
  }
});

test('NFR-PRIV-001 AC-034: 同意があっても音声は保存されない（保存内容に音声・認識結果の余分な項目がない）', async () => {
  const { app, env } = await boot(REMOTE);
  rec(app);
  env.speech.emit('同意後の発話です', true, { audio: 'RAW-AUDIO-MARKER-9f3a', audioBytes: [1, 2, 3] });
  assert.equal(app.getState().utterances.length, 1);
  const dump = JSON.stringify(env.storage.dump());
  assert.ok(!dump.includes('RAW-AUDIO-MARKER-9f3a'));
  assert.ok(!/audio/i.test(dump));
  assert.ok(env.storage.dump().every(([k]) => k.startsWith('grp.')));
});

// FR-001 AC-068
test('FR-001 AC-068: 外部送信の注意文は読み上げの対象（role）で操作できる要素を持たず、色だけで示されない', async () => {
  const { app } = await boot(REMOTE);
  rec(app);
  const u = app.getConsentUi();
  assert.ok(['note', 'status'].includes(u.role), `role=${u.role}`);
  assert.equal(u.interactive, false);
  assert.equal(u.colorOnly, false);
  assert.ok(u.notice.trim(), '文字で示される');
  assert.equal(u.checked, undefined); assert.equal(u.tabbable, undefined);
  assert.equal(app.commands['speech.consent'], undefined);
  assert.deepEqual(app.keymap.filter((k) => /consent/.test(k.command)), []);
});

test('FR-001 AC-068: index.html の注意文（#speech-consent-notice）は操作できる要素を持たず、ページに同意のチェック・switch・確認ダイアログがない', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const m = html.match(/<[a-z]+\b[^>]*\bid="speech-consent-notice"[^>]*>/i);
  assert.ok(m, 'id="speech-consent-notice" の要素');
  assert.ok(/role="(note|status)"/i.test(m[0]) || /aria-live=/i.test(m[0]), '読み上げの対象');
  assert.doesNotMatch(html, /id="speech-consent"/);
  const box = html.match(/<div id="speech-consent-box"[\s\S]*?<\/div>/i)?.[0] ?? '';
  assert.doesNotMatch(box, /<(input|button|select|textarea)\b|role="(switch|checkbox|button)"|tabindex/i, '注意文の領域に操作できる要素がない');
});

test('FR-001 AC-068 異常系: 同意状態は保存されず（AC-067。常に同意済みでメモリにも持たない）、セッションの保存に同意・音声は含まれない', async () => {
  const { app, env, createApp } = await boot(REMOTE);
  rec(app);
  env.speech.emit('秘密の発話テキスト', true, { audio: 'RAW-AUDIO-MARKER-68' });
  assert.equal(app.getSpeechConsent(), true);
  const dump = env.storage.dump();
  assert.equal(dump.filter(([k]) => /consent/i.test(k)).length, 0, '同意のキーが保存されない');
  assert.ok(!dump.some(([, v]) => /consent|RAW-AUDIO-MARKER-68|audio/i.test(v)), '保存内容に同意・音声が含まれない');
  const fresh = await createApp({ ...env.options, speechSource: new FakeSpeech(REMOTE) });
  assert.equal(fresh.getSpeechConsent(), true);
  assert.equal(fresh.getConsentUi().checked, undefined);
});

// FR-001 AC-069
test('FR-001 AC-069: 状態表示が 3 状態（デバイス内／要同意・外部送信の可能性／使えません）を区別する（同意待ちの理由は生じない）', async () => {
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
  assert.equal(sb.reason, null, '同意は口頭で得たものとして扱うので「同意待ち」の理由は生じない');
  assert.equal(sb.startEnabled, true);
  b.app.setLang('en');
  assert.ok(b.app.getSpeechStatus().text.trim() && !CJK.test(b.app.getSpeechStatus().text));
});

test('FR-001 AC-069: 使えない・開始できない理由（API 非対応／言語未対応／モデル未導入／マイク拒否）が区別して示され、「同意待ち」の理由は生じない', async () => {
  const texts = new Map();
  const cases = {
    api: async () => { const r = await boot({ supported: false }); rec(r.app); return r; },
    language: async () => { const r = await boot({ availability: { 'ja-JP': 'unsupported' } }); rec(r.app); return r; },
    model: async () => { const r = await boot({ availability: { 'ja-JP': 'downloadable' }, installOk: false }); rec(r.app); await r.app.startSpeech(); return r; },
    mic: async () => { const r = await boot({ availability: { 'ja-JP': 'local' } }); rec(r.app); await r.app.startSpeech(); r.env.speech.fail('not-allowed'); return r; },
  };
  for (const [reason, mk] of Object.entries(cases)) {
    const { app } = await mk();
    const st = app.getSpeechStatus();
    assert.equal(st.reason, reason);
    assert.equal(st.startEnabled, false, `${reason}: 開始は無効`);
    const msg = app.getState().message?.text ?? '';
    assert.ok(st.text.includes('使えません') && st.alternative === true, reason);
    texts.set(reason, `${st.text}|${msg}`);
  }
  assert.equal(new Set(texts.values()).size, 4, '理由ごとに表示が異なる');
  const r = await boot(REMOTE); rec(r.app); await r.app.startSpeech();
  assert.notEqual(r.app.getSpeechStatus().reason, 'consent', '外部送信の可能性がある環境でも同意待ちにならない');
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
    rec(app); await app.startSpeech();
    env.speech.emit('外部送信可の環境での発話', true);
    env.speech.end(); env.scheduler.advance(3000);
    assert.equal(app.getState().utterances.length, 1);
  } finally {
    for (const k of names) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
  }
  assert.deepEqual(calls, []);
});

// NFR-BG-001 AC-064
test('NFR-BG-001 AC-064: 外部送信可の環境でも、自動終了後 2 秒以内に再開される（processLocally は設定しない。同意の操作は不要）', async () => {
  const { app, env } = await boot(REMOTE);
  rec(app);
  const n = env.speech.startCalls.length;
  assert.equal(n, 1);
  env.speech.end(); env.scheduler.advance(2000);
  assert.equal(env.speech.startCalls.length, n + 1);
  assert.equal(hasProcLocally(env.speech.startCalls.at(-1)), false);
  assert.equal(env.speech.startCalls.at(-1).lang, 'ja-JP');
});

test('NFR-BG-001 AC-064 異常系: 一時停止・停止した後の自動終了では再開されず、再開操作（同意の操作は不要）で再び開始される', async () => {
  const { app, env } = await boot(REMOTE);
  rec(app);
  app.commands['session.pause']();
  const n = env.speech.startCalls.length;
  env.speech.end(); env.scheduler.advance(60 * 1000);
  assert.equal(env.speech.startCalls.length, n, '一時停止後は自動再開しない');
  app.commands['session.resume']();
  assert.equal(env.speech.startCalls.length, n + 1, '再開操作で開始される');
});

test('NFR-BG-001 AC-064 異常系: 選択言語が未対応になった（言語を替えた）後の自動終了では再開されない', async () => {
  const { app, env } = await boot({ availability: { 'ja-JP': 'local', 'en-US': 'unsupported' } });
  rec(app); await app.startSpeech();
  app.setLang('en');
  const n = env.speech.startCalls.length;
  env.speech.end(); env.scheduler.advance(10 * 1000);
  assert.equal(env.speech.startCalls.length, n);
});
