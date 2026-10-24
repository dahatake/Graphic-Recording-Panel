// FR-030 AC-519・AC-520／FR-084: リボンの「設定」グループ。［設定］パネル（レイアウトと描画スタイルの設定）の全項目を
// アイコンと簡略な説明つきでリボンにも出し、操作は［設定］と同じ保存・同じ状態に届ける（値は常に一致）。
// 契約: tests/system/CONTRACT-RIBBON-SETTINGS.md。DOM に依存しない（描画は ui.js）。
// - 決め方（settings.layoutMode）・ミュート（sound.toggleMute）・音量（sound.setVolume）・再配置の周期（arrange.setInterval）は新しい項目。
//   型のチェックは既存の layoutType.<id>、描画スタイルは既存の drawStyle.pick に settingsField を付けて 1 つにまとめる（重複させない）。
// - app.operateBarItem(command, value?) はリボンの項目の操作（クリック・値の入力）。不正な値は受け付けず、理由をメッセージで示す。
import { LAYOUT_TYPE_IDS } from './layouttypes.js';

const MODES = ['auto', 'fixed'];
const INTERVAL_PRESETS = [0, 10, 30, 60]; // 値なしで呼ばれたとき（コマンドの検索）に順に切り替える
const VOLUME_STEP = 10;
const FIELDS = {
  'settings.layoutMode': 'layout.mode', 'sound.toggleMute': 'sound.muted', 'sound.setVolume': 'sound.volume', 'arrange.setInterval': 'arrange.interval', 'drawStyle.pick': 'drawStyle',
  ...Object.fromEntries(LAYOUT_TYPE_IDS.map((id) => [`layoutType.${id}`, 'layout.types'])),
};

