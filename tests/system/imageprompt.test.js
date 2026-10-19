// FR-078 AC-420〜AC-424（System Test。契約: tests/system/CONTRACT-FR077-078.md「画像生成プロンプトのコピー」）
// 期待値は受入基準だけから決める（PARAM-011=6 全角、PARAM-082=2000 文字）。LLM 連携の中継はモック（実 Foundry は呼ばない）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, keyFor, CJK } from './helpers.js';

const OLD = ['handwritten', 'anime', 'simple', 'rpg'];
const MAX_CONTENT = 2000; // PARAM-082
const KEYS = ['purpose', 'palette', 'typography', 'illustration', 'mood', 'composition', 'content'];
const JA_HEAD = { purpose: '目的', palette: '配色', typography: '文字', illustration: 'イラスト', mood: '雰囲気', composition: '構成', content: '内容' };
const STYLE_KEYS = { palette: 'palette', typography: 'typography', illustration: 'drawing', mood: 'mood' };
const weight = (s) => [...s].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.5), 0);
const sec = (pr, key) => pr.sections.find((s) => s.key === key);
const labelOf = (app, id) => app.getDrawStyles().find((s) => s.id === id).label;
const typeLabel = (app, id) => app.getCommandBar().items.find((i) => i.command === `layoutType.${id}`).label;
const tick = () => new Promise((r) => setImmediate(r));
const keepOf = (app) => { const s = app.getState(); return JSON.stringify([s.utterances.map((u) => u.text), s.scenes, s.selectedSceneId, s.session, s.input.draft]); };

function makeClipboard(mode = 'ok') {
  const writes = [];
  return { writes, writeText: async (t) => { if (mode === 'deny') { const e = new Error('denied'); e.name = 'NotAllowedError'; throw e; } writes.push(String(t)); } };
}

async function appWith(clipboard = makeClipboard(), over = {}) {
  const r = await newApp({ ...over, options: { clipboard, ...(over.options || {}) } });
  return { ...r, clipboard };
}

// 各シーンの要点が一意になるように作る（40 文字以下＝1 要点。CONTRACT.md）
function seedScenes(app, env, nScenes, perScene, mk = (i, j) => `議題${i + 1}の論点${j + 1}を確認する`) {
  app.commands['session.start']();
  for (let i = 0; i < nScenes; i++) {
    for (let j = 0; j < perScene; j++) { app.setDraft(mk(i, j)); assert.equal(app.submitDraft().ok, true); env.tick(1); }
    if (i < nScenes - 1) app.commands['session.nextScene']();
  }
}

// 順に探して、すべて見つかるか（順序の確認）
function inOrder(text, list) {
  let pos = 0;
  for (const s of list) { const i = text.indexOf(s, pos); if (i < 0) return `「${s}」が順序どおりにない`; pos = i + s.length; }
  return null;
}

// FR-078 AC-420
test('FR-078 AC-420: コピーのボタン（ラベル 6 文字以内・ツールチップ付き）があり、キーの割り当てとコマンドの検索がある', async () => {
  const { app } = await appWith();
  const it = app.getCommandBar().items.find((i) => i.command === 'prompt.copy');
  assert.ok(it, 'prompt.copy のボタンがある');
  assert.ok(it.label.trim() && weight(it.label.trim()) <= 6, `ラベル「${it.label}」は 6 文字以内`);
  assert.equal(it.labelVisible, true);
  assert.equal(it.accessibleName, it.label);
  assert.ok(it.tooltip?.text?.trim());
  assert.equal(it.describedBy, it.tooltip.id);
  assert.equal(it.tabbable, true);
  assert.ok(keyFor(app, 'prompt.copy'), 'キーの割り当てがある');
  assert.ok(app.searchCommands(it.label).some((c) => c.command === 'prompt.copy'), 'コマンドの検索で見つかる');
});

