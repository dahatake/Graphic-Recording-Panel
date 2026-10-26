// FR-090 AC-528〜531: 構造化 Markdown と HTML プレゼンテーション（1 ファイルのスライド）の保存。契約: tests/system/CONTRACT-LIVE-EXPORT.md
// - Markdown: トピック（#）→ シーン（##）→ 要点（箇条書き）。関係の種類・向きは始点の要点の入れ子の箇条書きに書く。内容は図の詳細度に従う。
// - HTML: シーンごとに 1 枚（見出し・要点・図）。矢印キー・自動送り（PARAM-004 = 8 秒）。外部参照なし。会議の文字列は escapeHtml で文字にする（NFR-SEC-004）。
import { escapeHtml } from './outline.js';
import { renderDiagramSvg, classifyPoint } from './diagram.js';
import { stampName } from './export.js';

export const DWELL_SEC = 8; // PARAM-004

const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

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
const ACTION_RE = /お願い|してください|担当|までに|を行う|やります|対応します|確認します|共有します|調整します|todo|action/i;

// level: 'major'（トピックまで）| 'middle'（シーンの見出しまで）| 'detail'（要点まで）。relations: getOutlineRelations() の配列（詳細のみ）
// 構成（AC-528）: # 会議タイトル → ## トピック → ### 要点（詳細のみ）→ 箇条書き（関係・シーン見出し）→ 末尾に ## 決定事項・## アクション項目
// kindOf: 要点の文字列 → 種類 id（'conclusion' を決定事項にする）
export function buildMarkdown({ scenes, topics, relations = [], level = 'detail', title = '', kindOf = () => 'note', noneLabel = 'なし', labels = {} }) {
  const L = { decisions: '決定事項', actions: 'アクション項目', untitled: '(未分類)', ...labels };
  const out = [`# ${oneLine(title) || '-'}`, ''];
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
        out.push(`### ${oneLine(p.text)}`, '');
        for (const r of rels.get(p.id) ?? []) out.push(`- ${oneLine(r.kindLabel)} → ${oneLine(texts.get(r.to))}`);
        if (rels.has(p.id)) out.push('');
      }
    }
    out.push('');
  }
  for (const [head, list] of [[L.decisions, decisions], [L.actions, actions]]) {
    out.push(`## ${head}`, '');
    if (list.length) list.forEach((x) => out.push(`- ${oneLine(x)}`)); else out.push(`- ${noneLabel}`);
    out.push('');
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
const CSS = 'html,body{margin:0;height:100%;background:#fff;color:#1a1a1a;font-family:system-ui,"Yu Gothic","Hiragino Sans",sans-serif}'
  + 'main{height:100%;display:flex;flex-direction:column}section[data-slide]{display:none;flex:1;overflow:auto;padding:24px 32px}'
  + 'section[data-slide][data-active="true"]{display:block}h1{font-size:2rem;margin:0 0 12px}ul{padding:0;margin:0;list-style:none}li{display:inline-block;font-size:1.25rem;margin:4px 6px 4px 0;padding:4px 10px;border:1px solid #888;border-radius:8px}'
  + '.fig{margin-top:16px}.fig svg{max-width:100%;height:auto}nav{display:flex;gap:12px;align-items:center;padding:8px 32px;border-top:1px solid #888}'
  + 'button{font:inherit;padding:6px 14px;border:2px solid #1a1a1a;background:#fff;color:#1a1a1a;border-radius:6px;cursor:pointer}'
  + 'button[aria-pressed="true"]{background:#1a1a1a;color:#fff}';

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
export function buildHtml({ scenes, topics = [], lang = 'ja', title = '', labels, svgOf }) {
  const L = labels ?? { auto: 'Auto', hint: '← →' };
  const groups = groupScenes(scenes, topics);
  const slide = (attrs, i, head, items, figScenes) => `<section data-slide ${attrs} data-active="${i === 0 ? 'true' : 'false'}">`
    + `<h1>${escapeHtml(head)}</h1><ul>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
    + `<div class="fig">${svgOf(figScenes)}</div></section>`;
  const slides = [slide('data-slide-kind="overview"', 0, title || L.overview || '-', groups.map((g) => g.title ?? L.untitled ?? '-'), scenes)];
  groups.forEach((g, k) => slides.push(slide(`data-topic-id="${escapeHtml(topics[k]?.id ?? `rest-${k}`)}"`, k + 1, g.title ?? L.untitled ?? '-', g.scenes.flatMap((s) => s.points.map((p) => p.text)), g.scenes)));
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
  ctx.registerCommand('save.markdown', () => run('md', 'text/markdown', () => buildMarkdown({
    scenes: ctx.state.scenes, topics: api.getTopics?.() ?? [], relations: api.getOutlineRelations?.() ?? [],
    level: api.getDetailLevel?.() ?? 'detail', title: meetingTitle(),
    kindOf: classifyPoint, noneLabel: ctx.t('present.none'),
    labels: { decisions: ctx.t('present.decisions'), actions: ctx.t('present.actions'), untitled: ctx.t('present.untitled') },
  })));
  ctx.registerCommand('save.html', () => run('html', 'text/html', () => buildHtml({
    scenes: ctx.state.scenes, topics: api.getTopics?.() ?? [], lang: ctx.state.lang, title: meetingTitle(),
    labels: { auto: ctx.t('present.auto'), hint: ctx.t('present.hint'), untitled: ctx.t('present.untitled') },
    svgOf: (ss) => renderDiagramSvg(ss, { lang: ctx.state.lang, t: ctx.t, title: ctx.t('app.title'), style: api.getDrawStyleSpec?.(api.getDrawStyle?.()) }),
  })));
}
