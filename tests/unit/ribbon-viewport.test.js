// NFR-UX-003 AC-641・AC-642・AC-579、FR-017 AC-643、FR-112 AC-644・AC-036 の単体・結合テスト。
// 実ブラウザの測定（AC-641）は tests/system/ribbon-viewport.test.js（E2E-280）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialCollapsed, RIBBON_COLLAPSE_BELOW_HEIGHT, RIBBON_STORAGE_KEY, mountRibbonToggle } from '../../web/src/ribbontoggle.js';
import { defaultLayout, applyTile, WORK_AREA_MIN_PCT, DIAGRAM_MIN_RATIO, COLLAPSED_H, SECONDARY_EXPANDED_RATIO, ops, parseLayout } from '../../web/src/layout.js';
import { DRAW_KEY_STEP } from '../../web/src/draw.js';
import { newApp, seedThreeScenes, toDetail, keyFor } from '../system/helpers.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const css = fs.readFileSync(path.join(WEB, 'styles', 'app.css'), 'utf8');

// NFR-UX-003 AC-642・AC-641: 保存がなければ窓の高さで決める（PARAM-155=0 は高さによる既定の折りたたみなし＝常に開いて始まる）。保存があれば窓の高さによらずそれに従う。壊れた値は既定へ
test('NFR-UX-003 AC-642 AC-641: 既定（PARAM-155=0 は高さで折りたたまず開く）・保存への追従・壊れた値', () => {
  assert.equal(RIBBON_COLLAPSE_BELOW_HEIGHT, 0);
  assert.equal(initialCollapsed(null, 768), false, '低い窓でも既定は開く（AC-660 の 1 段）');
  assert.equal(initialCollapsed(null, 599), false);
  assert.equal(initialCollapsed(null, 1200), false);
  assert.equal(initialCollapsed('1', 1200), true, '保存が折りたたみなら高い窓でも折りたたむ');
  assert.equal(initialCollapsed('0', 600), false, '保存が開くなら低い窓でも開く');
  for (const bad of ['', 'x', '{"a":1}', 'true']) assert.equal(initialCollapsed(bad, 768), false, `壊れた値 ${bad} は既定（開く）`);
  for (const bad of ['', 'x', 'true']) assert.equal(initialCollapsed(bad, 1000), false, `壊れた値 ${bad} は既定（開く）`);
});

function fakeDoc(height) {
  const mk = () => { const attrs = {}; const l = {}; return { attrs, dataset: {}, children: {}, textContent: '', setAttribute(k, v) { attrs[k] = v; }, addEventListener(e, f) { l[e] = f; }, click() { l.click(); }, querySelector(s) { return this.children[s] ?? null; } }; };
  const btn = mk(); btn.children['.ribbon-toggle-shape'] = mk(); btn.children['.ribbon-toggle-text'] = mk();
  const nav = mk();
  return { btn, nav, doc: { defaultView: { innerHeight: height }, querySelector: (s) => (s === '#ribbon-toggle' ? btn : s === '#toolbar' ? nav : null) } };
}
const memStorage = (init = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } }; };
const app = { t: (k) => k, subscribe() {} };

