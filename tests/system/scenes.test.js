// FR-004 AC-009 AC-010 / NFR-PERF-001 AC-038（契約: tests/system/CONTRACT.md）
// 公開 API: app.renderSvg(), app.getState().scenes, app.commands['session.nextScene'], app.submitDraft
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, visibleTexts, PARAM } from './helpers.js';

test('FR-004 AC-009: 発話を追加すると進行中のシーンの図が更新され、新しい要点が表示される', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  app.setDraft('在庫の数を減らしたい'); app.submitDraft(); env.tick(1);
  let st = app.getState();
  assert.equal(st.scenes.at(-1).status, 'in_progress');
  assert.ok(app.renderSvg().includes('在庫の数を減らしたい'));
  app.setDraft('発注の頻度を見直す'); app.submitDraft();
  st = app.getState();
  const texts = st.scenes.at(-1).points.map((p) => p.text);
  assert.ok(texts.includes('発注の頻度を見直す'));
  assert.ok(app.renderSvg().includes('発注の頻度を見直す'));
});

test('FR-004 AC-009 異常系: 記録中でない発話は図を更新しない', async () => {
  const { app } = await newApp();
  app.setDraft('記録前の話'); app.submitDraft();
  assert.equal(app.getState().scenes.length, 0);
  assert.ok(!app.renderSvg().includes('記録前の話'));
});

test('FR-004 AC-010: 各シーンは見出し 1 つ・要点 1 件以上・関係線を持ち、時系列順に並ぶ', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const { scenes } = app.getState();
  assert.equal(scenes.length, 3);
  const svg = app.renderSvg();
  let last = -1;
  for (const s of scenes) {
    assert.equal(typeof s.heading, 'string');
    assert.ok(s.heading.length > 0);
    assert.ok(s.points.length >= 1);
    assert.ok(Array.isArray(s.relations));
    if (s.points.length >= 2) assert.ok(s.relations.length >= 1, '要点 2 件以上のシーンは関係線を持つ');
    const ids = new Set(s.points.map((p) => p.id));
    for (const r of s.relations) { assert.ok(ids.has(r.from) && ids.has(r.to)); }
    const at = svg.indexOf(`data-scene-id="${s.id}"`);
    assert.ok(at > last, 'SVG 内でシーンが時系列順');
    last = at;
    for (const p of s.points) assert.ok(svg.includes(p.text));
    assert.ok(svg.includes(s.heading));
  }
  assert.ok(/<line|<path/.test(svg), '関係線が描かれる');
});

test('FR-004 AC-010 異常系: シーン 0 件のとき図にシーンは現れない', async () => {
  const { app } = await newApp();
  assert.equal(app.getState().scenes.length, 0);
  assert.ok(!/data-scene-id=/.test(app.renderSvg()));
});

test(`NFR-PERF-001 AC-038: 100 件の後の 1 件の要点が ${PARAM.UPPER_SEC} 秒以内に表示される`, async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  for (let i = 0; i < 100; i++) {
    app.setDraft(`既存の発話その${i}について話す`); app.submitDraft(); env.tick(1);
    if (i % 25 === 24) app.commands['session.nextScene']();
  }
  assert.equal(app.getState().utterances.length, 100);
  const t0 = performance.now();
  app.setDraft('最後に追加する新しい要点'); app.submitDraft();
  const svg = app.renderSvg();
  const dt = (performance.now() - t0) / 1000;
  assert.ok(svg.includes('最後に追加する新しい要点'));
  assert.ok(dt <= PARAM.UPPER_SEC, `${dt}s`);
});

test('NFR-PERF-001 AC-038 異常系: 確定した要点が失われず 101 件目として数えられる', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  for (let i = 0; i < 100; i++) { app.setDraft(`発話${i}`); app.submitDraft(); env.tick(1); }
  app.setDraft('追加の一件'); app.submitDraft();
  assert.equal(app.getState().utterances.length, 101);
  assert.ok(visibleTexts(app.getState()).includes('追加の一件'));
});
