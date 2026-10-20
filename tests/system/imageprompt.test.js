// FR-078 AC-420〜AC-424・AC-468・AC-469（System Test。契約: tests/system/CONTRACT-FR077-078.md「画像生成プロンプトのコピー」「コピー前の注意と簡易マスキング」）
// 期待値は受入基準だけから決める（PARAM-011=6 全角、PARAM-082=2000 文字）。LLM 連携の中継はモック（実 Foundry は呼ばない）。
// コピーの操作は、注意（AC-468）でコピーを選んで初めてクリップボードに書き込む（AC-420）。
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
const masked = (app) => app.getImagePrompt({ mask: true });

// FR-078 AC-468: コピーの操作 → 注意 →（簡易マスキングの選択）→ コピー
async function copyVia(app, { mask } = {}) {
  const r0 = await app.commands['prompt.copy']();
  assert.equal(r0 && r0.pending, 'notice', 'コピーの前に注意が開く（AC-468）');
  assert.equal(app.getPromptCopyNotice().open, true);
  if (mask !== undefined) assert.equal(app.setPromptCopyMask(mask).ok, true);
  return app.confirmPromptCopy();
}
// 注意の中でキーボード（Tab）だけで操作に移る
function tabTo(app, id) {
  for (let i = 0; i < 8 && app.getPromptCopyNotice().active !== id; i++) app.handleKey({ key: 'Tab' });
  assert.equal(app.getPromptCopyNotice().active, id, `Tab で「${id}」に移れる`);
}

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

test('FR-078 AC-420: シーンがあるときボタンでコピーし注意でコピーを選ぶと、目的・配色・文字・イラスト・雰囲気・構成・内容の見出しを持つ文章がクリップボードに入り、メッセージで示される', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  app.setDrawStyle('anime');
  const r = await copyVia(app);
  assert.equal(r.ok, true);
  assert.equal(clipboard.writes.length, 1);
  const text = clipboard.writes[0];
  const pr = masked(app);
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

test('FR-078 AC-420: キーボードだけで（キーの割り当て・コマンドの検索と、注意の中の Tab・Enter）コピーできる', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  assert.equal(app.handleKey(keyFor(app, 'prompt.copy')), 'prompt.copy');
  await tick(); await tick();
  assert.equal(app.getPromptCopyNotice().open, true, '注意が開く');
  assert.equal(clipboard.writes.length, 0, '注意でコピーを選ぶまで書き込まない');
  tabTo(app, 'copy');
  assert.ok(app.handleKey({ key: 'Enter' }));
  await tick(); await tick();
  assert.equal(clipboard.writes.length, 1);
  assert.equal(clipboard.writes[0], masked(app).text);
  const label = app.getCommandBar().items.find((i) => i.command === 'prompt.copy').label;
  const hit = app.searchCommands(label).find((c) => c.command === 'prompt.copy');
  await app.commands[hit.command]();
  tabTo(app, 'copy');
  app.handleKey({ key: 'Enter' });
  await tick(); await tick();
  assert.equal(clipboard.writes.length, 2);
});

