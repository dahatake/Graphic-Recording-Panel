// FR-114 会議ボード型（FR-027 の 7 つ目の型。型 id: board）。
// タイトル帯と 9 つの区画（目的・背景／参加メンバー／議論の流れ・主な発言／決定事項／未決事項／主要テーマ・議論のポイント／
// 最終的に目指す姿／次アクション／メモ・補足）の骨格を先に描き、要点を規則（生成 AI なし）で、または LLM 連携が有効なら
// FR-063 の応答の区画の指定で、ちょうど 1 つの区画へ振り分けて描き足す。区画ごとに部品（番号バッジ・吹き出し・✓のリスト・
// ？のリスト・表・矢印・人物・絵記号・マーカーと下線の強調）を使い分ける。SVG だけで描き、外部通信・画像は使わない。
// 色は選んでいる描画スタイル（FR-029・FR-076）の配色。区画の枠の形は描画スタイルの任意の項目 boardFrame（'cloud' なら雲形）、なければ角丸。
import { classifyPoint } from './diagram.js';
import { escapeHtml } from './outline.js';
import { personGroupFor } from './personvariants.js';
import { contrastRatio, mix, boardFrameLook } from './stylepresets.js';

export const BOARD_TYPE_ID = 'board';
export const LABEL_MAX = 24; // PARAM-165: 図に出すラベルの最大の長さ（文字）
export const GROUP_MAX = 7; // PARAM-088: 1 つのまとまりに並べる要素数の上限（超えたら下位のまとまりに分ける。AC-428）
export const MIN_CONTRAST = 4.5; // PARAM-007

// 9 つの区画（並びは AC-664 の列挙の順）。名前は日英。icon は見出しの絵記号（区画ごとに異なる）
export const SECTIONS = [
  { id: 'purpose', ja: '目的・背景', en: 'Purpose & background', icon: 'target' },
  { id: 'members', ja: '参加メンバー', en: 'Members', icon: 'people' },
  { id: 'flow', ja: '議論の流れ・主な発言', en: 'Discussion flow', icon: 'chat' },
  { id: 'decisions', ja: '決定事項', en: 'Decisions', icon: 'check' },
  { id: 'open', ja: '未決事項', en: 'Open issues', icon: 'question' },
  { id: 'themes', ja: '主要テーマ・議論のポイント', en: 'Key themes', icon: 'bulb' },
  { id: 'vision', ja: '最終的に目指す姿', en: 'Where we aim', icon: 'flag' },
  { id: 'actions', ja: '次アクション', en: 'Next actions', icon: 'clipboard' },
  { id: 'memo', ja: 'メモ・補足', en: 'Notes', icon: 'pin' },
];
export const SECTION_IDS = SECTIONS.map((s) => s.id);
// 図に現れる部品の種類（AC-666 の 11 種類）。SVG では data-board-part の値
export const PART_KINDS = ['title', 'frame', 'badge', 'bubble', 'check', 'question', 'table', 'arrow', 'person', 'icon', 'emphasis'];

const TEXT = {
  ja: { aria: '会議ボードの図', section: '会議ボード', now: '現状', goal: '目指す姿', no: 'No', content: '内容', owner: '担当', due: '期限', tbd: '未定' },
  en: { aria: 'Meeting board diagram', section: 'Meeting board', now: 'Now', goal: 'Goal', no: 'No', content: 'Item', owner: 'Owner', due: 'Due', tbd: 'TBD' },
};
const L10N = (lang) => (lang === 'en' ? 'en' : 'ja');

// ---- 区画への振り分け（AC-665。決定的・生成 AI なし・外部通信なし） ----
// PARAM-126（決定）・PARAM-129（行動）・PARAM-127（保留）: 部分一致・大文字小文字を区別しない
export const DECISION_WORDS = ['決まりました', '決めました', '決定', '確定', '承認', '合意', '採用する', 'に決めた', 'agreed', 'decided'];
export const ACTION_WORDS = ['お願いします', 'してください', '対応する', 'やります', '確認します', '共有します', '調整します', '対応します', '連絡します', 'までに', '担当', 'TODO', 'action item'];
export const PENDING_WORDS = ['保留', '未定', '持ち帰り', '次回', '検討中', 'pending', 'TBD'];
// PARAM-178 の「未決事項」（否定・先送り。決定事項・次アクションの言い回しより先に判定する。日本語は部分一致、英語は単語単位）
export const NEGATION_WORDS = ['未決定', '未決', '未定', '保留', '決まらない', '決まっていない', '決めていない', '決定していない', '次回まで', '持ち越し', '先送り', 'undecided', 'TBD'];
// PARAM-131（質問）: 日本語は部分一致、英語の語は単語単位
const QUESTION_RE = /[?？]|でしょうか|ですか|ますか|ませんか|でしょう|(?<![a-z0-9])(why|how|what)(?![a-z0-9])/i;
// PARAM-178（区画ごとの言い回し）: 日本語は部分一致、英語は単語単位。判定の順は 目的・背景→最終的に目指す姿→参加メンバー→主要テーマ→メモ・補足
export const SECTION_WORDS = {
  purpose: ['目的', 'ねらい', '背景', '経緯', '趣旨', 'purpose', 'background'],
  vision: ['目指す', '目指したい', 'あるべき姿', '理想', '将来像', 'to-be'],
  members: ['参加', '出席', 'メンバー', 'attendee'],
  themes: ['テーマ', '論点', 'ポイント', '課題', 'issue'],
  memo: ['補足', 'ちなみに', '参考', 'メモ', 'note'],
};
const WORD_ORDER = ['purpose', 'vision', 'members', 'themes', 'memo'];
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAscii = (w) => /^[\x20-\x7e]+$/.test(w);
const reOf = (words, wordBoundary) => new RegExp(words.map((w) => (wordBoundary && isAscii(w) ? `(?<![a-z0-9])${esc(w)}(?![a-z0-9])` : esc(w))).join('|'), 'gi');
const RE = {
  decision: reOf(DECISION_WORDS, false), action: reOf(ACTION_WORDS, false), pending: reOf(PENDING_WORDS, false), negation: reOf(NEGATION_WORDS, true),
  ...Object.fromEntries(Object.entries(SECTION_WORDS).map(([k, ws]) => [k, reOf(ws, true)])),
};
const matches = (re, text) => [...String(text ?? '').matchAll(re)].map((m) => m[0]);

// LLM が返した区画の指定（id・日英の区画名）を区画 id に。どれでもなければ null（無視して規則で決める）
export function normalizeSection(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  const hit = SECTIONS.find((x) => x.id === s || x.ja === v.trim() || x.en.toLowerCase() === s);
  return hit ? hit.id : null;
}

