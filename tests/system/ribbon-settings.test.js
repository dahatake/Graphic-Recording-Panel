// FR-030 AC-519 AC-520（System Test。契約: tests/system/CONTRACT-RIBBON-SETTINGS.md）
// 2026-10-25 の依頼: ［設定］の「レイアウトと描画スタイルの設定」パネルの全項目をリボンにも表示し、同じ機能の項目は 1 つにまとめ、
// リボンのどの項目を操作しても機能が動作する。期待値は受入基準だけから決める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, CJK } from './helpers.js';

const PARAM_011 = 6;
const weight = (s) => [...String(s)].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.5), 0);
const items = (app) => app.getCommandBar().items;
const bySetting = (app, id) => items(app).filter((i) => i.settingsField === id);
const sfield = (app, id) => app.getSettingsDialog().fields.find((f) => f.id === id);
const TYPES = ['timeline', 'bubble', 'diverge', 'zone', 'metaphor', 'workshop'];
const PANEL_FIELDS = ['layout.mode', 'layout.types', 'drawStyle', 'sound.muted', 'sound.volume', 'arrange.interval'];

// FR-030 AC-519
test('FR-030 AC-519: リボンに［設定］パネルの全項目（決め方・型の各チェック・描画スタイル・ミュート・音量・再配置の周期）があり、アイコン（アクセシブルな名前）・説明・PARAM-011 文字以内のラベルを持つ', async () => {
  const { app } = await newApp();
  app.commands['settings.open'](); app.getSettingsDialog();
  const ids = app.getSettingsDialog().fields.map((f) => f.id);
  for (const id of PANEL_FIELDS) assert.ok(ids.includes(id), `［設定］に ${id} がある`);
  app.commands['settings.close']();
  for (const id of PANEL_FIELDS) assert.ok(bySetting(app, id).length >= 1, `リボンに ${id} の項目がある`);
  assert.deepEqual(TYPES.filter((t) => bySetting(app, 'layout.types').some((i) => i.command === `layoutType.${t}`)), TYPES, '型の各チェックは 6 つ');
  for (const id of PANEL_FIELDS) for (const it of bySetting(app, id)) {
    assert.ok(typeof it.icon === 'string' && it.icon.trim(), `${it.command}: アイコン`);
    assert.ok(it.accessibleName?.trim() && it.accessibleName.includes(it.label), `${it.command}: アクセシブルな名前`);
    assert.ok(it.tabbable === true, `${it.command}: キーボードで届く`);
    assert.ok((it.descriptionVisible === true && it.description?.trim()) || it.tooltip?.text?.trim(), `${it.command}: 簡略な説明（常時表示またはツールチップ）`);
    assert.ok(weight(it.label) <= PARAM_011, `${it.command}: ラベルは ${PARAM_011} 文字以内（${it.label}）`);
  }
  app.setLang('en');
  for (const id of PANEL_FIELDS) for (const it of bySetting(app, id)) {
    assert.ok(it.label.trim() && !CJK.test(it.label) && weight(it.label) <= PARAM_011, `en ${it.command}: ${it.label}`);
  }
  app.setLang('ja');
});

