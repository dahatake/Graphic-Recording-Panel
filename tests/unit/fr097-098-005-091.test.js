// FR-097 種類別スタイル・FR-098 議題タイマー・FR-005 手修正の履歴と元に戻す・FR-091 進行の段階 の単体・結合テスト。
// （System Test: tests/system/agenda-timer.test.js は AC-569。ここは AC-564〜568・570・571・574〜577）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from '../system/helpers.js';
import { classifyTopics } from '../../web/src/topics.js';
import { classifyKind, hasDecisionMark, PHASES } from '../../web/src/pointkind.js';
import { RECOMMENDED, HANDWRITTEN_STYLE_IDS, KIND_IDS, presetify } from '../../web/src/kindstyles.js';
import { buildLook } from '../../web/src/presetdiagram.js';
import { contrastRatio } from '../../web/src/stylepresets.js';
import { formatClock } from '../../web/src/agendatimer.js';

const AG = [{ name: '現状の共有', minutes: 2 }, { name: '案の比較' }];

// ---------------------------------------------------------------- FR-098
// FR-098 AC-568
test('FR-098 AC-568: 持ち時間は 1 以上の整数。省略は 10 分。0 件は開始できず理由が出る。minutes は再読込で復元される', async () => {
  const { app, env, createApp } = await newApp();
  await seedThreeScenes(app, env);
  const none = app.commands['timer.start']();
  assert.deepEqual([none.ok, none.reason], [false, 'no_agenda']);
  assert.match(app.getState().message.text, /議題が 0 件/, '理由が画面のメッセージにも出る');
  for (const bad of [0, -3, 1.5, '5']) assert.equal(app.setMeetingContext({ agenda: [{ name: 'A', minutes: bad }] }).ok, false, `minutes=${bad}`);
  assert.deepEqual(app.getMeetingContext().agenda, [], '失敗した設定は全体が不変');
  assert.equal(app.setMeetingContext({ agenda: [{ name: ' ' }] }).ok, false, '名前が空');
  assert.equal(app.setMeetingContext({ agenda: [{ name: '現状の共有', minutes: 3 }, { name: '案の比較' }] }).ok, true);
  assert.deepEqual(app.getMeetingContext().agenda.map((a) => [a.name, a.minutes]), [['現状の共有', 3], ['案の比較', null]]);
  const id0 = app.getMeetingContext().agenda[0].id;
  assert.equal(app.commands['timer.start']().ok, true);
  assert.equal(app.getAgendaTimer().remainingText, '03:00');
  assert.equal(app.commands['timer.next']().ok, true);
  assert.equal(app.getAgendaTimer().remainingText, '10:00', '省略した議題は 10 分（PARAM-124）');
  const r = app.commands['timer.next']();
  assert.deepEqual([r.ok, r.reason], [false, 'last'], '最後の議題では次へ進めない');
  const app2 = await createApp(env.options);
  assert.deepEqual(app2.getMeetingContext().agenda.map((a) => [a.id, a.name, a.minutes]), [[id0, '現状の共有', 3], [app2.getMeetingContext().agenda[1].id, '案の比較', null]], '再読込で持ち時間が復元され、id は変わらない');
  assert.equal(app2.getAgendaTimer().state, 'idle');
});

test('FR-098: mm:ss の整形（0 以下は 00:00、分は 2 桁以上）', () => {
  assert.equal(formatClock(300), '05:00');
  assert.equal(formatClock(59.2), '00:59');
  assert.equal(formatClock(-4), '00:00');
  assert.equal(formatClock(6000), '100:00');
});

// FR-098 AC-570
test('FR-098 AC-570: 残り 60 秒以下で「まもなく終了」、0 で「時間切れ」と超過時間。自動では次へ進まない。音はミュートで鳴らさず、reduced motion では点滅しない', async () => {
  const sounds = [];
  const { app, env } = await newApp({ options: { timerSound: (k) => sounds.push(k) } });
  await seedThreeScenes(app, env);
  app.setMeetingContext({ agenda: AG });
  app.commands['timer.start']();
  assert.equal(app.getAgendaTimer().warning, false);
  assert.ok(!app.renderAgendaTimer().includes('まもなく終了'));
  env.tick(61); env.scheduler.advance(1000); // 残り 59 秒
  let t = app.getAgendaTimer();
  assert.deepEqual([t.warning, t.expired, t.remainingText], [true, false, '00:59']);
  const html = app.renderAgendaTimer();
  assert.match(html, /まもなく終了/);
  assert.match(html, /data-shape="frame"/, '枠つきの記号（色だけにしない）');
  assert.deepEqual(sounds, ['warning']);
  env.tick(60); env.scheduler.advance(1000); // 残り -1 秒 = 時間切れ（超過 1 秒）
  t = app.getAgendaTimer();
  assert.deepEqual([t.expired, t.overtimeSec, t.remainingText, t.currentName, t.state], [true, 1, '00:00', '現状の共有', 'running'], '自動では次の議題に進まない');
  const html2 = app.renderAgendaTimer();
  assert.match(html2, /時間切れ/);
  assert.match(html2, /超過 00:01/);
  assert.match(html2, /data-motion="blink"/);
  assert.deepEqual(sounds, ['warning', 'expired']);
  assert.equal(app.getAgendaTimer().currentName, '現状の共有');
});

