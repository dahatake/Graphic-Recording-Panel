// FR-115 AC-672 AC-673 AC-674 AC-675（unit・integration）/ PARAM-182 / 決定 C-01（AC-669 の置き換え）/ AC-439:
// ライブ描画ショー（web/src/liveshow.js）の単体・結合テスト。テスト用の時計（env.tick）で演出の途中と終わりを観測する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, toDetail, visibleTexts, keyFor } from '../system/helpers.js';
import { SHOW_KEY, SHOW_LIMITS, SHOW_TIMING, parseShowSvg, planShow, renderShowFrame, setAttrs, flattenPath, charsOf, showLook } from '../../web/src/liveshow.js';

const add = (app, t) => { app.setDraft(t); app.submitDraft(); };
const SHOW_RE = /data-show-(pen|hand|confetti|carry|select|layer|drawing|unwritten|hidden|writing)/;
const has = (svg, name) => new RegExp(`data-show-${name}`).test(svg);
const settle = (app, env, sec = 12) => { env.tick(sec); env.scheduler.advance(sec * 1000); return app.renderSvg(); };
async function detailApp(over) {
  const r = await newApp(over);
  r.app.setLang('ja'); toDetail(r.app); r.app.commands['session.start']();
  return r;
}

// ---- 単体: SVG の解析・計画・見た目の変換（DOM に依存しない） ----
// FR-115 AC-673: 属性の値の中の「>」でタグを切らず、キーのある要素・図形・文字を読み順に取り出す
test('FR-115 AC-673: SVG の解析は属性の値の「>」を含めて正しく入れ子をたどり、図形の長さと文字の数を数える', () => {
  const svg = '<svg width="200" height="100"><path data-relation="a>b" d="M0 0L10 0"/><g data-scene-id="s1"><rect x="10" y="10" width="20" height="10" stroke="#000" fill="#fff"/><g data-point-id="p1" transform="translate(5 5)"><text x="0" y="20" font-size="10">A&amp;B字</text></g></g></svg>';
  const P = parseShowSvg(svg);
  assert.deepEqual(P.units.map((u) => [u.key, u.parent?.key ?? null]), [['data-scene-id=s1', null], ['data-point-id=p1', 'data-scene-id=s1']]);
  const s1 = P.byKey.get('data-scene-id=s1');
  assert.equal(s1.shapes.length, 1); assert.equal(Math.round(s1.shapes[0].length), 60); assert.equal(s1.shapes[0].stroke, true);
  const p1 = P.byKey.get('data-point-id=p1');
  assert.deepEqual(p1.texts[0].segs.flatMap((s) => s.chars), ['A', '&amp;', 'B', '字'], '文字参照は 1 字');
  assert.deepEqual([Math.round(p1.texts[0].x), Math.round(p1.texts[0].y)], [5, 25], '祖先の変換を当てた絶対座標');
  assert.deepEqual(charsOf('😀a'), ['😀', 'a']);
  assert.equal(flattenPath('M0 0h10v10z')[0].length, 4);
  assert.equal(setAttrs('<rect opacity="0.5" fill-opacity="1"/>', { opacity: '0' }), '<rect fill-opacity="1" opacity="0"/>', '同じ名前の属性は 1 つ（fill-opacity は残す）');
});

