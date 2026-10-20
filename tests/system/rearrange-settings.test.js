// FR-080 AC-436 AC-440（System Test。契約: tests/system/CONTRACT-ARRANGE.md「再配置の周期」、CONTRACT.md「データの初期化」「セッションファイル」「設定画面」）
// 期待値は受入基準だけから決める。実装がなければ失敗するのが正常（not_run → 実装後に pass）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeStorage, CJK } from './helpers.js';
import { P, T, arrangeApp, say, toDetail } from './rearrange-util.js';

const weight = (s) => [...s].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.5), 0);
const field = (app) => app.getSettingsDialog()?.fields.find((f) => f.id === 'arrange.interval');
const count = (app) => app.getArrangeStatus().count;
const AUTO_JA = '自動（会話の区切り）';

// ---- FR-080 AC-436 ----
// FR-080 AC-436
test('FR-080 AC-436: 保存された設定がない初回の起動では周期は 10 秒で、設定画面に現在の周期が表示される', async () => {
  const { app } = await arrangeApp();
  const iv = app.getArrangeInterval();
  assert.equal(iv.sec, P.INTERVAL_DEFAULT_SEC);
  assert.equal(iv.auto, false);
  assert.ok(iv.text.includes(String(P.INTERVAL_DEFAULT_SEC)), `現在の周期の表示「${iv.text}」`);
  app.commands['settings.open']();
  const f = field(app);
  assert.ok(f, '設定画面に再配置の周期の項目がある');
  assert.equal(f.value, P.INTERVAL_DEFAULT_SEC);
  assert.equal(f.text, iv.text);
  assert.equal(f.min, 0); assert.equal(f.max, P.INTERVAL_MAX_SEC); assert.equal(f.step, 1);
});

// FR-080 AC-436
test('FR-080 AC-436: 0 以上 300 以下の整数（境界値・入力欄の文字列を含む）に変更でき、0 は「自動（会話の区切り）」と表示される', async () => {
  const { app } = await arrangeApp();
  app.commands['settings.open']();
  for (const [v, sec] of [[0, 0], [P.INTERVAL_MAX_SEC, P.INTERVAL_MAX_SEC], [' 25 ', 25], ['0', 0], [1, 1], [299, 299]]) {
    const r = app.setArrangeInterval(v);
    assert.equal(r.ok, true, `値 ${JSON.stringify(v)}`);
    assert.equal(app.getArrangeInterval().sec, sec);
    assert.equal(app.getArrangeInterval().auto, sec === 0);
    assert.equal(field(app).value, sec, '設定画面の表示も変わる');
    if (sec === 0) assert.ok(app.getArrangeInterval().text.includes(AUTO_JA), '0 は「自動（会話の区切り）」と表示');
    else assert.ok(app.getArrangeInterval().text.includes(String(sec)));
  }
});

// FR-080 AC-436
test('FR-080 AC-436: 周期を変更した時点から新しい周期で数え直される（変更前の周期の時点では再配置されない）', async () => {
  const { app, env, scheduler } = await arrangeApp();
  toDetail(app);
  app.commands['session.start']();
  scheduler.advanceTo(7000);
  assert.equal(app.setArrangeInterval(5).ok, true);
  say(env, T.plain1);
  scheduler.advanceTo(10_000); // 変更前の周期の時点（起動から 10 秒）
  assert.equal(count(app), 0, '変更前の周期の時点では再配置されない');
  scheduler.advanceTo(11_999);
  assert.equal(count(app), 0);
  scheduler.advanceTo(12_000); // 変更から 5 秒
  assert.equal(count(app), 1, '変更から 5 秒の時点で再配置される');
  scheduler.advanceTo(13_000); say(env, T.plain2);
  scheduler.advanceTo(16_999);
  assert.equal(count(app), 1);
  scheduler.advanceTo(17_000); // 変更から 10 秒
  assert.equal(count(app), 2, '以後も変更の時点から 5 秒ごと');
});

