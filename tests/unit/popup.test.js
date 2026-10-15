// FR-024 AC-126（integration）: 配置は画面端・狭い画面でも見切れず、全シーンのテキスト一覧は従来どおり提供される。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';
import { popupPlacement } from '../../web/src/popup.js';

const scene = (n) => ({ id: 's1', heading: '見出し', points: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, text: `要点${i}`.repeat(10) })) });

async function seeded(env = {}) {
  const app = await createApp({ env });
  app.commands['session.start']();
  for (const t of ['予算の見直しが必要です', 'コストが高くて困った']) app.submitDraft && (app.setDraft(t), app.submitDraft());
  app.commands['session.nextScene']();
  app.setDraft('次の話題です'); app.submitDraft();
  return app;
}

// FR-024 AC-126
test('FR-024 AC-126: 狭い画面（幅 640px 以下）でもポップアップは画面内に収まる', () => {
  for (const vw of [320, 480, 640]) {
    const p = popupPlacement(scene(2), { viewportWidth: vw, viewportHeight: 600 });
    assert.ok(p.x >= 0 && p.x + p.w <= vw, `幅 ${vw}`);
    assert.ok(p.y + p.h <= 600);
  }
});

// FR-024 AC-126
test('FR-024 AC-126: 内容が画面に入りきらないときはスクロールで全体を確認できる', () => {
  const p = popupPlacement(scene(60), { viewportWidth: 400, viewportHeight: 400 });
  assert.equal(p.scrollable, true);
  assert.ok(p.maxHeight <= 400);
  assert.equal(popupPlacement(scene(1), { viewportWidth: 1280, viewportHeight: 720 }).scrollable, false);
});

// FR-024 AC-126（AC-035）
test('FR-024 AC-126: ポップアップとは別に、全シーンのテキスト一覧は従来どおり提供される', async () => {
  const app = await seeded({ viewportWidth: 500 });
  const scenes = app.getState().scenes;
  assert.ok(scenes.length >= 2);
  app.selectScene(scenes[0].id);
  assert.ok(app.getScenePopup());
  const html = app.renderOutline();
  for (const s of scenes) { assert.ok(html.includes(s.heading)); for (const p of s.points) assert.ok(html.includes(p.text)); }
  app.handleKey({ key: 'Escape' });
  assert.equal(app.getScenePopup(), null);
  assert.equal(app.renderOutline(), html);
});
