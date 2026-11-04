// FR-116 AC-676 AC-677 AC-678 AC-679（演出の音。System Test。契約: tests/system/CONTRACT-LIVE-SHOW.md「演出の音」）
// 期待値は要求定義書の受入基準（PARAM-184・PARAM-031・PARAM-164・PARAM-011）だけから決める。
// AudioContext は偽物（liveshow-util.js の makeFakeAudio。options.audioFactory で注入）に置き換え、作られた数・鳴らした音・
// destination までの gain の積（出力の大きさ）を数える。外部へのリクエストは fetch・XHR・WebSocket・EventSource・Audio・Image・sendBeacon を記録する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARAM, CJK } from './helpers.js';
import { T } from './rearrange-util.js';
import { SHOW, SFX_KINDS, showApp, brokenAudioFactory, spyNetwork, startRec, sample, show, sfield, assertOps, weight } from './liveshow-util.js';

const SEC = 1000;
const ITV = PARAM.LIVE_DEFAULT_SEC * SEC; // PARAM-100
const say = (env, text, fin = true) => env.speech.emit(text, fin);
const audio = (app) => app.getShowAudio();
const EVENT_TO_SFX = { stroke: 'pen', appear: 'pop', move: 'whoosh', decision: 'chime', celebrate: 'sparkle' };
// 2 回の更新（2 回目に「結論」を加え、再配置で既存の要素が動く）
const SCRIPT = [[1000, T.plain1], [2000, T.plain2], [3000, T.problem], [ITV + 3000, T.conclusion], [ITV + 4000, T.plain3]];
function runScript(r, until, onStep, dt = 20) {
  let i = 0; const base = r.scheduler.t;
  sample(r.scheduler, until, (t) => {
    while (i < SCRIPT.length && base + SCRIPT[i][0] <= r.scheduler.t) { say(r.env, SCRIPT[i][1]); i++; }
    if (onStep) onStep(t);
  }, dt);
}
const silent = (fa) => fa.count() === 0 || (fa.outputLevel() === 0 && fa.startedLevel(0) === 0);

// FR-116 AC-676
test('FR-116 AC-676: 起動から利用者の最初の操作までは、ショーが ON でも AudioContext は 0 個で音は鳴らない。操作の後はショーが ON のときだけ鳴り、OFF・ミュートでは鳴らない。外部へのリクエスト（音のファイルを含む）は 0 件', async () => {
  const net = spyNetwork();
  try {
    const first = await showApp();
    assert.equal(first.app.setLiveShow(true).ok, true);
    // 再読込（ショー ON は端末ごとの設定で復元される）。新しい偽の AudioContext で数える
    const r = await showApp({ storage: first.storage });
    const fa = r.audio;
    assert.equal(show(r.app).on, true, 'ショーは ON で起動する');
    startRec(r.app); // プログラムからのコマンドの呼び出しは利用者の操作ではない（契約）
    runScript(r, 2 * ITV, () => assert.equal(fa.count(), 0, '最初の操作の前は AudioContext を作らない'));
    assert.ok(r.app.renderSvg().includes(T.plain1), '音がなくても描き足しは進む');
    assert.deepEqual(audio(r.app).sfx ?? [], [], '最初の操作の前は効果音を鳴らさない');
    r.app.notifyUserGesture(); // 利用者の最初の操作（クリック・タップ・キー入力）
    const from = fa.log.starts.length;
    say(r.env, T.plain4);
    r.scheduler.advance(ITV + 8 * SEC);
    assert.ok(fa.count() >= 1, '操作の後、ショーが ON のときは音の仕組みを作る');
    assert.ok(fa.startedLevel(from) > 0, '操作の後、ショーが ON のときは音が鳴る');
    assert.ok((audio(r.app).sfx ?? []).length > 0, '効果音を鳴らした');

    // ショーが OFF のときは鳴らない
    const off = await showApp();
    off.app.notifyUserGesture(); startRec(off.app);
    runScript(off, 3 * ITV);
    assert.ok(silent(off.audio), 'ショーが OFF のときは AudioContext を作らないか、音は鳴らない');
    // ミュートのときは鳴らない（AC-228 のミュートと共通）
    const mu = await showApp();
    assert.equal(mu.app.setLiveShow(true).ok, true);
    assert.equal(mu.app.setRpgMuted(true).ok, true);
    mu.app.notifyUserGesture(); startRec(mu.app);
    runScript(mu, 3 * ITV);
    assert.ok(silent(mu.audio), 'ミュートのときは AudioContext を作らないか停止していて、音は鳴らない');
    for (const x of [fa, off.audio, mu.audio]) assert.equal(x.log.decodeCalls, 0, '音のファイルを読み込まない');
    assert.deepEqual(net.calls, [], '外部へのリクエストは 0 件');
  } finally { net.restore(); }
});