// FR-115 AC-673 AC-675 PARAM-182: 新しい要素は読み順に 1 つずつ、1 要素の描線 1200・1 字 80・運ぶ 800・お祝い 1500 ミリ秒以内、合計は更新間隔の 80% 以内（超えたら等しく縮める）
test('FR-115 AC-673 AC-675 PARAM-182: 計画は読み順に 1 つずつ・上限以内で、合計が更新間隔の 80% を超えるときは各要素の時間を等しく縮める', () => {
  const pt = (i, y) => `<g data-point-id="p${i}" data-kind="${i === 3 ? 'conclusion' : 'fact'}"><rect x="0" y="${y}" width="300" height="30" stroke="#000" fill="#fff"/><text x="4" y="${y + 20}" font-size="14">要点その${i}の文字です</text></g>`;
  const before = parseShowSvg(`<svg width="400" height="400">${pt(1, 0)}</svg>`);
  const after = parseShowSvg(`<svg width="400" height="400">${[1, 2, 3, 4].map((i) => pt(i, (i - 1) * 40)).join('')}</svg>`);
  const prev = new Map(before.units.map((u) => [u.key, { anchor: u.anchor, count: u.count }]));
  const p = planShow(prev, after, { intervalMs: 10000 });
  assert.deepEqual(p.units.map((u) => u.key), ['data-point-id=p2', 'data-point-id=p3', 'data-point-id=p4'], '読み順');
  for (let i = 1; i < p.units.length; i++) assert.ok(p.units[i].start >= p.units[i - 1].start + p.units[i - 1].draw + p.units[i - 1].write - 1e-9, '1 つずつ（前の要素が終わってから）');
  for (const u of p.units) { assert.ok(u.draw <= SHOW_LIMITS.strokeMax); assert.ok(u.charMs <= SHOW_LIMITS.charMax); }
  assert.equal(p.celebrations.length, 1, '結論の要点でお祝い'); assert.ok(p.celebrations[0].dur <= SHOW_LIMITS.celebrateMax);
  assert.ok(p.total <= 10000 * SHOW_LIMITS.budgetRatio);
  assert.equal(p.scale, 1);
  // 更新間隔が短いと、各要素の時間を同じ割合で縮めて 80% に収める
  const q = planShow(prev, after, { intervalMs: 2000 });
  assert.ok(q.scale < 1); assert.ok(q.total <= 2000 * SHOW_LIMITS.budgetRatio + 1e-6, String(q.total));
  q.units.forEach((u, i) => { if (u.draw > 0) assert.ok(Math.abs(u.draw - p.units[i].draw * q.scale) < 1e-6, '等しく縮める'); });
});

// FR-115 AC-674: 位置が変わった既存の要素は運ぶ（祖先を運ぶときは子を二重に運ばない）。途中は元の位置と新しい位置の間に手と要素がある
test('FR-115 AC-674: 動いた要素は手がつかんで途中の位置を経て運び、離す（子は親と一緒に動き、二重に運ばない）', () => {
  const sec = (y) => `<svg width="400" height="400"><g data-board-section="memo" data-count="1"><rect x="0" y="${y}" width="100" height="50" stroke="#000" fill="none"/><g data-board-el="p:a"><rect x="10" y="${y + 10}" width="20" height="20" fill="#eee" stroke="#000"/></g></g></svg>`;
  const A = parseShowSvg(sec(0)); const B = parseShowSvg(sec(100));
  const prev = new Map(A.units.map((u) => [u.key, { anchor: u.anchor, count: u.count }]));
  const p = planShow(prev, B, { intervalMs: 10000 });
  assert.deepEqual(p.carries.map((c) => [c.key, c.dx, c.dy]), [['data-board-section=memo', 0, -100]], '区画ごと運び、中の要素は親と一緒');
  assert.ok(p.carries[0].dur <= SHOW_LIMITS.carryMax);
  const mid = renderShowFrame(sec(100), B, p, p.carries[0].dur * 0.5, { look: showLook(null) });
  const dy = Number(/data-show-carry="[^"]+" transform="translate\(([-\d.]+) ([-\d.]+)\)"/.exec(mid.svg)[2]);
  assert.ok(dy < 0 && dy > -100, `途中の位置（${dy}）`);
  assert.equal(mid.stats.hands.length, 1); assert.ok(mid.stats.hands[0].y > 0 && mid.stats.hands[0].y < 150, '手も元と新しい位置の間');
  assert.ok(has(mid.svg, 'hand') && has(mid.svg, 'select'));
  const end = renderShowFrame(sec(100), B, p, p.carries[0].dur);
  assert.equal(end.svg, sec(100), '離した後は最終の SVG と同じ');
});

