// FR-117 AC-683 AC-684（System Test。契約: tests/system/CONTRACT-BATCH.md「2.」）
// 期待値は受入基準だけから決める（PARAM-011=6 全角/半角 12、PARAM-170=40、PARAM-001/098/099/100 は更新間隔）。AC-685 は検証レベル integration のため対象外。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, FakeSpeech } from './helpers.js';
import { serveWeb, launch, openApp } from './perf-util.js';
import { weight, P, TXT, modeItems, batchStyleItems, snapshot, finals } from './batch-util.js';

const itemOf = (app, mode) => modeItems(app).find((i) => i.command === `inputMode.set:${mode}`);
const pressed = (app) => modeItems(app).filter((i) => i.pressed === true).map((i) => i.command.replace('inputMode.set:', ''));
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

// FR-117 AC-683
test('FR-117 AC-683: 最上部に「音声取込」「ファイル読込」の 2 項目が、アイコン・名称（6 文字以内）・短い説明（40 文字以内）つきで常時表示され、初期値は音声取込で、現在の項目だけ aria-pressed が真で色以外の印がある（ja・en）', async () => {
  const { app } = await newApp();
  assert.equal(app.getCommandBar().position, 'top');
  assert.ok(app.getCommandBar().groups.some((g) => g.id === 'inputMode'), 'inputMode グループがある');
  assert.deepEqual(modeItems(app).map((i) => i.command), ['inputMode.set:live', 'inputMode.set:batch']);
  assert.equal(app.getInputMode().mode, 'live', '初期値は音声取込');
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    for (const it of modeItems(app)) {
      assert.ok(typeof it.icon === 'string' && it.icon.trim(), `${lang} ${it.command}: アイコン`);
      assert.ok(it.label.trim(), `${lang}: 名称`);
      if (lang === 'ja') assert.ok(weight(it.label) <= P.LABEL_MAX, `名称は全角 6 文字以内（${it.label}）`);
      else assert.ok([...it.label].length <= 12, `name ≤ 12 chars（${it.label}）`);
      assert.ok(it.description.trim() && weight(it.description) <= P.DESC_MAX, `短い説明は 40 文字以内（${it.description}）`);
      assert.equal(it.labelVisible, true, 'ホバー・フォーカスを待たずに常時表示');
      assert.equal(it.accessibleName, it.label);
      assert.equal(it.tabbable, true);
    }
    assert.notEqual(modeItems(app)[0].label, modeItems(app)[1].label);
  }
  app.setLang('ja');
  assert.match(itemOf(app, 'live').label, /音声/); assert.match(itemOf(app, 'batch').label, /ファイル/);
  // 名称と説明の区別（2026-11-07・監査 C-05）: 「リアルタイム」「バッチ」はモードの呼び名で、名称ではなく説明・ツールチップに回す
  assert.equal(itemOf(app, 'live').label, '音声取込'); assert.equal(itemOf(app, 'batch').label, 'ファイル取込');
  for (const m of ['live', 'batch']) assert.ok(!/リアルタイム|バッチ|[（(]/.test(itemOf(app, m).label), `${m}: 名称に括弧内の呼び名を含めない`);
  const modeText = (m) => `${itemOf(app, m).description} ${itemOf(app, m).tooltip?.text ?? ''}`;
  assert.match(modeText('live'), /リアルタイム/, '説明・ツールチップにモードの呼び名'); assert.match(modeText('batch'), /バッチ/, '説明・ツールチップにモードの呼び名');
  const fileLoad = app.getCommandBar().items.find((i) => i.command === 'file.load');
  if (fileLoad) assert.notEqual(fileLoad.label, itemOf(app, 'batch').label, 'ファイルの読込のコマンド（file.load）と名称で区別できる');
  app.setLang('en');
  assert.equal(itemOf(app, 'live').label, 'Voice input'); assert.equal(itemOf(app, 'batch').label, 'File batch');
  for (const m of ['live', 'batch']) assert.ok([...itemOf(app, m).label].length <= 12, `${m}: 英語の名称は半角 12 文字以内`);
  app.setLang('ja');
  assert.deepEqual(pressed(app), ['live']);
  assert.ok(itemOf(app, 'live').selectedMark && itemOf(app, 'batch').selectedMark === null, '色以外の印・枠');
});

