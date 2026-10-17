// FR-031 タイムライン型 / FR-032 吹き出し型 / FR-033 発散型 / FR-034 区画型 / FR-035 比喩テンプレート型の配置（共通部品「レイアウト型レジストリ」へ registerLayoutType で登録する）。
// DOM・外部通信に依存しない決定的な純粋関数。話者の識別は対象外（Q-006。AC-157 は BLOCKED）のため吹き出しは話者で分けない。
import { timelineLayout } from './layouttypes.js';
import { classifyPoint, kindLabelOf, baseKind } from './diagram.js';
import { detectEmotions } from './emotion.js';
import { tokenize } from './topics.js';

export const MIN_ECHO = 2; // PARAM-019: 共感が集まった意見とみなす、同じ語句が現れる異なるシーンの最小数

const W = 1280; const M = 24; const GAP = 32; const TITLE_H = 48;
const BODY_Y = M + TITLE_H + GAP / 2;
export const EVIDENCE_MAX = 40; // PARAM-033: 関係の根拠の語の最大文字数
// FR-055: 因果の語。「から」は理由（用言の後）のときだけ因果で、時間・起点（「来月から」「3時から」）や用法が判定できないものは因果にしない。英語の起点 from は対象外。
const CAUSE_WORD_RE = /だから|なので|ゆえ|ため|\bbecause\b|\bso\b/i;
const TIME_BEFORE_KARA = /(\d+\s*[時分日月年秒]|[時分日月年週秒]|来月|今月|先月|来週|今週|先週|明日|今日|昨日|午前|午後|朝|昼|夜|曜日|最初|初め|はじめ|以降|今|ここ|そこ|これ|それ)$/;
const PREDICATE_END = /(い|る|た|だ|す|ん|う|く|つ|ぬ|む|ぶ|ぐ|ず)$/;
export function causalEvidence(text) {
  const s = String(text ?? '');
  const m = CAUSE_WORD_RE.exec(s);
  if (m) return m[0];
  let i = s.indexOf('から');
  while (i >= 0) {
    const before = s.slice(0, i).replace(/[、,\s]+$/, '');
    if (before && !TIME_BEFORE_KARA.test(before) && PREDICATE_END.test(before)) return 'から';
    i = s.indexOf('から', i + 1);
  }
  return null;
}
// FR-053: 要点の並び（話順）の隣り合う 2 つから関係を決定的に導く。向きは原因・課題が始点、結果・提案が終点。
// 明示: 後ろの発話に因果の語（evidence=word）／課題の次にアイデア・提案（evidence=kinds）。推測: 課題の次に結論が続くだけで根拠の語がない（evidence=null）。
export function deriveRelations(points) {
  const out = [];
  const kinds = points.map((p) => classifyPoint(p.text));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]; const b = points[i];
    const word = causalEvidence(b.text);
    if (word) { out.push({ kind: 'cause-effect', from: a.id, to: b.id, basis: 'explicit', evidence: { type: 'word', text: [...word].slice(0, EVIDENCE_MAX).join('') } }); continue; }
    if (kinds[i - 1] === 'issue' && (kinds[i] === 'idea' || kinds[i] === 'proposal')) out.push({ kind: 'problem-proposal', from: a.id, to: b.id, basis: 'explicit', evidence: { type: 'kinds', text: `${kinds[i - 1]}→${kinds[i]}` } });
    else if (kinds[i - 1] === 'issue' && kinds[i] === 'conclusion') out.push({ kind: 'problem-proposal', from: a.id, to: b.id, basis: 'inferred', evidence: null });
    else if (causalEvidence(a.text)) out.push({ kind: 'cause-effect', from: a.id, to: b.id, basis: 'inferred', evidence: null }); // 理由を述べた発話の直後の発話は、話順だけから結果の候補とする（推測）
  }
  return out;
}
const REL_LABELS = {
  ja: { 'cause-effect': '原因→結果', 'problem-proposal': '課題→提案', explicit: '明示', inferred: '推測' },
  en: { 'cause-effect': 'Cause→Effect', 'problem-proposal': 'Issue→Proposal', explicit: 'Explicit', inferred: 'Inferred' },
};
export function labelRelations(rels, lang) {
  const L = REL_LABELS[lang === 'en' ? 'en' : 'ja'];
  return rels.map((r) => ({
    ...r, kindLabel: L[r.kind], basisLabel: L[r.basis],
    evidence: r.evidence && r.evidence.type === 'kinds' ? { type: 'kinds', text: r.evidence.text.split('→').map((k) => kindLabelOf(k, lang)).join('→') } : r.evidence,
  }));
}
const QUESTION_RE = /[?？]/;
const LABELS = {
  cause: { ja: '原因→結果', en: 'Cause→Effect' },
  proposal: { ja: '課題→提案', en: 'Issue→Proposal' },
  conclusion: { ja: '結論', en: 'Conclusion' },
  opening: { ja: '冒頭', en: 'Opening' },
};
const lab = (input, key) => LABELS[key][input.lang === 'en' ? 'en' : 'ja'];
const titleLines = (info) => ['series', 'theme', 'date', 'venue'].map((k) => String(info?.[k] ?? '').trim()).filter(Boolean);
const topicOfScene = (topics) => { const m = new Map(); for (const tp of topics) for (const id of tp.sceneIds) m.set(id, tp); return m; };

