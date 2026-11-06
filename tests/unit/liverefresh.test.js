// FR-014 AC-521・AC-522・AC-053、FR-022 AC-523 の単体・結合テスト
// （ライブの更新間隔での描き足し・設定画面とコマンドの検索での変更・端末ごとの保存。ファイル取込は図を更新しない。依頼 2026-11-06 で .vtt の再生取込 AC-671 は廃止）。
// 時計はテスト用の時計（scheduler と now）で進める。期待値は受入基準と PARAM-098〜100・PARAM-183 から決める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { isValidLiveSec, parseLiveSec, LIVE_INTERVAL_KEY, LIVE_MIN_SEC, LIVE_MAX_SEC, LIVE_DEFAULT_SEC } from '../../web/src/liverefresh.js';
import { SESSION_KEY } from '../../web/src/persist.js';

const SEC = 1000;
// 時計（受付時刻）と scheduler（タイマー）を同じだけ進める
const adv = (env, ms) => { env.tick(ms / SEC); env.scheduler.advance(ms); };
const startRec = (app) => { app.commands['session.start'](); app.startSpeech(); };
const say = (env, text) => env.speech.emit(text, true);
const svgHas = (app, text) => app.renderSvg().includes(text);
const pointTexts = (app) => app.getState().scenes.flatMap((s) => s.points.map((p) => p.text)).join('|');
async function live(over) {
  const r = await newApp(over);
  r.app.setDetailLevel('detail'); // FR-026: 要点を図で確かめる
  return r;
}

// ---- PARAM-098〜100 ----
// FR-014 AC-522
test('FR-014 AC-522: 更新間隔は 5〜60 の整数（PARAM-098・099）、初期値 10（PARAM-100）。空・整数でない・範囲外は理由を区別する', () => {
  assert.deepEqual([LIVE_MIN_SEC, LIVE_MAX_SEC, LIVE_DEFAULT_SEC], [5, 60, 10]);
  for (const ok of [5, 6, 10, 59, 60]) assert.equal(isValidLiveSec(ok), true, String(ok));
  for (const bad of [4, 61, 0, -10, 12.5, '12', NaN, null]) assert.equal(isValidLiveSec(bad), false, String(bad));
  assert.deepEqual(parseLiveSec(' 25 '), { ok: true, sec: 25 });
  assert.deepEqual(parseLiveSec(5), { ok: true, sec: 5 });
  for (const v of ['', '  ', null, undefined]) assert.equal(parseLiveSec(v).reason, 'empty', String(v));
  for (const v of [12.5, '12.5', 'abc', NaN, Infinity, true]) assert.equal(parseLiveSec(v).reason, 'integer', String(v));
  for (const v of [4, 61, '4', '61', -5]) assert.equal(parseLiveSec(v).reason, 'range', String(v));
});

// ---- 描き足し（AC-521） ----
// FR-014 AC-521: 更新間隔を T 秒にして T 秒の間に確定結果を複数件送ると、次の更新の時点でちょうど 1 回だけ、すべてを含めて描き足される
test('FR-014 AC-521: T 秒の間の複数の確定結果は、次の更新の時点でちょうど 1 回だけまとめて描き足され、それより前・後には加わらない', async () => {
  for (const T of [LIVE_MIN_SEC, 7, LIVE_DEFAULT_SEC, LIVE_MAX_SEC]) {
    const { app, env } = await live();
    assert.equal(app.setLiveInterval(T).ok, true);
    startRec(app);
    const ticks = [];
    app.on('live:tick', (e) => ticks.push(e));
    const c0 = app.getLiveRefresh().count;
    const p0 = pointTexts(app);
    say(env, `予算の見直しを話す${T}`);
    adv(env, 1000);
    say(env, `来月の計画を決める${T}`);
    adv(env, 1000);
    say(env, `担当者を割り当てる${T}`);
    assert.equal(app.getState().utterances.length, 3, '確定結果は発話としてすぐ記録される');
    assert.equal(app.getTranscript().finals.length, 3, '確定結果の一覧にもすぐ移る');
    adv(env, T * SEC - 2000 - 1);
    assert.equal(pointTexts(app), p0, `${T}: 更新の時点の前は新しい要素が図に加わらない`);
    assert.equal(app.getLiveRefresh().count, c0);
    assert.equal(app.getLiveRefresh().held, 3);
    adv(env, 1);
    assert.equal(app.getLiveRefresh().count, c0 + 1, `${T}: ちょうど 1 回`);
    assert.deepEqual(ticks.map((e) => e.count), [3], '1 回の描き足しの通知にすべての確定結果');
    for (const s of ['予算の見直しを話す', '来月の計画を決める', '担当者を割り当てる']) assert.ok(svgHas(app, `${s}${T}`), `${T}: ${s} を含む`);
    const p1 = pointTexts(app);
    adv(env, 3 * T * SEC);
    assert.equal(app.getLiveRefresh().count, c0 + 1, '新しい発話がなかった間隔では描画を更新しない');
    assert.equal(pointTexts(app), p1);
  }
});

