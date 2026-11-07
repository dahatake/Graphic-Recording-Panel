// FR-014 AC-521（ライブの更新間隔）／FR-022 AC-523（バッチ描画）（System Test。契約: tests/system/CONTRACT-LIVE-EXPORT.md）
// 期待値は要求定義書の受入基準（PARAM-098〜101・PARAM-001）だけから決める。2026-11-05: 更新間隔の範囲 5〜60 秒。2026-11-06: ファイル由来の発話は更新の対象外・ファイル読込時のリアルタイム描画（.vtt の再生取込 AC-671）は廃止。契約: CONTRACT-BATCH.md。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, PARAM, toDetail, CJK } from './helpers.js';
import { showApp, reload, sfield, assertOps, weight, SHOW, show, overlays, sample } from './liveshow-util.js';
import { parseSvg } from './stylepreset-util.js';

const SEC = 1000;
const startRec = (app) => { app.commands['session.start'](); app.startSpeech(); };
const count = (app) => app.getLiveRefresh().count;

// FR-014 AC-521
test('FR-014 AC-521: ライブの記録中、更新間隔（既定 10 秒、5〜60 秒）ごとに、その間に確定した発話をまとめて 1 回で描画し、発話がなかった間隔では更新しない', async () => {
  const { app, env } = await newApp(); toDetail(app);
  const itv = app.getLiveInterval();
  assert.equal(itv.sec, PARAM.LIVE_DEFAULT_SEC, '初期値 PARAM-100');
  assert.equal(itv.min, PARAM.LIVE_MIN_SEC, 'PARAM-098'); assert.equal(itv.max, PARAM.LIVE_MAX_SEC, 'PARAM-099');
  startRec(app);
  const c0 = count(app);
  env.speech.emit('予算の見直しを話す', true);
  env.scheduler.advance(2 * SEC);
  env.speech.emit('来月の計画を決める', true);
  assert.equal(app.getState().utterances.length, 2, '確定した発話は記録される');
  env.scheduler.advance(PARAM.LIVE_DEFAULT_SEC * SEC);
  assert.equal(count(app), c0 + 1, '2 件の発話は更新間隔の 1 回の更新にまとまる');
  env.scheduler.advance(PARAM.RENDER_SEC * SEC);
  assert.ok(app.renderSvg().includes('予算の見直しを話す') && app.renderSvg().includes('来月の計画を決める'), '描き足した要素が図にある');
  const c1 = count(app);
  env.scheduler.advance(3 * PARAM.LIVE_DEFAULT_SEC * SEC);
  assert.equal(count(app), c1, '新しい発話がなかった間隔では描画を更新しない');
  env.speech.emit('担当者を割り当てる', true);
  env.scheduler.advance((PARAM.LIVE_DEFAULT_SEC + PARAM.RENDER_SEC) * SEC);
  assert.equal(count(app), c1 + 1, '新しい発話があった間隔では 1 回更新する');
  assert.ok(app.renderSvg().includes('担当者を割り当てる'));
});

