// FR-078 AC-470〜AC-474（Q-027 A）: コピーの前の注意と任意の伏せ字（単体・結合テスト。System Test は tests/system/imageprompt.test.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';
import { buildContent, STRINGS } from '../../web/src/imageprompt.js';
import { maskText } from '../../web/src/llmdraw.js';

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, dump: () => [...m.entries()] };
};
const clip = (deny = false) => { const writes = []; return { writes, writeText: async (t) => { if (deny) throw new Error('denied'); writes.push(t); } }; };
const SECRET = '極秘案件';
async function seeded(options = {}, lines = [`${SECRET}の予算を見直す`, '山田様に連絡する', 'taro@example.com へ送る']) {
  let t = 1_700_000_000_000;
  const storage = mem(); const downloads = [];
  const app = await createApp({ storage, now: () => t, download: async (f) => { downloads.push(f); }, ...options });
  app.setLlmMaskWords([SECRET]);
  app.commands['session.start']();
  for (const s of lines) { app.setDraft(s); app.submitDraft(); t += 1000; }
  return { app, storage, downloads };
}
const sec = (pr, key) => pr.sections.find((s) => s.key === key);
// 伏せ字の適用に失敗する環境（登録した語が読めないなど）を作るモジュール。imageprompt より前に読み込まれる
const brokenMask = (ctx) => { ctx.api.applyLlmMask = () => { throw new Error('mask words unreadable'); }; };

// FR-078 AC-472: 伏せ字は切り詰めの前に適用し、上限の判定は伏せ字にした後の文字数で行う
test('FR-078 AC-472: buildContent は伏せ字にした後の文字数で上限を判定する（伏せ字は切り詰めの前）', () => {
  const t = (k) => STRINGS.ja[k];
  const long = 'abcdefghijklmnopqrstuvwxyz0123456789@example.com';
  const scenes = [0, 1, 2].map((i) => ({ id: `s${i}`, heading: `見出し${i}`, points: [{ id: `p${i}`, text: `${long} に送る` }] }));
  const tf = (s) => maskText(s, []);
  const masked = buildContent(scenes, [], t, 10_000, tf);
  assert.ok(!masked.body.includes(long));
  const max = [...masked.body].length;
  assert.ok([...buildContent(scenes, [], t, 10_000).body].length > max, '前提: 伏せ字の前は上限を超える');
  assert.equal(buildContent(scenes, [], t, max).truncated, true, '伏せ字なしでは切り詰める');
  const r = buildContent(scenes, [], t, max, tf);
  assert.equal(r.truncated, false, '伏せ字にした後の文字数が上限以内なら切り詰めない');
  assert.equal(r.body, masked.body);
});

// FR-078 AC-471: 内容の部分（トピック・見出し・要点）だけを伏せ字にし、ほかの節は同じ
test('FR-078 AC-471: getImagePrompt({mask:true}) は内容の部分だけを伏せ字にし、ほかの節は伏せ字なしと同じ', async () => {
  const { app } = await seeded();
  const plain = app.getImagePrompt();
  const masked = app.getImagePrompt({ mask: true });
  assert.deepEqual(app.getImagePrompt({ mask: false }), plain);
  for (const s of plain.sections.filter((x) => x.key !== 'content')) assert.equal(sec(masked, s.key).body, s.body, s.key);
  const body = sec(masked, 'content').body;
  for (const x of [SECRET, '山田様', 'taro@example.com']) { assert.ok(sec(plain, 'content').body.includes(x)); assert.ok(!body.includes(x), x); }
  assert.ok(body.includes('●●●'), 'AC-359 と同じ伏せ字');
  assert.ok(body.includes('の予算を見直す') && body.includes('に連絡する'), '伏せ字の対象以外はそのまま');
});