// FR-014 AC-521
test('FR-014 AC-521: 更新の時点の直後に届いた確定結果は、その次の時点まで図に加わらない', async () => {
  const { app, env } = await live();
  startRec(app);
  adv(env, 10 * SEC); // 1 回目の時点（発話なし）
  say(env, '時点の直後の発話');
  adv(env, 10 * SEC - 1);
  assert.ok(!svgHas(app, '時点の直後の発話'));
  adv(env, 1);
  assert.ok(svgHas(app, '時点の直後の発話'));
  assert.equal(app.getLiveRefresh().count, 1);
});

// FR-014 AC-522: 変更した時点から新しい間隔で数え直される
test('FR-014 AC-522: 間隔を変えた時点から新しい間隔で数え直される', async () => {
  const { app, env } = await live();
  startRec(app);
  adv(env, 6 * SEC);
  say(env, '間隔を変える前の発話');
  assert.equal(app.setLiveInterval(20).ok, true); // 6 秒の時点で変更 → 26 秒の時点が次の更新
  adv(env, 20 * SEC - 1);
  assert.ok(!svgHas(app, '間隔を変える前の発話'), '旧い間隔（10 秒の時点）では描き足さない');
  adv(env, 1);
  assert.ok(svgHas(app, '間隔を変える前の発話'));
});

// FR-014 AC-054・AC-521: 手入力は間隔を待たない。先に届いていたライブの発話も順を保って一緒に描かれる
test('FR-014 AC-054 AC-521: 記録中の手入力は更新間隔を待たず、先に届いていたライブの発話も順を保って取り込まれる', async () => {
  const { app, env } = await live();
  startRec(app);
  say(env, '先に話した内容');
  adv(env, 1000);
  app.setDraft('後から手で入れた内容'); app.submitDraft();
  assert.ok(svgHas(app, '先に話した内容') && svgHas(app, '後から手で入れた内容'), '手入力の時点で図に反映');
  const texts = app.getState().utterances.map((u) => u.text);
  assert.deepEqual(texts, ['先に話した内容', '後から手で入れた内容']);
  const pts = pointTexts(app);
  assert.ok(pts.indexOf('先に話した内容') < pts.indexOf('後から手で入れた内容'), '図の中の順も受付の順');
  const c = app.getLiveRefresh().count;
  adv(env, 30 * SEC);
  assert.equal(app.getLiveRefresh().count, c, '取り込み済みなので次の時点では更新しない');
});

// FR-014 AC-521・FR-003: まとめて取り込んでも、シーンの分かれ方は受付時刻で決まり、すぐ取り込んだ場合と同じ
test('FR-014 AC-521: まとめて描き足しても、シーンの分かれ方・要点は即時に取り込んだ場合と同じ（受付時刻の無音間隔で判定）', async () => {
  const script = [[0, '会議室は三階にあります'], [2, '資料は共有フォルダです'], [30, '次回は木曜の午後です'], [33, '参加者は八名でした'], [70, '予算は百万円です']];
  const shape = (app) => app.getState().scenes.map((s) => s.points.map((p) => p.text));
  const a = await live(); startRec(a.app);
  let at = 0;
  for (const [sec, text] of script) { adv(a.env, (sec - at) * SEC); at = sec; say(a.env, text); }
  adv(a.env, 60 * SEC);
  const b = await live(); b.app.commands['session.start']();
  at = 0;
  for (const [sec, text] of script) { adv(b.env, (sec - at) * SEC); at = sec; b.app.setDraft(text); b.app.submitDraft(); }
  assert.deepEqual(shape(a.app), shape(b.app));
  assert.ok(shape(a.app).length >= 2, '無音間隔でシーンが分かれる');
});

