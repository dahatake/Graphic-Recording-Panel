// FR-005 AC-574・AC-575: 手修正の履歴（修正前後の値と日時）と、直前の手修正を元に戻す操作。
// 手修正（要点の編集・削除・追加、シーンの結合・分割。edit.js）の API を包み、成功した操作ごとに履歴を残す。
// 元に戻す情報は、操作が触れたシーンの修正前の写し（確認状態・確認日・「要確認」の印など要点が持つ値ごと）で、履歴の項目に持つ（保存・復元される）。
// 履歴は直近 PARAM-123（50）件。超えた分は古いものから消える。データの初期化（FR-018）で消える。
// 元に戻した結果は要点を書き換えるだけで、自動処理（発話の追加・再配置）は既存の要点を書き換えないため、上書きされない（AC-012）。

export const HISTORY_MAX = 50; // PARAM-123
const KINDS = ['edit', 'delete', 'add', 'merge', 'split', 'undo'];
const clone = (v) => JSON.parse(JSON.stringify(v));
const p2 = (n) => String(n).padStart(2, '0');
export const formatAt = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };

// A-285 AC-575: 件数（HISTORY_MAX）に数えるのは手修正だけ。「元に戻した」の記録は数えない
// （元に戻すたびに古い手修正の記録が消えない）。新しい順の並びで、HISTORY_MAX 件を超える手修正より古い記録を落とす。
export function trimHistory(list) {
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i].kind !== 'undo' && ++n > HISTORY_MAX) { list.length = i; break; }
  }
  return list;
}

export function parseHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const h of raw) {
    if (!h || typeof h !== 'object' || !KINDS.includes(h.kind) || typeof h.id !== 'string') continue;
    const str = (v) => (v == null ? null : String(v));
    const u = h.undo && typeof h.undo === 'object' && Array.isArray(h.undo.scenes) ? { scenes: clone(h.undo.scenes), createdSceneIds: Array.isArray(h.undo.createdSceneIds) ? h.undo.createdSceneIds.filter((x) => typeof x === 'string') : [], createdPointIds: Array.isArray(h.undo.createdPointIds) ? h.undo.createdPointIds.filter((x) => typeof x === 'string') : [], selectedSceneId: typeof h.undo.selectedSceneId === 'string' ? h.undo.selectedSceneId : null } : null;
    out.push({ id: h.id, kind: h.kind, before: str(h.before), after: str(h.after), at: typeof h.at === 'string' ? h.at : '', ...(u ? { undo: u } : {}), ...(h.undone ? { undone: true } : {}) });
  }
  return trimHistory(out);
}

