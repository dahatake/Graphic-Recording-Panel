// FR-109 AC-624〜628: 数値を含む要点（KPI・前後比較）のゲージ・棒グラフ。契約: tests/system/CONTRACT-P2.md §6（getGauges／renderGauge）、PARAM-147。
// - 指標の検出（detectGauge）と表現の選び方は、規則だけで決める純関数（決定的・外部通信なし・生成 AI を使わない。G-002）。
// - 描画は独自の SVG（外部ライブラリ・外部画像なし）。renderGauge の出力は NFR-SEC-004 の許可リスト（要素・属性）だけで書く。
// - 色だけに頼らない: 単位・目標・望ましい方向は文字で書き、目標は線（破線）と文字、超過は二重の輪と「+n%」、切断は記号で示す。
// - 機密の要点の指標は、「機密の要点を除く」の保存（visibility.js が state.scenes を差し替える）で自然に除かれる（AC-606）。
import { escapeHtml } from './outline.js';
import { enhanceGaugeDom } from './gauge-ui.js';

// 名前空間の識別子（取得先ではない）。文字列として直書きしない（E2E-021）
const SVG_NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');
const INK = '#15191f';
const BRAND = '#0f548c';
const TRACK = '#bdbdbd';
const SOFT = '#8c9bb0';
const FONT = `font-family="'Yu Gothic UI', system-ui, 'Hiragino Sans', Meiryo, sans-serif"`;

export const BAR_CAP = 2; // PARAM-147: 棒は 200% を上限に描く
export const RING_CAP = 100; // PARAM-147: リングは 1 周（100%）を上限に描く
export const CARD_W = 300; export const CARD_H = 120; export const LABEL_H = 84;
const STRIP_MAX = 48; // 図に描くカードの上限（残りはテキスト一覧にある）

const WORDS = {
  ja: {
    indicator: '指標', kind: { ring: 'リングゲージ', bar: '棒グラフ', label: '数値ラベル' }, current: '現在値', target: '目標', before: '前', after: '後',
    unit: '単位', direction: '望ましい方向', up: '上がる', down: '下がる', undecided: '未定', original: '元の数値', review: '要確認', confidential: '機密', none: 'なし',
    more: (n) => `ほか ${n} 件（テキスト一覧を参照）`, over: (n) => `+${n}%`, actual: '実値', cut: '上限で切断',
    reason: {
      ring: '目標が数値の比率なのでリングゲージで示す', bar: '前後の値があるので棒グラフで示す', target: '目標が不明のため比率で示せない',
      unit: '単位が比率でないため比率で示せない', direction: '望ましい方向が決まらない', nonpositive: '値が 0 以下のため比率で示せない',
    },
  },
  en: {
    indicator: 'Metric', kind: { ring: 'Ring gauge', bar: 'Bar chart', label: 'Number label' }, current: 'Current', target: 'Target', before: 'Before', after: 'After',
    unit: 'Unit', direction: 'Preferred direction', up: 'Up', down: 'Down', undecided: 'Undecided', original: 'Original figure', review: 'Needs review', confidential: 'Confidential', none: 'None',
    more: (n) => `${n} more (see the text outline)`, over: (n) => `+${n}%`, actual: 'Actual', cut: 'Cut at the cap',
    reason: {
      ring: 'The target is a numeric ratio, so it is shown as a ring gauge', bar: 'Before and after values exist, so it is shown as a bar chart', target: 'The target is unknown, so it cannot be shown as a ratio',
      unit: 'The unit is not a ratio, so it cannot be shown as a ratio', direction: 'The preferred direction cannot be decided', nonpositive: 'The value is 0 or less, so it cannot be shown as a ratio',
    },
  },
};
const W = (lang) => WORDS[lang === 'en' ? 'en' : 'ja'];