// FR-080 AC-436 異常系
test('FR-080 AC-436 異常系: 範囲外・整数でない・空の値は受け付けられず、理由が示され、直前の値と数え方が保たれる', async () => {
  const { app, env, scheduler } = await arrangeApp();
  toDetail(app);
  app.commands['session.start']();
  app.commands['settings.open']();
  scheduler.advanceTo(3000);
  say(env, T.plain1);
  const bad = [[-1, 'range'], [P.INTERVAL_MAX_SEC + 1, 'range'], ['-5', 'range'], ['301', 'range'], [1.5, 'not_integer'], ['1.5', 'not_integer'],
    ['abc', 'not_integer'], [Number.NaN, 'not_integer'], [Number.POSITIVE_INFINITY, 'not_integer'], ['', 'empty'], ['   ', 'empty'], [null, 'empty'], [undefined, 'empty']];
  for (const [v, reason] of bad) {
    let r; try { r = app.setArrangeInterval(v); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, `値 ${String(v)} は受け付けない`);
    assert.equal(r.reason, reason, `値 ${String(v)} の理由`);
    assert.equal(app.getArrangeInterval().sec, P.INTERVAL_DEFAULT_SEC, '直前の値が保たれる');
    assert.equal(field(app).value, P.INTERVAL_DEFAULT_SEC);
    const msg = app.getState().message?.text ?? '';
    assert.ok(msg.trim(), `値 ${String(v)} の理由が示される`);
  }
  scheduler.advanceTo(10_000); // 数え直されていない（起動から 10 秒の時点で再配置）
  assert.equal(count(app), 1, '受け付けなかった入力で周期の数え方は変わらない');
});

// FR-080 AC-436
test('FR-080 AC-436: 選んだ周期（0 を含む）はブラウザ内に保存されて再読込後に復元される', async () => {
  const storage = new FakeStorage();
  const a = await arrangeApp({ storage });
  assert.equal(a.app.setArrangeInterval(30).ok, true);
  const b = await arrangeApp({ storage });
  assert.equal(b.app.getArrangeInterval().sec, 30, '再読込後に復元');
  assert.equal(b.app.setArrangeInterval(0).ok, true);
  const c = await arrangeApp({ storage });
  assert.equal(c.app.getArrangeInterval().sec, 0, '0（自動）も復元');
  assert.equal(c.app.getArrangeInterval().auto, true);
  const fresh = await arrangeApp({ storage: new FakeStorage() });
  assert.equal(fresh.app.getArrangeInterval().sec, P.INTERVAL_DEFAULT_SEC, '保存がなければ 10 秒');
});

// FR-080 AC-436
test('FR-080 AC-436: データの初期化では周期は変わらず、セッションファイルに含まれない（読み込んでも周期は変わらない）', async () => {
  const storage = new FakeStorage();
  const { app, env } = await arrangeApp({ storage });
  assert.equal(app.setArrangeInterval(30).ok, true);
  app.commands['session.start']();
  app.setDraft('予算の見直しが必要です'); app.submitDraft(); env.tick(1);
  // セッションファイルに保存（周期 30 の端末）
  const r = await app.commands['file.save']();
  assert.equal(r.ok, true);
  const file = env.downloads.at(-1);
  // 別の端末（周期 45）で読み込んでも周期は変わらない
  const other = await arrangeApp();
  assert.equal(other.app.setArrangeInterval(45).ok, true);
  const lr = await other.app.loadSessionFile({ name: file.filename, type: 'application/json', size: file.data.length, text: file.data });
  assert.equal(lr.ok, true);
  assert.ok(other.app.getState().utterances.some((u) => u.text === '予算の見直しが必要です'), '内容は読み込まれる');
  assert.equal(other.app.getArrangeInterval().sec, 45, 'セッションファイルの読込で周期は変わらない');
  // データの初期化
  app.commands['data.reset']();
  app.dialogAction('confirm');
  assert.equal(app.getState().utterances.length, 0, '初期化された');
  assert.equal(app.getArrangeInterval().sec, 30, 'データの初期化で周期は変わらない');
  app.clearSavedSession();
  const again = await arrangeApp({ storage });
  assert.equal(again.app.getArrangeInterval().sec, 30, '初期化・保存内容の消去の後の再読込でも周期は保たれる');
});

// ---- FR-080 AC-440 ----
// FR-080 AC-440
test('FR-080 AC-440: コマンドの検索から周期の設定を開き、キーボードだけ（打鍵＋Enter、矢印キー）で変更できる', async () => {
  const { app } = await arrangeApp();
  const found = app.searchCommands('再配置');
  assert.ok(found.some((x) => x.command === 'settings.arrangeInterval'), 'コマンドの検索で見つかる');
  app.commands['settings.arrangeInterval']();
  const d = app.getSettingsDialog();
  assert.ok(d && d.open, '設定画面が開く');
  assert.equal(d.focusedField, 'arrange.interval', '周期の項目にフォーカスがある（少ない手順）');
  assert.ok(app.searchCommands(field(app).label).some((x) => x.command === 'settings.arrangeInterval'), '項目のラベルでも見つかる');
  app.setSettingsFieldDraft('arrange.interval', '20');
  assert.equal(app.handleKey({ key: 'Enter' }), 'settings.arrange.commit');
  assert.equal(app.getArrangeInterval().sec, 20);
  assert.equal(app.handleKey({ key: 'ArrowUp' }), 'settings.arrange.step');
  assert.equal(app.getArrangeInterval().sec, 21);
  app.handleKey({ key: 'ArrowDown' }); app.handleKey({ key: 'ArrowDown' });
  assert.equal(app.getArrangeInterval().sec, 19);
  assert.equal(app.handleKey({ key: 'Escape' }), 'settings.close');
  assert.equal(app.getSettingsDialog(), null);
});

