// FR-079 図の情報デザインによる自動再配置（何を・どこに）の規則（共通部品「情報デザインの規則」）。DOM・外部通信に依存しない純粋関数。
// 戦略コンサルタントのホワイトボーディングの原則（SRC-065）を、まとまりの中の並び・下位のまとまり・同一の要点のまとめ・間隔・揃えに落とす:
//   ピラミッド原則 = 結論をまとまりの読み順の先頭へ昇格（AC-426）、MECE = 要点はちょうど 1 つの種類に分類（AC-427）、
//   階層化 = 1 まとまりの要素数の上限 PARAM-088 を超えたら下位のまとまりへ分ける（AC-428）、同一の要点のまとめ（AC-429）、
//   近接・整列（AC-430）、コントラスト・反復の文字の大きさの階層（AC-431）。
// 全体の配置（話順・区画・放射状など）は各レイアウト型が決め、ここではまとまりの中だけを決める。
import { classifyPoint, kindLabelOf } from './diagram.js';

export const GROUP_MAX = 7; // PARAM-088: 1 つのまとまりの要素の数の上限
export const ALIGN_TOLERANCE_PX = 1; // PARAM-091: 整列の許容差（実装は同じ値で揃えるので差は 0）
// AC-426: 種類の順（結論・課題・提案・アイデア・未決定・補足）
export const KIND_ORDER = ['conclusion', 'issue', 'proposal', 'idea', 'undecided', 'note'];
// AC-431: 強調のない基準の文字の大きさの階層（コントラスト）。同じ階層は図のどこでも同じ大きさ（反復）。
export const TYPE_SCALE = Object.freeze({ title: 22, theme: 22, topic: 20, scene: 18, point: 14 });

// AC-427: どの要点もちょうど 1 つの種類（どの語にも当てはまらなければ補足）
export function kindOf(text) {
  const k = classifyPoint(text);
  return KIND_ORDER.includes(k) ? k : 'note';
}
export const kindRank = (kind) => { const i = KIND_ORDER.indexOf(kind); return i < 0 ? KIND_ORDER.length - 1 : i; };

// AC-429: 同一の判定（前後の空白、全角と半角の違いを除く）
export function sameTextKey(text) {
  return String(text ?? '').normalize('NFKC').trim();
}

// 1 シーンの要点 → 要素（同一の要点をまとめ、種類の順・同じ種類は話順に並べる）。
// points: [{id,text}]（話順）→ [{ key, refIds:[id…]（話順）, text, kind, count }]
export function pointItems(points) {
  const byKey = new Map(); const items = [];
  points.forEach((p, i) => {
    const k = sameTextKey(p.text);
    const hit = byKey.get(k);
    if (hit) { hit.refIds.push(p.id); hit.count += 1; return; }
    const it = { key: p.id, refIds: [p.id], text: p.text, kind: kindOf(p.text), count: 1, talk: i };
    byKey.set(k, it); items.push(it);
  });
  return items
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || a.talk - b.talk)
    .map(({ talk, ...it }) => it);
}

// 読み順で max 個以下ずつに分ける
export function chunk(list, max = GROUP_MAX) {
  const out = [];
  for (let i = 0; i < list.length; i += max) out.push(list.slice(i, i + max));
  return out;
}

// AC-428: 1 シーンの要素が max を超えるとき、種類ごとの下位のまとまり、なお超えるときは読み順で max 個以下ずつに分ける。
// 返り値（シーンの木）: { children: [node] }。node は { type:'point', key, refIds } か { type:'subgroup', key, kind, part, parts, children:[point node] }。
export function sceneTree(scene, max = GROUP_MAX) {
  const items = pointItems(scene.points ?? []);
  const leaf = (it) => ({ type: 'point', key: it.key, refIds: [...it.refIds] });
  if (items.length <= max) return { children: items.map(leaf) };
  const children = [];
  for (const kind of KIND_ORDER) {
    const of = items.filter((it) => it.kind === kind);
    if (!of.length) continue;
    const parts = chunk(of, max);
    parts.forEach((part, i) => children.push({ type: 'subgroup', key: `${scene.id}:${kind}:${i + 1}`, kind, part: i + 1, parts: parts.length, children: part.map(leaf) }));
  }
  return { children };
}

// AC-428: トピックのシーン（中項目・詳細）を、話順を保ったまま max 個以下ずつに分ける。max 以下なら分けない（null）。
export function topicChunks(sceneIds, max = GROUP_MAX) {
  return sceneIds.length > max ? chunk(sceneIds, max) : null;
}

// 暫定の木（AC-435・AC-432）: 前回の再配置の木（snap）の位置を保ち、その後に加わった要点を読み順の末尾（最後のまとまり）に足す。
// 削除された要点は外し、空になった要素・下位のまとまりは消す。snap がなければ話順のまま（まとめない）。
// 返り値の node には provisional（前回の再配置の後に加わった）を付ける。
export function provisionalTree(scene, snap) {
  const present = new Set((scene.points ?? []).map((p) => p.id));
  if (!snap) return { children: (scene.points ?? []).map((p) => ({ type: 'point', key: p.id, refIds: [p.id], provisional: true })), provisional: true };
  const seen = new Set();
  const keepLeaf = (n) => {
    const refIds = n.refIds.filter((id) => present.has(id));
    for (const id of refIds) seen.add(id);
    return refIds.length ? { type: 'point', key: refIds.includes(n.key) ? n.key : refIds[0], refIds, provisional: false } : null;
  };
  const children = [];
  for (const n of snap.children) {
    if (n.type === 'subgroup') {
      const kids = n.children.map(keepLeaf).filter(Boolean);
      if (kids.length) children.push({ ...n, children: kids });
    } else { const l = keepLeaf(n); if (l) children.push(l); }
  }
  const added = (scene.points ?? []).filter((p) => !seen.has(p.id)).map((p) => ({ type: 'point', key: p.id, refIds: [p.id], provisional: true }));
  if (added.length) {
    const last = children.at(-1);
    if (last && last.type === 'subgroup') last.children.push(...added); else children.push(...added);
  }
  return { children, provisional: false };
}

// 木の要点の要素を読み順（深さ優先）で並べる
export function leaves(tree) {
  return tree.children.flatMap((n) => (n.type === 'subgroup' ? n.children : [n]));
}

// 下位のまとまりの小見出し（種類のラベルと件数。分けたときは「1/2」の番号）
export function subgroupLabel(node, lang, count) {
  const name = kindLabelOf(node.kind, lang);
  const no = node.parts > 1 ? ` ${node.part}/${node.parts}` : '';
  return lang === 'en' ? `${name}${no} (${count})` : `${name}${no}（${count}）`;
}
// AC-429: まとめた件数の文字
export const countMark = (n) => (n > 1 ? `×${n}` : '');
