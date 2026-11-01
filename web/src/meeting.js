// FR-095（議題の登録・取得）: タイマー（FR-098）が参照する議題と、目的・対象読者・出力の会議の文脈。契約: tests/system/CONTRACT-MEETING.md。
// 表題・日付（タイトル情報）は settings.js が持つ。議題の持ち時間 minutes は 1 以上の整数（分）。省略・null は「既定」（PARAM-124 の 10 分で動くが、保存値は null のまま）。
import { classifyPoint } from './diagram.js';
import { deriveRelations, labelRelations } from './layoutkinds.js';
import { buildFigureDescription } from './figuredesc.js';
import { scenesForDetail } from './export.js';
import { decorateSvg, headerModel } from './meetingout.js';
export const DEFAULT_MINUTES = 10; // PARAM-124
const AGENDA_MAX = 50;
const TEXT_MAX = 500;

const isMinutes = (m) => Number.isInteger(m) && m >= 1;

// 保存値の検証（形が合わない項目は捨てる）。id は項目ごとに一意で、再読込の後も変わらない。
export function parseAgenda(raw) {
  if (!Array.isArray(raw)) return [];
  const out = []; const seen = new Set();
  for (const it of raw.slice(0, AGENDA_MAX)) {
    if (!it || typeof it !== 'object' || typeof it.name !== 'string' || !it.name.trim()) continue;
    let id = typeof it.id === 'string' && it.id ? it.id : `a${out.length + 1}`;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    out.push({ id, name: it.name.trim(), minutes: isMinutes(it.minutes) ? it.minutes : null });
  }
  return out;
}

