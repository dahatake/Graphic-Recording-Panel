// NFR-PERF-003 AC-540: 認識文字列の一覧・アウトラインのキー付き差分更新。
// 新しい HTML を template で解析し、いまの DOM との差分だけを当てる（innerHTML の全置換をしない）。
// 子の対応づけ: キー（発話 ID・シーン ID・要点 ID・まとまり ID・関係の組）があればキーで、なければ同じ種類の要素の出現順で。
// 変わっていない項目のノードはそのまま残し（同一性を保つ）、追加・変更されるノードの数はデータ量に比例しない。
// DOM の標準の API（childNodes・insertBefore・removeChild・attributes・isEqualNode）だけを使う。

const KEY_ATTRS = ['data-chunk', 'data-id', 'data-scene-id', 'data-point-id', 'data-group-id', 'data-kind'];

// まとまりの要素（ul・ol）は入れ子にならず、最初の閉じタグで終わる
const CHUNK_RE = /<(ul|ol) [^>]*?data-chunk="([^"]*)"[^>]*>[\s\S]*?<\/\1>/g;

// 要素のキー。data-kind は認識文字列の暫定・確定の区別（data-id のない暫定結果を 1 つに対応づける）
export function keyOf(node) {
  if (node.nodeType !== 1) return null;
  for (const a of KEY_ATTRS) {
    const v = node.getAttribute(a);
    if (v != null && (a !== 'data-kind' || !node.hasAttribute('data-id'))) return `${node.nodeName}|${a}=${v}`;
  }
  const from = node.getAttribute('data-relation-from');
  if (from != null) return `${node.nodeName}|rel=${from}>${node.getAttribute('data-relation-to')}:${node.getAttribute('data-relation-kind')}`;
  return null;
}

function syncAttributes(oldEl, newEl) {
  for (const { name } of [...oldEl.attributes]) if (!newEl.hasAttribute(name)) oldEl.removeAttribute(name);
  for (const { name, value } of [...newEl.attributes]) if (oldEl.getAttribute(name) !== value) oldEl.setAttribute(name, value);
}

function sameKind(a, b) { return a.nodeType === b.nodeType && a.nodeName === b.nodeName; }

// old を new と同じ内容にする（old のノードは残す）
function morphNode(oldNode, newNode) {
  if (oldNode.nodeType !== 1) {
    if (oldNode.nodeValue !== newNode.nodeValue) oldNode.nodeValue = newNode.nodeValue;
    return;
  }
  if (newNode.hasAttribute('data-chunk-keep')) return;
  if (oldNode.isEqualNode(newNode)) return;
  syncAttributes(oldNode, newNode);
  morphChildren(oldNode, newNode);
}

// oldParent の子を newParent の子と同じ並びにする。newParent の子は、新しく足すものだけ oldParent へ移る
export function morphChildren(oldParent, newParent) {
  const olds = [...oldParent.childNodes];
  const news = [...newParent.childNodes];
  const keyed = new Map();
  for (const o of olds) { const k = keyOf(o); if (k != null && !keyed.has(k)) keyed.set(k, o); }
  const used = new Set();
  let cursor = 0; // キーのない古い子を出現順に対応づけるための位置
  news.forEach((n, i) => {
    const k = keyOf(n);
    let match = null;
    if (k != null) {
      const o = keyed.get(k);
      if (o && !used.has(o)) match = o;
    } else {
      for (let j = cursor; j < olds.length; j++) {
        const o = olds[j];
        if (!used.has(o) && keyOf(o) == null && sameKind(o, n)) { match = o; cursor = j + 1; break; }
      }
    }
    const at = oldParent.childNodes[i] ?? null;
    if (match) {
      used.add(match);
      morphNode(match, n);
      if (match !== at) oldParent.insertBefore(match, at);
    } else {
      oldParent.insertBefore(n, at);
    }
  });
  for (const o of olds) if (!used.has(o) && o.parentNode === oldParent) oldParent.removeChild(o);
}

// container の中身を html にする。前回と同じ HTML なら何もしない（早期 return）。変わったら差分だけを当てる。
export function patchHtml(container, html, doc = container.ownerDocument) {
  if (container._html === html) return false;
  // 内容が変わっていないまとまり（data-chunk）は解析も比較もせず、空の目印に置き換えて既存のノードを残す
  const prev = container._chunks;
  const chunks = new Map();
  const slim = html.replace(CHUNK_RE, (m, tag, key) => {
    chunks.set(key, m);
    return prev && prev.get(key) === m ? `<${tag} data-chunk="${key}" data-chunk-keep></${tag}>` : m;
  });
  const tpl = doc.createElement('template');
  tpl.innerHTML = slim;
  morphChildren(container, tpl.content);
  container._chunks = chunks;
  container._html = html;
  return true;
}
