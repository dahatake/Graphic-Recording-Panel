// FR-022 AC-671: .vtt の取込の方法（「一括」＝既定・AC-523／「再生取込」）と再生取込の進行。DOM・外部通信に依存しない（画面は vttplay-ui.js）。
// - 再生取込では、cue は AC-113 の受付時刻の差を、選んだ速さ（PARAM-183: 1・2・4・8 倍）で割った時間の経過ごとに（scheduler.setTimeout）、
//   確定結果として順に届く。受付時刻は一括と同じ（取込の開始時刻＋cue の開始時刻の差）なので、内容・順・受付時刻・シーンの分かれ方は速さによらず一括と同じ。
// - 届いた発話はライブの発話（opts.hold）として記録され、図には更新間隔（AC-521）ごとにまとめて描き足される（liverefresh.js）。
// - 進み具合（取り込んだ cue の数／全体）を取込の状態の文字で示し、一時停止・再開・中止ができる。中止しても取り込み済みの発話は残る。
// - 選んだ方法と速さは端末ごとの設定としてブラウザ内に保存する（セッションファイル・データの初期化の対象外）。
import { readJson, writeJson } from './persist.js';
import { validateTextFile } from './input.js';
import { parseVttCues, cueOffsets } from './vtt.js';

export const IMPORT_METHOD_KEY = 'grp.importMethod';
export const IMPORT_METHODS = ['batch', 'playback'];
export const PLAYBACK_SPEEDS = [1, 2, 4, 8]; // PARAM-183
export const DEFAULT_IMPORT = { method: 'batch', speed: 1 };

const STRINGS = {
  ja: {
    'import.method.label': '取込の方法', 'import.method.batch': '一括', 'import.method.playback': '再生取込',
    'import.speed.label': '速さ', 'import.speed.option': '{n} 倍', 'import.method.invalid': '選べない取込の方法か速さです（一括・再生取込、1・2・4・8 倍）',
    'vttplay.label': '再生取込', 'vttplay.progress': '{label}: {i} / {n}（{speed} 倍）', 'vttplay.paused': '一時停止中',
    'vttplay.done': '{label}: 完了 {i} / {n}', 'vttplay.cancelled': '{label}: 中止 {i} / {n}（取り込み済みの発話は残ります）',
    'vttplay.pause': '一時停止', 'vttplay.resume': '再開', 'vttplay.cancel': '中止', 'vttplay.controls': '再生取込の操作',
  },
  en: {
    'import.method.label': 'Import mode', 'import.method.batch': 'All at once', 'import.method.playback': 'Playback',
    'import.speed.label': 'Speed', 'import.speed.option': '{n}×', 'import.method.invalid': 'That import mode or speed is not available (all at once / playback, 1, 2, 4 or 8×)',
    'vttplay.label': 'Playback import', 'vttplay.progress': '{label}: {i} / {n} ({speed}×)', 'vttplay.paused': 'paused',
    'vttplay.done': '{label}: finished {i} / {n}', 'vttplay.cancelled': '{label}: stopped {i} / {n} (imported utterances are kept)',
    'vttplay.pause': 'Pause', 'vttplay.resume': 'Resume', 'vttplay.cancel': 'Stop', 'vttplay.controls': 'Playback import controls',
  },
};

