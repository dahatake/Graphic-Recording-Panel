// FR-106 AC-616（投票の主要な流れ。AC-612〜615 を通しで確かめる）
// （System Test。契約: tests/system/CONTRACT-P2.md）
// 期待値は受入基準だけから決める。実装がなければ失敗するのが正常（not_run → 実装後に pass）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from './helpers.js';

const OPTS = ['A案', 'B案', 'C案'];
const optId = (app, label) => app.getVote().options.find((o) => o.label === label).id;

async function outputs(app, env) {
  env.downloads.length = 0;
  await app.commands['save.markdown'](); const md = String(env.downloads.at(-1).data);
  await app.commands['save.html'](); const html = String(env.downloads.at(-1).data);
  return { outline: app.renderOutline(), md, html };
}

function vote3(app, { stance }) {
  assert.equal(app.startVote({ options: OPTS }).ok, true);
  assert.equal(app.getVote().votesPerPerson, 3, '既定の持ち票数は 3 票（PARAM-143）');
  assert.equal(app.getVote().stance, 'reference', '位置づけの既定は「参考」');
  assert.ok(app.getVote().rulesText.length > 0 && app.getVote().stanceLabel.length > 0, '規則と位置づけが文字で示される');
  assert.equal(app.setVoteStance(stance).ok, true);
  // B 案に 2 票・A 案に 1 票（B が最多）。持ち票数 3 を超える票は受け付けない
  for (const l of ['B案', 'B案', 'A案']) assert.equal(app.castVote(optId(app, l)).ok, true);
  const over = app.castVote(optId(app, 'C案'));
  assert.equal(over.ok, false, '持ち票数を超える票は受け付けない');
  assert.ok(String(over.reason || '').length > 0, '理由が文字で示される');
  assert.equal(app.getVote().votesUsed, 3);
  // 評価: B 案は最多票だがリスクが高い（5）。ほかの基準は評価しない（未評価のまま）
  assert.equal(app.rateOption(optId(app, 'B案'), 'risk', 5).ok, true);
  assert.equal(app.rateOption(optId(app, 'A案'), 'fit', 4).ok, true);
  assert.equal(app.rateOption(optId(app, 'A案'), 'fit', 6).ok, false, '段階は 1〜5');
}

test('FR-106 AC-616: 票と評価を入れ「決定」で集計すると、票数・評価・重大なリスクの印と注記が出て、決定事項の候補になるだけで確定せず、保存・復元・初期化・出力が一致する', async () => {
  const { app, env, createApp } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  vote3(app, { stance: 'decision' });
  const t = app.tallyVote();
  assert.equal(t.ok, true);
  const res = app.getVote().result;
  assert.equal(res.ranking[0].optionId, optId(app, 'B案'));
  assert.equal(res.ranking[0].votes, 2);
  const b = app.getVote().options.find((o) => o.label === 'B案');
  assert.equal(b.criticalRisk, true, 'リスク 5 は重大なリスク（PARAM-145 以上）');
  assert.equal(app.getVote().options.find((o) => o.label === 'A案').criticalRisk, false);
  const html = app.renderVote();
  for (const w of ['重大なリスク', '未評価', '決定', '票']) assert.ok(html.includes(w), `画面に「${w}」`);
  assert.ok(/少数意見[\s\S]*票数だけで却下しない/.test(html), '注記が文字で出る');

  // 結果は決定事項の候補。確定していない（操作なしに確定にならない）
  const items = app.getMeetingItems();
  const cand = items.decisions.filter((d) => d.state === 'candidate');
  assert.ok(cand.length >= 1 && cand.some((d) => d.text.includes('B案')), '決定事項の候補に出る');
  assert.ok(items.decisions.every((d) => d.state !== 'confirmed'), '確定していない');
  const o = await outputs(app, env);
  for (const [k, s] of Object.entries(o)) for (const w of ['重大なリスク', '未評価', '決定']) assert.ok(s.includes(w), `${k}: 「${w}」`);
  const snap = JSON.stringify(app.getVote());
  app.flushSave();
  const app2 = await createApp(env.options);
  assert.equal(JSON.stringify(app2.getVote()), snap, '再読込で票・評価・位置づけ・結果が復元される');
  assert.equal((await app.commands['file.save']()).ok, true);
  const dl = env.downloads.at(-1);
  assert.equal(app.commands['data.reset']().ok, true);
  assert.equal((await app.dialogAction('confirm')).ok, true);
  assert.equal(app.getVote(), null, 'データの初期化で消える');
  assert.ok(!app.renderOutline().includes('重大なリスク'), 'テキスト一覧からも消える');
  assert.equal((await app.loadSessionFile({ name: dl.filename, type: dl.mime, size: String(dl.data).length, text: String(dl.data) })).ok, true);
  assert.equal(JSON.stringify(app.getVote()), snap, 'ファイル読込で復元される');
});

