// FR-080 AC-435 AC-439（FR-079 AC-426・428・430・432・434 の規則を AC-435 の「FR-079 の規則で再配置され」として確かめる）
// System Test。契約: tests/system/CONTRACT-ARRANGE.md。期待値は受入基準だけから決める。実装がなければ失敗するのが正常（not_run → 実装後に pass）。
// 時計: rearrange-util.js の LinkedScheduler（起動からの経過 ms。テスト用の時計の注入）。周期は PARAM-084＝10 秒。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  P, T, KIND_ORDER, arrangeApp, seededDetail, say, elements, box, posMap, pointIdOf, elementOfPoint, elementOfScene,
  assertNoOverlap, assertAligned, before, gap, kindLabelOf, toDetail, FakeVisibility,
} from './rearrange-util.js';

const PERIOD = P.INTERVAL_DEFAULT_SEC * 1000;
const count = (app) => app.getArrangeStatus().count;
const pointsOfScene = (app, sceneElId) => elements(app).filter((e) => e.kind === 'point' && e.parentId === sceneElId);
// 下位のまとまりを含め、シーンの要素の子孫の要点
const descendantPoints = (app, rootId) => {
  const list = elements(app); const kids = (id) => list.filter((e) => e.parentId === id);
  const out = []; const walk = (id) => { for (const c of kids(id)) { if (c.kind === 'point') out.push(c); else walk(c.id); } }; walk(rootId); return out;
};

// ---- FR-080 AC-435 ----
// FR-080 AC-435
test('FR-080 AC-435: 初期値の周期では、起動から 10 秒の時点ちょうどで初めて再配置され、それより前の追加は暫定の位置のまま', async () => {
  const { app, env, scheduler } = await arrangeApp();
  assert.equal(app.getArrangeInterval().sec, P.INTERVAL_DEFAULT_SEC);
  toDetail(app);
  app.commands['session.start']();
  scheduler.advanceTo(500); say(env, T.plain1);
  scheduler.advanceTo(500 + P.UPPER_SEC * 1000);
  const e = elementOfPoint(app, pointIdOf(app, T.plain1));
  assert.equal(e.provisional, true, '確定結果の受付から 3 秒以内に暫定の位置に表示される');
  assert.equal(count(app), 0);
  assert.equal(app.getArrangeStatus().pending, true);
  scheduler.advanceTo(PERIOD - 1);
  assert.equal(count(app), 0, '周期の時点の前には再配置されない');
  scheduler.advanceTo(PERIOD);
  assert.equal(count(app), 1, '起動から 10 秒の時点で再配置される');
  assert.equal(app.getArrangeStatus().pending, false);
  assert.ok(elements(app).every((x) => x.provisional === false), '再配置後は暫定の位置の要素がない');
});

