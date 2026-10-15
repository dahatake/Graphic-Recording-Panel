// FR-030 AC-149 AC-151（System Test。契約: tests/system/CONTRACT.md「レイアウト型・描画スタイル・設定画面」）
// 期待値は受入基準だけから決める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newApp, seedThreeScenes, keyFor, WEB, CJK } from './helpers.js';

const weight = (s) => [...s].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.5), 0);
const snap = (app) => { const s = app.getState(); return JSON.stringify([s.utterances.map((u) => u.text), s.scenes, s.selectedSceneId, s.session, s.input.draft]); };
const field = (app, id) => app.getSettingsDialog().fields.find((f) => f.id === id);

// FR-030 AC-149
test('FR-030 AC-149: 初めて起動したとき［設定］画面は初期値（固定のタイムライン・手書き調）で表示される', async () => {
  const { app } = await newApp();
  assert.equal(app.getSettingsDialog(), null);
  assert.deepEqual(app.getSettings(), { layout: { mode: 'fixed', types: ['timeline'] }, drawStyle: 'handwritten' });
  app.commands['settings.open']();
  const d = app.getSettingsDialog();
  assert.ok(d && d.open === true);
  assert.deepEqual(d.fields.map((f) => f.id).sort(), ['drawStyle', 'layout.mode', 'layout.types']);
  assert.equal(field(app, 'layout.mode').value, 'fixed');
  assert.deepEqual(field(app, 'layout.types').value, ['timeline']);
  assert.equal(field(app, 'drawStyle').value, 'handwritten');
});

test('FR-030 AC-149: 既定のレイアウト（自動／固定と型）と描画スタイルを選ぶと図に反映され、内容・選択・入力中の内容・記録中の状態は失われない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.selectScene(app.getState().scenes[1].id);
  app.setDraft('入力中の文字');
  app.commands['settings.open']();
  const before = snap(app);
  assert.ok(app.setSettings({ layout: { mode: 'fixed', types: ['zone', 'bubble'] } }).ok);
  assert.deepEqual(app.getLayoutInfo().selected, ['zone', 'bubble']);
  assert.equal(app.getLayoutInfo().source, 'fixed');
  assert.match(app.renderSvg(), /data-layout-head="zone"/);
  assert.deepEqual(field(app, 'layout.types').value, ['zone', 'bubble']);
  assert.ok(app.setSettings({ drawStyle: 'simple' }).ok);
  assert.equal(app.getDrawStyle(), 'simple');
  assert.match(app.renderSvg(), /data-draw-style="simple"/);
  assert.ok(app.setSettings({ layout: { mode: 'auto' } }).ok);
  assert.equal(app.getLayoutInfo().source, 'auto');
  assert.equal(field(app, 'layout.mode').value, 'auto');
  assert.equal(snap(app), before);
  assert.equal(app.getState().session, 'recording');
});

test('FR-030 AC-149 異常系: 固定で型が空・未知の型・未知のスタイルは拒否され、設定・図は変わらない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const s0 = JSON.stringify(app.getSettings()); const svg0 = app.renderSvg();
  for (const bad of [{ layout: { mode: 'fixed', types: [] } }, { layout: { mode: 'fixed', types: ['nosuch'] } }, { layout: { mode: 'other' } }, { drawStyle: 'nosuch' }, { drawStyle: '' }]) {
    let r; try { r = app.setSettings(bad); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  assert.equal(JSON.stringify(app.getSettings()), s0);
  assert.equal(app.renderSvg(), svg0);
});

test('FR-030 AC-149: 手動の型の選択は設定の既定より優先され、設定を変えても手動は保たれる', async () => {
  const { app } = await newApp();
  app.setLayoutTypes(['diverge']);
  app.setSettings({ layout: { mode: 'fixed', types: ['zone'] } });
  assert.deepEqual(app.getLayoutInfo().selected, ['diverge']);
  app.clearManualLayout();
  assert.deepEqual(app.getLayoutInfo().selected, ['zone']);
});

// FR-030 AC-151
test('FR-030 AC-151: ［設定］画面はキーボードとコマンドの検索から少ない手順で開け、Esc で閉じ、ボタンに名称ラベル・ツールチップがある', async () => {
  const { app } = await newApp();
  assert.ok(keyFor(app, 'settings.open'), 'キー割り当てがある');
  assert.equal(app.handleKey(keyFor(app, 'settings.open')), 'settings.open');
  const d = app.getSettingsDialog();
  assert.ok(d && d.role === 'dialog' && d.label.trim());
  assert.equal(app.handleKey({ key: 'Escape' }), 'settings.close');
  assert.equal(app.getSettingsDialog(), null);
  const btn = app.getCommandBar().items.find((i) => i.command === 'settings.open');
  assert.ok(btn && btn.label.trim() && weight(btn.label) <= 6 && btn.tooltip.text.trim());
  assert.ok(app.searchCommands(btn.label).some((x) => x.command === 'settings.open'), 'コマンド検索で見つかる');
  app.commands['settings.open'](); app.commands['settings.close']();
  assert.equal(app.getSettingsDialog(), null);
});

test('FR-030 AC-151: 各項目のラベルは PARAM-011（6 文字）以内で、英語に切り替えても同様', async () => {
  const { app } = await newApp();
  app.commands['settings.open']();
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    for (const f of app.getSettingsDialog().fields) assert.ok(f.label.trim() && weight(f.label) <= 6, `${lang}: ${f.id}「${f.label}」`);
  }
});

test('FR-030 AC-151: 変更の結果は画面の読み上げ対象のメッセージで示される', async () => {
  const { app } = await newApp();
  app.commands['settings.open']();
  app.setSettings({ drawStyle: 'anime' });
  const label = app.getDrawStyles().find((s) => s.id === 'anime').label;
  assert.ok(app.getState().message.text.includes(label));
  assert.equal(app.getCommandBar().status.role, 'status');
  app.setSettings({ layout: { mode: 'fixed', types: ['bubble'] } });
  assert.ok(app.getState().message.text.trim());
});

test('FR-030 AC-151: 画面が狭くても（NFR-UX-001）すべての項目が欠けずに使える', async () => {
  const { app } = await newApp();
  app.commands['settings.open']();
  const wide = app.getSettingsView({ viewportWidth: 1280 });
  for (const w of [320, 480, 640]) {
    const v = app.getSettingsView({ viewportWidth: w });
    assert.deepEqual(v.fields.map((f) => f.id), wide.fields.map((f) => f.id), `${w}px: 項目が欠けない`);
    assert.ok(v.fields.every((f) => f.visible === true), `${w}px: すべて表示`);
  }
  assert.equal(wide.fields.length, 3);
});

test('FR-030 AC-151: 静的な画面に設定画面（id="settings-dialog"）があり、文言キーは ja と en で同一集合', async () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.ok(/id=["']settings-dialog["']/.test(html), 'settings-dialog がある');
  assert.ok(/role=["']dialog["']|<dialog/.test(html), 'dialog の役割がある');
  const { app } = await newApp();
  const keys = () => Object.keys(app.getStrings()).filter((k) => /^(settings|layoutType|drawStyle)\./.test(k)).sort();
  const ja = keys(); app.setLang('en'); const en = keys();
  assert.ok(ja.length > 0); assert.deepEqual(en, ja);
});
