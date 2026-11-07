// FR-118 AC-686 AC-687 AC-688 / NFR-PERF-001 AC-697（System Test。契約: tests/system/CONTRACT-BATCH.md「1.」「3.」「4.」）
// 期待値は受入基準だけから決める。LLM は中継サーバーのモック（決定的）。AC-689〜691・694・695 は検証レベル integration。AC-692 は検証レベル system（FR-118 AC-692 のテスト）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { newApp } from './helpers.js';
import { serveWeb, launch, openApp } from './perf-util.js';
import { weight, P, toFile, TXT, VTT, MEETING_LINES, maxSizeTxt, makeRelay, bootApp, enableLlm, batchStyleItems, snapshot, finals, bridgeRelay, sceneSplitVtt } from './batch-util.js';
import { startUpstream, startRelay, rawRequest, baseEnv } from './relay-util.js';
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

// FR-118 AC-688（2026-11-07 明確化: (a) 端末→中継 と (b) 中継→LLM の境界を区別し、予算停止を送信条件より優先する。契約: CONTRACT-BATCH.md「3.」、RELAY-CONTRACT.md）
// 中継サーバーは実プロセス（server/relay.py）、上流（LLM）はループバックのモック。実 LLM へは通信しない。
test('FR-118 AC-688 境界別: 端末→中継は固定指示本文を含まず、中継→LLM の各要求にだけそのスタイルの固定指示本文が付く。予算 0 円・予算到達後は LLM 有効・同意済みでも両境界とも 0 件（同意は撤回されない）で、予算を使用額より大きくすると再開する', async () => {
  const up = await startUpstream();
  const proc = await startRelay(baseEnv(up));
  try {
    const b = bridgeRelay(proc, rawRequest);
    const { app } = await newApp({ options: { relay: b.relay } });
    await enableLlm(app);
    assert.equal((await app.importTextFile(VTT)).ok, true);
    const [sa, sb] = app.getBatchStyles();
    const run = async (style) => {
      const t0 = b.llmReqs().length; const u0 = up.calls.length;
      const r = await app.runBatch(style.id); await app.flushLlm();
      assert.equal(r.ok, true, `${style.id}: 実行できる`);
      return { term: b.llmReqs().slice(t0), upstream: up.calls.slice(u0).map((c) => JSON.parse(c.body)) };
    };
    const A = await run(sa); const B = await run(sb);
    for (const [s, x] of [[sa, A], [sb, B]]) {
      assert.ok(x.term.length >= 1, `${s.id}: 端末→中継の LLM 向け要求が 1 件以上`);
      assert.ok(x.upstream.length >= 1, `${s.id}: 中継→LLM の要求が 1 件以上`);
      assert.ok(b.log.every((q) => q.path.startsWith('/api/')), '端末から同一オリジンの中継以外へのリクエストは 0 件');
      for (const q of x.term) {
        assert.equal(q.body?.styleId, s.id, `${s.id}: (a) 端末→中継はスタイルの ID を送る`);
        assert.ok(!deepKeys(q.body).some((k) => /instruction|prompt/i.test(k)), `${s.id}: (a) 端末→中継に固定指示（Prompt）の項目が無い`);
      }
    }
    // (b) 上流の要求の固定指示本文: 2 つのスタイルで異なる部分（スタイル固有の固定指示）を取り出し、上流にだけあることを確かめる
    const instr = (x) => { const v = x.upstream.map((u) => u.instructions ?? u.instruction ?? u.system ?? ''); assert.ok(v.every((s) => typeof s === 'string' && s.trim()), '(b) 中継→LLM の各要求に固定指示本文がある'); return v; };
    const ia = instr(A); const ib = instr(B);
    assert.ok(ia.every((s) => s === ia[0]) && ib.every((s) => s === ib[0]), '(b) 同じスタイルの各要求には同じ固定指示');
    let k = 0; while (k < ia[0].length && ia[0][k] === ib[0][k]) k++;
    const specificA = ia[0].slice(k, k + 40);
    assert.ok(specificA.length >= 10, '(b) スタイルごとに固定指示本文が異なる（スタイル固有の部分がある）');
    const termAll = JSON.stringify(b.log);
    assert.ok(!termAll.includes(specificA) && !termAll.includes(ia[0].slice(0, 40)), '(a) 固定指示本文は端末→中継のどの要求にも現れない');
    assert.ok(!ib[0].includes(specificA), '(b) 別のスタイルの要求には付かない');

    // 予算 0 円（AC-532）: LLM 有効・同意済みのままでも両境界とも 0 件で、ルールベースで描いて完了する
    assert.equal(app.setBudget(0).ok, true);
    const Z = await run(sa);
    assert.equal(Z.term.length, 0, '予算 0 円: 端末→中継の LLM 向け要求は 0 件');
    assert.equal(Z.upstream.length, 0, '予算 0 円: 中継→LLM の要求は 0 件');
    assert.equal(app.getLlmState().enabled, true, '予算停止は同意の撤回ではない');
    assert.ok(app.getState().scenes.length >= 1 && app.renderSvg().includes(`data-scene-id="${app.getState().scenes[0].id}"`), '予算停止中も図は描かれる');
    assert.equal(app.getDrawStyle(), sa.drawStyle, '予算停止中も選んだスタイルの画風になる');
  } finally { await proc.stop(); await up.close(); }

  // 予算到達後の停止（AC-526）と再開（AC-533）: 1 回目の実行の使用額で到達 → 2 回目は 0 件 → 予算を使用額より大きくすると再開
  {
    const h = makeRelay({ answer: { objects: [], people: [], emotions: [], metaphors: [], usage: { inputTokens: 1000, outputTokens: 1000 } } });
    const { app } = await bootApp(h);
    await enableLlm(app);
    assert.equal(app.setBudget(1).ok, true);
    assert.equal(app.setPricing({ inputPer1M: 1000000000, outputPer1M: 1000000000 }).ok, true);
    await app.importTextFile(VTT);
    const st = app.getBatchStyles()[0].id;
    assert.equal((await app.runBatch(st)).ok, true); await app.flushLlm();
    assert.ok(h.llmReqs().length >= 1, '到達前は送る');
    assert.equal(app.getBudgetWarning()?.key, 'budget.reached', '使用額で予算に到達');
    const n1 = h.llmReqs().length;
    assert.equal((await app.runBatch(st)).ok, true); await app.flushLlm();
    assert.equal(h.llmReqs().length, n1, '予算到達後の停止中は LLM 向け要求 0 件（送信条件より優先）');
    assert.equal(app.getLlmState().enabled, true, '予算停止は同意の撤回ではない');
    assert.equal(app.setBudget(Math.ceil(app.getBudget().usedYen) * 10 + 100).ok, true);
    assert.equal((await app.runBatch(st)).ok, true); await app.flushLlm();
    assert.ok(h.llmReqs().length > n1, '予算を使用額より大きくすると再開する（AC-533）');
  }
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
    // (1') 2026-11-07 明確化: LLM 有効・同意済みでも、実行開始時から予算停止（予算 0 円。AC-532）で要求 0 件なら、起点は「実行の操作」
    const z = makeRelay();
    const zb = await bootApp(z); await enableLlm(zb.app);
    assert.equal(zb.app.setBudget(0).ok, true, `${label}: 予算 0 円`);
    assert.equal((await zb.app.importTextFile(file)).ok, true);
    const t0z = performance.now(); const c0z = zb.env.clock.t;
    const rz = await zb.app.runBatch(zb.app.getBatchStyles()[0].id);
    assert.equal(rz.ok, true, `${label}: 予算停止でもルールベースで完了`);
    assert.ok(performance.now() - t0z <= P.SINGLE_SEC * 1000 && zb.env.clock.t - c0z <= P.SINGLE_SEC * 1000, `${label}: 予算停止（要求 0 件）は実行の操作から ${P.SINGLE_SEC} 秒以内`);
    assert.equal(z.llmReqs().length, 0, `${label}: 予算停止中は LLM 向けの要求 0 件`);
    assert.ok(zb.app.renderSvg().includes(`data-scene-id="${zb.app.getState().scenes[0].id}"`), `${label}: 予算停止でも図に反映`);
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

// FR-022 AC-523 / NFR-PERF-001 AC-697（2026-11-07 明確化。契約: CONTRACT-BATCH.md「4.」）
// 複数要求の実行では、起点は「その実行の全要求の応答受領または失敗・タイムアウトの確定が揃った最後の時点」で、そこから PARAM-158 秒以内に全体を一括反映する。
// 途中の応答だけでは図を更新しない。全失敗・最後がタイムアウト・途中の予算停止もそれぞれ確かめ、取消後は後着の応答も反映せず実行前の図を保持する。
test('FR-022 AC-523 / NFR-PERF-001 AC-697: 複数要求のバッチ実行は、離れて届く途中の応答では図を変えず、最後の応答または失敗・タイムアウトの確定から PARAM-158 秒以内に一括反映し、取消後は後着の応答も反映しない', async () => {
  const N = 3;
  const file = sceneSplitVtt(N);
  // LLM 由来の絵を見分けるため、同じ入力のルールベース描画に出ない部品キーを応答に使う
  const rule = await newApp();
  await rule.app.importTextFile(file);
  assert.equal((await rule.app.runBatch(rule.app.getBatchStyles()[0].id)).ok, true);
  const ruleSvg = rule.app.renderSvg();
  const key = rule.app.getPartKeys().find((k) => !ruleSvg.includes(`data-part-key="${k}"`));
  assert.ok(key, '前提: ルールベースの図に出ない同梱部品がある');
  const OK = { status: 200, body: { objects: [{ key }], people: [], emotions: [], metaphors: [] } };
  const FAIL = { status: 500, body: { error: 'mock' } };
  const settle = async () => { for (let i = 0; i < 3; i++) { await flush(); await new Promise((r) => setTimeout(r, 2)); } };
  const boot = async (extra) => {
    const h = makeRelay({ mode: 'manual' });
    const ctx = await bootApp(h); await enableLlm(ctx.app);
    if (extra) extra(ctx.app);
    assert.equal((await ctx.app.importTextFile(file)).ok, true, '取込');
    return { h, ...ctx };
  };
  const allDrawn = (app) => app.getState().scenes.length >= N && app.getState().scenes.every((s) => app.renderSvg().includes(`data-scene-id="${s.id}"`));
  // outcomes: 要求ごとの結果（'ok'|'fail'|'timeout'）。最後の 1 件の確定の直前までは図が変わらないことを確かめ、確定から PARAM-158 秒以内に一括反映されることを測る。
  const drive = async (label, outcomes) => {
    const { h, app, env } = await boot();
    const before = snapshot(app);
    const p = app.runBatch(app.getBatchStyles()[1].id);
    for (let i = 0; i < outcomes.length; i++) {
      assert.ok(await h.waitOpen(1), `${label}: ${i + 1} 件目の要求が送られる（前提: 要求は ${outcomes.length} 件）`);
      const last = i === outcomes.length - 1;
      if (last) assert.equal(snapshot(app), before, `${label}: 最後の確定の直前まで図（シーン・SVG）は更新されない`);
      let t; let c;
      if (outcomes[i] === 'timeout') {
        h.abandon();
        env.scheduler.advance(P.LLM_TIMEOUT_SEC * 1000); // PARAM-069 の打ち切り＝失敗の確定
        t = performance.now(); c = env.clock.t;
      } else {
        t = performance.now(); c = env.clock.t;
        h.respond(outcomes[i] === 'ok' ? OK : FAIL);
      }
      if (!last) {
        await settle();
        assert.equal(snapshot(app), before, `${label}: ${i + 1} 件目（途中）の${outcomes[i]}だけでは図を更新しない`);
        assert.equal(app.getBatchState().state, 'running', `${label}: 途中は処理中`);
        continue;
      }
      const r = await p;
      assert.equal(r.ok, true, `${label}: 完了`);
      assert.ok(performance.now() - t <= P.SINGLE_SEC * 1000, `${label}: 最後の確定から ${P.SINGLE_SEC} 秒以内（実時間 ${Math.round(performance.now() - t)} ms）`);
      assert.ok(env.clock.t - c <= P.SINGLE_SEC * 1000, `${label}: 最後の確定から ${P.SINGLE_SEC} 秒以内（アプリの時刻）`);
      assert.ok(allDrawn(app), `${label}: 失敗したシーンのルールベース描画を含む全シーンが一括で図に反映`);
      assert.equal(h.open().length, 0, `${label}: 未応答の要求は残らない`);
      return { app, h };
    }
    return null;
  };
  const all = await drive('離れて届く応答', Array(N).fill('ok'));
  assert.ok(all.app.renderSvg().includes(`data-part-key="${key}"`), '応答の反映が図に含まれる');
  assert.equal(all.h.llmReqs().length, N, '要求はシーンごと');
  await drive('最後が失敗', ['ok', 'ok', 'fail']);
  await drive('最後がタイムアウト', ['ok', 'fail', 'timeout']);
  const fails = await drive('全要求が失敗', Array(N).fill('fail'));
  assert.ok(!fails.app.renderSvg().includes(`data-part-key="${key}"`), '全失敗では LLM の絵は無く、ルールベース描画だけ');

  // 途中で予算停止: 1 件目の応答の使用額で予算に達し、以降のシーンは要求を出さずルールベースで一括反映に含める
  {
    const { h, app, env } = await boot((a) => {
      assert.equal(a.setBudget(1).ok, true);
      assert.equal(a.setPricing({ inputPer1M: 1000000000, outputPer1M: 1000000000 }).ok, true);
    });
    const before = snapshot(app);
    const p = app.runBatch(app.getBatchStyles()[1].id);
    assert.ok(await h.waitOpen(1), '予算到達前の 1 件目は送られる');
    const t = performance.now(); const c = env.clock.t;
    h.respond({ status: 200, body: { ...OK.body, usage: { inputTokens: 1000, outputTokens: 1000 } } });
    const r = await p;
    assert.equal(r.ok, true);
    assert.equal(h.llmReqs().length, 1, '予算到達後は要求を出さない');
    assert.equal(app.getBudgetWarning()?.key, 'budget.reached');
    assert.notEqual(snapshot(app), before);
    assert.ok(allDrawn(app), '要求を出せなかったシーンもルールベースで一括反映に含める');
    assert.ok(performance.now() - t <= P.SINGLE_SEC * 1000 && env.clock.t - c <= P.SINGLE_SEC * 1000, '最後の確定（予算停止で以降は要求なし）から PARAM-158 秒以内');
  }

  // 異常系: 最終反映の前に取消すと、一括反映せず、後着の応答も反映せず、実行前の図（前回の実行の結果）を保持する
  {
    const { h, app } = await boot();
    const p0 = app.runBatch(app.getBatchStyles()[0].id);
    for (let i = 0; i < N; i++) { assert.ok(await h.waitOpen(1)); h.respond(FAIL); }
    assert.equal((await p0).ok, true, '前回の実行（全失敗→ルールベース）');
    const prev = snapshot(app);
    const p = app.runBatch(app.getBatchStyles()[1].id);
    assert.ok(await h.waitOpen(1));
    h.respond(OK);
    assert.ok(await h.waitOpen(1), '2 件目の要求（最終反映の前）');
    app.cancelBatch();
    await settle();
    assert.equal(app.getBatchState().state, 'loaded', '取消で loaded に戻る');
    assert.equal(snapshot(app), prev, '取消後は実行前の図のまま');
    while (h.open().length) h.respond(OK); // 後着の応答
    const r = await p;
    await settle();
    assert.equal(r.cancelled, true, '取消で解決する');
    assert.equal(snapshot(app), prev, '後着の応答も反映しない');
    assert.ok(!app.renderSvg().includes(`data-part-key="${key}"`), '後着の応答の絵は図に無い');
  }
});

// FR-118 AC-692（system。Q-049 の回答 A。契約: CONTRACT-BATCH.md 3.。2026-11-07 に逐語の定義 (a)(b) を明確化し検証レベルを system に変更）
// バッチモードでは、取込んだファイルの全文・発話の逐語・話者名は、LLM 連携が有効・同意済みでも LLM（中継を含む外部）に送られない。
// 注入した長い発話の逐語（固有の文字列）が、スタブの受けた全要求（パスと本文の全階層）に 0 回しか現れないことで確かめる。
test('FR-118 AC-692: バッチ実行（LLM 有効・同意済み）で、注入した長い発話の逐語・ファイルの全文・話者名は、中継スタブが受けた全要求に 0 回しか現れない（送るのはスタイルの ID・名称と要点の文字などだけ）', async (t) => {
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
      const extractedText = (a) => (a.getBatchState().extracted ?? []).flatMap((s) => s.points ?? []).join('\n');
      let observed = null; // 抽出後・最初の LLM 向け要求の送信前（送信向けの伏せ字・省略の前）の要点
      const h = makeRelay({ answer: { objects: [], people: [], emotions: [], metaphors: [] }, onExtract: () => { if (observed === null) observed = { extracted: extractedText(appRef.app), scenes: (appRef.app.getBatchState().extracted ?? []).length }; } });
      const appRef = {};
      const { app } = await bootApp(h);
      appRef.app = app;
      await enableLlm(app);
      assert.equal((await app.importTextFile(f.file)).ok, true, `${f.file.name}: 取り込める`);
      assert.equal(h.llmReqs().length, 0, '取込だけでは要求 0 件');
      // 前提（固定入力・固定期待値。2026-11-07 明確化）: 原文には固有の文字列がある
      assert.ok(app.getTranscript().finals.some((x) => x.text.includes(TOKEN)), '前提: 発話の原文には固有の文字列がある');
      const r = await app.runBatch(style.id); await app.flushLlm();
      assert.equal(r.ok, true, `${f.file.name}/${style.id}: 実行できる`);
      // 前提の観測点: スタイル実行の抽出後かつ最初の LLM 向け要求の送信前。その実行で使う全シーンの要点が非空で、固有の文字列を含まない
      // （読込直後の空の getState().scenes での不在確認では代替しない。不一致は合格にせず前提不成立として失敗させる）
      assert.ok(observed, `${f.file.name}/${style.id}: 前提不成立: 最初の LLM 向け要求の送信時点を観測できない`);
      assert.ok(observed.scenes >= 1 && observed.extracted.trim(), `${f.file.name}/${style.id}: 前提不成立: 送信前の抽出済みの要点が空（getBatchState().extracted。契約 CONTRACT-BATCH.md 3.）`);
      assert.ok(!observed.extracted.includes(TOKEN), `${f.file.name}/${style.id}: 前提不成立: 固有の文字列が送信前の要点に含まれる`);
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
  // AC-692 (2)（2026-11-07 の定義 (b)）: 行（発話・見出し）の全体が要点の語だけでできていて再構成できる行は逐語として、そのシーンの要点の文字を送らない（「…」に置き換える）。
  // 英語の発話・.txt の見出し行・短い日本語・話者名つき .vtt の各固有の文字列が、スタブが受けた全要求（パス・本文の全階層）に 0 回。
  const WHOLE = { en: 'Please confirm ZQXENGLINE5521 schedule', head: '■ ZQXHEADLINE6642 議題一覧', ja: '雨天時の搬入経路を変更する', vtt: 'ZQXVTTSHORT7753 を確認' };
  const SPK_W = '話者SPKWH丙村';
  const wholeFiles = [
    { file: toFile('whole.txt', `${WHOLE.head}\n${WHOLE.en}\n${WHOLE.ja}\n来月のリリース計画を決める\n`), uniq: [WHOLE.head, WHOLE.en, WHOLE.ja, 'ZQXHEADLINE6642', 'ZQXENGLINE5521'], names: [] },
    { file: toFile('whole.vtt', ['WEBVTT', '', `00:00:01.000 --> 00:00:03.000\n<v ${SPK_W}>${WHOLE.vtt}</v>\n`, `00:00:04.000 --> 00:00:06.000\n<v ${SPK_W}>${WHOLE.ja}</v>\n`, `00:00:07.000 --> 00:00:09.000\n<v ${SPK_W}>${WHOLE.en}</v>\n`].join('\n')), uniq: [WHOLE.vtt, WHOLE.ja, WHOLE.en, 'ZQXVTTSHORT7753', 'ZQXENGLINE5521'], names: [SPK_W] },
  ];
  for (const f of wholeFiles) {
    for (const style of [styles[0], styles.at(-1)]) {
      const h = makeRelay({ answer: { objects: [], people: [], emotions: [], metaphors: [] } });
      const { app } = await bootApp(h);
      await enableLlm(app);
      assert.equal((await app.importTextFile(f.file)).ok, true, `${f.file.name}: 取り込める`);
      assert.ok(app.getTranscript().finals.some((x) => x.text.includes('ZQX')), '前提: 発話の原文には固有の文字列がある');
      const r = await app.runBatch(style.id); await app.flushLlm();
      assert.equal(r.ok, true, `${f.file.name}/${style.id}: 実行できる`);
      const reqs = h.llmReqs();
      assert.ok(reqs.length >= 1, `${f.file.name}/${style.id}: 要求は送られる（空振りでない）`);
      assert.ok(reqs.every((q) => q.body?.styleId === style.id), '送った要求は選んだスタイルの ID を持つ');
      const all = JSON.stringify(h.log);
      for (const u of f.uniq) assert.equal(count(all, u), 0, `${f.file.name}/${style.id}: 行の全体が要点の語だけの文字列「${u}」は 0 回`);
      for (const n of f.names) assert.equal(count(all, n), 0, `${f.file.name}/${style.id}: 話者名 ${n} は 0 回`);
    }
  }
  // FR-118 AC-692 (b) / AC-358 / AC-690:
  // 不可視書式文字を足しても、表示上同じ発話・見出しの逐語送信が許されるわけではない。
  // 期待値は「そのシーンの要点の文字を送らず『…』にする」。実装の正規化処理には依存しない。
  // 各ファイルは単独で取り込む（別の行の要点に紛れる／別シーンの抑止で空振りするのを防ぐ）。
  const formats = [
    0x200b, 0xfeff, // ゼロ幅空白、BOM / ZERO WIDTH NO-BREAK SPACE（ファイル先頭ではなく行中・行末）
    0x200c, 0x200d, 0x2060, // ZWNJ、ZWJ、WORD JOINER
    0x061c, 0x200e, 0x200f, // ARABIC LETTER MARK、LRM、RLM
    0x202a, 0x202b, 0x202c, 0x202d, 0x202e, // 双方向の埋込み・終了・上書き
    0x2066, 0x2067, 0x2068, 0x2069, // 双方向の分離・終了
  ];
  const lines = [
    { kind: '発話', plain: 'Please review budget', middle: 9 },
    { kind: '見出し', plain: '■ Budget review', middle: 5 },
  ];
  const violations = [];
  let checked = 0;
  for (const style of [styles[0], styles.at(-1)]) {
    // 正常系: 全文送信を防ぐ修正が、日本語の語抽出まで一律に省略してはならない。
    // 語の完全な一覧・順序は規定しない。原文の一部の「予算」は要点として送れ、文全体は送れない。
    const ja = '予算の見直しが必要です';
    const jh = makeRelay();
    const { app: jaApp } = await bootApp(jh);
    await enableLlm(jaApp);
    assert.equal((await jaApp.importTextFile(toFile('japanese-control.txt', `${ja}\n`))).ok, true);
    assert.equal((await jaApp.runBatch(style.id)).ok, true);
    await jaApp.flushLlm();
    const jaReqs = jh.llmReqs();
    assert.ok(jaReqs.length > 0, `${style.id}: 日本語の対照群も要求がある`);
    assert.ok(jaReqs.some((q) => q.body?.input?.includes('予算')), `${style.id}: 日本語の語抽出は維持される`);
    assert.ok(!JSON.stringify(jh.log).includes(ja), `${style.id}: 日本語の原文全体は送らない`);

    for (const line of lines) {
      const variants = [{ label: '不可視文字なし（対照群）', text: line.plain }];
      for (const cp of formats) {
        const ch = String.fromCodePoint(cp);
        const label = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
        variants.push(
          { label: `${label}/行末`, text: `${line.plain}${ch}` },
          { label: `${label}/行中`, text: line.plain.slice(0, line.middle) + ch + line.plain.slice(line.middle) },
        );
      }
      for (const variant of variants) {
        const label = `${style.id}/${line.kind}/${variant.label}`;
        const h = makeRelay();
        const { app } = await bootApp(h);
        await enableLlm(app);
        assert.equal((await app.importTextFile(toFile('format-boundary.txt', `${variant.text}\n`))).ok, true, `${label}: 取込`);
        assert.equal(h.llmReqs().length, 0, `${label}: 取込だけでは送信しない`);
        assert.ok(finals(app).some((s) => s.replace(/\p{Cf}/gu, '') === line.plain), `${label}: 原文は取り込まれた`);
        assert.equal((await app.runBatch(style.id)).ok, true, `${label}: バッチ実行`);
        await app.flushLlm();
        const reqs = h.llmReqs();
        assert.ok(reqs.length > 0, `${label}: 同意済みの要求がある（空振りでない）`);
        assert.ok(reqs.every((q) => q.path === '/api/llm/extract' && q.body?.styleId === style.id), `${label}: スタイルを伴う抽出要求`);
        checked++;
        try {
          // 全要求の全階層を検査。不可視文字そのものが消えた後の全文漏出も見逃さない。
          assert.ok(!JSON.stringify(h.log).replace(/\p{Cf}/gu, '').includes(line.plain), `${label}: 不可視文字を除いた逐語も全要求で 0 回`);
          for (const q of reqs) {
            assert.equal(typeof q.body.input, 'string', `${label}: 送信内容を検査できる`);
            assert.ok(q.body.input.includes('…') && /^[…\s]+$/u.test(q.body.input), `${label}: 行全体が要点の語になるシーンは『…』だけ（語の一部も送らない）`);
          }
        } catch (error) {
          // 最初の漏出で打ち切らず、BOM・方向制御・両スタイルと正常系まで確かめる。
          violations.push({ label, inputs: reqs.map((q) => q.body.input), error: error.message });
        }
      }
    }
  }
  t.diagnostic(`不可視書式文字の境界: ${checked} 組、漏出・省略違反 ${violations.length} 組。日本語の語抽出の対照群は両スタイルで成立`);
  assert.equal(violations.length, 0, `AC-692: 不可視書式文字によって逐語送信抑止が変わってはならない。先頭の違反: ${JSON.stringify(violations.slice(0, 8))}`);
});
