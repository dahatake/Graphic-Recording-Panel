// FR-005: 図の手修正（要点の編集・削除・追加、シーンの結合・分割）。
// 手修正した要点には manual:true を付ける。自動処理（発話の追加）は末尾への追記だけで、既存の要点を書き換えないため、
// 手修正が上書きされることはない（AC-012）。状態の変更は ctx.change を通る（自動保存・再描画つき）。
import { makeHeading } from './scenes.js';

const findPoint = (scenes, pointId) => {
  for (const sc of scenes) {
    const i = sc.points.findIndex((p) => p.id === pointId);
    if (i >= 0) return { sc, i };
  }
  return null;
};

// 要点の並びに沿って、隣り合う要点を結ぶ関係線を作り直す（削除・追加・分割・結合の後）。
function relink(sc) {
  const ids = new Set(sc.points.map((p) => p.id));
  const kept = sc.relations.filter((r) => ids.has(r.from) && ids.has(r.to));
  const linked = new Set();
  for (const r of kept) { linked.add(r.from); linked.add(r.to); }
  // 関係線を 1 本も持たない要点は、直前の要点につなぐ（図で孤立させない）
  sc.points.forEach((p, i) => { if (i > 0 && !linked.has(p.id)) kept.push({ from: sc.points[i - 1].id, to: p.id }); });
  sc.relations = kept;
}

export function editModule(ctx) {
  ctx.i18n.addStrings({
    ja: {
      'edit.title': '図の手修正', 'edit.target': '対象の要点', 'edit.text': '要点の文',
      'edit.save': '編集を反映', 'edit.delete': '削除', 'edit.add': '要点を追加', 'edit.merge': '次のシーンと結合', 'edit.split': 'ここからシーンを分割',
      'edit.scene': 'シーン', 'edit.none': '修正できる要点がありません',
      'msg.editEmpty': '要点の文が空です', 'msg.editNotFound': '対象が見つかりません', 'msg.editNoNext': '結合する次のシーンがありません', 'msg.editSplitFirst': '先頭の要点では分割できません',
      'msg.edited': '要点を修正しました', 'msg.pointDeleted': '要点を削除しました', 'msg.pointAdded': '要点を追加しました', 'msg.merged': 'シーンを結合しました', 'msg.split': 'シーンを分割しました',
    },
    en: {
      'edit.title': 'Edit the diagram', 'edit.target': 'Target point', 'edit.text': 'Point text',
      'edit.save': 'Apply edit', 'edit.delete': 'Delete', 'edit.add': 'Add point', 'edit.merge': 'Merge with next scene', 'edit.split': 'Split scene from here',
      'edit.scene': 'Scene', 'edit.none': 'No point to edit',
      'msg.editEmpty': 'The point text is empty', 'msg.editNotFound': 'The target was not found', 'msg.editNoNext': 'There is no next scene to merge', 'msg.editSplitFirst': 'Cannot split at the first point',
      'msg.edited': 'The point was edited', 'msg.pointDeleted': 'The point was deleted', 'msg.pointAdded': 'The point was added', 'msg.merged': 'The scenes were merged', 'msg.split': 'The scene was split',
    },
  });
  const fail = (key, reason) => { ctx.change(() => ctx.setMessage(key)); return { ok: false, reason }; };
  const ok = (key, extra = {}) => { ctx.change(() => ctx.setMessage(key)); return { ok: true, ...extra }; };

  ctx.api.editPoint = (pointId, text) => {
    const t = String(text ?? '').trim();
    if (!t) return fail('msg.editEmpty', 'empty');
    const hit = findPoint(ctx.state.scenes, pointId);
    if (!hit) return fail('msg.editNotFound', 'not_found');
    ctx.change(() => { const p = hit.sc.points[hit.i]; p.text = t; p.manual = true; ctx.setMessage('msg.edited'); });
    return { ok: true };
  };
  ctx.api.deletePoint = (pointId) => {
    const hit = findPoint(ctx.state.scenes, pointId);
    if (!hit) return fail('msg.editNotFound', 'not_found');
    ctx.change(() => {
      const { sc, i } = hit;
      const prev = sc.points[i - 1]; const next = sc.points[i + 1];
      sc.points.splice(i, 1);
      sc.relations = sc.relations.filter((r) => r.from !== pointId && r.to !== pointId);
      if (prev && next) sc.relations.push({ from: prev.id, to: next.id });
      relink(sc);
      ctx.setMessage('msg.pointDeleted');
    });
    return { ok: true };
  };
  ctx.api.addPoint = (sceneId, text) => {
    const t = String(text ?? '').trim();
    if (!t) return fail('msg.editEmpty', 'empty');
    const sc = ctx.state.scenes.find((s) => s.id === sceneId);
    if (!sc) return fail('msg.editNotFound', 'not_found');
    const id = ctx.nextId('p');
    ctx.change(() => {
      const prev = sc.points[sc.points.length - 1];
      sc.points.push({ id, text: t, manual: true });
      if (prev) sc.relations.push({ from: prev.id, to: id });
      ctx.setMessage('msg.pointAdded');
    });
    return { ok: true, pointId: id };
  };
  // sceneId のシーンを、時系列で次のシーンと結合する（見出しは前のシーン、状態は後のシーン）。
  ctx.api.mergeScenes = (sceneId) => {
    const list = ctx.state.scenes;
    const i = list.findIndex((s) => s.id === sceneId);
    if (i < 0) return fail('msg.editNotFound', 'not_found');
    if (i === list.length - 1) return fail('msg.editNoNext', 'no_next');
    ctx.change((s) => {
      const a = s.scenes[i]; const b = s.scenes[i + 1];
      const tail = a.points[a.points.length - 1]; const head = b.points[0];
      a.points.push(...b.points);
      a.relations.push(...b.relations);
      if (tail && head) a.relations.push({ from: tail.id, to: head.id });
      a.status = b.status;
      s.scenes.splice(i + 1, 1);
      if (s.selectedSceneId === b.id) s.selectedSceneId = a.id;
      relink(a);
      ctx.setMessage('msg.merged');
    });
    return { ok: true };
  };
  // pointId の要点から後ろを、新しいシーンとして切り出す（直後に挿入）。
  ctx.api.splitScene = (sceneId, pointId) => {
    const i = ctx.state.scenes.findIndex((s) => s.id === sceneId);
    if (i < 0) return fail('msg.editNotFound', 'not_found');
    const k = ctx.state.scenes[i].points.findIndex((p) => p.id === pointId);
    if (k < 0) return fail('msg.editNotFound', 'not_found');
    if (k === 0) return fail('msg.editSplitFirst', 'first_point');
    const id = ctx.nextId('s');
    ctx.change((s) => {
      const a = s.scenes[i];
      const moved = a.points.splice(k);
      const ids = new Set(moved.map((p) => p.id));
      const rel = a.relations.filter((r) => ids.has(r.from) && ids.has(r.to));
      a.relations = a.relations.filter((r) => !ids.has(r.from) && !ids.has(r.to));
      const b = { id, heading: makeHeading(moved[0].text), points: moved, relations: rel, status: a.status };
      if (a.status === 'in_progress') a.status = 'confirmed';
      s.scenes.splice(i + 1, 0, b);
      relink(a); relink(b);
      ctx.setMessage('msg.split');
    });
    return { ok: true, sceneId: id };
  };
}
