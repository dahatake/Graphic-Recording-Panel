// NFR-UX-002 AC-071 AC-072 AC-073（System Test。契約: tests/system/CONTRACT.md「コマンドバーのツールチップ」）
// 期待値は受入基準だけから決める。ホバー・フォーカス・言語切替でのツールチップ表示。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newApp, WEB } from './helpers.js';

const ICON_CMDS = ['session.pause', 'session.stop', 'session.nextScene', 'input.focus', 'save.png', 'save.svg', 'save.pdf',
  'view.2d', 'view.3d', 'presentation.start', 'layout.reset'];
const items = (app) => app.getCommandBar().items;

// NFR-UX-002 AC-071
test('NFR-UX-002 AC-071: コマンドバーのすべてのアイコンボタンに、非空でボタンごとに異なる説明文がある', async () => {
  const { app } = await newApp();
  const list = items(app);
  const byCmd = new Map(list.map((i) => [i.command, i]));
  for (const c of ICON_CMDS) assert.ok(byCmd.has(c), `${c} のボタンがある`);
  const texts = list.map((i) => {
    assert.ok(i.tooltip && typeof i.tooltip.text === 'string' && i.tooltip.text.trim(), `${i.command} に説明文がある`);
    return i.tooltip.text.trim();
  });
  assert.equal(new Set(texts).size, texts.length, '説明文はボタンごとに異なる');
});

test('NFR-UX-002 AC-071: ポインタを載せる（hover）と、そのボタンの説明文が表示される', async () => {
  const { app } = await newApp();
  for (const it of items(app)) {
    const r = app.showTooltip(it.command, 'hover');
    assert.equal(r.visible, true, it.command);
    assert.equal(r.text, it.tooltip.text);
    assert.deepEqual({ command: app.getTooltip().command, text: app.getTooltip().text }, { command: it.command, text: it.tooltip.text });
    app.hideTooltip(it.command, 'leave');
  }
});

test('NFR-UX-002 AC-071 異常系: 存在しないコマンドでは説明文を表示せず、ポインタが外れると消える', async () => {
  const { app } = await newApp();
  assert.equal(app.showTooltip('no.such.command', 'hover').visible, false);
  assert.equal(app.getTooltip(), null);
  const c = items(app)[0].command;
  app.showTooltip(c, 'hover');
  app.hideTooltip(c, 'leave');
  assert.equal(app.getTooltip(), null);
});

// NFR-UX-002 AC-072
test('NFR-UX-002 AC-072: フォーカスで hover と同じ説明文が出て、フォーカスが外れると消える', async () => {
  const { app } = await newApp();
  for (const it of items(app)) {
    const h = app.showTooltip(it.command, 'hover'); app.hideTooltip(it.command, 'leave');
    const f = app.showTooltip(it.command, 'focus');
    assert.equal(f.visible, true, it.command);
    assert.equal(f.text, h.text, 'hover と同じ文言');
    assert.equal(app.getTooltip().command, it.command);
    app.hideTooltip(it.command, 'blur');
    assert.equal(app.getTooltip(), null, `${it.command}: blur で消える`);
  }
});

test('NFR-UX-002 AC-072: 説明文は支援技術向けに aria-describedby で関連付けられる（id が一致し、ボタンごとに異なる）', async () => {
  const { app } = await newApp();
  const list = items(app);
  for (const it of list) {
    assert.ok(it.tooltip.id, `${it.command} に説明文の id がある`);
    assert.equal(it.describedBy, it.tooltip.id);
  }
  assert.equal(new Set(list.map((i) => i.tooltip.id)).size, list.length, 'id は重複しない');
});

test('NFR-UX-002 AC-072 異常系: 別ボタンへフォーカスが移ると前のボタンの説明文は残らず、1 つだけ表示される', async () => {
  const { app } = await newApp();
  const [a, b] = items(app).map((i) => i.command);
  app.showTooltip(a, 'focus'); app.hideTooltip(a, 'blur'); app.showTooltip(b, 'focus');
  assert.equal(app.getTooltip().command, b);
});

test('NFR-UX-002 AC-072: 静的な画面は role="tooltip" と aria-describedby を使う', () => {
  const src = ['index.html', ...fs.readdirSync(path.join(WEB, 'src')).map((f) => path.join('src', f))]
    .filter((f) => /\.(html|js)$/.test(f)).map((f) => fs.readFileSync(path.join(WEB, f), 'utf8')).join('\n');
  assert.ok(/role["'\]=\s]*tooltip/.test(src), 'role=tooltip がある');
  assert.ok(/aria-describedby/.test(src), 'aria-describedby がある');
});

// NFR-UX-002 AC-073
test('NFR-UX-002 AC-073: 表示言語を ja↔en に切り替えると、全ボタンの説明文が切替後の言語になる（再作成なし）', async () => {
  const { app } = await newApp();
  const ja = new Map(items(app).map((i) => [i.command, i.tooltip.text]));
  app.setLang('en');
  const en = new Map(items(app).map((i) => [i.command, i.tooltip.text]));
  for (const [c, t] of en) {
    assert.ok(t.trim(), c);
    assert.notEqual(t, ja.get(c), `${c}: 英語に切り替わる`);
    assert.ok(!/[\u3000-\u30ff\u3400-\u9fff]/.test(t), `${c}: 英語の説明文に日本語を含まない`);
  }
  app.setLang('ja');
  for (const it of items(app)) assert.equal(it.tooltip.text, ja.get(it.command), `${it.command}: 日本語に戻る`);
});

test('NFR-UX-002 AC-073: 説明文の表示中に言語を切り替えると、表示中の説明文も切替後の言語になる', async () => {
  const { app } = await newApp();
  const c = items(app)[0].command;
  app.showTooltip(c, 'hover');
  const before = app.getTooltip().text;
  app.setLang('en');
  const t = app.getTooltip();
  assert.ok(t && t.command === c);
  assert.notEqual(t.text, before);
  assert.equal(t.text, items(app).find((i) => i.command === c).tooltip.text);
});

test('NFR-UX-002 AC-073 異常系: 未対応の言語では説明文は現状の言語のまま空にならない', async () => {
  const { app } = await newApp();
  const before = items(app).map((i) => i.tooltip.text);
  try { app.setLang('fr'); } catch { /* 例外でも可 */ }
  assert.deepEqual(items(app).map((i) => i.tooltip.text), before);
});

test('NFR-UX-002 AC-073: 説明文の文言キー tooltip.<command> は ja と en で同一集合', async () => {
  const { app } = await newApp();
  const keys = () => Object.keys(app.getStrings()).filter((k) => k.startsWith('tooltip.')).sort();
  const ja = keys(); app.setLang('en'); const en = keys();
  assert.ok(ja.length > 0);
  assert.deepEqual(en, ja);
});