// FR-080 AC-435
test('FR-080 AC-435: 新しい要点は 3 秒以内に追加先のまとまりの読み順の末尾・重ならない位置に暫定表示され、前のまとまりの要素は動かず、次の周期の時点で再配置される', async () => {
  const { app, env, scheduler } = await seededDetail();
  assert.equal(count(app), 1);
  const topics = app.getTopics();
  assert.ok(topics.length >= 2, '語を共有しない 2 シーンは別のトピック');
  const scenes = app.getState().scenes;
  const sc1 = elementOfScene(app, scenes[0].id); const sc2 = elementOfScene(app, scenes[1].id);
  assert.ok(sc1 && sc2, 'シーンの要素がある');
  const pos0 = posMap(app);
  const prevTopicIds = elements(app).filter((x) => x.topicId === topics[0].id).map((x) => x.id);
  assert.ok(prevTopicIds.length >= 2, '前のトピックの要素（シーンと要点）がある');

  scheduler.advanceTo(PERIOD + 1000); say(env, T.problem); // 2 シーン目（最後の受付から 20 秒以内）
  scheduler.advanceTo(PERIOD + 1000 + P.UPPER_SEC * 1000);
  const id = pointIdOf(app, T.problem);
  assert.equal(app.getState().scenes.length, 2, '同じシーンに加わる');
  const e = elementOfPoint(app, id);
  assert.equal(e.provisional, true, '暫定の位置');
  assert.equal(e.parentId, sc2.id, '追加先のまとまり（2 シーン目）の中');
  const sibs = pointsOfScene(app, sc2.id);
  assert.equal(e.readIndex, Math.max(...sibs.map((s) => s.readIndex)), '読み順の末尾');
  assertNoOverlap(app, '暫定の位置:');
  const pos1 = posMap(app);
  for (const pid of prevTopicIds) assert.deepEqual(pos1.get(pid), pos0.get(pid), `前のトピックの要素 ${pid} の位置は変わらない（暫定表示）`);
  assert.equal(count(app), 1, '周期の時点の前は再配置されない');

  scheduler.advanceTo(2 * PERIOD - 1);
  assert.equal(count(app), 1);
  assert.deepEqual([...posMap(app)], [...pos1], '周期の時点まで位置は変わらない');
  scheduler.advanceTo(2 * PERIOD);
  assert.equal(count(app), 2, '前の時点以降に要素が加わったので再配置される');
  assert.equal(elementOfPoint(app, id).provisional, false);
  const pos2 = posMap(app);
  for (const pid of prevTopicIds) assert.deepEqual(pos2.get(pid), pos0.get(pid), `前のトピックの要素 ${pid} の位置は再配置でも変わらない（FR-079 AC-432(b)）`);
  assertNoOverlap(app, '再配置後:');
});

// FR-080 AC-435 異常系
test('FR-080 AC-435 異常系: 新しい要素が加わらなければ（暫定結果だけ・受け付けられない入力だけでも）周期の時点で再配置されず、すべての要素の位置が変わらない', async () => {
  const { app, env, scheduler } = await seededDetail();
  const c0 = count(app); const pos0 = posMap(app); const svg0 = app.renderSvg();
  scheduler.advanceTo(PERIOD + 2000);
  env.speech.emit('これは発話の途中の暫定', false); // 暫定結果は要素を加えない（AC-052）
  scheduler.advanceTo(PERIOD + 3000);
  app.setDraft('   '); assert.equal(app.submitDraft().ok, false, '空白だけは受け付けない');
  scheduler.advanceTo(4 * PERIOD);
  assert.equal(count(app), c0, '3 回の周期の時点で再配置されない');
  assert.equal(app.getArrangeStatus().pending, false);
  assert.deepEqual([...posMap(app)], [...pos0], 'すべての要素の位置が変わらない（冪等。FR-079 AC-432(c)）');
  assert.ok(elements(app).every((x) => x.provisional === false));
  // 一時停止中の確定結果は無視され、要素を加えない
  app.commands['session.pause']();
  say(env, T.problem);
  scheduler.advanceTo(5 * PERIOD);
  assert.equal(count(app), c0);
  assert.equal(app.renderSvg(), svg0);
});

// FR-080 AC-435 異常系
test('FR-080 AC-435 異常系: 画面が非表示の間に到来した再配置は、画面の復帰後 2 秒以内に行われる', async () => {
  const visibility = new FakeVisibility();
  const { app, env, scheduler } = await seededDetail({ visibility });
  const c0 = count(app);
  scheduler.advanceTo(PERIOD + 1000); visibility.set(true);
  scheduler.advanceTo(PERIOD + 1500); say(env, T.problem); // 非表示の間も記録は続く（NFR-BG-001）
  scheduler.advanceTo(2 * PERIOD + 5000); // 非表示の間に周期の時点（20 秒）が到来
  assert.ok(app.getState().utterances.some((u) => u.text === T.problem), '非表示の間の確定結果も記録される');
  visibility.set(false);
  scheduler.advance(P.RESUME_SEC * 1000);
  assert.ok(count(app) > c0, '復帰後 2 秒以内に再配置される');
  assert.equal(elementOfPoint(app, pointIdOf(app, T.problem)).provisional, false);
  assert.equal(app.getArrangeStatus().pending, false);
});

