// FR-115 AC-672 AC-673 AC-674 AC-675（ライブ描画ショー。System Test。契約: tests/system/CONTRACT-LIVE-SHOW.md）
// 期待値は要求定義書の受入基準（PARAM-182・PARAM-164・PARAM-011）だけから決める。演出の途中の状態は、
// テスト用の時計（LinkedScheduler: タイマーの発火の時刻に now() を合わせる）を細かく進めて観測する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARAM, CJK } from './helpers.js';
import { T } from './rearrange-util.js';
import { SHOW, OVERLAY_KINDS, showApp, reload, startRec, sample, show, overlays, sfield, barItem, assertOps, weight } from './liveshow-util.js';

const SEC = 1000;
const ITV = PARAM.LIVE_DEFAULT_SEC * SEC; // 更新間隔の初期値 PARAM-100（10 秒）
const say = (env, text) => env.speech.emit(text, true);
const els = (app) => app.getDiagramElements().map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, w: e.w, h: e.h })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
const ACTIVE = new Set(['stroke', 'write']);

// 同じ発話列・同じ時計で流す（再配置で既存の要素が動くよう、2 回目の更新で「結論」の要点を加える。AC-426）
const SCRIPT = [[1000, T.plain1], [2000, T.plain2], [3000, T.problem], [ITV + 3000, T.conclusion], [ITV + 4000, T.plain3]];
const END = 4 * ITV;
function runScript(r, onStep) {
  startRec(r.app);
  let i = 0;
  sample(r.scheduler, END, (t) => {
    while (i < SCRIPT.length && SCRIPT[i][0] <= t) { say(r.env, SCRIPT[i][1]); i++; }
    if (onStep) onStep(t);
  }, 20);
}

// FR-115 AC-672
test('FR-115 AC-672: 「ライブ描画ショー」は既定 OFF で、コマンドバーの項目（ON/OFF を文字でも示す）・［設定］・コマンドの検索（PARAM-164 回以内）で切り替えられ、ラベルは PARAM-011 以内で表示言語に従い、端末ごとに保存されて再読込後に復元される（初期化・セッションファイルでは変わらない）', async () => {
  const a = await showApp();
  const { app } = a;
  assert.equal(show(app).on, false, '既定は OFF');
  let it = barItem(app, 'show.toggle');
  assert.ok(it, 'コマンドバーに項目がある');
  assert.equal(it.pressed, false);
  assert.match(String(it.stateText), /OFF|オフ/, `OFF の状態を文字で示す（${it.stateText}）`);
  assert.ok(it.label?.trim() && weight(it.label) <= SHOW.LABEL_MAX, `ラベル「${it.label}」は PARAM-011 以内`);
  assert.equal(it.tabbable, true, 'キーボードで届く');
  assert.ok(it.accessibleName?.includes(it.label), 'アクセシブルな名前');
  app.commands['settings.open']();
  assert.equal(sfield(app, 'show.enabled')?.value, false, '［設定］に項目があり OFF');
  app.commands['settings.close']();
  // コマンドバーで ON
  app.operateBarItem('show.toggle');
  it = barItem(app, 'show.toggle');
  assert.equal(show(app).on, true); assert.equal(it.pressed, true);
  assert.match(String(it.stateText), /ON|オン/, `ON の状態を文字で示す（${it.stateText}）`);
  app.commands['settings.open']();
  assert.equal(sfield(app, 'show.enabled').value, true, '［設定］にも反映');
  // ［設定］で OFF
  assert.equal(app.setSettingsField('show.enabled', false).ok, true);
  assert.equal(show(app).on, false);
  assert.equal(barItem(app, 'show.toggle').pressed, false, 'コマンドバーにも反映');
  app.commands['settings.close']();
  // コマンドの検索（キーボードだけ）
  assertOps(app, it.label, 'show.toggle');
  app.commands['show.toggle']();
  assert.equal(show(app).on, true, 'コマンドの検索から ON');
  app.setLang('en');
  const en = barItem(app, 'show.toggle');
  assert.ok(en.label.trim() && !CJK.test(en.label) && weight(en.label) <= SHOW.LABEL_MAX, `en: ${en.label}`);
  assertOps(app, en.label, 'show.toggle');
  app.setLang('ja');
  // 不正な値は受け付けない
  for (const bad of ['on', 1, null, undefined]) { let r; try { r = app.setLiveShow(bad); } catch { r = { ok: false }; } assert.equal(r.ok, false, String(bad)); }
  assert.equal(show(app).on, true);
  // 保存・初期化・セッションファイル
  app.commands['session.start'](); app.setDraft('ショーの保存の確認'); app.submitDraft();
  assert.equal((await app.commands['file.save']()).ok, true);
  const file = a.env.downloads.at(-1);
  assert.equal(app.setLiveShow(false).ok, true);
  const lr = await app.loadSessionFile({ name: file.filename, type: 'application/json', size: file.data.length, text: file.data });
  if (lr.pending) await app.dialogAction('confirm');
  assert.equal(show(app).on, false, 'セッションファイルの読込では変わらない');
  assert.equal(app.setLiveShow(true).ok, true);
  app.commands['data.reset'](); app.dialogAction('confirm');
  assert.equal(show(app).on, true, 'データの初期化では変わらない');
  const b = await reload(a);
  assert.equal(show(b.app).on, true, '再読込後に復元される');
});