// ---- 検出の規則（PARAM-147） ----
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUM = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
const JA_UNITS = ['パーセント', '万円', '億円', '万人', '万件', '週間', '時間', 'か月', 'ヶ月', 'ポイント', '%', '割', '件', '人', '円', '日', '分', '秒', '個', '台', '回', '点', '倍'];
const EN_UNITS = ['percent', 'items', 'item', 'hours', 'hour', 'days', 'day', 'minutes', 'users', 'yen', 'points', 'times', 'kg', 'ms', 'pt'];
const UNIT = `(?:${JA_UNITS.map(reEsc).join('|')}|(?:${EN_UNITS.join('|')})(?![A-Za-z]))`;
const RE_T1 = new RegExp(`(?:目標|KPI|ターゲット|target|goal)(?:値|は|が|を|:|=|\\s)*(?:約|およそ)?\\s*${NUM}\\s?(${UNIT})?`, 'i');
const RE_T2 = new RegExp(`${NUM}\\s?(${UNIT})?\\s*(?:を|が|は)?\\s*(?:目標|ターゲット)`, 'i');
const RE_RATE = new RegExp(`達成率\\s*(?:は|が|:|=)?\\s*${NUM}\\s?%?`);
const RE_BA = new RegExp(`${NUM}\\s?(${UNIT})?(?:\\s*(?:から|→|->|⇒|⇨)\\s*|\\s+to\\s+)${NUM}\\s?(${UNIT})?`, 'i');
const RE_ONE = new RegExp(`${NUM}\\s?(${UNIT})?`, 'gi');
const RE_DATE = /\d+\s*年(?:\s*\d+\s*月(?:\s*\d+\s*日)?)?|\d+\s*月(?:\s*\d+\s*日)?|\d{1,2}:\d{2}/g;
const RE_METRIC_WORD = /目標|KPI|前年比|前月比|target|goal/i;
const UP_WORDS = ['増', '向上', '達成', '改善', 'increase', 'improve', 'achiev', 'reach', 'grow', 'raise'];
const DOWN_WORDS = ['減', '短縮', 'reduc', 'decreas', 'shorten', 'cut', 'lower'];
export const RATIO_UNITS = ['%', '割']; // 達成率は % の値として読む

const normUnit = (u) => {
  const x = String(u ?? '').trim().toLowerCase();
  if (x === 'パーセント' || x === 'percent') return '%';
  if (x === 'ヶ月') return 'か月';
  if (x === 'item') return 'items';
  if (x === 'hour') return 'hours';
  if (x === 'day') return 'days';
  return x;
};
const num = (s) => Number(String(s).replace(/,/g, ''));
export const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const withUnit = (n, u) => `${fmt(n)}${u ?? ''}`;
const pctOf = (v, unit) => (unit === '割' ? v * 10 : v); // 比率に向く単位（% と 割）を % の値にそろえる

const RE_QUICK = new RegExp(`\\d\\s?${UNIT}|目標|KPI|前年比|前月比|target|goal`, 'i'); // 指標になり得ない要点は、重い判定の前に外す
// 要点の文字から指標を検出する（決定的）。指標がなければ null。
export function detectGauge(text, lang = 'ja') {
  const raw = String(text ?? '');
  if (!/[0-9０-９]/.test(raw) || !RE_QUICK.test(raw.normalize('NFKC'))) return null;
  let s = raw.normalize('NFKC').replace(RE_DATE, ' ');
  // 目標
  let target = null; let targetUnit = '';
  let tm = RE_T1.exec(s) ?? RE_T2.exec(s);
  if (tm) { target = num(tm[1]); targetUnit = normUnit(tm[2]); s = `${s.slice(0, tm.index)} ${s.slice(tm.index + tm[0].length)}`; }
  // 達成率（単位。% の値として読む）
  let value = null; let unit = ''; let before = null; let after = null;
  const rm = RE_RATE.exec(s);
  if (rm) { value = num(rm[1]); unit = '%'; s = `${s.slice(0, rm.index)} ${s.slice(rm.index + rm[0].length)}`; }
  // 前後の値（「から」「→」の前後に数字があり、単位が同じ。または後ろだけに単位）
  if (value == null) {
    const bm = RE_BA.exec(s);
    if (bm) {
      const u1 = normUnit(bm[2]); const u2 = normUnit(bm[4]);
      if (u2 && (!u1 || u1 === u2)) { before = num(bm[1]); after = num(bm[3]); value = after; unit = u2; }
    }
  }
  if (value == null) {
    RE_ONE.lastIndex = 0; let m; let firstNoUnit = null;
    while ((m = RE_ONE.exec(s))) {
      if (m[2]) { value = num(m[1]); unit = normUnit(m[2]); break; }
      if (firstNoUnit == null) firstNoUnit = m;
    }
    if (value == null && firstNoUnit && (RE_METRIC_WORD.test(s) || target != null)) { value = num(firstNoUnit[1]); unit = ''; }
  }
  if (value == null) return null;
  // 望ましい方向（「達成率」は単位なので数えない）
  const low = raw.normalize('NFKC').toLowerCase().replace(/達成率/g, '');
  const up = UP_WORDS.some((w) => low.includes(w)); const down = DOWN_WORDS.some((w) => low.includes(w));
  const direction = up && !down ? 'up' : down && !up ? 'down' : null;
  const hasBA = before != null && after != null;
  const ratio = RATIO_UNITS.includes(unit);
  const tOk = target != null && target > 0 && (targetUnit === unit || (targetUnit === '' && ratio) || (RATIO_UNITS.includes(targetUnit) && ratio));
  let kind; let code;
  if (hasBA) {
    if (direction == null) { kind = 'label'; code = 'direction'; } else if (before <= 0 || after <= 0) { kind = 'label'; code = 'nonpositive'; } else { kind = 'bar'; code = 'bar'; }
  } else if (!tOk) { kind = 'label'; code = 'target'; } else if (!ratio) { kind = 'label'; code = 'unit'; } else if (direction == null) { kind = 'label'; code = 'direction'; } else if (value <= 0) { kind = 'label'; code = 'nonpositive'; } else { kind = 'ring'; code = 'ring'; }
  if (kind === 'label' && code === 'target' && target != null && !tOk && !ratio) code = 'unit'; // 目標はあるが単位がそろわない
  let clamped = false; let over = 0;
  if (kind === 'ring') { const p = pctOf(value, unit); if (p > RING_CAP) { clamped = true; over = Math.round((p - RING_CAP) * 100) / 100; } }
  if (kind === 'bar') { const base = tOk ? target : before; if (Math.max(before, after) / base > BAR_CAP) clamped = true; }
  const actualText = hasBA ? `${withUnit(before, unit)}→${withUnit(after, unit)}` : withUnit(value, unit);
  const w = W(lang);
  return {
    name: raw.trim(), value, unit, target: tOk ? target : null, before, after, direction, kind, reason: w.reason[code], reasonCode: code, actualText, clamped, over,
  };
}

