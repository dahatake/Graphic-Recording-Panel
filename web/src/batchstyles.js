// FR-119 グラレコスタイルの定義（共通部品「グラレコスタイルの定義」）。DOM に依存しない。
// 各スタイル: { id, icon, label{ja,en}, description{ja,en}, drawStyle, layout, sources[SRC-ID], kinds[U|I|A] }
//   drawStyle … 既存の描画スタイル（FR-029・FR-075・FR-076）の ID への参照。新しい描画スタイルは作らない。
//   layout    … 既存のレイアウト型（FR-027。layouttypes.js）の考え方。LLM への指示にだけ使い、図の型の決まり方（FR-030）は変えない。
// LLM への指示（Prompt 本文）は端末に置かない。中継サーバー（server/batch_styles.py）が styleId から固定文を引く（AC-690・AC-695）。
// 定義を足すだけでスタイルは増やせる（registerBatchStyle。FR-029 の拡張点と同じ。重複・欠けた定義は加えない）。
import { LAYOUT_TYPE_IDS } from './layouttypes.js';

export const BATCH_STYLE_LABEL_MAX = 6; // PARAM-011（全角。英語は半角でその 2 倍）
export const BATCH_STYLE_DESC_MAX = 40; // PARAM-170（日本語。英語は半角でその 2 倍）
export const SOURCE_KINDS = ['U', 'I', 'A']; // (U) 利用者が提示 (I) インターネット (A) 添付ファイル

// SRC-ID → 区分（3.8「収集元の区分」）。
export const SOURCE_KIND_OF = {
  'SRC-060': 'U', 'SRC-011': 'U',
  'SRC-061': 'I', 'SRC-062': 'I', 'SRC-007': 'I',
  'SRC-090': 'A',
};

const def = (id, icon, ja, en, dja, den, drawStyle, layout, sources) => ({
  id, icon, label: { ja, en }, description: { ja: dja, en: den }, drawStyle, layout, sources,
});

export const BUILTIN_BATCH_STYLES = [
  def('talk', '🎤', '講演まとめ', 'Talk Summary', '話の流れを順に追って要点をまとめる', 'Follow the talk in order and sum up the key points', 'yellowBlack', 'timeline', ['SRC-060', 'SRC-011']),
  def('dialogue', '💬', '対談・対話', 'Dialogue', '発言のやり取りを吹き出しでつなぐ', 'Link the exchange of remarks with speech bubbles', 'warmCards', 'bubble', ['SRC-011', 'SRC-061']),
  def('brainstorm', '🗒️', 'アイデア発散', 'Brainstorm', '意見をテーマの周りに集め、同じ種類を囲む', 'Gather ideas around the theme and group similar ones', 'stickyNotes', 'diverge', ['SRC-011', 'SRC-061', 'SRC-090']),
  def('keypoints', '🔲', '要点整理', 'Key Points', '論点を 2〜4 の区画に分けて整理する', 'Organize the issues into 2 to 4 sections', 'mintNote', 'zone', ['SRC-011', 'SRC-062']),
  def('journey', '⛰️', '振り返り', 'Journey', '道や山のたとえに内容を置いて見せる', 'Show the content on a path or mountain metaphor', 'kraftPaper', 'metaphor', ['SRC-011', 'SRC-061']),
  def('notes', '📓', '授業ノート', 'Study Notes', '黒板やノートに学びを書き留める', 'Write down what was learned on a blackboard or notebook', 'chalkboard', 'timeline', ['SRC-061']),
  def('wsboard', '📋', 'WS記録', 'WS Board', 'ボードの内容を課題・問い・次の一歩に整理する', 'Sort the board into issues, questions and next steps', 'colorPencil', 'board', ['SRC-090', 'SRC-011']),
  def('biz', '📊', 'ビジネス資料', 'Biz Brief', '余白を生かして簡潔に洗練して要約する', 'Summarize concisely and cleanly with generous margins', 'business', 'timeline', ['SRC-062', 'SRC-061', 'SRC-090']),
];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
// 全角を 1、半角を 0.5 として数える（ja 上限をそのまま、en は半角 2 倍で測る）。
const width = (s) => [...s].reduce((n, ch) => n + (ch.charCodeAt(0) <= 0x7e || (ch.charCodeAt(0) >= 0xff61 && ch.charCodeAt(0) <= 0xff9f) ? 0.5 : 1), 0);

// 定義の検証。{ ok:true } か { ok:false, reason }。
export function validateBatchStyle(d, { drawStyleIds } = {}) {
  if (!isObj(d) || !nonEmpty(d.id)) return { ok: false, reason: 'invalid_id' };
  if (!nonEmpty(d.icon)) return { ok: false, reason: 'invalid_icon' };
  for (const k of ['label', 'description']) {
    if (!isObj(d[k]) || !nonEmpty(d[k].ja) || !nonEmpty(d[k].en)) return { ok: false, reason: `invalid_${k}` };
  }
  if (width(d.label.ja) > BATCH_STYLE_LABEL_MAX || width(d.label.en) > BATCH_STYLE_LABEL_MAX) return { ok: false, reason: 'label_too_long' };
  if (width(d.description.ja) > BATCH_STYLE_DESC_MAX || width(d.description.en) > BATCH_STYLE_DESC_MAX) return { ok: false, reason: 'description_too_long' };
  if (!nonEmpty(d.drawStyle) || (Array.isArray(drawStyleIds) && !drawStyleIds.includes(d.drawStyle))) return { ok: false, reason: 'invalid_draw_style' };
  if (!LAYOUT_TYPE_IDS.includes(d.layout)) return { ok: false, reason: 'invalid_layout' };
  if (!Array.isArray(d.sources) || d.sources.length === 0 || !d.sources.every((s) => /^SRC-\d+$/.test(s))) return { ok: false, reason: 'invalid_sources' };
  return { ok: true };
}

// 登録簿。既定で 8 つ。重複・不正な定義は加えず、既存の登録は変えない。
export function createBatchStyleRegistry({ initial = BUILTIN_BATCH_STYLES, drawStyleIds } = {}) {
  const map = new Map();
  const api = {
    register(d) {
      const v = validateBatchStyle(d, { drawStyleIds });
      if (!v.ok) return v;
      if (map.has(d.id)) return { ok: false, reason: 'duplicate' };
      map.set(d.id, JSON.parse(JSON.stringify(d)));
      return { ok: true };
    },
    has: (id) => typeof id === 'string' && map.has(id),
    get: (id) => (typeof id === 'string' && map.has(id) ? JSON.parse(JSON.stringify(map.get(id))) : null),
    ids: () => [...map.keys()],
    // 端末へ出す一覧（instruction を持たない。AC-690）。drawStyle は既存の描画スタイルの ID。
    list(lang = 'ja') {
      const l = lang === 'en' ? 'en' : 'ja';
      return [...map.values()].map((d) => ({
        id: d.id, icon: d.icon, label: d.label[l], description: d.description[l], drawStyle: d.drawStyle, sources: [...d.sources],
      }));
    },
  };
  for (const d of initial) api.register(d);
  return api;
}
