// FR-002 AC-042 AC-006 / FR-003 AC-007 AC-008 AC-044 / FR-004 AC-011 の単体・結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';
import { extractPoints } from '../../web/src/scenes.js';
import { detectEmotions } from '../../web/src/emotion.js';
import { renderDiagramSvg } from '../../web/src/diagram.js';
import { validateTextFile, splitLines } from '../../web/src/input.js';

function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
async function mk() {
  const c = { t: 1_000_000 };
  const app = await createApp({ storage: mem(), now: () => c.t });
  return { app, c };
}

// FR-003 AC-007
test('FR-003 AC-007: 要点抽出は決定的で、要点は発話の語句だけから成る', () => {
  const text = '予算が足りない。人も足りない、しかも納期が近いので、早めに優先順位を決めて、関係者へ共有したいと考えている。';
  const a = extractPoints(text);
  assert.deepEqual(a, extractPoints(text));
  for (const p of a) { assert.ok(text.includes(p)); assert.ok([...p].length <= 40); }
  assert.ok(a.length >= 2);
  assert.deepEqual(extractPoints('短い発話'), ['短い発話']);
});

// FR-003 AC-008
test('FR-003 AC-008: 20 秒を超える間隔で進行中のシーンが確定し新しいシーンが始まる（ちょうど 20 秒は分割しない）', async () => {
  const { app, c } = await mk();
  app.commands['session.start']();
  app.setDraft('最初の話'); app.submitDraft();
  c.t += 20_000; app.setDraft('続きの話'); app.submitDraft();
  assert.equal(app.getState().scenes.length, 1);
  c.t += 20_001; app.setDraft('別の話'); app.submitDraft();
  const sc = app.getState().scenes;
  assert.equal(sc.length, 2);
  assert.equal(sc[0].status, 'confirmed');
  assert.equal(sc[1].status, 'in_progress');
});

// FR-003 AC-044
test('FR-003 AC-044: ファイル取込の各行は同一の受付時刻で、無音間隔では分割されず進行中のシーンに加わる', async () => {
  const { app, c } = await mk();
  app.commands['session.start']();
  app.setDraft('手入力'); app.submitDraft();
  c.t += 60_000;
  const r = await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: 12, text: '一行目\r\n\r\n二行目\n三行目' });
  assert.deepEqual([r.ok, r.added], [true, 3]);
  const st = app.getState();
  assert.equal(st.scenes.length, 1);
  assert.equal(st.scenes[0].points.length, 4);
  const times = st.utterances.slice(1).map((u) => u.receivedAt);
  assert.deepEqual(new Set(times).size, 1);
  // 取込の前に「次のシーン」を操作したときだけ分かれる
  app.commands['session.nextScene']();
  await app.importTextFile({ name: 'b.txt', type: 'text/plain', size: 6, text: '四行目\n五行目' });
  assert.equal(app.getState().scenes.length, 2);
});

// FR-002 AC-042
test('FR-002 AC-042: 記録中でないとき手入力もファイル取込も受け付けず、案内を表示し入力欄は保たれる', async () => {
  const { app } = await mk();
  for (const prep of [() => {}, () => { app.commands['session.start'](); app.commands['session.pause'](); }]) {
    prep();
    app.setDraft('保たれる文');
    assert.equal(app.submitDraft().ok, false);
    assert.equal(app.getState().message.text, '記録を開始・再開してください');
    const r = await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: 3, text: 'a\nb' });
    assert.equal(r.reason, 'not_recording');
    assert.equal(app.getState().utterances.length, 0);
    assert.equal(app.getState().input.draft, '保たれる文');
  }
  app.setLang('en');
  assert.equal(app.getState().message.text, app.t('msg.notRecording'));
});

// FR-002 AC-006
test('FR-002 AC-006: 上限超過・テキストでない・空のファイルは原因のメッセージが出て発話は不変', async () => {
  const { app } = await mk();
  app.commands['session.start']();
  app.setDraft('既存'); app.submitDraft();
  const cases = [
    [{ name: 'big.txt', type: 'text/plain', size: 1024 * 1024 + 1, text: 'x' }, 'too_large', 'msg.importTooLarge'],
    [{ name: 'a.png', type: 'image/png', size: 4, text: 'PNG' }, 'not_text', 'msg.importNotText'],
    [{ name: 'a.txt', type: 'text/plain', size: 4, text: 'a\u0000b' }, 'not_text', 'msg.importNotText'],
    [{ name: 'e.txt', type: 'text/plain', size: 0, text: '' }, 'empty', 'msg.importEmpty'],
    [{ name: 'w.txt', type: 'text/plain', size: 3, text: ' \n ' }, 'empty', 'msg.importEmpty'],
  ];
  for (const [f, reason, key] of cases) {
    const r = await app.importTextFile(f);
    assert.equal(r.reason, reason);
    assert.equal(app.getState().message.key, key);
    assert.equal(app.getState().utterances.length, 1);
  }
  assert.deepEqual(validateTextFile({ name: 'ok.TXT', type: '', size: 1024 * 1024, text: 'a' }), null, '上限ちょうどは取り込める');
  assert.deepEqual(splitLines('a\r\n\n b \n'), ['a', 'b']);
});

// FR-004 AC-011
test('FR-004 AC-011: 感情・様子の語があるシーンにだけ絵記号と語が表示される（日英）', async () => {
  assert.deepEqual(detectEmotions('在庫が多くてモヤモヤする').map((e) => e.word), ['モヤモヤ']);
  assert.deepEqual(detectEmotions('We are really worried').map((e) => e.id), ['anxious']);
  assert.deepEqual(detectEmotions('来月の計画を決める'), []);
  const { app } = await mk();
  app.commands['session.start']();
  app.setDraft('納期が近くて困った'); app.submitDraft();
  app.commands['session.nextScene']();
  app.setDraft('来月の計画を決める'); app.submitDraft();
  const [s1, s2] = app.getState().scenes;
  const svg = app.renderSvg();
  const g = (id) => svg.slice(svg.indexOf(`data-scene-id="${id}"`), svg.indexOf('</g></g>', svg.indexOf(`data-scene-id="${id}"`)));
  assert.match(svg, /data-emotion="trouble"/);
  assert.ok(g(s1.id).includes('data-emotion="trouble"') && g(s1.id).includes('困った'));
  assert.ok(!svg.slice(svg.indexOf(`data-scene-id="${s2.id}"`)).includes('data-emotion'));
});

// FR-004 AC-010 AC-009（SVG の構造）
test('FR-004 AC-010: SVG は見出し・吹き出し・矢印・シーン間の矢印を含み、特殊文字は退避される', () => {
  const scenes = [
    { id: 's1', heading: 'A & B <x>', points: [{ id: 'p1', text: '一つ目' }, { id: 'p2', text: '二つ目' }], relations: [{ from: 'p1', to: 'p2' }], status: 'confirmed' },
    { id: 's2', heading: '次', points: [{ id: 'p3', text: '三つ目' }], relations: [], status: 'in_progress' },
  ];
  const svg = renderDiagramSvg(scenes, { selectedSceneId: 's2', t: (k) => k });
  assert.ok(svg.includes('A &amp; B &lt;x&gt;'));
  assert.equal((svg.match(/<(?:line|path) [^>]*data-(?:relation|flow)/g) || []).length, 2, '要点間 1 + シーン間 1');
  assert.ok(svg.includes('stroke-dasharray'), '進行中は破線');
  assert.ok(svg.includes('aria-current="true"'));
  assert.ok(svg.indexOf('data-scene-id="s1"') < svg.indexOf('data-scene-id="s2"'));
});
