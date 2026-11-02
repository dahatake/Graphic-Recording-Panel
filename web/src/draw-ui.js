// FR-112 AC-635〜640 の画面部分（ブラウザ専用）。状態・操作は app（draw.js）が持ち、ここは描くだけ。
// - 図の操作の行（.diagram-tools）に、手描きの操作（モード・色・消しゴム・取り消し・やり直し・全消去・表示）を足す。色には名前の文字、状態は文字でも示す。
// - 描画のモードの間は、図の上のポインタ（ペン・マウス・タッチ）の操作を線として app.drawPointer に渡す（図の座標へ変換）。図の移動・クリックの動作は止める。
// - 全消去の確認は <dialog> の showModal()（背景の inert とフォーカスの閉じ込めをブラウザに任せる）。閉じるとフォーカスは開く前の要素へ戻す。動き・アニメーションは使わない。
export function mountDrawUI(app, doc = globalThis.document) {
  if (!doc?.body || !app.getDrawState) return null;
  const el = (tag, attrs = {}, text) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };
  const host = () => doc.querySelector('#diagram');
  const canvasOf = () => host()?.querySelector('.diagram-canvas') ?? null;

  // ---- 全消去の確認 ----
  const dlg = el('dialog', { id: 'draw-dialog', class: 'draw-dialog glossary-dialog', 'aria-labelledby': 'draw-dialog-title' });
  doc.body.append(dlg);
  let before = null; let dsig = null;
  function syncDialog() {
    const d = app.getDrawDialog();
    const sig = d ? JSON.stringify([d.text, d.countText]) : null;
    if (sig === dsig) return;
    dsig = sig;
    if (!d) { if (dlg.open) dlg.close(); if (before?.isConnected) before.focus?.(); before = null; return; }
    dlg.replaceChildren();
    dlg.append(el('h2', { id: 'draw-dialog-title' }, app.t('draw.title')), el('p', { 'data-id': 'draw.dialogCount' }, d.countText), el('p', {}, d.text));
    const actions = el('div', { class: 'glossary-actions' });
    for (const b of d.buttons) {
      const btn = el('button', { type: 'button', class: b.id === 'confirm' ? 'btn btn-primary' : 'btn', 'data-id': `draw.${b.id}` }, b.label);
      btn.addEventListener('click', () => { if (b.id === 'confirm') app.confirmDrawClear(); else app.cancelDrawClear(); });
      actions.append(btn);
    }
    dlg.append(actions);
    if (!dlg.open) { before = doc.activeElement; dlg.showModal?.(); }
    dlg.querySelector('[data-id="draw.cancel"]')?.focus?.(); // 破壊的な操作なので、最初のフォーカスはキャンセル
  }
  dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); app.cancelDrawClear(); }); // Esc

  // ---- 操作の行 ----
  let bar = null; let barSig = null;
  function ensureBar() {
    const tools = host()?.querySelector('.diagram-tools');
    if (!tools) return null;
    if (bar && bar.isConnected) return bar;
    bar = el('div', { class: 'draw-tools', role: 'group', 'data-id': 'draw.tools' });
    const mk = (id, onClick, pressed = false) => {
      const b = el('button', { type: 'button', class: 'btn btn-small', 'data-id': `draw.${id}` });
      if (pressed) b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', onClick);
      bar.append(b);
      return b;
    };
    mk('toggle', () => app.toggleDraw(), true);
    const sel = el('select', { 'data-id': 'draw.color', class: 'draw-color' });
    sel.addEventListener('change', () => app.setDrawColor(sel.value));
    const lab = el('label', { class: 'draw-color-label' }); lab.append(el('span', { 'data-id': 'draw.colorLabel' }), sel);
    bar.append(lab);
    mk('erase', () => app.toggleDrawEraser(), true);
    mk('undo', () => app.undoDraw());
    mk('redo', () => app.redoDraw());
    mk('clear', () => app.requestDrawClear());
    mk('visibility', () => app.toggleDrawVisibility(), true);
    bar.append(el('span', { class: 'draw-status', role: 'status', 'data-id': 'draw.status' }));
    tools.append(bar);
    barSig = null;
    return bar;
  }
  function syncBar() {
    const b = ensureBar();
    if (!b) return;
    const s = app.getDrawState(); const colors = app.getDrawColors();
    const sig = JSON.stringify([s.mode, s.tool, s.colorId, s.count, s.visible, s.canUndo, s.canRedo, s.hiddenText, app.getUiState?.().lang, colors.map((c) => c.name)]);
    if (sig !== barSig) {
      barSig = sig;
      const set = (id, text, pressed) => { const x = b.querySelector(`[data-id="draw.${id}"]`); x.textContent = text; if (pressed != null) x.setAttribute('aria-pressed', String(pressed)); return x; };
      set('toggle', app.t('draw.toggle'), s.mode); set('erase', app.t('draw.erase'), s.tool === 'eraser'); set('undo', app.t('draw.undo')); set('redo', app.t('draw.redo')); set('clear', app.t('draw.clear'));
      set('visibility', app.t('draw.visibility'), s.visible);
      b.querySelector('[data-id="draw.undo"]').disabled = !s.canUndo; b.querySelector('[data-id="draw.redo"]').disabled = !s.canRedo; b.querySelector('[data-id="draw.clear"]').disabled = s.count === 0;
      b.setAttribute('aria-label', app.t('draw.group')); b.querySelector('[data-id="draw.colorLabel"]').textContent = app.t('draw.color');
      const sel = b.querySelector('select');
      sel.replaceChildren(...colors.map((c) => { const o = el('option', { value: c.id }, c.name); if (c.id === s.colorId) o.selected = true; return o; }));
      sel.setAttribute('aria-label', `${app.t('draw.color')}: ${s.colorName}`);
      // 状態は文字でも示す（モード・道具・選んだ色の名前・線の件数・非表示）
      const status = b.querySelector('[data-id="draw.status"]');
      // AC-644: オフのときは「手描き」「表示」の 2 ボタンだけ（状態は文字で 1 語だけ添える）。オンのときだけ色・消しゴム・取り消し・やり直し・全消去・状態文
      for (const x of b.querySelectorAll('.draw-color-label, [data-id="draw.erase"], [data-id="draw.undo"], [data-id="draw.redo"], [data-id="draw.clear"]')) x.hidden = !s.mode;
      b.dataset.mode = s.mode ? 'on' : 'off';
      status.textContent = s.mode
        ? [s.modeText, s.toolText, `${app.t('draw.color')}: ${s.colorName}`, s.countText, s.hiddenText].filter(Boolean).join(' / ')
        : [s.modeText, s.hiddenText].filter(Boolean).join(' / ');
    }
  }
  function syncCanvas() {
    const c = canvasOf();
    if (!c) return;
    const svg = c.querySelector('svg');
    if (svg && !drawing) paintLive(svg); // キーボードで描いている線（ポインタの操作中は onMove が描く）
    const on = app.getDrawState().mode && app.getDrawState().visible;
    c.classList.toggle('is-drawing', on);
    c.classList.toggle('is-erasing', on && app.getDrawState().tool === 'eraser');
    if (on) c.setAttribute('data-draw-hint', app.t('draw.canvasHint')); else c.removeAttribute('data-draw-hint');
  }

  // ---- ポインタ（図の座標へ変換して渡す） ----
  const SVG_NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/'); // 名前空間の識別子（取得先ではない）
  let drawing = null; // { pointerId, svg, live }
  const toFigure = (svg, ev) => {
    const m = svg.getScreenCTM?.();
    if (!m) return null;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const live = (svg) => {
    let g = svg.querySelector('[data-role="draw-live"]');
    if (!g) { g = doc.createElementNS(SVG_NS, 'path'); g.setAttribute('data-role', 'draw-live'); g.setAttribute('fill', 'none'); g.setAttribute('stroke-linecap', 'round'); g.setAttribute('stroke-linejoin', 'round'); g.setAttribute('aria-hidden', 'true'); svg.append(g); }
    return g;
  };
  const paintLive = (svg) => {
    const cur = app.getDrawCurrent();
    const g = live(svg);
    if (!cur) { g.remove(); return; }
    g.setAttribute('stroke', cur.color); g.setAttribute('stroke-width', String(cur.width));
    const pts = cur.points;
    g.setAttribute('d', pts.length === 1 ? `M${pts[0].x} ${pts[0].y}l0 0` : `M${pts.map((p) => `${p.x} ${p.y}`).join('L')}`);
  };
  function onDown(ev) {
    const s = app.getDrawState();
    if (!s.mode) return;
    const canvas = canvasOf();
    if (!canvas || !canvas.contains(ev.target)) return;
    if (ev.button > 0) return;
    const svg = canvas.querySelector('svg');
    if (!svg) return;
    ev.preventDefault(); ev.stopImmediatePropagation(); // 図の移動（パン）を始めさせない
    const pt = toFigure(svg, ev);
    if (!pt) return;
    const r = app.drawPointer('down', pt);
    if (!r.ok) return;
    drawing = { pointerId: ev.pointerId, svg };
    canvas.setPointerCapture?.(ev.pointerId);
    paintLive(svg);
  }
  function onMove(ev) {
    if (!drawing || ev.pointerId !== drawing.pointerId) return;
    ev.preventDefault();
    // 連続した移動をまとめて取る（ペンの高頻度の点）
    const list = ev.getCoalescedEvents?.() ?? [];
    for (const e of list.length ? list : [ev]) { const pt = toFigure(drawing.svg, e); if (pt) app.drawPointer('move', pt); }
    paintLive(drawing.svg);
  }
  function onUp(ev) {
    if (!drawing || ev.pointerId !== drawing.pointerId) return;
    const d = drawing; drawing = null;
    ev.preventDefault();
    if (ev.type === 'pointercancel') { app.drawPointer('cancel'); d.svg.querySelector('[data-role="draw-live"]')?.remove(); return; }
    const pt = toFigure(d.svg, ev);
    d.svg.querySelector('[data-role="draw-live"]')?.remove();
    app.drawPointer('up', pt ?? undefined);
  }
  // 描画のモードの間は、図の上のクリック（要点の選択など）も止める（線を引いた直後の click が要点を選ばないように）
  function onClick(ev) {
    if (!app.getDrawState().mode) return;
    const canvas = canvasOf();
    if (canvas && canvas.contains(ev.target)) { ev.preventDefault(); ev.stopImmediatePropagation(); }
  }
  doc.addEventListener('pointerdown', onDown, true);
  doc.addEventListener('pointermove', onMove, true);
  doc.addEventListener('pointerup', onUp, true);
  doc.addEventListener('pointercancel', onUp, true);
  doc.addEventListener('click', onClick, true);

  function sync() { syncBar(); syncCanvas(); syncDialog(); }
  app.subscribe(sync);
  sync();
  return { sync };
}
