// FR-065 AC-330〜333 / NFR-SEC-004 AC-335 AC-336 AC-337 AC-338 AC-365 の単体・結合テスト（web/src/svgsanitize.js、llmdraw.js、session.js）。
// 実 Foundry は呼ばず、中継サーバーはモック。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { sanitizeSvg, acceptGeneratedSvg, MAX_GENERATED_SVG_BYTES } from '../../web/src/svgsanitize.js';
import { getPartKeys, getPartSvg, isAllowedPartSvg } from '../../web/src/parts.js';
import { parseSessionFile } from '../../web/src/session.js';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const FORBIDDEN = /<script|foreignobject|\son\w+\s*=|javascript:|https?:|\/\/|url\(|@import|<image|<style|<use|<a[\s>]/i;
const evil = [
  `<svg ${NS}><script>alert(1)</script><circle r="1"/></svg>`,
  `<svg ${NS}><SCRIPT>alert(1)</SCRIPT><circle r="1"/></svg>`,
  `<svg ${NS}><foreignObject><div onclick="x()"/></foreignObject></svg>`,
  `<svg ${NS} onload="x()"><circle r="1" onclick="y()" ONMOUSEOVER="z()"/></svg>`,
  `<svg ${NS}><a href="javascript:alert(1)"><circle r="1"/></a></svg>`,
  `<svg ${NS}><a xlink:href="https://e.example/x"><circle r="1"/></a></svg>`,
  `<svg ${NS}><image href="http://e.example/x.png"/><image href="//e.example/x.png"/></svg>`,
  `<svg ${NS}><rect width="1" fill="url(http://e.example/x)" style="fill:url(//e.example)"/></svg>`,
  `<svg ${NS}><style>@import url(http://e.example/a.css);</style><circle r="1"/></svg>`,
  `<svg ${NS}><circle r="1" fill="&#106;avascript:alert(1)"/></svg>`,
  `<svg ${NS}><circle r="1" fill="java&#x73;cript:alert(1)"/></svg>`,
  `<svg ${NS}><text>&lt;script&gt;x&lt;/script&gt;<![CDATA[<script>]]></text></svg>`,
  `<svg ${NS}><scr<script>ipt>alert(1)</scr</script>ipt><circle r="1"/></svg>`,
  `<svg ${NS}><g><g><script><svg><script>x</script></svg></script></g></g></svg>`,
  `<svg ${NS}><use href="#a"/><use href="http://e.example/s.svg#a"/></svg>`,
  `<svg ${NS}><circle r="1" fill="jav\tascript:x"/></svg>`,
];

// NFR-SEC-004 AC-335 AC-336
test('NFR-SEC-004 AC-335 AC-336 悪意のある SVG の集合は禁止項目 0 件になる（大文字小文字・文字参照・入れ子の回避を含む）', () => {
  for (const dirty of evil) {
    const out = sanitizeSvg(dirty)?.replace(NS, "");
    if (out == null) continue; // 拒否も可
    assert.ok(!FORBIDDEN.test(out), `禁止項目が残った: ${dirty} → ${out}`);
    assert.ok(!/[<][^>]*&#/.test(out));
  }
});

test('NFR-SEC-004 AC-336 解析できない入力・DOCTYPE・処理命令・複数の根は拒否される', () => {
  for (const bad of ['', 'abc', '<svg', `<svg ${NS}><circle></svg>`, `<!DOCTYPE svg><svg ${NS}/>`, `<?xml version="1.0"?><svg ${NS}/>`,
    `<svg ${NS}/><svg ${NS}/>`, `<div/>`, `<svg ${NS}><g></svg>`, null, 5]) assert.equal(sanitizeSvg(bad), null, String(bad));
});

// NFR-SEC-004 AC-338
test('NFR-SEC-004 AC-338 同梱部品は意味を変えずに通り、2 回かけても変わらない（冪等）', () => {
  for (const key of getPartKeys()) {
    const svg = getPartSvg(key);
    const once = sanitizeSvg(svg);
    assert.ok(once, key);
    assert.ok(isAllowedPartSvg(once), `許可リストと整合: ${key}`);
    assert.equal(sanitizeSvg(once), once, `冪等: ${key}`);
    const count = (s) => (s.match(/<(?!\/)[a-z]+/g) ?? []).length;
    assert.equal(count(once), count(svg), `要素の数が同じ: ${key}`);
  }
  const dirty = sanitizeSvg(evil[3]);
  assert.equal(sanitizeSvg(dirty), dirty);
});

// FR-065 AC-332
test('FR-065 AC-332 {PARAM-072} バイトを超える SVG と許可リストを満たせない SVG は受け入れない', () => {
  const big = `<svg ${NS}><path d="${'M0 0L1 1'.repeat(MAX_GENERATED_SVG_BYTES)}"/></svg>`;
  assert.equal(acceptGeneratedSvg(big), null);
  assert.equal(acceptGeneratedSvg(`<svg ${NS}><circle r="1"/></svg>`) !== null, true);
  assert.equal(acceptGeneratedSvg('<svg><circle></svg>'), null);
});

const CONF = { configured: { endpoint: true, deployment: true, credential: true }, endpointHost: 'example.invalid' };
function relay({ svg }) {
  const calls = [];
  const fn = async ({ method = 'GET', path, body }) => {
    calls.push({ method, path, body });
    if (path.startsWith('/api/llm/status')) return { status: 200, body: CONF };
    if (path === '/api/llm/extract') return { status: 200, body: { objects: [{ key: getPartKeys()[0] }, { key: 'x-none', label: '未収載の物' }], people: [], emotions: [], metaphors: [] } };
    if (path === '/api/llm/svg') return { status: 200, body: { svg } };
    return { status: 404, body: {} };
  };
  return { fn, calls };
}
async function run(svg, { on = true, download } = {}) {
  const r = relay({ svg });
  const ctx = await newApp({ options: { relay: r.fn, ...(download ? { download } : {}) } });
  await ctx.app.requestLlmEnable(); await ctx.app.answerLlmConsent(true);
  ctx.app.commands['session.start']();
  if (on) ctx.app.setLlmSvgGeneration(true);
  ctx.app.setDraft('会議室の未収載の物を片付ける'); ctx.app.submitDraft();
  await ctx.app.flushLlm();
  return { ...ctx, r };
}
const svgReqs = (r) => r.calls.filter((c) => c.path === '/api/llm/svg');

// FR-065 AC-331 NFR-SEC-004 AC-337（中継サーバーのサニタイズを回避した SVG でもアプリ側で除去される）
test('FR-065 AC-331 AC-333 NFR-SEC-004 AC-337 同梱部品がない物体だけ生成を求め、サニタイズ後の SVG が図・PNG・PDF 用の絵に入る', async () => {
  const { app, r } = await run(`<svg ${NS} viewBox="0 0 10 10" onload="x()"><script>x</script><circle cx="5" cy="5" r="4" fill="#c00"/><image href="http://e.example/a.png"/></svg>`);
  assert.equal(svgReqs(r).length, 1, '同梱部品がある物体では求めない');
  assert.equal(svgReqs(r)[0].body.label, '未収載の物');
  const svg = app.renderSvg();
  assert.ok(svg.includes('data-llm-kind="generated"') && svg.includes('<circle cx="5"'));
  assert.ok(!FORBIDDEN.test(svg.replace(NS, '').replace('http://www.w3.org/2000/svg', '')), '図に禁止項目がない');
  const items = app.getLlmDrawItems();
  assert.ok(items.some((i) => i.label === '未収載の物' && i.svg.includes('<circle')));
  assert.ok(items.every((i) => !FORBIDDEN.test(i.svg.replace('http://www.w3.org/2000/svg', ''))));
});

// FR-065 AC-330
test('FR-065 AC-330 方式2 がオフなら生成要求は 0 件', async () => {
  const { r } = await run(`<svg ${NS}><circle r="1"/></svg>`, { on: false });
  assert.equal(svgReqs(r).length, 0);
  assert.ok(r.calls.every((c) => !(c.body && c.body.allowSvg === true)));
});

// FR-065 AC-332
test('FR-065 AC-332 解析できない・上限超過の SVG は汎用のアイコンに置き換え、失敗を短く通知する', async () => {
  for (const bad of ['<svg><circle></svg>', `<svg ${NS}><path d="${'M0 0'.repeat(10000)}"/></svg>`]) {
    const { app } = await run(bad);
    const svg = app.renderSvg();
    assert.ok(svg.includes('data-llm-kind="generated"') && svg.includes('>?</text>'), '汎用アイコン');
    assert.ok(app.getState().message?.key === 'llmdraw.svgFailed' || JSON.stringify(app.getState().message ?? '').includes('svgFailed'));
  }
});

// FR-065 AC-334 NFR-SEC-004 AC-365
test('FR-065 AC-334 NFR-SEC-004 AC-365 生成 SVG はセッションファイルに保存され、読込時に再サニタイズして LLM なしで再描画される', async () => {
  let saved = null;
  const { app } = await run(`<svg ${NS} viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>`, { download: async (f) => { saved = f; } });
  await app.commands['file.save']();
  const file = JSON.parse(saved.data);
  assert.equal(file.generatedSvgs.length, 1);
  assert.ok(!FORBIDDEN.test(file.generatedSvgs[0].svg.replace(NS, '')), '保存物は禁止項目がない');
  // 改変されたファイル: 禁止項目つきと解析できない SVG を加える
  file.generatedSvgs.push({ sceneId: file.generatedSvgs[0].sceneId, label: '改変', svg: `<svg ${NS} onload="x()"><script>x</script><circle r="2" onclick="y()"/></svg>` });
  file.generatedSvgs.push({ sceneId: file.generatedSvgs[0].sceneId, label: '不正', svg: '<svg><circle></svg>' });
  const text = JSON.stringify(file);
  const r = parseSessionFile({ name: 'a.json', type: 'application/json', size: text.length, text });
  assert.equal(r.session.generatedSvgs.length, 2, '解析できないものは捨てる');
  for (const g of r.session.generatedSvgs) assert.ok(!FORBIDDEN.test(g.svg.replace(NS, '')), '読込時に再サニタイズ');
  // 別のアプリ（LLM 連携なし）で読み込むと同じ絵が描かれる
  const fresh = await newApp();
  assert.equal(fresh.app.getLlmState().enabled, false);
  const res = await fresh.app.loadSessionFile({ name: 'a.json', type: 'application/json', size: text.length, text });
  assert.equal(res.ok, true);
  const out = fresh.app.renderSvg();
  assert.ok(out.includes('data-llm-kind="generated"') && out.includes('<circle cx="5"'));
  assert.ok(!FORBIDDEN.test(out.replace(/xmlns="[^"]*"/g, '')));
});