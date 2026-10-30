// FR-091 ワークショップホワイトボード型（FR-027 の 6 つ目の型。型 id: workshop）。
// クリーム色の紙・手描きマーカー風の線・見出しリボン・番号付きの 5〜6 ステージ（ヴィネット＋大文字ラベル）・ステージ下の未解決の問い（最大 1）・
// 7 つのレンズの注記を SVG だけで描く。会話にない要素は作らない（ラベル・問いは発話の語そのもの）。外部通信・画像は使わない。
// 契約: tests/system/CONTRACT-WORKSHOP.md。色は PARAM-116〜121 と紙・白だけ（グリーンは図全体で 1 要素）。
import { classifyPoint } from './diagram.js';
import { escapeHtml } from './outline.js';

export const WORKSHOP_TYPE_ID = 'workshop';
export const MAX_STAGES = 6;
export const MIN_FULL_STAGES = 5;
export const NOTE_MAX = 200; // 注記の本文の最大文字数
export const NOTES_MAX = 60; // 保持する注記の最大件数

// PARAM-116〜121（意味色）と紙の色
const NAVY = '#0F2A43'; const TEAL = '#0E7490'; const AQUA = '#14B8A6'; const GREEN = '#1F7A54'; const AMBER = '#E2632B'; const CARD = '#F3F7FA';
const PAPER = '#FBF3E0';

export const LENSES = [
  { id: 'issue', ja: '課題', en: 'Issue' },
  { id: 'load', ja: '認知負荷と摩擦', en: 'Cognitive load and friction' },
  { id: 'judgment', ja: '人間の判断', en: 'Human judgment' },
  { id: 'risk', ja: 'リスク・信頼・結果', en: 'Risk, trust and outcome' },
  { id: 'data', ja: 'データと技術の依存', en: 'Data and technology dependency' },
  { id: 'boundary', ja: '境界', en: 'Boundary' },
  { id: 'ai', ja: 'AI 適合性', en: 'AI fit' },
];
const TEXT = {
  ja: { ribbon: 'ワークショップ ホワイトボード', lenses: 'レンズ', section: 'ワークショップホワイトボード', stage: 'ステージ', question: '未解決の問い', notes: '注記', aria: 'ワークショップホワイトボードの図' },
  en: { ribbon: 'WORKSHOP WHITEBOARD', lenses: 'LENSES', section: 'Workshop whiteboard', stage: 'Stage', question: 'Open question', notes: 'Notes', aria: 'Workshop whiteboard diagram' },
};
const L10N = (lang) => (lang === 'en' ? 'en' : 'ja');

// ---- 配置（DOM に依存しない純粋関数） ----
const W = 1280; const M = 28; const GAPX = 36; const TW = 384; const TH = 292; const GAPY = 28; const TOP = 108; const NOTE_H = 58;
const charW = (ch, size) => (ch.codePointAt(0) >= 0x2e80 ? size : size * 0.58);
function fit(text, maxPx, size) {
  const chars = [...String(text ?? '').replace(/\s+/g, ' ').trim()];
  let w = 0; let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = charW(chars[i], size);
    if (w + c > maxPx) return `${out.replace(/\s+$/, '')}…`;
    out += chars[i]; w += c;
  }
  return out;
}
const QUESTION_RE = /[?？]/;

// 発話 → ステージ（シーンを前から均等に 5〜6 個にまとめる。シーン数が 5 未満ならシーンの数だけ）
export function stageGroups(scenes) {
  const n = scenes.length;
  if (!n) return [];
  const k = Math.min(MAX_STAGES, n);
  const out = [];
  for (let i = 0; i < k; i++) out.push(scenes.slice(Math.floor((i * n) / k), Math.floor(((i + 1) * n) / k)));
  return out;
}

function stageQuestion(group) {
  let issue = null; let hasConclusion = false; let last = null;
  for (const s of group) {
    for (const p of s.points) {
      last = p;
      const kind = classifyPoint(p.text);
      if (QUESTION_RE.test(p.text) || kind === 'undecided') return p.text;
      if (kind === 'issue' && !issue) issue = p.text;
      if (kind === 'conclusion') hasConclusion = true;
    }
  }
  if (issue) return issue;
  // まだ話している（進行中の）ステージで決定がないときは、直近の発話を未解決のまま掲げる
  if (!hasConclusion && last && group.some((s) => s.status === 'in_progress')) return last.text;
  return null;
}
function stageKind(group) {
  let n = 0; const seen = new Set();
  for (const s of group) for (const p of s.points) { seen.add(classifyPoint(p.text)); if (++n >= 24) break; }
  for (const k of ['conclusion', 'issue', 'idea', 'proposal', 'undecided']) if (seen.has(k)) return k;
  return 'note';
}

