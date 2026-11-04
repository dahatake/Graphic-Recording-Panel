// FR-014・FR-022・FR-115・FR-116 の System Test の共通部品（契約: tests/system/CONTRACT-LIVE-SHOW.md）。
// 期待値は要求定義書の受入基準（PARAM-098〜100・PARAM-182〜184・PARAM-031）だけから決める。web/ の実装は import して呼ぶだけ。
import assert from 'node:assert/strict';
import { FakeStorage, newApp, toDetail, CJK } from './helpers.js';
import { LinkedScheduler } from './rearrange-util.js';

export const SHOW = {
  STROKE_MS: 1200, // PARAM-182: 1 要素の描線の上限
  CHAR_MS: 80, // PARAM-182: 1 字の書き込みの上限
  MOVE_MS: 800, // PARAM-182: 運ぶ動きの上限
  CELEBRATE_MS: 1500, // PARAM-182: お祝いの上限
  TOTAL_PCT: 80, // PARAM-182: 1 回の描き足しの演出の合計（更新間隔に対する割合）
  SPEEDS: [1, 2, 4, 8], // PARAM-183: .vtt の再生取込の速さ
  BGM_TRACKS_MIN: 3, // PARAM-184: BGM の曲数
  BGM_VOL: 30, // PARAM-184: BGM の音量の初期値
  SFX_VOL: 50, // PARAM-184 → PARAM-031: 効果音の音量の初期値
  DUCK_PCT: 30, // PARAM-184: ダッキング中の BGM の音量（設定値に対する割合）
  DUCK_DOWN_MS: 300, // PARAM-184: 下げる時間
  DUCK_UP_MS: 1000, // PARAM-184: 戻す時間
  OPS_MAX: 3, // PARAM-164
  LABEL_MAX: 6, // PARAM-011（全角 1・半角 0.5）
};
export const SFX_KINDS = ['pen', 'pop', 'whoosh', 'chime', 'sparkle'];
export const OVERLAY_KINDS = ['pen', 'hand', 'confetti', 'sparkle'];
export const weight = (s) => [...String(s)].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.5), 0);

