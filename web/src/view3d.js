// FR-009 2D/3D 切替・FR-010 ダイナミックカメラのプレゼンテーション。
// ライブラリ・外部通信なし。3D は CSS 3D transforms（WebGL 判定 env.webgl が偽なら 2D で代替）。
// app.js の拡張点（modules）から組み込まれる。

import { SLOTS, parseAxes, buildCandidates, placeScenes, buildTicks } from './axes3d.js';

export const DWELL_MS = 8000; // PARAM-004
export const NARROW_PX = 640; // PARAM-006
const SPACING_Z = 180;

// FR-021: 視点（回転・拡大縮小・移動）。初期の視点は従来の固定カメラ（正面 300px 手前）。
export const INITIAL_VIEWPOINT = Object.freeze({ azimuth: 0, elevation: 0, distance: 300, panX: 0, panY: 0 });
export const VIEW_OPS = ['rotate-left', 'rotate-right', 'rotate-up', 'rotate-down', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'reset'];
const ROT_STEP = 10; const PAN_STEP = 40; const ZOOM_IN = 0.8; const ZOOM_OUT = 1.25;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export function applyViewOp(vp, op) {
  const n = { ...vp };
  switch (op) {
    case 'rotate-left': n.azimuth = clamp(vp.azimuth - ROT_STEP, -180, 180); break;
    case 'rotate-right': n.azimuth = clamp(vp.azimuth + ROT_STEP, -180, 180); break;
    case 'rotate-up': n.elevation = clamp(vp.elevation + ROT_STEP, -80, 80); break;
    case 'rotate-down': n.elevation = clamp(vp.elevation - ROT_STEP, -80, 80); break;
    case 'zoom-in': n.distance = clamp(Math.round(vp.distance * ZOOM_IN), 120, 1500); break;
    case 'zoom-out': n.distance = clamp(Math.round(vp.distance * ZOOM_OUT), 120, 1500); break;
    case 'pan-left': n.panX = clamp(vp.panX + PAN_STEP, -1200, 1200); break;
    case 'pan-right': n.panX = clamp(vp.panX - PAN_STEP, -1200, 1200); break;
    case 'pan-up': n.panY = clamp(vp.panY + PAN_STEP, -1200, 1200); break;
    case 'pan-down': n.panY = clamp(vp.panY - PAN_STEP, -1200, 1200); break;
    case 'reset': return { ...INITIAL_VIEWPOINT };
    default: return null;
  }
  return n;
}
const fmtKey = (k) => [k.ctrl && 'Ctrl', k.alt && 'Alt', k.shift && 'Shift', k.key.length === 1 ? k.key.toUpperCase() : k.key].filter(Boolean).join('+');

// シーンの 3D 配置（時系列順に奥へ並べ、左右に振る）。純関数。
export function layout3D(scenes) {
  return scenes.map((s, i) => ({
    sceneId: s.id,
    position: { x: Math.round(Math.sin(i * 1.1) * 220), y: (i % 2) * 70 - 35, z: -i * SPACING_Z },
  }));
}

// 2D の代替提示: 全シーン分の強調表示を付ける（SVG の g[data-scene-id]）。
function highlight2D(host, sceneId) {
  // NFR-PERF-003: 変わらない属性・スタイルは書かない（毎回の書き込みでスタイルの再計算を起こさない）
  for (const g of host.querySelectorAll('[data-scene-id]')) {
    if (g.getAttribute('data-scene-id') === sceneId) {
      g.setAttribute('data-presenting', 'true');
      g.style.filter = 'drop-shadow(0 0 10px #f5a623)';
      g.scrollIntoView?.({ block: 'center', inline: 'center' });
    } else if (g.hasAttribute?.('data-presenting') !== false || g.style.filter) {
      g.removeAttribute('data-presenting');
      if (g.style.filter) g.style.filter = '';
    }
  }
}

