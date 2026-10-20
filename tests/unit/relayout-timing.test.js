// FR-080 再配置の周期の設定と、周期 0 での会話の区切りの自動判定の単体・結合テスト（AC-435〜440）。
// 時計はテスト用の時計（scheduler・now の注入）で進める。実装は web/src/relayout.js（時点・設定）・web/src/ui.js（設定画面の描画）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';
import {
  parseIntervalInput, isValidSec, INTERVAL_DEFAULT_SEC, INTERVAL_MAX_SEC, SILENCE_SEC, HOLD_MAX_SEC, INTERVAL_KEY,
} from '../../web/src/relayout.js';

function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
class Sched {
  constructor(clock) { this.t = 0; this.q = []; this.n = 1; this.clock = clock; }
  setTimeout(fn, ms) { const id = this.n++; this.q.push({ id, at: this.t + ms, fn }); return id; }
  clearTimeout(id) { this.q = this.q.filter((e) => e.id !== id); }
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      const next = this.q.filter((e) => e.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      this.q = this.q.filter((e) => e !== next); this.t = next.at; this.clock.t = 1e12 + this.t; next.fn();
    }
    this.t = end; this.clock.t = 1e12 + end;
  }
  to(at) { this.advance(at - this.t); }
}
class Speech {
  constructor() { this.onresult = null; this.onerror = null; this.onend = null; }
  availabilityFor() { return 'local'; }
  start() {} stop() {}
  emit(text, isFinal = true) { this.onresult?.({ text, isFinal }); }
}
class Vis { constructor() { this.hidden = false; this.onchange = null; } set(h) { this.hidden = h; this.onchange?.(); } }

async function mk({ storage = mem(), interval, visibility, start = true } = {}) {
  const clock = { t: 1e12 }; const sched = new Sched(clock); const speech = new Speech();
  const app = await createApp({ storage, scheduler: sched, now: () => clock.t, speechSource: speech, env: { webgl: false, reducedMotion: false, viewportWidth: 1280 }, ...(visibility ? { visibility } : {}) });
  app.setDetailLevel('detail');
  if (interval != null) assert.equal(app.setArrangeInterval(interval).ok, true);
  if (start) { app.commands['session.start'](); app.startSpeech?.(); }
  const count = () => app.getArrangeStatus().count;
  return { app, sched, speech, storage, count };
}

// ---- 入力の判定（AC-436） ----
// FR-080 AC-436
test('FR-080 AC-436: 周期の入力の判定（数値・入力欄の文字列。空・整数でない・範囲外を区別）', () => {
  assert.deepEqual(parseIntervalInput(0), { ok: true, sec: 0 });
  assert.deepEqual(parseIntervalInput(INTERVAL_MAX_SEC), { ok: true, sec: INTERVAL_MAX_SEC });
  assert.deepEqual(parseIntervalInput(' 25 '), { ok: true, sec: 25 });
  assert.deepEqual(parseIntervalInput('+7'), { ok: true, sec: 7 });
  for (const v of ['', '  ', null, undefined]) assert.equal(parseIntervalInput(v).reason, 'empty', String(v));
  for (const v of [1.5, '1.5', 'abc', '1e2', '0x10', Number.NaN, Number.POSITIVE_INFINITY, true, {}]) assert.equal(parseIntervalInput(v).reason, 'not_integer', String(v));
  for (const v of [-1, INTERVAL_MAX_SEC + 1, '-5', '301']) assert.equal(parseIntervalInput(v).reason, 'range', String(v));
  assert.equal(isValidSec(INTERVAL_DEFAULT_SEC), true);
  assert.equal(INTERVAL_DEFAULT_SEC, 10); assert.equal(INTERVAL_MAX_SEC, 300); assert.equal(SILENCE_SEC, 3); assert.equal(HOLD_MAX_SEC, 30);
});

