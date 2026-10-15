// FR-025 AC-127 AC-128 AC-129 AC-135 AC-136 / FR-026 AC-132 AC-138 の単体・結合テスト（トピック分類・詳細度）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, makeEnv, loadApp } from '../system/helpers.js';
import { classifyTopics, topicRelations, tokenize, emptyEdits, MIN_SHARED } from '../../web/src/topics.js';

const sc = (id, heading, points = [heading]) => ({ id, heading, points: points.map((t, i) => ({ id: `${id}p${i}`, text: t })), relations: [], status: 'confirmed' });
const SCENES = [
  sc('s1', '予算 コスト 見直し 必要'), sc('s2', '予算 コスト 削減 検討'),
  sc('s3', 'リリース 計画 決定 日程'), sc('s4', '予算 コスト 再確認'),
];

// FR-025 AC-127: 決定的・題名は語句だけ・どのシーンも必ず 1 つのトピックに属する
test('FR-025 AC-127: 同じ入力から同じ分類・題名が得られ、題名は属するシーンの語句だけから成り、全シーンがちょうど 1 つのトピックに属する', () => {
  assert.equal(MIN_SHARED, 2);
  const a = classifyTopics(SCENES); const b = classifyTopics(SCENES);
  assert.deepEqual(a, b);
  const all = a.flatMap((t) => t.sceneIds).sort();
  assert.deepEqual(all, SCENES.map((s) => s.id).sort());
  for (const t of a) {
    const pool = new Set(t.sceneIds.flatMap((id) => tokenize([SCENES.find((s) => s.id === id).heading])).map((w) => w.toLowerCase()));
    for (const w of tokenize([t.title])) assert.ok(pool.has(w.toLowerCase()), `題名の語「${w}」はシーンの語句`);
  }
  assert.deepEqual(classifyTopics([]), []);
});

// FR-025 AC-128: 直前のトピックとだけ比べる・共通語句なら題名・シーン 1 つなら見出し
test('FR-025 AC-128: 2 語以上共有すると直前のトピックに属し、複数に該当しても直前のトピックだけ。トピック数はシーン数以下', () => {
  const t = classifyTopics(SCENES);
  assert.equal(t.length, 3, 'S4 は予算と共通でも直前（リリース）とは共有しないので新しいトピック');
  assert.deepEqual(t[0].sceneIds, ['s1', 's2']);
  assert.equal(t[0].title, '予算 コスト');
  assert.equal(t[1].title, 'リリース 計画 決定 日程', 'シーンが 1 つのトピックの題名はそのシーンの見出し');
  assert.ok(t.length <= SCENES.length);
  const one = classifyTopics([sc('a', '予算 コスト'), sc('b', '予算 だけ')]);
  assert.equal(one.length, 2, '共有が 1 語だけなら別のトピック');
});

test('FR-025 AC-128: シーンが追加されたとき（記録中）、記録中の状態・発話の受付・選択中のシーンが失われず、分類と題名が更新される', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  app.setDraft('予算 コスト 見直し 必要'); app.submitDraft(); env.tick(1);
  const first = app.getState().selectedSceneId;
  assert.equal(app.getTopics().length, 1);
  app.commands['session.nextScene']();
  app.setDraft('予算 コスト 削減 検討'); app.submitDraft(); env.tick(1);
  assert.equal(app.getTopics().length, 1);
  assert.equal(app.getTopics()[0].title, '予算 コスト');
  app.commands['session.nextScene']();
  app.setDraft('全く別 話題 新規 議題'); assert.ok(app.submitDraft().ok);
  assert.equal(app.getTopics().length, 2);
  assert.equal(app.getState().session, 'recording');
  assert.equal(app.getState().selectedSceneId, first);
});

// FR-025 AC-129: 手修正は以後の自動分類で戻されず、階層はテキスト一覧でも文字で確認できる
test('FR-025 AC-129: 手修正した要点は以後の自動分類で戻されず、トピックの階層がテキスト一覧に文字で出る', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  app.setDraft('予算 コスト 見直し 必要'); app.submitDraft(); env.tick(1);
  const p = app.getState().scenes[0].points[0];
  assert.ok(app.editPoint(p.id, '手で直した 要点').ok);
  app.commands['session.nextScene']();
  app.setDraft('予算 コスト 削減 検討'); app.submitDraft(); env.tick(1);
  assert.equal(app.getState().scenes[0].points[0].text, '手で直した 要点');
  const html = app.renderOutline();
  const t = app.getTopics()[0];
  assert.ok(html.includes('outline-topics') && html.includes(t.title));
  for (const s of app.getState().scenes) assert.ok(html.includes(s.heading));
});

