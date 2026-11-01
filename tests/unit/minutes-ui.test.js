// FR-094 AC-553〜555 の画面操作（議事項目の一覧・候補の確定/却下/編集・項目の追加）の単体・結合テスト。契約: tests/system/CONTRACT-MEETING.md
// DOM は最小の偽物（minutes-ui.js が使う範囲だけ）で作る。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newApp } from '../system/helpers.js';
import { mountMinutesUI, KIND_FIELDS } from '../../web/src/minutes-ui.js';

class Node_ {
  constructor(tag) { this.tag = tag.toUpperCase(); this.tagName = this.tag; this.children = []; this.parent = null; this.attrs = {}; this.listeners = {}; this._text = ''; this.hidden = false; this._value = undefined; this.disabled = false; }
  get dataset() { const a = this.attrs; return new Proxy({}, { get: (_, k) => a[`data-${String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] }); }
  get parentElement() { return this.parent; }
  get firstChild() { return this.children[0] ?? null; }
  get className() { return this.attrs.class ?? ''; }
  set className(v) { this.attrs.class = v; }
  set type(v) { this.attrs.type = v; }
  get textContent() { return this.isText ? this._text : this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = []; this._text = String(v); }
  get options() { return this.children.filter((c) => c.tag === 'OPTION'); }
  get value() { if (this._value !== undefined) return this._value; if (this.tag === 'SELECT') return this.options[0]?.value ?? ''; return ''; }
  set value(v) { this._value = String(v); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  append(...cs) { for (const c of cs) { c.parent = this; this.children.push(c); } }
  addEventListener(n, f) { (this.listeners[n] ??= []).push(f); }
  focus() { this.doc.activeElement = this; }
  remove() { this.parent.children = this.parent.children.filter((c) => c !== this); }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  closest(sel) { for (let x = this; x && !x.isDoc; x = x.parent) if (x.matches?.(sel)) return x; return null; }
  matches(sel) {
    const m = [...sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    const tg = /^([a-z][\w-]*)/i.exec(sel);
    if (tg && this.tag !== tg[1].toUpperCase()) return false;
    const cls = /^\.([\w-]+)/.exec(sel);
    if (cls && !this.className.split(' ').includes(cls[1])) return false;
    return m.every(([, k, v]) => (v === undefined ? k in this.attrs : this.attrs[k] === v));
  }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) {
    const parts = sel.trim().split(/\s+/);
    return this.all().filter((n) => n.matches(parts.at(-1)) && (parts.length === 1 || parts.slice(0, -1).every((p) => { for (let x = n.parent; x; x = x.parent) if (x.matches?.(p)) return true; return false; })));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  fire(name, ev = {}) { const e = { target: this, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; }, ...ev }; for (let x = this; x; x = x.parent) { for (const f of x.listeners[name] ?? []) f(e); if (e.stopped) break; } return e; }
}
function fakeDoc() {
  const doc = { isDoc: true, activeElement: null, defaultView: null, mk(tag) { const n = new Node_(tag); n.doc = doc; return n; } };
  doc.createElement = (tag) => doc.mk(tag);
  doc.createTextNode = (s) => { const n = doc.mk('#text'); n.isText = true; n._text = String(s); return n; };
  const panel = doc.mk('section'); panel.setAttribute('class', 'panel'); panel.setAttribute('data-panel', 'outline');
  doc.querySelector = (sel) => (sel.startsWith('.panel') ? panel : null);
  doc.panel = panel;
  return doc;
}
const say = (app, env, text) => { app.setDraft(text); assert.equal(app.submitDraft().ok, true, text); env.tick(1); };
const btn = (root, act, id) => root.querySelectorAll('[data-minutes-act]').find((b) => b.attrs['data-minutes-act'] === act && (id === undefined || b.attrs['data-minutes-id'] === id));

async function setup(...texts) {
  const { app, env } = await newApp();
  app.commands['session.start']();
  for (const x of texts) say(app, env, x);
  const doc = fakeDoc();
  const ui = mountMinutesUI(app, doc);
  return { app, env, doc, ui, root: ui.getRoot() };
}

// FR-094 AC-553 / AC-555: 候補は文字「候補」＋枠つき記号で示し、確定・却下・編集のボタンを持つ（aria-label つき）
test('FR-094 AC-553 AC-555: 候補に「候補」の文字と記号があり、確定・却下・編集のボタンが aria-label つきで並ぶ', async () => {
  const { app, root } = await setup('リリースはA案に決まりました');
  const li = root.querySelectorAll('[data-state="candidate"]')[0];
  assert.ok(li, '候補の行');
  assert.match(li.textContent, /候補/);
  assert.ok(li.querySelector('[data-candidate-mark]').textContent.includes('□'));
  const id = li.attrs['data-minutes-id'];
  for (const [act, label] of [['confirm', '確定'], ['reject', '却下'], ['edit', '編集']]) {
    const b = btn(root, act, id);
    assert.ok(b, act); assert.equal(b.tag, 'BUTTON'); assert.equal(b.attrs.type, 'button');
    assert.ok(b.attrs['aria-label'].startsWith(label) && b.attrs['aria-label'].includes('A案'));
  }
  // 決定事項の理由・決定者は自動で補わず「未定」
  assert.equal(li.querySelectorAll('.minutes-undecided').length, 2);
  assert.ok(li.textContent.includes('未定'));
  assert.equal(app.getMeetingItems().decisions[0].reason, null);
});

test('FR-094 AC-553: 確定ボタンで確定し、候補の記号とボタン（確定・却下）が消える。却下ボタンで一覧から消える', async () => {
  const { app, root, ui } = await setup('A案に決まりました', 'コストが心配です');
  const [d] = app.getMeetingItems().decisions; const [o] = app.getMeetingItems().objections;
  btn(root, 'confirm', d.id).fire('click'); ui.sync(true);
  assert.equal(app.getMeetingItems().decisions[0].state, 'confirmed');
  const li = root.querySelectorAll('[data-minutes-id]').find((x) => x.tag === 'LI' && x.attrs['data-minutes-id'] === d.id);
  assert.equal(li.attrs['data-state'], 'confirmed');
  assert.equal(btn(root, 'confirm', d.id), undefined);
  btn(root, 'reject', o.id).fire('click'); ui.sync(true);
  assert.equal(app.getMeetingItems().objections.length, 0);
  assert.equal(root.querySelectorAll('li').some((x) => x.attrs['data-minutes-id'] === o.id), false);
});

// AC-554: 追加（種類・本文・種類ごとの欄。空欄は「未定」）
test('FR-094 AC-554: 項目を追加でき、アクション項目の担当者・期限・完了条件が空なら「未定」と表示し自動で補わない', async () => {
  const { app, doc, root, ui } = await setup();
  const form = root.querySelector('[data-minutes-add]');
  const f = (n) => form.querySelector(`[data-f="${n}"]`);
  assert.deepEqual([...f('kind').options].map((o) => o.value), ['decision', 'pending', 'objection', 'action']);
  assert.deepEqual([...f('kind').options].map((o) => o.textContent), ['決定事項', '保留事項', '異論・懸念', 'アクション項目']);
  f('kind').value = 'action'; f('kind').fire('change');
  assert.equal(f('assignee').parentElement.hidden, false);
  assert.equal(f('reason').parentElement.hidden, true);
  f('text').value = '見積を出す'; f('assignee').value = '佐藤';
  btn(root, 'add').fire('click'); ui.sync(true);
  const a = app.getMeetingItems().actions[0];
  assert.equal(a.state, 'confirmed'); assert.equal(a.assignee, '佐藤'); assert.equal(a.due, null); assert.equal(a.doneCriteria, null);
  const li = root.querySelectorAll('li').find((x) => x.attrs['data-minutes-id'] === a.id);
  assert.ok(li.textContent.includes('佐藤'));
  assert.equal(li.querySelectorAll('.minutes-undecided').filter((x) => x.textContent === '未定').length, 2);
  assert.equal(f('text').value, '', '追加後は入力欄を空にする');
  // 空の本文は追加しない
  btn(root, 'add').fire('click');
  assert.equal(app.getMeetingItems().actions.length, 1);
  assert.equal(doc.activeElement, f('text'));
  // 決定事項は理由・決定者
  assert.deepEqual(KIND_FIELDS.decision, ['reason', 'decider']);
  f('kind').value = 'decision'; f('kind').fire('change'); f('text').value = '予算は据え置き'; f('reason').value = '市況';
  btn(root, 'add').fire('click');
  assert.deepEqual([app.getMeetingItems().decisions[0].reason, app.getMeetingItems().decisions[0].decider], ['市況', null]);
});

// キーボード: Enter で保存・追加、Esc で取り消し、入力欄の中のキーは keymap に渡さない
test('FR-094 AC-555: 編集は Enter で保存・Esc で取り消し、追加は Enter。入力欄の中のキーは keymap に渡らず、Tab は妨げない', async () => {
  const { app, doc, root } = await setup('A案に決まりました');
  const d = app.getMeetingItems().decisions[0];
  btn(root, 'edit', d.id).fire('click');
  let form = root.querySelector('[data-minutes-edit]');
  assert.ok(form); assert.equal(doc.activeElement, form.querySelector('[data-f="text"]'), '編集を始めたら本文にフォーカス');
  let text = form.querySelector('[data-f="text"]');
  text.value = '書き換え中';
  // Esc: 取り消し（保存しない）、フォーカスは編集ボタンへ戻る
  let e = text.fire('keydown', { key: 'Escape' });
  assert.ok(e.stopped && e.prevented);
  assert.equal(root.querySelector('[data-minutes-edit]'), null);
  assert.equal(app.getMeetingItems().decisions[0].text, 'A案に決まりました');
  assert.equal(doc.activeElement, btn(root, 'edit', d.id));
  // Enter: 保存
  btn(root, 'edit', d.id).fire('click');
  form = root.querySelector('[data-minutes-edit]'); text = form.querySelector('[data-f="text"]');
  text.value = 'B案で進める'; form.querySelector('[data-f="reason"]').value = '安い';
  e = text.fire('keydown', { key: 'Enter' });
  assert.ok(e.stopped);
  const it = app.getMeetingItems().decisions[0];
  assert.deepEqual([it.text, it.reason], ['B案で進める', '安い']);
  assert.equal(root.querySelector('[data-minutes-edit]'), null);
  // 単独キー・Tab: 単独キーは keymap に渡さない（stopPropagation）。Tab は止めない
  const add = root.querySelector('[data-f="text"]');
  assert.ok(add.fire('keydown', { key: 'n' }).stopped);
  assert.equal(add.fire('keydown', { key: 'Tab' }).prevented, false);
  // 追加フォームの Enter
  add.value = '次回までに調べる'; root.querySelector('[data-f="kind"]').value = 'pending';
  add.fire('keydown', { key: 'Enter' });
  assert.equal(app.getMeetingItems().pendings[0].text, '次回までに調べる');
  // 空本文の保存は失敗し、編集を続ける
  btn(root, 'edit', d.id).fire('click');
  text = root.querySelector('[data-minutes-edit] [data-f="text"]'); text.value = '  ';
  text.fire('keydown', { key: 'Enter' });
  assert.ok(root.querySelector('[data-minutes-edit]'), '空のときは閉じない');
  assert.equal(app.getMeetingItems().decisions[0].text, 'B案で進める');
});

// 会議の文字列は escape（XSS）: DOM は textContent・value だけで作り、script 要素・属性への混入が起きない
test('FR-094 AC-557 NFR-A11Y-001: 会議の文字列は escape され、innerHTML を使わない（要素にならない）', async () => {
  const EVIL = '<img src=x onerror=alert(1)><script>alert(1)</script>に決まりました';
  const { app, root } = await setup(EVIL);
  assert.equal(root.querySelectorAll('script').length, 0);
  assert.equal(root.querySelectorAll('img').length, 0);
  const li = root.querySelectorAll('[data-state="candidate"]')[0];
  assert.ok(li.textContent.includes('<script>alert(1)</script>'), '文字としてそのまま表示');
  const id = li.attrs['data-minutes-id'];
  assert.ok(btn(root, 'edit', id).attrs['aria-label'].includes('<img'), '属性は setAttribute の値（解釈されない）');
  assert.equal(app.getMeetingItems().decisions[0].id, id);
  const src = fs.readFileSync(new URL('../../web/src/minutes-ui.js', import.meta.url), 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src.replace(/\/\/.*$/gm, '')), 'innerHTML を使わない');
});

// i18n（ja・en）と見た目の規則
test('NFR-PERF-003 AC-536: データを変えない操作（選択・ホバー）では、議事項目の抽出・全発話を複製する getState を再実行しない', async () => {
  const { app, ui } = await setup('Agreed: use plan A');
  ui.sync(true);
  let stateCalls = 0; let itemCalls = 0;
  const gs = app.getState; app.getState = (...a) => { stateCalls++; return gs.apply(app, a); };
  const gi = app.getMeetingItems; app.getMeetingItems = (...a) => { itemCalls++; return gi.apply(app, a); };
  for (let i = 0; i < 20; i++) ui.sync(); // 版数・言語が同じ（選択・ホバー相当）
  assert.equal(itemCalls, 0, '版数が変わらなければ抽出し直さない');
  assert.equal(stateCalls, 0, '全発話を複製する getState を毎回呼ばない');
});

// i18n（ja・en）と見た目の規則
test('FR-094 AC-555: 文言は ja・en の両方にあり、英語でも候補・ボタンが翻訳され、見た目は色だけに頼らず reduced motion に従う', async () => {
  const { app, root, ui } = await setup('Agreed: use plan A');
  app.setLang('en'); ui.sync(true);
  assert.equal(root.querySelector('[data-state="candidate"]').querySelector('[data-candidate-mark]').textContent.trim(), '□ Candidate');
  assert.ok(btn(root, 'confirm').textContent === 'Confirm' && btn(root, 'reject').textContent === 'Reject' && btn(root, 'edit').textContent === 'Edit');
  assert.equal(root.querySelector('[data-f="kind"]').options[3].textContent, 'Action items');
  app.setLang('ja'); ui.sync(true);
  assert.equal(btn(root, 'confirm').textContent, '確定');
  const css = fs.readFileSync(new URL('../../web/styles/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.minutes-editor \.minutes-item\[data-state="candidate"\] \{ border-style: dashed/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:focus-visible \{ outline: 3px solid var\(--color-focus\)/);
  assert.ok(!/transition|animation/.test(css.split('/* FR-094')[1].split('\n.tabs')[0]), '議事項目の見た目は動きを使わない');
});