test('FR-098 AC-570: ミュートでは通知音を鳴らさず、reduced motion では点滅せず文字だけで示す', async () => {
  const sounds = [];
  const { app, env } = await newApp({ options: { mute: true, timerSound: (k) => sounds.push(k), env: { webgl: true, reducedMotion: true, viewportWidth: 1280 } } });
  await seedThreeScenes(app, env);
  app.setMeetingContext({ agenda: AG });
  app.commands['timer.start']();
  assert.equal(app.getAgendaTimer().silent, true);
  env.tick(121); env.scheduler.advance(1000);
  assert.equal(app.getAgendaTimer().expired, true);
  assert.deepEqual(sounds, [], 'ミュートでは音の呼び出し 0 件');
  const html = app.renderAgendaTimer();
  assert.match(html, /時間切れ/);
  assert.match(html, /data-motion="none"/, 'reduced motion では点滅しない');
  assert.ok(!html.includes('data-motion="blink"'));
});

// FR-098 AC-571
test('FR-098 AC-571: 切替で進行中のシーンが確定し、次の発話から新しいシーン。議題名がシーンの見出しの近くに付き、発話列は変わらず、境は保存・復元される', async () => {
  const { app, env, createApp } = await newApp();
  await seedThreeScenes(app, env); // 3 シーン。最後は進行中
  app.setMeetingContext({ agenda: AG });
  const [a1, a2] = app.getMeetingContext().agenda;
  const utts = JSON.stringify(app.getState().utterances);
  const pointsBefore = app.getState().scenes.flatMap((s) => s.points.map((p) => p.text));
  app.commands['timer.start']();
  assert.equal(app.getState().scenes.at(-1).status, 'in_progress');
  assert.equal(app.commands['timer.next']().ok, true);
  const st = app.getState();
  assert.equal(st.scenes.at(-1).status, 'confirmed', '進行中のシーンが確定する');
  assert.equal(JSON.stringify(st.utterances), utts, '発話列（文字列と受付時刻）は変わらない');
  assert.equal(st.agendaBoundaries.length, 1);
  assert.deepEqual([st.agendaBoundaries[0].sceneId, st.agendaBoundaries[0].agendaId, st.agendaBoundaries[0].at], [st.scenes.at(-1).id, a1.id, env.now()]);
  app.setDraft('次の議題での最初の発話です'); app.submitDraft();
  const after = app.getState();
  assert.equal(after.scenes.length, 4, '次の発話から新しいシーン');
  assert.deepEqual(after.scenes.flatMap((s) => s.points.map((p) => p.text)).slice(0, pointsBefore.length), pointsBefore, '切替の前の要点は省かれない');
  assert.equal(app.getSceneAgenda(after.scenes[2].id), '現状の共有');
  assert.equal(app.getSceneAgenda(after.scenes[3].id), '案の比較');
  const html = app.renderOutline();
  assert.match(html, /data-agenda-of="[^"]+">議題: 案の比較</, 'テキスト一覧にも議題の名前が付く');
  // 保存・復元
  assert.equal((await app.commands['file.save']()).ok, true);
  const dl = env.downloads.at(-1);
  assert.deepEqual(JSON.parse(dl.data).extras.agendaBoundaries, st.agendaBoundaries);
  const app2 = await createApp(env.options);
  assert.deepEqual(app2.getState().agendaBoundaries, st.agendaBoundaries, '再読込で境が復元される');
  assert.deepEqual(app2.getMeetingContext().agenda.map((a) => a.id), [a1.id, a2.id]);
});