// input: { scenes, lang }、notes: [{ sceneId, lens, text }]
export function workshopLayout(input, notes = []) {
  const lang = L10N(input.lang);
  const tx = TEXT[lang];
  const groups = stageGroups(input.scenes ?? []);
  const stageOfScene = new Map();
  const stages = groups.map((g, i) => {
    for (const s of g) stageOfScene.set(s.id, i + 1);
    const first = g[0];
    const raw = String(first?.heading ?? first?.points?.[0]?.text ?? '').replace(/…$/, '').trim();
    const label = fit(lang === 'en' ? raw.toUpperCase() : raw, 340, 22);
    const q = stageQuestion(g);
    const col = i % 3; const row = Math.floor(i / 3);
    return {
      n: i + 1, sceneIds: g.map((s) => s.id), kind: stageKind(g), label,
      question: q == null ? null : { text: fit(q, 232, 14), full: String(q).trim() },
      x: M + col * (TW + GAPX), y: TOP + row * (TH + GAPY), w: TW, h: TH,
    };
  });
  const rows = Math.ceil(stages.length / 3);
  const lensLabel = (id) => LENSES.find((l) => l.id === id)?.[lang] ?? id;
  const noteItems = stages.length ? notes.filter((nt) => stageOfScene.has(nt.sceneId)).map((nt, i) => {
    const col = i % 3; const row = Math.floor(i / 3);
    const st = stageOfScene.get(nt.sceneId);
    return { lens: nt.lens, stage: st, head: `${lensLabel(nt.lens)} [${st}]`, headShown: fit(`${lensLabel(nt.lens)} [${st}]`, TW - 24, 13), body: fit(nt.text, TW - 24, 14), full: nt.text, col, row };
  }) : [];
  const gridBottom = TOP + (rows ? rows * TH + (rows - 1) * GAPY : 0);
  const notesY = gridBottom + 28;
  const noteRows = Math.ceil(noteItems.length / 3);
  noteItems.forEach((nt) => { nt.x = M + nt.col * (TW + GAPX); nt.y = notesY + 40 + nt.row * (NOTE_H + 12); });
  const H = stages.length ? Math.max(TOP + 40, notesY + (noteItems.length ? 40 + noteRows * (NOTE_H + 12) : 8)) + M : 0;
  const model = { ribbon: tx.ribbon, lensHeader: tx.lenses, lang, stages, notes: noteItems, notesY, lenses: LENSES.map((l) => ({ id: l.id, label: l[lang] })), canvas: { w: W, h: H } };
  return {
    canvas: { w: W, h: H }, title: { x: M, y: M, w: W - M * 2, h: 0, visible: false }, body: { x: M, y: TOP, w: W - M * 2, h: Math.max(0, H - TOP) },
    units: [], arrows: [], orderMark: 'number', centered: false, titleLines: [], workshop: model,
    // FR-036 AC-167: 型を替えてもテキスト一覧のまとまりの小見出しは同じ（図は workshop が描くので、枠は持たない）
    groups: (input.topics ?? []).filter((tp) => tp.sceneIds?.length).map((tp) => ({ id: tp.id, kind: 'enclosure', heading: String(tp.title ?? '').trim() || tp.id, frame: { x: 0, y: 0, w: 0, h: 0 }, headingRect: { x: 0, y: 0, w: 0, h: 0 } })),
  };
}

