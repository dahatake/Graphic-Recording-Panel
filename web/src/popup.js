// FR-024: 図でオブジェクト（シーン）を選択したとき、そのシーンの見出しと要点をポップアップで描く。
// 全シーンのテキスト一覧（outline.js、NFR-A11Y-001）は従来どおり別に提供する（Q-004 推奨 A）。
// ポップアップの開閉は状態（保存対象）ではなく、選択中のシーンと閉じた後も変わらない。
import { escapeHtml } from './outline.js';
import { NARROW_PX } from './view3d.js';

const MAX_W = 360; const MARGIN = 8; const LINE_PX = 24; const CHROME_PX = 72;

export function renderPopupHtml(scene) {
  const pts = scene.points.map((p) => `<li data-point-id="${escapeHtml(p.id)}">${escapeHtml(p.text)}</li>`).join('');
  return `<h3>${escapeHtml(scene.heading)}</h3><ul>${pts}</ul>`;
}

export function renderTopicPopupHtml(topic, scenes) {
  const body = scenes.map((s) => `<h4>${escapeHtml(s.heading)}</h4><ul>${s.points.map((p) => `<li data-point-id="${escapeHtml(p.id)}">${escapeHtml(p.text)}</li>`).join('')}</ul>`).join('');
  return `<h3>${escapeHtml(topic.title)}</h3>${body}`;
}

// 画面端・狭い画面でも見切れない配置。入りきらないときは scrollable（スクロールで全体を確認できる）。
export function popupPlacement(scene, env) {
  const vw = Number(env.viewportWidth) > 0 ? Number(env.viewportWidth) : 1280;
  const vh = Number(env.viewportHeight) > 0 ? Number(env.viewportHeight) : 720;
  const narrow = vw <= NARROW_PX;
  const w = Math.max(120, Math.min(MAX_W, vw - MARGIN * 2));
  const x = narrow ? MARGIN : Math.max(MARGIN, vw - w - MARGIN); // 図の上の右端に寄せ、画面外へ出さない
  const maxHeight = Math.max(80, vh - MARGIN * 2);
  const lines = 1 + scene.points.reduce((n, p) => n + Math.max(1, Math.ceil(String(p.text).length * 14 / (w - 32))), 0);
  const content = lines * LINE_PX + CHROME_PX;
  const h = Math.min(content, maxHeight);
  return { x, y: MARGIN, w, h, maxHeight, scrollable: content > maxHeight };
}

export function popupModule(ctx) {
  const { api, state, t } = ctx;
  let open = false; let focused = false;
  let chosenId = null; // 利用者が明示的に選んだシーン（自動の初期選択では開かない）
  let topicId = null; // 2D の大項目で選んだトピック（FR-026 AC-137。シーンの選択は変えない）
  const notify = () => ctx.emit('change', api);
  const sel = () => state.scenes.find((s) => s.id === state.selectedSceneId) ?? null;
  const close = () => { if (!open && !focused) return; open = false; focused = false; topicId = null; notify(); };

  const baseSelect = api.selectScene;
  api.selectScene = (id) => {
    topicId = null;
    if (id === null || id === undefined) { chosenId = null; open = false; focused = false; ctx.change((s) => { s.selectedSceneId = null; }); return true; }
    if (!state.scenes.some((s) => s.id === id)) return false;
    open = true; focused = false; chosenId = id; baseSelect(id);
  };
  api.selectTopic = (id) => {
    if (!api.getTopics().some((tp) => tp.id === id)) return { ok: false, reason: 'not_found' };
    open = true; focused = false; topicId = id; notify();
    return { ok: true };
  };
  const topicPopup = () => {
    const tp = api.getTopics().find((x) => x.id === topicId);
    if (!tp) { topicId = null; open = false; focused = false; return null; }
    const scenes = tp.sceneIds.map((id) => state.scenes.find((s) => s.id === id)).filter(Boolean);
    const flat = { points: scenes.flatMap((s) => [{ text: s.heading }, ...s.points]) };
    return {
      open: true, topicId: tp.id, title: tp.title,
      scenes: scenes.map((s) => ({ id: s.id, heading: s.heading, points: s.points.map((p) => ({ id: p.id, text: p.text })) })),
      html: renderTopicPopupHtml(tp, scenes), role: 'dialog', label: `${t('popup.label')}: ${tp.title}`, focused, placement: popupPlacement(flat, ctx.env),
    };
  };
  api.getScenePopup = () => {
    if (open && topicId) return topicPopup();
    const sc = open ? sel() : null;
    if (!sc) return null;
    const label = `${t('popup.label')}: ${sc.heading}`;
    return {
      open: true, sceneId: sc.id, heading: sc.heading, points: sc.points.map((p) => ({ id: p.id, text: p.text })),
      html: renderPopupHtml(sc), role: 'dialog', label, focused,
      placement: popupPlacement(sc, ctx.env),
    };
  };
  api.popupOutside = () => close();
  ctx.on('change', () => { if (state.selectedSceneId !== chosenId) chosenId = null; if (open && !topicId && !sel()) { open = false; focused = false; } if (topicId && !api.getTopics().some((x) => x.id === topicId)) { topicId = null; open = false; focused = false; } });

  const move = (d) => {
    const n = state.scenes.length; if (!n) return;
    const i = state.scenes.findIndex((s) => s.id === state.selectedSceneId);
    const j = i < 0 ? (d > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, i + d));
    api.selectScene(state.scenes[j].id);
  };
  ctx.registerCommand('scene.next', () => move(1));
  ctx.registerCommand('scene.prev', () => move(-1));
  ctx.registerCommand('popup.open', () => { if (!sel() || open || chosenId !== state.selectedSceneId) return; open = true; notify(); });
  ctx.registerCommand('popup.focusContent', () => { if (!sel() || chosenId !== state.selectedSceneId) return; open = true; focused = true; notify(); });
  ctx.registerCommand('popup.close', close);
  for (const [key, command] of [['8', 'scene.next'], ['9', 'scene.prev'], ['5', 'popup.open'], ['6', 'popup.focusContent'], ['7', 'popup.close']]) {
    ctx.registerKey({ key, alt: true, shift: true, command });
  }

  // Esc（修飾キーなし）: 開いていれば閉じる。開いていなければ従来のキー処理。
  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    if (open && String(ev?.key) === 'Escape' && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) { close(); return 'popup.close'; }
    return baseKey(ev);
  };
}
