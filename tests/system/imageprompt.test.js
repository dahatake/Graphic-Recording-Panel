// FR-078 AC-420〜AC-424・AC-470〜AC-474（System Test。契約: tests/system/CONTRACT-FR077-078.md「画像生成プロンプトのコピー」「コピーの前の注意」）
// 期待値は受入基準だけから決める（PARAM-011=6 全角、PARAM-082=2000 文字）。LLM 連携の中継はモック（実 Foundry は呼ばない）。
// Q-027 A（run 202610201309）: コピーの操作は先に注意を開き、注意で「コピー」を選んだときだけクリップボードへ書き込む。
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

// コピーの操作で注意（AC-470）を開き、「コピー」を選ぶ。mask は注意の伏せ字の選択（省略時は初期値のまま）
async function copyVia(app, { mask } = {}) {
  const o = await app.commands['prompt.copy']();
  if (!o || o.ok !== true || o.pending !== true) return o;
  assert.ok(app.getPromptNotice()?.open, '注意が開く');
  if (mask !== undefined) app.setPromptNoticeMask(mask);
  return app.promptNoticeAction('copy');
}

// 注意の中で Tab を押して target にフォーカスを移す（キーボードだけの操作）
function tabTo(app, target) {
  for (let i = 0; i < 6 && app.getFocus() !== target; i++) app.handleKey({ key: 'Tab' });
  assert.equal(app.getFocus(), target, `Tab で ${target} へ移れる`);
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

test('FR-078 AC-420: シーンがあるときボタンでコピーの操作をし、注意で「コピー」を選ぶと、目的・配色・文字・イラスト・雰囲気・構成・内容の見出しを持つ文章がクリップボードに入り、メッセージで示される', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  app.setDrawStyle('anime');
  const o = await app.commands['prompt.copy']();
  assert.equal(o.ok, true); assert.equal(o.pending, true, 'まず注意（AC-470）が開く');
  assert.equal(clipboard.writes.length, 0, '注意で「コピー」を選ぶまで書き込まない');
  const r = await app.promptNoticeAction('copy');
  assert.equal(r.ok, true);
  assert.equal(clipboard.writes.length, 1);
  const text = clipboard.writes[0];
  const pr = app.getImagePrompt({ mask: r.masked });
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

test('FR-078 AC-420: キーボードだけで（キーの割り当て・コマンドの検索 → 注意の「コピー」を Tab と Enter で）コピーできる', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  assert.equal(app.handleKey(keyFor(app, 'prompt.copy')), 'prompt.copy');
  assert.ok(app.getPromptNotice()?.open, '注意が開く');
  assert.equal(clipboard.writes.length, 0);
  const masked = app.getPromptNotice().mask.checked;
  tabTo(app, 'notice:copy');
  assert.ok(app.handleKey({ key: 'Enter' }));
  await tick(); await tick();
  assert.equal(clipboard.writes.length, 1);
  assert.equal(clipboard.writes[0], app.getImagePrompt({ mask: masked }).text);
  assert.equal(app.getPromptNotice(), null, 'コピーすると注意は閉じる');
  const label = app.getCommandBar().items.find((i) => i.command === 'prompt.copy').label;
  const hit = app.searchCommands(label).find((c) => c.command === 'prompt.copy');
  assert.equal((await app.commands[hit.command]()).pending, true);
  tabTo(app, 'notice:copy');
  app.handleKey({ key: 'Enter' });
  await tick(); await tick();
  assert.equal(clipboard.writes.length, 2);
});

test('FR-078 AC-420 異常系: 注意で「コピー」を選ばずに閉じたときはクリップボードに入らず、コピーしたことのメッセージも出ない', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  assert.equal((await app.commands['prompt.copy']()).pending, true);
  await app.promptNoticeAction('cancel');
  assert.equal(clipboard.writes.length, 0);
  assert.ok(!['prompt.copied', 'prompt.truncated'].includes(app.getState().message?.key));
  assert.equal((await app.promptNoticeAction('copy')).ok, false, '閉じた後に「コピー」を呼んでも書き込まない');
  assert.equal(clipboard.writes.length, 0);
});

