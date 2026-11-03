// FR-072 AC-647（System Test。実ブラウザ＝Chromium 系を playwright-core で起動して測る。ribbon-primary.test.js と同じ方式）
// 期待値は受入基準だけから決める（実装は読まない。要素の場所は既存のテストが使う [data-command="session.*"]・#ribbon-toggle だけ）。
//  AC-647: 記録グループのボタンの押下の強調は、その操作が実際に有効なときだけ付く。
//          準備中（アプリの初期状態）は、記録グループのどのボタンも押されていない表示（aria-pressed が真でない。強調の見た目もない）。
//          記録中は [記録開始]・[再開] が押されている表示、一時停止は [一時停止] が押されている表示で [記録開始]・[再開] は押されていない表示に戻り、
//          停止・準備中に戻るとすべて押されていない表示に戻る。[終了]・[次シーン]・[入力] は押下の強調を付けない。
//          折りたたみ中のバーに複製したボタン（AC-645）も同じ状態を示す。状態は支援技術に伝わり、色だけで示されない（NFR-A11Y-001）。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serveWeb, launch, openApp, startRecording, command, sessionOf } from './perf-util.js';

const WIN = { width: 1024, height: 768 }; // AC-645 と同じ窓（リボンが起動時の既定で折りたたまれる）
const GROUP = ['session.start', 'session.pause', 'session.resume', 'session.stop', 'session.nextScene', 'input.focus'];
const PRESSABLE = ['session.start', 'session.resume', 'session.pause'];

let srv; let browser;
before(async () => { srv = await serveWeb(); browser = await launch(); });
after(async () => { await browser?.close(); await srv?.close(); });

async function withApp(fn) {
  const { ctx, page } = await openApp(browser, srv.url, WIN);
  try { return await fn(page); } finally { await ctx.close(); }
}

// 記録グループの全ボタン（折りたたみ中のバーの複製も含む）の、押下の表示と強調の見た目。
const snapshot = (page) => page.evaluate((cmds) => {
  document.activeElement?.blur?.();
  const out = {};
  for (const c of cmds) {
    out[c] = [...document.querySelectorAll(`[data-command="${c}"]`)].map((el) => {
      const cs = getComputedStyle(el);
      return { pressed: el.getAttribute('aria-pressed'), cls: [...el.classList], look: [cs.backgroundColor, cs.boxShadow, cs.borderTopColor, cs.outlineStyle, cs.fontWeight, cs.color].join('|') };
    });
  }
  return out;
}, GROUP);

const isOn = (b) => b.pressed === 'true';
const anyOn = (snap, cmd) => snap[cmd].some(isOn);
const allOn = (snap, cmd) => snap[cmd].length > 0 && snap[cmd].every(isOn);

function assertNoneOn(snap, label) {
  for (const c of GROUP) {
    assert.ok(snap[c].length > 0, `${label}: ${c} のボタンが存在しない`);
    assert.ok(!anyOn(snap, c), `${label}: ${c} が押されている表示になっている ${JSON.stringify(snap[c])}`);
    // AC-647: aria-pressed が真でないことに加え、押下用のスタイルクラスが付かない。
    for (const b of snap[c]) assert.ok(!b.cls.some((k) => /press|active|selected|(^|[-_])on$/i.test(k)), `${label}: ${c} に押下用のスタイルクラスが付いている ${JSON.stringify(b.cls)}`);
  }
}

