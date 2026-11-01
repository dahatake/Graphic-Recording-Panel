// FR-093 用語集と認識語彙の事前登録（契約: tests/system/CONTRACT-REVIEW.md「用語集」）。
// - 語（正しい表記）と任意の別表記を登録・編集・削除する。上限は PARAM-122（500 件）。空・重複（前後の空白と全角・半角の違いを除く）は追加しない。
// - 発話の記録時に別表記を正しい表記へ置き換える（ctx.applyGlossary。音声・手入力・ファイル取込のすべてが ctx.addUtterances を通る）。
// - Azure Speech かつ同意があるときだけ、認識の開始時に語（term だけ）を phrase list として渡す（speech.js が api.getGlossaryPhrases を呼ぶ）。
// - 用語集はセッション（grp.session・file.save）に含まれ、データの初期化で消える。外部へは何も送らない。

export const GLOSSARY_LIMIT = 500; // PARAM-122
const TERM_MAX = 100;
const VARIANTS_MAX = 20;

// 前後の空白と全角・半角の違いを除いた比較用の形（重複判定）
export const normTerm = (s) => String(s ?? '').normalize('NFKC').trim();
const key = (s) => normTerm(s).toLowerCase();

export const emptyGlossary = () => ({ terms: [], seq: 0 });

function cleanVariants(variants, term) {
  const out = []; const seen = new Set([key(term)]);
  for (const v of Array.isArray(variants) ? variants : []) {
    const t = String(v ?? '').trim();
    if (!t || seen.has(key(t))) continue;
    seen.add(key(t)); out.push([...t].slice(0, TERM_MAX).join(''));
    if (out.length >= VARIANTS_MAX) break;
  }
  return out;
}

// 保存された用語集の検証（壊れていれば空）。
export function parseGlossary(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.terms)) return emptyGlossary();
  const terms = []; const seen = new Set();
  for (const t of raw.terms) {
    if (!t || typeof t.id !== 'string' || typeof t.term !== 'string') continue;
    const term = t.term.trim();
    if (!term || seen.has(key(term)) || terms.length >= GLOSSARY_LIMIT) continue;
    seen.add(key(term));
    terms.push({ id: t.id, term, variants: cleanVariants(t.variants, term) });
  }
  const seq = Number.isInteger(raw.seq) && raw.seq >= 0 ? raw.seq : terms.length;
  return { terms, seq: Math.max(seq, terms.length) };
}

// 別表記を正しい表記へ置き換える（長い別表記を先に。決定的）。
export function replaceVariants(text, terms) {
  const pairs = [];
  for (const t of terms) for (const v of t.variants) pairs.push([v, t.term]);
  pairs.sort((a, b) => b[0].length - a[0].length);
  let out = String(text);
  for (const [v, term] of pairs) if (v && out.includes(v)) out = out.split(v).join(term);
  return out;
}

export function glossaryModule(ctx) {
  const { state, api } = ctx;
  if (!state.glossary) state.glossary = emptyGlossary();
  const g = () => state.glossary;
  const fail = (reason) => ({ ok: false, reason });

  ctx.applyGlossary = (text) => replaceVariants(text, g().terms);

  api.getGlossary = () => ({ terms: g().terms.map((t) => ({ id: t.id, term: t.term, variants: [...t.variants] })), count: g().terms.length, limit: GLOSSARY_LIMIT });
  api.addGlossaryTerm = ({ term, variants } = {}) => {
    const tm = String(term ?? '').trim();
    if (!tm) return fail('empty');
    if (g().terms.length >= GLOSSARY_LIMIT) return fail('limit');
    if (g().terms.some((t) => key(t.term) === key(tm))) return fail('duplicate');
    let id = '';
    ctx.change((s) => {
      s.glossary.seq += 1; id = `g${s.glossary.seq}`;
      s.glossary.terms.push({ id, term: tm, variants: cleanVariants(variants, tm) });
    });
    return { ok: true, id };
  };
  api.updateGlossaryTerm = (id, { term, variants } = {}) => {
    const cur = g().terms.find((t) => t.id === id);
    if (!cur) return fail('not_found');
    const tm = String(term ?? '').trim();
    if (!tm) return fail('empty');
    if (g().terms.some((t) => t.id !== id && key(t.term) === key(tm))) return fail('duplicate');
    ctx.change(() => { cur.term = tm; cur.variants = cleanVariants(variants, tm); });
    return { ok: true };
  };
  api.removeGlossaryTerm = (id) => {
    if (!g().terms.some((t) => t.id === id)) return fail('not_found');
    ctx.change((s) => { s.glossary.terms = s.glossary.terms.filter((t) => t.id !== id); });
    return { ok: true };
  };
  // AC-551: 認識語彙（phrase list）として送る語。正しい表記だけ（別表記・会議の内容は含めない）。
  api.getGlossaryPhrases = () => g().terms.map((t) => t.term);
  // セッションの保存・復元・初期化（session.js・app.js が使う）
  api.exportGlossary = () => ({ terms: g().terms.map((t) => ({ id: t.id, term: t.term, variants: [...t.variants] })), seq: g().seq });
}
