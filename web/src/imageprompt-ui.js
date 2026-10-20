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

// FR-078 AC-468・AC-469: コピー前の注意（role=alertdialog・モーダル）。簡易マスキングの選択（初期は適用）・コピー・取りやめ。
// 状態（開閉・適用の有無・現在の操作）は app が持ち、ここは描くだけ。キー（Tab・Shift+Tab・Space・Enter・Esc）は
// document の keydown → app.handleKey が扱い（注意の外へフォーカスを出さない）、ここは app の現在の操作へ DOM のフォーカスを合わせる。
// 閉じたら、フォーカスをコピーの操作のボタン（コマンドバーの prompt.copy）へ戻す。外枠は確認ダイアログと同じデザイン基盤。
export function mountPromptCopyNotice(app, doc = globalThis.document) {
  if (!doc) return;
  let el = null;
  let returnFocus = null;
  const byId = (id) => el?.querySelector(`[data-control="${id}"]`) ?? null;
  function sync() {
    const n = app.getPromptCopyNotice?.();
    if (!n) return;
    if (!n.open) {
      if (el) {
        el.remove(); el = null;
        const btn = doc.querySelector('[data-command="prompt.copy"]');
        const target = n.focus === 'button' && btn ? btn : returnFocus;
        returnFocus = null;
        if (target && doc.activeElement !== target) target.focus?.();
      }
      return;
    }
    if (!el) {
      returnFocus = doc.activeElement;
      el = doc.createElement('div'); el.className = 'dialog-backdrop';
      const box = doc.createElement('div'); box.className = 'dialog prompt-notice';
      box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'prompt-notice-title'); box.setAttribute('aria-describedby', 'prompt-notice-text');
      const h = doc.createElement('h2'); h.id = 'prompt-notice-title'; h.className = 'prompt-notice-title';
      const p = doc.createElement('p'); p.id = 'prompt-notice-text'; p.className = 'prompt-notice-text';
      const maskWrap = doc.createElement('p'); // 既存のデザイン基盤のクラス（.dialog p の余白・.settings-check のチェックボックスの並び）を使う
      const maskRow = doc.createElement('label'); maskRow.className = 'settings-check prompt-notice-mask'; maskWrap.append(maskRow);
      const cb = doc.createElement('input'); cb.type = 'checkbox'; cb.dataset.control = 'mask'; cb.setAttribute('aria-describedby', 'prompt-notice-masknote');
      cb.addEventListener('change', () => { app.setPromptCopyMask(cb.checked); });
      const cbText = doc.createElement('span');
      maskRow.append(cb, cbText);
      const note = doc.createElement('p'); note.id = 'prompt-notice-masknote'; note.className = 'settings-status prompt-notice-masknote';
      const row = doc.createElement('div'); row.className = 'dialog-actions';
      const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.className = 'btn'; cancel.dataset.control = 'cancel';
      cancel.addEventListener('click', () => { app.cancelPromptCopy(); });
      const copy = doc.createElement('button'); copy.type = 'button'; copy.className = 'btn btn-primary'; copy.dataset.control = 'copy';
      copy.addEventListener('click', () => { void app.confirmPromptCopy(); });
      // ボタンは app の controls の順（＝Tab の順序）に置き、画面の並びとフォーカスの順序をそろえる（WCAG 2.4.3）
      const buttons = { cancel, copy };
      for (const c of app.getPromptCopyNotice().controls) if (buttons[c.id]) row.append(buttons[c.id]);
      box.append(h, p, maskWrap, note, row);
      // クリック・支援技術でフォーカスが移ったら、app の現在の操作を合わせる
      box.addEventListener('focusin', (e) => { const id = e.target?.dataset?.control; if (id) app.setPromptCopyActive?.(id); });
      el.append(box); doc.body.append(el);
    }
    const box = el.querySelector('.prompt-notice');
    box.setAttribute('role', n.role);
    box.setAttribute('aria-live', n.live);
    el.querySelector('h2').textContent = n.label;
    el.querySelector('#prompt-notice-text').textContent = n.text;
    el.querySelector('#prompt-notice-masknote').textContent = n.maskNote;
    for (const c of n.controls) {
      const node = byId(c.id);
      if (!node) continue;
      if (c.kind === 'checkbox') { node.checked = !!c.checked; node.nextElementSibling.textContent = c.label; } else node.textContent = c.label;
    }
    const target = byId(n.active);
    if (target && doc.activeElement !== target) target.focus();
  }
  app.on('change', sync);
  sync();
}
