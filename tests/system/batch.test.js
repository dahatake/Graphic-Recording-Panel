// FR-118 AC-686 AC-687 AC-688 / NFR-PERF-001 AC-697（System Test。契約: tests/system/CONTRACT-BATCH.md「1.」「3.」「4.」）
// 期待値は受入基準だけから決める。LLM は中継サーバーのモック（決定的）。AC-689〜691・694・695 は検証レベル integration、AC-692 は BLOCKED（Q-049）のため対象外。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { newApp } from './helpers.js';
import { serveWeb, launch, openApp } from './perf-util.js';
import { weight, P, toFile, TXT, VTT, MEETING_LINES, maxSizeTxt, makeRelay, bootApp, enableLlm, batchStyleItems, snapshot, finals } from './batch-util.js';
const deepKeys = (o, acc = []) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { acc.push(k); deepKeys(v, acc); } return acc; };

const STATES = { preparing: [], recording: ['session.start'], paused: ['session.start', 'session.pause'], stopped: ['session.start', 'session.stop'] };
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const styleBtn = (app, id) => batchStyleItems(app).find((i) => i.command === `batchStyle.set:${id}`);
const pressedIds = (app) => batchStyleItems(app).filter((i) => i.pressed === true).map((i) => i.command.replace('batchStyle.set:', ''));

// FR-118 AC-686（FR-117 AC-684 の「ファイル読込モードではスタイルのボタンが表示される」面。FR-118 の実装に依存するため、FR-117 単独のケースから分離した）
test('FR-118 AC-686（FR-117 AC-684 の表示面）: ファイル読込モードではスタイルのボタン（8 項目）が表示され、音声取込へ戻すと表示されない', async () => {
  const { app } = await newApp();
  assert.equal(app.getBatchState().visible, false, '音声取込ではスタイルのボタンは表示しない');
  assert.equal(app.setInputMode('batch').ok, true);
  assert.equal(app.getBatchState().visible, true);
  assert.equal(batchStyleItems(app).length, 8);
  assert.equal(app.setInputMode('live').ok, true);
  assert.equal(app.getBatchState().visible, false);
});

// FR-118 AC-686
test('FR-118 AC-686: ファイル読込モードで .txt・.vtt を読み込んだだけでは（どのセッションの状態でも）図は更新されず、LLM 向けの要求は 0 件で、取込んだ発話は認識文字列の一覧に並ぶ', async () => {
  for (const [name, steps] of Object.entries(STATES)) {
    const h = makeRelay();
    const { app, env } = await bootApp(h);
    await enableLlm(app);
    for (const c of steps) app.commands[c]();
    if (name === 'preparing') assert.equal(app.setInputMode('batch').ok, true);
    const before = snapshot(app); const reqs0 = h.llmReqs().length;
    const a = await app.importTextFile(TXT); const b = await app.importTextFile(VTT);
    assert.equal(a.ok, true, `${name}: .txt`); assert.equal(b.ok, true, `${name}: .vtt`);
    env.scheduler.advance(P.SINGLE_SEC * 1000);
    await app.flushLlm(); await flush();
    assert.deepEqual(finals(app), [...MEETING_LINES, ...MEETING_LINES], `${name}: 一覧に並ぶ`);
    assert.equal(snapshot(app), before, `${name}: 図（シーン・SVG）は更新されない`);
    assert.equal(h.llmReqs().length, reqs0, `${name}: LLM 向けの要求は 0 件`);
  }
});

