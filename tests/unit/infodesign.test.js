// FR-079 図の情報デザインによる自動再配置（何を・どこに）の単体・結合テスト（AC-426〜434）。
// 再配置の時点はテスト用の時計（scheduler の注入）で進める。規則の本体は web/src/infodesign.js、時点と図の要素は web/src/relayout.js。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';
import {
  KIND_ORDER, GROUP_MAX, TYPE_SCALE, kindOf, sameTextKey, pointItems, sceneTree, topicChunks, provisionalTree, leaves, subgroupLabel, countMark,
} from '../../web/src/infodesign.js';
import { KIND_LABELS, detailGeometry } from '../../web/src/diagram.js';

const PERIOD = 10_000; // PARAM-084
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
}
async function mk(extra = {}) {
  const clock = { t: 1e12 }; const sched = new Sched(clock);
  const app = await createApp({ storage: mem(), scheduler: sched, now: () => clock.t, env: { webgl: false, reducedMotion: false, viewportWidth: 1280 }, ...extra });
  app.setDetailLevel('detail');
  app.commands['session.start']();
  const say = (...texts) => { for (const t of texts) { sched.advance(100); app.setDraft(t); app.submitDraft(); } };
  const next = () => app.commands['session.nextScene']();
  const toPeriod = () => sched.advance(PERIOD - (sched.t % PERIOD));
  return { app, sched, say, next, toPeriod };
}
const els = (app) => app.getDiagramElements();
const pointEls = (app, parentId) => els(app).filter((e) => e.kind === 'point' && e.parentId === parentId).sort((a, b) => a.readIndex - b.readIndex);
const textOf = (app, id) => app.getState().scenes.flatMap((s) => s.points).find((p) => p.id === id)?.text;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const ancestors = (byId, e) => { const out = new Set(); let p = e.parentId; while (p) { out.add(p); p = byId.get(p)?.parentId ?? null; } return out; };
function assertNoOverlap(list) {
  const byId = new Map(list.map((e) => [e.id, e]));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i]; const b = list[j];
    if (ancestors(byId, a).has(b.id) || ancestors(byId, b).has(a.id)) continue;
    assert.ok(!overlap(a, b), `${a.id} と ${b.id} が重ならない`);
  }
}

// ---- AC-427 ----
// FR-079 AC-427
test('FR-079 AC-427: どの要点もちょうど 1 つの種類に分類され、どの語にも当てはまらない要点は補足。図と一覧の種類のラベルは同じ語', async () => {
  const samples = ['Aを採用すると決まりました。', 'コストが高くて困った', '案Aの採用を提案します。', 'アイデアがあります', 'まだ決まっていない', '会議室は三階にあります', '', 'xyz'];
  for (const s of samples) assert.ok(KIND_ORDER.includes(kindOf(s)), `「${s}」は 6 種類のどれか 1 つ`);
  assert.equal(kindOf('会議室は三階にあります'), 'note');
  assert.equal(kindOf(''), 'note');
  assert.deepEqual([...KIND_ORDER].sort(), Object.keys(KIND_LABELS.ja).sort(), '種類は重なりも漏れもない 6 つ');
  const { app, say } = await mk();
  say('Aを採用すると決まりました。', 'コストが高くて困った');
  const style = app.getDiagramStyle().scenes[0].points;
  const outline = app.renderOutline();
  for (const p of style) assert.ok(outline.includes(p.kindLabel), `一覧にも図と同じ種類のラベル「${p.kindLabel}」`);
});

// ---- AC-426 ----
// FR-079 AC-426
test('FR-079 AC-426: 要点は種類（結論・課題・提案・アイデア・未決定・補足）の順、同じ種類の中は話順に並び、結論が先頭に昇格する', () => {
  const pts = ['会議室は三階', 'コストが高くて困った', '案Aを提案します', '予算が足りない', 'Aを採用すると決まりました。', 'まだ決まっていない', 'アイデアがあります']
    .map((text, i) => ({ id: `p${i}`, text }));
  const items = pointItems(pts);
  assert.deepEqual(items.map((it) => it.kind), ['conclusion', 'issue', 'issue', 'proposal', 'idea', 'undecided', 'note']);
  assert.deepEqual(items.filter((it) => it.kind === 'issue').map((it) => it.key), ['p1', 'p3'], '同じ種類の中は話順');
  assert.equal(items[0].key, 'p4', '結論が読み順の先頭');
});

