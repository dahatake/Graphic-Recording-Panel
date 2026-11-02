// FR-106 AC-612〜616 の画面部分（ブラウザ専用）。状態・操作は app（vote.js）が持ち、ここは描くだけ。
// <dialog> の showModal() で、背景の inert とフォーカスの閉じ込めをブラウザに任せる。閉じるとフォーカスは開く前の要素へ戻す。
// 選択肢・投票者のラベルは textContent / value でだけ入れる。結果の表示は app.renderVote()（escape 済み）。動き・アニメーションは使わない。
export function mountVoteUI(app, doc = globalThis.document) {
  if (!doc?.body || !app.getVoteView) return null;
  const dlg = doc.createElement('dialog');
  dlg.id = 'vote-dialog'; dlg.className = 'vote-dialog glossary-dialog';
  dlg.setAttribute('aria-labelledby', 'vote-title');
  doc.body.append(dlg);
  let before = null; let sig = null; let voterId = null;
  const el = (tag, attrs = {}, text) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };
  const btn = (id, label, fn, cls = 'btn') => { const b = el('button', { type: 'button', class: cls, 'data-id': id }, label); b.addEventListener('click', fn); return b; };

  function buildSetup(v) {
    const err = el('p', { role: 'alert', 'data-id': 'vote.error' });
    dlg.append(el('p', { class: 'hint' }, app.t('vote.setupHint')));
    const ol = el('label', {}, app.t('vote.optionsLabel')); const ot = el('textarea', { rows: '4', 'data-id': 'vote.options' }); ol.append(ot);
    const vl = el('label', {}, app.t('vote.votersLabel')); const vt = el('textarea', { rows: '2', 'data-id': 'vote.voters' }); vl.append(vt);
    const pl = el('label', {}, app.t('vote.perPersonLabel')); const pi = el('input', { type: 'number', min: '1', max: '99', 'data-id': 'vote.perPerson' }); pi.value = String(v.defaultVotes); pl.append(pi);
    const lines = (s) => s.split(/\r?\n/);
    const stance = el('fieldset', {}); stance.append(el('legend', {}, app.t('vote.stance')));
    for (const val of ['reference', 'decision']) {
      const lab = el('label', { class: 'vote-radio' }); const r = el('input', { type: 'radio', name: 'vote-setup-stance', value: val, 'data-id': `vote.setupStance.${val}` });
      if (val === 'reference') r.checked = true;
      lab.append(r, doc.createTextNode(` ${val === 'decision' ? v.stanceDecision : v.stanceReference}`)); stance.append(lab);
    }
    const rules = el('p', { 'data-id': 'vote.setupRules' }, v.rulesText);
    pi.addEventListener('input', () => { const n = Number(pi.value); if (Number.isInteger(n) && n >= 1) rules.textContent = app.getVoteRulesText(n); });
    const start = btn('vote.start', app.t('vote.start'), () => {
      const r = app.startVote({ options: lines(ot.value).map((s) => s.trim()).filter(Boolean), voters: vt.value.trim() ? lines(vt.value) : [''], votesPerPerson: Number(pi.value), stance: dlg.querySelector('input[name="vote-setup-stance"]:checked')?.value });
      if (!r.ok) { err.textContent = r.reason; ot.focus(); }
    }, 'btn btn-primary');
    dlg.append(err, ol, vl, pl, stance, rules, el('div', { class: 'glossary-actions' }));
    dlg.querySelector('.glossary-actions').append(start, btn('vote.close', app.t('vote.close'), () => app.closeVote()));
  }

  function buildVote(v) {
    const g = v.vote;
    if (!g.voters.some((x) => x.id === voterId)) voterId = g.voters[0].id;
    dlg.append(el('p', { class: 'hint' }, app.t('vote.hint')));
    // 位置づけ（参考／決定）
    const fs = el('fieldset', {}); fs.append(el('legend', {}, app.t('vote.stance')));
    for (const val of ['reference', 'decision']) {
      const lab = el('label', { class: 'vote-radio' }); const r = el('input', { type: 'radio', name: 'vote-stance', value: val, 'data-id': `vote.stance.${val}` });
      if (g.stance === val) r.checked = true;
      r.addEventListener('change', () => app.setVoteStance(val));
      lab.append(r, doc.createTextNode(` ${val === 'decision' ? v.stanceDecision : v.stanceReference}`)); fs.append(lab);
    }
    dlg.append(fs, el('p', { 'data-id': 'vote.rules' }, `${g.rulesText}`));
    // 投票者
    const vsel = el('select', { 'data-id': 'vote.voter', 'aria-label': app.t('vote.voterSelect') });
    for (const x of g.voters) { const o = el('option', { value: x.id }, `${x.label}（${x.votesUsed} / ${g.votesPerPerson}）`); if (x.id === voterId) o.selected = true; vsel.append(o); }
    vsel.addEventListener('change', () => { voterId = vsel.value; sig = null; sync(); });
    const vlab = el('label', {}, app.t('vote.voterSelect')); vlab.append(vsel); dlg.append(vlab);
    dlg.append(el('p', { role: 'status', 'data-id': 'vote.remaining' }, `${v.usedLabel}: ${g.votesUsed} / ${g.votesPerPerson * g.voters.length}`));
    const err = el('p', { role: 'alert', 'data-id': 'vote.error' }); dlg.append(err);
    // 選択肢（票・評価）
    const ul = el('ul', { 'aria-label': app.t('vote.title') });
    for (const o of g.options) {
      const li = el('li', { 'data-id': `vote.option.${o.id}` });
      li.append(el('strong', {}, o.label), el('span', {}, ` : ${o.votes}${v.votesWord}${o.criticalRisk ? ` ⚠ ${v.critical}` : ''}`));
      const act = el('div', { class: 'glossary-actions' });
      const cast = btn(`vote.cast.${o.id}`, app.t('vote.cast'), () => { const r = app.castVote(o.id, voterId); if (!r.ok) { const e = dlg.querySelector('[data-id="vote.error"]'); if (e) e.textContent = r.reason; } }, 'btn btn-subtle');
      cast.setAttribute('aria-label', `${app.t('vote.cast')}: ${o.label}`);
      const ret = btn(`vote.retract.${o.id}`, app.t('vote.retract'), () => { const r = app.retractVote(o.id, voterId); if (!r.ok) { const e = dlg.querySelector('[data-id="vote.error"]'); if (e) e.textContent = r.reason; } }, 'btn btn-subtle');
      ret.setAttribute('aria-label', `${app.t('vote.retract')}: ${o.label}`);
      act.append(cast, ret);
      for (const c of v.criteria) {
        const lab = el('label', { class: 'vote-rating' }, `${c.label} `);
        const sel = el('select', { 'data-id': `vote.rate.${o.id}.${c.id}`, 'aria-label': `${o.label} ${c.label}` });
        sel.append(el('option', { value: '' }, v.unrated));
        for (let n = 1; n <= 5; n++) { const op = el('option', { value: String(n) }, `${n} / 5`); if (o.ratings[c.id] === n) op.selected = true; sel.append(op); }
        if (o.ratings[c.id] == null) sel.value = '';
        sel.addEventListener('change', () => app.rateOption(o.id, c.id, sel.value === '' ? null : Number(sel.value)));
        lab.append(sel); act.append(lab);
      }
      li.append(act); ul.append(li);
    }
    dlg.append(ul);
    const acts = el('div', { class: 'glossary-actions' });
    acts.append(btn('vote.tally', app.t('vote.tally'), () => app.tallyVote(), 'btn btn-primary'));
    if (g.result) acts.append(btn('vote.concern', app.t('vote.concern'), () => app.recordVoteConcern()));
    acts.append(btn('vote.end', app.t('vote.end'), () => app.endVote()), btn('vote.close', app.t('vote.close'), () => app.closeVote()));
    dlg.append(acts);
    const res = el('div', { 'data-id': 'vote.result', 'aria-live': 'polite' }); res.innerHTML = v.html; // renderVote は会議の文字列を escape 済み
    dlg.append(res);
  }

  function build(v) {
    const active = doc.activeElement?.getAttribute?.('data-id');
    dlg.replaceChildren();
    dlg.append(el('h2', { id: 'vote-title' }, app.t('vote.title')));
    if (v.vote) buildVote(v); else buildSetup(v);
    if (active) dlg.querySelector(`[data-id="${CSS.escape ? CSS.escape(active) : active}"]`)?.focus?.();
  }

  function sync() {
    const v = app.getVoteView();
    if (!v) { if (dlg.open) { dlg.close(); before?.focus?.(); before = null; } sig = null; return; }
    const view = { ...v, stanceReference: app.t('vote.stanceReference'), stanceDecision: app.t('vote.stanceDecision'), usedLabel: app.t('vote.used'), votesWord: app.t('vote.votesWord') };
    const s = JSON.stringify([v.vote, voterId, v.html]);
    const fresh = !dlg.open;
    if (fresh) before = doc.activeElement;
    if (s !== sig) { sig = s; build(view); }
    if (fresh) { dlg.showModal(); (dlg.querySelector('[data-id="vote.options"]') ?? dlg.querySelector('[data-id="vote.tally"]'))?.focus?.(); }
  }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); app.handleKey({ key: 'Escape' }); });
  app.on?.('change', sync);
  sync();
  return { sync };
}
