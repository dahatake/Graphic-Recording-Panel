// FR-027 レイアウト型の切替／FR-029 描画スタイルの選択／FR-030 レイアウト・描画スタイルの［設定］画面
// （契約: tests/system/CONTRACT.md「レイアウト型・描画スタイル・設定画面」）。DOM に依存しない。
// 型の決まり方: 手動の選択（FR-027）＞ 設定の既定のレイアウト（FR-030。自動なら自動選択の結果、固定ならその型）。
// 手動の現在値・描画スタイルの現在値はセッションファイルで復元し、ブラウザ内の保存（grp.*）には含めない。
// 端末ごとの設定（grp.settings）は詳細度（grp.detail）と同じ仕組みで保存し、初期化・セッションファイルの対象外。
import * as P from './persist.js';
import { createDrawStyleRegistry, DEFAULT_STYLE_ID } from './drawstyles.js';
import { createLayoutTypeRegistry, validTypeList, LAYOUT_TYPE_IDS, LAYOUT_TYPE_META, DEFAULT_LAYOUT_TYPE } from './layouttypes.js';

export const SETTINGS_KEY = 'grp.settings';
export const FIELD_IDS = ['layout.mode', 'layout.types', 'drawStyle'];
const MODES = ['auto', 'fixed'];

const strings = (lang) => {
  const out = {};
  for (const id of LAYOUT_TYPE_IDS) out[`layoutType.${id}`] = LAYOUT_TYPE_META[id][lang].label;
  return out;
};