// ---- 結合: アプリで ----
// FR-115 AC-672: 既定は OFF。コマンドバーの項目（状態の文字つき）と［設定］で切り替え、端末ごとに保存・再読込で復元。データの初期化・セッションファイルでは変わらない
test('FR-115 AC-672: 既定 OFF、コマンドバー（設定グループ・状態の文字）と［設定］で切り替え、保存・復元され、初期化・セッションファイルで変わらない', async () => {
  const { app, env, createApp } = await newApp();
  app.setLang('ja');
  assert.equal(app.getLiveShow().on, false, '既定は OFF');
  const item = () => app.getCommandBar().items.find((i) => i.command === 'show.toggle');
  assert.equal(item().group, 'settings'); assert.equal(item().stateText, 'オフ'); assert.equal(item().pressed, false); assert.ok(item().icon);
  // ラベルは PARAM-011（ja 全角 6・en 半角 12）以内で表示言語に従う
  const w = (s) => [...s].reduce((n, ch) => n + (ch.codePointAt(0) >= 0x2e80 ? 1 : 0.5), 0);
  assert.ok(w(item().label) <= 6, item().label);
  assert.equal(app.operateBarItem('show.toggle').ok, true);
  assert.equal(item().stateText, 'オン'); assert.equal(item().pressed, true);
  app.commands['settings.open']();
  const f = () => app.getSettingsDialog().fields.find((x) => x.id === 'show.enabled');
  assert.equal(f().value, true, '［設定］とコマンドバーは同じ状態'); assert.equal(f().role, 'switch');
  assert.equal(app.operateBarItem('show.toggle', 'yes').ok, false, '不正な値は受け付けない');
  assert.equal(app.getLiveShow().on, true);
  assert.deepEqual(JSON.parse(env.storage.getItem(SHOW_KEY)), { on: true });
  // 再読込で復元（端末ごとの設定）
  const app2 = await createApp(env.options);
  assert.equal(app2.getLiveShow().on, true);
  // データの初期化・セッションファイルの保存と読込では変わらない
  app2.commands['session.start'](); add(app2, 'テストの発話です'); env.tick(1);
  assert.equal((await app2.commands['file.save']()).ok, true);
  const dl = env.downloads.at(-1);
  assert.ok(!String(dl.data).includes('liveShow'), 'セッションファイルに含めない');
  assert.equal(app2.commands['data.reset']().ok, true); assert.equal((await app2.dialogAction('confirm')).ok, true);
  assert.equal(app2.getLiveShow().on, true, '初期化で変わらない');
  app2.setLiveShow(false);
  assert.equal((await app2.loadSessionFile({ name: dl.filename, type: dl.mime, size: String(dl.data).length, text: String(dl.data) })).ok, true);
  assert.equal(app2.getLiveShow().on, false, 'ファイルの読込で変わらない');
  app2.setLang('en');
  const en = app2.getCommandBar().items.find((i) => i.command === 'show.toggle');
  assert.ok(en.label.length <= 12 && /Live/.test(en.label)); assert.equal(en.stateText, 'Off');
});

// FR-115 AC-672（PARAM-164・NFR-A11Y-001）: コマンドの検索から 3 回以内（入力・候補の選択・確定）、キーボードだけでも操作できる
test('FR-115 AC-672: コマンドの検索の先頭候補で切り替えられ（3 回以内）、キー割り当てがある', async () => {
  const { app } = await newApp();
  app.setLang('ja');
  const hits = app.searchCommands('ライブ描画'); // 1 回目: 入力
  assert.equal(hits[0]?.command, 'show.toggle'); // 2 回目: 候補の選択
  app.commands[hits[0].command](); // 3 回目: 確定
  assert.equal(app.getLiveShow().on, true);
  assert.ok(keyFor(app, 'show.toggle'), 'キー割り当て');
  app.setLang('en'); assert.equal(app.searchCommands('live drawing show')[0]?.command, 'show.toggle');
});

