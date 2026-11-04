// FR-116 AC-676 AC-677 AC-678 AC-679（AC-228 のミュートの共通化）の単体・結合テスト。演出の音（ライブ描画ショーの BGM と効果音）。
// 接続点（FR-115 との契約）: ctx.showAudio の cue(name, detail)・setEnabled(on)・startBgm()/stopBgm()・duck(on)。
// ショー（FR-115）の代わりに、テスト用のモジュールで ctx.showAudio を受け取り、cue を直接呼んで確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newApp, seedThreeScenes } from '../system/helpers.js';
import {
  SE_SPECS, CUE_NAMES, SONGS, SONG_IDS, MIN_SONGS, BGM_DEFAULT_VOLUME, SE_DEFAULT, DUCK_RATIO, DUCK_DOWN_MS, DUCK_UP_MS, DUCK_HOLD_MS,
  barSeconds, volumeGain, parseShowAudioPrefs, SHOW_AUDIO_KEY,
} from '../../web/src/showaudio.js';

// Web Audio の代用。作った音源（発振器・ノイズ）と、音量の予約（傾き）を記録する。時刻は偽の時計（scheduler）に従う
function fakeAudio(env) {
  const made = [];
  const P = () => { const p = { value: 0, events: [] }; for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues']) p[m] = (...a) => { p.events.push([m, ...a]); }; return p; };
  const node = (kind, extra = {}) => ({ kind, outs: [], connect(n) { this.outs.push(n); return n; }, disconnect() { this.outs = []; }, ...extra });
  const factory = () => {
    const ac = {
      sampleRate: 8000, state: 'running', sources: [], gains: [],
      get currentTime() { return env.scheduler.t / 1000; },
      destination: node('destination'),
      suspend() { this.state = 'suspended'; return Promise.resolve(); },
      resume() { this.state = 'running'; return Promise.resolve(); },
      createGain() { const g = node('gain', { gain: P() }); this.gains.push(g); return g; },
      createOscillator() { const o = node('osc', { type: 'sine', frequency: P(), start: (at) => { ac.sources.push({ kind: 'osc', type: o.type, freq: o.frequency.events[0]?.[1], at }); }, stop() {} }); return o; },
      createBiquadFilter() { return node('filter', { type: 'lowpass', frequency: P(), Q: P() }); },
      createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; },
      createBufferSource() { const s = node('noise', { buffer: null, start: (at) => { ac.sources.push({ kind: 'noise', at }); }, stop() {} }); return s; },
      createDynamicsCompressor() { return node('comp', { threshold: P(), knee: P(), ratio: P(), attack: P(), release: P() }); },
      createStereoPanner() { return node('pan', { pan: P() }); },
    };
    made.push(ac);
    return ac;
  };
  return Object.assign(factory, { made });
}
// 最後に予約した傾きの [目標値, 終了時刻]
const lastRamp = (g) => { const e = g.gain.events.filter((x) => x[0] === 'linearRampToValueAtTime').at(-1); return e ? [e[1], e[2]] : null; };
const buses = (ac) => { const master = ac.gains[0]; return ac.gains.filter((g) => g !== master && g.outs.includes(master)); }; // [bgmBus, seBus]

async function setup(over = {}) {
  const opts = { ...(over.options ?? {}) };
  const holder = {};
  const r = await newApp({ ...over, options: { ...opts, modules: [...(opts.modules ?? []), (ctx) => { holder.ctx = ctx; }] } });
  // ショー（FR-115）が受け取る接続点。モジュールの組み立ての後に置かれている
  return { ...r, sa: holder.ctx.showAudio, ctx: holder.ctx };
}
async function withAudio(over = {}) {
  // fakeAudio は newApp が作る偽の時計を読むので、アプリを作った後に差し込む（作るのは最初の操作の後なので間に合う）
  const proxy = (...a) => proxy.impl(...a);
  const s = await setup({ ...over, options: { ...(over.options ?? {}), audioFactory: proxy } });
  proxy.impl = fakeAudio(s.env); proxy.made = proxy.impl.made;
  return { ...s, audio: proxy };
}