// FR-025 AC-135: 順・関連、決定的、線と文字、テキスト一覧
test('FR-025 AC-135: 隣り合うトピックは「順」、隣り合わなくても 2 語以上共有すれば「関連」で、決定的', () => {
  const list = [sc('a', '予算 コスト 見直し'), sc('b', 'リリース 計画 日程'), sc('c', '予算 コスト 再確認 担当')];
  const topics = classifyTopics(list);
  assert.equal(topics.length, 3);
  const r = topicRelations(topics, list);
  assert.deepEqual(r.map((x) => `${x.from}>${x.to}:${x.kind}`).sort(),
    [`${topics[0].id}>${topics[1].id}:order`, `${topics[1].id}>${topics[2].id}:order`, `${topics[0].id}>${topics[2].id}:related`].sort());
  assert.deepEqual(r, topicRelations(classifyTopics(list), list));
  const none = topicRelations(classifyTopics([sc('a', '甲 乙'), sc('b', '丙 丁'), sc('c', '戊 己')]), [sc('a', '甲 乙'), sc('b', '丙 丁'), sc('c', '戊 己')]);
  assert.ok(none.every((x) => x.kind === 'order'));
});

test('FR-025 AC-135: 関係は大項目の図に線と種類の文字で描かれ、テキスト一覧でも文字で確認できる（ja・en）', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  for (const [i, t] of ['予算 コスト 見直し', 'リリース 計画 日程', '予算 コスト 再確認 担当'].entries()) { if (i) app.commands['session.nextScene'](); app.setDraft(t); app.submitDraft(); env.tick(1); }
  const rels = app.getTopicRelations();
  assert.deepEqual(rels.map((r) => r.kind).sort(), ['order', 'order', 'related']);
  const svg = app.renderSvg();
  assert.equal((svg.match(/data-topic-relation=/g) ?? []).length, 3);
  for (const r of rels) assert.ok(svg.includes(`>${r.label}</text>`), `ラベル ${r.label}`);
  assert.ok(app.renderOutline().includes('関連'));
  app.setLang('en');
  assert.ok(app.getTopicRelations().some((r) => r.label === 'Related'));
  assert.ok(app.renderSvg().includes('>Related</text>'));
});

// FR-025 AC-136: 題名の編集・シーンの移動。以後の自動分類で戻されない。コマンドでも行える
test('FR-025 AC-136: 題名を編集・シーンを別のトピック（新しいトピック）へ移せ、以後の自動更新で戻らず、記録中の状態も失われない', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  for (const [i, t] of ['予算 コスト 見直し', 'リリース 計画 日程'].entries()) { if (i) app.commands['session.nextScene'](); app.setDraft(t); app.submitDraft(); env.tick(1); }
  const [t1, t2] = app.getTopics();
  assert.ok(app.renameTopic(t1.id, '予算の話').ok);
  assert.equal(app.getTopics()[0].title, '予算の話');
  assert.equal(app.renameTopic(t1.id, '  ').ok, false);
  assert.equal(app.renameTopic('no-such', 'x').ok, false);
  // 2 つ目のシーンを 1 つ目のトピックへ移す
  assert.equal(app.moveSceneToTopic(t2.sceneIds[0], t1.id).ok, true);
  assert.equal(app.getTopics().length, 1);
  assert.equal(app.getTopics()[0].title, '予算の話', '題名の手修正は引き継がれる');
  // 以後の発話（自動の分類・題名の更新）で戻らない
  app.commands['session.nextScene']();
  app.setDraft('予算 コスト 追加 確認'); assert.ok(app.submitDraft().ok);
  assert.equal(app.getState().session, 'recording');
  const after = app.getTopics();
  assert.equal(after.length, 2, '直前の自動の分類と共通しない新しいシーンは新しいトピック');
  assert.equal(after[0].sceneIds.length, 2, '手で移したシーンは戻らない');
  assert.equal(after[0].title, '予算の話');
  // 新しいトピックへ（コマンド経由）
  app.selectScene(app.getState().scenes[1].id);
  app.commands['topic.moveNew']();
  assert.equal(app.getTopics().length, 3);
  app.commands['topic.movePrev']();
  assert.equal(app.getTopics().length, 2);
  assert.equal(app.moveSceneToTopic('none', null).ok, false);
  assert.equal(app.moveSceneToTopic(app.getState().scenes[0].id, 'no-such').ok, false);
  for (const c of ['topic.moveNew', 'topic.moveNext', 'topic.movePrev', 'topic.next', 'topic.prev']) assert.ok(app.keymap.some((k) => k.command === c), `${c} にキー割り当て`);
});