// FR-078 AC-421
test('FR-078 AC-421: 同じ図の内容・描画スタイル・型・簡易マスキングの適用の有無からは毎回同じ文章になる', async () => {
  const run = async (mask) => {
    const { app, env, clipboard } = await appWith();
    await seedThreeScenes(app, env);
    app.setDrawStyle('simple');
    app.setLayoutTypes(['diverge']);
    await copyVia(app, { mask });
    await copyVia(app, { mask });
    assert.equal(clipboard.writes[0], clipboard.writes[1], '同じアプリで 2 回');
    return clipboard.writes[0];
  };
  for (const mask of [true, false]) assert.equal(await run(mask), await run(mask), `別の起動でも同じ（適用 ${mask}）`);
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
  const r = await copyVia(app);
  assert.equal(r.ok, true); assert.equal(r.truncated, true);
  const pr = masked(app);
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
  const r = await copyVia(app);
  assert.equal(r.ok, true); assert.equal(r.truncated, false);
  const pr = masked(app);
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
  assert.equal(app.getPromptCopyNotice().open, false, 'シーンが 0 のときは注意を出さない（AC-468）');
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
    const r = await copyVia(app);
    assert.equal(r.ok, false); assert.equal(r.reason, 'clipboard');
    const fb = app.getPromptFallback();
    assert.ok(fb && fb.open === true, '文章が画面に表示される');
    assert.equal(fb.selectable, true);
    assert.equal(fb.text, masked(app).text, '注意で選んだ文章（簡易マスキングの適用の初期値）');
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
      await copyVia(app);
      app.handleKey(keyFor(app, 'prompt.copy')); await tick(); await tick();
      await app.confirmPromptCopy();
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
  await copyVia(app);
  const pr = masked(app);
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
  await copyVia(app);
  const off = clipboard.writes[0];
  assert.equal((await app.requestLlmEnable()).ok, true);
  await app.answerLlmConsent(true);
  assert.equal(app.getLlmState().enabled, true, '前提: LLM 連携が有効');
  const n = log.length;
  await copyVia(app);
  assert.equal(log.length, n, 'コピーで中継へ要求しない');
  assert.equal(clipboard.writes[1], off, 'LLM 連携の有効・無効で文章は変わらない');
  app.setDraft('次の議題に進みます'); assert.equal(app.submitDraft().ok, true);
  await app.flushLlm();
  const pr = app.getImagePrompt();
  const marks = [off, sec(pr, 'purpose').body, sec(pr, 'palette').body, sec(pr, 'mood').body, sec(pr, 'composition').body].map((s) => s.trim()).filter(Boolean);
  const sent = log.map((r) => JSON.stringify(r)).join('\n');
  for (const m of marks) assert.ok(!sent.includes(m), `LLM 連携の送信内容に含まれない: ${m.slice(0, 20)}`);
});

// ---------------------------------------------------------------- FR-078 AC-468（コピー前の注意。System）
// FR-078 AC-468
test('FR-078 AC-468: シーンがあるときコピーの操作をすると、書き込む前に注意（外部サービスへ渡ることの注意・簡易マスキングの選択（初期は適用）・コピー・取りやめ）が表示される', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  assert.equal(app.getPromptCopyNotice().open, false, '操作の前は注意がない');
  const r = await app.commands['prompt.copy']();
  assert.equal(r.ok, true); assert.equal(r.pending, 'notice');
  assert.equal(clipboard.writes.length, 0, 'クリップボードへ書き込む前に注意が出る');
  const n = app.getPromptCopyNotice();
  assert.equal(n.open, true);
  assert.ok(['dialog', 'alertdialog'].includes(n.role), `role: ${n.role}`);
  assert.equal(n.modal, true);
  assert.ok(n.label.trim(), '注意の名前');
  assert.ok(n.text.trim() && CJK.test(n.text), '会議の内容が含まれ外部サービスへ渡ることの注意（日本語）');
  assert.ok(['polite', 'assertive'].includes(n.live), '注意は読み上げ対象');
  assert.equal(n.focus, 'notice', 'フォーカスは注意の中');
  assert.equal(n.mask, true, '簡易マスキングの適用の初期値は「適用する」');
  const ctl = Object.fromEntries(n.controls.map((c) => [c.id, c]));
  assert.deepEqual(Object.keys(ctl).sort(), ['cancel', 'copy', 'mask']);
  assert.equal(ctl.mask.kind, 'checkbox'); assert.equal(ctl.mask.checked, true);
  for (const c of n.controls) assert.ok(c.label.trim(), `${c.id} の名前`);
  const done = await app.confirmPromptCopy();
  assert.equal(done.ok, true);
  assert.equal(clipboard.writes.length, 1, 'コピーを選ぶと書き込む');
  assert.equal(app.getPromptCopyNotice().open, false);
  assert.equal(app.getPromptCopyNotice().focus, 'button', 'フォーカスはコピーの操作のボタンに戻る');
  assert.equal(app.getState().message.key, 'prompt.copied');
});

