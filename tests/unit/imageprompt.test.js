// FR-078 画像生成 AI 向けのプロンプトのコピー（単体・結合テスト。System Test は tests/system/imageprompt.test.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';
import { buildContent, buildTextLabels, clipLabel, MAX_TEXT_LABEL_CHARS, MAX_TEXT_LABELS, MAX_CONTENT_CHARS, SECTION_KEYS, STRINGS } from '../../web/src/imageprompt.js';
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
// FR-078 AC-470: コピーの操作で注意を開き、注意の「コピー」を選ぶ（mask は伏せ字の選択。省略時は初期値のまま）
async function copyVia(app, mask) {
  const o = await app.commands['prompt.copy']();
  if (o.pending !== true) return o;
  if (mask !== undefined) app.setPromptNoticeMask(mask);
  return app.promptNoticeAction('copy');
}

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
  assert.equal((await copyVia(app)).reason, 'clipboard');
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
  assert.deepEqual(await copyVia(app), { ok: true, truncated: false, masked: true }); // 伏せ字の選択の初期値は簡易マスキングの設定（有効）
  assert.equal(app.getState().message.text, STRINGS.ja['prompt.copied'] + STRINGS.ja['prompt.maskedSuffix']);
  app.setLang('en');
  assert.equal(app.getState().message.text, STRINGS.en['prompt.copied'] + STRINGS.en['prompt.maskedSuffix']);
  assert.equal(app.getState().message.masked, true);
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
    const opts = app.getCommandBar().items.filter((i) => i.group === 'drawStyle').map((i) => ({ id: i.command.slice('drawStyle.set:'.length), description: i.description }));
    for (const [id, text] of Object.entries(SHORT[lang])) {
      assert.equal(opts.find((o) => o.id === id).description, text, `${lang} ${id}`);
      assert.notEqual(text, app.getDrawStyleDescription(id).drawing, '画像生成用の記述とは別');
    }
    // 9 つの風は画風の記述（描画の文）の最初の文を短い説明に使い、PARAM-170（40 文字。英語は半角で 2 倍）以内に収める
    const yb = opts.find((o) => o.id === 'yellowBlack');
    const drawing = app.getDrawStyleDescription('yellowBlack').drawing;
    assert.ok(drawing.startsWith(yb.description.replace(/…$/, '')), `${lang}: ${yb.description}`);
    assert.ok(yb.description.length > 0 && yb.description.length <= drawing.length);
  }
});

// FR-078 AC-424: 文章はブラウザ内の保存（grp.*）に含まれない
test('FR-078 AC-424: コピーの前後でブラウザ内の保存に文章が入らない', async () => {
  const { app, storage } = await seeded({ clipboard: clip() });
  await copyVia(app);
  const purpose = sec(app.getImagePrompt(), 'purpose').body;
  for (const [, v] of storage.dump()) assert.ok(!v.includes(purpose));
});

// FR-078 AC-651: 文言の切り詰め（PARAM-171 = 20 文字・英語は半角で 2 倍）と件数（PARAM-172 = 12 件）。判定は伏せ字の後
test('FR-078 AC-651: buildTextLabels は 20 文字で切り詰め・12 件で省略し、伏せ字の後で判定し、決定的', () => {
  assert.equal(MAX_TEXT_LABEL_CHARS, 20); assert.equal(MAX_TEXT_LABELS, 12); // PARAM-171・172
  assert.deepEqual(clipLabel('あ'.repeat(20)), { text: 'あ'.repeat(20), clipped: false });
  assert.deepEqual(clipLabel('あ'.repeat(21)), { text: 'あ'.repeat(20), clipped: true });
  assert.equal(clipLabel('a'.repeat(40)).clipped, false); assert.equal(clipLabel('a'.repeat(41)).text.length, 40);
  const scenes = Array.from({ length: 14 }, (_, i) => ({ id: `s${i}`, heading: i === 0 ? 'い'.repeat(25) : `見出し${i}`, points: [] }));
  const r = buildTextLabels(scenes, [], 'detail');
  assert.equal(r.labels.length, 12); assert.equal(r.omitted, true); assert.equal(r.clipped, true); assert.equal(r.labels[0], 'い'.repeat(20));
  assert.deepEqual(buildTextLabels(scenes, [], 'detail'), r);
  // 伏せ字の後の文字で判定（伏せ字で 20 文字以内になれば切り詰めない）
  const m = buildTextLabels([{ id: 'a', heading: '山田太郎さんと' + 'あ'.repeat(30), points: [] }], [], 'detail', () => '【伏】');
  assert.deepEqual(m, { labels: ['【伏】'], clipped: false, omitted: false });
  const few = buildTextLabels(scenes.slice(1, 3), [], 'detail');
  assert.equal(few.clipped, false); assert.equal(few.omitted, false);
});

// FR-078 AC-650: 「文字」の節に、詳細度で図に出る見出しの引用符列挙と 3 制約。伏せ字・英語・外部リクエスト 0
test('FR-078 AC-650: 文字の節にトピック・シーン見出しを話順に列挙し 3 つの制約が続く（詳細度・伏せ字・英語）', async () => {
  const { app } = await seeded();
  let fetched = 0; const orig = globalThis.fetch; globalThis.fetch = () => { fetched++; return Promise.reject(new Error('no')); };
  try {
    const topics = app.getTopics?.() ?? [];
    const body = () => sec(app.getImagePrompt(), 'typography').body;
    app.setDetailLevel('detail');
    const b = body();
    const order = [...b.matchAll(/「([^」]*)」/g)].map((x) => x[1]);
    const heads = app.getTopics().flatMap((tp) => [tp.title]).concat(['予算を見直す', '来月に公開する']);
    for (const h of heads) assert.ok(order.includes(h), h);
    for (const c of ['列挙した文言以外の文字を画像に入れない', '一度ずつ描く', '余計なロゴ・透かしを入れない']) assert.ok(b.includes(c), c);
    assert.ok(b.indexOf('」') < b.indexOf('列挙した文言以外'));
    if (topics.length) { app.setDetailLevel('major'); const mj = [...body().matchAll(/「([^」]*)」/g)].map((x) => x[1]); assert.deepEqual(mj, topics.map((x) => x.title)); app.setDetailLevel('detail'); }
    assert.equal(body(), b); // 決定的
    app.setLang('en');
    const en = body();
    assert.ok(/"[^"]+"/.test(en) && en.includes('Do not put any text other than the listed wording') && en.includes('only once') && en.includes('logos or watermarks'));
    assert.equal(fetched, 0);
  } finally { globalThis.fetch = orig; }
});
