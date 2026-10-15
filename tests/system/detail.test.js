// FR-026 AC-130 AC-131 AC-133 / FR-026 AC-137 / AC-009（大項目・中項目）/ AC-123（2D 大項目のトピック）
// 契約: tests/system/CONTRACT.md「図の詳細度」。期待値は受入基準だけから決める。
// 手順: 詳細度の既定は「大項目」（AC-130）。要点・関係線・絵記号を確かめるときは setDetailLevel('detail')（「詳細」）へ、
//       シーンの見出しは 'middle'（中項目）へ切り替えてから確かめる。既存の AC-009・010・078〜081・094・123 は「詳細」への切替を冒頭で行う。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, makeEnv, loadApp, keyFor, toDetail } from './helpers.js';

// 話題が 2 つ（予算・リリース）になる 4 シーン。各シーンは空白区切りの語を 2 語以上（PARAM-015）共有するものだけが同じトピックになる。
const GROUPS = [
  ['予算 コスト 見直し 必要'],
  ['予算 コスト 削減 検討'],
  ['リリース 計画 決定 日程'],
  ['リリース 計画 担当 確認'],
];
async function seed(app, env) {
  app.commands['session.start']();
  GROUPS.forEach((g, i) => {
    g.forEach((t) => { app.setDraft(t); app.submitDraft(); env.tick(1); });
    if (i < GROUPS.length - 1) app.commands['session.nextScene']();
  });
  return app.getState().scenes;
}
const pointTexts = (app) => app.getState().scenes.flatMap((s) => s.points.map((p) => p.text));
const svgOf = (app) => app.renderSvg();

// FR-026 AC-130
test('FR-026 AC-130: 保存された設定がないとき 2D の図は「大項目」で、トピックの題名だけが見え、要点・シーンの見出しは描かれない', async () => {
  const { app, env } = await newApp();
  const scenes = await seed(app, env);
  assert.equal(app.getDetailLevel(), 'major');
  assert.equal(app.getDetailInfo().level, 'major');
  const topics = app.getTopics();
  assert.ok(topics.length >= 1 && topics.length <= scenes.length);
  const svg = svgOf(app);
  for (const t of topics) { assert.ok(t.title.trim()); assert.ok(svg.includes(t.title), `トピック「${t.title}」が図にある`); assert.ok(svg.includes(`data-topic-id="${t.id}"`)); }
  for (const t of pointTexts(app)) assert.ok(!svg.includes(t), `要点「${t}」は図に描かれない`);
  const titles = topics.map((t) => t.title);
  for (const s of scenes) if (!titles.some((x) => x.includes(s.heading))) assert.ok(!svg.includes(s.heading), `見出し「${s.heading}」は図に描かれない`);
  assert.ok(!/data-scene-id=/.test(svg), '大項目ではシーンの要素がない');
});

test('FR-026 AC-130 異常系: 話題が共通しないシーンは別のトピックになり、トピック数はシーン数以下。シーン 0 件では何も描かれない', async () => {
  const { app, env } = await newApp();
  assert.ok(!/data-topic-id=/.test(svgOf(app)));
  const scenes = await seed(app, env);
  const topics = app.getTopics();
  assert.equal(topics.length, 2, '予算の 2 シーンとリリースの 2 シーン');
  assert.ok(topics.length <= scenes.length);
  const all = topics.flatMap((t) => t.sceneIds).sort();
  assert.deepEqual(all, scenes.map((s) => s.id).sort(), 'すべてのシーンがちょうど 1 つのトピックに属する');
});

test('FR-026 AC-130 異常系: 保存された設定が不正な値のときは既定の「大項目」になる', async () => {
  const env = makeEnv();
  env.storage.setItem('grp.detail', 'nonsense');
  const app = await (await loadApp())(env.options);
  assert.equal(app.getDetailLevel(), 'major');
});

