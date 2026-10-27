// NFR-PERF-003 AC-538（integration）: データを変えない操作では、自動保存の直列化・保存、トピック分類、
// 認識文字列・アウトライン・図の SVG の再生成を呼ばない（呼び出しの回数を数える）。
// 図のパネルは実物（diagram.js の mountDiagramPanel）を最小の DOM で動かす。認識文字列・アウトラインは ui.js と同じ規則
// （app.getRenderVersion が前回の描画と同じなら再生成しない）で描く購読者で数える。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp } from '../system/helpers.js';
import { mountDiagramPanel } from '../../web/src/diagram.js';

const HUGE = 5000; // PARAM-106
const REPEAT = 10; // AC-538: 各操作 10 回
const PARAM_108 = 500;

// ---- 最小の DOM（mountDiagramPanel が使う範囲） ----
class El {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {};
    this.style = {}; this.className = ''; this.clientWidth = 800; this.clientHeight = 600; this.scrollLeft = 0; this.scrollTop = 0; this.isConnected = true;
    const cls = new Set();
    this.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) };
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] ?? []).filter((x) => x !== f); }
  fire(t, ev = {}) { for (const f of [...(this.listeners[t] ?? [])]) f({ preventDefault() {}, target: this, ...ev }); }
  setPointerCapture() {}
  append(...c) { this.children.push(...c); }
  set textContent(v) { this.children = []; this._text = v; }
  get textContent() { return this._text ?? ''; }
  set innerHTML(h) {
    this._html = h; this.children = [];
    if (h.includes('diagram-tools')) {
      for (const c of ['diagram-tools', 'diagram-canvas']) { const e = new El('div', this.ownerDocument); e.className = c; this.children.push(e); }
      return;
    }
    const m = /<svg[^>]*>/.exec(h);
    if (m) { const s = new El('svg', this.ownerDocument); for (const [, k, v] of m[0].matchAll(/([\w:-]+)="([^"]*)"/g)) s.attrs[k] = v; this.children.push(s); }
  }
  get innerHTML() { return this._html ?? ''; }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) {
    const ok = (e) => (sel.startsWith('.') ? e.className.split(' ').includes(sel.slice(1)) : sel.startsWith('[data-') ? sel.slice(6, -1) in e.dataset : e.tagName === sel.toUpperCase());
    return this.all().filter(ok);
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}
const doc = { createElement: (t) => new El(t, doc) };

async function hugeApp() {
  let ctx;
  const r = await newApp({ options: { modules: [(c) => { ctx = c; }] } });
  const { app, env } = r;
  app.commands['session.start']();
  const texts = Array.from({ length: HUGE }, (_, i) => `発話${i} 予算とリリース計画について確認する`);
  for (let i = 0; i < HUGE; i += 500) ctx.addUtterances(texts.slice(i, i + 500));
  app.commands['session.pause']();
  env.scheduler.advance(PARAM_108 * 2); // 保留中の保存を片付ける
  assert.equal(app.getState().utterances.length, HUGE);
  return { ...r, ctx };
}

// 呼び出しの回数を数える（図の SVG・認識文字列・アウトラインの再生成、自動保存の書き込み、トピック分類）
function instrument(app, env) {
  const n = { svg: 0, transcript: 0, outline: 0, writes: 0 };
  for (const [k, name] of [['svg', 'renderSvg'], ['transcript', 'renderTranscript'], ['outline', 'renderOutline']]) {
    const orig = app[name].bind(app);
    app[name] = (...a) => { n[k]++; return orig(...a); };
  }
  const set = env.storage.setItem.bind(env.storage);
  env.storage.setItem = (k, v) => { if (k === 'grp.session') n.writes++; set(k, v); };
  return n;
}

// ui.js の描画と同じ規則の購読者: 図のパネルは実物を毎回呼び、文字列・アウトラインはデータの版数が変わったときだけ作り直す
function mountView(app) {
  const host = new El('div', doc);
  let ver;
  const draw = () => {
    mountDiagramPanel(host, app, doc);
    const v = app.getRenderVersion();
    if (v !== ver) { ver = v; app.renderTranscript(); app.renderOutline(); }
  };
  app.subscribe(draw);
  draw();
  return host;
}

