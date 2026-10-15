// FR-027 AC-141 / FR-029 AC-147 AC-148 / FR-030 AC-150 の単体・結合テスト（レイアウト型レジストリ・描画スタイルの登録構造・設定の保存）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, makeEnv, seedThreeScenes, toDetail } from '../system/helpers.js';
import { createDrawStyleRegistry, validateStyle } from '../../web/src/drawstyles.js';
import { createLayoutTypeRegistry, validTypeList, timelineLayout, LAYOUT_TYPE_IDS } from '../../web/src/layouttypes.js';

const NEW_STYLE = { id: 'chalk', label: { ja: 'チョーク調', en: 'Chalk' }, line: { width: 1.2, jitter: 0.5 }, fill: { mode: 'tint' }, text: { decor: 'bold', icons: true } };

// FR-029 AC-148: 定義を 1 つ足すだけで選択肢に現れる
test('FR-029 AC-148: スタイルの定義を 1 つ追加すると選択肢に現れ、選べる。組込みの 3 つは変わらない', () => {
  const reg = createDrawStyleRegistry();
  assert.deepEqual(reg.ids(), ['handwritten', 'anime', 'simple']);
  assert.deepEqual(reg.register(NEW_STYLE), { ok: true });
  assert.deepEqual(reg.ids(), ['handwritten', 'anime', 'simple', 'chalk']);
  assert.equal(reg.label('chalk', 'en'), 'Chalk');
  assert.ok(reg.has('chalk'));
});

// FR-029 AC-148 異常系: 重複・欠けた定義は加えられず、既存は影響を受けない
test('FR-029 AC-148: 名前が重複する定義・名前が空・線／塗り／文字の飾りが欠けた定義は加えられない', () => {
  const reg = createDrawStyleRegistry();
  const before = JSON.stringify(reg.list());
  const bads = [
    { ...NEW_STYLE, id: 'anime' }, { ...NEW_STYLE, id: '' }, { ...NEW_STYLE, id: '   ' }, { ...NEW_STYLE, id: 3 },
    { ...NEW_STYLE, label: '' }, { ...NEW_STYLE, line: undefined }, { ...NEW_STYLE, line: { width: 0, jitter: 0 } }, { ...NEW_STYLE, line: { width: 1 } },
    { ...NEW_STYLE, fill: undefined }, { ...NEW_STYLE, fill: { mode: 'x' } }, { ...NEW_STYLE, text: undefined }, { ...NEW_STYLE, text: { decor: 'bold' } }, null, 'chalk', [],
  ];
  for (const b of bads) assert.equal(reg.register(b).ok, false, JSON.stringify(b));
  assert.equal(JSON.stringify(reg.list()), before);
  assert.equal(validateStyle(NEW_STYLE).ok, true);
  assert.equal(reg.get('anime').fill.mode, 'tint', '既存の定義は上書きされない');
});

test('FR-029 AC-148: アプリの拡張点（api.registerDrawStyle・options.drawStyles）から足すと設定・選択に現れ、図に使われる', async () => {
  const { app, env } = await newApp({ options: { drawStyles: [NEW_STYLE] } });
  assert.ok(app.getDrawStyles().some((s) => s.id === 'chalk'));
  await seedThreeScenes(app, env);
  assert.ok(app.setDrawStyle('chalk').ok);
  assert.match(app.renderSvg(), /data-draw-style="chalk"/);
  assert.equal(app.registerDrawStyle({ ...NEW_STYLE, id: 'chalk' }).ok, false);
  assert.equal(app.registerDrawStyle({ ...NEW_STYLE, id: 'later' }).ok, true);
  assert.ok(app.setSettings({ drawStyle: 'later' }).ok);
  assert.equal(app.getDrawStyle(), 'later');
});

// FR-029 AC-147: 見た目の規定
test('FR-029 AC-147: 手書き調は揺らぎがあり同じ入力から同じ図、アニメ調・シンプルは揺らぎがなく、シンプルは絵記号を抑える。保存（SVG）にも反映される', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  const hand = app.renderSvg(); assert.equal(app.renderSvg(), hand, '同じ入力から毎回同じ図形');
  app.setDrawStyle('anime'); const anime = app.renderSvg();
  app.setDrawStyle('simple'); const simple = app.renderSvg();
  const icons = (s) => (s.match(/aria-hidden="true"/g) || []).length;
  assert.ok(icons(anime) === icons(hand) && icons(simple) < icons(hand), '絵記号: アニメ調は維持・シンプルは抑える');
  assert.ok(/stroke-width="4"/.test(hand) || /stroke-width="2.5"/.test(hand));
  assert.ok(/stroke-width="4\.0|stroke-width="6|stroke-width="3\.2/.test(anime), '太めの輪郭線');
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(`${hand}${anime}${simple}`), '外部へのリクエストなし');
  app.setDrawStyle('anime');
  await app.commands['save.svg']();
  assert.match(env.downloads.at(-1).data, /data-draw-style="anime"/);
});

