// FR-017 AC-083 AC-085 AC-087 の単体・結合テスト（レイアウトの純粋関数と保存・復元）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../../web/src/layout.js';

const vis = (l) => Object.entries(l.panels).filter(([, p]) => p.visible);
const areaSum = (l) => vis(l).reduce((s, [, p]) => s + p.w * p.h, 0);

// FR-017 AC-083
test('FR-017 AC-083: 既定のレイアウトは作業領域を隙間なく占め、非表示にしても空きを埋める', () => {
  const l = L.defaultLayout();
  assert.equal(l.kind, 'tile');
  assert.equal(areaSum(l), l.workArea.w * l.workArea.h);
  L.ops.visible(l, 'outline', false);
  assert.equal(areaSum(l), l.workArea.w * l.workArea.h);
  L.ops.visible(l, 'input', false);
  assert.equal(l.panels.diagram.w, l.workArea.w);
});

// FR-017 AC-085
test('FR-017 AC-085: フォーカスはメインが PARAM-009 の 75%、残りは均等。不正なパネルは変更しない', () => {
  const l = L.defaultLayout();
  assert.equal(L.ops.arrange(l, 'focus', 'input'), true);
  const total = l.workArea.w * l.workArea.h;
  assert.ok(Math.abs(l.panels.input.w * l.panels.input.h / total - L.FOCUS_RATIO) < 1e-9);
  assert.equal(L.FOCUS_RATIO, 0.75);
  assert.ok(Math.abs(l.panels.diagram.h - l.panels.outline.h) < 1e-9);
  const before = JSON.stringify(l);
  assert.equal(L.ops.arrange(l, 'focus', 'nope'), false);
  assert.equal(L.ops.arrange(l, 'bogus'), false);
  assert.equal(JSON.stringify(l), before);
});

// FR-017 AC-083 AC-085
test('FR-017 AC-083 AC-085: 作業領域の大きさが変わるとタイル・フォーカスは再計算され、自由配置は変えない', () => {
  const l = L.defaultLayout();
  assert.equal(L.ops.workArea(l, 1200, 700), true);
  assert.equal(areaSum(l), 1200 * 700);
  L.ops.arrange(l, 'focus', 'diagram');
  L.ops.workArea(l, 900, 500);
  assert.ok(Math.abs(l.panels.diagram.w * l.panels.diagram.h - 0.75 * 900 * 500) < 1e-6);
  L.ops.move(l, 'diagram', { x: 5, y: 5 });
  assert.equal(l.kind, 'free');
  const snap = JSON.stringify(l.panels);
  L.ops.workArea(l, 1000, 600);
  assert.equal(JSON.stringify(l.panels), snap);
  assert.equal(L.ops.workArea(l, 10, 10), false);
});

// FR-017 AC-087
test('FR-017 AC-087: フォーカス・タイルの種類とメインは保存・復元され、狭い画面は積み重ね（FR-011 AC-028）', () => {
  const l = L.defaultLayout();
  L.ops.arrange(l, 'focus', 'outline');
  const back = L.parseLayout(JSON.stringify(l));
  assert.equal(back.kind, 'focus');
  assert.equal(back.mainPanel, 'outline');
  assert.deepEqual(back.panels, l.panels);
  assert.equal(L.parseLayout(JSON.stringify({ ...l, kind: 'zzz', mainPanel: 'q' })).kind, 'free');
  assert.equal(L.layoutMode(L.NARROW_PX - 1), 'stacked');
});
