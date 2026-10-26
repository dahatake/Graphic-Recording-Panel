// LLM 方式1・方式2（FR-063、FR-065）の System Test（part 2/3）。契約: CONTRACT-LLM-FR063.md、CONTRACT-LLM-FR062.md。
// 期待値は受入基準だけから決める。中継サーバーはモック（実 Foundry は呼ばない）。API キーの実値は書かない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, bytesToLatin1, pdfTexts, PARAM } from './helpers.js';

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
test('FR-063 AC-323 LLM の応答を待たずに PARAM-001（15 秒）以内にルールベースの描画が出て、応答後に絵が加わる', async () => {
  const probe = await newApp();
  const key = probe.app.getPartKeys()[0];
  const h = makeRelay({ extract: answerWith(key), deferExtract: true });
  const { app, env } = await enabledApp(h);
  app.setDraft(UTTERANCE); assert.equal(app.submitDraft().ok, true);
  env.tick(PARAM.UPPER_SEC); env.scheduler.advance(PARAM.UPPER_SEC * 1000);
  assert.ok(app.renderSvg().includes(UTTERANCE), '応答が未着でもルールベースの要点が表示済み');
  assert.ok(!app.renderSvg().includes('data-part-key'), 'まだ絵は加わっていない');
  h.release();
  await app.flushLlm();
  assert.ok(app.renderSvg().includes(`data-part-key="${key}"`), '応答の到着後に絵が加わる');
  assert.ok(app.renderSvg().includes(UTTERANCE), 'ルールベースの要点は残る');
});

// FR-063 AC-323（異常系: 応答が失敗しても要点は 3 秒以内に表示される）
test('FR-063 AC-323 LLM の要求が失敗しても要点は 15 秒（PARAM-001）以内に表示され続ける', async () => {
  const h = makeRelay({ extract: 'fail' });
  const { app, env } = await enabledApp(h);
  app.setDraft(UTTERANCE); app.submitDraft();
  env.tick(PARAM.UPPER_SEC); env.scheduler.advance(PARAM.UPPER_SEC * 1000);
  assert.ok(app.renderSvg().includes(UTTERANCE));
  await app.flushLlm();
  assert.ok(app.renderSvg().includes(UTTERANCE));
  assert.ok(!app.renderSvg().includes('data-part-key'));
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
