// FR-092「要確認」の印と確認状態／FR-024 AC-572・AC-573（元の発話・AI 要約の印）。契約: tests/system/CONTRACT-REVIEW.md
// - 判定（judgeReview）は純関数。規則だけで決める（決定的・外部通信なし・生成 AI を使わない。G-002）。
// - 確認状態は要点の confirmedAt（'YYYY-MM-DD HH:mm'・端末のローカル時刻）で持つ。印・確認日はセッションの保存で復元される。
// - 印は文字「要確認」と枠つきの記号で示す（色だけにしない。AC-231 と同じ方針）。図・ポップアップ・テキスト一覧が同じ語を使う。
import { escapeHtml } from './outline.js';

export const UNDO_LIMIT = 50; // PARAM-123

// ---- 判定（AC-544） ----
const NUM_RE = /[0-9０-９]|[〇二三四五六七八九十百千万億兆]|一(?=[つ日月年人回番時分秒件台個本枚円万千百十])/u;
const DATE_RE = /[0-9０-９〇一二三四五六七八九十]+\s*[年月日]|[月火水木金土日]曜|来週|再来週|今週|先週|明日|明後日|昨日|今日|来月|先月|今月|来年|去年|今年|翌日|翌週|翌月/u;
const PROPER_RE = /[ァ-ヶー]{3,}|[A-ZＡ-Ｚ]{3,}|(?<!く)さん|(?<![同多異模各仕一])様(?![々子式態])|株式会社|有限会社|合同会社|（株）|\(株\)|㈱/u;
export const REASONS = ['number', 'date', 'proper', 'ai', 'provisional'];

export function judgeReview(text, { glossary = [], aiGuess = false, provisional = false } = {}) {
  const s = String(text ?? '');
  const reasons = [];
  if (NUM_RE.test(s)) reasons.push('number');
  if (DATE_RE.test(s)) reasons.push('date');
  const low = s.normalize('NFKC').toLowerCase();
  if (PROPER_RE.test(s) || (glossary ?? []).some((g) => { const k = String(g ?? '').normalize('NFKC').trim().toLowerCase(); return k && low.includes(k); })) reasons.push('proper');
  if (aiGuess === true) reasons.push('ai');
  if (provisional === true) reasons.push('provisional');
  return { needsReview: reasons.length > 0, reasons };
}

const p2 = (n) => String(n).padStart(2, '0');
export const stampMinute = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export const stampSecond = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };

const STRINGS = {
  ja: {
    'review.mark': '要確認', 'review.unconfirmed': '未確認', 'review.confirmed': '確認済み',
    'review.reason.number': '数値', 'review.reason.date': '日付', 'review.reason.proper': '固有名詞', 'review.reason.ai': 'AI の推測', 'review.reason.provisional': '暫定',
    'review.source': '元の発話', 'review.manual': '手追加', 'review.aiSummary': 'AI 要約', 'review.aiRaw': '元の認識文字列',
    'msg.reviewConfirmed': '確認済みにしました', 'msg.reviewNotFound': '対象が見つかりません', 'msg.undoNone': '元に戻せる手修正がありません', 'msg.undone': '手修正を元に戻しました',
    'cmd.review.confirm': '選択中のシーンの要点を確認済みにする', 'cmd.edit.undo': '直前の手修正を元に戻す',
  },
  en: {
    'review.mark': 'Needs review', 'review.unconfirmed': 'Unconfirmed', 'review.confirmed': 'Confirmed',
    'review.reason.number': 'Number', 'review.reason.date': 'Date', 'review.reason.proper': 'Proper noun', 'review.reason.ai': 'AI guess', 'review.reason.provisional': 'Provisional',
    'review.source': 'Original utterance', 'review.manual': 'Added by hand', 'review.aiSummary': 'AI summary', 'review.aiRaw': 'Original recognized text',
    'msg.reviewConfirmed': 'Marked as confirmed', 'msg.reviewNotFound': 'The target was not found', 'msg.undoNone': 'There is no manual edit to undo', 'msg.undone': 'The manual edit was undone',
    'cmd.review.confirm': 'Confirm the points of the selected scene', 'cmd.edit.undo': 'Undo the last manual edit',
  },
};

