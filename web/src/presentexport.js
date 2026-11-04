// FR-090 AC-528〜531: 構造化 Markdown と HTML プレゼンテーション（1 ファイルのスライド）の保存。契約: tests/system/CONTRACT-LIVE-EXPORT.md
// - Markdown: トピック（#）→ シーン（##）→ 要点（箇条書き）。関係の種類・向きは始点の要点の入れ子の箇条書きに書く。内容は図の詳細度に従う。
// - HTML: シーンごとに 1 枚（見出し・要点・図）。矢印キー・自動送り（PARAM-004 = 8 秒）。外部参照なし。会議の文字列は escapeHtml で文字にする（NFR-SEC-004）。
import { escapeHtml } from './outline.js';
import { renderDiagramSvg, classifyPoint } from './diagram.js';
import { stampName } from './export.js';
import { markdownHead, htmlHead } from './meetingout.js';
import { PHRASES } from './minutes.js';
import { SLIDE_ITEM_MAX } from './projection.js';

export const DWELL_SEC = 8; // PARAM-004

const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
const REVIEW_MARK = '[要確認]'; // AC-547
const statusLine = (r) => `確認の状況: 確認済み ${r.confirmed} 件／全体 ${r.total} 件`;

// トピックごとに、含まれるシーンを出現順に並べる（どのトピックにも属さないシーンは最後の無題の組にまとめる）
function groupScenes(scenes, topics) {
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const seen = new Set();
  const groups = [];
  for (const tp of topics ?? []) {
    const list = (tp.sceneIds ?? []).map((id) => byId.get(id)).filter((s) => s && !seen.has(s.id));
    list.forEach((s) => seen.add(s.id));
    groups.push({ title: tp.title, scenes: list });
  }
  const rest = scenes.filter((s) => !seen.has(s.id));
  if (rest.length) groups.push({ title: null, scenes: rest });
  return groups;
}

