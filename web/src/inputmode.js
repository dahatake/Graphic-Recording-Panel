// FR-117 入力モードの選択（音声取込＝リアルタイム／ファイル読込＝バッチ。契約: tests/system/CONTRACT-BATCH.md §2）。DOM に依存しない（描画は ui.js）。
// - 現在のモードは端末ごとの設定としてブラウザに保存する（データの初期化 FR-018・セッションファイル FR-019 の対象外）。
// - 記録中（session==='recording'）は切り替えられない（AC-685）。切替で発話・シーン・図は変えない（モードは表示と操作の可否だけを変える）。
// - バッチモードでは音声入力の開始（session.start・session.resume）を無効にし、理由を文字で示す（AC-684）。
// - 音声取込で記録中でないときにファイルを取り込むと、自動でバッチモードに切り替える（AC-685 (b)）。
// - 画面の項目は commandbar.js の GROUPS（inputMode）の 2 項目。ここでは選択の状態（pressed・selectedMark）・常時表示の説明・無効の理由を付ける。
import { readJson, writeJson } from './persist.js';

export const INPUT_MODE_KEY = 'grp.inputMode';
export const INPUT_MODES = ['live', 'batch'];
const SET = 'inputMode.set:';
const VOICE_ONLY = ['session.start', 'session.resume'];

const STRINGS = {
  ja: {
    'toolbar.inputMode': '入力モード',
    'label.inputMode.set:live': '音声取込', 'label.inputMode.set:batch': 'ファイル取込',
    'inputMode.desc.live': '音声をリアルタイムで図にします', 'inputMode.desc.batch': 'ファイルを読み込み、スタイルを選んで図にします',
    'tooltip.inputMode.set:live': '入力モードを音声取込（リアルタイム）にします。音声と入力の確定結果が、更新間隔ごとに図へ描き足されます',
    'tooltip.inputMode.set:batch': '入力モードをファイル読込（バッチ）にします。読み込んだ字幕・テキストを、スタイルを選んで図にします',
    'msg.inputModeRecording': '記録を停止してから切り替えてください',
    'msg.inputModeVoiceOnly': '音声取込モードで使えます',
    'msg.importLiveMode': '記録を停止してファイル読込モードで図式化できます',
    'inputMode.changed.live': '入力モードを音声取込にしました', 'inputMode.changed.batch': '入力モードをファイル読込にしました',
  },
  en: {
    'toolbar.inputMode': 'Input mode',
    'label.inputMode.set:live': 'Voice input', 'label.inputMode.set:batch': 'File batch',
    'inputMode.desc.live': 'Draw from speech in real time', 'inputMode.desc.batch': 'Load a file, pick a style, and draw it',
    'tooltip.inputMode.set:live': 'Set the input mode to voice input (real time). Finalized speech and typing are added to the diagram at each update interval',
    'tooltip.inputMode.set:batch': 'Set the input mode to file batch. Loaded text or caption files are drawn in the style you pick',
    'msg.inputModeRecording': 'Stop recording before switching',
    'msg.inputModeVoiceOnly': 'Available in voice input mode',
    'msg.importLiveMode': 'Stop recording to draw the file in file batch mode',
    'inputMode.changed.live': 'Input mode set to voice input', 'inputMode.changed.batch': 'Input mode set to file batch',
  },
};

export function inputModeModule(ctx) {
  const { api, state } = ctx;
  const t = ctx.t;
  ctx.i18n.addStrings(STRINGS);

  let mode = 'live';
  { const raw = readJson(ctx.storage, INPUT_MODE_KEY); if (raw && INPUT_MODES.includes(raw.mode)) mode = raw.mode; }
  const recording = () => state.session === 'recording';

  api.getInputMode = () => {
    const canSwitch = !recording();
    return { mode, canSwitch, reason: canSwitch ? null : t('msg.inputModeRecording') };
  };
  api.setInputMode = (next) => {
    if (typeof next !== 'string' || !INPUT_MODES.includes(next)) return { ok: false, reason: 'invalid' };
    if (recording()) {
      ctx.change(() => ctx.setMessage('msg.inputModeRecording'));
      return { ok: false, reason: t('msg.inputModeRecording') };
    }
    if (next !== mode) {
      mode = next;
      writeJson(ctx.storage, INPUT_MODE_KEY, { mode });
      ctx.change(() => {});
      ctx.emit('inputmode:change', mode);
    }
    return { ok: true };
  };
  for (const m of INPUT_MODES) ctx.registerCommand(`${SET}${m}`, () => api.setInputMode(m));
  // 専用のキー割り当て（NFR-A11Y-001。Alt+Shift・Ctrl+Alt+Shift の英数字・F キーは使用済みのため Ctrl+Alt+Shift+( ・ )）
  ctx.registerKey({ key: '(', ctrl: true, alt: true, shift: true, command: `${SET}live` });
  ctx.registerKey({ key: ')', ctrl: true, alt: true, shift: true, command: `${SET}batch` });

  // バッチモードでは音声入力の開始・再開をしない（状態は変えない）
  for (const name of VOICE_ONLY) {
    const base = api.commands[name];
    if (typeof base !== 'function') continue;
    ctx.registerCommand(name, (...a) => {
      if (mode === 'batch') { ctx.change(() => ctx.setMessage('msg.inputModeVoiceOnly')); return undefined; }
      return base(...a);
    });
  }

  // 取込（FR-073）: 音声取込で記録中でなければ自動でバッチモードへ。記録中はモードも記録も変えず、案内だけ示す（AC-685 (b)）
  const baseImport = api.importTextFile;
  api.importTextFile = async (file) => {
    const r = await baseImport(file);
    if (r?.ok && mode === 'live') {
      if (recording()) ctx.change(() => ctx.setMessage('msg.importLiveMode'));
      else api.setInputMode('batch');
    }
    return r;
  };

  // コマンドバー: 現在のモードだけ pressed（色以外の印 selectedMark も付ける）、説明は常時表示、音声入力の開始の無効の理由
  const baseBar = api.getCommandBar;
  api.getCommandBar = () => {
    const bar = baseBar();
    return {
      ...bar,
      items: bar.items.map((it) => {
        if (it.command.startsWith(SET)) {
          const id = it.command.slice(SET.length);
          const on = id === mode;
          return { ...it, description: t(`inputMode.desc.${id}`), descriptionVisible: true, pressed: on, selectedMark: on ? 'check' : null };
        }
        if (VOICE_ONLY.includes(it.command)) {
          return mode === 'batch'
            ? { ...it, enabled: false, disabledReason: t('msg.inputModeVoiceOnly') }
            : { ...it, enabled: true, disabledReason: null };
        }
        return it;
      }),
    };
  };
}