// FR-116 AC-677
test('FR-116 AC-677: ショーが ON でミュートでないとき、描線・現れる・運ぶ・決定・お祝いの出来事の時点に、それぞれペン・ポン・シュッ・チャイム・きらめきの互いに異なる効果音が鳴る。動きを減らす設定でも、現れる・移る時点で鳴る', async () => {
  const r = await showApp();
  assert.equal(r.app.setLiveShow(true).ok, true);
  r.app.notifyUserGesture(); startRec(r.app);
  runScript(r, 4 * ITV, null, 10);
  const events = (show(r.app).log ?? []).filter((e) => EVENT_TO_SFX[e.type]);
  const sfx = audio(r.app).sfx ?? [];
  for (const type of Object.keys(EVENT_TO_SFX)) assert.ok(events.some((e) => e.type === type), `出来事「${type}」が起きる`);
  for (const e of events) {
    assert.ok(sfx.some((s) => s.kind === EVENT_TO_SFX[e.type] && s.at === e.at), `${e.type}（${e.at}）の時点に ${EVENT_TO_SFX[e.type]} が鳴る`);
  }
  const sig = new Map();
  for (const s of sfx) if (!sig.has(s.kind)) sig.set(s.kind, `${s.wave}|${s.freq}|${s.durMs}`);
  assert.deepEqual([...sig.keys()].sort(), [...SFX_KINDS].sort(), '5 種類の効果音');
  assert.equal(new Set(sig.values()).size, SFX_KINDS.length, `5 種類は高さ・長さ・波形のどれかが異なる（${[...sig.values()].join(' / ')}）`);
  assert.ok(r.audio.log.starts.length > 0, '効果音は合成した音源で鳴る');

  const rm = await showApp({ reducedMotion: true });
  assert.equal(rm.app.setLiveShow(true).ok, true);
  rm.app.notifyUserGesture(); startRec(rm.app);
  runScript(rm, 4 * ITV);
  const kinds = new Set((audio(rm.app).sfx ?? []).map((s) => s.kind));
  assert.ok(kinds.has('pop'), '動きを減らす設定でも、要素が現れる時点で鳴る');
  assert.ok(kinds.has('whoosh'), '動きを減らす設定でも、要素が移る時点で鳴る');
});

