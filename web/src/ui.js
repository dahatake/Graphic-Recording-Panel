// DOM との結び付け（ブラウザ専用。app.js は DOM を知らない）。app の状態を描くだけで、状態は持たない。
import { PANEL_IDS, PANEL_COMMANDS } from './layout.js';

import { GROUPS, ICONS, PRIMARY, tooltipId } from './commandbar.js';

function icon(doc, command) {
  const t = doc.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 20 20" class="icon" aria-hidden="true" focusable="false"><path d="${ICONS[command] ?? ICONS['session.start']}"></path></svg>`;
  return t.content.firstChild;
}
const PRESSED = { 'lang.ja': (s) => s.lang === 'ja', 'lang.en': (s) => s.lang === 'en', 'view.2d': (s) => s.viewMode === '2d', 'view.3d': (s) => s.viewMode === '3d', 'view.timeline': (s) => s.displayMode !== 'arrange', 'view.arrange': (s) => s.displayMode === 'arrange' };

export function mountUI(app, doc = document) {
  const $ = (sel, root = doc) => root.querySelector(sel);
  const toolbar = $('#toolbar');
  const workspace = $('#workspace');
  const draft = $('#draft');
  let builtLang = null;
  const consentBox = $('#speech-consent');
  if (consentBox) consentBox.addEventListener('change', () => app.setSpeechConsent(consentBox.checked));

  const keyLabel = (name) => {
    const k = app.keymap.find((e) => e.command === name);
    return k ? `${k.ctrl ? 'Ctrl+' : ''}${k.alt ? 'Alt+' : ''}${k.shift ? 'Shift+' : ''}${k.key.length === 1 ? k.key.toUpperCase() : k.key}` : '';
  };

  function syncTooltip() {
    const cur = app.getTooltip();
    for (const t of toolbar.querySelectorAll('[role="tooltip"]')) t.hidden = !(cur && t.id === cur.id);
  }

  function buildToolbar() {
    toolbar.textContent = '';
    for (const [labelKey, names] of GROUPS) {
      const fs = doc.createElement('fieldset');
      fs.className = 'toolbar-group';
      const lg = doc.createElement('legend');
      lg.textContent = app.t(labelKey);
      fs.append(lg);
      for (const name of names) {
        const b = doc.createElement('button');
        b.type = 'button'; b.className = PRIMARY.has(name) ? 'btn btn-primary' : 'btn btn-subtle'; b.dataset.command = name;
        const lab = doc.createElement('span'); lab.className = 'btn-label'; lab.textContent = app.t(`cmd.${name}`);
        b.append(icon(doc, name), lab);
        const kl = keyLabel(name);
        const lbl = app.t(`cmd.${name}`);
        // NFR-UX-002: ツールチップ（role=tooltip）を aria-describedby で関連付ける。ホバー・フォーカスで表示
        const tip = doc.createElement('span');
        tip.className = 'tooltip'; tip.id = tooltipId(name); tip.setAttribute('role', 'tooltip'); tip.hidden = true;
        tip.textContent = kl ? `${app.t(`tooltip.${name}`)} (${kl})` : app.t(`tooltip.${name}`);
        b.setAttribute('aria-describedby', tip.id);
        if (kl) b.setAttribute('aria-keyshortcuts', kl);
        b.addEventListener('click', () => { void app.commands[name]?.(); });
        const on = (trig) => () => { app.showTooltip(name, trig); syncTooltip(); };
        const off = (trig) => () => { app.hideTooltip(name, trig); syncTooltip(); };
        b.addEventListener('mouseenter', on('hover')); b.addEventListener('mouseleave', off('leave'));
        b.addEventListener('focus', on('focus')); b.addEventListener('blur', off('blur'));
        b.addEventListener('keydown', (e) => { if (e.key === 'Escape') { app.hideTooltip(name, 'blur'); syncTooltip(); } });
        const wrap = doc.createElement('span'); wrap.className = 'tooltip-host';
        wrap.append(b, tip);
        fs.append(wrap);
      }
      toolbar.append(fs);
    }
    // 非表示のパネルを戻す操作
    const fs = doc.createElement('fieldset'); fs.className = 'toolbar-group'; fs.dataset.role = 'panel-show';
    toolbar.append(fs);
    syncTooltip();
  }

  function buildPanelMenus() {
    for (const id of PANEL_IDS) {
      const menu = $(`[data-menu="${id}"]`);
      menu.textContent = '';
      menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', app.t('panel.menu'));
      const add = (label, fn, extra = {}) => {
        const b = doc.createElement('button');
        b.type = 'button'; b.className = 'btn btn-sm'; b.textContent = label; b.title = label;
        Object.assign(b.dataset, extra);
        b.addEventListener('click', fn);
        menu.append(b);
        return b;
      };
      const sym = { 'move-left': '←', 'move-right': '→', 'move-up': '↑', 'move-down': '↓', grow: '＋', shrink: '－' };
      for (const c of PANEL_COMMANDS) {
        const b = add(`${sym[c]}`, () => app.panelCommand(id, c));
        b.setAttribute('aria-label', `${app.t(`panel.${id}`)}: ${app.t(`panel.cmd.${c}`)}`);
      }
      const max = add('', () => app.setPanelMaximized(id, !app.getLayout().panels[id].maximized), { act: 'max' });
      const focusBtn = add(app.t('panel.focus'), () => app.layoutCommand('focus', id), { act: 'focus' });
      focusBtn.setAttribute('aria-label', `${app.t(`panel.${id}`)}: ${app.t('panel.focus')}`);
      const hide = add(app.t('panel.hide'), () => app.setPanelVisible(id, false));
      hide.setAttribute('aria-label', `${app.t(`panel.${id}`)}: ${app.t('panel.hide')}`);
      max.dataset.panel = id;
    }
  }

  function applyStatic() {
    doc.documentElement.lang = app.getState().lang;
    doc.title = app.t('app.title');
    for (const el of doc.querySelectorAll('[data-i18n]')) el.textContent = app.t(el.dataset.i18n);
    for (const el of doc.querySelectorAll('[data-i18n-attr]')) {
      for (const pair of el.dataset.i18nAttr.split(';')) { const [a, k] = pair.split(':'); el.setAttribute(a, app.t(k)); }
    }
  }

  function render() {
    const st = app.getState();
    if (builtLang !== st.lang) { builtLang = st.lang; applyStatic(); buildToolbar(); buildPanelMenus(); }
    doc.documentElement.dataset.theme = app.getTheme();
    const cs = app.getCommandStatus();
    $('#session-status').textContent = cs.text;
    $('#session-status').dataset.session = cs.session;
    for (const b of toolbar.querySelectorAll('[data-command]')) {
      const f = PRESSED[b.dataset.command];
      if (f) b.setAttribute('aria-pressed', String(f(st)));
      b.disabled = typeof app.commands[b.dataset.command] !== 'function'
        || (b.dataset.command === 'speech.start' && !app.isSpeechAvailable());
    }
    const interim = $('#interim');
    if (interim) { const ss = app.getSpeechStatus(); interim.textContent = ss.state === 'unavailable' ? ss.text : ''; }
    const cu = app.getConsentUi();
    const box = $('#speech-consent');
    if (box) {
      $('#speech-consent-box').hidden = !cu.visible;
      box.checked = cu.checked;
      $('#speech-consent-label').textContent = cu.label;
      $('#speech-consent-notice').textContent = cu.notice;
      $('#speech-consent-state').textContent = cu.stateText;
    }
    // FR-013/FR-014: 認識文字列。過去を読んでいる間はスクロール位置を奪わない（AC-051）
    const tr = $('#transcript');
    if (tr) {
      const atBottom = tr.scrollHeight - tr.scrollTop - tr.clientHeight <= 8;
      const keep = tr.scrollTop;
      tr.innerHTML = app.renderTranscript();
      tr.scrollTop = atBottom ? tr.scrollHeight : keep;
    }
    if (doc.activeElement !== draft && draft.value !== st.input.draft) draft.value = st.input.draft;
    $('#message').textContent = st.message ? st.message.text : '';
    $('#outline').innerHTML = app.renderOutline();

    const layout = app.getLayout();
    const mode = app.getLayoutMode();
    workspace.dataset.mode = mode;
    workspace.dataset.kind = layout.kind;
    const kindEl = $('#layout-kind');
    if (kindEl) kindEl.textContent = `${app.t('layout.kind.label')}: ${app.t(`layout.kind.${layout.kind}`)}`;
    const showBar = $('[data-role="panel-show"]');
    showBar.textContent = '';
    for (const id of PANEL_IDS) {
      const p = layout.panels[id];
      const el = $(`.panel[data-panel="${id}"]`);
      el.hidden = !p.visible;
      el.classList.toggle('is-maximized', p.maximized);
      Object.assign(el.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px` });
      const max = $(`[data-act="max"][data-panel="${id}"]`);
      max.textContent = p.maximized ? '▣' : '□';
      const label = `${app.t(`panel.${id}`)}: ${app.t(p.maximized ? 'panel.restore' : 'panel.maximize')}`;
      max.title = label; max.setAttribute('aria-label', label);
      if (!p.visible) {
        const b = doc.createElement('button');
        b.type = 'button'; b.className = 'btn';
        b.textContent = `${app.t(`panel.${id}`)}: ${app.t('panel.show')}`;
        b.addEventListener('click', () => app.setPanelVisible(id, true));
        showBar.append(b);
      }
      const renderer = app.getPanelRenderer(id);
      if (renderer && id !== 'outline' && id !== 'input') renderer($(`#${id}`), app);
    }
    if (!app.getPanelRenderer('diagram')) $('#diagram').textContent = app.t('diagram.empty');
    showBar.hidden = !showBar.childElementCount;
    // 自由配置の作業領域は、はみ出したパネルの端まで広げる（スクロールで到達できる）。
    // タイル・フォーカス・最大化は、作業領域に固定する（FR-017）
    const fixed = layout.kind === 'tile' || layout.kind === 'focus' || layout.kind === 'maximized';
    if (mode === 'floating' && fixed) {
      workspace.style.minHeight = '';
      workspace.style.height = `${layout.workArea.h}px`;
    } else if (mode === 'floating') {
      workspace.style.height = '';
      const vis = PANEL_IDS.map((id) => layout.panels[id]).filter((p) => p.visible);
      workspace.style.minHeight = `${Math.max(0, ...vis.map((p) => p.y + p.h)) + 24}px`;
    } else { workspace.style.minHeight = ''; workspace.style.height = ''; }
    measureWorkArea();
  }

  // 作業領域の大きさを実際の表示領域に合わせる（タイル・フォーカスの再計算は app 側）
  function measureWorkArea() {
    if (app.getLayoutMode() !== 'floating') return;
    const w = Math.floor(workspace.clientWidth);
    const top = workspace.getBoundingClientRect?.().top ?? 0;
    const vh = (doc.defaultView?.innerHeight ?? 0) - Math.max(0, top) - 16;
    const h = Math.max(480, Math.floor(vh));
    if (w > 0) app.setWorkArea(w, h);
  }
  doc.defaultView?.addEventListener('resize', measureWorkArea);

  // ドラッグ移動・大きさ変更（同じ操作はボタンとキーボードでもできる: AC-027）
  function drag(el, id, kind) {
    el.addEventListener('pointerdown', (ev) => {
      if (app.getLayoutMode() !== 'floating' || ev.target.closest('button')) return;
      const p = app.getLayout().panels[id];
      const sx = ev.clientX; const sy = ev.clientY;
      el.setPointerCapture?.(ev.pointerId);
      const move = (e) => {
        const dx = e.clientX - sx; const dy = e.clientY - sy;
        if (kind === 'move') app.movePanel(id, { x: p.x + dx, y: p.y + dy });
        else app.resizePanel(id, { w: p.w + dx, h: p.h + dy });
      };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
    });
  }
  for (const id of PANEL_IDS) {
    const panel = $(`.panel[data-panel="${id}"]`);
    drag($('.panel-head', panel), id, 'move');
    const grip = doc.createElement('div'); grip.className = 'resize-grip'; grip.setAttribute('aria-hidden', 'true');
    panel.append(grip); drag(grip, id, 'resize');
  }

  $('#draft-form').addEventListener('submit', (e) => { e.preventDefault(); app.submitDraft(); });
  draft.addEventListener('input', () => app.setDraft(draft.value));
  // ファイル取込: 取り込めたときだけ選択を解除する（記録中でないときは選択を保つ: FR-002 AC-042）
  const fileInput = $('#import-file');
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const text = await f.text();
    const r = await app.importTextFile({ name: f.name, type: f.type, size: f.size, text });
    if (r.ok) fileInput.value = '';
  });
  app.on('ui:focusInput', () => draft.focus());
  doc.addEventListener('keydown', (e) => {
    const cmd = app.handleKey({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey });
    if (cmd) e.preventDefault();
  });
  app.subscribe(render);
  render();
  return { render };
}
