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
import { renderOutline } from './outline.js';
import { newScene, appendPoints, extractPoints } from './scenes.js';
import * as P from './persist.js';
import { diagramModule } from './diagram.js';
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

const GAP_MS_DEFAULT = 20_000; // PARAM-002
const clone = (v) => JSON.parse(JSON.stringify(v));

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
  const saved = P.parseSession(P.readJson(storage, P.SESSION_KEY));
  if (saved) {
    state.utterances = saved.utterances; state.scenes = saved.scenes;
    state.selectedSceneId = saved.scenes.some((s) => s.id === saved.selectedSceneId) ? saved.selectedSceneId : null;
    seq = saved.seq;
    state.displayMode = saved.displayMode; state.arrange = saved.arrange; state.topicEdits = saved.topicEdits;
    if (saved.utterances.length || saved.scenes.length) state.session = 'paused';
  }

  const app = { commands, keymap };
  const on = (evt, fn) => { (listeners.get(evt) ?? listeners.set(evt, []).get(evt)).push(fn); return () => { listeners.set(evt, listeners.get(evt).filter((f) => f !== fn)); }; };
  const emit = (evt, payload) => { for (const fn of [...(listeners.get(evt) ?? [])]) fn(payload); };

  function persistSession() {
    if (!state.utterances.length && !state.scenes.length) return;
    P.writeJson(storage, P.SESSION_KEY, {
      utterances: state.utterances, scenes: state.scenes, selectedSceneId: state.selectedSceneId, seq,
      displayMode: state.displayMode, arrange: state.arrange, topicEdits: state.topicEdits,
    });
  }
  // 状態を変える唯一の入口: 自動保存と再描画の通知。
  function change(fn) {
    fn(state);
    persistSession();
    emit('change', app);
  }
  function setMessage(key) { state.message = key ? { key, text: i18n.t(key) } : null; }
  function saveLayout() { P.writeJson(storage, L.STORAGE_KEY, layout); }
  function layoutChange(ok) { if (ok) { saveLayout(); emit('change', app); } return ok; }

  const ctx = {
    setSeq: (n) => { seq = n; }, getSeq: () => seq, clearBreak: () => { breakScene = false; },
    options, env, state, i18n, storage, now, api: app, on, emit, change, setMessage, nextId,
    t: (k) => i18n.t(k),
    registerCommand(name, fn) { commands[name] = fn; },
    registerKey(k) {
      const dup = keymap.some((e) => e.command === k.command);
      if (!dup) keymap.push({ ...k });
    },
    registerPanelRenderer(id, fn) { panelRenderers.set(id, fn); },
    // 発話の追加（記録中のみ）。opts.at: 受付時刻の指定、opts.ats: 発話ごとの受付時刻（件数が同じときのみ。FR-022）、opts.noGapSplit: 無音間隔で分割しない（ファイル取込: FR-003 AC-044）。
    addUtterance(text, opts) { return ctx.addUtterances([text], opts) > 0; },
    // 複数の発話を 1 回の状態変更（保存・再描画）で追加する。追加した件数を返す。
    addUtterances(texts, opts = {}) {
      const list = texts.map((x) => String(x ?? '').trim()).filter(Boolean);
      if (state.session !== 'recording' || !list.length) return 0;
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
  app.renderOutline = () => renderOutline(state.scenes, state.selectedSceneId, i18n.t, app.getOutlineAnnotation?.() ?? null, app.getTopicOutline?.() ?? null);
  app.clearSavedSession = () => { P.remove(storage, P.SESSION_KEY); };

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
  app.getLayout = () => clone(layout);
  app.getLayoutMode = () => L.layoutMode(env.viewportWidth);
  app.setViewportWidth = (w) => { if (typeof w === 'number' && w !== env.viewportWidth) { env.viewportWidth = w; emit('change', app); } };
  app.movePanel = (id, pos) => layoutChange(L.ops.move(layout, id, pos));
  app.resizePanel = (id, size) => layoutChange(L.ops.resize(layout, id, size));
  app.setPanelVisible = (id, v) => layoutChange(L.ops.visible(layout, id, v));
  app.setPanelMaximized = (id, v) => layoutChange(L.ops.maximized(layout, id, v));
  app.panelCommand = (id, name) => layoutChange(L.ops.command(layout, id, name));
  app.resetLayout = () => { layout = L.defaultLayout(layout.workArea); return layoutChange(true); };
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
  for (const mod of [topicsModule, diagramModule, transcriptModule, inputModule, speechModule, view3DModule, editModule, exportModule, arrangeModule, commandBarModule, popupModule, sessionModule, settingsModule, ...(options.modules ?? [])]) await app.use(mod);

  return app;
}

