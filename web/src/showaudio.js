// FR-116: ライブ描画ショー（FR-115）の演出の音（全画風の BGM と効果音）。
// - 音はすべて Web Audio API でブラウザ内で合成する（外部ファイル・外部通信なし。NFR-OFFLINE-001）。
// - 利用者の最初の操作（クリック・タップ・キー入力）の前は AudioContext を作らない（AC-676）。
// - ショーが OFF・ミュート（AC-228 と共通。api.getRpgAudio().muted）のときは鳴らさず、作った AudioContext は停止（suspend）する。
// - 効果音: pen（ペンの走る音）・write（文字の書き込みのカリカリ）・pop（現れるポン）・whoosh（運ぶシュッ）・chime（決定のチャイム）・sparkle（お祝いのきらめき）。
// - BGM: コード進行＋ベース＋軽いリズムを小節ごとに先読みで予約する、切れ目のないループ（PARAM-184 の曲数以上）。
//   RPG風（FR-047）のときは FR-049 の BGM を優先し、この BGM は鳴らさない（監査の決定 C-02）。
// - 音声入力で話している間は BGM だけを下げる（ダッキング。PARAM-184）。効果音は下げない。
// - 設定（BGM・効果音の音量、BGM の ON/OFF、曲）は端末ごとにブラウザ内へ保存し、データの初期化・セッションファイルでは変わらない。
// - 音が使えない端末（AudioContext なし・例外）でも例外を外へ出さず、ショーと全機能は音なしで動く。
// 接続点（FR-115 との契約）: createShowAudio(ctx) が ctx.showAudio を置く。
//   cue(name, detail) / setEnabled(on) / startBgm() / stopBgm() / duck(on)。未知の name は無視する。
import { readJson, writeJson } from './persist.js';
import { DEFAULT_VOLUME as SE_DEFAULT_VOLUME } from './rpgaudio.js';

export const SHOW_AUDIO_KEY = 'grp.showaudio';
// PARAM-184: 演出の音の値
export const BGM_DEFAULT_VOLUME = 30;
export const SE_DEFAULT = SE_DEFAULT_VOLUME; // {PARAM-031} = 50
export const DUCK_RATIO = 0.3; // ダッキング中の BGM は設定値の 30%
export const DUCK_DOWN_MS = 300;
export const DUCK_UP_MS = 1000;
// 最後の認識結果の後、この時間だけ結果が届かなければ「話し終えた」とみなして戻し始める（暫定結果の間隔より長く、会話の間より短い値）
export const DUCK_HOLD_MS = 800;
export const MIN_SONGS = 3;
export const CUE_NAMES = ['pen', 'write', 'pop', 'whoosh', 'chime', 'sparkle'];
const VOLUME_STEP = 10;

// 効果音の仕様（AC-677: 種類ごとに音の高さ・長さ・波形のどれかが異なる）。ms はその音の既定の長さ。
export const SE_SPECS = {
  pen: { wave: 'noise-bandpass', freq: 3200, ms: 400, maxMs: 1200 }, // PARAM-182 の描線の上限
  write: { wave: 'noise-highpass', freq: 5200, ms: 40, maxMs: 80 }, // PARAM-182 の 1 字の上限
  pop: { wave: 'sine-sweep-up', freq: 650, ms: 140, maxMs: 140 },
  whoosh: { wave: 'noise-sweep', freq: 1200, ms: 350, maxMs: 800 }, // PARAM-182 の運ぶ動きの上限
  chime: { wave: 'sine-chord', freq: 1046.5, ms: 1300, maxMs: 1300 },
  sparkle: { wave: 'sine-bells', freq: 2637, ms: 900, maxMs: 1500 }, // PARAM-182 のお祝いの上限
};
// 同じ種類が短い間隔で続くときは重ねない（うるさくしない）。秒
const MIN_GAP = { pen: 0.05, write: 0.035, pop: 0.04, whoosh: 0.09, chime: 0.2, sparkle: 0.25 };
const MAX_VOICES = 24;
const LOG_MAX = 200;
const LOOKAHEAD = 1.5; // 秒。BGM を先読みで予約する長さ（バックグラウンドのタイマーの間引きに耐える）
const PUMP_MS = 400;
const BGM_LEVEL = 1.1; // 実測（OfflineAudioContext）: 音量 30 で RMS 約 -39 dBFS・効果音の山より低い
const SE_LEVEL = 1;

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// ---- 曲（コード進行・ベース・リズム）。1 曲 8 小節の 4/4。chords: { v: 和音の MIDI, b: ベースの根音, q: 'maj'|'min'|'dom' } ----
const C = (v, b, q = 'maj') => ({ v, b, q });
export const SONGS = {
  sunny: {
    label: ['ひだまり', 'Sunny'], bpm: 104, swing: 0, style: 'pop',
    chords: [C([60, 64, 67], 48), C([59, 62, 67], 47), C([57, 60, 64], 45, 'min'), C([57, 60, 65], 41), C([60, 64, 67], 48), C([59, 62, 67], 43), C([57, 60, 65], 41), C([60, 62, 67], 43)],
    melody: [[[0, 76], [1.5, 79], [3, 81]], [[0.5, 79], [2, 76]], [[0, 72], [1.5, 76], [3, 79]], [[0, 81], [2, 79]], [[0, 76], [1, 79], [2.5, 84]], [[0, 79], [2, 74]], [[0, 77], [1.5, 76], [3, 72]], [[0, 74], [2, 79]]],
  },
  stroll: {
    label: ['おさんぽ', 'Stroll'], bpm: 90, swing: 0.66, style: 'jazz',
    chords: [C([57, 60, 64, 67], 41), C([53, 57, 60, 64], 38, 'min'), C([58, 62, 65, 69], 43, 'min'), C([58, 62, 64, 67], 36, 'dom'), C([55, 60, 64, 67], 45, 'min'), C([53, 57, 60, 64], 38, 'min'), C([58, 62, 65, 69], 43, 'min'), C([58, 62, 64, 67], 36, 'dom')],
    melody: [[[0.66, 72], [1, 76]], [], [[2.66, 74]], [[1, 72]], [[0, 79], [0.66, 76]], [], [[2, 77]], [[1.66, 76]]],
  },
  sparkle: {
    label: ['きらきら', 'Sparkle'], bpm: 116, swing: 0, style: 'arp',
    chords: [C([55, 59, 62], 43), C([55, 59, 64], 40, 'min'), C([55, 60, 64], 36), C([57, 62, 66], 38), C([55, 59, 62], 43), C([55, 59, 64], 40, 'min'), C([55, 60, 64], 36), C([57, 62, 67], 38)],
    melody: [[], [[2, 83]], [], [[2, 81]], [], [[2, 83]], [], [[0, 86]]],
  },
};
export const SONG_IDS = Object.keys(SONGS);
export const barSeconds = (id) => (60 / SONGS[id].bpm) * 4;

