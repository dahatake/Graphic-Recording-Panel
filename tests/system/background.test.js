// NFR-BG-001 AC-063 AC-064 AC-065（System Test。契約: tests/system/CONTRACT.md「バックグラウンド動作の継続」）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, FakeVisibility, toDetail } from './helpers.js';

const BG_MS = 2 * 1000; // PARAM-008
const startRec = (app) => { app.commands['session.start'](); app.startSpeech(); };
async function boot(over = {}) {
  const vis = new FakeVisibility();
  const r = await newApp({ ...over, options: { visibility: vis, ...(over.options || {}) } });
  r.vis = vis;
  return r;
}
const finals = (app) => app.getTranscript().finals.map((f) => f.text);

// NFR-BG-001 AC-063
test('NFR-BG-001 AC-063: 記録中に非表示になっても確定結果が発話・シーン・要点に反映され、可視に戻ると 2 秒以内に右パネルと図が最新になる', async () => {
  const { app, env, vis } = await boot(); toDetail(app);
  startRec(app);
  env.speech.emit('最初の発言です');
  vis.set(true);
  env.tick(5);
  env.speech.emit('非表示中の発言その一');
  env.speech.emit('非表示中の発言その二');
  const st = app.getState();
  assert.equal(st.session, 'recording');
  assert.deepEqual(st.utterances.map((u) => u.text), ['最初の発言です', '非表示中の発言その一', '非表示中の発言その二']);
  const pts = st.scenes.flatMap((s) => s.points.map((p) => p.text));
  for (const t of ['非表示中の発言その一', '非表示中の発言その二']) assert.ok(pts.includes(t), `要点に ${t}`);
  vis.set(false);
  env.scheduler.advance(BG_MS);
  assert.deepEqual(finals(app), ['最初の発言です', '非表示中の発言その一', '非表示中の発言その二']);
  const html = app.renderTranscript();
  const svg = app.renderSvg();
  const outline = app.renderOutline();
  for (const t of ['非表示中の発言その一', '非表示中の発言その二']) {
    assert.ok(html.includes(t), `右パネルに ${t}`);
    assert.ok(svg.includes(t), `図に ${t}`);
    assert.ok(outline.includes(t), `アウトラインに ${t}`);
  }
});

test('NFR-BG-001 AC-063: 非表示になっても記録中のままで、音声認識は停止されない', async () => {
  const { app, env, vis } = await boot();
  startRec(app);
  const stops = env.speech.stopCalls;
  vis.set(true);
  env.scheduler.advance(60 * 1000);
  assert.equal(app.getState().session, 'recording');
  assert.equal(env.speech.stopCalls, stops, '非表示で stop を呼ばない');
});

test('NFR-BG-001 AC-063 異常系: 一時停止中は非表示の間に届いた結果を記録しない（記録中のときだけ継続する）', async () => {
  const { app, env, vis } = await boot();
  startRec(app);
  env.speech.emit('記録される発言');
  app.commands['session.pause']();
  vis.set(true);
  env.speech.emit('記録されない発言');
  vis.set(false);
  env.scheduler.advance(BG_MS);
  assert.deepEqual(app.getState().utterances.map((u) => u.text), ['記録される発言']);
  assert.ok(!app.renderSvg().includes('記録されない発言'));
});

// NFR-BG-001 AC-064
test('NFR-BG-001 AC-064: 記録中に音声認識が自動終了（onend）したら 2 秒以内に同じ言語で再開される', async () => {
  const { app, env } = await boot();
  startRec(app);
  const n = env.speech.startCalls.length;
  env.speech.end();
  env.scheduler.advance(BG_MS);
  assert.equal(env.speech.startCalls.length, n + 1, '再開で start が 1 回増える');
  assert.deepEqual(env.speech.startCalls.at(-1), env.speech.startCalls[n - 1]);
  assert.equal(app.getState().session, 'recording');
});