// FR-078 AC-421
test('FR-078 AC-421: 同じ図の内容・描画スタイル・型からは毎回同じ文章になる', async () => {
  const run = async () => {
    const { app, env, clipboard } = await appWith();
    await seedThreeScenes(app, env);
    app.setDrawStyle('simple');
    app.setLayoutTypes(['diverge']);
    await copyVia(app, { mask: false });
    await copyVia(app, { mask: false });
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
  const r = await copyVia(app, { mask: false });
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
  const r = await copyVia(app, { mask: false });
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
  assert.equal(app.getPromptNotice(), null, 'シーン 0 では注意を開かない');
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
    const r = await copyVia(app, { mask: false });
    assert.equal(r.ok, false); assert.equal(r.reason, 'clipboard');
    const fb = app.getPromptFallback();
    assert.ok(fb && fb.open === true, '文章が画面に表示される');
    assert.equal(fb.selectable, true);
    assert.equal(fb.text, app.getImagePrompt({ mask: false }).text);
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
      await copyVia(app, { mask: false });
      app.handleKey(keyFor(app, 'prompt.copy')); await app.promptNoticeAction('copy'); await tick(); await tick();
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
  await copyVia(app, { mask: false });
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
  await copyVia(app, { mask: false });
  const off = clipboard.writes[0];
  assert.equal((await app.requestLlmEnable()).ok, true);
  await app.answerLlmConsent(true);
  assert.equal(app.getLlmState().enabled, true, '前提: LLM 連携が有効');
  const n = log.length;
  await copyVia(app, { mask: false });
  assert.equal(log.length, n, 'コピーで中継へ要求しない');
  assert.equal(clipboard.writes[1], off, 'LLM 連携の有効・無効で文章は変わらない');
  app.setDraft('次の議題に進みます'); assert.equal(app.submitDraft().ok, true);
  await app.flushLlm();
  const pr = app.getImagePrompt();
  const marks = [off, sec(pr, 'purpose').body, sec(pr, 'palette').body, sec(pr, 'mood').body, sec(pr, 'composition').body].map((s) => s.trim()).filter(Boolean);
  const sent = log.map((r) => JSON.stringify(r)).join('\n');
  for (const m of marks) assert.ok(!sent.includes(m), `LLM 連携の送信内容に含まれない: ${m.slice(0, 20)}`);
});

// ---------------------------------------------------------------- コピーの前の注意（Q-027 A）
const STMT = ['content', 'external', 'local', 'maskLimit'];
const KW = {
  ja: { content: [/(トピック|見出し|要点|図の内容)/, /(人名|名前|連絡先|個人)/], external: [/外部/], local: [/(送信|保存)/, /(しない|しません|せず)/], maskLimit: [/保証/] },
  en: { content: [/(topic|heading|point|diagram)/i, /(name|contact|personal)/i], external: [/(external|third[- ]party)/i], local: [/(send|save|store)/i, /(not|never|n't)/i], maskLimit: [/guarantee/i] },
};
const noticeTexts = (n) => [n.label, n.description, ...n.statements.map((s) => s.text), n.mask.label, ...n.buttons.map((b) => b.label)];

// 注意の形（AC-470・471・473）を確かめる。lang は表示言語
function assertNotice(n, lang) {
  assert.ok(n && n.open === true, '注意が開いている');
  assert.equal(n.role, 'dialog', '支援技術にダイアログとして伝わる');
  assert.equal(n.modal, true);
  assert.ok(String(n.label ?? '').trim(), '注意の名前');
  assert.ok(String(n.description ?? '').trim(), '注意の説明（注意の文）');
  for (const k of STMT) {
    const s = n.statements.find((x) => x.key === k);
    assert.ok(s && String(s.text).trim(), `注意の文 ${k} がある`);
    assert.ok(n.description.includes(s.text), `説明に ${k} の文が入る`);
    for (const re of KW[lang][k]) assert.match(s.text, re, `${lang} ${k}: ${s.text}`);
  }
  assert.ok(['checkbox', 'switch'].includes(n.mask.role), '伏せ字の選択はチェックボックスかスイッチ');
  assert.ok(String(n.mask.label ?? '').trim(), '伏せ字の選択の名前');
  assert.equal(typeof n.mask.checked, 'boolean', '伏せ字の選択の状態');
  assert.deepEqual(n.buttons.map((b) => b.id).sort(), ['cancel', 'copy'], '「コピー」「キャンセル」の 2 つ');
  for (const b of n.buttons) assert.ok(String(b.label).trim());
  assert.notEqual(n.buttons[0].label, n.buttons[1].label);
  const texts = noticeTexts(n);
  if (lang === 'en') for (const t of texts) assert.ok(!CJK.test(t), `英語: ${t}`);
  else for (const t of [n.label, n.description, n.mask.label, ...n.buttons.map((b) => b.label)]) assert.ok(CJK.test(t), `日本語: ${t}`);
}

// 外部へのリクエストを記録する（AC-474。同一オリジン（'/' で始まる）以外は 0 件であること）
async function withNetSpy(fn) {
  const calls = []; const saved = {};
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
  for (const k of names) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: function (...a) { calls.push({ k, a }); throw new Error('network blocked'); } });
  }
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { ...(nav?.value || {}), sendBeacon: (...a) => { calls.push({ k: 'sendBeacon', a }); return false; } } });
  try { await fn(); } finally {
    for (const k of names) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
  }
  return calls.filter((c) => !String(c.a[0] ?? '').startsWith('/'));
}

