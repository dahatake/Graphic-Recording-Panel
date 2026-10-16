// FR-023 AC-118 AC-119 AC-120 AC-122（System Test。契約: tests/system/CONTRACT.md「取込の処理中表示と再取込」）
// 期待値は受入基準だけから決める。AC-121 は検証レベル integration のため対象外。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newApp, makeEnv, loadApp, WEB, toDetail } from './helpers.js';

const file = (name, text, extra = {}) => ({
  name, type: extra.type ?? 'text/vtt', size: extra.size ?? Buffer.byteLength(text), text,
});
const vttOf = (n) => ['WEBVTT', '', ...Array.from({ length: n }, (_, i) => [
  `00:00:${String(i % 60).padStart(2, '0')}.000 --> 00:00:${String(i % 60).padStart(2, '0')}.500`, `<v A>発話${i}</v>`, '']).flat()].join('\n');
const flush = () => new Promise((r) => setImmediate(r));

// importYield の呼び出しごとに止まる関門
function gated() {
  const gate = { waiters: [], calls: 0 };
  gate.importYield = () => { gate.calls++; return new Promise((r) => gate.waiters.push(r)); };
  gate.release = async () => { const w = gate.waiters.shift(); if (w) w(); await flush(); return !!w; };
  return gate;
}
async function appWith(gate) {
  const env = makeEnv({ options: gate ? { importYield: gate.importYield } : {} });
  const createApp = await loadApp();
  const app = await createApp(env.options);
  return { app, env };
}

test('FR-023 AC-118: 取込を始めた時点で処理中表示が出て（1 秒以内）、処理済み cue 数と全 cue 数が更新され、完了で処理中でなくなる', async () => {
  const gate = gated();
  const { app, env } = await appWith(gate);
  app.commands['session.start']();
  const p = app.importTextFile(file('big.vtt', vttOf(250)));
  let s = app.getImportStatus();
  assert.equal(s.state, 'processing');
  assert.equal(s.total, 250);
  assert.ok(s.processed >= 0 && s.processed < 250);
  assert.ok(s.text.length > 0);
  await flush();
  env.scheduler.advance(1000);
  s = app.getImportStatus();
  assert.equal(s.state, 'processing', '1 秒（PARAM-014）経過後も、処理の間は処理中の表示が続く');
  let prev = s.processed;
  let moved = false;
  for (let i = 0; i < 20 && gate.waiters.length >= 0; i++) {
    await flush();
    if (!(await gate.release())) { if (app.getImportStatus().state !== 'processing') break; continue; }
    const cur = app.getImportStatus();
    assert.ok(cur.processed >= prev, '処理済み cue 数は減らない');
    assert.ok(cur.processed <= cur.total);
    if (cur.processed > prev) moved = true;
    prev = cur.processed;
  }
  assert.ok(moved, '処理の間に処理済み cue 数が更新される');
  while (await gate.release()) { /* 残りを流す */ }
  const r = await p;
  assert.equal(r.ok, true);
  const done = app.getImportStatus();
  assert.notEqual(done.state, 'processing');
  assert.equal(done.state, 'done');
});

test('FR-023 AC-118 異常系: 失敗（WEBVTT ではない。記録中かどうかは無関係）でも処理中の表示は消える', async () => {
  const { app } = await newApp();
  const p = app.importTextFile(file('m.vtt', '一行目\n二行目\n'));
  const r = await p;
  assert.equal(r.ok, false);
  assert.notEqual(app.getImportStatus().state, 'processing');
  assert.equal(app.getImportStatus().state, 'failed');
});

test('FR-023 AC-119: 完了で追加件数が文字で表示され、状態名の文字を持ち、画面の読み上げ対象（status）である', async () => {
  const { app } = await newApp();
  app.commands['session.start']();
  const r = await app.importTextFile(file('m.vtt', vttOf(7)));
  assert.equal(r.ok, true);
  const s = app.getImportStatus();
  assert.equal(s.state, 'done');
  assert.equal(s.added, 7);
  assert.ok(s.text.includes('7'), '件数が表示される');
  assert.ok(s.label.length > 0 && s.text.includes(s.label), '色だけでなく文字で状態を示す');
  assert.ok(['status', 'alert'].includes(s.role));
  assert.ok(['polite', 'assertive'].includes(s.live));
});

test('FR-023 AC-119 異常系: 上限超過・WEBVTT でない・空・テキストでない、のどれでも原因と次の操作が出て既存の発話は不変（記録中でないことは理由にならない。FR-039）', async () => {
  const { app } = await newApp();
  const v = vttOf(3);
  const prep = await app.importTextFile(file('m.vtt', v));
  assert.equal(prep.ok, true, '準備中でも取り込める');
  assert.equal(app.getImportStatus().state, 'done');
  assert.ok(!app.getImportStatus().text.includes('記録を開始'));
  for (const setup of [[], ['session.start'], ['session.start', 'session.pause'], ['session.start', 'session.stop']]) {
    const { app: app2 } = await newApp();
    await failCases(app2, v, setup);
  }
});

