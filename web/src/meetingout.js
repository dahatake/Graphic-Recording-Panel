// FR-095 AC-560・AC-578 / FR-096 AC-561: 会議の文脈の出力（表題・日付・議題の見出し、SVG の title・desc）。純関数。
// 会議の文字列は文字としてだけ扱う（SVG・HTML・Markdown へ入れるときにエスケープする。NFR-SEC-004）。
import { xmlEscape } from './figuredesc.js';

const LABELS = { ja: { agenda: '議題', purpose: '目的', audience: '対象読者', desc: '図の説明' }, en: { agenda: 'Agenda', purpose: 'Purpose', audience: 'Audience', desc: 'Figure description' } };
export const meetingLabels = (lang) => LABELS[lang === 'en' ? 'en' : 'ja'];

const one = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim();

// out: { title, date, series, venue, agenda:[名前] } → { title, lines:[文字列] }。日付が空なら日付の行を出さず（出力日を補わない）、議題が 0 件なら議題の行を出さない。
export function headerModel(out, lang = 'ja') {
  if (!out) return null;
  const L = meetingLabels(lang);
  const lines = [];
  if (one(out.date)) lines.push(one(out.date));
  const where = [one(out.series), one(out.venue)].filter(Boolean).join(' / ');
  if (where) lines.push(where);
  for (const k of ['visibilityLine', 'excludedLine', 'conflictLine', 'objectionLine', 'rolesLine', 'questionLine']) if (one(out[k])) lines.push(one(out[k])); // FR-104 AC-604・AC-606 / FR-099 AC-588 / FR-107 AC-620
  const agenda = (out.agenda ?? []).map(one).filter(Boolean);
  if (agenda.length) { lines.push(`${L.agenda}:`); agenda.forEach((n, i) => lines.push(`${i + 1}. ${n}`)); }
  return { title: one(out.title), lines };
}

const cw = (ch, fs) => (ch.codePointAt(0) >= 0x2e80 ? fs : fs * 0.55);
function wrap(text, fs, width) {
  const lines = []; let cur = ''; let w = 0;
  for (const ch of String(text)) {
    const x = cw(ch, fs);
    if (w + x > width && cur) { lines.push(cur); cur = ''; w = 0; }
    cur += ch; w += x;
  }
  lines.push(cur);
  return lines;
}

// 画像（SVG・PNG）の上端に置く見出しの配置。rows: [{ text, size, bold, y }]（y は文字の基準線）。height は見出しの帯の高さ（見出しがなければ 0）。
export function layoutHeader(model, width, { margin = 16, titleSize = 22, size = 15 } = {}) {
  if (!model || (!model.title && !model.lines.length)) return { rows: [], height: 0 };
  const inner = Math.max(80, width - margin * 2);
  const rows = []; let y = 12;
  const push = (text, fs, bold) => { for (const t of wrap(text, fs, inner)) { rows.push({ text: t, size: fs, bold, y: Math.round(y + fs) }); y += Math.round(fs * 1.45); } };
  if (model.title) push(model.title, titleSize, true);
  for (const l of model.lines) push(l, size, false);
  return { rows, height: Math.round(y + 10), margin };
}

// 保存する SVG に <title>・<desc> を付け、見出し（表題・日付・議題）の帯を上に足す。既存の <title> は置き換える。
export function decorateSvg(svg, { title = '', desc = '', header = null } = {}) {
  const m = /^(\s*<svg\b[^>]*>)/.exec(svg);
  const end = svg.lastIndexOf('</svg>');
  if (!m || end < 0) return svg;
  let root = m[1];
  let inner = svg.slice(root.length, end).replace(/^<title>[\s\S]*?<\/title>/, '');
  const td = `<title>${xmlEscape(title)}</title>${desc ? `<desc>${xmlEscape(desc)}</desc>` : ''}`;
  const vb = /viewBox="\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(root);
  if (!vb || !header) return `${root}${td}${inner}</svg>`;
  const [vx, vy, vw, vh] = vb.slice(1).map(Number);
  const lay = layoutHeader(header, vw);
  if (!lay.height) return `${root}${td}${inner}</svg>`;
  const H = lay.height;
  root = root.replace(vb[0], () => `viewBox="${vx} ${vy} ${vw} ${Math.round((vh + H) * 100) / 100}"`);
  root = root.replace(/(\sheight=")([\d.]+)(")/, (_, a, b, c) => `${a}${Math.round((Number(b) + H) * 100) / 100}${c}`);
  const texts = lay.rows.map((r) => `<text x="${vx + lay.margin}" y="${vy + r.y}" font-size="${r.size}"${r.bold ? ' font-weight="800"' : ''}>${xmlEscape(r.text)}</text>`).join('');
  return `${root}${td}<rect data-role="meeting-header-bg" x="${vx}" y="${vy}" width="${vw}" height="${H}" fill="#ffffff"/>`
    + `<g data-role="meeting-header" fill="#15191f">${texts}</g><g transform="translate(0 ${H})">${inner}</g></svg>`;
}