// FR-115 AC-672（ON と OFF の結果の一致・OFF では演出の要素が現れない）
test('FR-115 AC-672: 同じ発話列・同じ時計で、ON と OFF の最後の演出の後の図（要素・文字・座標）・テキスト一覧・保存物（SVG）は一致し、OFF ではペン先・手・紙吹雪が 1 つも現れない', async () => {
  const off = await showApp();
  runScript(off, (t) => {
    assert.deepEqual(overlays(off.app), [], `OFF ${t} ms: 演出の要素は現れない`);
    if (t % 500 === 0) assert.ok(!/data-show-overlay/.test(off.app.renderSvg()), `OFF ${t} ms: 図に演出の要素はない`);
  });
  const on = await showApp();
  assert.equal(on.app.setLiveShow(true).ok, true);
  let seen = 0;
  runScript(on, () => { seen += overlays(on.app).length; });
  assert.ok(seen > 0, 'ON では演出の要素が現れる');
  assert.equal(show(on.app).running, false, 'ON: 最後の演出が終わっている');
  assert.deepEqual(overlays(on.app), []);
  assert.deepEqual(els(on.app), els(off.app), '図の要素・座標が一致');
  assert.equal(on.app.renderSvg(), off.app.renderSvg(), '図（文字を含む）が一致');
  assert.equal(on.app.renderOutline(), off.app.renderOutline(), 'テキスト一覧が一致');
  assert.deepEqual(on.app.getTranscript().finals.map((f) => f.text), off.app.getTranscript().finals.map((f) => f.text));
  await on.app.commands['save.svg'](); await off.app.commands['save.svg']();
  assert.equal(on.env.downloads.at(-1).data, off.env.downloads.at(-1).data, '保存物（SVG）が一致');
});

