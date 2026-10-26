// FR-013 AC-049 AC-050 / FR-014 AC-052 AC-053 AC-054（System Test。契約: tests/system/CONTRACT.md「右パネルと暫定結果」）
// 右パネル = 既存の 'input' パネル（FR-013: 既存の入力パネルを右側の認識文字列パネルに位置づけ直す）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, PARAM, toDetail } from './helpers.js';

const REFLECT_MS = PARAM.UPPER_SEC * 1000; // PARAM-001（15 秒）
const MB = 1024 * 1024;       // PARAM-003
const finals = (app) => app.getTranscript().finals.map((f) => f.text);
const startRec = (app) => { app.commands['session.start'](); app.startSpeech(); };

// FR-013 AC-049
test('FR-013 AC-049: 既定のレイアウトで認識文字列パネルは図のパネルより右にあり、見出しで識別できる', async () => {
  const { app } = await newApp();
  const p = app.getLayout().panels;
  assert.equal(p.input.visible, true);
  assert.ok(p.input.x > p.diagram.x, `右パネル x=${p.input.x} は図 x=${p.diagram.x} より右`);
  const t = app.getTranscript();
  assert.ok(typeof t.heading === 'string' && t.heading.trim().length > 0, '見出しが非空');
  assert.equal(t.heading, app.t('panel.input'));
  assert.ok(app.renderTranscript().includes(t.heading), '描画に見出しを含む');
});

test('FR-013 AC-049: 右パネルを移動・大きさ変更・表示/非表示・最大化でき、既定に戻せる', async () => {
  const { app } = await newApp();
  const def = JSON.stringify(app.getLayout());
  app.movePanel('input', { x: 10, y: 20 });
  app.resizePanel('input', { w: 500, h: 300 });
  app.setPanelMaximized('input', true);
  app.setPanelVisible('input', false);
  const q = app.getLayout().panels.input;
  assert.deepEqual([q.x, q.y, q.w, q.h, q.visible, q.maximized], [10, 20, 500, 300, false, true]);
  app.resetLayout();
  assert.equal(JSON.stringify(app.getLayout()), def);
});

test('FR-013 AC-049 異常系: 言語を切り替えても見出しは空にならず、その言語の文言になる', async () => {
  const { app } = await newApp();
  app.setLang('en');
  assert.equal(app.getTranscript().heading, app.t('panel.input'));
  assert.ok(app.getTranscript().heading.trim().length > 0);
});

// FR-013 AC-050
test('FR-013 AC-050: 記録中に .txt を取り込むと、各行が発話となり認識文字列の一覧に確定結果として並ぶ', async () => {
  const { app } = await newApp();
  startRec(app);
  const r = await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: 30, text: '一行目\n\n二行目\n三行目' });
  assert.equal(r.ok, true);
  assert.equal(r.added, 3);
  assert.deepEqual(app.getState().utterances.map((u) => u.text), ['一行目', '二行目', '三行目']);
  assert.deepEqual(finals(app), ['一行目', '二行目', '三行目']);
  assert.equal(app.getTranscript().interim, null);
});

// FR-013 AC-050（FR-022: .vtt も同じ入口・同じ結果）
test('FR-013 AC-050 FR-022: 記録中でなくても .vtt を同じ入口で取り込むと、本文が認識文字列の一覧に確定結果として並ぶ。準備中でも受け付ける（FR-039）', async () => {
  const { app } = await newApp();
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v A>一件目</v>\n\n00:00:03.000 --> 00:00:04.000\n<v B>二件目</v>\n';
  const r = await app.importTextFile({ name: 'a.vtt', type: 'text/vtt', size: vtt.length, text: vtt });
  assert.equal(r.ok, true);
  assert.equal(app.getState().session, 'preparing');
  assert.deepEqual(finals(app), ['一件目', '二件目']);
  assert.equal(app.getTranscript().interim, null);
});

test('FR-013 AC-050 異常系: 上限（1 MB）超過・.txt でないときは受け付けず、一覧も発話も不変（記録中でないことは理由にならない。FR-039）', async () => {
  const { app } = await newApp();
  const none = await app.importTextFile({ name: 'a.txt', type: 'text/plain', size: 5, text: '準備中' });
  assert.equal(none.ok, true, '準備中でも取り込める');
  startRec(app);
  await app.importTextFile({ name: 'ok.txt', type: 'text/plain', size: 5, text: '既存' });
  const before = JSON.stringify([app.getState().utterances, app.getTranscript().finals]);
  const big = await app.importTextFile({ name: 'big.txt', type: 'text/plain', size: MB + 1, text: '超過' });
  const bad = await app.importTextFile({ name: 'a.png', type: 'image/png', size: 5, text: 'x' });
  assert.equal(big.ok, false); assert.equal(bad.ok, false);
  assert.equal(JSON.stringify([app.getState().utterances, app.getTranscript().finals]), before);
  const edge = await app.importTextFile({ name: 'edge.txt', type: 'text/plain', size: MB, text: '境界' });
  assert.equal(edge.ok, true, 'ちょうど上限は受け付ける');
  assert.equal(PARAM.MAX_FILE_MB, 1);
});

