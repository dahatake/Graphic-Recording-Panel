// FR-063 方式1: LLM が会話の要点から「描くべき物・人物・感情・比喩」を抽出し、同梱部品（parts.js）のキーへ対応づけて描く。
// NFR-PRIV-003: 送るのは要点の文字だけ（簡易マスキング・サイズ上限つき）。描画は決定的で、LLM は部品キーと汎用キャラの属性だけを返す。
// 要求は api.llmCall(path, body)（llm.js。中継サーバー経由・タイムアウト・失敗時はルールベース描画のまま）で出す。
// 絵の対応づけはメモリだけに持ち、セッションファイル・ブラウザ内の保存・エクスポートには含めない（NFR-PRIV-003 AC-362）。
import { isPartKey, getPartKeys, getPartInfo, getPartGroup, getPartSvg, buildCharacter, CHARACTER_OPTIONS, EXPRESSION_LABELS } from './parts.js';
import { isPersonPartKey, personVariantFor, personGroupFor } from './personvariants.js';
import { escapeHtml } from './outline.js';
import { acceptGeneratedSvg } from './svgsanitize.js';
import { withoutConfidential } from './visibility.js';
import { readJson, writeJson } from './persist.js';
import { normalizeSection } from './board.js';
export const LLM_LABEL_MAX = 24; // PARAM-165: LLM が返したラベル文字列の最大の長さ（文字）

export const EXTRACT_PATH = '/api/llm/extract'; // 中継サーバーが /api/llm/responses と同じ中継をする
export const SVG_PATH = '/api/llm/svg'; // FR-065 方式2
export const MAX_SEND_CHARS = 2000; // PARAM-070
const TERM_MAX = 12; // FR-118: バッチで送る語の最大の長さ（これより長い英数字の列は識別子・鍵の恐れがあるので送らない）
const MAX_GENERATED = 4; // 1 回の抽出で生成を求める物の上限
const LIMITS = { objects: 8, metaphors: 4, people: 3, emotions: 4 };
const MASK = '●●●';
const CELL_W = 64; const CELL_H = 84;

// 簡易マスキング（検出は簡易で、完全な個人情報の除去は保証しない）。応答の伏せ字は元の語に戻さない（対応表を持たない）。
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\+?\d{1,4}[-\s]?\(?\d{1,4}\)?[-\s]\d{2,4}[-\s]\d{3,4}|\b0\d{9,10}\b/g;
const JA_NAME_RE = /[\u4E00-\u9FFF\u3040-\u30FF\u30FC々]{1,8}(?:さん|様|氏|くん|君|ちゃん|先生|部長|課長|社長|殿)/g;
const EN_NAME_RE = /\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function maskText(text, words = []) {
  let s = String(text ?? '');
  for (const w of words) { const k = String(w ?? '').trim(); if (k) s = s.replace(new RegExp(escRe(k), 'g'), MASK); }
  return s.replace(EMAIL_RE, MASK).replace(PHONE_RE, MASK).replace(JA_NAME_RE, MASK).replace(EN_NAME_RE, MASK);
}

// 送る文字列の切り詰め（NFR-PRIV-003 AC-361）
export function clampText(text, max = MAX_SEND_CHARS) {
  const chars = [...String(text ?? '')];
  return chars.length > max ? { text: chars.slice(0, max).join(''), truncated: true } : { text: chars.join(''), truncated: false };
}

const isArr = Array.isArray;
const isObj = (v) => v != null && typeof v === 'object' && !isArr(v);
// 応答から決められた形式の本体を取り出す。直接の形（objects/people/emotions/metaphors）か、Responses の出力の文字（JSON）。
function unwrap(body) {
  if (!isObj(body)) return null;
  if (['objects', 'people', 'emotions', 'metaphors'].some((k) => k in body)) return body;
  let text = typeof body.output_text === 'string' ? body.output_text : null;
  if (text == null && isArr(body.output)) {
    for (const o of body.output) for (const c of (isArr(o?.content) ? o.content : [])) if (typeof c?.text === 'string' && text == null) text = c.text;
  }
  if (text == null) return null;
  try { const v = JSON.parse(text); return isObj(v) ? v : null; } catch { return null; }
}

