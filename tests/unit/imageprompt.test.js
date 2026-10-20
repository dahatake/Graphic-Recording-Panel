// FR-078 画像生成 AI 向けのプロンプトのコピー（単体・結合テスト。System Test は tests/system/imageprompt.test.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';
import { mountPromptCopyNotice } from '../../web/src/imageprompt-ui.js';
import { buildContent, MAX_CONTENT_CHARS, SECTION_KEYS, STRINGS } from '../../web/src/imageprompt.js';
import { BUILTIN_STYLES, validateStyle } from '../../web/src/drawstyles.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, dump: () => [...m.entries()] };
};
const clip = () => { const writes = []; return { writes, writeText: async (t) => { writes.push(t); } }; };
async function seeded(options = {}) {
  let t = 1_700_000_000_000;
  const storage = mem();
  const app = await createApp({ storage, now: () => t, ...options });
  app.commands['session.start']();
  for (const [i, group] of [['予算を見直す', '費用が高い'], ['来月に公開する']].entries()) {
    for (const s of group) { app.setDraft(s); app.submitDraft(); t += 1000; }
    if (i === 0) app.commands['session.nextScene']();
  }
  return { app, storage };
}
const sec = (pr, key) => pr.sections.find((s) => s.key === key);

// FR-078 AC-420 AC-421: 組み込みの 13 の描画スタイルはすべて ja・en の画風の記述を持ち、既存の 4 つも見た目の項目は持たない（preset:false）
test('FR-078 AC-420 AC-421: 組み込みの描画スタイルはすべて画風の記述（4 軸・ja/en）を持ち、既存 4 つの見た目は変えない', async () => {
  assert.equal(BUILTIN_STYLES.length, 13);
  for (const s of BUILTIN_STYLES) {
    assert.equal(validateStyle(s).ok, true, s.id);
    for (const l of ['ja', 'en']) for (const ax of ['color', 'drawing', 'font', 'mood']) assert.ok(s.description?.[l]?.[ax]?.trim(), `${s.id} ${l}.${ax}`);
    for (const ax of ['color', 'drawing', 'font', 'mood']) assert.ok(!/[\u3000-\u30ff\u3400-\u9fff]/.test(s.description.en[ax]), `${s.id} en.${ax} は英語`);
  }
  const app = await createApp({ storage: mem() });
  for (const id of ['handwritten', 'anime', 'simple', 'rpg']) assert.equal(app.getDrawStyleSpec(id).preset, false, id);
  assert.equal(app.getDrawStyleDescription('nosuch'), null);
  app.setLang('en');
  assert.equal(app.getDrawStyleDescription('anime').palette, BUILTIN_STYLES.find((s) => s.id === 'anime').description.en.color);
});

// FR-078 AC-422: シーンの区切りで切り詰める（途中のシーンの一部だけは入れない）
test('FR-078 AC-422: buildContent はシーンの区切りで上限以内に切り詰め、上限ちょうどは切り詰めない', () => {
  const t = (k) => STRINGS.ja[k];
  const scenes = [0, 1, 2].map((i) => ({ id: `s${i}`, heading: `見出し${i}`, points: [{ id: `p${i}`, text: `要点${i}`.repeat(5) }] }));
  const all = buildContent(scenes, [], t, 10_000);
  assert.equal(all.truncated, false);
  const exact = buildContent(scenes, [], t, [...all.body].length);
  assert.equal(exact.truncated, false); assert.equal(exact.body, all.body);
  const cut = buildContent(scenes, [], t, [...all.body].length - 1);
  assert.equal(cut.truncated, true);
  assert.ok(cut.body.includes('見出し1') && !cut.body.includes('見出し2') && !cut.body.includes('要点2'));
  assert.equal(MAX_CONTENT_CHARS, 2000); // PARAM-082
});

// FR-078 AC-421: トピックの題名は、そのトピックの最初のシーンの前に 1 回だけ入る（テキスト一覧と同じ順序）
test('FR-078 AC-421: 内容はトピック → シーンの見出し → 要点の順で、トピックの題名は 1 回だけ', () => {
  const t = (k) => STRINGS.en[k];
  const scenes = [{ id: 'a', heading: 'A', points: [{ id: 'x', text: 'x1' }] }, { id: 'b', heading: 'B', points: [] }, { id: 'c', heading: 'C', points: [] }];
  const topics = [{ title: 'T1', sceneIds: ['a', 'b'] }, { title: 'T2', sceneIds: ['c'] }];
  const { body } = buildContent(scenes, topics, t);
  assert.equal(body, 'Topic: T1\n- Scene: A\n  - x1\n- Scene: B\nTopic: T2\n- Scene: C');
});

