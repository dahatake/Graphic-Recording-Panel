// FR-101（AC-592〜595）・FR-102（AC-596〜598）: 図・テキスト一覧の要素のホバー／フォーカスでの簡易プレビューと、
// 地図（RPG風）の要素のキーボード操作。契約: tests/system/CONTRACT-P1.md §1。DOM に依存しない（描画は ui.js）。
// 時計は options.scheduler.setTimeout だけを使う。プレビューの開閉は表示だけの状態で、データの版数・選択・保存を変えない。
import { classifyPoint, kindLabelOf } from './diagram.js';

export const PREVIEW_MS = 300; // PARAM-139（ホバー・フォーカスからプレビューが出るまでのミリ秒）
export const PREVIEW_LEAD_MAX = 40; // 要点の先頭として載せる文字数
export const PREVIEW_TIP_ID = 'preview-tip'; // プレビューの要素の ID（aria-describedby の参照先）

export function previewModule(ctx) {
  const { api, state, t } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'preview.review': '要確認', 'preview.label': 'プレビュー',
    },
    en: {
      'preview.review': 'Needs review', 'preview.label': 'Preview',
    },
  });
  const sched = ctx.options.scheduler ?? { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  const SURFACES = ['diagram', 'list'];
  let hovered = null; let focused = null; // 現在ポインタが載っている・フォーカスがある要素
  let keepHover = false; // ポインタがプレビューの上にある（WCAG 1.4.13: 消えない）
  let timer = null;
  let open = null; // { target }
  const blocks = new Set(); // 入力欄のフォーカス・ドラッグ・スクロール中（AC-594）
  const same = (a, b) => !!a && !!b && a.kind === b.kind && a.id === b.id && a.surface === b.surface;
  const view = () => ctx.emitView();

  function resolve(target) {
    if (!target || !['scene', 'point'].includes(target.kind) || !SURFACES.includes(target.surface)) return null;
    if (target.kind === 'scene') { const scene = state.scenes.find((s) => s.id === target.id); return scene ? { scene, point: null } : null; }
    for (const scene of state.scenes) { const point = scene.points.find((p) => p.id === target.id); if (point) return { scene, point }; }
    return null;
  }
  const clean = (tg) => ({ kind: tg.kind, id: tg.id, surface: tg.surface });
  const stopTimer = () => { if (timer != null) { sched.clearTimeout(timer); timer = null; } };
  const hide = () => { stopTimer(); if (open) { open = null; view(); } };
  const popupOpen = () => !!api.getScenePopup?.();
  function show(target) {
    stopTimer();
    if (blocks.size || popupOpen() || !resolve(target)) return;
    if (open && same(open.target, target)) return;
    open = { target: clean(target) };
    view();
  }
  function schedule(target) {
    stopTimer();
    if (open && !same(open.target, target)) { open = null; view(); }
    if (blocks.size || (open && same(open.target, target))) return;
    timer = sched.setTimeout(() => { timer = null; const cur = focused ?? hovered; if (cur && same(cur, target)) show(target); }, PREVIEW_MS);
  }
  const refresh = () => { const cur = hovered ?? focused; if (cur) schedule(cur); else hide(); };

  api.hoverElement = (target) => { if (!resolve(target)) return { ok: false }; hovered = clean(target); schedule(hovered); return { ok: true }; };
  api.unhoverElement = (target) => {
    if (same(hovered, target)) hovered = null;
    if (keepHover) return { ok: true };
    if (!hovered && !focused) hide(); else if (hovered || focused) refresh();
    return { ok: true };
  };
  api.focusElement = (target) => { if (!resolve(target)) return { ok: false }; focused = clean(target); schedule(focused); return { ok: true }; };
  api.blurElement = (target) => {
    if (same(focused, target)) focused = null;
    if (!hovered && !focused) hide(); else refresh();
    return { ok: true };
  };
  api.getPreview = () => {
    if (!open) return null;
    const r = resolve(open.target);
    if (!r) return null;
    const first = r.point ?? r.scene.points[0] ?? null;
    const ids = r.point ? [r.point.id] : r.scene.points.map((p) => p.id);
    const text = first ? String(first.text) : '';
    return {
      open: true, target: { ...open.target }, heading: r.scene.heading,
      lead: [...text].slice(0, PREVIEW_LEAD_MAX).join(''),
      kindLabel: first ? kindLabelOf(classifyPoint(first), state.lang) : '',
      needsReview: !!api.getReviewMark?.(ids)?.needsReview,
      role: 'tooltip', describedBy: PREVIEW_TIP_ID,
    };
  };
  // プレビューの上へポインタが動いても消えない（1.4.13）。離れたら元の要素に載っていなければ消える。
  api.hoverPreview = () => { keepHover = true; return { ok: true }; };
  api.leavePreview = () => { keepHover = false; if (!hovered && !focused) hide(); else refresh(); return { ok: true }; };
  api.closePreview = () => { const was = !!open; hovered = null; keepHover = false; hide(); return { ok: was }; };
  // 入力欄のフォーカス・ドラッグ・スクロール中はプレビューを出さない（AC-594）。出ていれば消す。
  api.setPreviewBlock = (reason, on) => {
    if (on) { blocks.add(String(reason)); hide(); } else { blocks.delete(String(reason)); }
    return { ok: true };
  };
  api.activateElement = (target) => {
    const r = resolve(target);
    if (!r) return { ok: false };
    hovered = null; keepHover = false; hide();
    api.selectScene(r.scene.id); // 固定のポップアップ（FR-024）。要点はその要点のシーン
    return { ok: true };
  };
  // タッチ（ホバーがない入力）: タップ＝クリック
  api.tapElement = (target) => api.activateElement(target, 'click');

  ctx.on('change', () => {
    if (!open) return;
    if (!resolve(open.target) || popupOpen()) { stopTimer(); open = null; }
  });

  const elementOf = (target) => target;
  ctx.registerCommand('preview.show', () => { const cur = focused ?? hovered; if (cur) show(elementOf(cur)); });

  // ---- FR-102: 地図の要素（町・城＝シーン、地点＝要点）の巡回。順序はテキスト一覧の話順（シーン→その要点） ----
  let cursor = -1;
  const mapTargets = () => {
    const map = api.getRpgMap?.();
    if (!map) return [];
    return map.places.map((p) => ({ kind: p.kind === 'spot' ? 'point' : 'scene', id: p.refId, surface: 'diagram' }));
  };
  api.getMapCursor = () => { const l = mapTargets(); return cursor >= 0 && cursor < l.length ? { index: cursor, target: l[cursor] } : null; };
  const stepMap = (d) => {
    const l = mapTargets();
    if (!l.length) return { ok: false };
    cursor = cursor < 0 ? (d > 0 ? 0 : l.length - 1) : (cursor + d + l.length) % l.length;
    const tg = l[cursor];
    ctx.emit('map:focus', tg);
    api.focusElement(tg);
    return { ok: true, target: tg };
  };
  ctx.registerCommand('map.focusNext', () => stepMap(1));
  ctx.registerCommand('map.focusPrev', () => stepMap(-1));
  ctx.registerCommand('map.activate', () => { const c = api.getMapCursor(); if (c) api.activateElement(c.target, 'enter'); });
  const CAS = { ctrl: true, alt: true, shift: true };
  for (const [key, command] of [['Home', 'preview.show'], ['PageDown', 'map.focusNext'], ['PageUp', 'map.focusPrev'], ['End', 'map.activate']]) ctx.registerKey({ key, ...CAS, command });

  // Esc（修飾キーなし）の優先順位: 入力欄（文字入力）＞ポップアップ（AC-124）＞プレビュー（AC-593）＞地図の B ボタン（AC-223）。
  // 1 回の Esc は最も優先の 1 つだけを閉じる。この module は RPG の module より後に足し、RPG のキー処理より先に見る。
  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    if (open && String(ev?.key) === 'Escape' && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && ev.inTextInput !== true && !popupOpen()) {
      api.closePreview();
      return 'preview.close';
    }
    return baseKey(ev);
  };
}
