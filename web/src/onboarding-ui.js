// FR-103: 初回の案内・ヘルプ（3 ステップ）の描画と、「サンプル」の印。状態・操作は app（onboarding.js）が持ち、ここは描くだけ。
// <dialog> の showModal() で背景の inert とフォーカスの閉じ込めをブラウザに任せる。文言はすべて textContent で入れる（escape 済み）。
// Esc（dialog の cancel）は skip と同じ（FR-024 AC-126 のポップアップの Esc には触れない）。閉じたらフォーカスを開く前の位置へ戻す。
export function mountOnboardingUI(app, doc = globalThis.document) {
  const dlg = doc?.querySelector('#onboarding-dialog');
  if (!dlg || !app.getOnboarding) return;
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let wasOpen = false; let returnTo = null; let shownStep = 0; let shownLang = '';

  function build(o) {
    for (const c of [...dlg.children]) c.remove();
    dlg.setAttribute('aria-labelledby', 'onboarding-title');
    dlg.setAttribute('aria-describedby', 'onboarding-body');
    const head = el('header', 'onboarding-head');
    const h = el('h2', null, o.label); h.id = 'onboarding-title';
    const prog = el('p', 'onboarding-progress', o.progress); prog.setAttribute('role', 'status');
    head.append(h, prog);
    const body = el('div', 'onboarding-body');
    const dots = el('ol', 'onboarding-steps'); dots.setAttribute('aria-label', o.label);
    for (const [i, s] of o.steps.entries()) {
      const li = el('li', 'onboarding-dot', `${i + 1}. ${s.title.replace(/^\d+\.\s*/, '')}`);
      if (s.current) { li.setAttribute('aria-current', 'step'); li.dataset.current = 'true'; }
      dots.append(li);
    }
    const t = el('h3', 'onboarding-step-title', o.title);
    const p = el('p', 'onboarding-text', o.body); p.id = 'onboarding-body';
    body.append(dots, t, p);
    if (o.canLoadSample) {
      const box = el('div', 'onboarding-sample');
      const b = el('button', 'btn', app.t('onboarding.loadSample')); b.type = 'button'; b.dataset.id = 'onboarding.loadSample';
      b.addEventListener('click', () => { app.onboarding.loadSample(); });
      const n = el('p', 'onboarding-note', app.t('onboarding.sampleNote')); n.id = 'onboarding-sample-note';
      b.setAttribute('aria-describedby', n.id);
      box.append(b, n); body.append(box);
    }
    const foot = el('footer', 'onboarding-foot');
    const skip = el('button', 'btn btn-subtle', app.t('onboarding.skip')); skip.type = 'button'; skip.dataset.id = 'onboarding.skip';
    skip.addEventListener('click', () => app.onboarding.skip());
    const nav = el('div', 'onboarding-nav');
    if (o.buttons.back) {
      const back = el('button', 'btn', app.t('onboarding.back')); back.type = 'button'; back.dataset.id = 'onboarding.back';
      back.addEventListener('click', () => app.onboarding.back());
      nav.append(back);
    }
    const next = el('button', 'btn btn-primary', o.buttons.next); next.type = 'button'; next.dataset.id = 'onboarding.next';
    next.addEventListener('click', () => app.onboarding.next());
    nav.append(next);
    foot.append(skip, nav);
    dlg.append(head, body, foot);
  }

  dlg.addEventListener('cancel', (e) => { e.preventDefault(); app.onboarding.skip(); }); // Esc = スキップ
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); app.onboarding.skip(); } }); // 非モーダルは cancel が来ないため

  function helpButton() {
    const b = doc.querySelector('#help-button');
    if (!b) return;
    if (b.hidden) { b.hidden = false; b.addEventListener('click', () => app.commands['help.open']()); }
    const label = app.t('label.help.open');
    if (b.textContent !== label) { b.textContent = label; b.title = app.t('tooltip.help.open'); b.setAttribute('aria-label', `${label}: ${app.t('tooltip.help.open')}`); }
  }

  function render() {
    helpButton();
    const o = app.getOnboarding();
    if (o) {
      const lang = app.getUiState?.().lang ?? '';
      if (!wasOpen) returnTo = doc.activeElement ?? null;
      if (!wasOpen || shownStep !== o.step || shownLang !== lang) {
        build(o); shownStep = o.step; shownLang = lang;
        dlg.hidden = false;
        if (!dlg.open) { if (dlg.show) dlg.show(); else dlg.setAttribute('open', ''); } // 非モーダル: 操作を塞がない（FR-062 の帯と同じ流儀）
        (dlg.querySelector('[data-id="onboarding.next"]'))?.focus();
      }
      wasOpen = true;
    } else if (wasOpen) {
      wasOpen = false; shownStep = 0;
      if (dlg.open) dlg.close?.();
      dlg.hidden = true;
      const target = returnTo?.isConnected ? returnTo : doc.querySelector('#help-button');
      target?.focus?.(); returnTo = null;
    }
    badge();
  }

  // 「サンプル」の印（色だけに頼らず文字で示す。AC-601）
  let chip = null;
  function badge() {
    const on = app.getState().sample === true;
    if (on && !chip) {
      chip = el('p', 'status-chip sample-badge', app.t('onboarding.sampleBadge')); chip.id = 'sample-badge';
      doc.querySelector('.statusbar')?.prepend(chip);
    } else if (on && chip) chip.textContent = app.t('onboarding.sampleBadge');
    else if (!on && chip) { chip.remove(); chip = null; }
  }

  app.subscribe(render);
  render();
}
