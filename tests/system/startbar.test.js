// FR-072 AC-384 AC-385 AC-386 AC-387 AC-394 / FR-073 AC-388 AC-389 / FR-074 AC-390 AC-391 AC-392 AC-393
// 契約: tests/system/CONTRACT.md「記録開始での音声開始の集約・最上部の取り込み・パネルの自動表示」。期待値は受入基準だけから決める。
// AC-387・AC-391・AC-392・AC-394 は検証レベル integration だが、同じ契約の app で確かめられるのでここに置く。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, FakeSpeech, PARAM } from './helpers.js';

const LOCAL = { availability: { 'ja-JP': 'local', 'en-US': 'local' } };
const REMOTE = { processLocally: false, availability: { 'ja-JP': 'remote', 'en-US': 'remote' } };
const boot = (opts = {}, over = {}) => newApp({ speech: new FakeSpeech(opts), ...over });
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const cmd = async (app, name) => { const r = app.commands[name](); await flush(); return r; };
const hasProcLocally = (o) => Object.prototype.hasOwnProperty.call(o ?? {}, 'processLocally');
const item = (app, command) => app.getCommandBar().items.find((i) => i.command === command);
const inputVisible = (app) => app.getLayout().panels.input.visible;
const MB = PARAM.MAX_FILE_MB * 1024 * 1024;
const narrow = (over = {}) => ({ options: { env: { webgl: true, reducedMotion: false, viewportWidth: 500 } }, ...over });

// ---------------- FR-072 ----------------
// FR-072 AC-384
test('FR-072 AC-384: 準備中に [記録開始] を 1 回操作すると、セッションが記録中になり同時に音声認識が開始される', async () => {
  const { app, env } = await boot(LOCAL);
  assert.equal(app.getState().session, 'preparing');
  await cmd(app, 'session.start');
  assert.equal(app.getState().session, 'recording');
  assert.equal(env.speech.startCalls.length, 1, '1 回の操作で音声認識も開始する');
  assert.equal(env.speech.startCalls[0].lang, 'ja-JP');
});

test('FR-072 AC-384: 音声認識の開始だけを行う別のボタン・操作（[音声開始]・マイクの開始）が存在しない', async () => {
  const { app } = await boot(LOCAL);
  const bad = /speech\.start|mic|voice|音声開始/i;
  assert.deepEqual(app.getCommandBar().items.filter((i) => bad.test(i.command) || bad.test(i.label)).map((i) => i.command), []);
  assert.equal(app.commands['speech.start'], undefined);
  assert.deepEqual(app.keymap.filter((k) => bad.test(k.command)).map((k) => k.command), []);
  assert.ok(item(app, 'session.start'), '[記録開始] は存在する');
});

test('FR-072 AC-384 異常系: 音声認識 API が使えない環境でも [記録開始] で記録中になるが、音声認識は開始されない', async () => {
  const { app, env } = await boot({ supported: false });
  await cmd(app, 'session.start');
  assert.equal(app.getState().session, 'recording');
  assert.equal(env.speech.startCalls.length, 0);
  assert.equal(app.getSpeechStatus().state, 'unavailable');
});

// FR-072 AC-385
test('FR-072 AC-385: 外部送信の可能性がある環境では、同意のチェックと説明が最上部の [記録開始] の直近に、同意の前（準備中）から表示される', async () => {
  const { app } = await boot(REMOTE);
  assert.equal(app.getState().session, 'preparing');
  assert.equal(app.getCommandBar().position, 'top');
  const c = app.getConsentUi();
  assert.equal(c.visible, true);
  assert.equal(c.region, 'top');
  assert.equal(c.nearCommand, 'session.start');
  assert.equal(c.noticeVisible, true);
  assert.ok(c.label.trim().length > 0);
  assert.match(c.notice, /外部/);
  assert.equal(c.checked, false);
});

