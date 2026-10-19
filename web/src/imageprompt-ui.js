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
