// NFR-PERF-003 AC-540（integration）: 認識文字列の一覧とアウトラインの描画を、キー付きの差分更新にする。
// 最小の DOM（解析・挿入・削除・属性）を用意し、ui.js と同じ patchHtml で app の描画結果を当てて、ノードの同一性と変更の数を数える。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createApp } from '../../web/src/app.js';
import { patchHtml, keyOf } from '../../web/src/morph.js';

const SMALL = 100; // PARAM-005
const BIG = 5000; // PARAM-106

// ---- 最小の DOM（変更の回数を数える） ----
const counter = { n: 0 };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]));
class Node {
  constructor(nodeType, nodeName) { this.nodeType = nodeType; this.nodeName = nodeName; this.childNodes = []; this.parentNode = null; }
  get live() { let p = this; while (p) { if (p.isRoot) return true; p = p.parentNode; } return false; }
  insertBefore(node, ref) {
    if (this.live) counter.n += node.parentNode?.live ? 1 : size(node); // 移動は 1、新しいノードは部分木の数
    if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(node); else this.childNodes.splice(i, 0, node);
    node.parentNode = this;
    return node;
  }
  appendChild(node) { return this.insertBefore(node, null); }
  removeChild(node) {
    if (this.live) counter.n++;
    this.childNodes.splice(this.childNodes.indexOf(node), 1); node.parentNode = null; return node;
  }
  isEqualNode(o) {
    if (!o || o.nodeType !== this.nodeType || o.nodeName !== this.nodeName) return false;
    if (this.nodeType === 3) return this.nodeValue === o.nodeValue;
    if (this.attributes.length !== o.attributes.length || this.attributes.some((a) => o.getAttribute(a.name) !== a.value)) return false;
    return this.childNodes.length === o.childNodes.length && this.childNodes.every((c, i) => c.isEqualNode(o.childNodes[i]));
  }
}
class Text extends Node {
  constructor(v) { super(3, '#text'); this._v = v; }
  get nodeValue() { return this._v; }
  set nodeValue(v) { if (this.live) counter.n++; this._v = v; }
}
class Element extends Node {
  constructor(tag) { super(1, tag.toUpperCase()); this.attributes = []; }
  getAttribute(n) { return this.attributes.find((a) => a.name === n)?.value ?? null; }
  hasAttribute(n) { return this.attributes.some((a) => a.name === n); }
  setAttribute(n, v) { if (this.live) counter.n++; const a = this.attributes.find((x) => x.name === n); if (a) a.value = String(v); else this.attributes.push({ name: n, value: String(v) }); }
  removeAttribute(n) { if (this.live) counter.n++; this.attributes = this.attributes.filter((a) => a.name !== n); }
  get textContent() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join(''); }
  set innerHTML(html) { // template 用の簡易な解析（app の描画する HTML の範囲）
    this.content = new Node(11, '#document-fragment');
    const stack = [this.content];
    for (const m of html.matchAll(/<(\/?)([a-zA-Z0-9]+)((?:[^>"]|"[^"]*")*)>|([^<]+)/g)) {
      const top = stack[stack.length - 1];
      if (m[4] != null) { top.appendChild(new Text(decode(m[4]))); continue; }
      if (m[1]) { stack.pop(); continue; }
      const el = new Element(m[2]);
      for (const a of m[3].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) el.attributes.push({ name: a[1], value: decode(a[2] ?? '') });
      top.appendChild(el);
      if (!/^(br|img|hr|input)$/i.test(m[2]) && !/\/\s*$/.test(m[3])) stack.push(el);
    }
  }
}
const size = (n) => 1 + n.childNodes.reduce((s, c) => s + size(c), 0);
const doc = { createElement: (t) => new Element(t) };
const root = () => { const r = new Element('div'); r.isRoot = true; return r; };
const all = (n, out = []) => { for (const c of n.childNodes) { out.push(c); all(c, out); } return out; };
const items = (n) => all(n).filter((e) => e.nodeType === 1 && (e.hasAttribute('data-id') || e.hasAttribute('data-scene-id') || e.hasAttribute('data-point-id')));

async function measure(count) {
  let ctx;
  const app = await createApp({ now: () => 1_700_000_000_000, storage: { getItem: () => null, setItem() {} }, modules: [(c) => { ctx = c; }] });
  await app.commands['session.start']();
  const say = (t) => { if (ctx.addUtterance(t)) ctx.transcript.addFinals([t]); };
  for (let i = 0; i < count; i++) say(`発話${i} 予算とリリース計画について確認する`);
  const tr = root(); const ol = root();
  patchHtml(tr, app.renderTranscript(), doc);
  patchHtml(ol, app.renderOutline(), doc);
  const before = [...items(tr), ...items(ol)];
  assert.ok(before.length >= count, '既存の項目が DOM にある');
  counter.n = 0;
  say(`発話${count} 新しい論点として採用基準を決める`);
  patchHtml(tr, app.renderTranscript(), doc);
  patchHtml(ol, app.renderOutline(), doc);
  const changed = counter.n;
  // 差分更新の結果は、全置換したときと同じ DOM になる（表示は変わらない）
  for (const [el, html] of [[tr, app.renderTranscript()], [ol, app.renderOutline()]]) {
    const fresh = doc.createElement('template'); fresh.innerHTML = html;
    assert.equal(el.childNodes.length, fresh.content.childNodes.length);
    assert.ok(el.childNodes.every((c, i) => c.isEqualNode(fresh.content.childNodes[i])), '全置換と同じ内容');
  }
  const liveNow = new Set(all(tr).concat(all(ol)));
  const kept = before.filter((n) => liveNow.has(n)).length;
  return { changed, kept, before: before.length, after: items(tr).length + items(ol).length };
}

// NFR-PERF-003 AC-540: 5000 件で 1 件追加しても、既存の項目のノードは残り、変更の数は 100 件のときと同じ
test('NFR-PERF-003 AC-540: 発話 PARAM-106 件で 1 件追加しても既存ノードは作り直されず、追加・変更ノード数は PARAM-005 件のときと同じ', async () => {
  const small = await measure(SMALL);
  const big = await measure(BIG);
  assert.equal(small.kept, small.before, '100 件: 追加前の項目のノードがすべて残る');
  assert.equal(big.kept, big.before, '5000 件: 追加前の項目のノードがすべて残る');
  assert.ok(big.after > big.before, '追加した発話の項目が増えている');
  assert.ok(small.changed > 0);
  assert.equal(big.changed, small.changed, `追加・変更ノード数（100 件: ${small.changed}、5000 件: ${big.changed}）がデータ量に比例しない`);
});

// NFR-PERF-003 AC-540: 同じ HTML なら DOM に触れない（早期 return）。キーで並べ替え・削除にも追従する
test('NFR-PERF-003 AC-540: patchHtml は同じ HTML では何もせず、キーで既存ノードを再利用して並べ替え・削除する', () => {
  const r = root();
  patchHtml(r, '<ol><li data-id="a">A</li><li data-id="b">B</li><li data-id="c">C</li></ol>', doc);
  const [a, b, c] = r.childNodes[0].childNodes;
  counter.n = 0;
  assert.equal(patchHtml(r, '<ol><li data-id="a">A</li><li data-id="b">B</li><li data-id="c">C</li></ol>', doc), false);
  assert.equal(counter.n, 0);
  patchHtml(r, '<ol><li data-id="c">C</li><li data-id="a">A2</li></ol>', doc);
  const list = r.childNodes[0].childNodes;
  assert.deepEqual(list.map((n) => n.getAttribute('data-id')), ['c', 'a']);
  assert.equal(list[0], c); assert.equal(list[1], a); assert.equal(list[1].textContent, 'A2');
  assert.equal(b.parentNode, null, '消えたキーのノードは外す');
  assert.equal(keyOf(new Text('x')), null);
});

// NFR-PERF-003 AC-540 / AC-538: ui.js は認識文字列・アウトラインを全置換せず patchHtml で当て、データの版が同じなら再生成を呼ばない
test('NFR-PERF-003 AC-540 AC-538: ui.js は innerHTML の全置換をせず、版が変わらなければ再生成を呼ばない', () => {
  const ui = fs.readFileSync(new URL('../../web/src/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /patchHtml\(tr, html, doc\)/);
  assert.match(ui, /patchHtml\(o, app\.renderOutline\(\), doc\)/);
  assert.doesNotMatch(ui, /tr\.innerHTML = html|o\.innerHTML = html/);
  assert.match(ui, /fresh\(tr\)/);
  assert.match(ui, /fresh\(o\)/);
});

// NFR-PERF-003 AC-540: 内容が変わらないまとまり（data-chunk）は解析・比較を省き、変わったまとまりだけを当てる
test('NFR-PERF-003 AC-540: patchHtml は変わらないまとまりのノードを残し、変わったまとまりだけを更新する', () => {
  const r = root();
  const ch = (k, items) => `<ul data-chunk="${k}">${items.map((i) => `<li data-point-id="${i}">${i}</li>`).join('')}</ul>`;
  patchHtml(r, `<div>${ch('s:0', ['a', 'b'])}${ch('s:1', ['c'])}</div>`, doc);
  const [c0, c1] = r.childNodes[0].childNodes;
  patchHtml(r, `<div>${ch('s:0', ['a', 'b'])}${ch('s:1', ['c', 'd'])}</div>`, doc);
  const [n0, n1] = r.childNodes[0].childNodes;
  assert.equal(n0, c0); assert.equal(n1, c1);
  assert.equal(n0.childNodes.length, 2); assert.equal(n1.childNodes.length, 2);
  assert.equal(n0.hasAttribute('data-chunk-keep'), false);
});