test('FR-072 AC-385: 同意のチェックと説明は認識文字列パネルの中には置かれない', async () => {
  const { app } = await boot(REMOTE);
  const html = app.renderTranscript();
  assert.doesNotMatch(html, /type="checkbox"|role="(switch|checkbox)"/);
  assert.ok(!html.includes(app.getConsentUi().notice), 'パネルに同意の説明を含めない');
  assert.ok(!html.includes(app.getConsentUi().label));
});

test('FR-072 AC-385 異常系: デバイス内処理が使える環境では同意のチェックも説明も表示されない', async () => {
  const { app } = await boot(LOCAL);
  for (const s of [[], ['session.start'], ['session.start', 'session.pause']]) {
    for (const c of s) app.commands[c]();
    assert.equal(app.getConsentUi().visible, false);
    assert.equal(app.getConsentUi().noticeVisible, false);
  }
});

// FR-072 AC-386
test('FR-072 AC-386: 未同意のまま [記録開始] を操作すると、記録中になるが音声認識は開始されず、同意待ちの理由と同意すれば始まる旨が出る', async () => {
  const { app, env } = await boot(REMOTE);
  await cmd(app, 'session.start');
  assert.equal(app.getState().session, 'recording');
  assert.equal(env.speech.startCalls.length, 0);
  assert.equal(app.getSpeechStatus().reason, 'consent');
  assert.equal(app.getCommandBar().status.speech, 'consent');
  const m = app.getState().message;
  assert.ok(m && m.text.trim().length > 0, '理由が表示される');
  assert.match(m.text, /同意/);
});

test('FR-072 AC-386: 記録中に同意のチェックを入れると音声認識が開始され、同意を外すと停止してセッションは記録中のまま', async () => {
  const { app, env } = await boot(REMOTE);
  await cmd(app, 'session.start');
  app.setSpeechConsent(true); await flush();
  assert.equal(env.speech.startCalls.length, 1);
  assert.equal(env.speech.startCalls[0].lang, 'ja-JP');
  assert.equal(hasProcLocally(env.speech.startCalls[0]), false);
  assert.equal(app.getState().session, 'recording');
  const stops = env.speech.stopCalls;
  app.setSpeechConsent(false); await flush();
  assert.ok(env.speech.stopCalls > stops, '同意を外すと停止する');
  assert.equal(app.getState().session, 'recording');
  assert.equal(env.speech.startCalls.length, 1, '同意を外しても再開しない');
});

test('FR-072 AC-386 異常系: 同意前は認識結果が届いても発話にならず、同意待ちの間は一度も音声認識を開始しない', async () => {
  const { app, env } = await boot(REMOTE);
  await cmd(app, 'session.start');
  env.speech.emit('同意前の音声', true);
  env.scheduler.advance(3000);
  assert.equal(env.speech.startCalls.length, 0);
  assert.equal(app.getState().session, 'recording');
});

// FR-072 AC-387
test('FR-072 AC-387: 同意のチェックはキーボードで操作でき、状態が文字で伝わり（色だけにしない）、役割を持つ', async () => {
  const { app } = await boot(REMOTE);
  const c = app.getConsentUi();
  assert.ok(['switch', 'checkbox'].includes(c.role));
  assert.equal(c.tabbable, true);
  assert.equal(c.colorOnly, false);
  const off = c.stateText;
  assert.ok(off.trim().length > 0);
  app.setSpeechConsent(true);
  const on = app.getConsentUi();
  assert.equal(on.checked, true);
  assert.notEqual(on.stateText, off, '同意の状態が文字で変わる');
  assert.equal(on.colorOnly, false);
});

test('FR-072 AC-387: 文言と説明は選択中の表示言語に従い、切替後に再読込を要さない', async () => {
  const { app } = await boot(REMOTE);
  app.setLang('ja'); const ja = app.getConsentUi();
  app.setLang('en'); const en = app.getConsentUi();
  assert.notEqual(en.label, ja.label);
  assert.notEqual(en.notice, ja.notice);
  assert.match(en.notice, /external/i);
  assert.match(ja.notice, /外部/);
});