test('FR-117 AC-683: クリック（コマンド）・コマンドの検索・setInputMode で切り替わり、再読み込みなしで名称・説明が表示言語に従い、切替で発話・シーン・図・選択中のオブジェクトは失われない', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  app.setDraft('予算の見直しが必要です'); assert.equal(app.submitDraft().ok, true); env.tick(1); env.scheduler.advance(3000);
  app.commands['session.pause']();
  const sel = app.getState().selectedSceneId;
  const keep = () => JSON.stringify([app.getState().utterances.map((u) => u.text), app.getState().scenes, app.getState().selectedSceneId, app.renderSvg()]);
  const before = keep();
  await app.commands['inputMode.set:batch'](); await flush();
  assert.equal(app.getInputMode().mode, 'batch'); assert.deepEqual(pressed(app), ['batch']);
  assert.equal(keep(), before); assert.equal(app.getState().selectedSceneId, sel);
  app.setLang('en');
  assert.match(itemOf(app, 'batch').label, /^[\x20-\x7e]+$/, '表示言語の切替で名称が即座に英語になる');
  const hit = app.searchCommands(itemOf(app, 'live').label);
  assert.ok(hit.some((h) => (h.command ?? h.id) === 'inputMode.set:live'), 'コマンドの検索から選べる');
  await app.commands['inputMode.set:live'](); assert.equal(app.getInputMode().mode, 'live');
  assert.equal(app.setInputMode('batch').ok, true); assert.equal(app.getInputMode().mode, 'batch');
  app.setLang('ja'); // 図の文言は表示言語に従うため、比較の前に言語を最初の状態（ja）へ揃える
  assert.equal(keep(), before, '往復しても発話・シーン・図は不変');
});

test('FR-117 AC-683: 選んだ値は端末ごとの設定として再読込後も保たれ、データの初期化では変わらず、セッションファイルに含まれない。不正な値は受け付けず直前の値が保たれる', async () => {
  const { app, env, createApp } = await newApp();
  assert.equal(app.setInputMode('batch').ok, true);
  const b = await createApp({ ...env.options });
  assert.equal(b.getInputMode().mode, 'batch', '再読込後に復元される');
  await b.commands['data.reset'](); await b.dialogAction('confirm');
  assert.equal(b.getInputMode().mode, 'batch', 'データの初期化では変わらない');
  // セッションファイルの内容は入力モードに依存しない
  // 空の状態では file.save は download せず reason:'empty'（CONTRACT-BATCH.md）なので、発話がある状態を作ってから保存する
  const save = async (mode) => {
    const x = await newApp();
    x.app.commands['session.start']();
    x.app.setDraft('予算の見直しが必要です'); assert.equal(x.app.submitDraft().ok, true);
    x.env.tick(1); x.env.scheduler.advance(3000);
    x.app.commands['session.pause']();
    assert.equal(x.app.setInputMode(mode).ok, true);
    x.env.downloads.length = 0; await x.app.commands['file.save']();
    assert.equal(x.env.downloads.length, 1, '発話があれば保存される');
    return x.env.downloads[0].data;
  };
  assert.equal(String(await save('batch')), String(await save('live')), 'セッションファイルに入力モードを含めない');
  for (const bad of ['', 'stream', null, undefined, 3, ['batch'], {}]) {
    assert.equal(b.setInputMode(bad).ok, false, `不正な値 ${JSON.stringify(bad)}`);
    assert.equal(b.getInputMode().mode, 'batch');
  }
});

test('FR-117 AC-683 異常系: 記録中（音声認識中を含む）は切替が受け付けられず、「記録を停止してから切り替えてください」が示され、モードも記録も変わらない', async () => {
  const speech = new FakeSpeech();
  const { app } = await newApp({ speech });
  app.commands['session.start']();
  const r = app.setInputMode('batch');
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /記録を停止してから切り替えてください/);
  assert.match(app.getState().message.text, /記録を停止してから切り替えてください/);
  assert.equal(app.getInputMode().mode, 'live'); assert.equal(app.getState().session, 'recording'); assert.equal(speech.stopCalls, 0);
  await app.commands['inputMode.set:batch'](); await flush();
  assert.equal(app.getInputMode().mode, 'live', 'コマンドでも同じ');
  app.commands['session.stop']();
  assert.equal(app.setInputMode('batch').ok, true, '停止すれば切り替えられる');
});