// ---- AC-435 の「FR-079 の規則で再配置され」 ----
// FR-080 AC-435 FR-079 AC-426 AC-430
test('FR-080 AC-435 FR-079 AC-426 AC-430: 再配置後、シーンの要点は種類の順（結論が先頭に昇格）で読み順に並び、整列・近接し、外枠が重ならず、シーンの並びは変わらない', async () => {
  const { app, env, scheduler } = await seededDetail();
  const scenes0 = app.getState().scenes.map((s) => s.id);
  scheduler.advanceTo(PERIOD + 1000); say(env, T.problem);
  scheduler.advanceTo(PERIOD + 2000); say(env, T.proposal);
  scheduler.advanceTo(PERIOD + 3000); say(env, T.conclusion);
  scheduler.advanceTo(2 * PERIOD);
  assert.deepEqual(app.getState().scenes.map((s) => s.id), scenes0, '新しいシーンはできていない');
  const sc1 = elementOfScene(app, scenes0[0]); const sc2 = elementOfScene(app, scenes0[1]);
  const pts = pointsOfScene(app, sc2.id).sort((a, b) => a.readIndex - b.readIndex);
  assert.equal(pts.length, 4, '2 シーン目の 4 要点がすべて描かれる');
  const concl = elementOfPoint(app, pointIdOf(app, T.conclusion));
  assert.equal(pts[0].id, concl.id, '結論の要点がシーンの読み順の先頭');
  for (const o of pts.slice(1)) assert.ok(before(concl, o), `結論は ${o.id} より上（同じ高さなら左）`);
  // 種類の順（結論・課題・提案・アイデア・未決定・補足）、同じ種類の中は話順
  const talk = app.getState().scenes[1].points.map((p) => p.id);
  const keys = pts.map((e) => { const lb = kindLabelOf(app, e.refIds[0]); assert.ok(KIND_ORDER.includes(lb), `種類のラベル ${lb}`); return [KIND_ORDER.indexOf(lb), talk.indexOf(e.refIds[0])]; });
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i - 1][0] < keys[i][0] || (keys[i - 1][0] === keys[i][0] && keys[i - 1][1] < keys[i][1]), `読み順 ${i - 1}→${i} が種類の順・話順`);
  // 読み順と位置が一致する（readIndex の順に before）
  for (let i = 1; i < pts.length; i++) assert.ok(before(pts[i - 1], pts[i]), `読み順 ${i - 1} の要点が ${i} より先の位置`);
  // 整列（PARAM-091 以内）と重なりなし
  assertAligned(pts, '2 シーン目の要点:');
  assertAligned(pointsOfScene(app, sc1.id), '1 シーン目の要点:');
  assertNoOverlap(app);
  // 近接: 同じシーンの隣り合う要点の間隔 < そのシーンの要点と隣のシーンの要点の間隔
  const inner = Math.max(...pts.slice(1).map((e, i) => gap(pts[i], e)));
  const outer = Math.min(...pts.flatMap((a) => pointsOfScene(app, sc1.id).map((b) => gap(a, b))));
  assert.ok(inner < outer, `近接: まとまりの中 ${inner} < まとまりの間 ${outer}`);
  // シーンの並び（話順）は変わらない
  const order = elements(app).map((e) => e.id);
  assert.ok(order.indexOf(sc1.id) < order.indexOf(sc2.id), 'シーンの読み順は話順のまま');
});

