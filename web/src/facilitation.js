// FR-091 AC-576・AC-577: ワークショップホワイトボード型の進行の段階（発散・分類・評価・決定）。契約: CONTRACT-TIMER.md。
// 段階を使うのはこの型（先頭の型が workshop）だけで、ほかの型には影響しない。
// 発散の間は、要点は話順に並べるだけ（分類 AC-426 の昇格・AC-428 の分割・AC-429 のまとめと、結論の強調を保留し、意見の大きさをそろえる）。
// 分類以降に切り替えると、その時点から FR-079 の再配置の規則が適用され、発散の間に追加された要点も省かれない。
import { PHASES, DEFAULT_PHASE, isPhase, classifyKind, hasDecisionMark } from './pointkind.js';
import { WORKSHOP_TYPE_ID } from './workshop.js';

export function facilitationModule(ctx) {
  const { state, api } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'phase.title': '進行の段階', 'phase.current': '現在の段階', 'phase.diverge': '発散', 'phase.classify': '分類', 'phase.evaluate': '評価', 'phase.decide': '決定',
      'phase.decideMark': '決定の段階', 'phase.divergeNote': '発散の間は、要点を話順に並べるだけで、分類・強調は行いません',
      'phase.notWorkshop': 'ワークショップホワイトボード型を選んでいるときだけ、進行の段階を切り替えられます', 'msg.phaseChanged': '進行の段階を切り替えました', 'cmd.phase.next': '進行の段階を進める',
      'phase.btn.diverge': '発散', 'phase.btn.classify': '分類', 'phase.btn.evaluate': '評価', 'phase.btn.decide': '決定',
    },
    en: {
      'phase.title': 'Meeting phase', 'phase.current': 'Current phase', 'phase.diverge': 'Diverge', 'phase.classify': 'Classify', 'phase.evaluate': 'Evaluate', 'phase.decide': 'Decide',
      'phase.decideMark': 'Decision phase', 'phase.divergeNote': 'During Diverge, points are only listed in speaking order, without classification or emphasis',
      'phase.notWorkshop': 'The phase can be switched only while the workshop whiteboard type is selected', 'msg.phaseChanged': 'The meeting phase was changed', 'cmd.phase.next': 'Advance the meeting phase',
      'phase.btn.diverge': 'Diverge', 'phase.btn.classify': 'Classify', 'phase.btn.evaluate': 'Evaluate', 'phase.btn.decide': 'Decide',
    },
  });
  const t = ctx.t;
  state.facilitationPhase = DEFAULT_PHASE;
  const active = () => { const info = api.getLayoutInfo?.(); return !!info && info.applied && info.head === WORKSHOP_TYPE_ID; };

  api.getFacilitationPhase = () => state.facilitationPhase;
  api.setFacilitationPhase = (phase) => {
    if (!isPhase(phase)) return { ok: false, reason: 'invalid' };
    if (!active()) { ctx.change(() => ctx.setMessage('phase.notWorkshop')); return { ok: false, reason: 'not_workshop' }; }
    if (phase === state.facilitationPhase) return { ok: true };
    ctx.change((s) => { s.facilitationPhase = phase; ctx.setMessage('msg.phaseChanged'); });
    api.requestRearrange?.(); // 発散の保留の開始・解除。その時点から FR-079 の規則が適用される（または保留される）
    return { ok: true };
  };
  // 発散の間（AC-576）: 分類・強調を保留する。この型を使っていないときは常に false（ほかの型に影響しない）
  api.isPhaseHold = () => active() && state.facilitationPhase === 'diverge';
  ctx.registerCommand('phase.next', () => api.setFacilitationPhase(PHASES[(PHASES.indexOf(state.facilitationPhase) + 1) % PHASES.length]));
  ctx.registerKey({ key: ',', ctrl: true, alt: true, shift: true, command: 'phase.next' });

  // AC-577: 切り替えた後に追加された要点から。すでにある要点は変わらない。段階を使うのはこの型のときだけ
  ctx.pointHooks.push((p) => {
    if (!active()) return;
    const phase = state.facilitationPhase;
    const kind = classifyKind(p.text, { phase });
    if (kind !== 'note' && kind === classifyKind(p.text, {})) return; // 語のパターンで決まる種類は保存しない（従来どおり）
    if (kind !== 'note') p.kind = kind;
    if (hasDecisionMark(p.text, { phase })) p.decided = true;
  });
  // テキスト一覧: 「決定の段階」の印
  api.getPointMark = (p) => (p && p.decided ? t('phase.decideMark') : null);

  // テキスト一覧（NFR-A11Y-001）: 現在の段階を文字（発散・分類・評価・決定）と形（● 現在・○ ほか）で示す。
  // ワークショップ型の節（outline-workshop）の中に入れる（この型のときだけ。ほかの型の一覧は変わらない）
  const phaseHtml = () => {
    const cur = state.facilitationPhase;
    const items = PHASES.map((ph) => `<li data-phase="${ph}"${ph === cur ? ' aria-current="step"' : ''}><span aria-hidden="true">${ph === cur ? '●' : '○'}</span> ${t(`phase.${ph}`)}${ph === cur ? ` <span class="badge">${t('phase.current')}</span>` : ''}</li>`).join('');
    const btns = PHASES.map((ph) => `<button type="button" data-command="phase.set" data-phase="${ph}"${ph === cur ? ' aria-pressed="true"' : ' aria-pressed="false"'}>${t(`phase.btn.${ph}`)}</button>`).join('');
    return `<div class="outline-phase" data-phase-current="${cur}"><h3>${t('phase.title')}</h3><p>${t('phase.current')}: ${t(`phase.${cur}`)}</p><ol>${items}</ol>${cur === 'diverge' ? `<p>${t('phase.divergeNote')}</p>` : ''}<div role="group" aria-label="${t('phase.title')}">${btns}</div></div>`;
  };
  const baseWorkshopOutline = api.getWorkshopOutline;
  api.getWorkshopOutline = () => {
    const html = baseWorkshopOutline?.() ?? '';
    if (!html || !active()) return html;
    return html.replace(/<\/section>\s*$/, `${phaseHtml()}</section>`);
  };

  ctx.registerPersist('facilitationPhase', {
    export: () => (state.facilitationPhase !== DEFAULT_PHASE ? state.facilitationPhase : undefined),
    import: (v) => { state.facilitationPhase = isPhase(v) ? v : DEFAULT_PHASE; },
    reset: () => { state.facilitationPhase = DEFAULT_PHASE; },
  });
}