// FR-078 AC-420 AC-421: 文章の構成と表示言語、構成（型）の名称と説明
test('FR-078 AC-420 AC-421: 文章は 7 つの節をこの順に持ち、英語では見出し・説明が英語になる', async () => {
  const { app } = await seeded({ clipboard: clip() });
  app.setLayoutTypes(['zone', 'diverge']);
  const ja = app.getImagePrompt();
  assert.deepEqual(ja.sections.map((s) => s.key), SECTION_KEYS);
  assert.deepEqual(sec(ja, 'composition').typeIds, ['zone', 'diverge']);
  assert.ok(sec(ja, 'composition').body.includes('区画') && sec(ja, 'composition').body.includes('発散'));
  app.setLang('en');
  const en = app.getImagePrompt();
  assert.equal(sec(en, 'purpose').heading, 'Purpose');
  assert.ok(sec(en, 'composition').body.includes('Zone') && sec(en, 'composition').body.includes('Diverge'));
  assert.ok(en.text.endsWith('\n'));
});

// FR-078 AC-423: 書けなかったときの表示は閉じられ、次に成功したら消える。シーン 0 では表示しない
test('FR-078 AC-423: 手でコピーする表示は閉じられ、成功・シーン 0 のときは出さない', async () => {
  const deny = { writeText: async () => { throw new Error('denied'); } };
  const { app } = await seeded({ clipboard: deny });
  assert.equal((await app.commands['prompt.copy']()).pending, 'notice'); // AC-468: 書き込みは注意でコピーを選んでから
  assert.equal((await app.confirmPromptCopy()).reason, 'clipboard');
  assert.equal(app.getPromptFallback().open, true);
  assert.equal(app.getState().message.key, 'prompt.clipboardFailed');
  assert.equal(app.closePromptFallback(), true);
  assert.equal(app.getPromptFallback(), null);
  assert.equal(app.closePromptFallback(), false);
  const empty = await createApp({ storage: mem(), clipboard: deny });
  assert.equal((await empty.commands['prompt.copy']()).reason, 'empty');
  assert.equal(empty.getPromptFallback(), null);
  assert.equal(empty.getState().message.key, 'prompt.empty');
});

// FR-078 AC-420: メッセージは表示言語の切替に追従する（読み上げ対象のメッセージ）
test('FR-078 AC-420: コピーしたメッセージは表示言語の切替で訳される', async () => {
  const c = clip();
  const { app } = await seeded({ clipboard: c });
  assert.deepEqual(await app.commands['prompt.copy'](), { ok: true, pending: 'notice' });
  assert.deepEqual(await app.confirmPromptCopy(), { ok: true, truncated: false, masked: true });
  assert.equal(app.getState().message.text, STRINGS.ja['prompt.copied']);
  app.setLang('en');
  assert.equal(app.getState().message.text, STRINGS.en['prompt.copied']);
});

// FR-078 AC-420 と FR-077 AC-414: 画風の記述を足しても、画風の一覧（FR-077）の既存 4 つの短い説明は変わらない（ja・en）
test('FR-078 AC-420 / FR-077 AC-414: 既存 4 つの画風の一覧の短い説明は従来どおり', async () => {
  const app = await createApp({ storage: mem() });
  const SHORT = {
    ja: { handwritten: '手描きの揺らぎのある線と白い紙面', anime: '太い輪郭線と色の淡い塗り', simple: '揺らぎと絵記号を抑えた見た目', rpg: 'ゲームの地図と会話の窓で見せる' },
    en: { handwritten: 'Wobbly hand-drawn lines on white paper', anime: 'Bold outlines with soft color fills', simple: 'Clean lines without icons or wobble', rpg: 'Shown as a game map with dialog windows' },
  };
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    const opts = app.getDrawStylePicker().options;
    for (const [id, text] of Object.entries(SHORT[lang])) {
      assert.equal(opts.find((o) => o.id === id).description, text, `${lang} ${id}`);
      assert.notEqual(text, app.getDrawStyleDescription(id).drawing, '画像生成用の記述とは別');
    }
    // 9 つの風は従来どおり画風の記述（描画の文）を短い説明に使う
    const yb = opts.find((o) => o.id === 'yellowBlack');
    assert.equal(yb.description, app.getDrawStyleDescription('yellowBlack').drawing);
  }
});

