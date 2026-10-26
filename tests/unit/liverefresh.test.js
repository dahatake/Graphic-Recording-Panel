// FR-014 AC-521・AC-522、FR-022 AC-523 の単体・結合テスト（ライブの更新間隔・設定での保存・バッチ描画）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { isValidLiveSec, LIVE_INTERVAL_KEY } from '../../web/src/liverefresh.js';

// FR-014 AC-522: 10〜15 の整数だけが有効
test('FR-014 AC-522: isValidLiveSec は 10〜15 の整数だけを受け付ける', () => {
  for (const ok of [10, 11, 15]) assert.equal(isValidLiveSec(ok), true);
  for (const bad of [9, 16, 12.5, '12', NaN, null]) assert.equal(isValidLiveSec(bad), false);
});

// FR-014 AC-522: 設定画面の項目から変更・保存・範囲外は理由つきで拒否
test('FR-014 AC-522: 設定画面の項目で変更でき、保存され、範囲外は理由を示して直前の値を保つ', async () => {
  const { app, env } = await newApp();
  app.commands['settings.open']();
  const f = () => app.getSettingsDialog().fields.find((x) => x.id === 'live.interval');
  assert.equal(f().value, 10);
  assert.equal(app.setLiveInterval('13').ok, true);
  assert.equal(f().value, 13);
  assert.deepEqual(JSON.parse(env.storage.getItem(LIVE_INTERVAL_KEY)), { intervalSec: 13 });
  const r = app.setLiveInterval(20);
  assert.equal(r.ok, false);
  assert.equal(f().value, 13);
  assert.equal(app.getState().message.key, 'live.interval.invalid');
});

// FR-014 AC-522: 再起動（同じ storage で再作成）後も保たれる
test('FR-014 AC-522: 選んだ値は再起動後も保たれる', async () => {
  const first = await newApp();
  assert.equal(first.app.setLiveInterval(14).ok, true);
  const second = await newApp({ storage: first.env.storage });
  assert.equal(second.app.getLiveInterval().sec, 14);
});

// FR-014 AC-521: 記録中でないとき（準備中）は発話がなくても数えない
test('FR-014 AC-521: 記録していない間は定期更新が起きない', async () => {
  const { app, env } = await newApp();
  env.scheduler.advance(60 * 1000);
  assert.equal(app.getLiveRefresh().count, 0);
});