// ---- 偽の AudioContext（options.audioFactory で注入。作られた数・鳴らした音・出力の大きさを数える）----
// 出力の大きさ: 鳴っている音源から destination までの経路の GainNode の gain の積（経路が複数なら最大）。
// AudioContext が running でないときは 0。AudioParam は時刻つきの値の変化（set・ramp・target）を記録し、時刻の値を返す。
export function makeFakeAudio(now) {
  const log = { created: 0, contexts: [], starts: [], decodeCalls: 0 };
  class Param {
    constructor(ctx, v = 1) { this.ctx = ctx; this.ev = [{ t: -Infinity, v, ramp: false }]; }
    get value() { return this.at(this.ctx.currentTime); }
    set value(v) { this.ev.push({ t: this.ctx.currentTime, v: Number(v), ramp: false }); this.sort(); }
    sort() { this.ev.sort((a, b) => a.t - b.t); }
    setValueAtTime(v, t) { this.ev.push({ t: Math.max(Number(t) || 0, -1e9), v: Number(v), ramp: false }); this.sort(); return this; }
    linearRampToValueAtTime(v, t) { this.ev.push({ t: Number(t) || 0, v: Number(v), ramp: true }); this.sort(); return this; }
    exponentialRampToValueAtTime(v, t) { return this.linearRampToValueAtTime(v, t); }
    setTargetAtTime(v, t, tc) { this.ev.push({ t: Number(t) || 0, v: this.at(Number(t) || 0), ramp: false }); this.ev.push({ t: (Number(t) || 0) + 3 * (Number(tc) || 0), v: Number(v), ramp: true }); this.sort(); return this; }
    setValueCurveAtTime(c, t, d) { const a = [...c]; if (a.length) { this.setValueAtTime(a[0], t); this.linearRampToValueAtTime(a[a.length - 1], (Number(t) || 0) + (Number(d) || 0)); } return this; }
    cancelScheduledValues(t) { this.ev = this.ev.filter((e) => e.t < t || e.t === -Infinity); return this; }
    cancelAndHoldAtTime(t) { const v = this.at(t); this.cancelScheduledValues(t); this.ev.push({ t, v, ramp: false }); this.sort(); return this; }
    at(t) {
      let prev = this.ev[0];
      for (const e of this.ev) {
        if (e.t <= t) { prev = e; continue; }
        if (e.ramp && prev.t !== -Infinity && e.t > prev.t) return prev.v + (e.v - prev.v) * ((t - prev.t) / (e.t - prev.t));
        break;
      }
      return prev.v;
    }
    peak(a, b) { let m = Math.max(Math.abs(this.at(a)), Math.abs(this.at(b))); for (const e of this.ev) if (e.t > a && e.t < b) m = Math.max(m, Math.abs(e.v)); return m; }
  }
  class Node {
    constructor(ctx, kind) { this.context = ctx; this.kind = kind; this.outs = new Set(); this.numberOfInputs = 1; this.numberOfOutputs = 1; }
    connect(n) { this.outs.add(n); return n; }
    disconnect(n) { if (n === undefined) this.outs.clear(); else this.outs.delete(n); }
  }
  class Source extends Node {
    constructor(ctx, kind) { super(ctx, kind); this.started = null; this.stopAt = null; this.onended = null; }
    start(when = 0) { this.started = Math.max(Number(when) || 0, this.context.currentTime); this.context._start(this); }
    stop(when = 0) { this.stopAt = Math.max(Number(when) || 0, this.context.currentTime); }
    addEventListener() {} removeEventListener() {}
  }
  class Ctx {
    constructor() {
      this.t0 = now(); this.state = 'running'; this.sampleRate = 48000; this.destination = new Node(this, 'destination'); this.nodes = [];
      this.listener = {}; log.created++; log.contexts.push(this);
    }
    get currentTime() { return (now() - this.t0) / 1000; }
    _start(src) {
      const a = src.started; const b = src.stopAt ?? a + 1;
      log.starts.push({ ctx: this, src, kind: src.kind, type: src.type, freq: src.frequency ? src.frequency.at(a) : null, at: now(), level: () => this.level(src, a, src.stopAt ?? b) });
    }
    level(node, a, b, seen = new Set()) {
      if (this.state !== 'running') return 0;
      if (node === this.destination) return 1;
      if (!(node instanceof Node) || seen.has(node)) return 0;
      seen.add(node);
      let m = 0;
      for (const o of node.outs) m = Math.max(m, this.level(o, a, b, new Set(seen)));
      if (node.kind === 'gain') m *= node.gain.peak(a, b);
      return m;
    }
    active() { const t = this.currentTime; return this.nodes.filter((n) => n instanceof Source && n.started !== null && n.started <= t && (n.stopAt === null || n.stopAt > t)); }
    outputLevel() { const t = this.currentTime; return Math.max(0, ...this.active().map((s) => this.level(s, t, t))); }
    _add(n) { this.nodes.push(n); return n; }
    createGain() { const n = new Node(this, 'gain'); n.gain = new Param(this, 1); return this._add(n); }
    createOscillator() { const n = new Source(this, 'oscillator'); n.type = 'sine'; n.frequency = new Param(this, 440); n.detune = new Param(this, 0); n.setPeriodicWave = (w) => { n.type = 'custom'; n.wave = w; }; return this._add(n); }
    createBufferSource() { const n = new Source(this, 'buffer'); n.buffer = null; n.loop = false; n.playbackRate = new Param(this, 1); n.detune = new Param(this, 0); return this._add(n); }
    createConstantSource() { const n = new Source(this, 'constant'); n.offset = new Param(this, 1); return this._add(n); }
    createBiquadFilter() { const n = new Node(this, 'filter'); n.type = 'lowpass'; n.frequency = new Param(this, 350); n.Q = new Param(this, 1); n.gain = new Param(this, 0); n.detune = new Param(this, 0); return this._add(n); }
    createDelay() { const n = new Node(this, 'delay'); n.delayTime = new Param(this, 0); return this._add(n); }
    createStereoPanner() { const n = new Node(this, 'panner'); n.pan = new Param(this, 0); return this._add(n); }
    createDynamicsCompressor() { const n = new Node(this, 'compressor'); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = new Param(this, 0); return this._add(n); }
    createWaveShaper() { const n = new Node(this, 'shaper'); n.curve = null; return this._add(n); }
    createConvolver() { const n = new Node(this, 'convolver'); n.buffer = null; return this._add(n); }
    createAnalyser() { const n = new Node(this, 'analyser'); n.fftSize = 2048; n.getByteFrequencyData = () => {}; return this._add(n); }
    createPeriodicWave(real, imag) { return { real, imag }; }
    createBuffer(ch, len, rate) { const data = Array.from({ length: ch }, () => new Float32Array(len)); return { numberOfChannels: ch, length: len, sampleRate: rate, duration: len / rate, getChannelData: (i) => data[i] }; }
    decodeAudioData() { log.decodeCalls++; return Promise.reject(new Error('外部の音のファイルは使わない（AC-676）')); }
    resume() { if (this.state !== 'closed') this.state = 'running'; return Promise.resolve(); }
    suspend() { if (this.state !== 'closed') this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    addEventListener() {} removeEventListener() {}
  }
  const factory = () => new Ctx();
  return {
    factory, log,
    count: () => log.created,
    // 今、出力されている音の大きさ（全 AudioContext の最大）
    outputLevel: () => Math.max(0, ...log.contexts.map((c) => c.outputLevel())),
    // index 以降に鳴らし始めた音源の、鳴っている間の大きさ（最大）
    startedLevel: (from = 0) => Math.max(0, ...log.starts.slice(from).map((s) => s.level())),
    startsFrom: (from = 0) => log.starts.slice(from),
  };
}

// 音が使えない端末（AudioContext を作れない・例外）
export const brokenAudioFactory = () => { throw new Error('AudioContext は使えない'); };

// ---- 外部へのリクエストの記録（fetch・XHR・WebSocket・EventSource・Audio（音のファイル）・Image・sendBeacon）----
export function spyNetwork() {
  const calls = []; const saved = {};
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Audio', 'Image'];
  for (const k of names) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: function (...a) { calls.push({ k, a: String(a[0]) }); throw new Error('network blocked'); } });
  }
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { ...(nav?.value || {}), sendBeacon: (...a) => { calls.push({ k: 'sendBeacon', a: String(a[0]) }); return false; } } });
  return { calls, restore() { for (const k of names) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; } if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator; } };
}