// FR-014 AC-521（テスト用の時計: 更新間隔 T 秒ごとにちょうど 1 回。T は下限・中間・上限）
test('FR-014 AC-521: 更新間隔を T 秒に設定し T 秒の間に確定結果を複数件送ると、次の更新の時点でちょうど 1 回だけ全件が描き足され、その時点の前と、その後の次の時点までは新しい要素が加わらない', async () => {
  for (const T of [PARAM.LIVE_MIN_SEC, 7, PARAM.LIVE_MAX_SEC]) {
    const { app, env, scheduler } = await showApp();
    startRec(app);
    scheduler.advance(1234); // 記録の開始の時点からずらす
    assert.equal(app.setLiveInterval(T).ok, true, `${T} 秒は受け付ける`);
    const t0 = scheduler.t; // 変更した時点から新しい間隔で数え直す（AC-522）
    const c0 = count(app);
    const words = [`第一の話題その${T}`, `第二の話題その${T}`, `第三の話題その${T}`];
    scheduler.advance(300); env.speech.emit(words[0], true);
    scheduler.advanceTo(t0 + Math.floor((T * SEC) / 2)); env.speech.emit(words[1], true);
    scheduler.advanceTo(t0 + T * SEC - 100); env.speech.emit(words[2], true);
    scheduler.advanceTo(t0 + T * SEC - 1);
    assert.equal(count(app), c0, `T=${T}: 更新の時点より前には描き足さない`);
    for (const w of words) assert.ok(!app.renderSvg().includes(w), `T=${T}: 更新の時点より前に「${w}」は図にない`);
    scheduler.advanceTo(t0 + T * SEC);
    assert.equal(count(app), c0 + 1, `T=${T}: 更新の時点でちょうど 1 回`);
    scheduler.advance(PARAM.RENDER_SEC * SEC);
    for (const w of words) assert.ok(app.renderSvg().includes(w), `T=${T}: その間に届いた「${w}」が含まれる`);
    const later = `次の間隔の話題その${T}`;
    env.speech.emit(later, true);
    scheduler.advanceTo(t0 + 2 * T * SEC - 1);
    assert.equal(count(app), c0 + 1, `T=${T}: 次の時点までは描き足さない`);
    assert.ok(!app.renderSvg().includes(later), `T=${T}: 次の時点まで新しい要素は加わらない`);
    scheduler.advanceTo(t0 + 2 * T * SEC);
    assert.equal(count(app), c0 + 2, `T=${T}: 次の時点で 1 回`);
    scheduler.advance(PARAM.RENDER_SEC * SEC);
    assert.ok(app.renderSvg().includes(later));
    scheduler.advance(3 * T * SEC);
    assert.equal(count(app), c0 + 2, `T=${T}: 新しい発話がなかった間隔では更新しない`);
  }
});

// FR-014 AC-521（A-874 2026-11-05: 更新間隔の途中のシーンの区切り。AC-008 の［次のシーン］と AC-571 の議題の切替 timer.next）
const sceneOf = (app, text) => app.getState().scenes.findIndex((s) => s.points.some((p) => p.text.includes(text) || text.includes(p.text)));
test('FR-014 AC-521: 更新間隔の途中でシーンの区切り（［次のシーン］・議題の切替）が起きても、その時点では描き足さず、区切りの前の待ちの確定結果は前のシーンに属したまま次の更新の時点に、区切りの後の確定結果は新しいシーンで、同じ 1 回の更新で描き足される', async () => {
  const T = 10;
  for (const brk of ['session.nextScene', 'timer.next']) {
    const { app, env, scheduler } = await showApp();
    if (brk === 'timer.next') assert.equal(app.setMeetingContext({ agenda: [{ name: '現状の共有', minutes: 5 }, { name: '案の比較', minutes: 15 }] }).ok, true, '議題を設定できる');
    startRec(app);
    if (brk === 'timer.next') assert.equal(app.commands['timer.start']().ok, true, '議題が進行中');
    scheduler.advance(1234);
    assert.equal(app.setLiveInterval(T).ok, true);
    const t0 = scheduler.t; const c0 = count(app);
    const pre = [`区切りの前の話題その一${brk}`, `区切りの前の話題その二${brk}`];
    const post = `区切りの後の話題${brk}`;
    scheduler.advance(500); env.speech.emit(pre[0], true);
    scheduler.advanceTo(t0 + 2 * SEC); env.speech.emit(pre[1], true);
    scheduler.advanceTo(t0 + 4 * SEC);
    const r = app.commands[brk]();
    assert.notEqual(r && r.ok, false, `${brk}: 区切りの操作を受け付ける`);
    assert.equal(count(app), c0, `${brk}: 区切りの時点では描き足さない`);
    for (const w of pre) assert.ok(!app.renderSvg().includes(w), `${brk}: 区切りの時点で「${w}」は図にない`);
    assert.equal(app.renderSvg().includes(post), false);
    scheduler.advanceTo(t0 + 6 * SEC); env.speech.emit(post, true);
    scheduler.advanceTo(t0 + T * SEC - 1);
    assert.equal(count(app), c0, `${brk}: 次の更新の時点より前には描き足さない`);
    for (const w of [...pre, post])     assert.ok(!app.renderSvg().includes(w), `${brk}: 更新の時点より前に「${w}」は図にない`);
    scheduler.advanceTo(t0 + T * SEC);
    assert.equal(count(app), c0 + 1, `${brk}: 次の更新の時点でちょうど 1 回`);
    scheduler.advance(PARAM.RENDER_SEC * SEC);
    for (const w of [...pre, post]) assert.ok(app.renderSvg().includes(w), `${brk}: 「${w}」が描き足される`);
    const sPre = pre.map((w) => sceneOf(app, w));
    const sPost = sceneOf(app, post);
    assert.ok(sPre.every((i) => i >= 0) && sPost >= 0, `${brk}: 各発話がシーンにある（${sPre}・${sPost}）`);
    assert.equal(sPre[0], sPre[1], `${brk}: 区切りの前の 2 件は同じシーン`);
    assert.ok(sPost > sPre[0], `${brk}: 区切りの後の発話は新しいシーン（区切りは保たれる。前 ${sPre[0]}・後 ${sPost}）`);
    scheduler.advance(3 * T * SEC);
    assert.equal(count(app), c0 + 1, `${brk}: 新しい発話がなかった間隔では更新しない`);
  }
});