test('NFR-PERF-003 AC-538: 5000 件で、データを変えない操作（ホバー・パネルの移動と大きさ変更・図のスクロールと拡大縮小・ツールチップ）を各 10 回しても、保存・トピック分類・文字列・アウトライン・図の SVG の再生成は 0 回', async () => {
  const { app, env } = await hugeApp();
  const host = mountView(app);
  const canvas = host.querySelector('.diagram-canvas');
  const zoomIn = host.querySelectorAll('[data-zoom]').find((b) => b.dataset.zoom === 'in');
  const zoomOut = host.querySelectorAll('[data-zoom]').find((b) => b.dataset.zoom === 'out');
  const n = instrument(app, env);
  const before = { ver: app.getRenderVersion(), counts: app.getCallCounts(), state: JSON.stringify(app.getState()) };
  const cmd = app.getCommandBar().items.find((it) => typeof app.commands[it.command] === 'function')?.command ?? 'session.resume';
  const p0 = app.getLayout().panels.input;
  for (let i = 1; i <= REPEAT; i++) {
    // ホバー・ツールチップ（コマンドバーのボタン）
    app.showTooltip(cmd, 'hover'); app.hideTooltip(cmd, 'leave');
    app.showTooltip(cmd, 'focus'); app.hideTooltip(cmd, 'blur');
    // パネルの移動・大きさ変更（ドラッグの各段階）
    assert.equal(app.movePanel('input', { x: p0.x + i * 4, y: p0.y + i * 2 }), true);
    assert.equal(app.resizePanel('input', { w: p0.w + i * 3, h: p0.h + i * 2 }), true);
    // 図のスクロール（ドラッグ・ホイール）と拡大縮小（ボタン・Ctrl+ホイール）、表示位置の通知つきの指定
    canvas.scrollLeft = i * 10; canvas.scrollTop = i * 5; canvas.fire('scroll');
    canvas.fire('wheel', { ctrlKey: true, deltaY: i % 2 ? -120 : 120 });
    (i % 2 ? zoomIn : zoomOut).fire('click');
    app.setDiagramView({ zoom: 1 + i / 10, scrollX: i, scrollY: i });
    canvas.clientWidth = 800 + i * 3; // パネルの大きさ変更で図の幅が変わる
    app.resizePanel('diagram', { w: app.getLayout().panels.diagram.w + 1, h: app.getLayout().panels.diagram.h });
  }
  env.scheduler.advance(PARAM_108 * 4);
  const after = app.getCallCounts();
  assert.equal(app.getRenderVersion(), before.ver, 'データの版数が変わった');
  assert.equal(n.writes, 0, '自動保存の書き込み');
  assert.equal((after.autosave ?? 0) - (before.counts.autosave ?? 0), 0, '自動保存の直列化');
  assert.equal((after.classifyTopics ?? 0) - (before.counts.classifyTopics ?? 0), 0, 'トピック分類');
  assert.equal(n.svg, 0, '図の SVG の再生成');
  assert.equal(n.transcript, 0, '認識文字列の再生成');
  assert.equal(n.outline, 0, 'アウトラインの再生成');
  assert.equal(JSON.stringify(app.getState()), before.state, 'データが変わった');
  // 見た目は反映されている（操作が無視されたのではない）
  assert.equal(app.getLayout().panels.input.x, p0.x + REPEAT * 4);
  assert.equal(app.getDiagramView().zoom, 1 + REPEAT / 10);
  assert.ok(canvas.querySelector('svg'), '図は描かれたまま');
});

// AC-538（対照）: データを変える操作では、版数が上がり、図・文字列・アウトラインを 1 回ずつ作り直し、間引いて 1 回保存する
test('NFR-PERF-003 AC-538: データを変える操作（シーンの選択・要点の修正）では版数が上がり、再生成と自動保存が行われる', async () => {
  const { app, env } = await hugeApp();
  mountView(app);
  const n = instrument(app, env);
  const c0 = app.getCallCounts();
  const v0 = app.getRenderVersion();
  const sc = app.getState().scenes[0];
  app.selectScene(sc.id);
  assert.ok(app.getRenderVersion() > v0);
  assert.equal(n.svg, 1); assert.equal(n.transcript, 1); assert.equal(n.outline, 1);
  assert.equal(app.editPoint(sc.points[0].id, '修正した要点').ok, true);
  app.getTopics(); app.getTopics();
  assert.equal((app.getCallCounts().classifyTopics ?? 0) - (c0.classifyTopics ?? 0) >= 1, true, 'データが変われば分類し直す');
  env.scheduler.advance(PARAM_108);
  assert.equal(n.writes, 1, '間引いて 1 回保存');
  assert.ok(JSON.parse(env.storage.getItem('grp.session')).scenes[0].points.some((p) => p.text === '修正した要点'));
});

// NFR-PERF-003 AC-536（画面外の行の配置・描画を省くための分割）: 認識文字列と要点の一覧は 100 件ずつに分け、番号・順序・件数は変えない
test('NFR-PERF-003 AC-536: 認識文字列は 100 件ずつの番号の続くリスト、要点は 100 件ずつのリストに分かれ、全件が順に並ぶ', async () => {
  let ctx;
  const { app } = await newApp({ options: { modules: [(c) => { ctx = c; }] } });
  app.commands['session.start']();
  const texts = Array.from({ length: 250 }, (_, i) => `分割の確認${i} 予算を決める`);
  ctx.addUtterances(texts); ctx.transcript.addFinals(texts);
  const tr = app.renderTranscript();
  const chunks = [...tr.matchAll(/<ol class="transcript-chunk" start="(\d+)" style="--n:(\d+)">/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(chunks, [[1, 100], [101, 100], [201, 50]]);
  assert.deepEqual([...tr.matchAll(/data-id="[^"]+">([^<]+)</g)].map((m) => m[1]), texts, '全件が受付順');
  assert.match(tr, /role="log"/);
  const ol = app.renderOutline();
  const pointLists = [...ol.matchAll(/<ul class="outline-points" style="--n:(\d+)">/g)].map((m) => Number(m[1]));
  assert.equal(pointLists.reduce((a, b) => a + b, 0), app.getState().scenes.reduce((n, s) => n + s.points.length, 0));
  assert.ok(pointLists.every((n) => n <= 100));
});

// AC-538 / AC-400: トピック分類はデータの版数ごとに 1 回（同じ版数の中で何度読んでも計算し直さない）、結果は計算し直したものと同じ
test('NFR-PERF-003 AC-538: トピック分類は版数ごとに 1 回だけ計算し、読み出し側が結果を変えても次の読み出しに影響しない', async () => {
  const { app } = await hugeApp();
  app.selectScene(app.getState().scenes[0].id); // 新しい版数にする
  const c0 = app.getCallCounts().classifyTopics ?? 0;
  const a = app.getTopics(); app.getTopicRelations(); app.getTopicOutline(); const b = app.getTopics();
  assert.equal((app.getCallCounts().classifyTopics ?? 0) - c0, 1);
  assert.deepEqual(a, b);
  a[0].sceneIds.push('x'); a[0].title = '書き換え';
  assert.deepEqual(app.getTopics(), b);
});
