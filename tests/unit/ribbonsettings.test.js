// FR-030 AC-519 AC-520 / FR-084 AC-482 / NFR-UX-011 AC-459（単体・結合）: リボンの「設定」グループと、［設定］の「接続キー」分類。
// 契約: tests/system/CONTRACT-RIBBON-SETTINGS.md。System Test: tests/system/ribbon-settings.test.js・apikeys.test.js・cmdgroups.test.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const mk = () => createApp({ env: {}, storage: mem(), speechSource: { processLocally: true, start() {}, stop() {} } });
const item = (app, c) => app.getCommandBar().items.find((i) => i.command === c);

// FR-030 AC-519
test('FR-030 AC-519: リボンの値のある項目は［設定］の同じ項目と値が一致し、不正な値は受け付けずメッセージで示す', async () => {
  const app = await mk();
  app.commands['settings.open']();
  const f = (id) => app.getSettingsDialog().fields.find((x) => x.id === id);
  assert.equal(app.operateBarItem('sound.setVolume', 30).ok, true);
  assert.equal(item(app, 'sound.setVolume').value, 30); assert.equal(f('sound.volume').value, 30); assert.equal(app.getRpgAudio().volume, 30);
  assert.equal(app.operateBarItem('sound.toggleMute', true).ok, true);
  assert.equal(item(app, 'sound.toggleMute').value, true); assert.equal(f('sound.muted').value, true);
  assert.equal(app.operateBarItem('settings.layoutMode', 'auto').ok, true);
  assert.equal(item(app, 'settings.layoutMode').value, 'auto'); assert.equal(f('layout.mode').value, 'auto');
  assert.equal(app.operateBarItem('arrange.setInterval', 25).ok, true);
  assert.equal(item(app, 'arrange.setInterval').value, 25); assert.equal(f('arrange.interval').value, 25);
  for (const bad of [-1, 101, 'abc', NaN, null, 1.5]) { assert.equal(app.operateBarItem('sound.setVolume', bad).ok, false, String(bad)); assert.equal(item(app, 'sound.setVolume').value, 30); }
  assert.ok(app.getState().message.text.trim());
  assert.equal(app.operateBarItem('settings.layoutMode', 'nope').ok, false);
  assert.equal(app.operateBarItem('drawStyle.pick', 'nope').ok, false);
  assert.equal(app.operateBarItem('no.such').ok, false);
});

// FR-030 AC-520 / NFR-UX-011 AC-459
test('FR-030 AC-520 / NFR-UX-011 AC-459: 9 グループで接続キーのグループがなく、設定グループは［設定］と 4 項目、各グループ 12 個以内', async () => {
  const app = await mk();
  const groups = app.getCommandBar().groups;
  assert.deepEqual(groups.map((g) => g.id), ['import', 'session', 'view', 'layoutType', 'settings', 'presentation', 'export', 'data', 'environment']);
  assert.ok(groups.every((g) => g.commands.length <= 12));
  assert.deepEqual(groups.find((g) => g.id === 'settings').commands, ['settings.open', 'settings.layoutMode', 'sound.toggleMute', 'sound.setVolume', 'arrange.setInterval']);
  assert.ok(!app.getCommandBar().items.some((i) => /^apiKeys\./.test(i.command)));
  const icons = app.getCommandBar().items.map((i) => i.icon);
  assert.equal(new Set(icons).size, icons.length, 'アイコンの重複なし');
});

// FR-084 AC-482
test('FR-084 AC-482: ［設定］の分類に「接続キー」があり、選ぶと接続キー画面が出て、閉じると［設定］ごと閉じる', async () => {
  const app = await mk();
  app.commands['settings.open']();
  const c = app.getSettingsDialog().categories.find((x) => x.id === 'apiKeys');
  assert.equal(c.label, '接続キー'); assert.ok(c.icon && c.description && c.descriptionVisible);
  assert.equal(app.getApiKeysDialog(), null);
  assert.equal(app.selectSettingsCategory('apiKeys').ok, true);
  assert.ok(app.getApiKeysDialog());
  assert.equal(app.selectSettingsCategory('general').ok, true);
  assert.equal(app.getApiKeysDialog(), null);
  app.commands['apiKeys.open']();
  assert.ok(app.getApiKeysDialog());
  app.commands['settings.close']();
  assert.equal(app.getApiKeysDialog(), null); assert.equal(app.getSettingsDialog(), null);
});