// ---- 表示の文字（テキスト一覧・Markdown・ポップアップ・ツールチップで同じ語） ----
export const directionLabel = (g, lang = 'ja') => (g.direction === 'up' ? W(lang).up : g.direction === 'down' ? W(lang).down : W(lang).undecided);
export const directionMark = (g) => (g.direction === 'up' ? '↑' : g.direction === 'down' ? '↓' : '？');
export const kindLabel = (g, lang = 'ja') => W(lang).kind[g.kind] ?? g.kind;
// 項目の並び（指標名・現在値・目標・単位・望ましい方向・表現の種類と理由）
export function gaugeParts(g, lang = 'ja') {
  const w = W(lang); const u = g.unit ?? '';
  const parts = [];
  if (g.before != null && g.after != null) parts.push(`${w.before} ${withUnit(g.before, u)}`, `${w.after} ${withUnit(g.after, u)}`);
  parts.push(`${w.current} ${withUnit(g.value, u)}`);
  parts.push(`${w.target} ${g.target != null ? withUnit(g.target, u) : w.none}`);
  parts.push(`${w.unit} ${u || w.none}`);
  parts.push(`${w.direction} ${directionMark(g)} ${directionLabel(g, lang)}`);
  parts.push(`${kindLabel(g, lang)}（${g.reason}）`);
  if (g.clamped) parts.push(`${w.actual} ${g.actualText}`);
  return parts;
}
export function gaugeLine(g, lang = 'ja', withName = true) {
  const w = W(lang);
  const tail = [g.original != null ? `${w.original}: ${g.original}` : '', g.needsReview ? `▲ ${g.reviewLabel || w.review}` : ''].filter(Boolean);
  return `${w.indicator}${withName ? `: ${g.name}` : ''}（${gaugeParts(g, lang).join('・')}）${tail.length ? ` ${tail.join(' ')}` : ''}`;
}

// ---- SVG ----
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => { const a = [...String(s).replace(/https?:\/\/\S+/gi, '…')]; return a.length > n ? `${a.slice(0, n - 1).join('')}…` : a.join(''); };
const r1 = (n) => Math.round(n * 10) / 10;
const T = (x, y, s, o = {}) => `<text x="${r1(x)}" y="${r1(y)}" font-size="${o.size ?? 12}" font-weight="${o.weight ?? 400}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''} fill="${INK}">${esc(s)}</text>`;
const box = (x, y, w, h, label) => `<rect x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="3" fill="#ffffff" stroke="${INK}" stroke-width="1.5"/>${T(x + 6, y + h - 5, label, { size: 11, weight: 700 })}`;
export const gaugeHeight = (g) => (g.kind === 'label' ? LABEL_H : CARD_H);