// FR-116 AC-676: 最初の操作の前は AudioContext 0 個。操作の後もショーが OFF なら作らない
test('FR-116 AC-676: 利用者の最初の操作の前は、ショーが ON でも AudioContext を作らず音は鳴らない', async () => {
  const { app, sa, audio } = await withAudio();
  assert.equal(typeof sa.cue, 'function');
  sa.setEnabled(true);
  assert.equal(sa.cue('pop'), false);
  sa.startBgm();
  assert.equal(audio.made.length, 0, '操作の前は 0 個');
  assert.equal(app.getShowAudio().contexts, 0);
  app.noteUserGesture();
  assert.equal(audio.made.length, 1, '操作の後、ショーが ON なら作る');
  assert.equal(sa.cue('pop'), true);
  assert.ok(audio.made[0].sources.length > 0, '音が鳴る');
});

test('FR-116 AC-676: 操作の後でもショーが OFF のときは AudioContext を作らない。ON→OFF では停止し鳴らない', async () => {
  const { app, sa, audio, env } = await withAudio();
  app.noteUserGesture();
  assert.equal(sa.cue('chime'), false);
  assert.equal(audio.made.length, 0, 'ショー OFF では作らない');
  sa.setEnabled(true);
  assert.equal(sa.cue('chime'), true);
  sa.setEnabled(false);
  env.scheduler.advance(400);
  assert.equal(audio.made[0].state, 'suspended', 'OFF で停止');
  const n = audio.made[0].sources.length;
  assert.equal(sa.cue('chime'), false);
  assert.equal(audio.made[0].sources.length, n, 'OFF の間は鳴らない');
  assert.equal(app.getShowAudio().bgmPlaying, false);
  sa.setEnabled(true);
  assert.equal(audio.made[0].state, 'running', 'ON に戻すと再開');
  assert.equal(audio.made.length, 1, '作り直さない');
});

test('FR-116 AC-676: キー入力（handleKey）も最初の操作として数える', async () => {
  const { app, sa, audio } = await withAudio();
  sa.setEnabled(true);
  app.handleKey({ key: 'q' });
  assert.equal(app.getShowAudio().started, true);
  assert.equal(audio.made.length, 1);
});

test('FR-116 AC-676: ミュート（AC-228 と共通）のときは AudioContext を作らず、鳴っていれば停止する', async () => {
  const { app, sa, audio, env } = await withAudio();
  app.setRpgMuted(true);
  sa.setEnabled(true); app.noteUserGesture();
  assert.equal(audio.made.length, 0);
  assert.equal(sa.cue('pop'), false);
  app.setRpgMuted(false);
  assert.equal(sa.cue('pop'), true);
  app.setRpgMuted(true);
  env.scheduler.advance(400);
  assert.equal(audio.made[0].state, 'suspended');
  assert.deepEqual([app.getShowAudio().bgmOutput, app.getShowAudio().seOutput], [0, 0], 'ミュート中の出力は 0');
});

test('FR-116 AC-676: 音の生成は合成だけで、外部のオリジンへのリクエスト・音のファイルを使わない', () => {
  const src = readFileSync(new URL('../../web/src/showaudio.js', import.meta.url), 'utf8');
  for (const bad of ['fetch(', 'XMLHttpRequest', 'decodeAudioData', 'new Audio(', 'http://', 'https://', '.mp3', '.wav', '.ogg', 'import(']) assert.ok(!src.includes(bad), bad);
});