test('FR-078 AC-420: シーンがあるときボタンでコピーすると、目的・配色・文字・イラスト・雰囲気・構成・内容の見出しを持つ文章がクリップボードに入り、メッセージで示される', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  app.setDrawStyle('anime');
  const r = await app.commands['prompt.copy']();
  assert.equal(r.ok, true);
  assert.equal(clipboard.writes.length, 1);
  const text = clipboard.writes[0];
  const pr = app.getImagePrompt();
  assert.equal(text, pr.text);
  assert.deepEqual(pr.sections.map((s) => s.key), KEYS);
  for (const s of pr.sections) {
    assert.ok(s.heading.includes(JA_HEAD[s.key]), `見出し「${s.heading}」に「${JA_HEAD[s.key]}」`);
    assert.ok(s.body.trim(), `${s.key} の本文がある`);
  }
  assert.equal(inOrder(text, pr.sections.flatMap((s) => [s.heading, s.body])), null, '見出しと本文がこの順に入る');
  assert.ok(app.getState().message.text.trim(), 'コピーしたことがメッセージで示される');
  assert.equal(app.getState().message.key, 'prompt.copied');
  assert.equal(app.getCommandBar().status.role, 'status');
});

test('FR-078 AC-420: 配色〜雰囲気は選んでいる描画スタイルの画風の記述、構成は選んでいる型の名称と説明、内容はトピック・見出し・要点（13 の描画スタイルすべて）', async () => {
  const { app, env } = await appWith();
  await seedThreeScenes(app, env);
  app.setLayoutTypes(['zone', 'bubble']);
  const all = app.getDrawStyles().map((s) => s.id);
  assert.equal(all.length, 13);
  const seen = new Set();
  for (const id of all) {
    assert.equal(app.setDrawStyle(id).ok, true, id);
    const d = app.getDrawStyleDescription(id);
    assert.ok(d, `${id}: 組み込みの描画スタイルは画風の記述を持つ`);
    for (const k of ['palette', 'drawing', 'typography', 'mood']) assert.ok(typeof d[k] === 'string' && d[k].trim(), `${id}: ${k}`);
    seen.add(JSON.stringify(d));
    const pr = app.getImagePrompt();
    for (const [sk, dk] of Object.entries(STYLE_KEYS)) assert.ok(sec(pr, sk).body.includes(d[dk]), `${id}: ${sk} に画風の記述の ${dk}`);
    const comp = sec(pr, 'composition');
    assert.deepEqual(comp.typeIds, app.getLayoutInfo().selected);
    const names = comp.typeIds.map((t) => typeLabel(app, t));
    assert.equal(inOrder(comp.body, names), null, `${id}: 構成に型の名称`);
    assert.ok(comp.body.length > names.join('').length, `${id}: 構成に型の説明もある`);
    const content = sec(pr, 'content').body;
    for (const t of app.getTopics()) assert.ok(content.includes(t.title), `トピック「${t.title}」`);
    for (const s of app.getState().scenes) { assert.ok(content.includes(s.heading)); for (const p of s.points) assert.ok(content.includes(p.text)); }
  }
  assert.equal(seen.size, 13, '画風の記述は描画スタイルごとに異なる');
  for (const id of OLD) assert.ok(all.includes(id));
});

test('FR-078 AC-420: キーボードだけで（キーの割り当て・コマンドの検索）コピーできる', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  assert.equal(app.handleKey(keyFor(app, 'prompt.copy')), 'prompt.copy');
  await tick(); await tick();
  assert.equal(clipboard.writes.length, 1);
  assert.equal(clipboard.writes[0], app.getImagePrompt().text);
  const label = app.getCommandBar().items.find((i) => i.command === 'prompt.copy').label;
  const hit = app.searchCommands(label).find((c) => c.command === 'prompt.copy');
  await app.commands[hit.command]();
  assert.equal(clipboard.writes.length, 2);
});

// FR-078 AC-421
test('FR-078 AC-421: 同じ図の内容・描画スタイル・型からは毎回同じ文章になる', async () => {
  const run = async () => {
    const { app, env, clipboard } = await appWith();
    await seedThreeScenes(app, env);
    app.setDrawStyle('simple');
    app.setLayoutTypes(['diverge']);
    await app.commands['prompt.copy']();
    await app.commands['prompt.copy']();
    assert.equal(clipboard.writes[0], clipboard.writes[1], '同じアプリで 2 回');
    return clipboard.writes[0];
  };
  assert.equal(await run(), await run(), '別の起動でも同じ');
});