// カード 1 枚の中身（原点は左上）
function cardBody(g, lang) {
  const w = W(lang); const u = g.unit ?? ''; const H = gaugeHeight(g);
  const out = [`<rect x="0.75" y="0.75" width="${CARD_W - 1.5}" height="${H - 1.5}" rx="6" fill="#ffffff" stroke="${INK}" stroke-width="1.5"/>`];
  out.push(T(10, 18, clip(g.name, 26), { size: 12, weight: 700 }));
  out.push(T(CARD_W - 8, 18, `${g.kind === 'ring' ? '◎' : g.kind === 'bar' ? '▮' : '＃'} ${kindLabel(g, lang)}`, { size: 11, weight: 700, anchor: 'end' }));
  const dir = `${directionMark(g)} ${w.direction}: ${directionLabel(g, lang)}`;
  let bx = CARD_W - 8;
  const marks = [];
  if (g.needsReview) { const l = `▲ ${g.reviewLabel || w.review}`; const bw = Math.max(60, [...l].length * 12 + 12); bx -= bw; marks.push(box(bx, H - 24, bw, 18, l)); bx -= 6; }
  if (g.confidential) { const l = `🔒 ${w.confidential}`; const bw = Math.max(60, [...l].length * 12 + 8); bx -= bw; marks.push(box(bx, H - 24, bw, 18, l)); }
  if (g.kind === 'ring') {
    const cx = 48; const cy = 66; const r = 28; const C = 2 * Math.PI * r;
    const pct = pctOf(g.value, g.unit); const frac = Math.min(pct, RING_CAP) / RING_CAP;
    out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${TRACK}" stroke-width="9"/>`);
    out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${BRAND}" stroke-width="9" stroke-dasharray="${r1(C * frac)} ${r1(C * (1 - frac) + 0.01)}" transform="rotate(-90 ${cx} ${cy})"/>`);
    const tp = Math.min(pctOf(g.target, g.unit), RING_CAP) / RING_CAP; const a = -Math.PI / 2 + 2 * Math.PI * tp;
    out.push(`<line x1="${r1(cx + Math.cos(a) * (r - 9))}" y1="${r1(cy + Math.sin(a) * (r - 9))}" x2="${r1(cx + Math.cos(a) * (r + 9))}" y2="${r1(cy + Math.sin(a) * (r + 9))}" stroke="${INK}" stroke-width="3" stroke-dasharray="3 1"/>`);
    if (g.clamped) { out.push(`<circle cx="${cx}" cy="${cy}" r="${r + 9}" fill="none" stroke="${BRAND}" stroke-width="3" stroke-dasharray="2 3"/>`); out.push(T(cx, cy + 50, w.over(fmt(g.over)), { size: 11, weight: 700, anchor: 'middle' })); }
    out.push(T(cx, cy + 4, withUnit(Math.min(g.value, 9999), g.unit), { size: 12, weight: 700, anchor: 'middle' }));
    out.push(T(100, 40, `${w.current} ${withUnit(g.value, u)}`));
    out.push(T(100, 58, `${w.target} ${withUnit(g.target, u)}`));
    out.push(T(100, 76, dir, { size: 11 }));
    out.push(T(100, 92, g.clamped ? `${w.actual} ${g.actualText}` : '', { size: 11 }));
  } else if (g.kind === 'bar') {
    const x0 = 36; const track = 120; const base = g.target != null ? g.target : g.before; const per = track / BAR_CAP;
    const rows = [[w.before, g.before, 30, SOFT], [w.after, g.after, 52, BRAND]];
    for (const [lab, v, y, col] of rows) {
      const ratio = v / base; const len = Math.min(ratio, BAR_CAP) * per;
      out.push(T(8, y + 11, lab, { size: 11, weight: 700 }));
      out.push(`<rect x="${x0}" y="${y}" width="${track}" height="14" fill="#f0f0f0" stroke="${TRACK}" stroke-width="1"/>`);
      out.push(`<rect x="${x0}" y="${y}" width="${r1(len)}" height="14" fill="${col}"${lab === w.before ? ' fill-opacity="0.7"' : ''} stroke="${INK}" stroke-width="1"/>`);
      if (ratio > BAR_CAP) out.push(`<polyline points="${x0 + track - 8},${y - 2} ${x0 + track - 3},${y + 7} ${x0 + track - 8},${y + 7} ${x0 + track - 3},${y + 16}" fill="none" stroke="${INK}" stroke-width="2"/>`);
      out.push(T(x0 + track + 8, y + 11, withUnit(v, u), { size: 12, weight: 700 }));
    }
    if (g.target != null) {
      const tx = x0 + per; // 目標 = 100%
      out.push(`<line x1="${tx}" y1="26" x2="${tx}" y2="72" stroke="${INK}" stroke-width="2" stroke-dasharray="4 2"/>`);
      out.push(T(tx, 84, `${w.target} ${withUnit(g.target, u)}`, { size: 11, weight: 700, anchor: 'middle' }));
    }
    out.push(T(8, H - 26, g.clamped ? `${dir}　${w.actual} ${g.actualText}（${w.cut}）` : dir, { size: 11 }));
  } else {
    out.push(T(10, 40, `${w.current} ${withUnit(g.value, u)}${g.before != null && g.after != null ? `（${w.before} ${withUnit(g.before, u)} → ${w.after} ${withUnit(g.after, u)}）` : ''}`, { size: 13, weight: 700 }));
    out.push(T(10, 58, clip(g.reason, 40), { size: 11 }));
    out.push(T(10, 74, `${w.direction}: ${directionLabel(g, lang)}${g.target != null ? `・${w.target} ${withUnit(g.target, u)}` : ''}`, { size: 11 }));
  }
  return out.join('') + marks.join('');
}

