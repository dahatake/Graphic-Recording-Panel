// 項目 I-02 の単体・結合テスト: AC-544（A-287 除外語 PARAM-159）／AC-575（A-285 履歴の件数）／AC-616（A-611 投票の保存・復元）／
// AC-053・AC-054・AC-122・AC-038・AC-401（PARAM-001 と PARAM-158 の分離）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeReview, KATAKANA_STOPWORDS, KATAKANA_MIN } from '../../web/src/review.js';
import { HISTORY_MAX, trimHistory } from '../../web/src/edithistory.js';
import { LIVE_MAX_SEC } from '../../web/src/liverefresh.js';
import { newApp, seedThreeScenes } from '../system/helpers.js';

// FR-092 AC-544 / A-287 / PARAM-159: 通常語（除外語）は固有名詞らしい語にしない
test('FR-092 AC-544: 除外語（PARAM-159）だけのカタカナは「要確認」にならず、除外語でない 3 文字以上のカタカナはなる', () => {
  assert.equal(KATAKANA_MIN, 3);
  assert.equal(KATAKANA_STOPWORDS.length, 20);
  for (const w of KATAKANA_STOPWORDS) assert.equal(judgeReview(`${w}を見直す`, {}).needsReview, false, w);
  assert.equal(judgeReview('システムのメンバーが集まる', {}).needsReview, false);
  for (const t of ['ワークショップを開く', 'サーバーを増やす', 'システムズを使う', 'システムとワークショップ']) assert.equal(judgeReview(t, {}).reasons.includes('proper'), true, t);
  // 除外語を含んでも別の理由（数字）は残る。英大文字・敬称は従来どおり
  assert.deepEqual(judgeReview('システムを3台', {}).reasons, ['number']);
  assert.equal(judgeReview('APIを呼ぶ', {}).reasons.includes('proper'), true);
  assert.equal(judgeReview('田中さんがシステムを見る', {}).reasons.includes('proper'), true);
});

// FR-005 AC-575 / A-285: 「元に戻した」は履歴の件数に数えない
test('FR-005 AC-575: trimHistory は手修正だけを HISTORY_MAX 件まで数え、元に戻した記録は数えない', () => {
  const list = [];
  for (let i = 0; i < HISTORY_MAX; i++) { list.push({ kind: 'edit', id: `e${i}` }); if (i % 2 === 0) list.push({ kind: 'undo', id: `u${i}` }); }
  const n = list.length;
  assert.ok(n > HISTORY_MAX);
  assert.equal(trimHistory(list).length, n, '手修正は 50 件で、undo は数えないので何も消えない');
  list.unshift({ kind: 'edit', id: 'extra' });
  trimHistory(list);
  assert.equal(list.filter((h) => h.kind !== 'undo').length, HISTORY_MAX);
  assert.equal(list.filter((h) => h.kind !== 'undo').at(-1).id, 'e48', '一番古い手修正だけが消える');
});

test('FR-005 AC-575: 元に戻すたびに古い手修正の記録が消えず、{PARAM-123} 件の手修正を戻せる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const pid = app.getState().scenes[0].points[0].id;
  for (let i = 0; i < HISTORY_MAX; i++) assert.equal(app.editPoint(pid, `修正${i}`).ok, true);
  for (let k = 0; k < 10; k++) assert.equal(app.undoManualEdit().ok, true);
  const h = app.getEditHistory();
  assert.equal(h.filter((x) => x.kind !== 'undo').length, HISTORY_MAX, '手修正の記録は 50 件のまま（元に戻しても消えない）');
  assert.equal(h.filter((x) => x.kind === 'undo').length, 10);
  assert.equal(h.at(-1).after, '修正0', '最初の手修正の記録が残っている');
});

// FR-106 AC-616 / A-611: 投票の保存・復元・初期化の経路
test('FR-106 AC-616: 投票（選択肢・票）は保存・復元され、データの初期化で消える', async () => {
  const { app, env } = await newApp();
  assert.equal(app.startVote({ options: ['A案', 'B案'], voters: ['甲'], votesPerPerson: 1 }).ok, true);
  const a = app.getVote().options.find((o) => o.label === 'A案').id; const v = app.getVote().voters[0].id;
  assert.equal(app.castVote(a, v).ok, true);
  app.flushSave();
  const { app: app2 } = await newApp({ storage: env.storage });
  assert.deepEqual(app2.getVote().options.map((o) => o.label), ['A案', 'B案']);
  assert.equal(app2.getVote().voters[0].label, '甲');
  assert.equal(app2.getVote().options.find((o) => o.label === 'A案').votes, 1, '票も復元される');
  app2.commands['data.reset'](); await app2.dialogAction('confirm');
  assert.equal(app2.getVote(), null);
});

// NFR-PERF-001 AC-038 ほか: 単発の反映の上限（PARAM-158=3 秒）とライブ更新の間隔の上限（PARAM-001=15 秒）は別の値
test('FR-014 AC-053 AC-054 AC-122 AC-038 AC-401: ライブの上限（PARAM-001=60 秒）と単発の反映の上限（PARAM-158=3 秒）を混用しない', async () => {
  assert.equal(LIVE_MAX_SEC, 60); // PARAM-001 と同じ（PARAM-099。依頼 2026-11-05 で 15→60）
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.setDetailLevel('detail');
  const t0 = performance.now();
  app.setDraft('手入力の単発'); app.submitDraft();
  const svg = app.renderSvg();
  assert.ok(performance.now() - t0 < 3000, '単発は PARAM-158（3 秒）以内');
  assert.ok(svg.includes('手入力の単発'), '手入力はライブ更新の周期を待たず即座に図へ反映される');
});
