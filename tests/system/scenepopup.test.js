// FR-024 AC-123 AC-124 AC-125（System Test。契約: tests/system/CONTRACT.md「オブジェクト選択のポップアップ」）
// AC-126 は検証レベル integration のため対象外。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from './helpers.js';

async function seeded() {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  toDetail(app); // 手順: 既定の「大項目」では 2D にシーンが描かれないため、「詳細」へ切り替えてからシーンを選択する（AC-123。トピックの選択は AC-137）
  assert.equal(app.getState().scenes.length, 3);
  return { app, env };
}
const sceneOf = (app, i) => app.getState().scenes[i];

for (const mode of ['2d', '3d']) {
  test(`FR-024 AC-123: ${mode} の図でオブジェクトを選択すると、そのシーンの見出しと要点がポップアップとして描画される`, async () => {
    const { app } = await seeded();
    app.setViewMode(mode);
    assert.equal(app.getScenePopup(), null, '選択前はポップアップがない');
    const s = sceneOf(app, 0);
    app.selectScene(s.id);
    const p = app.getScenePopup();
    assert.ok(p && p.open === true);
    assert.equal(p.sceneId, s.id);
    assert.equal(p.heading, s.heading);
    assert.deepEqual(p.points.map((x) => x.text), s.points.map((x) => x.text));
    assert.ok(p.html.includes(s.heading));
    for (const pt of s.points) assert.ok(p.html.includes(pt.text));
  });
}

test('FR-024 AC-123: 別のオブジェクトを選択するとポップアップの内容がそのシーンのものに切り替わる', async () => {
  const { app } = await seeded();
  app.selectScene(sceneOf(app, 0).id);
  app.selectScene(sceneOf(app, 2).id);
  const s = sceneOf(app, 2);
  const p = app.getScenePopup();
  assert.equal(p.sceneId, s.id);
  assert.equal(p.heading, s.heading);
  assert.ok(!p.html.includes(sceneOf(app, 0).heading) || sceneOf(app, 0).heading === s.heading);
  for (const pt of s.points) assert.ok(p.html.includes(pt.text));
});

test('FR-024 AC-123 異常系: 存在しないシーンの選択ではポップアップは開かない（開いていれば変わらない）', async () => {
  const { app } = await seeded();
  app.selectScene('no-such-scene');
  assert.equal(app.getScenePopup(), null);
  const s = sceneOf(app, 1);
  app.selectScene(s.id);
  app.selectScene('no-such-scene');
  assert.equal(app.getScenePopup()?.sceneId, s.id);
});

test('FR-024 AC-123 異常系: シーンが 0 件のとき選択してもポップアップは出ない', async () => {
  const { app } = await newApp();
  app.commands['session.start']();
  app.selectScene('x');
  assert.equal(app.getScenePopup(), null);
});

test('FR-024 AC-124: 選択の解除・Esc キー・外側の操作のいずれでもポップアップが閉じる', async () => {
  const { app } = await seeded();
  const id = sceneOf(app, 1).id;
  app.selectScene(id);
  app.selectScene(null);
  assert.equal(app.getScenePopup(), null, '選択の解除');
  assert.equal(app.getState().selectedSceneId, null);

  app.selectScene(id);
  assert.equal(app.handleKey({ key: 'Escape' }), 'popup.close');
  assert.equal(app.getScenePopup(), null, 'Esc');

  app.selectScene(id);
  app.popupOutside();
  assert.equal(app.getScenePopup(), null, '外側の操作');
});

test('FR-024 AC-124: 開閉しても選択中のシーン・入力中の文字列・表示モード・レイアウト・図は失われない', async () => {
  const { app } = await seeded();
  const id = sceneOf(app, 1).id;
  app.setDraft('入力中の文字');
  app.selectScene(id);
  const snap = () => JSON.stringify([app.getState().selectedSceneId, app.getState().input.draft,
    app.getDisplayMode(), app.getLayout(), app.renderSvg(), app.getState().scenes]);
  const before = snap();
  app.handleKey({ key: 'Escape' });
  assert.equal(app.getScenePopup(), null);
  assert.equal(snap(), before, 'Esc で閉じても何も失われない');
  app.commands['popup.open']();
  assert.equal(app.getScenePopup()?.sceneId, id, '選択中のシーンで開き直せる');
  app.popupOutside();
  assert.equal(snap(), before, '外側の操作で閉じても何も失われない');
});

test('FR-024 AC-124 異常系: ポップアップが開いていないときの Esc は何も変えない', async () => {
  const { app } = await seeded();
  app.selectScene(sceneOf(app, 0).id);
  app.popupOutside();
  const before = JSON.stringify(app.getState());
  const r = app.handleKey({ key: 'Escape' });
  assert.notEqual(r, 'popup.close');
  assert.equal(JSON.stringify(app.getState()), before);
});

test('FR-024 AC-125: キーボードだけで、選択・ポップアップを開く・内容へ移る・閉じる操作ができる', async () => {
  const { app } = await seeded();
  for (const c of ['scene.next', 'scene.prev', 'popup.open', 'popup.focusContent', 'popup.close']) {
    assert.equal(typeof app.commands[c], 'function', c);
    assert.ok(app.keymap.some((k) => k.command === c), `${c} は keymap に割り当てがある`);
  }
  app.commands['scene.next']();
  const first = app.getState().selectedSceneId;
  assert.ok(first, 'キーボードでシーンが選択される');
  app.commands['scene.next']();
  assert.notEqual(app.getState().selectedSceneId, first);
  app.commands['scene.prev']();
  assert.equal(app.getState().selectedSceneId, first);
  app.commands['popup.close']();
  assert.equal(app.getScenePopup(), null);
  app.commands['popup.open']();
  assert.equal(app.getScenePopup()?.sceneId, first);
  app.commands['popup.focusContent']();
  assert.equal(app.getScenePopup().focused, true);
  app.handleKey({ key: 'Escape' });
  assert.equal(app.getScenePopup(), null);
});

test('FR-024 AC-125: ポップアップの内容は画面の読み上げ対象（役割と名前を持つ）で、ドラッグを要しない', async () => {
  const { app } = await seeded();
  const s = sceneOf(app, 0);
  app.selectScene(s.id);
  const p = app.getScenePopup();
  assert.ok(['dialog', 'region', 'tooltip'].includes(p.role));
  assert.ok(p.label && p.label.length > 0);
  assert.ok(!/draggable/i.test(p.html), 'ドラッグを要する操作がない');
});

test('FR-024 AC-125 異常系: シーンが選ばれていないとき popup.open・popup.focusContent は何も開かない', async () => {
  const { app } = await seeded();
  app.commands['popup.open']();
  app.commands['popup.focusContent']();
  assert.equal(app.getScenePopup(), null);
});