// FR-116 AC-678
test('FR-116 AC-678: BGM は 3 曲以上から選べ ON/OFF でき（ショーが ON のときの既定は ON）、話している間は設定値の 30% まで 300 ms で下がり、無音が続くと 1000 ms で戻る。RPG風のときはこの BGM を鳴らさない', async () => {
  const r = await showApp();
  const a0 = audio(r.app);
  assert.ok(a0.tracks.length >= SHOW.BGM_TRACKS_MIN, `曲数 ${a0.tracks.length} ≥ ${SHOW.BGM_TRACKS_MIN}`);
  assert.equal(new Set(a0.tracks.map((x) => x.id)).size, a0.tracks.length);
  assert.equal(a0.bgmOn, true, 'BGM の既定は ON');
  assert.equal(r.app.setShowBgmTrack(a0.tracks[1].id).ok, true);
  assert.equal(audio(r.app).track, a0.tracks[1].id, '曲を選べる');
  assert.equal(r.app.setShowBgmTrack('no-such-track').ok, false, '無い曲は選べない');
  assert.equal(r.app.setLiveShow(true).ok, true);
  r.app.notifyUserGesture(); startRec(r.app);
  r.scheduler.advance(2 * SEC);
  assert.equal(audio(r.app).bgmPlaying, true, 'ショーが ON で BGM が鳴る');
  const full = audio(r.app).bgmLevel;
  assert.ok(full > 0, 'BGM の大きさ');
  say(r.env, '話している途中', false);
  r.scheduler.advance(SHOW.DUCK_DOWN_MS);
  assert.ok(Math.abs(audio(r.app).bgmLevel - (full * SHOW.DUCK_PCT) / 100) <= full * 0.02, `話している間は ${SHOW.DUCK_PCT}% まで ${SHOW.DUCK_DOWN_MS} ms で下がる（${audio(r.app).bgmLevel} / ${full}）`);
  assert.equal(audio(r.app).ducked, true);
  say(r.env, '話している途中の確定', true);
  let riseStart = null; let back = null;
  sample(r.scheduler, 15 * SEC, (t) => {
    const lv = audio(r.app).bgmLevel;
    if (riseStart === null && lv > (full * SHOW.DUCK_PCT) / 100 + full * 0.02) riseStart = t;
    if (back === null && Math.abs(lv - full) <= full * 0.02) back = t;
  }, 10);
  assert.ok(back !== null, '無音が続くと元の音量に戻る');
  assert.ok(back - (riseStart ?? back) <= SHOW.DUCK_UP_MS + 10, `戻す時間 ${back - riseStart} ms ≤ ${SHOW.DUCK_UP_MS}`);
  assert.equal(r.app.setShowBgm(false).ok, true);
  r.scheduler.advance(2 * SEC);
  assert.equal(audio(r.app).bgmPlaying, false, 'BGM を OFF にできる');
  // RPG風のときはこの BGM を鳴らさない（RPG風の BGM を優先）
  const g = await showApp();
  assert.equal(g.app.setLiveShow(true).ok, true);
  g.app.notifyUserGesture(); startRec(g.app);
  g.app.setDraft('勇者の話題'); g.app.submitDraft();
  assert.equal(g.app.setDrawStyle('rpg').ok, true);
  g.scheduler.advance(2 * SEC);
  assert.equal(audio(g.app).bgmPlaying, false, 'RPG風ではこの BGM を鳴らさない');
});

// FR-116 AC-679
test('FR-116 AC-679: ミュート・BGM の音量・効果音の音量は［設定］とコマンドの検索（PARAM-164 回以内、ラベル PARAM-011 以内）で別々に変えられ、初期値は BGM 30・効果音 50、端末ごとに保存されて再読込後に復元され、初期化・セッションファイルでは変わらない', async () => {
  const r = await showApp();
  const { app } = r;
  assert.equal(audio(app).bgmVolume, SHOW.BGM_VOL, 'BGM の音量の初期値 PARAM-184');
  assert.equal(audio(app).sfxVolume, SHOW.SFX_VOL, '効果音の音量の初期値 PARAM-031');
  app.commands['settings.open']();
  for (const [id, cmd, v] of [['showSound.bgmVolume', 'settings.showBgmVolume', SHOW.BGM_VOL], ['showSound.sfxVolume', 'settings.showSfxVolume', SHOW.SFX_VOL]]) {
    const f = sfield(app, id);
    assert.ok(f, `［設定］に ${id}`);
    assert.equal(f.value, v);
    assert.ok(f.label?.trim() && weight(f.label) <= SHOW.LABEL_MAX, `${id}: ラベル「${f.label}」`);
    app.commands['settings.close']();
    assertOps(app, f.label, cmd);
    app.commands[cmd]();
    assert.equal(app.getSettingsDialog()?.focusedField, id, `${cmd}: 選ぶだけでその項目にフォーカス`);
    app.setSettingsFieldDraft(id, '20');
    app.handleKey({ key: 'Enter' });
    app.setLang('en');
    const fe = sfield(app, id);
    assert.ok(fe.label.trim() && !CJK.test(fe.label) && weight(fe.label) <= SHOW.LABEL_MAX, `en ${id}: ${fe.label}`);
    app.setLang('ja');
  }
  assert.deepEqual([audio(app).bgmVolume, audio(app).sfxVolume], [20, 20], 'キーボードだけで別々に変えられる');
  assert.equal(sfield(app, 'sound.muted') !== undefined, true, 'ミュートは［設定］の共通の項目（AC-228）');
  app.handleKey({ key: 'Escape' });
  for (const bad of [-1, 101, 2.5, 'x', NaN, null]) {
    let x; try { x = app.setShowBgmVolume(bad); } catch { x = { ok: false }; } assert.equal(x.ok, false, `BGM ${String(bad)}`);
    let y; try { y = app.setShowSfxVolume(bad); } catch { y = { ok: false }; } assert.equal(y.ok, false, `効果音 ${String(bad)}`);
  }
  assert.deepEqual([audio(app).bgmVolume, audio(app).sfxVolume], [20, 20], '不正な値では変わらない');
  app.commands['session.start'](); app.setDraft('音の設定の保存'); app.submitDraft();
  assert.equal((await app.commands['file.save']()).ok, true);
  const file = r.env.downloads.at(-1);
  assert.equal(app.setShowBgmVolume(70).ok, true); assert.equal(app.setShowSfxVolume(10).ok, true);
  const lr = await app.loadSessionFile({ name: file.filename, type: 'application/json', size: file.data.length, text: file.data });
  if (lr.pending) await app.dialogAction('confirm');
  app.commands['data.reset'](); app.dialogAction('confirm');
  assert.deepEqual([audio(app).bgmVolume, audio(app).sfxVolume], [70, 10], 'セッションファイル・初期化では変わらない');
  const b = await showApp({ storage: r.storage });
  assert.deepEqual([audio(b.app).bgmVolume, audio(b.app).sfxVolume], [70, 10], '再読込後に復元される');
});

