// NFR-UX-011 AC-660: リボン（コマンドバー）を縦 1 段に収め、幅が足りないときは Office のリボンのように、
// グループの順に右から「ラベルつき → ラベルを省いたアイコンのみ → そのグループ 1 つのドロップダウン」へ段階的に縮退する。
// 折り返して段を増やさない。縮退してもボタン・コマンド ID・ツールチップ・アクセシブルな名前は変えず（見た目だけ変える）、
// DOM 順（＝Tab の順）は視覚上の順と一致する。窓を広げると、縮退したグループは元の表示に戻る（毎回、全グループを元の表示から測り直す）。
// ドロップダウンは開閉ボタン（aria-expanded・aria-controls）の開示パターン。Esc・外側の操作で閉じ、Esc ではボタンに戻る。
export const FIT_STAGES = ['full', 'icons', 'menu'];
export const NARROW_MAX_WIDTH = 640; // PARAM-006: これ以下は縮退（積み重ね。AC-092・AC-464）に従い、1 段の縮退は行わない

// 純粋関数: fits(stages) が真になる最小の縮退を右から決める。まず右のグループから順にアイコンのみ、
// それでも収まらなければ右のグループから順にドロップダウンにする。stages は FIT_STAGES の添字の配列。
export function chooseStages(count, fits) {
  const stages = new Array(count).fill(0);
  if (!count || fits(stages)) return stages;
  for (let i = count - 1; i >= 0; i--) { stages[i] = 1; if (fits(stages)) return stages; }
  for (let i = count - 1; i >= 0; i--) { stages[i] = 2; if (fits(stages)) return stages; }
  return stages;
}

export function mountRibbonFit(bar, doc = document) {
  const win = doc.defaultView;
  const groups = () => [...bar.querySelectorAll(':scope > .toolbar-group[data-group]')];
  const apply = (gs, stages) => gs.forEach((g, i) => { const s = FIT_STAGES[stages[i]]; if (g.dataset.fit !== s) g.dataset.fit = s; });
  let openGroup = null;

  function close(restoreFocus = false) {
    const g = openGroup; openGroup = null;
    if (!g) return;
    const trg = g.querySelector(':scope > .toolbar-group-trigger');
    const items = g.querySelector(':scope > .toolbar-group-items');
    delete g.dataset.open;
    trg?.setAttribute('aria-expanded', 'false');
    if (items) { items.style.top = ''; items.style.left = ''; items.style.maxHeight = ''; }
    if (restoreFocus) trg?.focus();
  }
  function open(g) {
    close();
    const trg = g.querySelector(':scope > .toolbar-group-trigger');
    const items = g.querySelector(':scope > .toolbar-group-items');
    if (!trg || !items) return;
    openGroup = g;
    g.dataset.open = 'true';
    trg.setAttribute('aria-expanded', 'true');
    const r = trg.getBoundingClientRect();
    const vw = win?.innerWidth ?? 1024; const vh = win?.innerHeight ?? 768;
    items.style.top = `${Math.round(r.bottom + 2)}px`;
    items.style.maxHeight = `${Math.max(120, Math.floor(vh - r.bottom - 10))}px`;
    items.style.left = `${Math.round(r.left)}px`;
    const w = items.getBoundingClientRect().width;
    items.style.left = `${Math.max(8, Math.min(Math.round(r.left), Math.floor(vw - w - 8)))}px`;
    items.querySelector('button:not([disabled]), select, input')?.focus?.(); // メニューを開いたら先頭の項目へ（Esc でボタンに戻る）
  }

  function fit() {
    close();
    const gs = groups();
    if (!gs.length) return;
    const noFit = (win?.innerWidth ?? Infinity) <= NARROW_MAX_WIDTH || bar.dataset.collapsed === 'true';
    if (noFit) { apply(gs, gs.map(() => 0)); return; }
    const fits = (st) => { apply(gs, st); return bar.scrollWidth <= bar.clientWidth + 1; };
    apply(gs, chooseStages(gs.length, fits));
  }

  bar.addEventListener('click', (e) => {
    const trg = e.target.closest?.('.toolbar-group-trigger');
    if (trg && bar.contains(trg)) { const g = trg.closest('.toolbar-group'); if (openGroup === g) close(); else open(g); return; }
    // メニューの中のボタンを押したら閉じる（値を入れる部品の操作では閉じない）
    const btn = e.target.closest?.('.toolbar-group-items button[data-command]');
    if (btn && openGroup) close();
  });
  bar.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openGroup) { e.preventDefault(); close(true); } });
  doc.addEventListener('pointerdown', (e) => { if (openGroup && !openGroup.contains(e.target)) close(); });
  bar.addEventListener('focusin', (e) => { if (openGroup && !openGroup.contains(e.target)) close(); });
  doc.addEventListener('focusin', (e) => { if (openGroup && !bar.contains(e.target)) close(); });

  let lastW = -1; let lastCollapsed = null;
  const refit = () => { lastW = bar.clientWidth; lastCollapsed = bar.dataset.collapsed; fit(); };
  win?.addEventListener('resize', refit);
  const RO = win?.ResizeObserver;
  if (RO) {
    // 幅・折りたたみの状態が変わったときだけ測り直す（縮退による高さの変化では測り直さない）
    new RO(() => { if (bar.clientWidth !== lastW || bar.dataset.collapsed !== lastCollapsed) refit(); }).observe(bar);
  }
  // 折りたたみ（data-collapsed）が変わったときも測り直す
  const MO = win?.MutationObserver;
  if (MO) new MO(() => { if (bar.dataset.collapsed !== lastCollapsed) refit(); }).observe(bar, { attributes: true, attributeFilter: ['data-collapsed'] });
  return { refit, close };
}
