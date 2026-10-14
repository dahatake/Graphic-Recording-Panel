// FR-022: WebVTT（.vtt）から cue ごとの発話テキストを取り出す純関数。話者名・タイムスタンプ・識別子は返さない。
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&nbsp;': '\u00a0', '&amp;': '&' };

export function isWebVtt(text) {
  return /^WEBVTT(?:[ \t\r\n]|$)/.test(String(text ?? '').replace(/^\uFEFF/, ''));
}

export function decodeEntities(s) {
  return s.replace(/&(?:lt|gt|nbsp|amp);/g, (m) => ENTITIES[m]);
}

// cue 開始時刻（hh:mm:ss.mmm / mm:ss.mmm）をミリ秒に。読めなければ null。
export function parseCueStart(line) {
  const m = /^\s*(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{3})\s*-->/.exec(line);
  return m ? ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]) : null;
}

// 戻り値: 本文の配列（ファイルの順）
export function parseVtt(text) { return parseVttCues(text).map((c) => c.text); }

// 戻り値: 発話になる cue の { text, startMs（読めなければ null） } の配列（ファイルの順）
export function parseVttCues(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');
  const blocks = src.split(/\n[ \t]*\n/).map((b) => b.split('\n').filter((l, i, a) => l.trim() || a.slice(0, i).some((x) => x.trim())));
  const out = [];
  for (const [i, lines] of blocks.entries()) {
    if (i === 0) continue; // WEBVTT ヘッダのブロック
    if (/^(NOTE|STYLE|REGION)(?:[ \t]|$)/.test(lines[0])) continue;
    const t = lines.findIndex((l) => l.includes('-->'));
    if (t < 0) continue;
    const body = lines.slice(t + 1)
      .map((l) => decodeEntities(l.replace(/<[^>]*>/g, '')).trim())
      .filter(Boolean)
      .join(' ');
    if (body) out.push({ text: body, startMs: parseCueStart(lines[t]) });
  }
  return out;
}