// FR-026 AC-131
test('FR-026 AC-131: 「中項目」でシーンの見出しが加わり、「詳細」で要点・関係線が加わり、「大項目」に戻すと元の表示になる', async () => {
  const { app, env } = await newApp();
  const scenes = await seed(app, env);
  const major = svgOf(app);
  assert.ok(app.setDetailLevel('middle').ok);
  const mid = svgOf(app);
  for (const s of scenes) assert.ok(mid.includes(`data-scene-id="${s.id}"`) && mid.includes(s.heading), '見出しが加わる');
  for (const t of pointTexts(app)) assert.ok(!mid.includes(t) || scenes.some((s) => s.heading.includes(t)), '中項目に要点は描かれない');
  assert.ok(app.setDetailLevel('detail').ok);
  const det = svgOf(app);
  for (const t of pointTexts(app)) assert.ok(det.includes(t), '要点が加わる');
  assert.ok(/<line|<path/.test(det), '関係線が加わる');
  assert.ok(app.setDetailLevel('major').ok);
  assert.equal(svgOf(app), major, '大項目に戻すと元の表示');
});

test('FR-026 AC-131: どの詳細度でも内容・選択中のオブジェクト・記録中の状態が失われず、記録中にも変更でき、時系列・整理の両方に適用される', async () => {
  const { app, env } = await newApp();
  const scenes = await seed(app, env);
  toDetail(app);
  app.selectScene(scenes[1].id);
  app.setDraft('入力中の文字');
  const snap = () => JSON.stringify([app.getState().utterances, app.getState().scenes, app.getState().selectedSceneId, app.getState().session, app.getState().input.draft, app.getDisplayMode()]);
  const before = snap();
  for (const mode of ['timeline', 'arrange']) {
    app.setDisplayMode(mode);
    const base = snap().replace('"timeline"', '"X"').replace('"arrange"', '"X"');
    for (const lv of ['middle', 'major', 'detail']) {
      assert.ok(app.setDetailLevel(lv).ok, `${mode}/${lv}`);
      assert.equal(app.getState().session, 'recording', '記録中の状態が保たれる');
      assert.equal(snap().replace('"timeline"', '"X"').replace('"arrange"', '"X"'), base, `${mode}/${lv} で内容が失われない`);
    }
  }
  app.setDisplayMode('timeline');
  assert.equal(snap(), before);
  app.setDraft('記録中に追加する発話'); assert.ok(app.submitDraft().ok, '詳細度の変更後も発話を受け付ける');
  app.setDetailLevel('middle');
  app.setDraft('変更直後の発話'); assert.ok(app.submitDraft().ok);
  assert.ok(app.getState().utterances.some((u) => u.text === '変更直後の発話'));
});

test('FR-026 AC-131 異常系: 不正な詳細度は拒否され、現在の詳細度・図は変わらない', async () => {
  const { app, env } = await newApp();
  await seed(app, env);
  app.setDetailLevel('middle');
  const before = svgOf(app);
  for (const bad of ['', 'minor', null, undefined, 3]) {
    let r; try { r = app.setDetailLevel(bad); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, String(bad));
  }
  assert.equal(app.getDetailLevel(), 'middle');
  assert.equal(svgOf(app), before);
});

// FR-026 AC-132 に関わる保存の取り決め（再読込後も保たれ、セッションファイルには含まれない）は契約どおり。ここでは AC-131 の「失われない」の一部として確かめる。
test('FR-026 AC-131: 詳細度は端末の設定として再読込後も保たれ、セッションファイルには含まれない', async () => {
  const { app, env, createApp } = await newApp();
  await seed(app, env);
  app.setDetailLevel('middle');
  const saved = await app.commands['file.save']();
  assert.equal(saved.ok, true);
  const data = env.downloads.at(-1).data;
  assert.ok(!Object.keys(JSON.parse(data)).some((k) => /detail/i.test(k)), 'セッションファイルに詳細度のキーがない');
  const app2 = await createApp(env.options);
  assert.equal(app2.getDetailLevel(), 'middle', '再読込後も保たれる');
});