test('FR-106 AC-616 異常系・参考: 位置づけが「参考」の結果は決定事項の候補にならず、「参考」の語で出力される', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  vote3(app, { stance: 'reference' });
  assert.equal(app.tallyVote().ok, true);
  assert.equal(app.getMeetingItems().decisions.length, 0, '参考の結果は決定事項にならない');
  const o = await outputs(app, env);
  for (const [k, s] of Object.entries(o)) for (const w of ['参考', '重大なリスク', '未評価']) assert.ok(s.includes(w), `${k}: 「${w}」`);
});
// FR-106 AC-616（rd-author 5cd447f の改訂: 投票者は任意のラベル・持ち票数は投票者ごと・機密の要点の選択肢は「除く」保存から除く。AC-606・AC-620）
test('FR-106 AC-616 異常系: 投票者は任意のラベル（省略時は連番）で持ち票数は投票者ごと、集計は合算。機密の要点の選択肢と結果は「機密の要点を除く」の保存から除かれる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  const p = app.getState().scenes.at(-1).points[0];
  app.selectPoint(p.id); app.commands['point.confidential']();
  assert.equal(app.getState().scenes.at(-1).points.find((q) => q.id === p.id).confidential, true);
  // 投票者 2 人（2 人目のラベルは省略）。選択肢 C は機密の要点に由来する
  assert.equal(app.startVote({ options: ['A案', 'B案', { label: 'C機密案XYZ', pointId: p.id }], voters: ['営業部', ''] }).ok, true);
  const voters = app.getVote().voters;
  assert.equal(voters.length, 2);
  assert.equal(voters[0].label, '営業部');
  assert.equal(voters[1].label, '投票者 2', '省略時は連番');
  assert.equal(app.setVoteStance('decision').ok, true);
  const v1 = voters[0].id, v2 = voters[1].id;
  for (let i = 0; i < 3; i++) assert.equal(app.castVote(optId(app, 'A案'), v1).ok, true);
  assert.equal(app.castVote(optId(app, 'B案'), v1).ok, false, '持ち票数は投票者 1 人あたり。超える票は受け付けない');
  for (const l of ['C機密案XYZ', 'C機密案XYZ', 'B案']) assert.equal(app.castVote(optId(app, l), v2).ok, true, '別の投票者は別に 3 票持つ');
  assert.equal(app.tallyVote().ok, true);
  const r = app.getVote().result.ranking;
  assert.equal(r.find((x) => x.optionId === optId(app, 'A案')).votes, 3, '集計は投票者を合算');
  assert.equal(r.find((x) => x.optionId === optId(app, 'C機密案XYZ')).votes, 2);
  // 画面・テキスト一覧には機密の選択肢も残り、「除かない」保存には載る
  assert.ok(app.renderVote().includes('C機密案XYZ'));
  app.setExcludeConfidential(false);
  env.downloads.length = 0;
  await app.commands['save.markdown'](); assert.ok(String(env.downloads.at(-1).data).includes('C機密案XYZ'), '除かない保存には載る');
  // 「除く」保存: 選択肢・結果が 5 形式から除かれ、除外の件数だけが載る
  app.setExcludeConfidential(true);
  await app.commands['save.markdown'](); const md = String(env.downloads.at(-1).data);
  await app.commands['save.html'](); const html = String(env.downloads.at(-1).data);
  for (const [k, s] of Object.entries({ md, html })) {
    assert.ok(!s.includes('C機密案XYZ'), `${k}: 機密の選択肢の文字が載らない`);
    assert.ok(s.includes('機密の要点を除外'), `${k}: 除外の件数が載る`);
  }
  assert.ok(app.getVote().options.some((o) => o.label === 'C機密案XYZ'), 'セッションの保存・アプリ内の表示は対象外（残る）');
});
