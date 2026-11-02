// FR-111 映画的な演出（シーンの確定・トピックの切り替え）。AC-632〜634、PARAM-149・PARAM-137。
// プレゼンテーション（FR-010）の中でだけ、シーンが替わった・トピックが替わった時点に短いカメラの寄り（zoom）とフェード（fade）を起こす。
// 強さ: なし／控えめ（既定。300 ms・1.1 倍）／標準（600 ms・1.25 倍）。端末ごとの設定として保存する（storage）。
// reduced motion では動きを止めて即時に切り替え、文字（状態メッセージ）で示す。ミュートは FR-049 と同じ設定（api.getRpgAudio().muted）。
// 演出の音は WebAudio の合成だけ（外部ファイルなし）。外部通信は行わない。生成 AI は使わない。
import { readJson, writeJson } from './persist.js';

export const CINEMATIC_KEY = 'grp.cinematic';
export const CINEMATIC_LEVELS = ['none', 'subtle', 'standard'];
export const DEFAULT_LEVEL = 'subtle';
export const MIN_FONT_PX = 24; // PARAM-137（図の幅 1920 px 換算）
export const LEVEL_SPECS = {
  none: { maxMs: 0, maxZoom: 1 },
  subtle: { maxMs: 300, maxZoom: 1.1 },
  standard: { maxMs: 600, maxZoom: 1.25 },
};
const EVENT_MAX = 200;

export const parseLevel = (raw) => (raw && typeof raw === 'object' && CINEMATIC_LEVELS.includes(raw.level) ? raw.level : DEFAULT_LEVEL);

// 表示される文字が最小サイズ（1920 px 換算で 24 px）を下回らない倍率にする。
// 寄り（1 以上）は上限の倍率まで。引き（1 未満）は、最小サイズを下回る手前で止める。
export function safeZoom(zoom, level, fontPx1920 = MIN_FONT_PX) {
  const spec = LEVEL_SPECS[level] ?? LEVEL_SPECS[DEFAULT_LEVEL];
  const z = Number.isFinite(zoom) ? zoom : 1;
  if (z >= 1) return Math.min(z, spec.maxZoom);
  const floor = fontPx1920 > 0 ? Math.min(1, MIN_FONT_PX / fontPx1920) : 1;
  return Math.max(z, floor);
}

