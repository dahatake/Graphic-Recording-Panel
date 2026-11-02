// FR-106 AC-612〜616 の単体・結合テスト（AC-612: 投票者・持ち票数・位置づけ、AC-613: 評価の基準、AC-614: 決定的な集計、AC-615: 注記・重大なリスク・決定の候補）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, keyFor } from '../system/helpers.js';
import { computeTally, isCriticalRisk, CRITICAL_RISK_MIN } from '../../web/src/vote.js';

const oid = (app, l) => app.getVote().options.find((o) => o.label === l).id;

// FR-106 AC-614: 集計は決定的な純関数。同点は同順位、並びは票数降順・同票は入力順
test('FR-106 AC-614: computeTally は同点を同順位にし、同じ入力から毎回同じ結果になる', () => {
  const opts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const ballots = { v1: { a: 1, b: 2 }, v2: { c: 1, d: 1, b: 1 } };
  const ratings = { a: { fit: 4, risk: 2 }, b: { risk: 5 } };
  const r1 = computeTally(opts, ballots, ratings); const r2 = computeTally(opts, ballots, ratings);
  assert.deepEqual(r1, r2);
  assert.deepEqual(r1.ranking.map((r) => [r.optionId, r.votes, r.rank, r.tie]), [['b', 3, 1, false], ['a', 1, 2, true], ['c', 1, 2, true], ['d', 1, 2, true]]);
  assert.equal(r1.tie, true);
  assert.equal(r1.ranking[0].avg.risk, 5);
  assert.equal(r1.ranking[0].avg.fit, null, '未評価は null のまま（自動で補わない）');
});

// FR-106 AC-615: 重大なリスクは PARAM-145（4）以上
test('FR-106 AC-615: リスク評価 4 以上が重大なリスク', () => {
  assert.equal(CRITICAL_RISK_MIN, 4);
  assert.deepEqual([null, 1, 3, 4, 5].map(isCriticalRisk), [false, false, false, true, true]);
});

// FR-106 AC-612: 開始の検査・投票者の連番・持ち票数（投票者ごと）・取り消し
test('FR-106 AC-612: 選択肢は 2 つ以上・重複なし、投票者の空ラベルは連番、持ち票数は投票者ごと、取り消せる', async () => {
  const { app } = await newApp();
  assert.equal(app.startVote({ options: ['A'] }).ok, false);
  assert.equal(app.startVote({ options: ['A', 'A'] }).ok, false);
  assert.equal(app.startVote({ options: ['A', 'B'], votesPerPerson: 0 }).ok, false);
  assert.equal(app.startVote({ options: ['A', 'B'], voters: ['甲', '', ' '], votesPerPerson: 1 }).ok, true);
  assert.deepEqual(app.getVote().voters.map((v) => v.label), ['甲', '投票者 2', '投票者 3']);
  assert.equal(app.getVote().remaining, 3);
  const [v1, v2] = app.getVote().voters.map((v) => v.id);
  assert.equal(app.castVote(oid(app, 'A'), v1).ok, true);
  assert.equal(app.castVote(oid(app, 'B'), v1).ok, false, '1 人あたり 1 票');
  assert.equal(app.castVote(oid(app, 'B'), v2).ok, true);
  assert.equal(app.retractVote(oid(app, 'A'), v1).ok, true);
  assert.equal(app.retractVote(oid(app, 'A'), v1).ok, false, '取り消す票がない');
  assert.equal(app.castVote('x').ok, false);
  assert.equal(app.setVoteStance('x').ok, false);
  assert.match(app.getVote().rulesText, /1 人あたり 1 票/);
});

