// FR-063 AC-317 AC-318 AC-320 AC-322 / NFR-PRIV-003 AC-358 AC-359 AC-360 AC-361 AC-362 の単体・結合テスト（web/src/llmdraw.js）。実 Foundry は呼ばず、中継サーバーはモック。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { parseExtraction, maskText, clampText, MAX_SEND_CHARS } from '../../web/src/llmdraw.js';
import { getPartKeys } from '../../web/src/parts.js';

const CONF = { configured: { endpoint: true, deployment: true, credential: true }, endpointHost: 'example.invalid' };
const KEY = getPartKeys()[0];
function relay(answer) {
  const calls = [];
  const fn = async ({ method = 'GET', path, body }) => {
    calls.push({ method, path, body });
    if (path.startsWith('/api/llm/status')) return { status: 200, body: CONF };
    return { status: 200, body: typeof answer === 'function' ? answer(body) : answer };
  };
  return { fn, calls };
}
async function enabled(answer) {
  const r = relay(answer);
  const ctx = await newApp({ options: { relay: r.fn } });
  await ctx.app.requestLlmEnable(); await ctx.app.answerLlmConsent(true);
  ctx.app.commands['session.start']();
  return { ...ctx, r };
}
const say = async (app, text) => { app.setDraft(text); app.submitDraft(); await app.flushLlm(); };

// FR-063 AC-317: 形式の検証を通ったものだけが対応づけられ、通らない応答は全体が無視される
test('FR-063 AC-317: 形式に合う応答は対応づけられ、合わない応答は全体が無視される', () => {
  const ok = parseExtraction({ objects: [{ key: KEY }], people: [], emotions: [], metaphors: [] });
  assert.deepEqual(ok.objects, [KEY]);
  for (const bad of [null, 'x', [], {}, { points: ['x'] }, { objects: 'x' }, { objects: [{ key: KEY }], people: 3 }, { objects: ['str'] }]) assert.equal(parseExtraction(bad), null);
  // Responses 形式の出力の文字（JSON）も受け付ける
  const wrapped = parseExtraction({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ objects: [{ key: KEY }] }) }] }] });
  assert.deepEqual(wrapped.objects, [KEY]);
  assert.equal(parseExtraction({ output_text: 'not json' }), null);
});

// FR-063 AC-318: 同梱部品にないキーは使われず、有効なキーだけが残る
test('FR-063 AC-318: 不正な部品キーは捨て、有効なキーだけを描く', () => {
  const r = parseExtraction({ objects: [{ key: 'nope' }, { key: KEY }, { key: '<script>' }], metaphors: [{ key: 'nope2' }], emotions: [{ key: 'bogus' }, { key: 'happy' }] });
  assert.deepEqual(r.objects, [KEY]); assert.deepEqual(r.metaphors, []); assert.deepEqual(r.emotions, ['happy']);
});

// FR-063 AC-320: LLM の文字列は図・一覧に出ない（部品の名前は同梱の定義から）。長さは制限される
test('FR-063 AC-320: LLM が返した文字列（ラベル・タグ）は図に解釈されず、長さも制限される', async () => {
  const evil = '<script>alert(1)</script>' + 'x'.repeat(500);
  const { app } = await enabled({ objects: [{ key: KEY, label: evil }], people: [{ hair: evil, hairColor: evil, outfit: evil, expression: evil }], emotions: [], metaphors: [] });
  await say(app, '机を片付ける');
  const svg = app.renderSvg(); const out = app.renderOutline();
  assert.ok(!svg.includes('<script') && !out.includes('<script') && !svg.includes('xxxxxxxx'));
  assert.ok(svg.includes('data-part-key'));
});

// FR-063 AC-322: 実在の人物の名前・特定の指定があっても、名前ラベル・似顔絵は描かれず汎用キャラだけ
test('FR-063 AC-322: 人物は汎用キャラだけで描かれ、名前は図にも一覧にも出ない', async () => {
  const { app } = await enabled({ objects: [], people: [{ name: '山田太郎', likeness: 'real', hair: 'long', hairColor: 'red', outfit: 'suit', expression: 'happy' }], emotions: [], metaphors: [] });
  await say(app, 'ある人が笑う');
  const svg = app.renderSvg();
  assert.ok(svg.includes('data-character="generic"'));
  assert.ok(!svg.includes('山田太郎') && !app.renderOutline().includes('山田太郎'));
});