test('FR-078 AC-468: 注意はキーボードだけで操作でき（Tab で移動・Space で適用の切り替え・Enter でコピー）、注意の外へフォーカスが出ない', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  app.handleKey(keyFor(app, 'prompt.copy')); await tick(); await tick();
  assert.equal(app.getPromptCopyNotice().open, true);
  const seen = new Set();
  for (let i = 0; i < 7; i++) { app.handleKey({ key: 'Tab' }); seen.add(app.getPromptCopyNotice().active); }
  for (let i = 0; i < 4; i++) { app.handleKey({ key: 'Tab', shiftKey: true }); seen.add(app.getPromptCopyNotice().active); }
  assert.deepEqual([...seen].sort(), ['cancel', 'copy', 'mask'], 'Tab・Shift+Tab は注意の中の操作だけを巡る');
  assert.equal(app.getPromptCopyNotice().open, true);
  tabTo(app, 'mask');
  assert.ok(app.handleKey({ key: ' ' }));
  assert.equal(app.getPromptCopyNotice().mask, false, 'Space で適用しないに切り替わる');
  app.handleKey({ key: ' ' });
  assert.equal(app.getPromptCopyNotice().mask, true, 'もう一度で適用するに戻る');
  tabTo(app, 'copy');
  app.handleKey({ key: 'Enter' }); await tick(); await tick();
  assert.equal(clipboard.writes.length, 1);
  assert.equal(app.getPromptCopyNotice().focus, 'button');
});

test('FR-078 AC-468 異常系: 取りやめ（Esc・取りやめの操作）では、クリップボードは変わらず、フォーカスはコピーのボタンに戻り、入力中の内容・選択中のオブジェクトは失われない', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  app.selectScene(app.getState().scenes[1].id);
  app.setDraft('入力中の文字');
  const before = keepOf(app);
  const cancelWays = [
    async () => { assert.equal(app.handleKey({ key: 'Escape' }), 'prompt.copy.cancel'); },
    async () => { tabTo(app, 'cancel'); assert.ok(app.handleKey({ key: 'Enter' })); },
    async () => { assert.equal(app.cancelPromptCopy().ok, true); },
  ];
  for (const [i, cancel] of cancelWays.entries()) {
    await app.commands['prompt.copy']();
    assert.equal(app.getPromptCopyNotice().open, true);
    await cancel(); await tick(); await tick();
    const n = app.getPromptCopyNotice();
    assert.equal(n.open, false, `取りやめ ${i}: 注意が閉じる`);
    assert.equal(n.focus, 'button', `取りやめ ${i}: フォーカスはコピーの操作のボタン`);
    assert.equal(clipboard.writes.length, 0, `取りやめ ${i}: クリップボードは変わらない`);
    assert.equal(app.getPromptFallback(), null);
    assert.equal(keepOf(app), before, `取りやめ ${i}: 入力中の内容・選択中のオブジェクトは失われない`);
  }
});

test('FR-078 AC-468: 注意は表示言語（日本語・英語）に従う', async () => {
  const { app, env } = await appWith();
  await seedThreeScenes(app, env);
  await app.commands['prompt.copy']();
  const ja = app.getPromptCopyNotice();
  app.cancelPromptCopy();
  app.setLang('en');
  await app.commands['prompt.copy']();
  const en = app.getPromptCopyNotice();
  for (const s of [en.label, en.text, ...en.controls.map((c) => c.label)]) assert.ok(s.trim() && !CJK.test(s), `英語: ${s}`);
  assert.notEqual(en.text, ja.text);
  assert.ok(CJK.test(ja.label + ja.text), '日本語の注意');
});

test('FR-078 AC-468 異常系: シーンが 0 のときは注意を出さずコピーされない。注意がないときのコピー・不正な適用の指定は何もしない', async () => {
  const { app, env, clipboard } = await appWith();
  app.commands['session.start']();
  app.setDraft('書きかけの発言');
  const r = await app.commands['prompt.copy']();
  assert.equal(r.ok, false); assert.equal(r.reason, 'empty');
  assert.equal(app.getPromptCopyNotice().open, false, 'シーンが 0 のときは注意を出さない');
  assert.ok(app.getState().message.text.trim());
  const c = await app.confirmPromptCopy();
  assert.equal(c.ok, false); assert.equal(c.reason, 'notice');
  assert.equal(clipboard.writes.length, 0);
  assert.equal(app.getState().input.draft, '書きかけの発言');
  await seedThreeScenes(app, env);
  await app.commands['prompt.copy']();
  for (const bad of ['true', 1, null, undefined, {}]) { let x; try { x = app.setPromptCopyMask(bad); } catch { x = { ok: false }; } assert.equal(x.ok, false, String(bad)); }
  assert.equal(app.getPromptCopyNotice().mask, true, '不正な指定では適用の選択は変わらない');
  await app.commands['prompt.copy']();
  assert.equal(clipboard.writes.length, 0, '注意の間にもう一度操作しても書き込まない');
  assert.equal(app.getPromptCopyNotice().open, true);
});

