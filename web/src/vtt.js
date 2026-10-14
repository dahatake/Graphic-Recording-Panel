// FR-022: WebVTT（.vtt）から cue ごとの発話テキストを取り出す純関数。話者名・タイムスタンプ・識別子は返さない。
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&nbsp;': '\u00a0', '&amp;': '&' };

export function isWebVtt(text) {
  return /^WEBVTT(?:[ \t\r\n]|$)/.test(String(text ?? '').replace(/^\uFEFF/, ''));
}

export function decodeEntities(s) {
  return s.replace(/&(?:lt|gt|nbsp|amp);/g, (m) => ENTITIES[m]);
}

// 戻り値: 発話になる cue 本文の配列（ファイルの順）
export function parseVtt(text) {
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
    if (body) out.push(body);
  }
  return out;
}