const validVolume = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100;
// 保存内容の検証。壊れた値は PARAM-184 の初期値に戻す
export function parseShowAudioPrefs(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    bgmVolume: validVolume(o.bgmVolume) ? o.bgmVolume : BGM_DEFAULT_VOLUME,
    seVolume: validVolume(o.seVolume) ? o.seVolume : SE_DEFAULT,
    bgmOn: typeof o.bgmOn === 'boolean' ? o.bgmOn : true,
    song: SONG_IDS.includes(o.song) ? o.song : SONG_IDS[0],
  };
}
// 音量（0〜100）から出力の倍率（0〜1）。耳の感じ方に合わせて小さい側を細かくする。0 は必ず 0
export const volumeGain = (v) => (v <= 0 ? 0 : (Math.min(100, v) / 100) ** 1.5);

// ---- 合成（ac: AudioContext 互換） ----
function param(p, at, v) { p.cancelScheduledValues?.(at); p.setValueAtTime(v, at); }
// 音の立ち上がり・減衰（指数の減衰は 0 にできないため最後に 0 を置く）
function envelope(p, at, peak, attack, decay) {
  p.setValueAtTime(0, at);
  p.linearRampToValueAtTime(peak, at + attack);
  p.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  p.setValueAtTime(0, at + attack + decay + 0.01);
}