// FR-079 AC-426
test('FR-079 AC-426: 再配置の後、図のシーンの要点は結論が上に昇格し、シーンの並び（話順）は変わらない。再配置の前は暫定（話順）のまま', async () => {
  const { app, say, next, toPeriod } = await mk();
  say('会議室は三階にあります');
  next();
  say('コストが高くて困った', '資料は共有フォルダに置きました', 'Aを採用すると決まりました。');
  const scenes = app.getState().scenes;
  const before = pointEls(app, `scene:${scenes[1].id}`);
  assert.deepEqual(before.map((e) => textOf(app, e.refIds[0])), ['コストが高くて困った', '資料は共有フォルダに置きました', 'Aを採用すると決まりました。'], '再配置の前は話順');
  assert.ok(before.every((e) => e.provisional));
  toPeriod();
  const after = pointEls(app, `scene:${scenes[1].id}`);
  assert.deepEqual(after.map((e) => textOf(app, e.refIds[0])), ['Aを採用すると決まりました。', 'コストが高くて困った', '資料は共有フォルダに置きました']);
  for (let i = 1; i < after.length; i++) assert.ok(after[i - 1].y < after[i].y, '読み順に上から');
  const sceneEls = els(app).filter((e) => e.kind === 'scene');
  assert.deepEqual(sceneEls.map((e) => e.refIds[0]), scenes.map((s) => s.id), 'シーンの並びは話順のまま');
  assert.ok(sceneEls[0].x < sceneEls[1].x);
  // SVG の描画も同じ並び
  const svg = app.renderSvg();
  const g2 = svg.slice(svg.indexOf(`data-scene-id="${scenes[1].id}"`));
  assert.ok(g2.indexOf('data-kind="conclusion"') < g2.indexOf('data-kind="issue"'), 'SVG の描画も同じ並び');
  // テキスト一覧は話順のまま（AC-035・AC-082）
  const out = app.renderOutline();
  assert.ok(out.indexOf('コストが高くて困った') < out.indexOf('Aを採用すると決まりました。'));
});

// FR-079 AC-426 AC-433
test('FR-079 AC-426: 発散型の放射状の配置では、結論の要点が 12 時の位置から時計回りの先頭に置かれ、意見の大きさは平等のまま', async () => {
  const { app, say, toPeriod } = await mk();
  app.setLayoutTypes(['diverge']);
  say('コストが高くて困った', '資料は共有フォルダに置きました', 'Aを採用すると決まりました。');
  toPeriod();
  const L = app.getDiagramLayout();
  const first = L.units.find((u) => u.order === 0);
  assert.equal(first.text, 'Aを採用すると決まりました。');
  const cx = L.center.x + L.center.w / 2;
  assert.ok(Math.abs(first.x + first.w / 2 - cx) < 1, '12 時の位置（中心の真上）');
  assert.ok(first.y < L.center.y);
  assert.equal(new Set(L.units.map((u) => `${u.w}x${u.h}`)).size, 1, '大きさの基準は全員同じ');
});

// ---- AC-428 ----
// FR-079 AC-428
test('FR-079 AC-428: 要素が 7 を超えるシーンは種類ごとの下位のまとまりに分け、なお超える種類は読み順で 7 個以下ずつ（1/2 の番号）。7 以下は分けない', () => {
  const seven = sceneTree({ id: 's', points: Array.from({ length: GROUP_MAX }, (_, i) => ({ id: `p${i}`, text: `補足の文${i}` })) });
  assert.ok(seven.children.every((n) => n.type === 'point'), '7 以下は分けない');
  const mixed = sceneTree({ id: 's', points: [...Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, text: `会場の件${i}` })), { id: 'c', text: 'Aを採用すると決まりました。' }, { id: 'i', text: 'コストが高くて困った' }] });
  assert.deepEqual(mixed.children.map((n) => [n.type, n.kind, n.children.length]), [['subgroup', 'conclusion', 1], ['subgroup', 'issue', 1], ['subgroup', 'note', 6]]);
  assert.equal(subgroupLabel(mixed.children[2], 'ja', 6), '補足（6）');
  const many = sceneTree({ id: 's', points: Array.from({ length: 16 }, (_, i) => ({ id: `p${i}`, text: `会場の件${i}` })) });
  assert.deepEqual(many.children.map((n) => n.children.length), [7, 7, 2]);
  assert.deepEqual(many.children.map((n) => subgroupLabel(n, 'ja', n.children.length)), ['補足 1/3（7）', '補足 2/3（7）', '補足 3/3（2）']);
  const ids = leaves(many).flatMap((l) => l.refIds);
  assert.equal(ids.length, 16); assert.equal(new Set(ids).size, 16, 'どの要点も 1 つの下位のまとまりだけ（消えない）');
  assert.equal(topicChunks(['a', 'b']), null);
  assert.deepEqual(topicChunks(Array.from({ length: 9 }, (_, i) => `s${i}`)).map((c) => c.length), [7, 2], 'トピックのシーンは話順のまま 7 個以下ずつ');
});