// FR-115 AC-673
test('FR-115 AC-673: ON のとき、更新の時点で加わった新しい要素は、ペン先が輪郭をなぞる描線（途中まで描かれた状態を経る）と 1 字ずつの書き込みで、読み順に 1 つずつ現れ（描線 1200 ms・1 字 80 ms 以内）、終わりにはすべての要素と文字が揃う。会議ボード型でも AC-669 のアニメーションに置き換わり両方は出ない', async () => {
  const r = await showApp();
  const { app, env, scheduler } = r;
  assert.equal(app.setLiveShow(true).ok, true);
  startRec(app);
  scheduler.advanceTo(1000); say(env, T.plain1); say(env, T.plain2); say(env, T.plain4);
  scheduler.advanceTo(ITV - 1);
  assert.equal(show(app).running, false, '更新の時点の前は演出しない');
  scheduler.advanceTo(ITV);
  const rec = new Map(); let partialStroke = false; let partialText = false;
  const DT = 10;
  sample(scheduler, Math.floor((ITV * SHOW.TOTAL_PCT) / 100), (t) => {
    const s = show(app);
    const active = s.items.filter((x) => ACTIVE.has(x.phase));
    assert.ok(active.length <= 1, `${t} ms: 1 つずつ現れる（同時に ${active.length}）`);
    for (const x of s.items) {
      const m = rec.get(x.id) ?? { text: x.text, order: rec.size, strokeStart: null, strokeEnd: null, writeStart: null, writeEnd: null, partial: false };
      if (x.phase === 'stroke') {
        m.strokeStart ??= t; m.strokeEnd = t;
        assert.ok(x.stroke >= 0 && x.stroke <= 1);
        if (x.stroke > 0 && x.stroke < 1) {
          m.partial = true; partialStroke = true;
          assert.ok(overlays(app).some((o) => o.kind === 'pen'), `${t} ms: 描線の間はペン先の絵がある`);
        }
      }
      if (x.phase === 'write') {
        m.writeStart ??= t; m.writeEnd = t;
        assert.ok(x.text.startsWith(x.shown), `${t} ms: 書かれた文字は先頭から（${x.shown}）`);
        if (x.shown.length > 0 && x.shown.length < x.text.length) partialText = true;
      }
      rec.set(x.id, m);
    }
  }, DT);
  assert.ok(rec.size >= 3, `新しい要素が演出される（${rec.size}）`);
  assert.ok(partialStroke, '輪郭が一部だけ描かれた要素を観測できる');
  assert.ok(partialText, '文字の一部だけが書かれた要素を観測できる');
  const list = [...rec.values()];
  for (const m of list) {
    assert.ok(m.partial, `「${m.text}」: 輪郭が途中まで描かれた状態を経る`);
    assert.ok(m.strokeEnd - m.strokeStart <= SHOW.STROKE_MS + DT, `「${m.text}」: 描線 ${m.strokeEnd - m.strokeStart} ms ≤ ${SHOW.STROKE_MS}`);
    if (m.writeStart !== null && m.text) assert.ok(m.writeEnd - m.writeStart <= SHOW.CHAR_MS * [...m.text].length + DT, `「${m.text}」: 書き込みは 1 字 ${SHOW.CHAR_MS} ms 以内`);
  }
  const starts = list.map((m) => m.strokeStart);
  assert.deepEqual(starts, [...starts].sort((x, y) => x - y), '読み順（items の順）に 1 つずつ始まる');
  const s = show(app);
  assert.equal(s.running, false, '演出が終わる');
  for (const x of s.items) { assert.equal(x.phase, 'done'); assert.equal(x.shown, x.text, 'すべての文字が揃う'); }
  assert.deepEqual(overlays(app), [], '終わりにペン先は残らない');
  for (const w of [T.plain1, T.plain2, T.plain4]) assert.ok(app.renderSvg().includes(w), `「${w}」が図にある`);

  // 会議ボード型（FR-114）でも、ショーの描線・書き込み（と運ぶ動き）が AC-669 の出現・移動のアニメーションに置き換わり、両方は出ない（依頼 2026-11-05）
  const boardRun = async (on) => {
    const b = await showApp();
    assert.equal(b.app.setLayoutTypes(['board']).ok, true, '会議ボード型を選べる');
    assert.equal(b.app.setLiveShow(on).ok, true);
    startRec(b.app);
    b.scheduler.advanceTo(b.scheduler.t + 1000); say(b.env, T.plain1); say(b.env, T.plain2);
    const next = Math.ceil(b.scheduler.t / ITV) * ITV; // 記録の開始（t=0）からの次の更新の時点
    b.scheduler.advanceTo(next);
    const seen = { anim: 0, partialStroke: false, wrote: false };
    sample(b.scheduler, Math.floor((ITV * SHOW.TOTAL_PCT) / 100), () => {
      const m = b.app.getBoardModel();
      assert.ok(m && Array.isArray(m.animations), 'getBoardModel().animations がある（契約 CONTRACT-BOARD.md）');
      seen.anim += m.animations.length;
      for (const x of show(b.app).items ?? []) {
        if (x.phase === 'stroke' && x.stroke > 0 && x.stroke < 1) seen.partialStroke = true;
        if (x.phase === 'write') seen.wrote = true;
      }
    }, 10);
    return { b, seen };
  };
  const bOff = await boardRun(false);
  assert.ok(bOff.seen.anim > 0, '会議ボード型・ショー OFF: AC-669 の出現のアニメーションが観測できる（観測の手段の確認）');
  assert.equal(bOff.seen.partialStroke, false, 'ショー OFF ではショーの描線はない');
  const bOn = await boardRun(true);
  assert.ok(bOn.seen.partialStroke, '会議ボード型・ショー ON: 輪郭が途中まで描かれた要素を観測できる');
  assert.ok(bOn.seen.wrote, '会議ボード型・ショー ON: 1 字ずつの書き込みを経る');
  assert.equal(bOn.seen.anim, 0, '会議ボード型・ショー ON: AC-669 の出現・移動のアニメーションは出ない（両方は出ない）');
  assert.equal(show(bOn.b.app).running, false, '演出が終わる');
  assert.deepEqual(els(bOn.b.app), els(bOff.b.app), '演出の後の図は OFF のときと同じ');
});