function paint3D(host, app, ctx, io) {
  const st = app.getState();
  const g = app.get3D();
  const doc = host.ownerDocument;
  const act = doc.activeElement;
  const focusKey = act && host.contains(act) ? (act.id ? `#${act.id}` : (act.dataset?.sceneId ? `[data-scene-id="${act.dataset.sceneId}"]` : null)) : null;
  host.textContent = '';
  const stage = doc.createElement('div');
  stage.className = 'scene3d-stage';
  stage.setAttribute('role', 'region');
  stage.setAttribute('aria-label', app.t('view3d.label'));
  const world = doc.createElement('div');
  world.className = 'scene3d-world';
  const tgt = g.nodes.find((n) => n.sceneId === g.camera.targetSceneId);
  const p = tgt ? tgt.position : { x: 0, y: 0, z: 0 };
  // カメラ: 対象シーンの正面 300px 手前へ。回転は対象ごとに少し振る（動きの軽減では省く）。
  const rot = g.camera.animated && tgt ? Math.round(-p.x / 20) : 0;
  const vp = g.viewpoint;
  // 位置の y は「大きいほど上」。CSS の y は下向きなので符号を反転して描く。
  world.style.transform = `translateZ(${vp.distance}px) rotateX(${vp.elevation}deg) rotateY(${rot + vp.azimuth}deg) translate3d(${-p.x + vp.panX}px, ${p.y + vp.panY}px, ${-p.z}px)`;
  // 手動の視点操作の変化は短く、プレゼンのカメラ移動は 1.2s。動きの軽減では常にアニメーションなし（FR-021 AC-111）。
  world.style.transition = !g.camera.animated ? 'none' : (io.manual ? 'transform 0.2s ease-out' : 'transform 1.2s ease-in-out');
  const t = app.t;
  for (const n of g.nodes) {
    const sc = st.scenes.find((s) => s.id === n.sceneId);
    if (!sc) continue;
    const card = doc.createElement('div');
    card.className = 'scene3d-card';
    card.dataset.sceneId = sc.id;
    card.tabIndex = 0;
    card.style.transform = `translate3d(${n.position.x}px, ${-n.position.y}px, ${n.position.z}px)`;
    if (sc.id === g.selectedSceneId) { card.classList.add('is-selected'); card.setAttribute('aria-current', 'true'); }
    if (sc.id === g.camera.targetSceneId && st.presentation.status !== 'idle') card.classList.add('is-presenting');
    const h = doc.createElement('h3'); h.textContent = sc.heading; card.append(h);
    const ul = doc.createElement('ul');
    for (const pt of sc.points) { const li = doc.createElement('li'); li.textContent = pt.text; ul.append(li); }
    card.append(ul);
    // FR-020 AC-105: 選んだ 3 軸での値・区分を文字でも示す（色・位置だけに頼らない）
    const vals = doc.createElement('p'); vals.className = 'scene3d-values';
    vals.textContent = SLOTS.map((k) => `${t(`axes3d.slot.${k}`)}: ${n.values[k]?.text ?? ''}`).join(' / ');
    card.append(vals);
    card.addEventListener('click', () => app.selectScene(sc.id));
    card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); app.selectScene(sc.id); } });
    world.append(card);
  }
  stage.append(world);
  io.bindStage(stage);
  host.append(stage);

  // ---- FR-020 評価軸の選択・名前・目盛り・各シーンの値（文字） ----
  const ax = app.getAxes3D();
  const sec = doc.createElement('section');
  sec.className = 'scene3d-axes'; sec.setAttribute('role', 'region'); sec.setAttribute('aria-label', t('axes3d.label'));
  const h = doc.createElement('h3'); h.textContent = t('axes3d.label'); sec.append(h);
  const row = doc.createElement('div'); row.className = 'scene3d-axes-row';
  for (const slot of SLOTS) {
    const wrap = doc.createElement('div'); wrap.className = 'scene3d-axis';
    const lab = doc.createElement('label'); lab.htmlFor = `axis3d-${slot}`; lab.textContent = t(`axes3d.slot.${slot}`);
    const sel = doc.createElement('select'); sel.id = `axis3d-${slot}`;
    for (const c of ax.candidates) {
      const o = doc.createElement('option'); o.value = c.id;
      const usedByOther = SLOTS.some((k) => k !== slot && ax.axes[k] === c.id);
      const why = c.id === ax.axes[slot] ? null : (usedByOther ? t('axes3d.reason.used') : c.reason);
      o.textContent = why ? `${c.label}（${t('axes3d.unavailable')}: ${why}）` : c.label;
      o.disabled = !!why; o.selected = c.id === ax.axes[slot];
      sel.append(o);
    }
    sel.addEventListener('change', () => { app.setAxis3D(slot, sel.value); });
    wrap.append(lab, sel);
    row.append(wrap);
  }
  sec.append(row);
  const ticks = doc.createElement('ul'); ticks.className = 'scene3d-ticks';
  for (const slot of SLOTS) {
    const li = doc.createElement('li');
    const c = ax.candidates.find((x) => x.id === ax.axes[slot]);
    li.textContent = `${t(`axes3d.slot.${slot}`)}: ${c?.label ?? ''} ｜ ${t('axes3d.ticks')}: ${ax.ticks[slot].map((k) => k.label).join(' / ')}`;
    ticks.append(li);
  }
  sec.append(ticks);
  const list = doc.createElement('ul'); list.className = 'scene3d-scene-values'; list.setAttribute('aria-label', t('axes3d.sceneValues'));
  for (const n of g.nodes) {
    const sc = st.scenes.find((s) => s.id === n.sceneId); if (!sc) continue;
    const li = doc.createElement('li'); if (sc.id === g.selectedSceneId) li.setAttribute('aria-current', 'true');
    li.textContent = `${sc.id === g.selectedSceneId ? '▶ ' : ''}${sc.heading} — ${SLOTS.map((k) => `${t(`axes3d.slot.${k}`)}: ${n.values[k]?.text ?? ''}`).join(' / ')}`;
    list.append(li);
  }
  sec.append(list);
  host.append(sec);

  // ---- FR-021 画面下部の操作説明（3D 表示の間、常に表示） ----
  const vc = app.getViewControls();
  if (vc.visible) {
    const help = doc.createElement('section');
    help.className = 'scene3d-help'; help.id = 'view3d-help'; help.setAttribute('role', vc.role); help.setAttribute('aria-label', t('view3d.help.title'));
    const hh = doc.createElement('h3'); hh.textContent = t('view3d.help.title'); help.append(hh);
    const ul2 = doc.createElement('ul');
    for (const o of vc.operations) {
      const li = doc.createElement('li');
      const b = doc.createElement('strong'); b.textContent = t(`view3d.op.${o.id}`);
      li.append(b, ` — ${t('view3d.dev.mouse')}: ${o.mouse} ／ ${t('view3d.dev.touch')}: ${o.touch} ／ ${t('view3d.dev.keyboard')}: ${o.keyboard}`);
      ul2.append(li);
    }
    help.append(ul2);
    const rb = doc.createElement('button'); rb.type = 'button'; rb.id = 'view3d-reset'; rb.className = 'btn btn-subtle';
    rb.textContent = t('view3d.op.reset'); rb.addEventListener('click', () => app.viewControl('reset', 'pointer'));
    help.append(rb);
    host.append(help);
  }
  if (focusKey) host.querySelector(focusKey)?.focus?.();
}

