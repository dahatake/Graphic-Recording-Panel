// DOM との結び付け（ブラウザ専用。app.js は DOM を知らない）。app の状態を描くだけで、状態は持たない。
import { PANEL_IDS, PANEL_COMMANDS } from './layout.js';

const GROUPS = [
  ['toolbar.session', ['session.start', 'session.pause', 'session.resume', 'session.stop', 'session.nextScene', 'input.focus']],
  ['toolbar.save', ['save.png', 'save.svg', 'save.pdf']],
  ['toolbar.language', ['lang.ja', 'lang.en']],
  ['toolbar.view', ['view.2d', 'view.3d', 'theme.toggle']],
  ['toolbar.presentation', ['presentation.start', 'presentation.pause', 'presentation.resume', 'presentation.stop', 'presentation.prev', 'presentation.next']],
  ['toolbar.layout', ['layout.reset']],
];
const PRESSED = { 'lang.ja': (s) => s.lang === 'ja', 'lang.en': (s) => s.lang === 'en', 'view.2d': (s) => s.viewMode === '2d', 'view.3d': (s) => s.viewMode === '3d' };

export function mountUI(app, doc = document) {
  const $ = (sel, root = doc) => root.querySelector(sel);
  const toolbar = $('#toolbar');
  const workspace = $('#workspace');
  const draft = $('#draft');
  let builtLang = null;

  const keyLabel = (name) => {
    const k = app.keymap.find((e) => e.command === name);
    return k ? `${k.ctrl ? 'Ctrl+' : ''}${k.alt ? 'Alt+' : ''}${k.shift ? 'Shift+' : ''}${k.key.length === 1 ? k.key.toUpperCase() : k.key}` : '';
  };

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
        b.type = 'button'; b.className = 'btn'; b.dataset.command = name;
        b.textContent = app.t(`cmd.${name}`);
        const kl = keyLabel(name);
        if (kl) { b.title = kl; b.setAttribute('aria-keyshortcuts', kl); }
        b.addEventListener('click', () => { void app.commands[name]?.(); });
        fs.append(b);
      }
      toolbar.append(fs);
    }
    // 非表示のパネルを戻す操作
    const fs = doc.createElement('fieldset'); fs.className = 'toolbar-group'; fs.dataset.role = 'panel-show';
    toolbar.append(fs);
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
    $('#session-status').textContent = `${app.t('session.statusLabel')}: ${app.t(`session.state.${st.session}`)}`;
    for (const b of toolbar.querySelectorAll('[data-command]')) {
      const f = PRESSED[b.dataset.command];
      if (f) b.setAttribute('aria-pressed', String(f(st)));
      b.disabled = typeof app.commands[b.dataset.command] !== 'function';
    }
    if (doc.activeElement !== draft && draft.value !== st.input.draft) draft.value = st.input.draft;
    $('#message').textContent = st.message ? st.message.text : '';
    $('#outline').innerHTML = app.renderOutline();

    const layout = app.getLayout();
    const mode = app.getLayoutMode();
    workspace.dataset.mode = mode;
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
    // 自由配置の作業領域は、はみ出したパネルの端まで広げる（スクロールで到達できる）
    if (mode === 'floating') {
      const vis = PANEL_IDS.map((id) => layout.panels[id]).filter((p) => p.visible);
      workspace.style.minHeight = `${Math.max(0, ...vis.map((p) => p.y + p.h)) + 24}px`;
    } else workspace.style.minHeight = '';
  }

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
  app.on('ui:focusInput', () => draft.focus());
  doc.addEventListener('keydown', (e) => {
    const cmd = app.handleKey({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey });
    if (cmd) e.preventDefault();
  });
  app.subscribe(render);
  render();
  return { render };
}