export function ribbonSettingsModule(ctx) {
  const { api, state } = ctx;
  const t = ctx.t;
  ctx.i18n.addStrings({
    ja: {
      'description.settings.layoutMode': 'レイアウトの決め方（自動・固定）', 'description.sound.toggleMute': 'RPG風の音を消す・戻す', 'description.sound.setVolume': '音量 0〜100', 'description.arrange.setInterval': '再配置の周期 0〜300 秒',
      'ribbon.sound.mute.on': 'ミュート中', 'ribbon.sound.mute.off': 'ミュートなし', 'ribbon.sound.volume': '音量',
      'ribbon.invalid.mode': '決め方は「自動」か「固定」を選んでください', 'ribbon.invalid.mute': 'ミュートは入か切かを指定してください', 'ribbon.invalid.volume': '音量は 0〜100 の整数で入力してください', 'ribbon.invalid.drawStyle': '選べない描画スタイルです', 'ribbon.unknown': 'その項目はありません', 'ribbon.noChange': '変更はありません（すでにその状態か、今は実行できる状態ではありません）',
      'settings.sound.muted': '音をミュート', 'settings.sound.volume': '音量',
    },
    en: {
      'description.settings.layoutMode': 'How the layout is decided (auto/fixed)', 'description.sound.toggleMute': 'Mute or unmute the RPG sound', 'description.sound.setVolume': 'Volume 0 to 100', 'description.arrange.setInterval': 'Rearrange interval 0-300 s',
      'ribbon.sound.mute.on': 'Muted', 'ribbon.sound.mute.off': 'Not muted', 'ribbon.sound.volume': 'Volume',
      'ribbon.invalid.mode': 'Choose Auto or Fixed for the mode', 'ribbon.invalid.mute': 'Specify mute on or off', 'ribbon.invalid.volume': 'Enter the volume as an integer from 0 to 100', 'ribbon.invalid.drawStyle': 'That draw style cannot be selected', 'ribbon.unknown': 'There is no such item', 'ribbon.noChange': 'No change (it is already in that state, or it cannot run right now)',
      'settings.sound.muted': 'Mute sound', 'settings.sound.volume': 'Volume',
    },
  });

  let msgKey = null; let msgFn = null;
  const say = (key, fn = () => t(key)) => { msgKey = key; msgFn = fn; ctx.change((s) => { s.message = { key, text: fn() }; }); };
  ctx.on('lang', () => { if (msgKey && state.message?.key === msgKey) ctx.change((s) => { s.message.text = msgFn(); }); });

  // ---- ［設定］の項目の現在値（リボンと［設定］で同じ値を返す） ----
  const mode = () => api.getSettings().layout.mode;
  const audio = () => api.getRpgAudio();
  const interval = () => api.getArrangeInterval().sec;
  const intValue = (v) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return typeof n === 'number' && Number.isInteger(n) ? n : null;
  };

  // ---- 値のある項目の操作。値なしは「次の値へ」（ボタンのクリック・コマンドの検索）。戻り値は { ok } ----
  const OPS = {
    'settings.layoutMode': (v) => {
      const next = v === undefined ? (mode() === 'auto' ? 'fixed' : 'auto') : v;
      if (!MODES.includes(next)) { say('ribbon.invalid.mode'); return { ok: false }; }
      return api.setSettings({ layout: { mode: next } });
    },
    'sound.toggleMute': (v) => {
      const next = v === undefined ? !audio().muted : v;
      if (typeof next !== 'boolean') { say('ribbon.invalid.mute'); return { ok: false }; }
      const r = api.setRpgMuted(next);
      say('ribbon.sound.muted', () => `${t('settings.sound.muted')}: ${t(next ? 'ribbon.sound.mute.on' : 'ribbon.sound.mute.off')}`);
      return r;
    },
    'sound.setVolume': (v) => {
      const next = v === undefined ? (audio().volume + VOLUME_STEP > 100 ? 0 : audio().volume + VOLUME_STEP) : intValue(v);
      if (next === null || next < 0 || next > 100) { say('ribbon.invalid.volume'); return { ok: false }; }
      const r = api.setRpgVolume(next);
      say('ribbon.sound.volumeChanged', () => `${t('ribbon.sound.volume')}: ${next}`);
      return r;
    },
    'arrange.setInterval': (v) => {
      const next = v === undefined ? INTERVAL_PRESETS[(INTERVAL_PRESETS.indexOf(interval()) + 1) % INTERVAL_PRESETS.length] : v;
      return api.setArrangeInterval(next); // 判定・保存・メッセージは再配置の周期（relayout.js）が行う
    },
  };
  for (const name of Object.keys(OPS)) ctx.registerCommand(name, () => OPS[name](undefined));
  // NFR-A11Y-001: すべての操作にキー割り当て（Ctrl+Alt+Shift+F6〜F9。Alt+Shift+F5〜F10 は BGM・トピックの移動、F11・F12 は［設定］の開閉が使用済み）
  for (const [key, command] of [['F6', 'settings.layoutMode'], ['F7', 'sound.toggleMute'], ['F8', 'sound.setVolume'], ['F9', 'arrange.setInterval']]) ctx.registerKey({ key, ctrl: true, alt: true, shift: true, command });

  // ---- 操作の効果の判定（状態・図・表示・ダイアログのどれが変わったか） ----
  const safe = (fn) => { try { return fn(); } catch { return null; } };
  const snapshot = () => ({
    dialogs: JSON.stringify([!!safe(() => api.getSettingsDialog()), !!safe(() => api.getDialog()), safe(() => api.getDrawStylePicker().open), !!safe(() => api.getApiKeysDialog()), !!safe(() => api.getScenePopup?.())]),
    display: JSON.stringify([safe(() => api.getTheme()), safe(() => api.getLayout()), safe(() => { const s = api.getState(); return [s.viewMode, s.displayMode, s.lang]; })]),
    figure: safe(() => api.renderSvg()),
    state: JSON.stringify(safe(() => api.getState())),
  });
  const effectOf = (a, b) => (a.dialogs !== b.dialogs ? 'dialog' : a.display !== b.display ? 'display' : a.figure !== b.figure ? 'figure' : a.state !== b.state ? 'state' : 'none');

  // 画面の部品（ファイル選択・入力欄）への依頼はブラウザ側（ui.js）が受ける。依頼を出した時点で、ダイアログが開く・フォーカスが移る効果とみなす
  let uiEffect = null;
  ctx.on('ui:pickImportFile', () => { uiEffect = 'dialog'; });
  ctx.on('ui:focusInput', () => { uiEffect = 'display'; });
  api.operateBarItem = (command, value) => {
    const item = api.getCommandBar().items.find((i) => i.command === command);
    if (!item) { say('ribbon.unknown'); return { ok: false, effect: 'none' }; }
    if (item.disabled === true) return { ok: false, effect: 'none' };
    const before = snapshot();
    uiEffect = null;
    let r;
    if (OPS[command] && value !== undefined) r = OPS[command](value);
    else if (command === 'drawStyle.pick' && value !== undefined) {
      r = typeof value === 'string' ? api.setSettings({ drawStyle: value }) : { ok: false };
      if (!r.ok) say('ribbon.invalid.drawStyle');
    } else if (typeof api.commands[command] === 'function') r = api.commands[command]();
    else return { ok: false, effect: 'none' };
    if (r && typeof r.then === 'function') return { ok: true, effect: 'state' }; // 非同期の操作（ファイルの選択・読込など）は開始した時点で効果あり
    if (r && r.ok === false) return { ok: false, effect: 'none' };
    // 値のある項目で受け付けた入力は、同じ値でも状態の操作として扱う
    if ((OPS[command] && value !== undefined) || command === 'drawStyle.pick' && value !== undefined) return { ok: true, effect: 'state' };
    const effect = uiEffect ?? effectOf(before, snapshot());
    if (effect !== 'none') return { ok: true, effect };
    // 変える状態がない（すでにその状態・今は実行できない）ときは、無反応にせず理由を読み上げ対象のメッセージで示す
    const label = item.label;
    say('ribbon.noChange', () => `${label}: ${t('ribbon.noChange')}`);
    return { ok: true, effect: 'state' };
  };

  // ---- コマンドバー: ［設定］の項目との対応・種類・現在値 ----
  const baseBar = api.getCommandBar;
  api.getCommandBar = () => {
    const bar = baseBar();
    return {
      ...bar,
      items: bar.items.map((it) => {
        const settingsField = FIELDS[it.command];
        if (!settingsField) return it;
        const out = { ...it, settingsField };
        switch (it.command) {
          case 'settings.layoutMode': Object.assign(out, { kind: 'select', value: mode(), options: MODES.map((m) => ({ value: m, label: t(`settings.mode.${m}`) })) }); break;
          case 'sound.toggleMute': Object.assign(out, { kind: 'toggle', value: audio().muted, pressed: audio().muted }); break;
          case 'sound.setVolume': Object.assign(out, { kind: 'slider', value: audio().volume, min: 0, max: 100, step: 1 }); break;
          case 'arrange.setInterval': Object.assign(out, { kind: 'number', value: interval(), min: 0, max: 300, step: 1 }); break;
          case 'drawStyle.pick': Object.assign(out, { kind: 'select', value: api.getSettings().drawStyle, options: api.getDrawStyles().map((s) => ({ value: s.id, label: s.label })) }); break;
          default: Object.assign(out, { kind: 'toggle', value: it.selected === true }); // layoutType.<id>
        }
        if (it.command in { 'settings.layoutMode': 1, 'sound.toggleMute': 1, 'sound.setVolume': 1, 'arrange.setInterval': 1 }) { out.description = t(`description.${it.command}`); out.descriptionVisible = true; }
        return out;
      }),
    };
  };

  // ---- ［設定］の項目: 音のミュート・音量（既存の項目の後ろに足す） ----
  const baseDialog = api.getSettingsDialog;
  api.getSettingsDialog = () => {
    const d = baseDialog();
    if (!d) return d;
    const a = audio();
    return { ...d, fields: [...d.fields,
      { id: 'sound.muted', label: t('settings.sound.muted'), value: a.muted, role: 'switch' },
      { id: 'sound.volume', label: t('settings.sound.volume'), value: a.volume, min: 0, max: 100, step: 1, role: 'slider' }] };
  };
  const baseView = api.getSettingsView;
  api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, { id: 'sound.muted', visible: true }, { id: 'sound.volume', visible: true }] }; };
}
