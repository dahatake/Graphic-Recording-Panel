// FR-014 AC-521（ライブの更新間隔）／FR-022 AC-523（バッチ描画）（System Test。契約: tests/system/CONTRACT-LIVE-EXPORT.md）
// 期待値は要求定義書の受入基準（PARAM-098〜101・PARAM-001）だけから決める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, PARAM, toDetail } from './helpers.js';

const SEC = 1000;
const startRec = (app) => { app.commands['session.start'](); app.startSpeech(); };
const count = (app) => app.getLiveRefresh().count;

// FR-014 AC-521
test('FR-014 AC-521: ライブの記録中、更新間隔（既定 10 秒、10〜15 秒）ごとに、その間に確定した発話をまとめて 1 回で描画し、発話がなかった間隔では更新しない', async () => {
  const { app, env } = await newApp(); toDetail(app);
  const itv = app.getLiveInterval();
  assert.equal(itv.sec, PARAM.LIVE_DEFAULT_SEC, '初期値 PARAM-100');
  assert.equal(itv.min, PARAM.LIVE_MIN_SEC); assert.equal(itv.max, PARAM.LIVE_MAX_SEC);
  startRec(app);
  const c0 = count(app);
  env.speech.emit('予算の見直しを話す', true);
  env.scheduler.advance(2 * SEC);
  env.speech.emit('来月の計画を決める', true);
  assert.equal(app.getState().utterances.length, 2, '確定した発話は記録される');
  env.scheduler.advance(PARAM.LIVE_DEFAULT_SEC * SEC);
  assert.equal(count(app), c0 + 1, '2 件の発話は更新間隔の 1 回の更新にまとまる');
  assert.ok(app.renderSvg().includes('予算の見直しを話す') && app.renderSvg().includes('来月の計画を決める'), 'PARAM-001 秒以内に図へ反映');
  const c1 = count(app);
  env.scheduler.advance(3 * PARAM.LIVE_DEFAULT_SEC * SEC);
  assert.equal(count(app), c1, '新しい発話がなかった間隔では描画を更新しない');
  env.speech.emit('担当者を割り当てる', true);
  env.scheduler.advance(PARAM.LIVE_MAX_SEC * SEC);
  assert.equal(count(app), c1 + 1, '新しい発話があった間隔では 1 回更新する');
  assert.ok(app.renderSvg().includes('担当者を割り当てる'));
});

test('FR-014 AC-521 異常系: 更新間隔は 10〜15 の整数だけで、範囲外・整数でない値は受け付けず直前の値が保たれる。15 秒でも 15 秒以内に反映される', async () => {
  const { app, env } = await newApp(); toDetail(app);
  assert.equal(app.setLiveInterval(15).ok, true);
  for (const bad of [9, 16, 12.5, 0, -10, 'abc', NaN]) {
    const r = app.setLiveInterval(bad);
    assert.equal(r.ok, false, `${bad} は受け付けない`);
    assert.equal(app.getLiveInterval().sec, 15, '直前の値が保たれる');
  }
  startRec(app);
  env.speech.emit('十五秒の間隔の確認', true);
  env.scheduler.advance(PARAM.LIVE_MAX_SEC * SEC);
  assert.ok(app.renderSvg().includes('十五秒の間隔の確認'));
  // 一時停止中の発話は記録されず、更新も起きない
  app.commands['session.pause']();
  const c = count(app);
  env.speech.emit('停止中の声', true);
  env.scheduler.advance(3 * PARAM.LIVE_MAX_SEC * SEC);
  assert.equal(count(app), c);
  assert.ok(!app.renderSvg().includes('停止中の声'));
});

// FR-022 AC-523
const vtt = (n) => ['WEBVTT', '', ...Array.from({ length: n }, (_, i) => [`cue-${i}`, `00:00:${String(i * 3).padStart(2, '0')}.000 --> 00:00:${String(i * 3 + 2).padStart(2, '0')}.000`, `<v 話者${i}>バッチの話題その${i}を確認</v>`, '']).flat()].join('\n');
const file = (name, text, type = 'text/vtt') => ({ name, type, size: Buffer.byteLength(text), text });

test('FR-022 AC-523: 録画済み会議の .vtt／.txt の取込は、更新間隔を待たず 1 回の描画で全体が図に反映される（準備中・記録中・停止のどの状態でも）', async () => {
  for (const state of ['preparing', 'recording', 'stopped']) {
    const { app, env } = await newApp(); toDetail(app);
    if (state !== 'preparing') app.commands['session.start']();
    if (state === 'stopped') app.commands['session.stop']();
    const c0 = count(app);
    const r = await app.importTextFile(file('meeting.vtt', vtt(8)));
    assert.equal(r.ok, true, state);
    env.scheduler.advance(1 * SEC);
    assert.equal(count(app), c0 + 1, `${state}: 取込全体が 1 回の描画`);
    const svg = app.renderSvg();
    for (let i = 0; i < 8; i++) assert.ok(svg.includes(`バッチの話題その${i}を確認`), `${state}: cue ${i} が図にある`);
    for (const s of app.getState().scenes) assert.ok(svg.includes(`data-scene-id="${s.id}"`), `${state}: 全シーンが反映`);
  }
  const { app, env } = await newApp(); toDetail(app);
  const lines = Array.from({ length: 30 }, (_, i) => `テキスト取込の行${i}の要点`);
  assert.equal((await app.importTextFile(file('m.txt', lines.join('\n'), 'text/plain'))).ok, true);
  env.scheduler.advance(PARAM.UPPER_SEC * SEC);
  for (const l of lines) assert.ok(app.renderSvg().includes(l), l);
});

test('FR-022 AC-523 異常系: 取り込めない（テキストでない・空の）ファイルでは描画も図の変化も起きない', async () => {
  const { app, env } = await newApp(); toDetail(app);
  app.commands['session.start']();
  const c0 = count(app); const before = app.renderSvg();
  assert.equal((await app.importTextFile(file('x.bin', 'バイナリ', 'application/octet-stream'))).ok, false);
  assert.equal((await app.importTextFile(file('e.vtt', ''))).ok, false);
  env.scheduler.advance(PARAM.UPPER_SEC * SEC);
  assert.equal(count(app), c0);
  assert.equal(app.renderSvg(), before);
});