// ---------------------------------------------------------------- FR-078 AC-469（簡易マスキング。検証レベル integration の参考）
const SECRETS = ['極秘案件', '山田様', 'taro@example.com', '090-1234-5678'];
const count = (s, w) => String(s).split(w).length - 1;
function seedSecret(app, env) {
  app.setLlmMaskWords(['極秘案件']);
  app.commands['session.start']();
  for (const t of ['極秘案件の予算を山田様と相談する', '連絡先は taro@example.com と 090-1234-5678']) { app.setDraft(t); assert.equal(app.submitDraft().ok, true); env.tick(1); }
  app.commands['session.nextScene']();
  app.setDraft('来月のリリース計画を決める'); assert.equal(app.submitDraft().ok, true); env.tick(1);
}
const LLM_RELAY = (log) => async (req) => {
  log.push(req);
  if (String(req.path).startsWith('/api/llm/status')) return { status: 200, body: { configured: { endpoint: true, deployment: true, credential: true }, endpointHost: 'example.invalid' } };
  if (req.path === '/api/llm/extract') return { status: 200, body: { objects: [], people: [], emotions: [], metaphors: [] } };
  return { status: 404, body: {} };
};

// FR-078 AC-469
test('FR-078 AC-469: 簡易マスキングを適用してコピーすると、内容の部分の登録語・敬称付きの人名・メールアドレス・電話番号が伏せ字になり、注意に簡易で保証しない旨が示される', async () => {
  const { app, env, clipboard } = await appWith();
  seedSecret(app, env);
  const plain = app.getImagePrompt({ mask: false });
  for (const s of SECRETS) assert.ok(sec(plain, 'content').body.includes(s), `前提: 適用しない文章には「${s}」`);
  const r0 = await app.commands['prompt.copy']();
  assert.equal(r0.pending, 'notice');
  assert.match(app.getPromptCopyNotice().maskNote, /保証し(ない|ません)/, '検出は簡易で完全な除去は保証しない旨');
  const r = await app.confirmPromptCopy();
  assert.equal(r.ok, true);
  const text = clipboard.writes[0];
  for (const s of SECRETS) assert.ok(!text.includes(s), `「${s}」は伏せ字になる`);
  const m = masked(app);
  assert.equal(text, m.text);
  for (const k of KEYS.filter((x) => x !== 'content')) assert.equal(sec(m, k).body, sec(plain, k).body, `${k} は内容の部分ではないので変わらない`);
  for (const s of ['来月のリリース計画を決める', '連絡先は']) assert.ok(sec(m, 'content').body.includes(s), `伏せ字の対象でない「${s}」は残る`);
  app.setLang('en');
  await app.commands['prompt.copy']();
  assert.match(app.getPromptCopyNotice().maskNote, /not (be )?guarantee|no guarantee|cannot guarantee|does not guarantee/i, '英語でも保証しない旨');
});

test('FR-078 AC-469: 適用しないでコピーすると、伏せ字のない文章（コピーの文章の規則のまま）', async () => {
  const { app, env, clipboard } = await appWith();
  seedSecret(app, env);
  const r = await copyVia(app, { mask: false });
  assert.equal(r.ok, true);
  assert.equal(clipboard.writes[0], app.getImagePrompt().text);
  assert.equal(clipboard.writes[0], app.getImagePrompt({ mask: false }).text);
  for (const s of SECRETS) assert.ok(clipboard.writes[0].includes(s), `「${s}」はそのまま`);
});