// ---- FR-031 タイムライン型: 共通の Z 字配置に、矢印のラベル・強調・見出しを加える ----
export function timelineTypeLayout(input) {
  const L = timelineLayout(input);
  const detail = input.level === 'detail';
  const sceneById = new Map(input.scenes.map((s) => [s.id, s]));
  const topicById = new Map(input.topics.map((tp) => [tp.id, tp]));
  const kindsOf = (u) => (u.kind === 'scene' ? sceneById.get(u.id)?.points.map((p) => classifyPoint(p.text)) ?? [] : []);
  L.units = L.units.map((u, i) => {
    const text = u.kind === 'topic' ? (topicById.get(u.id)?.title ?? u.id) : (sceneById.get(u.id)?.heading ?? u.id);
    let emphasis = null; let badge = null;
    if (i === 0) { emphasis = 'opening'; badge = lab(input, 'opening'); }
    if (detail && kindsOf(u).includes('conclusion')) { emphasis = emphasis ?? 'conclusion'; badge = lab(input, 'conclusion'); }
    return { ...u, text, emphasis, badge, relations: [] };
  });
  if (detail) {
    // 要点の並び（話順）の隣り合う 2 つ: 原因→結果（後ろの発話に因果の語）、課題→提案（課題の次にアイデア）
    const flat = [];
    L.units.forEach((u, ui) => { for (const p of sceneById.get(u.id)?.points ?? []) flat.push({ ui, p }); });
    const byId = new Map(flat.map((f) => [f.p.id, f]));
    // FR-053/FR-055: deriveRelations（時間用法の「から」は因果にしない）。推測の関係は「（推測）」を添える
    for (const r of labelRelations(deriveRelations(flat.map((f) => f.p)), input.lang)) {
      const a = byId.get(r.from); const b = byId.get(r.to);
      const label = r.basis === 'inferred' ? `${r.kindLabel}（${r.basisLabel}）` : r.kindLabel;
      if (a.ui !== b.ui) { const ar = L.arrows.find((x) => x.from === L.units[a.ui].id && x.to === L.units[b.ui].id); if (ar && !ar.label) ar.label = label; }
      else L.units[b.ui].relations.push({ from: a.p.id, to: b.p.id, label });
    }
  }
  return L;
}