// FR-014 AC-521: 一時停止・停止の時点では、それまでの確定結果を取り込む。一時停止中は記録も更新もしない
test('FR-014 AC-521: 一時停止の時点でそれまでの確定結果を描き足し、一時停止中の発話は記録されず更新も起きない', async () => {
  const { app, env } = await live();
  startRec(app);
  say(env, '止める前の発話');
  app.commands['session.pause']();
  assert.ok(svgHas(app, '止める前の発話'), '一時停止で失わない');
  const c = app.getLiveRefresh().count;
  say(env, '停止中の声');
  adv(env, 3 * LIVE_MAX_SEC * SEC);
  assert.equal(app.getLiveRefresh().count, c);
  assert.ok(!svgHas(app, '停止中の声'));
  assert.equal(app.getState().utterances.some((u) => u.text === '停止中の声'), false);
});

// FR-014 AC-521・FR-012: 更新の時点の前に閉じても、確定した発話は失われず、再読込の時点で図に取り込まれる
test('FR-014 AC-521 FR-012: 描き足しの前に再読込しても確定した発話は失われず、図に取り込まれる', async () => {
  const first = await live();
  startRec(first.app);
  say(first.env, '閉じる直前の発話');
  first.app.flushSave?.();
  const second = await live({ storage: first.env.storage });
  second.app.setDetailLevel('detail');
  assert.ok(second.app.getState().utterances.some((u) => u.text === '閉じる直前の発話'));
  assert.ok(svgHas(second.app, '閉じる直前の発話'));
  assert.equal(second.app.getLiveRefresh().held, 0);
});

// FR-014 AC-053（G-001）: 既定の 10 秒で、受付から描画の始まりまで PARAM-001 以内
test('FR-014 AC-053: 既定の更新間隔（10 秒）では、確定結果の受付から 10 秒以内に描画が始まる', async () => {
  const { app, env } = await live();
  startRec(app);
  for (const offset of [0, 3, 9.999]) {
    const { app: a, env: e } = await live(); startRec(a);
    adv(e, offset * SEC);
    say(e, '受付の時刻を変えた発話');
    let waited = 0;
    while (!svgHas(a, '受付の時刻を変えた発話') && waited < 60 * SEC) { adv(e, 100); waited += 100; }
    assert.ok(waited <= LIVE_DEFAULT_SEC * SEC, `受付から ${waited} ms`);
  }
  assert.ok(app && env);
});

// ---- 設定（AC-522） ----
// FR-014 AC-522: ［設定］画面の項目から変更・保存・現在値の表示。範囲外・整数でない・空は理由を示して直前の値を保つ
test('FR-014 AC-522: 設定画面の項目で変更でき、現在値が表示され、保存される。不正な値は理由を示して直前の値を保つ', async () => {
  const { app, env } = await newApp();
  app.commands['settings.open']();
  const f = () => app.getSettingsDialog().fields.find((x) => x.id === 'live.interval');
  assert.equal(f().value, 10);
  assert.match(f().text, /10/);
  assert.equal(f().min, 5); assert.equal(f().max, 60);
  assert.equal(app.setLiveInterval('13').ok, true);
  assert.equal(f().value, 13);
  assert.deepEqual(JSON.parse(env.storage.getItem(LIVE_INTERVAL_KEY)), { intervalSec: 13 });
  for (const [bad, reason] of [[4, 'range'], [61, 'range'], ['12.5', 'integer'], ['abc', 'integer'], ['', 'empty']]) {
    const r = app.setLiveInterval(bad);
    assert.equal(r.ok, false, String(bad)); assert.equal(r.reason, reason, String(bad));
    assert.equal(f().value, 13, '直前の値が保たれる');
    assert.equal(app.getState().message.key, `live.interval.invalid.${reason}`);
    assert.ok(app.getState().message.text.length > 0, '理由が表示される');
  }
});

// FR-014 AC-522: ラベルは PARAM-011（ja 全角 6・en 半角 12）以内で表示言語に従う
test('FR-014 AC-522: 項目のラベルは表示言語に従い PARAM-011 文字以内', async () => {
  const { app } = await newApp();
  app.commands['settings.open']();
  const label = () => app.getSettingsDialog().fields.find((x) => x.id === 'live.interval').label;
  assert.ok(label().length <= 6, label());
  app.setLang('en');
  assert.ok(label().length <= 12, label());
  assert.match(label(), /Live/);
});