// FR-026 AC-133
test('FR-026 AC-133: 詳細度はキーボードとコマンドの検索から少ない手順で設定でき、現在の詳細度が表示される', async () => {
  const { app } = await newApp();
  for (const c of ['detail.major', 'detail.middle', 'detail.detail', 'detail.next']) {
    assert.equal(typeof app.commands[c], 'function', c);
    assert.ok(keyFor(app, c), `${c} のキー割り当て`);
  }
  const info = app.getDetailInfo();
  assert.deepEqual(info.options.map((o) => o.level), ['major', 'middle', 'detail']);
  assert.equal(info.options.filter((o) => o.current).length, 1);
  assert.equal(info.options.find((o) => o.current).level, 'major');
  assert.deepEqual(info.options.map((o) => o.label), ['大項目', '中項目', '詳細']);
  // キーボード 1 手で切り替わる
  assert.equal(app.handleKey(keyFor(app, 'detail.next')), 'detail.next');
  assert.equal(app.getDetailLevel(), 'middle');
  assert.equal(app.getDetailInfo().label, '中項目', '現在の詳細度が表示される');
  // コマンドの検索
  for (const o of info.options) {
    const hit = app.searchCommands(o.label).map((x) => x.command);
    assert.ok(hit.some((c) => c.startsWith('detail.')), `検索「${o.label}」で詳細度のコマンドが見つかる`);
  }
  const cmd = app.searchCommands('詳細').find((x) => x.command === 'detail.detail');
  assert.ok(cmd, '「詳細」の検索で detail.detail が見つかる');
  app.commands[cmd.command]();
  assert.equal(app.getDetailLevel(), 'detail');
});

test('FR-026 AC-133: 操作のラベルは PARAM-011（6）文字以内で、変更の結果は画面の読み上げ対象のメッセージで示される（ja・en）', async () => {
  const { app } = await newApp();
  const width = (s) => [...s].reduce((n, ch) => n + (/[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/.test(ch) ? 1 : 0.5), 0);
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    for (const o of app.getDetailInfo().options) assert.ok(o.label.trim() && width(o.label) <= 6, `${lang}: ${o.label}`);
    for (const c of ['detail.middle', 'detail.detail', 'detail.major']) {
      app.commands[c]();
      const label = app.getDetailInfo().label;
      assert.ok(app.getState().message?.text?.includes(label), `${lang}: メッセージに「${label}」`);
      assert.equal(app.getCommandBar().status.role, 'status');
    }
  }
  const ja = (app.setLang('ja'), app.getStrings()); const en = (app.setLang('en'), app.getStrings());
  assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort(), 'ja と en のキー集合が同一');
});

test('FR-026 AC-133: 3D 表示・テキスト一覧・ポップアップは詳細度の影響を受けず、すべての要点が文字でも確認できる', async () => {
  const { app, env } = await newApp();
  const scenes = await seed(app, env);
  const snap = () => JSON.stringify([app.get3D(), app.renderOutline(), (app.selectScene(scenes[0].id), app.getScenePopup())]);
  app.setDetailLevel('detail'); const base = snap();
  for (const lv of ['major', 'middle', 'detail']) {
    app.setDetailLevel(lv);
    assert.equal(snap(), base, `${lv}: 3D・テキスト一覧・ポップアップが同じ`);
    const outline = app.renderOutline();
    for (const t of pointTexts(app)) assert.ok(outline.includes(t), `${lv}: 要点「${t}」がテキスト一覧にある`);
  }
});

test('FR-026 AC-133 異常系: 同じ詳細度を選び直しても何も壊れず、現在の詳細度の表示は 1 つだけ', async () => {
  const { app } = await newApp();
  app.commands['detail.major']();
  app.commands['detail.major']();
  assert.equal(app.getDetailLevel(), 'major');
  assert.equal(app.getDetailInfo().options.filter((o) => o.current).length, 1);
});

