// FR-063 方式1: LLM が会話の要点から「描くべき物・人物・感情・比喩」を抽出し、同梱部品（parts.js）のキーへ対応づけて描く。
// NFR-PRIV-003: 送るのは要点の文字だけ（簡易マスキング・サイズ上限つき）。描画は決定的で、LLM は部品キーと汎用キャラの属性だけを返す。
// 要求は api.llmCall(path, body)（llm.js。中継サーバー経由・タイムアウト・失敗時はルールベース描画のまま）で出す。
// 絵の対応づけはメモリだけに持ち、セッションファイル・ブラウザ内の保存・エクスポートには含めない（NFR-PRIV-003 AC-362）。
import { isPartKey, getPartKeys, getPartInfo, getPartGroup, getPartSvg, buildCharacter, CHARACTER_OPTIONS, EXPRESSION_LABELS } from './parts.js';
import { escapeHtml } from './outline.js';

export const EXTRACT_PATH = '/api/llm/extract'; // 中継サーバーが /api/llm/responses と同じ中継をする
export const MAX_SEND_CHARS = 2000; // PARAM-070
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

export function llmDrawModule(ctx) {
  const { api, state } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'llmdraw.mask': '送信前の簡易マスキング', 'llmdraw.maskNote': '利用者が登録した語・敬称付きの人名らしい語・メールアドレス・電話番号を伏せ字にします。検出は簡易で、完全な個人情報の除去は保証しません。',
      'llmdraw.truncated': '送る文字数の上限を超えたため、超過分は送っていません', 'llmdraw.heading': 'LLM が抽出した描画', 'llmdraw.person': '人物（汎用キャラ）', 'llmdraw.emotion': '感情',
    },
    en: {
      'llmdraw.mask': 'Simple masking before sending', 'llmdraw.maskNote': 'Registered words, name-like words with honorifics, email addresses and phone numbers are replaced with a mask. Detection is simple and does not guarantee complete removal of personal information.',
      'llmdraw.truncated': 'The text exceeded the send limit, so the excess was not sent', 'llmdraw.heading': 'Drawn from LLM extraction', 'llmdraw.person': 'Person (generic character)', 'llmdraw.emotion': 'Emotion',
    },
  });

  // ---- 同梱部品の公開（CONTRACT-LLM-FR063） ----
  api.getPartKeys = () => getPartKeys();
  api.getPartInfo = (key) => getPartInfo(key, state.lang);

  // ---- 簡易マスキングの設定（初期値は有効。Q-017 の推奨どおり。保存しない） ----
  let masking = true;
  let maskWords = [];
  api.getLlmMasking = () => masking;
  api.setLlmMasking = (v) => { masking = v === true; ctx.emit('change', api); return masking; };
  api.setLlmMaskWords = (list) => { maskWords = (Array.isArray(list) ? list : []).map((w) => String(w ?? '').trim()).filter(Boolean); return [...maskWords]; };

  // ---- 抽出結果（メモリだけ）: シーン ID → { objects, metaphors, people, emotions } ----
  const drawn = new Map();
  const latest = new Map(); // シーン ID → 最新の要求番号（古い応答で上書きしない）
  let seq = 0;
  const active = () => api.getLlmState?.().enabled === true;

  const catalogText = () => getPartKeys().map((k) => `${k}=${getPartInfo(k, 'en').label}`).join(', ');
  const instructions = () => `You extract what to draw from key points of a conversation. Reply with one JSON object only: {"objects":[{"key"}],"people":[{"hair","hairColor","outfit","expression"}],"emotions":[{"key"}],"metaphors":[{"key"}]}. `
    + `"key" of objects and metaphors must be one of these part keys: ${catalogText()}. `
    + `people use only: hair ${CHARACTER_OPTIONS.hair.join('|')}; hairColor ${CHARACTER_OPTIONS.hairColor.join('|')}; outfit ${CHARACTER_OPTIONS.outfit.join('|')}; expression ${CHARACTER_OPTIONS.expression.join('|')}. `
    + `emotions keys: ${CHARACTER_OPTIONS.expression.filter((e) => e !== 'neutral').join('|')}. Never include names of real people.`;

  function requestFor(scene) {
    const raw = [scene.heading, ...scene.points.map((p) => p.text)].join('\n');
    const masked = masking ? maskText(raw, maskWords) : raw;
    return clampText(masked, MAX_SEND_CHARS);
  }
  async function extract() {
    const scene = state.scenes[state.scenes.length - 1];
    if (!scene) return;
    const { text, truncated } = requestFor(scene);
    const n = ++seq; latest.set(scene.id, n);
    const pending = api.llmCall(EXTRACT_PATH, { instructions: instructions(), input: text, text: { format: { type: 'json_object' } } });
    if (truncated) { await Promise.resolve(); ctx.change(() => ctx.setMessage('llmdraw.truncated')); } // 呼び出し元の状態更新の後に通知する
    const res = await pending;
    if (!res?.ok || latest.get(scene.id) !== n || !active()) return;
    const parsed = parseExtraction(res.body);
    if (!parsed) return; // 形式に合わない応答は全体を無視（ルールベースのまま）
    drawn.set(scene.id, parsed);
    ctx.emit('change', api);
  }
  ctx.on('utterance', () => { if (active()) void extract(); });

  // ---- 描かれる内容（存在するシーンの分だけ。無効のときは空） ----
  const sceneIds = () => new Set(state.scenes.map((s) => s.id));
  function entries() {
    if (!active()) return [];
    const ids = sceneIds(); const out = [];
    for (const s of state.scenes) {
      const d = drawn.get(s.id);
      if (!d || !ids.has(s.id)) continue;
      for (const key of d.objects) out.push({ kind: 'object', key });
      for (const key of d.metaphors) out.push({ kind: 'metaphor', key });
      for (const p of d.people) out.push({ kind: 'person', attrs: p });
      for (const key of d.emotions) out.push({ kind: 'emotion', key });
    }
    return out;
  }
  const lang = () => (state.lang === 'en' ? 'en' : 'ja');
  const labelOf = (e) => {
    if (e.kind === 'object' || e.kind === 'metaphor') return getPartInfo(e.key, lang()).label;
    if (e.kind === 'person') return `${ctx.t('llmdraw.person')}: ${EXPRESSION_LABELS[e.attrs.expression][lang()]}`;
    return `${ctx.t('llmdraw.emotion')}: ${EXPRESSION_LABELS[e.key][lang()]}`;
  };
  const clip = (s) => [...String(s)].slice(0, 24).join('');
  // PNG・PDF に含める絵（物・比喩・汎用キャラ）。感情は文字だけ。
  api.getLlmDrawItems = () => {
    const items = entries().filter((e) => e.kind !== 'emotion').map((e) => ({
      label: clip(labelOf(e)), svg: e.kind === 'person' ? buildCharacter(e.attrs, { lang: lang() }) : getPartSvg(e.key),
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
      if (e.kind === 'object' || e.kind === 'metaphor') return `<g data-part-key="${e.key}" data-llm-kind="${e.kind}" transform="translate(${x} ${y})">${getPartGroup(e.key)}</g>${label}`;
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
    return d ? { ...d, fields: [...d.fields, { id: 'llm.mask', label: ctx.t('llmdraw.mask'), role: 'switch', value: masking, note: ctx.t('llmdraw.maskNote'), focusable: true }] } : null;
  };
  const baseView = api.getSettingsView;
  api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, { id: 'llm.mask', visible: true }] }; };
}