// FR-014 AC-521（2026-11-06: ファイル由来の発話は描き足しの対象外。手入力は更新間隔を待たない）
test('FR-014 AC-521: 更新間隔の描き足しの対象は音声入力の確定結果だけで、ファイル由来の発話（.txt・.vtt）は加わらず、手入力は更新間隔を待たず描かれる', async () => {
  const { app, env } = await newApp(); toDetail(app);
  startRec(app);
  assert.equal((await app.importTextFile({ name: 'f.txt', type: 'text/plain', size: 30, text: 'ファイルの発話その一\nファイルの発話その二\n' })).ok, true);
  env.speech.emit('音声の確定結果', true);
  app.setDraft('手入力の発話'); assert.equal(app.submitDraft().ok, true);
  env.scheduler.advance(PARAM.SINGLE_SEC * SEC);
  assert.ok(app.renderSvg().includes('手入力の発話'), '手入力は更新間隔を待たない');
  assert.ok(!app.renderSvg().includes('音声の確定結果'), '音声の確定結果は更新の時点まで加わらない');
  const sec = app.getLiveInterval().sec;
  env.scheduler.advance(sec * SEC);
  assert.ok(app.renderSvg().includes('音声の確定結果'), '更新の時点で描き足される');
  assert.ok(!app.renderSvg().includes('ファイルの発話その'), 'ファイル由来の発話は図に加わらない');
  const c = count(app);
  env.scheduler.advance(sec * SEC * 3);
  assert.equal(count(app), c, '新しい発話のない間隔（ファイル由来だけ）では更新しない');
});

// FR-014 AC-521 AC-522 異常系
test('FR-014 AC-521 AC-522 異常系: 更新間隔は 5〜60 の整数秒だけで、範囲外・整数でない・空の値は理由つきで受け付けず直前の値が保たれる。60 秒でも 60 秒以内に描画が始まる。一時停止中は更新しない', async () => {
  const { app, env } = await newApp(); toDetail(app);
  for (const [v, sec] of [[PARAM.LIVE_MIN_SEC, 5], [PARAM.LIVE_MAX_SEC, 60], [' 30 ', 30], ['12', 12], [PARAM.LIVE_MAX_SEC, 60]]) {
    assert.equal(app.setLiveInterval(v).ok, true, `${JSON.stringify(v)} は受け付ける`);
    assert.equal(app.getLiveInterval().sec, sec);
  }
  for (const bad of [PARAM.LIVE_MIN_SEC - 1, PARAM.LIVE_MAX_SEC + 1, 0, -10, 12.5, '12.5', 'abc', NaN, Infinity, '', '   ', null, undefined]) {
    let r; try { r = app.setLiveInterval(bad); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, `${String(bad)} は受け付けない`);
    assert.equal(app.getLiveInterval().sec, PARAM.LIVE_MAX_SEC, '直前の値が保たれる');
    assert.ok(app.getState().message?.text?.trim(), `${String(bad)}: 理由が表示される`);
  }
  startRec(app);
  const c = count(app);
  env.speech.emit('六十秒の間隔の確認', true);
  env.scheduler.advance(PARAM.LIVE_MAX_SEC * SEC);
  assert.equal(count(app), c + 1, '60 秒（PARAM-001）以内に描画が始まる');
  env.scheduler.advance(PARAM.RENDER_SEC * SEC);
  assert.ok(app.renderSvg().includes('六十秒の間隔の確認'));
  // 一時停止中の発話は記録されず、更新も起きない
  app.commands['session.pause']();
  const c2 = count(app);
  env.speech.emit('停止中の声', true);
  env.scheduler.advance(3 * PARAM.LIVE_MAX_SEC * SEC);
  assert.equal(count(app), c2);
  assert.ok(!app.renderSvg().includes('停止中の声'));
});

