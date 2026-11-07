// FR-014 AC-521・AC-522・AC-053／FR-022 AC-523・AC-671: ライブの更新間隔（PARAM-098〜100。5〜60 秒の整数、初期値 10）での描き足し。
// 契約: tests/system/CONTRACT-LIVE-EXPORT.md
// - ライブ（音声入力の記録中と、.vtt の再生取込の間）の確定結果は、発話としてはすぐ記録・保存されるが（app.js の opts.hold）、
//   図（シーン・要点）への取り込みは更新間隔ごと（scheduler.setTimeout。setInterval は使わない）に 1 回だけまとめて行う（ctx.flushHeld）。
//   その時点で取り込む発話が 1 件以上あるときだけ getLiveRefresh().count を 1 増やし、'live:tick' を通知する。発話がなかった間隔では更新しない。
// - 手入力・ファイルの一括取込は間隔を待たない（AC-054・AC-523）。一括取込の成功は取込全体を 1 回の更新として数える。
// - 一時停止・停止のときは、それまでに届いていたライブの発話をその時点で取り込む（再生取込が続いていれば、その間隔に任せる）。
// - 更新間隔は端末ごとにブラウザへ保存する（データの初期化・セッションファイルの対象外）。DOM・外部通信に依存しない。
import { readJson, writeJson } from './persist.js';

export const LIVE_INTERVAL_KEY = 'grp.liveInterval';
export const LIVE_MIN_SEC = 5; // PARAM-098
export const LIVE_MAX_SEC = 60; // PARAM-099
export const LIVE_DEFAULT_SEC = 10; // PARAM-100
export const isValidLiveSec = (v) => Number.isInteger(v) && v >= LIVE_MIN_SEC && v <= LIVE_MAX_SEC;

// 入力（数値・文字列）を検査する。{ ok:true, sec } か { ok:false, reason:'empty'|'integer'|'range' }（AC-522: 理由を示す）
export function parseLiveSec(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return { ok: false, reason: 'empty' };
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, reason: 'integer' };
  if (!isValidLiveSec(n)) return { ok: false, reason: 'range' };
  return { ok: true, sec: n };
}

const STRINGS = {
  ja: {
    'live.interval.label': 'ライブ更新', 'live.interval.unit': '秒', 'live.interval.text': '{n} 秒（{min}〜{max} 秒）',
    'live.interval.changed': 'ライブの更新間隔を変更しました',
    'live.interval.invalid.empty': 'ライブの更新間隔が空です。{min}〜{max} の整数（秒）を入力してください',
    'live.interval.invalid.integer': 'ライブの更新間隔は整数（秒）で入力してください（{min}〜{max}）',
    'live.interval.invalid.range': 'ライブの更新間隔は {min}〜{max} 秒の範囲で入力してください',
  },
  en: {
    'live.interval.label': 'Live update', 'live.interval.unit': 's', 'live.interval.text': '{n} s ({min} to {max} s)',
    'live.interval.changed': 'Changed the live update interval',
    'live.interval.invalid.empty': 'The live update interval is empty. Enter an integer from {min} to {max} (seconds)',
    'live.interval.invalid.integer': 'Enter the live update interval as a whole number of seconds ({min} to {max})',
    'live.interval.invalid.range': 'Enter a live update interval from {min} to {max} seconds',
  },
};
const fill = (s, n) => s.replace('{n}', String(n)).replace('{min}', String(LIVE_MIN_SEC)).replace('{max}', String(LIVE_MAX_SEC));