// 伏せ字の対象（AC-359 と同じ種類。合成データ）。「」で囲み、末尾の語で見分ける
const TARGETS = [
  { k: 'word', t: '極秘案件', suf: '甲' },
  { k: 'name', t: '山田様', suf: '乙' },
  { k: 'email', t: 'taro@example.com', suf: '丙' },
  { k: 'phone', t: '090-1234-5678', suf: '丁' },
];
const MASK_WORDS = ['極秘案件'];
const wrapT = (x) => `「${x.t}」について${x.suf}`;
function seedTargets(app, env) {
  app.commands['session.start']();
  TARGETS.forEach((x, i) => { app.setDraft(wrapT(x)); assert.equal(app.submitDraft().ok, true); env.tick(1); if (i === 1) app.commands['session.nextScene'](); });
}

// LLM 連携の送信（AC-359）で使われる伏せ字を、対象ごとに観察する（中継はモック）
async function llmPlaceholders() {
  const calls = [];
  const relay = async (req) => {
    calls.push(req);
    if (String(req.path).startsWith('/api/llm/status')) return { status: 200, body: { configured: { endpoint: true, deployment: true, credential: true }, endpointHost: 'example.invalid' } };
    if (req.path === '/api/llm/extract') return { status: 200, body: { objects: [], people: [], emotions: [], metaphors: [] } };
    return { status: 404, body: {} };
  };
  const { app, env } = await newApp({ options: { relay } });
  assert.equal((await app.requestLlmEnable()).ok, true);
  await app.answerLlmConsent(true);
  assert.equal(app.getLlmMasking(), true, '前提: 簡易マスキングは有効');
  app.setLlmMaskWords(MASK_WORDS);
  seedTargets(app, env);
  await app.flushLlm();
  const sent = calls.filter((c) => c.path === '/api/llm/extract').map((c) => String(c.body?.input ?? '')).join('\n');
  const ph = {};
  for (const x of TARGETS) {
    const m = sent.match(new RegExp(`「([^」]*)」について${x.suf}`));
    assert.ok(m, `前提: ${x.k} の要点が LLM へ送られる`);
    assert.ok(m[1].length > 0 && !m[1].includes(x.t), `前提: ${x.k} は AC-359 で伏せ字になる（${m[1]}）`);
    ph[x.k] = m[1];
  }
  return ph;
}

