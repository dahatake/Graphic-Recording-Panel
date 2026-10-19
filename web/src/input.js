// FR-002: 代替入力（手入力の送信はアプリ本体の submitDraft、ここはテキストファイルの取込）。
// 取込の各行は、取込時の同一の受付時刻を持ち、無音間隔では分割しない（FR-003 AC-044）。
// FR-022: .vtt（WebVTT）は vtt.js の純関数で cue ごとの本文だけを取り出す。
import { isWebVtt, parseVttCues } from './vtt.js';
export const MAX_FILE_BYTES = 1 * 1024 * 1024; // PARAM-003: 1 MB

export function validateTextFile({ name, type, size, text }) {
  const n = String(name ?? '');
  const isVtt = /\.vtt$/i.test(n);
  const isTxt = /\.txt$/i.test(n) || isVtt;
  const typeOk = !type || String(type).toLowerCase().startsWith('text');
  if (!isTxt || !typeOk || /\u0000/.test(String(text ?? ''))) return 'not_text';
  if (Number(size) > MAX_FILE_BYTES) return 'too_large';
  if (isVtt && !isWebVtt(text)) return 'not_vtt';
  if (!Number(size) || !String(text ?? '').trim()) return 'empty';
  return null;
}

export function splitLines(text) {
  return String(text).split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
}