// FR-014 AC-522
test('FR-014 AC-522: 更新間隔は［設定］とコマンドの検索（PARAM-164 回以内・キーボードだけ）で変えられ、現在の値とラベル（PARAM-011 以内・表示言語）が示され、端末ごとに保存されて再読込後も保たれ、初期化・セッションファイルでは変わらない', async () => {
  const a = await showApp();
  const { app } = a;
  app.commands['settings.open']();
  const f = sfield(app, 'live.interval');
  assert.ok(f, '［設定］に更新間隔の項目がある');
  assert.equal(f.value, PARAM.LIVE_DEFAULT_SEC, '現在の値');
  assert.equal(f.min, PARAM.LIVE_MIN_SEC); assert.equal(f.max, PARAM.LIVE_MAX_SEC);
  assert.ok(f.label?.trim() && weight(f.label) <= 6, `ラベル「${f.label}」は PARAM-011 以内`);
  app.commands['settings.close']();
  assertOps(app, f.label, 'settings.liveInterval');
  app.commands['settings.liveInterval']();
  assert.equal(app.getSettingsDialog()?.focusedField, 'live.interval', '選ぶだけで更新間隔の項目にフォーカス');
  app.setSettingsFieldDraft('live.interval', '20');
  app.handleKey({ key: 'Enter' });
  assert.equal(app.getLiveInterval().sec, 20, 'キーボードだけで確定');
  assert.equal(sfield(app, 'live.interval').value, 20, '現在の値の表示も変わる');
  app.setSettingsFieldDraft('live.interval', '61');
  app.handleKey({ key: 'Enter' });
  assert.equal(app.getLiveInterval().sec, 20, '範囲外の打鍵は確定しない');
  app.setLang('en');
  const fe = sfield(app, 'live.interval');
  assert.ok(fe.label.trim() && !CJK.test(fe.label) && weight(fe.label) <= 6, `en: ${fe.label}`);
  app.setLang('ja');
  app.handleKey({ key: 'Escape' });
  app.commands['session.start']();
  app.setDraft('保存の確認の発話'); app.submitDraft();
  assert.equal((await app.commands['file.save']()).ok, true);
  const file = a.env.downloads.at(-1);
  assert.ok(!/live\.?interval|liveInterval/i.test(file.data), 'セッションファイルに含まれない');
  assert.equal(app.setLiveInterval(30).ok, true);
  app.commands['data.reset'](); app.dialogAction('confirm');
  assert.equal(app.getLiveInterval().sec, 30, 'データの初期化では変わらない');
  const lr = await app.loadSessionFile({ name: file.filename, type: 'application/json', size: file.data.length, text: file.data });
  if (lr.pending) await app.dialogAction('confirm');
  assert.equal(app.getLiveInterval().sec, 30, 'セッションファイルの読込では変わらない');
  const b = await reload(a);
  assert.equal(b.app.getLiveInterval().sec, 30, '再読込後も保たれる');
});

// FR-022 AC-523
const vtt = (n) => ['WEBVTT', '', ...Array.from({ length: n }, (_, i) => [`cue-${i}`, `00:00:${String(i * 3).padStart(2, '0')}.000 --> 00:00:${String(i * 3 + 2).padStart(2, '0')}.000`, `<v 話者${i}>バッチの話題その${i}を確認</v>`, '']).flat()].join('\n');
const file = (name, text, type = 'text/vtt') => ({ name, type, size: Buffer.byteLength(text), text });

