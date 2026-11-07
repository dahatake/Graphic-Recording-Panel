// FR-118 バッチモード（web/src/batch.js）の単体・結合テスト。契約: tests/system/CONTRACT-BATCH.md「3.」。LLM は中継のモック（決定的）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { makeRelay, bootApp, enableLlm, snapshot, finals, TXT, VTT, MEETING_LINES } from '../system/batch-util.js';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// FR-118 AC-691: 取消すと読込済みに戻り、図は実行前のままで発話は残る。取消の後も別のスタイルで実行できる
test('FR-118 AC-691: 実行中は処理中と進み具合が示され、取消すと読込済みに戻り図は実行前のまま（発話は残る）。実行中は重ねて実行されない', async () => {
  const h = makeRelay({ mode: 'defer' });
  const { app } = await bootApp(h);
  await enableLlm(app);
  await app.importTextFile(VTT);
  const before = snapshot(app); const pressed0 = app.getBatchStyles().filter((s) => s.pressed).length;
  const [a, b] = app.getBatchStyles();
  const p = app.runBatch(a.id);
  await flush();
  const st = app.getBatchState();
  assert.equal(st.state, 'running'); assert.equal(st.cancelEnabled, true);
  assert.match(st.progressText, /処理中: 0 \/ 1/);
  assert.ok(app.getBatchStyles().every((s) => s.enabled === false), '実行中はどのスタイルも無効（完了または取消まで）');
  assert.equal((await app.runBatch(b.id)).ok, false, '実行中に別のスタイルを選んでも重ねて実行されない');
  assert.equal(app.cancelBatch().ok, true);
  const r = await p;
  assert.deepEqual([r.ok, r.cancelled], [true, true]);
  assert.equal(app.getBatchState().state, 'loaded'); assert.equal(app.getBatchState().cancelEnabled, false);
  assert.equal(snapshot(app), before, '図は実行前のまま');
  assert.deepEqual(finals(app), MEETING_LINES, '発話は残る');
  assert.equal(app.getBatchStyles().filter((s) => s.pressed).length, pressed0, '選択の印も実行前のまま');
  assert.equal(app.cancelBatch().ok, false, '実行中でなければ取消せない');
  h.state.mode = 'ok'; h.release();
  const r2 = await app.runBatch(b.id); await app.flushLlm();
  assert.equal(r2.ok, true);
  assert.equal(app.getBatchState().state, 'done');
});

// FR-118 AC-691: 完了後に別のスタイルを選ぶと、発話は変わらず、図だけが新しい結果に置き換わる
test('FR-118 AC-691: 完了後に別のスタイルを選ぶと発話は変わらず図の画風だけが置き換わり、描いたシーンの数が示される', async () => {
  const { app } = await newApp();
  await app.importTextFile(TXT);
  const [a, b] = app.getBatchStyles();
  assert.equal((await app.runBatch(a.id)).ok, true);
  const n = app.getState().scenes.length;
  assert.match(app.getBatchState().message, new RegExp(`${n} シーン`));
  assert.equal(app.getDrawStyle(), a.drawStyle);
  const utter = finals(app).slice();
  assert.equal((await app.runBatch(b.id)).ok, true);
  assert.equal(app.getDrawStyle(), b.drawStyle);
  assert.match(app.renderSvg(), new RegExp(`data-draw-style="${b.drawStyle}"`));
  assert.deepEqual(finals(app), utter);
  assert.deepEqual(app.getBatchStyles().filter((s) => s.pressed).map((s) => s.id), [b.id]);
  assert.equal(app.getState().utterances.length, MEETING_LINES.length, '発話は増えも減りもしない');
});

// FR-118 AC-689: LLM 連携が無効なら要求は 0 件で、選んだスタイルの画風のルールベース描画と有効化の案内。失敗ではシーンがルールベースで描かれ、原因が通知される
test('FR-118 AC-689: LLM 無効は要求 0 件・有効化の案内、LLM 失敗は原因の通知つきでルールベース描画（図は空にならず発話は失われない）', async () => {
  const off = makeRelay();
  const a = await bootApp(off);
  await a.app.importTextFile(VTT);
  const s = a.app.getBatchStyles()[3];
  assert.equal((await a.app.runBatch(s.id)).ok, true);
  assert.equal(off.llmReqs().length, 0);
  assert.match(a.app.getBatchState().message, /LLM 連携を有効にすると/);
  assert.equal(a.app.getDrawStyle(), s.drawStyle);
  assert.ok(a.app.getState().scenes.length >= 1);
  const bad = makeRelay({ mode: 'fail' });
  const b = await bootApp(bad);
  await enableLlm(b.app);
  await b.app.importTextFile(VTT);
  assert.equal((await b.app.runBatch(s.id)).ok, true);
  assert.ok(bad.llmReqs().length >= 1 && bad.llmReqs().every((q) => q.body.styleId === s.id && !('instructions' in q.body)));
  assert.match(b.app.getState().message?.text ?? '', /LLM 連携に失敗しました/);
  assert.ok(b.app.getState().scenes.length >= 1 && b.app.renderSvg().includes(`data-draw-style="${s.drawStyle}"`));
  assert.equal(b.app.getState().utterances.length, MEETING_LINES.length);
});

