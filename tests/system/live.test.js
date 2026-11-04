// FR-014 AC-521（ライブの更新間隔）／FR-022 AC-523（バッチ描画）（System Test。契約: tests/system/CONTRACT-LIVE-EXPORT.md）
// 期待値は要求定義書の受入基準（PARAM-098〜101・PARAM-001・PARAM-183）だけから決める。2026-11-05: 更新間隔の範囲 5〜60 秒、.vtt の再生取込（AC-671）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, PARAM, toDetail, CJK } from './helpers.js';
import { showApp, reload, sfield, assertOps, weight, SHOW } from './liveshow-util.js';

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
  env.scheduler.advance(PARAM.SINGLE_SEC * SEC); // PARAM-158（単発の反映）。PARAM-001 ではない
  for (const l of lines) assert.ok(app.renderSvg().includes(l), l);
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

// ---- FR-022 AC-671（.vtt の再生取込。契約: tests/system/CONTRACT-LIVE-SHOW.md「再生取込」）----
// cue の開始時刻 1.0・5.5・0.5（直前より前に戻る → 直前の時刻）・31.0・33.0 秒 → AC-113 の受付時刻の差は 0・4.5・4.5・30・32 秒。
// 30 秒の cue の前は 25.5 秒空くので PARAM-002（20 秒）を超え、シーンが分かれる（AC-113）。
const REPLAY_TEXTS = ['再生の話題その一', '再生の話題その二', '再生の話題その三', '再生の話題その四', '再生の話題その五'];
const REPLAY_OFF = [0, 4500, 4500, 30000, 32000];
const REPLAY_VTT = ['WEBVTT', '',
  'cue-a', '00:00:01.000 --> 00:00:04.000', `<v 山田太郎>${REPLAY_TEXTS[0]}</v>`, '',
  'cue-b', '00:00:05.500 --> 00:00:06.000', `<v 佐藤花子>${REPLAY_TEXTS[1]}</v>`, '',
  'cue-c', '00:00:00.500 --> 00:00:01.000', `<v 山田太郎>${REPLAY_TEXTS[2]}</v>`, '',
  'cue-d', '00:00:31.000 --> 00:00:32.000', `<v 鈴木一郎>${REPLAY_TEXTS[3]}</v>`, '',
  'cue-e', '00:00:33.000 --> 00:00:34.000', `<v 佐藤花子>${REPLAY_TEXTS[4]}</v>`, ''].join('\n');
const REPLAY_ITV = 7; // 更新間隔（cue の到着の時刻と重ならない値）
const utt = (app) => app.getState().utterances;
const sceneTexts = (app) => app.getState().scenes.map((s) => s.points.map((p) => p.text).join('|'));

function spyNet() {
  const calls = []; const saved = {};
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
  for (const k of names) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: function (...a) { calls.push({ k, a: String(a[0]) }); throw new Error('network blocked'); } });
  }
  return { calls, restore() { for (const k of names) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; } } };
}

// FR-022 AC-671
test('FR-022 AC-671: .vtt の取込の方法は既定が「一括」で、「再生取込」と速さ（PARAM-183: 1・2・4・8 倍）を選べ、端末ごとに保存されて再読込後に復元される。不正な方法・速さは受け付けない', async () => {
  const a = await showApp();
  const { app } = a;
  const m = app.getVttImportMode();
  assert.equal(m.mode, 'bulk', '既定は一括（AC-523）');
  assert.equal(m.speed, 1, '速さの既定は 1 倍');
  assert.deepEqual([...m.speeds].sort((x, y) => x - y), SHOW.SPEEDS, '速さの選択肢は PARAM-183');
  for (const s of SHOW.SPEEDS) {
    assert.equal(app.setVttImportMode({ mode: 'replay', speed: s }).ok, true, `${s} 倍`);
    assert.deepEqual([app.getVttImportMode().mode, app.getVttImportMode().speed], ['replay', s]);
  }
  assert.equal(app.setVttImportMode({ mode: 'replay', speed: 4 }).ok, true);
  for (const bad of [{ mode: 'stream' }, { mode: 'replay', speed: 3 }, { mode: 'replay', speed: 0 }, { mode: 'replay', speed: 16 }, { mode: 'replay', speed: 'fast' }, { mode: 'replay', speed: -2 }, null]) {
    let r; try { r = app.setVttImportMode(bad); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, `${JSON.stringify(bad)} は受け付けない`);
    assert.deepEqual([app.getVttImportMode().mode, app.getVttImportMode().speed], ['replay', 4], '直前の選択が保たれる');
  }
  const b = await reload(a);
  assert.deepEqual([b.app.getVttImportMode().mode, b.app.getVttImportMode().speed], ['replay', 4], '再読込後に復元される');
});

