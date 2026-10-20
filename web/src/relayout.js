// FR-079 図の情報デザインによる自動再配置（何を・どこに）と、その時点（FR-080 の周期。既定 PARAM-084＝10 秒）。
// 契約: tests/system/CONTRACT-ARRANGE.md。DOM・外部通信に依存しない（AC-031）。時計は options.scheduler.setTimeout と options.now だけを使う。
// 再配置の木（infodesign.js）の「前回の再配置の結果（snap）」を持ち、その後に加わった要素は暫定の位置（読み順の末尾）に置く。
// 図の配置は「snap ＋ 現在の内容」の純粋関数なので、同じ発話列と同じ再配置の時点の列からは毎回同じ配置になる（AC-434）。
// 手修正（編集・削除・結合・分割、トピックの手修正、整理の割り当て）は状態そのものにあるので、再配置で戻らない（AC-432(a)）。
import { sceneTree, provisionalTree, topicChunks, GROUP_MAX, KIND_ORDER, TYPE_SCALE, leaves } from './infodesign.js';
import { detailGeometry, topicsGeometry } from './diagram.js';
import { readJson, writeJson } from './persist.js';

export const INTERVAL_DEFAULT_SEC = 10; // PARAM-084
export const INTERVAL_MAX_SEC = 300; // PARAM-085
export const SILENCE_SEC = 3; // PARAM-086（会話の区切りとみなす無音）
export const HOLD_MAX_SEC = 30; // PARAM-087（周期 0 で再配置を保留する上限）
export const INTERVAL_KEY = 'grp.arrangeInterval'; // 端末ごとの設定（初期化・セッションファイルの対象外。AC-436）
const FIELD_ID = 'arrange.interval';
const TRANSITION_MS = 300; // 再配置の移動のアニメーションの長さ（動きを減らす設定では 0）

export const isValidSec = (v) => Number.isInteger(v) && v >= 0 && v <= INTERVAL_MAX_SEC;
// 周期の入力（数値、または入力欄の文字列）の判定。AC-436: 空・整数でない・範囲外は受け付けない。
export function parseIntervalInput(value) {
  if (value == null) return { ok: false, reason: 'empty' };
  let n;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return { ok: false, reason: 'empty' };
    if (!/^[+-]?\d+$/.test(s)) return { ok: false, reason: 'not_integer' };
    n = Number(s);
  } else return { ok: false, reason: 'not_integer' };
  if (!Number.isInteger(n)) return { ok: false, reason: 'not_integer' };
  if (n < 0 || n > INTERVAL_MAX_SEC) return { ok: false, reason: 'range' };
  return { ok: true, sec: n };
}