// FR-116 AC-679（出力の大きさ）
test('FR-116 AC-679: BGM の音量 0 でも効果音は鳴り、効果音の音量 0 でも BGM は鳴る。ミュート中と両方 0 のとき出力の大きさは 0 で、RPG風・映画的な演出の音も止まる。音が使えない端末でもショーと全機能はそのまま使える', async () => {
  const quiet = ITV + 9 * SEC; // 1 回目の演出が終わった後（BGM だけが鳴る時点）
  const b0 = await showApp();
  assert.equal(b0.app.setLiveShow(true).ok, true); assert.equal(b0.app.setShowBgmVolume(0).ok, true);
  b0.app.notifyUserGesture(); startRec(b0.app);
  let from = null;
  runScript(b0, quiet, (t) => { if (t === ITV - 100) from = b0.audio.log.starts.length; });
  assert.ok(b0.audio.startedLevel(from) > 0, 'BGM の音量 0 でも効果音は鳴る');
  assert.equal(b0.audio.outputLevel(), 0, `BGM の音量 0: 効果音のない時点（${quiet} ms）の出力は 0`);

  const s0 = await showApp();
  assert.equal(s0.app.setLiveShow(true).ok, true); assert.equal(s0.app.setShowSfxVolume(0).ok, true);
  s0.app.notifyUserGesture(); startRec(s0.app);
  runScript(s0, quiet);
  assert.ok(s0.audio.outputLevel() > 0, '効果音の音量 0 でも BGM は鳴る');

  for (const mode of ['mute', 'zero']) {
    const m = await showApp();
    assert.equal(m.app.setLiveShow(true).ok, true);
    if (mode === 'mute') assert.equal(m.app.setRpgMuted(true).ok, true);
    else { assert.equal(m.app.setShowBgmVolume(0).ok, true); assert.equal(m.app.setShowSfxVolume(0).ok, true); }
    m.app.notifyUserGesture(); startRec(m.app);
    runScript(m, 3 * ITV, () => assert.equal(m.audio.outputLevel(), 0, `${mode}: 出力の大きさは 0`), 50);
    assert.equal(m.audio.startedLevel(0), 0, `${mode}: 鳴らし始めた音の大きさも 0`);
    if (mode === 'mute') {
      assert.equal(m.app.getRpgAudio().audible, false, 'RPG風の音も止まる');
      assert.equal(m.app.getCinematicState().muted, true, '映画的な演出の音も止まる');
    }
  }

  // 音が使えない端末
  const nb = await showApp({ audio: { factory: brokenAudioFactory } });
  assert.equal(nb.app.setLiveShow(true).ok, true);
  nb.app.notifyUserGesture(); startRec(nb.app);
  runScript(nb, 3 * ITV);
  for (const w of [T.plain1, T.plain2, T.conclusion]) assert.ok(nb.app.renderSvg().includes(w), `音なしでも「${w}」が図にある`);
  assert.equal(show(nb.app).running, false, '音なしでもショーは終わる');
  assert.equal(nb.app.setShowBgmVolume(40).ok, true, '音なしでも設定できる');
});