async function failCases(app, v, setup) {
  let s;
  const r0 = await app.importTextFile(file('ok.txt', '既存', { type: 'text/plain' }));
  assert.equal(r0.ok, true);
  for (const c of setup) app.commands[c]();
  const cases = [
    file('big.vtt', v, { size: 2_000_000 }),
    file('fake.vtt', '一行目\n二行目\n'),
    file('empty.vtt', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v 話者></v>\n'),
    { name: 'bin.vtt', type: 'application/octet-stream', size: 10, text: null },
  ];
  for (const c of cases) {
    const r = await app.importTextFile(c);
    assert.equal(r.ok, false, c.name);
    s = app.getImportStatus();
    assert.equal(s.state, 'failed', c.name);
    assert.ok(s.reason && s.reason.length > 0, `${c.name}: 原因`);
    assert.ok(s.nextAction && s.nextAction.length > 0, `${c.name}: 次の操作`);
    assert.ok(s.text.includes(s.label), `${c.name}: 文字で識別`);
    assert.ok(['status', 'alert'].includes(s.role));
    assert.deepEqual(app.getState().utterances.map((u) => u.text), ['既存'], `${c.name}: 既存の発話は不変`);
  }
}

test('FR-023 AC-120 FR-039: 準備中・一時停止・停止でも、記録を開始・再開せずに取り込め、同じファイルの再取込もできる', async () => {
  for (const setup of [[], ['session.start', 'session.pause'], ['session.start', 'session.stop']]) {
    const { app } = await newApp();
    for (const c of setup) app.commands[c]();
    const before = app.getState().session;
    const f = file('same.vtt', vttOf(3));
    const first = await app.importTextFile(f);
    assert.equal(first.ok, true, `${before}: 取込できる`);
    assert.equal(app.getImportStatus().inputReset, true, '同じファイルを再選択できるよう選択値が戻る');
    assert.equal(app.getState().session, before, '状態は変わらない');
    const again = await app.importTextFile(f);
    assert.equal(again.ok, true);
    assert.equal(app.getState().utterances.length, 6);
    assert.equal(app.getImportStatus().state, 'done');
  }
});

test('FR-023 AC-120 異常系: 取込に失敗したあとも同じ名前のファイルを選び直して実行でき、失敗が再選択を妨げない', async () => {
  const { app } = await newApp();
  app.commands['session.start']();
  const bad = await app.importTextFile(file('same.vtt', '一行目\n'));
  assert.equal(bad.ok, false);
  assert.equal(app.getImportStatus().inputReset, true);
  const bad2 = await app.importTextFile(file('same.vtt', '一行目\n'));
  assert.equal(bad2.ok, false);
  assert.equal(app.getImportStatus().state, 'failed', '2 回目も実行され結果が出る');
  const good = await app.importTextFile(file('same.vtt', vttOf(2)));
  assert.equal(good.ok, true);
  assert.equal(app.getState().utterances.length, 2);
});

test('FR-023 AC-122: 取込の完了から 3 秒以内に認識文字列の一覧と図（SVG・テキスト一覧）に反映される', async () => {
  const { app, env } = await newApp(); toDetail(app);
  app.commands['session.start']();
  const r = await app.importTextFile(file('m.vtt', vttOf(3)));
  assert.equal(r.ok, true);
  env.scheduler.advance(3000);
  assert.deepEqual(app.getTranscript().finals.map((f) => f.text), ['発話0', '発話1', '発話2']);
  const svg = app.renderSvg(); const outline = app.renderOutline();
  assert.ok(app.getState().scenes.length >= 1);
  for (const s of app.getState().scenes) {
    assert.ok(svg.includes(`data-scene-id="${s.id}"`));
    assert.ok(outline.includes(s.heading));
  }
});

test('FR-023 AC-122 異常系: 取り込めなかったときは認識文字列の一覧と図は変わらない', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  const before = [app.renderSvg(), app.renderOutline(), JSON.stringify(app.getTranscript().finals)];
  await app.importTextFile(file('fake.vtt', '一行目\n'));
  env.scheduler.advance(3000);
  assert.deepEqual([app.renderSvg(), app.renderOutline(), JSON.stringify(app.getTranscript().finals)], before);
});

test('FR-023 AC-122: キーボードだけで取込の選択・実行・状態の確認ができる（コマンド・ファイル入力・status 要素）', async () => {
  const { app } = await newApp();
  assert.equal(typeof app.commands['file.import'], 'function');
  assert.ok(app.keymap.some((k) => k.command === 'file.import'), 'keymap に割り当て');
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(html, /<input[^>]*id="import-file"[^>]*type="file"|<input[^>]*type="file"[^>]*id="import-file"/);
  const st = html.match(/<[^>]*id="import-status"[^>]*>/);
  assert.ok(st, 'id="import-status" がある');
  assert.match(st[0], /role="(status|alert)"/);
  assert.match(st[0], /aria-live=/);
  assert.ok(!/tabindex="[1-9]/.test(html), '正の tabindex を使わない');
});
