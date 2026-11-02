// NFR-UX-003 AC-641・AC-642・AC-579、FR-017 AC-643、FR-112 AC-644・AC-036 の単体・結合テスト。
// 実ブラウザの測定（AC-641）は tests/system/ribbon-viewport.test.js（E2E-280）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialCollapsed, RIBBON_COLLAPSE_BELOW_HEIGHT, RIBBON_STORAGE_KEY, mountRibbonToggle } from '../../web/src/ribbontoggle.js';
import { defaultLayout, applyTile, WORK_AREA_MIN_PCT, DIAGRAM_MIN_RATIO } from '../../web/src/layout.js';
import { DRAW_KEY_STEP } from '../../web/src/draw.js';
import { newApp, seedThreeScenes, toDetail, keyFor } from '../system/helpers.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const css = fs.readFileSync(path.join(WEB, 'styles', 'app.css'), 'utf8');

// NFR-UX-003 AC-642: 保存がなければ窓の高さで決め、保存があれば窓の高さによらずそれに従う。壊れた値は既定へ
test('NFR-UX-003 AC-642: 既定（PARAM-155=900 未満で折りたたみ）・保存への追従・壊れた値', () => {
  assert.equal(RIBBON_COLLAPSE_BELOW_HEIGHT, 900);
  assert.equal(initialCollapsed(null, 768), true);
  assert.equal(initialCollapsed(null, 899), true);
  assert.equal(initialCollapsed(null, 900), false);
  assert.equal(initialCollapsed(null, 1200), false);
  assert.equal(initialCollapsed('1', 1200), true, '保存が折りたたみなら高い窓でも折りたたむ');
  assert.equal(initialCollapsed('0', 600), false, '保存が開くなら低い窓でも開く');
  for (const bad of ['', 'x', '{"a":1}', 'true']) assert.equal(initialCollapsed(bad, 768), true, `壊れた値 ${bad} は既定（低い窓で折りたたみ）`);
  for (const bad of ['', 'x', 'true']) assert.equal(initialCollapsed(bad, 1000), false, `壊れた値 ${bad} は既定（高い窓で開く）`);
});