// FR-078 AC-470
test('FR-078 AC-470: コピーの操作をすると、クリップボードへ書き込む前に、図の内容が入る・外部サービスへ渡る・アプリは送信も保存もしないことを示す注意が開き、「コピー」を選ぶまで書き換えられない', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  const o = await app.commands['prompt.copy']();
  assert.equal(o.ok, true); assert.equal(o.pending, true);
  assertNotice(app.getPromptNotice(), 'ja');
  assert.equal(clipboard.writes.length, 0, '注意が開いた時点では書き込まない');
  // 「コピー」以外の操作では書き込まない
  const c0 = app.getPromptNotice().mask.checked;
  app.setPromptNoticeMask(!c0); app.setPromptNoticeMask(c0);
  for (let i = 0; i < 3; i++) app.handleKey({ key: 'Tab' });
  assert.equal((await app.commands['prompt.copy']()).pending, true, '開いている間にもう一度操作しても開いたまま');
  await tick(); await tick();
  assert.equal(clipboard.writes.length, 0, '「コピー」を選ぶまでクリップボードは書き換えられない');
  const r = await app.promptNoticeAction('copy');
  assert.equal(r.ok, true);
  assert.equal(clipboard.writes.length, 1, '「コピー」で 1 回書き込む');
  assert.equal(app.getPromptNotice(), null);
});

test('FR-078 AC-470: 注意はコピーの操作のたびに（ボタン・キーの割り当て・コマンドの検索のどれでも）表示される', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  assert.equal((await copyVia(app)).ok, true);
  assert.equal(clipboard.writes.length, 1);
  assert.equal((await app.commands['prompt.copy']()).pending, true, '2 回目も注意が開く');
  assertNotice(app.getPromptNotice(), 'ja');
  await app.promptNoticeAction('cancel');
  assert.equal(app.handleKey(keyFor(app, 'prompt.copy')), 'prompt.copy');
  assertNotice(app.getPromptNotice(), 'ja');
  await app.promptNoticeAction('copy');
  assert.equal(clipboard.writes.length, 2);
  const label = app.getCommandBar().items.find((i) => i.command === 'prompt.copy').label;
  const hit = app.searchCommands(label).find((c) => c.command === 'prompt.copy');
  assert.equal((await app.commands[hit.command]()).pending, true);
  assertNotice(app.getPromptNotice(), 'ja');
  assert.equal(clipboard.writes.length, 2, '注意が開いただけでは書き込まない');
});

test('FR-078 AC-470: 注意の文言・選択の名前・ボタンの名前は表示言語に従い、表示言語を切り替えた後に開いた注意は切り替えた言語で示される', async () => {
  const { app, env } = await appWith();
  await seedThreeScenes(app, env);
  app.setLang('ja');
  await app.commands['prompt.copy']();
  const ja = app.getPromptNotice();
  assertNotice(ja, 'ja');
  await app.promptNoticeAction('cancel');
  app.setLang('en');
  await app.commands['prompt.copy']();
  const en = app.getPromptNotice();
  assertNotice(en, 'en');
  assert.notEqual(en.label, ja.label);
  assert.notEqual(en.mask.label, ja.mask.label);
  for (const id of ['copy', 'cancel']) assert.notEqual(en.buttons.find((b) => b.id === id).label, ja.buttons.find((b) => b.id === id).label, `${id} のボタン`);
  app.handleKey({ key: 'Escape' });
  app.setLang('ja');
  await app.commands['prompt.copy']();
  assertNotice(app.getPromptNotice(), 'ja');
  assert.equal(app.getPromptNotice().label, ja.label, '日本語に戻すと日本語の注意');
});

test('FR-078 AC-470 異常系: クリップボードへの書き込みが拒否されるときも、注意で「コピー」を選ぶまでは何も起きず、選んだ後に文章が手でコピーできる形で示される', async () => {
  const { app, env } = await appWith(makeClipboard('deny'));
  await seedThreeScenes(app, env);
  assert.equal((await app.commands['prompt.copy']()).pending, true);
  assert.equal(app.getPromptFallback(), null, '注意の間は代わりの表示も出ない');
  const masked = app.getPromptNotice().mask.checked;
  const r = await app.promptNoticeAction('copy');
  assert.equal(r.ok, false); assert.equal(r.reason, 'clipboard');
  const fb = app.getPromptFallback();
  assert.ok(fb && fb.open && fb.selectable);
  assert.equal(fb.text, app.getImagePrompt({ mask: masked }).text);
  assert.equal(app.getPromptNotice(), null);
});

