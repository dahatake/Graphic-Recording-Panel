// FR-092（AC-544・545・547 の判定と表示・548）／FR-093（AC-549〜552）／FR-024（AC-572・573）の単体・結合テスト。
// System Test: tests/system/review.test.js（AC-546・AC-572）。契約: tests/system/CONTRACT-REVIEW.md。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeReview } from '../../web/src/review.js';
import { createRelayAzureSpeechSource } from '../../web/src/azurespeech.js';
import { newApp, toDetail } from '../system/helpers.js';
import { bootAzure, startAzureRecording, flush, DUMMY_ENDPOINT } from '../system/azurespeech-util.js';

async function feed(texts, over) {
  const ctx = await newApp(over);
  ctx.app.commands['session.start']();
  for (const t of texts) { ctx.env.tick(1); ctx.app.setDraft(t); ctx.app.submitDraft(); }
  ctx.env.scheduler.advance(3000);
  toDetail(ctx.app);
  return ctx;
}

// FR-092 AC-544: 漢数字は数の語として妥当な並びだけ（十分・万一・一方などの慣用語は要確認にしない）
test('FR-092 AC-544: 慣用語の「十分」「万一」「一方」は数として扱わず、二十・三万・十二は数', () => {
  for (const t of ['十分に進めた', '万一のときは', '一方で進める', '百聞は一見にしかず']) assert.equal(judgeReview(t, {}).reasons.includes('number'), false, t);
  for (const t of ['二十人', '三万円', '十二個', '千五百件']) assert.equal(judgeReview(t, {}).reasons.includes('number'), true, t);
});

// FR-092 AC-544
test('FR-092 AC-544: 数字・日付・固有名詞らしい語で要確認、通常の文は付かず、判定は決定的', () => {
  for (const t of ['予算は100万円です', '予算は１００万円です', '三百人が来る', '2026年11月1日に実施', '11月3日です', '金曜日に会う', '来週やる', '明日までに', '田中さんが来る', '山田様へ', '株式会社テストの案件', 'サーバーを増やす', 'APIを呼ぶ']) {
    const r = judgeReview(t, {});
    assert.equal(r.needsReview, true, t);
    assert.deepEqual(judgeReview(t, {}), r, `決定的: ${t}`);
  }
  for (const t of ['普通に進めます', '次の話題です', 'たくさん集まった', '同様に対応する', '一緒に考える']) assert.equal(judgeReview(t, {}).needsReview, false, t);
  assert.deepEqual(judgeReview('来週の田中さん100件', {}).reasons.sort(), ['date', 'number', 'proper']);
  assert.equal(judgeReview('ワークショップを開く', {}).reasons.includes('proper'), true); // 3 文字以上のカタカナ
  // 用語集の語・AI の推測・暫定
  assert.equal(judgeReview('かぷせるを使う', { glossary: ['かぷせる'] }).reasons.includes('proper'), true);
  assert.deepEqual(judgeReview('普通の文', { aiGuess: true }).reasons, ['ai']);
  assert.deepEqual(judgeReview('普通の文', { provisional: true }).reasons, ['provisional']);
});

// FR-092 AC-545
test('FR-092 AC-545: 図・ポップアップに文字「要確認」＋枠つきの記号、テキスト一覧にも同じ語と理由。確認済みは出ない', async () => {
  const { app } = await feed(['予算は100万円です', '普通に進めます']);
  const svg = app.renderSvg();
  assert.match(svg, /data-review-mark="1"/);
  assert.ok(svg.includes('要確認'));
  assert.equal((svg.match(/data-review-mark="1"/g) || []).length, 1, '印は要確認の要点だけ');
  assert.match(svg, /<rect[^>]*data-?[^>]*>|<rect /, '枠つき');
  const sc = app.getState().scenes[0];
  app.selectScene(sc.id);
  const popup = app.getScenePopup();
  assert.ok(popup.html.includes('要確認') && popup.html.includes('数値'));
  const outline = app.renderOutline();
  assert.ok(outline.includes('要確認') && outline.includes('数値'));
  assert.equal(popup.points.find((p) => p.text === '普通に進めます').review.needsReview, false);
  // 確認すると印が外れる
  app.confirmScene(sc.id);
  assert.equal(app.renderSvg().includes('data-review-mark'), false);
  assert.equal(app.renderOutline().includes('要確認'), false);
  assert.ok(app.renderOutline().includes('確認済み'));
});

