// FR-099 対立・トレードオフ・少数意見の表示（比較の 2 列）。契約: tests/system/CONTRACT-P1.md（conflict.group・conflict.ungroup）。
// - 検出（AC-585）: 同じシーンの中で、発話に PARAM-133 の言い回しがある要点と、その直前または直後の対比される要点を「対立の組」の候補にする。
//   決定的（同じ発話列から毎回同じ）で、生成 AI・外部通信を使わない（G-002）。関係の種類「対立」（FR-053 AC-583。双方向）と同じ言い回しの表を使う。
// - 指定（AC-586）: 候補は確定・解除でき、要点を選んで組にすることも、側（左・右）の割り当て・組の解除もできる。確定した組は自動の検出・再配置より優先され、セッションに保存される。
// - 表示（AC-587）: 確定した組は「比較」のまとまり（左右 2 列。relayout.js の木 → diagram.js の幾何）。テキスト一覧には同じ語（対立・側の名前）で出る。
// - 少数の意見（AC-587・AC-588）: 件数にかかわらず省かず、同じ大きさで描く。異論の記録がないことは「異論の記録なし」と書き、「合意」「全員一致」とは書かない。
import { classifyPoint } from './diagram.js';
import { RELATION_PHRASES } from './layoutkinds.js';
import { escapeHtml, renderConflictOutline } from './outline.js';
import { COMPARE_EMPTY, sideSummary } from './infodesign.js';

// PARAM-133 の言い回しのうち、一方の側（賛成・メリット）を述べるもの／他方の側（対比の先・反対・デメリット）を述べるもの。残り（トレードオフ・比べ・vs）は側を決めない。
const FIRST_SIDE = ['賛成', 'メリット'];
const SECOND_SIDE = ['それに対して', '対して', '反対に', 'しかし', '一方', '反対', 'デメリット', 'however', 'on the other hand'];
const SIDE_IDS = ['left', 'right'];
const NAMES = {
  ja: { pair: ['賛成', '反対'], merit: ['メリット', 'デメリット'], plain: ['左', '右'] },
  en: { pair: ['For', 'Against'], merit: ['Pros', 'Cons'], plain: ['Left', 'Right'] },
};

