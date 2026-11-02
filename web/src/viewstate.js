// FR-108（AC-621〜623）: シーンの詳細（ポップアップ・ドリルスルー）を開く直前の画面の状態
// （絞り込み・スクロール位置・図の拡大率と中心）を記録し、閉じて戻るときに復元する。
// 画面の状態は端末内の一時の状態（メモリのみ）。セッションの保存・出力・外部への送信に含めず、再読込・初期化で破棄する。
import { clampZoom } from './diagram.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const nonNeg = (v) => Math.max(0, num(v, 0));

export const emptyViewState = () => ({ filter: { sceneId: null, text: '' }, scroll: { x: 0, y: 0 }, zoom: 1, center: { x: 0, y: 0 } });

// 入力を決まった形にそろえる（純関数）
export function normalizeViewState(v) {
  const o = v && typeof v === 'object' ? v : {};
  const f = o.filter && typeof o.filter === 'object' ? o.filter : {};
  return {
    filter: { sceneId: typeof f.sceneId === 'string' && f.sceneId ? f.sceneId : null, text: typeof f.text === 'string' ? f.text : '' },
    scroll: { x: nonNeg(o.scroll?.x), y: nonNeg(o.scroll?.y) },
    zoom: clampZoom(typeof o.zoom === 'number' && Number.isFinite(o.zoom) && o.zoom > 0 ? o.zoom : 1),
    center: { x: num(o.center?.x), y: num(o.center?.y) },
  };
}

// 復元の判定（純関数・決定的）。now = { sceneIds, maxScrollX?, maxScrollY? }
// 絞り込みの対象のシーンが消えていたら、絞り込みを解除し、スクロール位置を最も近い位置にして reason: 'filterSceneGone' を返す。
export function planRestore(recorded, now = {}) {
  const rec = normalizeViewState(recorded);
  const ids = new Set(Array.isArray(now.sceneIds) ? now.sceneIds : []);
  const gone = rec.filter.sceneId !== null && !ids.has(rec.filter.sceneId);
  const clamp = (v, max) => (typeof max === 'number' && Number.isFinite(max) ? Math.min(Math.max(0, max), v) : v);
  return {
    filter: gone ? { sceneId: null, text: '' } : rec.filter,
    scroll: { x: clamp(rec.scroll.x, now.maxScrollX), y: clamp(rec.scroll.y, now.maxScrollY) },
    zoom: rec.zoom,
    center: rec.center,
    reason: gone ? 'filterSceneGone' : null,
  };
}

export function viewStateModule(ctx) {
  const { api, state } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'msg.viewRestored': '詳細を開く前の画面の状態（絞り込み・スクロール位置・拡大）に戻しました',
      'msg.viewRestoredSceneGone': '絞り込みの対象のシーンがなくなったため、絞り込みを解除し、最も近いスクロール位置に戻しました',
    },
    en: {
      'msg.viewRestored': 'Restored the view from before opening the details (filter, scroll position, zoom)',
      'msg.viewRestoredSceneGone': 'The filtered scene no longer exists, so the       filter was cleared and the nearest scroll position was restored',
          },
  });
  let current = emptyViewState(); // 今の画面の状態（メモリのみ）
  let recorded = null; // 詳細を開く直前の記録（メモリのみ）

  api.getViewState = () => normalizeViewState({ ...current, ...(api.getDiagramView ? { zoom: api.getDiagramView().zoom, scroll: { x: api.getDiagramView().scrollX, y: api.getDiagramView().scrollY } } : {}) });
  api.setViewFilter = (f) => { current = { ...current, filter: normalizeViewState({ filter: f }).filter }; return { ok: true }; };
  api.setViewScroll = (x, y) => { api.setDiagramView?.({ scrollX: nonNeg(x), scrollY: nonNeg(y) }, { silent: true }); current = { ...current, scroll: { x: nonNeg(x), y: nonNeg(y) } }; return { ok: true }; };
  api.setViewZoom = (z) => { const zoom = clampZoom(typeof z === 'number' && Number.isFinite(z) && z > 0 ? z : 1); api.setDiagramView?.({ zoom }, { silent: true }); current = { ...current, zoom }; return { ok: true, zoom }; };
  api.setViewCenter = (c) => { current = { ...current, center: { x: num(c?.x), y: num(c?.y) } }; return { ok: true }; };
  api.recordViewState = () => { if (recorded) return false; recorded = api.getViewState(); return true; };
  api.hasRecordedViewState = () => recorded !== null;
  api.restoreViewState = (env = {}) => {
    if (!recorded) return { ok: false, reason: 'nothing_recorded' };
    const plan = planRestore(recorded, { sceneIds: state.scenes.map((s) => s.id), ...env });
    recorded = null;
    current = { filter: plan.filter, scroll: plan.scroll, zoom: plan.zoom, center: plan.center };
    api.setDiagramView?.({ zoom: plan.zoom, scrollX: plan.scroll.x, scrollY: plan.scroll.y });
    ctx.change(() => ctx.setMessage(plan.reason ? 'msg.viewRestoredSceneGone' : 'msg.viewRestored')); // 状態メッセージ（status）で読み上げる
    return { ok: true, reason: plan.reason, view: api.getViewState() };
  };

  ctx.on('popup:beforeOpen', () => { api.recordViewState(); });
  ctx.on('popup:closed', () => { if (recorded) api.restoreViewState(); });

  ctx.registerCommand('viewstate.restore', () => { if (recorded) api.restoreViewState(); });
  ctx.registerKey({ key: '?', ctrl: true, alt: true, shift: true, command: 'viewstate.restore' });

  // 端末内の一時の状態: 保存・出力には含めず（export なし）、初期化で破棄する
  ctx.registerPersist('viewState', { reset: () => { current = emptyViewState(); recorded = null; } });
}
