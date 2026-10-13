// FR-002: 代替入力（手入力の送信はアプリ本体の submitDraft、ここはテキストファイルの取込）。
// 取込の各行は、取込時の同一の受付時刻を持ち、無音間隔では分割しない（FR-003 AC-044）。
export const MAX_FILE_BYTES = 1 * 1024 * 1024; // PARAM-003: 1 MB

export function validateTextFile({ name, type, size, text }) {
  const n = String(name ?? '');
  const isTxt = /\.txt$/i.test(n);
  const typeOk = !type || String(type).toLowerCase().startsWith('text');
  if (!isTxt || !typeOk || /\u0000/.test(String(text ?? ''))) return 'not_text';
  if (Number(size) > MAX_FILE_BYTES) return 'too_large';
  if (!Number(size) || !String(text ?? '').trim()) return 'empty';
  return null;
}

export function splitLines(text) {
  return String(text).split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
}

export function inputModule(ctx) {
  ctx.i18n.addStrings({
    ja: {
      'input.file': 'テキストファイル（.txt）を取り込む',
      'msg.importTooLarge': 'ファイルが大きすぎます（上限 1 MB）',
      'msg.importNotText': 'テキストファイル（.txt）ではないため取り込めません',
      'msg.importEmpty': 'ファイルが空です',
      'msg.imported': 'ファイルから発話を取り込みました',
    },
    en: {
      'input.file': 'Import a text file (.txt)',
      'msg.importTooLarge': 'The file is too large (limit 1 MB)',
      'msg.importNotText': 'Only text files (.txt) can be imported',
      'msg.importEmpty': 'The file is empty',
      'msg.imported': 'Utterances were imported from the file',
    },
  });
  const REASON_KEY = { too_large: 'msg.importTooLarge', not_text: 'msg.importNotText', empty: 'msg.importEmpty' };
  ctx.api.importTextFile = async (file) => {
    if (ctx.state.session !== 'recording') {
      ctx.change(() => ctx.setMessage('msg.notRecording'));
      return { ok: false, reason: 'not_recording' };
    }
    const reason = validateTextFile(file ?? {});
    if (reason) {
      ctx.change(() => ctx.setMessage(REASON_KEY[reason]));
      return { ok: false, reason };
    }
    const lines = splitLines(file.text);
    if (!lines.length) {
      ctx.change(() => ctx.setMessage('msg.importEmpty'));
      return { ok: false, reason: 'empty' };
    }
    const added = ctx.addUtterances(lines, { at: ctx.now(), noGapSplit: true });
    ctx.transcript?.addFinals(lines.slice(0, added));
    ctx.change(() => ctx.setMessage('msg.imported'));
    return { ok: true, added };
  };
}