export function inputModule(ctx) {
  ctx.i18n.addStrings({
    ja: {
      'input.file': 'テキストファイル（.txt）・字幕ファイル（.vtt）を取り込む',
      'msg.importTooLarge': 'ファイルが大きすぎます（上限 1 MB）',
      'msg.importNotText': 'テキストファイル（.txt・.vtt）ではないため取り込めません',
      'msg.importNotVtt': 'WebVTT 形式ではないため取り込めません',
      'msg.importEmpty': 'ファイルが空です',
      'msg.imported': 'ファイルから発話を取り込みました',
      'msg.importBusy': '別の取込を処理中です',
      'import.label.processing': '処理中', 'import.label.done': '完了', 'import.label.failed': '失敗',
      'import.addedPrefix': '', 'import.addedSuffix': ' 件の発話を追加しました',
      'import.next.tooLarge': '1 MB 以下のファイルを選んでください', 'import.next.notVtt': '先頭が WEBVTT の字幕ファイルを選んでください',
      'import.next.notText': '.txt または .vtt のテキストファイルを選んでください', 'import.next.empty': '発話を含むファイルを選んでください',
      'import.next.notRecording': '記録を開始・再開してから、同じファイルをもう一度選んでください', 'import.next.busy': '処理が終わってからもう一度選んでください',
    },
    en: {
      'input.file': 'Import a text file (.txt) or caption file (.vtt)',
      'msg.importTooLarge': 'The file is too large (limit 1 MB)',
      'msg.importNotText': 'Only text files (.txt, .vtt) can be imported',
      'msg.importNotVtt': 'Not a WebVTT file, so it cannot be imported',
      'msg.importEmpty': 'The file is empty',
      'msg.imported': 'Utterances were imported from the file',
      'msg.importBusy': 'Another import is in progress',
      'import.label.processing': 'Processing', 'import.label.done': 'Done', 'import.label.failed': 'Failed',
      'import.addedPrefix': 'Added ', 'import.addedSuffix': ' utterances',
      'import.next.tooLarge': 'Choose a file of 1 MB or less', 'import.next.notVtt': 'Choose a caption file that starts with WEBVTT',
      'import.next.notText': 'Choose a .txt or .vtt text file', 'import.next.empty': 'Choose a file that has utterances',
      'import.next.notRecording': 'Start or resume recording, then choose the same file again', 'import.next.busy': 'Wait until it finishes, then choose the file again',
    },
  });
  const REASON_KEY = { too_large: 'msg.importTooLarge', not_vtt: 'msg.importNotVtt', not_text: 'msg.importNotText', empty: 'msg.importEmpty', not_recording: 'msg.notRecording', busy: 'msg.importBusy' };
  const NEXT_KEY = { too_large: 'import.next.tooLarge', not_vtt: 'import.next.notVtt', not_text: 'import.next.notText', empty: 'import.next.empty', not_recording: 'import.next.notRecording', busy: 'import.next.busy' };
  // FR-023: 取込の状態（idle / processing / done / failed）。文字は表示言語で組み立てる。
  const imp = { state: 'idle', processed: 0, total: 0, added: null, reason: null, inputReset: false };
  let running = false;
  const CHUNK = 50; // 契約: 50 cue（行）ごとに importYield を 1 回呼ぶ
  const yieldFn = () => (ctx.options.importYield ? ctx.options.importYield() : new Promise((r) => globalThis.setTimeout(r, 0)));
  const setImp = (patch) => { ctx.change(() => { Object.assign(imp, patch); }); };
  ctx.api.getImportStatus = () => {
    const t = ctx.t;
    const label = imp.state === 'idle' ? '' : t(`import.label.${imp.state}`);
    let text = '';
    if (imp.state === 'processing') text = `${label}: ${imp.processed} / ${imp.total}`;
    else if (imp.state === 'done') text = `${label}: ${t('import.addedPrefix')}${imp.added}${t('import.addedSuffix')}`;
    else if (imp.state === 'failed') text = `${label}: ${t(REASON_KEY[imp.reason])}。${t(NEXT_KEY[imp.reason])}`;
    const failed = imp.state === 'failed';
    return {
      state: imp.state, label, processed: imp.processed, total: imp.total,
      added: imp.state === 'done' ? imp.added : null,
      reason: failed ? imp.reason : null,
      nextAction: failed ? t(NEXT_KEY[imp.reason]) : null,
      text, role: failed ? 'alert' : 'status', live: failed ? 'assertive' : 'polite',
      inputReset: imp.inputReset,
    };
  };
  const fail = (reason) => {
    setImp({ state: 'failed', reason, processed: 0, total: 0, added: null, inputReset: true });
    ctx.change(() => ctx.setMessage(REASON_KEY[reason]));
    return { ok: false, reason };
  };
  ctx.registerCommand('file.import', () => ctx.emit('ui:pickImportFile'));
  ctx.registerCommand('import.file', () => ctx.emit('ui:pickImportFile')); // FR-073: 最上部のコマンドバーの「取り込み」（入口は importTextFile の 1 つ）
  ctx.registerKey({ key: 'w', alt: true, shift: true, command: 'import.file' });
  ctx.registerKey({ key: '4', alt: true, shift: true, command: 'file.import' });
  ctx.api.importTextFile = async (file) => {
    // AC-121: 取込の最中に重ねて実行しても、同じ発話を重複して追加しない
    if (running) { ctx.change(() => ctx.setMessage('msg.importBusy')); return { ok: false, reason: 'busy' }; }
    const reason = validateTextFile(file ?? {});
    if (reason) return fail(reason);
    const isVtt = /\.vtt$/i.test(String(file.name));
    const cues = isVtt ? parseVttCues(file.text) : null;
    const lines = cues ? cues.map((c) => c.text) : splitLines(file.text);
    if (!lines.length) return fail('empty');
    running = true;
    try {
      setImp({ state: 'processing', reason: null, processed: 0, total: lines.length, added: null, inputReset: false });
      const base = ctx.now();
      // FR-022 AC-113: 最初の cue=取込時刻、以降は開始時刻の差だけ遅らせる（読めない・戻る cue は直前の時刻）
      let ats;
      if (cues) {
        let first = null; let prev = 0;
        ats = cues.map((c) => {
          if (c.startMs != null) { if (first == null) first = c.startMs; prev = Math.max(prev, c.startMs - first); }
          return base + prev;
        });
      }
      let added = 0;
      for (let from = 0; from < lines.length; from += CHUNK) {
        const part = lines.slice(from, from + CHUNK);
        const n = ctx.addUtterances(part, cues ? { ats: ats.slice(from, from + CHUNK), anyState: true } : { at: base, noGapSplit: true, anyState: true });
        ctx.transcript?.addFinals(part.slice(0, n));
        added += n;
        if (n < part.length) break; // 途中で記録中でなくなった
        setImp({ processed: from + part.length });
        if (from + CHUNK < lines.length) await yieldFn();
      }
      if (!added) return fail('empty');
      setImp({ state: 'done', added, reason: null, inputReset: true });
      ctx.change(() => ctx.setMessage('msg.imported'));
      return { ok: true, added };
    } finally { running = false; }
  };
}
