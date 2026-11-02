// FR-107 AC-617〜620 の単体・結合テスト（AC-617: 役割、AC-618: 確認の問いかけ、AC-619: 未回答は合意にしない、AC-620: 保存・復元・出力）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail, keyFor } from '../system/helpers.js';
import { answerOf, QUESTION_PHRASES, ROLE_IDS } from '../../web/src/roles.js';
import { markdownHead, htmlHead } from '../../web/src/meetingout.js';

const text = (d) => (typeof d === 'string' ? d : Buffer.from(d).toString('utf8'));
async function setup() {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  return { app, env, pts: app.getState().scenes.flatMap((s) => s.points) };
}

// FR-107 AC-617: 役割は入力した名前だけ。未設定は「未定」。決定者は候補として示すだけで自動では補わない
test('FR-107 AC-617: 役割は 3 つで、未設定は「未定」と文字で示され、設定した名前だけが出る', async () => {
  const { app } = await newApp();
  assert.deepEqual(ROLE_IDS, ['recorder', 'facilitator', 'decider']);
  assert.deepEqual(app.getRoles().map((r) => [r.label, r.text, r.undecided]), [['記録者', '未定', true], ['進行役', '未定', true], ['決定者', '未定', true]]);
  assert.equal(app.setRole('decider', '  佐藤 ').name, '佐藤');
  assert.equal(app.getRoles().find((r) => r.id === 'decider').text, '佐藤');
  assert.equal(app.setRole('boss', 'x').ok, false);
  assert.deepEqual(app.getDeciderCandidates(), ['佐藤']);
  app.setRole('decider', '');
  assert.deepEqual(app.getDeciderCandidates(), []);
});

test('FR-107 AC-617: 決定者の名前は議事項目の決定者の欄を自動では埋めない', async () => {
  const { app } = await newApp();
  app.setRole('decider', '佐藤');
  const r = app.addMeetingItem('decision', { text: '案 A に決める' });
  assert.equal(r.ok, true);
  const d = app.getMeetingItems().decisions.find((x) => x.id === r.id);
  assert.ok(!d.decider, '自動では補わない');
});

// FR-107 AC-618: 定型文から選ぶ。対象は会議全体または要点
test('FR-107 AC-618: 問いかけは定型文から選び、対象の要点を選べる。定型文以外・存在しない要点は受け付けない', async () => {
  const { app, pts } = await setup();
  assert.ok(QUESTION_PHRASES.some((p) => p.ja === '懸念はありますか'));
  assert.equal(app.askQuestion({ text: '自由な文' }).ok, false);
  assert.equal(app.askQuestion({ phraseId: 'q1', pointId: 'nope' }).ok, false);
  const a = app.askQuestion({ phraseId: 'q1' });
  const b = app.askQuestion({ phraseId: 'q2', pointId: pts[0].id });
  assert.ok(a.ok && b.ok);
  const qs = app.getQuestions();
  assert.equal(qs[0].text, '懸念はありますか');
  assert.equal(qs[1].pointText, pts[0].text);
  assert.equal(app.removeQuestion(a.id).ok, true);
  assert.equal(app.getQuestions().length, 1);
});

// FR-107 AC-619: 沈黙・無回答を合意と記録しない。「懸念あり」は異論・懸念に記録できる
test('FR-107 AC-619: 回答のない問いかけは「未回答」で、懸念なし・合意・承認とは決して出ない', async () => {
  const { app } = await newApp();
  const q = app.askQuestion({ phraseId: 'q4' });
  const v = app.getQuestions()[0];
  assert.equal(v.status, 'unanswered'); assert.equal(v.answer, null); assert.equal(v.statusLabel, '未回答');
  for (const bad of [undefined, null, '', 'agree', 'approved', 'none ', 0]) {
    assert.equal(app.answerQuestion(q.id, bad).ok, false);
    assert.equal(app.getQuestions()[0].status, 'unanswered');
  }
  assert.equal(answerOf({ answer: 'x' }), 'unanswered');
  const line = app.getConflictLines().questionLine;
  assert.match(line, /この内容で決めてよいですか（未回答）/);
  assert.ok(!/合意|承認|懸念なし/.test(line));
});