// FR-078 AC-472: 伏せ字の選択の初期値は開くたびに設定に従い、注意の中の選択は設定を変えず、保存もされない
test('FR-078 AC-472: 伏せ字の選択の初期値は簡易マスキングの設定に従い、注意の中の選択は設定を変えず保存もされない', async () => {
  const { app, storage } = await seeded({ clipboard: clip() });
  const before = JSON.stringify(storage.dump());
  app.setLlmMasking(false);
  assert.equal((await app.commands['prompt.copy']()).pending, true);
  assert.equal(app.getPromptNotice().mask.checked, false, '設定が無効なら初期値は適用しない');
  app.setPromptNoticeMask(true);
  assert.equal(app.getPromptNotice().mask.checked, true);
  assert.equal(app.getLlmMasking(), false, '設定は変わらない');
  await app.promptNoticeAction('cancel');
  assert.equal((await app.commands['prompt.copy']()).pending, true);
  assert.equal(app.getPromptNotice().mask.checked, false, '開くたびに設定から始まる');
  await app.promptNoticeAction('cancel');
  app.setLlmMasking(true);
  await app.commands['prompt.copy']();
  assert.equal(app.getPromptNotice().mask.checked, true);
  app.setPromptNoticeMask(false);
  assert.equal(app.getLlmMasking(), true);
  await app.promptNoticeAction('cancel');
  assert.equal(JSON.stringify(storage.dump()), before, '注意の操作はブラウザ内の保存を変えない');
});

// FR-078 AC-472: 書き込みが拒否されたときに表示する文章は、選んだ伏せ字の選択を反映する
test('FR-078 AC-472: クリップボードが拒否されたときの手でコピーする表示は伏せ字の選択を反映する', async () => {
  for (const mask of [true, false]) {
    const { app } = await seeded({ clipboard: clip(true) });
    await app.commands['prompt.copy']();
    app.setPromptNoticeMask(mask);
    const r = await app.promptNoticeAction('copy');
    assert.equal(r.reason, 'clipboard');
    const fb = app.getPromptFallback();
    assert.equal(fb.text, app.getImagePrompt({ mask }).text);
    assert.equal(fb.text.includes(SECRET), !mask);
    assert.equal(app.getState().message.key, 'prompt.clipboardFailed');
    assert.equal(app.getState().message.masked, mask);
  }
});

// FR-078 AC-472 異常系: 伏せ字の適用を選んだのに適用できないときは、伏せ字のない文章を書き込まず・表示もせず、注意に戻る
test('FR-078 AC-472 異常系: 伏せ字を適用できないときは書き込まず表示もせず、メッセージで示して注意に戻る', async () => {
  for (const deny of [false, true]) {
    const c = clip(deny);
    const { app } = await seeded({ clipboard: c, modules: [brokenMask] });
    await app.commands['prompt.copy']();
    app.setPromptNoticeMask(true);
    const r = await app.promptNoticeAction('copy');
    assert.deepEqual(r, { ok: false, reason: 'mask' });
    assert.equal(c.writes.length, 0, '伏せ字のない文章を書き込まない');
    assert.equal(app.getPromptFallback(), null, '伏せ字のない文章を表示しない');
    const n = app.getPromptNotice();
    assert.ok(n?.open, '注意に戻る（開いたまま）');
    assert.equal(n.error, STRINGS.ja['prompt.maskFailed'], '注意の中でも示す');
    assert.equal(app.getState().message.key, 'prompt.maskFailed', '読み上げ対象のメッセージで示す');
    assert.ok(app.getState().message.text.trim());
    assert.throws(() => app.getImagePrompt({ mask: true }));
    // 伏せ字を適用しないを選び直せばコピーできる（利用者の選択）
    app.setPromptNoticeMask(false);
    assert.equal(app.getPromptNotice().error, null);
    const r2 = await app.promptNoticeAction('copy');
    assert.equal(r2.ok, !deny);
    if (!deny) { assert.equal(c.writes[0], app.getImagePrompt().text); assert.equal(r2.masked, false); }
  }
});

// FR-078 AC-471: メッセージは伏せ字の有無を示し、表示言語を切り替えると訳し直される
test('FR-078 AC-471: 伏せ字の有無を示すメッセージは表示言語の切替で訳し直される', async () => {
  const { app } = await seeded({ clipboard: clip() });
  await app.commands['prompt.copy']();
  app.setPromptNoticeMask(false);
  await app.promptNoticeAction('copy');
  assert.equal(app.getState().message.text, STRINGS.ja['prompt.copied'] + STRINGS.ja['prompt.unmaskedSuffix']);
  app.setLang('en');
  assert.equal(app.getState().message.text, STRINGS.en['prompt.copied'] + STRINGS.en['prompt.unmaskedSuffix']);
  assert.equal(app.getState().message.masked, false);
});

