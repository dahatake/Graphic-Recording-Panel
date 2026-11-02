// FR-105 AC-607〜609: 読み順の型（Z 型・F 型・左右比較・フロー）の判定・設定画面・配置の単体・結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectReadingOrder, resolveReadingOrder, enumerationEvidence } from '../../web/src/readingorder.js';
import { timelineLayout } from '../../web/src/layouttypes.js';
import { newApp, makeEnv } from '../system/helpers.js';

const sc = (id, ...texts) => ({ id, heading: `見出し${id}`, points: texts.map((t, i) => ({ id: `${id}p${i}`, text: t })) });
const tp = (id, ...ids) => ({ id, title: `話題${id}`, sceneIds: ids });

// FR-105 AC-607
test('FR-105 AC-607: 判定の順は 左右比較 ＞ フロー ＞ F 型 ＞ Z 型（既定）で、決定的', () => {
  assert.equal(detectReadingOrder([sc('a', '賛成です', 'まず準備する')]).type, 'compare');
  assert.equal(detectReadingOrder([sc('a', 'まず準備する', 'また別の話')]).type, 'flow');
  assert.equal(detectReadingOrder([sc('a', 'ほかに案がある')]).type, 'f');
  assert.deepEqual(detectReadingOrder([sc('a', '天気がよい')]), { type: 'z', reason: 'default', phrase: null });
  assert.deepEqual(detectReadingOrder([]), { type: 'z', reason: 'default', phrase: null });
  const s = [sc('a', 'しかし高い'), sc('b', 'then ship')];
  assert.deepEqual(detectReadingOrder(s), detectReadingOrder(s));
  assert.equal(detectReadingOrder([sc('a', 'FIRST we plan')]).reason, 'flow');
  assert.equal(detectReadingOrder([sc('a', 'thenceforth')]).type, 'z', '英語の語は語境界つき');
});

test('FR-105 AC-607: 列挙の「・」は行頭の箇条書きだけで、語の中の「・」には一致しない', () => {
  assert.equal(enumerationEvidence('A・B の話'), null);
  assert.equal(enumerationEvidence('・りんご'), '・');
  assert.equal(enumerationEvidence('果物\n・りんご'), '・');
  assert.equal(enumerationEvidence('1つ目は価格'), '1 つ目');
  assert.equal(enumerationEvidence('第二に'), '第二');
});

test('FR-105 AC-607: 手動の選択は自動の判定より優先する', () => {
  const s = [sc('a', '賛成です')];
  assert.equal(resolveReadingOrder(s, 'auto').type, 'compare');
  assert.deepEqual(resolveReadingOrder(s, 'f'), { type: 'f', reason: 'manual', phrase: null });
});

// FR-105 AC-609: 配置
const units = (n) => Array.from({ length: n }, (_, i) => sc(`s${i}`, `点${i}`));
const lay = (n, readingType) => { const scenes = units(n); return timelineLayout({ level: 'middle', scenes, topics: [tp('A', ...scenes.map((s) => s.id))], titleInfo: null, readingType }); };

test('FR-105 AC-609: Z 型は従来どおり（左→右・次の行）、F 型は上 2 行を横に左端を縦、フローは 1 列、左右比較は 2 列（左→右）', () => {
  const z = lay(6, undefined);
  assert.equal(z.readingType, 'z');
  assert.deepEqual(z.units.map((u) => u.x === z.units[0].x ? 0 : 1).slice(0, 4), [0, 1, 1, 0]);
  const f = lay(7, 'f');
  assert.equal(f.readingType, 'f');
  const ys = f.units.map((u) => u.y);
  assert.equal(ys[0], ys[1]); assert.equal(ys[1], ys[2]); assert.equal(ys[3], ys[4]); assert.ok(ys[5] > ys[4] && ys[6] > ys[5]);
  assert.equal(f.units[5].x, f.units[0].x); assert.equal(f.units[6].x, f.units[0].x);
  const fl = lay(4, 'flow');
  assert.ok(fl.units.every((u, i) => u.x === fl.units[0].x && (i === 0 || u.y > fl.units[i - 1].y)));
  const c = lay(5, 'compare');
  const left = c.units.slice(0, 3); const right = c.units.slice(3);
  assert.ok(left.every((u) => u.x === left[0].x) && right.every((u) => u.x === right[0].x) && right[0].x > left[0].x);
  assert.equal(c.units.length, 5, '省かれない');
  for (const L of [z, f, fl, c]) assert.equal(L.arrows.length, L.units.length - 1, '前から後への矢印');
  for (const L of [f, fl, c]) for (const g of L.groups) assert.ok(g.frame.w > 0 && g.frame.h > 0);
});

// FR-105 AC-608・AC-609: 設定画面・保存・復元
async function feed(app, env, texts) {
  app.commands['session.start']();
  for (const t of texts) { app.setDraft(t); app.submitDraft(); env.tick(1); }
}

test('FR-105 AC-608: 現在の型と理由が文字で示され、手動で選び直せて自動に戻せ、端末の設定として保存・復元される。話順のテキスト一覧は変わらない', async () => {
  const { createApp } = await newApp();
  const env = makeEnv();
  const app = await createApp(env.options);
  await feed(app, env, ['賛成の人が多い', '反対の意見もある']);
  app.commands['settings.open']();
  const d = app.getSettingsDialog();
  assert.equal(d.readingOrder.type, 'compare');
  assert.match(d.readingOrder.text, /左右比較/); assert.match(d.readingOrder.text, /対立・比較の言い回し/);
  const before = JSON.stringify(app.getState().scenes.map((s) => s.points.map((p) => p.text)));
  assert.equal(app.getDiagramLayout().readingType, 'compare');
  assert.ok(app.setReadingOrder('flow').ok);
  assert.equal(app.getReadingOrder().type, 'flow'); assert.equal(app.getReadingOrder().reason, 'manual');
  assert.equal(app.getDiagramLayout().readingType, 'flow');
  assert.equal(JSON.stringify(app.getState().scenes.map((s) => s.points.map((p) => p.text))), before, 'テキスト一覧は話順のまま');
  assert.equal(app.setReadingOrder('nosuch').ok, false);
  // 保存・復元（端末ごとの設定。データの初期化では消えない）
  const app2 = await createApp(env.options);
  assert.equal(app2.getReadingOrder().mode, 'flow');
  app2.clearSavedSession();
  assert.equal((await createApp(env.options)).getReadingOrder().mode, 'flow');
  assert.ok(app2.setReadingOrder('auto').ok);
  assert.equal(app2.getReadingOrder().mode, 'auto');
  assert.deepEqual(app2.getSettings(), { layout: { mode: 'fixed', types: ['timeline'] }, drawStyle: 'handwritten' }, '既存の設定の形は変わらない');
  env.storage.setItem('grp.settings', '{"readingOrder":"nosuch"}');
  assert.equal((await createApp(env.options)).getReadingOrder().mode, 'auto');
});

test('FR-105 AC-607: 放射状（発散）のときは型を適用せず固有の順を保つ', async () => {
  const { app, env } = await newApp();
  await feed(app, env, ['賛成です']);
  app.setLayoutTypes(['diverge']);
  const r = app.getReadingOrder();
  assert.equal(r.applicable, false); assert.equal(r.type, null);
  assert.match(r.reasonText, /適用しない/);
  assert.equal(app.getDiagramLayout().readingType, undefined);
});