// FR-117 AC-684
test('FR-117 AC-684: 音声取込モードでは記録・認識・暫定結果・手入力が従来どおり使え、確定結果は更新間隔ごとに 1 回で描き足される。ファイル由来の発話は図に加わらない', async () => {
  const { app, env } = await newApp({ speech: new FakeSpeech() });
  assert.equal(app.getCommandBar().groups.some((g) => g.id === 'batchStyle' && g.visible !== false), false, '音声取込ではスタイルのボタンは表示しない（FR-118 の表示面は batch.test.js）');
  app.commands['session.start']();
  assert.equal(app.getState().session, 'recording');
  env.speech.emit('暫定の声', false);
  assert.equal(app.getState().utterances.length, 0, '暫定結果は発話にならない');
  const n0 = app.getLiveRefresh().count;
  env.speech.emit('予算の見直しが必要です', true); env.speech.emit('コストが高くて困った', true);
  app.setDraft('手入力の発話'); assert.equal(app.submitDraft().ok, true);
  const sec = app.getLiveInterval().sec;
  env.scheduler.advance(sec * 1000 - 1);
  assert.equal(app.getLiveRefresh().count, n0, '更新の時点の前には描き足さない（手入力を除く）');
  env.scheduler.advance(2);
  assert.equal(app.getLiveRefresh().count, n0 + 1, '更新間隔ごとにまとめて 1 回');
  // ファイル由来の発話は描き足しの対象外
  const before = snapshot(app);
  assert.equal((await app.importTextFile(TXT)).ok, true);
  assert.equal(app.getState().session, 'recording', '記録中の取込でもモードも記録も変わらない');
  assert.equal(app.getInputMode().mode, 'live');
  env.scheduler.advance(sec * 1000 * 2);
  assert.equal(snapshot(app), before, 'ファイル由来の発話は図に加わらない');
  assert.ok(finals(app).includes('担当者の割り当てを確認する'), '一覧には並ぶ');
});

test('FR-117 AC-684: ファイル読込モードでは [記録開始] は無効で「音声取込モードで使えます」が文字で示され、押しても記録は始まらない。音声取込へ戻すと元に戻る（スタイルのボタンの表示は FR-118 側の batch.test.js）', async () => {
  const speech = new FakeSpeech();
  const { app } = await newApp({ speech });
  assert.equal(app.setInputMode('batch').ok, true);
  const start = app.getCommandBar().items.find((i) => i.command === 'session.start');
  assert.equal(start.enabled, false);
  assert.match(start.disabledReason ?? '', /音声取込モードで使えます/);
  await app.commands['session.start'](); await flush();
  assert.equal(app.getState().session, 'preparing'); assert.equal(speech.startCalls.length, 0);
  speech.emit('バッチ中の声', true);
  assert.equal(app.getState().utterances.length, 0, '音声入力は発話にならない');
  assert.equal(app.setInputMode('live').ok, true);
  assert.notEqual(app.getCommandBar().items.find((i) => i.command === 'session.start').enabled, false);
  await app.commands['session.start'](); await flush();
  assert.equal(app.getState().session, 'recording');
});

// FR-117 AC-684（2026-11-07・監査 C-03）/ FR-014 AC-054: ファイル読込モードでは手入力は受け付けられず、発話も図も変わらず、保留もしない
test('FR-117 AC-684 異常系: ファイル読込モードでは手入力の送信が受け付けられず、発話・図は変わらず「音声取込モードで使えます」が示され、バッチ実行まで保留もされない', async () => {
  const { app, env } = await newApp({ speech: new FakeSpeech() });
  assert.equal((await app.importTextFile(TXT)).ok, true); // 取込で自動的にファイル読込モードになる（AC-685）
  assert.equal(app.getInputMode().mode, 'batch');
  const before = snapshot(app); const finals0 = finals(app).slice(); const n0 = app.getState().utterances.length;
  app.setDraft('バッチ中の手入力ZQ');
  const r = app.submitDraft();
  assert.equal(r.ok, false, 'ファイル読込モードでは手入力は受け付けられない');
  const msg = `${r.reason ?? ''}${app.getState().message?.text ?? ''}`;
  env.scheduler.advance(10000);
  assert.equal(app.getState().utterances.length, n0, '発話は増えない'); assert.deepEqual(finals(app), finals0);
  assert.equal(snapshot(app), before, '図も変わらない');
  assert.ok(!app.renderSvg().includes('バッチ中の手入力ZQ'));
  // バッチ実行まで保留する扱いはしない: 実行しても、音声取込へ戻って記録を始めても、その発話は現れない
  const styleId = app.getBatchStyles()[0].id;
  assert.equal((await app.runBatch(styleId)).ok, true); await app.flushLlm();
  assert.ok(!finals(app).some((t) => t.includes('バッチ中の手入力ZQ')) && !app.renderSvg().includes('バッチ中の手入力ZQ'), '保留された手入力が実行で現れない');
  assert.equal(app.setInputMode('live').ok, true);
  app.commands['session.start'](); await flush();
  assert.equal(app.getState().session, 'recording');
  // 音声取込モードの記録中は受け付けられる（AC-054）
  app.setDraft('記録中の手入力'); assert.equal(app.submitDraft().ok, true); env.tick(1);
  assert.ok(app.getState().utterances.some((u) => u.text === '記録中の手入力'), '音声取込モードの記録中は手入力が受け付けられる');
  assert.match(msg, /音声取込モードで使えます/, '拒否の理由として「音声取込モードで使えます」が文字で示される');
});

