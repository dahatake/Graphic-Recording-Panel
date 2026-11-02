// FR-093 用語集と認識語彙の事前登録（契約: tests/system/CONTRACT-REVIEW.md「用語集」）。
// - 語（正しい表記）と任意の別表記を登録・編集・削除する。上限は PARAM-122（500 件）。空・重複（前後の空白と全角・半角の違いを除く）は追加しない。
// - 発話の記録時に別表記を正しい表記へ置き換える（ctx.applyGlossary。音声・手入力・ファイル取込のすべてが ctx.addUtterances を通る）。
// - 用語集の語は認識のために外部へ送らない（Azure Speech でも。AC-551）。認識後の表記の統一だけが効く。
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

  // NFR-A11Y-001 AC-036: 用語集を開く操作（キーだけで実行できる）。状態は aria-live のメッセージで知らせ、用語の一覧は書き出し済みの API で読める。
  ctx.i18n.addStrings({
    ja: { 'msg.glossaryOpen': '用語集を開きました' },
    en: { 'msg.glossaryOpen': 'The glossary was opened' },
  });
  ctx.i18n.addStrings({
    ja: {
      'glossary.title': '用語集', 'glossary.term': '正しい表記', 'glossary.variants': '別表記（読点・カンマ区切り。任意）',
      'glossary.add': '追加', 'glossary.update': '更新', 'glossary.close': '閉じる', 'glossary.edit': '編集', 'glossary.delete': '削除',
      'glossary.count': '件', 'glossary.none': '（登録なし）', 'glossary.variantsLabel': '別表記',
      'glossary.err.empty': '語が空のため追加できません', 'glossary.err.duplicate': '同じ語がすでに登録されているため追加できません',
      'glossary.err.limit': '上限（{n} 件）に達しているため追加できません', 'glossary.err.not_found': '対象の語が見つかりません',
      'glossary.hint': 'Tab で移動、Enter で追加・編集、Delete で削除、Esc で閉じる',
    },
    en: {
      'glossary.title': 'Glossary', 'glossary.term': 'Correct spelling', 'glossary.variants': 'Variants (comma-separated, optional)',
      'glossary.add': 'Add', 'glossary.update': 'Update', 'glossary.close': 'Close', 'glossary.edit': 'Edit', 'glossary.delete': 'Delete',
      'glossary.count': 'items', 'glossary.none': '(none registered)', 'glossary.variantsLabel': 'Variants',
      'glossary.err.empty': 'The term is empty, so it was not added', 'glossary.err.duplicate': 'The same term is already registered, so it was not added',
      'glossary.err.limit': 'The limit ({n} items) is reached, so it was not added', 'glossary.err.not_found': 'The term was not found',
      'glossary.hint': 'Tab to move, Enter to add or edit, Delete to remove, Esc to close',
    },
  });

  // 用語集の画面（AC-549）。状態は保存対象ではない（登録した語だけが g() に入る）。
  let open = false; let focusId = null; let outerFocus = null; let editingId = null; let error = null;
  let input = { term: '', variants: '' };
  const baseFocused = api.getFocusedElement;
  api.getFocusedElement = () => (open ? focusId : (baseFocused ? baseFocused() : outerFocus));
  const notify = () => ctx.emit('change', api);
  const errText = (reason) => ctx.t(`glossary.err.${reason}`).replace('{n}', String(GLOSSARY_LIMIT));
  const countText = () => `${g().terms.length}／${GLOSSARY_LIMIT} ${ctx.t('glossary.count')}`;
  const splitVariants = (s) => String(s ?? '').split(/[、,，\n]/).map((x) => x.trim()).filter(Boolean);
  const order = () => ['glossary.term', 'glossary.variants', 'glossary.add', 'glossary.close', ...g().terms.map((x) => `glossary.item.${x.id}`)];

  api.getGlossaryView = () => (!open ? null : {
    open: true, role: 'dialog', label: ctx.t('glossary.title'),
    items: g().terms.map((x) => ({ id: x.id, term: x.term, variants: [...x.variants] })),
    count: g().terms.length, limit: GLOSSARY_LIMIT, countText: countText(), error,
    input: { ...input }, editingId, focus: focusId, tabOrder: order(),
  });
  api.setGlossaryInput = ({ term, variants } = {}) => {
    if (term !== undefined) input.term = String(term);
    if (variants !== undefined) input.variants = String(variants);
    notify();
  };
  api.submitGlossaryInput = () => {
    const vs = splitVariants(input.variants);
    let r;
    if (editingId) r = api.updateGlossaryTerm(editingId, { term: input.term, variants: vs });
    else r = api.addGlossaryTerm({ term: input.term, variants: vs });
    if (r.ok) { error = null; input = { term: '', variants: '' }; editingId = null; focusId = 'glossary.term'; }
    else error = errText(r.reason);
    notify();
    return r.ok ? { ok: true } : { ok: false, reason: errText(r.reason), code: r.reason };
  };
  api.editGlossaryItem = (id) => {
    const cur = g().terms.find((x) => x.id === id);
    if (!cur) return { ok: false, reason: 'not_found' };
    editingId = id; input = { term: cur.term, variants: cur.variants.join('、') }; error = null; focusId = 'glossary.term'; notify();
    return { ok: true };
  };
  api.renderGlossary = () => {
    if (!open) return '';
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const items = g().terms.map((x) => `<li data-id="${esc(x.id)}">${esc(x.term)}${x.variants.length ? ` — ${esc(ctx.t('glossary.variantsLabel'))}: ${esc(x.variants.join('、'))}` : ''}</li>`).join('');
    return `<section role="dialog" aria-modal="true" aria-label="${esc(ctx.t('glossary.title'))}"><h2>${esc(ctx.t('glossary.title'))}</h2>`
      + `<p role="status">${esc(countText())}</p>${error ? `<p role="alert">${esc(error)}</p>` : ''}`
      + `<label>${esc(ctx.t('glossary.term'))} <input type="text" value="${esc(input.term)}"></label>`
      + `<label>${esc(ctx.t('glossary.variants'))} <input type="text" value="${esc(input.variants)}"></label>`
      + `<button type="button">${esc(ctx.t(editingId ? 'glossary.update' : 'glossary.add'))}</button><button type="button">${esc(ctx.t('glossary.close'))}</button>`
      + `<ul aria-label="${esc(ctx.t('glossary.title'))}">${items || `<li>${esc(ctx.t('glossary.none'))}</li>`}</ul></section>`;
  };
  const openView = () => {
    if (!open) { outerFocus = baseFocused ? baseFocused() : outerFocus; }
    open = true; focusId = 'glossary.term'; error = null; editingId = null; input = { term: '', variants: '' };
    ctx.change(() => ctx.setMessage('msg.glossaryOpen'));
    return { ok: true, count: g().terms.length };
  };
  const closeView = () => {
    if (!open) return { ok: true };
    open = false; focusId = null; editingId = null; error = null; input = { term: '', variants: '' };
    api.setFocusedElement?.(outerFocus); notify();
    return { ok: true };
  };
  ctx.registerCommand('glossary.open', openView);
  ctx.registerCommand('glossary.close', closeView);
  ctx.registerKey({ key: ',', alt: true, shift: true, command: 'glossary.open' });
  api.focusGlossary = (id) => { if (!open || !order().includes(id)) return false; focusId = id; notify(); return true; };

  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    const k = String(ev?.key);
    if (!open || ev?.ctrlKey || ev?.altKey || ev?.metaKey) return baseKey(ev);
    if (k === 'Escape') {
      if (editingId) { editingId = null; input = { term: '', variants: '' }; error = null; focusId = 'glossary.term'; notify(); return 'glossary.cancelEdit'; }
      closeView(); return 'glossary.close';
    }
    const ord = order();
    if (k === 'Tab') { const i = ord.indexOf(focusId); focusId = ord[(i < 0 ? 0 : i + (ev.shiftKey ? ord.length - 1 : 1)) % ord.length]; notify(); return 'glossary.focus'; }
    const isItem = String(focusId).startsWith('glossary.item.');
    if (isItem && (k === 'ArrowDown' || k === 'ArrowUp')) {
      const items = ord.filter((x) => x.startsWith('glossary.item.')); const i = items.indexOf(focusId);
      focusId = items[Math.max(0, Math.min(items.length - 1, i + (k === 'ArrowDown' ? 1 : -1)))]; notify(); return 'glossary.focus';
    }
    if (isItem && k === 'Delete') {
      const id = focusId.slice('glossary.item.'.length); const items = ord.filter((x) => x.startsWith('glossary.item.')); const i = items.indexOf(focusId);
      api.removeGlossaryTerm(id);
      const rest = order().filter((x) => x.startsWith('glossary.item.'));
      focusId = rest.length ? rest[Math.min(i, rest.length - 1)] : 'glossary.term'; notify(); return 'glossary.delete';
    }
    if (k === 'Enter') {
      if (isItem) { api.editGlossaryItem(focusId.slice('glossary.item.'.length)); return 'glossary.edit'; }
      if (focusId === 'glossary.close') { closeView(); return 'glossary.close'; }
      api.submitGlossaryInput(); return 'glossary.submit';
    }
    return baseKey(ev);
  };

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
  // セッションの保存・復元・初期化（session.js・app.js が使う）
  api.exportGlossary = () => ({ terms: g().terms.map((t) => ({ id: t.id, term: t.term, variants: [...t.variants] })), seq: g().seq });
}