test('FR-107 AC-619: 「懸念あり」は選んだときだけ記録され、異論・懸念の項目にできる（二重にならない）', async () => {
  const { app } = await newApp();
  const q = app.askQuestion({ phraseId: 'q1' });
  assert.equal(app.recordQuestionConcern(q.id).ok, false, '懸念ありを選ぶまでは記録できない');
  assert.equal(app.answerQuestion(q.id, 'concern').ok, true);
  assert.equal(app.getQuestions()[0].statusLabel, '懸念あり');
  const r = app.recordQuestionConcern(q.id);
  assert.equal(r.ok, true);
  assert.equal(app.getMeetingItems().objections.length, 1);
  assert.equal(app.recordQuestionConcern(q.id).already, true);
  assert.equal(app.getMeetingItems().objections.length, 1);
  assert.equal(app.answerQuestion(q.id, 'none').ok, true);
  assert.equal(app.getQuestions()[0].statusLabel, '懸念なし');
});

// FR-107 AC-620: 保存・復元・初期化・出力
test('FR-107 AC-620: 役割・問いかけ・回答は保存・復元され、データの初期化で消える', async () => {
  const { app, env } = await newApp();
  app.setRole('recorder', '田中');
  const q = app.askQuestion({ phraseId: 'q3' });
  app.answerQuestion(q.id, 'hold');
  app.flushSave();
  const { app: app2 } = await newApp({ storage: env.storage });
  assert.equal(app2.getRoles().find((r) => r.id === 'recorder').name, '田中');
  assert.deepEqual(app2.getQuestions().map((x) => [x.text, x.status]), [['抜けている点はありませんか', 'hold']]);
  app2.commands['data.reset'](); await app2.dialogAction('confirm');
  assert.equal(app2.getRoles().every((r) => r.undecided), true);
  assert.equal(app2.getQuestions().length, 0);
});

test('FR-107 AC-620: テキスト一覧と Markdown・HTML に同じ語で載り、何もなければ従来の出力のまま', async () => {
  const { app, env } = await setup();
  assert.equal(app.getConflictLines().rolesLine, undefined);
  assert.ok(!app.renderOutline().includes('data-roles-outline'));
  app.setRole('facilitator', '鈴木'); app.askQuestion({ phraseId: 'q1' });
  assert.match(app.renderOutline(), /data-roles-outline="1"[\s\S]*進行役: 鈴木[\s\S]*懸念はありますか（未回答）/);
  await app.commands['save.markdown'](); await app.commands['save.html']();
  for (const d of env.downloads) {
    const s = text(d.data);
    assert.match(s, /会議の役割: 記録者: 未定 \/ 進行役: 鈴木 \/ 決定者: 未定/, d.filename);
    assert.match(s, /懸念はありますか（未回答）/, d.filename);
  }
  assert.ok(markdownHead({ rolesLine: 'R', questionLine: 'Q' }).includes('R') && markdownHead({ rolesLine: 'R', questionLine: 'Q' }).includes('Q'));
  const h = htmlHead({ rolesLine: 'R<', questionLine: 'Q' }, 'ja', (x) => x.replace(/</g, '&lt;'));
  assert.match(h, /data-meeting="roles">R&lt;/); assert.match(h, /data-meeting="question">Q/);
});

test('FR-107 AC-620: 会議の文字列は escape され、機密の要点への問いかけは機密を除く出力から除かれる', async () => {
  const { app, env, pts } = await setup();
  app.setRole('recorder', '<img src=x onerror=alert(1)>');
  assert.ok(!app.getConflictOutlineHtml().includes('<img'));
  assert.ok(app.getConflictOutlineHtml().includes('&lt;img'));
  app.setPointConfidential(pts[0].id, true);
  app.askQuestion({ phraseId: 'q1', pointId: pts[0].id });
  app.askQuestion({ phraseId: 'q2' });
  app.setExcludeConfidential(true);
  await app.commands['save.markdown']();
  const s = text(env.downloads[0].data);
  assert.ok(!s.includes('懸念はありますか'), '機密の要点への問いかけは除く');
  assert.ok(s.includes('異論はありませんか'));
  assert.ok(app.getQuestions().length === 2, '画面・状態には残る');
});

// NFR-A11Y-001 AC-036: キーと Esc
test('FR-107 AC-036: roles.open・question.open のキーがあり、Esc で閉じる', async () => {
  const { app } = await newApp();
  assert.ok(keyFor(app, 'roles.open') && keyFor(app, 'question.open'));
  assert.equal(app.handleKey(keyFor(app, 'roles.open')), 'roles.open');
  assert.equal(app.getRolesView().which, 'roles');
  assert.equal(app.handleKey({ key: 'Escape' }), 'roles.close');
  assert.equal(app.getRolesView(), null);
  assert.equal(app.handleKey(keyFor(app, 'question.open')), 'question.open');
  assert.equal(app.getRolesView().which, 'question');
  app.handleKey({ key: 'Escape' });
  assert.equal(app.getRolesView(), null);
});