export function editHistoryModule(ctx) {
  const { state, api } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'edit.undo': '元に戻す', 'history.title': '手修正の履歴', 'history.kind.edit': '編集', 'history.kind.delete': '削除', 'history.kind.add': '追加', 'history.kind.merge': '結合', 'history.kind.split': '分割', 'history.kind.undo': '元に戻した',
      'history.before': '修正前', 'history.after': '修正後', 'history.none': '（なし）',
      'msg.undoNone': '元に戻せる手修正がありません', 'msg.undone': '直前の手修正を元に戻しました', 'cmd.edit.undo': '直前の手修正を元に戻す',
    },
    en: {
      'edit.undo': 'Undo', 'history.title': 'Manual edit history', 'history.kind.edit': 'Edit', 'history.kind.delete': 'Delete', 'history.kind.add': 'Add', 'history.kind.merge': 'Merge', 'history.kind.split': 'Split', 'history.kind.undo': 'Undone',
      'history.before': 'Before', 'history.after': 'After', 'history.none': '(none)',
      'msg.undoNone': 'There is no manual edit to undo', 'msg.undone': 'The last manual edit was undone', 'cmd.edit.undo': 'Undo the last manual edit',
    },
  });
  const t = ctx.t;
  state.editHistory = [];
  let hseq = 0;
  const hid = () => { const used = new Set(state.editHistory.map((h) => h.id)); let id; do { id = `h${++hseq}`; } while (used.has(id)); return id; };

  const sceneById = (id) => state.scenes.find((s) => s.id === id);
  const pointText = (id) => { for (const s of state.scenes) { const p = s.points.find((q) => q.id === id); if (p) return p.text; } return null; };

  const push = (entry) => {
    state.editHistory.unshift(entry);
    trimHistory(state.editHistory);
  };
  // 操作の前後で、触れたシーンの修正前の写しを取る。opts.scenes: 触れるシーンの id。run() が成功（ok）なら履歴に足す。
  function recorded(kind, sceneIdsOf, describe) {
    return (orig) => (...args) => {
      const ids = sceneIdsOf(...args);
      const beforeScenes = ids.map((id) => sceneById(id)).filter(Boolean).map((s) => clone(s));
      const beforeSceneIds = new Set(state.scenes.map((s) => s.id));
      const beforePointIds = new Set(state.scenes.flatMap((s) => s.points.map((p) => p.id)));
      const sel = state.selectedSceneId;
      const pre = describe.pre?.(...args) ?? {};
      const res = orig(...args);
      if (!res || res.ok !== true) return res;
      const createdSceneIds = state.scenes.map((s) => s.id).filter((id) => !beforeSceneIds.has(id));
      const createdPointIds = state.scenes.flatMap((s) => s.points.map((p) => p.id)).filter((id) => !beforePointIds.has(id));
      const { before, after } = describe.values(pre, res, ...args);
      ctx.change(() => {
        push({ id: hid(), kind, before, after, at: formatAt(ctx.now()), undo: { scenes: beforeScenes, createdSceneIds, createdPointIds, selectedSceneId: sel } });
      });
      return res;
    };
  }
  const wrap = (name, make) => { const orig = api[name]; if (typeof orig === 'function') api[name] = make(orig); };
  const scenePointsText = (id) => (sceneById(id)?.points ?? []).map((p) => p.text).join(' / ');
  wrap('editPoint', recorded('edit', (pid) => state.scenes.filter((s) => s.points.some((p) => p.id === pid)).map((s) => s.id), {
    pre: (pid) => ({ text: pointText(pid) }), values: (pre, res, pid, text) => ({ before: pre.text, after: String(text ?? '').trim() }),
  }));
  wrap('deletePoint', recorded('delete', (pid) => state.scenes.filter((s) => s.points.some((p) => p.id === pid)).map((s) => s.id), {
    pre: (pid) => ({ text: pointText(pid) }), values: (pre) => ({ before: pre.text, after: null }),
  }));
  wrap('addPoint', recorded('add', (sid) => [sid], {
    values: (pre, res, sid, text) => ({ before: null, after: String(text ?? '').trim() }),
  }));
  wrap('mergeScenes', recorded('merge', (sid) => { const i = state.scenes.findIndex((s) => s.id === sid); return i >= 0 && state.scenes[i + 1] ? [sid, state.scenes[i + 1].id] : []; }, {
    pre: (sid) => { const i = state.scenes.findIndex((s) => s.id === sid); return { a: state.scenes[i]?.heading ?? '', b: state.scenes[i + 1]?.heading ?? '' }; },
    values: (pre) => ({ before: `${pre.a} / ${pre.b}`, after: pre.a }),
  }));
  wrap('splitScene', recorded('split', (sid) => [sid], {
    pre: (sid) => ({ a: sceneById(sid)?.heading ?? '' }),
    values: (pre, res, sid) => ({ before: pre.a, after: `${sceneById(sid)?.heading ?? ''} / ${res.sceneId ? (sceneById(res.sceneId)?.heading ?? '') : ''}` }),
  }));

  api.getEditHistory = () => state.editHistory.map((h) => ({ id: h.id, kind: h.kind, before: h.before, after: h.after, at: h.at, label: t(`history.kind.${h.kind}`) }));

  // ---- 元に戻す ----
  function restore(u) {
    const saved = new Map(u.scenes.map((s) => [s.id, s]));
    const savedPointIds = new Set(u.scenes.flatMap((s) => s.points.map((p) => p.id)));
    const created = new Set(u.createdSceneIds); const createdPts = new Set(u.createdPointIds);
    // 後から加わった要点（修正の後の発話など）は、元に戻したシーンの末尾に残す（省かない）
    const extras = [];
    for (const s of state.scenes) {
      if (!saved.has(s.id) && !created.has(s.id)) continue;
      for (const p of s.points) if (!savedPointIds.has(p.id) && !createdPts.has(p.id)) extras.push({ p, from: s.id });
    }
    const order = u.scenes.map((s) => s.id);
    const lastSavedId = order[order.length - 1];
    // 修正の前に隣にあったシーンの位置を保つ: 保存したシーンのうち残っているものの位置に合わせて入れる
    state.scenes = state.scenes.filter((s) => !created.has(s.id));
    let anchor = state.scenes.findIndex((s) => s.id === order[0]);
    for (const [k, sv] of u.scenes.entries()) {
      const copy = clone(sv);
      const i = state.scenes.findIndex((s) => s.id === sv.id);
      const targetHasExtras = extras.filter((e) => e.from === sv.id || (created.has(e.from) && sv.id === lastSavedId));
      for (const e of targetHasExtras) { const prev = copy.points[copy.points.length - 1]; copy.points.push(e.p); if (prev) copy.relations.push({ from: prev.id, to: e.p.id }); }
      if (i >= 0) { state.scenes[i] = copy; anchor = i; } else { anchor = Math.min(state.scenes.length, (anchor < 0 ? state.scenes.length : anchor + 1)); state.scenes.splice(anchor, 0, copy); }
      void k;
    }
    if (u.selectedSceneId && state.scenes.some((s) => s.id === u.selectedSceneId)) state.selectedSceneId = u.selectedSceneId;
    else if (!state.scenes.some((s) => s.id === state.selectedSceneId)) state.selectedSceneId = state.scenes[0]?.id ?? null;
  }
  api.canUndoManualEdit = () => state.editHistory.some((x) => x.kind !== 'undo' && !x.undone && x.undo);
  api.undoManualEdit = () => {
    const h = state.editHistory.find((x) => x.kind !== 'undo' && !x.undone && x.undo);
    if (!h) { ctx.change(() => ctx.setMessage('msg.undoNone')); return { ok: false, reason: 'no_history' }; }
    ctx.change(() => {
      restore(h.undo);
      h.undone = true;
      push({ id: hid(), kind: 'undo', before: h.after, after: h.before, at: formatAt(ctx.now()) });
      ctx.setMessage('msg.undone');
    });
    return { ok: true };
  };
  ctx.registerCommand('edit.undo', () => api.undoManualEdit());
  ctx.registerKey({ key: 'F12', ctrl: true, alt: true, shift: true, command: 'edit.undo' });

  // テキスト一覧（NFR-A11Y-001）: 履歴を一覧で見られる
  api.renderEditHistory = () => {
    if (!state.editHistory.length) return '';
    const e = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const none = t('history.none');
    return `<section class="edit-history" aria-label="${e(t('history.title'))}"><h2>${e(t('history.title'))}</h2><ol>${state.editHistory.map((h) => `<li data-history-id="${e(h.id)}" data-kind="${h.kind}"><span class="badge">${e(t(`history.kind.${h.kind}`))}</span> ${e(h.at)} ${e(t('history.before'))}: ${e(h.before ?? none)} → ${e(t('history.after'))}: ${e(h.after ?? none)}</li>`).join('')}</ol></section>`;
  };

  ctx.registerPersist('editHistory', {
    export: () => (state.editHistory.length ? clone(state.editHistory) : undefined),
    import: (v) => { state.editHistory = parseHistory(v); },
    reset: () => { state.editHistory = []; },
  });
}
