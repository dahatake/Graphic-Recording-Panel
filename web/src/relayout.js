// FR-079 図の情報デザインによる自動再配置（何を・どこに）と、その時点（FR-080 の周期。既定 PARAM-084＝10 秒）。
// 契約: tests/system/CONTRACT-ARRANGE.md。DOM・外部通信に依存しない（AC-031）。時計は options.scheduler.setTimeout と options.now だけを使う。
// 再配置の木（infodesign.js）の「前回の再配置の結果（snap）」を持ち、その後に加わった要素は暫定の位置（読み順の末尾）に置く。
// 図の配置は「snap ＋ 現在の内容」の純粋関数なので、同じ発話列と同じ再配置の時点の列からは毎回同じ配置になる（AC-434）。
// 手修正（編集・削除・結合・分割、トピックの手修正、整理の割り当て）は状態そのものにあるので、再配置で戻らない（AC-432(a)）。
import { sceneTree, provisionalTree, topicChunks, GROUP_MAX, KIND_ORDER, TYPE_SCALE, leaves } from './infodesign.js';
import { detailGeometry, topicsGeometry } from './diagram.js';

export const INTERVAL_DEFAULT_SEC = 10; // PARAM-084
const TRANSITION_MS = 300; // 再配置の移動のアニメーションの長さ（動きを減らす設定では 0）

// 暫定のトピックの分け方: 前回の分け方を保ち、その後に加わったシーンは最後のまとまりの末尾へ
export function provisionalChunks(sceneIds, snapChunks) {
  if (!snapChunks) return null;
  const live = new Set(sceneIds); const seen = new Set();
  const out = snapChunks.map((c) => c.filter((id) => { if (!live.has(id)) return false; seen.add(id); return true; })).filter((c) => c.length);
  const added = sceneIds.filter((id) => !seen.has(id));
  if (added.length) { if (out.length) out[out.length - 1].push(...added); else out.push(added); }
  return out;
}