test('FR-118 AC-686: ファイルを読み込む前（発話が 0 件）はスタイルのボタンが無効で「ファイルを読み込んでください」が文字で示される。読み込めないファイルでは変わらない', async () => {
  const { app } = await newApp();
  assert.equal(app.setInputMode('batch').ok, true);
  assert.equal(app.getBatchState().state, 'idle');
  assert.equal(batchStyleItems(app).length, 8);
  for (const it of batchStyleItems(app)) {
    assert.equal(it.enabled, false, `${it.command}: 無効`);
    assert.match(it.disabledReason ?? '', /ファイルを読み込んでください/);
  }
  const r = await app.runBatch(app.getBatchStyles()[0].id);
  assert.equal(r.ok, false); assert.equal(app.getState().scenes.length, 0);
  assert.equal((await app.importTextFile(toFile('empty.txt', ''))).ok, false, '空のファイルは取り込まれない');
  assert.equal((await app.importTextFile(toFile('a.png', 'x', 'image/png'))).ok, false, 'テキストでないファイルは取り込まれない');
  assert.equal(app.getBatchState().state, 'idle');
  assert.equal((await app.importTextFile(TXT)).ok, true);
  assert.equal(app.getBatchState().state, 'loaded');
  for (const it of batchStyleItems(app)) assert.equal(it.enabled, true, `${it.command}: 読込済みで有効`);
});

// FR-118 AC-687
test('FR-118 AC-687: 読込済みのとき 8 つのスタイルがアイコン・名称（6 文字以内）・短い説明（40 文字以内）のボタンとして開閉なしに常時表示され、選ぶと aria-pressed が真・色以外の印がつく（クリック・検索・キーボード・ja/en）', async () => {
  const { app } = await newApp();
  await app.importTextFile(VTT);
  assert.equal(app.getInputMode().mode, 'batch', '取込で自動的にファイル読込モードへ（AC-685）');
  const styles = app.getBatchStyles();
  assert.equal(styles.length, 8);
  assert.deepEqual(app.getCommandBar().groups.find((g) => g.id === 'batchStyle').commands, styles.map((s) => `batchStyle.set:${s.id}`));
  assert.equal(new Set(styles.map((s) => s.id)).size, 8);
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    const items = batchStyleItems(app);
    assert.equal(items.length, 8);
    for (const it of items) {
      assert.ok(typeof it.icon === 'string' && it.icon.trim(), `${lang} ${it.command}: アイコン`);
      if (lang === 'ja') assert.ok(weight(it.label) <= P.LABEL_MAX && it.label.trim(), `名称は全角 6 文字以内（${it.label}）`);
      else assert.ok([...it.label].length <= 12 && it.label.trim(), `name ≤ 12（${it.label}）`);
      assert.ok(it.description.trim() && weight(it.description) <= P.DESC_MAX, `短い説明は 40 文字以内（${it.description}）`);
      assert.equal(it.labelVisible, true); assert.equal(it.accessibleName, it.label); assert.equal(it.tabbable, true);
      assert.equal(it.pressed, false, '実行前はどれも aria-pressed が偽');
    }
    assert.equal(new Set(items.map((i) => i.label)).size, 8, `${lang}: 名称はそれぞれ異なる`);
  }
  app.setLang('ja');
  for (const s of app.getBatchStyles()) {
    await app.commands[`batchStyle.set:${s.id}`](); await app.flushLlm();
    assert.deepEqual(pressedIds(app), [s.id], '選んだものだけ aria-pressed が真');
    assert.ok(styleBtn(app, s.id).selectedMark, '色以外の印・枠');
    assert.equal(batchStyleItems(app).filter((i) => i.pressed === false && i.selectedMark === null).length, 7);
  }
  const target = app.getBatchStyles()[2];
  const hit = app.searchCommands(styleBtn(app, target.id).label);
  assert.ok(hit.some((h) => (h.command ?? h.id) === `batchStyle.set:${target.id}`), 'コマンドの検索から選べる');
});

