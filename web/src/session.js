// FR-018 データの初期化（確認つき）／FR-019 議論途中データのファイル保存・読込（契約: tests/system/CONTRACT.md）。
// DOM に依存しない。確認（dialog）の状態はここで持ち、ui.js が描く。外部へ通信しない（ファイルはブラウザ内だけで作る・読む）。
import * as P from './persist.js';
import { parseArrange, presetArrange } from './arrange.js';
import { parseAxes, DEFAULT_AXES } from './axes3d.js';
import { INITIAL_VIEWPOINT } from './view3d.js';
import { stampName, browserDownload } from './export.js';

export const FORMAT = 'grp-session';
export const VERSION = 1;
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // PARAM-010: 10 MB

// セッションファイルの検証・変換。失敗は { reason }（too_large / not_json / not_session / bad_version / broken）。
export function parseSessionFile({ name, type, size, text } = {}) {
  if (Number(size) > MAX_FILE_BYTES || String(text ?? '').length > MAX_FILE_BYTES) return { reason: 'too_large' };
  if (!/\.json$/i.test(String(name ?? '')) || (type && !/json|text\/plain|octet/i.test(String(type)))) return { reason: 'not_session' };
  let raw;
  try { raw = JSON.parse(String(text ?? '')); } catch { return { reason: 'not_json' }; }
  if (!raw || typeof raw !== 'object' || raw.format !== FORMAT) return { reason: 'not_session' };
  if (raw.version !== VERSION) return { reason: 'bad_version' };
  const s = P.parseSession(raw);
  if (!s) return { reason: 'broken' };
  return {
    session: {
      ...s,
      displayMode: raw.displayMode === 'arrange' ? 'arrange' : 'timeline',
      viewMode: raw.viewMode === '3d' ? '3d' : '2d',
      axes3d: parseAxes(raw.axes3d),
    },
  };
}

