// FR-009 2D/3D 切替・FR-010 ダイナミックカメラのプレゼンテーション。
// ライブラリ・外部通信なし。3D は CSS 3D transforms（WebGL 判定 env.webgl が偽なら 2D で代替）。
// app.js の拡張点（modules）から組み込まれる。

export const DWELL_MS = 8000; // PARAM-004
const SPACING_Z = 180;

// シーンの 3D 配置（時系列順に奥へ並べ、左右に振る）。純関数。
export function layout3D(scenes) {
  return scenes.map((s, i) => ({
    sceneId: s.id,
    position: { x: Math.round(Math.sin(i * 1.1) * 220), y: (i % 2) * 70 - 35, z: -i * SPACING_Z },
  }));
}

// 2D の代替提示: 全シーン分の強調表示を付ける（SVG の g[data-scene-id]）。
function highlight2D(host, sceneId) {
  for (const g of host.querySelectorAll('[data-scene-id]')) {
    if (g.getAttribute('data-scene-id') === sceneId) {
      g.setAttribute('data-presenting', 'true');
      g.style.filter = 'drop-shadow(0 0 10px #f5a623)';
      g.scrollIntoView?.({ block: 'center', inline: 'center' });
    } else {
      g.removeAttribute('data-presenting');
      g.style.filter = '';
    }
  }
}

function paint3D(host, app, ctx) {
  const st = app.getState();
  const g = app.get3D();
  host.textContent = '';
  const doc = host.ownerDocument;
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
  world.style.transform = `translateZ(300px) rotateY(${rot}deg) translate3d(${-p.x}px, ${-p.y}px, ${-p.z}px)`;
  world.style.transition = g.camera.animated ? 'transform 1.2s ease-in-out' : 'none';
  for (const n of g.nodes) {
    const sc = st.scenes.find((s) => s.id === n.sceneId);
    if (!sc) continue;
    const card = doc.createElement('div');
    card.className = 'scene3d-card';
    card.dataset.sceneId = sc.id;
    card.tabIndex = 0;
    card.style.transform = `translate3d(${n.position.x}px, ${n.position.y}px, ${n.position.z}px)`;
    if (sc.id === g.selectedSceneId) { card.classList.add('is-selected'); card.setAttribute('aria-current', 'true'); }
    if (sc.id === g.camera.targetSceneId && st.presentation.status !== 'idle') card.classList.add('is-presenting');
    const h = doc.createElement('h3'); h.textContent = sc.heading; card.append(h);
    const ul = doc.createElement('ul');
    for (const pt of sc.points) { const li = doc.createElement('li'); li.textContent = pt.text; ul.append(li); }
    card.append(ul);
    card.addEventListener('click', () => app.selectScene(sc.id));
    card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); app.selectScene(sc.id); } });
    world.append(card);
  }
  stage.append(world);
  host.append(stage);
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
    },
    en: {
      'msg.no3d': '3D view is not available here, so the 2D view is used instead',
      'msg.noScenes': 'There are no scenes to present',
      'view3d.label': '3D view (spatial scene layout)',
      'presentation.status': 'Presentation',
    },
  });

  const can3D = () => !!env.webgl;
  const use3D = () => state.viewMode === '3d' && can3D();

  api.get3D = () => {
    const pr = state.presentation;
    return {
      nodes: layout3D(state.scenes),
      selectedSceneId: state.selectedSceneId,
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
      paint3D(host, api, ctx);
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