// FR-116 AC-677: 効果音の種類と同期
test('FR-116 AC-677: 効果音は 6 種類（ペン・書き込み・ポン・シュッ・チャイム・きらめき）で、どの 2 つも高さ・長さ・波形のどれかが異なる', () => {
  assert.deepEqual(CUE_NAMES, ['pen', 'write', 'pop', 'whoosh', 'chime', 'sparkle']);
  for (const a of CUE_NAMES) for (const b of CUE_NAMES) {
    if (a >= b) continue;
    const x = SE_SPECS[a]; const y = SE_SPECS[b];
    assert.ok(x.wave !== y.wave || x.freq !== y.freq || x.ms !== y.ms, `${a} と ${b} は異なる`);
  }
  // PARAM-182: 描線 1200・1 字 80・運ぶ 800・お祝い 1500 ms を超えない
  assert.deepEqual([SE_SPECS.pen.maxMs, SE_SPECS.write.maxMs, SE_SPECS.whoosh.maxMs, SE_SPECS.sparkle.maxMs], [1200, 80, 800, 1500]);
});

test('FR-116 AC-677: テスト用の時計で、各出来事の時点と鳴らした効果音の種類が一致する（未知の名前は無視）', async () => {
  const { app, sa, audio, env } = await withAudio();
  sa.setEnabled(true); app.noteUserGesture();
  const plan = [[0, 'pen', { ms: 600 }], [700, 'write'], [760, 'write'], [900, 'pop'], [1200, 'whoosh', { ms: 500 }], [1800, 'chime'], [2400, 'sparkle', { ms: 1200 }]];
  const t0 = env.now();
  let prev = 0;
  for (const [at, name, d] of plan) {
    env.scheduler.advance(at - prev); env.clock.t = t0 + at; prev = at;
    const before = audio.made[0].sources.length;
    assert.equal(sa.cue(name, d), true, name);
    assert.ok(audio.made[0].sources.length > before, `${name} で音源が鳴る`);
    assert.ok(audio.made[0].sources.slice(before).every((s) => Math.abs(s.at - env.scheduler.t / 1000) < 0.2 || s.at > env.scheduler.t / 1000), `${name} はその時点から鳴る`);
  }
  assert.equal(sa.cue('boom'), false);
  assert.equal(sa.cue(), false);
  const log = app.getShowAudioLog();
  assert.deepEqual(log.map((e) => e.name), plan.map((p) => p[1]));
  assert.deepEqual(log.map((e) => e.at - t0), plan.map((p) => p[0]));
  assert.ok(log.every((e) => e.voiced));
});

test('FR-116 AC-677: 種類ごとに音の作りが異なる（ペン・シュッはノイズ、ポンは上がる正弦波、チャイムは長三和音、きらめきは高い粒）', async () => {
  const { app, sa, audio, env } = await withAudio();
  sa.setEnabled(true); app.noteUserGesture(); sa.stopBgm();
  const kinds = {};
  for (const name of CUE_NAMES) {
    env.scheduler.advance(500);
    const ac = audio.made[0]; const before = ac.sources.length;
    sa.cue(name); kinds[name] = ac.sources.slice(before);
  }
  assert.ok(kinds.pen.every((s) => s.kind === 'noise'));
  assert.ok(kinds.whoosh.every((s) => s.kind === 'noise'));
  assert.equal(kinds.write.filter((s) => s.kind === 'noise').length, 2, 'カリカリは短い 2 つの擦れ');
  assert.ok(kinds.pop.some((s) => s.kind === 'osc' && s.type === 'sine'));
  const chimeSines = kinds.chime.filter((s) => s.type === 'sine').map((s) => Math.round(s.freq));
  assert.deepEqual(chimeSines, [1047, 1319, 1568, 2093], 'C6・E6・G6・C7 の明るい和音');
  assert.ok(kinds.sparkle.length >= 5 && kinds.sparkle.every((s) => s.freq >= 2000), '高い粒');
});

test('FR-116 AC-677: 動きを減らす設定でも、音は利用者の設定に従って鳴る', async () => {
  const { app, sa } = await withAudio({ options: { env: { webgl: true, reducedMotion: true, viewportWidth: 1280 } } });
  sa.setEnabled(true); app.noteUserGesture();
  assert.equal(sa.cue('pop'), true);
  assert.equal(sa.cue('whoosh'), true);
});

