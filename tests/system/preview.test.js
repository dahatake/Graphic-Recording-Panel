// FR-101 AC-592（System Test。契約: tests/system/CONTRACT-P1.md §1）
// AC-593〜595 は検証レベル integration のため対象外。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from './helpers.js';

const PREVIEW_MS = 300; // PARAM-139

async function seeded() {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  toDetail(app);
  const scenes = app.getState().scenes;
  assert.equal(scenes.length, 3);
  return { app, env, scenes };
}
const target = (kind, id, surface) => ({ kind, id, surface });

for (const surface of ['diagram', 'list']) {
  test(`FR-101 AC-592: ${surface} のシーンにポインタを載せて ${PREVIEW_MS} ミリ秒止まるとプレビュー（見出し・種類のラベル・要確認の印）が出て、離すと消える`, async () => {
    const { app, env, scenes } = await seeded();
    const s = scenes[0];
    assert.equal(app.getPreview(), null, '載せる前はプレビューがない');
    assert.equal(app.hoverElement(target('scene', s.id, surface)).ok, true);
    env.scheduler.advance(PREVIEW_MS - 1);
    assert.equal(app.getPreview(), null, `${PREVIEW_MS} ミリ秒の前には出ない`);
    env.scheduler.advance(1);
    const pv = app.getPreview();
    assert.ok(pv && pv.open === true, `${PREVIEW_MS} ミリ秒で出る`);
    assert.equal(pv.heading, s.heading);
    assert.equal(typeof pv.needsReview, 'boolean');
    assert.equal(app.getScenePopup(), null, 'プレビューは固定のポップアップではない');
    app.unhoverElement(target('scene', s.id, surface));
    assert.equal(app.getPreview(), null, 'ポインタを離すと消える');
  });

  test(`FR-101 AC-592: ${surface} の要点でも、要点の先頭と種類のラベルのプレビューが出て、クリックで固定のポップアップになり、Esc と選択の解除で閉じる`, async () => {
    const { app, env, scenes } = await seeded();
    const s = scenes[0]; const pt = s.points[0];
    const t = target('point', pt.id, surface);
    app.hoverElement(t); env.scheduler.advance(PREVIEW_MS);
    const pv = app.getPreview();
    assert.ok(pv && pv.open === true);
    assert.equal(pv.heading, s.heading);
    assert.ok(pv.lead.length > 0 && pt.text.startsWith(pv.lead), '要点の先頭');
    assert.ok(typeof pv.kindLabel === 'string' && pv.kindLabel.length > 0, '種類のラベル');
    assert.equal(app.activateElement(t, 'click').ok, true);
    const p = app.getScenePopup();
    assert.ok(p && p.open === true && p.sceneId === s.id, '要点のシーンの固定のポップアップ（FR-024）');
    assert.equal(app.getPreview(), null, '固定のポップアップになるとプレビューは消える');
    assert.equal(app.handleKey({ key: 'Escape' }), 'popup.close');
    assert.equal(app.getScenePopup(), null, 'Esc で閉じる');
    app.activateElement(t, 'click');
    app.selectScene(null);
    assert.equal(app.getScenePopup(), null, '選択の解除で閉じる');
  });

  test(`FR-101 AC-592: ${surface} の要素にフォーカスして Enter で固定のポップアップになる（キーボードだけ）`, async () => {
    const { app, env, scenes } = await seeded();
    const s = scenes[1];
    const t = target('scene', s.id, surface);
    assert.equal(app.focusElement(t).ok, true);
    env.scheduler.advance(PREVIEW_MS);
    app.blurElement(t);
    assert.equal(app.getPreview(), null);
    app.focusElement(t);
    assert.equal(app.activateElement(t, 'enter').ok, true);
    const p = app.getScenePopup();
    assert.ok(p && p.sceneId === s.id && p.heading === s.heading);
    assert.equal(app.handleKey({ key: 'Escape' }), 'popup.close');
    assert.equal(app.getScenePopup(), null);
  });
}

test(`FR-101 AC-592 異常系: ${PREVIEW_MS} ミリ秒より前にポインタが離れたら（通り過ぎ）プレビューは出ない`, async () => {
  const { app, env, scenes } = await seeded();
  const t = target('scene', scenes[2].id, 'diagram');
  app.hoverElement(t); env.scheduler.advance(PREVIEW_MS - 100);
  app.unhoverElement(t);
  env.scheduler.advance(PREVIEW_MS * 3);
  assert.equal(app.getPreview(), null);
});

test('FR-101 AC-592 異常系: 存在しない要素へのホバー・フォーカス・クリックはプレビューもポップアップも出さない', async () => {
  const { app, env } = await seeded();
  for (const surface of ['diagram', 'list']) {
    assert.equal(app.hoverElement(target('scene', 'no-such', surface)).ok, false);
    assert.equal(app.focusElement(target('point', 'no-such', surface)).ok, false);
    assert.equal(app.activateElement(target('point', 'no-such', surface), 'click').ok, false);
  }
  env.scheduler.advance(PREVIEW_MS * 2);
  assert.equal(app.getPreview(), null);
  assert.equal(app.getScenePopup(), null);
});