// FR-118 AC-690: 要点の文字は語だけ（発話の逐語を含まない）。取込んだ発話に長い英数字の列（識別子の恐れ）があっても送らない
test('FR-118 AC-690・AC-692: バッチで送る要点の文字は語だけで、発話の逐語と長い英数字の列を含まない', async () => {
  const h = makeRelay();
  const { app } = await bootApp(h);
  await enableLlm(app);
  const line = '来月のリリース計画を決める LONGIDENTIFIERABC budget';
  await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: line.length, text: `${line}\n` });
  await app.runBatch(app.getBatchStyles()[0].id); await app.flushLlm();
  const sent = h.llmReqs().map((q) => q.body.input).join('\n');
  assert.ok(sent.includes('リリース計画') && sent.includes('budget'), '語は送る');
  assert.ok(!sent.includes('LONGIDENTIFIERABC') && !sent.includes(line) && !sent.includes('来月のリリース計画を決める'));
});

// FR-118 AC-692（Q-049 A・監査 D-04）: 英語の発話・見出しの行・話者名つきの英語の発話は、語だけでできた行なので逐語そのものになる。送らない（…にする）
test('FR-118 AC-692: 行の全体が語だけの発話（英語・見出し）は、そのまま LLM への要求に載らない', async () => {
  const h = makeRelay();
  const { app } = await bootApp(h);
  await enableLlm(app);
  const en = 'We should review the quarterly budget';
  const vtt = `WEBVTT\n\n1\n00:00:00.000 --> 00:00:03.000\n<v Alice Smith>${en}</v>\n\n2\n00:00:03.000 --> 00:00:06.000\n<v 田中太郎>予算の見直しが必要です</v>\n`;
  await app.importTextFile({ name: 'a.vtt', type: 'text/vtt', size: vtt.length, text: vtt });
  await app.runBatch(app.getBatchStyles()[0].id); await app.flushLlm();
  const sent = h.llmReqs().map((q) => q.body.input).join('\n');
  for (const w of ['review', 'quarterly', 'budget', 'Alice', 'Smith', '田中']) assert.ok(!sent.includes(w), `${w} は送らない`);
  assert.ok(sent.includes('見直'), '日本語の語は送る（AC-690）');
  const h2 = makeRelay();
  const b = await bootApp(h2);
  await enableLlm(b.app);
  const txt = '# 予算レビュー会議\n## Quarterly Planning Review\n予算の見直しが必要です\n';
  await b.app.importTextFile({ name: 'b.txt', type: 'text/plain', size: txt.length, text: txt });
  await b.app.runBatch(b.app.getBatchStyles()[0].id); await b.app.flushLlm();
  const sent2 = h2.llmReqs().map((q) => q.body.input).join('\n');
  assert.ok(!sent2.includes('予算レビュー会議') && !sent2.includes('Quarterly') && sent2.includes('見直'));
});

// FR-118 AC-692（Q-049 A・NFR-PRIV-003、reviewer 差し戻し）: 語の長さ・欧文アクセント・短い単独語に関わらず、ひらがなを含まない行は送らない
test('FR-118 AC-692: 長い語を含む行・アクセント文字の行・短い単独語の行は断片も送らない（ひらがなを含む文は語を残す）', async () => {
  const h = makeRelay();
  const { app } = await bootApp(h);
  await enableLlm(app);
  const txt = ['Supercalifragilisticexpialidocious Alice', 'https://verylonghostname-example.com/x', 'Müller Straße', '山口', '予算の見直しが必要です', ''].join('\n');
  await app.importTextFile({ name: 'c.txt', type: 'text/plain', size: txt.length, text: txt });
  await app.runBatch(app.getBatchStyles()[0].id); await app.flushLlm();
  const sent = h.llmReqs().map((q) => q.body.input).join('\n');
  for (const w of ['Supercali', 'Alice', 'https', 'example', 'verylong', 'Stra', 'ller', '山口']) assert.ok(!sent.includes(w), `${w} は送らない`);
  assert.ok(sent.includes('見直'), 'ひらがなを含む日本語の文は語を残す（AC-690）');
});

// FR-118 AC-686: 未読込・ライブモードでは実行しない
test('FR-118 AC-686: 読み込む前とライブモードでは実行できず、スタイルは無効の理由つき', async () => {
  const { app } = await newApp();
  assert.equal(app.getBatchState().visible, false);
  assert.equal((await app.runBatch(app.getBatchStyles()[0].id)).reason, 'not_batch');
  app.setInputMode('batch');
  assert.equal(app.getBatchState().state, 'idle');
  assert.equal((await app.runBatch(app.getBatchStyles()[0].id)).reason, 'no_input');
  assert.ok(app.getBatchStyles().every((x) => x.enabled === false && /ファイルを読み込んでください/.test(x.disabledReason)));
});