export function settingsModule(ctx) {
  const { api, state, storage } = ctx;
  const types = createLayoutTypeRegistry();
  const styles = createDrawStyleRegistry();
  for (const def of ctx.options.drawStyles ?? []) styles.register(def);

  ctx.i18n.addStrings({
    ja: {
      ...strings('ja'),
      'drawStyle.anime': 'アニメ調', 'drawStyle.handwritten': '手書き調', 'drawStyle.simple': 'シンプル',
      'layoutType.label': 'レイアウト型', 'layoutType.cleared': '手動の選択を解除しました。既定のレイアウトに従います', 'layoutType.keepLast': '最後の 1 つの型は外せません', 'layoutType.invalid': '指定した型は選べません',
      'cmd.layoutType.clear': 'レイアウト型の手動選択を解除', 'label.layoutType.clear': '型を解除', 'tooltip.layoutType.clear': '手動で選んだレイアウト型を解除し、設定の既定のレイアウトに戻します',
      'toolbar.layoutType': 'レイアウト型', 'settings.title': 'レイアウトと描画スタイルの設定', 'settings.layout.mode': '決め方', 'settings.layout.types': 'レイアウト型', 'settings.drawStyle': '描画スタイル',
      'settings.mode.auto': '自動', 'settings.mode.fixed': '固定', 'settings.close': '閉じる',
      'settings.changed': '設定を変更しました', 'settings.invalid': '設定の値が正しくないため変更しませんでした', 'drawStyle.changed': '描画スタイル', 'drawStyle.invalid': '選べない描画スタイルです',
      'cmd.settings.open': '設定を開く', 'cmd.settings.close': '設定を閉じる', 'label.settings.open': '設定', 'tooltip.settings.open': '既定のレイアウトと描画スタイルを選ぶ設定画面を開きます',
    },
    en: {
      ...strings('en'),
      'drawStyle.anime': 'Anime', 'drawStyle.handwritten': 'Hand-drawn', 'drawStyle.simple': 'Simple',
      'layoutType.label': 'Layout', 'layoutType.cleared': 'The manual choice was cleared. The default layout applies', 'layoutType.keepLast': 'The last layout type cannot be removed', 'layoutType.invalid': 'That layout type cannot be selected',
      'cmd.layoutType.clear': 'Clear the manual layout choice', 'label.layoutType.clear': 'Clear type', 'tooltip.layoutType.clear': 'Clear the manually chosen layout types and return to the default layout in Settings',
      'toolbar.layoutType': 'Layout type', 'settings.title': 'Layout and draw style settings', 'settings.layout.mode': 'Mode', 'settings.layout.types': 'Layout types', 'settings.drawStyle': 'Draw style',
      'settings.mode.auto': 'Auto', 'settings.mode.fixed': 'Fixed', 'settings.close': 'Close',
      'settings.changed': 'Settings changed', 'settings.invalid': 'The settings were not changed because a value is invalid', 'drawStyle.changed': 'Draw style', 'drawStyle.invalid': 'That draw style cannot be selected',
      'cmd.settings.open': 'Open settings', 'cmd.settings.close': 'Close settings', 'label.settings.open': 'Settings', 'tooltip.settings.open': 'Open the settings for the default layout and draw style',
    },
  });
  const t = ctx.t;
  const lang = () => state.lang;
  const typeLabel = (id) => t(`layoutType.${id}`);
  const styleLabel = (id) => styles.label(id, lang());

  // ---- 端末ごとの設定（grp.settings） ----
  const defaults = () => ({ layout: { mode: 'fixed', types: [DEFAULT_LAYOUT_TYPE] }, drawStyle: DEFAULT_STYLE_ID });
  let settings = defaults();
  { // 復元。壊れた値・未知の値は初期値のまま（起動を妨げない）
    const raw = P.readJson(storage, SETTINGS_KEY);
    if (raw && typeof raw === 'object') {
      const l = raw.layout;
      if (l && typeof l === 'object') {
        if (MODES.includes(l.mode)) settings.layout.mode = l.mode;
        if (validTypeList(l.types, types)) settings.layout.types = [...l.types];
      }
      if (styles.has(raw.drawStyle)) settings.drawStyle = raw.drawStyle;
    }
  }
  const saveSettings = () => P.writeJson(storage, SETTINGS_KEY, settings);

  // ---- 手動の選択・描画スタイルの現在値（セッションファイルの対象。grp.* には保存しない） ----
  let manual = null; // null | [typeId]
  let manualStyle = null; // null | styleId
  let autoSelector = () => [DEFAULT_LAYOUT_TYPE]; // FR-028 の自動選択（後続の項目が差し替える）

  const autoTypes = () => {
    let r; try { r = autoSelector({ scenes: state.scenes, utterances: state.utterances, topics: api.getTopics?.() ?? [] }); } catch { r = null; }
    return validTypeList(r, types) ? [...r] : [DEFAULT_LAYOUT_TYPE];
  };
  api.getLayoutInfo = () => {
    const source = manual ? 'manual' : (settings.layout.mode === 'auto' ? 'auto' : 'fixed');
    const selected = manual ? [...manual] : (source === 'auto' ? autoTypes() : [...settings.layout.types]);
    return { selected, head: selected[0], manual: manual != null, source, applied: (api.getDisplayMode?.() ?? 'timeline') !== 'arrange' };
  };

  let msgKey = null; let msgFn = null;
  const say = (key, fn) => { msgKey = key; msgFn = fn; ctx.change(() => { state.message = { key, text: fn() }; }); };
  ctx.on('lang', () => { if (msgKey && state.message?.key === msgKey) ctx.change(() => { state.message.text = msgFn(); }); });
  const reject = (key, reason) => { say(key, () => t(key)); return { ok: false, reason }; };
  const typesText = () => api.getLayoutInfo().selected.map(typeLabel).join(' ');
  const typeMsg = () => `${t('layoutType.label')}: ${typesText()}`;

  api.setLayoutTypes = (ids) => {
    if (!validTypeList(ids, types)) return reject('layoutType.invalid', 'invalid');
    manual = [...ids];
    say('msg.layoutType', typeMsg);
    return { ok: true };
  };
  api.toggleLayoutType = (id) => {
    if (!types.has(id)) return reject('layoutType.invalid', 'invalid');
    const cur = api.getLayoutInfo().selected;
    if (cur.includes(id)) {
      if (cur.length === 1) return reject('layoutType.keepLast', 'last');
      manual = cur.filter((x) => x !== id);
    } else manual = [...cur, id];
    say('msg.layoutType', typeMsg);
    return { ok: true };
  };
  api.clearManualLayout = () => {
    manual = null;
    say('msg.layoutType', () => `${t('layoutType.cleared')} (${typesText()})`);
    return { ok: true };
  };
  for (const id of LAYOUT_TYPE_IDS) {
    ctx.registerCommand(`layoutType.${id}`, () => api.setLayoutTypes([id]));
    ctx.registerCommand(`layoutType.add.${id}`, () => api.toggleLayoutType(id));
  }
  ctx.registerCommand('layoutType.clear', () => api.clearManualLayout());
  // Ctrl+Alt+Shift+1〜5: その型だけを選ぶ、Ctrl+Alt+Shift+6〜0: 併用に加える／外す、Ctrl+Alt+Shift+Backspace: 手動の選択を解除（Alt+Shift+英字はほかの機能が使用済み）
  const ONLY_KEYS = { timeline: '1', bubble: '2', diverge: '3', zone: '4', metaphor: '5' };
  const ADD_KEYS = { timeline: '6', bubble: '7', diverge: '8', zone: '9', metaphor: '0' };
  for (const id of LAYOUT_TYPE_IDS) {
    ctx.registerKey({ key: ONLY_KEYS[id], ctrl: true, alt: true, shift: true, command: `layoutType.${id}` });
    ctx.registerKey({ key: ADD_KEYS[id], ctrl: true, alt: true, shift: true, command: `layoutType.add.${id}` });
  }
  ctx.registerKey({ key: 'Backspace', ctrl: true, alt: true, shift: true, command: 'layoutType.clear' });
  // コマンドの検索用の名称（cmd.layoutType.*・cmd.settings.*）は i18n.js の基本辞書にある

  // ---- 描画スタイル ----
  api.getDrawStyles = () => styles.list(lang());
  api.getDrawStyle = () => manualStyle ?? settings.drawStyle;
  api.getDrawStyleSpec = () => styles.get(api.getDrawStyle());
  api.setDrawStyle = (id) => {
    if (!styles.has(id)) return reject('drawStyle.invalid', 'invalid');
    manualStyle = id;
    say('msg.drawStyle', () => `${t('drawStyle.changed')}: ${styleLabel(id)}`);
    return { ok: true };
  };
  // 拡張点（AC-148）: 定義を 1 つ足すだけで選択肢に現れる。不正・重複は加えない。
  api.registerDrawStyle = (def) => { const r = styles.register(def); if (r.ok) ctx.emit('change', api); return r; };
  api.registerLayoutType = (id, impl) => types.register(id, impl);
  api.setAutoLayoutSelector = (fn) => { if (typeof fn === 'function') { autoSelector = fn; ctx.emit('change', api); } };
  api.getLayoutTypeRegistry = () => types;

  // ---- FR-036 AC-166: タイトル情報（シリーズ名・演題・日付・会場）。セッション内のみで保持し、保存（grp.*・セッションファイル）には含めない ----
  const TITLE_KEYS = ['series', 'theme', 'date', 'venue'];
  let titleInfo = { series: '', theme: '', date: '', venue: '' };
  api.getTitleInfo = () => ({ ...titleInfo });
  api.setTitleInfo = (info) => {
    if (!info || typeof info !== 'object' || Array.isArray(info)) return { ok: false, reason: 'invalid' };
    const next = { ...titleInfo };
    for (const k of TITLE_KEYS) if (k in info) { if (typeof info[k] !== 'string') return { ok: false, reason: 'invalid' }; next[k] = info[k].trim().slice(0, 100); }
    titleInfo = next; ctx.emit('change', api);
    return { ok: true };
  };

  // ---- 2D・時系列の配置（型ごとの実装はレジストリで差し替える。先頭の型が配置を決める） ----
  api.getDiagramLayout = () => {
    const info = api.getLayoutInfo();
    const level = api.getDetailLevel?.() ?? 'detail';
    const input = { level, topics: api.getTopics?.() ?? [], scenes: state.scenes, titleInfo: api.getTitleInfo?.() ?? null, types: info.selected };
    const base = types.layoutFor(info.head)(input);
    for (const id of info.selected.slice(1)) { const ov = types.overlayFor(id); if (ov) ov(base, input); }
    return JSON.parse(JSON.stringify({ type: info.head, types: info.selected, ...base }));
  };

  // ---- 設定（FR-030） ----
  api.getSettings = () => JSON.parse(JSON.stringify(settings));
  api.setSettings = (partial) => {
    const bad = () => reject('settings.invalid', 'invalid');
    if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return bad();
    const next = JSON.parse(JSON.stringify(settings));
    let touched = false;
    if ('layout' in partial) {
      const l = partial.layout;
      if (!l || typeof l !== 'object' || !MODES.includes(l.mode)) return bad();
      if ('types' in l || l.mode === 'fixed') {
        const ids = 'types' in l ? l.types : next.layout.types;
        if (!validTypeList(ids, types)) return bad();
        next.layout.types = [...ids];
      }
      next.layout.mode = l.mode; touched = true;
    }
    if ('drawStyle' in partial) {
      if (!styles.has(partial.drawStyle)) return bad();
      next.drawStyle = partial.drawStyle; touched = true;
    }
    if (!touched) return bad();
    settings = next; saveSettings();
    if ('drawStyle' in partial) manualStyle = null; // 設定の変更は図にすぐ反映する
    say('msg.settings', () => `${t('settings.changed')}: ${[
      ...(('layout' in partial) ? [`${t('settings.layout.mode')} ${t(`settings.mode.${settings.layout.mode}`)}`, `${t('settings.layout.types')} ${settings.layout.types.map(typeLabel).join(' ')}`] : []),
      ...(('drawStyle' in partial) ? [`${t('settings.drawStyle')} ${styleLabel(settings.drawStyle)}`] : []),
    ].join(' / ')}`);
    return { ok: true };
  };

  // ---- ［設定］画面 ----
  let open = false;
  const notify = () => ctx.emit('change', api);
  api.getSettingsDialog = () => (open ? {
    open: true, role: 'dialog', label: t('settings.title'), focused: true,
    fields: FIELD_IDS.map((id) => ({ id, label: t(`settings.${id}`), value: id === 'layout.mode' ? settings.layout.mode : id === 'layout.types' ? [...settings.layout.types] : settings.drawStyle })),
  } : null);
  // UI 用の選択肢（値と表示名）
  api.getSettingsOptions = () => ({
    modes: MODES.map((m) => ({ value: m, label: t(`settings.mode.${m}`) })),
    types: LAYOUT_TYPE_IDS.map((id) => ({ value: id, label: typeLabel(id) })),
    styles: styles.list(lang()).map((s) => ({ value: s.id, label: s.label })),
    closeLabel: t('settings.close'),
  });
  api.getSettingsView = () => ({ fields: FIELD_IDS.map((id) => ({ id, visible: true })), scrollsHorizontally: false }); // 狭い画面では縦に並べ、項目を欠かさない
  ctx.registerCommand('settings.open', () => { if (!open) { open = true; notify(); } });
  ctx.registerCommand('settings.close', () => { if (open) { open = false; notify(); } });
  ctx.registerKey({ key: 'F11', alt: true, shift: true, command: 'settings.open' });
  ctx.registerKey({ key: 'F12', alt: true, shift: true, command: 'settings.close' });
  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    if (open && String(ev?.key) === 'Escape' && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) { ctx.api.commands['settings.close'](); return 'settings.close'; }
    return baseKey(ev);
  };

  // ---- コマンドバー: 型のアイコンの選択状態（色以外の手がかり） ----
  const baseBar = api.getCommandBar;
  api.getCommandBar = () => {
    const bar = baseBar();
    const sel = new Set(api.getLayoutInfo().selected);
    return {
      ...bar,
      items: bar.items.map((it) => {
        const m = /^layoutType\.(\w+)$/.exec(it.command);
        if (!m || !types.has(m[1])) return it;
        const on = sel.has(m[1]);
        return { ...it, selected: on, selectedMark: on ? (api.getLayoutInfo().head === m[1] ? 'frame' : 'check') : null, pressed: on };
      }),
    };
  };

  // ---- セッションファイルとの受け渡し（FR-019） ----
  api.exportViewSettings = () => ({ layoutTypes: manual ? [...manual] : null, drawStyle: manualStyle });
  api.importViewSettings = (v) => {
    manual = v && validTypeList(v.layoutTypes, types) ? [...v.layoutTypes] : null;
    manualStyle = v && styles.has(v.drawStyle) ? v.drawStyle : null;
  };
  api.parseViewSettings = (raw) => ({
    layoutTypes: raw && validTypeList(raw.layoutTypes, types) ? [...raw.layoutTypes] : null,
    drawStyle: raw && styles.has(raw.drawStyle) ? raw.drawStyle : null,
  });
}