export function reviewModule(ctx) {
  const { state, api } = ctx;
  ctx.i18n.addStrings(STRINGS);
  const t = (k) => ctx.i18n.t(k);
  const allPoints = () => state.scenes.flatMap((s) => s.points);
  const glossaryTerms = () => (state.glossary?.terms ?? []).map((x) => x.term);
  const llmOn = () => api.getLlmState?.().enabled === true;
  // NFR-PERF-003: 要点・発話の索引と AI の推測の端の要点は、データの版数ごとに 1 回だけ作る（要点ごとの線形探索をしない）
  let cache = { ver: -2 };
  const getCache = () => {
    const v = ctx.getDataVersion();
    if (v != null && cache.ver === v) return cache;
    const idx = new Map();
    for (const sc of state.scenes) for (const p of sc.points) idx.set(p.id, { sc, p });
    // 生成 AI が補った推測候補の関係線（FR-053）の端の要点。LLM 連携が有効なときだけ（AC-548）
    const ai = new Set();
    if (llmOn()) for (const r of api.getOutlineRelations?.() ?? []) if (r.basis === 'ai') { ai.add(r.from); ai.add(r.to); }
    const gl = glossaryTerms();
    cache = { ver: v ?? -2, idx, utt: new Map(state.utterances.map((u) => [u.id, u])), ai, glossary: gl, gsig: gl.join('\u0001') };
    return cache;
  };
  const findPoint = (id) => getCache().idx.get(id) ?? null;
  const aiIds = () => getCache().ai;

  // NFR-PERF-003: 要点ごとの判定結果は、文字・用語集・暫定・AI の推測が同じなら使い回す（5000 件でも描画のたびに判定し直さない）
  const revMemo = new WeakMap();
  function reviewOf(p, ai = aiIds()) {
    const c = getCache();
    const m = revMemo.get(p);
    if (p.confirmedAt) {
      if (m && m.c === p.confirmedAt) return m.r;
      const r = { needsReview: false, reasons: [], status: 'confirmed', confirmedAt: p.confirmedAt };
      revMemo.set(p, { c: p.confirmedAt, r });
      return r;
    }
    const prov = api.isProvisionalPoint?.(p.id) === true; const a = ai.has(p.id);
    if (m && !m.c && m.text === p.text && m.gsig === c.gsig && m.prov === prov && m.a === a) return m.r;
    const j = judgeReview(p.text, { glossary: c.glossary, aiGuess: a, provisional: prov });
    const r = { needsReview: j.needsReview, reasons: j.reasons, status: 'unconfirmed', confirmedAt: null };
    revMemo.set(p, { c: null, text: p.text, gsig: c.gsig, prov, a, r });
    return r;
  }
  const copyReview = (r) => ({ ...r, reasons: [...r.reasons] });

  api.getPointReview = (pointId) => {
    const hit = findPoint(pointId);
    return hit ? copyReview(reviewOf(hit.p)) : { needsReview: false, reasons: [], status: 'unconfirmed', confirmedAt: null };
  };
  api.getSceneReview = (sceneId) => {
    const sc = state.scenes.find((s) => s.id === sceneId);
    if (!sc) return { status: 'unconfirmed', confirmedAt: null, unconfirmedCount: 0 };
    const un = sc.points.filter((p) => !p.confirmedAt).length;
    const all = sc.points.length > 0 && un === 0;
    return { status: all ? 'confirmed' : 'unconfirmed', confirmedAt: all ? sc.points.map((p) => p.confirmedAt).sort().pop() : null, unconfirmedCount: un };
  };
  api.getReviewSummary = () => {
    const ai = aiIds(); const pts = allPoints();
    return { confirmed: pts.filter((p) => p.confirmedAt).length, total: pts.length, unconfirmed: pts.filter((p) => reviewOf(p, ai).needsReview).map((p) => p.id) };
  };
  // 図の要素（まとめた要点 AC-429 を含む）の印。refIds のどれかが未確認の「要確認」なら印を付ける
  api.getReviewMark = (refIds) => {
    const ai = aiIds(); const reasons = new Set();
    for (const id of refIds ?? []) { const h = findPoint(id); if (!h) continue; const r = reviewOf(h.p, ai); if (r.needsReview) r.reasons.forEach((x) => reasons.add(x)); }
    return reasons.size ? { needsReview: true, reasons: REASONS.filter((x) => reasons.has(x)), label: t('review.mark') } : null;
  };

  const confirmIds = (ids) => {
    const at = stampMinute(ctx.now());
    ctx.change(() => { for (const id of ids) { const h = findPoint(id); if (h && !h.p.confirmedAt) h.p.confirmedAt = at; } ctx.setMessage('msg.reviewConfirmed'); });
  };
  api.confirmPoint = (pointId) => {
    const hit = findPoint(pointId);
    if (!hit) return { ok: false, reason: 'not_found' };
    // AC-429: 同じシーンの同一文字列（まとめた要点）はすべて確認済みにする
    confirmIds(hit.sc.points.filter((q) => q.text === hit.p.text).map((q) => q.id));
    return { ok: true };
  };
  api.confirmScene = (sceneId) => {
    const sc = state.scenes.find((s) => s.id === sceneId);
    if (!sc) return { ok: false, reason: 'not_found' };
    confirmIds(sc.points.map((p) => p.id));
    return { ok: true };
  };
  ctx.registerCommand('review.confirm', () => (state.selectedSceneId ? api.confirmScene(state.selectedSceneId) : { ok: false, reason: 'no_selection' }));
  ctx.registerKey({ key: 'Enter', ctrl: true, alt: true, shift: true, command: 'review.confirm' }); // Alt+Shift+英数字は使用済みのため Ctrl+Alt+Shift

  // ---- 手修正の履歴（AC-546・AC-575）。確認状態・確認日も戻す ----
  const history = [];
  const baseEdit = api.editPoint;
  api.editPoint = (pointId, text) => {
    const hit = findPoint(pointId);
    const snap = hit ? { id: pointId, text: hit.p.text, hadManual: 'manual' in hit.p, manual: hit.p.manual, confirmedAt: hit.p.confirmedAt ?? null } : null;
    const r = baseEdit(pointId, text);
    if (r?.ok && snap) {
      const h = findPoint(pointId);
      ctx.change(() => { if (h) delete h.p.confirmedAt; }); // 確認済みの要点の手修正は未確認に戻る（印は再判定）
      history.push(snap);
      while (history.length > UNDO_LIMIT) history.shift();
    }
    return r;
  };
  api.undoManualEdit = () => {
    const snap = history.pop();
    if (!snap) { ctx.change(() => ctx.setMessage('msg.undoNone')); return { ok: false, reason: 'no_history' }; }
    const hit = findPoint(snap.id);
    if (!hit) return { ok: false, reason: 'not_found' };
    ctx.change(() => {
      hit.p.text = snap.text;
      if (snap.hadManual) hit.p.manual = snap.manual; else delete hit.p.manual;
      if (snap.confirmedAt) hit.p.confirmedAt = snap.confirmedAt; else delete hit.p.confirmedAt;
      ctx.setMessage('msg.undone');
    });
    return { ok: true };
  };
  ctx.registerCommand('edit.undo', () => api.undoManualEdit());
  ctx.registerKey({ key: 'Delete', ctrl: true, alt: true, shift: true, command: 'edit.undo' });

  // ---- 元の発話・AI 要約（AC-572・AC-573） ----
  const uttOf = (id) => getCache().utt.get(id);
  const srcMemo = new WeakMap(); const NO_SOURCES = Object.freeze([]);
  const sourcesOf = (p) => {
    const u = p.uid ? uttOf(p.uid) : null;
    if (!u) return NO_SOURCES;
    let s = srcMemo.get(u);
    if (!s) { s = [{ utteranceId: u.id, rawText: u.rawText ?? u.text, time: stampSecond(u.receivedAt) }]; srcMemo.set(u, s); }
    return s;
  };
  const isManual = (p) => !!p.manual; // 手修正・手追加（AC-012）。「手追加」の表示は元の発話のない要点（手追加）だけ
  const isAdded = (p) => !!p.manual && !p.uid;
  const aiOn = (o) => o.aiSummary === true && llmOn();
  // 生成 AI（FR-063）が言い換えた要点・見出しに印を付ける（rawText: 言い換えの前の認識文字列。null で外す）。無効・失敗時は付かない
  api.setPointAiSummary = (pointId, rawText) => {
    const h = findPoint(pointId);
    if (!h) return { ok: false, reason: 'not_found' };
    ctx.change(() => { if (rawText == null) { delete h.p.aiSummary; delete h.p.aiRaw; } else { h.p.aiSummary = true; h.p.aiRaw = String(rawText); } });
    return { ok: true };
  };
  api.setHeadingAiSummary = (sceneId, rawText) => {
    const sc = state.scenes.find((s) => s.id === sceneId);
    if (!sc) return { ok: false, reason: 'not_found' };
    ctx.change(() => { if (rawText == null) { delete sc.aiSummary; delete sc.aiRaw; } else { sc.aiSummary = true; sc.aiRaw = String(rawText); } });
    return { ok: true };
  };
  // ポップアップ・状態の要点に足す情報（読み取り専用。同じ内容なら同じ物を返す。NFR-PERF-003）
  const infoMemo = new WeakMap();
  const infoOf = (p) => {
    const r = reviewOf(p);
    const aiv = aiOn(p);
    const m = infoMemo.get(p);
    if (m && m.r === r && m.uid === p.uid && m.man === p.manual && m.aiv === aiv && m.aiRaw === p.aiRaw) return m.info;
    const info = { sources: sourcesOf(p), manual: isManual(p), added: isAdded(p), aiSummary: aiv, ...(aiv ? { aiRaw: p.aiRaw ?? '' } : {}), review: r };
    infoMemo.set(p, { r, uid: p.uid, man: p.manual, aiv, aiRaw: p.aiRaw, info });
    return info;
  };
  api.getPointInfo = (pointId) => {
    const h = findPoint(pointId);
    return h ? infoOf(h.p) : null;
  };
  const baseState = api.getState;
  api.getState = () => {
    const st = baseState();
    for (const sc of st.scenes) {
      for (const p of sc.points) {
        const src = findPoint(p.id)?.p;
        delete p.uid; delete p.confirmedAt; delete p.aiSummary; delete p.aiRaw;
        p.sources = src ? sourcesOf(src).map((x) => ({ ...x })) : []; p.manual = src ? isManual(src) : false;
      }
      delete sc.aiSummary; delete sc.aiRaw;
    }
    return st;
  };

  // ---- 表示（HTML。テキスト一覧・ポップアップで共通）。色だけに頼らず、文字と枠つきの記号で示す ----
  const reasonText = (reasons) => reasons.map((r) => t(`review.reason.${r}`)).join('・');
  const box = (cls, mark, label, extra = '') => `<span class="badge ${cls}"${extra}>${mark} ${escapeHtml(label)}</span>`; // 記号は文字の一部（1 要素だけ。NFR-PERF-003）
  const htmlMemo = new WeakMap();
  api.getPointExtraHtml = (p) => {
    const h = findPoint(p.id);
    if (!h) return '';
    const info = infoOf(h.p);
    const lang = state.lang;
    const m = htmlMemo.get(h.p);
    if (m && m.info === info && m.lang === lang) return m.html;
    const out = [];
    const r = info.review;
    if (r.status === 'confirmed') out.push(box('badge-confirmed', '☑', `${t('review.confirmed')} ${r.confirmedAt}`, ' data-review-status="confirmed"'));
    else if (r.needsReview) out.push(box('badge-review', '⚠', `${t('review.mark')}（${reasonText(r.reasons)}）${t('review.unconfirmed')}`, ' data-review-mark="1"'));
    if (info.aiSummary) out.push(box('badge-ai', '◇', t('review.aiSummary'), ' data-ai-summary="1"') + ` <span class="review-ai-raw" data-ai-raw="1">${escapeHtml(t('review.aiRaw'))}: ${escapeHtml(info.aiRaw ?? '')}</span>`);
    if (info.added) out.push(box('badge-manual', '✎', t('review.manual'), ' data-manual="1"'));
    const srcs = [...info.sources].sort((a, b) => a.time.localeCompare(b.time));
    // 文字だけ（要素を増やさない）。認識文字列が表示の文字と同じときは繰り返さず時刻だけを添える（5000 件でも DOM・HTML を増やしすぎない）
    for (const s of srcs) out.push(s.rawText === h.p.text ? `（${escapeHtml(t('review.source'))} ${escapeHtml(s.time)}）` : `（${escapeHtml(t('review.source'))}: ${escapeHtml(s.rawText)} ${escapeHtml(s.time)}）`);
    const html = out.length ? ` ${out.join(' ')}` : '';
    htmlMemo.set(h.p, { info, lang, html });
    return html;
  };
  const liMemo = new WeakMap();
  api.getPointLiHtml = (p) => { // ポップアップの 1 行（文字＋印・元の発話）。同じ内容なら文字列を使い回す（NFR-PERF-003）
    const h = findPoint(p.id);
    if (!h) return `<li data-point-id="${escapeHtml(p.id)}">${escapeHtml(p.text)}</li>`;
    const extra = api.getPointExtraHtml(p);
    const m = liMemo.get(h.p);
    if (m && m.text === p.text && m.extra === extra) return m.li;
    const li = `<li data-point-id="${escapeHtml(p.id)}">${escapeHtml(p.text)}${extra}</li>`;
    liMemo.set(h.p, { text: p.text, extra, li });
    return li;
  };
  api.getHeadingExtraHtml = (scene) => (aiOn(scene)
    ? ` ${box('badge-ai', '◇', t('review.aiSummary'), ' data-ai-summary="1"')} <span class="review-ai-raw" data-ai-raw="1">${escapeHtml(t('review.aiRaw'))}: ${escapeHtml(scene.aiRaw ?? '')}</span>` : '');
}