test('FR-022 AC-523: 録画済み会議の .vtt／.txt を取り込んだだけでは（準備中・記録中・停止のどの状態でも）、図は更新されず、取込んだ発話は認識文字列の一覧にだけ並ぶ（ファイル読込時のリアルタイム描画は削除。2026-11-06）', async () => {
  for (const state of ['preparing', 'recording', 'stopped']) {
    const { app, env } = await newApp(); toDetail(app);
    if (state !== 'preparing') app.commands['session.start']();
    if (state === 'stopped') app.commands['session.stop']();
    const c0 = count(app); const before = JSON.stringify([app.getState().scenes, app.renderSvg(), app.renderOutline()]);
    const r = await app.importTextFile(file('meeting.vtt', vtt(8)));
    assert.equal(r.ok, true, state);
    env.scheduler.advance(PARAM.SINGLE_SEC * SEC);
    assert.equal(count(app), c0, `${state}: 描画は起きない`);
    assert.deepEqual(app.getTranscript().finals.map((f) => f.text), Array.from({ length: 8 }, (_, i) => `バッチの話題その${i}を確認`), `${state}: 一覧にだけ並ぶ`);
    env.scheduler.advance(PARAM.UPPER_SEC * SEC * 2); // 更新間隔を待っても図は更新されない（ファイル由来は更新の対象外。AC-521）
    assert.equal(JSON.stringify([app.getState().scenes, app.renderSvg(), app.renderOutline()]), before, `${state}: 図は更新されない`);
    assert.equal(count(app), c0, `${state}: 更新間隔を待っても描画は起きない`);
  }
  const { app, env } = await newApp(); toDetail(app);
  const lines = Array.from({ length: 30 }, (_, i) => `テキスト取込の行${i}の要点`);
  assert.equal((await app.importTextFile(file('m.txt', lines.join('\n'), 'text/plain'))).ok, true);
  env.scheduler.advance(PARAM.SINGLE_SEC * SEC);
  for (const l of lines) assert.ok(!app.renderSvg().includes(l), `${l} は図に出ない`);
  assert.equal(app.getTranscript().finals.length, 30);
});

// FR-022 AC-523（2026-11-06: 図は、読込後にグラレコのスタイルを選んで実行したとき、取込んだ全体が一度に描かれる。実行の時間は AC-697。ライブの更新間隔 PARAM-001 には従わない。契約: CONTRACT-BATCH.md）
test('FR-022 AC-523: ファイル読込後にスタイルを選んで実行すると、（ライブ描画ショー ON・更新間隔 60 秒でも）更新間隔を待たず、取込んだ全体が 1 回の描画で一度に図へ反映され、演出（描線・書き込み）を経ない。再生取込の API はない', async () => {
  const { app, scheduler } = await showApp();
  assert.equal(app.getVttImportMode, undefined, '再生取込（AC-671）は廃止');
  assert.equal(app.setVttImportMode, undefined);
  assert.equal(app.setLiveShow(true).ok, true, 'ライブ描画ショー ON');
  assert.equal(app.setLiveInterval(PARAM.LIVE_MAX_SEC).ok, true, '更新間隔を最大にして、待っていないことを区別する');
  assert.equal((await app.importTextFile(file('meeting.vtt', vtt(8)))).ok, true, '取込');
  assert.equal(app.getInputMode().mode, 'batch', '記録中でないので自動でファイル読込モード（AC-685）');
  assert.equal(app.getState().scenes.length, 0, '取込だけでは図は描かれない');
  const t0 = Date.now();
  const r = await app.runBatch(app.getBatchStyles()[0].id);
  assert.equal(r.ok, true);
  let animated = false;
  sample(scheduler, PARAM.SINGLE_SEC * SEC, () => {
    if ((show(app).items ?? []).some((x) => x.phase === 'stroke' || x.phase === 'write') || overlays(app).length > 0) animated = true;
  }, 50);
  assert.ok(Date.now() - t0 <= PARAM.SINGLE_SEC * SEC, '実行から PARAM-158 秒以内（ライブの更新間隔を待たない）');
  assert.equal(animated, false, 'バッチの描画は ON でも描線・書き込みの演出を経ない（全体が一度に描画される）');
  assert.equal(show(app).running, false);
  const svg = app.renderSvg();
  for (let i = 0; i < 8; i++) assert.ok(svg.includes(`バッチの話題その${i}を確認`), `cue ${i} が図にある`);
  assert.ok(app.getState().scenes.length >= 1);
  for (const s of app.getState().scenes) assert.ok(svg.includes(`data-scene-id="${s.id}"`), '全シーンが反映');
});

test('FR-022 AC-523 異常系: 取り込めない（テキストでない・空の）ファイルでは描画も図の変化も起きない', async () => {
  const { app, env } = await newApp(); toDetail(app);
  app.commands['session.start']();
  const c0 = count(app); const before = app.renderSvg();
  assert.equal((await app.importTextFile(file('x.bin', 'バイナリ', 'application/octet-stream'))).ok, false);
  assert.equal((await app.importTextFile(file('e.vtt', ''))).ok, false);
  env.scheduler.advance(PARAM.SINGLE_SEC * SEC);
  assert.equal(count(app), c0);
  assert.equal(app.renderSvg(), before);
});