// FR-014 AC-052
test('FR-014 AC-052: 暫定結果は右パネルに、確定結果と文字の見た目・読み上げ上の属性の両方で区別して表示され、発話にならず図も更新されない', async () => {
  const { app, env } = await newApp();
  startRec(app);
  env.speech.emit('確定の発話', true);
  env.scheduler.advance(REFLECT_MS);
  const svg0 = app.renderSvg();
  const utt0 = app.getState().utterances.length;
  env.speech.emit('暫定の文字列', false);
  env.scheduler.advance(REFLECT_MS * 2);
  assert.equal(app.getTranscript().interim, '暫定の文字列');
  assert.equal(app.getState().utterances.length, utt0, '発話として記録されない');
  assert.ok(!finals(app).includes('暫定の文字列'));
  assert.equal(app.renderSvg(), svg0, '図は更新されない');
  const html = app.renderTranscript();
  const label = app.t('transcript.interim');
  assert.ok(label && label.trim(), '「暫定」の語の文言がある');
  const m = html.match(/<[^>]*data-kind="interim"[^>]*>[\s\S]*?暫定の文字列[\s\S]*?<\/[a-z0-9]+>/i);
  assert.ok(m, '暫定の要素 data-kind="interim"');
  assert.ok(m[0].includes(label), '読み上げ上の属性: 「暫定」の語を含む');
  const f = html.match(/<[^>]*data-kind="final"[^>]*>/i);
  assert.ok(f, '確定の要素 data-kind="final"');
  const cls = (tag) => (tag.match(/class="([^"]*)"/) || [, ''])[1];
  const iTag = m[0].match(/^<[^>]*>/)[0];
  assert.notEqual(cls(iTag), cls(f[0]), '文字の見た目（クラス）が確定と異なる');
  assert.ok(/interim/i.test(cls(iTag)), '暫定のクラス名に interim を含む');
  assert.ok(!html.match(/data-kind="final"[^>]*>[^<]*暫定\b/), '確定の要素に暫定の語は付かない');
});

test('FR-014 AC-052 異常系: 記録中でないときの暫定結果は表示も記録もされない', async () => {
  const { app, env } = await newApp();
  app.startSpeech();
  env.speech.emit('準備中の暫定', false);
  assert.equal(app.getTranscript().interim, null);
  assert.equal(app.getState().utterances.length, 0);
  assert.equal(app.getState().scenes.length, 0);
});

// FR-014 AC-053
test('FR-014 AC-053: 確定結果で暫定表示が消えて確定一覧に移り、図が受付から 15 秒（PARAM-001）以内に画面へ反映される', async () => {
  const { app, env } = await newApp();
  startRec(app);
  env.speech.emit('予算を見直す', false);
  assert.equal(app.getTranscript().interim, '予算を見直す');
  env.speech.emit('予算を見直す', true);
  assert.equal(app.getTranscript().interim, null, '暫定表示は消える');
  assert.deepEqual(finals(app), ['予算を見直す']);
  env.scheduler.advance(REFLECT_MS);
  assert.ok(app.renderSvg().includes('予算を見直す'), 'PARAM-001（15 秒）以内に図に反映');
  assert.ok(app.renderOutline().includes('予算を見直す'));
  assert.equal(app.getState().scenes.length >= 1, true);
});

test('FR-014 AC-053 異常系: 一時停止中に届いた確定結果は一覧にも図にも反映されない', async () => {
  const { app, env } = await newApp();
  startRec(app);
  app.commands['session.pause']();
  env.speech.emit('停止中の声', true);
  env.scheduler.advance(REFLECT_MS * 2);
  assert.deepEqual(finals(app), []);
  assert.ok(!app.renderSvg().includes('停止中の声'));
});

// FR-014 AC-054（件数は AC の文言から決まる範囲: 手入力 1 件、取込は 100 行（各 40 文字以下）。上限 1 MB 全行の負荷は AC から決まらないので範囲外）
test('FR-014 AC-054: 手入力の確定結果が、送信から 15 秒（PARAM-001）以内に図へ反映される', async () => {
  const { app, env } = await newApp(); toDetail(app);
  app.commands['session.start']();
  app.setDraft('手入力の要点');
  assert.equal(app.submitDraft().ok, true);
  env.scheduler.advance(REFLECT_MS);
  assert.ok(app.renderSvg().includes('手入力の要点'));
});

test('FR-014 AC-054: ファイル取込の確定結果（100 行）が、取込の完了から 15 秒（PARAM-001）以内に図へ反映される', async () => {
  const { app, env } = await newApp(); toDetail(app);
  app.commands['session.start']();
  const lines = Array.from({ length: 100 }, (_, i) => `取込行${i + 1}の要点`);
  const r = await app.importTextFile({ name: 'm.txt', type: 'text/plain', size: 2000, text: lines.join('\n') });
  assert.equal(r.ok, true);
  env.scheduler.advance(REFLECT_MS);
  const svg = app.renderSvg();
  for (const l of lines) assert.ok(svg.includes(l), `${l} が図にある`);
});

// FR-014 AC-054 / FR-039 AC-180 AC-181: 取込は状態によらず図に反映。受け付けられない手入力（準備中）・不正取込だけが図を変えない
test('FR-014 AC-054 異常系: 受け付けられなかった手入力・不正な取込は図を変えない（準備中の取込は反映される）', async () => {
  const { app, env } = await newApp();
  app.setDraft('準備中の入力');
  assert.equal(app.submitDraft().ok, false);
  env.scheduler.advance(REFLECT_MS * 2);
  assert.ok(!app.renderSvg().includes('準備中の入力'));
  assert.equal(app.getState().scenes.length, 0);
  const bad = await app.importTextFile({ name: 'x.bin', type: 'application/octet-stream', size: 5, text: '不正な取込' });
  assert.equal(bad.ok, false);
  env.scheduler.advance(REFLECT_MS * 2);
  assert.ok(!app.renderSvg().includes('不正な取込'));
  assert.equal(app.getState().scenes.length, 0);
  const ok = await app.importTextFile({ name: 'x.txt', type: 'text/plain', size: 5, text: '準備中の取込' });
  assert.equal(ok.ok, true);
  env.scheduler.advance(REFLECT_MS);
  assert.ok(app.renderSvg().includes('準備中の取込'));
});