// FR-115 AC-673（1c4bd9d: 演出はライブ（音声入力・.vtt の再生取込）の更新の時点の描き足しだけ。手入力・ファイルの一括取込は ON でも演出せず即時。FR-115）
test('FR-115 AC-673: ON のとき、.vtt の再生取込でも更新の時点に加わった要素は描線（途中まで描かれた状態）と 1 字ずつの書き込みで読み順に 1 つずつ現れ、終わりに揃う。手入力・ファイルの一括取込では ON でも描線・書き込みを経ず、PARAM-158 秒以内に図に現れる', async () => {
  const W = ['再生ショーの話題その一', '再生ショーの話題その二', '再生ショーの話題その三'];
  const vttFile = (ws) => {
    const text = ['WEBVTT', '', ...ws.flatMap((w, i) => [`c${i}`, `00:00:0${i}.000 --> 00:00:0${i}.500`, w, ''])].join('\n');
    return { name: 'replay.vtt', type: 'text/vtt', size: Buffer.byteLength(text), text };
  };
  // 再生取込（ライブ）
  {
    const { app, scheduler } = await showApp();
    assert.equal(app.setLiveShow(true).ok, true);
    app.commands['session.start']();
    const t0 = scheduler.t;
    assert.equal(app.setVttImportMode({ mode: 'replay', speed: 8 }).ok, true);
    assert.equal((await app.importTextFile(vttFile(W))).ok, true, '再生取込を受け付ける');
    let early = false; let partialStroke = false; let partialText = false; const order = [];
    sample(scheduler, ITV - 1, () => { if ((show(app).items ?? []).some((x) => ACTIVE.has(x.phase)) || overlays(app).length) early = true; }, 20);
    assert.equal(early, false, '再生取込: 更新の時点の前は演出しない');
    scheduler.advanceTo(t0 + ITV);
    sample(scheduler, Math.floor((ITV * SHOW.TOTAL_PCT) / 100), (t) => {
      const items = show(app).items ?? [];
      const active = items.filter((x) => ACTIVE.has(x.phase));
      assert.ok(active.length <= 1, `再生取込 ${t} ms: 1 つずつ現れる`);
      for (const x of items) {
        if (x.phase === 'stroke' && x.stroke > 0 && x.stroke < 1) { partialStroke = true; if (!order.includes(x.id)) order.push(x.id); }
        if (x.phase === 'write' && x.shown.length > 0 && x.shown.length < x.text.length) partialText = true;
      }
    }, 10);
    assert.ok(partialStroke, '再生取込: 輪郭が一部だけ描かれた要素を観測できる');
    assert.ok(partialText, '再生取込: 文字の一部だけが書かれた要素を観測できる');
    const ids = (show(app).items ?? []).map((x) => x.id);
    assert.deepEqual(order, ids.filter((id) => order.includes(id)), '再生取込: 読み順に 1 つずつ');
    assert.equal(show(app).running, false, '再生取込: 演出が終わる');
    for (const w of W) assert.ok(app.renderSvg().includes(w), `再生取込: 「${w}」が図に揃う`);
  }
  // 単発の反映（手入力・ファイルの一括取込）: ON でも描線・書き込みを経ず、PARAM-158 秒以内に図に現れる
  const single = async (label, act, words) => {
    const { app, scheduler } = await showApp();
    assert.equal(app.setLiveShow(true).ok, true);
    app.commands['session.start']();
    await act(app);
    let animated = false;
    sample(scheduler, PARAM.SINGLE_SEC * SEC, () => {
      if ((show(app).items ?? []).some((x) => ACTIVE.has(x.phase)) || overlays(app).length > 0) animated = true;
    }, 20);
    assert.equal(animated, false, `${label}: ON でも描線・書き込み・ペン先は出ない`);
    assert.equal(show(app).running, false, `${label}: 演出は走っていない`);
    for (const w of words) assert.ok(app.renderSvg().includes(w), `${label}: 「${w}」が PARAM-158 秒以内に図にある`);
  };
  await single('手入力', (app) => { app.setDraft(T.plain1); assert.equal(app.submitDraft().ok, true); }, [T.plain1]);
  await single('一括取込（.vtt）', async (app) => {
    assert.equal(app.getVttImportMode().mode, 'bulk', '既定は一括');
    assert.equal((await app.importTextFile(vttFile(W))).ok, true);
  }, W);
  await single('一括取込（.txt）', async (app) => {
    const text = W.join('\n');
    assert.equal((await app.importTextFile({ name: 'm.txt', type: 'text/plain', size: Buffer.byteLength(text), text })).ok, true);
  }, W);
});