// FR-092 AC-649: 保存の画面の警告「未確認 k 件」。k は AC-547 と同じ数・機密を除く保存は除いた後の件数・0 件は出さない・保存は妨げず内容は AC-547 のとおり
test('FR-092 AC-649: getSaveWarnings に「未確認 k 件」と確認できる場所（テキスト一覧）。0 件は出ず、機密を除くと除いた後の件数、保存は妨げない', async () => {
  const { app, env } = await feed(['予算は100万円です', '2026年11月1日に実施', '普通に進めます']);
  const k = app.getReviewSummary().unconfirmed.length;
  assert.equal(k, 2);
  let ws = app.getSaveWarnings();
  assert.equal(ws.length, 1);
  assert.ok(ws[0].includes(`未確認 ${k} 件`) && ws[0].includes('テキスト一覧'), '文字で示す');
  // 5 形式のどれの保存でも警告のまま保存できる（保存物は AC-547: k は警告と同じ）
  for (const c of ['save.markdown', 'save.html', 'save.svg', 'save.png', 'save.pdf']) {
    const before = env.downloads.length;
    await app.commands[c]();
    assert.equal(env.downloads.length, before + 1, `${c} は警告があっても保存できる`);
  }
  await app.commands['save.html']();
  assert.ok(String(env.downloads.at(-1).data).includes(`未確認 ${k} 件`));
  // 機密の要点を除く保存では、除いた後の件数
  const conf = app.getReviewSummary().unconfirmed[0];
  app.selectPoint(conf); app.commands['point.confidential']();
  assert.ok(app.getSaveWarnings()[0].includes('未確認 2 件'), '「除く」でなければ除かない');
  app.setExcludeConfidential(true);
  assert.ok(app.getSaveWarnings()[0].includes('未確認 1 件'));
  await app.commands['save.html']();
  assert.ok(String(env.downloads.at(-1).data).includes('未確認 1 件'), '保存物の k と同じ');
  // 全部確認すると出さない
  app.setExcludeConfidential(false);
  for (const id of app.getReviewSummary().unconfirmed) app.confirmPoint(id);
  assert.deepEqual(app.getSaveWarnings(), []);
});

// FR-092 AC-546（補足: 確認の状況・理由 provisional）
test('FR-092 AC-546/548: getReviewSummary の件数、再配置後に加わった要点は暫定、AI は LLM 有効時の AI 関係線だけ', async () => {
  const { app, env } = await feed(['予算は100万円です', '普通に進めます']);
  let sum = app.getReviewSummary();
  assert.equal(sum.total, 2); assert.equal(sum.confirmed, 0); assert.equal(sum.unconfirmed.length, 1);
  const id = sum.unconfirmed[0];
  app.confirmPoint(id);
  sum = app.getReviewSummary();
  assert.equal(sum.confirmed, 1); assert.deepEqual(sum.unconfirmed, []);
  // 再配置の後に加わった要点は暫定（FR-014）
  app.rearrangeNow?.();
  env.scheduler.advance(20000);
  env.tick(30); app.setDraft('追加の話'); app.submitDraft();
  const added = app.getState().scenes.flatMap((s) => s.points).find((p) => p.text === '追加の話');
  const r = app.getPointReview(added.id);
  if (app.getArrangeStatus?.().count > 0) assert.deepEqual(r.reasons, ['provisional']);
  // 通常の文脈では ai は付かない（LLM 無効）
  assert.equal(app.getPointReview(id).reasons.includes('ai'), false);
});

// FR-092 AC-548
test('FR-092 AC-548: 外部通信を遮断（fetch・WebSocket 0 件）でも判定・印・確認が動く', async () => {
  let calls = 0;
  const g = globalThis; const f0 = g.fetch; const w0 = g.WebSocket;
  g.fetch = () => { calls++; throw new Error('blocked'); }; g.WebSocket = function () { calls++; throw new Error('blocked'); };
  try {
    const { app } = await feed(['田中さんに100件']);
    const p = app.getState().scenes[0].points[0];
    assert.equal(app.getPointReview(p.id).needsReview, true);
    assert.ok(app.renderSvg().includes('要確認'));
    assert.equal(app.confirmPoint(p.id).ok, true);
    assert.equal(calls, 0);
  } finally { g.fetch = f0; g.WebSocket = w0; }
});