// FR-027 AC-139〜141: レジストリ（未実装の型はタイムライン相当）
test('FR-027 AC-139: 5 つの型が登録され、未実装の型はタイムライン相当の配置にフォールバックし、型の実装を足せる', () => {
  const reg = createLayoutTypeRegistry();
  assert.deepEqual(reg.ids(), ['timeline', 'bubble', 'diverge', 'zone', 'metaphor']);
  for (const id of LAYOUT_TYPE_IDS) { assert.equal(reg.isImplemented(id), false); assert.equal(reg.layoutFor(id), timelineLayout); }
  const impl = () => ({ marker: 1 });
  assert.deepEqual(reg.register('zone', { layout: impl }), { ok: true });
  assert.equal(reg.layoutFor('zone'), impl); assert.equal(reg.layoutFor('bubble'), timelineLayout);
  assert.equal(reg.register('nosuch', { layout: impl }).ok, false);
  assert.ok(validTypeList(['zone', 'bubble'], reg));
  for (const bad of [[], ['x'], ['zone', 'zone'], null, 'zone']) assert.equal(validTypeList(bad, reg), false);
});

// FR-027 AC-141: 切替で内容・選択・記録中の状態・詳細度が保たれ、3D・テキスト一覧・ポップアップは影響を受けない
test('FR-027 AC-141: 型を切り替えても内容・選択・記録中の状態・詳細度が保たれ、3D・テキスト一覧・ポップアップは変わらず、要点は文字でも確認できる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.setDetailLevel('middle');
  app.selectScene(app.getState().scenes[1].id);
  const snap = () => { const s = app.getState(); return JSON.stringify([s.utterances, s.scenes, s.selectedSceneId, s.session, s.viewMode, app.getDetailLevel(), app.get3D(), app.renderOutline(), app.getScenePopup()]); };
  const base = snap();
  for (const id of LAYOUT_TYPE_IDS) { assert.ok(app.setLayoutTypes([id]).ok); assert.equal(snap(), base, id); }
  app.setLayoutTypes(['zone', 'bubble', 'metaphor']);
  assert.equal(snap(), base);
  for (const s of app.getState().scenes) for (const p of s.points) assert.ok(app.renderOutline().includes(p.text), '要点は文字でも確認できる');
});

// FR-030 AC-150: 保存・復元・手動の優先・初期化とセッションファイルの対象外
test('FR-030 AC-150: 設定はブラウザ内に保存され再読込後に復元され、初期化・セッションファイルでは変わらない。壊れた保存値は初期値になる', async () => {
  const { createApp } = await newApp();
  const env = makeEnv();
  const app = await createApp(env.options);
  app.setSettings({ layout: { mode: 'fixed', types: ['zone', 'bubble'] }, drawStyle: 'simple' });
  assert.ok(env.storage.getItem('grp.settings'));
  const app2 = await createApp(env.options);
  assert.deepEqual(app2.getSettings(), { layout: { mode: 'fixed', types: ['zone', 'bubble'] }, drawStyle: 'simple' });
  assert.deepEqual(app2.getLayoutInfo().selected, ['zone', 'bubble']);
  assert.equal(app2.getDrawStyle(), 'simple');
  app2.setLayoutTypes(['diverge']);
  assert.deepEqual(app2.getSettings().layout.types, ['zone', 'bubble'], '手動の選択は設定に書かれない');
  assert.ok(!/diverge/.test(env.storage.getItem('grp.settings')));
  app2.clearSavedSession();
  assert.ok(env.storage.getItem('grp.settings'));
  // 壊れた保存値・未知の値は初期値
  env.storage.setItem('grp.settings', '{"layout":{"mode":"fixed","types":["nosuch"]},"drawStyle":"nosuch"}');
  const app3 = await createApp(env.options);
  assert.deepEqual(app3.getSettings(), { layout: { mode: 'fixed', types: ['timeline'] }, drawStyle: 'handwritten' });
  env.storage.setItem('grp.settings', '{broken');
  assert.deepEqual((await createApp(env.options)).getSettings().layout.mode, 'fixed');
});

test('FR-030 AC-150: データの初期化（FR-018）でも設定は変わらず、セッションファイルには設定を含めず手動の現在値だけを含む', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.setSettings({ layout: { mode: 'fixed', types: ['zone'] }, drawStyle: 'anime' });
  app.setLayoutTypes(['bubble']); app.setDrawStyle('simple');
  await app.commands['file.save']();
  const data = JSON.parse(env.downloads.at(-1).data);
  assert.deepEqual(data.layoutTypes, ['bubble']); assert.equal(data.drawStyle, 'simple');
  assert.ok(!('settings' in data) && !JSON.stringify(data).includes('"mode"'));
  app.commands['data.reset'](); await app.dialogAction('confirm');
  assert.deepEqual(app.getSettings(), { layout: { mode: 'fixed', types: ['zone'] }, drawStyle: 'anime' });
  assert.equal(app.getLayoutInfo().manual, false);
  assert.deepEqual(app.getLayoutInfo().selected, ['zone']);
  assert.equal(app.getDrawStyle(), 'anime');
});