// FR-098 AC-571（トピック分類は議題をまたがない）
test('FR-098 AC-571: トピック分類は議題の境をまたがず、同じ発話列と同じ境からは同じ結果（AC-127）', () => {
  const sc = (id, text) => ({ id, heading: text, points: [{ id: `${id}p`, text }], relations: [], status: 'confirmed' });
  const scenes = [sc('s1', 'budget review plan'), sc('s2', 'budget review again'), sc('s3', 'budget review done')];
  assert.equal(classifyTopics(scenes).length, 1, '境がなければ共通の語で 1 つにまとまる');
  const a = classifyTopics(scenes, undefined, undefined, new Set(['s1']));
  assert.deepEqual(a.map((t) => t.sceneIds), [['s1'], ['s2', 's3']], '境の後ろでは区切る');
  const b = classifyTopics(JSON.parse(JSON.stringify(scenes)), undefined, undefined, new Set(['s1']));
  assert.deepEqual(b, a, '同じ入力から同じ結果');
});

test('FR-098 AC-571: 議題の切替の後のシーンは、語が共通でも別のトピックになる（アプリの結果）', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  app.setMeetingContext({ agenda: AG });
  app.commands['timer.start']();
  app.setDraft('予算の見直しが必要です'); app.submitDraft(); env.tick(1);
  app.commands['timer.next']();
  app.setDraft('予算の見直しを進めます'); app.submitDraft();
  const sc = app.getState().scenes;
  assert.equal(sc.length, 2);
  const topics = app.getTopics();
  assert.deepEqual(topics.map((t) => t.sceneIds), [[sc[0].id], [sc[1].id]]);
});

test('FR-098: 一時停止・再開・終了と、状態ごとのボタンの有効・無効（キーボードでも操作できる）', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  assert.equal(app.renderAgendaTimer(), '', '議題がなく待機のときは出さない');
  app.setMeetingContext({ agenda: AG });
  assert.match(app.renderAgendaTimer(), /data-command="timer.start"(?! disabled)/);
  assert.equal(app.commands['timer.pause']().ok, false);
  app.commands['timer.start']();
  assert.equal(app.commands['timer.start']().ok, false, '二重の開始はできない');
  assert.equal(app.commands['timer.resume']().ok, false);
  assert.match(app.renderAgendaTimer(), /data-command="timer.pause"(?! disabled)/);
  assert.match(app.renderAgendaTimer(), /data-command="timer.resume" disabled/);
  app.commands['timer.pause']();
  env.tick(50);
  assert.equal(app.getAgendaTimer().remainingText, '02:00', '一時停止中は減らない');
  assert.equal(app.commands['timer.stop']().ok, true);
  assert.equal(app.getAgendaTimer().state, 'finished');
  assert.equal(app.commands['timer.start']().ok, true, '終了の後は最初から開始できる');
  assert.equal(app.getAgendaTimer().currentName, '現状の共有');
});

// ---------------------------------------------------------------- FR-005
const edit = async () => {
  const ctx = await newApp();
  await seedThreeScenes(ctx.app, ctx.env);
  toDetail(ctx.app);
  return ctx;
};
const textsOf = (app) => app.getState().scenes.map((s) => s.points.map((p) => p.text));