// FR-080 AC-440 異常系
test('FR-080 AC-440 異常系: キーボード・マウスの操作で範囲外・不正な値にはならず、値は保たれる', async () => {
  const { app } = await arrangeApp();
  app.commands['settings.arrangeInterval']();
  app.setSettingsFieldDraft('arrange.interval', 'abc');
  app.handleKey({ key: 'Enter' });
  assert.equal(app.getArrangeInterval().sec, P.INTERVAL_DEFAULT_SEC, '整数でない打鍵は確定しない');
  assert.ok(app.getState().message?.text.trim(), '理由が示される');
  // マウス（増減ボタン）
  assert.equal(app.settingsFieldStep('arrange.interval', +1).ok, true);
  assert.equal(app.getArrangeInterval().sec, P.INTERVAL_DEFAULT_SEC + 1);
  assert.equal(app.settingsFieldStep('arrange.interval', -1).ok, true);
  assert.equal(app.getArrangeInterval().sec, P.INTERVAL_DEFAULT_SEC);
  app.setArrangeInterval(0);
  const lo = app.settingsFieldStep('arrange.interval', -1);
  assert.equal(lo.ok, false); assert.equal(lo.reason, 'range');
  app.handleKey({ key: 'ArrowDown' });
  assert.equal(app.getArrangeInterval().sec, 0, '0 より下にならない');
  app.setArrangeInterval(P.INTERVAL_MAX_SEC);
  assert.equal(app.settingsFieldStep('arrange.interval', +1).ok, false);
  app.handleKey({ key: 'ArrowUp' });
  assert.equal(app.getArrangeInterval().sec, P.INTERVAL_MAX_SEC, '300 より上にならない');
});

// FR-080 AC-440
test('FR-080 AC-440: 項目のラベルは 6 文字以内（英語は半角 12 文字）で表示言語に従い、周期の表示も切り替わる', async () => {
  const { app } = await arrangeApp();
  app.commands['settings.open']();
  app.setArrangeInterval(0);
  const ja = { label: field(app).label, text: app.getArrangeInterval().text };
  assert.ok(ja.label.trim() && weight(ja.label) <= P.LABEL_MAX, `ja「${ja.label}」`);
  assert.ok(ja.text.includes(AUTO_JA));
  app.setLang('en');
  const en = { label: field(app).label, text: app.getArrangeInterval().text };
  assert.ok(en.label.trim() && weight(en.label) <= P.LABEL_MAX, `en「${en.label}」`);
  assert.notEqual(en.label, ja.label, '表示言語に従う');
  assert.ok(en.text.trim() && en.text !== ja.text && !CJK.test(en.text), `en の周期の表示「${en.text}」`);
  assert.ok(app.searchCommands('arrange').some((x) => x.command === 'settings.arrangeInterval'), '英語でもコマンドの検索で見つかる');
  const keys = (a) => Object.keys(a.getStrings()).filter((k) => k.startsWith('arrange.')).sort();
  const enKeys = keys(app); app.setLang('ja'); const jaKeys = keys(app);
  assert.ok(jaKeys.length > 0); assert.deepEqual(enKeys, jaKeys);
});

// FR-080 AC-440
test('FR-080 AC-440: 設定の変更の結果は読み上げ対象のメッセージで示され、周期ごとの再配置そのものはメッセージを出さない', async () => {
  const { app, env, scheduler } = await arrangeApp();
  toDetail(app);
  app.commands['session.start']();
  app.commands['settings.open']();
  assert.equal(app.setArrangeInterval(15).ok, true);
  const msg = app.getState().message;
  assert.ok(msg && msg.text.includes(app.getArrangeInterval().text), '変更の結果（新しい周期）がメッセージに出る');
  assert.equal(app.getCommandBar().status.role, 'status');
  scheduler.advanceTo(1000); say(env, T.plain1);
  scheduler.advanceTo(2000);
  const before = JSON.stringify(app.getState().message); const c0 = count(app);
  scheduler.advanceTo(15_000);
  assert.equal(count(app), c0 + 1, '周期の時点で再配置された');
  assert.equal(JSON.stringify(app.getState().message), before, '再配置はメッセージを出さない');
});