// FR-079 AC-428
test('FR-079 AC-428: 中項目で 1 トピックのシーンが 7 を超えると、再配置で話順のまま 7 個以下ずつの下位のまとまりに分かれ、シーンは消えない', async () => {
  const { app, say, next, toPeriod } = await mk();
  for (let i = 0; i < 9; i++) { say(`予算 会議 その${i}`); next(); }
  app.setDetailLevel('middle');
  const tps = app.getTopics();
  const big = tps.find((tp) => tp.sceneIds.length > GROUP_MAX);
  assert.ok(big, '同じ語を共有する 9 シーンは 1 トピック');
  toPeriod();
  const list = els(app);
  const tid = `topic:${big.id}`;
  const subs = list.filter((e) => e.kind === 'subgroup' && e.parentId === tid);
  assert.equal(subs.length, 2);
  const scenesIn = subs.flatMap((g) => list.filter((e) => e.parentId === g.id));
  assert.ok(subs.every((g) => list.filter((e) => e.parentId === g.id).length <= GROUP_MAX));
  assert.deepEqual(scenesIn.map((e) => e.refIds[0]), big.sceneIds, '話順を保つ');
  assertNoOverlap(list);
  assert.match(app.renderSvg(), /data-role="subgroup-heading"[^>]*>1\/2/);
});

// ---- AC-429 ----
// FR-079 AC-429
test('FR-079 AC-429: 同じシーンの同一の要点（前後の空白・全角半角の違いを除く）は 1 つにまとめ、件数を文字で示す。異なるシーンはまとめない', async () => {
  assert.equal(sameTextKey(' ＡＢＣ　'), sameTextKey('ABC'));
  const items = pointItems([{ id: 'a', text: 'ABC で進める' }, { id: 'b', text: 'ＡＢＣ で進める ' }, { id: 'c', text: '別の話' }]);
  assert.deepEqual(items.find((it) => it.key === 'a').refIds, ['a', 'b']);
  assert.equal(countMark(2), '×2'); assert.equal(countMark(1), '');
  const { app, say, next, toPeriod } = await mk();
  say('会議室は三階にあります', '会議室は三階にあります ');
  next();
  say('会議室は三階にあります');
  toPeriod();
  const st = app.getState();
  const s1 = pointEls(app, `scene:${st.scenes[0].id}`);
  assert.equal(s1.length, 1, '同じシーンの同一の要点は 1 つの要素');
  assert.deepEqual(s1[0].refIds, st.scenes[0].points.map((p) => p.id), 'まとめた要点はすべて（話順）');
  assert.equal(pointEls(app, `scene:${st.scenes[1].id}`).length, 1, '異なるシーンの同一の要点はまとめない');
  assert.match(app.renderSvg(), /data-role="dup-count"[^>]*>×2</);
  assert.equal((app.renderOutline().match(/会議室は三階にあります/g) ?? []).length >= 3, true, '一覧では元の件数のまま');
  // 選ぶとまとめた要点のすべてが対象。ポップアップにはすべてが話順に
  const sel = app.selectDiagramElement(s1[0].id);
  assert.deepEqual(sel.pointIds, s1[0].refIds);
  assert.deepEqual(app.getScenePopup().points.map((p) => p.id), st.scenes[0].points.map((p) => p.id));
  // 手修正はまとめた要点のすべてに適用
  assert.equal(app.editDiagramElement(s1[0].id, '会議室は四階です').ok, true);
  assert.ok(app.getState().scenes[0].points.every((p) => p.text === '会議室は四階です'));
  // 編集で同一でなくなった要点は、次の再配置でまとめが解かれる
  app.editPoint(st.scenes[0].points[1].id, '会議室は五階です');
  say('新しい要点'); toPeriod();
  assert.equal(pointEls(app, `scene:${st.scenes[0].id}`).length, 2);
  // 削除もすべてに適用
  const both = pointEls(app, `scene:${st.scenes[1].id}`)[0];
  assert.equal(app.deleteDiagramElement(both.id).ok, true);
  assert.equal(app.getState().scenes[1].points.filter((p) => both.refIds.includes(p.id)).length, 0);
});