function fakeDoc(height) {
  const mk = () => { const attrs = {}; const l = {}; return { attrs, dataset: {}, children: {}, textContent: '', setAttribute(k, v) { attrs[k] = v; }, addEventListener(e, f) { l[e] = f; }, click() { l.click(); }, querySelector(s) { return this.children[s] ?? null; } }; };
  const btn = mk(); btn.children['.ribbon-toggle-shape'] = mk(); btn.children['.ribbon-toggle-text'] = mk();
  const nav = mk();
  return { btn, nav, doc: { defaultView: { innerHeight: height }, querySelector: (s) => (s === '#ribbon-toggle' ? btn : s === '#toolbar' ? nav : null) } };
}
const memStorage = (init = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
const app = { t: (k) => k, subscribe() {} };

test('NFR-UX-003 AC-641・AC-642: 窓の高さ 768 で折りたたんで起動し、開閉を保存し、次の起動は保存に従う', () => {
  const st = memStorage();
  const a = fakeDoc(768);
  const r = mountRibbonToggle(app, a.doc, st);
  assert.equal(r.isCollapsed(), true);
  assert.equal(a.nav.dataset.collapsed, 'true');
  a.btn.click();
  assert.equal(r.isCollapsed(), false);
  assert.equal(st.m.get(RIBBON_STORAGE_KEY), '0');
  const b = fakeDoc(768); // 同じ低い窓でも、保存の「開く」に従う
  assert.equal(mountRibbonToggle(app, b.doc, st).isCollapsed(), false);
  const c = fakeDoc(1080); // 高い窓で、保存の「折りたたみ」に従う
  const st2 = memStorage({ [RIBBON_STORAGE_KEY]: '1' });
  assert.equal(mountRibbonToggle(app, c.doc, st2).isCollapsed(), true);
  const d = fakeDoc(1080); // 保存の値が壊れていても既定で起動し、保存が書けなくても動く
  const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
  const rd = mountRibbonToggle(app, d.doc, broken);
  assert.equal(rd.isCollapsed(), false);
  d.btn.click();
  assert.equal(rd.isCollapsed(), true);
});

test('NFR-UX-003 AC-579: 開閉ボタンは窓の高さによらず表示され、折りたたみは CSS が常に効く', () => {
  assert.match(css, /\.ribbon-toggle \{ display: inline-flex;/);
  assert.match(css, /\.commandbar\[data-collapsed="true"\] \{ visibility: hidden;/); // AC-645: 主操作ボタンだけ visible に戻す（display:none にしない）
  assert.match(css, /body \{ overflow-y: auto; \}/);
});

// FR-017 AC-643: 既定のタイルで図のパネルは幅の PARAM-157（50）% 以上。手で変えたレイアウトは尊重する
test('FR-017 AC-643: 既定のタイルの図は幅の 50% 以上、残りをテキスト一覧と認識文字列で分ける。非表示・手動の配置は尊重', () => {
  assert.equal(DIAGRAM_MIN_RATIO, 0.5);
  assert.equal(WORK_AREA_MIN_PCT, 55);
  for (const W of [800, 1000, 1280, 1920]) {
    const l = defaultLayout({ w: W, h: 600 });
    assert.ok(l.panels.diagram.w >= W * 0.5 - 1, `幅 ${W}: 図 ${l.panels.diagram.w}`);
    const sum = ['diagram', 'outline', 'input'].reduce((s, id) => s + l.panels[id].w, 0);
    assert.equal(sum, W, '隙間なく占める');
    assert.ok(l.panels.outline.w > 0 && l.panels.input.w > 0);
  }
  const two = defaultLayout({ w: 1000, h: 600 }); two.panels.input.visible = false; applyTile(two);
  assert.ok(two.panels.diagram.w >= 500 && two.panels.diagram.w + two.panels.outline.w === 1000);
  const one = defaultLayout({ w: 1000, h: 600 }); one.panels.input.visible = false; one.panels.outline.visible = false; applyTile(one);
  assert.equal(one.panels.diagram.w, 1000, '図だけなら全幅');
});

test('FR-017 AC-643 異常系: 手で動かした（free）レイアウトは作業領域の変更でタイルに戻されない', async () => {
  const { app } = await newApp();
  app.movePanel('diagram', { x: 30, y: 40 });
  app.setWorkArea(1200, 700);
  assert.equal(app.getLayout().kind, 'free');
  assert.equal(app.getLayout().panels.diagram.x, 30);
});

// FR-112 AC-644・AC-036: キーボードで線を描く。1 回の矢印は PARAM-160 = 8
test('FR-112 AC-644 AC-036: モード中の矢印キーは 8 ずつ動き、Space で開始・終了、Esc で取りやめ。入力欄・ボタンの操作・モードオフでは何もしない', async () => {
  assert.equal(DRAW_KEY_STEP, 8);
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  const k = (key, extra = {}) => app.handleKey({ key, code: key === ' ' ? 'Space' : key, ctrlKey: false, altKey: false, shiftKey: false, ...extra });
  assert.equal(k('ArrowRight'), null, 'オフでは矢印を横取りしない');
  app.handleKey(keyFor(app, 'draw.toggle'));
  assert.equal(k('ArrowRight', { inTextInput: true }), null, '入力欄では横取りしない');
  assert.equal(k(' ', { inControl: true }), null, 'ボタンの Space は横取りしない');
  k(' ');
  const x0 = app.getDrawCursor().x; const y0 = app.getDrawCursor().y;
  assert.equal(app.getDrawCursor().penDown, true);
  k('ArrowRight'); k('ArrowRight'); k('ArrowDown');
  assert.equal(app.getDrawCursor().x, x0 + 16); assert.equal(app.getDrawCursor().y, y0 + 8);
  k('ArrowRight', { shiftKey: true });
  assert.equal(app.getDrawCursor().x, x0 + 16 + 32, 'Shift で 4 倍');
  k(' ');
  const s = app.getStrokes().at(-1);
  assert.equal(s.points.length, 5);
  assert.deepEqual([s.points[1].x - s.points[0].x, s.points[2].x - s.points[1].x], [8, 8]);
  k('Enter'); k('ArrowLeft'); k('Escape');
  assert.equal(app.getStrokes().length, 1, 'Esc で描きかけは残らない');
  assert.equal(app.getDrawCursor().penDown, false);
  k('ArrowLeft'); k('ArrowLeft'); k('ArrowLeft'); k('ArrowLeft'); k('ArrowLeft'); k('ArrowLeft'); k('ArrowLeft'); k('ArrowLeft');
  assert.ok(app.getDrawCursor().x >= 0, 'カーソルは負にならない');
  app.handleKey(keyFor(app, 'draw.toggle'));
  assert.equal(app.getDrawCursor(), null, 'モードオフでカーソルなし');
});