test('FR-078 AC-469: 伏せ字は図・テキスト一覧・セッションファイルに反映されず、同じ内容・描画スタイル・型・適用の有無からは同じ文章になる', async () => {
  const run = async (mask) => {
    const { app, env, clipboard } = await appWith();
    seedSecret(app, env);
    const svg0 = app.renderSvg(); const outline0 = app.renderOutline(); const state0 = JSON.stringify(app.getState().scenes);
    await copyVia(app, { mask });
    assert.equal(app.renderSvg(), svg0, '図は変わらない');
    assert.equal(app.renderOutline(), outline0, 'テキスト一覧は変わらない');
    assert.equal(JSON.stringify(app.getState().scenes), state0, '要点は変わらない');
    assert.equal((await app.commands['file.save']()).ok, true);
    const data = env.downloads.at(-1).data;
    for (const s of ['極秘案件', '山田様']) assert.equal(count(data, s) > 0, count(outline0, s) > 0, `セッションファイルの「${s}」は伏せ字にならない`);
    await copyVia(app, { mask });
    assert.equal(clipboard.writes[0], clipboard.writes[1]);
    return clipboard.writes[0];
  };
  assert.equal(await run(true), await run(true), '適用するとき毎回同じ');
  assert.equal(await run(false), await run(false), '適用しないとき毎回同じ');
});

test('FR-078 AC-469 異常系: クリップボードが使えないときの画面の表示も選んだ文章で、切り詰めは伏せ字の後の文字で判定する', async () => {
  for (const mask of [true, false]) {
    const { app, env } = await appWith(null);
    seedSecret(app, env);
    const r = await copyVia(app, { mask });
    assert.equal(r.reason, 'clipboard');
    assert.equal(app.getPromptFallback().text, app.getImagePrompt({ mask }).text, `表示は選んだ文章（適用 ${mask}）`);
    for (const s of SECRETS) assert.equal(app.getPromptFallback().text.includes(s), !mask, `「${s}」`);
  }
  const { app, env, clipboard } = await appWith();
  app.setLlmMaskWords(['極秘案件']);
  app.commands['session.start']();
  const N = 100;
  for (let i = 0; i < N; i++) {
    const tag = `場面${String(i + 1).padStart(3, '0')}`;
    for (const t of [`${tag}の論点Aは極秘案件を山田様と確認`, `${tag}の論点Bは taro@example.com に送る`]) { app.setDraft(t); app.submitDraft(); env.tick(1); }
    if (i < N - 1) app.commands['session.nextScene']();
  }
  const r = await copyVia(app, { mask: true });
  assert.equal(r.ok, true); assert.equal(r.truncated, true);
  const pr = masked(app);
  assert.equal(clipboard.writes[0], pr.text);
  const content = sec(pr, 'content').body;
  assert.ok([...content].length <= MAX_CONTENT, `伏せ字の後の内容は ${[...content].length} 文字 ≤ 2000`);
  for (const s of SECRETS.slice(0, 3)) assert.ok(!content.includes(s), `「${s}」は伏せ字`);
  const has = Array.from({ length: N }, (_, i) => { const tag = `場面${String(i + 1).padStart(3, '0')}`; return [`${tag}の論点A`, `${tag}の論点B`].map((x) => content.includes(x)); });
  const k = has.findIndex((h) => !h.every(Boolean));
  assert.ok(k >= 1 && k < N, `先頭から ${k} シーンが入る`);
  for (let i = k; i < N; i++) assert.ok(has[i].every((x) => !x), `シーン ${i + 1} は入らない（シーンの区切りで切り詰め）`);
  assert.equal(app.getState().message.key, 'prompt.truncated');
});

test('FR-078 AC-469: LLM 連携の有効・無効と設定画面の簡易マスキングの設定によって、適用の初期値と結果は変わらない', async () => {
  const results = [];
  for (const [llm, setting] of [[false, true], [false, false], [true, true], [true, false]]) {
    const log = [];
    const { app, env, clipboard } = await appWith(undefined, { options: { relay: LLM_RELAY(log) } });
    if (llm) { assert.equal((await app.requestLlmEnable()).ok, true); await app.answerLlmConsent(true); assert.equal(app.getLlmState().enabled, true); }
    app.setLlmMasking(setting);
    seedSecret(app, env);
    await app.commands['prompt.copy']();
    assert.equal(app.getPromptCopyNotice().mask, true, `LLM ${llm}・設定 ${setting}: 初期値は適用する`);
    await app.confirmPromptCopy();
    results.push(clipboard.writes[0]);
  }
  for (const t of results) assert.equal(t, results[0], '結果は同じ');
  for (const s of SECRETS) assert.ok(!results[0].includes(s));
});