// ---- AC-430 ----
// FR-079 AC-430
test('FR-079 AC-430: 再配置後、同じ親の要素は左端が揃い、まとまりの中の間隔はまとまりの間より小さく、外枠は重ならない（下位のまとまりを含む）', async () => {
  const { app, say, next, toPeriod } = await mk();
  say('会議室は三階にあります', '資料は共有フォルダに置きました');
  next();
  say(...Array.from({ length: 6 }, (_, i) => `会場の件その${i}`), 'Aを採用すると決まりました。', 'コストが高くて困った');
  toPeriod();
  const list = els(app);
  assertNoOverlap(list);
  const parents = new Set(list.map((e) => e.parentId).filter(Boolean));
  for (const pid of parents) {
    const kids = list.filter((e) => e.parentId === pid);
    if (kids.length < 2) continue;
    assert.ok(Math.max(...kids.map((e) => e.x)) - Math.min(...kids.map((e) => e.x)) <= 1, `${pid} の子の左端が PARAM-091 以内で揃う`);
  }
  const gap = (a, b) => Math.hypot(Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)));
  const subs = list.filter((e) => e.kind === 'subgroup');
  assert.ok(subs.length >= 2);
  const inGroup = (g) => list.filter((e) => e.parentId === g.id).sort((a, b) => a.readIndex - b.readIndex);
  for (const g of subs) {
    const k = inGroup(g);
    const inner = Math.max(0, ...k.slice(1).map((e, i) => gap(k[i], e)));
    for (const h of subs.filter((x) => x !== g)) {
      const outer = Math.min(...k.flatMap((a) => inGroup(h).map((b) => gap(a, b))));
      if (k.length > 1) assert.ok(inner < outer, `近接: ${inner} < ${outer}`);
    }
  }
});

// ---- AC-431 ----
// FR-079 AC-431
test('FR-079 AC-431: 基準の文字の大きさはタイトル欄・テーマ＞トピックの題名＞シーンの見出し＞要点で、同じ階層・種類は同じ形・絵記号・大きさ', async () => {
  assert.ok(TYPE_SCALE.title > TYPE_SCALE.topic && TYPE_SCALE.theme > TYPE_SCALE.topic && TYPE_SCALE.topic > TYPE_SCALE.scene && TYPE_SCALE.scene > TYPE_SCALE.point);
  const { app, say, next } = await mk();
  app.setTitleInfo({ theme: '演題', series: '週次' });
  say('コストが高くて困った', '予算が足りない');
  next();
  say('Aを採用すると決まりました。');
  const svg = app.renderSvg();
  assert.match(svg, new RegExp(`<g data-role="title"><text[^>]*font-size="${TYPE_SCALE.title}"`));
  assert.match(svg, new RegExp(`data-role="subheading"[^>]*font-size="${TYPE_SCALE.topic}"`));
  assert.match(svg, new RegExp(`font-size="${TYPE_SCALE.scene}"[^>]*data-role="heading"`));
  const style = app.getDiagramStyle();
  assert.deepEqual(style.scenes[0].typeScale, TYPE_SCALE);
  const issues = style.scenes.flatMap((s) => s.points).filter((p) => p.kind === 'issue');
  assert.equal(new Set(issues.map((p) => `${p.shape}|${p.icon}|${p.fontSize}`)).size, 1, '同じ種類は同じ形・絵記号・大きさ（反復）');
  const strong = style.scenes.flatMap((s) => s.points).filter((p) => p.emphasized);
  assert.ok(strong.every((p) => p.kind === 'conclusion'), '強い強調は結論の要点だけ');
  app.setDetailLevel('middle');
  const mid = app.renderSvg();
  assert.match(mid, new RegExp(`font-size="${TYPE_SCALE.topic}"[^>]*data-role="topic-title"`));
  assert.match(mid, new RegExp(`font-size="${TYPE_SCALE.scene}"[^>]*data-role="scene-heading"`));
});

