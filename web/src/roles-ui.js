// FR-107 AC-617〜619 の画面部分（ブラウザ専用）。状態・操作は app（roles.js）が持ち、ここは描くだけ。
// <dialog> の showModal() で、背景の inert とフォーカスの閉じ込めをブラウザに任せる。Esc で閉じ、フォーカスは開く前の要素へ戻す。
// 名前・問いかけ・要点の文は textContent / value でだけ入れる。回答は「懸念なし／懸念あり／保留」を選んだときだけ記録し、
// 未回答は文字（「未回答」）と「？」の記号で示す（色だけに頼らない）。動き・アニメーションは使わない。
export function mountRolesUI(app, doc = globalThis.document) {
  if (!doc?.body || !app.getRolesView) return null;
  const dlg = doc.createElement('dialog');
  dlg.id = 'roles-dialog'; dlg.className = 'roles-dialog glossary-dialog';
  dlg.setAttribute('aria-labelledby', 'roles-title');
  doc.body.append(dlg);
  let before = null; let sig = null; let kept = null;
  const el = (tag, attrs = {}, text) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };
  const btn = (id, label, fn, cls = 'btn') => { const b = el('button', { type: 'button', class: cls, 'data-id': id }, label); b.addEventListener('click', fn); return b; };

  function buildRoles(v) {
    dlg.append(el('p', { class: 'hint' }, app.t('roles.note')));
    for (const r of v.roles) {
      const lab = el('label', {}, `${r.label} `);
      const inp = el('input', { type: 'text', autocomplete: 'off', maxlength: '100', 'data-id': `roles.${r.id}`, placeholder: app.t('roles.undecided'), 'aria-label': `${r.label}（${app.t('roles.nameLabel')}）` });
      inp.value = r.name;
      inp.addEventListener('change', () => app.setRole(r.id, inp.value));
      lab.append(inp); dlg.append(lab);
    }
    dlg.append(el('p', { role: 'status', 'data-id': 'roles.summary' }, v.roles.map((r) => `${r.label}: ${r.text}`).join(' / ')));
  }

  function buildQuestions(v) {
    dlg.append(el('p', { class: 'hint' }, app.t('question.note')));
    const ps = el('select', { 'data-id': 'question.phrase', 'aria-label': app.t('question.phrase') });
    for (const p of v.phrases) { const o = el('option', { value: p.id }, p.text); if (p.id === kept?.phrase) o.selected = true; ps.append(o); }
    const pl = el('label', {}, `${app.t('question.phrase')} `); pl.append(ps);
    const ts = el('select', { 'data-id': 'question.target', 'aria-label': app.t('question.target') });
    ts.append(el('option', { value: '' }, app.t('question.targetAll')));
    for (const p of app.getState?.().scenes?.flatMap((s) => s.points) ?? []) { const o = el('option', { value: p.id }, String(p.text ?? '').slice(0, 60)); if (p.id === kept?.target) o.selected = true; ts.append(o); }
    const tl = el('label', {}, `${app.t('question.target')} `); tl.append(ts);
    ps.addEventListener('change', () => { kept = { ...(kept ?? {}), phrase: ps.value }; });
    ts.addEventListener('change', () => { kept = { ...(kept ?? {}), target: ts.value }; });
    const ask = btn('question.ask', app.t('question.ask'), () => { app.askQuestion({ phraseId: ps.value, pointId: ts.value || null }); }, 'btn btn-primary');
    dlg.append(pl, tl, el('div', { class: 'glossary-actions' }));
    dlg.querySelector('.glossary-actions:last-of-type').append(ask);
    if (!v.questions.length) { dlg.append(el('p', { 'data-id': 'question.empty' }, app.t('question.empty'))); return; }
    const ul = el('ul', { 'aria-label': app.t('question.heading') });
    for (const q of v.questions) {
      const li = el('li', { 'data-id': `question.${q.id}`, 'data-answer': q.status });
      li.append(el('span', { class: 'badge badge-question', 'aria-hidden': 'true' }, q.mark), el('strong', {}, ` ${q.text}`));
      if (q.pointText) li.append(el('span', {}, ` — ${q.pointText}`));
      li.append(el('span', { 'data-id': `question.status.${q.id}` }, `（${q.statusLabel}）`));
      const act = el('div', { class: 'glossary-actions' });
      const sel = el('select', { 'data-id': `question.answer.${q.id}`, 'aria-label': `${app.t('question.answerLabel')}: ${q.text}` });
      sel.append(el('option', { value: '' }, app.t('question.unanswered')));
      for (const a of ['none', 'concern', 'hold']) { const o = el('option', { value: a }, app.t(`question.answer.${a}`)); if (q.answer === a) o.selected = true; sel.append(o); }
      if (!q.answer) sel.value = '';
      sel.addEventListener('change', () => { if (sel.value) app.answerQuestion(q.id, sel.value); });
      act.append(sel);
      if (q.status === 'concern') {
        if (q.concernRecorded) act.append(el('span', {}, app.t('question.recorded')));
        else act.append(btn(`question.record.${q.id}`, app.t('question.recordConcern'), () => app.recordQuestionConcern(q.id), 'btn btn-subtle'));
      }
      act.append(btn(`question.remove.${q.id}`, app.t('question.remove'), () => app.removeQuestion(q.id), 'btn btn-subtle'));
      li.append(act); ul.append(li);
    }
    dlg.append(ul);
  }

  function build(v) {
    const active = doc.activeElement?.getAttribute?.('data-id');
    dlg.replaceChildren();
    dlg.append(el('h2', { id: 'roles-title' }, v.label));
    if (v.which === 'roles') buildRoles(v); else buildQuestions(v);
    const acts = el('div', { class: 'glossary-actions' });
    acts.append(btn('roles.close', app.t('roles.close'), () => app.handleKey({ key: 'Escape' })));
    dlg.append(acts);
    if (active) dlg.querySelector(`[data-id="${globalThis.CSS?.escape ? CSS.escape(active) : active}"]`)?.focus?.();
  }

  function sync() {
    const v = app.getRolesView();
    if (!v) { if (dlg.open) { dlg.close(); before?.focus?.(); before = null; } sig = null; return; }
    const fresh = !dlg.open;
    if (fresh) before = doc.activeElement;
    const s = JSON.stringify([v.which, v.roles, v.questions, v.label]);
    if (s !== sig) { sig = s; build(v); }
    if (fresh) { dlg.showModal(); dlg.querySelector('input, select')?.focus?.(); }
  }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); app.handleKey({ key: 'Escape' }); });
  app.on?.('change', sync);
  sync();
  return { sync };
}
