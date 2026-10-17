// FR-049: RPG風の BGM（フィールド・街・城）と効果音（決定・キャンセル・カーソル・歩行・会話送り）。
// すべて WebAudio の合成（外部ファイル・外部通信なし）。音は利用者の最初の操作の後に始まる。
// 音が使えない端末（AudioContext なし・エラー）でも例外を出さず、全機能は音なしで動く。
import { readJson, writeJson } from './persist.js';

export const RPG_AUDIO_KEY = 'grp.rpgaudio';
export const DEFAULT_VOLUME = 50; // PARAM-031（%）
export const BGM_KINDS = ['field', 'town', 'castle'];
export const SE_KINDS = ['confirm', 'cancel', 'cursor', 'step', 'talk'];

const NOTE = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A3: 220, G3: 196, F3: 174.61, E3: 164.81 };
// 曲: [音名|null, 拍数] の並び（1 拍 = beat 秒）。曲ごとに音色・速さを変える。
export const SONGS = {
  field: { wave: 'square', beat: 0.3, notes: [['C4', 1], ['E4', 1], ['G4', 1], ['E4', 1], ['A4', 1], ['G4', 1], ['E4', 1], [null, 1], ['D4', 1], ['F4', 1], ['A4', 1], ['F4', 1], ['G4', 2], ['C5', 2]] },
  town: { wave: 'triangle', beat: 0.4, notes: [['G4', 1], ['A4', 1], ['B4', 1], ['D5', 1], ['B4', 2], ['G4', 2], ['E4', 1], ['G4', 1], ['A4', 1], ['G4', 1], ['E4', 2], [null, 2]] },
  castle: { wave: 'sawtooth', beat: 0.5, notes: [['A3', 1], ['C4', 1], ['E4', 2], ['F3', 1], ['A3', 1], ['C4', 2], ['G3', 1], ['B4', 1], ['D5', 2], ['E3', 1], ['G3', 1], ['E4', 2]] },
};
export const SE_DEFS = {
  confirm: { wave: 'square', tones: [['C5', 0.06], ['G5', 0.1]] },
  cancel: { wave: 'square', tones: [['G4', 0.06], ['C4', 0.1]] },
  cursor: { wave: 'square', tones: [['E5', 0.04]] },
  step: { wave: 'triangle', tones: [['C4', 0.03]] },
  talk: { wave: 'square', tones: [['A4', 0.03], ['C5', 0.03]] },
};
export const songDuration = (kind) => SONGS[kind].notes.reduce((s, n) => s + n[1], 0) * SONGS[kind].beat;

const validVolume = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;

// 保存内容の検証。壊れていれば初期値（音量 50・ミュートなし）。
export function parseAudioPrefs(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return { volume: validVolume(o.volume) ? o.volume : DEFAULT_VOLUME, muted: o.muted === true };
}

// 合成エンジン。createContext() が AudioContext 互換を返す（なければ null＝無音）。
export function createAudioEngine(createContext, { setTimer = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimer = (t) => globalThis.clearTimeout(t) } = {}) {
  let ac = null; let master = null; let failed = false;
  let bgm = null; let timer = null; let gain = 0;
  const ensure = () => {
    if (ac) return true;
    if (failed || typeof createContext !== 'function') return false;
    try {
      ac = createContext();
      if (!ac) { failed = true; return false; }
      master = ac.createGain(); master.gain.value = gain; master.connect(ac.destination);
      return true;
    } catch { failed = true; ac = null; return false; }
  };
  const tone = (freq, at, dur, wave, level) => {
    const osc = ac.createOscillator(); const g = ac.createGain();
    osc.type = wave; osc.frequency.value = freq;
    g.gain.setValueAtTime(level, at); g.gain.linearRampToValueAtTime(0, at + dur);
    osc.connect(g); g.connect(master); osc.start(at); osc.stop(at + dur + 0.02);
  };
  const clear = () => { if (timer != null) { clearTimer(timer); timer = null; } };
  const loop = () => {
    timer = null;
    if (!bgm || !ensure()) return;
    try {
      const song = SONGS[bgm]; let t = ac.currentTime + 0.05;
      for (const [n, beats] of song.notes) { if (n) tone(NOTE[n], t, beats * song.beat * 0.9, song.wave, 0.25); t += beats * song.beat; }
      timer = setTimer(loop, songDuration(bgm) * 1000);
      if (timer && typeof timer.unref === 'function') timer.unref();
    } catch { failed = true; }
  };
  return {
    // 実際に出す音量（0〜1）。ミュート・音量 0 のときは 0。
    setGain(v) { gain = v; if (master) { try { master.gain.value = v; } catch { /* 音が使えなくても続ける */ } } },
    playBgm(kind) { if (bgm === kind) return; clear(); bgm = kind; if (kind && SONGS[kind]) loop(); else bgm = null; },
    stopBgm() { clear(); bgm = null; },
    playSe(kind) {
      const d = SE_DEFS[kind]; if (!d || gain <= 0 || !ensure()) return false;
      try { let t = ac.currentTime; for (const [n, dur] of d.tones) { tone(NOTE[n], t, dur, d.wave, 0.3); t += dur; } return true; } catch { failed = true; return false; }
    },
    currentBgm: () => bgm,
    available: () => !failed,
  };
}