test('FR-116 AC-677: 同じ効果音が極端に詰まって届いても重ねすぎない（出来事の記録は残る）', async () => {
  const { app, sa, audio } = await withAudio();
  sa.setEnabled(true); app.noteUserGesture(); sa.stopBgm();
  const before = audio.made[0].sources.length;
  for (let i = 0; i < 50; i++) sa.cue('write');
  const voiced = app.getShowAudioLog().filter((e) => e.voiced).length;
  assert.equal(app.getShowAudioLog().length, 50);
  assert.equal(voiced, 1, '同じ時点の書き込みは 1 回だけ鳴らす');
  assert.ok(audio.made[0].sources.length - before <= 2);
});

// FR-116 AC-678: BGM
test('FR-116 AC-678: BGM は 3 曲以上で、それぞれコード進行・ベース・リズムの 8 小節のループ', () => {
  assert.ok(SONG_IDS.length >= MIN_SONGS && MIN_SONGS === 3);
  for (const id of SONG_IDS) {
    const s = SONGS[id];
    assert.equal(s.chords.length, 8, id);
    assert.equal(s.melody.length, 8, id);
    assert.ok(s.bpm >= 80 && s.bpm <= 130, `${id}: 会話を邪魔しない軽快な速さ`);
    assert.ok(s.chords.every((c) => c.v.length >= 3 && c.b < Math.min(...c.v)), `${id}: 和音とその下のベース`);
  }
});

test('FR-116 AC-678: ショーが ON なら既定で BGM が流れ、小節の頭は切れ目なく続き、曲の終わりから頭へ隙間なく戻る', async () => {
  const { app, sa, env } = await withAudio();
  sa.setEnabled(true); app.noteUserGesture();
  assert.equal(app.getShowAudio().bgmPlaying, true, '既定は ON');
  const song = app.getShowAudio().song;
  env.scheduler.advance(barSeconds(song) * 9 * 1000 + 200);
  const bars = app.getShowAudioBgmLog().filter((b) => b.song === song);
  assert.ok(bars.length >= 9);
  for (let i = 1; i < bars.length; i++) {
    assert.ok(Math.abs(bars[i].at - bars[i - 1].at - barSeconds(song)) < 1e-9, '隙間・重なりなし');
    assert.equal(bars[i].bar, (bars[i - 1].bar + 1) % 8);
  }
  assert.ok(bars.some((b, i) => i > 0 && b.bar === 0), 'ループの頭に戻る');
});

test('FR-116 AC-678: 曲を選べ、BGM の ON/OFF ができる。stopBgm/startBgm にも従う', async () => {
  const { app, sa } = await withAudio();
  sa.setEnabled(true); app.noteUserGesture();
  assert.equal(app.setShowBgmSong('stroll').ok, true);
  assert.equal(app.getShowAudio().bgmSong, 'stroll');
  assert.equal(app.setShowBgmSong('nope').ok, false);
  assert.equal(app.setShowBgmOn(false).ok, true);
  assert.equal(app.getShowAudio().bgmPlaying, false);
  assert.equal(sa.cue('pop'), true, 'BGM を止めても効果音は鳴る');
  app.setShowBgmOn(true);
  assert.equal(app.getShowAudio().bgmPlaying, true);
  sa.stopBgm(); assert.equal(app.getShowAudio().bgmPlaying, false);
  sa.startBgm(); assert.equal(app.getShowAudio().bgmPlaying, true);
});

test('FR-116 AC-678: RPG風のときは FR-049 の BGM を優先し、この BGM は鳴らさない（効果音は鳴る）', async () => {
  const { app, sa } = await withAudio();
  sa.setEnabled(true); app.noteUserGesture();
  assert.equal(app.getShowAudio().bgmPlaying, true);
  app.setDrawStyle('rpg');
  assert.equal(app.getShowAudio().bgmPlaying, false);
  assert.equal(app.getShowAudio().rpgPriority, true);
  assert.equal(sa.cue('chime'), true);
  app.setDrawStyle('anime');
  assert.equal(app.getShowAudio().bgmPlaying, true);
});