// FR-078 AC-473: 注意が開いている間は、ほかのショートカットを働かせず、Enter ではチェックボックスを切り替えない
test('FR-078 AC-473: 注意が開いている間はほかのショートカットが働かず、注意の外へフォーカスを移せない', async () => {
  const { app } = await seeded({ clipboard: clip() });
  assert.deepEqual(app.focusCommand('nosuch.command'), { ok: false, reason: 'unknown' });
  assert.equal(app.focusCommand('save.svg').ok, true);
  await app.commands['prompt.copy']();
  assert.equal(app.getFocus(), 'notice:mask', '開くとフォーカスは伏せ字の選択へ');
  const lang = app.keymap.find((k) => k.command === 'lang.en');
  const ev = { key: lang.key, ctrlKey: !!lang.ctrl, altKey: !!lang.alt, shiftKey: !!lang.shift };
  assert.equal(app.handleKey(ev), 'prompt.notice.blocked');
  assert.equal(app.getState().lang, 'ja', '注意の後ろのコマンドは動かない');
  const c0 = app.getPromptNotice().mask.checked;
  assert.ok(app.handleKey({ key: 'Enter' }));
  assert.equal(app.getPromptNotice().mask.checked, c0, 'Enter では切り替えない');
  assert.equal(app.noteFocus('other'), false);
  assert.equal(app.setPromptNoticeFocus('cancel'), true);
  assert.equal(app.getFocus(), 'notice:cancel');
  assert.equal(app.setPromptNoticeFocus('outside'), false);
  assert.equal(app.handleKey({ key: ' ' }), 'prompt.notice.cancel', 'キャンセルのボタンは Space でも押せる');
  assert.equal(app.getPromptNotice(), null);
  assert.equal(app.getFocus(), 'command:save.svg');
  assert.equal(app.handleKey(ev), 'lang.en', '閉じた後はショートカットが働く');
  assert.equal(app.noteFocus('other'), true);
  assert.equal(app.getFocus(), 'other');
});

// FR-078 AC-470: 注意を開くと、前回の手でコピーする表示と画風の一覧は閉じる。閉じた後の操作は 'closed'
test('FR-078 AC-470: 注意を開くと手でコピーする表示と画風の一覧を閉じ、閉じた注意への操作は何もしない', async () => {
  const c = clip(true);
  const { app } = await seeded({ clipboard: c });
  await app.commands['prompt.copy']();
  await app.promptNoticeAction('copy');
  assert.ok(app.getPromptFallback());
  app.commands['drawStyle.pick']();
  assert.equal(app.getDrawStylePicker().open, true);
  await app.commands['prompt.copy']();
  assert.equal(app.getPromptFallback(), null);
  assert.equal(app.getDrawStylePicker().open, false);
  assert.deepEqual(await app.promptNoticeAction('other'), { ok: false, reason: 'invalid' });
  await app.promptNoticeAction('cancel');
  assert.deepEqual(await app.promptNoticeAction('copy'), { ok: false, reason: 'closed' });
  assert.equal(app.setPromptNoticeMask(true), false);
});

// FR-078 AC-474: 伏せ字の選択・伏せ字にした文章は、セッションファイル・ブラウザ内の保存に含まれず、LLM 連携の同意を求めない
test('FR-078 AC-474: 伏せ字にした文章はセッションファイルとブラウザ内の保存に含まれず、LLM 連携の同意を求めない', async () => {
  const c = clip();
  const { app, storage, downloads } = await seeded({ clipboard: c });
  assert.equal(app.getLlmState().enabled, false);
  await app.commands['prompt.copy']();
  app.setPromptNoticeMask(true);
  assert.equal((await app.promptNoticeAction('copy')).masked, true);
  const masked = c.writes[0];
  const purpose = sec(app.getImagePrompt(), 'purpose').body;
  for (const [, v] of storage.dump()) { assert.ok(!v.includes(purpose)); assert.ok(!v.includes('●●●')); }
  assert.equal((await app.commands['file.save']()).ok, true);
  const data = String(downloads.at(-1).data);
  assert.ok(!data.includes(purpose) && !data.includes('●●●') && !data.includes(masked.slice(0, 40)));
  assert.ok(!JSON.stringify(app.getState()).includes('●●●'), '状態にも残さない');
  assert.equal(app.getLlmConsent(), null);
});