// FR-022 AC-671（テスト用の時計: cue は受付時刻の差÷速さごとに届き、図は更新間隔ごとにまとめて描き足される。結果は速さによらず一括と同じ）
test('FR-022 AC-671: 再生取込では cue が受付時刻の差を速さで割った時間ごとに順に確定結果として届き、進み具合が文字で示され、図は更新間隔ごとにまとめて描き足される。発話の内容・順・受付時刻・シーンの分かれ方は速さによらず一括と同じで、話者名を含まず、外部へのリクエストは 0 件', async () => {
  // 一括（AC-523）の結果を基準にする
  const ref = await showApp();
  ref.app.commands['session.start']();
  const refT0 = ref.clock.t;
  assert.equal((await ref.app.importTextFile(file('replay.vtt', REPLAY_VTT))).ok, true);
  ref.scheduler.advance(PARAM.SINGLE_SEC * SEC);
  const refTexts = utt(ref.app).map((u) => u.text);
  assert.deepEqual(refTexts, REPLAY_TEXTS, '一括の発話（AC-113）');
  assert.deepEqual(utt(ref.app).map((u) => u.receivedAt - refT0), REPLAY_OFF, '一括の受付時刻（AC-113）');
  const refScenes = sceneTexts(ref.app);
  assert.equal(ref.app.getState().scenes.length, 2, '25.5 秒の差でシーンが分かれる');

  const net = spyNet();
  try {
    for (const s of SHOW.SPEEDS) {
      const { app, scheduler, clock } = await showApp();
      app.commands['session.start']();
      assert.equal(app.setLiveInterval(REPLAY_ITV).ok, true);
      assert.equal(app.setVttImportMode({ mode: 'replay', speed: s }).ok, true);
      const ts0 = scheduler.t; const t0 = clock.t; const c0 = count(app);
      assert.equal((await app.importTextFile(file('replay.vtt', REPLAY_VTT))).ok, true, `${s} 倍: 取込を受け付ける`);
      const arrive = REPLAY_OFF.map((d) => Math.ceil(d / s));
      const expectedRefresh = [...new Set(arrive.map((x) => (Math.floor(x / (REPLAY_ITV * SEC)) + 1) * REPLAY_ITV * SEC))];
      const nAt = (t) => arrive.filter((x) => x <= t).length;
      const checkpoints = [...new Set(arrive.flatMap((x) => (x > 0 ? [x - 1, x] : [0])))].sort((x, y) => x - y);
      const refreshAt = []; let last = c0;
      const stepTo = (target) => {
        while (scheduler.t - ts0 < target) {
          const cur = scheduler.t - ts0; scheduler.advance(Math.min(target, Math.floor(cur / 50) * 50 + 50) - cur);
          const c = count(app);
          if (c !== last) { assert.equal(c, last + 1, `${s} 倍: 1 回ずつ描き足す`); refreshAt.push(scheduler.t - ts0); last = c; }
        }
      };
      for (const t of checkpoints) {
        stepTo(t);
        assert.equal(utt(app).length, nAt(t), `${s} 倍: ${t} ms の時点で届いた cue は ${nAt(t)} 件`);
        const p = app.getVttReplay();
        assert.equal(p.total, REPLAY_TEXTS.length, `${s} 倍: 全体の数`);
        assert.equal(p.done, nAt(t), `${s} 倍: 取り込んだ数`);
        assert.ok(p.text.includes(String(p.done)) && p.text.includes(String(p.total)), `${s} 倍: 進み具合の文字「${p.text}」`);
      }
      stepTo(REPLAY_ITV * SEC - 1);
      for (const w of REPLAY_TEXTS) assert.ok(!app.renderSvg().includes(w), `${s} 倍: 最初の更新の時点より前は図に描き足さない（一括のように待たずには描かない）`);
      stepTo(expectedRefresh.at(-1) + PARAM.RENDER_SEC * SEC);
      assert.deepEqual(refreshAt.map((t) => Math.ceil(t / 50) * 50), expectedRefresh, `${s} 倍: 更新間隔の時点にだけまとめて描き足す`);
      for (const w of REPLAY_TEXTS) assert.ok(app.renderSvg().includes(w), `${s} 倍: ${w} が図にある`);
      assert.equal(app.getVttReplay().running, false, `${s} 倍: 終わる`);
      assert.deepEqual(utt(app).map((u) => u.text), refTexts, `${s} 倍: 内容と順は一括と同じ`);
      assert.deepEqual(utt(app).map((u) => u.receivedAt - t0), REPLAY_OFF, `${s} 倍: 受付時刻は一括と同じ（取込の開始時刻＋cue の開始時刻の差）`);
      assert.deepEqual(sceneTexts(app), refScenes, `${s} 倍: シーンの分かれ方は一括と同じ`);
      const all = utt(app).map((u) => u.text).join('\n') + app.renderSvg() + app.renderTranscript();
      for (const bad of ['山田太郎', '佐藤花子', '鈴木一郎', '-->', 'cue-']) assert.ok(!all.includes(bad), `${s} 倍: 「${bad}」を含まない`);
    }
    assert.deepEqual(net.calls, [], '外部へのリクエストは 0 件');
  } finally { net.restore(); }
});