test('FR-116 AC-678: 話している間（暫定・確定の結果が届く間）は BGM を 30% まで 300 ms で下げ、無音が続くと 1000 ms で戻す。効果音は下げない', async () => {
  const { app, sa, audio, env } = await withAudio();
  sa.setEnabled(true); app.noteUserGesture();
  const normal = app.getShowAudio().bgmOutput; const se = app.getShowAudio().seOutput;
  assert.ok(normal > 0);
  app.commands['session.start']();
  env.speech.emit('こんにちは', false);
  const ac = audio.made[0]; const [bgmBus] = buses(ac);
  let s = app.getShowAudio();
  assert.equal(s.ducked, true);
  assert.ok(Math.abs(s.bgmOutput - normal * DUCK_RATIO) < 1e-9, '設定値の 30%');
  assert.equal(s.seOutput, se, '効果音は下げない');
  let [v, end] = lastRamp(bgmBus);
  assert.ok(Math.abs(v - normal * DUCK_RATIO) < 1e-9);
  assert.ok(Math.abs(end - (ac.currentTime + DUCK_DOWN_MS / 1000)) < 1e-9, '300 ms で下げる');
  env.scheduler.advance(500); env.speech.emit('こんにちは、今日は', false);
  env.scheduler.advance(DUCK_HOLD_MS + 500);
  assert.equal(app.getShowAudio().ducked, true, '暫定結果が出ている間は下げたまま');
  env.speech.emit('こんにちは、今日は', true);
  const tFinal = env.scheduler.t;
  env.scheduler.advance(DUCK_HOLD_MS - 100);
  assert.equal(app.getShowAudio().ducked, true, '最後の結果の直後は下げたまま');
  env.scheduler.advance(200);
  s = app.getShowAudio();
  assert.equal(s.ducked, false, '無音が続くと戻す');
  assert.ok(Math.abs(s.bgmOutput - normal) < 1e-9);
  [v, end] = lastRamp(bgmBus);
  assert.ok(Math.abs(v - normal) < 1e-9);
  assert.ok(Math.abs(end - ((tFinal + DUCK_HOLD_MS) / 1000 + DUCK_UP_MS / 1000)) < 1e-9, '1000 ms で戻す');
  assert.equal(DUCK_DOWN_MS, 300); assert.equal(DUCK_UP_MS, 1000); assert.equal(DUCK_RATIO, 0.3);
});

test('FR-116 AC-678: 接続点の duck(on) でも BGM だけを下げ・戻す', async () => {
  const { app, sa } = await withAudio();
  sa.setEnabled(true); app.noteUserGesture();
  const n = app.getShowAudio().bgmOutput;
  sa.duck(true); assert.ok(Math.abs(app.getShowAudio().bgmOutput - n * 0.3) < 1e-9);
  sa.duck(false); assert.equal(app.getShowAudio().bgmOutput, n);
});

// FR-116 AC-679 / FR-051 AC-228
test('FR-116 AC-679 AC-228: 音量の初期値は BGM 30・効果音 50（PARAM-184・PARAM-031）。端末ごとに保存され再読込後に復元される', async () => {
  const a = await withAudio();
  assert.deepEqual([a.app.getShowAudio().bgmVolume, a.app.getShowAudio().seVolume, a.app.getShowAudio().bgmOn], [30, 50, true]);
  assert.deepEqual([BGM_DEFAULT_VOLUME, SE_DEFAULT], [30, 50]);
  a.app.setShowBgmVolume(70); a.app.setShowSeVolume(20); a.app.setShowBgmOn(false); a.app.setShowBgmSong('sparkle');
  const b = await a.createApp(a.env.options);
  const s = b.getShowAudio();
  assert.deepEqual([s.bgmVolume, s.seVolume, s.bgmOn, s.song], [70, 20, false, 'sparkle']);
  assert.equal(a.app.setShowBgmVolume(101).ok, false);
  assert.equal(a.app.setShowSeVolume(-1).ok, false);
  assert.equal(a.app.setShowSeVolume(1.5).ok, false);
  assert.deepEqual(parseShowAudioPrefs({ bgmVolume: 'x', seVolume: 300, song: 'zzz', bgmOn: 1 }), { bgmVolume: 30, seVolume: 50, bgmOn: true, song: SONG_IDS[0] });
});