// 説明の文章（aria-label・title）。画面外・音声でも全部の値が分かる
export const gaugeSummary = (g, lang = 'ja') => gaugeLine(g, lang);

// 1 枚の SVG（契約: renderGauge(gauge) → SVG 文字列。許可リストの要素・属性だけ）。opts.lang, opts.nested + x, y（図の中に置くとき）
export function renderGauge(g, opts = {}) {
  const lang = opts.lang ?? 'ja'; const H = gaugeHeight(g);
  const pos = opts.nested ? ` x="${opts.x ?? 0}" y="${opts.y ?? 0}"` : ` xmlns="${SVG_NS}"`;
  const label = esc(gaugeSummary(g, lang));
  return `<svg${pos} viewBox="0 0 ${CARD_W} ${H}" width="${CARD_W}" height="${H}" ${FONT} role="img" aria-label="${label}"><title>${esc(gaugeSummary(g, lang))}</title>${cardBody(g, lang)}</svg>`;
}

// 図の下に指標の帯を足す（どの描画（時系列・整理・画風）でも同じ。要点ごとの名前つきのカード）。root の寸法を伸ばす
export function appendGaugeStrip(svg, gauges, opts = {}) {
  const list = gauges ?? [];
  const src = String(svg ?? '');
  const root = /^\s*<svg\b[^>]*>/.exec(src);
  if (!list.length || !root) return src;
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(root[0]);
  const wm = /\bwidth="([\d.]+)"/.exec(root[0]); const hm = /\bheight="([\d.]+)"/.exec(root[0]);
  if (!vb || !wm || !hm) return src;
  const lang = opts.lang ?? 'ja'; const w = W(lang);
  const M = 16; const GAP = 12;
  const W0 = Math.max(Number(vb[1]), CARD_W + M * 2); const H0 = Number(vb[2]);
  const cols = Math.max(1, Math.floor((W0 - M * 2 + GAP) / (CARD_W + GAP)));
  const shown = list.slice(0, STRIP_MAX);
  let y = H0 + 32; const cells = [];
  for (let i = 0; i < shown.length; i += cols) {
    const row = shown.slice(i, i + cols); const rh = Math.max(...row.map(gaugeHeight));
    row.forEach((g, k) => cells.push(`<g data-gauge-point="${esc(g.pointId)}" data-gauge-kind="${g.kind}">${renderGauge(g, { lang, nested: true, x: M + k * (CARD_W + GAP), y })}</g>`));
    y += rh + GAP;
  }
  const more = list.length > shown.length ? T(M, y + 8, w.more(list.length - shown.length), { size: 12 }) : '';
  const H1 = y + (more ? 20 : 4);
  const strip = `<g data-gauge-strip="${list.length}"><rect x="0" y="${H0}" width="${W0}" height="${H1 - H0}" fill="#ffffff"/>`
    + `<line x1="${M}" y1="${H0 + 8}" x2="${W0 - M}" y2="${H0 + 8}" stroke="${INK}" stroke-width="1.5" stroke-dasharray="6 4"/>`
    + `${T(M, H0 + 24, `◎ ${w.indicator}`, { size: 13, weight: 700 })}${cells.join('')}${more}</g>`;
  const head = root[0].replace(/viewBox="0 0 [\d.]+ [\d.]+"/, `viewBox="0 0 ${W0} ${H1}"`).replace(/\bwidth="[\d.]+"/, `width="${W0}"`).replace(/\bheight="[\d.]+"/, `height="${H1}"`);
  const rest = src.slice(root.index + root[0].length);
  const end = rest.lastIndexOf('</svg>');
  if (end < 0) return src;
  return `${src.slice(0, root.index)}${head}${rest.slice(0, end)}${strip}${rest.slice(end)}`;
}

