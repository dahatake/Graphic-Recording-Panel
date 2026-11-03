// FR-030 AC-648（System Test。契約: tests/system/CONTRACT-RIBBON-SETTINGS.md「講演向けの初期値（AC-648）」）
// 依頼 2026-11-03: 「講演向けの初期値にする」の操作を 1 回行うと、既定のレイアウトが「自動」になり、型は FR-028 の規則（AC-143）で選ばれ、
// 共通配置（FR-036 AC-166・AC-167）が適用される。ほかの状態は変わらない。期待値は受入基準だけから決める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from './helpers.js';
import { withNetSpy } from './jpfont-util.js';

const CMD = 'settings.talkPreset';
const LABEL = '講演向けの初期値にする';
// 空白区切りの語を 2 語以上共有するシーンが同じトピック（PARAM-015）。順序の語・ビジョンの語は含めない（AC-143 の区画の入力）。
const TWO_TOPICS = [['予算 コスト 見直し 必要'], ['予算 コスト 削減 検討'], ['リリース 計画 決定 日程'], ['リリース 計画 担当 確認']];
const ONE_TOPIC = [['データ 分析 結果 確認'], ['データ 分析 方法 共有']];
const VISION = [['ビジョン 共有 全体 方針'], ['ビジョン 共有 今後 展望']];
const TITLE = { series: '講演シリーズ', theme: '予算とリリース', date: '2026-11-03', venue: '大ホール' };

async function seed(app, env, groups) {
  app.commands['session.start']();
  groups.forEach((g, i) => {
    g.forEach((t) => { app.setDraft(t); app.submitDraft(); env.tick(1); });
    if (i < groups.length - 1) app.commands['session.nextScene']();
  });
}
const info = (app) => app.getLayoutInfo();
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const snap = (app) => {
  const s = app.getState();
  return JSON.stringify([s.utterances.map((u) => u.text), s.scenes, s.selectedSceneId, s.session, s.input.draft, app.getDetailLevel(), app.getDrawStyle(), app.getRpgAudio().volume, app.getArrangeInterval().sec]);
};

// FR-030 AC-648 AC-143 AC-166 AC-167（型は AC-143 の結果だけで選ばれる。区画は AC-143 の入力が区画の条件を満たすから選ばれるのであって、講演の規則ではない）
test('FR-030 AC-648: 操作 1 回で既定のレイアウトが「自動」になり、型は AC-143 の結果（この入力はトピック 2 つが連続した区間なので区画）で選ばれ、タイトル欄を含む共通配置が適用され、ほかの状態は変わらない', async () => {
  const { app, env } = await newApp();
  await seed(app, env, TWO_TOPICS);
  app.setTitleInfo(TITLE);
  app.setDetailLevel('detail'); app.setSettings({ drawStyle: 'simple' });
  app.selectScene(app.getState().scenes[1].id); app.setDraft('入力中の文字');
  // 操作の前は従来の表示（固定のタイムライン）のまま
  assert.deepEqual(app.getSettings().layout, { mode: 'fixed', types: ['timeline'] });
  assert.equal(info(app).head, 'timeline');
  // 操作が［設定］画面とリボンの両方にある
  app.commands['settings.open']();
  const d = app.getSettingsDialog();
  const act = (d.actions || []).find((a) => a.command === CMD);
  assert.ok(act, '［設定］画面に操作がある');
  assert.equal(act.label, LABEL);
  const bar = app.getCommandBar().items.find((i) => i.command === CMD);
  assert.ok(bar, 'リボンに操作がある');
  assert.ok([bar.accessibleName, bar.tooltip?.text, bar.description].some((t) => String(t || '').includes(LABEL)), 'リボンの項目も「講演向けの初期値にする」と分かる');
  app.commands['settings.close']();
  const before = snap(app);
  // 1 回の操作（型を選ぶための追加の操作は 0 回）
  const r = app.commands[CMD]();
  assert.ok(r === undefined || r === true || r.ok !== false, '操作は成功する');
  assert.equal(app.getSettings().layout.mode, 'auto');
  assert.equal(info(app).source, 'auto');
  assert.equal(info(app).manual, false);
  assert.equal(info(app).head, 'zone', 'AC-143: トピック 2 つ・各トピックが連続した区間・ビジョンの語なし → 区画（講演専用の優先ではなく AC-143 の結果）');
  assert.match(app.renderSvg(), /data-layout-head="zone"/);
  // 共通配置（AC-166・AC-167）: タイトル欄が左上、本編と重ならず、各まとまりに小見出しと外枠
  const L = app.getDiagramLayout();
  assert.equal(L.title.visible, true);
  assert.ok(L.groups.length >= 1);
  for (const g of L.groups) { assert.ok(g.heading.trim()); assert.ok(g.frame.w > 0 && g.frame.h > 0); assert.ok(!overlap(g.frame, L.title)); assert.ok(g.frame.x >= L.title.x && g.frame.y >= L.title.y); }
  // 描画スタイル・詳細度・内容・選択・入力中・記録中は変わらない
  assert.equal(snap(app), before);
  assert.equal(app.getState().session, 'recording');
  assert.equal(app.getDrawStyle(), 'simple');
  assert.equal(app.getDetailLevel(), 'detail');
  // リボンからの操作でも同じ結果（2 回目。冪等）
  assert.equal(app.operateBarItem(CMD).ok, true);
  assert.equal(app.getSettings().layout.mode, 'auto');
  assert.equal(snap(app), before);
});