export function liveRefreshModule(ctx) {
  const { api, state } = ctx;
  const t = ctx.t;
  ctx.i18n.addStrings(STRINGS);
  const sched = ctx.options.scheduler ?? {
    setTimeout: (f, ms) => { const h = globalThis.setTimeout(f, ms); h?.unref?.(); return h; },
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };

  let sec = LIVE_DEFAULT_SEC;
  { const raw = readJson(ctx.storage, LIVE_INTERVAL_KEY); if (raw && isValidLiveSec(raw.intervalSec)) sec = raw.intervalSec; }
  let count = 0;
  let timer = null;
  let draft = null;
  let focused = false;

  const intervalText = () => fill(t('live.interval.text'), sec);
  const live = () => state.session === 'recording' || ctx.heldCount() > 0;
  api.getLiveInterval = () => ({ sec, min: LIVE_MIN_SEC, max: LIVE_MAX_SEC, default: LIVE_DEFAULT_SEC });
  api.getLiveRefresh = () => ({ count, held: ctx.heldCount() });
  // FR-022 AC-523: a complete batch (never a partial response or cancellation) is one application.
  ctx.on('batch:done', () => { count += 1; });

  // 1 回の描き足し: たまった発話をまとめて取り込む。なければ何もしない（描画を更新しない）
  // ctx.liveRefreshing: いま更新間隔ごとの描き足しの最中か（FR-115 のショーは、この間に加わった・動いた要素だけを演出する）
  const tick = () => {
    if (!ctx.heldCount()) return 0;
    ctx.liveRefreshing = true;
    try {
      const n = ctx.flushHeld();
      if (!n) return 0;
      count += 1;
      ctx.emit('live:tick', { count: n, refresh: count }); // FR-115 などが 1 回の描き足しを 1 つの単位として扱える
      ctx.emit('change', api);
      return n;
    } finally { ctx.liveRefreshing = false; }
  };
  const stopTimer = () => { if (timer != null) { sched.clearTimeout(timer); timer = null; } };
  const arm = () => {
    stopTimer();
    if (!live()) return;
    timer = sched.setTimeout(() => { timer = null; tick(); arm(); }, sec * 1000);
  };
  // 記録中の間（または待ちの発話がある間）だけ更新間隔のタイマーを動かす

  ctx.on('utterance:held', () => { if (timer == null) arm(); });
  ctx.on('session:start', arm);
  ctx.on('session:resume', arm);
  const leave = () => { stopTimer(); tick(); };
  ctx.on('session:pause', leave);
  ctx.on('session:stop', leave);
  if (live()) arm();
  // NFR-BG-001 AC-063: 画面に戻ったとき（可視になった時点）は、たまっていた発話をすぐ描き足して図を最新にする
  const vis = ctx.options.visibility ?? null;
  const isHidden = () => Boolean(vis ? vis.hidden : globalThis.document?.hidden);
  const onVisible = () => { if (!isHidden() && ctx.heldCount() > 0) { tick(); if (timer == null) arm(); } };
  if (vis) { const prev = vis.onchange; vis.onchange = (...a) => { if (typeof prev === 'function') prev(...a); onVisible(); }; }
  else globalThis.document?.addEventListener?.('visibilitychange', onVisible);

  // ファイル取込（.txt・.vtt）は図を更新しない（FR-014 AC-054・AC-523。依頼 2026-11-06）。図はバッチモード（FR-118）で描く。

  // ---- 更新間隔の変更（AC-522）: 5〜60 の整数だけ。範囲外・整数でない・空の値は理由を示して直前の値を保つ ----
  let msgKey = null;
  const msgText = (key) => (key === 'live.interval.changed' ? `${t(key)}: ${intervalText()}` : fill(t(key), sec));
  const say = (key) => { msgKey = key; ctx.change((s) => { s.message = { key, text: msgText(key) }; }); };
  ctx.on('lang', () => { if (msgKey && state.message?.key === msgKey) ctx.change((s) => { s.message.text = msgText(msgKey); }); });
  api.setLiveInterval = (value) => {
    const p = parseLiveSec(value);
    if (!p.ok) { say(`live.interval.invalid.${p.reason}`); return { ok: false, reason: p.reason }; }
    draft = null;
    if (p.sec !== sec) { sec = p.sec; writeJson(ctx.storage, LIVE_INTERVAL_KEY, { intervalSec: sec }); }
    if (timer != null) arm(); // 設定した時点から数え直す（同じ値を設定し直したときも。次の更新の時点は設定の T 秒後。AC-521）
    say('live.interval.changed');
    return { ok: true };
  };
  const step = (dir) => {
    const next = sec + (dir > 0 ? 1 : -1);
    if (!isValidLiveSec(next)) { say('live.interval.invalid.range'); return { ok: false, reason: 'range' }; }
    return api.setLiveInterval(next);
  };

  // ---- ［設定］画面の項目・コマンドの検索（settings.liveInterval）・キーボードだけの操作 ----
  const FIELD_ID = 'live.interval';
  const baseDialog = api.getSettingsDialog;
  const dialogOpen = () => Boolean(baseDialog());
  const field = () => ({
    id: FIELD_ID, label: t('live.interval.label'), value: sec, text: intervalText(), min: LIVE_MIN_SEC, max: LIVE_MAX_SEC, step: 1,
    role: 'spinbutton', focusable: true, input: { type: 'number', value: draft ?? String(sec), inputmode: 'numeric' }, unit: t('live.interval.unit'),
  });
  api.getSettingsDialog = () => {
    const d = baseDialog();
    return d ? { ...d, fields: [...d.fields, field()], focusedField: focused ? FIELD_ID : (d.focusedField ?? null) } : null;
  };
  const baseView = api.getSettingsView;
  api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, { id: FIELD_ID, visible: true }] }; };
  const baseFocus = api.focusSettingsField;
  api.focusSettingsField = (id) => {
    if (id === FIELD_ID) { if (!dialogOpen()) return false; baseFocus?.(null); focused = true; ctx.emit('change', api); return true; }
    focused = false; return baseFocus ? baseFocus(id) : false;
  };
  const baseDraft = api.setSettingsFieldDraft;
  api.setSettingsFieldDraft = (id, text) => {
    if (id !== FIELD_ID) return baseDraft ? baseDraft(id, text) : { ok: false, reason: 'not_found' };
    draft = String(text ?? ''); ctx.emit('change', api); return { ok: true };
  };
  const baseStep = api.settingsFieldStep;
  api.settingsFieldStep = (id, dir) => (id === FIELD_ID ? step(dir) : (baseStep ? baseStep(id, dir) : { ok: false, reason: 'not_found' }));
  ctx.on('change', () => { if (!dialogOpen()) { focused = false; draft = null; } });
  ctx.registerCommand('settings.liveInterval', () => {
    api.commands['settings.open']();
    api.focusSettingsField(FIELD_ID);
  });
  ctx.registerKey({ key: 'F9', ctrl: true, shift: true, command: 'settings.liveInterval' });
  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    const k = String(ev?.key);
    const plain = !ev?.ctrlKey && !ev?.altKey && !ev?.shiftKey;
    if (focused && dialogOpen() && plain) {
      if (k === 'Enter') { api.setLiveInterval(draft ?? sec); return 'settings.live.commit'; }
      if (k === 'ArrowUp' || k === 'ArrowDown') { step(k === 'ArrowUp' ? 1 : -1); return 'settings.live.step'; }
    }
    return baseKey(ev);
  };
}
