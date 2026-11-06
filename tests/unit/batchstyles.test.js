// FR-119 グラレコスタイルの定義（AC-694・AC-695・AC-698・AC-148 の拡張点）の単体テスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_BATCH_STYLES, createBatchStyleRegistry, SOURCE_KIND_OF } from '../../web/src/batchstyles.js';
import { createDrawStyleRegistry } from '../../web/src/drawstyles.js';

const drawIds = createDrawStyleRegistry().ids();

test('FR-119 AC-694: 8 スタイルが既存の描画スタイルを参照し、描画スタイルは 15 のまま', () => {
  const reg = createBatchStyleRegistry({ drawStyleIds: drawIds });
  assert.equal(reg.ids().length, 8);
  assert.equal(drawIds.length, 15);
  for (const s of reg.list('ja')) assert.ok(drawIds.includes(s.drawStyle), s.id);
});

test('FR-119 AC-695: 端末向けの一覧は instruction（Prompt 本文）を持たない', () => {
  const reg = createBatchStyleRegistry({ drawStyleIds: drawIds });
  for (const lang of ['ja', 'en']) for (const s of reg.list(lang)) {
    assert.ok(!('instruction' in s) && !('prompt' in s));
    assert.ok(s.icon && s.label && s.description);
  }
  assert.ok(!JSON.stringify(BUILTIN_BATCH_STYLES).includes('instruction'));
});

test('FR-119 AC-698: 全スタイルが出典を持ち、U・I・A の 3 区分がそれぞれ 1 つ以上', () => {
  const kinds = new Set();
  for (const d of BUILTIN_BATCH_STYLES) {
    assert.ok(d.sources.length > 0, d.id);
    for (const s of d.sources) { assert.ok(SOURCE_KIND_OF[s], s); kinds.add(SOURCE_KIND_OF[s]); }
  }
  assert.deepEqual([...kinds].sort(), ['A', 'I', 'U']);
});

test('FR-119 AC-148: 定義を足すだけで増える。重複・欠けた定義は加えない', () => {
  const reg = createBatchStyleRegistry({ drawStyleIds: drawIds });
  const ok = { id: 'x1', icon: '★', label: { ja: '新', en: 'New' }, description: { ja: '説明', en: 'Desc' }, drawStyle: 'minimal', layout: 'zone', sources: ['SRC-060'] };
  assert.deepEqual(reg.register(ok), { ok: true });
  assert.equal(reg.ids().length, 9);
  assert.equal(reg.register(ok).reason, 'duplicate');
  assert.equal(reg.register({ ...ok, id: 'x2', label: { ja: '', en: 'a' } }).ok, false);
  assert.equal(reg.register({ ...ok, id: 'x3', drawStyle: 'nope' }).reason, 'invalid_draw_style');
  assert.equal(reg.register({ ...ok, id: 'x4', label: { ja: 'ながすぎるなまえです', en: 'a' } }).reason, 'label_too_long');
  assert.equal(reg.ids().length, 9);
});
