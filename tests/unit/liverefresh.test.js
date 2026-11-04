// FR-014 AC-521・AC-522・AC-053、FR-022 AC-523・AC-671 の単体・結合テスト
// （ライブの更新間隔での描き足し・設定画面とコマンドの検索での変更・端末ごとの保存・.vtt の再生取込）。
// 時計はテスト用の時計（scheduler と now）で進める。期待値は受入基準と PARAM-098〜100・PARAM-183 から決める。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { isValidLiveSec, parseLiveSec, LIVE_INTERVAL_KEY, LIVE_MIN_SEC, LIVE_MAX_SEC, LIVE_DEFAULT_SEC } from '../../web/src/liverefresh.js';
import { IMPORT_METHOD_KEY, PLAYBACK_SPEEDS } from '../../web/src/vttplay.js';
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

// ---- .vtt の再生取込（AC-671） ----
const vttText = (cues) => ['WEBVTT', '', ...cues.flatMap(([sec, text], i) => [`c${i}`, `00:${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}.000 --> 00:${String(Math.floor((sec + 1) / 60)).padStart(2, '0')}:${String((sec + 1) % 60).padStart(2, '0')}.000`, `<v 話者${i}>${text}</v>`, ''])].join('\n');
const vttFile = (cues) => { const text = vttText(cues); return { name: 'meeting.vtt', type: 'text/vtt', size: Buffer.byteLength(text), text }; };
const CUES = [[0, '会議室は三階にあります'], [3, '資料は共有フォルダです'], [6, '予算は百万円です'], [40, '次回は木曜の午後です'], [44, '参加者は八名でした'], [50, '議事録は山田さんが書きます']];

// FR-022 AC-671
test('FR-022 AC-671: 取込の方法（一括・再生取込）と速さ（1・2・4・8 倍）を選べ、端末ごとに保存される', async () => {
  const { app, env } = await newApp();
  const m = app.getImportMethod();
  assert.equal(m.method, 'batch', '既定は一括');
  assert.deepEqual(m.methods.map((x) => x.value), ['batch', 'playback']);
  assert.deepEqual(m.speeds.map((x) => x.value), PLAYBACK_SPEEDS);
  assert.deepEqual(PLAYBACK_SPEEDS, [1, 2, 4, 8]);
  assert.equal(app.setImportMethod({ method: 'playback', speed: 4 }).ok, true);
  assert.equal(app.setImportMethod({ speed: 3 }).ok, false, '選択肢にない速さ');
  assert.equal(app.setImportMethod({ method: 'stream' }).ok, false);
  assert.deepEqual(JSON.parse(env.storage.getItem(IMPORT_METHOD_KEY)), { method: 'playback', speed: 4 });
  const again = await newApp({ storage: env.storage });
  assert.deepEqual([again.app.getImportMethod().method, again.app.getImportMethod().speed], ['playback', 4]);
});

// FR-022 AC-671: cue は受付時刻の差÷速さの経過ごとに確定結果として届き、図は更新間隔ごとに描き足される
test('FR-022 AC-671: 再生取込では cue が「開始時刻の差÷速さ」ごとに確定結果として届き、図は更新間隔ごとにまとめて描き足される', async () => {
  const { app, env } = await live();
  app.setImportMethod({ method: 'playback', speed: 2 });
  const finals = () => app.getTranscript().finals.length;
  const r = await app.importTextFile(vttFile(CUES));
  assert.equal(r.ok, true);
  assert.equal(finals(), 1, '最初の cue は開始の時点で届く');
  assert.match(app.getImportStatus().text, /1 \/ 6/, '進み具合を文字で示す');
  assert.ok(!svgHas(app, '会議室は三階にあります'), '図には更新の時点まで加わらない');
  adv(env, 1500 - 1);
  assert.equal(finals(), 1);
  adv(env, 1);
  assert.equal(finals(), 2, '3 秒の差を 2 倍で 1.5 秒');
  adv(env, 1500);
  assert.equal(finals(), 3);
  adv(env, 10 * SEC - 3000);
  assert.equal(app.getLiveRefresh().count, 1, '更新間隔（10 秒）の時点で 1 回描き足す');
  assert.ok(svgHas(app, '会議室は三階にあります') && svgHas(app, '予算は百万円です'));
  assert.ok(!svgHas(app, '次回は木曜の午後です'));
  adv(env, 30 * SEC);
  assert.equal(app.getVttPlayback().state, 'done');
  assert.equal(finals(), 6);
  assert.ok(svgHas(app, '議事録は山田さんが書きます'));
  assert.equal(app.getState().utterances.some((u) => /話者/.test(u.text)), false, '話者名は含めない');
});

