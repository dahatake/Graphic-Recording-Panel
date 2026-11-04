// FR-022: WebVTT（.vtt）から cue ごとの発話テキストを取り出す純関数。タイムスタンプ・識別子は本文に含めない。
// 話者タグ（<v 名前>）の名前は本文から除き、parseVttCues の speaker として別に返す（会議ボード型の人物に添える名前だけに使う。AC-117・AC-668）。
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

// FR-022 AC-113: 各 cue の受付時刻の、最初の cue からの差（ミリ秒）。読めない・戻る cue は直前の差を使う（一括取込・再生取込で共通。AC-671）
export function cueOffsets(cues) {
  let first = null; let prev = 0;
  return cues.map((c) => {
    if (c.startMs != null) { if (first == null) first = c.startMs; prev = Math.max(prev, c.startMs - first); }
    return prev;
  });
}

// FR-022 AC-668: cue の最初の話者タグ（<v 名前> / <v.class 名前>）の名前。なければ null。名前は文字としてだけ扱う（本文には含めない）
export function cueSpeaker(bodyLines) {
  for (const l of bodyLines) {
    const m = /<v(?:\.[^\s>]*)?[ \t]+([^>]+)>/.exec(l);
    if (m) { const n = decodeEntities(m[1]).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); if (n) return n; }
  }
  return null;
}

// 戻り値: 発話になる cue の { text, startMs（読めなければ null）, speaker?（話者タグの名前） } の配列（ファイルの順）
export function parseVttCues(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');
  const blocks = src.split(/\n[ \t]*\n/).map((b) => b.split('\n').filter((l, i, a) => l.trim() || a.slice(0, i).some((x) => x.trim())));
  const out = [];
  for (const [i, lines] of blocks.entries()) {
    if (i === 0) continue; // WEBVTT ヘッダのブロック
    if (/^(NOTE|STYLE|REGION)(?:[ \t]|$)/.test(lines[0])) continue;
    const t = lines.findIndex((l) => l.includes('-->'));
    if (t < 0) continue;
    const bodyLines = lines.slice(t + 1);
    const body = bodyLines
      .map((l) => decodeEntities(l.replace(/<[^>]*>/g, '')).trim())
      .filter(Boolean)
      .join(' ');
    if (body) { const speaker = cueSpeaker(bodyLines); out.push({ text: body, startMs: parseCueStart(lines[t]), ...(speaker ? { speaker } : {}) }); }
  }
  return out;
}