// FR-014 AC-522: コマンドの検索から PARAM-164（3 回）以内・キーボードだけで変更できる
test('FR-014 AC-522: コマンドの検索から 3 回以内（検索・選択・確定）にキーボードだけで変更できる', async () => {
  const { app } = await newApp();
  for (const q of ['ライブ更新', '更新の間隔']) {
    const hits = app.searchCommands(q).map((x) => x.command);
    const idx = hits.indexOf('settings.liveInterval');
    assert.ok(idx >= 0, `${q} で見つかる`);
    assert.ok(1 + idx + 1 + 1 <= 3, `${q}: 操作回数 ${1 + idx + 2}`);
  }
  app.commands['settings.liveInterval']();
  const d = app.getSettingsDialog();
  assert.ok(d && d.open);
  assert.equal(d.focusedField, 'live.interval', '選択だけで項目にフォーカスが移る');
  app.setSettingsFieldDraft('live.interval', '25');
  assert.equal(app.handleKey({ key: 'Enter' }), 'settings.live.commit');
  assert.equal(app.getLiveInterval().sec, 25);
  assert.equal(app.handleKey({ key: 'ArrowUp' }), 'settings.live.step');
  assert.equal(app.getLiveInterval().sec, 26);
  app.handleKey({ key: 'ArrowDown' }); app.handleKey({ key: 'ArrowDown' });
  assert.equal(app.getLiveInterval().sec, 24);
  // 再配置の周期（FR-080）とは別の設定
  assert.notEqual(app.getArrangeInterval().sec, 24);
  app.setLang('en');
  assert.ok(app.searchCommands('live update').some((x) => x.command === 'settings.liveInterval'), '英語でも見つかる');
  assert.equal(app.handleKey({ key: 'Escape' }), 'settings.close');
  assert.equal(app.getSettingsDialog(), null);
});

// FR-014 AC-522: 端の値での矢印は範囲を超えない
test('FR-014 AC-522: 範囲の端で矢印キーを押しても範囲を超えず、理由が表示される', async () => {
  const { app } = await newApp();
  app.commands['settings.liveInterval']();
  app.setSettingsFieldDraft('live.interval', '60'); app.handleKey({ key: 'Enter' });
  app.handleKey({ key: 'ArrowUp' });
  assert.equal(app.getLiveInterval().sec, 60);
  assert.equal(app.getState().message.key, 'live.interval.invalid.range');
  app.setSettingsFieldDraft('live.interval', '5'); app.handleKey({ key: 'Enter' });
  app.handleKey({ key: 'ArrowDown' });
  assert.equal(app.getLiveInterval().sec, 5);
});

// FR-014 AC-522: 再起動後も保たれ、データの初期化・セッションの保存の対象外（端末ごとの設定）
test('FR-014 AC-522: 選んだ値は再起動後も保たれ、セッションの保存内容には含まれず、保存内容の消去でも変わらない', async () => {
  const first = await newApp();
  assert.equal(first.app.setLiveInterval(14).ok, true);
  first.app.commands['session.start']();
  first.app.setDraft('保存される発話'); first.app.submitDraft();
  first.app.flushSave?.();
  assert.ok(!String(first.env.storage.getItem(SESSION_KEY) ?? '').includes('intervalSec'), 'セッションの保存内容に含まれない');
  first.app.clearSavedSession();
  const second = await newApp({ storage: first.env.storage });
  assert.equal(second.app.getLiveInterval().sec, 14);
  // 壊れた・範囲外の保存値は初期値
  for (const bad of ['{', '{"intervalSec":61}', '{"intervalSec":4}', '{"intervalSec":7.5}']) {
    const r = await newApp();
    r.env.storage.setItem(LIVE_INTERVAL_KEY, bad);
    const again = await newApp({ storage: r.env.storage });
    assert.equal(again.app.getLiveInterval().sec, 10, bad);
  }
});

// FR-014 AC-521: 記録していない間は定期更新が起きない
test('FR-014 AC-521: 記録していない間は定期更新が起きない', async () => {
  const { app, env } = await newApp();
  adv(env, 60 * SEC);
  assert.equal(app.getLiveRefresh().count, 0);
});