// ---- 吹き出し型・発散型の共通: 描く単位（詳細度に従う） ----
function sources(input) {
  const tOf = topicOfScene(input.topics);
  if (input.level === 'major') {
    return input.topics.map((tp) => ({ id: tp.id, kind: 'topic', text: tp.title, topicId: tp.id, sceneId: tp.sceneIds[0], texts: tp.sceneIds.flatMap((id) => input.scenes.find((s) => s.id === id)?.points.map((p) => p.text) ?? []) }));
  }
  if (input.level === 'middle') {
    return input.scenes.map((s) => ({ id: s.id, kind: 'scene', text: s.heading, topicId: tOf.get(s.id)?.id ?? `scene:${s.id}`, sceneId: s.id, texts: s.points.map((p) => p.text) }));
  }
  return input.scenes.flatMap((s) => s.points.map((p) => ({ id: p.id, kind: 'point', text: p.text, topicId: tOf.get(s.id)?.id ?? `scene:${s.id}`, sceneId: s.id, texts: [p.text] })));
}
const topicTitle = (input, id) => input.topics.find((tp) => tp.id === id)?.title ?? input.scenes.find((s) => `scene:${s.id}` === id)?.heading ?? id;
const emotional = (src) => src.texts.some((t) => detectEmotions(t).length) || detectEmotions(src.text).length > 0;

// ---- FR-032 吹き出し型 ----
export function bubbleLayout(input) {
  const info = input.titleInfo ?? {};
  const visible = titleLines(info).length > 0;
  const title = { x: M, y: M, w: W - M * 2, h: TITLE_H, visible };
  const BW = 600; const BH = 44; const HEAD = 26; const OVER = 12; const TOPIC_GAP = 48;
  const src = sources(input);
  const units = []; const arrows = []; const groups = [];
  let y = BODY_Y; let order = 0; let prevTopic = null; let g = null; let prev = null;
  const closeGroup = () => { if (g) { g.frame.h = y - g.frame.y + 8; groups.push(g); y = g.frame.y + g.frame.h; g = null; } };
  for (const s of src) {
    if (s.topicId !== prevTopic) {
      closeGroup(); if (prevTopic !== null) y += TOPIC_GAP; // 話題の切替は余白
      g = { id: s.topicId, kind: 'topic', heading: String(topicTitle(input, s.topicId)).trim() || s.topicId, frame: { x: M, y, w: W - M * 2, h: 0 }, headingRect: { x: M + 8, y: y + 4, w: W - M * 2 - 16, h: 18 } };
      y += HEAD; prevTopic = s.topicId; prev = null;
    }
    const left = order % 2 === 0;
    const isAnswer = prev && QUESTION_RE.test(prev.text) && !QUESTION_RE.test(s.text);
    let x = left ? M + 12 : W - M - 12 - BW;
    let uy = y;
    if (isAnswer) { x = prev.x + (left ? 60 : -60); uy = prev.y + prev.h - OVER; }
    const u = { id: s.id, kind: s.kind, order, x, y: uy, w: BW, h: BH, text: s.text, shape: emotional(s) ? 'jagged' : 'round', role: QUESTION_RE.test(s.text) ? 'question' : (isAnswer ? 'answer' : 'statement'), attachedTo: isAnswer ? prev.id : null, emphasis: null, badge: null, relations: [] };
    if (isAnswer) arrows.push({ from: prev.id, to: u.id, label: null });
    units.push(u); y = uy + BH + (isAnswer ? 14 : 14); prev = u; order += 1;
  }
  closeGroup();
  const bodyH = units.length ? y - BODY_Y : 0;
  return { canvas: { w: W, h: BODY_Y + bodyH + M }, title, body: { x: M, y: BODY_Y, w: W - M * 2, h: bodyH }, units, arrows, orderMark: 'number', groups, centered: false, titleLines: titleLines(info) };
}