// 形式の検証（AC-317）。形式に合わなければ null（全体を無視）。合えば、使える部品キーと汎用キャラの属性だけを返す（AC-318・AC-322）。
export function parseExtraction(body) {
  const b = unwrap(body);
  if (!b) return null;
  const names = ['objects', 'people', 'emotions', 'metaphors'];
  if (!names.some((k) => isArr(b[k]))) return null;
  for (const k of names) if (k in b && b[k] != null && !isArr(b[k])) return null;
  for (const k of names) for (const it of (b[k] ?? [])) if (!isObj(it)) return null;
  const uniq = (list) => [...new Set(list)];
  const partKeys = (list, max) => uniq((list ?? []).map((i) => i.key).filter((k) => isPartKey(k))).slice(0, max);
  const pick = (opts, v) => (opts.includes(v) ? v : opts[0]);
  const people = (b.people ?? []).slice(0, LIMITS.people).map((p) => ({
    hair: pick(CHARACTER_OPTIONS.hair, p.hair), hairColor: pick(CHARACTER_OPTIONS.hairColor, p.hairColor),
    outfit: pick(CHARACTER_OPTIONS.outfit, p.outfit), expression: pick(CHARACTER_OPTIONS.expression, p.expression),
  })); // 名前・特定の人物を表す指定は読まない（Q-006 の回答 B）
  const emotions = uniq((b.emotions ?? []).map((e) => e.key).filter((k) => typeof k === 'string' && CHARACTER_OPTIONS.expression.includes(k) && k !== 'neutral')).slice(0, LIMITS.emotions);
  return { objects: partKeys(b.objects, LIMITS.objects), metaphors: partKeys(b.metaphors, LIMITS.metaphors), people, emotions };
}