// FR-005 AC-574
test('FR-005 AC-574: 手修正のたびに、修正前の値・修正後の値・日時が履歴に残り、新しい順に一覧で見られる', async () => {
  const { app, env } = await edit();
  const [s1, s2] = app.getState().scenes;
  const pid = s1.points[0].id;
  assert.deepEqual(app.getEditHistory(), []);
  app.editPoint(pid, '予算を見直す');
  app.addPoint(s2.id, '追加した要点');
  app.deletePoint(s2.points[0].id);
  app.mergeScenes(s1.id);
  const h = app.getEditHistory();
  assert.deepEqual(h.map((x) => x.kind), ['merge', 'delete', 'add', 'edit'], '新しい順');
  assert.deepEqual([h[3].before, h[3].after], ['予算の見直しが必要です', '予算を見直す']);
  assert.deepEqual([h[2].before, h[2].after], [null, '追加した要点']);
  assert.deepEqual([h[1].before, h[1].after], ['来月のリリース計画を決める', null]);
  for (const x of h) assert.match(x.at, /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.match(app.renderOutline(), /手修正の履歴/);
  assert.match(app.renderOutline(), /修正前: 予算の見直しが必要です → 修正後: 予算を見直す/, 'テキスト一覧にも出る');
  // 分割
  const sc = app.getState().scenes[0];
  assert.equal(app.splitScene(sc.id, sc.points[1].id).ok, true);
  assert.equal(app.getEditHistory()[0].kind, 'split');
  // 失敗した操作は履歴に残らない
  const n = app.getEditHistory().length;
  assert.equal(app.editPoint('nope', 'x').ok, false);
  assert.equal(app.getEditHistory().length, n);
  void env;
});

test('FR-005 AC-574: 履歴は直近 50 件を保ち、保存・復元され、データの初期化で消える', async () => {
  const { app, env, createApp } = await edit();
  const pid = app.getState().scenes[0].points[0].id;
  for (let i = 0; i < 55; i++) app.editPoint(pid, `修正 ${i}`);
  const h = app.getEditHistory();
  assert.equal(h.length, 50, '超えた分は古いものから消える');
  assert.equal(h[0].after, '修正 54');
  assert.equal(h.at(-1).after, '修正 5');
  assert.equal((await app.commands['file.save']()).ok, true);
  const dl = env.downloads.at(-1);
  const app2 = await createApp(env.options);
  assert.deepEqual(app2.getEditHistory(), h, '再読込で復元される');
  assert.equal(app.commands['data.reset']().ok, true);
  assert.equal((await app.dialogAction('confirm')).ok, true);
  assert.deepEqual(app.getEditHistory(), [], '初期化で消える');
  const l = await app.loadSessionFile({ name: dl.filename, type: dl.mime, size: String(dl.data).length, text: String(dl.data) });
  assert.equal(l.ok, true);
  assert.deepEqual(app.getEditHistory(), h, 'ファイルから復元される');
});

// FR-005 AC-575
test('FR-005 AC-575: 直前の手修正を元に戻せる。繰り返すと新しい順に戻り、戻した操作は「元に戻した」として残る', async () => {
  const { app } = await edit();
  const before = JSON.stringify(app.getState().scenes);
  const pid = app.getState().scenes[0].points[0].id;
  app.editPoint(pid, '一回目の修正'); const mid = JSON.stringify(app.getState().scenes);
  app.editPoint(pid, '二回目の修正');
  assert.equal(app.undoManualEdit().ok, true);
  assert.equal(JSON.stringify(app.getState().scenes), mid, '直前の手修正だけが戻る');
  const h = app.getEditHistory();
  assert.deepEqual([h[0].kind, h[0].label], ['undo', '元に戻した']);
  assert.equal(app.undoManualEdit().ok, true);
  assert.equal(JSON.stringify(app.getState().scenes), before, '2 回目で最初の状態');
  const r = app.undoManualEdit();
  assert.deepEqual([r.ok, r.reason], [false, 'no_history'], '履歴がなければ無効で、理由が示される');
  assert.ok(app.getState().message.text.includes('元に戻せる手修正がありません'));
});

test('FR-005 AC-575: 削除・追加・結合・分割も元に戻せ、キーボードのコマンドからも戻せる', async () => {
  const { app, env } = await edit();
  const s0 = JSON.stringify(app.getState().scenes);
  const [a, b] = app.getState().scenes;
  app.deletePoint(a.points[0].id);
  assert.equal(app.commands['edit.undo']().ok, true);
  assert.equal(JSON.stringify(app.getState().scenes), s0, '削除を戻す');
  const add = app.addPoint(b.id, '新しい要点');
  assert.equal(add.ok, true);
  app.undoManualEdit();
  assert.equal(JSON.stringify(app.getState().scenes), s0, '追加を戻す');
  app.mergeScenes(a.id);
  assert.equal(app.getState().scenes.length, 2);
  app.undoManualEdit();
  assert.equal(JSON.stringify(app.getState().scenes), s0, '結合を戻す');
  app.splitScene(a.id, a.points[1].id);
  assert.equal(app.getState().scenes.length, 4);
  app.undoManualEdit();
  assert.equal(JSON.stringify(app.getState().scenes), s0, '分割を戻す');
  const key = app.keymap.find((k) => k.command === 'edit.undo');
  assert.ok(key, 'キー割り当てがある');
  app.editPoint(a.points[0].id, 'キーで戻す');
  assert.equal(app.handleKey({ key: key.key, ctrlKey: !!key.ctrl, altKey: !!key.alt, shiftKey: !!key.shift }), 'edit.undo');
  assert.equal(app.getState().scenes[0].points[0].text, a.points[0].text);
  void env;
});

test('FR-005 AC-575: 結合を戻したとき、結合の後に加わった要点は省かれず、元に戻した結果は再配置で上書きされない', async () => {
  const { app, env } = await edit();
  const [a] = app.getState().scenes;
  app.mergeScenes(a.id); // 2 つ目のシーンと結合（以後 a が進行中でない）
  const cur = app.getState().scenes.at(-1);
  app.addPoint(cur.id, '後から加わった要点');
  app.undoManualEdit(); // 追加を戻す
  app.undoManualEdit(); // 結合を戻す
  assert.equal(app.getState().scenes.length, 3);
  app.setDraft('結合を戻した後の発話'); app.submitDraft();
  app.requestRearrange?.();
  const texts = textsOf(app).flat();
  assert.ok(texts.includes('結合を戻した後の発話'));
  assert.ok(app.getState().scenes[0].points.some((p) => p.text === a.points[0].text));
  void env;
});

test('FR-005 AC-575: 手修正で変わった点の追加の値（確認状態など）も、修正の直前の値に戻る', async () => {
  const { app } = await edit();
  const [a] = app.getState().scenes;
  // 要点が持つ追加の値（確認状態・確認日など）は、要点ごと写しを取るので、そのまま戻る
  app.getState(); // 状態は写し
  const pid = a.points[0].id;
  app.editPoint(pid, '直前の値');
  const scene = app.getState().scenes[0];
  assert.equal(scene.points[0].text, '直前の値');
  app.undoManualEdit();
  assert.deepEqual(app.getState().scenes[0].points[0], a.points[0], '要点の全項目が直前の値と同じ');
});

// ---------------------------------------------------------------- FR-091
// FR-091 AC-577
test('FR-091 AC-577: 種類の語に当てはまらない要点の種類は段階で決まり、語に当てはまる要点は段階によらない', () => {
  assert.deepEqual(PHASES, ['diverge', 'classify', 'evaluate', 'decide']);
  const plain = 'この点について話しました';
  assert.deepEqual(PHASES.map((phase) => classifyKind(plain, { phase })), ['idea', 'note', 'issue', 'note']);
  assert.equal(classifyKind(plain), 'note');
  for (const phase of PHASES) {
    assert.equal(classifyKind('コストが高くて困った', { phase }), 'issue');
    assert.equal(classifyKind('方針を決定しました', { phase }), 'conclusion');
    assert.equal(classifyKind('まだ決まっていません', { phase }), 'undecided');
  }
  assert.deepEqual(PHASES.map((phase) => hasDecisionMark(plain, { phase })), [false, false, false, true]);
  assert.equal(hasDecisionMark('方針を決定しました', { phase: 'decide' }), false, '語に当てはまる要点は印なし');
  assert.notEqual(classifyKind(plain, { phase: 'decide' }), 'conclusion', '決定の段階でも結論にしない');
});

const workshop = async () => {
  const ctx = await newApp();
  assert.equal(ctx.app.setLayoutTypes(['workshop']).ok, true);
  ctx.app.commands['session.start']();
  return ctx;
};
const say = (app, env, text) => { app.setDraft(text); app.submitDraft(); env.tick(1); };

test('FR-091 AC-576: 段階の切替は workshop 型のときだけ。初期は発散で、現在の段階が文字でテキスト一覧にも出る', async () => {
  const { app } = await newApp();
  const r = app.setFacilitationPhase('classify');
  assert.deepEqual([r.ok, r.reason, app.getFacilitationPhase()], [false, 'not_workshop', 'diverge'], '他の型では無効で不変');
  assert.equal(app.setFacilitationPhase('bad').ok, false);
  app.setLayoutTypes(['workshop']);
  assert.equal(app.getFacilitationPhase(), 'diverge');
  app.commands['session.start']();
  say(app, { tick() {} }, 'テスト');
  assert.equal(app.setFacilitationPhase('classify').ok, true);
  assert.equal(app.getFacilitationPhase(), 'classify');
  assert.match(app.renderOutline(), /現在の段階: 分類/);
  for (const w of ['発散', '分類', '評価', '決定']) assert.ok(app.renderOutline().includes(w), `段階「${w}」`);
  app.setLayoutTypes(['zone']);
  assert.ok(!app.renderOutline().includes('進行の段階'), '他の型には出ない');
  assert.equal(app.setFacilitationPhase('decide').ok, false);
});

test('FR-091 AC-576: 発散の間は話順に並べるだけで昇格・強調を保留し、分類へ切り替えるとその時点から再配置の規則が適用され、要点は省かれない', async () => {
  const { app, env } = await workshop();
  toDetail(app);
  say(app, env, 'この点について話しました');
  say(app, env, '方針を決定しました');
  say(app, env, 'コストが高くて困った');
  const sid = app.getState().scenes[0].id;
  const ids = app.getState().scenes[0].points.map((p) => p.id);
  assert.equal(ids.length, 3);
  app.requestRearrange();
  assert.deepEqual(app.getArrangedPointOrder(sid), ids.map((i) => [i]), '発散: 話順のまま（結論を昇格しない）');
  const em = () => app.getDiagramStyle().scenes[0].points.map((p) => p.emphasized);
  assert.deepEqual(em(), [false, false, false], '発散: 強調しない');
  assert.equal(app.setFacilitationPhase('classify').ok, true);
  const order = app.getArrangedPointOrder(sid).flat();
  assert.equal(order[0], ids[1], '分類: 結論が先頭へ昇格する（AC-426）');
  assert.deepEqual([...order].sort(), [...ids].sort(), '発散の間に加わった要点も省かれない');
  assert.deepEqual(em(), [false, true, false], '分類: 結論の強調が戻る');
  assert.equal(app.setFacilitationPhase('diverge').ok, true);
  assert.deepEqual(app.getArrangedPointOrder(sid), ids.map((i) => [i]), '発散へ戻すと再び話順');
});

test('FR-091 AC-576: 発散の間は同じ文の要点をまとめず、分類以降でまとめる（AC-429）', async () => {
  const { app, env } = await workshop();
  toDetail(app);
  say(app, env, '予算を確認します'); say(app, env, '予算を確認します');
  const sid = app.getState().scenes[0].id;
  app.requestRearrange();
  assert.equal(app.getArrangedPointOrder(sid).length, 2, '発散: まとめない');
  app.setFacilitationPhase('classify');
  assert.equal(app.getArrangedPointOrder(sid).length, 1, '分類: 同一の要点をまとめる');
});

test('FR-091 AC-577: 追加した時点の段階で種類が決まり、すでにある要点は変わらない。決定の段階は印だけで結論にしない。保存・復元される', async () => {
  const { app, env, createApp } = await workshop();
  toDetail(app);
  const kindsOf = () => app.getDiagramStyle().scenes.flatMap((s) => s.points.map((p) => p.kind));
  say(app, env, '一つ目の話です'); // 発散 = アイデア
  app.setFacilitationPhase('classify'); say(app, env, '二つ目の話です'); // 補足
  app.setFacilitationPhase('evaluate'); say(app, env, '三つ目の話です'); // 課題
  app.setFacilitationPhase('decide'); say(app, env, '四つ目の話です'); // 補足（決定の段階）
  say(app, env, '方針を決定しました'); // 語に当てはまる = 結論（印なし）
  assert.deepEqual(kindsOf(), ['idea', 'note', 'issue', 'note', 'conclusion']);
  const pts = app.getState().scenes[0].points;
  assert.deepEqual(pts.map((p) => !!p.decided), [false, false, false, true, false]);
  assert.ok(app.renderOutline().includes('決定の段階'), '印（文字「決定の段階」）が一覧に出る');
  assert.equal((app.renderOutline().match(/決定の段階/g) ?? []).length, 1, '印は決定の段階で追加した、語に当てはまらない要点だけ');
  app.setFacilitationPhase('diverge');
  assert.deepEqual(kindsOf(), ['idea', 'note', 'issue', 'note', 'conclusion'], '段階を戻しても、すでにある要点は変わらない');
  // 保存・復元
  app.setFacilitationPhase('evaluate');
  const app2 = await createApp(env.options);
  assert.equal(app2.getFacilitationPhase(), 'evaluate');
  assert.deepEqual(app2.getState().scenes[0].points.map((p) => [p.kind ?? null, !!p.decided]), pts.map((p) => [p.kind ?? null, !!p.decided]));
  // どの要点もちょうど 1 つの種類
  for (const k of kindsOf()) assert.ok(KIND_IDS.includes(k));
});

test('FR-091: 他の型では進行の段階を使わず、従来どおりの種類で分類する', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  say(app, env, 'この点について話しました');
  assert.equal(app.getState().scenes[0].points[0].kind, undefined);
  assert.equal(app.getDiagramStyle().scenes[0].points[0].kind, 'note');
});