// FR-115 AC-672: 同じ発話列・同じ時計で、ON の最後の演出の後の図・テキスト一覧・保存物（SVG）は OFF と一致し、OFF では演出の要素が 1 つも現れない
test('FR-115 AC-672: ON の演出が終わった後の図・テキスト一覧・保存物は OFF と同じで、OFF では演出の要素が現れない', async () => {
  const run = async (on) => {
    const { app, env } = await detailApp();
    if (on) app.setLiveShow(true);
    app.renderSvg();
    const seen = [];
    for (const t of ['今日の目的は方向性をそろえることです', '料金プランは月額制で合意しました', '来週までに見積を共有します']) {
      add(app, t);
      for (let i = 0; i < 6; i++) { env.tick(0.4); env.scheduler.advance(400); seen.push(app.renderSvg()); }
      seen.push(settle(app, env));
    }
    // 最後の演出が終わるまで進める（再配置の周期で起きた運ぶ演出を含む）
    for (let i = 0; i < 5 && app.getLiveShow().running; i++) seen.push(settle(app, env, 2));
    if (on) assert.equal(app.getLiveShow().running, false);
    const els = app.getDiagramElements().map((e) => [e.id, e.x, e.y, e.w, e.h]);
    return { svg: app.renderSvg(), save: app.renderSvgForSave(), texts: visibleTexts(app.getState()), els, seen };
  };
  const off = await run(false); const on = await run(true);
  assert.equal(on.svg, off.svg, '図（要素・文字・座標）が一致');
  assert.equal(on.save, off.save, '保存物（SVG）が一致');
  assert.deepEqual(on.texts, off.texts, 'テキスト一覧が一致');
  assert.deepEqual(on.els, off.els, '要素の外枠が一致');
  assert.ok(off.seen.every((s) => !SHOW_RE.test(s)), 'OFF ではペン先・手・紙吹雪などが 1 つも現れない');
  assert.ok(on.seen.some((s) => has(s, 'pen')), 'ON では途中にペン先が現れる');
});

// FR-115 AC-673: 途中に、輪郭が一部だけ描かれた要素と、文字の一部だけが書かれた要素を観測でき、終わりにはすべて揃う。保存物には演出を含めない
test('FR-115 AC-673: 描線（dashoffset の途中）と 1 字ずつの書き込み（未記入の字）を途中で観測し、終わりに揃う。保存物は演出なし', async () => {
  const { app, env } = await detailApp();
  add(app, '今日の目的は方向性をそろえることです'); env.tick(1); app.renderSvg();
  app.setLiveShow(true); app.renderSvg();
  add(app, '料金プランは月額制で合意しました');
  const first = app.renderSvg();
  const plan = app.getLiveShowStatus().plan;
  assert.ok(plan && plan.units.length >= 1);
  assert.ok(has(first, 'hidden'), '始まる前の新しい要素は見えない');
  const u = plan.units[0];
  let sawStroke = false; let sawText = false; let sawSave = false; const t0 = env.now();
  for (let ms = 40; ms <= plan.total + 40; ms += 40) {
    env.clock.t = t0 + ms; const s = app.renderSvg();
    const m = /stroke-dashoffset="([\d.]+)"[^>]*data-show-drawing/.exec(s);
    if (m && Number(m[1]) > 0 && Number(m[1]) < 1) { sawStroke = true; assert.ok(has(s, 'pen'), '描線の間はペン先がある'); }
    if (has(s, 'unwritten') && has(s, 'writing')) sawText = true;
    if (SHOW_RE.test(app.renderSvgForSave())) sawSave = true;
  }
  assert.ok(sawStroke, '輪郭が一部だけ描かれた要素'); assert.ok(sawText, '文字の一部だけが書かれた要素');
  assert.equal(sawSave, false, '保存物（SVG）に演出を含めない');
  assert.ok(u.draw <= SHOW_LIMITS.strokeMax && u.charMs <= SHOW_LIMITS.charMax);
  const end = settle(app, env, 1);
  assert.ok(!SHOW_RE.test(end), '終わりには演出の要素がない');
  assert.match(end, /料金プランは月額制で合意しました/);
});