// FR-080 AC-435 FR-079 AC-428
test('FR-080 AC-435 FR-079 AC-428: 1 シーンの要点が 7 を超えると再配置で下位のまとまりに分かれ、どの下位のまとまりも 7 個以下で、要点は 1 つも消えず 1 つの下位のまとまりだけに属する', async () => {
  const { app, env, scheduler } = await arrangeApp();
  toDetail(app);
  app.commands['session.start']();
  const texts = ['北口の受付は九時から', '南口の受付は十時から', '駐車場は地下二階', '昼食は弁当を用意', '名札は入口で配布', '休憩は十五分', '撮影は後方から', '配布資料は二部'];
  texts.forEach((t, i) => { scheduler.advanceTo(500 + i * 500); say(env, t); });
  assert.equal(app.getState().scenes.length, 1, '1 シーンに 8 要点');
  scheduler.advanceTo(PERIOD);
  assert.equal(count(app), 1);
  const scene = elementOfScene(app, app.getState().scenes[0].id);
  const pts = descendantPoints(app, scene.id);
  const ids = pts.flatMap((e) => e.refIds).sort();
  assert.deepEqual(ids, app.getState().scenes[0].points.map((p) => p.id).sort(), 'すべての要点が図に残り、どれも 1 回だけ現れる');
  const list = elements(app);
  const subgroups = list.filter((e) => e.kind === 'subgroup');
  assert.ok(subgroups.length >= 2, '下位のまとまりに分かれる');
  for (const parent of [scene, ...subgroups]) {
    const kids = list.filter((e) => e.parentId === parent.id);
    assert.ok(kids.length <= P.GROUP_MAX, `${parent.id} の子は ${P.GROUP_MAX} 個以下（${kids.length}）`);
  }
  for (const g of subgroups) assertAligned(list.filter((e) => e.parentId === g.id), `下位のまとまり ${g.id}:`);
  assertNoOverlap(app);
});

// FR-080 AC-435 FR-079 AC-434
test('FR-080 AC-435 FR-079 AC-434: 同じ発話列と同じ時点からは毎回同じ配置（並び・下位のまとまり・座標）になる', async () => {
  const run = async () => {
    const r = await seededDetail();
    r.scheduler.advanceTo(PERIOD + 1000); say(r.env, T.problem);
    r.scheduler.advanceTo(PERIOD + 2000); say(r.env, T.conclusion);
    r.scheduler.advanceTo(2 * PERIOD);
    const st = r.app.getState();
    const name = new Map([...st.scenes.map((s) => [s.id, `S:${s.heading}`]), ...st.scenes.flatMap((s) => s.points).map((p) => [p.id, `P:${p.text}`]), ...r.app.getTopics().map((t) => [t.id, `T:${t.title}`])]);
    return elements(r.app).map((e) => [e.kind, e.refIds.map((x) => name.get(x) ?? x).join('|'), e.readIndex, e.provisional, box(e)]);
  };
  const a = await run(); const b = await run();
  assert.ok(a.length > 0);
  assert.deepEqual(b, a);
});

// ---- FR-080 AC-439 ----
const keep = (app) => {
  const pop = app.getScenePopup();
  return {
    session: app.getState().session, selectedSceneId: app.getState().selectedSceneId,
    popup: pop && { open: pop.open, sceneId: pop.sceneId ?? null, topicId: pop.topicId ?? null, heading: pop.heading ?? null, title: pop.title ?? null, points: pop.points ?? null, scenes: pop.scenes ?? null },
    draft: app.getState().input.draft, detail: app.getDetailLevel(), layout: app.getLayoutInfo(), displayMode: app.getDisplayMode(),
    viewMode: app.getState().viewMode, view: app.getDiagramView(), utterances: app.getState().utterances.map((u) => u.text),
  };
};