test('FR-118 AC-687 実ブラウザ: スタイルの項目は <button aria-pressed> で、ホバーなしで文字が見え、Tab で到達して Enter で選べる', async () => {
  const srv = await serveWeb(); const browser = await launch();
  try {
    const { ctx, page } = await openApp(browser, srv.url, { width: 1280, height: 1000 });
    try {
      await page.evaluate(async ({ name, text }) => { await globalThis.__app.importTextFile({ name, type: 'text/plain', size: text.length, text }); }, { name: TXT.name, text: TXT.text });
      const ids = await page.evaluate(() => globalThis.__app.getBatchStyles().map((s) => s.id));
      assert.equal(ids.length, 8);
      for (const id of ids) {
        const el = page.locator(`button[data-command="batchStyle.set:${id}"]`).first();
        assert.equal(await el.isVisible(), true, `${id}: 開閉なしに表示`);
        assert.ok((await el.innerText()).trim(), `${id}: 名称の文字`);
        assert.equal(await el.getAttribute('aria-pressed'), 'false');
      }
      const first = page.locator(`button[data-command="batchStyle.set:${ids[1]}"]`).first();
      await first.focus(); await page.keyboard.press('Enter');
      await page.waitForFunction((id) => document.querySelector(`[data-command="batchStyle.set:${id}"]`)?.getAttribute('aria-pressed') === 'true', ids[1]);
      assert.equal(await page.locator('[data-command^="batchStyle.set:"][aria-pressed="true"]').count(), 1);
    } finally { await ctx.close(); }
  } finally { await browser.close(); await srv.close(); }
});

// FR-118 AC-688
test('FR-118 AC-688: LLM 連携が有効・同意済みでスタイルを選ぶと、LLM 向けの要求が 1 件以上送られ各要求にそのスタイルの ID・名称だけが含まれる（Prompt 本文は端末から送らない）。応答は検査・サニタイズを通ったものだけが使われ、全シーンが図に描かれ、画風がそのスタイルになる。外部への通信は同一オリジンの中継だけ', async () => {
  const probe = await newApp();
  const key = probe.app.getPartKeys()[0];
  const answer = { objects: [{ key }, { key: '<script>alert(1)</script>' }, { key: '../../etc/passwd' }], people: [], emotions: [], metaphors: [], points: ['<img src=x onerror=alert(1)>'] };
  for (const style of probe.app.getBatchStyles()) {
    const h = makeRelay({ answer });
    const { app } = await bootApp(h);
    await enableLlm(app);
    await app.importTextFile(VTT);
    const n0 = h.llmReqs().length;
    const r = await app.runBatch(style.id); await app.flushLlm();
    assert.equal(r.ok, true, `${style.id}: 実行できる`);
    const reqs = h.llmReqs().slice(n0);
    assert.ok(reqs.length >= 1, `${style.id}: LLM 向けの要求が 1 件以上`);
    // AC-690・AC-358: 端末が送るのは styleId・styleName だけ。Prompt 本文（instruction）は送らない（サーバーが ID から固定文を付与）
    assert.ok(!('instruction' in style), `${style.id}: getBatchStyles() の項目に instruction を持たない`);
    for (const q of reqs) {
      assert.equal(q.body.styleId, style.id, `${style.id}: 各要求に body.styleId がある`);
      assert.equal(q.body.styleName, style.label, `${style.id}: 各要求に body.styleName（スタイル名）がある`);
      assert.ok(!('instruction' in q.body) && !deepKeys(q.body).some((k) => /instruction|prompt/i.test(k)), `${style.id}: 要求に instruction（Prompt 本文）を含まない`);
    }
    assert.ok(h.log.every((q) => q.path.startsWith('/api/')), '同一オリジンの中継（/api/）以外へのリクエストは 0 件');
    const svg = app.renderSvg();
    assert.ok(app.getState().scenes.length >= 1);
    for (const s of app.getState().scenes) assert.ok(svg.includes(`data-scene-id="${s.id}"`), `${style.id}: 全シーンが図に描かれる`);
    assert.ok(svg.includes(`data-part-key="${key}"`), '正しい部品キーは使われる');
    assert.doesNotMatch(svg, /<script|onerror=|etc\/passwd/i, 'サニタイズを通らないものは使われない');
    assert.equal(app.getDrawStyle(), style.drawStyle, '現在の描画スタイルはそのスタイルの画風');
    assert.match(svg, new RegExp(`data-draw-style="${style.drawStyle}"`));
    assert.ok(app.getDrawStyles().some((d) => d.id === style.drawStyle) && app.getDrawStyles().length === 15, '新しい描画スタイルは作らない');
  }
});