// FR-072 AC-647
test('FR-072 AC-647: 準備中（起動直後）は記録グループのどのボタンも押されていない表示で、記録中は開始、一時停止は一時停止だけが押されている表示になり、停止で全部戻る', async () => {
  await withApp(async (page) => {
    assert.equal(await page.locator('#ribbon-toggle').getAttribute('aria-expanded'), 'false', '前提: 折りたたまれた状態（複製ボタンも対象）');
    assert.equal(await sessionOf(page), 'preparing');
    const base = await snapshot(page);
    assertNoneOn(base, '準備中');

    await startRecording(page);
    await page.waitForFunction(() => globalThis.__app.getState().session === 'recording');
    const rec = await snapshot(page);
    assert.ok(allOn(rec, 'session.start'), `記録中: [記録開始] がすべて押されている表示でない ${JSON.stringify(rec['session.start'])}`);
    assert.ok(allOn(rec, 'session.resume'), `記録中: [再開] が押されている表示でない ${JSON.stringify(rec['session.resume'])}`);
    assert.ok(!anyOn(rec, 'session.pause'), '記録中: [一時停止] は押されていない');
    for (const c of ['session.stop', 'session.nextScene', 'input.focus']) assert.ok(!anyOn(rec, c), `記録中: ${c} は状態を持たない操作で押下の強調を付けない`);
    // 色だけで示されない: 押された表示と押されていない表示で、aria-pressed が支援技術に伝わる（属性の値が異なる）。
    assert.notDeepEqual(rec['session.start'].map((b) => b.pressed), base['session.start'].map((b) => b.pressed));
    // 強調の見た目も押下のときだけ付く（準備中の見た目と記録中の見た目が異なる）。
    assert.notDeepEqual(rec['session.start'].map((b) => b.look), base['session.start'].map((b) => b.look), '記録中の [記録開始] に強調の見た目がある');

    await command(page, 'session.pause');
    await page.waitForFunction(() => globalThis.__app.getState().session === 'paused');
    const paused = await snapshot(page);
    assert.ok(allOn(paused, 'session.pause'), `一時停止: [一時停止] が押されている表示でない ${JSON.stringify(paused['session.pause'])}`);
    assert.ok(!anyOn(paused, 'session.start') && !anyOn(paused, 'session.resume'), '一時停止: [記録開始]・[再開] は押されていない表示に戻る');
    assert.deepEqual(paused['session.start'].map((b) => b.look), base['session.start'].map((b) => b.look), '一時停止: [記録開始] の見た目も強調なし');

    await command(page, 'session.stop');
    await page.waitForFunction(() => globalThis.__app.getState().session === 'stopped');
    const stopped = await snapshot(page);
    assertNoneOn(stopped, '停止');
    assert.deepEqual(stopped['session.start'].map((b) => b.look), base['session.start'].map((b) => b.look), '停止: 強調の見た目もない');
  });
});

// FR-072 AC-647 異常系: リボンを開いた状態（複製でない元のボタン）でも同じ。一時停止→再開で戻り、強調は押せない操作（終了・次シーン・入力）に付かない。
test('FR-072 AC-647 異常系: リボンを開いた状態でも同じ。一時停止から再開すると [一時停止] の強調が消えて [再開]・[記録開始] が押された表示に戻り、押せない操作に強調が付かない', async () => {
  await withApp(async (page) => {
    await page.locator('#ribbon-toggle').click();
    assert.equal(await page.locator('#ribbon-toggle').getAttribute('aria-expanded'), 'true');
    assertNoneOn(await snapshot(page), '準備中（リボンを開いた状態）');
    await startRecording(page);
    await page.waitForFunction(() => globalThis.__app.getState().session === 'recording');
    await command(page, 'session.pause');
    await page.waitForFunction(() => globalThis.__app.getState().session === 'paused');
    const paused = await snapshot(page);
    assert.ok(allOn(paused, 'session.pause'));
    await command(page, 'session.resume');
    await page.waitForFunction(() => globalThis.__app.getState().session === 'recording');
    const resumed = await snapshot(page);
    assert.ok(!anyOn(resumed, 'session.pause'), '再開すると [一時停止] の強調は消える');
    assert.ok(allOn(resumed, 'session.start') && allOn(resumed, 'session.resume'), '再開すると記録中の押された表示に戻る');
    for (const c of ['session.stop', 'session.nextScene', 'input.focus']) assert.ok(!anyOn(resumed, c), `${c} に押下の強調を付けない`);
    // 折りたたみ直しても、複製が元と同じ状態を示す。
    await page.locator('#ribbon-toggle').click();
    assert.equal(await page.locator('#ribbon-toggle').getAttribute('aria-expanded'), 'false');
    const collapsed = await snapshot(page);
    for (const c of PRESSABLE) assert.equal(new Set(collapsed[c].map((b) => b.pressed)).size, 1, `${c} の複製どうしで押下の状態が食い違う`);
    assert.ok(!anyOn(collapsed, 'session.pause'));
  });
});
