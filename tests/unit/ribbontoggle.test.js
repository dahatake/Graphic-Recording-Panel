// NFR-UX-003 AC-579（PARAM-130 = 窓の高さ 600px）: 窓の高さが小さいときのリボンの開閉と、パネル領域に重ならない条件。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RIBBON_COMPACT_MAX_HEIGHT, isCompactHeight, ribbonToggleView, mountRibbonToggle } from '../../web/src/ribbontoggle.js';
import { createI18n } from '../../web/src/i18n.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const css = fs.readFileSync(path.join(WEB, 'styles', 'app.css'), 'utf8');
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');

test('NFR-UX-003 AC-579: 境は PARAM-130 = 600px で、CSS の @media と一致する', () => {
  assert.equal(RIBBON_COMPACT_MAX_HEIGHT, 600);
  assert.ok(isCompactHeight(540) && isCompactHeight(600) && !isCompactHeight(601) && !isCompactHeight(900));
  assert.match(css, /@media \(max-height: 600px\)/);
});

test('NFR-UX-003 AC-579: 状態は文字・形・aria-expanded で示す（色だけに頼らない）', () => {
  const i = createI18n();
  for (const lang of ['ja', 'en']) {
    i.setLang(lang);
    const open = ribbonToggleView(false, i.t);
    const shut = ribbonToggleView(true, i.t);
    assert.equal(open.ariaExpanded, 'true'); assert.equal(shut.ariaExpanded, 'false');
    assert.notEqual(open.text, shut.text); assert.notEqual(open.shape, shut.shape);
    assert.ok(open.text && shut.text && !open.text.startsWith('ribbon.'));
  }
});

function fakeDoc() {
  const mk = () => {
    const attrs = {}; const l = {};
    return { attrs, dataset: {}, children: {}, textContent: '', setAttribute(k, v) { attrs[k] = v; }, addEventListener(e, f) { l[e] = f; }, click() { l.click(); }, querySelector(s) { return this.children[s] ?? null; } };
  };
  const btn = mk(); btn.children['.ribbon-toggle-shape'] = mk(); btn.children['.ribbon-toggle-text'] = mk();
  const nav = mk();
  return { btn, nav, doc: { querySelector: (s) => (s === '#ribbon-toggle' ? btn : s === '#toolbar' ? nav : null) } };
}

test('NFR-UX-003 AC-579: ボタンの操作で折りたたみ・展開し、aria-expanded と対象の状態が変わる（キーボードの Enter・Space は button の click）', () => {
  const i = createI18n();
  const { btn, nav, doc } = fakeDoc();
  const m = mountRibbonToggle({ t: i.t, subscribe() {} }, doc);
  assert.equal(btn.attrs['aria-expanded'], 'true'); assert.equal(nav.dataset.collapsed, 'false');
  assert.equal(btn.attrs['aria-controls'], 'toolbar');
  btn.click();
  assert.equal(btn.attrs['aria-expanded'], 'false'); assert.equal(nav.dataset.collapsed, 'true'); assert.equal(m.isCollapsed(), true);
  assert.equal(btn.children['.ribbon-toggle-shape'].textContent, '▼');
  btn.click();
  assert.equal(btn.attrs['aria-expanded'], 'true'); assert.equal(nav.dataset.collapsed, 'false');
});

test('NFR-UX-003 AC-579: 折りたたみ中に言語を切り替えても、文字は「開く」で aria-expanded=false と一致する（data-i18n で上書きしない）', () => {
  assert.doesNotMatch(html, /id="ribbon-toggle"[\s\S]*?data-i18n="ribbon\.toggle/);
  const i = createI18n();
  const { btn, doc } = fakeDoc();
  let notify = () => {};
  mountRibbonToggle({ t: i.t, subscribe(f) { notify = f; } }, doc);
  btn.click();
  for (const lang of ['en', 'ja']) {
    i.setLang(lang); notify();
    assert.equal(btn.attrs['aria-expanded'], 'false');
    assert.equal(btn.children['.ribbon-toggle-text'].textContent, i.t('ribbon.toggle.show'));
  }
});

test('NFR-UX-003 AC-579: 低い窓ではリボンの高さに上限（スクロール）があり、折りたたみは低い窓でだけ効く（重ならない・広い窓に影響しない）', () => {
  const block = /@media \(max-height: 600px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  assert.match(block, /\.commandbar \{[^}]*max-height: 40vh[^}]*overflow-y: auto/);
  assert.match(block, /\.commandbar\[data-collapsed="true"\] \{ display: none; \}/);
  assert.match(block, /\.ribbon-toggle \{ display: inline-flex; \}/);
  assert.doesNotMatch(css.replace(block, ''), /data-collapsed/);
  assert.match(css, /\.ribbon-toggle \{ display: none;/);
  // リボンはフロー内（static/relative）で、固定・絶対配置にしない
  assert.doesNotMatch(css, /\.commandbar \{[^}]*position: (fixed|absolute|sticky)/);
});

test('NFR-UX-003 AC-579: ボタンはネイティブ button（Tab で到達・Enter/Space で操作）で、リボンの直前にあり、リボンの項目数・重複を変えない', () => {
  assert.match(html, /<button type="button" id="ribbon-toggle"[^>]*aria-expanded="true"/);
  assert.ok(html.indexOf('id="ribbon-toggle"') < html.indexOf('id="toolbar"'));
  assert.ok(!/<nav id="toolbar"[^>]*>[^<]*<button/.test(html)); // #toolbar の中身は ui.js が作る（AC-417・AC-519・AC-520）
});
