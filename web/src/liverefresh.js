// FR-014 AC-521・AC-522／FR-022 AC-523: ライブの更新間隔（10〜15 秒の整数秒。初期値 10）とバッチ描画。契約: tests/system/CONTRACT-LIVE-EXPORT.md
// - 記録中、更新間隔ごと（scheduler.setTimeout。setInterval は使わない）に、前回の更新以降に確定した発話が 1 件以上あるときだけ、
//   図を再描画した回数（getLiveRefresh().count）を 1 増やす。発話がなかった間隔では増やさない。
// - ファイル取込（importTextFile）が成功したときは、更新間隔を待たず、取込全体を 1 回の更新として数える（記録中・準備中・停止のどれでも）。
// - 更新間隔は端末ごとにブラウザへ保存する（PARAM-098〜100）。DOM・外部通信に依存しない。
import { readJson, writeJson } from './persist.js';

export const LIVE_INTERVAL_KEY = 'grp.liveInterval';
export const LIVE_MIN_SEC = 10; // PARAM-098
export const LIVE_MAX_SEC = 15; // PARAM-099
export const LIVE_DEFAULT_SEC = 10; // PARAM-100
export const isValidLiveSec = (v) => Number.isInteger(v) && v >= LIVE_MIN_SEC && v <= LIVE_MAX_SEC;

const STRINGS = {
  ja: {
    'live.interval.label': 'ライブの更新間隔', 'live.interval.unit': '秒', 'live.interval.text': '{n} 秒（10〜15 秒）',
    'live.interval.changed': 'ライブの更新間隔を変更しました', 'live.interval.invalid': 'ライブの更新間隔は 10〜15 の整数（秒）で入力してください',
  },
  en: {
    'live.interval.label': 'Live update interval', 'live.interval.unit': 's', 'live.interval.text': '{n} s (10 to 15 s)',
    'live.interval.changed': 'Changed the live update interval', 'live.interval.invalid': 'Enter the live update interval as an integer from 10 to 15 (seconds)',
  },
};

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
  let pending = false; // 前回の更新以降に確定した発話がある
  let importing = false;
  let timer = null;
  let draft = null;

  const intervalText = () => t('live.interval.text').replace('{n}', String(sec));
  api.getLiveInterval = () => ({ sec, min: LIVE_MIN_SEC, max: LIVE_MAX_SEC, default: LIVE_DEFAULT_SEC });
  api.getLiveRefresh = () => ({ count });

  const refresh = () => { count += 1; pending = false; ctx.emit('change', api); };
  const stopTimer = () => { if (timer != null) { sched.clearTimeout(timer); timer = null; } };
  const arm = () => {
    stopTimer();
    if (state.session !== 'recording') return;
    timer = sched.setTimeout(() => { timer = null; if (pending && state.session === 'recording') refresh(); arm(); }, sec * 1000);
  };

  ctx.on('utterance', () => { if (!importing && state.session === 'recording') pending = true; });
  ctx.on('session:start', () => { pending = false; arm(); });
  ctx.on('session:resume', arm);
  ctx.on('session:pause', stopTimer);
  ctx.on('session:stop', () => { stopTimer(); pending = false; });
  if (state.session === 'recording') arm();

  // バッチ描画（AC-523）: 取込成功時に 1 回だけ数える。取込中の個々の発話は定期更新の対象にしない
  const baseImport = api.importTextFile;
  api.importTextFile = async (file) => {
    importing = true;
    let r;
    try { r = await baseImport(file); } finally { importing = false; }
    if (r?.ok) { count += 1; ctx.emit('change', api); }
    return r;
  };

  // ---- 更新間隔の変更（AC-522）: 10〜15 の整数だけ。範囲外・整数でない値は理由を示して直前の値を保つ ----
  let msgKey = null;
  const say = (key, text) => { msgKey = key; ctx.change((s) => { s.message = { key, text }; }); };
  ctx.on('lang', () => { if (msgKey && state.message?.key === msgKey) ctx.change((s) => { s.message.text = t(msgKey) + (msgKey === 'live.interval.changed' ? `: ${intervalText()}` : ''); }); });
  api.setLiveInterval = (value) => {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (!isValidLiveSec(n)) { say('live.interval.invalid', t('live.interval.invalid')); return { ok: false, reason: 'range' }; }
    draft = null;
    if (n !== sec) { sec = n; writeJson(ctx.storage, LIVE_INTERVAL_KEY, { intervalSec: sec }); if (timer != null) arm(); }
    say('live.interval.changed', `${t('live.interval.changed')}: ${intervalText()}`);
    return { ok: true };
  };

  // ---- ［設定］画面の項目 ----
  const FIELD_ID = 'live.interval';
  const baseDialog = api.getSettingsDialog;
  const field = () => ({
    id: FIELD_ID, label: t('live.interval.label'), value: sec, text: intervalText(), min: LIVE_MIN_SEC, max: LIVE_MAX_SEC, step: 1,
    role: 'spinbutton', focusable: true, input: { type: 'number', value: draft ?? String(sec), inputmode: 'numeric' }, unit: t('live.interval.unit'),
  });
  api.getSettingsDialog = () => { const d = baseDialog(); return d ? { ...d, fields: [...d.fields, field()] } : null; };
  const baseView = api.getSettingsView;
  api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, { id: FIELD_ID, visible: true }] }; };
  const baseDraft = api.setSettingsFieldDraft;
  api.setSettingsFieldDraft = (id, text) => {
    if (id !== FIELD_ID) return baseDraft ? baseDraft(id, text) : { ok: false, reason: 'not_found' };
    draft = String(text ?? ''); ctx.emit('change', api); return { ok: true };
  };
  ctx.on('change', () => { if (!baseDialog()) draft = null; });
}