// ---------------------------------------------------------------- FR-097
const kindApp = async () => {
  const ctx = await newApp();
  toDetail(ctx.app);
  ctx.app.commands['session.start']();
  say(ctx.app, ctx.env, '方針を決定しました');
  say(ctx.app, ctx.env, 'コストが高くて困った');
  say(ctx.app, ctx.env, 'ただの補足です');
  say(ctx.app, ctx.env, '別の方針も決定しました');
  return ctx;
};
const frames = (svg) => [...svg.matchAll(/<g data-point-id="([^"]+)" data-kind="(\w+)"([^>]*)>/g)].map((m) => ({ id: m[1], kind: m[2], attrs: m[3] }));

// FR-097 AC-564
test('FR-097 AC-564: 既定は無効。有効にして種類ごとに手書き系スタイルを割り当てると、同じ図で併用され、同じ種類は同じスタイル。手書き系以外は割り当てられない', async () => {
  const { app } = await kindApp();
  assert.deepEqual(app.getPointKindStyles().enabled, false, '既定は無効');
  assert.deepEqual(Object.keys(app.getPointKindStyles().assign).sort(), [...KIND_IDS].sort());
  for (const id of HANDWRITTEN_STYLE_IDS) assert.ok(app.getDrawStyles().some((s) => s.id === id), `${id} は描画スタイルの登録簿にある`);
  const off = app.renderSvg();
  assert.ok(!off.includes('data-point-style'), '無効のときは従来と同じ');
  assert.equal(app.setPointKindStyles({ enabled: true, assign: { conclusion: 'yellowBlack', issue: 'stickyNotes', note: 'colorPencil' } }).ok, true);
  const svg = app.renderSvg();
  const f = frames(svg);
  const styleOf = (a) => /data-point-style="([^"]*)"/.exec(a)?.[1];
  assert.deepEqual(f.map((x) => [x.kind, styleOf(x.attrs)]), [['conclusion', 'yellowBlack'], ['issue', 'stickyNotes'], ['note', 'colorPencil'], ['conclusion', 'yellowBlack']], '同じ種類は図のどこでも同じスタイル');
  // スタイルごとの線・塗りが異なる（黄黒手書き風の太い線・付箋の面・色鉛筆の細い線）
  const frameOf = (id) => new RegExp(`<g data-point-id="${id}"[\\s\\S]*?data-style-role="point-frame"[^>]*stroke-width="([\\d.]+)"`).exec(svg)?.[1];
  const widths = f.map((x) => Number(frameOf(x.id)));
  assert.ok(widths[0] > widths[2], `黄黒手書き風（${widths[0]}）は色鉛筆風（${widths[2]}）より太い線`);
  assert.match(svg.slice(svg.indexOf(f[1].id)), /data-style-role="sticky"/, '付箋ボード風は付箋の面で描く');
  assert.match(svg, /font-family="[^"]*"[^>]*data-point-id|data-point-id[^>]*font-family="/, '要点ごとに書体を持つ');
  // 手書き系以外は割り当てられず、不変
  const before = JSON.stringify(app.getPointKindStyles());
  for (const bad of ['anime', 'simple', 'rpg', 'mintNote', 'business', 'nope', 7]) {
    const r = app.setPointKindStyles({ assign: { idea: bad } });
    assert.equal(r.ok, false, `${bad}`);
  }
  assert.equal(app.setPointKindStyles({ assign: { unknown: 'handwritten' } }).ok, false);
  assert.equal(app.setPointKindStyles({ enabled: 'yes' }).ok, false);
  assert.equal(JSON.stringify(app.getPointKindStyles()), before, '失敗した設定は不変');
  // 無効に戻すと、選択中の 1 つのスタイルだけ（従来と同一）
  app.setPointKindStyles({ enabled: false });
  assert.equal(app.renderSvg(), off, '無効に戻すと従来と同一');
});