// アクション項目の抽出規則（AC に定めがないため、依頼・担当・期限を述べる要点だけを拾う）
// PARAM-129 の語（minutes.js の PHRASES.action）に、従来のこの書き出し固有の語（お願い・を行う・action）を足す
const ACTION_WORDS = [...new Set([...PHRASES.action, 'お願い', 'を行う', 'action'])];
const ACTION_RE = new RegExp(ACTION_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');

// level: 'major'（トピックまで）| 'middle'（シーンの見出しまで）| 'detail'（要点まで）。relations: getOutlineRelations() の配列（詳細のみ）
// 構成（AC-528）: # 会議タイトル → ## トピック → ### 要点（詳細のみ）→ 箇条書き（関係・シーン見出し）→ 末尾に ## 決定事項・## アクション項目
// kindOf: 要点の文字列 → 種類 id（'conclusion' を決定事項にする）
// minutes（FR-094 AC-556）: { sections:[{title, lines}], candidateCount, labels } を渡すと、末尾の 4 節は確定した議事項目だけにする（候補は出さない）。
// reviewTexts（AC-547）: 渡すと末尾に「要確認」の節（確認されていない要点。詳細度によらず常に出す。0 件は「なし」）を置く
export function buildMarkdown({ scenes, topics, relations = [], level = 'detail', title = '', kindOf = () => 'note', noneLabel = 'なし', labels = {}, minutes = null, reviewTexts = null, meta = null, lang = 'ja', review = null, gauges = null }) {  const L = { decisions: '決定事項', actions: 'アクション項目', untitled: '(未分類)', ...labels };
  // AC-547: review = { confirmed, total, ids:Set } で、要点の行の印・確認の状況・「要確認」の節（常に）を出す
  const mark = (p) => (review?.ids.has(p.id) ? ` ${REVIEW_MARK}` : '');
  // AC-547: 1 要点 1 行「要点の文字（理由: 数値、日付…）」。理由は review.reasons（要点 id → 理由の語の配列）
  const withReason = (p) => { const rs = review.reasons?.get(p.id) ?? []; return rs.length ? `${p.text}（${review.reasonLabel ?? '理由'}: ${rs.join('、')}）` : p.text; };
  if (review) reviewTexts = scenes.flatMap((s) => s.points).filter((p) => review.ids.has(p.id)).map(withReason);
  const out = [`# ${oneLine(title) || '-'}`, '', ...markdownHead(meta, lang)]; // FR-095 AC-560・AC-578: 冒頭に日付・議題・目的・対象読者
  if (review) out.push('', statusLine(review), '');
  const texts = new Map(scenes.flatMap((s) => s.points).map((p) => [p.id, p.text]));
  const rels = new Map();
  if (level === 'detail') for (const r of relations) { (rels.get(r.from) ?? rels.set(r.from, []).get(r.from)).push(r); }
  const decisions = []; const actions = [];
  for (const g of groupScenes(scenes, topics)) {
    out.push(`## ${oneLine(g.title ?? L.untitled) || '-'}`, '');
    for (const s of g.scenes) {
      if (level === 'middle') out.push(`- ${oneLine(s.heading)}`);
      for (const p of s.points) {
        if (kindOf(p.text) === 'conclusion') decisions.push(p.text);
        if (ACTION_RE.test(p.text)) actions.push(p.text);
        if (level !== 'detail') continue;
        out.push(`### ${oneLine(p.text)}${mark(p)}`, '');
        for (const r of rels.get(p.id) ?? []) out.push(`- ${oneLine(r.kindLabel)} ${r.bidirectional ? '↔' : '→'} ${oneLine(texts.get(r.to))}${r.basis === 'inferred' && r.basisLabel ? `（${oneLine(r.basisLabel)}）` : ''}`);
        if (rels.has(p.id)) out.push('');
      }
    }
    out.push('');
  }
  if (minutes) {
    minutes.sections.forEach((sec, k) => {
      out.push(`## ${oneLine(sec.title)}`, '');
      if (sec.lines.length) sec.lines.forEach((x) => out.push(`- ${oneLine(x)}`)); else out.push(`- ${noneLabel}`);
      if (k === minutes.sections.length - 1 && minutes.candidateCount > 0) out.push('', `${minutes.labels.candidates} ${minutes.candidateCount} ${minutes.labels.count}`.trimEnd());
      out.push('');
    });
  } else {
    for (const [head, list] of [[L.decisions, decisions], [L.actions, actions]]) {
      out.push(`## ${head}`, '');
      if (list.length) list.forEach((x) => out.push(`- ${oneLine(x)}`)); else out.push(`- ${noneLabel}`);
      out.push('');
    }
  }
  if (gauges?.length) { // FR-109 AC-627・AC-628: 指標の文字（現在値・目標・単位・方向・種類と理由・元の数値・要確認）。詳細度によらず常に出す
    out.push(`## ${L.gauges ?? '指標'}`, '');
    gauges.forEach((x) => out.push(`- ${oneLine(x)}`));
    out.push('');
  }
  if (reviewTexts) {
    out.push(`## ${L.review ?? '要確認'}`, '');
    if (reviewTexts.length) reviewTexts.forEach((x) => out.push(`- ${oneLine(x)}`)); else out.push(`- ${noneLabel}`);
    out.push('');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
// FR-100 AC-590: 表示される文字は 24 px（図の幅 1920 px 換算＝幅の 1.25%）を下回らない。基準の文字（1rem）を max(1.25vw,16px) にし、見出し・項目・操作は 1rem 以上
export { SLIDE_ITEM_MAX }; // PARAM-142（projection.js で定義）。超えるときは文字を縮めず、次のスライドへ分ける（どの項目も省かない）
const CSS = 'html{font-size:max(1.25vw,16px)}html,body{margin:0;height:100%;background:#fff;color:#1a1a1a;font-family:system-ui,"Yu Gothic","Hiragino Sans",sans-serif}'
  + 'main{height:100%;display:flex;flex-direction:column}section[data-slide]{display:none;flex:1;overflow:auto;padding:24px 32px}'
  + 'section[data-slide][data-active="true"]{display:block}h1{font-size:1.5rem;margin:0 0 12px}ul{padding:0;margin:0;list-style:none}li{display:inline-block;font-size:1rem;margin:4px 6px 4px 0;padding:4px 10px;border:1px solid #888;border-radius:8px}'
  + '.fig{margin-top:16px}.fig svg{max-width:100%;height:auto}nav{display:flex;gap:12px;align-items:center;padding:8px 32px;border-top:1px solid #888}'
  + 'button{font:inherit;padding:6px 14px;border:2px solid #1a1a1a;background:#fff;color:#1a1a1a;border-radius:6px;cursor:pointer}'
  + 'button[aria-pressed="true"]{background:#1a1a1a;color:#fff}.meeting-head p{margin:2px 0}.meeting-head li{display:list-item;border:0;margin:0;padding:0;font-size:1rem}';

// 実行時の挙動（スクリプトは固定の文字列。会議の文字列は含めない）
const RUNTIME = `(function(){var s=[].slice.call(document.querySelectorAll('section[data-slide]')),i=0,timer=null,auto=false,D=__DWELL__*1000;
var b=document.querySelector('[data-autoplay]'),c=document.querySelector('[data-counter]');
function show(n){i=Math.max(0,Math.min(s.length-1,n));s.forEach(function(e,k){e.setAttribute('data-active',k===i?'true':'false');});if(c)c.textContent=(i+1)+' / '+s.length;}
function stop(){auto=false;if(timer){clearTimeout(timer);timer=null;}if(b)b.setAttribute('aria-pressed','false');}
function arm(){if(timer){clearTimeout(timer);timer=null;}if(!auto)return;if(i>=s.length-1){stop();return;}timer=setTimeout(function(){timer=null;show(i+1);arm();},D);}
function go(n){show(n);if(auto)arm();}
document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'){go(i+1);}else if(e.key==='ArrowLeft'){go(i-1);}});
if(b)b.addEventListener('click',function(){if(auto){stop();}else{auto=true;b.setAttribute('aria-pressed','true');arm();}});
show(0);})();`;

// 最初に概要 1 枚（data-slide-kind="overview"）、続いてトピックごとに 1 枚（data-topic-id。見出し・要点・図）。AC-530
// svgOf(scenes[]) → その範囲の図の SVG
export function buildHtml({ scenes, topics = [], lang = 'ja', title = '', labels, svgOf, minutes = null, reviewTexts = null, meta = null, review = null, gauges = null }) {
  const L = labels ?? { auto: 'Auto', hint: '← →' };
  if (review && !reviewTexts && minutes) reviewTexts = scenes.flatMap((s) => s.points).filter((p) => review.ids.has(p.id)).map((p) => p.text);
  const gaugeBlock = gauges?.length ? `<section data-gauges><h2>${escapeHtml(L.gauges ?? '指標')}</h2><ul>${gauges.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul></section>` : ''; // FR-109 AC-628
  const statusBlock = gaugeBlock + (review ? `<p data-review-status>${escapeHtml(statusLine(review))}</p><p data-review-unconfirmed>${escapeHtml(`未確認 ${review.ids.size} 件`)}</p>` : ''); // AC-547
  const groups = groupScenes(scenes, topics);
  // FR-094 AC-556: 確定した議事項目の節（見出し付き）を概要のスライドに置く（スライド数は変えない）。候補は含めず、未確定の候補の件数を文字で示す
  const minutesBlock = minutes ? `<div class="minutes" data-minutes>${minutes.sections.map((sec) => `<section data-minutes-kind="${escapeHtml(sec.kind)}"><h2>${escapeHtml(sec.title)}</h2>${sec.lines.length ? `<ul>${sec.lines.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : `<p>${escapeHtml(L.none ?? 'なし')}</p>`}</section>`).join('')}`
    + `${minutes.candidateCount > 0 ? `<p data-minutes-candidates>${escapeHtml(`${minutes.labels.candidates} ${minutes.candidateCount} ${minutes.labels.count}`.trimEnd())}</p>` : ''}`
    + `${reviewTexts ? `<section data-minutes-kind="review"><h2>${escapeHtml(L.review ?? '要確認')}</h2>${reviewTexts.length ? `<ul>${reviewTexts.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : `<p>${escapeHtml(L.none ?? 'なし')}</p>`}</section>` : ''}</div>` : '';
  const slide = (attrs, i, head, items, figScenes, extra = '', headHtml = '') => {
    // FR-100 AC-590: 項目が多いときは文字を縮めず、次のスライドへ分ける（続きのスライドは data-slide-continued。要点は省かない）。図・補足は最初の 1 枚に置く
    const parts = [];
    for (let k = 0; k < items.length || k === 0; k += SLIDE_ITEM_MAX) parts.push(items.slice(k, k + SLIDE_ITEM_MAX));
    return parts.map((part, n) => `<section data-slide ${n === 0 ? attrs : `data-slide-continued="${n + 1}/${parts.length}"`} data-active="${i === 0 && n === 0 ? 'true' : 'false'}">`
      + `<h1>${escapeHtml(parts.length > 1 ? `${head} (${n + 1}/${parts.length})` : head)}</h1>${n === 0 ? headHtml : ''}<ul>${part.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
      + `${n === 0 ? `<div class="fig">${svgOf(figScenes)}</div>${extra}` : ''}</section>`).join('');
  };
  const slides = [slide('data-slide-kind="overview"', 0, title || L.overview || '-', groups.map((g) => g.title ?? L.untitled ?? '-'), scenes, statusBlock + minutesBlock, htmlHead(meta, lang, escapeHtml))]; // FR-095: 概要に日付・議題・目的・対象読者
  groups.forEach((g, k) => slides.push(slide(`data-topic-id="${escapeHtml(topics[k]?.id ?? `rest-${k}`)}"`, k + 1, g.title ?? L.untitled ?? '-', g.scenes.flatMap((s) => s.points.map((p) => (review?.ids.has(p.id) ? `${p.text} ${REVIEW_MARK}` : p.text))), g.scenes)));
  return `<!DOCTYPE html>\n<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escapeHtml(title)}</title><style>${CSS}</style></head><body><main>${slides.join('')}`
    + `<nav><button type="button" data-autoplay aria-pressed="false">${escapeHtml(L.auto)}</button><span data-counter aria-live="polite"></span><span>${escapeHtml(L.hint)}</span></nav></main>`
    + `<script>${RUNTIME.replace('__DWELL__', String(DWELL_SEC))}</script></body></html>\n`;
}

export function presentExportModule(ctx) {
  const { api } = ctx;
  ctx.i18n.addStrings({
    ja: { 'present.auto': '自動送り', 'present.hint': '← → キーでスライドを移動', 'present.none': 'なし', 'present.decisions': '決定事項', 'present.actions': 'アクション項目', 'present.untitled': '(未分類)' },
    en: { 'present.auto': 'Auto-advance', 'present.hint': 'Use the ← → keys to move between slides', 'present.none': 'None', 'present.decisions': 'Decisions', 'present.actions': 'Action items', 'present.untitled': '(Uncategorized)' },
  });
  const meetingTitle = () => String(api.getTitleInfo?.()?.theme ?? '').trim() || ctx.t('app.title');
  const meetingMeta = () => api.getMeetingOutput?.() ?? null; // FR-095: 日付・議題・目的・対象読者（表題は meetingTitle）
  const download = ctx.options.download ?? (async (a) => (await import('./export.js')).browserDownload(a));
  async function run(ext, mime, make) {
    if (!ctx.state.scenes.length) { ctx.change(() => ctx.setMessage('msg.saveNone')); return { ok: false, reason: 'no_scenes' }; }
    try {
      await download({ filename: `graphic-recording-${stampName(ctx.now())}.${ext}`, mime, data: make() });
    } catch {
      ctx.change(() => ctx.setMessage('msg.saveFailed'));
      return { ok: false, reason: 'failed' };
    }
    ctx.change(() => ctx.setMessage('msg.saved'));
    return { ok: true };
  }
  const minutesArgs = () => {
    const m = api.getMinutesForExport?.() ?? null;
    const sum = api.getReviewSummary?.();
    const ids = new Set(sum?.unconfirmed ?? []);
    const reasons = new Map([...ids].map((id) => [id, (api.getPointReview?.(id)?.reasons ?? []).map((r) => ctx.t(`review.reason.${r}`))])); // AC-547: 理由（テキスト一覧と同じ語）
    const review = sum ? { confirmed: sum.confirmed, total: sum.total, ids, reasons, reasonLabel: ctx.t('minutes.reason') } : null; // AC-547: 詳細度によらない
    const texts = ctx.state.scenes.flatMap((s) => s.points).filter((p) => ids.has(p.id)).map((p) => p.text);
    return m ? { minutes: m, reviewTexts: texts, review } : { review };
  };
  // FR-114 AC-668 (d)（決定 2026-11-05）: Markdown はテキスト一覧と同じ名前を載せる（参加メンバーの行と、ステップの最初の要点の「（発言: 名前）」）。名前を隠すときは載せない
  const withBoardNames = (scenes) => {
    const nn = api.getBoardNameNotes?.() ?? null;
    if (!nn) return { scenes, line: '' };
    return { scenes: scenes.map((s) => ({ ...s, points: s.points.map((p) => (nn.saidOf.has(p.id) ? { ...p, text: `${p.text} ${nn.saidOf.get(p.id)}` } : p)) })), line: nn.membersLine };
  };
  const addMembersLine = (md, line) => (line ? String(md).replace(/^(# [^\n]*\n)/, (m) => `${m}\n${line}\n`) : md);
  ctx.registerCommand('save.markdown', () => run('md', 'text/markdown', () => { const bn = withBoardNames(ctx.state.scenes); return addMembersLine(buildMarkdown({
    scenes: bn.scenes, topics: api.getTopics?.() ?? [], relations: api.getOutlineRelations?.() ?? [],
    level: api.getDetailLevel?.() ?? 'detail', title: meetingTitle(), meta: meetingMeta(), lang: ctx.state.lang,
    kindOf: classifyPoint, noneLabel: ctx.t('present.none'), ...minutesArgs(), gauges: api.getGaugeLines?.() ?? null,
    labels: { decisions: ctx.t('present.decisions'), actions: ctx.t('present.actions'), untitled: ctx.t('present.untitled'), review: ctx.t('minutes.review'), gauges: ctx.t('gauge.heading') },
  }), bn.line); }));
  ctx.registerCommand('save.html', () => run('html', 'text/html', () => buildHtml({
    scenes: ctx.state.scenes, topics: api.getTopics?.() ?? [], lang: ctx.state.lang, title: meetingTitle(), meta: meetingMeta(), ...minutesArgs(), gauges: api.getGaugeLines?.() ?? null,
    labels: { auto: ctx.t('present.auto'), hint: ctx.t('present.hint'), untitled: ctx.t('present.untitled'), none: ctx.t('present.none'), review: ctx.t('minutes.review'), gauges: ctx.t('gauge.heading') },
    svgOf: (ss) => { let svg = renderDiagramSvg(ss, { lang: ctx.state.lang, t: ctx.t, title: ctx.t('app.title'), style: api.getDrawStyleSpec?.(api.getDrawStyle?.()) }); svg = api.appendGaugeStrip?.(svg, ss) ?? svg; return api.renderDrawLayer ? api.renderDrawLayer(svg, { forExport: true }) : svg; }, // FR-112 AC-638: 手描きの線も図と同じ位置で含める。FR-109: 指標も含める
  })));
}