// FR-080 AC-436
test('FR-080 AC-436: 周期は grp. のキーに保存され、壊れた・範囲外の保存値は初期値 10 秒で起動する', async () => {
  const storage = mem();
  const a = await mk({ storage, start: false });
  assert.equal(a.app.setArrangeInterval(42).ok, true);
  assert.ok(INTERVAL_KEY.startsWith('grp.'));
  assert.deepEqual(JSON.parse(storage.getItem(INTERVAL_KEY)), { intervalSec: 42 });
  for (const bad of ['{', '{"intervalSec":301}', '{"intervalSec":1.5}', '"x"']) {
    const s = mem(); s.setItem(INTERVAL_KEY, bad);
    const b = await mk({ storage: s, start: false });
    assert.equal(b.app.getArrangeInterval().sec, INTERVAL_DEFAULT_SEC, bad);
  }
});

// FR-080 AC-436
test('FR-080 AC-436: 同じ値への変更では数え直さない。周期 0→P の変更で区切りの判定をやめ、変更の時点から P 秒ごとになる', async () => {
  const { app, sched, count } = await mk();
  sched.to(4000);
  assert.equal(app.setArrangeInterval(10).ok, true); // 同じ値
  app.setDraft('会議室は三階にあります'); app.submitDraft();
  sched.to(10_000);
  assert.equal(count(), 1, '起動から 10 秒の時点（数え直していない）');
  app.setArrangeInterval(0);
  sched.to(11_000); app.setDraft('参加者は八名でした'); app.submitDraft();
  app.setArrangeInterval(7); // 区切り（無音）の判定を取りやめ、11 秒から 7 秒ごと
  sched.to(17_999);
  assert.equal(count(), 1, '無音の区切りでは再配置されない');
  sched.to(18_000);
  assert.equal(count(), 2, '変更の時点から 7 秒');
});

// ---- 会話の区切り（AC-437） ----
// FR-080 AC-437 (a)
test('FR-080 AC-437 (a): 周期 0 では、最後の確定結果から 3 秒、確定・暫定の結果がどちらも届かない時点で再配置される', async () => {
  const { app, sched, speech, count } = await mk({ interval: 0 });
  sched.to(1000); speech.emit('会議室は三階にあります', true);
  sched.advance(0);
  const c0 = count(); // 最初のシーン（新しいトピック）で再配置されている
  sched.to(1500); speech.emit('資料は共有', true);
  assert.equal(app.getArrangeStatus().pending, true);
  sched.to(1500 + SILENCE_SEC * 1000 - 1);
  assert.equal(count(), c0, '3 秒経つまでは再配置しない');
  sched.to(1500 + SILENCE_SEC * 1000);
  assert.equal(count(), c0 + 1, '無音 3 秒で再配置');
  assert.equal(app.getArrangeStatus().pending, false);
});

// FR-080 AC-437 (a) 異常系
test('FR-080 AC-437 (a) 異常系: 暫定結果が届き続けている間（発話の途中）は無音の区切りにならない', async () => {
  const { app, sched, speech, count } = await mk({ interval: 0 });
  sched.to(500); speech.emit('会議室は三階にあります', true);
  sched.to(4000); speech.emit('資料は共有フォルダに置きました', true);
  const c0 = count();
  assert.equal(app.getArrangeStatus().pending, true);
  for (let at = 5000, i = 1; at <= 12_000; at += 1000, i++) { sched.to(at); speech.emit(`次回は${'木'.repeat(i)}`, false); }
  assert.equal(count(), c0, '暫定結果が届いている間は再配置しない');
  sched.to(12_000 + SILENCE_SEC * 1000 - 1);
  assert.equal(count(), c0);
  sched.to(12_000 + SILENCE_SEC * 1000);
  assert.equal(count(), c0 + 1, '最後の暫定結果から 3 秒の無音で再配置');
});

// FR-080 AC-437 (b)
test('FR-080 AC-437 (b): シーンが確定する（「次のシーン」の操作）と、その時点で再配置される', async () => {
  const { app, sched, count } = await mk({ interval: 0 });
  sched.to(500); app.setDraft('会議室は三階にあります'); app.submitDraft();
  sched.to(3000); app.setDraft('資料は共有フォルダに置きました'); app.submitDraft(); // 無音 3 秒の前
  const c0 = count();
  assert.equal(app.getArrangeStatus().pending, true);
  sched.to(3500); app.commands['session.nextScene']();
  sched.advance(0);
  assert.equal(count(), c0 + 1, 'シーンの確定で再配置');
  assert.equal(app.getArrangeStatus().pending, false);
});