test('FR-030 AC-648 異常系・境界: 図の型は AC-143 の規則の結果で選ばれ（講演専用の規則を持たない）、トピックが 1 つ・シーン 0 件でも失敗せずエラーにならない', async () => {
  // トピック 1 つ・順序語なし → 発散（区画にならない）
  let ctx = await newApp();
  await seed(ctx.app, ctx.env, ONE_TOPIC);
  assert.equal(ctx.app.commands[CMD]() === false, false);
  assert.equal(info(ctx.app).source, 'auto');
  assert.equal(info(ctx.app).head, 'diverge', '区画でも講演専用の型でもなく AC-143 の結果');
  // ビジョンの語 → 比喩テンプレート
  ctx = await newApp();
  await seed(ctx.app, ctx.env, VISION);
  ctx.app.commands[CMD]();
  assert.equal(info(ctx.app).head, 'metaphor');
  // 順序の語 → タイムライン
  ctx = await newApp();
  await seed(ctx.app, ctx.env, [['まず 現状 整理 確認'], ['次に 対策 検討 共有']]);
  ctx.app.commands[CMD]();
  assert.equal(info(ctx.app).head, 'timeline');
  assert.ok(!['talk', 'lecture', 'speech'].includes(info(ctx.app).head), '講演専用の型は新設されない');
  // シーン 0 件: 失敗せず設定だけが自動になり、図にまとまりはない
  ctx = await newApp();
  const r = ctx.app.commands[CMD]();
  assert.ok(r === undefined || r === true || r.ok !== false);
  assert.equal(ctx.app.getSettings().layout.mode, 'auto');
  assert.equal(ctx.app.getDiagramLayout().groups.length, 0);
  assert.equal(ctx.app.getState().session !== 'recording', true, '操作で記録は始まらない');
});

// FR-027 AC-139 AC-140 と AC-150 の優先順位
test('FR-030 AC-648: 手動の型の選択（FR-027）は操作の前後とも優先され、手動を解除すると自動選択の結果（AC-143 でこの入力は区画）になる', async () => {
  const { app, env } = await newApp();
  await seed(app, env, TWO_TOPICS);
  // 操作の前の手動
  assert.ok(app.setLayoutTypes(['bubble']).ok);
  app.commands[CMD]();
  assert.equal(app.getSettings().layout.mode, 'auto');
  assert.equal(info(app).manual, true, '手動は保たれる');
  assert.deepEqual(info(app).selected, ['bubble']);
  assert.equal(info(app).head, 'bubble');
  assert.ok(app.clearManualLayout().ok);
  assert.equal(info(app).source, 'auto');
  assert.equal(info(app).head, 'zone', '手動を外すと既定（自動）の結果');
  // 操作の後の手動
  assert.ok(app.setLayoutTypes(['diverge']).ok);
  assert.equal(info(app).head, 'diverge');
  assert.deepEqual(info(app).selected, ['diverge']);
});

// FR-030 AC-150 と同じ保存・外部リクエスト 0 件
test('FR-030 AC-648: 操作の結果はブラウザ内に保存され再読込後も保たれ、操作をしない端末（保存なし）は従来の表示のまま。外部へのリクエストは 0 件', async () => {
  const calls = await withNetSpy(async () => {
    const { app, env, createApp } = await newApp();
    await seed(app, env, TWO_TOPICS);
    app.commands[CMD]();
    app.commands['settings.open'](); app.commands['settings.close']();
    const again = await createApp({ ...env.options });
    assert.equal(again.getSettings().layout.mode, 'auto', '再読込後も自動');
    assert.equal(again.getLayoutInfo().source, 'auto');
    // 初期値（固定のタイムライン・手書き調）は変わらず、操作をしない新しい保存先では従来の表示
    const fresh = await newApp();
    assert.deepEqual(fresh.app.getSettings(), { layout: { mode: 'fixed', types: ['timeline'] }, drawStyle: 'handwritten' });
  });
  assert.deepEqual(calls, [], '外部へのリクエスト 0 件');
});