test('NFR-UX-003 AC-641・AC-642: 窓の高さ 768 でも開いて起動し、開閉を保存し、次の起動は保存に従う（PARAM-155=0）', () => {
  const st = memStorage();
  const a = fakeDoc(768);
  const r = mountRibbonToggle(app, a.doc, st);
  assert.equal(r.isCollapsed(), false, '高さで折りたたまない');
  assert.equal(a.nav.dataset.collapsed, 'false');
  a.btn.click();
  assert.equal(r.isCollapsed(), true);
  assert.equal(st.m.get(RIBBON_STORAGE_KEY), '1');
  const b = fakeDoc(1080); // 高い窓でも、保存の「折りたたみ」に従う
  assert.equal(mountRibbonToggle(app, b.doc, st).isCollapsed(), true);
  a.btn.click();
  assert.equal(r.isCollapsed(), false);
  assert.equal(st.m.get(RIBBON_STORAGE_KEY), '0');
  const b2 = fakeDoc(600); // 低い窓でも、保存の「開く」に従う
  assert.equal(mountRibbonToggle(app, b2.doc, st).isCollapsed(), false);
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

// FR-017 AC-643 AC-661 AC-662: 既定のタイルは、図が幅の全面（PARAM-157 の 50% 以上を満たす）、副次パネル（テキスト一覧・認識文字列）は図の下に横並びで折りたたみ。手で変えたレイアウトは尊重する
test('FR-017 AC-643 AC-661: 既定のタイルの図は幅の全面（≥ 50%）で、副次パネルは図の下に横並び。非表示・手動の配置は尊重', () => {
  assert.equal(DIAGRAM_MIN_RATIO, 0.5);
  assert.equal(WORK_AREA_MIN_PCT, 55);
  for (const W of [800, 1000, 1280, 1920]) {
    const l = defaultLayout({ w: W, h: 600 });
    assert.ok(l.panels.diagram.w >= W * 0.5 - 1, `幅 ${W}: 図 ${l.panels.diagram.w}`);
    assert.equal(l.panels.diagram.w, W, '図は幅の全面');
    assert.equal(l.panels.outline.w + l.panels.input.w, W, '副次パネルは図の下で幅を分け合う');
    assert.ok(l.panels.outline.w > 0 && l.panels.input.w > 0);
    assert.equal(l.panels.diagram.h + l.panels.outline.h, 600, '図と副次パネルで高さの全面');
    assert.equal(l.panels.outline.y, l.panels.diagram.h);
    assert.equal(l.panels.input.x, l.panels.outline.w, '認識文字列は右（FR-013）');
  }
  const two = defaultLayout({ w: 1000, h: 600 }); two.panels.input.visible = false; applyTile(two);
  assert.equal(two.panels.diagram.w, 1000); assert.equal(two.panels.outline.w, 1000);
  const one = defaultLayout({ w: 1000, h: 600 }); one.panels.input.visible = false; one.panels.outline.visible = false; applyTile(one);
  assert.equal(one.panels.diagram.w, 1000, '図だけなら全面'); assert.equal(one.panels.diagram.h, 600);
});

// FR-017 AC-662: 副次パネルは初期は折りたたみ（見出しの高さ）。展開・折りたたみは図の領域を占め直し、保存・復元・既定に戻すの対象
test('FR-017 AC-662: 副次パネルは初期は折りたたみ（≤ 20%）、展開・折りたたみは図を占め直し、保存して復元でき、既定に戻すと折りたたみに戻る', () => {
  const l = defaultLayout({ w: 1280, h: 600 });
  assert.equal(l.panels.outline.collapsed, true); assert.equal(l.panels.input.collapsed, true); assert.equal(l.panels.diagram.collapsed, false);
  assert.equal(l.panels.outline.h, COLLAPSED_H);
  assert.ok(COLLAPSED_H <= 600 * 0.2, '折りたたみは窓の高さの 20% 以下');
  assert.equal(ops.collapsed(l, 'outline', false), true);
  assert.ok(Math.abs(l.panels.outline.h - Math.round(600 * SECONDARY_EXPANDED_RATIO)) <= 1, '展開した高さ');
  assert.equal(l.panels.diagram.h + l.panels.outline.h, 600, '展開しても図は残りの全面');
  assert.equal(ops.collapsed(l, 'outline', false), false, '同じ状態は変更なし');
  assert.equal(ops.collapsed(l, 'diagram', true), false, '図は折りたたまない');
  assert.equal(ops.collapsed(l, 'nope', true), false);
  const back = parseLayout(JSON.stringify(l));
  assert.equal(back.panels.outline.collapsed, false, '保存・復元');
  assert.equal(back.panels.input.collapsed, true);
  const legacy = JSON.parse(JSON.stringify(defaultLayout({ w: 1000, h: 500 })));
  for (const id of Object.keys(legacy.panels)) delete legacy.panels[id].collapsed;
  assert.equal(parseLayout(JSON.stringify(legacy)).panels.input.collapsed, true, 'collapsed のない古いタイルは新しい既定で復元');
  legacy.kind = 'free';
  assert.equal(parseLayout(JSON.stringify(legacy)).panels.input.collapsed, false, '古い自由配置は変えない');
  ops.arrange(l, 'tile');
  assert.equal(l.panels.outline.collapsed, true, 'タイルに戻すと既定（折りたたみ）');
  ops.collapsed(l, 'input', false); ops.arrange(l, 'focus', 'diagram');
  assert.equal(l.kind, 'focus');
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