function makeNoise(ac) {
  const len = Math.floor((ac.sampleRate || 44100) * 2);
  const buf = ac.createBuffer(1, len, ac.sampleRate || 44100);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function createSynth(ac, out) {
  const noise = makeNoise(ac);
  const chain = (nodes) => { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); };
  const pan = (p) => {
    if (typeof p !== 'number' || !Number.isFinite(p) || typeof ac.createStereoPanner !== 'function') return null;
    const n = ac.createStereoPanner(); n.pan.value = Math.max(-1, Math.min(1, p)); return n;
  };
  const tone = (dest, { type = 'sine', freq, freqEnd, at, attack = 0.005, decay, peak, filter }) => {
    const o = ac.createOscillator(); const g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, at);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, at + Math.max(0.02, attack + decay * 0.35));
    envelope(g.gain, at, peak, attack, decay);
    const nodes = [o];
    if (filter) { const f = ac.createBiquadFilter(); f.type = filter.type; f.frequency.value = filter.freq; f.Q.value = filter.q ?? 0.7; nodes.push(f); }
    nodes.push(g, dest); chain(nodes);
    o.start(at); o.stop(at + attack + decay + 0.05);
    return at + attack + decay;
  };
  const hiss = (dest, { at, dur, type = 'bandpass', freq, freqEnd, q = 1, peak, attack = 0.004, shape }) => {
    const s = ac.createBufferSource(); s.buffer = noise;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, at);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, at + dur);
    const g = ac.createGain();
    if (shape) shape(g.gain, at, dur, peak); else envelope(g.gain, at, peak, attack, Math.max(0.005, dur - attack));
    chain([s, f, g, dest]);
    s.start(at, Math.random() * 1.5); s.stop(at + dur + 0.05);
    return at + dur;
  };
  const vary = (x, r = 0.03) => x * (1 + (Math.random() * 2 - 1) * r);

  // 効果音（戻り値: 鳴り終わる時刻）
  const SE = {
    // ペンの走る音: 帯域を絞ったノイズの紙ずれに、筆圧の揺れ（25 ms ごとの強弱）を付ける
    pen(dest, at, d) {
      const dur = Math.min(SE_SPECS.pen.maxMs, Math.max(80, d.ms ?? SE_SPECS.pen.ms)) / 1000;
      return hiss(dest, { at, dur, type: 'bandpass', freq: vary(SE_SPECS.pen.freq, 0.08), q: 0.9, peak: 0.2, shape: (p, t0, len, peak) => {
        p.setValueAtTime(0, t0); p.linearRampToValueAtTime(peak * 0.8, t0 + 0.015);
        for (let t = 0.04; t < len - 0.04; t += 0.025) p.linearRampToValueAtTime(peak * (0.5 + Math.random() * 0.5), t0 + t);
        p.linearRampToValueAtTime(0, t0 + len);
      } });
    },
    // 文字の書き込み: 高い帯域の短い 2 つの擦れ（カリカリ）
    write(dest, at) {
      const f = vary(SE_SPECS.write.freq, 0.1);
      hiss(dest, { at, dur: 0.018, type: 'highpass', freq: f, q: 0.7, peak: 0.16, attack: 0.002 });
      return hiss(dest, { at: at + 0.022, dur: 0.018, type: 'highpass', freq: f * 1.12, q: 0.7, peak: 0.11, attack: 0.002 });
    },
    // ポン: 下から上へ素早く上がる正弦波＋ごく短い当たり
    pop(dest, at) {
      const f = vary(SE_SPECS.pop.freq, 0.05);
      hiss(dest, { at, dur: 0.012, type: 'bandpass', freq: 2000, q: 1.5, peak: 0.05, attack: 0.001 });
      return tone(dest, { type: 'sine', freq: f * 0.58, freqEnd: f * 1.4, at, attack: 0.006, decay: 0.13, peak: 0.32 });
    },
    // シュッ: 帯域が低い方から高い方へ動くノイズの膨らみ
    whoosh(dest, at, d) {
      const dur = Math.min(SE_SPECS.whoosh.maxMs, Math.max(150, d.ms ?? SE_SPECS.whoosh.ms)) / 1000;
      return hiss(dest, { at, dur, type: 'bandpass', freq: 350, freqEnd: 2600, q: 1.2, peak: 0.2, shape: (p, t0, len, peak) => {
        p.setValueAtTime(0, t0); p.linearRampToValueAtTime(peak, t0 + len * 0.55); p.linearRampToValueAtTime(0, t0 + len);
      } });
    },
    // 決定のチャイム: 明るい長三和音を下から順に（C6・E6・G6・C7）。倍音を少し足した鐘の音
    chime(dest, at) {
      let end = at;
      [84, 88, 91, 96].forEach((m, i) => {
        const t = at + i * 0.06;
        tone(dest, { type: 'sine', freq: mtof(m), at: t, attack: 0.004, decay: 1.1, peak: 0.11 });
        end = Math.max(end, tone(dest, { type: 'triangle', freq: mtof(m + 12), at: t, attack: 0.003, decay: 0.35, peak: 0.025 }));
      });
      return end;
    },
    // お祝いのきらめき: 高いペンタトニックの粒を左右に散らす
    sparkle(dest, at, d) {
      const dur = Math.min(SE_SPECS.sparkle.maxMs, Math.max(300, d.ms ?? SE_SPECS.sparkle.ms)) / 1000;
      const pool = [96, 98, 100, 103, 105, 108];
      const n = Math.max(5, Math.round(dur / 0.09)); let end = at;
      for (let i = 0; i < n; i++) {
        const t = at + (i / n) * dur * 0.75;
        const p = pan(((i % 2) ? 1 : -1) * 0.5);
        const target = p ? (p.connect(dest), p) : dest;
        end = Math.max(end, tone(target, { type: 'sine', freq: mtof(pool[Math.floor(Math.random() * pool.length)]), at: t, attack: 0.003, decay: 0.22, peak: 0.1 * (1 - i / (n * 1.6)) }));
      }
      return end;
    },
  };

  // ---- BGM の楽器 ----
  const INS = {
    kick: (dest, at, v = 1) => tone(dest, { type: 'sine', freq: 120, freqEnd: 45, at, attack: 0.002, decay: 0.16, peak: 0.42 * v }),
    hat: (dest, at, v = 1) => hiss(dest, { at, dur: 0.035, type: 'highpass', freq: 7000, q: 0.7, peak: 0.05 * v, attack: 0.001 }),
    shaker: (dest, at, v = 1) => hiss(dest, { at, dur: 0.05, type: 'highpass', freq: 5500, q: 0.6, peak: 0.03 * v, attack: 0.01 }),
    rim: (dest, at, v = 1) => hiss(dest, { at, dur: 0.06, type: 'bandpass', freq: 1800, q: 2.5, peak: 0.07 * v, attack: 0.001 }),
    brush: (dest, at, v = 1) => hiss(dest, { at, dur: 0.12, type: 'bandpass', freq: 3000, q: 0.6, peak: 0.035 * v, attack: 0.02 }),
    bass: (dest, at, m, len, v = 1) => tone(dest, { type: 'triangle', freq: mtof(m), at, attack: 0.008, decay: len, peak: 0.2 * v, filter: { type: 'lowpass', freq: 700 } }),
    keys: (dest, at, m, len, v = 1) => tone(dest, { type: 'triangle', freq: mtof(m), at, attack: 0.012, decay: len, peak: 0.045 * v, filter: { type: 'lowpass', freq: 1800 } }),
    epiano: (dest, at, m, len, v = 1) => { tone(dest, { type: 'sine', freq: mtof(m), at, attack: 0.01, decay: len, peak: 0.065 * v }); return tone(dest, { type: 'sine', freq: mtof(m) * 2, at, attack: 0.005, decay: len * 0.3, peak: 0.016 * v }); },
    pad: (dest, at, m, len, v = 1) => tone(dest, { type: 'sawtooth', freq: mtof(m), at, attack: Math.min(0.3, len / 3), decay: len, peak: 0.016 * v, filter: { type: 'lowpass', freq: 900 } }),
    bell: (dest, at, m, len, v = 1) => tone(dest, { type: 'sine', freq: mtof(m), at, attack: 0.003, decay: len, peak: 0.05 * v }),
    marimba: (dest, at, m, len, v = 1) => { tone(dest, { type: 'sine', freq: mtof(m) * 4, at, attack: 0.002, decay: 0.05, peak: 0.012 * v }); return tone(dest, { type: 'sine', freq: mtof(m), at, attack: 0.003, decay: len, peak: 0.07 * v }); },
  };

  // 1 小節を予約する。t0: 小節の頭の時刻、beat: 1 拍の秒
  function bar(songId, index, t0, dest) {
    const s = SONGS[songId]; const beat = 60 / s.bpm; const ch = s.chords[index % s.chords.length];
    const next = s.chords[(index + 1) % s.chords.length];
    const sw = (pos) => (s.swing && pos % 1 === 0.5 ? Math.floor(pos) + s.swing : pos); // 裏拍のはね
    const at = (pos) => t0 + sw(pos) * beat;
    if (s.style === 'pop') {
      for (const [pos, len] of [[0, 0.9], [1.5, 0.4], [2.5, 0.4], [3, 0.8]]) for (const m of ch.v) INS.keys(dest, at(pos), m, len * beat, pos === 0 ? 1 : 0.75);
      INS.bass(dest, at(0), ch.b, beat * 1.6); INS.bass(dest, at(2), ch.b + 7, beat * 1.2, 0.85); INS.bass(dest, at(3.5), ch.b + 12, beat * 0.4, 0.6);
      INS.kick(dest, at(0)); INS.kick(dest, at(2), 0.8);
      INS.rim(dest, at(1)); INS.rim(dest, at(3));
      for (let p = 0; p < 4; p += 0.5) INS.hat(dest, at(p), p % 1 ? 1 : 0.55);
      for (const [pos, m] of s.melody[index % s.melody.length]) INS.marimba(dest, at(pos), m, beat * 0.9);
    } else if (s.style === 'jazz') {
      for (const [pos, len] of [[0, 1.2], [2.5, 0.8]]) for (const m of ch.v) INS.epiano(dest, at(pos), m, len * beat, pos === 0 ? 1 : 0.7);
      const third = ch.q === 'min' ? 3 : 4;
      const walk = [ch.b, ch.b + third, ch.b + 7, next.b + (next.b > ch.b ? -1 : 1)];
      walk.forEach((m, i) => INS.bass(dest, at(i), m, beat * 0.85, i === 0 ? 1 : 0.8));
      INS.kick(dest, at(0), 0.5);
      for (let p = 0; p < 4; p += 1) { INS.brush(dest, at(p), p % 2 ? 1 : 0.7); INS.brush(dest, at(p + 0.5), 0.45); }
      for (const [pos, m] of s.melody[index % s.melody.length]) INS.bell(dest, t0 + pos * beat, m, beat * 1.4, 0.8);
    } else {
      for (const m of ch.v) INS.pad(dest, at(0), m, beat * 3.8);
      const tones = [...ch.v.map((m) => m + 12), ch.v[0] + 24];
      const order = [0, 1, 2, 3, 2, 1, 2, 3];
      for (let i = 0; i < 16; i++) INS.bell(dest, at(i / 4), tones[order[i % order.length]], beat * 0.45, i % 4 === 0 ? 0.75 : 0.5);
      for (let p = 0; p < 4; p += 0.5) INS.bass(dest, at(p), ch.b + (p % 1 ? 12 : 0), beat * 0.4, p % 1 ? 0.6 : 0.9);
      for (let p = 0; p < 4; p += 1) INS.kick(dest, at(p), 0.7);
      INS.rim(dest, at(1), 0.8); INS.rim(dest, at(3), 0.8);
      for (let p = 0; p < 4; p += 0.25) INS.shaker(dest, at(p), (p * 4) % 2 ? 1 : 0.6);
      for (const [pos, m] of s.melody[index % s.melody.length]) INS.bell(dest, at(pos), m, beat * 1.6, 0.9);
    }
  }
  return { se: (name, dest, at, d) => SE[name](dest, at, d), bar, noise };
}

