// アプリの組立（契約: tests/system/CONTRACT.md）。DOM・グローバルに依存せず Node から import できる。
// 拡張点（後続の機能は、ここを書き換えずに options.modules か app.use で足す）:
//   module = (ctx) => void | Promise<void>
//   ctx.registerCommand(name, fn)   コマンド（ボタン・キーボード共通。app.commands[name]）
//   ctx.registerKey({key,alt,shift,ctrl,command})  キー割り当て
//   ctx.registerPanelRenderer(id, (host, ctx) => void)  パネルの描画（ui.js が呼ぶ）
//   ctx.api                          app の公開面（機能が追加のメソッドを生やす）
//   ctx.change(fn) / ctx.state       状態の変更（自動保存・再描画の通知つき）
//   ctx.on(event, fn) / ctx.emit     'session:start|pause|resume|stop' 'utterance' 'lang' など
//   ctx.i18n.addStrings({ja,en})     UI 文言
//   ctx.addUtterance(text)           発話の追加（記録中のみ。音声・ファイル取込もここを通す）

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
import { topicsModule } from './topics.js';
import { settingsModule } from './settings.js';
import { stylePickerModule } from './stylepicker.js';
import { autoLayoutModule } from './autolayout.js';
import { layoutKindsModule } from './layoutkinds.js';
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
  };
  let seq = 0;
  let breakScene = false;
  let layout = L.parseLayout(storage.getItem(L.STORAGE_KEY));
  let theme = P.readJson(storage, P.THEME_KEY);
  if (!P.THEMES.includes(theme)) theme = null; // null = OS の設定に従う

  const nextId = (prefix) => `${prefix}${++seq}`;

  // 復元（FR-012）: 保存済みセッションは必ず paused で始まる。
  flushPendingSaves(storage);
  const saved = P.parseSession(P.readJson(storage, P.SESSION_KEY));
  if (saved) {
    state.utterances = saved.utterances; state.scenes = saved.scenes;
    state.selectedSceneId = saved.scenes.some((s) => s.id === saved.selectedSceneId) ? saved.selectedSceneId : null;
    seq = saved.seq;
    state.displayMode = saved.displayMode; state.arrange = saved.arrange; state.topicEdits = saved.topicEdits;
    if (saved.utterances.length || saved.scenes.length) state.session = 'paused';
  }

  const app = { commands, keymap };
  // NFR-PERF-003 AC-538: データの版数。データ（発話・シーン・要点・選択・表示の設定、機能の状態）を変える通知でだけ増える。
  // 見た目だけの変更（パネルの移動・大きさ・タブ・画面幅・図の拡大率と位置）は emitView で通知し、版数を変えない。
  // 描画・計算のメモ化は、この版数が同じなら前回の結果を使う。change の関数の実行中は null（途中の状態をキャッシュしない）。
  let dataVersion = 0;
  let mutating = 0;
  const on = (evt, fn) => { (listeners.get(evt) ?? listeners.set(evt, []).get(evt)).push(fn); return () => { listeners.set(evt, listeners.get(evt).filter((f) => f !== fn)); }; };
  const notify = (evt, payload) => { for (const fn of [...(listeners.get(evt) ?? [])]) fn(payload); };
  const emit = (evt, payload) => { if (evt === 'change') dataVersion++; notify(evt, payload); };
  const emitView = () => notify('change', app);
  const getDataVersion = () => (mutating ? null : dataVersion);
  // NFR-PERF-003 AC-538: 重い処理（自動保存の直列化・トピック分類など）の呼び出し回数（計測用。動作には使わない）
  const callCounts = {};
  const countCall = (name) => { callCounts[name] = (callCounts[name] ?? 0) + 1; };

  function persistSession() {
    if (!state.utterances.length && !state.scenes.length) return;
    countCall('autosave');
    P.writeJson(storage, P.SESSION_KEY, {
      utterances: state.utterances, scenes: state.scenes, selectedSceneId: state.selectedSceneId, seq,
      displayMode: state.displayMode, arrange: state.arrange, topicEdits: state.topicEdits,
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
  function change(fn) {
    mutating++;
    dataVersion++; // 実行中に読まれたキャッシュを無効にする
    try { fn(state); } finally { mutating--; }
    scheduleSave();
    emit('change', app);
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
    // 発話の追加（記録中のみ）。opts.at: 受付時刻の指定、opts.ats: 発話ごとの受付時刻（件数が同じときのみ。FR-022）、opts.anyState: 記録中以外でも追加（ファイル取込のみ。FR-039）、opts.noGapSplit: 無音間隔で分割しない（ファイル取込: FR-003 AC-044）。
    addUtterance(text, opts) { return ctx.addUtterances([text], opts) > 0; },
    // 複数の発話を 1 回の状態変更（保存・再描画）で追加する。追加した件数を返す。
    addUtterances(texts, opts = {}) {
      const list = texts.map((x) => String(x ?? '').trim()).filter(Boolean);
      if ((state.session !== 'recording' && !opts.anyState) || !list.length) return 0; // FR-039: ファイル取込は状態によらず可（opts.anyState）
      const at0 = opts.at ?? now();
      change((s) => {
        for (const [i, t] of list.entries()) {
          const at = Array.isArray(opts.ats) && opts.ats.length === list.length ? opts.ats[i] : at0;
          s.utterances.push({ id: nextId('u'), text: t, receivedAt: at });
          const cur = s.scenes[s.scenes.length - 1];
          const prevAt = s.utterances.length > 1 ? s.utterances[s.utterances.length - 2].receivedAt : null;
          const gap = !opts.noGapSplit && prevAt != null && at - prevAt > gapMs;
          if (cur && cur.status === 'in_progress' && !breakScene && !gap) {
            appendPoints(cur, extractPoints(t), nextId);
          } else {
            if (cur && cur.status === 'in_progress') cur.status = 'confirmed';
            const sc = newScene(t, nextId);
            s.scenes.push(sc);
            if (!s.selectedSceneId) s.selectedSceneId = sc.id;
          }
          breakScene = false;
        }
      });
      for (const t of list) emit('utterance', t);
      return list.length;
    },
  };

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
  app.getRenderVersion = () => dataVersion;
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
    change((s) => { s.selectedSceneId = id; });
    return true;
  };
  app.setViewMode = (mode) => {
    if (mode !== '2d' && mode !== '3d') return false;
    change((s) => { s.viewMode = mode; });
    return true;
  };
  app.renderOutline = () => {
    const html = renderOutline(state.scenes, state.selectedSceneId, i18n.t, app.getOutlineAnnotation?.() ?? null, app.getTopicOutline?.() ?? null, { label: (text) => kindLabelOf(classifyPoint(text), state.lang), relations: app.getOutlineRelations?.() ?? [] });
    // FR-036 AC-167: 各まとまり（トピック・区画・囲み）の小見出しを文字でも示す（時系列の表示のとき）
    const applied = app.getLayoutInfo?.().applied;
    const groups = applied && state.scenes.length ? (app.getDiagramLayout?.().groups ?? []) : [];
    return groups.length ? `${html}<section class="outline-groups" aria-label="${i18n.t('outline.groups')}"><h2>${i18n.t('outline.groups')}</h2><ul>${groups.map((g) => `<li data-group-id="${escapeHtml(g.id)}">${escapeHtml(g.heading)}</li>`).join('')}</ul></section>` : html;
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
  let activeTab = null;
  app.getLayout = () => { const l = clone(layout); if (autoShownInput) l.panels.input.visible = true; return l; };
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
    emit('change', app);
  });
  app.setViewportWidth = (w) => { if (typeof w === 'number' && w !== env.viewportWidth) { env.viewportWidth = w; emit('change', app); } };
  app.movePanel = (id, pos) => layoutChange(L.ops.move(layout, id, pos));
  app.resizePanel = (id, size) => layoutChange(L.ops.resize(layout, id, size));
  app.setPanelVisible = (id, v) => { if (id === 'input') autoShownInput = false; return layoutChange(L.ops.visible(layout, id, v)); }; // 利用者の操作が自動表示に優先する
  app.setPanelMaximized = (id, v) => layoutChange(L.ops.maximized(layout, id, v));
  app.panelCommand = (id, name) => layoutChange(L.ops.command(layout, id, name));
  app.resetLayout = () => { autoShownInput = false; layout = L.defaultLayout(layout.workArea); return layoutChange(true); };
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
    return Object.keys(commands)
      .map((command) => ({ command, label: i18n.t(`cmd.${command}`) }))
      .filter((c) => c.label && c.label !== `cmd.${c.command}` && c.label.toLowerCase().includes(q));
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
  for (const mod of [topicsModule, diagramModule, transcriptModule, inputModule, speechModule, view3DModule, editModule, exportModule, arrangeModule, commandBarModule, popupModule, sessionModule, settingsModule, stylePickerModule, autoLayoutModule, layoutKindsModule, rpgModule, rpgAudioModule, llmModule, llmDrawModule, stylePresetModule, relayoutModule, liveRefreshModule, speechSettingsModule, budgetModule, presentExportModule, ...(options.modules ?? [])]) await app.use(mod);

  // FR-078: 画像生成 AI 向けのプロンプトのコピー（描画スタイル・レイアウト型・トピックの登録の後に足す）
  await app.use(imagePromptModule);
  // FR-088: 接続キー画面の GitHub Copilot の分類（認証方式・サインイン・トークン・モデル名）。接続キー画面より先に足す
  await app.use(copilotKeysModule);
  // FR-030 AC-519・AC-520: リボンの「設定」グループ（［設定］パネルの項目）。背景の操作を止める接続キー画面より先に足す
  await app.use(ribbonSettingsModule);
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

