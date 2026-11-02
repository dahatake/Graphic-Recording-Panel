// FR-107 役割（記録者・進行役・決定者）の設定と確認の問いかけ（AC-617〜620）。契約: tests/system/CONTRACT-P2.md（キー roles.open・question.open）。
// - 役割は利用者が入力した名前だけ。自動で割り当てず、発話にも結びつけない（話者の識別ではない）。未設定は「未定」と文字で出す。
//   決定者の名前は議事項目の決定者の欄の「候補」として示すだけで、自動では補わない（getDeciderCandidates）。
// - 確認の問いかけは定型文（PARAM-146）から選ぶ。回答は「懸念なし／懸念あり／保留」を利用者が明示的に選んだときだけ記録する。
//   回答がない問いかけは「未回答」で、「合意」「承認」「懸念なし」とは決して記録・表示・出力しない（判定は決定的）。「懸念あり」は異論・懸念として記録できる。
// - 役割・問いかけ・回答はセッションの保存・復元で戻り、データの初期化で消える。テキスト一覧と Markdown・HTML の出力に同じ語で載る。
//   生成 AI への送信には含めない（外部通信なし）。問いかけの対象が機密の要点のとき、機密を除く保存からその問いかけと回答を除く（AC-606）。
import { escapeHtml } from './outline.js';

export const ROLE_IDS = ['recorder', 'facilitator', 'decider'];
export const ANSWER_IDS = ['none', 'concern', 'hold'];
// PARAM-146 の定型文（id は言語によらず同じ。表示は言語ごと）
export const QUESTION_PHRASES = [
  { id: 'q1', ja: '懸念はありますか', en: 'Do you have any concerns?' },
  { id: 'q2', ja: '異論はありませんか', en: 'Are there any objections?' },
  { id: 'q3', ja: '抜けている点はありませんか', en: 'Is anything missing?' },
  { id: 'q4', ja: 'この内容で決めてよいですか', en: 'Shall we decide on this?' },
];
const NAME_MAX = 100;
const QUESTION_MAX = 200;
const cleanName = (v) => [...String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim()].slice(0, NAME_MAX).join('');

// 回答の判定（AC-619。決定的）。明示的に選ばれた 3 つ以外は、すべて「未回答」。
export const answerOf = (q) => (q && ANSWER_IDS.includes(q.answer) ? q.answer : 'unanswered');