// FR-114 AC-665 (1)（監査 S-01）: 応答の任意の項目 sections（[{ point: 1 始まりの要点の番号, section: 区画名, emphasis?: 強調語 }]）。
// 形式の検証（AC-317）を通った応答でだけ使う。不正な項目は、その項目の区画の指定だけを無視する（規則で振り分ける）。文字は LLM_LABEL_MAX まで・文字としてだけ扱う（AC-320）。
export function parseSections(body, pointCount = Infinity) {
  const b = unwrap(body);
  const out = new Map(); // 要点の添字（0 始まり）→ { section, emphasis }
  if (!b || !isArr(b.sections)) return out;
  for (const it of b.sections.slice(0, 200)) {
    if (!isObj(it) || !Number.isInteger(it.point) || it.point < 1 || it.point > pointCount || out.has(it.point - 1)) continue;
    const section = normalizeSection(it.section);
    if (!section) continue;
    const em = (isArr(it.emphasis) ? it.emphasis : [it.emphasis]).filter((w) => typeof w === 'string').map((w) => [...w.replace(/[<>&"'\u0000-\u001f]/g, ' ').trim()].slice(0, LLM_LABEL_MAX).join('')).filter(Boolean).slice(0, 2);
    out.set(it.point - 1, { section, emphasis: em });
  }
  return out;
}

// FR-065 AC-331: 同梱部品にない物体（key が部品キーでなく label がある）の名前。重複なし・上限つき。
export function parseUnbundled(body) {
  const b = unwrap(body);
  if (!b || !isArr(b.objects)) return [];
  const out = [];
  for (const it of b.objects) {
    if (!isObj(it) || isPartKey(it.key) || typeof it.label !== 'string') continue;
    const label = [...it.label.replace(/[<>&"'\u0000-\u001f]/g, ' ').trim()].slice(0, LLM_LABEL_MAX).join('');
    if (label && !out.includes(label)) out.push(label);
    if (out.length >= MAX_GENERATED) break;
  }
  return out;
}
// 生成の応答から SVG の文字列を取り出す（body.svg か、Responses の出力の文字の中の <svg>…</svg>）。なければ null。
export function findSvg(body) {
  if (!isObj(body)) return null;
  if (typeof body.svg === 'string') return body.svg;
  const texts = [];
  if (typeof body.output_text === 'string') texts.push(body.output_text);
  if (isArr(body.output)) for (const o of body.output) for (const c of (isArr(o?.content) ? o.content : [])) if (typeof c?.text === 'string') texts.push(c.text);
  for (const t of texts) { const m = /<svg\b[\s\S]*?<\/svg\s*>/i.exec(t); if (m) return m[0]; }
  return null;
}
export const GENERIC_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><rect x="8" y="8" width="32" height="32" rx="4" fill="none" stroke="#15191f" stroke-width="2"/><text x="24" y="31" font-size="20" text-anchor="middle" fill="#15191f">?</text></svg>';
const INNER_SIZE = 48;

export function llmDrawModule(ctx) {
  const { api, state } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'llmdraw.mask': '送信前の簡易マスキング', 'llmdraw.maskWords': '登録語', 'llmdraw.maskWordAdd': '追加', 'llmdraw.maskWordRemove': '削除', 'llmdraw.maskWordsEmpty': '登録語はありません', 'llmdraw.maskNote': '利用者が登録した語・敬称付きの人名らしい語・メールアドレス・電話番号を伏せ字にします。検出は簡易で、完全な個人情報の除去は保証しません。',
      'llmdraw.truncated': '送る文字数の上限を超えたため、超過分は送っていません', 'llmdraw.heading': 'LLM が抽出した描画', 'llmdraw.person': '人物（汎用キャラ）', 'llmdraw.emotion': '感情', 'llmdraw.svgFailed': 'SVG の生成結果を使えなかったため、汎用のアイコンにしました',
    },
    en: {
      'llmdraw.mask': 'Simple masking before sending', 'llmdraw.maskWords': 'Words', 'llmdraw.maskWordAdd': 'Add', 'llmdraw.maskWordRemove': 'Remove', 'llmdraw.maskWordsEmpty': 'No registered words', 'llmdraw.maskNote': 'Registered words, name-like words with honorifics, email addresses and phone numbers are replaced with a mask. Detection is simple and does not guarantee complete removal of personal information.',
      'llmdraw.truncated': 'The text exceeded the send limit, so the excess was not sent', 'llmdraw.heading': 'Drawn from LLM extraction', 'llmdraw.person': 'Person (generic character)', 'llmdraw.emotion': 'Emotion', 'llmdraw.svgFailed': 'The generated SVG could not be used, so a generic icon is shown',
    },
  });

  // ---- 同梱部品の公開（CONTRACT-LLM-FR063） ----
  api.getPartKeys = () => getPartKeys();
  api.getPartInfo = (key) => getPartInfo(key, state.lang);

  // ---- 簡易マスキングの設定（初期値は有効。Q-017 の推奨どおり）と登録語（AC-474）。端末のブラウザ内にだけ保存し（セッションファイル・データの初期化・LLM 連携の送信には含めない）、LLM 連携の有効・無効にかかわらず設定画面で操作できる ----
  const MASK_KEY = 'grp.llmMask';
  let masking = true;
  let maskWords = [];
  { const raw = readJson(ctx.storage, MASK_KEY); if (raw && typeof raw === 'object') { if (typeof raw.enabled === 'boolean') masking = raw.enabled; if (Array.isArray(raw.words)) maskWords = raw.words.map((w) => String(w ?? '').trim()).filter(Boolean); } }
  const saveMask = () => writeJson(ctx.storage, MASK_KEY, { enabled: masking, words: maskWords });
  api.getLlmMasking = () => masking;
  api.setLlmMasking = (v) => { masking = v === true; saveMask(); ctx.emit('change', api); return masking; };
  api.setLlmMaskWords = (list) => { maskWords = [...new Set((Array.isArray(list) ? list : []).map((w) => String(w ?? '').trim()).filter(Boolean))]; saveMask(); ctx.emit('change', api); return [...maskWords]; };
  api.getLlmMaskWords = () => [...maskWords];
  // 登録語の追加（入力欄）と個別の削除（一覧）。登録語そのものは外へ送らない
  api.addLlmMaskWord = (w) => { const s = String(w ?? '').trim(); if (!s) return { ok: false, reason: 'empty' }; if (!maskWords.includes(s)) { maskWords = [...maskWords, s]; saveMask(); ctx.emit('change', api); } return { ok: true, words: [...maskWords] }; };
  api.removeLlmMaskWord = (w) => { const had = maskWords.includes(w); if (had) { maskWords = maskWords.filter((x) => x !== w); saveMask(); ctx.emit('change', api); } return { ok: had, words: [...maskWords] }; };
  // 簡易マスキングを文字に適用する（設定の有効・無効によらず、登録した語と同じ対象・伏せ字で）。FR-078 AC-471 の注意の伏せ字が使う。端末の中だけで行う
  // AC-359・AC-668: 会議ボード型の参加者名簿と .vtt の話者タグの名前も伏せる対象（長い名前から。端末の中だけ）
  const allMaskWords = () => [...maskWords, ...[...(api.getPersonMaskWords?.() ?? api.getPersonNames?.() ?? [])].sort((a, b) => b.length - a.length)];
  api.applyLlmMask = (text) => maskText(text, allMaskWords());

  // ---- 抽出結果（メモリだけ）: シーン ID → { objects, metaphors, people, emotions } ----
  const drawn = new Map();
  const latest = new Map(); // シーン ID → 最新の要求番号（古い応答で上書きしない）
  let seq = 0;
  const active = () => api.getLlmState?.().enabled === true;

  // ---- FR-065 方式2（任意・既定オフ・保存しない設定）。生成 SVG はサニタイズ後だけ持つ（NFR-SEC-004） ----
  let svgGeneration = false;
  const baseState = api.getLlmState;
  api.getLlmState = () => ({ ...baseState(), svgGeneration });
  api.setLlmSvgGeneration = (v) => { svgGeneration = v === true; ctx.emit('change', api); return svgGeneration; };
  const generated = new Map(); // シーン ID → [{ label, svg: サニタイズ済み | null（汎用アイコン） }]
  const norm = (svg) => acceptGeneratedSvg(svg, { width: INNER_SIZE, height: INNER_SIZE });
  async function generate(sceneId, labels, n) {
    for (const label of labels) {
      if ((generated.get(sceneId) ?? []).some((g) => g.label === label)) continue;
      const sent = api.maskPersonNames ? api.maskPersonNames(label) : label; // AC-358・AC-668: 名前は常に伏せる
      const res = await api.llmCall(SVG_PATH, { key: 'generated', label: sent, input: sent }); // AC-358: 指示（Prompt 本文）は端末から送らず、中継サーバーが付与する
      if (!res?.ok || latest.get(sceneId) !== n || !svgGeneration || !active()) continue;
      const svg = norm(findSvg(res.body));
      generated.set(sceneId, [...(generated.get(sceneId) ?? []), { label, svg }]);
      ctx.change(() => { if (!svg) ctx.setMessage('llmdraw.svgFailed'); });
      ctx.emit('change', api);
    }
  }
  // セッションファイル（FR-019）: 保存はサニタイズ済みの SVG だけ。読込は必ず再サニタイズ（AC-365）。
  api.exportGeneratedSvgs = () => [...generated].flatMap(([sceneId, list]) => list.filter((g) => g.svg).map((g) => ({ sceneId, label: g.label, svg: g.svg })));
  api.importGeneratedSvgs = (list) => {
    generated.clear();
    for (const it of (Array.isArray(list) ? list : [])) {
      if (!isObj(it) || typeof it.sceneId !== 'string' || typeof it.label !== 'string') continue;
      const svg = norm(it.svg);
      if (!svg) continue;
      generated.set(it.sceneId, [...(generated.get(it.sceneId) ?? []), { label: [...it.label].slice(0, LLM_LABEL_MAX).join(''), svg }]);
    }
    ctx.emit('change', api);
  };

  // 抽出・SVG 生成の指示（Prompt 本文）は端末に置かない。中継サーバー（server/batch_styles.py）が固定文を付与する（AC-358・AC-690。FR-114 の区画 ID の一覧もサーバー側）
  // FR-114: 要点ごとの区画の指定（シーン ID → Map(要点の添字 → { section, emphasis })）。LLM 連携が無効のときは使わない
  const sectionsOf = new Map();
  api.getLlmPointSection = (sceneId, index) => (active() ? sectionsOf.get(sceneId)?.get(index) ?? null : null);

  // FR-118・AC-692（Q-049 回答 A）: バッチでは、取込んだ発話の逐語を送らない。要点の文字は、ルールベースで取り出した語（漢字・カタカナ・英数字の語。ひらがなの助詞と長い英数字の列は除く）だけにする
  const termsOf = (line) => {
    const words = String(line).match(/[\u4E00-\u9FFF\u3005\u30A0-\u30FF\u30FC]+|[A-Za-z][A-Za-z'-]*/gu) ?? []; // 数字だけの列（電話番号・番号類）は簡易マスキングの設定に関わらず送らない（AC-692）
    const keep = []; for (const w of words) { if ([...w].length <= TERM_MAX && !keep.includes(w)) keep.push(w); }
    return keep.length ? keep.join(' ') : '…';
  };
  function requestFor(scene, termsOnly = false) {
    const [safe] = withoutConfidential([scene], state.lang === 'en' ? 'en' : 'ja'); // 機密の要点は公開範囲に関わらず LLM へ送らない（監査 S-1）
    const lines = [safe.heading, ...safe.points.map((p) => p.text)];
    const raw = (termsOnly ? lines.map((l) => termsOf(api.maskPersonNames ? api.maskPersonNames(l) : l)) : lines).join('\n');
    const named = termsOnly ? raw : (api.maskPersonNames ? api.maskPersonNames(raw) : raw); // AC-358・AC-668: 参加者名簿・話者タグの名前は簡易マスキングの設定に関わらず常に伏せる（決定 2026-11-05）
    const masked = masking ? maskText(named, allMaskWords()) : named;
    return clampText(masked, MAX_SEND_CHARS);
  }
  // opts.style: { id, name }（FR-118 バッチ。スタイルの ID・名称だけを送る。指示の本文はサーバーが ID から付与する）。戻り値: 'ok' | 'failed' | 'invalid' | 'stale' | 'none'
  async function extract(sceneId, opts = {}) {
    const scene = sceneId === undefined ? state.scenes[state.scenes.length - 1] : state.scenes.find((s) => s.id === sceneId);
    if (!scene) return 'none';
    const { text, truncated } = requestFor(scene, !!opts.style);
    const n = ++seq; latest.set(scene.id, n);
    const styleFields = opts.style ? { styleId: opts.style.id, styleName: opts.style.name, lang: state.lang === 'en' ? 'en' : 'ja' } : {};
    const pending = api.llmCall(EXTRACT_PATH, { input: text, scene: state.scenes.length, drawStyle: api.getDrawStyle?.() ?? 'handwritten', partKeys: getPartKeys(), text: { format: { type: 'json_object' } }, ...styleFields, ...(svgGeneration ? { allowSvg: true } : {}) });
    if (truncated) { await Promise.resolve(); ctx.change(() => ctx.setMessage('llmdraw.truncated')); } // 呼び出し元の状態更新の後に通知する
    const res = await pending;
    if (!res?.ok || latest.get(scene.id) !== n || !active()) return res?.ok ? 'stale' : (res?.reason === 'failed' ? 'failed' : 'stale');
    const parsed = parseExtraction(res.body);
    if (!parsed) return 'invalid'; // 形式に合わない応答は全体を無視（ルールベースのまま）
    drawn.set(scene.id, parsed);
    { const secs = parseSections(res.body, scene.points.length); const same = withoutConfidential([scene], state.lang === 'en' ? 'en' : 'ja')[0].points.length === scene.points.length; if (secs.size && same) sectionsOf.set(scene.id, secs); else sectionsOf.delete(scene.id); } // 機密の要点を除いて送ったときは番号がずれるので使わない
    if (svgGeneration) { const labels = parseUnbundled(res.body); if (labels.length) { ctx.emit('change', api); await generate(scene.id, labels, n); return 'ok'; } }
    ctx.emit('change', api);
    return 'ok';
  }
  api.extractSceneWithStyle = (sceneId, style) => extract(sceneId, { style }); // FR-118（batch.js）が使う。LLM 連携が無効なら 'none'
  api.clearLlmDrawn = (sceneIds) => { for (const id of sceneIds) { drawn.delete(id); sectionsOf.delete(id); latest.delete(id); } }; // バッチの再実行で置き換えたシーンの抽出結果を捨てる
  // 取込などで発話が短時間に大量に来ても、要求は同時に 1 件だけ。処理中に来た発話は、発話のあったシーンごとに 1 回へまとめて（同じシーンへの複数発話は 1 回）、終わった後に順に送る（AC-359・AC-471）
  let extracting = false; const dirty = new Set();
  async function extractCoalesced() {
    if (extracting) return;
    extracting = true;
    try {
      while (dirty.size && active()) { const id = dirty.values().next().value; dirty.delete(id); await extract(id); }
    } catch { /* ルールベース描画のまま */ } finally { extracting = false; if (!active()) dirty.clear(); }
  }
  ctx.on('utterance', () => { if (!active()) return; const last = state.scenes[state.scenes.length - 1]; if (last) dirty.add(last.id); void extractCoalesced(); });

  // ---- 描かれる内容（存在するシーンの分だけ。無効のときは空） ----
  const sceneIds = () => new Set(state.scenes.map((s) => s.id));
  function entries() {
    const ids = sceneIds(); const out = [];
    for (const s of state.scenes) {
      const d = active() ? drawn.get(s.id) : null;
      if (d && ids.has(s.id)) {
        for (const key of d.objects) out.push({ kind: 'object', key });
        for (const key of d.metaphors) out.push({ kind: 'metaphor', key });
        for (const p of d.people) out.push({ kind: 'person', attrs: p });
        for (const key of d.emotions) out.push({ kind: 'emotion', key });
      }
      // 生成 SVG は保存・読込の後は LLM 連携なしでも描く（AC-334）
      for (const g of generated.get(s.id) ?? []) out.push({ kind: 'generated', label: g.label, svg: g.svg ?? GENERIC_ICON });
    }
    return out;
  }
  const lang = () => (state.lang === 'en' ? 'en' : 'ja');
  const labelOf = (e) => {
    if (e.kind === 'object' || e.kind === 'metaphor') return getPartInfo(e.key, lang()).label;
    if (e.kind === 'generated') return e.label;
    if (e.kind === 'person') return `${ctx.t('llmdraw.person')}: ${EXPRESSION_LABELS[e.attrs.expression][lang()]}`;
    return `${ctx.t('llmdraw.emotion')}: ${EXPRESSION_LABELS[e.key][lang()]}`;
  };
  const clip = (s) => [...String(s)].slice(0, LLM_LABEL_MAX).join('');
  // PNG・PDF に含める絵（物・比喩・汎用キャラ）。感情は文字だけ。
  api.getLlmDrawItems = () => {
    const items = entries().filter((e) => e.kind !== 'emotion').map((e) => ({
      label: clip(labelOf(e)), svg: e.kind === 'person' ? buildCharacter(e.attrs, { lang: lang() }) : e.kind === 'generated' ? e.svg : (isPersonPartKey(e.key) ? personVariantFor(e.id ?? e.key).svg : getPartSvg(e.key)),
    }));
    return items.length ? items : null;
  };

  // ---- 2D の図（末尾の帯） ----
  const baseRender = api.renderSvg;
  api.renderSvg = () => {
    const base = baseRender();
    const list = entries();
    if (!list.length) return base;
    const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(base);
    if (!m) return base;
    const width = Number(m[1]); const height = Number(m[2]);
    const per = Math.max(1, Math.floor((width - 24) / CELL_W));
    const rows = Math.ceil(list.length / per);
    const bandH = rows * CELL_H + 40;
    const cells = list.map((e, i) => {
      const x = 12 + (i % per) * CELL_W; const y = height + 28 + Math.floor(i / per) * CELL_H;
      const label = `<text x="${x}" y="${y + 62}" font-size="11" fill="#15191f">${escapeHtml(clip(labelOf(e)))}</text>`;
      if (e.kind === 'object' || e.kind === 'metaphor') return `<g data-part-key="${e.key}" data-llm-kind="${e.kind}" transform="translate(${x} ${y})">${isPersonPartKey(e.key) ? personGroupFor(e.id ?? e.key) : getPartGroup(e.key)}</g>${label}`;
      if (e.kind === 'generated') return `<g data-llm-kind="generated" transform="translate(${x} ${y})">${e.svg}</g>${label}`;
      if (e.kind === 'person') return `<g data-llm-kind="person" transform="translate(${x} ${y}) scale(0.8)">${buildCharacter(e.attrs, { lang: lang() }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</g>`;
      return `<g data-llm-kind="emotion" data-emotion-key="${e.key}"><text x="${x}" y="${y + 24}" font-size="12" font-weight="700" fill="#15191f">${escapeHtml(clip(labelOf(e)))}</text></g>`;
    }).join('');
    const band = `<g data-role="llm-draw"><text x="12" y="${height + 18}" font-size="12" font-weight="700" fill="#15191f">${escapeHtml(ctx.t('llmdraw.heading'))}</text>${cells}</g>`;
    return base
      .replace(m[0], `viewBox="0 0 ${m[1]} ${height + bandH}"`)
      .replace(/(<svg[^>]*?) height="[\d.]+"/, `$1 height="${height + bandH}"`)
      .replace(/<\/svg>\s*$/, `${band}</svg>`);
  };

  // ---- テキスト一覧（物の名前を文字で示す: NFR-A11Y-001） ----
  const baseOutline = api.renderOutline;
  api.renderOutline = () => {
    const html = baseOutline();
    const list = entries();
    if (!list.length) return html;
    return `${html}<section class="outline-llm" aria-label="${escapeHtml(ctx.t('llmdraw.heading'))}"><h2>${escapeHtml(ctx.t('llmdraw.heading'))}</h2><ul>${list.map((e) => `<li data-llm-kind="${e.kind}">${escapeHtml(clip(labelOf(e)))}</li>`).join('')}</ul></section>`;
  };

  // ---- 設定画面: 簡易マスキングの切替（注意書きつき） ----
  const baseDialog = api.getSettingsDialog;
  api.getSettingsDialog = () => {
    const d = baseDialog();
    return d ? { ...d, fields: [...d.fields,
      { id: 'llm.mask', label: ctx.t('llmdraw.mask'), role: 'switch', value: masking, note: ctx.t('llmdraw.maskNote'), focusable: true },
      { id: 'llm.maskWords', label: ctx.t('llmdraw.maskWords'), role: 'list', words: [...maskWords], addLabel: ctx.t('llmdraw.maskWordAdd'), removeLabel: ctx.t('llmdraw.maskWordRemove'), emptyText: ctx.t('llmdraw.maskWordsEmpty'), focusable: true }] } : null;
  };
  const baseView = api.getSettingsView;
  api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, { id: 'llm.mask', visible: true }, { id: 'llm.maskWords', visible: true }] }; };

  // 設定画面の llm.mask を Enter / Space で切り替える（AC-360）
  let maskFocus = false;
  const baseFocus = api.focusSettingsField;
  api.focusSettingsField = (id) => {
    if (id === 'llm.mask') { if (!baseDialog()) return false; maskFocus = true; return true; }
    maskFocus = false; return baseFocus(id);
  };
  ctx.on('change', () => { if (!baseDialog()) maskFocus = false; });
  const baseKeyDraw = api.handleKey;
  api.handleKey = (ev) => {
    const k = String(ev?.key);
    const plain = !ev?.ctrlKey && !ev?.altKey && !ev?.shiftKey;
    if (maskFocus && baseDialog() && !api.getLlmConsent?.() && plain && (k === 'Enter' || k === ' ' || k === 'Space')) { api.setLlmMasking(!masking); return 'llm.mask.toggle'; }
    return baseKeyDraw(ev);
  };
}