// ---- AC-432 ----
// FR-079 AC-432
test('FR-079 AC-432: 再配置で手修正・トピックの手修正・整理の割り当ては戻らず、前のトピックの要素は動かず、新しい要素がなければ何度でも位置は変わらない', async () => {
  const { app, say, next, toPeriod } = await mk();
  say('会議室は三階にあります', '資料は共有フォルダに置きました');
  next();
  say('参加者は八名でした');
  toPeriod();
  const st0 = app.getState();
  const tp0 = app.getTopics()[0];
  assert.equal(app.editPoint(st0.scenes[0].points[0].id, '会議室は四階です').ok, true);
  assert.equal(app.renameTopic(tp0.id, '会場の件').ok !== false, true);
  assert.equal(app.assignObject(st0.scenes[0].points[1].id, { v: 'v1', h: 'h1' }).ok, true);
  const prev = new Map(els(app).filter((e) => e.topicId === tp0.id).map((e) => [e.id, [e.x, e.y, e.w, e.h]]));
  const c0 = app.getArrangeStatus().count;
  say('コストが高くて困った', 'Aを採用すると決まりました。');
  toPeriod();
  assert.equal(app.getArrangeStatus().count, c0 + 1);
  const st1 = app.getState();
  assert.equal(st1.scenes[0].points[0].text, '会議室は四階です', '編集は戻らない');
  assert.equal(app.getTopics()[0].title, '会場の件', 'トピックの手修正は戻らない');
  assert.equal(app.getArrangement().assignments.find((a) => a.objectId === st0.scenes[0].points[1].id).v, 'v1', '整理の割り当ては戻らない');
  for (const e of els(app).filter((x) => prev.has(x.id))) assert.deepEqual([e.x, e.y, e.w, e.h], prev.get(e.id), `前のトピックの要素 ${e.id} は動かない`);
  // 冪等: 新しい要素がなければ再配置しない・位置は変わらない
  const snap = JSON.stringify(els(app));
  assert.equal(app.rearrangeNow(), false);
  toPeriod(); toPeriod();
  assert.equal(app.getArrangeStatus().count, c0 + 1);
  assert.equal(JSON.stringify(els(app)), snap);
});

// ---- AC-433 ----
// FR-079 AC-433
test('FR-079 AC-433: 整理の表示では区分の中の並び・同一の要点のまとめだけが適用され、区分の割り当ては変わらない', async () => {
  const { app, say, toPeriod } = await mk();
  say('コストが高くて困った', '資料は共有フォルダに置きました', '資料は共有フォルダに置きました', 'Aを採用すると決まりました。');
  app.setDisplayMode('arrange');
  toPeriod();
  const m = app.getArrangement();
  const pts = m.geometry.items.filter((i) => i.kind === 'point').sort((a, b) => a.y - b.y);
  assert.deepEqual(pts.map((i) => i.text), ['Aを採用すると決まりました。', 'コストが高くて困った', '資料は共有フォルダに置きました'], '結論が先頭・種類の順');
  const dup = pts.find((i) => i.refIds?.length === 2);
  assert.ok(dup, '同一の要点は 1 つにまとまる');
  assert.ok(m.assignments.filter((a) => a.kind === 'point').every((a) => a.unclassified), '区分の割り当ては変わらない');
  assert.match(app.renderSvg(), /data-role="dup-count"[^>]*>×2</);
  // テキスト一覧は常に話順
  const out = app.renderOutline();
  assert.ok(out.indexOf('コストが高くて困った') < out.indexOf('Aを採用すると決まりました。'));
});

