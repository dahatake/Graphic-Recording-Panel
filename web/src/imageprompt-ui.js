// FR-078 AC-423: クリップボードに書けなかったときの、プロンプトの文章の表示（選択して手でコピーする）。状態は app が持ち、ここは描くだけ。
// 外枠は確認ダイアログ（.dialog-backdrop・.dialog）と同じデザイン基盤を使う。Esc・［閉じる］で閉じる。
export function mountPromptFallback(app, doc = globalThis.document) {
  if (!doc) return;
  let el = null; let shownText = null;
  let returnFocus = null;
  const close = () => { app.closePromptFallback(); };
  function sync() {
    const f = app.getPromptFallback();
    if (!f) {
      if (el) { el.remove(); el = null; shownText = null; returnFocus?.focus?.(); returnFocus = null; }
      return;
    }
    if (el && shownText === f.text) {
      el.querySelector('.dialog').setAttribute('aria-label', f.label);
      el.querySelector('h2').textContent = f.label;
      el.querySelector('p').textContent = app.t('prompt.fallback.hint');
      el.querySelector('button').textContent = app.t('prompt.fallback.close');
      return;
    }
    el?.remove();
    returnFocus = returnFocus ?? doc.activeElement;
    shownText = f.text;
    el = doc.createElement('div'); el.className = 'dialog-backdrop';
    const box = doc.createElement('div'); box.className = 'dialog prompt-fallback';
    box.setAttribute('role', f.role); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', f.label);
    const h = doc.createElement('h2'); h.className = 'prompt-fallback-title'; h.textContent = f.label;
    const p = doc.createElement('p'); p.id = 'prompt-fallback-hint'; p.textContent = app.t('prompt.fallback.hint');
    const ta = doc.createElement('textarea'); ta.className = 'prompt-fallback-text'; ta.readOnly = true; ta.value = f.text;
    ta.setAttribute('aria-label', f.label); ta.setAttribute('aria-describedby', p.id); ta.rows = 12;
    const row = doc.createElement('div'); row.className = 'dialog-actions';
    const btn = doc.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-primary'; btn.textContent = app.t('prompt.fallback.close');
    btn.addEventListener('click', close);
    row.append(btn);
    box.append(h, p, ta, row);
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); close(); } });
    el.append(box); doc.body.append(el);
    ta.focus(); ta.select();
  }
  app.on('change', sync);
  sync();
}

// FR-078 AC-470・471・473（Q-027 A）: コピーの前の注意。状態（伏せ字の選択・フォーカスの位置）は app が持ち、ここは描くだけ。
// role="dialog"・aria-modal・aria-labelledby・aria-describedby。Tab・Shift+Tab・Esc は app.handleKey で注意の中を巡回・閉じる。
// Space・Enter はブラウザの既定の動作（チェックボックスの切り替え・ボタンのクリック）に任せ、その結果を app に渡す。
export function mountPromptNotice(app, doc = globalThis.document) {
  if (!doc) return;
  let el = null; let returnFocus = null; let lang = null;
  const q = (id) => el?.querySelector(`[data-notice="${id}"]`);
  // フォーカスの位置を app に伝える（コマンドバーのボタンは command:<command>。ほかは other）
  doc.addEventListener('focusin', (e) => {
    const t = e.target;
    const n = t?.closest?.('[data-notice]');
    if (n && el?.contains(n)) { app.setPromptNoticeFocus?.(n.dataset.notice); return; }
    const b = t?.closest?.('#toolbar [data-command]');
    if (b) app.focusCommand?.(b.dataset.command); else app.noteFocus?.('other');
  });
  function build(n) {
    el?.remove();
    el = doc.createElement('div'); el.className = 'dialog-backdrop';
    const box = doc.createElement('div'); box.className = 'dialog prompt-notice';
    box.setAttribute('role', n.role); box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'prompt-notice-title'); box.setAttribute('aria-describedby', 'prompt-notice-desc');
    const h = doc.createElement('h2'); h.id = 'prompt-notice-title'; h.className = 'prompt-notice-title'; h.textContent = n.label;
    const desc = doc.createElement('div'); desc.id = 'prompt-notice-desc';
    for (const s of n.statements) { const p = doc.createElement('p'); p.dataset.statement = s.key; p.textContent = s.text; desc.append(p); }
    const lab = doc.createElement('label'); lab.className = 'prompt-notice-mask';
    const cb = doc.createElement('input'); cb.type = 'checkbox'; cb.dataset.notice = 'mask'; cb.id = 'prompt-notice-mask';
    cb.addEventListener('change', () => { app.setPromptNoticeMask(cb.checked); });
    const span = doc.createElement('span'); span.textContent = n.mask.label;
    lab.append(cb, span);
    const err = doc.createElement('p'); err.className = 'prompt-notice-error'; err.setAttribute('role', 'alert');
    const row = doc.createElement('div'); row.className = 'dialog-actions';
    for (const b of n.buttons) {
      const btn = doc.createElement('button'); btn.type = 'button'; btn.dataset.notice = b.id; btn.textContent = b.label;
      btn.className = b.id === 'copy' ? 'btn btn-primary' : 'btn';
      btn.addEventListener('click', () => { void app.promptNoticeAction(b.id); });
      row.append(btn);
    }
    box.append(h, desc, lab, err, row);
    // Tab・Esc は app に任せ（注意の外へ出さない）、document の keydown へは渡さない
    box.addEventListener('keydown', (e) => {
      if ((e.key === 'Tab' || e.key === 'Escape') && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); e.stopPropagation();
        app.handleKey({ key: e.key, shiftKey: e.shiftKey, ctrlKey: false, altKey: false });
      } else if ((e.key === ' ' || e.key === 'Enter') && !e.ctrlKey && !e.altKey) {
        e.stopPropagation(); // 既定の動作（切り替え・クリック）に任せる
      }
    });
    el.append(box); doc.body.append(el);
    lang = app.getState().lang;
  }
  function sync() {
    const n = app.getPromptNotice?.();
    if (!n) {
      if (el) {
        el.remove(); el = null;
        if (!app.getPromptFallback?.() && returnFocus?.isConnected) returnFocus.focus?.(); // 開く前の位置へ戻す
        returnFocus = null;
      }
      return;
    }
    if (!el) { returnFocus = doc.activeElement; build(n); } else if (lang !== app.getState().lang) build(n);
    const cb = q('mask');
    cb.checked = n.mask.checked;
    const err = el.querySelector('.prompt-notice-error');
    err.textContent = n.error ?? ''; err.hidden = !n.error;
    const target = q(String(app.getFocus?.() ?? '').replace(/^notice:/, ''));
    if (target && doc.activeElement !== target) target.focus();
  }
  app.on('change', sync);
  sync();
}