// FR-022 AC-671: 一時停止・再開・中止。中止しても取り込み済みの発話は残る。取込の間は重ねて取り込めない
test('FR-022 AC-671: 一時停止・再開・中止ができ、中止しても取り込み済みの発話は残る', async () => {
  const { app, env } = await live();
  app.setImportMethod({ method: 'playback', speed: 1 });
  await app.importTextFile(vttFile(CUES));
  adv(env, 3 * SEC);
  assert.equal(app.getVttPlayback().delivered, 2);
  assert.equal(app.pauseVttPlayback().ok, true);
  assert.match(app.getImportStatus().text, /一時停止/);
  adv(env, 20 * SEC);
  assert.equal(app.getVttPlayback().delivered, 2, '一時停止中は届かない');
  assert.equal((await app.importTextFile(vttFile(CUES))).reason, 'busy', '再生取込の間は重ねて取り込まない');
  assert.equal(app.resumeVttPlayback().ok, true);
  adv(env, 3 * SEC);
  assert.equal(app.getVttPlayback().delivered, 3);
  assert.equal(app.cancelVttPlayback().ok, true);
  assert.equal(app.getVttPlayback().state, 'cancelled');
  adv(env, 60 * SEC);
  const texts = app.getState().utterances.map((u) => u.text);
  assert.deepEqual(texts, CUES.slice(0, 3).map((c) => c[1]), '取り込み済みの発話は残り、それ以降は届かない');
  assert.ok(svgHas(app, '予算は百万円です'), '取り込み済みは図に描き足される');
  assert.match(app.getImportStatus().text, /3 \/ 6/);
});

// FR-022 AC-671・AC-113: 発話の内容・順・受付時刻・シーンの分かれ方は、速さによらず一括と同じ
test('FR-022 AC-671: 内容・順・受付時刻・シーンの分かれ方は、速さによらず一括の取込と同じ', async () => {
  const shape = (app) => ({
    u: app.getState().utterances.map((u) => [u.text, u.receivedAt]),
    s: app.getState().scenes.map((s) => s.points.map((p) => p.text)),
  });
  const batch = await newApp();
  assert.equal((await batch.app.importTextFile(vttFile(CUES))).ok, true);
  const expected = shape(batch.app);
  assert.ok(expected.s.length >= 2, '無音間隔でシーンが分かれる入力');
  for (const speed of PLAYBACK_SPEEDS) {
    const p = await newApp();
    p.app.setImportMethod({ method: 'playback', speed });
    await p.app.importTextFile(vttFile(CUES));
    adv(p.env, 120 * SEC);
    assert.deepEqual(shape(p.app), expected, `${speed} 倍`);
  }
});

// FR-022 AC-671: 再生取込は記録中でなくても行え、.txt は一括のまま
test('FR-022 AC-671: 再生取込は準備中でも行え、.txt は再生取込を選んでいても一括で取り込まれる', async () => {
  const { app, env } = await live();
  app.setImportMethod({ method: 'playback', speed: 8 });
  const txt = { name: 'memo.txt', type: 'text/plain', size: 30, text: '一行目の話題\n二行目の話題' };
  const r = await app.importTextFile(txt);
  assert.equal(r.ok, true); assert.equal(r.playback, undefined);
  assert.ok(svgHas(app, '二行目の話題'), '.txt は即座に一括');
  await app.importTextFile(vttFile(CUES));
  adv(env, 20 * SEC);
  assert.equal(app.getVttPlayback().state, 'done');
  assert.ok(svgHas(app, '議事録は山田さんが書きます'));
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

// FR-022 AC-671（契約 CONTRACT-LIVE-SHOW の観察点）: getVttImportMode・setVttImportMode・getVttReplay と vttReplay.* のコマンド
test('FR-022 AC-671: 取込の方法は bulk|replay と速さで読み書きでき、不正は ok:false で変えず、再生取込の進み具合とコマンドがある', async () => {
  const { app, env } = await live();
  assert.deepEqual(app.getVttImportMode(), { mode: 'bulk', speed: 1, speeds: [...PLAYBACK_SPEEDS] });
  assert.equal(app.getVttReplay(), null, '一度も始めていない');
  for (const bad of [null, {}, { mode: 'x' }, { mode: 'replay', speed: 3 }, { mode: 'replay', speed: '2' }]) {
    assert.equal(app.setVttImportMode(bad).ok, false, JSON.stringify(bad));
    assert.deepEqual(app.getVttImportMode().mode, 'bulk');
  }
  assert.equal(app.setVttImportMode({ mode: 'replay', speed: 4 }).ok, true);
  assert.deepEqual(app.getVttImportMode(), { mode: 'replay', speed: 4, speeds: [...PLAYBACK_SPEEDS] });
  assert.deepEqual(app.getImportMethod().method, 'playback');
  startRec(app);
  assert.equal((await app.importTextFile(vttFile(CUES))).ok, true);
  let r = app.getVttReplay();
  assert.equal(r.running, true); assert.equal(r.total, CUES.length); assert.equal(r.done, 1);
  assert.ok(r.text.includes(String(r.done)) && r.text.includes(String(r.total)));
  app.commands['vttReplay.pause'](); assert.equal(app.getVttReplay().paused, true);
  adv(env, 60 * SEC); assert.equal(app.getVttReplay().done, 1, '一時停止中は届かない');
  app.commands['vttReplay.resume'](); assert.equal(app.getVttReplay().paused, false);
  app.commands['vttReplay.cancel']();
  r = app.getVttReplay(); assert.equal(r.running, false); assert.ok(app.getState().utterances.length >= 1, '取り込み済みは残る');
  assert.equal(app.setVttImportMode({ mode: 'bulk' }).ok, true);
  assert.equal(app.getVttImportMode().speed, 4, '速さを省くと変えない');
});