// FR-078 AC-471
test('FR-078 AC-471: 伏せ字の適用を選んでコピーすると、内容の部分の登録した語・敬称付きの人名・メールアドレス・電話番号が AC-359 と同じ伏せ字になり、ほかの部分は伏せ字なしと同じ', async () => {
  const ph = await llmPlaceholders();
  const { app, env, clipboard } = await appWith();
  app.setLlmMaskWords(MASK_WORDS);
  seedTargets(app, env);
  app.setDrawStyle('anime');
  const r = await copyVia(app, { mask: true });
  assert.equal(r.ok, true); assert.equal(r.masked, true);
  const M = clipboard.writes[0];
  for (const x of TARGETS) {
    assert.ok(!M.includes(x.t), `${x.k}「${x.t}」は文章に残らない（トピック・見出し・要点のどこにも）`);
    assert.ok(M.includes(`「${ph[x.k]}」について${x.suf}`), `${x.k} は AC-359 と同じ伏せ字「${ph[x.k]}」になる`);
  }
  const plain = app.getImagePrompt({ mask: false });
  const others = plain.sections.filter((s) => s.key !== 'content');
  assert.equal(inOrder(M, others.flatMap((s) => [s.heading, s.body])), null, '目的〜構成は伏せ字を適用しないときと同じ');
  const mp = app.getImagePrompt({ mask: true });
  assert.equal(M, mp.text);
  for (const s of others) assert.equal(sec(mp, s.key).body, s.body, `${s.key} は同じ`);
  assert.equal(app.getState().message.masked, true, 'メッセージは伏せ字を適用したことを示す');
});

test('FR-078 AC-471: 伏せ字を適用しないを選ぶと、内容の部分は元の文字で入り、メッセージは伏せ字を適用したかどうかで異なる', async () => {
  const { app, env, clipboard } = await appWith();
  app.setLlmMaskWords(MASK_WORDS);
  seedTargets(app, env);
  assert.equal((await copyVia(app, { mask: true })).masked, true);
  const msgMasked = app.getState().message;
  const r = await copyVia(app, { mask: false });
  assert.equal(r.ok, true); assert.equal(r.masked, false);
  const U = clipboard.writes[1];
  for (const x of TARGETS) assert.ok(U.includes(x.t), `${x.k}「${x.t}」は元の文字で入る`);
  assert.equal(U, app.getImagePrompt().text, 'AC-420・AC-421 のとおりの文章');
  const msgPlain = app.getState().message;
  assert.equal(msgPlain.masked, false);
  assert.ok(msgPlain.text.trim() && msgMasked.text.trim());
  assert.notEqual(msgPlain.text, msgMasked.text, '伏せ字を適用したかどうかがメッセージで分かる');
  for (const m of [msgPlain, msgMasked]) assert.ok(['prompt.copied', 'prompt.truncated'].includes(m.key), 'コピーしたことのメッセージ');
});

test('FR-078 AC-471: 注意に、伏せ字の検出は簡易で完全な個人情報の除去は保証しない旨が示される（日本語・英語）', async () => {
  const { app, env } = await appWith();
  await seedThreeScenes(app, env);
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    await app.commands['prompt.copy']();
    const n = app.getPromptNotice();
    const s = n.statements.find((x) => x.key === 'maskLimit');
    assert.ok(s, `${lang}: 保証しない旨の文がある`);
    assert.match(s.text, lang === 'ja' ? /保証し(ない|ません)/ : /(not|n't|no)\b.*guarantee|guarantee.*\bnot\b/i);
    assert.ok(n.description.includes(s.text));
    await app.promptNoticeAction('cancel');
  }
});

test('FR-078 AC-471 異常系: 伏せ字の対象がない内容では、伏せ字を適用しても文章は伏せ字なしと同じで、LLM 連携が無効・同意なしでも使える', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  assert.equal(app.getLlmState().enabled, false, '前提: LLM 連携は無効');
  const r = await copyVia(app, { mask: true });
  assert.equal(r.ok, true); assert.equal(r.masked, true);
  assert.equal(clipboard.writes[0], app.getImagePrompt({ mask: false }).text, '対象がなければ何も伏せない');
  assert.equal(app.getLlmConsent(), null, 'LLM 連携の同意を求めない');
  for (const s of app.getState().scenes) for (const p of s.points) assert.ok(clipboard.writes[0].includes(p.text));
});