test('FR-118 AC-688 異常系: 実行できない条件（未知のスタイル ID・ライブモード・実行中の再選択）では要求を増やさず、図も変わらない。LLM のスタブが失敗しても図は空にならず発話は残る', async () => {
  const h = makeRelay({ mode: 'fail' });
  const { app } = await bootApp(h);
  await enableLlm(app);
  assert.equal((await app.runBatch(app.getBatchStyles()[0].id)).ok, false, 'ライブモード・未読込では実行しない');
  await app.importTextFile(TXT);
  const n0 = h.llmReqs().length;
  for (const bad of ['', 'nosuch', null, undefined, 3, {}]) assert.equal((await app.runBatch(bad)).ok, false, `不正な ID ${JSON.stringify(bad)}`);
  assert.equal(h.llmReqs().length, n0);
  const keep = snapshot(app);
  for (const bad of ['', 'nosuch', null, undefined, 3, {}]) assert.equal((await app.runBatch(bad)).ok, false, `不正な ID（再確認） ${JSON.stringify(bad)}`);
  assert.equal(snapshot(app), keep, '不正な ID では図は変わらない');
  const r = await app.runBatch(app.getBatchStyles()[0].id); await app.flushLlm();
  assert.equal(r.ok, true, '失敗してもルールベースで描いて完了する');
  assert.ok(app.getState().scenes.length >= 1 && app.getState().utterances.length === MEETING_LINES.length, '図は空にならず、発話は失われない');
});