test('FR-025 AC-136: 手修正したトピックはセッションの保存・復元とファイル保存・読込で保たれ、データの初期化で消える', async () => {
  const { app, env, createApp } = await newApp();
  app.commands['session.start']();
  for (const [i, t] of ['予算 コスト 見直し', '予算 コスト 削減'].entries()) { if (i) app.commands['session.nextScene'](); app.setDraft(t); app.submitDraft(); env.tick(1); }
  const t = app.getTopics()[0];
  app.renameTopic(t.id, '保たれる題名');
  const app2 = await createApp(env.options);
  assert.equal(app2.getTopics()[0].title, '保たれる題名');
  await app.commands['file.save']();
  const data = JSON.parse(env.downloads.at(-1).data);
  assert.equal(data.topicEdits.titles[t.id], '保たれる題名');
  void app.commands['data.reset']();
  await app.dialogAction('confirm');
  assert.deepEqual(app.getState().topicEdits, emptyEdits());
});

// FR-026 AC-132: 端末の設定
test('FR-026 AC-132: 詳細度は再読込後に復元され、データの初期化では変わらず、セッションファイルには含まれない', async () => {
  const env = makeEnv();
  const createApp = await loadApp();
  const app = await createApp(env.options);
  app.setDetailLevel('middle');
  assert.equal(env.storage.getItem('grp.detail'), JSON.stringify('middle'));
  app.commands['session.start'](); app.setDraft('予算 コスト'); app.submitDraft();
  await app.commands['file.save']();
  assert.ok(!/detail/i.test(Object.keys(JSON.parse(env.downloads.at(-1).data)).join(',')));
  void app.commands['data.reset'](); await app.dialogAction('confirm');
  assert.equal(app.getDetailLevel(), 'middle');
  assert.equal((await createApp(env.options)).getDetailLevel(), 'middle');
  assert.equal(app.setDetailLevel('bogus').ok, false);
});

// FR-026 AC-138: 選択中のシーンが図に描かれない詳細度
test('FR-026 AC-138: 大項目へ切り替えても選択は失われず、属するトピックが文字で示され、ポップアップは内容を保ち、トピックの選択でシーンの選択は変わらない', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  for (const [i, t] of ['予算 コスト 見直し', '予算 コスト 削減', 'リリース 計画 日程'].entries()) { if (i) app.commands['session.nextScene'](); app.setDraft(t); app.submitDraft(); env.tick(1); }
  const scenes = app.getState().scenes;
  app.setDetailLevel('detail');
  app.selectScene(scenes[1].id);
  const popup = app.getScenePopup();
  app.setDetailLevel('major');
  assert.equal(app.getState().selectedSceneId, scenes[1].id);
  assert.deepEqual(app.getScenePopup(), popup, 'ポップアップは内容を保つ');
  const tops = app.getTopics();
  assert.deepEqual(tops.map((t) => t.containsSelected), [true, false]);
  const svg = app.renderSvg();
  assert.ok(svg.includes('選択中のシーンを含む'), '文字で示される');
  assert.equal((svg.match(/data-role="contains-selected"/g) ?? []).length, 1);
  // トピックを選んでもシーンの選択は変わらない
  assert.ok(app.selectTopic(tops[1].id).ok);
  assert.equal(app.getState().selectedSceneId, scenes[1].id);
  assert.equal(app.getScenePopup().topicId, tops[1].id);
  app.setDetailLevel('middle');
  assert.ok(app.renderSvg().includes(`data-scene-id="${scenes[1].id}"`) && app.renderSvg().includes('aria-current="true"'), '中項目では選択中のシーンが表示される');
  app.setDetailLevel('detail');
  assert.equal(app.getState().selectedSceneId, scenes[1].id);
});