// ---- 演出の音の本体（FR-115 との接続点） ----
export function createShowAudio(ctx) {
  const api = ctx.api;
  const sched = ctx.options.scheduler ?? { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  const factory = ctx.options.audioFactory ?? (() => { const K = globalThis.AudioContext ?? globalThis.webkitAudioContext; return K ? new K() : null; });
  const prefs = parseShowAudioPrefs(readJson(ctx.storage, SHOW_AUDIO_KEY));
  let started = false; // 利用者の最初の操作の後
  let enabled = false; // ショーが ON
  let bgmWanted = true; // startBgm()/stopBgm()（ショー側の指示）
  let ac = null; let failed = false; let contexts = 0; let suspending = false;
  let nodes = null; let synth = null;
  let ducked = false; let releaseTimer = null;
  let bgm = null; // { song, bar, nextAt, timer, gain }
  const last = {}; let voices = [];
  const log = []; const bgmLog = []; const sfx = [];

  const muted = () => api.getRpgAudio?.().muted === true;
  const isRpg = () => api.getDrawStyle?.() === 'rpg';
  const audible = () => started && enabled && !muted();
  const bgmShould = () => audible() && prefs.bgmOn && bgmWanted && !isRpg() && prefs.bgmVolume > 0;
  const bgmTarget = () => (audible() ? volumeGain(prefs.bgmVolume) * BGM_LEVEL * (ducked ? DUCK_RATIO : 1) : 0);
  const seTarget = () => (audible() ? volumeGain(prefs.seVolume) * SE_LEVEL : 0);

  function ensure() {
    if (ac) return true;
    if (failed || !started) return false;
    try {
      ac = factory(); contexts++;
      if (!ac) { failed = true; return false; }
      const master = ac.createGain(); master.gain.value = 0.9;
      let tail = master;
      if (typeof ac.createDynamicsCompressor === 'function') { // 効果音と BGM が重なっても割れないように軽く抑える
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
        master.connect(comp); tail = comp;
      }
      tail.connect(ac.destination);
      const bgmBus = ac.createGain(); bgmBus.gain.value = 0; bgmBus.connect(master);
      const seBus = ac.createGain(); seBus.gain.value = 0; seBus.connect(master);
      nodes = { master, bgmBus, seBus };
      synth = createSynth(ac, master);
      return true;
    } catch { failed = true; ac = null; nodes = null; return false; }
  }
  const guard = (fn) => { try { return fn(); } catch { failed = true; return undefined; } };

  // 出力の大きさを状態に合わせる（ミュート・音量 0 は 0）。ダッキングは BGM のバスだけを動かす
  let applied = { se: null, bgm: null };
  function levels(rampMs = 60) {
    if (!ac || !nodes) return;
    const se = seTarget(); const bg = bgmTarget();
    guard(() => {
      const t = ac.currentTime;
      // 変わったときだけ予約し直す（短い傾きで変えて、プツッという音を出さない）
      if (applied.se !== se) { param(nodes.seBus.gain, t, nodes.seBus.gain.value); nodes.seBus.gain.linearRampToValueAtTime(se, t + 0.06); applied.se = se; }
      if (applied.bgm !== bg) { param(nodes.bgmBus.gain, t, nodes.bgmBus.gain.value); nodes.bgmBus.gain.linearRampToValueAtTime(bg, t + rampMs / 1000); applied.bgm = bg; }
    });
  }

  function pump() {
    if (!bgm) return;
    bgm.timer = null;
    guard(() => {
      const bs = barSeconds(bgm.song);
      while (bgm.nextAt < ac.currentTime + LOOKAHEAD) {
        synth.bar(bgm.song, bgm.bar, bgm.nextAt, bgm.gain);
        bgmLog.push({ song: bgm.song, bar: bgm.bar, at: bgm.nextAt }); if (bgmLog.length > 64) bgmLog.shift();
        bgm.nextAt += bs; // 小節の頭を前の小節の終わりにそろえる（ループの継ぎ目に隙間を作らない）
        bgm.bar = (bgm.bar + 1) % SONGS[bgm.song].chords.length;
      }
      bgm.timer = sched.setTimeout(pump, PUMP_MS);
    });
  }
  function fadeOutBgm() {
    if (!bgm) return;
    const b = bgm; bgm = null;
    if (b.timer != null) sched.clearTimeout(b.timer);
    guard(() => {
      const t = ac.currentTime;
      param(b.gain.gain, t, b.gain.gain.value); b.gain.gain.linearRampToValueAtTime(0, t + 0.25);
      sched.setTimeout(() => guard(() => b.gain.disconnect()), 400);
    });
  }
  function startBgmNow() {
    if (bgm && bgm.song === prefs.song) return;
    fadeOutBgm();
    if (!ensure()) return;
    guard(() => {
      const g = ac.createGain(); const t = ac.currentTime;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.4); g.connect(nodes.bgmBus);
      bgm = { song: prefs.song, bar: 0, nextAt: t + 0.08, timer: null, gain: g };
      pump();
    });
  }

  // 状態から、作る・止める・鳴らす を決める
  function sync() {
    if (!audible()) {
      fadeOutBgm();
      if (ac && !suspending && ac.state !== 'suspended') {
        levels();
        // 音を 0 へ下げ終えてから止める（途中で切ってプツッと鳴らさない）
        suspending = true;
        sched.setTimeout(() => { suspending = false; if (!audible()) guard(() => { if (ac.state !== 'suspended') ac.suspend?.(); }); }, 300);
      }
      return;
    }
    if (!ensure()) return;
    guard(() => { if (ac.state === 'suspended') ac.resume?.(); });
    levels();
    if (bgmShould()) startBgmNow(); else fadeOutBgm();
  }

  const save = () => writeJson(ctx.storage, SHOW_AUDIO_KEY, { ...prefs });

  const showAudio = {
    // 演出の出来事に合わせた効果音（未知の name は無視。鳴らしたら true）
    cue(name, detail = {}) {
      if (!CUE_NAMES.includes(name)) return false;
      if (!audible()) return false;
      const d = detail && typeof detail === 'object' ? detail : {};
      const entry = { name, at: ctx.now(), voiced: false };
      log.push(entry); if (log.length > LOG_MAX) log.shift();
      if (prefs.seVolume <= 0) return false;
      if (!ensure()) return false;
      const ok = guard(() => {
        if (ac.state === 'suspended') ac.resume?.();
        levels();
        const t = ac.currentTime;
        if (last[name] != null && t - last[name] < MIN_GAP[name]) return false;
        voices = voices.filter((e) => e > t);
        if (voices.length >= MAX_VOICES) return false;
        last[name] = t;
        let dest = nodes.seBus;
        if (typeof d.pan === 'number' && typeof ac.createStereoPanner === 'function') { const p = ac.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, d.pan)) * 0.6; p.connect(nodes.seBus); dest = p; }
        voices.push(synth.se(name, dest, t + 0.005, d));
        return true;
      });
      entry.voiced = ok === true;
      if (entry.voiced && name !== 'write') { const { wave, freq, ms } = SE_SPECS[name]; sfx.push({ kind: name, at: entry.at, wave, freq, durMs: ms }); if (sfx.length > LOG_MAX) sfx.shift(); }
      return entry.voiced;
    },
    setEnabled(on) { const next = on === true; if (next === enabled) return; enabled = next; if (enabled) bgmWanted = true; else { ducked = false; clearRelease(); } sync(); },
    startBgm() { bgmWanted = true; sync(); },
    stopBgm() { bgmWanted = false; sync(); },
    // ダッキング: on で BGM を {DUCK_RATIO} まで {DUCK_DOWN_MS} で下げ、off で {DUCK_UP_MS} で戻す
    duck(on) { clearRelease(); setDuck(on === true); },
  };
  function clearRelease() { if (releaseTimer != null) { sched.clearTimeout(releaseTimer); releaseTimer = null; } }
  function setDuck(on) { if (ducked === on) return; ducked = on; levels(on ? DUCK_DOWN_MS : DUCK_UP_MS); }

  // 音声入力の結果（暫定・確定）が届いている間は下げ、最後の結果から {DUCK_HOLD_MS} 届かなければ戻す
  let lastInterim = '';
  function speechActivity(stillTalking) {
    if (!audible()) return; // ショーが OFF・ミュートの間は下げる対象がない（タイマーも予約しない）
    clearRelease(); setDuck(true);
    if (!stillTalking) releaseTimer = sched.setTimeout(() => { releaseTimer = null; setDuck(false); }, DUCK_HOLD_MS);
  }
  ctx.on?.('change', () => {
    const im = String(ctx.state.speech?.interim ?? '');
    if (im !== lastInterim) { const was = lastInterim; lastInterim = im; if (im) speechActivity(true); else if (was) speechActivity(false); }
    if (started) sync(); // 画風（RPG風）・ミュートの変化に追従
  });
  ctx.on?.('utterance', () => { if (ctx.state.speech?.active === true) speechActivity(String(ctx.state.speech?.interim ?? '') !== ''); });

  // 利用者の最初の操作（ブラウザの自動再生の制限に合わせ、ここから先だけ音の仕組みを作れる）
  function gesture() {
    if (started) { if (ac && audible()) guard(() => { if (ac.state === 'suspended') ac.resume?.(); }); return; }
    started = true; sync();
  }

  const bgmLevel = () => { if (!bgm || !ac || !nodes) return 0; const v = guard(() => nodes.bgmBus.gain.value); return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : 0; };
  const state = () => ({
    started, enabled, muted: muted(), audible: audible(), available: !failed,
    contexts, bgmVolume: prefs.bgmVolume, seVolume: prefs.seVolume, bgmOn: prefs.bgmOn, song: prefs.song,
    bgmPlaying: bgm != null, bgmSong: bgm?.song ?? null, rpgPriority: isRpg(), ducked,
    bgmOutput: bgmTarget(), seOutput: seTarget(), suspended: ac ? ac.state === 'suspended' : null,
    // 契約（CONTRACT-LIVE-SHOW）の名前
    sfxVolume: prefs.seVolume, track: prefs.song, tracks: SONG_IDS.map((id) => ({ id })), bgmLevel: bgmLevel(), sfx: sfx.map((e) => ({ ...e })),
  });
  const setters = {
    setBgmVolume(n) { if (!validVolume(n)) return { ok: false, reason: 'invalid' }; prefs.bgmVolume = n; save(); sync(); return { ok: true, bgmVolume: n }; },
    setSeVolume(n) { if (!validVolume(n)) return { ok: false, reason: 'invalid' }; prefs.seVolume = n; save(); sync(); return { ok: true, seVolume: n }; },
    setBgmOn(b) { if (typeof b !== 'boolean') return { ok: false, reason: 'invalid' }; prefs.bgmOn = b; save(); sync(); return { ok: true, bgmOn: b }; },
    setSong(id) { if (!SONG_IDS.includes(id)) return { ok: false, reason: 'invalid' }; prefs.song = id; save(); sync(); return { ok: true, song: id }; },
  };
  Object.defineProperty(showAudio, '_internal', { value: { gesture, state, setters, log, bgmLog }, enumerable: false });
  ctx.showAudio = showAudio;
  return showAudio;
}

