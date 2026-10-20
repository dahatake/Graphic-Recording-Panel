// DOM との結び付け（ブラウザ専用。app.js は DOM を知らない）。app の状態を描くだけで、状態は持たない。
import { PANEL_IDS, PANEL_COMMANDS, MIN_H } from './layout.js';

import { coalesceFrame } from './frame.js';
import { GROUPS, ICONS, PRIMARY, tooltipId, labelKey } from './commandbar.js';

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
    for (const [groupLabelKey, names, groupId] of GROUPS) {
      // NFR-UX-011 AC-460: 見出し（常に表示）と、グループ要素のアクセシブルな名前（aria-label）は同じ文言
      const fs = doc.createElement('div');
      fs.className = 'toolbar-group'; fs.setAttribute('role', 'group'); fs.dataset.group = groupId;
      const lg = doc.createElement('span');
      lg.className = 'toolbar-group-heading';
      lg.textContent = app.t(groupLabelKey);
      fs.setAttribute('aria-label', lg.textContent);
      fs.append(lg);
      for (const name of names) {
        const b = doc.createElement('button');
        b.type = 'button'; b.className = PRIMARY.has(name) ? 'btn btn-primary' : 'btn btn-subtle'; b.dataset.command = name;
        const lab = doc.createElement('span'); lab.className = 'btn-label'; lab.textContent = app.t(labelKey(name));
        b.append(icon(doc, name), lab);
        // FR-073 AC-388: 取り込みは、取り込めるファイルの説明を常に文字で見せる（アイコンだけに頼らない）
        if (name === 'import.file') {
          const d = doc.createElement('span'); d.className = 'btn-desc'; d.textContent = app.t('import.description'); b.append(d);
          d.id = 'import-desc'; b.className += ' btn-import';
        }
        // FR-077 AC-414: 画風のボタンは、ラベルの下に現在の画風の名前を常に出し、一覧（listbox）を開くことを示す
        if (name === 'drawStyle.pick') {
          const v = doc.createElement('span'); v.className = 'btn-value'; v.dataset.role = 'drawstyle-value'; b.append(v);
          b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-controls', 'drawstyle-list'); b.setAttribute('aria-expanded', 'false');
          b.className += ' btn-drawstyle';
        }
        const kl = keyLabel(name);
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
    const fs = doc.createElement('div'); fs.className = 'toolbar-group'; fs.dataset.role = 'panel-show';
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

  let dragging = false; // ドラッグ中は文字列・アウトラインの再構築を止め、位置の更新だけにする（終了時に 1 回描く）
  function render() {
    const st = app.getState();
    if (builtLang !== st.lang) { applyStatic(); buildToolbar(); buildPanelMenus(); builtLang = st.lang; }
    doc.documentElement.dataset.theme = app.getTheme();
    const cs = app.getCommandStatus();
    $('#session-status').textContent = cs.text;
    $('#session-status').dataset.session = cs.session;
    for (const b of toolbar.querySelectorAll('[data-command]')) {
      const f = PRESSED[b.dataset.command];
      if (f) b.setAttribute('aria-pressed', String(f(st)));
      b.disabled = typeof app.commands[b.dataset.command] !== 'function';
    }
    // FR-027 AC-139: 選択中のレイアウト型は、色だけでなく枠（先頭の型）・チェック印でも示す
    for (const it of app.getCommandBar().items) {
      if (!('pressed' in it)) continue;
      const b = toolbar.querySelector(`[data-command="${it.command}"]`);
      if (!b) continue;
      b.setAttribute('aria-pressed', String(it.pressed));
      if (it.selectedMark) b.dataset.selectedMark = it.selectedMark; else delete b.dataset.selectedMark;
      let mk = b.querySelector('.sel-mark');
      if (!mk) { mk = doc.createElement('span'); mk.className = 'sel-mark'; mk.setAttribute('aria-hidden', 'true'); b.append(mk); }
      mk.textContent = it.selectedMark ? '✓' : '';
    }
    // FR-077: 画風のボタンの現在値と、一覧の開閉
    for (const it of app.getCommandBar().items) {
      if (!('valueLabel' in it)) continue;
      const b = toolbar.querySelector(`[data-command="${it.command}"]`);
      if (!b) continue;
      const v = b.querySelector('.btn-value'); if (v) v.textContent = it.valueLabel;
      if ('expanded' in it) b.setAttribute('aria-expanded', String(!!it.expanded));
    }
    // FR-074 AC-391: 狭い画面ではパネルをタブにまとめ、見える位置（選択中のタブ）のパネルだけを出す
    const pres = app.getPanelPresentation();
    const tabsEl = $('#panel-tabs');
    if (tabsEl) {
      tabsEl.hidden = pres.mode !== 'tabs';
      tabsEl.textContent = '';
      if (pres.mode === 'tabs') {
        for (const id of PANEL_IDS) {
          if (!app.getLayout().panels[id].visible) continue;
          const tb = doc.createElement('button');
          tb.type = 'button'; tb.className = 'btn btn-subtle'; tb.setAttribute('role', 'tab'); tb.dataset.tab = id;
          tb.setAttribute('aria-selected', String(id === pres.activeTab)); tb.textContent = app.t(`panel.${id}`);
          tb.addEventListener('click', () => app.setActivePanelTab(id));
          tabsEl.append(tb);
        }
      }
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
    if (tr && !dragging) {
      const html = app.renderTranscript();
      if (tr._html !== html) {
        const atBottom = tr.scrollHeight - tr.scrollTop - tr.clientHeight <= 8;
        const keep = tr.scrollTop;
        tr.innerHTML = html; tr._html = html;
        tr.scrollTop = atBottom ? tr.scrollHeight : keep;
      }
    }
    if (doc.activeElement !== draft && draft.value !== st.input.draft) draft.value = st.input.draft;
    $('#message').textContent = st.message ? st.message.text : '';
    const is = app.getImportStatus?.(); const ise = $('#import-status');
    if (is && ise) {
      ise.textContent = is.text; ise.setAttribute('role', is.role); ise.setAttribute('aria-live', is.live);
      ise.dataset.state = is.state;
    }
    if (!dragging) { const o = $('#outline'); const html = app.renderOutline(); if (o._html !== html) { o.innerHTML = html; o._html = html; } }

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
      el.hidden = !p.visible || (pres.mode === 'tabs' && !pres.inView.includes(id));
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
    const h = Math.max(MIN_H, Math.floor(vh));
    if (w > 0) app.setWorkArea(w, h);
  }
  doc.defaultView?.addEventListener('resize', measureWorkArea);
  const ResizeObserver = doc.defaultView?.ResizeObserver;
  if (ResizeObserver) {
    const observer = new ResizeObserver(measureWorkArea);
    for (const el of [$('.app-header'), toolbar, $('.statusbar')]) observer.observe(el);
  }

  // ドラッグ移動・大きさ変更（同じ操作はボタンとキーボードでもできる: AC-027）
  function drag(el, id, kind) {
    el.addEventListener('pointerdown', (ev) => {
      if (app.getLayoutMode() !== 'floating' || ev.target.closest('button')) return;
      const p = app.getLayout().panels[id];
      const sx = ev.clientX; const sy = ev.clientY;
      el.setPointerCapture?.(ev.pointerId);
      dragging = true;
      const move = (e) => {
        const dx = e.clientX - sx; const dy = e.clientY - sy;
        if (kind === 'move') app.movePanel(id, { x: p.x + dx, y: p.y + dy });
        else app.resizePanel(id, { w: p.w + dx, h: p.h + dy });
      };
      const up = () => { dragging = false; renderSoon(); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
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
    let r;
    try { r = await app.importTextFile({ name: f.name, type: f.type, size: f.size, text }); } finally {
      // FR-023 AC-120: 成功・失敗どちらでも選択を解除し、同じファイルを選び直しても change が起きるようにする
      if (!r || r.reason !== 'busy') fileInput.value = '';
    }
  });
  app.on('ui:pickImportFile', () => fileInput.click());
  // FR-019: セッションファイルの選択（.txt の取込とは別の入力）
  const sessInput = doc.createElement('input');
  sessInput.type = 'file'; sessInput.accept = '.json,application/json'; sessInput.hidden = true; sessInput.id = 'session-file';
  sessInput.setAttribute('aria-hidden', 'true'); sessInput.tabIndex = -1;
  doc.body.append(sessInput);
  sessInput.addEventListener('change', async () => {
    const f = sessInput.files?.[0];
    if (!f) return;
    const text = await f.text();
    await app.loadSessionFile({ name: f.name, type: f.type, size: f.size, text });
    sessInput.value = '';
  });
  app.pickSessionFile = () => sessInput.click();

  // FR-018/FR-019: 確認ダイアログ（既定のフォーカスはキャンセル。Esc はキー処理でキャンセル）
  let dlgEl = null; let dlgKind = null;
  function syncDialog() {
    const d = app.getDialog();
    if (!d) { if (dlgEl) { dlgEl.remove(); dlgEl = null; dlgKind = null; } return; }
    if (dlgEl && dlgKind === d.kind) { dlgEl.querySelector('p').textContent = d.text; for (const b of d.buttons) { const el = dlgEl.querySelector(`[data-action="${b.id}"]`); if (el) el.textContent = b.label; } return; }
    dlgEl?.remove();
    dlgKind = d.kind;
    dlgEl = doc.createElement('div'); dlgEl.className = 'dialog-backdrop';
    const box = doc.createElement('div'); box.className = 'dialog'; box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-modal', 'true');
    const p = doc.createElement('p'); p.id = 'dialog-text'; p.textContent = d.text; box.setAttribute('aria-describedby', p.id);
    const row = doc.createElement('div'); row.className = 'dialog-actions';
    for (const b of d.buttons.slice().sort((x) => (x.id === 'cancel' ? -1 : 1))) {
      const el = doc.createElement('button'); el.type = 'button'; el.dataset.action = b.id; el.textContent = b.label;
      el.className = b.id === 'confirm' ? 'btn btn-primary' : 'btn';
      el.addEventListener('click', () => { void app.dialogAction(b.id); });
      row.append(el);
    }
    box.append(p, row); dlgEl.append(box); doc.body.append(dlgEl);
    row.querySelector(`[data-action="${d.defaultFocus}"]`)?.focus();
  }
  app.on('change', syncDialog);

  // FR-030: ［設定］画面（既定のレイアウト・描画スタイル）。状態は app が持ち、ここは描くだけ。
  const setEl = $('#settings-dialog');
  let setBuilt = null;
  function syncSettings() {
    if (!setEl) return;
    const d = app.getSettingsDialog();
    if (!d) { setEl.hidden = true; setBuilt = null; return; }
    const key = `${app.getState().lang}|${app.getDrawStyles().map((s) => s.id).join(',')}`; // 描画スタイルが登録されたら選択肢を作り直す（FR-077 AC-418）
    if (setBuilt !== key) {
      setBuilt = key; setEl.textContent = '';
      const o = app.getSettingsOptions();
      setEl.setAttribute('aria-label', d.label);
      const h = doc.createElement('h2'); h.textContent = d.label; h.id = 'settings-title';
      const form = doc.createElement('div'); form.className = 'settings-form';
      const row = (id, label, control) => { const w = doc.createElement('div'); w.className = 'settings-row'; w.dataset.field = id; const l = doc.createElement('label'); l.textContent = label; l.htmlFor = `settings-${id}`; control.id = `settings-${id}`; w.append(l, control); form.append(w); };
      const mode = doc.createElement('select');
      for (const m of o.modes) { const op = doc.createElement('option'); op.value = m.value; op.textContent = m.label; mode.append(op); }
      mode.addEventListener('change', () => app.setSettings({ layout: { mode: mode.value } }));
      row('layout.mode', d.fields[0].label, mode);
      const types = doc.createElement('div'); types.setAttribute('role', 'group'); types.setAttribute('aria-label', d.fields[1].label);
      for (const ty of o.types) {
        const lab = doc.createElement('label'); lab.className = 'settings-check';
        const cb = doc.createElement('input'); cb.type = 'checkbox'; cb.value = ty.value;
        cb.addEventListener('change', () => { const cur = app.getSettings().layout; const next = cb.checked ? [...cur.types, ty.value] : cur.types.filter((x) => x !== ty.value); app.setSettings({ layout: { mode: cur.mode, types: next } }); });
        lab.append(cb, ` ${ty.label}`); types.append(lab);
      }
      row('layout.types', d.fields[1].label, types);
      const style = doc.createElement('select');
      for (const s of o.styles) { const op = doc.createElement('option'); op.value = s.value; op.textContent = s.label; style.append(op); }
      style.addEventListener('change', () => app.setSettings({ drawStyle: style.value }));
      row('drawStyle', d.fields[2].label, style);
      // FR-051 AC-228: RPG風の音（端末ごとに保存。ミュート・音量）
      const mute = doc.createElement('input'); mute.type = 'checkbox';
      mute.addEventListener('change', () => app.setRpgMuted(mute.checked));
      row('rpg.mute', app.t('rpg.audio.mute'), mute);
      const vol = doc.createElement('input'); vol.type = 'range'; vol.min = '0'; vol.max = '100'; vol.step = '1';
      vol.addEventListener('input', () => app.setRpgVolume(Number(vol.value)));
      row('rpg.volume', app.t('rpg.audio.volume'), vol);
      // FR-068: LLM 連携の切替・状態・認証情報の有無（入力欄なし）・接続テスト。状態は色だけでなく文字とアイコンで示す
      const llmSw = doc.createElement('input'); llmSw.type = 'checkbox'; llmSw.setAttribute('role', 'switch');
      llmSw.addEventListener('click', (e) => { e.preventDefault(); void app.toggleLlm(); });
      row('llm.enabled', d.fields.find((f) => f.id === 'llm.enabled').label, llmSw);
      const llmSt = doc.createElement('p'); llmSt.id = 'settings-llm-status'; llmSt.setAttribute('role', 'status'); llmSt.className = 'settings-status';
      const llmCred = doc.createElement('p'); llmCred.id = 'settings-llm-credential'; llmCred.className = 'settings-status';
      const llmTest = doc.createElement('button'); llmTest.type = 'button'; llmTest.className = 'btn';
      llmTest.addEventListener('click', () => { void app.testLlmConnection(); });
      const llmTestRes = doc.createElement('p'); llmTestRes.id = 'settings-llm-test-result'; llmTestRes.setAttribute('role', 'status'); llmTestRes.className = 'settings-status';
      row('llm.test', d.fields.find((f) => f.id === 'llm.test').label, llmTest);
      form.append(llmSt, llmCred, llmTestRes);
      const close = doc.createElement('button'); close.type = 'button'; close.className = 'btn btn-primary'; close.textContent = o.closeLabel; close.dataset.action = 'settings-close';
      close.addEventListener('click', () => app.commands['settings.close']());
      setEl.append(h, form, close);
    }
    const vals = Object.fromEntries(d.fields.map((f) => [f.id, f.value]));
    setEl.querySelector('select#settings-layout\\.mode').value = vals['layout.mode'];
    setEl.querySelector('select#settings-drawStyle').value = vals.drawStyle;
    const au = app.getRpgAudio();
    setEl.querySelector('#settings-rpg\\.mute').checked = au.muted;
    setEl.querySelector('#settings-rpg\\.volume').value = String(au.volume);
    for (const cb of setEl.querySelectorAll('input[type=checkbox]:not([role=switch])')) cb.checked = vals['layout.types'].includes(cb.value);
    { // FR-068
      const f = Object.fromEntries(d.fields.map((x) => [x.id, x]));
      const sw = setEl.querySelector('#settings-llm\\.enabled'); sw.checked = !!f['llm.enabled'].value;
      setEl.querySelector('#settings-llm-status').textContent = `${f['llm.enabled'].status.icon} ${f['llm.enabled'].label}: ${f['llm.enabled'].status.text}`;
      setEl.querySelector('#settings-llm-credential').textContent = `${f['llm.credential'].status.icon} ${f['llm.credential'].label}: ${f['llm.credential'].status.text}`;
      const tb = setEl.querySelector('#settings-llm\\.test'); tb.textContent = f['llm.test'].label;
      const tr = f['llm.test'].status; setEl.querySelector('#settings-llm-test-result').textContent = tr.text ? `${tr.icon} ${tr.text}` : '';
    }
    const wasHidden = setEl.hidden; setEl.hidden = false;
    if (wasHidden) setEl.querySelector('select')?.focus();
  }
  app.on('change', syncSettings);

  // FR-077: 画風の一覧（role=listbox。ボタンの下に出す）。状態（開閉・候補・現在値）は app が持ち、ここは描くだけ。
  // キー（↑↓ Home End Enter Space Esc）は document の keydown → app.handleKey が扱う。項目のクリックは pickDrawStyle。
  let dsEl = null; let dsWasOpen = false;
  function syncStylePicker() {
    const p = app.getDrawStylePicker?.();
    if (!p) return;
    const btn = toolbar.querySelector('[data-command="drawStyle.pick"]');
    if (!p.open) {
      if (dsEl) { dsEl.remove(); dsEl = null; }
      if (dsWasOpen && p.focus === 'button' && btn && doc.activeElement !== btn) btn.focus();
      dsWasOpen = false;
      return;
    }
    if (!dsEl) {
      dsEl = doc.createElement('ul'); dsEl.id = 'drawstyle-list'; dsEl.className = 'drawstyle-list'; dsEl.tabIndex = -1;
      dsEl.addEventListener('click', (e) => { const li = e.target.closest?.('[data-style-id]'); if (li) app.pickDrawStyle(li.dataset.styleId); });
      dsEl.addEventListener('focusout', (e) => { if (!e.relatedTarget || (!dsEl?.contains(e.relatedTarget) && e.relatedTarget !== btn)) app.closeDrawStylePicker(null); });
      doc.body.append(dsEl);
    }
    dsEl.setAttribute('role', p.role); dsEl.setAttribute('aria-label', p.label);
    const vw = doc.documentElement.clientWidth || 1280; const vh = doc.defaultView?.innerHeight || doc.documentElement.clientHeight || 720;
    const r = btn?.getBoundingClientRect?.();
    // AC-417: 位置・高さの上限・上下どちらに開くかは app が画面の大きさとボタンの位置から決める（下に入りきらなければ上に開く）
    const view = app.getDrawStylePickerView({ viewportWidth: vw, viewportHeight: vh, anchor: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : undefined });
    dsEl.dataset.placement = view.placement;
    dsEl.style.cssText = `left:${view.left}px;top:${view.top}px;width:${view.width}px;max-height:${view.maxHeight}px;`;
    const key = JSON.stringify(p.options);
    if (dsEl.dataset.key !== key) {
      dsEl.dataset.key = key; dsEl.textContent = '';
      for (const o of p.options) {
        const li = doc.createElement('li'); li.id = `drawstyle-opt-${o.id}`; li.setAttribute('role', 'option'); li.dataset.styleId = o.id;
        li.setAttribute('aria-selected', String(o.selected)); li.className = 'drawstyle-option';
        if (o.selectedMark) li.dataset.selectedMark = o.selectedMark;
        const mk = doc.createElement('span'); mk.className = 'drawstyle-mark'; mk.setAttribute('aria-hidden', 'true'); mk.textContent = o.selected ? '✓' : '';
        const nm = doc.createElement('span'); nm.className = 'drawstyle-name'; nm.textContent = o.label;
        const ds = doc.createElement('span'); ds.className = 'drawstyle-desc'; ds.textContent = o.description;
        li.append(mk, nm, ds); dsEl.append(li);
      }
    }
    for (const li of dsEl.children) li.classList.toggle('is-active', li.dataset.styleId === p.activeId);
    if (p.activeId) { dsEl.setAttribute('aria-activedescendant', `drawstyle-opt-${p.activeId}`); dsEl.querySelector(`[data-style-id="${p.activeId}"]`)?.scrollIntoView?.({ block: 'nearest' }); }
    if (p.focus === 'list' && doc.activeElement !== dsEl) dsEl.focus();
    dsWasOpen = true;
  }
  app.on('change', syncStylePicker);
  for (const ev of ['resize', 'scroll']) doc.defaultView?.addEventListener?.(ev, () => { if (dsEl) syncStylePicker(); }, { passive: true, capture: true }); // 画面の大きさ・スクロールが変わったら置き直す
  doc.addEventListener('pointerdown', (e) => { if (dsEl && !e.target.closest?.('#drawstyle-list, [data-command="drawStyle.pick"]')) app.closeDrawStylePicker(null); });

  // FR-062: LLM 連携の同意の表示（送る項目の種類・送信先ホスト名・送らないもの）。同意するまで有効にならない
  let consentEl = null;
  function syncConsent() {
    const c = app.getLlmConsent();
    if (!c) { if (consentEl) { consentEl.remove(); consentEl = null; } return; }
    if (consentEl) return;
    consentEl = doc.createElement('div'); consentEl.className = 'dialog-backdrop';
    const box = doc.createElement('div'); box.className = 'dialog'; box.setAttribute('role', c.role); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', c.label);
    const h = doc.createElement('h2'); h.textContent = c.label;
    const list = (items) => { const ul = doc.createElement('ul'); for (const x of items) { const li = doc.createElement('li'); li.textContent = x; ul.append(li); } return ul; };
    const p1 = doc.createElement('p'); p1.textContent = app.t('llm.consent.sent'); const p2 = doc.createElement('p'); p2.textContent = `${app.t('llm.consent.to')}: ${c.host}`;
    const p3 = doc.createElement('p'); p3.textContent = app.t('llm.consent.notSentLabel'); const p4 = doc.createElement('p'); p4.textContent = c.note;
    const row = doc.createElement('div'); row.className = 'dialog-actions';
    for (const a of c.actions) {
      const el = doc.createElement('button'); el.type = 'button'; el.dataset.action = a.id; el.textContent = a.label; el.className = a.id === 'accept' ? 'btn btn-primary' : 'btn';
      el.addEventListener('click', () => { void app.answerLlmConsent(a.id === 'accept'); });
      row.append(el);
    }
    box.append(h, p1, list(c.kinds), p2, p3, list(c.notSent), p4, row); consentEl.append(box); doc.body.append(consentEl);
    row.querySelector('[data-action="decline"]')?.focus();
  }
  app.on('change', syncConsent);

  // FR-050: RPG風の仮想パッド（十字キー・A・B）とコマンドウィンドウ。状態は app が持ち、ここは描くだけ。
  const rpgEl = doc.createElement('div'); rpgEl.id = 'rpg-ui'; rpgEl.hidden = true;
  const padEl = doc.createElement('div'); padEl.className = 'rpg-pad'; padEl.setAttribute('role', 'group');
  const winEl = doc.createElement('div'); winEl.className = 'rpg-window'; winEl.hidden = true; winEl.setAttribute('role', 'dialog');
  const winText = doc.createElement('p'); winText.className = 'rpg-window-text'; winText.setAttribute('aria-hidden', 'true');
  const winFull = doc.createElement('p'); winFull.className = 'sr-only'; winFull.setAttribute('aria-live', 'polite');
  const winHint = doc.createElement('p'); winHint.className = 'rpg-window-hint';
  winEl.append(winText, winFull, winHint);
  rpgEl.append(winEl, padEl); doc.body.append(rpgEl);
  let padLang = null;
  function syncRpg() {
    const on = !!app.getRpgMap?.();
    rpgEl.hidden = !on;
    if (!on) return;
    const lang = app.getState().lang;
    if (padLang !== lang) {
      padLang = lang; padEl.textContent = '';
      padEl.setAttribute('aria-label', app.t('rpg.pad.label'));
      for (const b of app.getRpgPad().buttons) {
        const el = doc.createElement('button'); el.type = 'button'; el.className = `rpg-btn rpg-btn-${b.id}`; el.dataset.rpgButton = b.id;
        el.textContent = { up: '▲', down: '▼', left: '◀', right: '▶' }[b.id] ?? b.label; // 矢印の記号＋名前（色だけに頼らない）
        el.setAttribute('aria-label', b.label); el.title = b.label;
        el.style.width = `${b.width}px`; el.style.height = `${b.height}px`;
        el.addEventListener('click', () => { app.setRpgFocus(true); app.rpgPress(b.id); });
        padEl.append(el);
      }
    }
    const d = app.getRpgDialog();
    winEl.hidden = !d;
    if (d) {
      winEl.style.background = d.theme.bg; winEl.style.borderColor = d.theme.frame;
      winEl.setAttribute('aria-label', app.t('rpg.dialog.label'));
      winText.textContent = d.shown; winFull.textContent = d.sentences[d.index]; winHint.textContent = app.t('rpg.dialog.hint');
    }
  }
  app.on('change', syncRpg);
  // 地図にフォーカスがあるときだけ RPG のキーが効く（図・仮想パッドに入ると真、それ以外へ移ると偽）
  doc.addEventListener('focusin', (e) => { app.setRpgFocus?.(!!e.target.closest?.('#diagram, #rpg-ui')); });
  doc.addEventListener('pointerdown', (e) => { app.setRpgFocus?.(!!e.target.closest?.('#diagram, #rpg-ui')); });

  app.on('ui:focusInput', () => draft.focus());
  doc.addEventListener('keydown', (e) => {
    const t = e.target; const tag = String(t?.tagName ?? '').toUpperCase();
    const inTextInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable === true;
    const cmd = app.handleKey({ key: e.key, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, inTextInput });
    if (cmd) e.preventDefault();
  });
  // FR-024: オブジェクト選択のポップアップ（図の上。role=dialog・名前つき。Esc・外側の操作で閉じる）
  let popEl = null;
  function syncPopup() {
    const p = app.getScenePopup();
    if (!p) { if (popEl) { popEl.remove(); popEl = null; } return; }
    if (!popEl) {
      popEl = doc.createElement('div'); popEl.id = 'scene-popup'; popEl.className = 'scene-popup'; popEl.tabIndex = -1;
      doc.body.append(popEl);
    }
    popEl.setAttribute('role', p.role); popEl.setAttribute('aria-label', p.label); popEl.dataset.sceneId = p.sceneId ?? ''; popEl.dataset.topicId = p.topicId ?? '';
    popEl.style.cssText = `position:fixed;left:${p.placement.x}px;top:${p.placement.y}px;width:${p.placement.w}px;max-height:${p.placement.maxHeight}px;overflow:auto;`;
    if (popEl.dataset.html !== p.html) { popEl.innerHTML = p.html; popEl.dataset.html = p.html; }
    if (p.focused && doc.activeElement !== popEl) popEl.focus();
  }
  app.on('change', syncPopup);
  doc.addEventListener('pointerdown', (e) => { if (popEl && !e.target.closest?.('#scene-popup, [data-scene-id], [data-topic-id]')) app.popupOutside(); });

  // 変更が続いても再構築は 1 フレームに 1 回（NFR-PERF-002/003）
  const renderSoon = coalesceFrame(render, doc.defaultView?.requestAnimationFrame?.bind(doc.defaultView), doc.defaultView?.cancelAnimationFrame?.bind(doc.defaultView));
  app.subscribe(renderSoon);
  render();
  return { render, renderSoon, measureWorkArea };
}