// FR-080 AC-437 (b)
test('FR-080 AC-437 (b): 無音間隔の超過（AC-008）でシーンが確定したときも再配置される', async () => {
  const clock = { t: 1e12 }; const sched = new Sched(clock); const speech = new Speech();
  const app = await createApp({ storage: mem(), scheduler: sched, now: () => clock.t, speechSource: speech, sceneGapMs: 1500, env: { webgl: false, reducedMotion: false, viewportWidth: 1280 } });
  app.setDetailLevel('detail'); app.setArrangeInterval(0); app.commands['session.start']();
  sched.to(500); app.setDraft('会議室は三階にあります'); app.submitDraft();
  sched.to(1500); app.setDraft('会議室の予約は三階'); app.submitDraft(); // 同じトピック
  sched.to(3400); // 無音 3 秒の前に、無音間隔（1.5 秒）を超えた次の発話
  const c0 = app.getArrangeStatus().count;
  app.setDraft('会議室の三階の鍵'); app.submitDraft();
  assert.equal(app.getState().scenes[0].status, 'confirmed', '前のシーンが確定');
  sched.advance(0);
  assert.equal(app.getArrangeStatus().count, c0 + 1);
});

// FR-080 AC-437 (c)
test('FR-080 AC-437 (c): 新しいトピックが生まれると、その時点で再配置される', async () => {
  const { app, sched, count } = await mk({ interval: 0 });
  sched.to(500); app.setDraft('会議室は三階にあります'); app.submitDraft();
  sched.to(3600); // 無音で再配置済み
  const c0 = count();
  const t0 = app.getTopics().length;
  sched.to(4000); app.commands['session.nextScene'](); // 確定済みのシーンの区切り（新しい要素はない）
  sched.advance(0);
  assert.equal(count(), c0, '新しい要素がない区切りでは再配置されない');
  sched.to(4500); app.setDraft('次回は木曜の午後です'); app.submitDraft(); // 語を共有しない新しいシーン＝新しいトピック
  assert.equal(app.getTopics().length, t0 + 1);
  sched.advance(0);
  assert.equal(count(), c0 + 1, '新しいトピックの発生で再配置');
});

// FR-080 AC-437 異常系
test('FR-080 AC-437 異常系: 区切りが起きても、前の再配置以降に新しい要素が加わっていなければ再配置されない', async () => {
  const { app, sched, speech, count } = await mk({ interval: 0 });
  sched.to(500); speech.emit('会議室は三階にあります', true);
  sched.to(5000);
  const c0 = count();
  assert.equal(app.getArrangeStatus().pending, false);
  speech.emit('途中の暫定', false); // 暫定結果だけ
  app.setDraft(''); app.submitDraft(); // 受け付けられない入力
  app.commands['session.stop'](); // シーンの確定
  sched.to(60_000);
  assert.equal(count(), c0);
});

// FR-080 AC-437
test('FR-080 AC-437: 同じ発話列と受付時刻からは毎回同じ時点で再配置される（決定的）', async () => {
  const run = async () => {
    const { app, sched, speech } = await mk({ interval: 0 });
    const times = [];
    let last = app.getArrangeStatus().count;
    app.subscribe(() => { const c = app.getArrangeStatus().count; if (c !== last) { last = c; times.push(sched.t); } });
    const script = [[300, '会議室は三階にあります', true], [900, '会議室の', false], [1400, '会議室の予約', true], [6000, '次回は木曜の午後です', true], [6500, '次回は', false], [7100, '参加者は八名でした', true]];
    for (const [at, text, fin] of script) { sched.to(at); speech.emit(text, fin); }
    app.commands['session.nextScene']();
    sched.to(9000); speech.emit('資料は共有フォルダに置きました', true);
    sched.to(60_000);
    return times;
  };
  const a = await run(); const b = await run();
  assert.ok(a.length >= 2, `再配置の時点: ${a}`);
  assert.deepEqual(b, a);
});