test('FR-116 AC-679: データの初期化・セッションファイルでは音の設定は変わらない', async () => {
  const { app, env, createApp } = await withAudio();
  await seedThreeScenes(app, env);
  app.setShowBgmVolume(80); app.setShowSeVolume(10);
  await app.commands['file.save']();
  const file = env.downloads.at(-1);
  assert.ok(!String(file.data).includes(SHOW_AUDIO_KEY) && !String(file.data).includes('bgmVolume'), 'セッションファイルに入らない');
  app.commands['data.reset'](); await app.dialogAction('confirm');
  assert.deepEqual([app.getShowAudio().bgmVolume, app.getShowAudio().seVolume], [80, 10]);
  const other = await createApp(env.options);
  other.setShowBgmVolume(40);
  assert.equal((await other.loadSessionFile({ name: file.filename, type: file.mime, size: Buffer.byteLength(String(file.data)), text: String(file.data) })).ok, true);
  assert.equal(other.getShowAudio().bgmVolume, 40);
});

test('FR-116 AC-679: BGM の音量 0 でも効果音は鳴り、効果音の音量 0 でも BGM は鳴る。音量 0 の出力は 0', async () => {
  const { app, sa, audio } = await withAudio();
  sa.setEnabled(true); app.noteUserGesture();
  app.setShowBgmVolume(0);
  assert.equal(app.getShowAudio().bgmOutput, 0);
  assert.equal(app.getShowAudio().bgmPlaying, false);
  assert.equal(sa.cue('pop'), true, '効果音は鳴る');
  const [bgmBus, seBus] = buses(audio.made[0]);
  assert.equal(lastRamp(bgmBus)[0], 0);
  assert.ok(lastRamp(seBus)[0] > 0);
  app.setShowBgmVolume(30); app.setShowSeVolume(0);
  assert.equal(app.getShowAudio().seOutput, 0);
  assert.equal(lastRamp(seBus)[0], 0);
  assert.equal(sa.cue('pop'), false);
  assert.equal(app.getShowAudio().bgmPlaying, true, 'BGM は鳴る');
  assert.ok(lastRamp(bgmBus)[0] > 0);
  assert.equal(volumeGain(0), 0); assert.equal(volumeGain(100), 1);
  assert.ok(volumeGain(30) < volumeGain(50));
});

test('FR-116 AC-679: ミュート（sound.toggleMute・AC-228 と共通）で、この音の出力も 0 になる', async () => {
  const { app, sa } = await withAudio();
  sa.setEnabled(true); app.noteUserGesture();
  app.commands['sound.toggleMute']();
  assert.equal(app.getRpgAudio().muted, true);
  assert.deepEqual([app.getShowAudio().muted, app.getShowAudio().bgmOutput, app.getShowAudio().seOutput, app.getShowAudio().bgmPlaying], [true, 0, 0, false]);
  app.commands['sound.toggleMute']();
  assert.equal(app.getShowAudio().bgmPlaying, true);
});