// 文言（ja・en は同一のキー集合。ラベルは PARAM-011 以内: ja 全角 6、en 半角 12）
const ARRANGE_STRINGS = {
  ja: {
    'arrange.interval.sec': '{n} 秒ごと', 'arrange.interval.auto': '自動（会話の区切り）', 'arrange.interval.label': '再配置の周期', 'arrange.interval.unit': '秒（0 は自動）',
    'arrange.interval.changed': '再配置の周期を変更しました',
    'arrange.interval.invalid.empty': '再配置の周期を入力してください（0〜300 の整数）',
    'arrange.interval.invalid.not_integer': '再配置の周期は整数の秒数で入力してください（0〜300）',
    'arrange.interval.invalid.range': '再配置の周期は 0〜300 秒の範囲で入力してください',
  },
  en: {
    'arrange.interval.sec': 'Every {n} s', 'arrange.interval.auto': 'Auto (conversation breaks)', 'arrange.interval.label': 'Rearrange', 'arrange.interval.unit': 's (0 = auto)',
    'arrange.interval.changed': 'Rearrange interval changed',
    'arrange.interval.invalid.empty': 'Enter a rearrange interval (a whole number from 0 to 300)',
    'arrange.interval.invalid.not_integer': 'Enter the rearrange interval as a whole number of seconds (0 to 300)',
    'arrange.interval.invalid.range': 'The rearrange interval must be from 0 to 300 seconds',
  },
};

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

  // 再配置（外部へのリクエストを発しない。表示の状態・選択・入力中の文字列・詳細度・型・拡大率と表示位置・メッセージは変えない。AC-439・AC-440）
  let inRearrange = false;
  let onRearranged = () => {};
  function rearrange() {
    snap = canonical();
    count += 1;
    lastTransition = env.reducedMotion ? { animated: false, durationMs: 0 } : { animated: true, durationMs: TRANSITION_MS };
    onRearranged();
    inRearrange = true;
    try { ctx.emit('change', api); } finally { inRearrange = false; }
  }
  // 復元したセッションは再配置済みとして始める（起動時の回数は数えない）
  if (state.scenes.length) snap = canonical();

  // ---- 時点（FR-080）: 周期 P>0 は起点（起動・周期の変更）から P 秒ごと。P=0 は会話の区切り（AC-437）と保留の上限（AC-438）。
  // 時計は options.scheduler.setTimeout／clearTimeout と options.now だけを使う（テスト用の時計の注入。AC-435）。
  // 画面が非表示の間に到来した再配置は、復帰したときに行う（AC-435。PARAM-008 以内）。再配置そのものはメッセージを出さない（AC-440）。
  ctx.i18n.addStrings(ARRANGE_STRINGS);
  const t = ctx.t;
  const now = ctx.now ?? (() => 0);
  let intervalSec = INTERVAL_DEFAULT_SEC;
  { const raw = readJson(ctx.storage, INTERVAL_KEY); if (raw && isValidSec(raw.intervalSec)) intervalSec = raw.intervalSec; }
  const intervalText = () => (intervalSec === 0 ? t('arrange.interval.auto') : t('arrange.interval.sec').replace('{n}', String(intervalSec)));
  api.getArrangeInterval = () => ({ sec: intervalSec, auto: intervalSec === 0, text: intervalText() });

  const timers = { period: null, silence: null, hold: null, soon: null };
  const clear = (name) => { if (timers[name] != null) { sched.clearTimeout(timers[name]); timers[name] = null; } };
  const arm = (name, ms, fn) => { clear(name); timers[name] = sched.setTimeout(() => { timers[name] = null; fn(); }, Math.max(0, ms)); };

  // 画面の表示・非表示（options.visibility。なければ document）。speech.js の購読は保ったまま足す。
  const vis = ctx.options.visibility ?? null;
  const isHidden = () => Boolean(vis ? vis.hidden : globalThis.document?.hidden);
  let deferred = false;
  const request = () => {
    if (!pending()) return;
    if (isHidden()) { deferred = true; return; }
    rearrange();
  };
  const onVisibility = () => {
    if (isHidden() || !deferred) return;
    deferred = false;
    arm('soon', 0, request); // 復帰後すぐ（PARAM-008 以内）
  };
  if (vis) { const prev = vis.onchange; vis.onchange = (...a) => { if (typeof prev === 'function') prev(...a); onVisibility(); }; }
  else globalThis.document?.addEventListener?.('visibilitychange', onVisibility);

  // 周期（P>0）: 起点から P 秒ごとの時点で、前の時点以降に新しい要素が加わっていたときだけ再配置する
  const startPeriod = () => {
    clear('period');
    if (intervalSec <= 0) return;
    const periodMs = intervalSec * 1000;
    const tick = () => { arm('period', periodMs, tick); request(); };
    arm('period', periodMs, tick);
  };

  // 会話の区切り（P=0）: (a) 確定・暫定の結果が SILENCE_SEC 秒届かない、(b) シーンの確定、(c) 新しいトピックの発生。
  // 保留の上限: 前の再配置以降の最初の追加から HOLD_MAX_SEC 秒を超えて保留しない。
  let firstPendingAt = null;
  let lastInterim = '';
  let confirmedIds = new Set();
  let topicIds = new Set();
  const auto = () => intervalSec === 0;
  const snapshotBreaks = () => {
    confirmedIds = new Set(state.scenes.filter((s) => s.status === 'confirmed').map((s) => s.id));
    topicIds = new Set(topics().map((tp) => tp.id));
  };
  const armSilence = () => { if (auto()) arm('silence', SILENCE_SEC * 1000, request); };
  const armHold = () => {
    if (!auto() || firstPendingAt == null) return;
    arm('hold', firstPendingAt + HOLD_MAX_SEC * 1000 - now(), request);
  };
  onRearranged = () => { firstPendingAt = null; deferred = false; clear('silence'); clear('hold'); clear('soon'); };
  const startAuto = () => {
    clear('silence'); clear('hold'); clear('soon');
    if (!auto()) return;
    snapshotBreaks();
    if (pending()) { if (firstPendingAt == null) firstPendingAt = now(); armHold(); armSilence(); }
  };

  ctx.on('change', () => {
    if (inRearrange) return;
    const p = pending();
    if (!p) { firstPendingAt = null; clear('hold'); }
    else if (firstPendingAt == null) { firstPendingAt = now(); armHold(); }
    const im = String(state.speech?.interim ?? '');
    if (im && im !== lastInterim) armSilence(); // 暫定結果が届いている間（発話の途中）は無音の区切りにしない
    lastInterim = im;
    if (!auto()) return;
    const prevConfirmed = confirmedIds; const prevTopics = topicIds;
    snapshotBreaks();
    const sceneConfirmed = [...confirmedIds].some((id) => !prevConfirmed.has(id));
    const newTopic = [...topicIds].some((id) => !prevTopics.has(id));
    if (p && (sceneConfirmed || newTopic)) arm('soon', 0, request); // 状態の変更が終わってから再配置する
  });
  ctx.on('utterance', () => armSilence()); // 確定結果の受付から無音を数え直す

  // 周期の変更（設定画面・コマンドの検索・キーボード・マウス。AC-436・AC-440）
  let msgKey = null; let msgFn = null;
  const say = (key, fn) => { msgKey = key; msgFn = fn; ctx.change((s) => { s.message = { key, text: fn() }; }); };
  ctx.on('lang', () => { if (msgKey && state.message?.key === msgKey) ctx.change((s) => { s.message.text = msgFn(); }); });
  let draft = null; // 入力欄の入力中の文字列（確定前）
  api.setArrangeInterval = (value) => {
    const r = parseIntervalInput(value);
    if (!r.ok) {
      say(`arrange.interval.invalid.${r.reason}`, () => t(`arrange.interval.invalid.${r.reason}`));
      return { ok: false, reason: r.reason };
    }
    draft = null;
    if (r.sec !== intervalSec) {
      intervalSec = r.sec;
      writeJson(ctx.storage, INTERVAL_KEY, { intervalSec });
      startPeriod(); startAuto(); // 変更した時点から新しい周期で数え直す
    }
    say('arrange.interval.changed', () => `${t('arrange.interval.changed')}: ${intervalText()}`);
    return { ok: true };
  };
  const step = (dir) => {
    const next = intervalSec + (dir > 0 ? 1 : -1);
    if (!isValidSec(next)) { say('arrange.interval.invalid.range', () => t('arrange.interval.invalid.range')); return { ok: false, reason: 'range' }; }
    return api.setArrangeInterval(next);
  };

  // 設定画面の項目（既存の項目の後ろに足す）
  let focused = false;
  const dialogOpen = () => Boolean(baseDialog());
  const baseDialog = api.getSettingsDialog;
  const field = () => ({
    id: FIELD_ID, label: t('arrange.interval.label'), value: intervalSec, text: intervalText(), min: 0, max: INTERVAL_MAX_SEC, step: 1,
    role: 'spinbutton', focusable: true, input: { type: 'number', value: draft ?? String(intervalSec), inputmode: 'numeric' }, unit: t('arrange.interval.unit'),
  });
  api.getSettingsDialog = () => {
    const d = baseDialog();
    return d ? { ...d, fields: [...d.fields, field()], focusedField: focused ? FIELD_ID : (d.focusedField ?? null) } : null;
  };
  const baseView = api.getSettingsView;
  api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, { id: FIELD_ID, visible: true }] }; };
  const baseFocus = api.focusSettingsField;
  api.focusSettingsField = (id) => {
    if (id === FIELD_ID) { if (!dialogOpen()) return false; focused = true; ctx.emit('change', api); return true; }
    focused = false; return baseFocus ? baseFocus(id) : false;
  };
  api.setSettingsFieldDraft = (id, text) => {
    if (id !== FIELD_ID) return { ok: false, reason: 'not_found' };
    draft = String(text ?? ''); ctx.emit('change', api);
    return { ok: true };
  };
  api.settingsFieldStep = (id, dir) => (id === FIELD_ID ? step(dir) : { ok: false, reason: 'not_found' });
  ctx.on('change', () => { if (!dialogOpen()) { focused = false; draft = null; } });
  ctx.registerCommand('settings.arrangeInterval', () => {
    ctx.api.commands['settings.open']();
    api.focusSettingsField(FIELD_ID);
  });
  ctx.registerKey({ key: 'y', ctrl: true, alt: true, shift: true, command: 'settings.arrangeInterval' });
  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    const k = String(ev?.key);
    const plain = !ev?.ctrlKey && !ev?.altKey && !ev?.shiftKey;
    if (focused && dialogOpen() && plain) {
      if (k === 'Enter') { api.setArrangeInterval(draft ?? intervalSec); return 'settings.arrange.commit'; }
      if (k === 'ArrowUp' || k === 'ArrowDown') { step(k === 'ArrowUp' ? 1 : -1); return 'settings.arrange.step'; }
    }
    return baseKey(ev);
  };

  // 起動時から数える
  startPeriod(); startAuto();

  api.getArrangeView = () => view();
  api.getArrangeStatus = () => ({ count, pending: pending(), lastTransition: lastTransition ? { ...lastTransition } : null });
  // 再配置をすぐ行う（新しい要素がなければ何もしない＝冪等。AC-432(c)）。
  api.rearrangeNow = () => { if (!pending()) return false; rearrange(); return true; };

  // ---- 図の拡大率と表示位置（2D。再配置の前後で変えない。AC-439） ----
  let diagramView = { zoom: 1, scrollX: 0, scrollY: 0 };
  api.getDiagramView = () => ({ ...diagramView });
  api.setDiagramView = (v, opts = {}) => {
    if (!v || typeof v !== 'object') return { ok: false };
    const next = { ...diagramView };
    if ('zoom' in v) { if (!(typeof v.zoom === 'number' && Number.isFinite(v.zoom) && v.zoom > 0)) return { ok: false }; next.zoom = v.zoom; }
    for (const k of ['scrollX', 'scrollY']) if (k in v) { if (!(typeof v[k] === 'number' && Number.isFinite(v[k]))) return { ok: false }; next[k] = Math.max(0, v[k]); }
    diagramView = next;
    if (!opts.silent) ctx.emit('change', api);
    return { ok: true };
  };

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