// FR-078 AC-473（AC-474 の外部へのリクエスト 0 件も確かめる）
test('FR-078 AC-473: 注意で「キャンセル」を選ぶと、注意が閉じ、クリップボードは書き換えられず、メッセージは出ず、フォーカスは開く前の位置に戻り、入力中の内容・選択中のオブジェクトは失われない', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  app.selectScene(app.getState().scenes[1].id);
  app.setDraft('入力中の文字');
  assert.equal(app.focusCommand('prompt.copy').ok, true);
  assert.equal(app.getFocus(), 'command:prompt.copy');
  const before = keepOf(app);
  const msgBefore = JSON.stringify(app.getState().message ?? null);
  assert.equal((await app.commands['prompt.copy']()).pending, true);
  assert.match(app.getFocus(), /^notice:/, '注意が開くとフォーカスは注意の中');
  await app.promptNoticeAction('cancel');
  assert.equal(app.getPromptNotice(), null, '注意が閉じる');
  assert.equal(clipboard.writes.length, 0, 'クリップボードは書き換えられない');
  assert.ok(!['prompt.copied', 'prompt.truncated'].includes(app.getState().message?.key), 'コピーしたことのメッセージは出ない');
  assert.equal(JSON.stringify(app.getState().message ?? null), msgBefore, 'メッセージは変わらない');
  assert.equal(app.getFocus(), 'command:prompt.copy', 'フォーカスは開く前の位置に戻る');
  assert.equal(keepOf(app), before, '入力中の内容・選択中のオブジェクトは失われない');
});

test('FR-078 AC-473: Esc キーでも同じく閉じ、キーボードで開いたときはフォーカスが開く前のボタンに戻る', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  app.setDraft('書きかけ');
  assert.equal(app.focusCommand('save.svg').ok, true);
  const before = keepOf(app);
  assert.equal(app.handleKey(keyFor(app, 'prompt.copy')), 'prompt.copy');
  assert.ok(app.getPromptNotice()?.open);
  assert.equal(app.handleKey({ key: 'Escape' }), 'prompt.notice.cancel');
  assert.equal(app.getPromptNotice(), null);
  await tick(); await tick();
  assert.equal(clipboard.writes.length, 0);
  assert.ok(!['prompt.copied', 'prompt.truncated'].includes(app.getState().message?.key));
  assert.equal(app.getFocus(), 'command:save.svg');
  assert.equal(keepOf(app), before);
});

