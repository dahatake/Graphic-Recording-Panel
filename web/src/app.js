// アプリの組立（契約: tests/system/CONTRACT.md）。DOM・グローバルに依存せず Node から import できる。
// 拡張点（後続の機能は、ここを書き換えずに options.modules か app.use で足す）:
//   module = (ctx) => void | Promise<void>
//   ctx.registerCommand(name, fn)   コマンド（ボタン・キーボード共通。app.commands[name]）
//   ctx.registerKey({key,alt,shift,ctrl,command})  キー割り当て
//   ctx.registerPanelRenderer(id, (host, ctx) => void)  パネルの描画（ui.js が呼ぶ）
//   ctx.api                          app の公開面（機能が追加のメソッドを生やす）
//   ctx.change(fn) / ctx.state       状態の変更（自動保存・再描画の通知つき）
//   ctx.on(event, fn) / ctx.emit     'session:start|pause|resume|stop' 'utterance' 'utterance:held' 'live:tick' 'lang' など
//   ctx.i18n.addStrings({ja,en})     UI 文言
//   ctx.addUtterance(text, opts)     発話の追加（記録中のみ。音声・ファイル取込もここを通す。opts.hold はライブの描き足し待ち。ctx.flushHeld で取り込む）

import { createI18n } from './i18n.js';
import * as L from './layout.js';
import { KEYMAP, matchKey } from './keymap.js';
import { renderOutline, escapeHtml } from './outline.js';
import { newScene, appendPoints, extractPoints } from './scenes.js';
import * as P from './persist.js';
import { diagramModule, classifyPoint, kindLabelOf } from './diagram.js';
import { inputModule } from './input.js';
import { editModule } from './edit.js';
import { exportModule } from './export.js';
import { view3DModule } from './view3d.js';
import { speechModule } from './speech.js';
import { transcriptModule } from './transcript.js';
import { commandBarModule } from './commandbar.js';
import { arrangeModule } from './arrange.js';
import { sessionModule } from './session.js';
import { popupModule } from './popup.js';
import { viewStateModule } from './viewstate.js';
import { previewModule } from './preview.js';
import { topicsModule } from './topics.js';
import { settingsModule } from './settings.js';
import { stylePickerModule } from './stylepicker.js';
import { autoLayoutModule } from './autolayout.js';
import { layoutKindsModule } from './layoutkinds.js';
import { workshopModule } from './workshop.js';
import { boardModule } from './board.js';
import { rpgModule } from './rpg.js';
import { rpgAudioModule } from './rpgaudio.js';
import { llmModule } from './llm.js';
import { llmDrawModule } from './llmdraw.js';
import { relayoutModule } from './relayout.js';
import { liveRefreshModule } from './liverefresh.js';
import { budgetModule } from './budget.js';
import { presentExportModule } from './presentexport.js';
import { speechSettingsModule } from './speechsettings.js';
import { stylePresetModule } from './presetdiagram.js';
import { imagePromptModule } from './imageprompt.js';
import { apiKeysModule } from './apikeys.js';
import { ribbonSettingsModule } from './ribbonsettings.js';
import { copilotKeysModule } from './copilotkeys.js';
import { glossaryModule, emptyGlossary } from './glossary.js';
import { reviewModule } from './review.js';
import { meetingModule } from './meeting.js';
import { minutesModule } from './minutes.js';
import { agendaTimerModule } from './agendatimer.js';
import { agendaViewModule } from './agendaview.js';
import { voteModule } from './vote.js';
import { editHistoryModule } from './edithistory.js';
import { facilitationModule } from './facilitation.js';
import { kindStylesModule } from './kindstyles.js';
import { visibilityModule } from './visibility.js';
import { conflictModule } from './conflict.js';
import { projectionModule } from './projection.js';
import { onboardingModule } from './onboarding.js';
import { rolesModule } from './roles.js';
import { drawModule } from './draw.js';
import { cinematicModule } from './cinematic.js';
import { showAudioModule } from './showaudio.js';
import { gaugeModule } from './gauge.js';
import { personVariantsModule } from './personvariants.js';
import { liveShowModule, liveShowBarModule } from './liveshow.js'; // FR-115: 描画の拡張（renderBaseSvg）の最も外側に置くため、並びの末尾

