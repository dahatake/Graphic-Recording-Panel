// FR-095（議題の登録・取得の最小部分）: タイマー（FR-098）が参照する議題。契約: tests/system/CONTRACT-MEETING.md。
// ここでは議題（agenda）だけを扱う。目的・対象読者・表題は FR-095 の項目（別の要求）が足す。
// 議題の持ち時間 minutes は 1 以上の整数（分）。省略・null は「既定」（PARAM-124 の 10 分で動くが、保存値は null のまま）。
export const DEFAULT_MINUTES = 10; // PARAM-124
const AGENDA_MAX = 50;

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
    ja: { 'msg.agendaEmpty': '議題の名前が空です', 'msg.agendaMinutes': '持ち時間は 1 以上の整数（分）で入力してください', 'msg.agendaSet': '議題を登録しました' },
    en: { 'msg.agendaEmpty': 'An agenda item name is empty', 'msg.agendaMinutes': 'Enter the time as an integer of 1 or more (minutes)', 'msg.agendaSet': 'The agenda was saved' },
  });
  state.meeting = { agenda: [] };
  let idSeq = 0;
  const newId = () => { const used = new Set(state.meeting.agenda.map((a) => a.id)); let id; do { id = `a${++idSeq}`; } while (used.has(id)); return id; };

  api.getMeetingContext = () => ({ purpose: '', audience: '', agenda: state.meeting.agenda.map((a) => ({ ...a })) });
  api.setMeetingContext = (input = {}) => {
    if (input && Object.hasOwn(input, 'agenda')) {
      const list = Array.isArray(input.agenda) ? input.agenda : null;
      if (!list) return { ok: false, reason: 'invalid' };
      for (const it of list) {
        if (!it || typeof it.name !== 'string' || !it.name.trim()) { ctx.change(() => ctx.setMessage('msg.agendaEmpty')); return { ok: false, reason: 'empty_name' }; }
        if (it.minutes != null && !isMinutes(it.minutes)) { ctx.change(() => ctx.setMessage('msg.agendaMinutes')); return { ok: false, reason: 'invalid_minutes' }; }
      }
      // 同じ名前の項目は、並びの順に前回の id を引き継ぐ（再入力で id が変わらないように）
      const prev = state.meeting.agenda.map((a) => ({ ...a }));
      const next = list.slice(0, AGENDA_MAX).map((it) => {
        const k = prev.findIndex((a) => a.name === it.name.trim());
        const id = k >= 0 ? prev.splice(k, 1)[0].id : newId();
        return { id, name: it.name.trim(), minutes: it.minutes == null ? null : it.minutes };
      });
      ctx.change(() => { state.meeting.agenda = next; ctx.setMessage('msg.agendaSet'); });
    }
    return { ok: true };
  };
  // 議題の持ち時間（分）。登録がなければ既定の 10 分
  api.agendaMinutes = (item) => (item && isMinutes(item.minutes) ? item.minutes : DEFAULT_MINUTES);

  ctx.registerPersist('agenda', {
    export: () => (state.meeting.agenda.length ? state.meeting.agenda.map((a) => ({ ...a })) : undefined),
    import: (v) => { state.meeting.agenda = parseAgenda(v); },
    reset: () => { state.meeting.agenda = []; },
  });
}