test('NFR-BG-001 AC-064: 非表示の間の自動終了でも再開され、再開後の確定結果も記録される', async () => {
  const { app, env, vis } = await boot();
  startRec(app);
  vis.set(true);
  const n = env.speech.startCalls.length;
  env.speech.end();
  env.scheduler.advance(BG_MS);
  assert.equal(env.speech.startCalls.length, n + 1);
  env.speech.emit('再開後の発言');
  assert.deepEqual(app.getState().utterances.map((u) => u.text), ['再開後の発言']);
});

test('NFR-BG-001 AC-064 異常系: 一時停止・停止した後の自動終了では再開されない', async () => {
  for (const cmd of ['session.pause', 'session.stop']) {
    const { app, env } = await boot();
    startRec(app);
    app.commands[cmd]();
    const n = env.speech.startCalls.length;
    env.speech.end();
    env.scheduler.advance(10 * 1000);
    assert.equal(env.speech.startCalls.length, n, `${cmd} の後は start しない`);
  }
});

test('NFR-BG-001 AC-064 異常系: stopSpeech の後の自動終了では再開されない', async () => {
  const { app, env } = await boot();
  startRec(app);
  app.stopSpeech();
  const n = env.speech.startCalls.length;
  env.speech.end();
  env.scheduler.advance(10 * 1000);
  assert.equal(env.speech.startCalls.length, n);
});

test('NFR-BG-001 AC-064 異常系: デバイス内処理が確認できない環境では再開されない', async () => {
  const { app, env } = await boot();
  startRec(app);
  env.speech.processLocally = false;
  const n = env.speech.startCalls.length;
  env.speech.end();
  env.scheduler.advance(10 * 1000);
  assert.equal(env.speech.startCalls.length, n);
});

// NFR-BG-001 AC-065
test('NFR-BG-001 AC-065: 非表示の間に連続して届いた確定結果が欠落・重複なく届いた順に記録され、復帰後の件数と順序が一致する', async () => {
  const { app, env, vis } = await boot();
  startRec(app);
  env.speech.emit('開始前の発言');
  vis.set(true);
  const sent = ['一番目', '二番目', '同じ内容', '同じ内容', '五番目', '六番目', '七番目'];
  for (const t of sent) env.speech.emit(t);
  assert.deepEqual(app.getState().utterances.map((u) => u.text), ['開始前の発言', ...sent]);
  vis.set(false);
  env.scheduler.advance(BG_MS);
  assert.deepEqual(app.getState().utterances.map((u) => u.text), ['開始前の発言', ...sent]);
  assert.deepEqual(finals(app), ['開始前の発言', ...sent]);
  const ids = app.getState().utterances.map((u) => u.id);
  assert.equal(new Set(ids).size, ids.length, '発話 ID は重複しない');
});

test('NFR-BG-001 AC-065: 非表示・可視を繰り返しても件数は増減せず、自動終了・再開を挟んでも重複しない', async () => {
  const { app, env, vis } = await boot();
  startRec(app);
  env.speech.emit('甲');
  vis.set(true); env.speech.emit('乙');
  env.speech.end(); env.scheduler.advance(BG_MS);
  env.speech.emit('丙');
  vis.set(false); vis.set(true); vis.set(false);
  env.scheduler.advance(BG_MS);
  assert.deepEqual(app.getState().utterances.map((u) => u.text), ['甲', '乙', '丙']);
  assert.deepEqual(finals(app), ['甲', '乙', '丙']);
});

test('NFR-BG-001 AC-065 異常系: 非表示の間に届いた暫定結果は発話にならず、確定結果だけが記録される', async () => {
  const { app, env, vis } = await boot();
  startRec(app);
  vis.set(true);
  env.speech.emit('暫定のみ', false);
  env.speech.emit('確定した発言', true);
  vis.set(false);
  env.scheduler.advance(BG_MS);
  assert.deepEqual(app.getState().utterances.map((u) => u.text), ['確定した発言']);
  assert.equal(app.getTranscript().interim, null);
});