const GAP_MS_DEFAULT = 20_000; // PARAM-002
// NFR-PERF-003 AC-539: 自動保存の間引き（PARAM-108。0 なら変更のたびに即時保存）
export const SAVE_DELAY_MS_DEFAULT = 500;
const clone = (v) => JSON.parse(JSON.stringify(v));

// 同じ保存先を使う別のアプリ（再読込で作り直したもの）が読む前に、保留中の自動保存を確定する（ページを閉じる契機の保存と同じ扱い）。
const pendingSaves = new WeakMap(); // storage -> Set<flush>
function flushPendingSaves(storage) {
  if (!storage || (typeof storage !== 'object' && typeof storage !== 'function')) return;
  for (const flush of [...(pendingSaves.get(storage) ?? [])]) flush();
}

function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

export async function createApp(options = {}) {
  const storage = options.storage ?? defaultStorage() ?? memoryStorage();
  const now = options.now ?? (() => Date.now());
  const env = { webgl: false, reducedMotion: false, viewportWidth: 1280, ...(options.env || {}) };
  const i18n = createI18n('ja');
  const listeners = new Map();
  const panelRenderers = new Map();
  const commands = {};
  const keymap = KEYMAP.map((k) => ({ ...k }));
  const gapMs = options.sceneGapMs ?? GAP_MS_DEFAULT;

  const state = {
    lang: 'ja', session: 'preparing', utterances: [], scenes: [], selectedSceneId: null,
    viewMode: '2d', input: { draft: '' }, message: null,
    presentation: { status: 'idle', index: null, sceneId: null },
    glossary: emptyGlossary(), // FR-093: 用語集（セッションに保存）
  };
  let seq = 0;
  let breakScene = false;
  let layout = L.parseLayout(storage.getItem(L.STORAGE_KEY));
  let theme = P.readJson(storage, P.THEME_KEY);
  if (!P.THEMES.includes(theme)) theme = null; // null = OS の設定に従う

  const nextId = (prefix) => `${prefix}${++seq}`;
  const tagNew = (pts) => { for (const h of ctx.pointHooks) for (const p of pts) h(p); };

  // 復元（FR-012）: 保存済みセッションは必ず paused で始まる。
  flushPendingSaves(storage);
  const saved = P.parseSession(P.readJson(storage, P.SESSION_KEY));
  if (saved) {
    state.utterances = saved.utterances; state.scenes = saved.scenes;
    state.selectedSceneId = saved.scenes.some((s) => s.id === saved.selectedSceneId) ? saved.selectedSceneId : null;
    seq = saved.seq;
    state.displayMode = saved.displayMode; state.arrange = saved.arrange; state.topicEdits = saved.topicEdits;
    state.glossary = saved.glossary; // FR-093 AC-552
    if (saved.utterances.length || saved.scenes.length) state.session = 'paused';
  }

  const app = { commands, keymap };
  // NFR-PERF-003 AC-538: データの版数。データ（発話・シーン・要点・選択・表示の設定、機能の状態）を変える通知でだけ増える。
  // 見た目だけの変更（パネルの移動・大きさ・タブ・画面幅・図の拡大率と位置）は emitView で通知し、版数を変えない。
  // 描画・計算のメモ化は、この版数が同じなら前回の結果を使う。change の関数の実行中は null（途中の状態をキャッシュしない）。
  let dataVersion = 0;
  // NFR-PERF-003 AC-536: 選択の変更だけは、図・文字列・要点の計算結果（衝突・指標・投影・トピックなど）を作り直さなくてよいので、
  // それらのメモ化に使う dataVersion は進めず、描画のための renderVersion だけを進める（選択の印は描画し直す）
  let renderVersion = 0;
  // 文字列・テキスト一覧の版数。図の再配置（relayout.js。要点の並び・文字は変えない）の通知だけでは進めない
  let textVersion = 0;
  let selectionOnly = false;
  let mutating = 0;
  const on = (evt, fn) => { (listeners.get(evt) ?? listeners.set(evt, []).get(evt)).push(fn); return () => { listeners.set(evt, listeners.get(evt).filter((f) => f !== fn)); }; };
  const notify = (evt, payload) => { for (const fn of [...(listeners.get(evt) ?? [])]) fn(payload); };
  const emit = (evt, payload, opts) => { if (evt === 'change') { renderVersion++; if (opts?.arrangeOnly !== true) textVersion++; if (!selectionOnly) dataVersion++; } notify(evt, payload); };
  const emitView = () => notify('change', app);
  const getDataVersion = () => (mutating ? null : dataVersion);
  // NFR-PERF-003 AC-538: 重い処理（自動保存の直列化・トピック分類など）の呼び出し回数（計測用。動作には使わない）
  const callCounts = {};
  const countCall = (name) => { callCounts[name] = (callCounts[name] ?? 0) + 1; };

  // 機能ごとの保存項目（FR-097・098・005・091）。export が undefined を返す（既定の状態）ときは保存しない。
  const persistors = new Map(); // key -> { export, import, reset }
  const collectExtras = () => {
    const out = {};
    for (const [k, h] of persistors) { const v = h.export?.(); if (v !== undefined) out[k] = v; }
    return out;
  };
  function persistSession() {
    const extras = collectExtras();
    if (!state.utterances.length && !state.scenes.length && !state.glossary?.terms?.length && !Object.keys(extras).length) return;
    countCall('autosave');
    P.writeJson(storage, P.SESSION_KEY, {
      utterances: state.utterances, scenes: state.scenes, selectedSceneId: state.selectedSceneId, seq,
      displayMode: state.displayMode, arrange: state.arrange, topicEdits: state.topicEdits, glossary: state.glossary,
      ...(Object.keys(extras).length ? { extras } : {}),
    });
  }
  // NFR-PERF-003 AC-539: 自動保存は入力の処理（change の中）では行わず、未保存の印とタイマーで間引く。
  // タイマーは最初の未保存の変更で 1 度だけ掛け、延長しない（最初の変更から PARAM-108 以内に必ず保存＝max wait）。
  // 保存の時点では最新の状態を直列化するので、最後の変更までが 1 回にまとまる。
  const saveDelayMs = Number.isFinite(options.saveDelayMs) && options.saveDelayMs >= 0 ? options.saveDelayMs : SAVE_DELAY_MS_DEFAULT;
  const saveSched = options.scheduler ?? { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  let saveDirty = false;
  let saveTimer = null;
  const registerPending = () => {
    if (!storage || (typeof storage !== 'object' && typeof storage !== 'function')) return;
    (pendingSaves.get(storage) ?? pendingSaves.set(storage, new Set()).get(storage)).add(flushSave);
  };
  const unregisterPending = () => { pendingSaves.get(storage)?.delete(flushSave); };
  const clearSaveTimer = () => { if (saveTimer != null) { saveSched.clearTimeout(saveTimer); saveTimer = null; } };
  // 保存の唯一の実行点: 保留中の保存があれば直ちに行う（タイマー・非表示・ページを閉じる・再読込の契機から呼ぶ）。
  function flushSave() {
    clearSaveTimer();
    unregisterPending();
    if (!saveDirty) return false;
    saveDirty = false;
    persistSession();
    return true;
  }
  // 保留中の保存を取り消す（消去・初期化の直前の変更が、消去後に書き戻されないようにする。監査 C-1）。
  function cancelPendingSave() { clearSaveTimer(); unregisterPending(); saveDirty = false; }
  function scheduleSave() {
    saveDirty = true;
    if (saveDelayMs === 0) { flushSave(); return; }
    registerPending();
    if (saveTimer == null) saveTimer = saveSched.setTimeout(() => { saveTimer = null; flushSave(); }, saveDelayMs);
  }
  // 状態を変える唯一の入口: 自動保存の予約と再描画の通知。
  function change(fn, opts) {
    mutating++;
    const sel = opts?.selectionOnly === true;
    if (!sel) dataVersion++; // 実行中に読まれたキャッシュを無効にする
    renderVersion++;
    try { fn(state); } finally { mutating--; }
    scheduleSave();
    selectionOnly = sel;
    try { emit('change', app); } finally { selectionOnly = false; }
  }
  function setMessage(key) { state.message = key ? { key, text: i18n.t(key) } : null; }
  function saveLayout() { P.writeJson(storage, L.STORAGE_KEY, layout); }
  // パネルの配置は見た目だけの変更（AC-538: 図・文字列・トピックの再計算をしない）
  function layoutChange(ok) { if (ok) { saveLayout(); emitView(); } return ok; }

  const ctx = {
    setSeq: (n) => { seq = n; }, getSeq: () => seq, clearBreak: () => { breakScene = false; },
    options, env, state, i18n, storage, now, api: app, on, emit, emitView, getDataVersion, countCall, change, setMessage, nextId,
    flushSave: () => flushSave(), cancelPendingSave: () => cancelPendingSave(),
    t: (k) => i18n.t(k),
    registerCommand(name, fn) { commands[name] = fn; },
    registerKey(k) {
      const dup = keymap.some((e) => e.command === k.command);
      if (!dup) keymap.push({ ...k });
    },
    registerPanelRenderer(id, fn) { panelRenderers.set(id, fn); },
    // 機能ごとの保存項目（セッションの保存・ファイル・復元・初期化の対象。h: { export(), import(value), reset() }）
    registerPersist(key, h) { persistors.set(key, h); },
    exportExtras: () => collectExtras(),
    importExtras(extras) { const e = extras && typeof extras === 'object' ? extras : {}; for (const [k, h] of persistors) h.import?.(e[k]); },
    resetExtras() { for (const h of persistors.values()) h.reset?.(); },
    // 新しく加わった要点への付与（FR-091 の進行の段階など）。要点の追加（発話）のたびに、加わった要点ごとに呼ぶ
    pointHooks: [],
    // 進行中のシーンを確定し、次の発話から新しいシーンにする（session.nextScene と同じ結果。FR-098 AC-571。記録の状態は問わない）
    breakScene() {
      ctx.flushHeld(); // FR-014 AC-521: 区切りの前に届いていた発話は、区切りの前のシーンに入れる
      const cur = state.scenes[state.scenes.length - 1];
      breakScene = true;
      if (cur && cur.status === 'in_progress') { change(() => { cur.status = 'confirmed'; }); return cur.id; }
      return cur?.id ?? null;
    },
    // 発話の追加（記録中のみ）。opts.at: 受付時刻の指定、opts.ats: 発話ごとの受付時刻（件数が同じときのみ。FR-022）、opts.anyState: 記録中以外でも追加（ファイル取込のみ。FR-039）、opts.noGapSplit: 無音間隔で分割しない（ファイル取込: FR-003 AC-044）。
    addUtterance(text, opts) { return ctx.addUtterances([text], opts) > 0; },
    // 複数の発話を 1 回の状態変更（保存・再描画）で追加する。追加した件数を返す。
    // opts.hold（FR-014 AC-521）: ライブ（音声・.vtt の再生取込）の確定結果。発話としてはすぐ記録・保存し（held の印）、
    //   図（シーン・要点）への取り込みは ctx.flushHeld()（更新間隔ごと）でまとめて行う。通知は 'utterance:held'。
    //   hold なし（手入力・一括取込）は、先に届いていた held の発話を順に取り込んでから自分を取り込む（順序を保つ）。
    addUtterances(texts, opts = {}) {
      const list = texts.map((x) => String(x ?? '').trim()).filter(Boolean);
      if ((state.session !== 'recording' && !opts.anyState) || !list.length) return 0; // FR-039: ファイル取込は状態によらず可（opts.anyState）
      const at0 = opts.at ?? now();
      let flushed = [];
      change((s) => {
        if (!opts.hold) flushed = ingestHeld(s);
        for (const [i, raw] of list.entries()) {
          const at = Array.isArray(opts.ats) && opts.ats.length === list.length ? opts.ats[i] : at0;
          // FR-093 AC-550: 用語集の別表記は、発話として記録する時点で正しい表記に置き換える（置き換える前は rawText に残す。FR-024 AC-572）
          const t = ctx.applyGlossary ? (ctx.applyGlossary(raw).trim() || raw) : raw;
          const u = { id: nextId('u'), text: t, rawText: raw, receivedAt: at };
          if (opts.hold) u.held = true;
          s.utterances.push(u);
          if (!opts.hold) ingestOne(s, s.utterances.length - 1, opts.noGapSplit === true);
        }
      });
      if (opts.hold) { emit('utterance:held', list.length); return list.length; }
      for (const t of [...flushed, ...list]) emit('utterance', t);
      return list.length;
    },
    // FR-014 AC-521: 図にまだ取り込んでいないライブの発話（held）の件数と、それらをまとめて 1 回の状態変更で取り込む操作（取り込んだ件数を返す）
    heldCount: () => { let n = 0; for (let i = state.utterances.length - 1; i >= 0 && state.utterances[i].held; i--) n++; return n; },
    flushHeld() {
      if (!ctx.heldCount()) return 0;
      let done = [];
      change((s) => { done = ingestHeld(s); });
      ctx.flushing = true; // 受付ではなく図への取り込みの通知（relayout.js は無音を数え直さない）
      try { for (const t of done) emit('utterance', t); } finally { ctx.flushing = false; }
      return done.length;
    },
  };
  // 発話（state.utterances[idx]）を図のシーン・要点に取り込む。無音の間隔は直前の発話の受付時刻との差で判定する（FR-003）
  function ingestOne(s, idx, noGapSplit) {
    const u = s.utterances[idx]; const t = u.text; const uid = u.id;
    const cur = s.scenes[s.scenes.length - 1];
    const prevAt = idx > 0 ? s.utterances[idx - 1].receivedAt : null;
    const gap = !noGapSplit && prevAt != null && u.receivedAt - prevAt > gapMs;
    if (cur && cur.status === 'in_progress' && !breakScene && !gap) {
      const n0 = cur.points.length;
      appendPoints(cur, extractPoints(t), nextId, uid);
      tagNew(cur.points.slice(n0));
    } else {
      if (cur && cur.status === 'in_progress') cur.status = 'confirmed';
      const sc = newScene(t, nextId, uid);
      tagNew(sc.points);
      s.scenes.push(sc);
      if (!s.selectedSceneId) s.selectedSceneId = sc.id;
    }
    breakScene = false;
  }
  // held の発話（末尾に続く）を古い順に取り込み、印を外す。取り込んだ本文の配列を返す
  function ingestHeld(s) {
    let i = s.utterances.length;
    while (i > 0 && s.utterances[i - 1].held) i--;
    const out = [];
    for (; i < s.utterances.length; i++) { delete s.utterances[i].held; ingestOne(s, i, false); out.push(s.utterances[i].text); }
    return out;
  }

  // ---- 状態・言語 ----
  app.getState = () => clone(state);
  // NFR-PERF-003 AC-538: 画面の描画に要る小さい値だけの写し（発話・シーンの全件を複製しない）
  app.getUiState = () => ({
    lang: state.lang, session: state.session, viewMode: state.viewMode, displayMode: state.displayMode,
    selectedSceneId: state.selectedSceneId, input: { draft: state.input.draft }, message: state.message ? { ...state.message } : null,
    presentation: { ...state.presentation }, utteranceCount: state.utterances.length, sceneCount: state.scenes.length,
  });
  // シーンの読み取り専用の写し（NFR-PERF-003。データの版数ごとに 1 回だけ複製する。呼び出し側は変更しない）
  let scenesView = { ver: -1, scenes: [] };
  app.getScenesView = () => {
    const v = getDataVersion();
    if (v == null) return clone(state.scenes);
    if (scenesView.ver !== v) scenesView = { ver: v, scenes: clone(state.scenes) };
    return scenesView.scenes;
  };
  // NFR-PERF-003 AC-538: データの版数（データを変える操作でだけ増える）。同じなら描画の再生成を省ける
  app.getRenderVersion = () => renderVersion;
  app.getTextVersion = () => textVersion;
  app.getCallCounts = () => ({ ...callCounts });
  app.t = (k) => i18n.t(k);
  app.getStrings = () => i18n.getStrings();
  app.setLang = (lang) => {
    if (!i18n.setLang(lang)) return false;
    change((s) => { s.lang = lang; if (s.message) s.message.text = i18n.t(s.message.key); });
    emit('lang', lang);
    return true;
  };

  // ---- 入力 ----
  app.setDraft = (text) => { change((s) => { s.input.draft = String(text ?? ''); }); };
  app.submitDraft = () => {
    if (state.session !== 'recording') {
      change(() => setMessage('msg.notRecording'));
      return { ok: false, reason: 'not_recording' };
    }
    if (!state.input.draft.trim()) {
      change(() => setMessage('msg.empty'));
      return { ok: false, reason: 'empty' };
    }
    ctx.addUtterance(state.input.draft);
    change((s) => { s.input.draft = ''; setMessage(null); });
    return { ok: true };
  };

  // ---- シーン・表示 ----
  app.selectScene = (id) => {
    if (!state.scenes.some((s) => s.id === id)) return false;
    change((s) => { s.selectedSceneId = id; }, { selectionOnly: true });
    return true;
  };
  app.setViewMode = (mode) => {
    if (mode !== '2d' && mode !== '3d') return false;
    change((s) => { s.viewMode = mode; });
    return true;
  };
  app.renderOutline = () => {
    const html = renderOutline(state.scenes, state.selectedSceneId, i18n.t, app.getOutlineAnnotation?.() ?? null, app.getTopicOutline?.() ?? null, { label: (text, p) => kindLabelOf(classifyPoint(p ?? text), state.lang), relations: app.getOutlineRelations?.() ?? [], agendaOf: (id) => app.getSceneAgenda?.(id) ?? null, agendaLabel: i18n.t('timer.sceneAgenda'), markOf: (p) => app.getPointMark?.(p) ?? null, extra: app.getPointExtraHtml ?? null, headingExtra: app.getHeadingExtraHtml ?? null });
    // FR-036 AC-167: 各まとまり（トピック・区画・囲み）の小見出しを文字でも示す（時系列の表示のとき）
    const applied = app.getLayoutInfo?.().applied;
    const groups = applied && state.scenes.length ? (app.getDiagramLayout?.().groups ?? []) : [];
    const ws = applied ? (app.getWorkshopOutline?.() ?? '') : ''; // FR-091: ワークショップ型のラベル・問い・注記を文字でも示す
    const tmr = app.renderAgendaTimer?.() ?? '';
    const ph = `${app.renderEditHistory?.() ?? ''}`;
    const mn = app.getMinutesOutlineHtml?.() ?? ''; // FR-094 AC-557: 議事項目（決定事項ほか・候補・未定）を同じ語で一覧にも出す
    const cfo = app.getConflictOutlineHtml?.() ?? ''; // FR-099 AC-585〜588: 対立の組（候補・確定）と異論の状況を、図と同じ語（対立・側の名前）で一覧にも出す
    const vt = app.getVoteOutlineHtml?.() ?? ''; // FR-106 AC-616: 投票・評価（参考／決定・重大なリスク・未評価）を同じ語で一覧にも出す
    return groups.length ? `${tmr}${ph}${html}${mn}${cfo}${vt}${ws}<section class="outline-groups" aria-label="${i18n.t('outline.groups')}"><h2>${i18n.t('outline.groups')}</h2><ul>${groups.map((g) => `<li data-group-id="${escapeHtml(g.id)}">${escapeHtml(g.heading)}</li>`).join('')}</ul></section>` : `${tmr}${ph}${html}${mn}${cfo}${vt}${ws}`;
  };
  app.clearSavedSession = () => { cancelPendingSave(); P.remove(storage, P.SESSION_KEY); };
  // NFR-PERF-003 AC-539: 保留中の自動保存を直ちに行う（保存したら true）。
  app.flushSave = () => flushSave();
  app.hasPendingSave = () => saveDirty;

  // ---- 記録の状態 ----
  const lifecycle = {
    'session.start': () => { if (state.session !== 'preparing' && state.session !== 'stopped') return; change((s) => { s.session = 'recording'; setMessage(null); }); emit('session:start'); },
    'session.pause': () => { if (state.session !== 'recording') return; change((s) => { s.session = 'paused'; }); emit('session:pause'); },
    'session.resume': () => { if (state.session !== 'paused') return; change((s) => { s.session = 'recording'; setMessage(null); }); emit('session:resume'); },
    'session.stop': () => {
      if (state.session !== 'recording' && state.session !== 'paused') return;
      change((s) => { s.session = 'stopped'; for (const sc of s.scenes) sc.status = 'confirmed'; });
      emit('session:stop');
    },
    'session.nextScene': () => {
      if (state.session !== 'recording') return;
      const cur = state.scenes[state.scenes.length - 1];
      if (!cur || cur.status !== 'in_progress') return;
      breakScene = true;
      change(() => { cur.status = 'confirmed'; });
    },
  };
  for (const [name, fn] of Object.entries(lifecycle)) commands[name] = fn;
  commands['input.focus'] = () => emit('ui:focusInput');
  commands['lang.ja'] = () => app.setLang('ja');
  commands['lang.en'] = () => app.setLang('en');
  commands['view.2d'] = () => app.setViewMode('2d');
  commands['view.3d'] = () => app.setViewMode('3d');
  commands['layout.reset'] = () => { app.resetLayout(); change(() => setMessage('msg.layoutReset')); };
  commands['theme.toggle'] = () => app.setTheme(app.getTheme() === 'dark' ? 'light' : 'dark');

  // ---- テーマ ----
  app.getTheme = () => theme ?? (env.prefersDark ? 'dark' : 'light');
  app.setTheme = (name) => {
    if (!P.THEMES.includes(name)) return false;
    theme = name; P.writeJson(storage, P.THEME_KEY, name); emit('change', app); return true;
  };

  // ---- レイアウト（FR-011） ----
  // FR-074: 音声認識の開始で認識文字列パネルを一時的に表示する。保存するレイアウト（layout）は書き換えず、見せ方だけに重ねる（AC-393）。
  let autoShownInput = false;
  // FR-074 AC-390: 認識文字列パネルが折りたたまれているとき、音声認識の開始で一時的に展開する（保存しない。AC-393）
  let autoExpandedInput = false;
  let activeTab = null;
  app.getLayout = () => {
    const l = clone(layout);
    if (autoShownInput || autoExpandedInput) {
      if (autoShownInput) l.panels.input.visible = true;
      if (autoExpandedInput) l.panels.input.collapsed = false;
      L.retile(l);
    }
    return l;
  };
  app.getLayoutMode = () => L.layoutMode(env.viewportWidth);
  // FR-074 AC-391: 狭い画面（積み重ね）では、パネルをタブにまとめる。広い画面は列（columns）。
  const visiblePanels = () => { const l = app.getLayout(); return L.PANEL_IDS.filter((id) => l.panels[id].visible); };
  app.getPanelPresentation = () => {
    const vis = visiblePanels();
    if (app.getLayoutMode() !== 'stacked') return { mode: 'columns', activeTab: null, inView: vis };
    const tab = vis.includes(activeTab) ? activeTab : (vis[0] ?? null);
    return { mode: 'tabs', activeTab: tab, inView: tab ? [tab] : [] };
  };
  app.setActivePanelTab = (id) => {
    if (!visiblePanels().includes(id)) return false;
    activeTab = id; emitView(); return true;
  };
  on('speech:started', () => {
    activeTab = 'input';
    if (!layout.panels.input.visible) autoShownInput = true;
    if (layout.panels.input.collapsed) autoExpandedInput = true;
    emit('change', app);
  });
  app.setViewportWidth = (w) => { if (typeof w === 'number' && w !== env.viewportWidth) { env.viewportWidth = w; emit('change', app); } };
  app.movePanel = (id, pos) => layoutChange(L.ops.move(layout, id, pos));
  app.resizePanel = (id, size) => layoutChange(L.ops.resize(layout, id, size));
  app.setPanelVisible = (id, v) => { if (id === 'input') autoShownInput = false; return layoutChange(L.ops.visible(layout, id, v)); }; // 利用者の操作が自動表示に優先する
  // FR-017 AC-662: 副次パネルの折りたたみ・展開（保存・復元・既定に戻すの対象）。利用者の操作が自動展開に優先する
  app.setPanelCollapsed = (id, v) => {
    if (id === 'input') autoExpandedInput = false;
    const ok = layoutChange(L.ops.collapsed(layout, id, v));
    if (!ok) emitView();
    return ok;
  };
  app.setPanelMaximized = (id, v) => layoutChange(L.ops.maximized(layout, id, v));
  app.panelCommand = (id, name) => layoutChange(L.ops.command(layout, id, name));
  app.resetLayout = () => { autoShownInput = false; autoExpandedInput = false; layout = L.defaultLayout(layout.workArea); return layoutChange(true); };
  // FR-017: タイル配置・フォーカス・最大化（コマンド・キー・コマンドの検索・ボタンから共通で呼ぶ）
  app.layoutCommand = (name, panelId) => layoutChange(L.ops.arrange(layout, name, panelId));
  app.setWorkArea = (w, h) => layoutChange(L.ops.workArea(layout, w, h));
  commands['layout.tile'] = () => { app.layoutCommand('tile'); };
  commands['layout.focus'] = () => { app.layoutCommand('focus', layout.mainPanel ?? 'diagram'); };
  commands['layout.maximize'] = () => { app.layoutCommand('maximize'); };
  // コマンドの検索: 表示言語のラベルの部分一致（大文字小文字は区別しない）
  app.searchCommands = (query) => {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return [];
    // 並び（AC-133・PARAM-164）: 完全一致 → 「見出し: 項目」の項目部分が完全一致 → 前方一致 → 部分一致。同順位は登録順
    const rank = (label) => {
      const l = label.toLowerCase();
      if (l === q) return 0;
      if (l.split(/[:：]\s*/).slice(1).some((seg) => seg.trim() === q)) return 1;
      return l.startsWith(q) ? 2 : 3;
    };
    return Object.keys(commands)
      .map((command, i) => ({ command, label: i18n.t(`cmd.${command}`), i }))
      .filter((c) => c.label && c.label !== `cmd.${c.command}` && c.label.toLowerCase().includes(q))
      .sort((a, b) => rank(a.label) - rank(b.label) || a.i - b.i)
      .map(({ command, label }) => ({ command, label }));
  };

  // ---- キーボード ----
  app.handleKey = (ev) => {
    const hit = matchKey(keymap, ev);
    if (!hit || typeof commands[hit.command] !== 'function') return null;
    commands[hit.command]();
    return hit.command;
  };

  // ---- 拡張 ----
  app.on = on;
  app.subscribe = (fn) => on('change', fn);
  app.getPanelRenderer = (id) => panelRenderers.get(id) ?? null;
  app.use = async (mod) => { await mod(ctx); };
  for (const mod of [topicsModule, diagramModule, transcriptModule, inputModule, speechModule, view3DModule, editModule, exportModule, arrangeModule, commandBarModule, popupModule, viewStateModule, sessionModule, settingsModule, stylePickerModule, autoLayoutModule, layoutKindsModule, rpgModule, rpgAudioModule, llmModule, llmDrawModule, stylePresetModule, workshopModule, boardModule, relayoutModule, liveRefreshModule, speechSettingsModule, budgetModule, presentExportModule, meetingModule, minutesModule, agendaTimerModule, editHistoryModule, facilitationModule, kindStylesModule, glossaryModule, agendaViewModule, reviewModule, previewModule, visibilityModule,   conflictModule, voteModule, rolesModule, projectionModule, onboardingModule, drawModule, cinematicModule, gaugeModule, personVariantsModule, liveShowModule, ...(options.modules ?? [])]) await app.use(mod);
  // FR-116: ライブ描画ショーの演出の音（ctx.showAudio を置く。ショー側は再生時に ctx.showAudio を参照する）
  await app.use(showAudioModule);
  // 機能ごとの保存項目の復元（モジュールが保存項目を登録した後）
  if (saved?.extras) ctx.importExtras(saved.extras);
  // FR-014 AC-521: 記録中に閉じられて図に取り込まれていなかったライブの発話（held）は、復元の時点で取り込む（失わない）
  ctx.flushHeld();

  // FR-078: 画像生成 AI 向けのプロンプトのコピー（描画スタイル・レイアウト型・トピックの登録の後に足す）
  await app.use(imagePromptModule);
  // FR-088: 接続キー画面の GitHub Copilot の分類（認証方式・サインイン・トークン・モデル名）。接続キー画面より先に足す
  await app.use(copilotKeysModule);
  // FR-030 AC-519・AC-520: リボンの「設定」グループ（［設定］パネルの項目）。背景の操作を止める接続キー画面より先に足す
  await app.use(ribbonSettingsModule);
  // FR-115 AC-672: ライブ描画ショーのコマンドバーの項目（状態の文字・値の操作）。リボンの「設定」グループの後に足す
  await app.use(liveShowBarModule);
  // FR-084・FR-085: 接続キー画面（Foundry・Azure Speech のキー）。背景の操作を止めるため、最後に足す
  await app.use(apiKeysModule);

  // NFR-PERF-003 AC-539（監査 C-2）: 非表示・ページを閉じる・再読込の契機では保留中の保存を直ちに行う
  // （非表示中はタイマーが間引かれるため、タイマーを待たない）。
  const vis = options.visibility ?? null;
  if (vis) {
    const prev = vis.onchange;
    vis.onchange = (...a) => { if (typeof prev === 'function') prev(...a); if (vis.hidden) flushSave(); };
  } else {
    globalThis.document?.addEventListener?.('visibilitychange', () => { if (globalThis.document.visibilityState === 'hidden' || globalThis.document.hidden) flushSave(); });
  }
  const win = options.window ?? globalThis;
  if (typeof win?.addEventListener === 'function') {
    for (const evt of ['pagehide', 'beforeunload']) win.addEventListener(evt, () => { flushSave(); });
  }
  return app;
}

