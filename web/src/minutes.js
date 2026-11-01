// FR-094: 決定事項・保留事項・異論・懸念・アクション項目（議事項目）。契約: tests/system/CONTRACT-MEETING.md
// - 発話から規則で（生成 AI なしで）候補を抽出する（PARAM-126〜129）。候補は利用者が確定・却下・編集するまで確定の項目にならない。
// - 担当者・期限・完了条件・理由・決定者は自動で補わない（空は null。表示は「未定」）。
// - 保存・復元・初期化は registerPersist。生成 AI への送信には含めない（NFR-PRIV-003。api を通して外へ出さない）。
import { escapeHtml } from './outline.js';

export const KINDS = ['decision', 'pending', 'objection', 'action'];
export const KIND_LIST = { decision: 'decisions', pending: 'pendings', objection: 'objections', action: 'actions' };
// PARAM-126〜129: 言い回し（部分一致・大文字小文字を区別しない）
export const PHRASES = {
  decision: ['決まりました', '決定', '合意', '採用する', 'に決めた', 'agreed', 'decided'], // PARAM-126
  pending: ['保留', '未定', '持ち帰り', '次回', '検討中', 'pending', 'tbd'], // PARAM-127
  objection: ['反対', '懸念', '心配', '問題がある', '難しい', 'concern', 'object'], // PARAM-128
  action: ['お願いします', 'してください', '対応する', 'やります', '確認します', 'todo', 'action item'], // PARAM-129
};
const FIELDS = { decision: ['reason', 'decider'], pending: [], objection: ['relatedDecisionId'], action: ['assignee', 'due', 'doneCriteria'] };
const MAX_ITEMS = 2000;

// 発話 → 該当する種類すべて（複数に当てはまるときは複数）
export function extractKinds(text) {
  const s = String(text ?? '').toLowerCase();
  return KINDS.filter((k) => PHRASES[k].some((w) => s.includes(w.toLowerCase())));
}

const orNull = (v) => { const s = v == null ? '' : String(v).trim(); return s ? s : null; };

function blank(kind, id, state, text, sourceUtteranceId) {
  const it = { id, kind, state, text, sourceUtteranceId: sourceUtteranceId ?? null };
  for (const f of FIELDS[kind]) it[f] = null;
  return it;
}

// 保存値の検証（形が合わない項目は捨てる）
export function parseItems(raw) {
  const out = []; const seen = new Set();
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return { items: out };
  for (const it of raw.items.slice(0, MAX_ITEMS)) {
    if (!it || typeof it !== 'object' || !KINDS.includes(it.kind) || typeof it.id !== 'string' || !it.id || seen.has(it.id)) continue;
    if (!['candidate', 'confirmed', 'rejected'].includes(it.state) || typeof it.text !== 'string') continue;
    seen.add(it.id);
    const n = blank(it.kind, it.id, it.state, it.text, typeof it.sourceUtteranceId === 'string' ? it.sourceUtteranceId : null);
    for (const f of FIELDS[it.kind]) n[f] = orNull(it[f]);
    out.push(n);
  }
  return { items: out };
}

const STRINGS = {
  ja: {
    'minutes.decisions': '決定事項', 'minutes.pendings': '保留事項', 'minutes.objections': '異論・懸念', 'minutes.actions': 'アクション項目',
    'minutes.candidate': '候補', 'minutes.undecided': '未定', 'minutes.none': 'なし', 'minutes.heading': '議事項目',
    'minutes.reason': '理由', 'minutes.decider': '決定者', 'minutes.related': '関連する決定事項',
    'minutes.assignee': '担当者', 'minutes.due': '期限', 'minutes.doneCriteria': '完了条件',
    'minutes.candidates': '未確定の候補', 'minutes.count': '件', 'minutes.review': '要確認',
    'minutes.ui.confirm': '確定', 'minutes.ui.reject': '却下', 'minutes.ui.edit': '編集', 'minutes.ui.delete': '削除', 'minutes.ui.save': '保存', 'minutes.ui.cancel': '取り消し',
    'minutes.ui.add': '議事項目を追加', 'minutes.ui.addButton': '追加', 'minutes.ui.kind': '種類', 'minutes.ui.text': '本文',
    'msg.minutesEmpty': '内容が空です', 'msg.minutesConfirmed': '議事項目を確定しました', 'msg.minutesRejected': '候補を却下しました', 'msg.minutesSaved': '議事項目を保存しました',
  },
  en: {
    'minutes.decisions': 'Decisions', 'minutes.pendings': 'Pending items', 'minutes.objections': 'Objections and concerns', 'minutes.actions': 'Action items',
    'minutes.candidate': 'Candidate', 'minutes.undecided': 'TBD', 'minutes.none': 'None', 'minutes.heading': 'Meeting items',
    'minutes.reason': 'Reason', 'minutes.decider': 'Decided by', 'minutes.related': 'Related decision',
    'minutes.assignee': 'Owner', 'minutes.due': 'Due', 'minutes.doneCriteria': 'Done when',
    'minutes.candidates': 'Unconfirmed candidates', 'minutes.count': ' items', 'minutes.review': 'Needs review',
    'minutes.ui.confirm': 'Confirm', 'minutes.ui.reject': 'Reject', 'minutes.ui.edit': 'Edit', 'minutes.ui.delete': 'Delete', 'minutes.ui.save': 'Save', 'minutes.ui.cancel': 'Cancel',
    'minutes.ui.add': 'Add a meeting item', 'minutes.ui.addButton': 'Add', 'minutes.ui.kind': 'Type', 'minutes.ui.text': 'Text',
    'msg.minutesEmpty': 'The text is empty', 'msg.minutesConfirmed': 'The item was confirmed', 'msg.minutesRejected': 'The candidate was rejected', 'msg.minutesSaved': 'The item was saved',
  },
};