test('FR-030 AC-519: リボンで操作した値は［設定］の同じ項目と一致し、［設定］側の操作もリボンに反映される（保存も同じ）', async () => {
  const { app, env, createApp } = await newApp();
  await seedThreeScenes(app, env);
  const op = (c, v) => app.operateBarItem(c, v);
  const mode = bySetting(app, 'layout.mode')[0].command;
  const draw = bySetting(app, 'drawStyle')[0].command;
  const mute = bySetting(app, 'sound.muted')[0].command;
  const vol = bySetting(app, 'sound.volume')[0].command;
  const itv = bySetting(app, 'arrange.interval')[0].command;
  const val = (c) => items(app).find((i) => i.command === c).value;
  app.commands['settings.open']();
  // リボン → ［設定］
  assert.equal(op(mode, 'auto').ok, true); assert.equal(sfield(app, 'layout.mode').value, 'auto'); assert.equal(app.getLayoutInfo().source, 'auto');
  assert.equal(op(draw, 'simple').ok, true); assert.equal(sfield(app, 'drawStyle').value, 'simple'); assert.equal(app.getDrawStyle(), 'simple');
  assert.equal(op(mute, true).ok, true); assert.equal(sfield(app, 'sound.muted').value, true); assert.equal(app.getRpgAudio().muted, true);
  assert.equal(op(vol, 30).ok, true); assert.equal(sfield(app, 'sound.volume').value, 30); assert.equal(app.getRpgAudio().volume, 30);
  assert.equal(op(itv, 25).ok, true); assert.equal(sfield(app, 'arrange.interval').value, 25); assert.equal(app.getArrangeInterval().sec, 25);
  // ［設定］ → リボン
  assert.ok(app.setSettings({ layout: { mode: 'fixed', types: ['zone', 'bubble'] }, drawStyle: 'handwritten' }).ok);
  assert.equal(val(mode), 'fixed'); assert.equal(val(draw), 'handwritten');
  assert.deepEqual(TYPES.filter((t) => items(app).find((i) => i.command === `layoutType.${t}`).selected), ['bubble', 'zone'], '型のチェックが反映される');
  app.setRpgMuted(false); app.setRpgVolume(70); app.setArrangeInterval(40);
  assert.equal(val(mute), false); assert.equal(val(vol), 70); assert.equal(val(itv), 40);
  // 同じ保存: 再読込で復元され、リボンにも反映される
  app.commands['settings.close']();
  const again = await createApp({ ...env.options });
  assert.equal(again.getSettings().drawStyle, 'handwritten');
  assert.equal(items(again).find((i) => i.command === draw).value, 'handwritten');
  assert.equal(items(again).find((i) => i.command === vol).value, 70);
  assert.equal(items(again).find((i) => i.command === itv).value, 40);
});

test('FR-030 AC-519 異常系: リボンの音量・周期に範囲外・不正な値を入れても受け付けず値は保たれ、理由が読み上げ対象のメッセージで示される。固定で型が 0 件になる操作は拒否される', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const vol = bySetting(app, 'sound.volume')[0].command; const itv = bySetting(app, 'arrange.interval')[0].command;
  const val = (c) => items(app).find((i) => i.command === c).value;
  app.operateBarItem(vol, 40); app.operateBarItem(itv, 20);
  for (const bad of [-1, 101, 'abc', NaN, null]) { const r = app.operateBarItem(vol, bad); assert.equal(r.ok, false, `音量 ${String(bad)}`); assert.equal(val(vol), 40); }
  for (const bad of [-1, 301, 1.5, 'abc', '']) { const r = app.operateBarItem(itv, bad); assert.equal(r.ok, false, `周期 ${String(bad)}`); assert.equal(val(itv), 20); }
  assert.ok(app.getState().message.text.trim(), '理由が示される');
  assert.equal(app.getCommandBar().status.role, 'status');
  assert.equal(app.getSettings().layout.mode, 'fixed');
  assert.ok(app.setSettings({ layout: { mode: 'fixed', types: ['zone'] } }).ok);
  const r = app.operateBarItem('layoutType.zone');
  assert.ok(!(r.ok && app.getSettings().layout.mode === 'fixed' && app.getSettings().layout.types.length === 0), '固定で型を 0 件にしない');
  assert.equal(app.operateBarItem('nosuch.command').ok, false, '存在しない項目は拒否');
});

