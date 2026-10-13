// FR-008 AC-017 AC-018 / FR-011 AC-025 AC-026 AC-027 AC-028 / NFR-A11Y-001 AC-035 AC-036 AC-037 / NFR-OFFLINE-001 AC-031
// 単体・結合テスト（System Test と重ならない、モジュール単位と DOM 非依存の観点）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createI18n } from '../../web/src/i18n.js';
import * as L from '../../web/src/layout.js';
import { KEYMAP, matchKey } from '../../web/src/keymap.js';
import { renderOutline } from '../../web/src/outline.js';
import { createApp } from '../../web/src/app.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const CJK = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/;

function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, m };
}

test('FR-008 AC-018: addStrings は ja/en のキー集合が違うと拒否する', () => {
  const i = createI18n();
  assert.throws(() => i.addStrings({ ja: { a: 'あ' }, en: {} }));
  i.addStrings({ ja: { 'x.k': '値' }, en: { 'x.k': 'value' } });
  i.setLang('en');
  assert.equal(i.t('x.k'), 'value');
  assert.equal(i.setLang('fr'), false);
  assert.equal(i.lang, 'en');
});

test('FR-008 AC-018: 全コマンド名とパネル名に ja/en の文言がある', () => {
  const i = createI18n();
  const ja = i.getStrings();
  for (const k of KEYMAP) assert.ok(ja[`cmd.${k.command}`], k.command);
  i.setLang('en');
  for (const [k, v] of Object.entries(i.getStrings())) assert.doesNotMatch(v, CJK, k);
});

test('FR-011 AC-026: 壊れた・不完全なレイアウトは既定に戻る', () => {
  const d = JSON.stringify(L.defaultLayout());
  for (const bad of ['{x', 'null', '[]', '{"panels":{}}', JSON.stringify({ panels: { input: { x: 'a' } } })]) {
    assert.equal(JSON.stringify(L.parseLayout(bad)), d, bad);
  }
  const ok = L.defaultLayout(); ok.panels.input.x = 55;
  assert.equal(L.parseLayout(JSON.stringify(ok)).panels.input.x, 55);
});

test('FR-011 AC-025: 値の下限（負の位置・極小サイズ）は丸められ、最大化は表示を伴う', () => {
  const l = L.defaultLayout();
  L.ops.move(l, 'input', { x: -50, y: -1 });
  L.ops.resize(l, 'input', { w: 1, h: 1 });
  assert.deepEqual([l.panels.input.x, l.panels.input.y, l.panels.input.w, l.panels.input.h], [0, 0, L.MIN_W, L.MIN_H]);
  assert.equal(L.ops.move(l, 'input', { x: NaN, y: 1 }), false);
  L.ops.visible(l, 'outline', false);
  L.ops.maximized(l, 'outline', true);
  assert.equal(l.panels.outline.visible, true);
});

test('FR-011 AC-028: 画面幅が狭いと積み重ね、広いと自由配置', () => {
  assert.equal(L.layoutMode(L.NARROW_PX - 1), 'stacked');
  assert.equal(L.layoutMode(L.NARROW_PX), 'floating');
});

test('NFR-A11Y-001 AC-036: キー割り当てが重複せず、matchKey は修飾キーまで一致したときだけ当たる', () => {
  const combos = KEYMAP.map((k) => `${!!k.ctrl}${!!k.alt}${!!k.shift}${k.key.toLowerCase()}`);
  assert.equal(new Set(combos).size, combos.length);
  assert.equal(matchKey(KEYMAP, { key: 'R', altKey: true, shiftKey: true })?.command, 'session.start');
  assert.equal(matchKey(KEYMAP, { key: 'r' }), null);
});

test('NFR-A11Y-001 AC-035 AC-037: 一覧は図と同じ順序で、状態と選択中が文字でも示され、HTML は無害化される', () => {
  const scenes = [
    { id: 's1', heading: '<b>A</b>', points: [{ id: 'p1', text: '要点1' }], relations: [], status: 'confirmed' },
    { id: 's2', heading: 'B', points: [{ id: 'p2', text: '要点2' }], relations: [], status: 'in_progress' },
  ];
  const t = createI18n().t;
  const html = renderOutline(scenes, 's2', t);
  assert.ok(html.indexOf('s1') < html.indexOf('s2'));
  assert.ok(!html.includes('<b>A</b>'));
  assert.match(html, /確定/); assert.match(html, /進行中/); assert.match(html, /選択中/);
  assert.equal((html.match(/aria-current/g) || []).length, 1);
  assert.match(renderOutline([], null, t), /まだシーンがありません/);
});

test('NFR-A11Y-001 AC-035 FR-011 AC-025: 拡張点（modules・registerCommand・registerPanelRenderer）が使える', async () => {
  const seen = [];
  const app = await createApp({ storage: mem(), modules: [(ctx) => {
    ctx.registerCommand('save.svg', () => seen.push('svg'));
    ctx.registerPanelRenderer('diagram', () => {});
  }] });
  assert.equal(app.handleKey({ key: '2', altKey: true, shiftKey: true }), 'save.svg');
  assert.deepEqual(seen, ['svg']);
  assert.equal(typeof app.getPanelRenderer('diagram'), 'function');
  // 実装がまだ無いコマンド（後続の項目が足すと該当なしになる）は、キーを押しても実行されない
  const missing = app.keymap.find((k) => typeof app.commands[k.command] !== 'function');
  if (missing) assert.equal(app.handleKey({ key: missing.key, altKey: true, shiftKey: true }), null, '未実装のコマンドは実行しない');
});

test('FR-011 AC-028: 狭い画面では getLayoutMode が stacked になり、幅の変更に追従する', async () => {
  const app = await createApp({ storage: mem(), env: { viewportWidth: 400 } });
  assert.equal(app.getLayoutMode(), 'stacked');
  app.setViewportWidth(1200);
  assert.equal(app.getLayoutMode(), 'floating');
});

test('FR-011 AC-025: パネル操作はキー（layout.reset）でも戻せる。保存は grp. だけ', async () => {
  const st = mem();
  const app = await createApp({ storage: st });
  app.movePanel('input', { x: 9, y: 9 });
  app.handleKey({ key: '0', altKey: true, shiftKey: true });
  assert.deepEqual(app.getLayout(), (await createApp({ storage: mem() })).getLayout());
  assert.ok([...st.m.keys()].every((k) => k.startsWith('grp.')));
});

test('NFR-OFFLINE-001 AC-031: sw.js は外部オリジンに触れず、キャッシュ対象が実在する', () => {
  const sw = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');
  const list = [...sw.matchAll(/'(\.\/[^']*)'/g)].map((m) => m[1]);
  assert.ok(list.length >= 5);
  for (const f of list) if (f !== './') assert.ok(fs.existsSync(path.join(WEB, f)), f);
  assert.match(sw, /origin !== self\.location\.origin\) return/);
});

test('NFR-A11Y-001 AC-036: index.html は lang・viewport・スキップリンク・見出し付きのパネルを持つ', () => {
  const h = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(h, /<html lang="ja"/);
  assert.match(h, /name="viewport"/);
  assert.match(h, /class="skip-link"/);
  for (const id of ['input', 'diagram', 'outline']) assert.match(h, new RegExp(`data-panel="${id}"[^>]*aria-labelledby`));
});
