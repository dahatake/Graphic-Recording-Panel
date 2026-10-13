// NFR-UX-002 の単体・結合テスト（AC-071 AC-072 AC-073）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../web/src/app.js';
import { GROUPS } from '../../web/src/commandbar.js';

const ui = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'src', 'ui.js'), 'utf8');

// NFR-UX-002 AC-071: GROUPS の全コマンドに、ja・en の説明文キーがある
test('NFR-UX-002 AC-071 AC-073: 全コマンドに tooltip.<command> が ja・en で定義されている', async () => {
  const app = await createApp({ env: {}, speechSource: { processLocally: true, start() {}, stop() {} } });
  const names = GROUPS.flatMap(([, n]) => n);
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    const s = app.getStrings();
    for (const n of names) assert.ok(s[`tooltip.${n}`]?.trim(), `${lang}:${n}`);
  }
});

// NFR-UX-002 AC-072: 表示は 1 つだけ。hover/focus は同文言、leave/blur で消える
test('NFR-UX-002 AC-072: 1 つだけ表示され、blur で消える', async () => {
  const app = await createApp({ env: {}, speechSource: { processLocally: true, start() {}, stop() {} } });
  const [a, b] = app.getCommandBar().items.map((i) => i.command);
  assert.equal(app.showTooltip(a, 'hover').text, app.showTooltip(a, 'focus').text);
  app.showTooltip(b, 'focus');
  assert.equal(app.getTooltip().command, b);
  app.hideTooltip(a, 'blur'); // 別ボタンの blur では消さない
  assert.equal(app.getTooltip().command, b);
  app.hideTooltip(b, 'blur');
  assert.equal(app.getTooltip(), null);
  assert.equal(app.showTooltip(a, 'bogus').visible, false);
});

// NFR-UX-002 AC-072: 画面は role=tooltip と aria-describedby で関連付ける
test('NFR-UX-002 AC-072: ui.js が role=tooltip と aria-describedby、focus/mouseenter を結ぶ', () => {
  assert.match(ui, /role', 'tooltip'/);
  assert.match(ui, /aria-describedby/);
  assert.match(ui, /'focus'/);
  assert.match(ui, /'mouseenter'/);
});
