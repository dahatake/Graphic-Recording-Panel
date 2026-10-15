// FR-025 シーンのトピックへの分類と集約 / FR-026 図の表示の詳細度（契約: tests/system/CONTRACT.md「図の詳細度」）。
// 分類・題名付けは語句の共有だけを使う外部通信なしの決定的な処理（同じ発話列からは同じ結果）。DOM に依存しない。
// 階層: トピック（大項目）→ シーン（中項目）→ 要点・関係線・絵記号（詳細）。
import * as P from './persist.js';

export const DETAIL_KEY = 'grp.detail';
export const DETAIL_LEVELS = ['major', 'middle', 'detail'];
export const DEFAULT_DETAIL = 'major';
export const MIN_SHARED = 2; // PARAM-015: 話題が共通すると判定する共通語句の最小数

const SPLIT = /[\s、。，．,.!?！？「」『』（）()[\]［］:：;；・/／"'“”]+/u;

// 見出し・要点から語句（空白と句読点で区切った塊）を取り出す。重複は除く（出現順）。
export function tokenize(texts) {
  const seen = new Set(); const out = [];
  for (const raw of texts) {
    for (const w of String(raw ?? '').replace(/…/g, ' ').split(SPLIT)) {
      if (!w) continue;
      const k = w.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(w); }
    }
  }
  return out;
}
const sceneWords = (sc) => tokenize([sc.heading, ...sc.points.map((p) => p.text)]);
const keySet = (words) => new Set(words.map((w) => w.toLowerCase()));
const sharedCount = (words, set) => words.reduce((n, w) => n + (set.has(w.toLowerCase()) ? 1 : 0), 0);

export const emptyEdits = () => ({ titles: {}, moves: {} });
export function parseEdits(raw) {
  const out = emptyEdits();
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw.titles && typeof raw.titles === 'object' ? raw.titles : {})) if (typeof v === 'string' && v.trim()) out.titles[k] = v.trim();
  for (const [k, v] of Object.entries(raw.moves && typeof raw.moves === 'object' ? raw.moves : {})) if (typeof v === 'string') out.moves[k] = v;
  return out;
}

// scenes → トピックの配列（時系列順）。edits: 利用者の手修正（題名 titles、所属 moves: シーン id → 移し先のシーン id、'' は新しいトピック）。
export function classifyTopics(scenes, edits = emptyEdits(), min = MIN_SHARED) {
  const words = new Map(scenes.map((s) => [s.id, sceneWords(s)]));
  const groups = [];
  for (const sc of scenes) {
    const w = words.get(sc.id);
    const last = groups[groups.length - 1];
    if (last && sharedCount(w, last.keys) >= min) { last.scenes.push(sc); for (const x of w) last.keys.add(x.toLowerCase()); }
    else groups.push({ scenes: [sc], keys: keySet(w) });
  }
  // 手修正の所属（以後の自動分類で元に戻さない）
  const idx = new Map(scenes.map((s, i) => [s.id, i]));
  for (const sc of scenes) {
    if (!(sc.id in edits.moves)) continue;
    const anchor = edits.moves[sc.id];
    const from = groups.find((g) => g.scenes.includes(sc));
    if (anchor === '') {
      if (from.scenes.length === 1) continue;
      from.scenes = from.scenes.filter((s) => s !== sc);
      groups.push({ scenes: [sc], keys: keySet(words.get(sc.id)) });
      continue;
    }
    if (anchor === sc.id || !idx.has(anchor)) continue;
    const to = groups.find((g) => g.scenes.some((s) => s.id === anchor));
    if (!to || to === from) continue;
    from.scenes = from.scenes.filter((s) => s !== sc);
    to.scenes.push(sc);
  }
  return groups.filter((g) => g.scenes.length)
    .map((g) => ({ ...g, scenes: [...g.scenes].sort((a, b) => idx.get(a.id) - idx.get(b.id)) }))
    .sort((a, b) => idx.get(a.scenes[0].id) - idx.get(b.scenes[0].id))
    .map((g) => {
      const id = `tp-${g.scenes[0].id}`;
      return { id, title: edits.titles[id] ?? autoTitle(g.scenes, words), sceneIds: g.scenes.map((s) => s.id), pointIds: g.scenes.flatMap((s) => s.points.map((p) => p.id)), manualTitle: id in edits.titles };
    });
}

// 題名: 属するシーンの見出し・要点に共通する語句（なければ最初のシーンの見出し）。シーンが 1 つならそのシーンの見出し。
function autoTitle(list, words) {
  if (list.length === 1) return list[0].heading;
  const common = words.get(list[0].id).filter((w) => list.every((s) => keySet(words.get(s.id)).has(w.toLowerCase())));
  return common.length ? common.join(' ') : list[0].heading;
}