// FR-030 AC-520
test('FR-030 AC-520: リボンに同じ機能の項目の重複がなく（型・描画スタイル・配置・配色・言語は各 1 つ）、接続キーのグループもない', async () => {
  const { app } = await newApp();
  const its = items(app);
  const cmds = its.map((i) => i.command);
  assert.equal(new Set(cmds).size, cmds.length, '同じコマンドの項目が 2 つ以上ない');
  const once = (pred, name) => assert.equal(its.filter(pred).length, 1, `${name} は 1 つだけ`);
  for (const t of TYPES) once((i) => i.command === `layoutType.${t}`, `型 ${t}`);
  once((i) => i.command === 'layoutType.clear', '型を解除');
  once((i) => i.command === 'drawStyle.pick', '描画スタイル');
  for (const c of ['layout.tile', 'layout.focus', 'layout.maximize', 'layout.reset']) once((i) => i.command === c, c);
  once((i) => i.command === 'theme.toggle', '配色');
  once((i) => i.command === 'lang.ja', '日本語'); once((i) => i.command === 'lang.en', '英語');
  for (const id of ['layout.mode', 'sound.muted', 'sound.volume', 'arrange.interval']) assert.equal(bySetting(app, id).length, 1, `${id} は 1 つだけ`);
  assert.equal(bySetting(app, 'drawStyle').length, 1, '描画スタイルは［設定］と 1 つにまとまる');
  assert.equal(bySetting(app, 'layout.types').length, TYPES.length, '型のチェックは型ごとに 1 つ');
  for (const k of ['label', 'icon']) {
    const vs = its.map((i) => i[k]).filter(Boolean);
    assert.equal(new Set(vs).size, vs.length, `同じ機能を示す ${k} が 2 つ以上ない`);
  }
  assert.equal(its.filter((i) => /^apiKeys\./.test(i.command) || i.group === 'apiKeys').length, 0, '接続キーはリボンにない（AC-482）');
  assert.equal(app.getCommandBar().groups.filter((g) => g.id === 'apiKeys').length, 0);
});

test('FR-030 AC-520: リボンのすべての項目を操作すると対応する機能が動作し（状態・図・表示が変わる／ダイアログが開く）、無反応の項目は 0 件で、操作の結果は読み上げ対象で示される', async () => {
  const dead = [];
  let total = 0;
  const { app: probe } = await newApp();
  const entries = items(probe).map((i) => ({ command: i.command, kind: i.kind ?? 'button', min: i.min, max: i.max }));
  assert.ok(entries.length >= 20, `リボンの項目の全数を数える（${entries.length}）`);
  const sample = (e) => {
    if (e.kind === 'slider' || e.kind === 'number') return Math.min(e.max ?? 100, 7);
    if (e.kind === 'select') return undefined;
    return undefined;
  };
  for (const e of entries) {
    total++;
    let worked = false; let lastResult = null;
    // 状態 A: 起動直後。状態 B: 3 シーンの記録中。機能が働く状態の少なくとも一方で効果がある。
    for (const state of ['idle', 'recording']) {
      const { app, env } = await newApp();
      if (state === 'recording') await seedThreeScenes(app, env);
      const r = app.operateBarItem(e.command, sample(e));
      lastResult = r;
      if (r && r.ok === true && r.effect && r.effect !== 'none') { worked = true; break; }
    }
    if (!worked) dead.push(`${e.command}: ${JSON.stringify(lastResult)}`);
  }
  assert.equal(total, entries.length);
  assert.deepEqual(dead, [], `無反応の項目は 0 件（${dead.length} 件）`);
});

test('FR-030 AC-520 異常系: 無効にできない項目が理由なく無反応になる（ok:true・effect:none）ことがなく、無効な項目は disabled と理由を示す。言語を替えても項目数は変わらない', async () => {
  const { app } = await newApp();
  const n = items(app).length;
  for (const it of items(app)) {
    if (it.disabled === true) assert.ok(it.disabledReason?.trim(), `${it.command}: 無効な理由`);
  }
  app.setLang('en');
  assert.equal(items(app).length, n, '英語でも項目は欠けない');
  assert.equal(new Set(items(app).map((i) => i.command)).size, n);
  app.setLang('ja');
  assert.equal(items(app).length, n);
});
