// LLM 方式1・方式2（FR-063、FR-065）の System Test（part 2/3）。契約: CONTRACT-LLM-FR063.md、CONTRACT-LLM-FR062.md。
// 期待値は受入基準だけから決める。中継サーバーはモック（実 Foundry は呼ばない）。API キーの実値は書かない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, bytesToLatin1, pdfTexts, PARAM } from './helpers.js';
import { showApp, show, startRec, sample } from './liveshow-util.js';

const CONFIGURED = { configured: { endpoint: true, deployment: true, credential: true }, endpointHost: 'example.invalid' };
const UTTERANCE = '会議室の机と椅子を片付ける';

function makeRelay({ extract, svg, deferExtract = false } = {}) {
  const log = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const relay = async (req) => {
    log.push(req);
    if (req.path.startsWith('/api/llm/status')) return { status: 200, body: CONFIGURED };
    if (req.path === '/api/llm/extract') {
      if (deferExtract) await gate;
      const r = typeof extract === 'function' ? extract(req) : extract;
      if (r === 'fail') return { status: 500, body: { error: 'mock' } };
      return { status: 200, body: r };
    }
    if (req.path === '/api/llm/svg') return { status: 200, body: svg ?? { svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>' } };
    return { status: 404, body: {} };
  };
  const llmReqs = () => log.filter((r) => !r.path.startsWith('/api/llm/status'));
  return { relay, log, llmReqs, release };
}

async function enabledApp(relayHelper) {
  const { app, env } = await newApp({ options: { relay: relayHelper.relay } });
  const r = await app.requestLlmEnable();
  assert.equal(r.ok, true, '設定済みなら同意の表示へ進む');
  await app.answerLlmConsent(true);
  assert.equal(app.getLlmState().enabled, true, '同意後は有効');
  app.commands['session.start']();
  return { app, env };
}

function partAnswer(app, n = 0) {
  const key = app.getPartKeys()[n];
  assert.ok(key, '同梱部品が 1 点以上ある');
  return { key, label: app.getPartInfo(key).label };
}

const answerWith = (key) => ({ objects: [{ key }], people: [], emotions: [], metaphors: [] });

async function drawOnce() {
  // 同じ入力・同じモック応答で描く（キーは同梱部品の先頭）。
  const probe = await newApp();
  const key = probe.app.getPartKeys()[0];
  const h = makeRelay({ extract: answerWith(key) });
  const { app, env } = await enabledApp(h);
  app.setDraft(UTTERANCE); assert.equal(app.submitDraft().ok, true);
  await app.flushLlm();
  return { app, env, key, h };
}

// FR-063 AC-319
test('FR-063 AC-319 同じ入力と同じモック応答で 2 回描くと SVG が完全に一致する（部品が実際に描かれている）', async () => {
  const a = await drawOnce();
  const b = await drawOnce();
  const sa = a.app.renderSvg(); const sb = b.app.renderSvg();
  assert.ok(sa.includes(`data-part-key="${a.key}"`), '対応づけられた部品が図にある（空の一致ではない）');
  assert.equal(sa, sb);
});

// FR-063 AC-319（異常系: 一部が不正なキーでも、同じ入力なら描画は一致する）
test('FR-063 AC-319 不正な部品キーを含む応答でも 2 回の描画が一致し、有効なキーだけが描かれる', async () => {
  const run = async () => {
    const probe = await newApp();
    const key = probe.app.getPartKeys()[0];
    const h = makeRelay({ extract: { objects: [{ key: 'no-such-part-key' }, { key }], people: [], emotions: [], metaphors: [] } });
    const { app } = await enabledApp(h);
    app.setDraft(UTTERANCE); app.submitDraft(); await app.flushLlm();
    return { svg: app.renderSvg(), key };
  };
  const a = await run(); const b = await run();
  assert.equal(a.svg, b.svg);
  assert.ok(a.svg.includes(`data-part-key="${a.key}"`));
  assert.ok(!a.svg.includes('no-such-part-key'));
});

// FR-063 AC-321
test('FR-063 AC-321 対応づけられた絵が 2D の図・PNG・SVG・PDF・テキスト一覧に反映される', async () => {
  const { app, env, key } = await drawOnce();
  const label = app.getPartInfo(key).label;
  assert.ok(app.renderSvg().includes(`data-part-key="${key}"`), '2D の図に表示');
  assert.ok(app.renderOutline().includes(label), 'テキスト一覧に物の名前');

  await app.commands['save.svg']();
  const svgFile = env.downloads.find((d) => d.mime === 'image/svg+xml');
  assert.ok(svgFile && svgFile.data.includes(`data-part-key="${key}"`), 'SVG の保存物に含まれる');

  // PNG: 部品ごとに drawImage が呼ばれる
  let draws = 0;
  const ctxFactory = (w, h) => {
    const ctx = new Proxy({}, {
      get(t, p) {
        if (p === 'drawImage') return () => { draws++; };
        if (p === 'measureText') return (s) => ({ width: String(s).length * 8 });
        if (p === 'canvas') return canvas;
        if (p in t) return t[p];
        return () => undefined;
      },
      set(t, p, v) { t[p] = v; return true; },
    });
    const canvas = { width: w, height: h, getContext: () => ctx, toBytes: async () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) };
    return canvas;
  };
  const h2 = makeRelay({ extract: answerWith(key) });
  const { app: app2, env: env2 } = await newApp({ options: { relay: h2.relay, canvasFactory: ctxFactory } });
  await app2.requestLlmEnable(); await app2.answerLlmConsent(true);
  app2.commands['session.start'](); app2.setDraft(UTTERANCE); app2.submitDraft(); await app2.flushLlm();
  await app2.commands['save.png']();
  assert.ok(draws >= 1, 'PNG の保存物に部品が描かれる（drawImage）');
  assert.ok(env2.downloads.some((d) => d.mime === 'image/png'));

  // PDF: 部品がないときと内容が異なる
  await app.commands['save.pdf']();
  const withPart = env.downloads.find((d) => d.mime === 'application/pdf');
  const plain = await newApp(); plain.app.commands['session.start'](); plain.app.setDraft(UTTERANCE); plain.app.submitDraft();
  await plain.app.commands['save.pdf']();
  const without = plain.env.downloads.find((d) => d.mime === 'application/pdf');
  assert.ok(withPart && without);
  assert.notEqual(bytesToLatin1(withPart.data), bytesToLatin1(without.data), 'PDF に部品の絵が含まれる');
  assert.ok(pdfTexts(withPart.data).length > 0, 'PDF にテキストも含まれる');
});

// FR-063 AC-321（異常系: 応答が不正な形式なら絵は加わらず、一覧にも出ない）
test('FR-063 AC-321 形式に合わない応答では絵が図・一覧に出ない', async () => {
  const probe = await newApp();
  const key = probe.app.getPartKeys()[0];
  const label = probe.app.getPartInfo(key).label;
  const h = makeRelay({ extract: { objects: 'not-an-array', key } });
  const { app } = await enabledApp(h);
  app.setDraft(UTTERANCE); app.submitDraft(); await app.flushLlm();
  assert.ok(!app.renderSvg().includes('data-part-key'));
  assert.ok(!app.renderOutline().includes(`>${label}<`));
});

// FR-063 AC-323
test('FR-063 AC-323 LLM の応答を待たずに PARAM-158（3 秒。手入力の単発の反映）以内にルールベースの描画が出て、応答後に絵が加わる', async () => {
  const probe = await newApp();
  const key = probe.app.getPartKeys()[0];
  const h = makeRelay({ extract: answerWith(key), deferExtract: true });
  const { app, env } = await enabledApp(h);
  app.setDraft(UTTERANCE); assert.equal(app.submitDraft().ok, true);
  env.tick(PARAM.SINGLE_SEC); env.scheduler.advance(PARAM.SINGLE_SEC * 1000);
  assert.ok(app.renderSvg().includes(UTTERANCE), '応答が未着でもルールベースの要点が表示済み');
  assert.ok(!app.renderSvg().includes('data-part-key'), 'まだ絵は加わっていない');
  h.release();
  await app.flushLlm();
  assert.ok(app.renderSvg().includes(`data-part-key="${key}"`), '応答の到着後に絵が加わる');
  assert.ok(app.renderSvg().includes(UTTERANCE), 'ルールベースの要点は残る');
});

// FR-063 AC-323（2026-11-07 明確化: ファイル取込は先行描画の対象外。読込だけでは図を更新せず実行前の図を保持し、スタイルを選んだバッチ実行時だけ AC-697 で一括反映。契約: CONTRACT-BATCH.md）
test('FR-063 AC-323 ファイル取込: LLM 連携が有効でも、未実行の取り込みファイルでは PARAM-158 秒を超えて待っても図は更新されず実行前の図を保持し、LLM 向けの要求も出ない。スタイルを選んで実行したときだけ全体が図に反映される', async () => {
  const probe = await newApp();
  const key = probe.app.getPartKeys()[0];
  const h = makeRelay({ extract: answerWith(key) });
  const { app, env } = await enabledApp(h);
  app.setDraft(UTTERANCE); assert.equal(app.submitDraft().ok, true);
  env.tick(PARAM.SINGLE_SEC); env.scheduler.advance(PARAM.SINGLE_SEC * 1000); await app.flushLlm();
  assert.ok(app.renderSvg().includes(UTTERANCE), '前提: 手入力の図がある（実行前の図）');
  const fig = () => JSON.stringify({ scenes: app.getState().scenes, svg: app.renderSvg() });
  const n0 = h.llmReqs().length;
  if (app.getState().session === 'recording') app.commands['session.stop']();
  if (app.getInputMode?.().mode !== 'batch') assert.equal(app.setInputMode('batch').ok, true, 'ファイル読込モードに切り替えられる');
  const before = fig();
  const FILE_LINE = '来月のリリース計画を決める';
  const text = `${FILE_LINE}\n担当者の割り当てを確認する\n`;
  assert.equal((await app.importTextFile({ name: 'later.txt', type: 'text/plain', size: Buffer.byteLength(text), text })).ok, true);
  for (let i = 0; i < 4; i++) { env.tick(PARAM.SINGLE_SEC); env.scheduler.advance(PARAM.SINGLE_SEC * 1000); }
  await app.flushLlm();
  assert.equal(fig(), before, '未実行の取り込みファイルでは PARAM-158 秒を超えて待っても図は更新されない（先行描画の対象外）');
  assert.ok(!app.renderSvg().includes(FILE_LINE), '取込んだ発話は図に出ていない');
  assert.equal(h.llmReqs().length, n0, '読込だけでは LLM 向けの要求は出ない');
  const style = app.getBatchStyles?.()[0];
  assert.ok(style, 'スタイルを選べる');
  const rb = await app.runBatch(style.id);
  assert.equal(rb.ok, true, `バッチ実行: ${JSON.stringify(rb)} ${JSON.stringify(app.getBatchState?.())}`);
  await app.flushLlm();
  assert.notEqual(fig(), before, 'スタイルを選んで実行したときだけ図が更新される');
  assert.ok(app.getState().scenes.every((s) => app.renderSvg().includes(`data-scene-id="${s.id}"`)), '全体が図に反映される');
});

// FR-063 AC-323（異常系: 応答が失敗しても要点は 3 秒以内に表示される）
test('FR-063 AC-323 LLM の要求が失敗しても要点は 3 秒（PARAM-158。手入力の単発の反映）以内に表示され続ける', async () => {
  const h = makeRelay({ extract: 'fail' });
  const { app, env } = await enabledApp(h);
  app.setDraft(UTTERANCE); app.submitDraft();
  env.tick(PARAM.SINGLE_SEC); env.scheduler.advance(PARAM.SINGLE_SEC * 1000);
  assert.ok(app.renderSvg().includes(UTTERANCE));
  await app.flushLlm();
  assert.ok(app.renderSvg().includes(UTTERANCE));
  assert.ok(!app.renderSvg().includes('data-part-key'));
});

// FR-063 AC-323（ライブ描画ショー（FR-115）が ON のとき。1c4bd9d: ライブの上限は描画の開始に当てはめ、演出の完了は AC-675。手入力は単発の反映で即時）
test('FR-063 AC-323 ライブ描画ショー ON: LLM の応答を待たずに、手入力では PARAM-158 秒以内に要点が図に表示され（演出で待たせない）、ライブでは描画の開始（最初の要素の描線の開始）が PARAM-001＋PARAM-104 秒以内で、演出の終わりに要点が揃い、応答の到着後に絵が加わる', async () => {
  // LLM 由来の絵だけを判定する: 同じ設定（詳細度「詳細」）・LLM なしで同じ発話から規則で描かれる部品（例: 「会議」→ 規則の部品）を除いたキーを応答に使う
  const probe = await showApp();
  probe.app.commands['session.start']();
  probe.app.setDraft(UTTERANCE); assert.equal(probe.app.submitDraft().ok, true);
  probe.scheduler.advance(PARAM.SINGLE_SEC * 1000);
  const ruleKeys = new Set([...probe.app.renderSvg().matchAll(/data-part-key="([^"]+)"/g)].map((m) => m[1]));
  const key = probe.app.getPartKeys().find((k) => !ruleKeys.has(k));
  assert.ok(key, '規則の部品に当たらない同梱部品がある');
  const llmPart = `data-part-key="${key}"`;
  const boot = async () => {
    const h = makeRelay({ extract: answerWith(key), deferExtract: true });
    const r = await showApp({ options: { relay: h.relay } });
    assert.equal((await r.app.requestLlmEnable()).ok, true, '設定済みなら同意の表示へ進む');
    await r.app.answerLlmConsent(true);
    assert.equal(r.app.getLlmState().enabled, true, 'LLM 連携が有効');
    assert.equal(r.app.setLiveShow(true).ok, true, 'ライブ描画ショー ON');
    return { ...r, h };
  };
  // 手入力（単発の反映）: ショー ON でも PARAM-158 秒以内に要点が図に表示され、演出の途中で止まっていない
  {
    const { app, scheduler, h } = await boot();
    app.commands['session.start']();
    app.setDraft(UTTERANCE); assert.equal(app.submitDraft().ok, true);
    scheduler.advance(PARAM.SINGLE_SEC * 1000);
    assert.ok(app.renderSvg().includes(UTTERANCE), '手入力: 応答が未着でも PARAM-158 秒以内にルールベースの要点が表示済み');
    assert.equal(show(app).running, false, '手入力: ショー ON でも PARAM-158 秒の時点で演出の途中ではない（要点が表示し終わっている）');
    assert.ok(!app.renderSvg().includes(llmPart), '手入力: まだ LLM の絵は加わっていない');
    h.release(); await app.flushLlm();
    assert.ok(app.renderSvg().includes(llmPart), '手入力: 応答の到着後に絵が加わる');
  }
  // ライブ（音声入力）: 上限は PARAM-001＋PARAM-104 秒のまま判定する。応答の保留が LLM の要求のタイムアウト（PARAM-069）を超えて
  // 失敗扱いにならないよう、更新間隔は既定（PARAM-100）にし、描画の開始を見つけた時点で時計を止める（保留は合計 2 間隔＝20 秒）
  {
    const { app, env, scheduler, clock, h } = await boot();
    startRec(app);
    const ITV = PARAM.LIVE_DEFAULT_SEC;
    assert.equal(app.setLiveInterval(ITV).ok, true);
    scheduler.advance(10);
    const t0 = clock.t;
    env.speech.emit(UTTERANCE, true);
    const LIMIT = (PARAM.UPPER_SEC + PARAM.RENDER_SEC) * 1000;
    let startAt = null;
    for (let el = 0; startAt === null && el < LIMIT; el += 100) {
      scheduler.advance(100);
      startAt = (show(app).log ?? []).find((e) => e.type === 'stroke' && e.at >= t0)?.at ?? null;
    }
    assert.ok(startAt !== null, `ライブ: ${LIMIT / 1000} 秒以内に描画（最初の要素の描線）が始まる`);
    assert.ok(startAt - t0 <= LIMIT, `ライブ: 描画の開始は受付から ${startAt - t0} ms ≤ ${LIMIT} ms（PARAM-001＋PARAM-104）`);
    assert.ok(!app.renderSvg().includes(llmPart), 'ライブ: LLM の応答を待たずに描画が始まる（応答は未着）');
    sample(scheduler, ITV * 1000, () => {}, 100); // 更新の時点から 1 間隔ぶん（演出は間隔の PARAM-182 の割合以内に終わる。完了の時間そのものは AC-675）
    assert.equal(show(app).running, false, 'ライブ: 演出が終わっている');
    assert.ok(app.renderSvg().includes(UTTERANCE), 'ライブ: 演出の終わりにルールベースの要点が図に揃う');
    h.release(); await app.flushLlm();
    scheduler.advance(PARAM.SINGLE_SEC * 1000);
    assert.ok(app.renderSvg().includes(llmPart), 'ライブ: 応答の到着後に絵が加わる');
    assert.ok(app.renderSvg().includes(UTTERANCE), 'ライブ: ルールベースの要点は残る');
  }
});

// FR-065 AC-330
test('FR-065 AC-330 方式2 は既定でオフで、LLM 連携が有効でも SVG の生成要求が 0 件', async () => {
  const h = makeRelay({ extract: { objects: [{ key: 'thing-not-in-bundle', label: '未収載の物' }], people: [], emotions: [], metaphors: [] } });
  const { app } = await enabledApp(h);
  assert.equal(app.getLlmState().svgGeneration, false, '既定はオフ');
  app.setDraft(UTTERANCE); app.submitDraft(); await app.flushLlm();
  const reqs = h.llmReqs();
  assert.ok(reqs.some((r) => r.path === '/api/llm/extract'), 'LLM 連携自体は動いている');
  assert.equal(reqs.filter((r) => r.path === '/api/llm/svg').length, 0, 'SVG の生成要求 0 件');
  assert.ok(reqs.every((r) => !(r.body && r.body.allowSvg === true)), '抽出要求も SVG の生成を求めない');
});

// FR-065 AC-330（異常系: 方式2 をオンにして、さらにオフへ戻すと要求は再び 0 件）
test('FR-065 AC-330 方式2 をオンにした後オフへ戻すと、以降の SVG 生成要求は 0 件', async () => {
  const h = makeRelay({ extract: { objects: [{ key: 'thing-not-in-bundle', label: '未収載の物' }], people: [], emotions: [], metaphors: [] } });
  const { app } = await enabledApp(h);
  app.setLlmSvgGeneration(true);
  assert.equal(app.getLlmState().svgGeneration, true);
  app.setLlmSvgGeneration(false);
  assert.equal(app.getLlmState().svgGeneration, false);
  app.setDraft(UTTERANCE); app.submitDraft(); await app.flushLlm();
  assert.equal(h.llmReqs().filter((r) => r.path === '/api/llm/svg').length, 0);
});