export function meetingModule(ctx) {
  const { state, api } = ctx;
  ctx.i18n.addStrings({
    ja: { 'msg.agendaEmpty': '議題の名前が空です', 'msg.agendaMinutes': '持ち時間は 1 以上の整数（分）で入力してください', 'msg.agendaSet': '議題を登録しました', 'msg.meetingInvalid': '会議の目的・対象読者は文字で入力してください',
      'meeting.series': 'シリーズ名', 'meeting.theme': '演題', 'meeting.date': '日付', 'meeting.venue': '会場', 'meeting.purpose': '目的', 'meeting.audience': '対象読者',
      'meeting.agenda': '議題（1 行に 1 項目。「名前 | 分」）', 'meeting.group': '会議の文脈' },
    en: { 'msg.agendaEmpty': 'An agenda item name is empty', 'msg.agendaMinutes': 'Enter the time as an integer of 1 or more (minutes)', 'msg.agendaSet': 'The agenda was saved', 'msg.meetingInvalid': 'Enter the purpose and audience as text',
      'meeting.series': 'Series', 'meeting.theme': 'Title', 'meeting.date': 'Date', 'meeting.venue': 'Venue', 'meeting.purpose': 'Purpose', 'meeting.audience': 'Audience',
      'meeting.agenda': 'Agenda (one item per line: "name | minutes")', 'meeting.group': 'Meeting context' },
  });
  state.meeting = { agenda: [], purpose: '', audience: '' };
  let idSeq = 0;
  const newId = () => { const used = new Set(state.meeting.agenda.map((a) => a.id)); let id; do { id = `a${++idSeq}`; } while (used.has(id)); return id; };

  api.getMeetingContext = () => ({ purpose: state.meeting.purpose, audience: state.meeting.audience, agenda: state.meeting.agenda.map((a) => ({ ...a })) });
  api.setMeetingContext = (input = {}) => {
    // 先に全部を検査し、1 つでも不正なら全体を変えない
    for (const k of ['purpose', 'audience']) {
      if (input && Object.hasOwn(input, k) && typeof input[k] !== 'string') { ctx.change(() => ctx.setMessage('msg.meetingInvalid')); return { ok: false, reason: 'invalid' }; }
    }
    let next = null;
    if (input && Object.hasOwn(input, 'agenda')) {
      const list = Array.isArray(input.agenda) ? input.agenda : null;
      if (!list) return { ok: false, reason: 'invalid' };
      for (const it of list) {
        if (!it || typeof it.name !== 'string' || !it.name.trim()) { ctx.change(() => ctx.setMessage('msg.agendaEmpty')); return { ok: false, reason: 'empty_name' }; }
        if (it.minutes != null && !isMinutes(it.minutes)) { ctx.change(() => ctx.setMessage('msg.agendaMinutes')); return { ok: false, reason: 'invalid_minutes' }; }
      }
      // 同じ名前の項目は、並びの順に前回の id を引き継ぐ（再入力で id が変わらないように）
      const prev = state.meeting.agenda.map((a) => ({ ...a }));
      next = list.slice(0, AGENDA_MAX).map((it) => {
        const k = prev.findIndex((a) => a.name === it.name.trim());
        const id = k >= 0 ? prev.splice(k, 1)[0].id : newId();
        return { id, name: it.name.trim(), minutes: it.minutes == null ? null : it.minutes };
      });
    }
    const text = (v) => v.trim().slice(0, TEXT_MAX);
    ctx.change(() => {
      if (next) { state.meeting.agenda = next; ctx.setMessage('msg.agendaSet'); }
      if (input && Object.hasOwn(input, 'purpose')) state.meeting.purpose = text(input.purpose);
      if (input && Object.hasOwn(input, 'audience')) state.meeting.audience = text(input.audience);
    });
    return { ok: true };
  };
  // 議題の持ち時間（分）。登録がなければ既定の 10 分
  api.agendaMinutes = (item) => (item && isMinutes(item.minutes) ? item.minutes : DEFAULT_MINUTES);

  // FR-095 AC-558: 画面の入力欄（設定画面のタイトル欄と同じ場所）。議題は 1 行に 1 項目（「名前 | 分」）
  api.getMeetingFormSpec = () => ({
    group: ctx.t('meeting.group'),
    fields: ['series', 'theme', 'date', 'venue'].map((id) => ({ id, label: ctx.t(`meeting.${id}`), kind: 'title' }))
      .concat(['purpose', 'audience'].map((id) => ({ id, label: ctx.t(`meeting.${id}`), kind: 'context' })), [{ id: 'agenda', label: ctx.t('meeting.agenda'), kind: 'agenda' }]),
  });
  api.getMeetingFormValues = () => ({ ...api.getTitleInfo(), purpose: state.meeting.purpose, audience: state.meeting.audience, agenda: agendaToText(state.meeting.agenda) });
  api.setMeetingAgendaText = (text) => {
    const list = [];
    for (const line of String(text ?? '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const m = /^(.*?)\s*[|｜]\s*(\d+)\s*$/.exec(line);
      list.push(m ? { name: m[1], minutes: Number(m[2]) } : { name: line, minutes: null });
    }
    return api.setMeetingContext({ agenda: list });
  };

  // FR-095 AC-560: 出力（PNG・PDF・SVG・Markdown・HTML）が載せる会議の文脈。表題は演題（未入力は従来の表題）、日付は入力のまま（出力日を補わない）
  api.getMeetingOutput = () => {
    const ti = api.getTitleInfo?.() ?? {};
    return { title: String(ti.theme ?? '').trim() || ctx.t('app.title'), date: ti.date ?? '', series: ti.series ?? '', venue: ti.venue ?? '', agenda: state.meeting.agenda.map((a) => a.name), purpose: state.meeting.purpose, audience: state.meeting.audience };
  };
  // FR-096 AC-561〜563: 図の説明。画面の詳細度（FR-026）に従い、その詳細度で出ない要点は含めない（生成 AI・外部通信なし）
  api.getFigureDescription = () => {
    const mo = api.getMeetingOutput();
    const level = api.getDetailLevel?.() ?? 'detail';
    const topicList = api.getTopics?.() ?? [];
    const topics = topicList.map((tp) => tp.title);
    let rels; let conclusions; let open;
    if (level === 'detail' || !topicList.length) {
      const pts = state.scenes.flatMap((s) => s.points);
      const text = new Map(pts.map((p) => [p.id, p.text]));
      rels = labelRelations(deriveRelations(pts), state.lang).map((r) => `${r.kindLabel}: ${text.get(r.from)} → ${text.get(r.to)}`);
      conclusions = pts.filter((p) => classifyPoint(p) === 'conclusion').map((p) => p.text);
      open = pts.filter((p) => classifyPoint(p) === 'undecided').map((p) => p.text);
      for (const it of api.getMeetingItems?.()?.pendings ?? []) if (it.state === 'confirmed') open.push(it.text);
    } else {
      // 大項目・中項目: 画面に出る単位（大項目はトピックの題名、中項目は加えてシーンの見出し）だけを対象にする
      const shown = scenesForDetail(state.scenes, level, topicList).flatMap((s) => s.points);
      const tt = new Map(topicList.map((tp) => [tp.id, tp.title]));
      rels = (api.getTopicRelations?.() ?? []).filter((r) => tt.has(r.from) && tt.has(r.to)).map((r) => `${r.label}: ${tt.get(r.from)} → ${tt.get(r.to)}`);
      conclusions = shown.filter((p) => classifyPoint(p) === 'conclusion').map((p) => p.text);
      open = shown.filter((p) => classifyPoint(p) === 'undecided').map((p) => p.text);
    }
    return buildFigureDescription({ title: mo.title, purpose: mo.purpose, audience: mo.audience, topics: topics.length ? topics : state.scenes.map((s) => s.heading), relations: rels, conclusions, unresolved: open, lang: state.lang });
  };
  // 保存する SVG: <title>（表題）・<desc>（説明）と、表題・日付・議題の見出しを付ける
  {
    const base = api.renderSvgForSave ?? api.renderSvg;
    if (base) {
      api.renderSvgForSave = () => {
        const svg = base();
        if (!state.scenes.length) return svg;
        const fd = api.getFigureDescription();
        const mo = api.getMeetingOutput();
        // 表題・日付・議題などの入力があるときだけ、見出しの帯を足す（入力がなければ従来の図のまま、<title>・<desc> だけを付ける）
        const any = ['series', 'date', 'venue'].some((k) => String(mo[k]).trim()) || mo.agenda.length > 0 || String(api.getTitleInfo?.()?.theme ?? '').trim();
        return decorateSvg(svg, { title: fd.title, desc: fd.text, header: any ? headerModel(mo, state.lang) : null });
      };
    }
  }

  ctx.registerPersist('agenda', {
    export: () => (state.meeting.agenda.length ? state.meeting.agenda.map((a) => ({ ...a })) : undefined),
    import: (v) => { state.meeting.agenda = parseAgenda(v); },
    reset: () => { state.meeting.agenda = []; },
  });
  ctx.registerPersist('meetingText', {
    export: () => (state.meeting.purpose || state.meeting.audience ? { purpose: state.meeting.purpose, audience: state.meeting.audience } : undefined),
    import: (v) => {
      const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      state.meeting.purpose = typeof o.purpose === 'string' ? o.purpose.trim().slice(0, TEXT_MAX) : '';
      state.meeting.audience = typeof o.audience === 'string' ? o.audience.trim().slice(0, TEXT_MAX) : '';
    },
    reset: () => { state.meeting.purpose = ''; state.meeting.audience = ''; },
  });
}

const agendaToText = (list) => list.map((a) => (a.minutes ? `${a.name} | ${a.minutes}` : a.name)).join('\n');

