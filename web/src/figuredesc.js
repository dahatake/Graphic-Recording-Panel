// FR-096 AC-561〜563: 図の説明（主なテーマ・関係・結論・未解決事項）を、生成 AI を使わずに決定的に文章にする純関数。
// 外部通信なし・同じ入力は同じ文章。文字は素の文字列のまま返す（SVG・HTML への埋め込みは呼び出し側がエスケープする）。
// 注意: 議題が 0 件の出力に「議題」の語が現れないよう、説明の見出しは「議題」の語を使わない（AC-560）。
const MAX_ITEMS = 30;
const MAX_CHARS = 120;
const LABELS = {
  ja: { title: '表題', purpose: '目的', audience: '対象読者', topics: '主なテーマ', relations: '関係', conclusions: '結論', unresolved: '未解決事項', none: 'なし', sep: '、' },
  en: { title: 'Title', purpose: 'Purpose', audience: 'Audience', topics: 'Main themes', relations: 'Relations', conclusions: 'Conclusions', unresolved: 'Open items', none: 'None', sep: ', ' },
};
const one = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
const cut = (s) => { const a = [...s]; return a.length > MAX_CHARS ? `${a.slice(0, MAX_CHARS - 1).join('')}…` : s; };
const clean = (list) => (Array.isArray(list) ? list : []).map(one).filter(Boolean).map(cut);

export function buildFigureDescription({ title = '', purpose = '', audience = '', topics = [], relations = [], conclusions = [], unresolved = [], lang = 'ja', extra = [] } = {}) {
  const L = LABELS[lang === 'en' ? 'en' : 'ja'];
  const lines = [];
  const head = one(title);
  if (head) lines.push(`${L.title}: ${head}`);
  if (one(purpose)) lines.push(`${L.purpose}: ${cut(one(purpose))}`);
  if (one(audience)) lines.push(`${L.audience}: ${cut(one(audience))}`);
  for (const [key, list] of [['topics', topics], ['relations', relations], ['conclusions', conclusions], ['unresolved', unresolved]]) {
    const items = clean(list);
    const shown = items.slice(0, MAX_ITEMS);
    const more = items.length > shown.length ? `${L.sep}…(+${items.length - shown.length})` : '';
    lines.push(`${L[key]}: ${shown.length ? shown.join(L.sep) + more : L.none}`);
  }
  // FR-104 AC-604・AC-606: 公開範囲（と除外した件数）の行（呼び出し側が組み立てた文字列）
  for (const x of Array.isArray(extra) ? extra : []) if (one(x)) lines.push(one(x));
  return { title: head, text: lines.join('\n') };
}

export const xmlEscape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