export function showAudioModule(ctx) {
  const { api } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'show.audio.bgmVolume': 'BGM の音量', 'show.audio.seVolume': '効果音の音量', 'show.audio.bgmOn': 'BGM を流す', 'show.audio.song': 'BGM の曲',
      'show.audio.song.sunny': 'ひだまり', 'show.audio.song.stroll': 'おさんぽ', 'show.audio.song.sparkle': 'きらきら',
      'msg.showAudio.bgmOn': 'BGM: 流す', 'msg.showAudio.bgmOff': 'BGM: 止める', 'msg.showAudio.invalid': '音量は 0〜100 の整数で指定してください',
    },
    en: {
      'show.audio.bgmVolume': 'BGM volume', 'show.audio.seVolume': 'SFX volume', 'show.audio.bgmOn': 'Play BGM', 'show.audio.song': 'BGM song',
      'show.audio.song.sunny': 'Sunny', 'show.audio.song.stroll': 'Stroll', 'show.audio.song.sparkle': 'Sparkle',
      'msg.showAudio.bgmOn': 'BGM: on', 'msg.showAudio.bgmOff': 'BGM: off', 'msg.showAudio.invalid': 'Enter a whole number from 0 to 100 for the volume',
    },
  });
  const sa = createShowAudio(ctx);
  const { gesture, state, setters, log, bgmLog } = sa._internal;
  const t = ctx.t;
  const songLabel = (id) => t(`show.audio.song.${id}`);
  const say = (text) => ctx.change((s) => { s.message = { key: 'msg.showAudio', text }; });
  const done = (r) => { if (r.ok) ctx.change(() => {}); return r; };

  // 利用者の操作（main.js・ui.js が pointerdown・keydown で呼ぶ）。プログラムからのコマンドの呼び出しは操作とみなさない（契約）
  api.notifyUserGesture = () => { gesture(); api.noteRpgUserGesture?.(); };
  api.noteUserGesture = api.notifyUserGesture;
  api.getShowAudio = () => { const s = state(); return { ...s, tracks: SONG_IDS.map((id) => ({ id, label: songLabel(id) })) }; };
  api.getShowAudioLog = () => log.map((e) => ({ ...e }));
  api.getShowAudioBgmLog = () => bgmLog.map((e) => ({ ...e }));
  api.getShowAudioSongs = () => SONG_IDS.map((id) => ({ value: id, label: songLabel(id), bpm: SONGS[id].bpm, bars: SONGS[id].chords.length, current: id === state().song }));
  api.setShowBgmVolume = (n) => done(setters.setBgmVolume(n));
  api.setShowSeVolume = (n) => done(setters.setSeVolume(n));
  api.setShowBgmOn = (b) => done(setters.setBgmOn(b));
  api.setShowBgmSong = (id) => done(setters.setSong(id));
  // 契約（CONTRACT-LIVE-SHOW）の名前
  api.setShowSfxVolume = api.setShowSeVolume;
  api.setShowBgm = api.setShowBgmOn;
  api.setShowBgmTrack = api.setShowBgmSong;
  // ライブ描画ショー（FR-115）の ON/OFF に合わせる（ショーは先に組み立て済み。以後はショー側が setEnabled を呼ぶ）
  sa.setEnabled(api.getLiveShow?.()?.on === true);

  // ［設定］の項目（BGM の音量・効果音の音量・BGM の ON/OFF・曲）。描画は ui.js。音量はコマンドで開いてフォーカスし、入力して Enter で確定
  const VOL = { 'showSound.bgmVolume': (n) => api.setShowBgmVolume(n), 'showSound.sfxVolume': (n) => api.setShowSfxVolume(n) };
  const intOf = (v) => (typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v);
  const baseDialog = api.getSettingsDialog;
  const dialogOpen = () => Boolean(baseDialog?.());
  let focused = null; const drafts = {};
  api.setSettingsField = ((base) => (id, value) => {
    if (VOL[id]) return VOL[id](intOf(value));
    if (id === 'showSound.bgm') return api.setShowBgm(value);
    if (id === 'showSound.track') return api.setShowBgmTrack(value);
    return base ? base(id, value) : { ok: false, reason: 'not_found' };
  })(api.setSettingsField);
  const baseDraft = api.setSettingsFieldDraft;
  api.setSettingsFieldDraft = (id, text) => {
    if (!VOL[id]) return baseDraft ? baseDraft(id, text) : { ok: false, reason: 'not_found' };
    drafts[id] = String(text ?? ''); ctx.emit('change', api); return { ok: true };
  };
  const baseFocus = api.focusSettingsField;
  api.focusSettingsField = (id) => {
    if (VOL[id]) { if (!dialogOpen()) return false; baseFocus?.(id); focused = id; ctx.emit('change', api); return true; }
    focused = null; return baseFocus ? baseFocus(id) : false;
  };
  ctx.on?.('change', () => { if (!dialogOpen()) { focused = null; for (const k of Object.keys(drafts)) delete drafts[k]; } });
  const hk = api.handleKey;
  if (typeof hk === 'function') {
    api.handleKey = (ev) => {
      gesture(); // キー入力は利用者の操作（ブラウザでは ui.js が notifyUserGesture も呼ぶ）
      const plain = !ev?.ctrlKey && !ev?.altKey && !ev?.shiftKey;
      if (focused && dialogOpen() && plain && String(ev?.key) === 'Enter') {
        const id = focused; const s = state(); const cur = id === 'showSound.bgmVolume' ? s.bgmVolume : s.seVolume;
        const r = VOL[id](intOf(drafts[id] ?? cur)); delete drafts[id];
        say(r.ok ? `${fieldLabel(id)}: ${id === 'showSound.bgmVolume' ? state().bgmVolume : state().seVolume}` : t('msg.showAudio.invalid'));
        return 'settings.showSound.commit';
      }
      return hk(ev);
    };
  }
  const fieldLabel = (id) => t(id === 'showSound.bgmVolume' ? 'show.audio.bgmVolume' : 'show.audio.seVolume');
  // コマンドの検索で、項目のラベルと同じ名前（先頭の候補）。選ぶと［設定］を開いてその項目にフォーカス
  for (const [cmd, id] of [['settings.showBgmVolume', 'showSound.bgmVolume'], ['settings.showSfxVolume', 'showSound.sfxVolume']]) {
    ctx.registerCommand(cmd, () => { api.commands['settings.open']?.(); api.focusSettingsField(id); });
  }
  // NFR-A11Y-001: キー割り当て（Alt+Shift+[ ・ ]。記号は物理キーで判定する）
  ctx.registerKey({ key: '[', alt: true, shift: true, command: 'settings.showBgmVolume' });
  ctx.registerKey({ key: ']', alt: true, shift: true, command: 'settings.showSfxVolume' });

  // コマンドの検索（AC-679: 検索の入力・候補の選択・確定の {PARAM-164} 回以内）。値なしは「次の値へ」
  const stepVol = (v) => (v + VOLUME_STEP > 100 ? 0 : v + VOLUME_STEP);
  ctx.registerCommand('showAudio.bgmToggle', () => { const r = api.setShowBgmOn(!state().bgmOn); say(t(state().bgmOn ? 'msg.showAudio.bgmOn' : 'msg.showAudio.bgmOff')); return r; });
  ctx.registerCommand('showAudio.nextSong', () => { const i = SONG_IDS.indexOf(state().song); const r = api.setShowBgmSong(SONG_IDS[(i + 1) % SONG_IDS.length]); say(`${t('show.audio.song')}: ${songLabel(state().song)}`); return r; });
  ctx.registerCommand('showAudio.bgmVolume', () => { const r = api.setShowBgmVolume(stepVol(state().bgmVolume)); say(`${t('show.audio.bgmVolume')}: ${state().bgmVolume}`); return r; });
  ctx.registerCommand('showAudio.seVolume', () => { const r = api.setShowSeVolume(stepVol(state().seVolume)); say(`${t('show.audio.seVolume')}: ${state().seVolume}`); return r; });
  // NFR-A11Y-001: すべての操作にキー割り当て（Alt+Shift+Home・End・PageUp・PageDown は未使用）
  for (const [key, command] of [['Home', 'showAudio.bgmToggle'], ['End', 'showAudio.nextSong'], ['PageUp', 'showAudio.bgmVolume'], ['PageDown', 'showAudio.seVolume']]) ctx.registerKey({ key, alt: true, shift: true, command });

  if (typeof baseDialog === 'function') {
    api.getSettingsDialog = (...a) => {
      const d = baseDialog(...a);
      if (!d) return d;
      const s = state();
      const vol = (id, label, value) => ({ id, label, value, min: 0, max: 100, step: 1, role: 'slider', focusable: true, input: { type: 'number', value: drafts[id] ?? String(value), inputmode: 'numeric' } });
      return { ...d, focusedField: focused ?? d.focusedField ?? null, fields: [...d.fields,
        vol('showSound.bgmVolume', t('show.audio.bgmVolume'), s.bgmVolume),
        vol('showSound.sfxVolume', t('show.audio.seVolume'), s.seVolume),
        { id: 'showSound.bgm', label: t('show.audio.bgmOn'), value: s.bgmOn, role: 'switch' },
        { id: 'showSound.track', label: t('show.audio.song'), value: s.song, options: api.getShowAudioSongs().map(({ value, label }) => ({ value, label })) }] };
    };
  }
  const baseView = api.getSettingsView;
  if (typeof baseView === 'function') api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, ...['showSound.bgmVolume', 'showSound.sfxVolume', 'showSound.bgm', 'showSound.track'].map((id) => ({ id, visible: true }))] }; };
}