// FR-115 AC-674 / 決定 C-01 / AC-439: 会議ボード型のあふれの詰め直しで動く要素は手で運ばれ（AC-669 のフェード・移動は出さない）、
// 運んでいる間も選択・ポップアップ・入力中の文字列・記録中の状態は保たれる
test('FR-115 AC-674 C-01 AC-439: 会議ボード型では詰め直しを手で運び（AC-669 の演出は出さない）、運ぶ途中も選択・ポップアップ・入力中・記録中を保つ', async () => {
  const { app, env } = await newApp();
  app.setLang('ja'); app.setLayoutTypes(['board']); app.commands['session.start']();
  add(app, '今日の目的は新サービスの方向性をそろえることです'); env.tick(1); app.renderSvg();
  app.setLiveShow(true); app.renderSvg();
  let carried = false;
  for (let k = 1; k <= 16 && !carried; k++) {
    add(app, `目的その${k}は品質の底上げ`); env.tick(0.01);
    const s0 = app.renderSvg();
    assert.ok(!/data-board-appear/.test(s0), 'C-01: AC-669 の出現の演出は出さない');
    const plan = app.getLiveShowStatus().plan;
    if (plan?.carries.length) {
      carried = true;
      for (const c of plan.carries) assert.ok(c.dur <= SHOW_LIMITS.carryMax);
      const finalModel = JSON.stringify(app.getBoardModel().sections.map((s) => [s.id, s.frame]));
      const sid = app.getState().scenes[0].id; app.selectScene(sid);
      app.setDraft('入力中の文字列');
      const keep = () => JSON.stringify([app.getState().session, app.getState().selectedSceneId, app.getState().input.draft, !!app.getScenePopup()]);
      const before = keep();
      env.tick(plan.carries[0].dur / 2000); env.scheduler.advance(plan.carries[0].dur / 2);
      const mid = app.renderSvg();
      assert.ok(has(mid, 'carry') && has(mid, 'hand') && has(mid, 'select'), '手がつかんで運んでいる（選択の枠つき）');
      const tr = [...mid.matchAll(/data-show-carry="[^"]+" transform="translate\(([-\d.]+) ([-\d.]+)\)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
      const c0 = plan.carries[0];
      assert.ok(tr.some(([x, y]) => Math.hypot(x, y) > 0.5 && Math.hypot(x, y) < Math.hypot(c0.dx, c0.dy) - 0.5), '元の位置と新しい位置の間');
      assert.equal(JSON.stringify(app.getBoardModel().sections.map((s) => [s.id, s.frame])), finalModel, '配置のモデルは最終の位置（演出は見た目だけ）');
      assert.equal(keep(), before, 'AC-439: 運ぶ途中も保たれる');
      const end = settle(app, env, 9);
      assert.ok(!SHOW_RE.test(end));
      assert.equal(keep(), before);
    } else settle(app, env, 9);
  }
  assert.ok(carried, 'あふれの詰め直しで運ぶ演出が起きた');
});

// FR-115 AC-675: 決定事項の追加と、空だった区画に最初の要点が入ったときに、PARAM-182 の上限以内の紙吹雪・きらめきが出て消える
test('FR-115 AC-675: 決定事項・空だった区画の最初の要点でお祝いが出て、上限以内に消える', async () => {
  const { app, env } = await newApp();
  app.setLang('ja'); app.setLayoutTypes(['board']); app.commands['session.start']();
  add(app, '今日の目的は新サービスの方向性をそろえることです'); env.tick(1); app.renderSvg();
  app.setLiveShow(true); app.renderSvg();
  for (const [text, kind] of [['料金プランは月額制で合意しました', 'decision'], ['来週の金曜日までに田中さんが見積を共有します', 'section']]) {
    add(app, text); env.tick(0.01); app.renderSvg();
    const plan = app.getLiveShowStatus().plan;
    assert.equal(plan.celebrations.length, 1, text); const c = plan.celebrations[0];
    assert.equal(c.kind, kind); assert.ok(c.dur <= SHOW_LIMITS.celebrateMax);
    const t0 = env.now(); env.clock.t = t0 + c.start + 10; app.renderSvg(); // お祝いの始まり（合図 chime）
    env.clock.t = t0 + c.start + c.dur / 2; const mid = app.renderSvg();
    assert.ok(has(mid, 'confetti'), '紙吹雪・きらめき');
    env.clock.t = t0 + c.start + c.dur + 10; const after = app.renderSvg();
    assert.ok(!has(after, 'confetti'), '上限以内に消える（要点の文字を隠し続けない）');
    settle(app, env, 9);
  }
  const names = app.getLiveShowStatus().cues.map((x) => x.name);
  assert.ok(names.includes('chime'));
});

// FR-115 AC-675: 1 回の描き足しの演出は次の更新の前に終わる。途中で次の更新が来たら、前の演出は残らない
test('FR-115 AC-675: 合計は更新間隔の 80% 以内に収まり、次の更新が来たら前の演出は残らない', async () => {
  const { app, env } = await detailApp();
  add(app, '最初の発話です'); env.tick(1); app.renderSvg();
  app.setLiveShow(true); app.renderSvg();
  for (let i = 0; i < 12; i++) add(app, `一度に加わる要点その${i}についての少し長めの文章です`);
  app.renderSvg();
  const p = app.getLiveShowStatus().plan;
  const interval = app.getLiveInterval().sec * 1000;
  assert.ok(p.total <= interval * SHOW_LIMITS.budgetRatio + 1e-6, `${p.total} <= ${interval * 0.8}`);
  assert.ok(p.scale < 1, '収まらないので等しく縮めた');
  env.tick(1); app.renderSvg();
  const firstKeys = p.units.map((u) => u.key);
  add(app, '次の更新で加わった要点です'); app.renderSvg();
  const q = app.getLiveShowStatus().plan;
  assert.ok(q.units.every((u) => !firstKeys.includes(u.key)), '前の演出の要素は新しい計画に残らない（最後の状態へ収束）');
  env.tick(0.05); const s = app.renderSvg();
  for (const k of firstKeys) { const id = k.split('=')[1]; assert.ok(!new RegExp(`data-point-id="${id}"[^>]*>[^]*?data-show-hidden`).test(s.slice(s.indexOf(`data-point-id="${id}"`), s.indexOf(`data-point-id="${id}"`) + 400)), `${id} は隠れていない`); }
});

// FR-115 AC-675: 動きを減らす設定では、ON でも動きを出さず即時に現れ、描き足した件数を状態メッセージで示す。強制カラーではペン先・手・紙吹雪を出さない
test('FR-115 AC-675: 動きを減らす設定では動きなしで件数をメッセージで示し、強制カラーではペン先・手・紙吹雪を出さない', async () => {
  const { app, env } = await detailApp({ options: { env: { webgl: true, reducedMotion: true, viewportWidth: 1280 } } });
  add(app, '最初の発話です'); env.tick(1); app.renderSvg();
  app.setLiveShow(true); app.renderSvg();
  add(app, '料金プランは月額制で合意しました'); add(app, '二つ目の要点です');
  const s = app.renderSvg();
  assert.ok(!SHOW_RE.test(s), '動きを出さない');
  assert.equal(app.getLiveShowStatus().plan, null);
  await Promise.resolve(); await Promise.resolve();
  const msg = app.getState().message;
  assert.equal(msg.key, 'msg.showInstant'); assert.match(msg.text, /2 件/);
  // 強制カラー
  const r2 = await detailApp();
  add(r2.app, '最初の発話です'); r2.env.tick(1); r2.app.renderSvg();
  r2.app.setLiveShow(true); r2.app.setForcedColors(true); r2.app.renderSvg();
  add(r2.app, '料金プランは月額制で合意しました');
  let overlays = false; let drew = false; const t0 = r2.env.now();
  for (let ms = 0; ms < 4000; ms += 50) { r2.env.clock.t = t0 + ms; const x = r2.app.renderSvg(); if (/data-show-(pen|hand|confetti)/.test(x)) overlays = true; if (has(x, 'drawing') || has(x, 'unwritten')) drew = true; }
  assert.equal(overlays, false, '強制カラーではペン先・手・紙吹雪を出さない'); assert.ok(drew, '描線・書き込みは行う');
});

// FR-115 / FR-116 の接続点: 演出の各時点で ctx.showAudio?.cue(name, detail) を呼ぶ（未定義なら何もしない）
test('FR-115: 演出の各時点で ctx.showAudio.cue を pen・write・whoosh・chime などの名前で呼ぶ', async () => {
  const calls = [];
  const audioMod = (ctx) => { ctx.showAudio = { cue: (name, detail) => calls.push([name, detail?.key]) }; };
  const { app, env } = await detailApp({ options: { modules: [audioMod] } });
  add(app, '最初の発話です'); env.tick(1); app.renderSvg();
  app.setLiveShow(true); app.renderSvg();
  add(app, '料金プランは月額制で合意しました'); app.renderSvg();
  const t0 = env.now();
  for (let ms = 0; ms < 5000; ms += 40) { env.clock.t = t0 + ms; app.renderSvg(); }
  const names = calls.map((c) => c[0]);
  for (const n of ['pen', 'write', 'chime']) assert.ok(names.includes(n), n);
  assert.ok(names.every((n) => ['pen', 'pop', 'whoosh', 'chime', 'write'].includes(n)));
  // 時計のたびの再描画（scheduler）で、図の元の SVG を作り直さずに演出が進む
  assert.ok(SHOW_TIMING.tickMs <= 50);
});