// FR-078 AC-424: 文章はブラウザ内の保存（grp.*）に含まれない
test('FR-078 AC-424: コピーの前後でブラウザ内の保存に文章が入らない', async () => {
  const { app, storage } = await seeded({ clipboard: clip() });
  await app.commands['prompt.copy']();
  const purpose = sec(app.getImagePrompt(), 'purpose').body;
  for (const [, v] of storage.dump()) assert.ok(!v.includes(purpose));
});

// ---------------------------------------------------------------- FR-078 AC-468・AC-469（コピー前の注意と簡易マスキング）
// FR-078 AC-469: buildContent の変換は利用者の文字だけに掛かり、上限の判定は変換した後の文字で行う
test('FR-078 AC-469: buildContent は題名・見出し・要点だけを変換し、切り詰めは変換後の長さで判定する', () => {
  const t = (k) => STRINGS.ja[k];
  const scenes = [0, 1].map((i) => ({ id: `s${i}`, heading: `見出し${i}`, points: [{ id: `p${i}`, text: 'ABCDEFGHIJ'.repeat(3) }] }));
  const topics = [{ title: '題名', sceneIds: ['s0', 's1'] }];
  const fix = (s) => s.replace(/[A-Z]+/g, 'x');
  const { body } = buildContent(scenes, topics, t, 10_000, fix);
  assert.equal(body, 'トピック: 題名\n- シーン: 見出し0\n  - x\n- シーン: 見出し1\n  - x');
  const plainLen = [...buildContent(scenes, topics, t, 10_000).body].length;
  const fixed = buildContent(scenes, topics, t, [...body].length, fix);
  assert.equal(fixed.truncated, false, '変換後の長さなら上限以内');
  assert.ok(plainLen > [...body].length, '前提: 変換前は上限を超える長さ');
});

// FR-078 AC-469: 伏せ字は NFR-PRIV-003 と同じ登録語を使い、内容の部分だけに掛かる
test('FR-078 AC-469: getImagePrompt({mask}) は登録語・人名・メール・電話を内容の部分だけで伏せ、getLlmMaskWords は登録語の写しを返す', async () => {
  const { app } = await seeded({ clipboard: clip() });
  assert.deepEqual(app.getLlmMaskWords(), []);
  app.setDraft('予算は佐藤さんと決める hana@example.org'); app.submitDraft();
  app.setLlmMaskWords(['予算']);
  const words = app.getLlmMaskWords(); words.push('改ざん');
  assert.deepEqual(app.getLlmMaskWords(), ['予算'], '写しを返す（外から変えられない）');
  const plain = app.getImagePrompt({ mask: false });
  const m = app.getImagePrompt({ mask: true });
  for (const w of ['予算', '佐藤さん', 'hana@example.org']) { assert.ok(plain.text.includes(w)); assert.ok(!sec(m, 'content').body.includes(w), w); }
  assert.ok(sec(m, 'content').body.includes('●●●'));
  for (const k of SECTION_KEYS.filter((k) => k !== 'content')) assert.equal(sec(m, k).body, sec(plain, k).body, k);
  assert.equal(app.getImagePrompt().text, plain.text, '省略は適用しない');
  assert.equal(app.getImagePrompt({ mask: 'yes' }).text, plain.text, '真偽値の true 以外は適用しない');
});