test('FR-072 AC-387 異常系: 同意状態は保存せず、再読込（同じ storage で再生成）後は未同意に戻る', async () => {
  const { app, env, createApp } = await boot(REMOTE);
  app.setSpeechConsent(true);
  assert.equal(app.getSpeechConsent(), true);
  assert.ok(!JSON.stringify(env.storage.dump()).includes('consent'), '同意を保存しない');
  const app2 = await createApp(env.options);
  assert.equal(app2.getSpeechConsent(), false);
  assert.equal(app2.getConsentUi().checked, false);
});

// FR-072 AC-394
test('FR-072 AC-394: (a) 一時停止で音声認識は停止し、停止でも音声認識は行われない', async () => {
  const { app, env } = await boot(REMOTE);
  app.setSpeechConsent(true);
  await cmd(app, 'session.start');
  assert.equal(env.speech.startCalls.length, 1);
  let stops = env.speech.stopCalls;
  await cmd(app, 'session.pause');
  assert.ok(env.speech.stopCalls > stops, '一時停止で停止する');
  stops = env.speech.stopCalls;
  await cmd(app, 'session.stop');
  assert.equal(env.speech.startCalls.length, 1, '停止で開始しない');
  assert.equal(app.getState().session, 'stopped');
});

test('FR-072 AC-394: (b) 同意済みなら、再開・停止後の再記録の [記録開始] で音声認識が再び開始される（改めて同意は不要）', async () => {
  const { app, env } = await boot(REMOTE);
  app.setSpeechConsent(true);
  await cmd(app, 'session.start');
  await cmd(app, 'session.pause');
  await cmd(app, 'session.resume');
  assert.equal(env.speech.startCalls.length, 2);
  assert.equal(app.getSpeechConsent(), true);
  await cmd(app, 'session.stop');
  await cmd(app, 'session.start');
  assert.equal(app.getState().session, 'recording');
  assert.equal(env.speech.startCalls.length, 3);
});

test('FR-072 AC-394: (b) 未同意なら再開・再記録でも開始されず、同意待ちと同意すれば始まる旨が表示される', async () => {
  const { app, env } = await boot(REMOTE);
  await cmd(app, 'session.start');
  await cmd(app, 'session.pause');
  await cmd(app, 'session.resume');
  assert.equal(env.speech.startCalls.length, 0);
  assert.equal(app.getSpeechStatus().reason, 'consent');
  assert.match(app.getState().message.text, /同意/);
  await cmd(app, 'session.stop');
  await cmd(app, 'session.start');
  assert.equal(env.speech.startCalls.length, 0);
  assert.match(app.getState().message.text, /同意/);
  app.setSpeechConsent(true); await flush();
  assert.equal(env.speech.startCalls.length, 1);
});

test('FR-072 AC-394: (b) 復元直後は再読込後のため未同意で、再開しても開始されず、同意すれば始まる', async () => {
  const { app, env, createApp } = await boot(REMOTE);
  app.setSpeechConsent(true);
  await cmd(app, 'session.start');
  app.setDraft('復元の元'); app.submitDraft();
  const speech2 = new FakeSpeech(REMOTE);
  const app2 = await createApp({ ...env.options, speechSource: speech2 });
  assert.equal(app2.getState().session, 'paused');
  assert.equal(app2.getSpeechConsent(), false);
  await cmd(app2, 'session.resume');
  assert.equal(speech2.startCalls.length, 0);
  assert.equal(app2.getSpeechStatus().reason, 'consent');
  app2.setSpeechConsent(true); await flush();
  assert.equal(speech2.startCalls.length, 1);
});

test('FR-072 AC-394: (c) 同意のチェックと説明は記録中以外（準備中・一時停止・停止）でも表示され、変更しても音声認識は開始されない', async () => {
  const { app, env } = await boot(REMOTE);
  const states = [[], ['session.start', 'session.pause'], ['session.stop']];
  for (const step of states) {
    for (const c of step) await cmd(app, c);
    assert.notEqual(app.getState().session, 'recording');
    const c = app.getConsentUi();
    assert.equal(c.visible, true, app.getState().session);
    assert.equal(c.noticeVisible, true);
    app.setSpeechConsent(true); await flush();
    assert.equal(app.getConsentUi().checked, true);
    app.setSpeechConsent(false); await flush();
    assert.equal(app.getConsentUi().checked, false);
  }
  assert.equal(env.speech.startCalls.length, 0, '記録中以外の変更では開始しない');
});