// 出力用の節（Markdown・HTML 共通）の組み立て。labels: { decisions, pendings, objections, actions, none, undecided, candidates, count, reason, decider, related, assignee, due, doneCriteria }
export function minutesSections(items, L) {
  const u = (v) => (v == null || v === '' ? L.undecided : v);
  const line = {
    decision: (i) => `${i.text}（${L.reason}: ${u(i.reason)} / ${L.decider}: ${u(i.decider)}）`,
    pending: (i) => i.text,
    objection: (i) => `${i.text}${i.relatedDecisionText ? `（${L.related}: ${i.relatedDecisionText}）` : ''}`,
    action: (i) => `${i.text}（${L.assignee}: ${u(i.assignee)} / ${L.due}: ${u(i.due)} / ${L.doneCriteria}: ${u(i.doneCriteria)}）`,
  };
  return KINDS.map((k) => ({ kind: k, title: L[KIND_LIST[k]], lines: (items[KIND_LIST[k]] ?? []).filter((i) => i.state === 'confirmed').map((i) => line[k]({ ...i, relatedDecisionText: i.relatedDecisionId ? (items.decisions.find((d) => d.id === i.relatedDecisionId)?.text ?? '') : '' })) }));
}

export function minutesModule(ctx) {
  const { state, api } = ctx;
  ctx.i18n.addStrings(STRINGS);
  const t = (k) => ctx.i18n.t(k);
  state.minutes = { items: [] };
  let seq = 0;
  const newId = () => { const used = new Set(state.minutes.items.map((i) => i.id)); let id; do { id = `m${++seq}`; } while (used.has(id)); return id; };

  // 発話から候補を作る（まだ作っていない（発話, 種類）の組だけ。却下した組も items に残るので再び候補にならない）
  function sync() {
    const have = new Set(state.minutes.items.filter((i) => i.sourceUtteranceId).map((i) => `${i.sourceUtteranceId}\u0001${i.kind}`));
    for (const u of state.utterances ?? []) {
      if (state.minutes.items.length >= MAX_ITEMS) break;
      for (const k of extractKinds(u.text)) {
        if (have.has(`${u.id}\u0001${k}`)) continue;
        state.minutes.items.push(blank(k, newId(), 'candidate', String(u.text), u.id));
      }
    }
  }
  const copy = (i) => ({ ...i });
  const find = (id) => state.minutes.items.find((i) => i.id === id && i.state !== 'rejected');

  api.getMeetingItems = () => {
    sync();
    const vis = state.minutes.items.filter((i) => i.state !== 'rejected');
    const out = { decisions: [], pendings: [], objections: [], actions: [], candidateCount: 0 };
    for (const i of vis) { out[KIND_LIST[i.kind]].push(copy(i)); if (i.state === 'candidate') out.candidateCount++; }
    return out;
  };
  api.confirmMeetingItem = (id) => {
    sync();
    const it = state.minutes.items.find((i) => i.id === id);
    if (!it || it.state === 'rejected') return { ok: false };
    if (it.state === 'candidate') ctx.change(() => { it.state = 'confirmed'; ctx.setMessage('msg.minutesConfirmed'); });
    return { ok: true };
  };
  api.rejectMeetingItem = (id) => {
    sync();
    const it = find(id);
    if (!it) return { ok: false };
    if (it.state === 'candidate' && it.sourceUtteranceId) ctx.change(() => { it.state = 'rejected'; ctx.setMessage('msg.minutesRejected'); });
    else ctx.change(() => { state.minutes.items = state.minutes.items.filter((x) => x !== it); ctx.setMessage('msg.minutesRejected'); });
    return { ok: true };
  };
  function applyFields(it, fields) {
    for (const f of FIELDS[it.kind]) {
      if (!Object.hasOwn(fields, f)) continue;
      it[f] = orNull(fields[f]);
    }
  }
  const checkRelated = (kind, fields, self) => {
    if (kind !== 'objection' || !Object.hasOwn(fields, 'relatedDecisionId')) return true;
    const v = orNull(fields.relatedDecisionId);
    return v == null || state.minutes.items.some((d) => d.id === v && d.kind === 'decision' && d.state !== 'rejected' && d !== self);
  };
  api.editMeetingItem = (id, fields = {}) => {
    sync();
    const it = find(id);
    if (!it) return { ok: false, reason: 'not_found' };
    if (Object.hasOwn(fields, 'text') && !String(fields.text ?? '').trim()) { ctx.change(() => ctx.setMessage('msg.minutesEmpty')); return { ok: false, reason: 'empty_text' }; }
    if (!checkRelated(it.kind, fields, it)) return { ok: false, reason: 'invalid_related' };
    ctx.change(() => { if (Object.hasOwn(fields, 'text')) it.text = String(fields.text).trim(); applyFields(it, fields); ctx.setMessage('msg.minutesSaved'); });
    return { ok: true };
  };
  api.addMeetingItem = (kind, fields = {}) => {
    if (!KINDS.includes(kind)) return { ok: false, reason: 'invalid_kind' };
    if (!String(fields?.text ?? '').trim()) { ctx.change(() => ctx.setMessage('msg.minutesEmpty')); return { ok: false, reason: 'empty_text' }; }
    if (!checkRelated(kind, fields, null)) return { ok: false, reason: 'invalid_related' };
    sync();
    const it = blank(kind, newId(), 'confirmed', String(fields.text).trim(), null);
    applyFields(it, fields);
    ctx.change(() => { state.minutes.items.push(it); ctx.setMessage('msg.minutesSaved'); });
    return { ok: true, id: it.id };
  };

  const labels = () => ({
    decisions: t('minutes.decisions'), pendings: t('minutes.pendings'), objections: t('minutes.objections'), actions: t('minutes.actions'),
    none: t('minutes.none'), undecided: t('minutes.undecided'), candidates: t('minutes.candidates'), count: t('minutes.count'), review: t('minutes.review'),
    reason: t('minutes.reason'), decider: t('minutes.decider'), related: t('minutes.related'), assignee: t('minutes.assignee'), due: t('minutes.due'), doneCriteria: t('minutes.doneCriteria'),
  });
  api.getMinutesLabels = labels;
  // 出力（Markdown・HTML）用: 確定した項目だけの節と、未確定の候補の件数
  api.getMinutesForExport = () => { const items = api.getMeetingItems(); return { sections: minutesSections(items, labels()), candidateCount: items.candidateCount, labels: labels() }; };

  // テキスト一覧（NFR-A11Y-001）: 同じ語で。候補は文字「候補」＋枠つきの記号（色だけにしない）
  api.renderMinutes = () => {
    const items = api.getMeetingItems();
    const L = labels();
    const u = (v) => `<span class="minutes-undecided">${escapeHtml(v == null || v === '' ? L.undecided : v)}</span>`;
    const detail = {
      decision: (i) => ` <span class="minutes-field">${escapeHtml(L.reason)}: ${u(i.reason)} / ${escapeHtml(L.decider)}: ${u(i.decider)}</span>`,
      pending: () => '',
      objection: (i) => (i.relatedDecisionId ? ` <span class="minutes-field">${escapeHtml(L.related)}: ${escapeHtml(items.decisions.find((d) => d.id === i.relatedDecisionId)?.text ?? '')}</span>` : ''),
      action: (i) => ` <span class="minutes-field">${escapeHtml(L.assignee)}: ${u(i.assignee)} / ${escapeHtml(L.due)}: ${u(i.due)} / ${escapeHtml(L.doneCriteria)}: ${u(i.doneCriteria)}</span>`,
    };
    const sec = KINDS.map((k) => {
      const list = items[KIND_LIST[k]];
      const lis = list.map((i) => `<li data-minutes-id="${escapeHtml(i.id)}" data-state="${i.state}">${i.state === 'candidate' ? `<span class="badge badge-candidate" data-candidate-mark><span aria-hidden="true">□</span> ${escapeHtml(L.candidate ?? t('minutes.candidate'))}</span> ` : ''}${escapeHtml(i.text)}${detail[k](i)}</li>`).join('');
      return `<section class="outline-minutes-${k}" aria-label="${escapeHtml(L[KIND_LIST[k]])}"><h3>${escapeHtml(L[KIND_LIST[k]])}</h3>${list.length ? `<ul>${lis}</ul>` : `<p>${escapeHtml(L.none)}</p>`}</section>`;
    }).join('');
    return `<section class="outline-minutes" aria-label="${escapeHtml(t('minutes.heading'))}"><h2>${escapeHtml(t('minutes.heading'))}</h2>${sec}</section>`;
  };
  // 項目が 1 つもないときは一覧に出さない
  api.getMinutesOutlineHtml = () => (state.minutes.items.some((i) => i.state !== 'rejected') || (state.utterances ?? []).some((u) => extractKinds(u.text).length) ? api.renderMinutes() : '');

  ctx.registerPersist('minutes', {
    export: () => { sync(); return state.minutes.items.length ? { items: state.minutes.items.map(copy) } : undefined; },
    import: (v) => { state.minutes = parseItems(v); seq = 0; },
    reset: () => { state.minutes = { items: [] }; seq = 0; },
  });
}