// Markdown の冒頭（# の次の行から最初の ## の前まで）に入れる行。< と > は文字として残す（&lt; &gt;）
const mdText = (s) => one(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function markdownHead(meta, lang = 'ja') {
  if (!meta) return [];
  const L = meetingLabels(lang);
  const out = [];
  if (one(meta.date)) out.push(mdText(meta.date), '');
  const where = [one(meta.series), one(meta.venue)].filter(Boolean).map(mdText).join(' / ');
  if (where) out.push(where, '');
  for (const k of ['visibilityLine', 'excludedLine', 'conflictLine', 'objectionLine', 'voteLine', 'rolesLine', 'questionLine']) if (one(meta[k])) out.push(mdText(meta[k]), ''); // FR-104 AC-604・AC-606 / FR-099 AC-588 / FR-107
  const agenda = (meta.agenda ?? []).map(one).filter(Boolean);
  if (agenda.length) { out.push(`**${L.agenda}**`, ''); agenda.forEach((n, i) => out.push(`${i + 1}. ${mdText(n)}`)); out.push(''); }
  if (one(meta.purpose)) out.push(`**${L.purpose}**: ${mdText(meta.purpose)}`, '');
  if (one(meta.audience)) out.push(`**${L.audience}**: ${mdText(meta.audience)}`, '');
  return out;
}

// HTML の概要スライドに入れる断片（会議の文字列は escapeHtml 済みで返す）
export function htmlHead(meta, lang, esc) {
  if (!meta) return '';
  const L = meetingLabels(lang);
  const parts = [];
  if (one(meta.date)) parts.push(`<p data-meeting="date">${esc(one(meta.date))}</p>`);
  const where = [one(meta.series), one(meta.venue)].filter(Boolean).join(' / ');
  if (where) parts.push(`<p data-meeting="where">${esc(where)}</p>`);
  if (one(meta.visibilityLine)) parts.push(`<p data-meeting="visibility">${esc(one(meta.visibilityLine))}</p>`); // FR-104 AC-604
  if (one(meta.excludedLine)) parts.push(`<p data-meeting="excluded">${esc(one(meta.excludedLine))}</p>`); // FR-104 AC-606
  if (one(meta.conflictLine)) parts.push(`<p data-meeting="conflict">${esc(one(meta.conflictLine))}</p>`); // FR-099 AC-587
  if (one(meta.objectionLine)) parts.push(`<p data-meeting="objection">${esc(one(meta.objectionLine))}</p>`); // FR-099 AC-588
  if (one(meta.voteLine)) parts.push(`<p data-meeting="vote">${esc(one(meta.voteLine))}</p>`); // FR-106 AC-616
  if (one(meta.rolesLine)) parts.push(`<p data-meeting="roles">${esc(one(meta.rolesLine))}</p>`); // FR-107
  if (one(meta.questionLine)) parts.push(`<p data-meeting="question">${esc(one(meta.questionLine))}</p>`); // FR-107
  if (one(meta.purpose)) parts.push(`<p data-meeting="purpose"><strong>${esc(L.purpose)}</strong>: ${esc(one(meta.purpose))}</p>`);
  if (one(meta.audience)) parts.push(`<p data-meeting="audience"><strong>${esc(L.audience)}</strong>: ${esc(one(meta.audience))}</p>`);
  const agenda = (meta.agenda ?? []).map(one).filter(Boolean);
  if (agenda.length) parts.push(`<div data-meeting="agenda"><strong>${esc(L.agenda)}</strong><ol>${agenda.map((n) => `<li>${esc(n)}</li>`).join('')}</ol></div>`);
  return parts.length ? `<div class="meeting-head">${parts.join('')}</div>` : '';
}