// FR-080 AC-439
test('FR-080 AC-439: 周期による再配置の前後で、記録中の状態・選択・開いているポップアップと内容・入力中の文字列・詳細度・レイアウト型・表示のモード・拡大率と表示位置が保たれ、直後の発話も受け付ける', async () => {
  const { app, env, scheduler } = await seededDetail();
  const s1 = app.getState().scenes[0].id;
  app.selectScene(s1);
  assert.ok(app.getScenePopup()?.open, 'ポップアップが開いている');
  app.setDraft('入力中の文字列');
  assert.ok(app.setDiagramView({ zoom: 1.5, scrollX: 40, scrollY: 30 }).ok);
  scheduler.advanceTo(PERIOD + 1000); say(env, T.problem);
  scheduler.advanceTo(PERIOD + 1000 + P.UPPER_SEC * 1000);
  const k0 = keep(app); const c0 = count(app);
  scheduler.advanceTo(2 * PERIOD);
  assert.equal(count(app), c0 + 1, '再配置が行われた');
  assert.deepEqual(keep(app), k0);
  assert.equal(app.getState().session, 'recording');
  assert.equal(app.submitDraft().ok, true, '再配置の直後の発話も受け付ける');
  say(env, '再配置の直後の確定結果');
  assert.deepEqual(app.getState().utterances.map((u) => u.text), [...k0.utterances, '入力中の文字列', '再配置の直後の確定結果']);
});

// FR-080 AC-439
test('FR-080 AC-439: 周期 0（会話の区切り）による再配置でも、大項目でのシーンの選択（AC-138）・トピックのポップアップ・詳細度・表示が保たれる', async () => {
  const { app, env, scheduler } = await arrangeApp();
  assert.equal(app.setArrangeInterval(0).ok, true);
  toDetail(app);
  app.commands['session.start']();
  scheduler.advanceTo(500); say(env, T.plain1);
  app.commands['session.nextScene']();
  scheduler.advanceTo(1000); say(env, T.plain2);
  scheduler.advanceTo(1000 + P.SILENCE_SEC * 1000 + 1);
  assert.ok(count(app) >= 1, '無音 3 秒の区切りで再配置される');
  const [sA, sB] = app.getState().scenes;
  app.selectScene(sA.id);
  assert.equal(app.setDetailLevel('major').ok, true);
  const topicOfB = app.getTopics().find((t) => t.sceneIds.includes(sB.id));
  scheduler.advanceTo(5000); say(env, T.problem); // 2 シーン目（選択していないトピック）に加わる
  scheduler.advanceTo(5500);
  const k0 = keep(app); const c0 = count(app);
  assert.equal(k0.selectedSceneId, sA.id, '大項目でもシーンの選択は保たれる');
  assert.equal(app.getState().scenes.length, 2);
  assert.ok(topicOfB);
  scheduler.advanceTo(5000 + P.SILENCE_SEC * 1000 + 1);
  assert.equal(count(app), c0 + 1, '無音 3 秒の区切りで再配置された');
  assert.deepEqual(keep(app), k0);
  app.setDetailLevel('detail');
  assert.equal(app.getState().selectedSceneId, sA.id);
});

// FR-080 AC-439
test('FR-080 AC-439: 動きを減らす設定（prefers-reduced-motion）が有効なとき、周期・会話の区切りのどちらの再配置もアニメーションなしで行われる', async () => {
  const { app, env, scheduler } = await arrangeApp({ reducedMotion: true });
  toDetail(app);
  app.commands['session.start']();
  scheduler.advanceTo(500); say(env, T.plain1);
  scheduler.advanceTo(PERIOD);
  assert.equal(count(app), 1);
  assert.deepEqual(app.getArrangeStatus().lastTransition, { animated: false, durationMs: 0 });
  assert.equal(app.setArrangeInterval(0).ok, true);
  scheduler.advanceTo(PERIOD + 500); say(env, T.problem);
  scheduler.advanceTo(PERIOD + 500 + P.SILENCE_SEC * 1000 + 1);
  assert.equal(count(app), 2);
  assert.deepEqual(app.getArrangeStatus().lastTransition, { animated: false, durationMs: 0 });
});
