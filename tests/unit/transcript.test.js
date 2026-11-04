// FR-013 AC-049 AC-050 AC-051 / FR-014 AC-052 AC-053 AC-054 の単体・結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';
import { defaultLayout } from '../../web/src/layout.js';

class Fake {
  constructor() { this.processLocally = true; this.onresult = null; this.onerror = null; }
  start() {}
  stop() {}
  emit(text, isFinal = true) { this.onresult?.({ text, isFinal }); }
}
class Sched {
  constructor() { this.t = 0; this.q = []; this.n = 1; }
  setTimeout(fn, ms) { const id = this.n++; this.q.push({ id, at: this.t + ms, fn }); return id; }
  clearTimeout(id) { this.q = this.q.filter((e) => e.id !== id); }
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      const next = this.q.filter((e) => e.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      this.q = this.q.filter((e) => e !== next); this.t = next.at; next.fn();
    }
    this.t = end;
  }
}
async function mk(opts = {}) {
  let t = 1_000_000;
  const sp = new Fake();
  const app = await createApp({ storage: null, speechSource: sp, now: () => (t += 1000), ...opts });
  app.commands['session.start']();
  app.startSpeech();
  return { app, sp };
}

test('FR-013 AC-049: 既定レイアウトで入力パネル（認識文字列）は図より右', () => {
  const p = defaultLayout().panels;
  assert.ok(p.input.x > p.diagram.x);
  assert.ok(p.input.x > p.outline.x);
});

test('FR-013 AC-050 AC-051: 取込の各行と音声の確定結果が受付順に一覧へ並ぶ。一覧は role=log', async () => {
  const { app, sp } = await mk();
  sp.emit('音声一', true);
  await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: 10, text: 'A\nB' });
  assert.deepEqual(app.getTranscript().finals.map((f) => f.text), ['音声一', 'A', 'B']);
  assert.match(app.renderTranscript(), /role="log"/);
});

// FR-039 AC-182: 受け付けられない取込（空）は状態によらず一覧を変えない
test('FR-013 AC-050: 受け付けられない取込は一覧を変えない', async () => {
  const { app } = await mk();
  app.commands['session.pause']();
  const r = await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: 1, text: '\n' });
  assert.equal(r.ok, false);
  assert.deepEqual(app.getTranscript().finals, []);
});

test('FR-014 AC-052: 暫定は区別表示され発話にならず、記録中でなくなると消える。HTML はエスケープされる', async () => {
  const { app, sp } = await mk();
  sp.emit('<b>途中</b>', false);
  const html = app.renderTranscript();
  assert.ok(html.includes('data-kind="interim"') && html.includes('&lt;b&gt;'));
  assert.ok(!html.includes('<b>'));
  assert.equal(app.getState().utterances.length, 0);
  app.commands['session.pause']();
  assert.equal(app.getTranscript().interim, null);
});

// FR-014 AC-053 AC-521: 音声の確定結果は、確定結果の一覧へはすぐ移り、図へは次のライブ更新（初期値 10 秒）で描き足される
test('FR-014 AC-053 AC-054: 確定は次のライブ更新で、手入力・取込は即座に図へ反映される', async () => {
  const sched = new Sched();
  const { app, sp } = await mk({ scheduler: sched });
  app.setDetailLevel('detail'); // FR-026: 要点を図で確かめるため「詳細」にする
  sp.emit('予算', false);
  sp.emit('予算を見直す', true);
  assert.equal(app.getTranscript().interim, null);
  assert.ok(app.getTranscript().finals.some((f) => f.text === '予算を見直す'), '確定結果の一覧にはすぐ移る');
  assert.ok(!app.renderSvg().includes('予算を見直す'), '次の更新の時点までは図に加わらない');
  sched.advance(app.getLiveInterval().sec * 1000);
  assert.ok(app.renderSvg().includes('予算を見直す'), '更新間隔の時点で図に描き足される');
  app.setDraft('手入力'); app.submitDraft();
  assert.ok(app.renderSvg().includes('手入力'));
  await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: 10, text: '取込行' });
  assert.ok(app.renderSvg().includes('取込行'));
});