// FR-117 AC-685 (b)(c)（検証レベル integration のため台帳には載せない。2026-11-07・監査 C-04）
test('FR-117 AC-685 (b): 一時停止・停止・準備中でも、ファイルの取込で自動的にファイル読込モードになりバッチ描画が読込済みになる。一時停止は変わらない', async () => {
  for (const st of ['paused', 'stopped', 'preparing']) {
    const { app } = await newApp({ speech: new FakeSpeech() });
    if (st !== 'preparing') { app.commands['session.start'](); if (st === 'paused') app.commands['session.pause'](); else app.commands['session.stop'](); }
    const s0 = app.getState().session;
    assert.equal((await app.importTextFile(TXT)).ok, true, `${st}: 取り込める`);
    assert.equal(app.getInputMode().mode, 'batch', `${st}: 自動でファイル読込モード`);
    assert.equal(app.getBatchState().state, 'loaded', `${st}: 読込済み`);
    assert.equal(app.getState().session, s0, `${st}: セッションの状態は変わらない`);
  }
});

test('FR-117 AC-685 (c): 一時停止中はモードを切り替えられ（セッションは一時停止のまま）、ファイル読込モードでは [再開] が無効で押しても変わらず、[記録終了] は使え、音声取込へ戻すと [再開] で記録中に戻る', async () => {
  const bar = (app, c) => app.getCommandBar().items.find((i) => i.command === c);
  const { app, env } = await newApp({ speech: new FakeSpeech() });
  app.commands['session.start'](); app.setDraft('一時停止前の発話'); app.submitDraft(); env.tick(1);
  app.commands['session.pause']();
  assert.equal(app.getState().session, 'paused');
  assert.equal(app.setInputMode('batch').ok, true, '一時停止中は切り替えられる（(a) は適用しない）');
  assert.equal(app.getInputMode().mode, 'batch'); assert.equal(app.getState().session, 'paused', '切替でセッションの状態は変わらない');
  const resume = bar(app, 'session.resume');
  assert.equal(resume.enabled, false, 'ファイル読込モードでは [再開] が無効');
  assert.match(resume.disabledReason ?? '', /音声取込モードで使えます/);
  await app.commands['session.resume'](); await flush();
  assert.equal(app.getState().session, 'paused', '押しても状態は変わらない（一時停止のまま）');
  assert.notEqual(bar(app, 'session.stop')?.enabled, false, '[記録終了] はファイル読込モードでも使える');
  assert.equal(app.setInputMode('live').ok, true);
  assert.notEqual(bar(app, 'session.resume').enabled, false, '音声取込へ戻すと [再開] が使える');
  await app.commands['session.resume'](); await flush();
  assert.equal(app.getState().session, 'recording', '押すと記録中に戻る');
  // 一時停止 → ファイル読込モード → [記録終了]
  app.commands['session.pause'](); assert.equal(app.setInputMode('batch').ok, true);
  app.commands['session.stop']();
  assert.equal(app.getState().session, 'stopped', 'ファイル読込モードの一時停止中でも [記録終了] できる');
});

// FR-117 AC-683（実ブラウザ: 通常の <button>・aria-pressed・キーボード）
test('FR-117 AC-683 実ブラウザ: 2 つの項目は最上部の <button> で aria-pressed を持ち、ホバーなしで名称と説明の文字が見え、Tab で到達して Enter で切り替わる', async () => {
  const srv = await serveWeb(); const browser = await launch();
  try {
    const { ctx, page } = await openApp(browser, srv.url, { width: 1280, height: 1000 });
    try {
      const sel = (m) => `button[data-command="inputMode.set:${m}"]`;
      for (const m of ['live', 'batch']) {
        const el = page.locator(sel(m)).first();
        assert.equal(await el.isVisible(), true, `${m}: 常時表示`);
        assert.ok((await el.innerText()).trim().length >= 1, `${m}: 名称の文字`);
        assert.ok((await el.evaluate((e) => (e.getAttribute('aria-describedby') ? document.getElementById(e.getAttribute('aria-describedby'))?.textContent : e.title) ?? '')).trim(), `${m}: 短い説明`);
        assert.ok((await el.boundingBox()).y < 200, `${m}: 画面最上部の領域`);
      }
      assert.equal(await page.locator(sel('live')).first().getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator(sel('batch')).first().getAttribute('aria-pressed'), 'false');
      await page.locator(sel('batch')).first().focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator(sel('batch')).first().getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator(sel('live')).first().getAttribute('aria-pressed'), 'false');
      await page.reload(); await page.waitForFunction(() => !!globalThis.__app);
      assert.equal(await page.locator(sel('batch')).first().getAttribute('aria-pressed'), 'true', '再読込後も保たれる');
    } finally { await ctx.close(); }
  } finally { await browser.close(); await srv.close(); }
});