// NFR-PRIV-003 AC-358: 送るのは要点の文字だけ（音声・ファイル全文・セッション・端末の情報を含まない）
test('NFR-PRIV-003 AC-358: 送信内容は要点の文字（と固定の指示）だけで、端末の情報を含まない', async () => {
  const { app, r } = await enabled({ objects: [], people: [], emotions: [], metaphors: [] });
  await say(app, '予算を決める');
  const sent = r.calls.filter((c) => !c.path.startsWith('/api/llm/status'));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, '/api/llm/extract');
  assert.deepEqual(Object.keys(sent[0].body).sort(), ['drawStyle', 'input', 'instructions', 'partKeys', 'scene', 'text']); // Q-020 B
  assert.ok(sent[0].body.input.includes('予算を決める'));
  assert.ok(!/userAgent|navigator|session|audio/i.test(JSON.stringify({ input: sent[0].body.input })));
});

// NFR-PRIV-003 AC-359: 簡易マスキング（登録語・敬称付きの人名らしい語・メール・電話）。伏せ字は元に戻さない
test('NFR-PRIV-003 AC-359: 登録語・人名らしい語・メール・電話が伏せ字になる', () => {
  const t = maskText('山田さんと Acme の件。a.b@example.com / 03-1234-5678 / Mr. Smith', ['Acme']);
  assert.ok(!/山田|Acme|a\.b@|1234|Smith/.test(t), t);
  assert.ok(t.includes('●●●'));
});

// NFR-PRIV-003 AC-359 AC-360: 既定は有効で送信前に伏せられ、無効にすると伏せない。設定画面に注意書きがある
test('NFR-PRIV-003 AC-359 AC-360: 既定で簡易マスキングが有効、無効にできる、設定画面に注意書き', async () => {
  const { app, r } = await enabled({ objects: [], people: [], emotions: [], metaphors: [] });
  assert.equal(app.getLlmMasking(), true);
  await say(app, '田中さんに連絡');
  const first = r.calls.filter((c) => c.path === '/api/llm/extract')[0].body.input;
  assert.ok(!first.includes('田中'));
  app.setLlmMasking(false);
  assert.equal(app.getLlmMasking(), false);
  app.commands['settings.open']?.();
  const f = app.getSettingsDialog()?.fields.find((x) => x.id === 'llm.mask');
  assert.ok(f && /保証しません/.test(f.note));
});

// NFR-PRIV-003 AC-361: 送る文字数の上限（PARAM-070）を超える分は送らず、通知する
test('NFR-PRIV-003 AC-361: 上限を超えると切り詰めて通知する', async () => {
  assert.equal(MAX_SEND_CHARS, 2000);
  assert.equal(clampText('a'.repeat(2500)).text.length, 2000);
  assert.equal(clampText('abc').truncated, false);
  const { app, r } = await enabled({ objects: [], people: [], emotions: [], metaphors: [] });
  await say(app, 'あ'.repeat(2500));
  const body = r.calls.filter((c) => c.path === '/api/llm/extract')[0].body;
  assert.ok([...body.input].length <= 2000);
  assert.equal(app.getState().message?.key, 'llmdraw.truncated');
});

// NFR-PRIV-003 AC-362: 送った内容・抽出結果はセッションの保存に含まれない
test('NFR-PRIV-003 AC-362: 抽出結果と送信内容は保存領域に書かれない', async () => {
  const { app, env } = await enabled({ objects: [{ key: KEY }], people: [], emotions: [], metaphors: [] });
  await say(app, '秘密の予算');
  assert.ok(app.renderSvg().includes('data-llm-kind'));
  const dump = JSON.stringify(env.storage.dump());
  assert.ok(!dump.includes(KEY.length ? 'data-llm-kind' : '') && !dump.includes('instructions'));
});

// FR-063: 無効にすると絵は消え、失敗時はルールベース描画のまま
test('FR-063 AC-317: LLM 連携を無効にすると加わった絵が消える', async () => {
  const { app } = await enabled({ objects: [{ key: KEY }], people: [], emotions: [], metaphors: [] });
  await say(app, 'テスト');
  assert.ok(app.renderSvg().includes('data-llm-kind'));
  await app.disableLlm();
  assert.ok(!app.renderSvg().includes('data-llm-kind'));
});
