// FR-017 AC-661（PARAM-177）: 状態欄のメッセージは折り返さず 1 行・省略記号。状態欄の高さは固定（過渡で図の領域を縮めない）。全文は title（ui.js）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WEB } from '../system/helpers.js';

const css = fs.readFileSync(path.join(WEB, 'styles/app.css'), 'utf8');
const ui = fs.readFileSync(path.join(WEB, 'src/ui.js'), 'utf8');
const rule = (sel) => css.split('\n').find((l) => l.startsWith(`${sel} {`)) ?? '';

test('FR-017 AC-661: .statusbar .message は white-space: nowrap・overflow: hidden・text-overflow: ellipsis', () => {
  const r = rule('.statusbar .message');
  assert.match(r, /white-space:\s*nowrap/); assert.match(r, /overflow:\s*hidden/); assert.match(r, /text-overflow:\s*ellipsis/);
});

test('FR-017 AC-661: 状態欄の高さは固定（height と overflow: hidden）', () => {
  const r = rule('.statusbar');
  assert.match(r, /\bheight:\s*3\.2rem/); assert.match(r, /overflow:\s*hidden/);
});

test('FR-017 AC-661: 状態欄のメッセージの全文を title に入れる', () => {
  assert.match(ui, /me\.title = mt/); assert.match(ui, /ise\.title = is\.text/);
});