export function cinematicModule(ctx) {
  const { api, state } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'cinematic.title': '映画的な演出', 'cinematic.level': '演出の強さ', 'cinematic.level.none': 'なし', 'cinematic.level.subtle': '控えめ', 'cinematic.level.standard': '標準',
      'cinematic.hint': 'プレゼンテーションの中で、シーンの確定・トピックの切り替えに短い寄りとフェードを入れます。動きの低減・ミュートに従います。',
      'cmd.cinematic.next': '演出の強さを次へ（なし・控えめ・標準）', 'msg.cinematicLevel': '演出の強さ', 'msg.cinematicInstant': '動きの低減のため、演出なしで切り替えました', 'msg.cinematicAborted': '演出を中断しました',
      'msg.cinematicScene': 'シーンが切り替わりました', 'msg.cinematicTopic': 'トピックが切り替わりました',
    },
    en: {
      'cinematic.title': 'Cinematic effects', 'cinematic.level': 'Effect strength', 'cinematic.level.none': 'None', 'cinematic.level.subtle': 'Subtle', 'cinematic.level.standard': 'Standard',
      'cinematic.hint': 'During the presentation, a short zoom and fade play when a scene is confirmed or the topic changes. Reduced motion and mute are respected.',
      'cmd.cinematic.next': 'Next effect strength (none, subtle, standard)', 'msg.cinematicLevel': 'Effect strength', 'msg.cinematicInstant': 'Switched without effects because reduced motion is on', 'msg.cinematicAborted': 'The effect was interrupted',
      'msg.cinematicScene': 'The scene changed', 'msg.cinematicTopic': 'The topic changed',
    },
  });

  let level = parseLevel(readJson(ctx.storage, CINEMATIC_KEY));
  let events = []; // { type:'zoom'|'fade', ms, zoom }
  let last = { sceneId: null, topicId: null, active: false };
  let camera = null; // 最後の演出のカメラ { sceneId, zoom, ms, fade, endAt }
  let sounds = 0; let instantCount = 0; let aborted = 0;
  let audio = null; let audioFailed = false;

  const label = (l) => ctx.t(`cinematic.level.${l}`);
  const spec = () => LEVEL_SPECS[level];
  const reduced = () => ctx.env?.reducedMotion === true;
  const muted = () => { const a = api.getRpgAudio?.(); return !a || a.muted === true || a.volume <= 0; };
  const running = () => camera != null && ctx.now() < camera.endAt;
  const topicOf = (sceneId) => (api.getTopics?.() ?? []).find((tp) => tp.sceneIds.includes(sceneId))?.id ?? null;

  // 演出の音（WebAudio の合成の短い音。ミュート・音量 0・音が使えない端末では鳴らさない）
  function blip(ms) {
    if (muted() || audioFailed) return false;
    try {
      if (!audio) {
        const factory = ctx.options.audioFactory ?? (() => { const C = globalThis.AudioContext ?? globalThis.webkitAudioContext; return C ? new C() : null; });
        audio = factory();
        if (!audio) { audioFailed = true; return false; }
      }
      const osc = audio.createOscillator(); const g = audio.createGain(); const at = audio.currentTime; const dur = Math.max(0.05, ms / 1000);
      osc.type = 'sine'; osc.frequency.value = 523.25;
      g.gain.setValueAtTime(0.08 * ((api.getRpgAudio?.().volume ?? 50) / 100), at); g.gain.linearRampToValueAtTime(0, at + dur);
      osc.connect(g); g.connect(audio.destination); osc.start(at); osc.stop(at + dur + 0.02);
      sounds++; return true;
    } catch { audioFailed = true; return false; }
  }

  function fire(sceneId, topicChanged) {
    if (reduced()) { instantCount++; ctx.change(() => { state.message = { key: 'msg.cinematicInstant', text: ctx.t('msg.cinematicInstant') }; }); return; }
    if (level === 'none') return;
    const { maxMs, maxZoom } = spec();
    const add = (e) => { events.push(e); if (events.length > EVENT_MAX) events.splice(0, events.length - EVENT_MAX); };
    const zoom = safeZoom(maxZoom, level);
    add({ type: 'zoom', ms: maxMs, zoom });
    if (topicChanged) add({ type: 'fade', ms: maxMs, zoom: 1 });
    // 演出の途中で次のシーンが確定したら、前の演出を置き換えて最後の状態へ収束する
    camera = { sceneId, zoom, ms: maxMs, fade: topicChanged, endAt: ctx.now() + maxMs };
    blip(Math.min(maxMs, 120));
  }

  ctx.on('change', () => {
    const pr = state.presentation;
    const active = pr.status === 'playing' || pr.status === 'paused';
    if (!active) { if (last.active) { last = { sceneId: null, topicId: null, active: false }; camera = null; } return; }
    const sceneId = pr.sceneId;
    if (sceneId == null || sceneId === last.sceneId) { last.active = true; return; }
    const topicId = topicOf(sceneId);
    const topicChanged = last.sceneId != null && topicId !== last.topicId;
    last = { sceneId, topicId, active: true };
    fire(sceneId, topicChanged);
  });

  api.getCinematic = () => ({ level, maxMs: spec().maxMs, maxZoom: spec().maxZoom, presentationOnly: true, label: label(level) });
  api.getCinematicOptions = () => CINEMATIC_LEVELS.map((l) => ({ value: l, label: label(l), ...LEVEL_SPECS[l], current: l === level }));
  api.setCinematicLevel = (next) => {
    if (!CINEMATIC_LEVELS.includes(next)) return { ok: false, reason: 'invalid' };
    level = next; writeJson(ctx.storage, CINEMATIC_KEY, { level });
    ctx.change(() => { state.message = { key: 'msg.cinematicLevel', text: `${ctx.t('msg.cinematicLevel')}: ${label(level)}` }; });
    return { ok: true, level };
  };
  api.getCinematicEvents = () => events.map((e) => ({ ...e }));
  api.getCinematicState = () => ({ level, running: running(), reducedMotion: reduced(), muted: muted(), soundCount: sounds, instantCount, abortedCount: aborted });
  // 見た目へ渡すカメラ（view3d.js が使う）。プレゼンテーション中の演出の間だけ値を返す。zoom は 1 以上（寄り）で、文字は最小サイズを下回らない
  api.getCinematicCamera = () => (running() && !reduced() && level !== 'none' ? { sceneId: camera.sceneId, zoom: camera.zoom, ms: camera.ms, fade: camera.fade } : null);
  api.abortCinematic = () => {
    if (!running()) return false;
    camera = null; aborted++;
    ctx.change(() => { state.message = { key: 'msg.cinematicAborted', text: ctx.t('msg.cinematicAborted') }; });
    return true;
  };

  ctx.registerCommand('cinematic.next', () => api.setCinematicLevel(CINEMATIC_LEVELS[(CINEMATIC_LEVELS.indexOf(level) + 1) % CINEMATIC_LEVELS.length]));
  ctx.registerKey({ key: '*', ctrl: true, alt: true, shift: true, command: 'cinematic.next' });
  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    if (ev?.key === 'Escape' && !ev?.ctrlKey && !ev?.altKey && !ev?.shiftKey && api.abortCinematic()) return 'cinematic.abort';
    return baseKey(ev);
  };

  // 演出の強さは端末ごとの設定。セッションの保存物には含めない（図の内容・保存物を変えない: AC-634）。初期化・復元では演出の記録だけを消す
  const clearRun = () => { events = []; camera = null; last = { sceneId: null, topicId: null, active: false }; };
  ctx.registerPersist('cinematic', { export: () => undefined, import: clearRun, reset: clearRun });
}
