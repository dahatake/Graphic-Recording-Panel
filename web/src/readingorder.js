// FR-105 読み順の型（AC-607〜609）。DOM・外部通信に依存しない決定的な純粋関数（生成 AI を使わない）。
// 型は図の単位（図全体の要点）で 1 つ。判定の順: 左右比較（PARAM-133）＞ フロー（PARAM-134）＞ F 型（PARAM-135）＞ Z 型（既定）。
// 型は読み順の向きの配置だけを決める（layouttypes.js の timelineLayout が input.readingType で使う）。要点の並び・テキスト一覧（話順）は変えない。
import { phraseEvidence } from './layoutkinds.js';

export const READING_TYPES = ['z', 'f', 'compare', 'flow'];
export const DEFAULT_READING_TYPE = 'z';
export const READING_MODES = ['auto', ...READING_TYPES];

// PARAM-135: 列挙の言い回し。日本語は部分一致。「・」は行頭（または改行の直後）の箇条書きの記号だけ
export const ENUM_PHRASES = ['ひとつ目', '1 つ目', '一つ目', '第一', '第二', 'ほかに', 'また', 'さらに'];
export function enumerationEvidence(text) {
  const s = String(text ?? '').normalize('NFKC');
  for (const w of ENUM_PHRASES) {
    const n = w.normalize('NFKC');
    if (n.includes('つ目') && /\d/.test(n)) { if (/\d\s*つ目/.test(s)) return w; } else if (s.includes(n)) return w;
  }
  if (/(^|\n)\s*・/.test(String(text ?? ''))) return '・';
  return null;
}

// NFR-PERF-003 AC-536: 判定は文字列だけで決まる純粋関数なので、文字列ごとに結果を覚える（選択など別の変更の再描画のたびに、
// 数千件の要点を正規表現で判定し直さない）。件数が上限を超えたら捨てて作り直す。
const EVIDENCE_MEMO_MAX = 20000;
const evidenceMemo = new Map();
function evidencesOf(text) {
  let e = evidenceMemo.get(text);
  if (!e) {
    if (evidenceMemo.size >= EVIDENCE_MEMO_MAX) evidenceMemo.clear();
    e = { opposition: phraseEvidence(text, 'opposition'), nextStep: phraseEvidence(text, 'next-step'), enumeration: enumerationEvidence(text) };
    evidenceMemo.set(text, e);
  }
  return e;
}

// scenes: [{ points:[{ text }] }]（話順）。返り値: { type, reason:'compare'|'flow'|'enumeration'|'default', phrase }
export function detectReadingOrder(scenes) {
  const texts = [];
  for (const sc of scenes ?? []) for (const p of sc.points ?? []) texts.push(String(p.text ?? ''));
  const first = (key) => { for (const t of texts) { const w = evidencesOf(t)[key]; if (w) return w; } return null; };
  let w = first('opposition');
  if (w) return { type: 'compare', reason: 'compare', phrase: w };
  w = first('nextStep');
  if (w) return { type: 'flow', reason: 'flow', phrase: w };
  w = first('enumeration');
  if (w) return { type: 'f', reason: 'enumeration', phrase: w };
  return { type: DEFAULT_READING_TYPE, reason: 'default', phrase: null };
}

// 手動の選択（mode が READING_TYPES のどれか）は自動の判定より優先する。
export function resolveReadingOrder(scenes, mode = 'auto') {
  if (READING_TYPES.includes(mode)) return { type: mode, reason: 'manual', phrase: null };
  return detectReadingOrder(scenes);
}