// FR-106 AC-613: 評価は 1〜5。未評価は文字で示し、null で未評価に戻せる
test('FR-106 AC-613: 評価の段階は 1〜5 で、評価しない基準は「未評価」と示される', async () => {
  const { app } = await newApp();
  app.startVote({ options: ['A', 'B'] });
  const a = oid(app, 'A');
  assert.equal(app.rateOption(a, 'fit', 3).ok, true);
  assert.equal(app.rateOption(a, 'fit', 0).ok, false);
  assert.equal(app.rateOption(a, 'fit', 2.5).ok, false);
  assert.equal(app.rateOption(a, 'nope', 3).ok, false);
  assert.match(app.getVote().options[0].ratingText, /目標への適合: 3 \/ 5/);
  assert.match(app.getVote().options[0].ratingText, /影響: 未評価/);
  assert.equal(app.rateOption(a, 'fit', null).ok, true);
  assert.equal(app.getVote().options[0].ratings.fit, null);
});

// FR-106 AC-615: 注記は常に出る。決定の結果は候補で、確定の操作でだけ確定になる。却下・参考は決定事項にならない
test('FR-106 AC-615: 注記・重大なリスクの印・決定の候補（確定は利用者の操作）・異論・懸念への記録', async () => {
  const { app } = await newApp();
  app.startVote({ options: ['A', 'B'] });
  app.setVoteStance('decision');
  app.castVote(oid(app, 'A')); app.castVote(oid(app, 'A'));
  app.rateOption(oid(app, 'A'), 'risk', 4);
  app.tallyVote();
  const html = app.renderVote();
  assert.match(html, /少数意見・重大なリスクは票数だけで却下しない/);
  assert.match(html, /決定（候補）/);
  assert.ok(html.includes('data-critical-risk'));
  let items = app.getMeetingItems();
  const cand = items.decisions.find((d) => d.id === 'vote-result');
  assert.equal(cand.state, 'candidate');
  assert.ok(cand.text.includes('決定（候補）') && cand.text.includes('A'));
  assert.equal(app.recordVoteConcern().ok, true);
  assert.ok(app.getMeetingItems().objections.some((o) => o.text.includes('重大なリスク')));
  assert.equal(app.confirmMeetingItem('vote-result').ok, true);
  items = app.getMeetingItems();
  assert.ok(!items.decisions.some((d) => d.id === 'vote-result'));
  assert.ok(items.decisions.some((d) => d.state === 'confirmed' && d.text.includes('A')));
  // 却下
  app.castVote(oid(app, 'B')); app.tallyVote();
  app.setVoteStance('decision');
});

test('FR-106 AC-615: 候補を却下すると決定事項に出ない。票が変わると古い結果は消える', async () => {
  const { app } = await newApp();
  app.startVote({ options: ['A', 'B'] }); app.setVoteStance('decision');
  app.castVote(oid(app, 'B')); app.tallyVote();
  assert.ok(app.getMeetingItems().decisions.some((d) => d.id === 'vote-result'));
  assert.equal(app.rejectMeetingItem('vote-result').ok, true);
  assert.ok(!app.getMeetingItems().decisions.some((d) => d.id === 'vote-result'));
  app.castVote(oid(app, 'A'));
  assert.equal(app.getVote().result, null, '票が変わると集計は取り直し');
});

// 会議の文字列は escape（NFR-SEC-004）
test('FR-106 AC-616: 選択肢のラベルは escape され、データの初期化で消える', async () => {
  const { app } = await newApp();
  app.startVote({ options: ['<img src=x onerror=alert(1)>', 'B'] });
  assert.ok(!app.renderVote().includes('<img'));
  assert.ok(app.getVoteOutlineHtml().includes('&lt;img'));
  app.commands['data.reset'](); await app.dialogAction('confirm');
  assert.equal(app.getVote(), null);
  assert.equal(app.getVoteOutlineHtml(), '');
});

// NFR-A11Y-001 AC-036: 開く・集計のキーがあり、Esc で閉じる
test('FR-106 AC-036: vote.open・vote.tally のキーがあり、Esc で画面を閉じる', async () => {
  const { app } = await newApp();
  assert.ok(keyFor(app, 'vote.open') && keyFor(app, 'vote.tally'));
  assert.equal(app.handleKey(keyFor(app, 'vote.open')), 'vote.open');
  assert.ok(app.getVoteView());
  assert.equal(app.handleKey({ key: 'Escape' }), 'vote.close');
  assert.equal(app.getVoteView(), null);
});