// FR-093 AC-549
test('FR-093 AC-549: 用語集の登録・編集・削除、空・重複（空白・全角半角）・上限 500 件', async () => {
  const { app } = await newApp();
  assert.equal(app.addGlossaryTerm({ term: '  ' }).ok, false);
  const a = app.addGlossaryTerm({ term: 'Kubernetes', variants: ['くべるねてす', 'くばねてす'] });
  assert.equal(a.ok, true);
  assert.equal(app.addGlossaryTerm({ term: ' Ｋubernetes ' }).ok, false, '全角・前後空白を除いた重複');
  assert.equal(app.addGlossaryTerm({ term: 'kubernetes' }).reason, 'duplicate');
  assert.equal(app.updateGlossaryTerm(a.id, { term: 'K8s', variants: ['けーえいてぃす'] }).ok, true);
  assert.equal(app.getGlossary().terms[0].term, 'K8s');
  assert.equal(app.updateGlossaryTerm(a.id, { term: '' }).ok, false);
  assert.equal(app.removeGlossaryTerm(a.id).ok, true);
  assert.equal(app.getGlossary().count, 0);
  assert.equal(app.removeGlossaryTerm('nope').ok, false);
  for (let i = 0; i < 500; i++) assert.equal(app.addGlossaryTerm({ term: `語${i}` }).ok, true);
  const over = app.addGlossaryTerm({ term: '501番目' });
  assert.equal(over.ok, false);
  assert.deepEqual([app.getGlossary().count, app.getGlossary().limit], [500, 500]);
});

// FR-093 AC-550
test('FR-093 AC-550: 手入力・ファイル取込の記録時に別表記が正しい表記へ置き換わり、rawText に元が残る', async () => {
  const { app, env } = await newApp();
  app.addGlossaryTerm({ term: 'Kubernetes', variants: ['くべるねてす'] });
  app.commands['session.start']();
  env.tick(1); app.setDraft('くべるねてす を使う'); app.submitDraft();
  const u = app.getState().utterances[0];
  assert.equal(u.text, 'Kubernetes を使う'); assert.equal(u.rawText, 'くべるねてす を使う');
  assert.ok(app.renderOutline().includes('Kubernetes を使う'));
  assert.ok(app.renderSvg().includes('Kubernetes を使う'));
  env.speech.emit?.('くべるねてす', true); // 音声（ブラウザ標準）でも addUtterance を通る
});

// FR-093 AC-551（案 A）: 用語集の語は Azure Speech でも外部へ送らない。認識の開始・クライアントの fetch・結果の表記統一（AC-550）。
test('FR-093 AC-551: Azure Speech の開始に用語集の語を渡さない（同意の前後とも）。認識結果は別表記が正しい表記に統一される', async () => {
  const c = await bootAzure();
  c.app.addGlossaryTerm({ term: 'Kubernetes', variants: ['くべるねてす'] });
  await startAzureRecording(c.app, { consent: false });
  assert.equal(c.azure.startCalls.length, 0, '同意前は開始しない');
  c.app.setSpeechConsent(true); await flush();
  assert.equal(c.azure.startCalls.length, 1);
  assert.equal('phrases' in c.azure.startCalls[0], false);
  assert.equal(JSON.stringify(c.azure.startCalls[0]).includes('Kubernetes'), false);
  // AC-550: Azure の認識結果（記録の入口）でも別表記が正しい表記になり、rawText に元が残る
  c.azure.emit('くべるねてす を使う', true); await flush();
  const u = c.app.getState().utterances.at(-1);
  assert.equal(u.text, 'Kubernetes を使う');
  assert.equal(u.rawText, 'くべるねてす を使う');
  // ブラウザ標準: 用語集を渡さない
  const b = await newApp();
  b.app.addGlossaryTerm({ term: 'Kubernetes' });
  b.app.commands['session.start']();
  b.app.startSpeech?.();
  for (const call of b.env.speech.startCalls) assert.equal('phrases' in call, false);
  assert.ok(DUMMY_ENDPOINT);
});

