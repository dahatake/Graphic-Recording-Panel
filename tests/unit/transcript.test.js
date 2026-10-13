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
async function mk() {
  let t = 1_000_000;
  const sp = new Fake();
  const app = await createApp({ storage: null, speechSource: sp, now: () => (t += 1000) });
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

test('FR-013 AC-050: 受け付けられない取込は一覧を変えない', async () => {
  const { app } = await mk();
  app.commands['session.pause']();
  const r = await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: 10, text: 'A' });
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

test('FR-014 AC-053 AC-054: 確定・手入力・取込は即座に図へ反映される', async () => {
  const { app, sp } = await mk();
  sp.emit('予算', false);
  sp.emit('予算を見直す', true);
  assert.equal(app.getTranscript().interim, null);
  assert.ok(app.renderSvg().includes('予算を見直す'));
  app.setDraft('手入力'); app.submitDraft();
  assert.ok(app.renderSvg().includes('手入力'));
  await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: 10, text: '取込行' });
  assert.ok(app.renderSvg().includes('取込行'));
});