const STRINGS = {
  ja: {
    'roles.heading': '会議の役割', 'roles.recorder': '記録者', 'roles.facilitator': '進行役', 'roles.decider': '決定者', 'roles.undecided': '未定',
    'roles.note': '役割は会議の運用の表示です。発話者の識別ではなく、名前は入力したものだけを使います。', 'roles.close': '閉じる', 'roles.nameLabel': '名前',
    'question.heading': '確認の問いかけ', 'question.phrase': '定型文', 'question.target': '対象の要点', 'question.targetAll': '会議全体', 'question.ask': '問いかける',
    'question.unanswered': '未回答', 'question.answer.none': '懸念なし', 'question.answer.concern': '懸念あり', 'question.answer.hold': '保留',
    'question.recordConcern': '異論・懸念に記録', 'question.recorded': '異論・懸念に記録済み', 'question.remove': '削除', 'question.empty': '問いかけはまだありません',
    'question.note': '回答がない問いかけは「未回答」と表示します。回答は選んだときだけ記録されます。',
    'question.mark': '？', 'question.answerLabel': '回答',
    'msg.rolesOpen': '役割の設定を開きました', 'msg.questionOpen': '確認の問いかけを開きました', 'msg.rolesClose': '役割・問いかけを閉じました', 'msg.roleSet': '役割を設定しました',
    'msg.questionAsked': '確認の問いかけ', 'msg.questionAnswered': '回答を記録しました', 'msg.questionInvalid': '問いかけを選んでください', 'msg.questionRemoved': '問いかけを削除しました', 'msg.questionRecorded': '異論・懸念に記録しました',
    'cmd.roles.open': '役割の設定を開く', 'cmd.question.open': '確認の問いかけを開く',
  },
  en: {
    'roles.heading': 'Meeting roles', 'roles.recorder': 'Recorder', 'roles.facilitator': 'Facilitator', 'roles.decider': 'Decider', 'roles.undecided': 'TBD',
    'roles.note': 'Roles are a display for running the meeting. They do not identify who spoke; only the names you type are used.', 'roles.close': 'Close', 'roles.nameLabel': 'Name',
    'question.heading': 'Confirmation questions', 'question.phrase': 'Standard question', 'question.target': 'Target point', 'question.targetAll': 'Whole meeting', 'question.ask': 'Ask',
    'question.unanswered': 'Unanswered', 'question.answer.none': 'No concerns', 'question.answer.concern': 'Concerns', 'question.answer.hold': 'On hold',
    'question.recordConcern': 'Record as objection', 'question.recorded': 'Recorded as objection', 'question.remove': 'Delete', 'question.empty': 'No questions yet',
    'question.note': 'A question without an answer is shown as "Unanswered". An answer is recorded only when you choose it.',
    'question.mark': '?', 'question.answerLabel': 'Answer',
    'msg.rolesOpen': 'The roles settings were opened', 'msg.questionOpen': 'The confirmation questions were opened', 'msg.rolesClose': 'Roles and questions were closed', 'msg.roleSet': 'The role was set',
    'msg.questionAsked': 'Confirmation question', 'msg.questionAnswered': 'The answer was recorded', 'msg.questionInvalid': 'Choose a question', 'msg.questionRemoved': 'The question was deleted', 'msg.questionRecorded': 'Recorded as an objection',
    'cmd.roles.open': 'Open the roles settings', 'cmd.question.open': 'Open the confirmation questions',
  },
};