// FR-115 AC-674
test('FR-115 AC-674: ON のとき、再配置で位置が変わる既存の要素は、手（またはペン先）の絵がつかんで途中の位置を経て新しい位置まで運ばれ（1 回 800 ms 以内）、運ぶ間も選択・入力中の文字列・記録中が保たれる', async () => {
  const off = await showApp();
  runScript(off);
  const r = await showApp();
  const { app, scheduler } = r;
  assert.equal(app.setLiveShow(true).ok, true);
  const carry = new Map(); let midway = false; let checked = false; let sel = null;
  const DT = 10;
  startRec(app);
  let i = 0;
  sample(scheduler, END, (t) => {
    while (i < SCRIPT.length && SCRIPT[i][0] <= t) { say(r.env, SCRIPT[i][1]); i++; }
    if (t === ITV + 5000) { sel = app.getState().scenes[0]?.id ?? null; if (sel) app.selectScene(sel); app.setDraft('入力中の文字列'); }
    for (const m of show(app).moves ?? []) {
      const c = carry.get(m.id) ?? { start: null, end: null };
      if (m.phase === 'carry') {
        c.start ??= t; c.end = t;
        const between = (k) => Math.min(m.from[k], m.to[k]) - 0.5 <= m.at[k] && m.at[k] <= Math.max(m.from[k], m.to[k]) + 0.5;
        const moved = (m.at.x !== m.from.x || m.at.y !== m.from.y) && (m.at.x !== m.to.x || m.at.y !== m.to.y);
        if (between('x') && between('y') && moved) {
          midway = true;
          const hand = overlays(app).find((o) => (o.kind === 'hand' || o.kind === 'pen') && o.targetId === m.id);
          assert.ok(hand, `${t} ms: 運ぶ間は手の絵がその要素の上にある`);
        }
        if (sel !== null) {
          checked = true;
          assert.equal(app.getState().selectedSceneId, sel, '運ぶ間も選択が保たれる');
          assert.equal(app.getState().input.draft, '入力中の文字列', '入力中の文字列が保たれる');
          assert.equal(app.getState().session, 'recording', '記録中が保たれる');
        }
      }
      carry.set(m.id, c);
    }
  }, DT);
  assert.ok(carry.size >= 1, '再配置で位置が変わる要素が運ばれる');
  assert.ok(midway, '運ぶ途中に要素が元の位置と新しい位置の間にある');
  assert.ok(checked, '運ぶ間の状態を確かめた');
  for (const [id, c] of carry) if (c.start !== null) assert.ok(c.end - c.start <= SHOW.MOVE_MS + DT, `${id}: 運ぶ動き ${c.end - c.start} ms ≤ ${SHOW.MOVE_MS}`);
  assert.equal(show(app).running, false);
  assert.deepEqual(els(app), els(off.app), '運び終えた位置は OFF のときの最終の配置と同じ');
});