// FR-097 AC-565
test('FR-097 AC-565: 推奨セットを適用すると割り当てが決まった組み合わせになり、どの要点の文字も 4.5:1 以上', async () => {
  const { app } = await kindApp();
  assert.equal(app.applyRecommendedPointKindStyles().ok, true);
  assert.deepEqual(app.getPointKindStyles().assign, {
    conclusion: 'yellowBlack', issue: 'stickyNotes', proposal: 'kraftPaper', idea: 'kraftPaper', undecided: 'colorPencil', note: 'handwritten',
  });
  assert.deepEqual(app.getPointKindStyles().assign, RECOMMENDED);
  for (const [kind, id] of Object.entries(RECOMMENDED)) {
    const look = buildLook(presetify(app.getDrawStyleSpec(id)));
    const pairs = [[look.textOn(look.frameFill), look.frameFill], [look.emphText, look.emph], [look.textOn(look.balloonFill === 'none' ? look.bg : look.balloonFill), look.balloonFill === 'none' ? look.bg : look.balloonFill]];
    for (const f of look.stickyFills ?? []) pairs.push([look.textOn(f), f]);
    for (const [fg, bg] of pairs) assert.ok(contrastRatio(fg, bg) >= 4.5, `${kind}/${id}: ${fg} on ${bg} = ${contrastRatio(fg, bg).toFixed(2)}`);
  }
});

