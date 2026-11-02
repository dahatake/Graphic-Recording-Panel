// FR-103 AC-599〜602（integration / unit）: 初回の案内・ヘルプ・練習用のサンプル。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newApp, FakeStorage, keyFor } from '../system/helpers.js';
import { buildSampleFile } from '../../web/src/onboarding.js';

const key = (app, c) => app.handleKey(keyFor(app, c));

// FR-103 AC-600: ヘルプはボタン（コマンドバー）とキーボードで開け、日英の文言があり、外部へのリクエストは 0 件
test('FR-103 AC-600: help.open がヘッダーのボタンとキーで案内を開き、日英とも文言があり、fetch を呼ばない', async () => {
  let fetches = 0;
  const saved = globalThis.fetch; globalThis.fetch = () => { fetches++; return Promise.reject(new Error('no network')); };
  try {
    const storage = new FakeStorage(); storage.setItem('grp.onboarding', 'done');
    const { app } = await newApp({ storage });
    assert.equal(app.getOnboarding(), null);
    assert.ok(fs.readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8').includes('id="help-button"'), 'ヘルプのボタンがある（画面上部）');
    assert.equal(typeof app.commands['help.open'], 'function', 'ボタンの操作');
    key(app, 'help.open');
    const ja = app.getOnboarding();
    assert.equal(ja.role, 'dialog'); assert.ok(ja.label && ja.title && ja.body);
    app.setLang('en');
    const en = app.getOnboarding();
    assert.notEqual(en.body, ja.body);
    assert.ok(/[A-Za-z]/.test(en.body) && !/[぀-ヿ]/.test(en.body), '英語の本文');
    assert.equal(fetches, 0);
  } finally { globalThis.fetch = saved; }
});

// FR-103 AC-601: 既存の議論があるときは上書きの前に確認し、取り消せる。読込後は一時停止で「サンプル」
test('FR-103 AC-601: 既存の議論があると load-replace で確認し、取り消せる。確認後はサンプル・一時停止・案内は閉じる', async () => {
  const { app } = await newApp();
  app.commands['session.start'](); app.setDraft('既存の議論です'); app.submitDraft();
  app.commands['session.pause']();
  const before = app.getState().scenes.map((s) => s.heading);
  for (let i = 0; i < 2; i++) app.onboarding.next();
  const r = app.onboarding.loadSample();
  assert.equal(r.pending, true);
  assert.equal(app.getDialog().kind, 'load-replace');
  await app.dialogAction('cancel');
  assert.deepEqual(app.getState().scenes.map((s) => s.heading), before, '取り消せる');
  assert.equal(app.getState().sample, false);
  assert.ok(app.getOnboarding(), '案内は開いたまま');
  app.onboarding.loadSample();
  await app.dialogAction('confirm');
  const st = app.getState();
  assert.equal(st.sample, true); assert.equal(st.session, 'paused');
  assert.equal(app.getOnboarding(), null);
});

// FR-103 AC-602: 日英の同梱・実在の名称なし・生成 AI なし・外部通信なし・データの初期化で消える
test('FR-103 AC-602: サンプルは日英で同梱され、データの初期化で消え、再読込で復元されても印が保たれる', async () => {
  for (const lang of ['ja', 'en']) {
    const f = buildSampleFile(lang);
    const d = JSON.parse(f.text);
    assert.ok(d.scenes.length >= 2 && d.utterances.length >= 3);
    assert.ok(!/https?:|@|株式会社|Inc\.|Corp|Ltd/i.test(f.text), '実在の組織・連絡先らしい文字列がない');
    assert.ok(d.scenes.every((s) => !s.aiSummary && s.points.every((p) => !p.aiSummary)), '生成 AI を使わない');
  }
  const storage = new FakeStorage();
  const { app, createApp, env } = await newApp({ storage });
  for (let i = 0; i < 2; i++) app.onboarding.next();
  assert.equal(app.onboarding.loadSample().ok, true);
  storage.dump();
  const again = await createApp({ ...env.options, storage });
  assert.equal(again.getState().sample, true, '保存・復元で印が残る');
  void again.commands['data.reset'](); await again.dialogAction('confirm');
  assert.equal(again.getState().sample, false);
  assert.equal(again.getState().scenes.length, 0);
  assert.ok(storage.dump().some(([k]) => k === 'grp.onboarding'), '案内を終えた記録はデータの初期化で消えない');
});

test('FR-103 AC-599: 案内の描画は textContent だけを使い、コードに外部の URL を書かない', () => {
  for (const f of ['web/src/onboarding.js', 'web/src/onboarding-ui.js']) {
    const s = fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
    assert.ok(!/https?:\/\//.test(s), `${f}: 外部の URL なし`);
    assert.ok(!/innerHTML/.test(s), `${f}: innerHTML を使わない`);
  }
});