// ---- AC-434 ----
// FR-079 AC-434
test('FR-079 AC-434: 同じ発話列と同じ時点の列からは毎回同じ配置。再配置は外部へのリクエストを発さず、保存の SVG は画面と同じ配置', async () => {
  const realFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('外部通信をしない'); };
  try {
    const run = async () => {
      const { app, say, next, toPeriod } = await mk();
      say('会議室は三階にあります', 'コストが高くて困った'); toPeriod();
      next(); say('Aを採用すると決まりました。', 'まだ決まっていない', 'まだ決まっていない');
      const provisional = app.renderSvg();
      toPeriod();
      return { els: JSON.stringify(els(app)), svg: app.renderSvg(), provisional };
    };
    const a = await run(); const b = await run();
    assert.equal(b.els, a.els); assert.equal(b.svg, a.svg); assert.equal(b.provisional, a.provisional);
    assert.notEqual(a.provisional, a.svg, '暫定の位置の要素を含む画面と、再配置後の画面は別の配置');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = realFetch; }
  // 暫定の木: 前回の木を保ち、新しい要点は末尾へ
  const snap = sceneTree({ id: 's', points: [{ id: 'a', text: 'コストが高くて困った' }, { id: 'b', text: 'Aを採用すると決まりました。' }] });
  const pt = provisionalTree({ id: 's', points: [{ id: 'a', text: 'コストが高くて困った' }, { id: 'b', text: 'Aを採用すると決まりました。' }, { id: 'c', text: '新しい' }] }, snap);
  assert.deepEqual(leaves(pt).map((l) => [l.key, l.provisional]), [['b', false], ['a', false], ['c', true]]);
  const g1 = detailGeometry([{ id: 's', heading: 'h', status: 'confirmed', relations: [], points: [{ id: 'a', text: 'x' }] }], null, 'ja');
  const g2 = detailGeometry([{ id: 's', heading: 'h', status: 'confirmed', relations: [], points: [{ id: 'a', text: 'x' }] }], null, 'ja');
  assert.deepEqual(g1, g2);
});

// ---- 差し戻し（レビュー）で足した結合テスト ----
const LAYOUT_TYPES = ['timeline', 'bubble', 'diverge', 'zone', 'metaphor'];
const rectOf = (e) => [e.x, e.y, e.w, e.h];

// FR-079 AC-432
test('FR-079 AC-432: 中項目・大項目で、後から加わるトピックが前のトピックと関連（離れた関連の弧）で結ばれても、前のトピックの要素は動かない', async () => {
  for (const type of LAYOUT_TYPES) for (const lv of ['middle', 'major']) {
    const { app, say, next, toPeriod } = await mk();
    app.setLayoutTypes([type]); app.setDetailLevel(lv);
    say('予算 会議 その一'); next(); say('リリース 計画 です'); next(); say('担当 割当 です');
    toPeriod();
    const tps0 = app.getTopics();
    assert.equal(tps0.length, 3);
    const keep = new Set(tps0.slice(0, 2).map((tp) => tp.id));
    const before = new Map(els(app).filter((e) => keep.has(e.topicId) && e.kind !== 'group' && e.kind !== 'unit').map((e) => [e.id, rectOf(e)]));
    assert.ok(before.size >= 2);
    for (const [i, extra] of ['予算 会議 その二', '名札 配布 です', '撮影 後方 です', 'リリース 計画 その二'].entries()) {
      next(); say(extra); toPeriod();
      assert.ok(app.getTopicRelations().some((r) => r.kind === 'related') || i > 0, '離れたトピックの関連がある');
      for (const e of els(app).filter((x) => before.has(x.id))) assert.deepEqual(rectOf(e), before.get(e.id), `${type}・${lv}: ${e.id} は動かない（${extra}）`);
    }
  }
});