export function rpgAudioModule(ctx) {
  ctx.i18n.addStrings({
    ja: { 'rpg.audio.mute': '音をミュート', 'rpg.audio.volume': '音量', 'rpg.audio.bgm': 'BGM', 'rpg.audio.bgmToggle': 'BGM の停止・再開', 'rpg.audio.bgmOn': 'BGM を再開しました', 'rpg.audio.bgmOff': 'BGM を停止しました' },
    en: { 'rpg.audio.mute': 'Mute sound', 'rpg.audio.volume': 'Volume', 'rpg.audio.bgm': 'BGM', 'rpg.audio.bgmToggle': 'Stop / resume BGM', 'rpg.audio.bgmOn': 'BGM resumed', 'rpg.audio.bgmOff': 'BGM stopped' },
  });
  const api = ctx.api;
  const prefs = parseAudioPrefs(readJson(ctx.storage, RPG_AUDIO_KEY));
  let started = false; let bgmOn = true;
  const factory = ctx.options.audioFactory ?? (() => { const C = globalThis.AudioContext ?? globalThis.webkitAudioContext; return C ? new C() : null; });
  const engine = createAudioEngine(factory);
  const isRpg = () => api.getDrawStyle?.() === 'rpg';
  const audible = () => started && !prefs.muted && prefs.volume > 0;
  const areaNow = () => {
    const map = api.getRpgMap?.(); if (!map) return null;
    const c = map.cells.find((k) => k.x === map.hero.x && k.y === map.hero.y);
    return c && BGM_KINDS.includes(c.area) ? c.area : 'field';
  };
  const bgmKind = () => (started && isRpg() && bgmOn ? areaNow() : null);
  const sync = () => {
    engine.setGain(audible() ? prefs.volume / 100 : 0);
    const kind = audible() ? bgmKind() : null;
    if (kind) engine.playBgm(kind); else engine.stopBgm();
  };
  const save = () => writeJson(ctx.storage, RPG_AUDIO_KEY, { volume: prefs.volume, muted: prefs.muted });

  api.getRpgAudio = () => ({ started, volume: prefs.volume, muted: prefs.muted, audible: audible(), bgm: bgmKind(), bgmPlaying: bgmKind() !== null && audible() });
  api.setRpgVolume = (n) => { if (!validVolume(n)) return { ok: false, reason: 'invalid' }; prefs.volume = n; save(); sync(); ctx.change?.(() => {}); return { ok: true, volume: n }; };
  api.setRpgMuted = (b) => { if (typeof b !== 'boolean') return { ok: false, reason: 'invalid' }; prefs.muted = b; save(); sync(); ctx.change?.(() => {}); return { ok: true, muted: b }; };
  // AC-295: BGM だけの停止・再開（ミュートとは別。効果音は鳴る）
  api.setRpgBgm = (b) => { if (typeof b !== 'boolean') return { ok: false, reason: 'invalid' }; bgmOn = b; sync(); ctx.change?.(() => {}); return { ok: true, bgmOn }; };
  ctx.registerKey({ key: 'F5', alt: true, shift: true, command: 'rpg.bgmToggle' });
  api.playRpgSe = (kind) => (SE_KINDS.includes(kind) && audible() ? engine.playSe(kind) : false);
  ctx.registerCommand('rpg.bgmToggle', () => { api.setRpgBgm(!bgmOn); ctx.setMessage?.(bgmOn ? 'rpg.audio.bgmOn' : 'rpg.audio.bgmOff'); });

  // 既存の rpgPress に重ねる（rpg.js は変えない）。RPG風での最初の操作で音を始め、場所の変化で BGM を切り替える。
  const press = api.rpgPress;
  api.rpgPress = (button) => {
    const r = press(button);
    if (r && r.reason !== 'not_rpg' && isRpg()) {
      started = true; sync();
      const se = { up: 'step', down: 'step', left: 'step', right: 'step', a: 'confirm', confirm: 'confirm', b: 'cancel', cancel: 'cancel' }[button];
      if (se && !(se === 'step' && r.moved === false)) api.playRpgSe(se);
    }
    return r;
  };
  ctx.on?.('change', () => { if (started) sync(); });
}