test('FR-072 AC-394 異常系: デバイス内処理が使える環境では記録中以外でも同意のチェックは表示されず、一時停止で停止する', async () => {
  const { app, env } = await boot(LOCAL);
  await cmd(app, 'session.start');
  const stops = env.speech.stopCalls;
  await cmd(app, 'session.pause');
  assert.equal(app.getConsentUi().visible, false);
  assert.ok(env.speech.stopCalls > stops);
  await cmd(app, 'session.stop');
  assert.equal(app.getConsentUi().visible, false);
});

// ---------------- FR-073 ----------------
// FR-073 AC-388
test('FR-073 AC-388: 最上部に取り込みのアイコン・名称・説明（.txt・.vtt）が常時表示され、認識文字列パネルの中には取込の操作がない', async () => {
  const { app } = await boot(LOCAL);
  assert.equal(app.getCommandBar().position, 'top');
  const it = item(app, 'import.file');
  assert.ok(it, '取り込みが最上部のコマンドバーにある');
  assert.ok(it.icon && String(it.icon).trim().length > 0);
  assert.equal(it.label, '取り込み');
  assert.equal(it.descriptionVisible, true, 'ホバー・フォーカスを待たず常に表示');
  assert.match(it.description, /\.txt/);
  assert.match(it.description, /\.vtt/);
  const html = app.renderTranscript();
  assert.doesNotMatch(html, /type="file"|import\.file/);
});

test('FR-073 AC-388: 名称・説明は選択中の表示言語に従い、切替後に再読み込みを要さない', async () => {
  const { app } = await boot(LOCAL);
  const ja = { ...item(app, 'import.file') };
  app.setLang('en');
  const en = item(app, 'import.file');
  assert.notEqual(en.label, ja.label);
  assert.ok(en.label.trim().length > 0 && !/[\u3040-\u30ff\u4e00-\u9fff]/.test(en.label), '英語表示では英語の名称');
  assert.notEqual(en.description, ja.description);
  assert.match(en.description, /\.txt/); assert.match(en.description, /\.vtt/);
  assert.equal(en.descriptionVisible, true);
  app.setLang('ja');
  assert.equal(item(app, 'import.file').label, '取り込み');
});

test('FR-073 AC-388 異常系: 認識文字列パネルを非表示にしても最上部の取り込みは残る', async () => {
  const { app } = await boot(LOCAL);
  app.setPanelVisible('input', false);
  const it = item(app, 'import.file');
  assert.ok(it); assert.equal(it.descriptionVisible, true);
});

// FR-073 AC-389
const STATES = { preparing: [], recording: ['session.start'], paused: ['session.start', 'session.pause'], stopped: ['session.start', 'session.stop'] };
const txt = '一行目\n二行目\n';
const txtFile = { name: 'm.txt', type: 'text/plain', size: Buffer.byteLength(txt), text: txt };
const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v A>一件目</v>\n\n00:00:03.000 --> 00:00:04.000\n<v B>二件目</v>\n';
const vttFile = { name: 'm.vtt', type: 'text/vtt', size: vtt.length, text: vtt };
for (const [state, steps] of Object.entries(STATES)) {
  test(`FR-073 AC-389: 認識文字列パネルが非表示でも、${state} に .txt・.vtt を取り込め、各行が確定結果として並び、セッションの状態は変わらない`, async () => {
    const { app } = await boot(LOCAL);
    for (const c of steps) await cmd(app, c);
    app.setPanelVisible('input', false);
    const s0 = app.getState().session;
    const r1 = await app.importTextFile(txtFile);
    const r2 = await app.importTextFile(vttFile);
    assert.equal(r1.ok, true); assert.equal(r2.ok, true);
    assert.equal(app.getState().session, s0);
    assert.deepEqual(app.getTranscript().finals.map((f) => f.text), ['一行目', '二行目', '一件目', '二件目']);
    assert.deepEqual(app.getState().utterances.map((u) => u.text), ['一行目', '二行目', '一件目', '二件目']);
    assert.equal(inputVisible(app), false, '取込でパネルは自動表示されない');
  });
}