test('FR-078 AC-421: 文章は表示言語（日本語・英語）で作られる', async () => {
  const { app, env } = await appWith();
  await seedThreeScenes(app, env);
  app.setDrawStyle('anime');
  const ja = app.getImagePrompt();
  app.setLang('en');
  const en = app.getImagePrompt();
  assert.deepEqual(en.sections.map((s) => s.key), KEYS);
  for (const s of en.sections) {
    assert.ok(s.heading.trim() && !CJK.test(s.heading), `英語の見出し "${s.heading}"`);
    assert.notEqual(s.heading, sec(ja, s.key).heading);
  }
  for (const k of ['purpose', 'palette', 'typography', 'illustration', 'mood', 'composition']) assert.ok(!CJK.test(sec(en, k).body), `${k} の本文が英語: ${sec(en, k).body}`);
  for (const s of app.getState().scenes) for (const p of s.points) assert.ok(sec(en, 'content').body.includes(p.text), '内容は入力した文字のまま');
  app.setLang('ja');
  assert.equal(app.getImagePrompt().text, ja.text);
});

test('FR-078 AC-421: 内容の順序はテキスト一覧と同じで、手修正した要点は修正後の文字で入る', async () => {
  const { app, env } = await appWith();
  seedScenes(app, env, 4, 2);
  const pts = app.getState().scenes.flatMap((s) => s.points);
  assert.equal(pts.length, 8, '前提: 要点 8 個');
  const target = pts[5];
  const NEW = '手で直した要点の文字';
  assert.equal(app.editPoint(target.id, NEW).ok, true);
  const order = app.getState().scenes.flatMap((s) => s.points.map((p) => p.text));
  assert.ok(order.includes(NEW));
  assert.equal(inOrder(app.renderOutline(), order), null, '前提: テキスト一覧の順序');
  const content = sec(app.getImagePrompt(), 'content').body;
  assert.equal(inOrder(content, order), null, '内容の順序はテキスト一覧と同じ');
  const elsewhere = app.getState().scenes.some((s) => s.heading.includes(target.text)) || app.getTopics().some((t) => t.title.includes(target.text));
  if (!elsewhere) assert.ok(!content.includes(target.text), '修正前の文字は入らない');
});

test('FR-078 AC-421 異常系: 画風の記述を持たない（後から登録された）描画スタイルでは、その名前だけが入る', async () => {
  const { app, env } = await appWith();
  await seedThreeScenes(app, env);
  const def = { id: 'test-nodesc', label: { ja: '試験の画風', en: 'Test look' }, line: { width: 1, jitter: 0 }, fill: { mode: 'paper' }, text: { decor: 'plain', icons: false } };
  assert.equal(app.registerDrawStyle(def).ok, true);
  assert.equal(app.setDrawStyle('test-nodesc').ok, true);
  assert.equal(app.getDrawStyleDescription('test-nodesc'), null);
  const pr = app.getImagePrompt();
  const bodies = Object.keys(STYLE_KEYS).map((k) => sec(pr, k).body.trim());
  assert.ok(bodies.every((b) => b === '' || b === '試験の画風'), `名前だけ: ${JSON.stringify(bodies)}`);
  assert.ok(bodies.includes('試験の画風'), '名前が入る');
  const other = app.getDrawStyleDescription('handwritten');
  for (const v of Object.values(other)) assert.ok(!pr.text.includes(v), 'ほかの描画スタイルの記述は入らない');
});

