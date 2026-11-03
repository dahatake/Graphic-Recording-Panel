// FR-072 AC-647 の単体テスト（web/src/ui.js の PRESSED）。実ブラウザでの確認は System Test E2E-283。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ui = fs.readFileSync(new URL('../../web/src/ui.js', import.meta.url), 'utf8');
const m = ui.match(/^const PRESSED = (\{.*\});$/m);
assert.ok(m, 'ui.js に PRESSED がある');
const PRESSED = vm.runInNewContext(`(${m[1]})`);
const pressedOf = (session) => Object.fromEntries(['session.start', 'session.resume', 'session.pause', 'session.stop', 'session.nextScene', 'input.focus']
  .map((c) => [c, PRESSED[c] ? PRESSED[c]({ session }) : null]));

// FR-072 AC-647: 準備中・停止はどれも押されていない。記録中は開始・再開、一時停止は一時停止だけ。終了・次シーン・入力は状態を持たない
test('FR-072 AC-647: 記録グループの押下の表示は、準備中・停止ではすべて偽、記録中は開始と再開、一時停止は一時停止だけが真', () => {
  for (const s of ['preparing', 'stopped']) {
    const p = pressedOf(s);
    assert.deepEqual([p['session.start'], p['session.resume'], p['session.pause']], [false, false, false], s);
  }
  assert.deepEqual(pressedOf('recording'), { 'session.start': true, 'session.resume': true, 'session.pause': false, 'session.stop': null, 'session.nextScene': null, 'input.focus': null });
  const p = pressedOf('paused');
  assert.deepEqual([p['session.start'], p['session.resume'], p['session.pause']], [false, false, true]);
});

// FR-072 AC-647: 状態の変更と同時に（描画を待たず）押下の表示を更新する
test('FR-072 AC-647: 押下の表示は状態の変更の購読で同期して更新される', () => {
  assert.match(ui, /app\.subscribe\(syncRecordPressed\)/);
});
