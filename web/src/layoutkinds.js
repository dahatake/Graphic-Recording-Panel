// FR-031 タイムライン型 / FR-032 吹き出し型 / FR-033 発散型の配置（共通部品「レイアウト型レジストリ」へ registerLayoutType で登録する）。
// DOM・外部通信に依存しない決定的な純粋関数。話者の識別は対象外（Q-006。AC-157 は BLOCKED）のため吹き出しは話者で分けない。
import { timelineLayout } from './layouttypes.js';
import { classifyPoint } from './diagram.js';
import { detectEmotions } from './emotion.js';
import { tokenize } from './topics.js';

export const MIN_ECHO = 2; // PARAM-019: 共感が集まった意見とみなす、同じ語句が現れる異なるシーンの最小数

const W = 1280; const M = 24; const GAP = 32; const TITLE_H = 48;
const BODY_Y = M + TITLE_H + GAP / 2;
const CAUSE_RE = /から|ため|なので|だから|ゆえ|\bbecause\b|\bso\b/i;
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
    L.units.forEach((u, ui) => { for (const p of sceneById.get(u.id)?.points ?? []) flat.push({ ui, p, kind: classifyPoint(p.text) }); });
    for (let i = 1; i < flat.length; i++) {
      const a = flat[i - 1]; const b = flat[i];
      const key = CAUSE_RE.test(b.p.text) ? 'cause' : (a.kind === 'issue' && b.kind === 'idea' ? 'proposal' : null);
      if (!key) continue;
      if (a.ui !== b.ui) { const ar = L.arrows.find((x) => x.from === L.units[a.ui].id && x.to === L.units[b.ui].id); if (ar && !ar.label) ar.label = lab(input, key); }
      else L.units[b.ui].relations.push({ from: a.p.id, to: b.p.id, label: lab(input, key) });
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

// アプリ組立の拡張（modules）。settingsModule の後に足す。
export function layoutKindsModule(ctx) {
  ctx.api.registerLayoutType('timeline', { layout: timelineTypeLayout });
  ctx.api.registerLayoutType('bubble', { layout: bubbleLayout });
  ctx.api.registerLayoutType('diverge', { layout: divergeLayout });
}