// FR-078 AC-422
test('FR-078 AC-422: 内容が 2000 文字を超えるときはシーンの区切りで切り詰め、文章の末尾とメッセージで示す', async () => {
  const { app, env, clipboard } = await appWith();
  const N = 60;
  seedScenes(app, env, N, 2, (i, j) => `場面${String(i + 1).padStart(2, '0')}の論点${j === 0 ? 'A' : 'B'}として予算と日程の関係を確認する`);
  const scenes = app.getState().scenes;
  assert.equal(scenes.length, N, '前提: 60 シーン');
  assert.ok(scenes.flatMap((s) => s.points.map((p) => p.text)).join('').length > MAX_CONTENT, '前提: 内容が 2000 文字を超える');
  const r = await app.commands['prompt.copy']();
  assert.equal(r.ok, true); assert.equal(r.truncated, true);
  const pr = app.getImagePrompt();
  assert.equal(pr.truncated, true);
  assert.equal(clipboard.writes[0], pr.text);
  const content = sec(pr, 'content').body;
  assert.ok([...content].length <= MAX_CONTENT, `内容は ${[...content].length} 文字 ≤ 2000`);
  const has = scenes.map((s) => s.points.map((p) => content.includes(p.text)));
  const k = has.findIndex((h) => !h.every(Boolean));
  assert.ok(k >= 1 && k < N, `先頭から ${k} シーンが入る`);
  for (let i = 0; i < k; i++) assert.ok(has[i].every(Boolean), `シーン ${i + 1} は全部入る`);
  for (let i = k; i < N; i++) assert.ok(has[i].every((x) => !x), `シーン ${i + 1} は入らない（途中で切らない）`);
  const note = app.t('prompt.truncatedNote');
  assert.ok(note.trim() && note !== 'prompt.truncatedNote');
  const lines = pr.text.trimEnd().split('\n');
  assert.ok(lines.at(-1).includes(note), '切り詰めたことを文章の末尾で示す');
  assert.equal(app.getState().message.key, 'prompt.truncated');
  assert.ok(app.getState().message.text.trim(), 'メッセージで示す');
});

test('FR-078 AC-422: 2000 文字以内のときは切り詰めず、切り詰めの表示もない', async () => {
  const { app, env } = await appWith();
  await seedThreeScenes(app, env);
  const r = await app.commands['prompt.copy']();
  assert.equal(r.ok, true); assert.equal(r.truncated, false);
  const pr = app.getImagePrompt();
  assert.equal(pr.truncated, false);
  assert.ok(!pr.text.includes(app.t('prompt.truncatedNote')));
  assert.equal(app.getState().message.key, 'prompt.copied');
});

// FR-078 AC-423
test('FR-078 AC-423 異常系: シーンが 0 のときはコピーされず、内容がないことが示され、入力中の内容は失われない', async () => {
  const { app, clipboard } = await appWith();
  app.commands['session.start']();
  app.setDraft('書きかけの発言');
  const r = await app.commands['prompt.copy']();
  assert.equal(r.ok, false); assert.equal(r.reason, 'empty');
  assert.equal(clipboard.writes.length, 0);
  assert.equal(app.getImagePrompt(), null);
  assert.equal(app.getPromptFallback(), null);
  assert.ok(app.getState().message.text.trim(), '内容がないことが示される');
  assert.equal(app.getState().input.draft, '書きかけの発言');
});

for (const [name, clip] of [['拒否された', () => makeClipboard('deny')], ['使えない（null）', () => null], ['使えない（writeText なし）', () => ({})]]) {
  test(`FR-078 AC-423 異常系: クリップボードへの書き込みが${name}ときは、文章が選択できる形で表示され、手でコピーできることが示される`, async () => {
    const { app, env } = await appWith(clip());
    await seedThreeScenes(app, env);
    app.selectScene(app.getState().scenes[1].id);
    app.setDraft('入力中の文字');
    const before = keepOf(app);
    const r = await app.commands['prompt.copy']();
    assert.equal(r.ok, false); assert.equal(r.reason, 'clipboard');
    const fb = app.getPromptFallback();
    assert.ok(fb && fb.open === true, '文章が画面に表示される');
    assert.equal(fb.selectable, true);
    assert.equal(fb.text, app.getImagePrompt().text);
    assert.ok(fb.label.trim());
    assert.ok(['dialog', 'region'].includes(fb.role));
    assert.ok(app.getState().message.text.trim(), '手でコピーできることが示される');
    assert.equal(keepOf(app), before, '入力中の内容・選択中のオブジェクトは失われない');
  });
}

