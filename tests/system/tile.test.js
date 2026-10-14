// FR-017 AC-083 AC-084 AC-085 AC-086（契約: getLayout の workArea/kind/mainPanel、layoutCommand、searchCommands、CONTRACT.md「パネルのタイル配置とフォーカス」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, keyFor } from './helpers.js';

const area = (r) => r.w * r.h;
function visiblePanels(app) {
  const l = app.getLayout();
  return { l, list: Object.entries(l.panels).filter(([, p]) => p.visible).map(([id, p]) => ({ id, ...p })) };
}
// 隙間なし: 作業領域内・重なりなし・面積の合計が作業領域に等しい
function assertTiled(app, msg = '') {
  const { l, list } = visiblePanels(app);
  const W = l.workArea.w; const H = l.workArea.h;
  let sum = 0;
  for (const p of list) {
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= W + 1e-6 && p.y + p.h <= H + 1e-6, `${msg} ${p.id} が作業領域内`);
    sum += area(p);
  }
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i]; const b = list[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    assert.ok(ox <= 1e-6 || oy <= 1e-6, `${msg} ${a.id} と ${b.id} が重ならない`);
  }
  assert.ok(Math.abs(sum - W * H) <= W * H * 1e-6, `${msg} 隙間がない（面積 ${sum} / ${W * H}）`);
}

// FR-017 AC-083
test('FR-017 AC-083: 既定のレイアウトとタイル配置への切替の直後、パネルが作業領域を隙間なく占める。非表示・再表示でも空きを埋める', async () => {
  const { app } = await newApp();
  assertTiled(app, '既定');
  app.movePanel('diagram', { x: 300, y: 200 });
  app.layoutCommand('tile');
  assert.equal(app.getLayout().kind, 'tile');
  assertTiled(app, 'タイル');
  app.setPanelVisible('outline', false); assertTiled(app, '非表示');
  app.setPanelVisible('input', false); assertTiled(app, '2 つ非表示');
  app.setPanelVisible('outline', true); app.setPanelVisible('input', true); assertTiled(app, '再表示');
});

test('FR-017 AC-083 異常系: 全パネルを非表示にしても例外にならず、1 つ戻すとそれが全領域を占める', async () => {
  const { app } = await newApp();
  for (const id of ['input', 'diagram', 'outline']) app.setPanelVisible(id, false);
  app.setPanelVisible('diagram', true);
  const { l, list } = visiblePanels(app);
  assert.equal(list.length, 1);
  assert.ok(Math.abs(area(list[0]) - l.workArea.w * l.workArea.h) < 1e-6);
});

// FR-017 AC-084
test('FR-017 AC-084: パネルを動かした後でも「タイル配置に整列」で隙間なく戻り、入力中の文字列・選択シーン・記録中の状態が保たれる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const sid = app.getState().scenes[1].id;
  app.selectScene(sid); app.setDraft('入力途中');
  app.movePanel('diagram', { x: 400, y: 300 }); app.resizePanel('outline', { w: 111, h: 77 }); app.movePanel('input', { x: 9, y: 500 });
  app.layoutCommand('tile');
  assertTiled(app, '整列後');
  assert.equal(app.getState().input.draft, '入力途中');
  assert.equal(app.getState().selectedSceneId, sid);
  assert.equal(app.getState().session, 'recording');
  assert.equal(app.getState().utterances.length, 4);
});

test('FR-017 AC-084 異常系: フォーカスや最大化の後でも整列で元のタイル配置に戻る', async () => {
  const { app } = await newApp();
  app.layoutCommand('tile'); const tile = JSON.stringify(app.getLayout().panels);
  app.layoutCommand('focus', 'outline'); app.layoutCommand('maximize', 'diagram');
  app.layoutCommand('tile');
  assert.equal(app.getLayout().kind, 'tile');
  assert.equal(JSON.stringify(app.getLayout().panels), tile);
});