export function sessionModule(ctx) {
  const { state, api } = ctx;
  const t = ctx.t;
  ctx.i18n.addStrings({
    ja: {
      'toolbar.data': 'データ',
      'dialog.reset.text': '発話・認識文字列・シーン・要点・図の手修正・整理の割り当てと、ブラウザ内に保存されたセッションを消去し、初期状態に戻します。この操作は元に戻せません。レイアウト・表示言語・テーマは変わりません。',
      'dialog.reset.confirm': '初期化する', 'dialog.cancel': 'キャンセル',
      'dialog.load.text': '現在のデータは、読み込む内容に置き換えられて消えます。この操作は元に戻せません。',
      'dialog.load.confirm': '置き換えて読み込む',
      'msg.resetDone': 'データを初期化しました。記録は準備中です',
      'msg.fileSaved': 'セッションファイルを保存しました',
      'msg.fileEmpty': '保存できるデータがありません。発話を記録してから保存してください',
      'msg.fileLoaded': 'セッションファイルを読み込みました。一時停止中です。再開すると記録を続けられます',
      'msg.fileTooLarge': 'ファイルが大きすぎます（上限 10 MB）。別のファイルを選んでください',
      'msg.fileNotJson': 'ファイルを読めません（壊れているか、JSON ではありません）。保存したセッションファイルを選んでください',
      'msg.fileNotSession': 'セッションファイルではないため読み込めません。「ファイルに保存」で作ったファイルを選んでください',
      'msg.fileBadVersion': '未対応の版のセッションファイルです。保存したアプリの版で開いてください',
      'msg.fileBroken': 'セッションファイルの内容が壊れているため読み込めません。別のファイルを選んでください',
      'msg.fileNoPicker': 'ファイル選択を開けませんでした',
    },
    en: {
      'toolbar.data': 'Data',
      'dialog.reset.text': 'This erases the utterances, transcript, scenes, points, manual diagram edits, arrangement assignments, and the session saved in this browser, and returns the app to its initial state. This cannot be undone. Layout, language, and theme are kept.',
      'dialog.reset.confirm': 'Reset', 'dialog.cancel': 'Cancel',
      'dialog.load.text': 'The current data will be replaced by the loaded file and will be lost. This cannot be undone.',
      'dialog.load.confirm': 'Replace and load',
      'msg.resetDone': 'Data was reset. Recording is ready to start',
      'msg.fileSaved': 'The session file was saved',
      'msg.fileEmpty': 'There is no data to save. Record some speech first',
      'msg.fileLoaded': 'The session file was loaded. It is paused; resume to continue recording',
      'msg.fileTooLarge': 'The file is too large (limit 10 MB). Choose another file',
      'msg.fileNotJson': 'The file cannot be read (it is broken or not JSON). Choose a saved session file',
      'msg.fileNotSession': 'This is not a session file. Choose a file made with Save file',
      'msg.fileBadVersion': 'This session file version is not supported. Open it with the app version that saved it',
      'msg.fileBroken': 'The session file content is broken and cannot be loaded. Choose another file',
      'msg.fileNoPicker': 'The file picker could not be opened',
    },
  });

  const hasData = () => state.utterances.length > 0 || state.scenes.length > 0;
  const notify = () => ctx.emit('change', api);
  const say = (key) => ctx.change(() => ctx.setMessage(key));

  // ---- 手修正 ----
  api.getManualEdits = () => state.scenes.flatMap((s) => s.points.filter((p) => p.manual).map((p) => ({ pointId: p.id, text: p.text })));

  // ---- 確認 ----
  let dialog = null; // { kind, session? }
  api.getDialog = () => {
    if (!dialog) return null;
    const load = dialog.kind === 'load-replace';
    return {
      kind: dialog.kind,
      text: t(load ? 'dialog.load.text' : 'dialog.reset.text'),
      buttons: [{ id: 'confirm', label: t(load ? 'dialog.load.confirm' : 'dialog.reset.confirm') }, { id: 'cancel', label: t('dialog.cancel') }],
      defaultFocus: 'cancel', keyboard: true,
    };
  };

  function doReset() {
    api.stopSpeech?.({ force: true });
    ctx.api.commands['presentation.stop']?.();
    ctx.transcript?.clear();
    ctx.clearBreak();
    ctx.setSeq(0);
    ctx.change((s) => {
      s.utterances = []; s.scenes = []; s.selectedSceneId = null; s.session = 'preparing';
      s.viewMode = '2d'; s.displayMode = 'timeline'; s.arrange = presetArrange();
      s.axes3d = { ...DEFAULT_AXES }; s.viewpoint = { ...INITIAL_VIEWPOINT };
      s.input.draft = '';
      if (s.speech) s.speech.interim = '';
      ctx.setMessage('msg.resetDone');
    });
    P.remove(ctx.storage, P.SESSION_KEY);
  }

  function applySession(sess) {
    api.stopSpeech?.({ force: true });
    ctx.api.commands['presentation.stop']?.();
    ctx.transcript?.clear();
    ctx.clearBreak();
    ctx.setSeq(sess.seq);
    ctx.change((s) => {
      s.utterances = sess.utterances; s.scenes = sess.scenes;
      s.selectedSceneId = sess.scenes.some((x) => x.id === sess.selectedSceneId) ? sess.selectedSceneId : null;
      s.displayMode = sess.displayMode; s.arrange = parseArrange(sess.arrange);
      s.viewMode = sess.viewMode; s.axes3d = sess.axes3d; s.viewpoint = { ...INITIAL_VIEWPOINT };
      s.session = 'paused';
      s.input.draft = '';
      ctx.setMessage('msg.fileLoaded');
    });
  }

  api.dialogAction = (action) => {
    const d = dialog;
    if (!d) return Promise.resolve({ ok: false, reason: 'no_dialog' });
    dialog = null;
    if (action === 'confirm') {
      if (d.kind === 'reset') { doReset(); return Promise.resolve({ ok: true }); }
      applySession(d.session); return Promise.resolve({ ok: true });
    }
    notify();
    return Promise.resolve({ ok: false, reason: 'cancelled' });
  };

  ctx.registerCommand('data.reset', () => {
    if (!dialog) { dialog = { kind: 'reset' }; notify(); }
    return { ok: true, pending: true };
  });

  // Esc は確認を閉じる（キャンセルと同じ）。それ以外は従来のキー処理。
  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    if (dialog && String(ev?.key) === 'Escape' && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) { void api.dialogAction('cancel'); return 'dialog.cancel'; }
    return baseKey(ev);
  };

  // ---- 保存 ----
  const save = async () => {
    if (!hasData()) { say('msg.fileEmpty'); return { ok: false, reason: 'empty' }; }
    const data = JSON.stringify({
      format: FORMAT, version: VERSION,
      utterances: state.utterances, scenes: state.scenes, selectedSceneId: state.selectedSceneId, seq: ctx.getSeq(),
      displayMode: state.displayMode, arrange: state.arrange, viewMode: state.viewMode, axes3d: state.axes3d,
    });
    await (ctx.options.download ?? browserDownload)({ filename: `grp-session-${stampName(ctx.now())}.json`, mime: 'application/json', data });
    say('msg.fileSaved');
    return { ok: true };
  };
  ctx.registerCommand('file.save', save);

  // ---- 読込 ----
  const FAIL_KEY = { too_large: 'msg.fileTooLarge', not_json: 'msg.fileNotJson', not_session: 'msg.fileNotSession', bad_version: 'msg.fileBadVersion', broken: 'msg.fileBroken' };
  api.loadSessionFile = async (file) => {
    const r = parseSessionFile(file ?? {});
    if (r.reason) { say(FAIL_KEY[r.reason]); return { ok: false, reason: r.reason }; }
    if (hasData()) { dialog = { kind: 'load-replace', session: r.session }; notify(); return { ok: false, pending: true }; }
    applySession(r.session);
    return { ok: true };
  };
  // 実ブラウザ: ファイル選択（ui.js が api.pickSessionFile を差す）。選択後は loadSessionFile と同じ。
  ctx.registerCommand('file.load', () => { if (api.pickSessionFile) api.pickSessionFile(); else say('msg.fileNoPicker'); });

  for (const [key, command] of [['b', 'file.save'], ['o', 'file.load'], ['u', 'data.reset']]) ctx.registerKey({ key, alt: true, shift: true, command });
}