// ---- FR-033 発散型 ----
export function divergeLayout(input) {
  const info = input.titleInfo ?? {};
  const visible = titleLines(info).length > 0;
  const OW = 200; const OH = 56; const CW = 240; const CH = 80; const R0 = 250; const STEP = 250; const ARC = 240; const HEAD = 24;
  const src = sources(input);
  // 共感: 同じ語句が MIN_ECHO 以上の異なるシーンの要点に現れる意見を強調する（大きさの基準は全員同じ）
  const sceneSets = new Map(input.scenes.map((s) => [s.id, new Set(tokenize(s.points.map((p) => p.text)).map((w) => w.toLowerCase()))]));
  const spread = new Map();
  for (const set of sceneSets.values()) for (const w of set) spread.set(w, (spread.get(w) ?? 0) + 1);
  const echoed = (s) => tokenize(s.texts).some((w) => (spread.get(w.toLowerCase()) ?? 0) >= MIN_ECHO);
  const theme = String(input.scenes[0]?.heading ?? '');
  const raw = []; // 中心を (0,0) とした配置
  let ring = 0; let slot = 0;
  src.forEach((s, i) => {
    let cap = Math.max(1, Math.floor((2 * Math.PI * (R0 + ring * STEP)) / ARC));
    if (slot >= cap) { ring += 1; slot = 0; cap = Math.max(1, Math.floor((2 * Math.PI * (R0 + ring * STEP)) / ARC)); }
    const r = R0 + ring * STEP;
    const th = -Math.PI / 2 + (2 * Math.PI * slot) / cap + (ring % 2 ? Math.PI / cap : 0);
    raw.push({ s, i, cx: r * Math.cos(th), cy: r * Math.sin(th) });
    slot += 1;
  });
  const gx = new Map(); // topicId → 範囲
  for (const r of raw) {
    const b = gx.get(r.s.topicId) ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    b.x0 = Math.min(b.x0, r.cx - OW / 2); b.y0 = Math.min(b.y0, r.cy - OH / 2 - HEAD); b.x1 = Math.max(b.x1, r.cx + OW / 2); b.y1 = Math.max(b.y1, r.cy + OH / 2);
    gx.set(r.s.topicId, b);
  }
  const xs = [-CW / 2, CW / 2, ...[...gx.values()].flatMap((b) => [b.x0 - 8, b.x1 + 8])]; const ys = [-CH / 2, CH / 2, ...[...gx.values()].flatMap((b) => [b.y0 - 8, b.y1 + 8])];
  const ox = M - Math.min(...xs); const oy = BODY_Y - Math.min(...ys);
  const bw = Math.max(...xs) - Math.min(...xs); const bh = Math.max(...ys) - Math.min(...ys);
  const hasScenes = src.length > 0;
  const center = hasScenes ? { id: 'center', x: ox - CW / 2, y: oy - CH / 2, w: CW, h: CH, text: theme } : null;
  const units = raw.map((r) => ({ id: r.s.id, kind: r.s.kind, order: r.i, x: r.cx + ox - OW / 2, y: r.cy + oy - OH / 2, w: OW, h: OH, text: r.s.text, emphasis: echoed(r.s) ? 'echo' : null, badge: echoed(r.s) ? '★' : null, topicId: r.s.topicId, relations: [] }));
  const groups = [...gx.entries()].map(([id, b]) => {
    const frame = { x: b.x0 - 8 + ox, y: b.y0 - 8 + oy, w: b.x1 - b.x0 + 16, h: b.y1 - b.y0 + 16 };
    return { id, kind: 'enclosure', heading: String(topicTitle(input, id)).trim() || id, frame, headingRect: { x: frame.x + 8, y: frame.y + 4, w: frame.w - 16, h: 18 } };
  });
  const arrows = center ? units.map((u) => ({ from: 'center', to: u.id, label: null })) : [];
  const bodyW = hasScenes ? bw : 0;
  return {
    canvas: { w: Math.max(W, Math.ceil(M * 2 + bodyW)), h: Math.ceil(hasScenes ? BODY_Y + bh + M : BODY_Y + M) },
    title: { x: M, y: M, w: Math.max(W, M * 2 + bodyW) - M * 2, h: TITLE_H, visible },
    body: { x: M, y: BODY_Y, w: bodyW, h: hasScenes ? bh : 0 }, center, units, arrows, orderMark: 'arrow', groups, centered: false, titleLines: titleLines(info),
  };
}

    // ---- FR-034 区画型 / FR-035 比喩テンプレート型の共通: 描く単位（大項目＝トピック、それ以外＝シーン。詳細は要点も添える） ----
    export const MAX_ZONES = 4; // PARAM-017（autolayout.js と同じ値。この型では超えた分を最後の区画にまとめる）
    const UW_H = (input) => (input.level === 'detail' ? 64 : 44);
    function unitSources(input) {
      const tOf = topicOfScene(input.topics);
      const idx = new Map(input.topics.map((tp, i) => [tp.id, i]));
      if (input.level === 'major') return input.topics.map((tp, i) => ({ id: tp.id, kind: 'topic', text: tp.title, topicIndex: i, sceneIds: tp.sceneIds }));
      return input.scenes.map((s) => {
        const tp = tOf.get(s.id);
        const pts = s.points.map((p) => p.text).join('／');
        return { id: s.id, kind: 'scene', text: input.level === 'detail' && pts ? `${s.heading}：${pts}` : s.heading, topicIndex: tp ? idx.get(tp.id) : -1, sceneIds: [s.id], points: s.points };
      });
    }
    const SZ = (input, ja, en) => (input.lang === 'en' ? en : ja);

    // ---- FR-034 区画型: 図を縦線で 2〜4 の区画（基本 3）に区切り、1 区画に 1 トピック。1 つなら区切り線なし。超えた分は最後の区画へ ----
    export function zoneLayout(input) {
      const info = input.titleInfo ?? {};
      const visible = titleLines(info).length > 0;
      const title = { x: M, y: M, w: W - M * 2, h: TITLE_H, visible };
      const src = unitSources(input);
      const topics = input.topics;
      const k = Math.max(1, Math.min(topics.length, MAX_ZONES));
      const zoneOf = (s) => Math.min(Math.max(s.topicIndex, 0), k - 1);
      const zw = (W - M * 2) / k; const HEAD = 26; const UH = UW_H(input); const UG = 12;
      const cols = Array.from({ length: k }, () => []);
      for (const s of src) cols[zoneOf(s)].push(s);
      const units = []; let order = 0;
      const flat = src.map((s) => ({ s, z: zoneOf(s) }));
      const ordinal = new Map(flat.map((f, i) => [f.s.id, i]));
      cols.forEach((col, z) => col.forEach((s, r) => {
        units.push({ id: s.id, kind: s.kind, order: ordinal.get(s.id), x: M + z * zw + 8, y: BODY_Y + HEAD + r * (UH + UG), w: zw - 16, h: UH, text: s.text, emphasis: null, badge: null, relations: [] });
        order += 1;
      }));
      units.sort((a, b) => a.order - b.order);
      const rows = Math.max(1, ...cols.map((c) => c.length));
      const bodyH = HEAD + rows * (UH + UG) + 4;
      const groups = topics.length ? Array.from({ length: k }, (_, z) => {
        const tp = topics[z];
        const frame = { x: M + z * zw, y: BODY_Y, w: zw, h: bodyH };
        return { id: tp.id, kind: 'zone', heading: String(tp.title).trim() || tp.id, frame, headingRect: { x: frame.x + 8, y: BODY_Y + 4, w: zw - 16, h: 18 } };
      }) : [];
      const dividers = k > 1 && topics.length ? Array.from({ length: k - 1 }, (_, i) => ({ x1: M + (i + 1) * zw, y1: BODY_Y, x2: M + (i + 1) * zw, y2: BODY_Y + bodyH })) : [];
      return { canvas: { w: W, h: BODY_Y + bodyH + M }, title, body: { x: M, y: BODY_Y, w: W - M * 2, h: bodyH }, units, arrows: [], orderMark: 'number', groups, dividers, centered: false, titleLines: titleLines(info) };
    }

    // ---- FR-035 比喩テンプレート型: 比喩（道・山・橋・太陽 / 4 象限）が先に描かれ、その上に区分と内容が載る。外部の画像は使わない ----
    const GOAL_RE = /ビジョン|ゴール|目標|道のり|ロードマップ|\bvision\b|\bgoal\b|\broadmap\b|\bjourney\b/i;
    function pointKinds(s) { return (s.points ?? []).map((p) => classifyPoint(p.text)); }