// FR-022 AC-671 異常系
test('FR-022 AC-671 異常系: 再生取込は一時停止・再開・中止ができ、一時停止中は届かず、中止しても取り込み済みの発話は残る。取り込めないファイルでは再生取込は始まらず発話は変わらない', async () => {
  const { app, scheduler } = await showApp();
  app.commands['session.start']();
  assert.equal(app.setLiveInterval(REPLAY_ITV).ok, true);
  assert.equal(app.setVttImportMode({ mode: 'replay', speed: 1 }).ok, true);
  for (const bad of [file('x.vtt', 'これは WebVTT ではない'), file('e.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v A></v>\n'), file('x.bin', 'バイナリ', 'application/octet-stream')]) {
    assert.equal((await app.importTextFile(bad)).ok, false, `${bad.name} は取り込めない`);
    assert.ok(!app.getVttReplay()?.running, `${bad.name}: 再生取込は始まらない`);
    assert.equal(utt(app).length, 0);
  }
  const ts0 = scheduler.t;
  assert.equal((await app.importTextFile(file('replay.vtt', REPLAY_VTT))).ok, true);
  scheduler.advanceTo(ts0 + REPLAY_OFF[1]);
  assert.equal(utt(app).length, 3);
  app.commands['vttReplay.pause']();
  assert.equal(app.getVttReplay().paused, true, '一時停止');
  scheduler.advance(2 * REPLAY_OFF[4]);
  assert.equal(utt(app).length, 3, '一時停止中は届かない');
  assert.equal(app.getVttReplay().done, 3);
  app.commands['vttReplay.resume']();
  assert.equal(app.getVttReplay().paused, false, '再開');
  scheduler.advance(REPLAY_OFF[3] - REPLAY_OFF[1]);
  assert.equal(utt(app).length, 4, '再開すると残りの cue が続けて届く');
  app.commands['vttReplay.cancel']();
  assert.equal(app.getVttReplay()?.running ?? false, false, '中止');
  scheduler.advance(2 * REPLAY_OFF[4]);
  assert.deepEqual(utt(app).map((u) => u.text), REPLAY_TEXTS.slice(0, 4), '中止しても取り込み済みの発話は残り、残りは届かない');
  scheduler.advance((REPLAY_ITV + PARAM.RENDER_SEC) * SEC);
  for (const w of REPLAY_TEXTS.slice(0, 4)) assert.ok(app.renderSvg().includes(w), `取り込み済みの「${w}」は図にある`);
  assert.ok(!app.renderSvg().includes(REPLAY_TEXTS[4]));
});