// ---- 保留の上限（AC-438） ----
// FR-080 AC-438
test('FR-080 AC-438: 区切りが来ないまま発話が続いても、最初の追加から 30 秒を超えて保留しない', async () => {
  const { app, sched, speech, count } = await mk({ interval: 0 });
  sched.to(500); speech.emit('会議室は三階にあります', true);
  sched.to(4000); // 無音で再配置済み
  const c0 = count();
  const first = 5000;
  sched.to(first); speech.emit('会議室の予約は三階です', true); // 同じシーン・同じトピック（区切りにならない）
  for (let at = first + 1000; at < first + HOLD_MAX_SEC * 1000; at += 1000) { sched.to(at); speech.emit(`会議室の話${at}`, false); } // 暫定結果が続く（発話の途中）
  sched.to(first + HOLD_MAX_SEC * 1000 - 1);
  assert.equal(count(), c0, '30 秒までは保留できる（区切りがない）');
  sched.to(first + HOLD_MAX_SEC * 1000);
  assert.equal(count(), c0 + 1, '最初の追加から 30 秒の時点で再配置');
  assert.equal(app.getArrangeStatus().pending, false);
});

// FR-080 AC-438
test('FR-080 AC-438: 保留の上限は「前の再配置以降の最初の追加」から数え、後の追加で延びない', async () => {
  const { sched, speech, count } = await mk({ interval: 0 });
  sched.to(500); speech.emit('会議室は三階にあります', true);
  sched.to(4000);
  const c0 = count();
  speech.emit('会議室の予約は三階', true); // 4000: 最初の追加
  for (let at = 6000; at <= 34_000; at += 2000) { sched.to(at); speech.emit(`会議室の件${at}`, true); } // 2 秒おきの確定（無音 3 秒にならない）
  assert.equal(count(), c0 + 1, '4000+30000=34000 の時点で再配置（追加が続いても延びない）');
});

// ---- 画面の復帰（AC-435） ----
// FR-080 AC-435 異常系
test('FR-080 AC-435 異常系: 非表示の間に到来した再配置は行わず、復帰後に行う（周期・会話の区切りとも）', async () => {
  const vis = new Vis();
  const { app, sched, speech, count } = await mk({ visibility: vis });
  sched.to(500); speech.emit('会議室は三階にあります', true);
  vis.set(true);
  sched.to(25_000);
  assert.equal(count(), 0, '非表示の間は再配置しない');
  assert.equal(app.getArrangeStatus().pending, true);
  vis.set(false);
  sched.advance(0);
  assert.equal(count(), 1, '復帰の直後に再配置');
  // 周期 0（無音）でも同じ
  app.setArrangeInterval(0);
  vis.set(true);
  sched.to(26_000); speech.emit('会議室の予約は三階', true);
  sched.to(40_000);
  assert.equal(count(), 1);
  vis.set(false); sched.advance(0);
  assert.equal(count(), 2);
});

// FR-080 AC-435
test('FR-080 AC-435: 画面の表示・非表示の購読は、既存の購読（可視に戻ったときの最新化。NFR-BG-001）を保ったまま足す', async () => {
  const vis = new Vis();
  const { app } = await mk({ visibility: vis });
  let n = 0; app.subscribe(() => { n++; });
  vis.set(true); vis.set(false);
  assert.ok(n >= 1, '可視に戻ったときの画面の最新化（speech.js の購読）が残っている');
});