// FR-078 AC-424
test('FR-078 AC-424: コピーの操作の間、外部へのリクエストは 0 件', async () => {
  const calls = [];
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
  const saved = {};
  for (const k of names) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: function (...a) { calls.push({ k, a }); throw new Error('network blocked'); } });
  }
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { ...(nav?.value || {}), sendBeacon: (...a) => { calls.push({ k: 'sendBeacon', a }); return false; } } });
  const relayLog = [];
  try {
    for (const clip of [makeClipboard(), makeClipboard('deny')]) {
      const { app, env } = await appWith(clip, { options: { relay: async (req) => { relayLog.push(req); return { status: 404, body: {} }; } } });
      await seedThreeScenes(app, env);
      const n = relayLog.length;
      await app.commands['prompt.copy']();
      app.handleKey(keyFor(app, 'prompt.copy')); await tick(); await tick();
      assert.equal(relayLog.length, n, 'コピーで中継へ要求しない');
    }
  } finally {
    for (const k of names) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
  }
  assert.deepEqual(calls.filter((c) => !String(c.a[0] ?? '').startsWith('/')), [], '同一オリジン以外へのリクエストは 0 件');
});

test('FR-078 AC-424: 文章はセッションファイル・ブラウザ内の保存に含まれない', async () => {
  const { app, env } = await appWith();
  await seedThreeScenes(app, env);
  app.setDrawStyle('anime');
  await app.commands['prompt.copy']();
  const pr = app.getImagePrompt();
  const marks = [pr.text, sec(pr, 'purpose').body, sec(pr, 'palette').body, sec(pr, 'mood').body].map((s) => s.trim()).filter(Boolean);
  for (const [k, v] of env.storage.dump()) for (const m of marks) assert.ok(!String(v).includes(m), `${k} に文章が含まれない`);
  assert.equal((await app.commands['file.save']()).ok, true);
  const data = env.downloads.at(-1).data;
  for (const m of marks) assert.ok(!data.includes(m), 'セッションファイルに文章が含まれない');
});

test('FR-078 AC-424: 文章は LLM 連携の送信内容に含まれず、LLM 連携の有効・無効によって変わらない', async () => {
  const log = [];
  const relay = async (req) => {
    log.push(req);
    if (String(req.path).startsWith('/api/llm/status')) return { status: 200, body: { configured: { endpoint: true, deployment: true, credential: true }, endpointHost: 'example.invalid' } };
    if (req.path === '/api/llm/extract') return { status: 200, body: { objects: [], people: [], emotions: [], metaphors: [] } };
    return { status: 404, body: {} };
  };
  const { app, env, clipboard } = await appWith(makeClipboard(), { options: { relay } });
  await seedThreeScenes(app, env);
  app.setDrawStyle('anime');
  await app.commands['prompt.copy']();
  const off = clipboard.writes[0];
  assert.equal((await app.requestLlmEnable()).ok, true);
  await app.answerLlmConsent(true);
  assert.equal(app.getLlmState().enabled, true, '前提: LLM 連携が有効');
  const n = log.length;
  await app.commands['prompt.copy']();
  assert.equal(log.length, n, 'コピーで中継へ要求しない');
  assert.equal(clipboard.writes[1], off, 'LLM 連携の有効・無効で文章は変わらない');
  app.setDraft('次の議題に進みます'); assert.equal(app.submitDraft().ok, true);
  await app.flushLlm();
  const pr = app.getImagePrompt();
  const marks = [off, sec(pr, 'purpose').body, sec(pr, 'palette').body, sec(pr, 'mood').body, sec(pr, 'composition').body].map((s) => s.trim()).filter(Boolean);
  const sent = log.map((r) => JSON.stringify(r)).join('\n');
  for (const m of marks) assert.ok(!sent.includes(m), `LLM 連携の送信内容に含まれない: ${m.slice(0, 20)}`);
});
