// FR-098 議題ごとの持ち時間のタイマー（契約: tests/system/CONTRACT-TIMER.md）。DOM に依存しない。
// 状態: 待機（idle）→ 進行中（running）→ 一時停止（paused）→ 終了（finished）。タイマーの状態は保存せず、復元後は常に待機（AC-569）。
// 残り時間は options.now() の差で求める（AC-569: 非表示・最小化でもずれない）。scheduler.setTimeout は表示の更新の契機で、1 秒ごと（setInterval は使わない）。
// 議題を切り替えると進行中のシーンが確定し、次の発話から新しいシーンになる。切替の時点（agendaBoundaries）は保存する（AC-571）。
// 通知音と点滅は、ミュートでは鳴らさず、reduced motion では止めて文字だけで示す（AC-570）。色だけに頼らない（記号と文字を併用）。
import { DEFAULT_MINUTES } from './meeting.js';

export const WARN_SEC = 60; // PARAM-125: 「まもなく終了」を示す残り時間（秒）
export const TICK_MS = 1000;

const pad2 = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
// 秒 → mm:ss（分は 99 を超えてもそのまま）
export const formatClock = (sec) => { const s = Math.max(0, Math.floor(sec)); return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`; };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function parseBoundaries(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((b) => b && typeof b === 'object' && typeof b.agendaId === 'string' && typeof b.at === 'number' && (b.sceneId == null || typeof b.sceneId === 'string'))
    .slice(0, 500).map((b) => ({ sceneId: b.sceneId ?? null, agendaId: b.agendaId, at: b.at }));
}

export function agendaTimerModule(ctx) {
  const { state, api } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'timer.title': '議題タイマー', 'timer.state': '状態', 'timer.current': '現在の議題', 'timer.remaining': '残り時間', 'timer.next': '次の議題', 'timer.noNext': '次の議題なし',
      'timer.state.idle': '待機', 'timer.state.running': '進行中', 'timer.state.paused': '一時停止', 'timer.state.finished': '終了',
      'timer.warning': 'まもなく終了', 'timer.expired': '時間切れ', 'timer.overtime': '超過', 'timer.sceneAgenda': '議題',
      'timer.noAgenda': '議題が 0 件のためタイマーを開始できません。先に議題を登録してください', 'timer.hintIdle': 'タイマーを開始できます（議題の登録済み）',
      'timer.err.running': 'すでに進行中です', 'timer.err.notRunning': '進行中の議題がありません', 'timer.err.notPaused': '一時停止中ではありません', 'timer.err.last': '最後の議題のため、次の議題はありません',
      'msg.timerStarted': '議題タイマーを開始しました', 'msg.timerPaused': '議題タイマーを一時停止しました', 'msg.timerResumed': '議題タイマーを再開しました', 'msg.timerNext': '次の議題へ切り替えました', 'msg.timerStopped': '議題タイマーを終了しました',
      'cmd.timer.start': '議題タイマーを開始', 'cmd.timer.pause': '議題タイマーを一時停止', 'cmd.timer.resume': '議題タイマーを再開', 'cmd.timer.next': '次の議題へ切り替え', 'cmd.timer.stop': '議題タイマーを終了',
      'timer.btn.start': '開始', 'timer.btn.pause': '一時停止', 'timer.btn.resume': '再開', 'timer.btn.next': '次の議題へ', 'timer.btn.stop': '終了',
    },
    en: {
      'timer.title': 'Agenda timer', 'timer.state': 'State', 'timer.current': 'Current item', 'timer.remaining': 'Time left', 'timer.next': 'Next item', 'timer.noNext': 'No next item',
      'timer.state.idle': 'Idle', 'timer.state.running': 'Running', 'timer.state.paused': 'Paused', 'timer.state.finished': 'Finished',
      'timer.warning': 'Ending soon', 'timer.expired': 'Time is up', 'timer.overtime': 'Over by', 'timer.sceneAgenda': 'Agenda',
      'timer.noAgenda': 'The timer cannot start because there are no agenda items. Register the agenda first', 'timer.hintIdle': 'The timer can start (an agenda is registered)',
      'timer.err.running': 'The timer is already running', 'timer.err.notRunning': 'There is no running agenda item', 'timer.err.notPaused': 'The timer is not paused', 'timer.err.last': 'This is the last item; there is no next item',
      'msg.timerStarted': 'The agenda timer started', 'msg.timerPaused': 'The agenda timer was paused', 'msg.timerResumed': 'The agenda timer resumed', 'msg.timerNext': 'Switched to the next agenda item', 'msg.timerStopped': 'The agenda timer ended',
      'cmd.timer.start': 'Start the agenda timer', 'cmd.timer.pause': 'Pause the agenda timer', 'cmd.timer.resume': 'Resume the agenda timer', 'cmd.timer.next': 'Switch to the next agenda item', 'cmd.timer.stop': 'End the agenda timer',
      'timer.btn.start': 'Start', 'timer.btn.pause': 'Pause', 'timer.btn.resume': 'Resume', 'timer.btn.next': 'Next item', 'timer.btn.stop': 'End',
    },
  });
  const t = ctx.t;
  const now = ctx.now;
  const sched = ctx.options.scheduler ?? { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };

  state.agendaBoundaries = [];
  // 進行の状態（保存しない）
  let tm = { state: 'idle', index: 0, remainingMs: 0, resumedAt: null, warned: false, expiredNotified: false };
  let timerId = null;

  const agenda = () => api.getMeetingContext?.().agenda ?? [];
  const minutesOf = (item) => (api.agendaMinutes ? api.agendaMinutes(item) : (item?.minutes ?? DEFAULT_MINUTES));
  const isMuted = () => {
    const m = ctx.options.mute;
    return (typeof m === 'function' ? m() === true : m === true) || api.getRpgAudio?.().muted === true;
  };
  const remainingMs = () => (tm.state === 'running' && tm.resumedAt != null ? tm.remainingMs - (now() - tm.resumedAt) : tm.remainingMs);
  const clearTick = () => { if (timerId != null) { sched.clearTimeout(timerId); timerId = null; } };
  const refresh = () => ctx.emit('change', api); // 見た目の更新（保存はしない）

  function alertIfNeeded() {
    if (tm.state !== 'running') return;
    const ms = remainingMs();
    const sec = Math.ceil(ms / 1000);
    const play = (kind) => { if (!isMuted()) { try { ctx.options.timerSound?.(kind); } catch { /* 音が使えなくても動作は続ける */ } } };
    if (ms <= 0) { if (!tm.expiredNotified) { tm.expiredNotified = true; tm.warned = true; play('expired'); } }
    else if (sec <= WARN_SEC && !tm.warned) { tm.warned = true; play('warning'); }
  }
  function tick() {
    timerId = null;
    if (tm.state !== 'running') return;
    alertIfNeeded();
    refresh();
    timerId = sched.setTimeout(tick, TICK_MS);
  }
  const armTick = () => { clearTick(); if (tm.state === 'running') timerId = sched.setTimeout(tick, TICK_MS); };

  const fail = (reason, msgKey) => { if (msgKey) ctx.change(() => ctx.setMessage(msgKey)); return { ok: false, reason }; };
  const loadItem = (i) => {
    const item = agenda()[i];
    tm.index = i; tm.remainingMs = minutesOf(item) * 60000; tm.resumedAt = tm.state === 'running' ? now() : null; tm.warned = false; tm.expiredNotified = false;
  };

  api.getAgendaTimer = () => {
    const list = agenda();
    const idle = tm.state === 'idle';
    const cur = idle ? null : list[tm.index] ?? null;
    const ms = idle ? 0 : remainingMs();
    const sec = Math.max(0, Math.ceil(ms / 1000));
    const over = idle ? 0 : Math.max(0, Math.floor(-ms / 1000));
    const warning = tm.state === 'running' && ms > 0 && sec <= WARN_SEC;
    const expired = (tm.state === 'running' || tm.state === 'paused') && ms <= 0 && !idle;
    return {
      state: tm.state, currentName: cur ? cur.name : null,
      remainingSec: sec, remainingText: formatClock(sec),
      nextName: idle ? null : (list[tm.index + 1]?.name ?? t('timer.noNext')),
      overtimeSec: over, warning, expired, silent: isMuted(),
    };
  };

  api.renderAgendaTimer = () => {
    const list = agenda(); const tm1 = api.getAgendaTimer();
    if (tm1.state === 'idle' && !list.length) return '';
    const e = esc;
    const btn = (cmd, enabled) => `<button type="button" data-command="${cmd}"${enabled ? '' : ' disabled'}>${e(t(`timer.btn.${cmd.slice(6)}`))}</button>`;
    const rows = tm1.state === 'idle'
      ? `<p data-role="hint">${e(t('timer.hintIdle'))}</p>`
      : `<dl><dt>${e(t('timer.current'))}</dt><dd data-role="current">${e(tm1.currentName ?? '')}</dd>`
        + `<dt>${e(t('timer.remaining'))}</dt><dd data-role="remaining" aria-live="off">${e(tm1.remainingText)}</dd>`
        + `<dt>${e(t('timer.next'))}</dt><dd data-role="next">${e(tm1.nextName ?? '')}</dd></dl>`;
    // 色だけに頼らない: 記号（⚠ 枠つき・■）と文字。点滅（アニメーション）は reduced motion では止めて文字だけ
    const motion = ctx.env.reducedMotion ? 'none' : 'blink';
    const warn = tm1.warning ? `<p class="timer-badge" data-role="warning" data-shape="frame"><span aria-hidden="true">⚠</span> ${e(t('timer.warning'))}</p>` : '';
    const exp = tm1.expired ? `<p class="timer-badge timer-expired" data-role="expired" data-shape="frame" data-motion="${motion}"><span aria-hidden="true">■</span> ${e(t('timer.expired'))} （${e(t('timer.overtime'))} ${e(formatClock(tm1.overtimeSec))}）</p>` : '';
    const running = tm1.state === 'running'; const paused = tm1.state === 'paused';
    const ctl = `<div role="group" aria-label="${e(t('timer.title'))}">${btn('timer.start', tm1.state === 'idle' || tm1.state === 'finished')}${btn('timer.pause', running)}${btn('timer.resume', paused)}${btn('timer.next', (running || paused) && tm.index + 1 < list.length)}${btn('timer.stop', running || paused)}</div>`;
    return `<section class="agenda-timer" aria-label="${e(t('timer.title'))}" data-state="${tm1.state}"><h2>${e(t('timer.title'))}</h2>`
      + `<p data-role="state">${e(t('timer.state'))}: ${e(t(`timer.state.${tm1.state}`))}</p>${rows}${warn}${exp}${ctl}</section>`;
  };

  // ---- コマンド ----
  const start = () => {
    if (!agenda().length) return fail('no_agenda', 'timer.noAgenda');
    if (tm.state === 'running' || tm.state === 'paused') return fail('already_started', 'timer.err.running');
    tm = { state: 'running', index: 0, remainingMs: 0, resumedAt: now(), warned: false, expiredNotified: false };
    loadItem(0);
    armTick();
    ctx.change(() => ctx.setMessage('msg.timerStarted'));
    return { ok: true };
  };
  const pause = () => {
    if (tm.state !== 'running') return fail('not_running', 'timer.err.notRunning');
    tm.remainingMs = remainingMs(); tm.resumedAt = null; tm.state = 'paused'; clearTick();
    ctx.change(() => ctx.setMessage('msg.timerPaused'));
    return { ok: true };
  };
  const resume = () => {
    if (tm.state !== 'paused') return fail('not_paused', 'timer.err.notPaused');
    tm.state = 'running'; tm.resumedAt = now(); armTick();
    ctx.change(() => ctx.setMessage('msg.timerResumed'));
    return { ok: true };
  };
  const next = () => {
    if (tm.state !== 'running' && tm.state !== 'paused') return fail('not_running', 'timer.err.notRunning');
    const list = agenda();
    if (tm.index + 1 >= list.length) return fail('last', 'timer.err.last');
    const from = list[tm.index];
    // AC-571: 進行中のシーンを確定し、次の発話から新しいシーンにする。切替の時点を記録する（発話列は変えない）
    const sceneId = ctx.breakScene();
    const at = now();
    ctx.change((s) => {
      s.agendaBoundaries.push({ sceneId, agendaId: from.id, at });
      loadItem(tm.index + 1);
      ctx.setMessage('msg.timerNext');
    });
    armTick();
    return { ok: true };
  };
  const stop = () => {
    if (tm.state !== 'running' && tm.state !== 'paused') return fail('not_running', 'timer.err.notRunning');
    tm.remainingMs = remainingMs(); tm.resumedAt = null; tm.state = 'finished'; clearTick();
    ctx.change(() => ctx.setMessage('msg.timerStopped'));
    return { ok: true };
  };
  for (const [name, fn] of Object.entries({ 'timer.start': start, 'timer.pause': pause, 'timer.resume': resume, 'timer.next': next, 'timer.stop': stop })) ctx.registerCommand(name, fn);
  // NFR-A11Y-001: キーボード（Ctrl+Alt+Shift+F1〜F5）
  [['F1', 'timer.start'], ['F2', 'timer.pause'], ['F3', 'timer.resume'], ['F4', 'timer.next'], ['F5', 'timer.stop']]
    .forEach(([key, command]) => ctx.registerKey({ key, ctrl: true, alt: true, shift: true, command }));

  // ---- シーンと議題の対応（AC-571）: 切替の時点より前のシーンは前の議題、後のシーンは次の議題 ----
  api.getSceneAgendas = () => {
    const list = agenda(); const map = new Map();
    if (!list.length) return map;
    let cur = 0;
    for (const sc of state.scenes) {
      map.set(sc.id, { id: list[Math.min(cur, list.length - 1)].id, name: list[Math.min(cur, list.length - 1)].name });
      for (const b of state.agendaBoundaries) {
        if (b.sceneId !== sc.id) continue;
        const k = list.findIndex((a) => a.id === b.agendaId);
        cur = k >= 0 ? k + 1 : cur + 1;
      }
    }
    return map;
  };
  // 進行中でも切替の記録があるときだけ、シーンに議題名を付ける（議題を使っていない図は従来どおり）
  api.getSceneAgenda = (sceneId) => {
    if (tm.state === 'idle' && !state.agendaBoundaries.length) return null;
    return api.getSceneAgendas().get(sceneId)?.name ?? null;
  };
  // トピック分類が使う境（シーン ID の集合。このシーンの後ろでトピックを区切る）
  api.getAgendaBreaks = () => new Set(state.agendaBoundaries.filter((b) => b.sceneId && state.scenes.some((s) => s.id === b.sceneId)).map((b) => b.sceneId));

  const resetTimer = () => { clearTick(); tm = { state: 'idle', index: 0, remainingMs: 0, resumedAt: null, warned: false, expiredNotified: false }; };
  ctx.registerPersist('agendaBoundaries', {
    export: () => (state.agendaBoundaries.length ? state.agendaBoundaries.map((b) => ({ ...b })) : undefined),
    import: (v) => { resetTimer(); state.agendaBoundaries = parseBoundaries(v); },
    reset: () => { resetTimer(); state.agendaBoundaries = []; },
  });
}