export function vttPlaybackModule(ctx, live) {
  const { api } = ctx;
  const t = ctx.t;
  ctx.i18n.addStrings(STRINGS);
  const sched = ctx.options.scheduler ?? {
    setTimeout: (f, ms) => { const h = globalThis.setTimeout(f, ms); h?.unref?.(); return h; },
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };

  let pref = { ...DEFAULT_IMPORT };
  { const raw = readJson(ctx.storage, IMPORT_METHOD_KEY); if (raw && IMPORT_METHODS.includes(raw.method) && PLAYBACK_SPEEDS.includes(raw.speed)) pref = { method: raw.method, speed: raw.speed }; }
  let play = null; // { texts, ats, offsets, next, total, speed, state:'playing'|'paused', timer }
  let last = null; // 終わった再生取込 { state:'done'|'cancelled', delivered, total, speed }

  api.getImportMethod = () => ({
    method: pref.method, speed: pref.speed, label: t('import.method.label'), speedLabel: t('import.speed.label'),
    methods: IMPORT_METHODS.map((value) => ({ value, label: t(`import.method.${value}`) })),
    speeds: PLAYBACK_SPEEDS.map((value) => ({ value, label: t('import.speed.option').replace('{n}', String(value)) })),
  });
  api.setImportMethod = (patch = {}) => {
    const method = patch.method ?? pref.method;
    const speed = patch.speed == null ? pref.speed : (typeof patch.speed === 'string' && patch.speed.trim() !== '' ? Number(patch.speed) : patch.speed);
    if (!IMPORT_METHODS.includes(method) || !PLAYBACK_SPEEDS.includes(speed)) {
      ctx.change((s) => { s.message = { key: 'import.method.invalid', text: t('import.method.invalid') }; });
      return { ok: false, reason: 'invalid' };
    }
    pref = { method, speed };
    writeJson(ctx.storage, IMPORT_METHOD_KEY, pref);
    if (play) play.speed = speed; // 再生中に変えたら、次の cue からその速さ
    ctx.emit('change', api);
    return { ok: true };
  };

  const stopTimer = () => { if (play?.timer != null) { sched.clearTimeout(play.timer); play.timer = null; } };
  const finish = (state) => {
    stopTimer();
    last = { state, delivered: play.next, total: play.total, speed: play.speed };
    play = null;
    live.end('playback');
    ctx.emit('change', api);
  };
  const deliver = () => {
    const i = play.next;
    const n = ctx.addUtterances([play.texts[i]], { ats: [play.ats[i]], anyState: true, hold: true });
    if (n) ctx.transcript?.addFinals([play.texts[i]]);
    play.next = i + 1;
    if (play.next >= play.total) { finish('done'); return; }
    ctx.emit('change', api);
    schedule();
  };
  const schedule = () => {
    stopTimer();
    const i = play.next;
    const wait = Math.max(0, (play.offsets[i] - play.offsets[i - 1]) / play.speed);
    play.timer = sched.setTimeout(() => { if (play) { play.timer = null; deliver(); } }, wait);
  };

  api.getVttPlayback = () => {
    const cur = play ?? last;
    const state = play ? play.state : (last?.state ?? 'idle');
    return {
      state, delivered: cur?.next ?? cur?.delivered ?? 0, total: cur?.total ?? 0, speed: cur?.speed ?? pref.speed,
      canPause: state === 'playing', canResume: state === 'paused', canCancel: state === 'playing' || state === 'paused',
      text: statusText(), labels: { pause: t('vttplay.pause'), resume: t('vttplay.resume'), cancel: t('vttplay.cancel'), group: t('vttplay.controls') },
    };
  };
  function statusText() {
    const label = t('vttplay.label');
    const fmt = (key, o) => t(key).replace('{label}', label).replace('{i}', String(o.i)).replace('{n}', String(o.n)).replace('{speed}', String(o.speed));
    if (play) return fmt('vttplay.progress', { i: play.next, n: play.total, speed: play.speed }) + (play.state === 'paused' ? `・${t('vttplay.paused')}` : '');
    if (last) return fmt(`vttplay.${last.state}`, { i: last.delivered, n: last.total, speed: last.speed });
    return '';
  }
  api.pauseVttPlayback = () => {
    if (play?.state !== 'playing') return { ok: false, reason: 'not_playing' };
    stopTimer(); play.state = 'paused'; ctx.emit('change', api); return { ok: true };
  };
  api.resumeVttPlayback = () => {
    if (play?.state !== 'paused') return { ok: false, reason: 'not_paused' };
    play.state = 'playing'; schedule(); ctx.emit('change', api); return { ok: true }; // 次の cue までの待ちを数え直す
  };
  api.cancelVttPlayback = () => {
    if (!play) return { ok: false, reason: 'not_playing' };
    finish('cancelled'); return { ok: true };
  };

  // 取込の入口（importTextFile）: 「再生取込」を選んでいて .vtt のときだけ再生取込にする。それ以外（.txt・一括）は従来どおり
  const baseImport = api.importTextFile;
  api.importTextFile = async (file) => {
    if (play) { ctx.change(() => ctx.setMessage('msg.importBusy')); return { ok: false, reason: 'busy' }; }
    const isVtt = /\.vtt$/i.test(String(file?.name ?? ''));
    if (pref.method !== 'playback' || !isVtt || validateTextFile(file ?? {})) { last = null; return baseImport(file); } // 検査の失敗の表示も一括と同じ
    const cues = parseVttCues(file.text);
    if (!cues.length) { last = null; return baseImport(file); }
    const base = ctx.now();
    const offsets = cueOffsets(cues);
    last = null;
    play = { texts: cues.map((c) => c.text), offsets, ats: offsets.map((d) => base + d), next: 0, total: cues.length, speed: pref.speed, state: 'playing', timer: null };
    live.begin('playback');
    deliver(); // 最初の cue は開始の時点で届く
    return { ok: true, playback: true, total: cues.length };
  };

  // 契約 CONTRACT-LIVE-SHOW（FR-022 AC-671）の観察点: 取込の方法 'bulk'|'replay'（内部の 'batch'|'playback'）と速さ、再生取込の進み具合、操作のコマンド
  let everStarted = false;
  const baseBegin = live.begin;
  live = { ...live, begin(src) { everStarted = true; baseBegin(src); } };
  api.getVttImportMode = () => ({ mode: pref.method === 'playback' ? 'replay' : 'bulk', speed: pref.speed, speeds: [...PLAYBACK_SPEEDS] });
  api.setVttImportMode = (o) => {
    if (!o || typeof o !== 'object' || (o.mode !== 'bulk' && o.mode !== 'replay')) return { ok: false, reason: 'invalid' };
    if (o.speed !== undefined && !PLAYBACK_SPEEDS.includes(o.speed)) return { ok: false, reason: 'invalid' };
    return api.setImportMethod({ method: o.mode === 'replay' ? 'playback' : 'batch', speed: o.speed });
  };
  api.getVttReplay = () => {
    if (!everStarted) return null;
    const s = api.getVttPlayback();
    return { running: !!play, paused: play?.state === 'paused', done: s.delivered, total: s.total, text: s.text };
  };
  ctx.registerCommand('vttReplay.pause', () => api.pauseVttPlayback());
  ctx.registerCommand('vttReplay.resume', () => api.resumeVttPlayback());
  ctx.registerCommand('vttReplay.cancel', () => api.cancelVttPlayback());
  // NFR-A11Y-001: すべての操作にキー割り当て（Ctrl+Shift+F2〜F4 は未使用。Ctrl+Shift+F9 はライブの更新間隔）
  for (const [key, command] of [['F2', 'vttReplay.pause'], ['F3', 'vttReplay.resume'], ['F4', 'vttReplay.cancel']]) ctx.registerKey({ key, ctrl: true, shift: true, command });

  // 取込の状態（FR-023）: 再生取込の間と終わった後は、その進み具合を示す
  const baseStatus = api.getImportStatus;
  api.getImportStatus = () => {
    if (!play && !last) return baseStatus();
    const s = api.getVttPlayback();
    const st = play ? 'processing' : 'done';
    return {
      state: st, label: t('vttplay.label'), processed: s.delivered, total: s.total, added: play ? null : s.delivered, reason: null, nextAction: null,
      text: s.text, role: 'status', live: 'polite', inputReset: true, playback: s,
    };
  };
}