// ---- 設定画面・キーボード・マウス（AC-436・AC-440） ----
// FR-080 AC-440
test('FR-080 AC-440: 設定画面の項目は数値の入力欄（0〜300・1 刻み）で、入力中の文字列を持ち、閉じると破棄される', async () => {
  const { app } = await mk({ start: false });
  app.commands['settings.arrangeInterval']();
  const f = () => app.getSettingsDialog().fields.find((x) => x.id === 'arrange.interval');
  assert.equal(f().role, 'spinbutton');
  assert.deepEqual([f().min, f().max, f().step], [0, 300, 1]);
  assert.equal(f().input.value, '10');
  app.setSettingsFieldDraft('arrange.interval', '4');
  assert.equal(f().input.value, '4');
  assert.equal(app.getArrangeInterval().sec, 10, '確定前は変わらない');
  assert.ok(app.getSettingsView().fields.some((x) => x.id === 'arrange.interval' && x.visible));
  app.commands['settings.close']();
  assert.equal(app.getSettingsDialog(), null);
  app.commands['settings.open']();
  assert.equal(f().input.value, '10', '閉じると入力中の文字列は破棄');
  assert.equal(app.getSettingsDialog().focusedField, null, '開き直したときは周期の項目にフォーカスがない');
  assert.deepEqual(app.setSettingsFieldDraft('nope', 'x'), { ok: false, reason: 'not_found' });
  assert.deepEqual(app.settingsFieldStep('nope', 1), { ok: false, reason: 'not_found' });
});

// FR-080 AC-440
test('FR-080 AC-440: 周期の項目にフォーカスがないときは Enter・矢印キーを横取りしない。キー割り当て（Ctrl+Alt+Shift+Y）で開ける', async () => {
  const { app } = await mk({ start: false });
  const k = app.keymap.find((x) => x.command === 'settings.arrangeInterval');
  assert.ok(k && k.ctrl && k.alt && k.shift);
  app.commands['settings.open']();
  assert.notEqual(app.handleKey({ key: 'Enter' }), 'settings.arrange.commit');
  assert.notEqual(app.handleKey({ key: 'ArrowUp' }), 'settings.arrange.step');
  assert.equal(app.getArrangeInterval().sec, 10);
  assert.equal(app.focusSettingsField('arrange.interval'), true);
  assert.equal(app.handleKey({ key: 'ArrowUp' }), 'settings.arrange.step');
  assert.equal(app.focusSettingsField('llm.enabled'), true, '別の項目に移る');
  assert.equal(app.getSettingsDialog().focusedField, null);
  assert.notEqual(app.handleKey({ key: 'ArrowUp' }), 'settings.arrange.step');
  assert.equal(app.getArrangeInterval().sec, 11);
});

// FR-080 AC-440
test('FR-080 AC-440: 拒否・変更のメッセージは表示言語の切替に追従する', async () => {
  const { app } = await mk({ start: false });
  app.setArrangeInterval('abc');
  const ja = app.getState().message.text;
  app.setLang('en');
  const en = app.getState().message.text;
  assert.ok(en && en !== ja && !/[ぁ-んァ-ン一-龥]/.test(en), en);
  app.setArrangeInterval(0);
  assert.ok(app.getState().message.text.includes('Auto (conversation breaks)'));
  app.setLang('ja');
  assert.ok(app.getState().message.text.includes('自動（会話の区切り）'));
});

// ---- 拡大率と表示位置（AC-439） ----
// FR-080 AC-439
test('FR-080 AC-439: 図の拡大率と表示位置は app が持ち、正でない拡大率・数でない位置は受け付けない', async () => {
  const { app } = await mk({ start: false });
  assert.deepEqual(app.getDiagramView(), { zoom: 1, scrollX: 0, scrollY: 0 });
  assert.equal(app.setDiagramView({ zoom: 1.5, scrollX: 40, scrollY: 30 }).ok, true);
  for (const bad of [{ zoom: 0 }, { zoom: -1 }, { zoom: Number.NaN }, { zoom: '2' }, { scrollX: 'a' }, null]) assert.equal(app.setDiagramView(bad).ok, false, JSON.stringify(bad));
  assert.deepEqual(app.getDiagramView(), { zoom: 1.5, scrollX: 40, scrollY: 30 });
  let n = 0; const off = app.subscribe(() => { n++; });
  app.setDiagramView({ scrollX: 50 }, { silent: true });
  assert.equal(n, 0, 'UI からのスクロールの反映は再描画を起こさない');
  off();
  assert.equal(app.getDiagramView().scrollX, 50);
});
