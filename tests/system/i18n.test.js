// FR-008 AC-017 AC-018 AC-019（契約: app.getStrings / setLang / getState().lang）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, CJK } from './helpers.js';

test('FR-008 AC-017: 初回起動時の表示言語は日本語', async () => {
  const { app } = await newApp();
  assert.equal(app.getState().lang, 'ja');
  assert.match(app.getStrings()['app.title'], CJK);
});

test('FR-008 AC-018: 英語に切り替えると全ての操作名・メッセージが英語になり、日本語に戻すと日本語になる（再読込なし）', async () => {
  const { app } = await newApp();
  const ja = { ...app.getStrings() };
  app.setLang('en');
  assert.equal(app.getState().lang, 'en');
  const en = app.getStrings();
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ja).sort(), 'キー集合が同一');
  assert.ok(Object.keys(en).length >= 20);
  for (const [k, v] of Object.entries(en)) {
    assert.ok(v && v.length > 0, k);
    assert.doesNotMatch(v, CJK, `英語の ${k} に日本語が残っている`);
  }
  const differing = Object.keys(ja).filter((k) => ja[k] !== en[k]).length;
  assert.ok(differing / Object.keys(ja).length >= 0.8);
  app.setLang('ja');
  assert.equal(app.getState().lang, 'ja');
  assert.deepEqual(app.getStrings(), ja);
});

test('FR-008 AC-018: 実行時メッセージも切替後の言語で出る', async () => {
  const { app } = await newApp();
  app.setDraft('x'); app.submitDraft();
  assert.match(app.getState().message.text, /記録を開始・再開してください/);
  app.setLang('en');
  app.setDraft('x'); app.submitDraft();
  assert.doesNotMatch(app.getState().message.text, CJK);
  assert.ok(app.getState().message.text.length > 0);
});

test('FR-008 AC-018 異常系: 未対応の言語コードは受け付けず現在の言語のまま', async () => {
  const { app } = await newApp();
  try { app.setLang('fr'); } catch { /* 例外でも可 */ }
  assert.equal(app.getState().lang, 'ja');
});

test('FR-008 AC-019: 言語を切り替えても発話・シーン・要点と記録中の状態が失われない', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const before = JSON.stringify({ u: app.getState().utterances, s: app.getState().scenes });
  assert.equal(app.getState().session, 'recording');
  app.setLang('en');
  assert.equal(JSON.stringify({ u: app.getState().utterances, s: app.getState().scenes }), before);
  assert.equal(app.getState().session, 'recording');
  app.setLang('ja');
  assert.equal(JSON.stringify({ u: app.getState().utterances, s: app.getState().scenes }), before);
  app.setDraft('切替後の発話'); assert.equal(app.submitDraft().ok, true);
});