// FR-014 AC-521（FR-002 の［次のシーン］との結合）: 更新間隔の待ちの間に押した［次のシーン］の区切りは失われず、
// 更新の時点で、区切りの前の発話は前のシーンに、後の発話は新しいシーンに加わる。区切りの時点では図に何も加わらない。
test('FR-014 AC-521: 待ちの間の［次のシーン］の区切りを保ち、更新の時点で前・後のシーンに分けて描き足す', async () => {
  for (const withScene of [false, true]) {
    const { app, env } = await live();
    assert.equal(app.setLiveInterval(LIVE_MIN_SEC).ok, true);
    startRec(app);
    if (withScene) { say(env, '最初の話題の発話'); adv(env, LIVE_MIN_SEC * SEC); }
    const n0 = app.getState().scenes.length;
    say(env, '予算の見直しを話す'); adv(env, 500);
    say(env, '来月の計画を決める'); adv(env, 500);
    const before = JSON.stringify(app.getState().scenes);
    app.commands['session.nextScene']();
    assert.equal(JSON.stringify(app.getState().scenes), before, `${withScene}: 区切りの時点では図が変わらない`);
    say(env, '担当者を割り当てる'); adv(env, 500);
    adv(env, LIVE_MIN_SEC * SEC);
    const sc = app.getState().scenes;
    const texts = (s) => s.points.map((p) => p.text).join('|');
    assert.equal(sc.length, n0 + (withScene ? 1 : 2), `${withScene}: 区切りの前と後で別のシーン`);
    const pre = sc[sc.length - 2]; const post = sc[sc.length - 1];
    assert.match(texts(pre), /予算の見直し/); assert.match(texts(pre), /来月の計画/);
    assert.doesNotMatch(texts(pre), /担当者/);
    assert.match(texts(post), /担当者/); assert.doesNotMatch(texts(post), /予算|来月/);
    assert.equal(pre.status, 'confirmed');
    assert.ok(app.getState().utterances.every((u) => !u.held && !u.breakAfter), '取り込んだら印を外す');
  }
});

// FR-014 AC-521 FR-098 AC-571（A-874）: 更新間隔の待ちの間に議題を切り替えても、その時点では描き足さず、
// 待ちの発話は切替の前のシーンに属したまま次の更新の時点に描き足され、切替の後の発話は新しいシーンに入る。切替の境は前のシーンに記録される
test('FR-014 AC-521 FR-098 AC-571 A-874: 待ちの間の議題の切替は、その場で取り込まず、次の更新の時点に区切りの前・後のシーンに分けて描き足す', async () => {
  const { app, env } = await live();
  assert.equal(app.setLiveInterval(LIVE_MIN_SEC).ok, true);
  assert.equal(app.setMeetingContext({ agenda: [{ name: '予算' }, { name: '計画' }] }).ok, true);
  startRec(app);
  assert.equal(app.commands['timer.start']().ok, true);
  say(env, '予算の見直しを話す'); adv(env, 500);
  say(env, '来月の予算を決める'); adv(env, 500);
  const before = JSON.stringify(app.getState().scenes);
  const n0 = app.getState().scenes.length;
  assert.equal(app.commands['timer.next']().ok, true);
  assert.equal(JSON.stringify(app.getState().scenes), before, '切替の時点では図が変わらない（その場で取り込まない）');
  say(env, '担当者を割り当てる'); adv(env, 500);
  assert.equal(JSON.stringify(app.getState().scenes), before, '次の更新の時点までは加わらない');
  adv(env, LIVE_MIN_SEC * SEC);
  const sc = app.getState().scenes;
  assert.equal(sc.length, n0 + 2, '切替の前と後で別のシーン');
  const texts = (s) => s.points.map((p) => p.text).join('|');
  const pre = sc[sc.length - 2]; const post = sc[sc.length - 1];
  assert.match(texts(pre), /予算の見直し/); assert.match(texts(pre), /来月の予算/); assert.doesNotMatch(texts(pre), /担当者/);
  assert.match(texts(post), /担当者/);
  assert.equal(pre.status, 'confirmed');
  assert.equal(app.getSceneAgenda(pre.id), '予算'); assert.equal(app.getSceneAgenda(post.id), '計画');
  assert.ok(app.getAgendaBreaks().has(pre.id), '切替の境は前のシーンに記録される');
});
