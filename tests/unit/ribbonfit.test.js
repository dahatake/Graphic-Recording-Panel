// NFR-UX-011 AC-660・FR-017 AC-661 AC-662 の単体テスト（リボンの縮退の段階の決め方・副次パネルの折りたたみのコマンド）。
// 実ブラウザの測定は tests/system/ribbon-onerow.test.js・diagram-fill.test.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseStages, FIT_STAGES, NARROW_MAX_WIDTH, mountRibbonFit } from '../../web/src/ribbonfit.js';
import { newApp } from '../system/helpers.js';

// 幅の見積り: グループ i が段階 s のときの幅（full > icons > menu）。合計が avail 以下なら収まる。
const widths = [[100, 60, 20], [200, 120, 20], [300, 150, 20], [250, 140, 20]];
const fitsIn = (avail) => (st) => st.reduce((s, v, i) => s + widths[i][v], 0) <= avail;

// NFR-UX-011 AC-660: 幅が足りないときは、右のグループから順にアイコンのみ → ドロップダウンへ段階的に縮退する
test('NFR-UX-011 AC-660: 収まるときは縮退せず、足りないときは右からアイコンのみ→ドロップダウン。窓を広げると元に戻る', () => {
  assert.deepEqual(FIT_STAGES, ['full', 'icons', 'menu']);
  assert.equal(NARROW_MAX_WIDTH, 640, 'PARAM-006 以下は縮退しない（縦積み）');
  assert.deepEqual(chooseStages(4, fitsIn(2000)), [0, 0, 0, 0], '収まるなら全部ラベルつき');
  assert.deepEqual(chooseStages(4, fitsIn(800)), [0, 0, 0, 1], '右のグループからアイコンのみ（850 → 740 で収まる）');
  assert.deepEqual(chooseStages(4, fitsIn(500)), [1, 1, 1, 1], '全部アイコンのみ（60+120+150+140=470）');
  assert.deepEqual(chooseStages(4, fitsIn(400)), [1, 1, 1, 2], 'まだ足りなければ右から順にドロップダウン');
  assert.deepEqual(chooseStages(4, fitsIn(300)), [1, 1, 2, 2]);
  assert.deepEqual(chooseStages(4, fitsIn(80)), [2, 2, 2, 2], '極端に狭いときは全部ドロップダウン');
  assert.deepEqual(chooseStages(4, fitsIn(10)), [2, 2, 2, 2], '収まらなくても段を増やさず、全部ドロップダウンで止める');
  assert.deepEqual(chooseStages(0, () => false), []);
  // 広げると元に戻る（毎回、元の表示から測り直す）
  assert.deepEqual(chooseStages(4, fitsIn(2000)), [0, 0, 0, 0]);
});

function fakeBar() {
  const calls = [];
  const bar = { dataset: {}, clientWidth: 1000, scrollWidth: 1000, querySelectorAll: () => [], addEventListener: (e) => calls.push(e), contains: () => false };
  const doc = { defaultView: { innerWidth: 1280, addEventListener: (e) => calls.push(`win:${e}`) }, addEventListener: (e) => calls.push(`doc:${e}`) };
  return { bar, doc, calls };
}

test('NFR-UX-011 AC-660: mountRibbonFit は開閉・キー・窓の操作を購読し、グループがなくても落ちない', () => {
  const { bar, doc, calls } = fakeBar();
  const r = mountRibbonFit(bar, doc);
  assert.equal(typeof r.refit, 'function');
  r.refit();
  assert.ok(calls.includes('click') && calls.includes('keydown') && calls.includes('doc:pointerdown') && calls.includes('win:resize'));
});

// FR-017 AC-662: 副次パネルの折りたたみ・展開は app のコマンドで行え、保存・復元・既定に戻すの対象（音声開始の一時展開は tests/system/panel-autoexpand.test.js）
test('FR-017 AC-662: 副次パネルは初期は折りたたみ。利用者の展開は保存・復元され、既定に戻すと折りたたみ', async () => {
  const { app, env, createApp } = await newApp();
  for (const id of ['outline', 'input']) assert.equal(app.getLayout().panels[id].collapsed, true, `${id}: 初期は折りたたみ`);
  assert.equal(app.getLayout().panels.diagram.collapsed, false);
  assert.equal(app.setPanelCollapsed('outline', false), true);
  assert.equal(app.getLayout().panels.outline.collapsed, false);
  const app2 = await createApp(env.options);
  assert.equal(app2.getLayout().panels.outline.collapsed, false, '展開は再読込後も復元される');
  assert.equal(app2.getLayout().panels.input.collapsed, true);
  app2.resetLayout();
  assert.equal(app2.getLayout().panels.outline.collapsed, true, '既定に戻すと折りたたみ');
  assert.equal(app2.setPanelCollapsed('diagram', true), false, '図は折りたたまない');
});