// FR-017 AC-085
test('FR-017 AC-085: フォーカスでメインが 75%（PARAM-009）を占め、残りの表示中パネルは均等に分け合い、メインの入れ替えで同じ割合になる', async () => {
  const { app } = await newApp();
  app.movePanel('input', { x: 50, y: 50 });
  app.layoutCommand('focus', 'diagram');
  let l = app.getLayout(); const total = l.workArea.w * l.workArea.h;
  assert.equal(l.kind, 'focus'); assert.equal(l.mainPanel, 'diagram');
  assertTiled(app, 'フォーカス');
  const check = (main) => {
    const { list } = visiblePanels(app);
    assert.equal(list.length, 3, '全パネルが表示されたまま');
    const m = list.find((p) => p.id === main);
    assert.ok(Math.abs(area(m) / total - 0.75) <= 0.01, `メインの割合 ${area(m) / total}`);
    const others = list.filter((p) => p.id !== main).map(area);
    assert.ok(Math.abs(others[0] - others[1]) <= total * 0.01, '残りは均等');
  };
  check('diagram');
  app.layoutCommand('focus', 'outline');
  assert.equal(app.getLayout().mainPanel, 'outline');
  check('outline');
  app.setPanelVisible('input', false);
  app.layoutCommand('focus', 'diagram');
  const { list } = visiblePanels(app);
  assert.ok(Math.abs(area(list.find((p) => p.id === 'diagram')) / total - 0.75) <= 0.01, '2 パネルでもメインが 75%');
  assertTiled(app, '2 パネル');
});

test('FR-017 AC-085 異常系: 表示中が 1 つだけならそのパネルが全領域を占める。非表示のパネルをメインに指定してもレイアウトが壊れない', async () => {
  const { app } = await newApp();
  app.setPanelVisible('input', false); app.setPanelVisible('outline', false);
  app.layoutCommand('focus', 'diagram');
  const { l, list } = visiblePanels(app);
  assert.equal(list.length, 1);
  assert.ok(Math.abs(area(list[0]) - l.workArea.w * l.workArea.h) < 1e-6);
  try { app.layoutCommand('focus', 'nope'); } catch { /* 例外でも可 */ }
  assertTiled(app, '不正指定後');
});

// FR-017 AC-086
test('FR-017 AC-086: フォーカス・整列・最大化がキーボードとコマンドの検索から行え、現在のレイアウトの種類が表示され、移動にはドラッグなしの手段がある', async () => {
  const { app } = await newApp();
  for (const c of ['layout.tile', 'layout.focus', 'layout.maximize']) {
    assert.ok(keyFor(app, c), `${c} のキー割り当て`);
    assert.ok(typeof app.commands[c] === 'function', `${c} のコマンド`);
  }
  app.handleKey(keyFor(app, 'layout.focus'));
  assert.equal(app.getLayout().kind, 'focus');
  app.handleKey(keyFor(app, 'layout.maximize'));
  assert.equal(app.getLayout().kind, 'maximized');
  app.handleKey(keyFor(app, 'layout.tile'));
  assert.equal(app.getLayout().kind, 'tile');
  const found = app.searchCommands('フォーカス').map((x) => x.command);
  assert.ok(found.includes('layout.focus'), 'コマンドの検索でフォーカスが見つかる');
  assert.ok(app.searchCommands('最大化').some((x) => x.command === 'layout.maximize'));
  assert.ok(app.searchCommands('整列').some((x) => x.command === 'layout.tile') || app.searchCommands('タイル').some((x) => x.command === 'layout.tile'));
  const x0 = app.getLayout().panels.diagram.x;
  app.panelCommand('diagram', 'move-right');
  assert.notEqual(app.getLayout().panels.diagram.x, x0, 'ドラッグなしで移動できる');
});

test('FR-017 AC-086 異常系: 該当のないコマンド検索は空で、レイアウトを変えない', async () => {
  const { app } = await newApp();
  const before = JSON.stringify(app.getLayout());
  assert.deepEqual(app.searchCommands('存在しないコマンドzzz'), []);
  assert.equal(JSON.stringify(app.getLayout()), before);
});