test('FR-073 AC-389 異常系: 上限（PARAM-003）超過・.txt/.vtt でないファイルは受け付けず、一覧も状態も不変。ちょうど上限は受け付ける', async () => {
  const { app } = await boot(LOCAL);
  await cmd(app, 'session.start');
  await app.importTextFile(txtFile);
  const before = JSON.stringify([app.getState().utterances, app.getTranscript().finals, app.getState().session]);
  const big = await app.importTextFile({ name: 'big.txt', type: 'text/plain', size: MB + 1, text: '超過' });
  const bad = await app.importTextFile({ name: 'a.png', type: 'image/png', size: 5, text: 'x' });
  assert.equal(big.ok, false); assert.equal(bad.ok, false);
  assert.equal(JSON.stringify([app.getState().utterances, app.getTranscript().finals, app.getState().session]), before);
  assert.equal((await app.importTextFile({ name: 'edge.txt', type: 'text/plain', size: MB, text: '境界' })).ok, true);
});

test('FR-073 AC-389: 取り込みはキーボードで操作でき（tabbable）、アイコンだけに頼らずアクセシブルな名前を持つ', async () => {
  const { app } = await boot(LOCAL);
  const it = item(app, 'import.file');
  assert.equal(it.tabbable, true);
  assert.ok(it.accessibleName && it.accessibleName.trim().length > 0);
  assert.ok(it.accessibleName.includes(it.label), 'アクセシブルな名前に名称の文字を含む');
  assert.ok(it.tooltip && it.tooltip.text.trim().length > 0);
});

// ---------------- FR-074 ----------------
// FR-074 AC-390
test('FR-074 AC-390: パネルを隠した状態で [記録開始] により音声認識が開始されると、認識文字列パネルが自動で表示される', async () => {
  const { app } = await boot(LOCAL);
  app.setPanelVisible('input', false);
  assert.equal(inputVisible(app), false);
  await cmd(app, 'session.start');
  assert.equal(inputVisible(app), true);
});

test('FR-074 AC-390: 同意後の開始・再開による開始でも自動表示され、表示済みのときは表示のまま変わらない', async () => {
  const { app } = await boot(REMOTE);
  await cmd(app, 'session.start');
  app.setPanelVisible('input', false);
  app.setSpeechConsent(true); await flush();
  assert.equal(inputVisible(app), true, '同意後の開始');
  await cmd(app, 'session.pause');
  app.setPanelVisible('input', false);
  await cmd(app, 'session.resume');
  assert.equal(inputVisible(app), true, '再開による開始');
  const before = JSON.stringify(app.getLayout());
  await cmd(app, 'session.pause'); await cmd(app, 'session.resume');
  assert.equal(JSON.stringify(app.getLayout()), before, '表示済みならレイアウトは変わらない');
});

// FR-074 AC-391
test('FR-074 AC-391: 画面幅が狭く（タブ・積み重ね）ても、音声認識の開始で認識文字列パネルの内容が見える位置に出て、入力中の文字列・選択シーン・記録中は失われない', async () => {
  const { app, env } = await boot(LOCAL, narrow());
  assert.notEqual(app.getPanelPresentation().mode, 'columns', '狭い画面では積み重ね・タブ');
  app.commands['session.start'](); await flush();
  app.setDraft('1 件目'); app.submitDraft(); env.tick(1);
  app.commands['session.nextScene'](); app.setDraft('2 件目'); app.submitDraft();
  const sid = app.getState().scenes[0].id;
  app.selectScene(sid);
  await cmd(app, 'session.pause');
  app.setActivePanelTab('diagram');
  app.setPanelVisible('input', false);
  app.setDraft('入力途中');
  await cmd(app, 'session.resume');
  const v = app.getPanelPresentation();
  assert.ok(v.inView.includes('input'));
  if (v.mode === 'tabs') assert.equal(v.activeTab, 'input');
  assert.equal(app.getState().input.draft, '入力途中');
  assert.equal(app.getState().selectedSceneId, sid);
  assert.equal(app.getState().session, 'recording');
});