// FR-079 AC-431（FR-036 AC-166）
test('FR-079 AC-431: タイトル欄の文字は最上位の大きさのまま欄の幅で折り返され、長い演題でも日付・会場を含めタイトル欄と図の範囲（viewBox）に収まる', async () => {
  for (const type of LAYOUT_TYPES) {
    const { app, say } = await mk();
    app.setLayoutTypes([type]);
    say('会議室は三階にあります');
    const info = { series: '週次の振り返り', theme: 'とても長い演題の例です'.repeat(6), date: '2026-10-16', venue: '大会議室' };
    app.setTitleInfo(info);
    const L = app.getDiagramLayout();
    const rows = L.titleRows;
    assert.ok(rows.length >= 4);
    const svg = app.renderSvg();
    const [, vw, vh] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg).map(Number);
    for (const r of rows) {
      assert.equal(r.size, TYPE_SCALE.title);
      assert.ok(r.x >= L.title.x && r.x + r.w <= L.title.x + L.title.w + 0.5, `${type}: 「${r.text}」が欄の幅に収まる`);
      assert.ok(r.y - r.size >= L.title.y - 1 && r.y + r.size * 0.3 <= L.title.y + L.title.h, `${type}: 「${r.text}」が欄の高さに収まる`);
      assert.ok(r.x + r.w <= vw && L.title.y + L.title.h <= vh, `${type}: viewBox に収まる`);
      assert.ok(svg.includes(`>${r.text}</text>`), 'SVG に描かれる');
    }
    for (const k of ['date', 'venue', 'series']) assert.ok(rows.some((r) => r.text === info[k]), `${k} が欄に表示される`);
    assert.equal(rows.filter((r) => info.theme.includes(r.text)).map((r) => r.text).join(''), info.theme, '演題は折り返しても欠けない');
    for (const g of L.groups) assert.ok(g.frame.y >= L.title.y + L.title.h, `${type}: 本編はタイトル欄の下`);
    for (const u of L.units) assert.ok(u.y >= L.title.y + L.title.h, `${type}: 単位はタイトル欄の下`);
  }
});

// FR-079 AC-426 AC-429 AC-433
test('FR-079 AC-426 AC-429: 吹き出し型・区画型・比喩型の詳細でも、再配置で結論が先頭に昇格し、同一の要点はまとめて件数を示す', async () => {
  for (const type of ['bubble', 'zone', 'metaphor']) {
    const { app, say, toPeriod } = await mk();
    app.setLayoutTypes([type]);
    say('コストが高くて困った', '資料は共有フォルダに置きました', '資料は共有フォルダに置きました', 'Aを採用すると決まりました。');
    const pre = JSON.stringify(app.getDiagramLayout().units.map((u) => u.text));
    toPeriod();
    const L = app.getDiagramLayout();
    if (type === 'bubble') {
      const texts = L.units.sort((a, b) => a.order - b.order).map((u) => u.text);
      assert.deepEqual(texts, ['Aを採用すると決まりました。', 'コストが高くて困った', '資料は共有フォルダに置きました ×2'], `${type}: 種類の順・まとめ`);
    } else {
      const u = L.units.find((x) => x.kind === 'scene');
      const pts = u.text.slice(u.text.indexOf('：') + 1);
      assert.ok(pts.indexOf('Aを採用すると決まりました。') === 0 && pts.indexOf('コストが高くて困った') > 0, `${type}: 結論が先頭`);
      assert.ok(pts.includes('資料は共有フォルダに置きました ×2'), `${type}: 同一の要点はまとめる`);
    }
    assert.notEqual(JSON.stringify(L.units.map((u) => u.text)), pre, `${type}: 再配置の前は話順のまま`);
  }
});

// FR-079 AC-430
test('FR-079 AC-430(c): 型の配置（タイトル欄・まとまり・単位）を含む図の要素は、すべての型・詳細度で親子でなければ重ならない', async () => {
  for (const type of LAYOUT_TYPES) for (const lv of ['detail', 'middle', 'major']) {
    const { app, say, next, toPeriod } = await mk();
    app.setLayoutTypes([type]); app.setDetailLevel(lv);
    app.setTitleInfo({ series: '週次', theme: '長い演題'.repeat(12), date: '2026-10-16', venue: '大会議室' });
    say('予算 会議 は三階', 'コストが高くて困った'); next();
    say('リリース 計画 を決める', 'Aを採用すると決まりました。', '質問はありますか？', 'ありません'); next();
    say('担当 割当 の確認', '会場 の件', '名札 の件', '撮影 の件', '配布 の件');
    toPeriod();
    const list = els(app);
    const kinds = new Set(list.map((e) => e.kind));
    for (const k of ['title', 'group', 'unit']) assert.ok(kinds.has(k), `${type}・${lv}: 型の配置の ${k} を含む`);
    assertNoOverlap(list);
    say('追加の要点'); // 暫定の位置でも重ならない
    assertNoOverlap(els(app));
  }
});
