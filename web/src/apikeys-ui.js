// FR-084・FR-085・NFR-SEC-006: 接続キー画面（画面中央のモーダル）の描画。状態・操作は app（apikeys.js）が持ち、ここは描くだけ。
// <dialog> の showModal() で、背景の inert（クリック・キーボード・読み上げ）とフォーカスの閉じ込めをブラウザに任せる。
// 背後のグレーのオーバーレイは ::backdrop（web/styles/app.css）。オーバーレイのクリックでは閉じない（入力中のキーを失わないため）。
// キー欄は type=password・autocomplete=new-password。入力中の値はこの欄（DOM）と app のメモリにだけあり、保存の操作の後と閉じたときに空にする。
export function mountApiKeysUI(app, doc = globalThis.document) {
  const dlg = doc?.querySelector('#apikeys-dialog');
  if (!dlg) return;
  let built = null; // 組み立て済みの「分類・言語」
  const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const q = (id) => dlg.querySelector(`[data-id="${id}"]`);

  function build(d) {
    for (const c of [...dlg.children]) if (!c.classList.contains('dialog-backdrop')) c.remove(); // 確認（dialog-backdrop）は残す
    dlg.setAttribute('aria-labelledby', 'apikeys-title');
    const head = el('header', 'apikeys-head');
    const h = el('h2', null, d.heading); h.id = 'apikeys-title';
    const x = el('button', 'btn btn-subtle apikeys-x', '×'); x.type = 'button'; x.dataset.id = 'apiKeys.close';
    x.setAttribute('aria-label', d.closeButton.accessibleName); x.title = d.closeButton.label;
    x.addEventListener('click', () => app.apiKeysClick('closeButton'));
    head.append(h, x);
    const body = el('div', 'apikeys-body');
    const nav = el('div', 'apikeys-nav'); nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-orientation', 'vertical'); nav.setAttribute('aria-label', app.t('apikeys.categories'));
    for (const c of d.categories) {
      const b = el('button', 'apikeys-cat', c.label); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.id = `apiKeys.category.${c.id}`;
      b.setAttribute('aria-selected', String(c.selected)); b.tabIndex = c.selected ? 0 : -1; b.id = `apikeys-tab-${c.id}`;
      b.addEventListener('click', () => app.selectApiKeysCategory(c.id));
      b.addEventListener('keydown', (e) => {
        if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); app.focusApiKeysField(b.dataset.id); app.handleKey({ key: e.key }); dlg.querySelector('[role="tab"][aria-selected="true"]')?.focus(); }
      });
      nav.append(b);
    }
    const panel = el('div', 'apikeys-panel'); panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', `apikeys-tab-${d.selected}`);
    for (const f of d.fields) {
      const row = el('div', 'apikeys-row'); row.dataset.field = f.id;
      if (f.input) {
        const l = el('label', null, f.label);
        const isSelect = f.input.type === 'select';
        const inp = doc.createElement(isSelect ? 'select' : 'input'); inp.dataset.id = f.id; inp.id = `ak-${f.id}`; l.htmlFor = inp.id;
        if (isSelect) {
          for (const o of f.input.options) { const op = doc.createElement('option'); op.value = o.value; op.textContent = o.label ?? o.value; inp.append(op); }
        } else {
          inp.type = f.input.type; inp.autocomplete = f.input.autocomplete; inp.placeholder = f.input.placeholder ?? ''; inp.spellcheck = false;
          inp.setAttribute('autocapitalize', 'off'); inp.setAttribute('autocorrect', 'off'); inp.setAttribute('data-lpignore', 'true'); inp.setAttribute('data-1p-ignore', '');
        }
        if (f.id.endsWith('.foundry.key')) inp.addEventListener('input', () => app.setFoundryKeyInput(inp.value));
        else if (f.id.endsWith('.copilot.token')) inp.addEventListener('input', () => app.setCopilotTokenInput(inp.value));
        else if (f.id.endsWith('.copilot.model')) inp.addEventListener('input', () => app.setCopilotModelInput(inp.value));
        else if (f.id.endsWith('.copilot.authMethod')) inp.addEventListener('change', () => app.setCopilotAuthMethod(inp.value));
        else if (f.id.endsWith('.foundry.endpoint')) inp.addEventListener('input', () => app.setFoundryEndpointInput(inp.value));
        else if (f.id.endsWith('.foundry.deployment')) inp.addEventListener('input', () => app.setFoundryDeploymentInput(inp.value));
        else if (f.id.endsWith('.foundry.authMethod')) inp.addEventListener('change', () => app.setFoundryAuthMethod(inp.value));
        else if (f.id.endsWith('.azureSpeech.key')) inp.addEventListener('input', () => app.setAzureSpeechKeyInput(inp.value));
        else if (f.id.endsWith('.azureSpeech.endpoint')) inp.addEventListener('input', () => app.setAzureSpeechEndpointInput(inp.value));
        row.append(l, inp);
        if (f.note) { const n = el('p', 'apikeys-note', f.note); n.id = `ak-note-${f.id}`; inp.setAttribute('aria-describedby', n.id); row.append(n); }
        if (f.status) { const sp = el('p', 'apikeys-status apikeys-field-status'); sp.dataset.statusFor = f.id; row.append(sp); }
      } else if (f.role === 'link') {
        // FR-088 AC-509: 確認のページ（新しいタブ）と確認コード
        const box = el('div', 'apikeys-signin');
        const p = el('p', 'apikeys-status'); p.dataset.id = f.id; p.setAttribute('role', 'status');
        const a = el('a', 'apikeys-link', f.label); a.href = f.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.dataset.id = `${f.id}.a`;
        a.setAttribute('aria-label', f.accessibleName);
        const code = el('code', 'apikeys-code', f.text);
        box.append(p, a, code);
        row.append(box);
      } else if (f.role === 'status') {
        const p = el('p', 'apikeys-status'); p.dataset.id = f.id; p.setAttribute('role', 'status');
        row.append(el('span', 'apikeys-status-label', f.label), p);
        if (f.guide) row.append(el('p', 'apikeys-note', f.guide));
      } else {
        const b = el('button', f.id.endsWith('.save') || f.id.endsWith('.configSave') ? 'btn btn-primary' : 'btn', f.label); b.type = 'button'; b.dataset.id = f.id;
        b.setAttribute('aria-label', f.accessibleName);
        b.addEventListener('click', () => {
          if (f.id === 'apiKeys.foundry.save') { void app.saveFoundryKey(); } else if (f.id === 'apiKeys.foundry.delete') app.commands['foundry.deleteKey']();
          else if (f.id === 'apiKeys.foundry.configSave') { void app.saveFoundryConfig(); } else if (f.id === 'apiKeys.foundry.configDelete') app.commands['foundry.deleteConfig']();
          else if (f.id === 'apiKeys.azureSpeech.save') { void app.saveAzureSpeech(); } else if (f.id === 'apiKeys.azureSpeech.delete') app.commands['azureSpeech.deleteKey']();
          else if (f.id === 'apiKeys.azureSpeech.test') void app.testAzureSpeech();
          else if (f.id.startsWith('apiKeys.copilot.')) app.runCopilotField?.(f.id);
        });
        row.append(b);
      }
      const why = el('p', 'apikeys-reason'); why.dataset.reason = f.id; why.hidden = true; row.append(why);
      panel.append(row);
    }
    if (d.selected === 'foundry' || d.selected === 'copilot') { const ls = buildLlm(); if (ls) panel.append(ls); }
    if (d.selected === 'azureSpeech') { const ms = buildSpeechMethod(); if (ms) panel.prepend(ms); }
    body.append(nav, panel);
    const live = el('p', 'apikeys-live'); live.dataset.id = 'live'; live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
    const foot = el('footer', 'apikeys-foot');
    const close = el('button', 'btn', d.closeButton.label); close.type = 'button'; close.dataset.id = 'apiKeys.close2';
    close.addEventListener('click', () => app.apiKeysClick('closeButton'));
    foot.append(live, close);
    dlg.append(head, body, foot);
    built = `${d.selected}|${(app.getUiState?.() ?? app.getState()).lang}|${d.fields.map((f) => f.id).join(',')}`;
  }

  // 設定画面から移した項目（FR-068・AC-474・FR-081）。状態・操作は app（llm.js・llmdraw.js・speechsettings.js）が持ち、ここは描くだけ。
  const settingsField = (id) => app.getSettingsDialog?.()?.fields.find((x) => x.id === id);
  function buildSpeechMethod() {
    const m = app.getAzureSpeechFields?.().find((x) => x.id === 'speech.method');
    if (!m) return null;
    const g = el('fieldset', 'settings-group'); g.dataset.id = 'speech.method';
    g.append(el('legend', null, m.label));
    for (const o of m.options) {
      const lab = el('label', 'settings-check');
      const r = doc.createElement('input'); r.type = 'radio'; r.name = 'apikeys-speech-method'; r.value = o.id;
      r.addEventListener('change', () => { if (r.checked) app.setSpeechMethod(o.id); });
      lab.append(r, el('span', null, ` ${o.label}`)); g.append(lab);
    }
    const why = el('p', 'apikeys-note'); why.dataset.id = 'speech.method.reason'; g.append(why);
    return g;
  }
  function buildLlm() {
    if (!settingsField('llm.enabled') || !settingsField('llm.test')) return null;
    const g = el('fieldset', 'settings-group'); g.dataset.id = 'llm.section';
    g.append(el('legend', null, app.t('llm.title')));
    const pf = settingsField('llm.provider');
    if (pf) {
      const grp = el('div', 'settings-radios'); grp.setAttribute('role', 'radiogroup'); grp.setAttribute('aria-label', pf.label);
      for (const op of pf.options) {
        const lab = el('label', 'settings-check');
        const rb = doc.createElement('input'); rb.type = 'radio'; rb.name = 'apikeys-llm-provider'; rb.value = op.value;
        rb.addEventListener('change', () => { if (rb.checked) void app.setLlmProvider(op.value); });
        lab.append(rb, ` ${op.label}`); grp.append(lab);
      }
      g.append(el('span', null, pf.label), grp);
    }
    const sw = (id, label, onClick) => {
      const lab = el('label', 'settings-check'); const c = doc.createElement('input'); c.type = 'checkbox'; c.setAttribute('role', 'switch'); c.dataset.id = id;
      c.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
      lab.append(c, ` ${label}`); return lab;
    };
    g.append(sw('llm.enabled', settingsField('llm.enabled').label, () => { void app.toggleLlm(); }));
    const st = el('p', 'apikeys-status'); st.dataset.id = 'llm.status'; st.setAttribute('role', 'status');
    const acts = el('div', 'settings-actions'); acts.dataset.id = 'llm.actions';
    const cred = el('p', 'apikeys-status'); cred.dataset.id = 'llm.credential';
    const tb = el('button', 'btn', settingsField('llm.test').label); tb.type = 'button'; tb.dataset.id = 'llm.test';
    tb.addEventListener('click', () => { void app.testLlmConnection(); });
    const tr = el('p', 'apikeys-status'); tr.dataset.id = 'llm.testResult'; tr.setAttribute('role', 'status');
    g.append(st, acts, cred, tb, tr);
    const mk = settingsField('llm.mask'); const mw = settingsField('llm.maskWords');
    if (mk && mw) {
      g.append(sw('llm.mask', mk.label, () => { app.setLlmMasking(!app.getLlmMasking()); }), el('p', 'apikeys-note', mk.note));
      const wi = doc.createElement('input'); wi.type = 'text'; wi.autocomplete = 'off'; wi.setAttribute('aria-label', mw.label);
      const wb = el('button', 'btn', mw.addLabel); wb.type = 'button';
      const add = () => { if (app.addLlmMaskWord(wi.value).ok) wi.value = ''; };
      wb.addEventListener('click', add);
      wi.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); } });
      const box = el('div', 'settings-inline'); box.append(wi, wb);
      const ul = el('ul', 'settings-list'); ul.dataset.id = 'llm.maskWords';
      g.append(el('span', null, mw.label), box, ul);
    }
    return g;
  }
  function syncMovedSettings() {
    const m = app.getAzureSpeechFields?.().find((x) => x.id === 'speech.method');
    if (m && q('speech.method')) {
      for (const r of dlg.querySelectorAll('input[name="apikeys-speech-method"]')) { const o = m.options.find((x) => x.id === r.value); r.checked = m.value === r.value; r.disabled = !o?.enabled; }
      const why = q('speech.method.reason'); const reason = m.options.find((x) => !x.enabled)?.reason ?? ''; why.textContent = reason; why.hidden = !reason;
    }
    if (!q('llm.section')) return;
    const en = settingsField('llm.enabled'); const cr = settingsField('llm.credential'); const te = settingsField('llm.test'); const pf = settingsField('llm.provider');
    if (!en || !cr || !te) return;
    q('llm.enabled').checked = !!en.value;
    q('llm.status').textContent = `${en.status.icon} ${en.label}: ${en.status.text}`;
    if (pf) for (const rb of dlg.querySelectorAll('input[name="apikeys-llm-provider"]')) rb.checked = rb.value === pf.value;
    const acts = q('llm.actions'); const actKey = JSON.stringify(en.status.actions ?? []);
    if (acts.dataset.key !== actKey) {
      acts.dataset.key = actKey; acts.textContent = '';
      for (const a of en.status.actions ?? []) {
        if (a.id === 'installGuide') {
          const p = el('p', 'apikeys-note'); p.dataset.action = a.id; p.append(el('strong', null, `${a.label}: `), a.text); acts.append(p);
        } else {
          const b = el('button', 'btn', a.label); b.type = 'button'; b.dataset.action = a.id;
          b.addEventListener('click', () => app.selectApiKeysCategory('copilot')); // 接続キー画面の中なので、GitHub Copilot の分類へ移る
          acts.append(b);
        }
      }
    }
    q('llm.credential').textContent = `${cr.status.icon} ${cr.label}: ${cr.status.text}`;
    q('llm.test').textContent = te.label;
    q('llm.testResult').textContent = te.status.text ? `${te.status.icon} ${te.status.text}` : '';
    const mk = settingsField('llm.mask'); const mw = settingsField('llm.maskWords'); const ul = q('llm.maskWords');
    if (mk && mw && ul) {
      q('llm.mask').checked = !!mk.value;
      const key = JSON.stringify([mw.words, (app.getUiState?.() ?? app.getState()).lang]);
      if (ul.dataset.key !== key) {
        ul.dataset.key = key; ul.textContent = '';
        if (!mw.words.length) ul.append(el('li', null, mw.emptyText));
        for (const w of mw.words) {
          const li = el('li'); li.dataset.word = w;
          const rm = el('button', 'btn', mw.removeLabel); rm.type = 'button'; rm.setAttribute('aria-label', `${mw.removeLabel}: ${w}`);
          rm.addEventListener('click', () => app.removeLlmMaskWord(w));
          li.append(el('span', null, w), rm); ul.append(li);
        }
      }
    }
  }
  function sync() {
    const d = app.getApiKeysDialog();
    if (!d) {
      if (dlg.open) dlg.close();
      dlg.hidden = true; built = null;
      return;
    }
    const key = `${d.selected}|${(app.getUiState?.() ?? app.getState()).lang}|${d.fields.map((f) => f.id).join(',')}`; // 項目が増減したとき（サインインの待機中など）も組み立て直す
    const wasOpen = dlg.open;
    if (built !== key) {
      const keep = doc.activeElement && dlg.contains(doc.activeElement) ? doc.activeElement.dataset?.id : null;
      build(d);
      if (keep) q(keep)?.focus?.();
    }
    dlg.hidden = false;
    dlg.dataset.layout = d.layout; dlg.dataset.motion = d.motion;
    if (!wasOpen) {
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      (q(`apiKeys.category.${d.selected}`) ?? q('apiKeys.close'))?.focus?.();
    }
    for (const f of d.fields) {
      const node = q(f.id);
      if (!node) continue;
      if (f.input) {
        node.disabled = f.disabled; node.setAttribute('aria-label', f.accessibleName);
        if (f.input.placeholder != null && node.tagName === 'INPUT') node.placeholder = f.input.placeholder;
        const sp = dlg.querySelector(`[data-status-for="${f.id}"]`);
        if (sp && f.status) sp.textContent = `${f.status.icon ?? ''} ${f.status.text}`.trim();
        // 入力中の値は DOM と app が持つ。app 側が空（保存の操作の後・閉じた後）なら DOM も空にする
        if (f.input.type === 'password') { if (f.input.value === '' && node.value !== '') node.value = ''; } else if (node.value !== f.input.value) node.value = f.input.value;
      } else if (f.role === 'status' || f.role === 'link') node.textContent = `${f.status.icon} ${f.status.text}`;
      else node.disabled = f.disabled;
      const why = dlg.querySelector(`[data-reason="${f.id}"]`);
      if (why) { why.textContent = f.reason ?? ''; why.hidden = !f.reason; }
    }
    syncMovedSettings();
    const live = q('live'); const lm = d.liveMessage;
    if (live) { live.textContent = lm ? lm.text : ''; live.setAttribute('role', lm?.role ?? 'status'); }
    dlg.querySelectorAll('.apikeys-cat').forEach((b, i) => { const sel = d.categories[i].selected; b.setAttribute('aria-selected', String(sel)); b.tabIndex = sel ? 0 : -1; });
  }

  // Esc はブラウザの既定（<dialog> を閉じる）にせず、app の閉じる操作に通す（保存していない入力の破棄・フォーカスの復帰を app が行う）
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (app.getDialog()) app.handleKey({ key: 'Escape' }); else app.commands['apiKeys.close'](); });
  // オーバーレイ（::backdrop）のクリックでは閉じない。何もしない
  dlg.addEventListener('click', (e) => { if (e.target === dlg) e.stopPropagation(); });
  // 閉じたら、フォーカスは「接続キー」のボタンへ戻す
  app.on('change', () => {
    const was = dlg.open;
    sync();
    if (was && !dlg.open) doc.querySelector('#toolbar [data-command="settings.open"]')?.focus?.();
  });
  sync();
}