// FR-074 AC-392
test('FR-074 AC-392: 同意待ち・非対応・言語未対応で音声認識が開始されなかったときは、パネルは自動表示されない', async () => {
  for (const opts of [REMOTE, { supported: false }, { availability: { 'ja-JP': 'unsupported', 'en-US': 'unsupported' } }]) {
    const { app, env } = await boot(opts);
    app.setPanelVisible('input', false);
    await cmd(app, 'session.start');
    assert.equal(env.speech.startCalls.length, 0);
    assert.equal(inputVisible(app), false, JSON.stringify(opts));
  }
});

test('FR-074 AC-392: ファイル取込・手入力だけのときはパネルは自動表示されない', async () => {
  const { app, env } = await boot({ supported: false });
  app.setPanelVisible('input', false);
  await cmd(app, 'session.start');
  app.setDraft('手入力'); app.submitDraft();
  await app.importTextFile(txtFile);
  env.scheduler.advance(3000);
  assert.equal(inputVisible(app), false);
});

test('FR-074 AC-392: 自動表示の後に利用者が非表示にしたら、結果を受けても次に音声認識が開始されるまで再表示されない', async () => {
  const { app, env } = await boot(LOCAL);
  app.setPanelVisible('input', false);
  await cmd(app, 'session.start');
  assert.equal(inputVisible(app), true);
  app.setPanelVisible('input', false);
  env.speech.emit('暫定', false); env.speech.emit('確定の発話', true);
  app.setDraft('手入力'); app.submitDraft();
  await app.importTextFile(txtFile);
  env.scheduler.advance(3000);
  assert.equal(inputVisible(app), false, '再表示されない');
  await cmd(app, 'session.pause');
  assert.equal(inputVisible(app), false);
  await cmd(app, 'session.resume');
  assert.equal(inputVisible(app), true, '次の開始で再び表示される');
});

// FR-074 AC-393
test('FR-074 AC-393: 自動表示は保存された利用者のレイアウトを書き換えず、音声認識を開始せずに再読込すると保存済みのとおり（非表示）に復元される', async () => {
  const { app, env, createApp } = await boot(LOCAL);
  app.setPanelVisible('input', false);
  const saved = env.storage.getItem('grp.layout');
  assert.ok(saved, '利用者の非表示は保存されている');
  await cmd(app, 'session.start');
  assert.equal(inputVisible(app), true);
  assert.equal(env.storage.getItem('grp.layout'), saved, '自動表示で grp.layout を書き換えない');
  const app2 = await createApp({ ...env.options, speechSource: new FakeSpeech(LOCAL) });
  assert.equal(app2.getLayout().panels.input.visible, false, '再読込で保存済みのレイアウトに戻る');
});

test('FR-074 AC-393 異常系: 利用者が表示のまま保存したレイアウトは、自動表示後の再読込でも表示のまま。壊れた保存値でも起動する', async () => {
  const { app, env, createApp } = await boot(LOCAL);
  app.setPanelVisible('input', true);
  await cmd(app, 'session.start');
  const app2 = await createApp({ ...env.options, speechSource: new FakeSpeech(LOCAL) });
  assert.equal(app2.getLayout().panels.input.visible, true);
  env.storage.setItem('grp.layout', '{壊れた');
  const app3 = await createApp({ ...env.options, speechSource: new FakeSpeech(LOCAL) });
  assert.ok(app3.getLayout().panels.input);
});
