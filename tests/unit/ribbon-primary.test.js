// NFR-UX-003 AC-645 / AC-646（PARAM-163 = 10px）の単体テスト。実ブラウザの測定は tests/system/ribbon-primary.test.js（E2E-281・E2E-282）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIAGRAM_MIN_TEXT_PX, minTextFontSize } from '../../web/src/diagram.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const css = fs.readFileSync(path.join(WEB, 'styles', 'app.css'), 'utf8');

// AC-645: 折りたたみの CSS は、リボン全体を隠さず、開始（session.start）と停止（session.stop）を残す
test('NFR-UX-003 AC-645: 折りたたみでリボン全体を display:none にせず（バーは visibility:hidden）、開始と停止のボタンを visible に残す', () => {
  assert.ok(!/\.commandbar\[data-collapsed="true"\]\s*\{\s*display:\s*none/.test(css), 'リボン全体を隠していない');
  assert.match(css, /\[data-collapsed="true"\] \.tooltip-host > \[data-command="session\.start"\][^{]*\{ visibility: visible/);
  assert.match(css, /\[data-collapsed="true"\][^{]*:not\(:has\(\[data-command="session\.start"\], \[data-command="session\.stop"\]\)\)/);
  assert.match(css, /\[data-collapsed="true"\][^{]*:not\(\[data-command="session\.start"\]\):not\(\[data-command="session\.stop"\]\)/);
});

// AC-646: 図の最小の文字の大きさの測定と、下限
test('NFR-UX-003 AC-646: PARAM-163 は 10px で、図の最小の文字の大きさを測る（空の文字は無視）', () => {
  assert.equal(DIAGRAM_MIN_TEXT_PX, 10);
  const mk = (sizes) => ({ querySelectorAll: () => sizes.map(([txt, fs]) => ({ textContent: txt, getAttribute: () => String(fs) })) });
  assert.equal(minTextFontSize(mk([['a', 16], ['1', 8.8], ['', 2]])), 8.8);
  assert.equal(minTextFontSize(mk([])), 0);
});