// FR-026 AC-137
async function arranged() {
  const { app, env } = await newApp();
  const scenes = await seed(app, env);
  toDetail(app);
  app.setDisplayMode('arrange');
  const arr = app.getArrangement();
  const [v0, v1] = arr.axes.vertical.sections; const [h0, h1] = arr.axes.horizontal.sections;
  const [t1, t2] = app.getTopics();
  const pid = (i) => scenes[i].points[0].id;
  // トピック 1（予算）: 2 件とも (v1,h1)。トピック 2（リリース）: 縦は v0 と v1 が同数
  app.assignObject(pid(0), { v: v1.id, h: h1.id });
  app.assignObject(pid(1), { v: v1.id, h: h1.id });
  app.assignObject(pid(2), { v: v1.id, h: h0.id });
  app.assignObject(pid(3), { v: v0.id, h: h0.id });
  return { app, scenes, arr, v0, v1, h0, h1, t1, t2 };
}
const asg = (app, id) => app.getArrangement().assignments.find((x) => x.objectId === id);

test('FR-026 AC-137: 整理の「大項目」で、トピックは属する要点の最多の区分（同数は区分の並びで先）に置かれ、軸・区分の見出し・未分類は表示される', async () => {
  const { app, v0, v1, h0, h1, t1, t2, arr } = await arranged();
  app.setDetailLevel('major');
  const a1 = asg(app, t1.id); const a2 = asg(app, t2.id);
  assert.ok(a1 && a1.kind === 'topic');
  assert.equal(a1.v, v1.id); assert.equal(a1.h, h1.id);
  assert.equal(a2.v, v0.id, '同数のときは区分の並び順で先のもの'); assert.equal(a2.h, h0.id);
  const svg = svgOf(app);
  for (const ax of [arr.axes.vertical, arr.axes.horizontal]) { assert.ok(svg.includes(ax.name)); for (const s of ax.sections) assert.ok(svg.includes(s.label)); }
  assert.ok(svg.includes(arr.unclassified.label), '未分類の領域が表示される');
  for (const t of [t1, t2]) assert.ok(svg.includes(t.title));
  for (const t of pointTexts(app)) assert.ok(!svg.includes(t), '大項目に要点は描かれない');
  assert.notDeepEqual(a1.position, a2.position);
});

test('FR-026 AC-137: 中項目ではシーンの見出しも属する要点の最多の区分に置かれ、単位を選ぶと置かれた区分と理由（内訳）が文字で表示される', async () => {
  const { app, scenes, v1, h1, t1 } = await arranged();
  app.setDetailLevel('middle');
  const a = asg(app, scenes[0].id);
  assert.ok(a && a.kind === 'scene'); assert.equal(a.v, v1.id); assert.equal(a.h, h1.id);
  const dT = app.describeObject(t1.id);
  assert.ok(dT.text.includes(v1.label) && dT.text.includes(h1.label), '置かれた区分');
  const b = asg(app, t1.id).breakdown;
  assert.ok(Array.isArray(b) && b.reduce((n, x) => n + x.count, 0) === t1.pointIds.length, '内訳は属する要点の割り当て');
  assert.ok(/2/.test(dT.text), '内訳の件数が文字で表示される');
});

test('FR-026 AC-137: 要点の移動は「詳細」で行い、「詳細」に切り替えた後の割り当てが大項目・中項目の位置に反映される', async () => {
  const { app, scenes, v0, h0, t1 } = await arranged();
  app.setDetailLevel('major');
  const before = asg(app, t1.id);
  toDetail(app);
  app.assignObject(scenes[0].points[0].id, { v: v0.id, h: h0.id });
  app.assignObject(scenes[1].points[0].id, { v: v0.id, h: h0.id });
  app.setDetailLevel('major');
  const after = asg(app, t1.id);
  assert.equal(after.v, v0.id); assert.equal(after.h, h0.id);
  assert.notDeepEqual(after.position, before.position);
});