// ---- アプリ組立 ----
export function gaugeModule(ctx) {
  const { api, state } = ctx;
  ctx.i18n.addStrings({
    ja: { 'gauge.heading': '指標（数値の要点）', 'gauge.tip': '指標の値' },
    en: { 'gauge.heading': 'Metrics (numeric points)', 'gauge.tip': 'Metric values' },
  });
  const lang = () => state.lang;
  // 同じ要点（文字・言語が同じ）は同じ結果を使い回す（NFR-PERF-003: 5000 件でも描画のたびに判定し直さない）
  const memo = new WeakMap();
  const detect = (p) => {
    const L = lang();
    const m = memo.get(p);
    if (m && m.text === p.text && m.lang === L) return m.g;
    const g = detectGauge(p.text, L);
    memo.set(p, { text: p.text, lang: L, g });
    return g;
  };
  const decorate = (g, p) => {
    const mark = api.getReviewMark?.([p.id]) ?? null;
    const info = api.getPointInfo?.(p.id) ?? null;
    const original = info?.sources?.[0]?.rawText ?? p.text;
    return { ...g, pointId: p.id, name: p.text, original, needsReview: !!mark?.needsReview, reviewLabel: mark?.label ?? '', confidential: !!mark?.confidential };
  };
  const compute = (scenes) => {
    const out = [];
    for (const s of scenes) for (const p of s.points) { const g = detect(p); if (g) out.push(decorate(g, p)); }
    return out;
  };
  let cache = { ver: -2, lang: '', list: [] };
  api.getGauges = (scenes = null) => {
    if (scenes) return compute(scenes);
    const v = ctx.getDataVersion();
    if (v != null && cache.ver === v && cache.lang === lang()) return cache.list;
    const list = compute(state.scenes);
    cache = { ver: v ?? -2, lang: lang(), list };
    return list;
  };
  api.getGauge = (pointId) => api.getGauges().find((g) => g.pointId === pointId) ?? null;
  api.renderGauge = (g) => renderGauge(g, { lang: lang() });
  api.getGaugeLines = (scenes = null) => api.getGauges(scenes).map((g) => gaugeLine(g, lang()));
  api.getGaugeTip = (pointId) => {
    const g = api.getGauge(pointId);
    if (!g) return null;
    const w = W(lang());
    return { pointId, label: ctx.t('gauge.tip'), title: g.name, lines: [...gaugeParts(g, lang()), `${w.original}: ${g.original}`, ...(g.needsReview ? [`▲ ${g.reviewLabel || w.review}`] : [])] };
  };
  api.appendGaugeStrip = (svg, scenes = null) => appendGaugeStrip(svg, api.getGauges(scenes), { lang: lang() });
  api.enhanceGauges = (el, host) => enhanceGaugeDom(el, host, api);
  // 図（保存を含む）の下に指標の帯を足す。画面・画像・PDF・SVG が同じ出力を使う
  const baseRender = api.renderSvg;
  api.renderSvg = () => api.appendGaugeStrip(baseRender());
  // テキスト一覧・ポップアップ: 要点の行に指標の語（現在値・目標・単位・方向・種類と理由）と元の数値を添える
  const baseExtra = api.getPointExtraHtml;
  api.getPointExtraHtml = (p) => {
    const base = baseExtra ? baseExtra(p) : '';
    const g0 = /[0-9０-９]/.test(p.text) ? detect(p) : null;
    if (!g0) return base;
    const g = decorate(g0, p);
    return `${base} <span class="badge badge-gauge" data-gauge-point="${escapeHtml(p.id)}" data-gauge-kind="${g.kind}">${g.kind === 'ring' ? '◎' : g.kind === 'bar' ? '▮' : '＃'} ${escapeHtml(gaugeLine(g, lang(), false))}</span>`;
  };
}