test('FR-078 AC-473: 注意が開いている間はフォーカスが注意の外に出ず、伏せ字の選択・「コピー」・「キャンセル」をキーボードだけで操作できる', async () => {
  const { app, env, clipboard } = await appWith();
  await seedThreeScenes(app, env);
  app.focusCommand('prompt.copy');
  app.handleKey(keyFor(app, 'prompt.copy'));
  const seen = new Set();
  for (const shiftKey of [false, true]) for (let i = 0; i < 7; i++) {
    assert.ok(app.handleKey({ key: 'Tab', shiftKey }), 'Tab は注意の中で処理される');
    const f = app.getFocus();
    assert.match(f, /^notice:(mask|copy|cancel)$/, `フォーカスは注意の中: ${f}`);
    seen.add(f);
  }
  assert.deepEqual([...seen].sort(), ['notice:cancel', 'notice:copy', 'notice:mask'], 'Tab で 3 つすべてに届く');
  assert.equal(app.focusCommand('save.svg').ok, false, '注意の外へはフォーカスを移さない');
  assert.match(app.getFocus(), /^notice:/);
  // 伏せ字の選択をキーボードで切り替え、その選択でコピーする
  tabTo(app, 'notice:mask');
  const c0 = app.getPromptNotice().mask.checked;
  assert.ok(app.handleKey({ key: ' ' }));
  assert.equal(app.getPromptNotice().mask.checked, !c0, 'Space で伏せ字の選択が切り替わり、状態が伝わる');
  tabTo(app, 'notice:copy');
  app.handleKey({ key: 'Enter' });
  await tick(); await tick();
  assert.equal(clipboard.writes.length, 1);
  assert.equal(clipboard.writes[0], app.getImagePrompt({ mask: !c0 }).text, '選んだ伏せ字の選択で入る');
  assert.equal(app.getState().message.masked, !c0);
  // 「キャンセル」もキーボードで
  app.handleKey(keyFor(app, 'prompt.copy'));
  tabTo(app, 'notice:cancel');
  app.handleKey({ key: 'Enter' });
  await tick();
  assert.equal(app.getPromptNotice(), null);
  assert.equal(clipboard.writes.length, 1);
});

test('FR-078 AC-473: 注意は名前と説明を持つダイアログとして、伏せ字の選択は名前と選択の状態として支援技術に伝わる', async () => {
  const { app, env } = await appWith();
  await seedThreeScenes(app, env);
  await app.commands['prompt.copy']();
  const n = app.getPromptNotice();
  assertNotice(n, 'ja');
  app.setPromptNoticeMask(true);
  assert.equal(app.getPromptNotice().mask.checked, true);
  app.setPromptNoticeMask(false);
  assert.equal(app.getPromptNotice().mask.checked, false, '選択の状態が反映される');
  assert.equal(app.getPromptNotice().mask.label, n.mask.label, '名前は状態で変わらない');
});

test('FR-078 AC-473 異常系: シーンが 0 のときは注意を表示せず、内容がないことが示される（ボタン・キーのどちらでも）', async () => {
  const { app, clipboard } = await appWith();
  app.commands['session.start']();
  app.setDraft('書きかけの発言');
  const r = await app.commands['prompt.copy']();
  assert.equal(r.ok, false); assert.equal(r.reason, 'empty');
  assert.equal(app.getPromptNotice(), null, '注意を表示しない');
  assert.ok(app.getState().message.text.trim(), '内容がないことが示される');
  app.handleKey(keyFor(app, 'prompt.copy')); await tick(); await tick();
  assert.equal(app.getPromptNotice(), null);
  assert.equal(clipboard.writes.length, 0);
  assert.equal(app.getState().input.draft, '書きかけの発言');
});

test('FR-078 AC-473 AC-474: 注意の表示・伏せ字の選択・キャンセル・コピーの間、外部へのリクエストは 0 件で、LLM 連携の同意を求めない', async () => {
  const relayLog = [];
  const relay = async (req) => { relayLog.push(req); return { status: 404, body: {} }; };
  const { app, env } = await appWith(makeClipboard(), { options: { relay } });
  app.setLlmMaskWords(MASK_WORDS);
  seedTargets(app, env);
  const n0 = relayLog.length;
  const ext = await withNetSpy(async () => {
    await app.commands['prompt.copy']();
    app.setPromptNoticeMask(true); app.setPromptNoticeMask(false); app.setPromptNoticeMask(true);
    app.handleKey({ key: 'Escape' });
    app.handleKey(keyFor(app, 'prompt.copy'));
    tabTo(app, 'notice:cancel'); app.handleKey({ key: 'Enter' }); await tick();
    await copyVia(app, { mask: true });
    await tick(); await tick();
  });
  assert.deepEqual(ext, [], '同一オリジン以外へのリクエストは 0 件');
  assert.equal(relayLog.length, n0, '中継（LLM 連携）へ要求しない');
  assert.equal(app.getLlmConsent(), null, 'LLM 連携の同意を求めない');
});