// トピック間の関係: 時系列で隣り合う「順」、隣り合わなくても語句を min 語以上共有する「関連」。
export function topicRelations(topics, scenes, min = MIN_SHARED) {
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const words = topics.map((tp) => tp.sceneIds.map((id) => sceneWords(byId.get(id))));
  const sets = words.map((ws) => ws.map(keySet));
  const related = (i, j) => words[j].some((wb) => sets[i].some((sa) => sharedCount(wb, sa) >= min));
  const rels = [];
  for (let i = 0; i < topics.length; i++) {
    for (let j = i + 1; j < topics.length; j++) {
      const kind = j === i + 1 ? 'order' : (related(i, j) ? 'related' : null);
      if (kind) rels.push({ id: `${topics[i].id}>${topics[j].id}`, from: topics[i].id, to: topics[j].id, kind });
    }
  }
  return rels;
}

export function topicsModule(ctx) {
  const { api, state, storage } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'detail.name.major': '大項目', 'detail.name.middle': '中項目', 'detail.name.detail': '詳細',
      'detail.label': '詳細度', 'msg.detailChanged': '詳細度を変更しました',
      'topic.rel.order': '順', 'topic.rel.related': '関連', 'topic.selected': '選択中のシーンを含む',
      'topic.untitled': '（題名なし）', 'topic.outline.heading': 'トピック（大項目）',
      'msg.topicRenamed': 'トピックの題名を変更しました', 'msg.topicMoved': 'シーンを別のトピックへ移しました', 'msg.topicNotFound': '対象のトピックまたはシーンが見つかりません', 'msg.topicTitleEmpty': 'トピックの題名が空です', 'msg.topicNoMove': 'これ以上移せません',
      'topic.edit.title': 'トピックの手修正', 'topic.edit.target': '対象のトピック', 'topic.edit.rename': '題名を変更', 'topic.edit.moveHere': '選択中のシーンをこのトピックへ', 'topic.edit.moveNew': '選択中のシーンを新しいトピックへ', 'topic.edit.text': '新しい題名',
    },
    en: {
      'detail.name.major': 'Topics', 'detail.name.middle': 'Scenes', 'detail.name.detail': 'Full',
      'detail.label': 'Detail', 'msg.detailChanged': 'Detail level changed',
      'topic.rel.order': 'Next', 'topic.rel.related': 'Related', 'topic.selected': 'Contains the selected scene',
      'topic.untitled': '(untitled)', 'topic.outline.heading': 'Topics',
      'msg.topicRenamed': 'The topic title was changed', 'msg.topicMoved': 'The scene was moved to another topic', 'msg.topicNotFound': 'The topic or scene was not found', 'msg.topicTitleEmpty': 'The topic title is empty', 'msg.topicNoMove': 'It cannot be moved any further',
      'topic.edit.title': 'Edit topics', 'topic.edit.target': 'Target topic', 'topic.edit.rename': 'Rename', 'topic.edit.moveHere': 'Move the selected scene here', 'topic.edit.moveNew': 'Move the selected scene to a new topic', 'topic.edit.text': 'New title',
    },
  });
  const t = ctx.t;

  // ---- 手修正（セッションの一部。保存・初期化・ファイルに含む） ----
  state.topicEdits = parseEdits(state.topicEdits);

  // ---- 詳細度（端末ごとの設定 grp.detail。セッション・初期化・ファイルの対象外） ----
  let level = DEFAULT_DETAIL;
  { const v = P.readJson(storage, DETAIL_KEY); if (DETAIL_LEVELS.includes(v)) level = v; }
  api.getDetailLevel = () => level;
  api.setDetailLevel = (next) => {
    if (!DETAIL_LEVELS.includes(next)) return { ok: false, reason: 'invalid' };
    if (next !== level) { level = next; P.writeJson(storage, DETAIL_KEY, level); }
    // 通知と自動保存（議論の内容は変えない）。結果は画面の読み上げ対象のメッセージで示す。
    ctx.change((s) => { s.message = { key: 'msg.detailChanged', text: `${t('detail.label')}: ${t(`detail.name.${level}`)}` }; });
    return { ok: true };
  };
  api.getDetailInfo = () => ({ level, label: t(`detail.name.${level}`), options: DETAIL_LEVELS.map((l) => ({ level: l, label: t(`detail.name.${l}`), current: l === level })) });
  for (const l of DETAIL_LEVELS) ctx.registerCommand(`detail.${l}`, () => { api.setDetailLevel(l); });
  ctx.registerCommand('detail.next', () => { api.setDetailLevel(DETAIL_LEVELS[(DETAIL_LEVELS.indexOf(level) + 1) % DETAIL_LEVELS.length]); });
  for (const [command, key] of [['detail.next', 'F1'], ['detail.major', 'F2'], ['detail.middle', 'F3'], ['detail.detail', 'F4']]) ctx.registerKey({ key, alt: true, shift: true, command });
  ctx.on('lang', () => { if (state.message?.key === 'msg.detailChanged') ctx.change((s) => { s.message.text = `${t('detail.label')}: ${t(`detail.name.${level}`)}`; }); });

  // ---- トピック ----
  const compute = () => classifyTopics(state.scenes, state.topicEdits);
  api.getTopics = () => compute().map(({ manualTitle, ...tp }) => ({ ...tp, manualTitle, containsSelected: state.selectedSceneId != null && tp.sceneIds.includes(state.selectedSceneId) }));
  api.getTopicRelations = () => topicRelations(compute(), state.scenes).map((r) => ({ ...r, label: t(`topic.rel.${r.kind}`) }));

  const fail = (key, reason) => { ctx.change(() => ctx.setMessage(key)); return { ok: false, reason }; };
  // 題名を手で変える（以後の自動の更新で元に戻さない）
  api.renameTopic = (topicId, title) => {
    const tp = compute().find((x) => x.id === topicId);
    if (!tp) return fail('msg.topicNotFound', 'not_found');
    const text = String(title ?? '').trim();
    if (!text) return fail('msg.topicTitleEmpty', 'empty');
    ctx.change((s) => { s.topicEdits.titles[topicId] = text; ctx.setMessage('msg.topicRenamed'); });
    return { ok: true };
  };
  // シーンを別のトピック（toTopicId）か新しいトピック（null）へ移す。題名の手修正は、トピックの id が変わっても引き継ぐ。
  api.moveSceneToTopic = (sceneId, toTopicId = null) => {
    if (!state.scenes.some((s) => s.id === sceneId)) return fail('msg.topicNotFound', 'not_found');
    const before = compute();
    let anchor = '';
    if (toTopicId != null) {
      const to = before.find((x) => x.id === toTopicId);
      if (!to) return fail('msg.topicNotFound', 'not_found');
      anchor = to.sceneIds.find((id) => id !== sceneId);
      if (anchor === undefined) return fail('msg.topicNoMove', 'no_move');
    }
    ctx.change((s) => {
      s.topicEdits.moves[sceneId] = anchor;
      const after = classifyTopics(s.scenes, s.topicEdits);
      const titles = {};
      for (const tp of before) {
        if (!(tp.id in s.topicEdits.titles)) continue;
        const host = after.find((a) => tp.sceneIds.some((id) => id !== sceneId && a.sceneIds.includes(id)));
        if (host) titles[host.id] = s.topicEdits.titles[tp.id];
      }
      for (const [k, v] of Object.entries(s.topicEdits.titles)) if (after.some((a) => a.id === k)) titles[k] = titles[k] ?? v;
      s.topicEdits.titles = titles;
      ctx.setMessage('msg.topicMoved');
    });
    return { ok: true };
  };
  const moveSelected = (d) => {
    const sid = state.selectedSceneId; const list = compute();
    const i = list.findIndex((x) => x.sceneIds.includes(sid));
    if (i < 0) return fail('msg.topicNotFound', 'not_found');
    const j = i + d;
    if (j < 0 || j >= list.length) return fail('msg.topicNoMove', 'no_move');
    return api.moveSceneToTopic(sid, list[j].id);
  };
  ctx.registerCommand('topic.movePrev', () => moveSelected(-1));
  ctx.registerCommand('topic.moveNext', () => moveSelected(1));
  ctx.registerCommand('topic.moveNew', () => { const sid = state.selectedSceneId; return sid ? api.moveSceneToTopic(sid, null) : fail('msg.topicNotFound', 'not_found'); });
  const stepTopic = (d) => {
    const list = compute(); if (!list.length) return;
    const cur = api.getScenePopup?.()?.topicId;
    const i = list.findIndex((x) => x.id === cur);
    api.selectTopic(list[i < 0 ? (d > 0 ? 0 : list.length - 1) : (i + d + list.length) % list.length].id);
  };
  ctx.registerCommand('topic.next', () => stepTopic(1));
  ctx.registerCommand('topic.prev', () => stepTopic(-1));
  for (const [command, key] of [['topic.movePrev', 'F6'], ['topic.moveNext', 'F7'], ['topic.moveNew', 'F8'], ['topic.next', 'F9'], ['topic.prev', 'F10']]) ctx.registerKey({ key, alt: true, shift: true, command });

  // テキスト一覧（NFR-A11Y-001）にトピックの階層・関係を文字で示す
  api.getTopicOutline = () => {
    const tops = api.getTopics(); const byId = new Map(tops.map((x) => [x.id, x]));
    const sc = new Map(state.scenes.map((s) => [s.id, s]));
    return {
      heading: t('topic.outline.heading'),
      topics: tops.map((tp) => ({ id: tp.id, title: tp.title, containsSelected: tp.containsSelected, scenes: tp.sceneIds.map((id) => ({ id, heading: sc.get(id).heading, points: sc.get(id).points.map((p) => ({ id: p.id, text: p.text })) })) })),
      relations: api.getTopicRelations().map((r) => ({ ...r, text: `${byId.get(r.from).title} → ${byId.get(r.to).title}: ${r.label}` })),
    };
  };
}