// 要点（{ text, kind? }）→ { section, rule, emphasis }。opts.llm: { section?, emphasis? }（FR-063 の応答。形式の検証済み）
export function assignSection(point, opts = {}) {
  const text = String(point?.text ?? '');
  const kind = classifyPoint(point ?? '');
  const words = [...matches(RE.negation, text), ...matches(RE.decision, text), ...matches(RE.action, text), ...WORD_ORDER.flatMap((k) => matches(RE[k], text))];
  const llmWords = (Array.isArray(opts.llm?.emphasis) ? opts.llm.emphasis : []).filter((w) => typeof w === 'string' && w.trim() && text.includes(w.trim())).map((w) => w.trim());
  const emphasis = [...new Set([...llmWords, ...words])];
  const out = (section, rule) => ({ section, rule, emphasis, kind });
  const llm = normalizeSection(opts.llm?.section);
  if (llm) return out(llm, 1);
  // AC-665 (2): 種類が未決定、または PARAM-127・PARAM-178（未決事項）の否定・先送りの言い回しは、(3)(4) の「決定」「確認」などの部分一致より先に未決事項へ
  if (kind === 'undecided' || matches(RE.pending, text).length || matches(RE.negation, text).length) return out('open', 2);
  if (kind === 'conclusion' || matches(RE.decision, text).length) return out('decisions', 3);
  if (kind === 'action' || matches(RE.action, text).length) return out('actions', 4);
  if (kind === 'question' || QUESTION_RE.test(text)) return out('open', 5);
  for (const k of WORD_ORDER) if (matches(RE[k], text).length) return out(k, 6);
  if (kind === 'evidence') return out('memo', 7);
  return out('flow', 8);
}

// 次アクションの担当・期限（要点の文字の「〜さん」「〜担当」と「〜まで（に）」の語。ないときは null＝「未定」。自動で補わない）
export function actionFields(text) {
  const s = String(text ?? '');
  const o = /([^\s、。,，．・がはをにでのと「」（）()]{1,10})(?:さん|担当)/.exec(s);
  const d = /([^\s、。,，がはをにで「」（）()]{1,12}?)まで/.exec(s);
  return { owner: o ? o[1] : null, due: d ? d[1] : null };
}

// ---- 文字の幅（決定的な見積もり） ----
const charW = (ch, size) => (ch.codePointAt(0) >= 0x2e80 ? size : size * 0.58);
export const textW = (s, size) => [...String(s ?? '')].reduce((w, ch) => w + charW(ch, size), 0);
export const clipLabel = (s) => [...String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, LABEL_MAX).join('');
function fit(text, maxPx, size) {
  const chars = [...String(text ?? '')];
  let w = 0; let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = charW(chars[i], size);
    if (w + c > maxPx) return `${out.replace(/\s+$/, '')}…`;
    out += chars[i]; w += c;
  }
  return out;
}
// 表示する文字の中の強調語の位置（左端からの距離と幅）
function emphOf(shown, words, size) {
  const out = []; const used = [];
  for (const w of words) {
    const i = shown.indexOf(w);
    if (i < 0 || used.some(([a, b]) => i < b && a < i + w.length)) continue;
    used.push([i, i + w.length]);
    out.push({ word: w, dx: Math.round(textW(shown.slice(0, i), size) * 10) / 10, w: Math.round(textW(w, size) * 10) / 10 });
    if (out.length >= 2) break;
  }
  return out;
}

// ---- 配置（DOM に依存しない純粋関数） ----
const W = 1280; const M = 24; const GAP = 16; const COL = (W - M * 2 - GAP * 2) / 3; // 400
const HEAD = 36; const PAD = 12; const FS = 14; const ROW = 26; const EMPTY_BODY = 28; const BAND = 76;
// 区画の並び（行ごと。[id, 列, 幅の列数]）。重なりのない格子で、行の高さはその行の区画の中身の高さの最大
const GRID = [
  [['purpose', 0, 1], ['members', 1, 1], ['vision', 2, 1]],
  [['flow', 0, 2], ['decisions', 2, 1]],
  [['themes', 0, 2], ['open', 2, 1]],
  [['actions', 0, 2], ['memo', 2, 1]],
];
// FR-079 AC-669: 区画の容量の刻み（行 3 つ分）。容量は中身の高さだけで決まる（決定的・冪等。AC-434・AC-432 (c)）。空の区画は EMPTY_BODY のまま
export const SLACK = ROW * 3;
export const capacity = (h) => (h <= EMPTY_BODY ? EMPTY_BODY : Math.ceil(h / SLACK) * SLACK);
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const label = (e, maxPx) => { const shown = fit(e.label, maxPx, FS); return { text: shown, full: e.label, emph: emphOf(shown, e.emphasis, FS) }; };

