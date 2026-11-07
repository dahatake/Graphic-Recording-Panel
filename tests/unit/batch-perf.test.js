// NFR-PERF-001 AC-697 (3)（FR-118 AC-689・AC-692）: 取込上限サイズ（PARAM-003）ちょうどのファイルで LLM 有効・全要求失敗でも、バッチの実行が PARAM-158（3 秒）以内に終わる回帰テスト。
// 原因: 要求の組み立てが発話の件数に比例する名前の辞書づくりを行ごとに繰り返していた（要求は 1 件だけ。待ちは無い）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { makeRelay, bootApp, enableLlm, maxSizeTxt, toFile } from '../system/batch-util.js';

test('NFR-PERF-001 AC-697 (3): 上限サイズのファイル・LLM 有効・全要求失敗でも、実行は 3 秒以内でルールベースの図が残る', async () => {
  const h = makeRelay({ mode: 'fail' });
  const { app } = await bootApp(h); await enableLlm(app);
  assert.equal((await app.importTextFile(maxSizeTxt())).ok, true);
  const t0 = performance.now();
  const r = await app.runBatch(app.getBatchStyles()[1].id); await app.flushLlm();
  const ms = performance.now() - t0;
  assert.equal(r.ok, true);
  assert.ok(h.llmReqs().length >= 1);
  assert.ok(app.getState().scenes.length >= 1);
  assert.ok(ms <= 3000, `実行 ${Math.round(ms)} ms`);
});

test('FR-118 AC-692: バッチの要求は名前（話者）を含まず、語だけを送る（要求の組み立てを 1 回にまとめても同じ）', async () => {
  const h = makeRelay();
  const { app } = await bootApp(h); await enableLlm(app);
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v 話者ZQ甲斐>予算の見直しが必要です</v>\n\n00:00:03.000 --> 00:00:04.000\n<v 話者ZQ乙川>来月のリリース計画を決める</v>\n';
  assert.equal((await app.importTextFile(toFile('a.vtt', vtt))).ok, true);
  await app.runBatch(app.getBatchStyles()[0].id); await app.flushLlm();
  assert.ok(h.llmReqs().length >= 1);
  assert.equal(JSON.stringify(h.log).includes('ZQ'), false);
});