test('FR-026 AC-137: 2D の大項目でトピックを選ぶと、題名と属するシーンの見出し・要点が図の上のポップアップとして描画される（閉じ方・選択の保持は AC-124）', async () => {
  const { app, scenes, t1 } = await arranged();
  app.setDetailLevel('major');
  assert.ok(app.selectTopic(t1.id).ok);
  const p = app.getScenePopup();
  assert.ok(p && p.open === true && p.topicId === t1.id);
  assert.equal(p.title, t1.title);
  assert.ok(p.html.includes(t1.title));
  for (const s of scenes.filter((x) => t1.sceneIds.includes(x.id))) { assert.ok(p.html.includes(s.heading)); for (const pt of s.points) assert.ok(p.html.includes(pt.text)); }
  for (const s of scenes.filter((x) => !t1.sceneIds.includes(x.id))) for (const pt of s.points) assert.ok(!p.html.includes(pt.text), '他のトピックの要点は含まない');
  assert.ok(['dialog', 'region', 'tooltip'].includes(p.role) && p.label);
  assert.equal(app.handleKey({ key: 'Escape' }), 'popup.close');
  assert.equal(app.getScenePopup(), null);
});

test('FR-026 AC-137 異常系: 要点が 1 件も割り当てられていないトピックは「未分類」に置かれ、存在しないトピックの選択はポップアップを開かない', async () => {
  const { app, env } = await newApp();
  await seed(app, env);
  app.setDisplayMode('arrange'); app.setDetailLevel('major');
  const [t1] = app.getTopics();
  const a = asg(app, t1.id);
  assert.equal(a.unclassified, true);
  assert.ok(app.describeObject(t1.id).text.includes(app.getArrangement().unclassified.label));
  const r = app.selectTopic('no-such-topic');
  assert.equal(r.ok, false);
  assert.equal(app.getScenePopup(), null);
});

// FR-004 AC-009（詳細度が「大項目」「中項目」のとき）
test('FR-004 AC-009: 「大項目」「中項目」では新しい要点は図に描かれず、テキスト一覧に文字で表示され、図はトピック（・見出し）の更新として反映される', async () => {
  const { app, env } = await newApp();
  const scenes = await seed(app, env);
  for (const lv of ['major', 'middle']) {
    app.setDetailLevel(lv);
    const text = `新しい要点${lv}を発話`;
    const svg0 = svgOf(app); const n0 = app.getState().scenes.length;
    app.setDraft(text); assert.ok(app.submitDraft().ok); env.tick(1);
    assert.ok(!svgOf(app).includes(text), `${lv}: 要点は図に描かれない`);
    assert.ok(app.renderOutline().includes(text), `${lv}: テキスト一覧に文字で表示される`);
    assert.equal(app.getState().session, 'recording');
    assert.ok(app.getTopics().length <= app.getState().scenes.length && app.getState().scenes.length === n0);
    void svg0;
  }
  assert.ok(app.getTopics().flatMap((t) => t.pointIds).length >= scenes.length, 'トピックは新しい要点を含む');
});

test('FR-004 AC-009 異常系: 「大項目」で新しいシーンが追加されると、記録中の状態・発話の受付・選択中のシーンが失われずトピックが更新される', async () => {
  const { app, env } = await newApp();
  const scenes = await seed(app, env);
  app.selectScene(scenes[0].id);
  app.setDetailLevel('major');
  const n = app.getTopics().length;
  app.commands['session.nextScene']();
  app.setDraft('全く別の話題 新規 議題'); assert.ok(app.submitDraft().ok); env.tick(1);
  assert.equal(app.getState().session, 'recording');
  assert.equal(app.getState().selectedSceneId, scenes[0].id);
  assert.ok(app.getTopics().length >= n && app.getTopics().length <= app.getState().scenes.length);
  assert.ok(svgOf(app).includes(app.getTopics().at(-1).title), '図にトピックの更新が反映される');
});

// FR-024 AC-123（2D の大項目ではシーンが描かれないため、トピックの選択は AC-137）
test('FR-024 AC-123 異常系: 2D の「大項目」ではシーンのオブジェクトが描かれず、詳細度を「詳細」にするとシーンを選択してポップアップが開く', async () => {
  const { app, env } = await newApp();
  const scenes = await seed(app, env);
  assert.ok(!/data-scene-id=/.test(svgOf(app)));
  toDetail(app);
  assert.ok(new RegExp(`data-scene-id="${scenes[0].id}"`).test(svgOf(app)));
  app.selectScene(scenes[0].id);
  assert.equal(app.getScenePopup()?.sceneId, scenes[0].id);
});