// 区画ごとの部品の組み立て。units を (x, y, w) から下へ並べ、{ els, h } を返す（els の外枠は重ならない）
const BUILD = {
  purpose: (units, x, y, w) => listRows(units, x, y, w, 'icon'),
  memo: (units, x, y, w) => listRows(units, x, y, w, 'icon'),
  decisions: (units, x, y, w) => listRows(units, x, y, w, 'check'),
  open: (units, x, y, w) => listRows(units, x, y, w, 'question'),
  members: (units, x, y, w) => {
    const els = []; let cy = y;
    // AC-668 (b): 名前（参加者名簿・話者タグ）は人物の絵記号と名前の組で、幅に収まれば 2 つずつ並べる（絵記号の選び方は名前と結びつけない。AC-630）
    const half = (w - 8) / 2; let col = 0;
    for (const e of units.filter((u) => u.memberName != null)) {
      const wide = textW(e.memberName, FS) > half - 36;
      if (col === 1 && wide) { col = 0; cy += 36; }
      els.push({ id: `member:${e.i}`, part: 'person', member: true, seed: `member:${e.i}`, persons: 1, x: x + col * (half + 8), y: cy, w: wide ? w : half, h: 32, name: e.memberName, nameShown: fit(e.memberName, (wide ? w : half) - 36, FS) });
      if (wide || col === 1) { col = 0; cy += 36; } else col = 1;
    }
    if (col === 1) cy += 36;
    for (const e of units.filter((u) => u.memberName == null)) {
      const n = Math.max(1, Math.min(6, (e.text.match(/さん|様|、|,|と/g) ?? []).length || 1));
      els.push({ id: `p:${e.pointId}`, part: 'person', x, y: cy, w, h: 62, pointId: e.pointId, sceneId: e.sceneId, persons: n, ...label(e, w) });
      cy += 68;
    }
    return { els, h: cy - y - 6 };
  },
  flow: (units, x, y, w) => { // units = ステップ（トピックごと）。バッジ・人物・吹き出し、ステップの間に ⇒
    const els = []; let cy = y;
    units.forEach((st, i) => {
      if (i > 0 || st.cont) { els.push({ id: `arrow:${st.uid}`, part: 'arrow', dir: 'down', x: x + 4, y: cy, w: 20, h: 16 }); cy += 20; }
      const bh = 10 + st.lines.length * 20;
      const h = Math.max(st.name ? 60 : 40, bh); // AC-668 (c): 話者タグの名前は人物の下に添える
      els.push({ id: `badge:${st.uid}`, part: 'badge', x, y: cy, w: 28, h: 28, n: st.n });
      els.push({ id: `person:${st.uid}`, part: 'person', x: x + 34, y: cy, w: 40, h: 40, seed: st.key, persons: 1, ...(st.name ? { name: st.name, nameShown: fit(st.name, 78, 12), speaker: true, firstPointId: st.lines[0].pointId } : {}) });
      els.push({ id: `bubble:${st.uid}`, part: 'bubble', x: x + 82, y: cy, w: w - 82, h: bh, step: st.n, sceneIds: st.sceneIds, pointIds: st.lines.map((l) => l.pointId), lines: st.lines.map((l) => ({ pointId: l.pointId, ...label(l, w - 82 - 30) })) });
      cy += h + 6;
    });
    return { els, h: cy - y - 6 };
  },
  themes: (units, x, y, w, first) => { // 絵記号付きの項目を 3 つずつ横に並べ、話順に矢印でつなぐ
    const AW = 24; const iw = (w - 3 * AW) / 3; const els = []; let cy = y;
    chunk(units, 3).forEach((row) => {
      row.forEach((e, j) => {
        const ax = x + j * (AW + iw);
        if (!(first && cy === y && j === 0)) els.push({ id: `arrow:p:${e.pointId}`, part: 'arrow', dir: 'right', x: ax, y: cy + 8, w: AW - 4, h: 16 });
        els.push({ id: `p:${e.pointId}`, part: 'icon', icon: 'bulb', x: ax + AW, y: cy, w: iw, h: 32, pointId: e.pointId, sceneId: e.sceneId, ...label(e, iw - 30) });
      });
      cy += 40;
    });
    return { els, h: cy - y - 8 };
  },
  vision: (units, x, y, w, first) => { // 「現状」→「目指す姿」の矢印と人物、その下に要点
    const els = []; let cy = y;
    if (first) {
      const bw = Math.floor((w - 40 - 48) / 2);
      els.push({ id: 'vision:now', part: 'icon', icon: 'dot', x, y: cy, w: bw, h: 40, word: 'now' });
      els.push({ id: 'vision:arrow', part: 'arrow', dir: 'right', x: x + bw + 4, y: cy + 12, w: 32, h: 16 });
      els.push({ id: 'vision:goal', part: 'icon', icon: 'flag', x: x + bw + 40, y: cy, w: bw, h: 40, word: 'goal' });
      els.push({ id: 'vision:person', part: 'person', x: x + w - 44, y: cy, w: 40, h: 40, seed: 'vision', persons: 1 });
      cy += 46;
    }
    const r = listRows(units, x, cy, w, 'icon', 'flag');
    return { els: [...els, ...r.els], h: cy - y + r.h };
  },
  actions: (units, x, y, w) => { // No・内容・担当・期限の 4 列の表
    const rows = units.map((e) => ({ pointId: e.pointId, sceneId: e.sceneId, no: e.no, owner: e.owner, due: e.due, ...label(e, w - 36 - 120 - 120 - 16) }));
    return { els: [{ id: `table:${units[0].pointId}`, part: 'table', x, y, w, h: ROW * (rows.length + 1), cols: [36, w - 36 - 240, 120, 120], rows }], h: ROW * (rows.length + 1) };
  },
};
function listRows(units, x, y, w, part, icon) {
  const els = units.map((e, i) => ({ id: `p:${e.pointId}`, part, icon, x, y: y + i * ROW, w, h: ROW - 4, pointId: e.pointId, sceneId: e.sceneId, ...label(e, w - 26) }));
  return { els, h: units.length ? units.length * ROW - 4 : 0 };
}