// FR-078 AC-468: 注意の状態（開閉・現在の操作・フォーカスの戻り先）とキーの扱い（モーダル）
test('FR-078 AC-468: 注意が開いている間は Tab で巡回し、ほかのキーの操作は働かず、閉じるとフォーカスはボタンに戻る', async () => {
  const c = clip();
  const { app } = await seeded({ clipboard: c });
  assert.equal(app.getPromptCopyNotice().focus, null, '開いたことがなければ null');
  await app.commands['prompt.copy']();
  const n = app.getPromptCopyNotice();
  assert.equal(n.active, 'mask'); assert.equal(n.role, 'alertdialog'); assert.equal(n.modal, true);
  assert.deepEqual(n.controls.map((x) => x.id), ['mask', 'cancel', 'copy']);
  assert.equal(app.handleKey({ key: 'Tab' }), 'prompt.copy.focus'); assert.equal(app.getPromptCopyNotice().active, 'cancel');
  app.handleKey({ key: 'Tab' }); app.handleKey({ key: 'Tab' }); assert.equal(app.getPromptCopyNotice().active, 'mask', '末尾の次は先頭');
  app.handleKey({ key: 'Tab', shiftKey: true }); assert.equal(app.getPromptCopyNotice().active, 'copy', '先頭の前は末尾');
  assert.equal(app.setPromptCopyActive('copy').ok, true); assert.equal(app.getPromptCopyNotice().active, 'copy');
  assert.equal(app.setPromptCopyActive('nosuch').ok, false);
  const draft = app.getState().input.draft;
  assert.equal(app.handleKey({ key: 'c', ctrlKey: true, altKey: true, shiftKey: true }), null, '注意の外の操作は働かない');
  assert.equal(app.handleKey({ key: 'a' }), null);
  assert.equal(app.getState().input.draft, draft);
  assert.equal(app.handleKey({ key: 'Enter' }), 'prompt.copy.confirm');
  await new Promise((r) => setImmediate(r));
  assert.equal(c.writes.length, 1);
  const after = app.getPromptCopyNotice();
  assert.equal(after.open, false); assert.equal(after.focus, 'button'); assert.equal(after.active, null);
  assert.equal(app.setPromptCopyMask(false).ok, false, '閉じているときは適用の指定はできない');
  assert.equal(app.setPromptCopyActive('copy').ok, false);
  assert.equal(app.cancelPromptCopy().ok, true, '閉じているときの取りやめは何もしない');
});

// FR-078 AC-468: 注意が開いたら、前回の手でコピーする表示（AC-423）は閉じる（画面に重ねない）
test('FR-078 AC-468 異常系: 注意を開くと前回の手でコピーする表示は閉じる', async () => {
  const deny = { writeText: async () => { throw new Error('denied'); } };
  const { app } = await seeded({ clipboard: deny });
  await app.commands['prompt.copy'](); await app.confirmPromptCopy();
  assert.ok(app.getPromptFallback());
  await app.commands['prompt.copy']();
  assert.equal(app.getPromptFallback(), null);
  assert.equal(app.cancelPromptCopy().ok, true);
  assert.equal(app.getPromptFallback(), null, '取りやめても前回の表示は戻らない');
});