const isAscii = (w) => /^[\x20-\x7e]+$/.test(w);
// 日本語は部分一致、英語の語は語境界つき。大文字小文字を区別しない（PARAM-133）
function indexOfPhrase(text, word) {
  const s = String(text ?? '').toLowerCase(); const w = word.toLowerCase();
  if (!isAscii(w)) return s.indexOf(w);
  const m = new RegExp(`(?<![a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).exec(s);
  return m ? m.index : -1;
}
export const hasConflictPhrase = (text) => RELATION_PHRASES.opposition.some((w) => indexOfPhrase(text, w) >= 0);
// 言い回しの側。最も前にある側の言い回しで決める（「賛成ですが反対の意見もある」は賛成の側）。側を決める言い回しがなければ null
function polarityOf(text) {
  let best = null;
  for (const [side, list] of [['left', FIRST_SIDE], ['right', SECOND_SIDE]]) {
    for (const w of list) { const i = indexOfPhrase(text, w); if (i >= 0 && (!best || i < best.i)) best = { i, side }; }
  }
  return best?.side ?? null;
}
// 側の名前: 「賛成」「反対」を述べる要点があれば 賛成／反対、「メリット」「デメリット」なら メリット／デメリット、なければ 左／右
export function sideNames(texts, lang = 'ja') {
  const N = NAMES[lang === 'en' ? 'en' : 'ja'];
  const all = texts.join('\n');
  if (indexOfPhrase(all, '賛成') >= 0 || indexOfPhrase(all, '反対') >= 0) return [...N.pair];
  if (indexOfPhrase(all, 'デメリット') >= 0 || indexOfPhrase(all, 'メリット') >= 0) return [...N.merit];
  return [...N.plain];
}

// AC-585: 1 シーンの対立の組の候補。scene: { id, points:[{id,text,uid}] }（話順）、utterances: [{id,text}]。
// 返り値: [{ key, sceneId, names:[左の名前, 右の名前], sides:[{ id:'left', name, pointIds }, { id:'right', … }] }]（話順の最初の要点の順）
export function detectConflictCandidates(scene, utterances = [], lang = 'ja') {
  const pts = scene?.points ?? [];
  if (pts.length < 2) return [];
  const uttText = new Map((utterances ?? []).map((u) => [u.id, u.text]));
  const perUtt = new Map();
  for (const p of pts) if (p.uid) perUtt.set(p.uid, (perUtt.get(p.uid) ?? 0) + 1);
  // 発話の言い回し: 要点の文。その発話から要点が 1 つだけのときは、発話全体の文も見る
  const source = (p) => (p.uid && perUtt.get(p.uid) === 1 && uttText.has(p.uid) ? `${p.text}\n${uttText.get(p.uid)}` : String(p.text ?? ''));
  const src = pts.map(source);
  const isMarker = pts.map((_, i) => hasConflictPhrase(src[i]));
  const assigned = new Map(); const parent = new Map(); const edges = [];
  const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); return r; };
  const other = (s) => (s === 'left' ? 'right' : 'left');
  for (let i = 0; i < pts.length; i++) {
    if (!isMarker[i]) continue;
    const sideM = polarityOf(src[i]) === 'left' ? 'left' : 'right'; // 側が決まらない言い回しは、対比の先（右）
    for (const j of [i - 1, i + 1]) { // 直前を先に、なければ直後
      const c = pts[j];
      if (!c || (c.uid && c.uid === pts[i].uid) || classifyPoint(c) === 'question') continue;
      const pc = polarityOf(src[j]);
      const sideC = pc ?? other(sideM);
      if (sideC === sideM) continue;
      const cur = assigned.get(pts[i].id) ?? sideM; const cur2 = assigned.get(c.id) ?? sideC;
      if (cur !== sideM || cur2 !== sideC) continue; // すでに別の側に決まっている要点とは組まない
      assigned.set(pts[i].id, sideM); assigned.set(c.id, sideC);
      for (const id of [pts[i].id, c.id]) if (!parent.has(id)) parent.set(id, id);
      parent.set(find(pts[i].id), find(c.id));
      edges.push([pts[i].id, c.id]);
      break;
    }
  }
  const order = new Map(pts.map((p, i) => [p.id, i]));
  const groups = new Map();
  for (const id of assigned.keys()) { const r = find(id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(id); }
  const out = [];
  for (const ids of groups.values()) {
    ids.sort((a, b) => order.get(a) - order.get(b));
    const left = ids.filter((id) => assigned.get(id) === 'left'); const right = ids.filter((id) => assigned.get(id) === 'right');
    if (!left.length || !right.length) continue;
    const names = sideNames(ids.map((id) => pts[order.get(id)].text), lang);
    out.push({ key: `cand:${scene.id}:${ids.join('+')}`, sceneId: scene.id, names, sides: [{ id: 'left', name: names[0], pointIds: left }, { id: 'right', name: names[1], pointIds: right }] });
  }
  return out.sort((a, b) => order.get(a.sides[0].pointIds[0] ?? a.sides[1].pointIds[0]) - order.get(b.sides[0].pointIds[0] ?? b.sides[1].pointIds[0]));
}

const STR = {
  ja: {
    'conflict.heading': '対立・トレードオフ', 'conflict.word': '対立', 'conflict.compare': '比較', 'conflict.candidate': '候補',
    'conflict.confirmedHead': '対立（比較）', 'conflict.candidateHead': '対立の候補', 'conflict.scene': 'シーン',
    'conflict.confirm': '対立の組にする（確定）', 'conflict.dismiss': '候補を解除', 'conflict.ungroup': '対立の組を解除', 'conflict.flip': '側を移す',
    'conflict.pick': '対立の組に加える', 'conflict.unpick': '選択から外す', 'conflict.make': '選んだ要点を対立の組にする', 'conflict.picked': '選択中',
    'conflict.empty': COMPARE_EMPTY.ja, 'conflict.objections': '異論・懸念', 'conflict.objectionCount': '{n} 件', 'conflict.groupCount': '{n} 組',
    'msg.conflictNoSelection': '要点を選んでください', 'msg.conflictPicked': '対立の組にする要点を選択しました（{n} 件）。もう一度押すと組にします', 'msg.conflictUnpicked': '選択から外しました',
    'msg.conflictCreated': '対立の組にしました', 'msg.conflictConfirmed': '候補を対立の組に確定しました', 'msg.conflictDismissed': '候補を解除しました', 'msg.conflictUngrouped': '対立の組を解除しました',
    'msg.conflictNeedTwo': '対立の組には 2 つ以上の要点が要ります', 'msg.conflictOneSide': '2 つの側に要点を分けてください', 'msg.conflictGrouped': 'すでに対立の組に入っています',
    'cmd.conflict.group': '選択した要点を対立の組にする（候補は確定）', 'cmd.conflict.ungroup': '選択した要点の対立の組・候補を解除',
  },
  en: {
    'conflict.heading': 'Oppositions and trade-offs', 'conflict.word': 'Opposition', 'conflict.compare': 'Compare', 'conflict.candidate': 'Candidate',
    'conflict.confirmedHead': 'Opposition (compare)', 'conflict.candidateHead': 'Opposition candidate', 'conflict.scene': 'Scene',
    'conflict.confirm': 'Make an opposition (confirm)', 'conflict.dismiss': 'Dismiss candidate', 'conflict.ungroup': 'Ungroup', 'conflict.flip': 'Move to the other side',
    'conflict.pick': 'Add to an opposition', 'conflict.unpick': 'Remove from selection', 'conflict.make': 'Make the selected points an opposition', 'conflict.picked': 'Selected',
    'conflict.empty': COMPARE_EMPTY.en, 'conflict.objections': 'Objections and concerns', 'conflict.objectionCount': '{n} items', 'conflict.groupCount': '{n} groups',
    'msg.conflictNoSelection': 'Select a point first', 'msg.conflictPicked': 'Point picked for an opposition ({n}). Press again to group them', 'msg.conflictUnpicked': 'Removed from the selection',
    'msg.conflictCreated': 'The points were grouped as an opposition', 'msg.conflictConfirmed': 'The candidate was confirmed', 'msg.conflictDismissed': 'The candidate was dismissed', 'msg.conflictUngrouped': 'The opposition was ungrouped',
    'msg.conflictNeedTwo': 'An opposition needs two or more points', 'msg.conflictOneSide': 'Put points on both sides', 'msg.conflictGrouped': 'The point is already in an opposition',
    'cmd.conflict.group': 'Make the selected point an opposition (confirm a candidate)', 'cmd.conflict.ungroup': 'Ungroup the opposition or dismiss the candidate of the selected point',
  },
};

export function conflictModule(ctx) {
  const { api, state } = ctx;
  ctx.i18n.addStrings(STR);
  const lang = () => state.lang;
  const tt = (k, n) => String(ctx.t(k)).replace('{n}', n);

  // 保存の対象: 確定した組（要点の id・側・側の名前）と、利用者が解除した候補の鍵
  let groups = []; // [{ id, sceneId, names:[l,r], sides:{ left:[id], right:[id] } }]
  let dismissed = new Set();
  let picked = []; // 組にする要点の選択（保存しない）
  let seq = 0;

  const sceneOf = (pointId) => state.scenes.find((s) => s.points.some((p) => p.id === pointId)) ?? null;
  const pointOf = (id) => { for (const s of state.scenes) { const p = s.points.find((q) => q.id === id); if (p) return { p, s }; } return null; };
  const nextGroupId = () => { const used = new Set(groups.map((g) => g.id)); let id; do { id = `cf${++seq}`; } while (used.has(id)); return id; };

  // 確定した組の写し（存在する要点だけ）。2 つ未満になった組は無いものとして扱う
  function confirmedOf(sceneId) {
    const out = [];
    for (const g of groups) {
      if (sceneId != null && g.sceneId !== sceneId) continue;
      const sc = state.scenes.find((s) => s.id === g.sceneId);
      if (!sc) continue;
      const have = new Set(sc.points.map((p) => p.id));
      const sides = SIDE_IDS.map((sid, i) => ({ id: sid, name: g.names[i], pointIds: g.sides[sid].filter((id) => have.has(id)) }));
      if (sides[0].pointIds.length + sides[1].pointIds.length < 2) continue;
      out.push({ id: g.id, sceneId: g.sceneId, sides });
    }
    return out;
  }
  // 候補（確定した組に入っている要点を含むもの・解除した候補を除く。手動の指定を優先）。データの版数ごとに 1 回だけ作る
  let memo = { ver: -2, lang: '', value: [] };
  function candidates() {
    const v = ctx.getDataVersion?.() ?? null;
    if (v != null && memo.ver === v && memo.lang === lang()) return memo.value;
    const taken = new Set(confirmedOf().flatMap((g) => g.sides.flatMap((s) => s.pointIds)));
    const value = [];
    for (const s of state.scenes) {
      for (const c of detectConflictCandidates(s, state.utterances, lang())) {
        if (dismissed.has(c.key)) continue;
        if (c.sides.some((sd) => sd.pointIds.some((id) => taken.has(id)))) continue;
        value.push(c);
      }
    }
    memo = { ver: v ?? -2, lang: lang(), value };
    return value;
  }

  // ---- 表示用のモデル（図・テキスト一覧・出力が同じ語を使う） ----
  function viewOf(g, status) {
    const sc = state.scenes.find((s) => s.id === g.sceneId);
    const text = new Map((sc?.points ?? []).map((p) => [p.id, p.text]));
    const sides = g.sides.map((sd) => ({
      id: sd.id, name: sd.name, count: sd.pointIds.length, pointIds: [...sd.pointIds],
      points: sd.pointIds.map((id) => ({ id, text: text.get(id) ?? '' })), empty: sd.pointIds.length === 0, emptyLabel: ctx.t('conflict.empty'),
    }));
    return {
      id: status === 'candidate' ? g.key : g.id, status, sceneId: g.sceneId, sceneHeading: sc?.heading ?? '',
      word: ctx.t(status === 'candidate' ? 'conflict.candidate' : 'conflict.word'), mark: status === 'candidate' ? '◇' : '⇄',
      label: ctx.t(status === 'candidate' ? 'conflict.candidateHead' : 'conflict.confirmedHead'), summary: sideSummary(sides, lang()), sides,
    };
  }
  api.getConflicts = (sceneId = null) => [
    ...confirmedOf(sceneId).map((g) => viewOf(g, 'confirmed')),
    ...candidates().filter((c) => sceneId == null || c.sceneId === sceneId).map((c) => viewOf(c, 'candidate')),
  ];
  api.getConflictCandidates = (sceneId = null) => candidates().filter((c) => sceneId == null || c.sceneId === sceneId).map((c) => viewOf(c, 'candidate'));
  api.getConfirmedConflicts = (sceneId) => { const l = confirmedOf(sceneId); return l.length ? l : null; };
  api.getConflictSelection = () => picked.filter((id) => pointOf(id)).slice();
  // 点ごとの情報（データの版数ごと）
  let infoMemo = { ver: -2, lang: '', map: new Map() };
  function pointInfos() {
    const v = ctx.getDataVersion?.() ?? null;
    if (v != null && infoMemo.ver === v && infoMemo.lang === lang()) return infoMemo.map;
    const map = new Map();
    for (const view of api.getConflicts()) for (const sd of view.sides) for (const id of sd.pointIds) map.set(id, { id: view.id, status: view.status, side: sd.id, sideName: sd.name, word: view.word, mark: view.mark });
    infoMemo = { ver: v ?? -2, lang: lang(), map };
    return map;
  }
  api.getConflictForPoint = (pointId) => pointInfos().get(pointId) ?? null;

  // ---- 変更 ----
  function create(sceneId, left, right, names) {
    const id = nextGroupId();
    groups.push({ id, sceneId, names: [...names], sides: { left: [...left], right: [...right] } });
    return id;
  }
  api.confirmConflict = (candidateId) => {
    const c = candidates().find((x) => x.key === candidateId);
    if (!c) return { ok: false, reason: 'not_found' };
    let id;
    ctx.change(() => { id = create(c.sceneId, c.sides[0].pointIds, c.sides[1].pointIds, c.names); picked = []; ctx.setMessage('msg.conflictConfirmed'); });
    return { ok: true, id };
  };
  api.dismissConflict = (candidateId) => {
    const c = candidates().find((x) => x.key === candidateId);
    if (!c) return { ok: false, reason: 'not_found' };
    ctx.change(() => { dismissed.add(c.key); ctx.setMessage('msg.conflictDismissed'); });
    return { ok: true };
  };
  // AC-586: 要点を 2 つ以上選んで組にする。opts.sides: { 要点の id: 'left'|'right' }（なければ 1 つ目が左・残りが右）、opts.names: [左の名前, 右の名前]
  api.createConflict = (pointIds, opts = {}) => {
    const ids = [...new Set(pointIds ?? [])];
    if (ids.length < 2) { ctx.change(() => ctx.setMessage('msg.conflictNeedTwo')); return { ok: false, reason: 'need_two' }; }
    const hits = ids.map(pointOf);
    if (hits.some((h) => !h) || new Set(hits.map((h) => h.s.id)).size !== 1) return { ok: false, reason: 'not_found' };
    if (ids.some((id) => confirmedOf().some((g) => g.sides.some((sd) => sd.pointIds.includes(id))))) { ctx.change(() => ctx.setMessage('msg.conflictGrouped')); return { ok: false, reason: 'already_grouped' }; }
    const sideOf = (id, i) => (opts.sides?.[id] === 'left' || opts.sides?.[id] === 'right' ? opts.sides[id] : (i === 0 ? 'left' : 'right'));
    const left = ids.filter((id, i) => sideOf(id, i) === 'left'); const right = ids.filter((id, i) => sideOf(id, i) === 'right');
    if (!left.length && !right.length) return { ok: false, reason: 'not_found' };
    if (!left.length || !right.length) { ctx.change(() => ctx.setMessage('msg.conflictOneSide')); return { ok: false, reason: 'one_side' }; }
    const names = Array.isArray(opts.names) && opts.names.length === 2 ? opts.names.map((n) => String(n).trim().slice(0, 20) || '-') : sideNames(ids.map((id) => pointOf(id).p.text), lang());
    let id;
    ctx.change(() => { id = create(hits[0].s.id, left, right, names); picked = []; ctx.setMessage('msg.conflictCreated'); });
    return { ok: true, id };
  };
  const groupOfPoint = (pointId) => groups.find((g) => SIDE_IDS.some((sd) => g.sides[sd].includes(pointId)));
  // AC-586: 各要点の側の割り当て（組の中の要点を左右で移す。組に入っていない要点は、あれば組に加えず拒否）
  api.setConflictSide = (pointId, side) => {
    const g = groupOfPoint(pointId);
    if (!g || !SIDE_IDS.includes(side)) return { ok: false, reason: 'not_found' };
    ctx.change(() => { for (const sd of SIDE_IDS) g.sides[sd] = g.sides[sd].filter((id) => id !== pointId); g.sides[side].push(pointId); });
    return { ok: true };
  };
  api.setConflictSideName = (conflictId, side, name) => {
    const g = groups.find((x) => x.id === conflictId); const i = SIDE_IDS.indexOf(side);
    const n = String(name ?? '').trim().slice(0, 20);
    if (!g || i < 0 || !n) return { ok: false, reason: 'invalid' };
    ctx.change(() => { g.names[i] = n; });
    return { ok: true };
  };
  // 組の中の要点を 1 つ外す（残りが 2 つ未満なら組ごと解除）
  api.removeConflictPoint = (pointId) => {
    const g = groupOfPoint(pointId);
    if (!g) return { ok: false, reason: 'not_found' };
    ctx.change(() => { for (const sd of SIDE_IDS) g.sides[sd] = g.sides[sd].filter((id) => id !== pointId); if (g.sides.left.length + g.sides.right.length < 2) groups = groups.filter((x) => x !== g); });
    return { ok: true };
  };
  api.ungroupConflict = (conflictId) => {
    const g = groups.find((x) => x.id === conflictId);
    if (!g) return { ok: false, reason: 'not_found' };
    ctx.change(() => {
      groups = groups.filter((x) => x !== g);
      // 解除した組は、再検出で元に戻らない（同じ要点の組の候補を解除済みにする）
      for (const c of detectConflictCandidates(state.scenes.find((s) => s.id === g.sceneId), state.utterances, lang())) {
        const mine = new Set([...g.sides.left, ...g.sides.right]);
        if (c.sides.some((sd) => sd.pointIds.some((id) => mine.has(id)))) dismissed.add(c.key);
      }
      ctx.setMessage('msg.conflictUngrouped');
    });
    return { ok: true };
  };
  api.toggleConflictSelection = (pointId) => {
    if (!pointOf(pointId)) return { ok: false, reason: 'not_found' };
    ctx.change(() => { picked = picked.includes(pointId) ? picked.filter((id) => id !== pointId) : [...picked, pointId]; });
    return { ok: true, count: picked.length };
  };
  api.groupConflictSelection = () => {
    const r = api.createConflict(api.getConflictSelection());
    if (r.ok) ctx.change(() => { picked = []; });
    return r;
  };
  // 画面のボタンの入口
  api.conflictAction = (act, id) => {
    if (act === 'pick') return api.toggleConflictSelection(id);
    if (act === 'group') return api.groupConflictSelection();
    if (act === 'confirm') return api.confirmConflict(id);
    if (act === 'dismiss') return api.dismissConflict(id);
    if (act === 'ungroup') return api.ungroupConflict(id);
    if (act === 'flip') { const g = groupOfPoint(id); return g ? api.setConflictSide(id, g.sides.left.includes(id) ? 'right' : 'left') : { ok: false, reason: 'not_found' }; }
    return { ok: false, reason: 'unknown' };
  };

  // ---- キーボード（AC-586）: 選択した要点に対して ----
  const currentPoint = () => api.getSelectedPointId?.() ?? api.getHighlight?.()?.pointId ?? null;
  ctx.registerCommand('conflict.group', () => {
    const id = currentPoint();
    if (!id || !pointOf(id)) { ctx.change(() => ctx.setMessage('msg.conflictNoSelection')); return { ok: false, reason: 'no_selection' }; }
    const info = pointInfos().get(id);
    if (info?.status === 'candidate') return api.confirmConflict(info.id);
    if (info) { ctx.change(() => ctx.setMessage('msg.conflictGrouped')); return { ok: false, reason: 'already_grouped' }; }
    if (picked.includes(id) && picked.length >= 2) return api.groupConflictSelection(); // 選択済みの要点でもう一度押すと、選んだ要点を組にする
    if (picked.includes(id)) { ctx.change(() => ctx.setMessage('msg.conflictNeedTwo')); return { ok: false, reason: 'need_two' }; }
    ctx.change(() => { picked = [...picked, id]; state.message = { key: 'msg.conflictPicked', text: tt('msg.conflictPicked', picked.length) }; });
    return { ok: true, picked: picked.length };
  });
  ctx.registerCommand('conflict.ungroup', () => {
    const id = currentPoint();
    if (!id || !pointOf(id)) { ctx.change(() => ctx.setMessage('msg.conflictNoSelection')); return { ok: false, reason: 'no_selection' }; }
    const info = pointInfos().get(id);
    if (info?.status === 'candidate') return api.dismissConflict(info.id);
    if (info) return api.ungroupConflict(info.id);
    if (picked.includes(id)) { ctx.change(() => { picked = picked.filter((x) => x !== id); ctx.setMessage('msg.conflictUnpicked'); }); return { ok: true }; }
    return { ok: false, reason: 'not_grouped' };
  });
  ctx.registerKey({ key: '[', ctrl: true, alt: true, shift: true, command: 'conflict.group' });
  ctx.registerKey({ key: ']', ctrl: true, alt: true, shift: true, command: 'conflict.ungroup' });

  // ---- 表示の追加（図の印・テキスト一覧の語） ----
  const baseMark = api.getReviewMark;
  api.getReviewMark = (refIds) => {
    const base = baseMark ? baseMark(refIds) : null;
    const infos = pointInfos();
    if (!infos.size) return base;
    const hit = (refIds ?? []).map((id) => infos.get(id)).find(Boolean);
    if (!hit) return base;
    return { needsReview: false, reasons: [], label: '', ...(base ?? {}), conflict: { status: hit.status, label: `${hit.word}: ${hit.sideName}` } };
  };
  const baseExtra = api.getPointExtraHtml;
  api.getPointExtraHtml = (p) => {
    const base = baseExtra ? baseExtra(p) : '';
    const info = pointInfos().get(p.id);
    const selected = api.getSelectedPointId?.() === p.id;
    if (!info && !selected) return base;
    let out = base;
    if (info) out += ` <span class="badge badge-conflict" data-conflict-badge="${escapeHtml(info.status)}" data-conflict-side="${escapeHtml(info.side)}"><span aria-hidden="true">${info.mark}</span> ${escapeHtml(info.word)}: ${escapeHtml(info.sideName)}</span>`;
    else if (selected) out += ` <button type="button" class="btn btn-small" data-conflict-act="pick" data-id="${escapeHtml(p.id)}" aria-pressed="${picked.includes(p.id)}">${escapeHtml(ctx.t(picked.includes(p.id) ? 'conflict.unpick' : 'conflict.pick'))}</button>`;
    return out;
  };
  const baseInfo = api.getPointInfo;
  api.getPointInfo = (id) => {
    const info = baseInfo ? baseInfo(id) : null;
    const c = pointInfos().get(id);
    return info && c ? { ...info, conflict: { id: c.id, status: c.status, side: c.side, sideName: c.sideName } } : info;
  };

  // ---- 出力（AC-588）: 異論・懸念の状況は文字で書く。0 件は「異論の記録なし」（「合意」「全員一致」とは書かない）----
  const objectionCount = () => (state.minutes?.items ?? []).filter((i) => i.kind === 'objection' && i.state === 'confirmed').length;
  api.getConflictLines = () => {
    const confirmed = api.getConflicts().filter((c) => c.status === 'confirmed');
    const n = objectionCount();
    if (!confirmed.length && !n) return {};
    const out = { objectionLine: `${ctx.t('conflict.objections')}: ${n === 0 ? ctx.t('conflict.empty') : tt('conflict.objectionCount', n)}` };
    if (confirmed.length) out.conflictLine = `${ctx.t('conflict.confirmedHead')}: ${tt('conflict.groupCount', confirmed.length)}（${confirmed.map((c) => `${c.sceneHeading ? `${c.sceneHeading} ` : ''}${c.summary}`).join('；')}）`;
    return out;
  };
  api.getConflictOutlineHtml = () => {
    const list = api.getConflicts();
    const sel = api.getConflictSelection();
    const lines = api.getConflictLines();
    if (!list.length && !sel.length && !lines.objectionLine) return '';
    const text = new Map(state.scenes.flatMap((s) => s.points).map((p) => [p.id, p.text]));
    return renderConflictOutline({
      heading: ctx.t('conflict.heading'), list, objectionLine: lines.objectionLine ?? '',
      selection: sel.length ? { count: sel.length, label: `${ctx.t('conflict.picked')}: ${sel.length}`, items: sel.map((id) => ({ id, text: text.get(id) ?? '' })), makeLabel: ctx.t('conflict.make') } : null,
      labels: { confirm: ctx.t('conflict.confirm'), dismiss: ctx.t('conflict.dismiss'), ungroup: ctx.t('conflict.ungroup'), flip: ctx.t('conflict.flip'), scene: ctx.t('conflict.scene') },
    });
  };

  // ---- 保存・復元・初期化（AC-586） ----
  ctx.registerPersist('conflicts', {
    export: () => {
      const gs = groups.map((g) => ({ id: g.id, sceneId: g.sceneId, names: [...g.names], left: [...g.sides.left], right: [...g.sides.right] }));
      return gs.length || dismissed.size ? { groups: gs, dismissed: [...dismissed].sort() } : undefined;
    },
    import: (v) => {
      const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      const strs = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string').slice(0, 5000) : []);
      groups = (Array.isArray(o.groups) ? o.groups : []).slice(0, 500).filter((g) => g && typeof g.id === 'string' && typeof g.sceneId === 'string').map((g) => ({
        id: g.id, sceneId: g.sceneId,
        names: Array.isArray(g.names) && g.names.length === 2 ? g.names.map((n) => String(n).slice(0, 20)) : [...NAMES[lang() === 'en' ? 'en' : 'ja'].plain],
        sides: { left: strs(g.left), right: strs(g.right) },
      }));
      dismissed = new Set(strs(o.dismissed));
      picked = []; seq = 0;
      for (const g of groups) { const m = /^cf(\d+)$/.exec(g.id); if (m) seq = Math.max(seq, Number(m[1])); }
    },
    reset: () => { groups = []; dismissed = new Set(); picked = []; seq = 0; },
  });
  // (end)
}