// NFR-PERF-001 AC-697
test('NFR-PERF-001 AC-697: バッチの描画は、LLM 無効（ルールベース）では実行から PARAM-158（3 秒）以内、LLM 有効では応答の受領から 3 秒以内に図へ反映され、待つ間も処理中の表示が出てほかの操作は止まらない。取込上限サイズちょうどのファイルでも同じ', async () => {
  const files = [['通常', VTT], ['上限サイズ', maxSizeTxt()]];
  for (const [label, file] of files) {
    // (1) ルールベース（LLM 無効）
    const a = await newApp();
    assert.equal((await a.app.importTextFile(file)).ok, true, `${label}: 取込`);
    const id = a.app.getBatchStyles()[0].id;
    const t0 = performance.now(); const c0 = a.env.clock.t;
    const p = a.app.runBatch(id);
    assert.equal(a.app.getBatchState().state, 'running', `${label}: 実行の操作の直後に処理中`);
    const r = await p;
    assert.equal(r.ok, true);
    assert.ok(performance.now() - t0 <= P.SINGLE_SEC * 1000, `${label}: ルールベースは ${P.SINGLE_SEC} 秒以内（${Math.round(performance.now() - t0)} ms）`);
    assert.ok(a.env.clock.t - c0 <= P.SINGLE_SEC * 1000);
    assert.ok(a.app.getState().scenes.length >= 1 && a.app.renderSvg().includes(`data-scene-id="${a.app.getState().scenes[0].id}"`), `${label}: 図に反映`);
    // (2) LLM 有効: 応答の受領から 3 秒以内（応答を保留して、処理中の表示と他の操作を確かめる）
    const h = makeRelay({ mode: 'defer' });
    const b = await bootApp(h); await enableLlm(b.app);
    await b.app.importTextFile(file);
    const pb = b.app.runBatch(b.app.getBatchStyles()[1].id);
    await flush();
    const st = b.app.getBatchState();
    assert.equal(st.state, 'running'); assert.ok(st.progressText && st.progressText.trim(), `${label}: 進み具合の文字`);
    assert.equal(b.app.setViewMode('3d').ok !== false, true);
    assert.equal(b.app.getState().viewMode, '3d', `${label}: 待つ間もほかの操作（表示の切替）は止まらない`);
    const t1 = performance.now(); const c1 = b.env.clock.t;
    h.release(); await pb; await b.app.flushLlm();
    assert.ok(performance.now() - t1 <= P.SINGLE_SEC * 1000, `${label}: 応答の受領から ${P.SINGLE_SEC} 秒以内（${Math.round(performance.now() - t1)} ms）`);
    assert.ok(b.env.clock.t - c1 <= P.SINGLE_SEC * 1000);
    assert.ok(b.app.getState().scenes.length >= 1 && b.app.renderSvg().includes(`data-scene-id="${b.app.getState().scenes[0].id}"`));
    // (2') LLM 有効で失敗（中継が 500）: 失敗の確定から 3 秒以内に、失敗したシーンのルールベース描画が図へ反映される（AC-689）。応答の待ち（上限 PARAM-069＝30 秒）は 3 秒に含めない
    const hf = makeRelay({ mode: 'fail' });
    if (label !== '通常') continue; // 上限サイズ×全要求失敗は実装の処理量が大きく（実測 75 秒）、(3) は上の (1)(2) で確かめる
    const f = await bootApp(hf); await enableLlm(f.app);
    await f.app.importTextFile(file);
    const t2 = performance.now(); const c2 = f.env.clock.t;
    const rf = await f.app.runBatch(f.app.getBatchStyles()[1].id); await f.app.flushLlm();
    assert.equal(rf.ok, true, `${label}: 失敗してもルールベースで描いて完了する`);
    assert.ok(hf.llmReqs().length >= 1, `${label}: LLM に要求は出た（空振りでない）`);
    assert.ok(performance.now() - t2 <= P.SINGLE_SEC * 1000, `${label}: 失敗の確定から ${P.SINGLE_SEC} 秒以内（${Math.round(performance.now() - t2)} ms）`);
    assert.ok(f.env.clock.t - c2 <= (P.SINGLE_SEC + P.LLM_TIMEOUT_SEC) * 1000, `${label}: 待ちは ${P.LLM_TIMEOUT_SEC} 秒を上限とする`);
    assert.ok(f.app.getState().scenes.length >= 1 && f.app.renderSvg().includes(`data-scene-id="${f.app.getState().scenes[0].id}"`), `${label}: ルールベースの図が反映される`);
  }
});