// input: { scenes, topics, titleInfo, lang }。opts.llmOf(sceneId, index) → { section, emphasis } | null
// 次アクションの表の行は、この区画に振り分けた要点ごとの図の表示で、議事項目（FR-094）の候補・確定とは別（「候補」の印は付けない。AC-666）
export function boardLayout(input, opts = {}) {
  const lang = L10N(input.lang);
  const tx = TEXT[lang];
  const info = input.titleInfo ?? {};
  // AC-668: 人物に添える名前（参加者名簿・.vtt の話者タグ）。opts.names: { members: [名前], speakerOf(発話 id) } | null（名前を表示しない・名前なし）
  const names = opts.names ?? null;
  const memberUnits = (names?.members ?? []).map((n) => clipLabel(n)).filter(Boolean).map((n, i) => ({ memberName: names.anonymous === true ? '' : n, i })); // anonymous: 名前を表示しない（AC-680。人物だけ）
  const title = { title: String(info.theme ?? '').trim(), subtitle: [info.series, info.venue].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ・ '), date: String(info.date ?? '').trim() };
  const band = title.title || title.subtitle || title.date ? { x: M, y: M, w: W - M * 2, h: BAND, title: fit(title.title || title.subtitle, W - M * 2 - 220, 26), subtitle: title.title ? fit(title.subtitle, W - M * 2 - 40, 15) : '', date: fit(title.date, 180, 15), full: title } : null;
  // 要点 → 区画
  const topicOf = new Map();
  (input.topics ?? []).forEach((tp, i) => { for (const id of tp.sceneIds ?? []) topicOf.set(id, { key: tp.id, i }); });
  const by = Object.fromEntries(SECTION_IDS.map((id) => [id, []]));
  const assigned = [];
  for (const s of input.scenes ?? []) {
    (s.points ?? []).forEach((p, idx) => {
      const llm = opts.llmOf?.(s.id, idx) ?? null;
      const a = assignSection(p, { llm });
      const e = { pointId: p.id, sceneId: s.id, uid: p.uid ?? null, text: String(p.text ?? ''), label: clipLabel(p.text), emphasis: a.emphasis, section: a.section, rule: a.rule, topic: topicOf.get(s.id)?.key ?? `scene:${s.id}` };
      if (a.section === 'actions') {
        const f = actionFields(e.text);
        e.owner = f.owner; e.due = f.due; e.no = by.actions.length + 1;
      }
      by[a.section].push(e);
      assigned.push({ pointId: p.id, sceneId: s.id, section: a.section, rule: a.rule });
    });
  }
  // 議論の流れ: トピックごとの話順のステップ（1 ステップの行が PARAM-088 を超えたら続きのステップに分ける）
  const steps = []; const stepNo = new Map();
  for (const e of by.flow) {
    if (!stepNo.has(e.topic)) stepNo.set(e.topic, stepNo.size + 1);
    let st = steps.findLast((x) => x.key === e.topic);
    if (!st || st.lines.length >= GROUP_MAX) { const k = steps.filter((x) => x.key === e.topic).length; st = { key: e.topic, uid: `${e.topic}#${k}`, n: stepNo.get(e.topic), cont: !!st, lines: [], sceneIds: [], name: names?.speakerOf?.(e.uid) ?? null }; steps.push(st); }
    st.lines.push(e); if (!st.sceneIds.includes(e.sceneId)) st.sceneIds.push(e.sceneId);
  }
  const unitsOf = (id) => (id === 'flow' ? steps : id === 'members' ? [...memberUnits, ...by.members] : by[id]);
  // 区画の中身（PARAM-088 を超えたら下位のまとまりに分ける。AC-428）
  const content = (id, x, y, w) => {
    const units = unitsOf(id);
    if (!units.length) return { els: [], subs: [], h: EMPTY_BODY };
    if (units.length <= GROUP_MAX) { const r = BUILD[id](units, x, y, w, true); return { els: r.els, subs: [], h: r.h }; }
    const els = []; const subs = []; let cy = y;
    chunk(units, GROUP_MAX).forEach((part, i) => {
      const r = BUILD[id](part, x + 6, cy + 6, w - 12, i === 0);
      subs.push({ x, y: cy, w, h: r.h + 12 });
      els.push(...r.els); cy += r.h + 12 + 8;
    });
    return { els, subs, h: cy - y - 8 };
  };
  let top = band ? M + BAND + GAP : M;
  const sections = [];
  for (const row of GRID) {
    const cells = row.map(([id, col, span]) => {
      const x = M + col * (COL + GAP); const w = span * COL + (span - 1) * GAP;
      const c = content(id, x + PAD, top + HEAD + 8, w - PAD * 2);
      return { id, x, w, c };
    });
    // AC-669: 枠の中身の高さは SLACK 刻みの容量に切り上げる。中身が容量に収まる間は枠もほかの区画も動かず、あふれたときだけ大きくなる
    const h = Math.max(...cells.map((cl) => HEAD + 8 + capacity(cl.c.h) + PAD));
    for (const cl of cells) {
      const def = SECTIONS.find((s) => s.id === cl.id);
      sections.push({ id: cl.id, name: def[lang], icon: def.icon, frame: { x: cl.x, y: top, w: cl.w, h }, headingRect: { x: cl.x + 8, y: top + 6, w: cl.w - 16, h: HEAD - 10 }, count: by[cl.id].length, elements: cl.c.els, subgroups: cl.c.subs });
    }
    top += h + GAP;
  }
  const H = top - GAP + M;
  let k = 0;
  for (const s of sections) for (const el of s.elements) { el.id ??= `${s.id}-${k++}`; el.section = s.id; } // id は要点・ステップから決める（取込の前後で同じ要素は同じ id。CONTRACT-BOARD）
  const model = { lang, band, sections, assigned, text: tx, canvas: { w: W, h: H } };
  return {
    canvas: { w: W, h: H }, title: { x: M, y: M, w: W - M * 2, h: 0, visible: false }, body: { x: M, y: band ? M + BAND + GAP : M, w: W - M * 2, h: H - M * 2 },
    units: [], arrows: [], orderMark: 'number', centered: false, titleLines: [], board: model,
    // FR-036 AC-167: 型を替えてもテキスト一覧のまとまりの小見出しは同じ（図は board が描くので、枠は持たない）
    groups: (input.topics ?? []).filter((tp) => tp.sceneIds?.length).map((tp) => ({ id: tp.id, kind: 'enclosure', heading: String(tp.title ?? '').trim() || tp.id, frame: { x: 0, y: 0, w: 0, h: 0 }, headingRect: { x: 0, y: 0, w: 0, h: 0 } })),
  };
}

// ---- 配色（描画スタイルの配色。見た目の項目のない従来の 4 つは白地と墨） ----
const pickOn = (fill, cands) => cands.reduce((b, c) => (contrastRatio(c, fill) > contrastRatio(b, fill) ? c : b), cands[0]);
export function boardColors(spec) {
  const p = spec?.palette;
  const bg = p?.background ?? '#ffffff'; const text = p?.text ?? '#15191f';
  const primary = p?.primary ?? '#1346a8'; const accent = p?.accent?.[0] ?? '#b45309';
  // 文字と背景のコントラスト比が PARAM-007 未満にならない色だけを使う（線・面は文字の背景にしない）
  const ink = contrastRatio(text, bg) >= MIN_CONTRAST ? text : pickOn(bg, [text, '#111111', '#ffffff']);
  const line = contrastRatio(primary, bg) >= 3 ? primary : ink;
  const bandInk = pickOn(line, [bg, ink, '#ffffff', '#111111']);
  const bandFill = contrastRatio(bandInk, line) >= MIN_CONTRAST ? line : ink;
  // マーカー: アクセントを背景に混ぜた面で、文字とのコントラスト比が PARAM-007 以上のときだけ。足りなければ下線
  // AC-670: 配色を限る定義（paletteOnly）では混ぜず、配色の黄（文字と 4.5 以上）をそのまま使う。なければ下線
  let marker = null;
  if (spec?.paletteOnly) marker = (p?.accent ?? []).filter((c) => isYellow(c)).find((c) => contrastRatio(ink, c) >= MIN_CONTRAST) ?? null;
  else for (const t of [0.5, 0.35, 0.25, 0.15]) { const c = mix(accent, bg, t); if (contrastRatio(ink, c) >= MIN_CONTRAST) { marker = c; break; } }
  const under = contrastRatio(accent, bg) >= 3 ? accent : line;
  // AC-670: 見出しの帯のグラデーション（headingBand）。白抜きの文字と絵記号が、帯のどの色（最も明るい位置を含む）とも PARAM-007 以上のときだけ
  const grad = spec?.headingBand?.gradient ?? null;
  const gradInk = grad ? pickOn(grad.reduce((a, c) => (lum(c) > lum(a) ? c : a), grad[0]), ['#ffffff', bg, ink, '#111111']) : null;
  const headBand = grad && grad.every((c) => contrastRatio(gradInk, c) >= MIN_CONTRAST) ? { stops: [...grad], ink: gradInk } : null;
  const card = spec?.card?.radius > 0 ? spec.card.radius : null; // AC-670: 要点の行・吹き出しを白いカード（角の丸み）で描く
  return { bg, ink, line, accent, bandFill, bandInk: pickOn(bandFill, [bg, ink, '#ffffff', '#111111']), marker, under, badgeInk: pickOn(line, [bg, ink, '#ffffff', '#111111']), headBand, card, paletteOnly: spec?.paletteOnly === true };
}
const hex = (c) => { const s = String(c).replace('#', ''); const f = s.length === 3 ? [...s].map((x) => x + x).join('') : s; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
const lum = (c) => contrastRatio(c, '#000000'); // 黒との比は明るさの順と同じ
const isYellow = (c) => { const [r, g, b] = hex(c); return r >= 200 && g >= 170 && b <= 120; };

// ---- 描画（SVG だけ） ----
const r1 = (v) => Math.round(v * 10) / 10;
const ICONS = {
  target: (c) => `<circle cx="10" cy="10" r="8" fill="none" stroke="${c}" stroke-width="2"/><circle cx="10" cy="10" r="3.5" fill="none" stroke="${c}" stroke-width="2"/>`,
  people: (c) => `<circle cx="6.5" cy="6" r="3" fill="none" stroke="${c}" stroke-width="2"/><circle cx="14" cy="6" r="3" fill="none" stroke="${c}" stroke-width="2"/><path d="M1 18c0-5 3-7 5.5-7s5.5 2 5.5 7M9 18c0-5 2.5-7 5-7s5 2 5 7" fill="none" stroke="${c}" stroke-width="2"/>`,
  chat: (c) => `<path d="M2 3h16v10H9l-4 4v-4H2z" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`,
  check: (c) => `<rect x="2" y="2" width="16" height="16" rx="3" fill="none" stroke="${c}" stroke-width="2"/><path d="M5.5 10.5l3 3 6-7" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  question: (c) => `<circle cx="10" cy="10" r="8.5" fill="none" stroke="${c}" stroke-width="2"/><path d="M7.5 7.5a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1.1.9-1.1 1.8" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="15" r="1.2" fill="${c}"/>`,
  bulb: (c) => `<path d="M10 2a6 6 0 0 1 3.5 10.9V15h-7v-2.1A6 6 0 0 1 10 2zM7.5 18h5" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  flag: (c) => `<path d="M4 19V2M4 3h11l-3 4 3 4H4" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  clipboard: (c) => `<rect x="3" y="3" width="14" height="16" rx="2" fill="none" stroke="${c}" stroke-width="2"/><path d="M7 2h6v3H7zM6 9h8M6 13h6" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
  pin: (c) => `<path d="M4 2h12v12l-4 4H4z" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/><path d="M7 7h6M7 11h4" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
  dot: (c) => `<circle cx="10" cy="10" r="6" fill="none" stroke="${c}" stroke-width="2"/><circle cx="10" cy="10" r="2" fill="${c}"/>`,
};
const icon = (name, x, y, color, scale = 1) => `<g data-board-part="icon" data-board-icon="${name}" transform="translate(${r1(x)} ${r1(y)})${scale !== 1 ? ` scale(${scale})` : ''}">${(ICONS[name] ?? ICONS.dot)(color)}</g>`;

// 区画の枠: 角丸（既定）か、描画スタイルの boardFrame が 'cloud' のときは雲形（stylepresets.js の boardFrameLook・cloudFramePath。AC-670）。
// 雲形の弧のふくらみと影が区画の枠（モデルの frame）の外へ出ないよう、内側へ寄せて描く（隣の区画と重ならない）
function cloudFrameSvg(f, look, seed) {
  let k = 0; let c = null;
  for (let i = 0; i < 3; i++) { // ふくらみの量は大きさで少し変わるので、収まるまで寄せ直す
    c = look.path(f.x + k, f.y + k, Math.max(1, f.w - 2 * k), Math.max(1, f.h - 2 * k), { seed });
    const need = Math.max(f.x - c.box[0], f.y - c.box[1], c.box[0] + c.box[2] - (f.x + f.w), c.box[1] + c.box[3] - (f.y + f.h)) + 3; // 3 = 影のずれ
    if (need <= 0.01) break;
    k += need;
  }
  return `<path d="${c.d}" transform="translate(3 3)" fill="${look.shadow}" stroke="none"/><path d="${c.d}" fill="${look.fill}" stroke="${look.stroke}" stroke-width="${r1(look.strokeWidth)}" stroke-linejoin="round"/>`;
}

function labelSvg(l, x, y, C, attrs = '') {
  const em = (l.emph ?? []).map((e) => (C.marker
    ? `<rect data-board-part="emphasis" data-emph="marker" x="${r1(x + e.dx)}" y="${r1(y - FS + 1)}" width="${r1(e.w)}" height="${FS + 4}" rx="2" fill="${C.marker}"/>`
    : `<path data-board-part="emphasis" data-emph="underline" d="M${r1(x + e.dx)} ${r1(y + 4)}h${r1(e.w)}" stroke="${C.under}" stroke-width="3" stroke-linecap="round"/>`)).join('');
  // 強調語の位置は文字幅の見積もりで決めるので、強調のある文字は見積もりの幅に合わせて描く（マーカー・下線が語に重なる）
  const fitAttr = l.emph?.length ? ` textLength="${r1(textW(l.text, FS))}" lengthAdjust="spacing"` : '';
  return `${em}<text x="${r1(x)}" y="${r1(y)}" font-size="${FS}" fill="${C.ink}"${fitAttr}${attrs}>${escapeHtml(l.text)}</text>`;
}
const arrowSvg = (el, C) => (el.dir === 'down'
  ? `<g data-board-part="arrow"><path d="M${el.x + 6} ${el.y}v${el.h - 6}M${el.x + 14} ${el.y}v${el.h - 6}M${el.x + 2} ${el.y + el.h - 8}l8 8 8-8" fill="none" stroke="${C.line}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>`
  : `<g data-board-part="arrow"><path d="M${el.x} ${el.y + 5}h${el.w - 6}M${el.x} ${el.y + 11}h${el.w - 6}M${el.x + el.w - 8} ${el.y}l8 8-8 8" fill="none" stroke="${C.line}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>`);
// AC-670: 配色を限る定義（paletteOnly）では、人物の線画も配色の線の色と白だけで描く（暗い塗りと線は線の色、それ以外の塗りは白）
const paletteOnlyPerson = (svg, C) => svg.replace(/(fill|stroke)="(#[0-9a-fA-F]{3,6})"/g, (_, a, col) => `${a}="${a === 'stroke' || contrastRatio(col, '#000000') < 4 ? C.line : C.bg}"`);
const personSvg = (id, x, y, size, C) => `<g data-board-part="person" transform="translate(${r1(x)} ${r1(y)}) scale(${r1(size / 48 * 100) / 100})">${C?.paletteOnly ? paletteOnlyPerson(personGroupFor(id), C) : personGroupFor(id)}</g>`;

// AC-669: 出現の演出の途中（a は 0〜1）は、中心 (cx, cy) を基準にフェードと拡大（縮小した状態から 1 倍へ。外枠を越えない）
const APPEAR_SCALE = 0.6;
export function appearSvg(inner, a, cx, cy) {
  if (a == null || a >= 1) return inner;
  const s = Math.round((APPEAR_SCALE + (1 - APPEAR_SCALE) * a) * 1000) / 1000;
  return `<g data-board-appear opacity="${Math.round(a * 1000) / 1000}" transform="translate(${r1(cx)} ${r1(cy)}) scale(${s}) translate(${r1(-cx)} ${r1(-cy)})">${inner}</g>`;
}
function elementSvg(el, C, tx) {
  const pid = el.pointId ? ` data-point-id="${escapeHtml(el.pointId)}"` : '';
  const g = (inner) => `<g data-board-el="${escapeHtml(el.id)}"${pid}>${inner}</g>`;
  switch (el.part) {
    case 'check': case 'question': case 'icon': {
      if (el.word) { // 目指す姿の「現状」「目指す姿」の箱
        return g(`<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="8" fill="${C.bg}" stroke="${C.line}" stroke-width="2"/>${icon(el.icon, el.x + 8, el.y + 10, C.line)}<text x="${el.x + 34}" y="${el.y + 26}" font-size="15" font-weight="700" fill="${C.ink}">${escapeHtml(tx[el.word])}</text>`);
      }
      const ic = el.part === 'icon' ? icon(el.icon ?? 'dot', el.x, el.y + 2, C.line, 0.9) : `<g data-board-part="${el.part}" transform="translate(${el.x} ${el.y + 2}) scale(0.9)">${ICONS[el.part](C.line)}</g>`;
      const box = el.h > ROW ? `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="${C.card ?? 6}" fill="${C.bg}" stroke="${C.line}" stroke-width="1.5"/>`
        : C.card ? `<rect data-board-card x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="${C.card}" fill="${C.bg}" stroke="${C.line}" stroke-width="1.2"/>` : '';
      const ix = el.h > ROW ? el.x + 6 : el.x; const iy = el.h > ROW ? el.y + 6 : el.y;
      const ic2 = el.h > ROW ? icon(el.icon ?? 'dot', ix, iy + 2, C.line, 0.9) : C.card ? (el.part === 'icon' ? icon(el.icon ?? 'dot', el.x + 3, el.y + 2, C.line, 0.9) : `<g data-board-part="${el.part}" transform="translate(${el.x + 3} ${el.y + 2}) scale(0.9)">${ICONS[el.part](C.line)}</g>`) : ic;
      return g(`${box}${ic2}${labelSvg(el, ix + 24, iy + 16, C)}`);
    }
    case 'person': {
      if (el.text != null) { // 参加メンバー: 人物の絵記号の並びと、要点の文字
        const ps = Array.from({ length: el.persons }, (_, i) => personSvg(`${el.pointId}:${i}`, el.x + i * 44, el.y, 40, C)).join('');
        return g(`${ps}${labelSvg(el, el.x, el.y + 58, C)}`);
      }
      if (el.member) { // AC-668 (b): 参加メンバーの名前（人物の絵記号と名前の組）
        return g(`${personSvg(String(el.seed), el.x, el.y + 2, 28, C)}${el.nameShown ? `<text data-board-name="participant" x="${r1(el.x + 32)}" y="${r1(el.y + 22)}" font-size="${FS}" fill="${C.ink}">${escapeHtml(el.nameShown)}</text>` : ''}`);
      }
      const said = el.name ? `<text data-board-name="speaker" x="${r1(el.x - 34)}" y="${r1(el.y + 56)}" font-size="12" fill="${C.ink}">${escapeHtml(el.nameShown)}</text>` : ''; // AC-668 (c): 話者タグの名前
      return g(personSvg(String(el.seed), el.x, el.y, el.w, C) + said);
    }
    case 'badge':
      return g(`<g data-board-part="badge"><circle cx="${el.x + 14}" cy="${el.y + 14}" r="13" fill="${C.line}"/><text x="${el.x + 14}" y="${el.y + 19}" font-size="15" font-weight="800" text-anchor="middle" fill="${C.badgeInk}">${el.n}</text></g>`);
    case 'bubble': {
      const d = `M${el.x + 10} ${el.y}H${el.x + el.w}V${el.y + el.h}H${el.x + 10}V${el.y + 22}L${el.x} ${el.y + 16}L${el.x + 10} ${el.y + 10}Z`;
      const lines = el.lines.map((l, i) => appearSvg(`<g data-point-id="${escapeHtml(l.pointId)}">${labelSvg(l, el.x + 20, el.y + 22 + i * 20, C)}</g>`, l.appear, el.x + 20, el.y + 16 + i * 20)).join('');
      const body = C.card // AC-670: 白いカード（角の丸み card.radius）の吹き出し
        ? `<rect data-board-part="bubble" data-board-card x="${el.x + 10}" y="${el.y}" width="${el.w - 10}" height="${el.h}" rx="${C.card}" fill="${C.bg}" stroke="${C.line}" stroke-width="2"/><path d="M${el.x + 10} ${el.y + 10}L${el.x} ${el.y + 16}L${el.x + 10} ${el.y + 22}" fill="${C.bg}" stroke="${C.line}" stroke-width="2" stroke-linejoin="round"/>`
        : `<path data-board-part="bubble" d="${d}" fill="${C.bg}" stroke="${C.line}" stroke-width="2" stroke-linejoin="round"/>`;
      return `<g data-board-el="${escapeHtml(el.id)}" data-board-step="${el.step}">${body}${lines}</g>`;
    }
    case 'arrow': return g(arrowSvg(el, C));
    case 'table': {
      const [c0, c1, c2] = el.cols; const xs = [el.x, el.x + c0, el.x + c0 + c1, el.x + c0 + c1 + c2];
      const head = [tx.no, tx.content, tx.owner, tx.due].map((h, i) => `<text x="${xs[i] + 6}" y="${el.y + 18}" font-size="${FS}" font-weight="800" fill="${C.ink}">${escapeHtml(h)}</text>`).join('');
      const rows = el.rows.map((r, i) => {
        const y = el.y + ROW * (i + 1);
        return appearSvg(`<g data-point-id="${escapeHtml(r.pointId)}" data-board-row="${r.no}"><path d="M${el.x} ${y}h${el.w}" stroke="${C.line}" stroke-width="1"/>`
          + `<text x="${xs[0] + 6}" y="${y + 18}" font-size="${FS}" fill="${C.ink}">${r.no}</text>${labelSvg(r, xs[1] + 6, y + 18, C)}`
          + `<text x="${xs[2] + 6}" y="${y + 18}" font-size="${FS}" fill="${C.ink}">${escapeHtml(fit(r.owner ?? tx.tbd, c2 - 10, FS))}</text>`
          + `<text x="${xs[3] + 6}" y="${y + 18}" font-size="${FS}" fill="${C.ink}">${escapeHtml(fit(r.due ?? tx.tbd, el.cols[3] - 10, FS))}</text></g>`, r.appear, el.x + el.w / 2, y + ROW / 2);
      }).join('');
      const vlines = xs.slice(1).map((x) => `<path d="M${x} ${el.y}v${el.h}" stroke="${C.line}" stroke-width="1"/>`).join('');
      return g(`<g data-board-part="table"><rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" fill="${C.bg}" stroke="${C.line}" stroke-width="1.6"/><path d="M${el.x} ${el.y + ROW}h${el.w}" stroke="${C.line}" stroke-width="2"/>${vlines}${head}${rows}</g>`);
    }
    default: return '';
  }
}

export function boardSvg(L, opts = {}) {
  const m = L.board; const tx = m.text;
  const spec = opts.style ?? null;
  const C = boardColors(spec);
  const look = spec ? boardFrameLook(spec) : null; // AC-670: 雲形の枠の配色と形（style-670 の定義）
  const shape = look ? 'cloud' : 'rounded';
  const lw = Math.max(1.2, Math.min(3, 2 * (spec?.line?.width ?? 1)));
  const attrs = [`data-draw-style="${escapeHtml(opts.drawStyle ?? 'handwritten')}"`, `data-board-frame="${shape}"`];
  if (opts.types) attrs.push(`data-layout-types="${escapeHtml(opts.types.join(' '))}"`, `data-layout-head="${BOARD_TYPE_ID}"`);
  const out = [`<rect data-board-paper x="0" y="0" width="${m.canvas.w}" height="${m.canvas.h}" fill="${C.bg}"/>`];
  // AC-670: 見出しの帯のグラデーション（headingBand）。タイトル帯と区画の見出しを帯で塗り、文字と絵記号は白抜き
  const HB = C.headBand;
  if (HB) out.push(`<defs><linearGradient id="board-head-band" x1="0" y1="0" x2="1" y2="0">${HB.stops.map((c, i) => `<stop offset="${r1(i / (HB.stops.length - 1))}" stop-color="${c}"/>`).join('')}</linearGradient></defs>`);
  const bandFill = HB ? 'url(#board-head-band)' : C.bandFill; const bandInk = HB ? HB.ink : C.bandInk;
  if (m.band) {
    const b = m.band;
    out.push(`<g data-board-part="title"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12" fill="${bandFill}"/>`
      + (b.title ? `<text x="${b.x + 20}" y="${b.y + 36}" font-size="26" font-weight="800" fill="${bandInk}">${escapeHtml(b.title)}</text>` : '')
      + (b.subtitle ? `<text x="${b.x + 20}" y="${b.y + 62}" font-size="15" fill="${bandInk}">${escapeHtml(b.subtitle)}</text>` : '')
      + (b.date ? `<text x="${b.x + b.w - 20}" y="${b.y + 36}" font-size="15" font-weight="700" text-anchor="end" fill="${bandInk}">${escapeHtml(b.date)}</text>` : '')
      + '</g>');
  }
  for (const s of m.sections) {
    const f = s.shown ?? s.frame; // 描き足しで枠が動く途中は表示の位置（createBoardMotion）
    const frame = look ? cloudFrameSvg(f, look, s.id) : `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="12" fill="${C.bg}" stroke="${C.line}" stroke-width="${lw}"/>`;
    // 雲形の枠（黄の面）の上の文字は、枠の配色の文字の色（黄の面と白い面の両方で PARAM-007 以上のときだけ）
    const SC = look && contrastRatio(look.text, look.fill) >= MIN_CONTRAST && contrastRatio(look.text, C.bg) >= MIN_CONTRAST ? { ...C, ink: look.text } : C;
    // 見出しの絵記号は枠と見出しの一部（部品「絵記号」は要点のある区画にだけ現れる）
    const head = HB
      ? `<rect data-board-heading-band x="${f.x + 8}" y="${f.y + 6}" width="${f.w - 16}" height="${HEAD - 10}" rx="6" fill="${bandFill}"/><g data-board-heading-icon="${s.icon}" transform="translate(${f.x + 12} ${f.y + 8})">${ICONS[s.icon](bandInk)}</g><text data-board-heading x="${f.x + 40}" y="${f.y + 25}" font-size="16" font-weight="800" fill="${bandInk}">${escapeHtml(s.name)}</text>`
      : `<g data-board-heading-icon="${s.icon}" transform="translate(${f.x + 12} ${f.y + 8})">${ICONS[s.icon](C.line)}</g><text data-board-heading x="${f.x + 40}" y="${f.y + 25}" font-size="16" font-weight="800" fill="${SC.ink}">${escapeHtml(s.name)}</text>`
      + `<path d="M${f.x + 40} ${f.y + 31}h${r1(Math.min(f.w - 52, textW(s.name, 16)))}" stroke="${C.under}" stroke-width="2.5" stroke-linecap="round"/>`;
    const subs = s.subgroups.map((sg) => `<rect data-board-subgroup x="${sg.x}" y="${sg.y}" width="${sg.w}" height="${sg.h}" rx="8" fill="none" stroke="${C.line}" stroke-width="1" stroke-dasharray="5 4"/>`).join('');
    out.push(`<g data-board-section="${s.id}" data-board-part="frame" data-count="${s.count}">${frame}${head}${subs}${s.elements.map((el) => { const g = appearSvg(elementSvg(el, SC, tx), el.appear, el.x + el.w / 2, el.y + el.h / 2); return el.dx || el.dy ? `<g transform="translate(${r1(el.dx ?? 0)} ${r1(el.dy ?? 0)})">${g}</g>` : g; }).join('')}</g>`);
  }
  const { w, h } = m.canvas;
  const title = opts.title ?? tx.aria;
  return `<svg ${attrs.join(' ')} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="'Yu Gothic UI', system-ui, 'Hiragino Sans', Meiryo, sans-serif" role="img" aria-label="${escapeHtml(tx.aria)}"><title>${escapeHtml(title)}</title>${out.join('')}</svg>`;
}

// 図に現れる部品の種類（AC-666・AC-667 (b)）
export const partKindsOf = (svg) => [...new Set([...String(svg).matchAll(/data-board-part="([a-z]+)"/g)].map((x) => x[1]))].filter((k) => PART_KINDS.includes(k));
// テキスト一覧（NFR-A11Y-001）は AC-141・AC-664 のとおり型の影響を受けない（区画名・次アクションの表を一覧に足さない）。要点の文字は従来の一覧にある

// ---- 描き足しで位置が変わる要素の移動（FR-079 AC-669・AC-667 (f)）。DOM に依存しない ----
export const MOVE_MS = 400; // PARAM-181（600 ミリ秒）以内
const ease = (k) => 1 - (1 - k) ** 3;
// 区画の枠と要素の目標の位置が変わったら、いまの表示位置から MOVE_MS かけて移す。reduced（動きを減らす設定）なら移動なし。
// board（getDiagramLayout の写し）の位置を表示位置に書き換え、要素には目標からのずれ dx・dy を付ける。移動中なら true
export function createBoardMotion() {
  const last = new Map(); const moving = new Map();
  const at = (key, t) => {
    const m = moving.get(key); if (!m) return null;
    const k = Math.min(1, Math.max(0, (t - m.t0) / MOVE_MS));
    if (k >= 1) { moving.delete(key); return m.to; }
    const e = ease(k); const o = {};
    for (const p of Object.keys(m.to)) o[p] = m.from[p] + (m.to[p] - m.from[p]) * e;
    return o;
  };
  const step = (key, target, t, reduced) => {
    const prev = last.get(key);
    if (reduced) moving.delete(key);
    else if (prev && Object.keys(target).some((p) => prev[p] !== target[p])) moving.set(key, { from: at(key, t) ?? prev, to: target, t0: t });
    last.set(key, target);
    return at(key, t) ?? target;
  };
  // AC-669: 新しく現れた要素（行・吹き出しの 1 行を含む）は MOVE_MS かけてフェードと拡大で現れる。最初の描画と動きを減らす設定では演出なし
  const seen = new Set(); const appearing = new Map(); let seeded = false;
  const appear = (key, t, reduced) => {
    if (!seen.has(key)) { seen.add(key); if (seeded && !reduced) appearing.set(key, t); }
    const t0 = appearing.get(key); if (t0 == null) return null;
    if (reduced) { appearing.delete(key); return null; }
    const k = Math.min(1, Math.max(0, (t - t0) / MOVE_MS));
    if (k >= 1) { appearing.delete(key); return null; }
    return ease(k);
  };
  return {
    apply(board, t, reduced) {
      for (const s of board.sections) {
        const f = step(`frame:${s.id}`, { ...s.frame }, t, reduced);
        const fdx = f.x - s.frame.x; const fdy = f.y - s.frame.y;
        if (fdx || fdy || f.h !== s.frame.h || f.w !== s.frame.w) s.shown = f; // 枠の表示（見出しも一緒に動く）
        for (const el of s.elements) {
          const p = step(el.id, { x: el.x, y: el.y }, t, reduced);
          el.dx = p.x - el.x; el.dy = p.y - el.y; el.x = p.x; el.y = p.y;
          const a = appear(el.id, t, reduced); if (a != null) el.appear = a;
          for (const r of [...(el.lines ?? []), ...(el.rows ?? [])]) { const b = appear(`${el.id}|${r.pointId}`, t, reduced); if (b != null && a == null) r.appear = b; }
        }
      }
      seeded = true;
      return moving.size > 0 || appearing.size > 0;
    },
    moving: () => moving.size > 0 || appearing.size > 0,
    // 契約（CONTRACT-BOARD の animations。AC-673）: いま進行中の出現・移動（区画の枠と、要素の 1 行の出現は除く）
    animations: (t) => [...[...appearing.keys()].filter((k) => !k.includes('|') && t - appearing.get(k) < MOVE_MS).map((id) => ({ id, kind: 'appear' })), ...[...moving.entries()].filter(([k, m]) => !k.startsWith('frame:') && t - m.t0 < MOVE_MS).map(([id]) => ({ id, kind: 'move' }))],
  };
}

// ---- アプリ組立の拡張（modules）。workshopModule の後に足す（先頭の型が board のとき、描画を引き取る） ----
export function boardModule(ctx) {
  const { api, state } = ctx;
  const llmOf = (sceneId, idx) => api.getLlmPointSection?.(sceneId, idx) ?? null;
  api.registerLayoutType(BOARD_TYPE_ID, { layout: (input) => boardLayout(input, { llmOf, names: api.getBoardNames?.() ?? null }) });
  const active = () => {
    const info = api.getLayoutInfo?.();
    return !!info && info.applied && info.head === BOARD_TYPE_ID && state.displayMode !== 'arrange';
  };
  api.isBoardActive = active;
  // 移動の途中の表示を描き直す契機（scheduler.setTimeout。移動が終われば予約しない）
  const motion = createBoardMotion();
  const sched = ctx.options?.scheduler ?? { setTimeout: (f, ms) => globalThis.setTimeout(f, ms) };
  const now = () => (typeof ctx.now === 'function' ? ctx.now() : Date.now());
  let ticking = false;
  const tick = () => { ticking = false; if (active() && motion.moving()) ctx.emit('change', api); };
  const shownLayout = () => {
    const L = api.getDiagramLayout();
    // FR-115 決定 C-01: ライブ描画ショーが ON のときは、ショーの描線・運ぶ演出がこの出現・移動の演出を置き換える（ここでは直ちに最終の位置）
    const instant = ctx.env?.reducedMotion === true || api.isLiveShowDriving?.() === true;
    if (motion.apply(L.board, now(), instant) && !ticking) { ticking = true; sched.setTimeout(tick, 40); }
    return L;
  };
  const baseRender = api.renderBaseSvg;
  api.renderBaseSvg = () => {
    if (!active()) return baseRender();
    const info = api.getLayoutInfo();
    return boardSvg(shownLayout(), { types: info.selected, drawStyle: api.getDrawStyle?.(), style: api.getDrawStyleSpec?.(), title: ctx.t('app.title') });
  };
  // 契約（CONTRACT-BOARD）: 会議ボードの配置のモデル（区画の枠・要素の現在の表示位置の外枠・振り分け）。先頭の型が board でないときは null
  // 状態の変更の時点で表示位置を進める（描画を待たずに、出現・移動の始まりを変更の時点にそろえる）
  ctx.on?.('change', () => { if (active()) shownLayout(); });
  api.getBoardModel = () => {
    if (!active()) return null;
    const b = shownLayout().board;
    return { ...b, sections: b.sections.map(({ shown, ...s }) => ({ ...s, frame: shown ?? s.frame })), animations: motion.animations(now()) };
  };
}
