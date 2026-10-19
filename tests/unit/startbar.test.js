// FR-072 AC-384 AC-385 AC-386 AC-387 AC-394 / FR-073 AC-388 AC-389 / FR-074 AC-390 AC-391 AC-392 AC-393 の単体・結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';

function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
class Fake {
  constructor(avail) { this.avail = avail; this.supported = true; this.startCalls = []; this.stopCalls = 0; }
  availabilityFor() { return this.avail; }
  start(o) { this.startCalls.push(o); }
  stop() { this.stopCalls++; }
}
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
async function boot(avail, over = {}) {
  const speech = new Fake(avail);
  const storage = over.storage ?? mem();
  const app = await createApp({ storage, speechSource: speech, scheduler: { setTimeout: () => 0, clearTimeout: () => {} }, ...over });
  return { app, speech, storage };
}
const cmd = async (app, n) => { app.commands[n](); await flush(); };

test('FR-072 AC-384: [記録開始] 1 回で記録中になり音声認識も開始、音声だけの開始操作は無い', async () => {
  const { app, speech } = await boot('local');
  await cmd(app, 'session.start');
  assert.equal(app.getState().session, 'recording');
  assert.equal(speech.startCalls.length, 1);
  assert.equal(app.commands['speech.start'], undefined);
  assert.ok(!app.keymap.some((k) => k.command === 'speech.start' || k.command === 'speech.stop'));
});

test('FR-072 AC-385 AC-387: 同意は最上部の [記録開始] の直近・準備中から見え、パネルには含まれず、文言は言語に従う', async () => {
  const { app } = await boot('remote');
  const c = app.getConsentUi();
  assert.deepEqual([c.visible, c.noticeVisible, c.region, c.nearCommand, c.checked, c.tabbable], [true, true, 'top', 'session.start', false, true]);
  assert.ok(!app.renderTranscript().includes(c.notice));
  app.setLang('en');
  assert.match(app.getConsentUi().notice, /external/i);
  assert.notEqual(app.getConsentUi().stateText, '');
});

test('FR-072 AC-386 AC-394: 未同意の記録開始は開始せず同意待ち。同意で開始、再開でも同意状態は引き継がれる', async () => {
  const { app, speech } = await boot('remote');
  await cmd(app, 'session.start');
  assert.equal(speech.startCalls.length, 0);
  assert.equal(app.getSpeechStatus().reason, 'consent');
  assert.match(app.getState().message.text, /同意/);
  app.setSpeechConsent(true); await flush();
  assert.equal(speech.startCalls.length, 1);
  await cmd(app, 'session.pause');
  assert.ok(speech.stopCalls >= 1);
  await cmd(app, 'session.resume');
  assert.equal(speech.startCalls.length, 2);
  await cmd(app, 'session.stop');
  assert.equal(app.getConsentUi().visible, true, '停止中も表示');
  await cmd(app, 'session.start');
  assert.equal(speech.startCalls.length, 3);
});

test('FR-073 AC-388 AC-389: 取り込みは最上部のコマンドバーにアイコン・説明つきで常時表示、パネルを隠しても状態によらず取込める', async () => {
  const { app } = await boot('local');
  const it = app.getCommandBar().items.find((i) => i.command === 'import.file');
  assert.ok(it.icon && it.description.includes('.txt') && it.description.includes('.vtt'));
  assert.equal(it.descriptionVisible, true);
  assert.ok(it.accessibleName.includes(it.label));
  assert.doesNotMatch(app.renderTranscript(), /type="file"/);
  app.setPanelVisible('input', false);
  const r = await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: 4, text: 'あ\nい' });
  assert.equal(r.ok, true);
  assert.equal(app.getState().session, 'preparing');
  assert.equal(app.getLayout().panels.input.visible, false);
});

test('FR-074 AC-390 AC-392 AC-393: 開始でパネルを一時表示、開始しないとき・保存済みレイアウトは不変', async () => {
  const { app, storage, speech } = await boot('local');
  app.setPanelVisible('input', false);
  const saved = storage.getItem('grp.layout');
  await cmd(app, 'session.start');
  assert.equal(app.getLayout().panels.input.visible, true);
  assert.equal(storage.getItem('grp.layout'), saved);
  app.setPanelVisible('input', false);
  assert.equal(app.getLayout().panels.input.visible, false);
  await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: 1, text: 'x' });
  assert.equal(app.getLayout().panels.input.visible, false);
  const app2 = await createApp({ storage, speechSource: new Fake('local') });
  assert.equal(app2.getLayout().panels.input.visible, false);
  assert.equal(speech.startCalls.length, 1);
});

test('FR-074 AC-391 AC-392: 同意待ちでは表示しない。狭い画面ではタブの input が選ばれ、入力中の文字は保たれる', async () => {
  const r = await boot('remote');
  r.app.setPanelVisible('input', false);
  await cmd(r.app, 'session.start');
  assert.equal(r.app.getLayout().panels.input.visible, false);
  const { app } = await boot('local', { env: { viewportWidth: 500 } });
  assert.equal(app.getPanelPresentation().mode, 'tabs');
  await cmd(app, 'session.start');
  await cmd(app, 'session.pause');
  app.setActivePanelTab('diagram');
  app.setDraft('途中');
  await cmd(app, 'session.resume');
  const p = app.getPanelPresentation();
  assert.deepEqual([p.activeTab, p.inView], ['input', ['input']]);
  assert.equal(app.getState().input.draft, '途中');
  assert.equal(app.getState().session, 'recording');
});