// ---- 描画（SVG だけ。手描き風の線は決定的なゆらぎ） ----
const r1 = (v) => Math.round(v * 10) / 10;
const jit = (seed, k) => { const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return (s - Math.floor(s)) - 0.5; };
function wob(pts, seed, amp = 1.6) { // 点の並びを、小さくゆらした曲線にする
  const p = pts.map(([x, y], i) => [x + jit(seed, i * 2) * amp, y + jit(seed, i * 2 + 1) * amp]);
  let d = `M${r1(p[0][0])} ${r1(p[0][1])}`;
  for (let i = 1; i < p.length; i++) { const [a, b] = p[i - 1]; const [c, e] = p[i]; d += `Q${r1((a + c) / 2 + jit(seed, i * 7) * amp)} ${r1((b + e) / 2 + jit(seed, i * 5) * amp)} ${r1(c)} ${r1(e)}`; }
  return d;
}
const boxPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y + 3]];
const stroke = (d, color, w, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;

function doodle(kind, cx, cy, seed) { // 場面の絵（話の性質に合わせた小さな絵。文字は含めない）
  const s = [];
  switch (kind) {
    case 'issue':
      s.push(stroke(wob([[cx - 46, cy + 36], [cx, cy - 40], [cx + 46, cy + 36], [cx - 46, cy + 36]], seed, 2.2), AMBER, 5));
      s.push(stroke(wob([[cx, cy - 12], [cx, cy + 12]], seed + 1, 1), NAVY, 5), `<circle cx="${cx}" cy="${cy + 25}" r="3.5" fill="${NAVY}"/>`);
      break;
    case 'idea':
      s.push(`<circle cx="${cx}" cy="${cy - 8}" r="30" fill="${CARD}" stroke="${AQUA}" stroke-width="5"/>`);
      s.push(stroke(wob([[cx - 12, cy + 28], [cx + 12, cy + 28]], seed, 1), NAVY, 5), stroke(wob([[cx - 9, cy + 38], [cx + 9, cy + 38]], seed + 2, 1), NAVY, 5));
      s.push(stroke(wob([[cx - 50, cy - 40], [cx - 38, cy - 30]], seed + 3, 1), AQUA, 4), stroke(wob([[cx + 50, cy - 40], [cx + 38, cy - 30]], seed + 4, 1), AQUA, 4));
      break;
    case 'proposal':
      s.push(stroke(wob([[cx - 30, cy + 42], [cx - 30, cy - 44]], seed, 1.2), NAVY, 5));
      s.push(stroke(wob([[cx - 30, cy - 44], [cx + 40, cy - 28], [cx - 30, cy - 10]], seed + 1, 2), TEAL, 5));
      break;
    case 'undecided':
      s.push(stroke(wob([[cx - 44, cy + 14], [cx - 44, cy - 6], [cx - 20, cy - 26], [cx + 8, cy - 22], [cx + 20, cy - 34], [cx + 44, cy - 10], [cx + 46, cy + 14], [cx - 44, cy + 14]], seed, 2), TEAL, 5));
      for (let i = 0; i < 3; i++) s.push(`<circle cx="${cx - 18 + i * 18}" cy="${cy + 34}" r="3.5" fill="${NAVY}"/>`);
      break;
    case 'conclusion':
      s.push(stroke(wob(boxPts(cx - 40, cy - 34, 80, 68), seed, 2), NAVY, 5));
      s.push(stroke(wob([[cx - 22, cy - 8], [cx + 22, cy - 8]], seed + 1, 1), TEAL, 4), stroke(wob([[cx - 22, cy + 10], [cx + 10, cy + 10]], seed + 2, 1), TEAL, 4));
      break;
    default: // note: 書類（話の内容の記録）
      s.push(stroke(wob(boxPts(cx - 34, cy - 44, 68, 88), seed, 2), NAVY, 5));
      for (let i = 0; i < 3; i++) s.push(stroke(wob([[cx - 20, cy - 20 + i * 20], [cx + 20, cy - 20 + i * 20]], seed + i + 1, 1), TEAL, 4));
  }
  return s.join('');
}

export function workshopSvg(L, opts = {}) {
  const m = L.workshop;
  const lang = m.lang; const tx = TEXT[lang];
  const { W: CW, H: CH } = { W: m.canvas.w, H: Math.max(m.canvas.h, 160) };
  const attrs = [`data-draw-style="${escapeHtml(opts.drawStyle ?? 'handwritten')}"`];
  if (opts.types) attrs.push(`data-layout-types="${escapeHtml(opts.types.join(' '))}"`, `data-layout-head="${WORKSHOP_TYPE_ID}"`);
  const out = [];
  out.push(`<rect data-ws-paper x="0" y="0" width="${CW}" height="${CH}" fill="${PAPER}"/>`);
  // 見出しリボン（太い帯）
  const rx = M; const rw = W - M * 2;
  out.push(`<path data-ws-ribbon d="M${rx} 24L${rx + rw} 24L${rx + rw - 22} 52L${rx + rw} 80L${rx} 80L${rx + 22} 52Z" fill="${NAVY}" stroke="${NAVY}" stroke-width="3" stroke-linejoin="round"/>`);
  out.push(`<text x="${W / 2}" y="63" font-size="30" font-weight="800" text-anchor="middle" fill="#FFFFFF">${escapeHtml(m.ribbon)}</text>`);
  m.stages.forEach((st, i) => {
    const seed = st.n * 3.7;
    const g = [];
    g.push(`<rect x="${st.x}" y="${st.y}" width="${st.w}" height="${st.h}" rx="10" fill="${CARD}" stroke="none"/>`);
    g.push(stroke(wob(boxPts(st.x, st.y, st.w, st.h), seed, 2.4), NAVY, 3));
    g.push(`<circle data-ws-num cx="${st.x + 30}" cy="${st.y + 30}" r="17" fill="${NAVY}" stroke="${NAVY}" stroke-width="2"/>`);
    g.push(`<text x="${st.x + 30}" y="${st.y + 37}" font-size="20" font-weight="800" text-anchor="middle" fill="#FFFFFF">${st.n}</text>`);
    g.push(doodle(st.kind, st.x + st.w / 2, st.y + 92, seed));
    g.push(`<text data-ws-label x="${st.x + st.w / 2}" y="${st.y + 196}" font-size="22" font-weight="800" text-anchor="middle" fill="${NAVY}">${escapeHtml(st.label)}</text>`);
    g.push(stroke(wob([[st.x + 60, st.y + 206], [st.x + st.w - 60, st.y + 206]], seed + 9, 1.4), TEAL, 3));
    if (st.question) {
      g.push(`<rect data-ws-question x="${st.x + 14}" y="${st.y + 222}" width="${st.w - 28}" height="56" rx="8" fill="#FFFFFF" stroke="${AMBER}" stroke-width="2.5" stroke-dasharray="7 5"/>`);
      g.push(`<text x="${st.x + 36}" y="${st.y + 260}" font-size="30" font-weight="800" text-anchor="middle" fill="${AMBER}">?</text>`);
      g.push(`<text x="${st.x + 58}" y="${st.y + 255}" font-size="14" fill="${NAVY}">${escapeHtml(st.question.text)}</text>`);
    }
    out.push(`<g data-ws-stage="${st.n}" data-scene-ids="${escapeHtml(st.sceneIds.join(' '))}">${g.join('')}</g>`);
    // ステージ間の流れ（ティール）。行の端は番号が順序を示す
    if (i < m.stages.length - 1 && (i % 3) < 2) {
      const x1 = st.x + st.w + 4; const x2 = x1 + GAPX - 8; const y = st.y + 92;
      out.push(`<g data-ws-flow>${stroke(wob([[x1, y], [x2, y]], seed + 11, 1), TEAL, 4)}${stroke([`M${r1(x2 - 8)} ${y - 7}L${r1(x2)} ${y}L${r1(x2 - 8)} ${y + 7}`].join(''), TEAL, 4)}</g>`);
    }
  });
  // 流れの終わり（承認・完了）の印。グリーンは図全体で 1 回だけ
  const last = m.stages.at(-1);
  if (last) out.push(`<path data-ws-done d="M${last.x + last.w - 52} ${last.y + 28}L${last.x + last.w - 38} ${last.y + 42}L${last.x + last.w - 16} ${last.y + 14}" fill="none" stroke="${GREEN}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
  // レンズの注記
  if (m.notes.length) {
    out.push(`<text x="${M}" y="${m.notesY + 22}" font-size="18" font-weight="800" fill="${NAVY}">${escapeHtml(m.lensHeader)}</text>`);
    out.push(stroke(wob([[M, m.notesY + 30], [M + 180, m.notesY + 30]], 5.5, 1.2), AQUA, 4));
    m.notes.forEach((nt, i) => {
      out.push(`<g data-ws-note="${escapeHtml(nt.lens)}" data-ws-on="${nt.stage}"><rect x="${nt.x}" y="${nt.y}" width="${TW}" height="${NOTE_H}" rx="8" fill="${CARD}" stroke="${TEAL}" stroke-width="2"/>`
        + `<text x="${nt.x + 12}" y="${nt.y + 22}" font-size="13" font-weight="800" fill="${TEAL}">${escapeHtml(nt.headShown)}</text>`
        + `<text x="${nt.x + 12}" y="${nt.y + 46}" font-size="14" fill="${NAVY}">${escapeHtml(nt.body)}</text></g>`);
      void i;
    });
  }
  const w = CW; const h = CH;
  const title = opts.title ?? tx.aria;
  return `<svg ${attrs.join(' ')} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="'Yu Gothic UI', system-ui, 'Hiragino Sans', Meiryo, sans-serif" role="img" aria-label="${escapeHtml(tx.aria)}"><title>${escapeHtml(title)}</title>${out.join('')}</svg>`;
}

// テキスト一覧（NFR-A11Y-001）: 図の文字（ラベル・問い・注記・レンズ名）を文字で確認できる
export function workshopOutlineHtml(L) {
  const m = L?.workshop;
  if (!m || !m.stages.length) return '';
  const tx = TEXT[m.lang]; const e = escapeHtml;
  const span = (s, full) => `<span>${e(s)}</span>${full != null && full !== s ? ` <span>(${e(full)})</span>` : ''}`;
  const stages = m.stages.map((st) => `<li data-ws-ostage="${st.n}"><span>${st.n}</span> ${span(st.label)}${st.question ? ` <span>?</span> ${tx.question}: ${span(st.question.text, st.question.full)}` : ''}</li>`).join('');
  const lenses = m.lenses.map((l) => `<li data-ws-olens="${e(l.id)}">${e(l.label)}</li>`).join('');
  const notes = m.notes.map((nt) => `<li data-ws-onote="${e(nt.lens)}">${span(nt.headShown, nt.head)}: ${span(nt.body, nt.full)}</li>`).join('');
  return `<section class="outline-workshop" aria-label="${e(tx.section)}"><h2>${e(tx.section)}</h2><p>${e(m.ribbon)}</p><ol class="outline-ws-stages">${stages}</ol>`
    + `<h3>${e(m.lensHeader)}</h3><ul class="outline-ws-lenses">${lenses}</ul>${notes ? `<h3>${e(tx.notes)}</h3><ul class="outline-ws-notes">${notes}</ul>` : ''}</section>`;
}

// ---- アプリ組立の拡張（modules）。stylePresetModule の後に足す（先頭の型が workshop のとき、描画を引き取る） ----
export function workshopModule(ctx) {
  const { api, state } = ctx;
  const notes = []; // { sceneId, lens, text }（メモリだけ。保存しない）
  api.registerLayoutType(WORKSHOP_TYPE_ID, { layout: (input) => workshopLayout(input, notes) });
  api.getWorkshopLenses = () => LENSES.map((l) => ({ id: l.id, label: l[L10N(state.lang)] }));
  api.addWorkshopNote = ({ sceneId, lens, text } = {}) => {
    const body = typeof text === 'string' ? text.trim() : '';
    if (!body || !LENSES.some((l) => l.id === lens) || !state.scenes.some((s) => s.id === sceneId) || notes.length >= NOTES_MAX) return { ok: false };
    notes.push({ sceneId, lens, text: [...body].slice(0, NOTE_MAX).join('') });
    ctx.change(() => {});
    return { ok: true };
  };
  const active = () => {
    const info = api.getLayoutInfo?.();
    return !!info && info.applied && info.head === WORKSHOP_TYPE_ID && state.displayMode !== 'arrange';
  };
  const baseRender = api.renderBaseSvg;
  api.renderBaseSvg = () => {
    if (!active()) return baseRender();
    const info = api.getLayoutInfo();
    return workshopSvg(api.getDiagramLayout(), { types: info.selected, drawStyle: api.getDrawStyle?.(), title: ctx.t('app.title') });
  };
  api.getWorkshopOutline = () => (active() ? workshopOutlineHtml(api.getDiagramLayout()) : '');
}