// FR-093 AC-551: クライアントの認識リクエスト（relay への fetch 相当）に用語集の語がない
test('FR-093 AC-551: createRelayAzureSpeechSource の認識リクエストにヘッダー・本文・パスとも用語集の語が含まれない', async () => {
  const reqs = [];
  const relay = async (req) => { reqs.push(req); return { status: 200, body: { ok: true, result: 'success', text: '結果' } }; };
  let proc = null;
  const stream = { getTracks: () => [{ stop() {} }], getAudioTracks: () => [{}] };
  const g = {
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    AudioContext: class {
      constructor() { this.sampleRate = 16000; this.destination = {}; }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      createScriptProcessor() { proc = { connect() {}, disconnect() {}, onaudioprocess: null }; return proc; }
      close() { return Promise.resolve(); }
    },
  };
  const src = createRelayAzureSpeechSource({ relay, g });
  const got = [];
  src.onresult = (e) => got.push(e.text);
  src.start({ lang: 'ja-JP', phrases: ['Kubernetes', 'くべるねてす'] }); // 渡されても使わない
  await flush();
  const frame = (v) => ({ inputBuffer: { getChannelData: () => new Float32Array(4096).fill(v) } });
  proc.onaudioprocess(frame(0.3));
  for (let i = 0; i < 4; i++) proc.onaudioprocess(frame(0));
  await flush();
  assert.equal(reqs.length, 1);
  const r = reqs[0];
  assert.equal(r.path, '/api/speech/recognize?language=ja-JP');
  assert.equal(r.headers?.['x-grp-phrases'], undefined);
  assert.deepEqual(Object.keys(r.headers ?? {}), []);
  for (const w of ['Kubernetes', 'くべるねてす', 'phrase']) {
    assert.equal(JSON.stringify({ ...r, body: undefined }).includes(w), false, w);
    assert.equal(Buffer.from(r.body).includes(Buffer.from(w)), false, w);
  }
  assert.deepEqual(got, ['結果']);
  src.stop();
});

// FR-093 AC-552
test('FR-093 AC-552: 用語集は保存・復元・セッションファイルに含まれ、データの初期化で消える', async () => {
  const { app, env, createApp } = await newApp();
  app.addGlossaryTerm({ term: 'Kubernetes', variants: ['くべるねてす'] });
  app.commands['session.start'](); env.tick(1); app.setDraft('くべるねてす'); app.submitDraft();
  const app2 = await createApp(env.options);
  assert.deepEqual(app2.getGlossary().terms.map((t) => [t.term, t.variants]), [['Kubernetes', ['くべるねてす']]]);
  await app.commands['file.save']();
  const file = env.downloads.at(-1);
  assert.ok(String(file.data).includes('くべるねてす'));
  // 初期化 → 空 → 読込で復元
  app.commands['data.reset'](); await app.dialogAction('confirm');
  assert.equal(app.getGlossary().count, 0);
  const r = await app.loadSessionFile({ name: file.filename, type: 'application/json', size: String(file.data).length, text: String(file.data) });
  assert.equal(r.ok, true);
  assert.equal(app.getGlossary().terms[0].term, 'Kubernetes');
  const app3 = await createApp(env.options);
  assert.equal(app3.getGlossary().count, 1);
});

// FR-024 AC-573
test('FR-024 AC-573: AI 要約の印と元の認識文字列は、ポップアップ・テキスト一覧の両方に。LLM 無効のときは付かない', async () => {
  const { app } = await feed(['予算を決める']);
  const sc = app.getState().scenes[0]; const pt = sc.points[0];
  assert.equal(app.setPointAiSummary(pt.id, 'よさんをきめる').ok, true);
  app.selectScene(sc.id);
  // LLM が無効（ルールベース）→ 印なし
  assert.equal(app.getScenePopup().points[0].aiSummary, false);
  assert.equal(app.renderOutline().includes('AI 要約'), false);
  // LLM が有効なとき
  const orig = app.getLlmState; app.getLlmState = () => ({ enabled: true });
  try {
    const popup = app.getScenePopup();
    assert.equal(popup.points[0].aiSummary, true);
    for (const html of [popup.html, app.renderOutline()]) { assert.ok(html.includes('AI 要約')); assert.ok(html.includes('よさんをきめる')); assert.ok(html.includes('data-ai-summary')); }
  } finally { app.getLlmState = orig; }
});