// ---- テスト用の時計（タイマーの発火の時刻に now() を合わせる）で作るアプリ ----
// テスト用の時計（タイマーの発火の時刻に now() を合わせる）を newApp の over に渡す形で作る（showApp を使えない起動の仕方のテスト用）
export function linkedClock(env = {}) {
  const clock = { t: 1_700_000_000_000 };
  const scheduler = new LinkedScheduler(clock);
  return { clock, scheduler, now: () => clock.t, tick: (sec) => scheduler.advance(sec * 1000), options: { env: { webgl: true, reducedMotion: false, viewportWidth: 1280, ...env } } };
}

// options: createApp に足すオプション（例: LLM 連携の中継のモック relay。AC-323 のショー ON の確認で使う）
export async function showApp({ storage, reducedMotion = false, forcedColors = false, lang, audio, detail = true, options = {} } = {}) {
  const clock = { t: 1_700_000_000_000 };
  const scheduler = new LinkedScheduler(clock);
  const fa = audio === undefined ? makeFakeAudio(() => clock.t) : audio;
  const over = {
    clock, scheduler, now: () => clock.t, tick: (sec) => scheduler.advance(sec * 1000),
    options: {
      env: { webgl: true, reducedMotion, forcedColors, viewportWidth: 1280 },
      ...(fa ? { audioFactory: fa.factory ?? fa } : {}),
      ...options,
    },
  };
  if (storage) over.storage = storage;
  const r = await newApp(over);
  r.env.storage = storage ?? r.env.storage;
  if (lang) r.app.setLang(lang);
  if (detail) toDetail(r.app);
  return { ...r, scheduler, clock, audio: fa && fa.factory ? fa : null, storage: r.env.storage };
}

// 同じ storage・同じ音の偽物で作り直す（再読込）
export async function reload(prev, extra = {}) {
  return showApp({ storage: prev.storage, audio: prev.audio ?? null, ...extra });
}

export const startRec = (app) => { app.commands['session.start'](); app.startSpeech(); };

// ms だけ dt 刻みで進め、刻みごとに fn(経過 ms) を呼ぶ（演出の途中の状態の観測）
export function sample(scheduler, ms, fn, dt = 20) {
  for (let t = dt; t <= ms; t += dt) { scheduler.advance(dt); fn(t); }
  const rest = ms % dt; if (rest) { scheduler.advance(rest); fn(ms); }
}

export const show = (app) => app.getLiveShow();
export const overlays = (app) => show(app).overlays ?? [];
export const sfield = (app, id) => app.getSettingsDialog()?.fields.find((f) => f.id === id);
export const barItem = (app, cmd) => app.getCommandBar().items.find((i) => i.command === cmd);
export function assertOps(app, query, command) {
  const hits = app.searchCommands(query).map((x) => x.command);
  const idx = hits.indexOf(command);
  assert.ok(idx >= 0, `コマンドの検索「${query}」で ${command} が見つかる（${hits.join(',')}）`);
  const ops = 1 + idx + 1 + 1; // 検索の入力 1 + 候補までの移動 + 選択 1 + 確定 1
  assert.ok(ops <= SHOW.OPS_MAX, `操作回数 ${ops} > ${SHOW.OPS_MAX}（PARAM-164）`);
}
export { FakeStorage };