export function rolesModule(ctx) {
  const { state, api } = ctx;
  ctx.i18n.addStrings(STRINGS);
  const t = (k) => ctx.t(k);
  const lang = () => (state.lang === 'en' ? 'en' : 'ja');
  let roles = { recorder: '', facilitator: '', decider: '' };
  let questions = []; // { id, phraseId, pointId|null, answer|null, objectionId|null }
  let seq = 0;
  let open = null; // null | 'roles' | 'question'

  const phraseText = (id) => (QUESTION_PHRASES.find((p) => p.id === id) ?? QUESTION_PHRASES[0])[lang()];
  const allPointIds = () => new Set(state.scenes.flatMap((s) => s.points.map((p) => p.id)));
  const pointText = (id) => { for (const s of state.scenes) { const p = s.points.find((x) => x.id === id); if (p) return String(p.text ?? ''); } return ''; };
  // 機密を除く保存の作成中か（visibility.js が excludedLine を載せるのは、除く保存の作成中だけ）
  const exporting = () => !!api.getVisibilityLines?.()?.excludedLine;
  const visibleQuestions = () => {
    if (!exporting()) return questions;
    const ids = allPointIds(); // 除く保存の間、機密の要点は状態から外れている
    return questions.filter((q) => !q.pointId || ids.has(q.pointId));
  };

  // ---- 役割（AC-617） ----
  const roleView = (id) => { const name = roles[id]; return { id, label: t(`roles.${id}`), name, text: name || t('roles.undecided'), undecided: !name }; };
  api.getRoles = () => ROLE_IDS.map(roleView);
  api.setRole = (id, name) => {
    if (!ROLE_IDS.includes(id)) return { ok: false, reason: 'invalid_role' };
    const v = cleanName(name);
    ctx.change(() => { roles[id] = v; ctx.setMessage('msg.roleSet'); });
    return { ok: true, name: v };
  };
  // 決定者の欄の入力の候補（自動では補わない）
  api.getDeciderCandidates = () => (roles.decider ? [roles.decider] : []);

  // ---- 確認の問いかけ（AC-618・619） ----
  api.getQuestionPhrases = () => QUESTION_PHRASES.map((p) => ({ id: p.id, text: p[lang()] }));
  const questionView = (q) => {
    const a = answerOf(q);
    return {
      id: q.id, phraseId: q.phraseId, text: phraseText(q.phraseId), pointId: q.pointId, pointText: q.pointId ? pointText(q.pointId) : '',
      answer: a === 'unanswered' ? null : a, status: a, statusLabel: t(a === 'unanswered' ? 'question.unanswered' : `question.answer.${a}`),
      mark: a === 'unanswered' ? '□' : a === 'concern' ? '▲' : a === 'hold' ? '◇' : '○', concernRecorded: !!q.objectionId,
    };
  };
  api.getQuestions = () => visibleQuestions().map(questionView);
  api.askQuestion = (arg = {}) => {
    const phrase = QUESTION_PHRASES.find((p) => p.id === arg.phraseId || p.ja === arg.text || p.en === arg.text);
    if (!phrase) { ctx.change(() => ctx.setMessage('msg.questionInvalid')); return { ok: false, reason: 'invalid_phrase' }; }
    const pointId = typeof arg.pointId === 'string' && arg.pointId ? arg.pointId : null;
    if (pointId && !allPointIds().has(pointId)) return { ok: false, reason: 'point_not_found' };
    if (questions.length >= QUESTION_MAX) return { ok: false, reason: 'limit' };
    const id = `rq${++seq}`;
    ctx.change(() => { questions.push({ id, phraseId: phrase.id, pointId, answer: null, objectionId: null }); state.message = { key: 'msg.questionAsked', text: `${t('msg.questionAsked')}: ${phrase[lang()]}` }; }); // 状態メッセージ（status）で読み上げる
    return { ok: true, id };
  };
  // 回答は明示的に選ばれたときだけ（none・concern・hold）。それ以外（空・null・未知の値）は何も記録しない
  api.answerQuestion = (id, answer) => {
    const q = questions.find((x) => x.id === id);
    if (!q) return { ok: false, reason: 'not_found' };
    if (!ANSWER_IDS.includes(answer)) return { ok: false, reason: 'invalid_answer' };
    ctx.change(() => { q.answer = answer; ctx.setMessage('msg.questionAnswered'); });
    return { ok: true };
  };
  // 「懸念あり」を異論・懸念（FR-094）の項目として記録する（利用者の操作のとき）
  api.recordQuestionConcern = (id) => {
    const q = questions.find((x) => x.id === id);
    if (!q) return { ok: false, reason: 'not_found' };
    if (answerOf(q) !== 'concern') return { ok: false, reason: 'not_concern' };
    if (q.objectionId) return { ok: true, id: q.objectionId, already: true };
    const r = api.addMeetingItem?.('objection', { text: `${phraseText(q.phraseId)}: ${t('question.answer.concern')}` });
    if (!r?.ok) return { ok: false, reason: 'add_failed' };
    ctx.change(() => { q.objectionId = r.id; ctx.setMessage('msg.questionRecorded'); });
    return { ok: true, id: r.id };
  };
  api.removeQuestion = (id) => {
    if (!questions.some((x) => x.id === id)) return { ok: false, reason: 'not_found' };
    ctx.change(() => { questions = questions.filter((x) => x.id !== id); ctx.setMessage('msg.questionRemoved'); });
    return { ok: true };
  };

  // ---- 画面（roles-ui.js が使う） ----
  const openPanel = (which, msg) => { ctx.change(() => { open = which; ctx.setMessage(msg); }); ctx.emit('roles:open', { which }); return { ok: true, open: which }; };
  ctx.registerCommand('roles.open', () => openPanel('roles', 'msg.rolesOpen'));
  ctx.registerCommand('question.open', () => openPanel('question', 'msg.questionOpen'));
  ctx.registerCommand('roles.close', () => { if (!open) return { ok: true }; ctx.change(() => { open = null; ctx.setMessage('msg.rolesClose'); }); ctx.emit('roles:close', {}); return { ok: true }; });
  ctx.registerKey({ key: 'j', ctrl: true, alt: true, shift: true, command: 'roles.open' });
  ctx.registerKey({ key: 'k', ctrl: true, alt: true, shift: true, command: 'question.open' });
  api.getRolesView = () => (open ? {
    open: true, which: open, role: 'region', label: t(open === 'roles' ? 'roles.heading' : 'question.heading'),
    roles: api.getRoles(), questions: api.getQuestions(), phrases: api.getQuestionPhrases(), deciderCandidates: api.getDeciderCandidates(),
  } : null);

  // ---- 出力の行・テキスト一覧（AC-620）。何も設定・問いかけがなければ何も足さない（従来の出力のまま） ----
  const active = () => roles.recorder || roles.facilitator || roles.decider || visibleQuestions().length > 0;
  const rolesLine = () => `${ROLE_IDS.map((id) => `${t(`roles.${id}`)}: ${roles[id] || t('roles.undecided')}`).join(' / ')}`;
  const questionLine = () => {
    const qs = api.getQuestions();
    return qs.length ? `${t('question.heading')}: ${qs.map((q) => `${q.text}（${q.statusLabel}）`).join('；')}` : '';
  };
  const baseLines = api.getConflictLines;
  api.getConflictLines = () => {
    const base = baseLines ? baseLines() : {};
    if (!active()) return base;
    const out = { ...base, rolesLine: `${t('roles.heading')}: ${rolesLine()}` };
    const ql = questionLine();
    if (ql) out.questionLine = ql;
    return out;
  };
  const baseOutline = api.getConflictOutlineHtml;
  api.getConflictOutlineHtml = () => {
    const base = baseOutline ? baseOutline() : '';
    if (!active()) return base;
    const e = escapeHtml;
    const rs = api.getRoles().map((r) => `<li data-role-id="${e(r.id)}">${e(r.label)}: ${e(r.text)}</li>`).join('');
    const qs = api.getQuestions().map((q) => `<li data-question-id="${e(q.id)}" data-answer="${e(q.status)}"><span class="badge badge-question" aria-hidden="true">${e(q.mark)}</span> ${e(q.text)}（${e(q.statusLabel)}）</li>`).join('');
    return `${base}<section class="outline-roles" data-roles-outline="1" aria-label="${e(t('roles.heading'))}"><h2>${e(t('roles.heading'))}</h2><ul>${rs}</ul>${qs ? `<h3>${e(t('question.heading'))}</h3><ul>${qs}</ul>` : ''}</section>`;
  };

  // ---- 保存・復元・初期化（AC-617・620） ----
  ctx.registerPersist('roles', {
    export: () => {
      const hasRole = ROLE_IDS.some((id) => roles[id]);
      if (!hasRole && !questions.length) return undefined;
      return { roles: { ...roles }, questions: questions.map((q) => ({ ...q })), seq };
    },
    import: (v) => {
      const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      roles = { recorder: '', facilitator: '', decider: '' };
      for (const id of ROLE_IDS) if (typeof o.roles?.[id] === 'string') roles[id] = cleanName(o.roles[id]);
      questions = (Array.isArray(o.questions) ? o.questions : []).slice(0, QUESTION_MAX)
        .filter((q) => q && typeof q.id === 'string' && QUESTION_PHRASES.some((p) => p.id === q.phraseId))
        .map((q) => ({ id: q.id, phraseId: q.phraseId, pointId: typeof q.pointId === 'string' && q.pointId ? q.pointId : null, answer: ANSWER_IDS.includes(q.answer) ? q.answer : null, objectionId: typeof q.objectionId === 'string' ? q.objectionId : null }));
      seq = Number.isInteger(o.seq) ? o.seq : 0;
      for (const q of questions) { const m = /^rq(\d+)$/.exec(q.id); if (m) seq = Math.max(seq, Number(m[1])); }
      open = null;
    },
    reset: () => { roles = { recorder: '', facilitator: '', decider: '' }; questions = []; seq = 0; open = null; },
  });
}