// FR-097 AC-566
test('FR-097 AC-566: 種類別スタイルを有効にしても、要点の位置・大きさ・文字の大きさの階層は同じで、種類はラベル・形・絵記号でも見分けられる', async () => {
  const { app } = await kindApp();
  assert.equal(app.setDrawStyle('yellowBlack').ok, true);
  const strip = (svg) => [...svg.matchAll(/data-style-role="(?:point-frame|heading-band|heading-marker|heading-sticky)"\s+data-box="([^"]+)"/g)].map((m) => m[1]).join('|');
  const sizes = (svg) => [...svg.matchAll(/font-size="(\d+)"/g)].map((m) => m[1]).join(',');
  const base = app.renderSvg();
  app.applyRecommendedPointKindStyles(); app.setPointKindStyles({ enabled: true });
  const on = app.renderSvg();
  assert.notEqual(on, base, '見た目は変わる');
  assert.equal(strip(on), strip(base), '近接・整列・重ならない配置（AC-430）は同じ');
  assert.equal(sizes(on), sizes(base), '文字の大きさの階層（AC-431）は同じ');
  assert.deepEqual(app.getDiagramStyle().scenes[0].points.map((p) => p.fontSize), [14, 14, 14, 14]);
  // 種類は色だけに頼らない: ラベル・形・絵記号
  const style = app.getDiagramStyle().scenes[0].points;
  assert.ok(style.every((p) => p.kindLabel && p.shape && p.icon));
  assert.match(on, /data-role="kind-label"/);
  assert.match(on, /data-style-role="icon"/);
  // 再配置の後も同じ
  app.requestRearrange();
  assert.equal(strip(app.renderSvg()), strip(on));
});