export function view3DModule(ctx) {
  const { state, env } = ctx;
  const api = ctx.api;
  const sched = ctx.options.scheduler ?? { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  let timer = null;

  ctx.i18n.addStrings({
    ja: {
      'msg.no3d': '3D 表示が使えない環境のため、2D 表示で代替します',
      'msg.noScenes': '提示できるシーンがありません',
      'view3d.label': '3D 表示（シーンの空間配置）',
      'presentation.status': 'プレゼンテーション',
      'axes3d.label': '3D の評価軸',
      'axes3d.slot.x': '横', 'axes3d.slot.y': '縦', 'axes3d.slot.z': '奥行き',
      'axes3d.axis.time': '時間（シーンの発生順）', 'axes3d.axis.pointCount': '要点の数', 'axes3d.axis.utterances': '発話量（文字数）',
      'axes3d.axis.emotion': '感情の強さ（感情語の数）', 'axes3d.axis.kindCount': '要点の種類ごとの数',
      'axes3d.axis.arrangeV': '整理の縦軸の区分', 'axes3d.axis.arrangeH': '整理の横軸の区分',
      'axes3d.kind.conclusion': '結論', 'axes3d.kind.issue': '課題', 'axes3d.kind.idea': 'アイデア', 'axes3d.kind.note': '補足',
      'axes3d.reason.same': '全シーンで値が同じため選べません', 'axes3d.reason.noAssign': '整理の割り当てがないため選べません',
      'axes3d.reason.used': '別の方向で選択中',
      'axes3d.unavailable': '選べません', 'axes3d.ticks': '目盛り・区分', 'axes3d.sceneValues': '各シーンの軸の値',
      'view3d.help.title': '3D 表示の操作方法',
      'view3d.op.rotate': '回転', 'view3d.op.zoom': '拡大縮小', 'view3d.op.pan': '移動', 'view3d.op.reset': '視点を初期に戻す',
      'view3d.dev.mouse': 'マウス', 'view3d.dev.touch': 'タッチ', 'view3d.dev.keyboard': 'キーボード',
      'view3d.mouse.rotate': 'ドラッグ', 'view3d.mouse.zoom': 'ホイール', 'view3d.mouse.pan': 'Shift を押しながらドラッグ', 'view3d.mouse.reset': '「視点を初期に戻す」ボタンをクリック',
      'view3d.touch.rotate': '1 本指でドラッグ', 'view3d.touch.zoom': '2 本指でピンチ', 'view3d.touch.pan': '2 本指でドラッグ', 'view3d.touch.reset': '「視点を初期に戻す」ボタンをタップ',
      'view3d.kb.rotate': '回転', 'view3d.kb.zoom': '拡大・縮小', 'view3d.kb.pan': '移動', 'view3d.kb.reset': '初期視点',
      'view3d.kb.dir': '左 / 右 / 上 / 下', 'view3d.kb.zoomdir': '拡大 / 縮小',
      'cmd.view.rotate-left': '視点を左へ回転', 'cmd.view.rotate-right': '視点を右へ回転', 'cmd.view.rotate-up': '視点を上へ回転', 'cmd.view.rotate-down': '視点を下へ回転',
      'cmd.view.zoom-in': '視点を拡大', 'cmd.view.zoom-out': '視点を縮小',
      'cmd.view.pan-left': '視点を左へ移動', 'cmd.view.pan-right': '視点を右へ移動', 'cmd.view.pan-up': '視点を上へ移動', 'cmd.view.pan-down': '視点を下へ移動',
      'cmd.view.reset': '視点を初期に戻す',
    },
    en: {
      'msg.no3d': '3D view is not available here, so the 2D view is used instead',
      'msg.noScenes': 'There are no scenes to present',
      'view3d.label': '3D view (spatial scene layout)',
      'presentation.status': 'Presentation',
      'axes3d.label': '3D evaluation axes',
      'axes3d.slot.x': 'Horizontal', 'axes3d.slot.y': 'Vertical', 'axes3d.slot.z': 'Depth',
      'axes3d.axis.time': 'Time (scene order)', 'axes3d.axis.pointCount': 'Number of points', 'axes3d.axis.utterances': 'Amount of speech (characters)',
      'axes3d.axis.emotion': 'Emotion intensity (emotion words)', 'axes3d.axis.kindCount': 'Points by kind',
      'axes3d.axis.arrangeV': 'Arranged vertical-axis section', 'axes3d.axis.arrangeH': 'Arranged horizontal-axis section',
      'axes3d.kind.conclusion': 'Conclusion', 'axes3d.kind.issue': 'Issue', 'axes3d.kind.idea': 'Idea', 'axes3d.kind.note': 'Note',
      'axes3d.reason.same': 'All scenes have the same value', 'axes3d.reason.noAssign': 'No arrangement assignments yet',
      'axes3d.reason.used': 'Already used for another direction',
      'axes3d.unavailable': 'unavailable', 'axes3d.ticks': 'Ticks / sections', 'axes3d.sceneValues': 'Axis values of each scene',
      'view3d.help.title': 'How to operate the 3D view',
      'view3d.op.rotate': 'Rotate', 'view3d.op.zoom': 'Zoom', 'view3d.op.pan': 'Pan', 'view3d.op.reset': 'Reset view',
      'view3d.dev.mouse': 'Mouse', 'view3d.dev.touch': 'Touch', 'view3d.dev.keyboard': 'Keyboard',
      'view3d.mouse.rotate': 'Drag', 'view3d.mouse.zoom': 'Scroll the wheel', 'view3d.mouse.pan': 'Shift + drag', 'view3d.mouse.reset': 'Click the "Reset view" button',
      'view3d.touch.rotate': 'Drag with one finger', 'view3d.touch.zoom': 'Pinch with two fingers', 'view3d.touch.pan': 'Drag with two fingers', 'view3d.touch.reset': 'Tap the "Reset view" button',
      'view3d.kb.rotate': 'Rotate', 'view3d.kb.zoom': 'Zoom in / out', 'view3d.kb.pan': 'Pan', 'view3d.kb.reset': 'Reset',
      'view3d.kb.dir': 'left / right / up / down', 'view3d.kb.zoomdir': 'in / out',
      'cmd.view.rotate-left': 'Rotate view left', 'cmd.view.rotate-right': 'Rotate view right', 'cmd.view.rotate-up': 'Rotate view up', 'cmd.view.rotate-down': 'Rotate view down',
      'cmd.view.zoom-in': 'Zoom view in', 'cmd.view.zoom-out': 'Zoom view out',
      'cmd.view.pan-left': 'Pan view left', 'cmd.view.pan-right': 'Pan view right', 'cmd.view.pan-up': 'Pan view up', 'cmd.view.pan-down': 'Pan view down',
      'cmd.view.reset': 'Reset view',
    },
  });

  const can3D = () => !!env.webgl;
  const use3D = () => state.viewMode === '3d' && can3D();

  // ---- FR-020 評価軸 ----
  state.axes3d = parseAxes(state.axes3d);
  const arrangement = () => (api.getArrangement ? api.getArrangement() : null);
  const candidates = () => buildCandidates(state.scenes, arrangement(), ctx.t);
  api.getAxes3D = () => {
    const cands = candidates();
    const axes = { ...state.axes3d };
    return {
      axes,
      candidates: cands.map(({ id, label, available, reason }) => ({ id, label, available, reason })),
      ticks: buildTicks(axes, cands),
    };
  };
  api.setAxis3D = (slot, id) => {
    if (!SLOTS.includes(slot)) return { ok: false, reason: 'invalid_slot' };
    const c = candidates().find((x) => x.id === id);
    if (!c) return { ok: false, reason: 'unknown_axis' };
    if (state.axes3d[slot] === id) return { ok: true };
    if (SLOTS.some((k) => k !== slot && state.axes3d[k] === id)) return { ok: false, reason: ctx.t('axes3d.reason.used') };
    if (!c.available) return { ok: false, reason: c.reason };
    ctx.change((s) => { s.axes3d[slot] = id; });
    return { ok: true };
  };

  // ---- FR-021 視点と操作説明 ----
  state.viewpoint = { ...INITIAL_VIEWPOINT };
  let manualView = false;
  const presenting = () => state.presentation.status === 'playing';
  api.getViewpoint = () => ({ ...state.viewpoint });
  api.viewControl = (op, source = 'pointer') => {
    if (!VIEW_OPS.includes(op) || (source !== 'pointer' && source !== 'keyboard')) return { ok: false, reason: 'invalid' };
    if (!use3D()) return { ok: false, reason: 'not_3d' };
    if (presenting()) return { ok: false, reason: 'presenting' }; // 自動カメラの再生中は手動操作なし（一時停止・停止中は可）
    manualView = true;
    ctx.change((s) => { s.viewpoint = applyViewOp(s.viewpoint, op); });
    return { ok: true };
  };
  const keyOf = (op) => { const k = api.keymap?.find((e) => e.command === `view.${op}`); return k ? fmtKey(k) : ''; };
  api.getViewControls = () => {
    const t = ctx.t;
    const kb = {
      rotate: `${t('view3d.kb.rotate')} (${t('view3d.kb.dir')}): ${['rotate-left', 'rotate-right', 'rotate-up', 'rotate-down'].map(keyOf).join(' / ')}`,
      zoom: `${t('view3d.kb.zoom')} (${t('view3d.kb.zoomdir')}): ${['zoom-in', 'zoom-out'].map(keyOf).join(' / ')}`,
      pan: `${t('view3d.kb.pan')} (${t('view3d.kb.dir')}): ${['pan-left', 'pan-right', 'pan-up', 'pan-down'].map(keyOf).join(' / ')}`,
      reset: `${t('view3d.kb.reset')}: ${keyOf('reset')}`,
    };
    return {
      visible: use3D(), role: 'region', region: 'bottom', wrap: 'wrap', hidesOthers: false,
      narrow: env.viewportWidth <= NARROW_PX,
      operations: ['rotate', 'zoom', 'pan', 'reset'].map((id) => ({
        id, mouse: t(`view3d.mouse.${id}`), touch: t(`view3d.touch.${id}`), keyboard: kb[id],
      })),
    };
  };
  for (const op of VIEW_OPS) ctx.registerCommand(`view.${op}`, () => { api.viewControl(op, 'keyboard'); });
  const CAS = { alt: true, shift: true, ctrl: true };
  for (const [op, key, mods] of [
    ['rotate-left', 'j', CAS], ['rotate-right', 'l', CAS], ['rotate-up', 'i', CAS], ['rotate-down', 'k', CAS],
    ['zoom-in', 'e', CAS], ['zoom-out', 'q', CAS], ['reset', 'r', CAS],
    ['pan-left', 'a', CAS], ['pan-right', 'd', CAS], ['pan-up', 'w', CAS], ['pan-down', 's', CAS],
  ]) ctx.registerKey({ key, ...mods, command: `view.${op}` });

  // ポインタ操作（ドラッグ=回転、Shift+ドラッグ=移動、ホイール=拡大縮小、ピンチ=拡大縮小、2 本指ドラッグ=移動）
  const STEP_PX = 14;
  function bindStage(stage) {
    const pts = new Map(); let acc = { x: 0, y: 0 }; let pinch = null;
    const spend = (axisVal, neg, pos, accKey) => {
      while (Math.abs(acc[accKey]) >= STEP_PX) { api.viewControl(acc[accKey] < 0 ? neg : pos, 'pointer'); acc[accKey] -= Math.sign(acc[accKey]) * STEP_PX; }
    };
    stage.addEventListener('wheel', (ev) => { ev.preventDefault?.(); api.viewControl(ev.deltaY < 0 ? 'zoom-in' : 'zoom-out', 'pointer'); }, { passive: false });
    stage.addEventListener('pointerdown', (ev) => { pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); acc = { x: 0, y: 0 }; pinch = null; });
    const up = (ev) => { pts.delete(ev.pointerId); pinch = null; };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('pointermove', (ev) => {
      const prev = pts.get(ev.pointerId); if (!prev) return;
      const cur = { x: ev.clientX, y: ev.clientY }; pts.set(ev.pointerId, cur);
      const dx = cur.x - prev.x; const dy = cur.y - prev.y;
      if (pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch != null && Math.abs(d - pinch) >= STEP_PX) { api.viewControl(d > pinch ? 'zoom-in' : 'zoom-out', 'pointer'); pinch = d; } else if (pinch == null) pinch = d;
        acc.x += dx / 2; acc.y += dy / 2;
        spend(0, 'pan-left', 'pan-right', 'x'); spend(0, 'pan-up', 'pan-down', 'y');
        return;
      }
      acc.x += dx; acc.y += dy;
      if (ev.shiftKey) { spend(0, 'pan-left', 'pan-right', 'x'); spend(0, 'pan-up', 'pan-down', 'y'); }
      else { spend(0, 'rotate-left', 'rotate-right', 'x'); spend(0, 'rotate-up', 'rotate-down', 'y'); }
    });
  }

  api.get3D = () => {
    const pr = state.presentation;
    const cands = candidates();
    return {
      nodes: placeScenes(state.scenes, state.axes3d, cands),
      axes: { ...state.axes3d },
      ticks: buildTicks(state.axes3d, cands),
      selectedSceneId: state.selectedSceneId,
      viewpoint: { ...state.viewpoint },
      camera: {
        targetSceneId: pr.status !== 'idle' && pr.sceneId ? pr.sceneId : state.selectedSceneId,
        animated: can3D() && !env.reducedMotion,
      },
    };
  };

  // 3D が使えない環境では、3D への切替時にその旨を表示する（FR-009 AC-021）。
  const baseSet = api.setViewMode;
  api.setViewMode = (mode) => {
    const ok = baseSet(mode);
    if (ok && mode === '3d' && !can3D()) ctx.change(() => ctx.setMessage('msg.no3d'));
    else if (ok && state.message?.key === 'msg.no3d') ctx.change(() => ctx.setMessage(null));
    return ok;
  };

  // ---- プレゼンテーション ----
  const clear = () => { if (timer != null) { sched.clearTimeout(timer); timer = null; } };
  const setPos = (i) => ctx.change((s) => {
    s.presentation.index = i; s.presentation.sceneId = s.scenes[i]?.id ?? null;
  });
  function arm() {
    clear();
    timer = sched.setTimeout(() => {
      timer = null;
      if (state.presentation.status !== 'playing') return;
      const i = state.presentation.index;
      if (i + 1 < state.scenes.length) { setPos(i + 1); arm(); } else { clear(); ctx.change((s) => { s.presentation.status = 'finished'; }); }
    }, DWELL_MS);
  }
  const active = () => state.presentation.status === 'playing' || state.presentation.status === 'paused';

  const cmd = {
    'presentation.start': () => {
      if (!state.scenes.length) { ctx.change(() => ctx.setMessage('msg.noScenes')); return; }
      clear();
      ctx.change((s) => { s.presentation.status = 'playing'; setMessage0(s); });
      setPos(0); arm();
    },
    'presentation.pause': () => { if (state.presentation.status !== 'playing') return; clear(); ctx.change((s) => { s.presentation.status = 'paused'; }); },
    'presentation.resume': () => { if (state.presentation.status !== 'paused') return; ctx.change((s) => { s.presentation.status = 'playing'; }); arm(); },
    'presentation.stop': () => {
      clear();
      ctx.change((s) => { s.presentation = { status: 'idle', index: null, sceneId: null }; });
    },
    'presentation.next': () => {
      if (!active()) return;
      const i = Math.min(state.presentation.index + 1, state.scenes.length - 1);
      setPos(i); if (state.presentation.status === 'playing') arm();
    },
    'presentation.prev': () => {
      if (!active()) return;
      setPos(Math.max(state.presentation.index - 1, 0)); if (state.presentation.status === 'playing') arm();
    },
  };
  function setMessage0(s) { if (s.message?.key === 'msg.noScenes') s.message = null; }
  for (const [name, fn] of Object.entries(cmd)) ctx.registerCommand(name, fn);

  // ---- 表示（図パネル）: 3D 表示のときだけ 3D を描き、それ以外は 2D の描画へ委ねる ----
  const base = api.getPanelRenderer('diagram');
  ctx.registerPanelRenderer('diagram', (host, c) => {
    if (use3D()) {
      host.dataset.diagramBuilt = ''; host.dataset.mode = '3d';
      paint3D(host, api, ctx, { manual: manualView, bindStage });
      manualView = false;
      return;
    }
    if (host.dataset.mode === '3d') { host.textContent = ''; host.dataset.mode = ''; }
    base?.(host, c);
    const pr = state.presentation;
    if (state.viewMode === '3d' && !can3D() && active()) highlight2D(host, pr.sceneId);
    else if (active() && state.viewMode === '2d') highlight2D(host, pr.sceneId);
    else highlight2D(host, null);
  });
}
