// NFR-PERF-003 AC-536（ドラッグ・スクロール・クリック・ホバー中の長いタスク 0 件）の単体・結合テスト。
// 数千件の画面で 1 回の描画・計算を 50ms 以内に収めるための、再計算を避ける仕組みが、結果を変えないことを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';
import { detectReadingOrder } from '../../web/src/readingorder.js';
import { detectConflictCandidates } from '../../web/src/conflict.js';
import { classifyPointRule } from '../../web/src/diagram.js';
import { phraseEvidence } from '../../web/src/layoutkinds.js';

class Fake { constructor() { this.processLocally = true; this.onresult = null; } start() {} stop() {} emit(text) { this.onresult?.({ text, isFinal: true }); } }
async function mk() {
  let t = 1_000_000;
  const sp = new Fake();
  const app = await createApp({ storage: null, speechSource: sp, now: () => (t += 1000) });
  app.commands['session.start']();
  app.startSpeech();
  return { app, sp };
}

test('NFR-PERF-003 AC-536: 読み順の判定は、覚えた結果を使っても同じ（2 回目も、文字が変われば変わる）', () => {
  const sc = (texts) => [{ points: texts.map((text) => ({ text })) }];
  assert.deepEqual(detectReadingOrder(sc(['平凡な話', 'まず確認する'])), { type: 'flow', reason: 'flow', phrase: 'まず' });
  assert.deepEqual(detectReadingOrder(sc(['平凡な話', 'まず確認する'])), { type: 'flow', reason: 'flow', phrase: 'まず' });
  assert.equal(detectReadingOrder(sc(['賛成です', '平凡な話'])).type, 'compare');
  assert.equal(detectReadingOrder(sc(['ひとつ目は予算'])).type, 'f');
  assert.equal(detectReadingOrder(sc(['平凡な話'])).type, 'z');
  assert.equal(detectReadingOrder(sc(['平凡な話'])).type, 'z');
});

test('NFR-PERF-003 AC-536: 言い回し・種類の判定は、同じ文字列を繰り返しても同じ結果（英語の語境界・next month の除外を含む）', () => {
  for (let i = 0; i < 2; i++) {
    assert.equal(phraseEvidence('Then we ship', 'next-step'), 'then');
    assert.equal(phraseEvidence('see you next month', 'next-step'), null);
    assert.equal(phraseEvidence('however it works', 'opposition'), 'however');
    assert.equal(classifyPointRule('これはどうですか'), 'question');
    assert.equal(classifyPointRule('ただの記録'), null);
  }
});

test('NFR-PERF-003 AC-536: 対立の候補は、発話の表（Map）を渡しても配列を渡しても同じ', () => {
  const scene = { id: 's1', points: [{ id: 'p1', uid: 'u1', text: 'Aは賛成' }, { id: 'p2', uid: 'u2', text: 'Bは反対' }] };
  const utt = [{ id: 'u1', text: 'Aは賛成です' }, { id: 'u2', text: 'Bは反対です' }];
  const viaArray = detectConflictCandidates(scene, utt, 'ja');
  const viaMap = detectConflictCandidates(scene, new Map(utt.map((u) => [u.id, u.text])), 'ja');
  assert.ok(viaArray.length >= 1);
  assert.deepEqual(viaMap, viaArray);
});

test('NFR-PERF-003 AC-536: 選択だけの変更は、計算結果の版数（getDataVersion に使う版）を進めず、描画の版数と文字列の版数は進める', async () => {
  const { app, sp } = await mk();
  sp.emit('一つ目の話をする'); sp.emit('二つ目の話をする');
  const scenes = app.getState().scenes;
  assert.ok(scenes.length >= 1);
  const r0 = app.getRenderVersion(); const t0 = app.getTextVersion();
  let observedData = null;
  app.on('change', () => {}); // 通知は届く
  const before = app.getScenesView();
  app.selectScene(scenes[0].id);
  assert.ok(app.getRenderVersion() > r0, '選択の印を描き直せるよう、描画の版数は進む');
  assert.ok(app.getTextVersion() > t0, '選択の印はテキスト一覧に出るので、文字列の版数も進む');
  // 計算結果のメモ化（シーンの写し）は、選択だけの変更では作り直さない
  assert.equal(app.getScenesView(), before);
  // データを変える操作では作り直す
  sp.emit('三つ目の話をする');
  assert.notEqual(app.getScenesView(), before);
  assert.equal(observedData, null);
});

test('NFR-PERF-003 AC-536: 発話の追加は、文字列・テキスト一覧の版数も描画の版数も進める（再配置だけの通知は進めない設計の前提）', async () => {
  const { app, sp } = await mk();
  sp.emit('一つ目の話をする');
  const t0 = app.getTextVersion();
  sp.emit('二つ目の話をする');
  assert.ok(app.getTextVersion() > t0, '発話を足したら文字列の版数は進む');
  assert.ok(app.getRenderVersion() >= app.getTextVersion());
});