// FR-115 AC-675
test('FR-115 AC-675: ON のとき、区画に最初の要点が入ったときと「結論」の要点が加わったときに、付近に紙吹雪・きらめきが 1500 ms 以内だけ出て消える。1 回の演出の合計は更新間隔の 80% 以内で、収まらないときは縮めて次の更新までに終わる', async () => {
  const r = await showApp();
  const { app } = r;
  assert.equal(app.setLiveShow(true).ok, true);
  const party = new Map(); const DT = 10;
  runScript(r, (t) => {
    for (const o of overlays(app)) {
      if (o.kind !== 'confetti' && o.kind !== 'sparkle') continue;
      const k = `${o.kind}:${o.targetId}`;
      const p = party.get(k) ?? { start: t, end: t, at: Math.floor(t / ITV) };
      p.end = t; party.set(k, p);
    }
    if (t % ITV === Math.floor((ITV * SHOW.TOTAL_PCT) / 100)) assert.equal(show(app).running, false, `${t} ms: 更新間隔の ${SHOW.TOTAL_PCT}% 以内に終わる`);
  });
  const ps = [...party.values()];
  assert.ok(ps.some((p) => p.at === 1), '最初の要点が入ったときにお祝いが出る');
  assert.ok(ps.some((p) => p.at === 2), '「結論」の要点が加わったときにお祝いが出る');
  for (const p of ps) assert.ok(p.end - p.start <= SHOW.CELEBRATE_MS + 20, `お祝いは ${p.end - p.start} ms ≤ ${SHOW.CELEBRATE_MS} で消える`);
  // 収まらないとき: 5 秒の間隔に多数の要素 → 各要素の時間を縮め、4 秒（80%）以内に終わり、次の更新の時点で前の演出が残らない
  const b = await showApp();
  assert.equal(b.app.setLiveShow(true).ok, true);
  startRec(b.app);
  assert.equal(b.app.setLiveInterval(PARAM.LIVE_MIN_SEC).ok, true);
  const t0 = b.scheduler.t;
  const many = Array.from({ length: 12 }, (_, k) => `長めの話題その${k}についての確認と今後の進め方を相談する`);
  for (const w of many) say(b.env, w);
  b.scheduler.advanceTo(t0 + PARAM.LIVE_MIN_SEC * SEC);
  assert.equal(show(b.app).running, true, '更新の時点で演出が始まる');
  b.scheduler.advance(Math.floor((PARAM.LIVE_MIN_SEC * SEC * SHOW.TOTAL_PCT) / 100));
  assert.equal(show(b.app).running, false, `更新間隔 ${PARAM.LIVE_MIN_SEC} 秒の ${SHOW.TOTAL_PCT}% 以内に終わる`);
  assert.deepEqual(overlays(b.app), []);
  for (const w of many) assert.ok(b.app.renderSvg().includes(w), `「${w}」は図にある`);
});

// FR-115 AC-675 異常系（動きを減らす設定・強制カラー）
test('FR-115 AC-675 異常系: 動きを減らす設定では ON でも動き（描線・書き込み・運ぶ・お祝い）を出さず要素は即時に現れ、描き足した件数を状態メッセージ（読み上げ対象）で示す。強制カラーではペン先・手・紙吹雪はシステムの色で描くか出さない', async () => {
  const rm = await showApp({ reducedMotion: true });
  assert.equal(rm.app.setLiveShow(true).ok, true);
  startRec(rm.app);
  rm.scheduler.advanceTo(1000); say(rm.env, T.plain1); say(rm.env, T.plain2);
  rm.scheduler.advanceTo(ITV - 20);
  sample(rm.scheduler, 3000, (t) => {
    assert.deepEqual(overlays(rm.app), [], `${t} ms: 演出の要素は出ない`);
    for (const x of show(rm.app).items) assert.ok(!ACTIVE.has(x.phase), `${t} ms: 描線・書き込みをしない`);
  });
  for (const w of [T.plain1, T.plain2]) assert.ok(rm.app.renderSvg().includes(w), `「${w}」は即時に現れる`);
  const msg = rm.app.getState().message?.text ?? '';
  const n = show(rm.app).lastAddedCount;
  assert.ok(Number.isInteger(n) && n > 0, '描き足した件数');
  assert.ok(msg.includes(String(n)), `状態メッセージに件数（${n}）: ${msg}`);
  assert.equal(rm.app.getCommandBar().status.role, 'status', '読み上げ対象');
  const fc = await showApp({ forcedColors: true });
  assert.equal(fc.app.setLiveShow(true).ok, true);
  runScript(fc, () => { for (const o of overlays(fc.app)) { assert.ok(OVERLAY_KINDS.includes(o.kind)); assert.equal(o.systemColor, true, `強制カラー: ${o.kind} はシステムの色`); } });
});