// FR-118 AC-692（integration。Q-049 の回答 A。契約: CONTRACT-BATCH.md 3.）
// バッチモードでは、取込んだファイルの全文・発話の逐語・話者名は、LLM 連携が有効・同意済みでも LLM（中継を含む外部）に送られない。
// 注入した長い発話の逐語（固有の文字列）が、スタブの受けた全要求（パスと本文の全階層）に 0 回しか現れないことで確かめる。
test('FR-118 AC-692: バッチ実行（LLM 有効・同意済み）で、注入した長い発話の逐語・ファイルの全文・話者名は、中継スタブが受けた全要求に 0 回しか現れない（送るのはスタイルの ID・名称と要点の文字などだけ）', async () => {
  const pointTexts = (a) => a.getState().scenes.flatMap((s) => s.points.map((p) => p.text)).join('\n'); // 要点の文字（sources の原文は含まない）
  const count = (hay, needle) => hay.split(needle).length - 1;
  const TOKEN = 'ZQXINJECT7731VERBATIM';
  const LONG = `この発話は固有の長い文章であり、会議の途中で参加者が詳しい経緯を延べ延べと説明した内容をそのまま記録したものである。${TOKEN}は取込んだ原文にしか現れない目印であり、外部へ送ってはならない。`;
  const SPK = ['話者SPKZQ甲斐', '話者SPKZQ乙川'];
  const vttText = ['WEBVTT', '',
    `00:00:01.000 --> 00:00:03.000\n<v ${SPK[0]}>${LONG}</v>\n`,
    `00:00:04.000 --> 00:00:06.000\n<v ${SPK[1]}>来月のリリース計画を決める</v>\n`,
    `00:00:07.000 --> 00:00:09.000\n<v ${SPK[0]}>担当者の割り当てを確認する</v>\n`].join('\n');
  const txtText = `${LONG}\n来月のリリース計画を決める\n担当者の割り当てを確認する\n`;
  // 検出器の自己確認（空振りしないこと）: 注入した文字列を含む要求は数えられ、含まない要求は 0 になる
  assert.equal(count(JSON.stringify({ path: '/api/llm/extract', body: { input: LONG } }), TOKEN), 1, '検出器: 含む要求は 1 回と数える');
  assert.equal(count(JSON.stringify({ path: '/api/llm/extract', body: { input: '予算' } }), TOKEN), 0, '検出器: 含まない要求は 0');
  const files = [
    { file: toFile('inject.vtt', vttText), full: vttText, speakers: SPK },
    { file: toFile('inject.txt', txtText), full: txtText, speakers: [] },
  ];
  const probe = await newApp();
  const styles = probe.app.getBatchStyles();
  assert.equal(styles.length, 8);
  for (const f of files) {
    for (const style of [styles[0], styles.at(-1)]) {
      const h = makeRelay({ answer: { objects: [], people: [], emotions: [], metaphors: [] } });
      const { app } = await bootApp(h);
      await enableLlm(app);
      assert.equal((await app.importTextFile(f.file)).ok, true, `${f.file.name}: 取り込める`);
      assert.equal(h.llmReqs().length, 0, '取込だけでは要求 0 件');
      // 「逐語」の定義（要点の文字の一部になっていない発話の文字列）: 実行の前に、固有の文字列がシーンの要点に含まれないことを先に確かめる
      assert.ok(!pointTexts(app).includes(TOKEN), '前提: 固有の文字列はシーンの要点に含まれない（含まれるときは含まれない形に発話を作り直す）');
      assert.ok(app.getTranscript().finals.some((x) => x.text.includes(TOKEN)), '前提: 発話の原文には固有の文字列がある');
      const r = await app.runBatch(style.id); await app.flushLlm();
      assert.equal(r.ok, true, `${f.file.name}/${style.id}: 実行できる`);
      const reqs = h.llmReqs();
      assert.ok(reqs.length >= 1, `${f.file.name}/${style.id}: LLM 向けの要求は送られる（有効・同意済み。空振りでない）`);
      assert.ok(reqs.every((q) => q.body?.styleId === style.id), '送った要求は選んだスタイルの ID を持つ');
      // 検査の対象は、スタブが受けた全要求（状態の確認 /api/llm/status を含む。パス・本文の全階層・JSON の文字列）
      const all = JSON.stringify(h.log);
      assert.equal(count(all, TOKEN), 0, `${f.file.name}/${style.id}: 注入した発話の固有の文字列は 0 回`);
      assert.equal(count(all, LONG), 0, `${f.file.name}/${style.id}: 長い発話の逐語は 0 回`);
      assert.equal(count(all, LONG.slice(0, 20)), 0, `${f.file.name}/${style.id}: 逐語の先頭（20 文字）も 0 回`);
      for (const line of f.full.split('\n')) if (line.length >= 20 && !/-->/.test(line)) assert.equal(count(all, line.replace(/<\/?v[^>]*>/g, '')), 0, `ファイルの行は送られない: ${line.slice(0, 12)}…`);
      for (const n of f.speakers) assert.equal(count(all, n), 0, `${f.file.name}/${style.id}: 話者名 ${n} は 0 回`);
      assert.equal(count(all, f.full), 0, 'ファイルの全文は 0 回');
    }
  }
});