// トピックごとの囲み（そのトピックの単位をすべて含む外接矩形）。小見出し・テキスト一覧はこの囲みの題名を使う（型を替えても一覧が変わらない）
function topicGroups(input, units) {
  const tOf = topicOfScene(input.topics);
  const out = [];
  for (const tp of input.topics) {
    const mine = units.filter((u) => (u.kind === 'topic' ? u.id === tp.id : tOf.get(u.id)?.id === tp.id));
    if (!mine.length) continue;
    const x0 = Math.min(...mine.map((u) => u.x)) - 4; const y0 = Math.min(...mine.map((u) => u.y)) - 4;
    const x1 = Math.max(...mine.map((u) => u.x + u.w)) + 4; const y1 = Math.max(...mine.map((u) => u.y + u.h)) + 4;
    out.push({ id: tp.id, kind: 'enclosure', heading: String(tp.title).trim() || tp.id, frame: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, headingRect: { x: x0 + 4, y: y0 - 16, w: Math.max(40, x1 - x0 - 8), h: 14 } });
  }
  return out;
}

    export function metaphorLayout(input) {
      const info = input.titleInfo ?? {};
      const visible = titleLines(info).length > 0;
      const title = { x: M, y: M, w: W - M * 2, h: TITLE_H, visible };
      const src = unitSources(input);
      const sceneById = new Map(input.scenes.map((s) => [s.id, s]));
      const kindOfSrc = (s) => s.sceneIds.flatMap((id) => pointKinds(sceneById.get(id) ?? {}));
      const journey = GOAL_RE.test(input.scenes.flatMap((s) => [s.heading, ...s.points.map((p) => p.text)]).join('\n'));
      const UH = UW_H(input); const UG = 12; const HEAD = 26;
      const units = []; const groups = []; const elements = [];
      let canvasH; let bodyH; let axes = null;
      if (journey) {
        const SUN_W = 170; const zw = (W - M * 2 - SUN_W) / 3;
        const names = [SZ(input, '課題', 'Issues'), SZ(input, '解決策', 'Solutions'), SZ(input, '成果', 'Outcomes')];
        const stageOf = (i) => Math.min(2, Math.floor((i * 3) / Math.max(1, src.length)));
        const cols = [[], [], []]; src.forEach((s, i) => cols[stageOf(i)].push({ s, i }));
        cols.forEach((col, z) => col.forEach(({ s, i }, r) => units.push({ id: s.id, kind: s.kind, order: i, x: M + z * zw + 8, y: BODY_Y + HEAD + r * (UH + UG), w: zw - 16, h: UH, text: s.text, emphasis: null, badge: null, relations: [] })));
        units.sort((a, b) => a.order - b.order);
        const rows = Math.max(1, ...cols.map((c) => c.length));
        bodyH = HEAD + rows * (UH + UG) + 4;
        names.forEach((n, z) => {
          const frame = { x: M + z * zw, y: BODY_Y, w: zw, h: bodyH };
          groups.push({ id: `stage-${z + 1}`, kind: 'zone', heading: n, frame, headingRect: { x: frame.x + 8, y: BODY_Y + 4, w: zw - 16, h: 18 } });
        });
        const roadY = BODY_Y + bodyH + 8;
        elements.push({ type: 'mountain', label: SZ(input, '山（課題）', 'Mountain (issues)'), x: M, y: BODY_Y, w: zw, h: bodyH });
        elements.push({ type: 'bridge', label: SZ(input, '橋（解決策）', 'Bridge (solutions)'), x: M + zw, y: BODY_Y, w: zw, h: bodyH });
        elements.push({ type: 'road', label: SZ(input, '道のり', 'Journey'), x: M, y: roadY, w: W - M * 2 - SUN_W, h: 36 });
        elements.push({ type: 'sun', label: SZ(input, 'ゴール', 'Goal'), x: W - M - SUN_W, y: BODY_Y, w: SUN_W, h: SUN_W });
        bodyH += 8 + 36;
        canvasH = BODY_Y + bodyH + M;
        return { canvas: { w: W, h: canvasH }, title, body: { x: M, y: BODY_Y, w: W - M * 2, h: bodyH }, units, arrows: [], orderMark: 'number', groups: topicGroups(input, units), metaphor: { kind: 'journey', elements, axes: null, sections: groups }, centered: false, titleLines: titleLines(info) };
      }
      // 4 象限の振り返り: 縦軸＝良い／悪い、横軸＝いま／これから。課題・良かったこと・アイデア・次の行動に割り当てる
      const Q = [
        { id: 'q-good', kind: 'note', name: SZ(input, '良かったこと', 'Went well') },
        { id: 'q-issue', kind: 'issue', name: SZ(input, '課題', 'Problems') },
        { id: 'q-idea', kind: 'idea', name: SZ(input, 'アイデア', 'Ideas') },
        { id: 'q-next', kind: 'conclusion', name: SZ(input, '次の行動', 'Next actions') },
      ];
      const qOf = (s) => { const ks = kindOfSrc(s).map(baseKind); return ks.includes('issue') ? 1 : ks.includes('idea') ? 2 : ks.includes('conclusion') ? 3 : 0; };
      const AX = 28; const qw = (W - M * 2 - AX) / 2;
      const cols = [[], [], [], []]; src.forEach((s, i) => cols[qOf(s)].push({ s, i }));
      const rows = Math.max(1, ...cols.map((c) => c.length)); const qh = HEAD + rows * (UH + UG) + 4;
      // 配置: 左上=良かったこと 右上=課題 左下=アイデア 右下=次の行動
      const pos = [[0, 0], [1, 0], [0, 1], [1, 1]];
      cols.forEach((col, q) => {
        const [cx, cy] = pos[q]; const ox = M + AX + cx * qw; const oy = BODY_Y + AX + cy * qh;
        col.forEach(({ s, i }, r) => units.push({ id: s.id, kind: s.kind, order: i, x: ox + 8, y: oy + HEAD + r * (UH + UG), w: qw - 16, h: UH, text: s.text, emphasis: null, badge: null, relations: [] }));
        const frame = { x: ox, y: oy, w: qw, h: qh };
        groups.push({ id: Q[q].id, kind: 'zone', heading: Q[q].name, frame, headingRect: { x: ox + 8, y: oy + 4, w: qw - 16, h: 18 } });
      });
      units.sort((a, b) => a.order - b.order);
      axes = { x: { label: SZ(input, '現在 ⇔ これから', 'Now ⇔ Next'), x1: M + AX, y1: BODY_Y + AX + qh * 2 + 14, x2: W - M }, y: { label: SZ(input, '良い ⇔ 悪い', 'Good ⇔ Bad'), x1: M + 12, y1: BODY_Y + AX, y2: BODY_Y + AX + qh * 2 } };
      elements.push({ type: 'quadrant', label: SZ(input, '4 象限の振り返り', '4-quadrant retrospective'), x: M + AX, y: BODY_Y + AX, w: qw * 2, h: qh * 2 });
      bodyH = AX + qh * 2 + 24;
      return { canvas: { w: W, h: BODY_Y + bodyH + M }, title, body: { x: M, y: BODY_Y, w: W - M * 2, h: bodyH }, units, arrows: [], orderMark: 'number', groups: topicGroups(input, units), metaphor: { kind: 'quadrant', elements, axes, sections: groups }, centered: false, titleLines: titleLines(info) };
    }

    // アプリ組立の拡張（modules）。settingsModule の後に足す。
    export function layoutKindsModule(ctx) {
      ctx.api.registerLayoutType('timeline', { layout: timelineTypeLayout });
      ctx.api.registerLayoutType('bubble', { layout: bubbleLayout });
      ctx.api.registerLayoutType('diverge', { layout: divergeLayout });
      ctx.api.registerLayoutType('zone', { layout: zoneLayout });
      ctx.api.registerLayoutType('metaphor', { layout: metaphorLayout });
      // FR-053: 図に描く要点どうしの関係線（詳細度が「詳細」のときだけ）と、一覧の関係情報（同じもの）
      const rels = () => {
        if ((ctx.api.getDetailLevel?.() ?? 'detail') !== 'detail') return [];
        return labelRelations(deriveRelations(ctx.state.scenes.flatMap((s) => s.points)), ctx.state.lang);
      };
      ctx.api.getDiagramRelations = rels;
      ctx.api.getOutlineRelations = rels;
    }