// FR-097 AC-567
test('FR-097 AC-567: 有効・無効と割り当ては保存・復元され、PNG・SVG・PDF に反映され、テキスト一覧は変わらず、外部へのリクエストはない', async () => {
  const { app, env, createApp } = await kindApp();
  const outlineOff = app.renderOutline();
  const pdfOff = await (async () => { await app.commands['save.pdf'](); return Buffer.from(env.downloads.at(-1).data).toString('latin1'); })();
  const pngOff = env.canvasFactory.log.created.length;
  app.applyRecommendedPointKindStyles(); app.setPointKindStyles({ enabled: true });
  assert.equal(app.renderOutline().replace(/<span class="badge badge-kind">/g, '<span class="badge badge-kind">'), outlineOff.replace(/\s+$/, '') && app.renderOutline(), 'テキスト一覧の取得は成功');
  assert.equal(app.renderOutline(), outlineOff, 'テキスト一覧の内容は変わらない');
  assert.ok((await app.commands['save.svg']()).ok);
  const svg = env.downloads.at(-1).data;
  assert.match(svg, /data-point-style="yellowBlack"/, 'SVG に反映');
  assert.ok(!/(https?:)?\/\/(?!www\.w3\.org)[a-z0-9-]+\.[a-z]{2,}/i.test(svg), '外部のリクエスト（URL）なし');
  assert.ok((await app.commands['save.pdf']()).ok);
  const pdfOn = Buffer.from(env.downloads.at(-1).data).toString('latin1');
  assert.notEqual(pdfOn, pdfOff, 'PDF に反映');
  assert.ok((await app.commands['save.png']()).ok);
  assert.ok(env.canvasFactory.log.created.length > pngOff, 'PNG を描いた');
  // 保存・復元
  const want = app.getPointKindStyles();
  const app2 = await createApp(env.options);
  assert.deepEqual(app2.getPointKindStyles(), want, '再読込で復元される');
  assert.equal((await app.commands['file.save']()).ok, true);
  const dl = env.downloads.at(-1);
  assert.equal(app.commands['data.reset']().ok, true);
  assert.equal((await app.dialogAction('confirm')).ok, true);
  assert.deepEqual(app.getPointKindStyles().enabled, false, '初期化で既定（無効）に戻る');
  const l = await app.loadSessionFile({ name: dl.filename, type: dl.mime, size: String(dl.data).length, text: String(dl.data) });
  assert.equal(l.ok, true);
  assert.deepEqual(app.getPointKindStyles(), want, 'ファイルから復元される');
  app.setPointKindStyles({ enabled: false });
  assert.ok(!app.renderSvg().includes('data-point-style'), '無効に戻すと 1 つのスタイルで描く');
});

test('FR-097: RPG風・整理の表示では種類別スタイルを使わず従来どおり描く', async () => {
  const { app } = await kindApp();
  app.setPointKindStyles({ enabled: true });
  app.setDrawStyle('rpg');
  assert.ok(!app.renderSvg().includes('data-point-style'));
  app.setDrawStyle('handwritten');
  assert.ok(app.renderSvg().includes('data-point-style'));
  assert.ok(app.getKindStyleSpecs(), '有効なときは種類ごとの定義がある');
  app.setPointKindStyles({ enabled: false });
  assert.equal(app.getKindStyleSpecs(), null);
});