// FR-078 AC-468: 画面（imageprompt-ui.js）は app の状態を描き、現在の操作へフォーカスを合わせ、閉じたらコピーのボタンへ戻す
function fakeDom() {
  const all = [];
  const el = (tag) => {
    const e = { tagName: tag.toUpperCase(), children: [], attrs: {}, dataset: {}, listeners: {}, textContent: '', checked: false, parent: null, className: '', id: '',
      append(...xs) { for (const x of xs) { if (typeof x === 'object') { x.parent = e; e.children.push(x); } } },
      remove() { if (e.parent) e.parent.children = e.parent.children.filter((x) => x !== e); e.parent = null; },
      setAttribute(k, v) { e.attrs[k] = String(v); }, getAttribute(k) { return e.attrs[k] ?? null; },
      addEventListener(k, f) { (e.listeners[k] ??= []).push(f); },
      focus() { doc.activeElement = e; },
      get nextElementSibling() { const p = e.parent?.children ?? []; return p[p.indexOf(e) + 1] ?? null; },
      querySelector(sel) { return find(e, sel); },
    };
    all.push(e); return e;
  };
  const match = (e, sel) => {
    let m;
    if ((m = /^\[data-control="(\w+)"\]$/.exec(sel))) return e.dataset.control === m[1];
    if ((m = /^\[data-command="([\w.]+)"\]$/.exec(sel))) return e.dataset.command === m[1];
    if ((m = /^#([\w-]+)$/.exec(sel))) return e.id === m[1];
    if ((m = /^\.([\w-]+)$/.exec(sel))) return e.className.split(' ').includes(m[1]);
    return e.tagName === sel.toUpperCase();
  };
  const find = (root, sel) => { for (const c of root.children) { if (match(c, sel)) return c; const f = find(c, sel); if (f) return f; } return null; };
  const doc = { activeElement: null, createElement: el };
  doc.body = el('body');
  doc.querySelector = (sel) => find(doc.body, sel);
  return doc;
}
test('FR-078 AC-468: 注意の画面は役割・名前・文言を描き、現在の操作にフォーカスを合わせ、閉じるとコピーのボタンへ戻す', async () => {
  const { app } = await seeded({ clipboard: clip() });
  const doc = fakeDom();
  const btn = doc.createElement('button'); btn.dataset.command = 'prompt.copy'; doc.body.append(btn); btn.focus();
  mountPromptCopyNotice(app, doc);
  assert.equal(doc.querySelector('.prompt-notice'), null, '閉じているときは描かない');
  await app.commands['prompt.copy']();
  const box = doc.querySelector('.prompt-notice');
  assert.ok(box);
  assert.equal(box.getAttribute('role'), 'alertdialog'); assert.equal(box.getAttribute('aria-modal'), 'true');
  assert.equal(box.getAttribute('aria-live'), 'assertive');
  assert.equal(doc.querySelector('h2').textContent, STRINGS.ja['prompt.notice.label']);
  assert.equal(doc.querySelector('#prompt-notice-text').textContent, STRINGS.ja['prompt.notice.text']);
  assert.equal(doc.querySelector('#prompt-notice-masknote').textContent, STRINGS.ja['prompt.notice.maskNote']);
  const cb = doc.querySelector('[data-control="mask"]');
  assert.equal(cb.checked, true); assert.equal(doc.activeElement, cb, '最初の操作（簡易マスキング）にフォーカス');
  app.handleKey({ key: ' ' });
  assert.equal(cb.checked, false, 'Space の切り替えが画面に反映される');
  app.handleKey({ key: 'Tab' });
  assert.equal(doc.activeElement, doc.querySelector('[data-control="cancel"]'));
  app.handleKey({ key: 'Tab' });
  assert.equal(doc.activeElement, doc.querySelector('[data-control="copy"]'));
  app.setLang('en');
  assert.equal(doc.querySelector('[data-control="cancel"]').textContent, STRINGS.en['prompt.notice.cancel'], '表示言語の切替に追従');
  for (const f of doc.querySelector('[data-control="cancel"]').listeners.click) f();
  assert.equal(doc.querySelector('.prompt-notice'), null, '取りやめで閉じる');
  assert.equal(doc.activeElement, btn, 'フォーカスはコピーのボタンへ戻る');
});

// FR-078 AC-468（WCAG 2.4.3 フォーカスの順序）: 注意の Tab の順序は、画面に置いた操作の並び（文書の順）と同じ
test('FR-078 AC-468: 注意の Tab・Shift+Tab の順序は画面の並び（簡易マスキング → 取りやめ → コピー）と一致する', async () => {
  const { app } = await seeded({ clipboard: clip() });
  const doc = fakeDom();
  mountPromptCopyNotice(app, doc);
  await app.commands['prompt.copy']();
  const order = [];
  const walk = (e) => { for (const c of e.children) { if (c.dataset.control) order.push(c.dataset.control); walk(c); } };
  walk(doc.querySelector('.prompt-notice'));
  assert.deepEqual(order, ['mask', 'cancel', 'copy'], '画面の並び');
  assert.deepEqual(app.getPromptCopyNotice().controls.map((c) => c.id), order, 'controls は画面の並びと同じ順');
  const forward = [app.getPromptCopyNotice().active];
  for (let i = 0; i < order.length - 1; i++) { app.handleKey({ key: 'Tab' }); forward.push(app.getPromptCopyNotice().active); }
  assert.deepEqual(forward, order, 'Tab は画面の並びの順に進む');
  assert.equal(doc.activeElement.dataset.control, 'copy', 'DOM のフォーカスも同じ順に移る');
  const back = [app.getPromptCopyNotice().active];
  for (let i = 0; i < order.length - 1; i++) { app.handleKey({ key: 'Tab', shiftKey: true }); back.push(app.getPromptCopyNotice().active); }
  assert.deepEqual(back, [...order].reverse(), 'Shift+Tab は逆の順に戻る');
});
