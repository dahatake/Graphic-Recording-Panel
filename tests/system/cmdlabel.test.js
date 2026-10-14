// NFR-UX-003 AC-090 AC-091（System Test。契約: CONTRACT.md「コマンドバーの常時ラベル」）
// 期待値は受入基準だけから決める（PARAM-011=6 全角/半角12、PARAM-012=1280px）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, CJK } from './helpers.js';

const MAX_FULL = 6; // PARAM-011
const WIDTH = 1280; // PARAM-012
const NEEDED = ['session.pause', 'session.stop', 'session.nextScene', 'input.focus', 'speech.start', 'save.png', 'save.svg', 'save.pdf',
  'view.2d', 'view.3d', 'presentation.start', 'layout.reset', 'data.reset', 'file.save', 'file.load'];
const items = (app) => app.getCommandBar().items;
const weight = (s) => [...s].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.5), 0);

// NFR-UX-003 AC-090
test('NFR-UX-003 AC-090: すべてのボタン（初期化・ファイル保存/読込を含む）に非空でボタンごとに異なるラベルが常に表示される', async () => {
  const { app } = await newApp();
  const list = items(app);
  const byCmd = new Map(list.map((i) => [i.command, i]));
  for (const c of NEEDED) assert.ok(byCmd.has(c), `${c} のボタンがある`);
  for (const it of list) {
    assert.ok(typeof it.label === 'string' && it.label.trim(), `${it.command} のラベルは非空`);
    assert.equal(it.labelVisible, true, `${it.command}: ホバー・フォーカスなしで見える`);
  }
  const labels = list.map((i) => i.label.trim());
  assert.equal(new Set(labels).size, labels.length, 'ラベルはボタンごとに異なる');
});

test('NFR-UX-003 AC-090: ラベルは 6 文字（全角換算）以内で、画面幅 1280px で 1 行に収まる', async () => {
  const { app } = await newApp();
  for (const it of items(app)) assert.ok(weight(it.label.trim()) <= MAX_FULL, `${it.command}: ${it.label}`);
  const lay = app.getCommandBarLayout({ viewportWidth: WIDTH });
  const byCmd = new Map(lay.items.map((i) => [i.command, i]));
  for (const it of items(app)) assert.equal(byCmd.get(it.command)?.labelLines, 1, `${it.command} は 1 行`);
});

test('NFR-UX-003 AC-090 異常系: 英語でも半角 12 文字以内・1 行・非空で、ボタンごとに異なる', async () => {
  const { app } = await newApp();
  app.setLang('en');
  const list = items(app);
  for (const it of list) {
    assert.ok(it.label.trim(), `${it.command} のラベルが空でない`);
    assert.ok([...it.label.trim()].length <= 12, `${it.command}: ${it.label}`);
  }
  assert.equal(new Set(list.map((i) => i.label.trim())).size, list.length);
  for (const i of app.getCommandBarLayout({ viewportWidth: WIDTH }).items) assert.equal(i.labelLines, 1, i.command);
});

// NFR-UX-003 AC-091
test('NFR-UX-003 AC-091: 日本語⇄英語の切替で全ラベルが切替後の言語になり、再生成を要さない', async () => {
  const { app } = await newApp();
  const ja = new Map(items(app).map((i) => [i.command, i.label]));
  app.setLang('en');
  const en = new Map(items(app).map((i) => [i.command, i.label]));
  for (const [c, l] of en) {
    assert.ok(!CJK.test(l), `${c}: 英語のラベルに日本語が残らない (${l})`);
    assert.notEqual(l, ja.get(c), `${c}: 切替で変わる`);
  }
  app.setLang('ja');
  for (const it of items(app)) assert.equal(it.label, ja.get(it.command), `${it.command}: 日本語に戻る`);
});

test('NFR-UX-003 AC-091: ラベルとアクセシブルな名前が一致し、ツールチップ（AC-071〜073）も従来どおり表示される（両言語）', async () => {
  const { app } = await newApp();
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    for (const it of items(app)) {
      assert.equal(it.accessibleName, it.label, `${lang} ${it.command}`);
      assert.ok(it.tooltip?.text?.trim(), `${it.command} の説明文がある`);
      const r = app.showTooltip(it.command, 'hover');
      assert.equal(r.visible, true);
      assert.equal(r.text, it.tooltip.text);
      assert.equal(it.describedBy, it.tooltip.id);
      app.hideTooltip(it.command, 'leave');
    }
  }
});