test('FR-116 AC-679: コマンドの検索で BGM の音量・効果音の音量・BGM の ON/OFF・曲を 3 回以内で変えられ、ラベルは 6 文字（英語 12 字）以内', async () => {
  const { app } = await withAudio();
  const weight = (s) => [...s].reduce((n, ch) => n + (/[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.5), 0);
  for (const [q, cmd, check] of [['BGM 音量', 'showAudio.bgmVolume', () => app.getShowAudio().bgmVolume === 40], ['効果音の音量', 'showAudio.seVolume', () => app.getShowAudio().seVolume === 60], ['BGM 切替', 'showAudio.bgmToggle', () => app.getShowAudio().bgmOn === false], ['BGM の曲', 'showAudio.nextSong', () => app.getShowAudio().song === SONG_IDS[1]]]) {
    const hit = app.searchCommands(q); // 1: 検索の入力
    const c = hit.find((h) => h.command === cmd); // 2: 候補の選択
    assert.ok(c, q);
    assert.ok(weight(c.label) <= 6, c.label);
    app.commands[c.command](); // 3: 確定
    assert.ok(check(), cmd);
    assert.ok(app.getState().message.text.length > 0, '結果を文字で示す');
  }
  app.setLang('en');
  for (const cmd of ['showAudio.bgmVolume', 'showAudio.seVolume', 'showAudio.bgmToggle', 'showAudio.nextSong']) assert.ok(app.t(`cmd.${cmd}`).length <= 12, cmd);
  // NFR-A11Y-001: キーボードだけでも変えられる
  assert.equal(app.handleKey({ key: 'Home', altKey: true, shiftKey: true }), 'showAudio.bgmToggle');
  assert.equal(app.getShowAudio().bgmOn, true);
  assert.equal(app.handleKey({ key: 'PageUp', altKey: true, shiftKey: true }), 'showAudio.bgmVolume');
  assert.equal(app.getShowAudio().bgmVolume, 50);
});

test('FR-116 AC-679: ［設定］に BGM の音量・効果音の音量・BGM の ON/OFF・曲がある', async () => {
  const { app } = await withAudio();
  app.commands['settings.open']?.();
  const d = app.getSettingsDialog();
  const ids = d.fields.map((f) => f.id);
  for (const id of ['showSound.bgmVolume', 'showSound.sfxVolume', 'showSound.bgm', 'showSound.track', 'sound.muted']) assert.ok(ids.includes(id), id);
  assert.equal(d.fields.find((f) => f.id === 'showSound.bgmVolume').value, 30);
  assert.equal(d.fields.find((f) => f.id === 'showSound.track').options.length, SONG_IDS.length);
});

test('FR-116 AC-679: 音が使えない端末（AudioContext なし・作成で例外）でも、例外を出さずに全機能が使える', async () => {
  for (const factory of [() => null, () => { throw new Error('no audio'); }]) {
    const { app, sa } = await setup({ options: { audioFactory: factory } });
    sa.setEnabled(true); app.noteUserGesture();
    for (const n of CUE_NAMES) assert.equal(sa.cue(n), false);
    sa.startBgm(); sa.duck(true); sa.duck(false); sa.stopBgm(); sa.setEnabled(false);
    assert.equal(app.getShowAudio().available, false);
    app.commands['session.start']();
    app.submitInput?.('音がなくても動く');
    assert.equal(app.setShowBgmVolume(50).ok, true);
  }
});

// ---- FR-115 と FR-116 の結合（契約 CONTRACT-LIVE-SHOW の「演出の音」） ----
// FR-116 AC-676: ショーの ON/OFF に setEnabled が連動し、ON で BGM を始める（鳴るのは notifyUserGesture の後だけ。プログラムからの setLiveShow は操作ではない）
test('FR-115 FR-116 AC-676: ショーの ON/OFF が演出の音の有効・無効に連動し、ON で BGM を始める（利用者の操作の後だけ）', async () => {
  const { app, audio } = await withAudio();
  assert.equal(app.getShowAudio().enabled, false, '既定（ショー OFF）は無効');
  app.setLiveShow(true);
  assert.equal(app.getShowAudio().enabled, true, 'ショー ON で有効');
  assert.equal(audio.made.length, 0, '操作の前は AudioContext を作らない');
  assert.equal(app.getShowAudio().bgmPlaying, false);
  app.notifyUserGesture();
  assert.equal(app.getShowAudio().bgmPlaying, true, '操作の後、ショー ON で BGM が鳴る');
  app.setLiveShow(false);
  assert.deepEqual([app.getShowAudio().enabled, app.getShowAudio().bgmPlaying], [false, false], 'ショー OFF で止まる');
});

// FR-116 AC-679: 契約の名前（sfxVolume・track・tracks・setShowBgm・setShowBgmTrack・setShowSfxVolume）と［設定］の showSound.* の項目・コマンドからのフォーカスと Enter での確定
test('FR-116 AC-679: ［設定］の showSound.* の項目をコマンドで開いてフォーカスし、入力して Enter で確定する（不正な値は変えない）', async () => {
  const { app } = await withAudio();
  const a = app.getShowAudio();
  assert.deepEqual([a.sfxVolume, a.track, a.tracks.length >= MIN_SONGS, a.tracks.every((x) => x.id && x.label)], [SE_DEFAULT, SONG_IDS[0], true, true]);
  assert.equal(app.setShowBgmTrack(SONG_IDS[2]).ok, true); assert.equal(app.getShowAudio().track, SONG_IDS[2]);
  assert.equal(app.setShowBgm(false).ok, true); assert.equal(app.getShowAudio().bgmOn, false);
  assert.equal(app.setShowSfxVolume(101).ok, false);
  assert.equal(app.searchCommands('効果音の音量')[0].command, 'settings.showSfxVolume', '検索の先頭の候補');
  app.commands['settings.showSfxVolume']();
  assert.equal(app.getSettingsDialog().focusedField, 'showSound.sfxVolume');
  app.setSettingsFieldDraft('showSound.sfxVolume', '35');
  assert.equal(app.handleKey({ key: 'Enter' }), 'settings.showSound.commit');
  assert.equal(app.getShowAudio().sfxVolume, 35);
  app.setSettingsFieldDraft('showSound.sfxVolume', '3.5'); app.handleKey({ key: 'Enter' });
  assert.equal(app.getShowAudio().sfxVolume, 35, '整数でない値では変わらない');
  assert.equal(app.setSettingsField('showSound.bgmVolume', 12).ok, true); assert.equal(app.getShowAudio().bgmVolume, 12);
  assert.equal(app.setSettingsField('show.enabled', true).ok, true); assert.equal(app.getLiveShow().on, true);
  app.setLang('en');
  assert.equal(app.searchCommands('SFX volume')[0].command, 'settings.showSfxVolume');
});

// FR-116 AC-677・AC-678: 鳴らした効果音の記録（sfx）と、いまの BGM の大きさ（bgmLevel。ダッキングを含む）
test('FR-116 AC-677 AC-678: 鳴らした効果音は sfx に種類・時刻・波形・高さ・長さで残り（write は含めない）、いまの BGM の大きさ bgmLevel を数で返す', async () => {
  const { app, sa, env } = await withAudio();
  app.setLiveShow(true); app.notifyUserGesture();
  for (const n of ['pen', 'write', 'sparkle']) sa.cue(n);
  const sfx = app.getShowAudio().sfx;
  assert.deepEqual(sfx.map((x) => x.kind), ['pen', 'sparkle']);
  assert.deepEqual([sfx[1].wave, sfx[1].freq, sfx[1].durMs, sfx[1].at], [SE_SPECS.sparkle.wave, SE_SPECS.sparkle.freq, SE_SPECS.sparkle.ms, env.now()]);
  assert.equal(typeof app.getShowAudio().bgmLevel, 'number');
});

// FR-049 AC-219 と共通の利用者の操作: notifyUserGesture の後は RPG風の音も始まる
test('FR-049 AC-219 FR-116 AC-676: notifyUserGesture は RPG風の音の最初の操作としても数える', async () => {
  const { app } = await withAudio();
  assert.equal(app.getRpgAudio().started, false);
  app.notifyUserGesture();
  assert.equal(app.getRpgAudio().started, true);
});