export function relayoutModule(ctx) {
  const { state, api, env } = ctx;
  const sched = ctx.options.scheduler ?? {
    setTimeout: (f, ms) => { const h = globalThis.setTimeout(f, ms); h?.unref?.(); return h; },
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
  let snap = null; // { scenes: Map(sceneId → 木), topics: Map(topicId → chunks|null), known: Set(id) }
  let count = 0;
  let lastTransition = null;

  const level = () => api.getDetailLevel?.() ?? 'detail';
  const topics = () => api.getTopics?.() ?? [];
  const ids = () => state.scenes.flatMap((s) => [s.id, ...s.points.map((p) => p.id)]);
  // 新しい要素（シーン・要点）が前回の再配置の後に加わったか
  const pending = () => (snap ? ids().some((id) => !snap.known.has(id)) : state.scenes.length > 0);

  function canonical() {
    return {
      scenes: new Map(state.scenes.map((s) => [s.id, sceneTree(s, GROUP_MAX)])),
      topics: new Map(topics().map((tp) => [tp.id, topicChunks(tp.sceneIds, GROUP_MAX)])),
      known: new Set(ids()),
    };
  }
  // 今の図の木（再配置の結果＋暫定の要素）
  function view() {
    const trees = new Map(state.scenes.map((s) => [s.id, provisionalTree(s, snap?.scenes.get(s.id) ?? null)]));
    const chunks = new Map(topics().map((tp) => [tp.id, snap ? provisionalChunks(tp.sceneIds, snap.topics.has(tp.id) ? snap.topics.get(tp.id) : null) : null]));
    return { trees, chunks };
  }

  // 再配置（外部へのリクエストを発しない。表示の状態・選択・入力中の文字列・詳細度・型は変えない。AC-439）
  function rearrange() {
    snap = canonical();
    count += 1;
    lastTransition = env.reducedMotion ? { animated: false, durationMs: 0 } : { animated: true, durationMs: TRANSITION_MS };
    ctx.emit('change', api);
  }
  // 復元したセッションは再配置済みとして始める（起動時の回数は数えない）
  if (state.scenes.length) snap = canonical();

  // ---- 時点（FR-080 の周期。周期の設定・会話の区切り・画面の復帰は FR-080 の項目が足す） ----
  ctx.i18n.addStrings({
    ja: { 'arrange.interval.sec': '{n} 秒ごと', 'arrange.interval.auto': '自動（会話の区切り）' },
    en: { 'arrange.interval.sec': 'Every {n} s', 'arrange.interval.auto': 'Auto (conversation breaks)' },
  });
  const intervalSec = INTERVAL_DEFAULT_SEC;
  api.getArrangeInterval = () => ({ sec: intervalSec, auto: intervalSec === 0, text: intervalSec === 0 ? ctx.t('arrange.interval.auto') : ctx.t('arrange.interval.sec').replace('{n}', String(intervalSec)) });
  const periodMs = () => intervalSec * 1000;
  let timer = null;
  const tick = () => { timer = sched.setTimeout(tick, periodMs()); if (pending()) rearrange(); };
  timer = sched.setTimeout(tick, periodMs());

  api.getArrangeView = () => view();
  api.getArrangeStatus = () => ({ count, pending: pending(), lastTransition: lastTransition ? { ...lastTransition } : null });
  // 再配置をすぐ行う（新しい要素がなければ何もしない＝冪等。AC-432(c)）。FR-080 の時点の判定から呼ぶ。
  api.rearrangeNow = () => { if (!pending()) return false; rearrange(); return true; };

  // ---- 図の要素の外枠（2D・時系列の表示。テキスト一覧・3D・ポップアップの位置は含まない） ----
  // 型の配置（タイトル欄 kind:'title'・まとまり kind:'group'・単位 kind:'unit'）と、その右のシーン・要点の詳細（scene・point・subgroup・topic）を含む。
  const overlay = () => {
    const info = api.getLayoutInfo?.();
    return info && info.applied && state.displayMode !== 'arrange' ? (api.getDiagramLayout?.() ?? null) : null;
  };
  function overlayElements(L, topicOf, tps) {
    const out = [];
    if (!L) return out;
    const known = snap?.known;
    const topicIds = new Set(tps.map((tp) => tp.id));
    const sceneOfPoint = new Map(state.scenes.flatMap((s) => s.points.map((p) => [p.id, s.id])));
    if (L.title?.visible && (L.titleRows ?? []).length) out.push({ id: 'title', kind: 'title', refIds: [], parentId: null, topicId: null, readIndex: 0, x: L.title.x, y: L.title.y, w: L.title.w, h: L.title.h, provisional: false });
    const groups = (L.groups ?? []).map((g, i) => ({ id: `layout-group:${g.id}`, kind: 'group', refIds: [g.id], parentId: null, topicId: topicIds.has(g.id) ? g.id : null, readIndex: i, x: g.frame.x, y: g.frame.y, w: g.frame.w, h: g.frame.h, provisional: false }));
    out.push(...groups);
    const inside = (u, g) => u.x >= g.x && u.y >= g.y && u.x + u.w <= g.x + g.w && u.y + u.h <= g.y + g.h;
    if (L.center) out.push({ id: 'unit:center', kind: 'unit', refIds: [], parentId: null, topicId: null, readIndex: 0, x: L.center.x, y: L.center.y, w: L.center.w, h: L.center.h, provisional: false });
    const topicOfUnit = (u) => {
      if (u.kind === 'topic') return u.id;
      if (u.kind === 'scene') return topicOf.get(u.id) ?? null;
      return topicOf.get(sceneOfPoint.get(u.id)) ?? null;
    };
    const counts = new Map();
    for (const u of L.units ?? []) {
      const parent = u.attachedTo ? `unit:${u.attachedTo}` : (groups.find((g) => inside(u, g))?.id ?? null);
      const n = counts.get(parent) ?? 0; counts.set(parent, n + 1);
      const refIds = u.refIds ?? [u.id];
      out.push({ id: `unit:${u.id}`, kind: 'unit', refIds: [...refIds], parentId: parent, topicId: topicOfUnit(u), readIndex: n, x: u.x, y: u.y, w: u.w, h: u.h, provisional: u.kind === 'topic' ? false : !known?.has(u.id) });
    }
    return out;
  }
  api.getDiagramElements = () => {
    if (!state.scenes.length) return [];
    const { trees, chunks } = view();
    const tps = topics();
    const topicOf = new Map(); for (const tp of tps) for (const id of tp.sceneIds) topicOf.set(id, tp.id);
    const L = overlay();
    const originX = api.getDiagramOriginX?.() ?? 0;
    const out = [];
    const lv = level();
    if (lv === 'detail') {
      const geo = detailGeometry(state.scenes, trees, state.lang, originX);
      geo.forEach((g, si) => {
        const sid = `scene:${g.sceneId}`; const topicId = topicOf.get(g.sceneId) ?? null;
        out.push({ id: sid, kind: 'scene', refIds: [g.sceneId], parentId: null, topicId, readIndex: si, x: g.x, y: g.y, w: g.w, h: g.h, provisional: g.provisional });
        const pointEl = (p) => ({ id: `point:${p.key}`, kind: 'point', refIds: [...p.refIds], parentId: p.parent ? `group:${p.parent}` : sid, topicId, readIndex: p.readIndex, x: p.x, y: p.y, w: p.w, h: p.h, provisional: p.provisional });
        const subs = new Map(g.subgroups.map((sg) => [sg.key, sg]));
        const tree = trees.get(g.sceneId);
        for (const n of tree.children) {
          if (n.type === 'subgroup') {
            const sg = subs.get(n.key);
            out.push({ id: `group:${sg.key}`, kind: 'subgroup', refIds: [...sg.refIds], parentId: sid, topicId, readIndex: sg.readIndex, x: sg.x, y: sg.y, w: sg.w, h: sg.h, provisional: false });
            for (const p of g.points.filter((q) => q.parent === n.key)) out.push(pointEl(p));
          } else out.push(pointEl(g.points.find((q) => q.key === n.key && !q.parent)));
        }
      });
      return [...out, ...overlayElements(L, topicOf, tps)];
    }
    const geo = topicsGeometry(tps, api.getTopicRelations?.() ?? [], state.scenes, { level: lv, chunks, t: ctx.t, originX });
    const known = snap?.known;
    geo.topics.forEach((g, ti) => {
      const tid = `topic:${g.topicId}`;
      const tp = tps[ti];
      out.push({ id: tid, kind: 'topic', refIds: [g.topicId], parentId: null, topicId: g.topicId, readIndex: ti, x: g.x, y: g.y, w: g.w, h: g.h, provisional: !known || tp.sceneIds.every((id) => !known.has(id)) });
      const row = (r) => ({ id: `scene:${r.sceneId}`, kind: 'scene', refIds: [r.sceneId], parentId: r.parent ? `group:${r.parent}` : tid, topicId: g.topicId, readIndex: r.readIndex, x: r.x, y: r.y, w: r.w, h: r.h, provisional: !known?.has(r.sceneId) });
      if (g.subs.length) {
        for (const sg of g.subs) {
          out.push({ id: `group:${sg.key}`, kind: 'subgroup', refIds: [...sg.refIds], parentId: tid, topicId: g.topicId, readIndex: sg.readIndex, x: sg.x, y: sg.y, w: sg.w, h: sg.h, provisional: false });
          for (const r of g.rows.filter((q) => q.parent === sg.key)) out.push(row(r));
        }
      } else for (const r of g.rows) out.push(row(r));
    });
    return [...out, ...overlayElements(L, topicOf, tps)];
  };

  // ---- まとめた要素（AC-429）: 選ぶとまとめた要点のすべてが対象。編集・削除はまとめた要点のすべてに適用 ----
  const elementById = (id) => api.getDiagramElements().find((e) => e.id === id) ?? null;
  const pointsOf = (e) => (e && e.kind === 'point' ? e.refIds : null);
  api.selectDiagramElement = (elementId) => {
    const e = elementById(elementId);
    if (!e) return { ok: false, reason: 'not_found' };
    const sceneId = e.kind === 'point'
      ? state.scenes.find((s) => s.points.some((p) => p.id === e.refIds[0]))?.id
      : (e.kind === 'scene' ? e.refIds[0] : null);
    if (sceneId) api.selectScene(sceneId);
    else if (e.kind === 'topic') api.selectTopic?.(e.refIds[0]);
    return { ok: true, pointIds: pointsOf(e) ?? [] };
  };
  api.editDiagramElement = (elementId, text) => {
    const refs = pointsOf(elementById(elementId));
    if (!refs) return { ok: false, reason: 'not_found' };
    let r = { ok: true };
    for (const id of refs) { r = api.editPoint(id, text); if (!r.ok) return r; }
    return r;
  };
  api.deleteDiagramElement = (elementId) => {
    const refs = pointsOf(elementById(elementId));
    if (!refs) return { ok: false, reason: 'not_found' };
    let r = { ok: true };
    for (const id of refs) { r = api.deletePoint(id); if (!r.ok) return r; }
    return r;
  };

  // FR-079: 図の情報デザインの記述（種類の順・上限・文字の大きさの階層）
  api.getInfoDesign = () => ({ kindOrder: [...KIND_ORDER], groupMax: GROUP_MAX, typeScale: { ...TYPE_SCALE } });
  api.getArrangedPointOrder = (sceneId) => { const tr = view().trees.get(sceneId); return tr ? leaves(tr).map((l) => [...l.refIds]) : null; };
}
