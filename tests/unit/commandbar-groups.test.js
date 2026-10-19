// NFR-UX-011 AC-463 AC-464（integration）: 作業順グループへの再編でも、ボタンの集合・ラベル・ツールチップ・操作が変わらず、
// 狭い画面でも見出しがボタン・他の見出しと重ならない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';
import { GROUPS, ICONS, labelKey } from '../../web/src/commandbar.js';

const mk = () => createApp({ env: {}, storage: { getItem: () => null, setItem() {} }, speechSource: { processLocally: true, start() {}, stop() {} } });
const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// NFR-UX-011 AC-463
test('NFR-UX-011 AC-463: 再編後もボタンの集合が過不足なく同じで、全ボタンにアイコン・ラベル・ツールチップ・操作がある', async () => {
  const app = await mk();
  const names = GROUPS.flatMap(([, n]) => n);
  assert.equal(new Set(names).size, names.length);
  const cmds = app.getCommandBar().items.map((i) => i.command);
  assert.deepEqual([...cmds].sort(), names.filter((n) => typeof app.commands[n] === 'function').sort());
  assert.equal(cmds.length, 38);
  for (const it of app.getCommandBar().items) {
    assert.ok(ICONS[it.command], `${it.command}: アイコン`);
    assert.equal(it.label, app.t(labelKey(it.command)));
    assert.ok(it.tooltip.text.trim());
  }
});

// NFR-UX-011 AC-464
test('NFR-UX-011 AC-464: 640px 以下でも横スクロールなしで全ボタンが画面幅に収まり、見出しが重ならない', async () => {
  const app = await mk();
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    for (const w of [640, 480, 360]) {
      const lay = app.getCommandBarLayout({ viewportWidth: w });
      assert.equal(lay.scrollsHorizontally, false);
      for (const it of lay.items) assert.ok(it.rect.x >= 0 && it.rect.x + it.rect.w <= w, `${w}px ${it.command}`);
      for (const g of lay.groups) {
        for (const it of lay.items) assert.ok(!intersects(g.headingRect, it.rect), `${g.id}/${it.command}`);
        for (const o of lay.groups) if (o !== g) assert.ok(!intersects(g.headingRect, o.headingRect), `${g.id}/${o.id}`);
      }
    }
  }
});
