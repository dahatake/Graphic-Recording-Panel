// FR-027 AC-139 AC-140 / FR-028 AC-145 / FR-031 AC-152 / FR-036 AC-167（System Test。契約: tests/system/CONTRACT.md「レイアウト型・描画スタイル・設定画面」）
// 期待値は受入基準だけから決める。実装は未着手でも書ける契約の API だけを使う。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, makeEnv, keyFor, toDetail, CJK } from './helpers.js';

const TYPES = ['timeline', 'bubble', 'diverge', 'zone', 'metaphor', 'workshop'];
const weight = (s) => [...s].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.5), 0);
// 空白区切りの語を 2 語以上共有するシーンが同じトピック（PARAM-015）。順序の語・ビジョンの語は含めない。
const TWO_TOPICS = [['予算 コスト 見直し 必要'], ['予算 コスト 削減 検討'], ['リリース 計画 決定 日程'], ['リリース 計画 担当 確認']];
const THREE_TOPICS = [['予算 コスト 見直し 必要'], ['予算 コスト 削減 検討'], ['リリース 計画 決定 日程'], ['リリース 計画 担当 確認'], ['品質 試験 範囲 確認'], ['品質 試験 結果 共有']];
const ONE_TOPIC = [['データ 分析 結果 確認'], ['データ 分析 方法 共有']];

async function seed(app, env, groups) {
  app.commands['session.start']();
  groups.forEach((g, i) => {
    g.forEach((t) => { app.setDraft(t); app.submitDraft(); env.tick(1); });
    if (i < groups.length - 1) app.commands['session.nextScene']();
  });
}
const sceneOf = (app) => app.getState().scenes;
const barItem = (app, id) => app.getCommandBar().items.find((i) => i.command === `layoutType.${id}`);
const info = (app) => app.getLayoutInfo();
const core = (app) => { const s = app.getState(); return JSON.stringify([s.utterances.map((u) => u.text), s.scenes, s.selectedSceneId, s.session, s.input.draft, app.getDetailLevel(), s.viewMode, app.getDisplayMode()]); };
const svgTexts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const inside = (r, o) => r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w + 0.5 && r.y + r.h <= o.y + o.h + 0.5;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// FR-027 AC-139
test('FR-027 AC-139: 上部に 6 つの型のアイコン（FR-091 の追加後）があり、名称ラベル（PARAM-011 以内）とツールチップを持ち、選択中は色以外でも識別できる', async () => {
  const { app } = await newApp();
  assert.equal(app.getCommandBar().position, 'top');
  const labels = [];
  for (const id of TYPES) {
    const it = barItem(app, id);
    assert.ok(it, `${id} のアイコンがある`);
    assert.ok(it.label.trim() && weight(it.label) <= 6, `${id}: ラベルは 6 文字以内（${it.label}）`);
    assert.ok(it.tooltip && it.tooltip.text.trim() && it.tooltip.id && it.describedBy === it.tooltip.id, `${id}: ツールチップ`);
    assert.equal(app.showTooltip(it.command, 'hover').visible, true);
    app.hideTooltip(it.command, 'leave');
    labels.push(it.label);
  }
  assert.equal(new Set(labels).size, 6, 'ラベルは型ごとに異なる');
  const sel = TYPES.filter((id) => barItem(app, id).selected);
  assert.deepEqual(sel, ['timeline'], '初期は固定のタイムラインが選択中');
  for (const id of TYPES) {
    const it = barItem(app, id);
    if (it.selected) assert.ok(typeof it.selectedMark === 'string' && it.selectedMark.trim() && it.pressed === true, '選択中は色以外の手がかりがある');
    else assert.ok(it.selectedMark === null && it.pressed === false);
  }
});

test('FR-027 AC-139: キーボードとコマンドの検索から型を選べ、結果は message で示される', async () => {
  const { app } = await newApp();
  for (const id of TYPES) {
    const c = `layoutType.${id}`;
    assert.ok(keyFor(app, c), `${c} に割り当てがある`);
    assert.ok(app.searchCommands(barItem(app, id).label).some((x) => x.command === c), `${c} を検索で見つけられる`);
  }
  const k = keyFor(app, 'layoutType.zone');
  assert.equal(app.handleKey(k), 'layoutType.zone');
  assert.deepEqual(info(app).selected, ['zone']);
  assert.ok(barItem(app, 'zone').selected && !barItem(app, 'timeline').selected);
  assert.ok(app.getState().message.text.includes(barItem(app, 'zone').label));
  assert.equal(app.getCommandBar().status.role, 'status');
});

test('FR-027 AC-139 異常系: 存在しない型のコマンドは無く、型の名称ラベルは表示言語を切り替えても PARAM-011 以内で、英語では英語になる', async () => {
  const { app } = await newApp();
  assert.equal(barItem(app, 'nosuchtype'), undefined);
  assert.equal(typeof app.commands['layoutType.nosuchtype'], 'undefined');
  const ja = TYPES.map((id) => barItem(app, id).label);
  app.setLang('en');
  TYPES.forEach((id, i) => {
    const l = barItem(app, id).label;
    assert.ok(l.trim() && weight(l) <= 6, `${id}: ${l}`);
    assert.notEqual(l, ja[i]);
  });
});

// FR-027 AC-140
test('FR-027 AC-140: 手動で型を選ぶと図がその型で描かれ、シーンが増えても自動選択で上書きされない', async () => {
  const { app, env } = await newApp();
  await seed(app, env, TWO_TOPICS);
  app.setDetailLevel('middle');
  assert.deepEqual(app.setLayoutTypes(['bubble']).ok, true);
  assert.equal(info(app).manual, true); assert.equal(info(app).source, 'manual');
  assert.equal(app.getDiagramLayout().type, 'bubble');
  assert.match(app.renderSvg(), /data-layout-head="bubble"/);
  app.setSettings({ layout: { mode: 'auto' } });
  assert.deepEqual(info(app).selected, ['bubble'], '自動に切り替えても手動が優先');
  app.commands['session.nextScene']();
  app.setDraft('ビジョン ゴール 道のり 共有'); assert.ok(app.submitDraft().ok);
  assert.deepEqual(info(app).selected, ['bubble'], 'シーン・語が増えても自動で上書きされない');
  assert.equal(app.getState().session, 'recording');
});

test('FR-027 AC-140: 型を併用でき、先頭の型が配置を決め、最後の 1 つは外せない（0 個にならない）', async () => {
  const { app, env } = await newApp();
  await seed(app, env, TWO_TOPICS);
  assert.ok(app.setLayoutTypes(['zone', 'bubble']).ok);
  assert.deepEqual(info(app).selected, ['zone', 'bubble']);
  assert.equal(info(app).head, 'zone');
  assert.match(app.renderSvg(), /data-layout-types="zone bubble"/);
  assert.ok(app.toggleLayoutType('metaphor').ok);
  assert.deepEqual(info(app).selected, ['zone', 'bubble', 'metaphor']);
  assert.ok(app.toggleLayoutType('zone').ok);
  assert.deepEqual(info(app).selected, ['bubble', 'metaphor']);
  assert.equal(info(app).head, 'bubble', '先頭が外れると次の型が配置を決める');
  assert.ok(app.toggleLayoutType('metaphor').ok);
  const last = app.toggleLayoutType('bubble');
  assert.equal(last.ok, false, '最後の 1 つは外せない');
  assert.deepEqual(info(app).selected, ['bubble']);
  for (const bad of [[], ['nosuch'], ['zone', 'zone'], null, 'zone']) {
    let r; try { r = app.setLayoutTypes(bad); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  assert.deepEqual(info(app).selected, ['bubble'], '不正な指定では不変');
});

test('FR-027 AC-140: 手動の選択を解除すると設定の既定（固定ならその型、自動なら自動選択の結果）に戻る', async () => {
  const { app, env } = await newApp();
  await seed(app, env, TWO_TOPICS);
  app.setLayoutTypes(['diverge']);
  assert.ok(app.clearManualLayout().ok);
  assert.equal(info(app).manual, false);
  assert.deepEqual(info(app).selected, ['timeline'], '既定は固定のタイムライン');
  app.setSettings({ layout: { mode: 'fixed', types: ['zone'] } });
  app.setLayoutTypes(['bubble']);
  assert.ok(app.handleKey(keyFor(app, 'layoutType.clear')) === 'layoutType.clear');
  assert.deepEqual(info(app).selected, ['zone']);
  app.setSettings({ layout: { mode: 'auto' } });
  app.setLayoutTypes(['bubble']);
  app.clearManualLayout();
  assert.equal(info(app).manual, false);
  assert.equal(info(app).source, 'auto', '手動を解除すると設定の既定（自動）に戻る');
});

test('FR-027 AC-140: 整理の表示では型は図に適用されず選択は保たれ、時系列に戻ると反映される。3D・一覧・ポップアップ・内容は型の影響を受けない', async () => {
  const { app, env } = await newApp();
  await seed(app, env, TWO_TOPICS);
  toDetail(app);
  app.selectScene(sceneOf(app)[1].id);
  const beforeCore = core(app); const out = app.renderOutline(); const d3 = JSON.stringify(app.get3D()); const pop = JSON.stringify(app.getScenePopup());
  app.setLayoutTypes(['zone', 'bubble']);
  assert.equal(core(app), beforeCore, '型の切替で内容・選択・記録中の状態・詳細度が保たれる');
  assert.equal(app.renderOutline(), out); assert.equal(JSON.stringify(app.get3D()), d3); assert.equal(JSON.stringify(app.getScenePopup()), pop);
  app.setDisplayMode('arrange');
  assert.equal(info(app).applied, false);
  assert.deepEqual(info(app).selected, ['zone', 'bubble'], '選択は保たれる');
  assert.ok(!/data-layout-head/.test(app.renderSvg()), '整理の表示に型は適用されない');
  app.setDisplayMode('timeline');
  assert.equal(info(app).applied, true);
  assert.match(app.renderSvg(), /data-layout-head="zone"/);
});

test('FR-027 AC-140: 手動の現在値はセッションファイルの読込で復元され、再読込後は設定の既定になる', async () => {
  const { app, env, createApp } = await newApp();
  await seed(app, env, TWO_TOPICS);
  app.setLayoutTypes(['zone', 'bubble']);
  assert.equal((await app.commands['file.save']()).ok, true);
  const f = env.downloads.at(-1);
  const env2 = makeEnv();
  const app2 = await createApp(env2.options);
  assert.deepEqual((await app2.loadSessionFile({ name: f.filename, type: f.mime, size: f.data.length, text: f.data })).ok, true);
  assert.deepEqual(info(app2).selected, ['zone', 'bubble']);
  assert.equal(info(app2).manual, true);
  const app3 = await createApp(env.options);
  assert.equal(info(app3).manual, false, '再読込後は手動の選択がない');
  assert.deepEqual(info(app3).selected, ['timeline'], '設定の既定（固定のタイムライン）');
});

// FR-028 AC-145
function autoApp() { return newApp().then(async (r) => { r.app.setSettings({ layout: { mode: 'auto' } }); return r; }); }

test('FR-028 AC-145: 自動のとき、論点が連続した 2〜4 のトピックは区画、ビジョンの語は比喩テンプレート、順序の語はタイムライン、流れのない話は発散が選ばれ、上部アイコンに反映される', async () => {
  let r = await autoApp(); await seed(r.app, r.env, TWO_TOPICS);
  assert.equal(info(r.app).source, 'auto'); assert.equal(info(r.app).head, 'zone');
  assert.ok(barItem(r.app, 'zone').selected && barItem(r.app, 'zone').selectedMark);
  r = await autoApp(); await seed(r.app, r.env, [['ビジョン 実現 計画 共有'], ['ビジョン 実現 課題 確認']]);
  assert.equal(info(r.app).head, 'metaphor');
  r = await autoApp(); await seed(r.app, r.env, [['まず データ 分析 結果 確認'], ['次に データ 分析 方法 共有']]);
  assert.deepEqual(info(r.app).selected, ['timeline']);
  r = await autoApp(); await seed(r.app, r.env, ONE_TOPIC);
  assert.deepEqual(info(r.app).selected, ['diverge'], '流れのない話は発散');
  assert.ok(!info(r.app).selected.includes('timeline'), '流れのない話にタイムラインは選ばれない');
});

test('FR-028 AC-145: 手動の選択を解除して自動に戻ると、2 つの連続したトピックは自動選択で区画になる', async () => {
  const { app, env } = await autoApp();
  await seed(app, env, TWO_TOPICS);
  app.setLayoutTypes(['bubble']);
  app.clearManualLayout();
  assert.equal(info(app).source, 'auto');
  assert.equal(info(app).head, 'zone', '2 つの連続したトピックは自動選択で区画');
});

test('FR-028 AC-145: 複数の規則に当てはまるときは優先順位（比喩テンプレート＞区画＞順序のタイムライン）の高い型が先頭になり、当てはまった型が併用される', async () => {
  let r = await autoApp(); await seed(r.app, r.env, [['ビジョン 予算 コスト 必要'], ['ビジョン 予算 コスト 検討'], ['リリース 計画 決定 日程'], ['リリース 計画 担当 確認']]);
  assert.equal(info(r.app).selected[0], 'metaphor'); assert.ok(info(r.app).selected.includes('zone'));
  r = await autoApp(); await seed(r.app, r.env, [['まず 予算 コスト 必要'], ['予算 コスト 削減 検討'], ['最後に リリース 計画 日程'], ['リリース 計画 担当 確認']]);
  assert.equal(info(r.app).selected[0], 'zone'); assert.ok(info(r.app).selected.includes('timeline'));
});

test('FR-028 AC-145: 記録中にシーンが増えると自動選択の結果が更新され、手動の選択があれば更新されない', async () => {
  const { app, env } = await autoApp();
  await seed(app, env, ONE_TOPIC);
  assert.deepEqual(info(app).selected, ['diverge']);
  app.commands['session.nextScene']();
  app.setDraft('その後 次に ロードマップ 確認'); assert.ok(app.submitDraft().ok);
  assert.equal(info(app).head, 'metaphor', '語が増えて自動選択が更新される');
  assert.equal(app.getState().session, 'recording');
  app.setLayoutTypes(['bubble']);
  app.commands['session.nextScene']();
  app.setDraft('品質 試験 範囲 確認'); app.submitDraft();
  assert.deepEqual(info(app).selected, ['bubble']);
});

test('FR-028 AC-145 異常系: 既定が「固定」のときはシーンが増えても自動では変わらず、固定の型または手動に従う（手動＞既定）', async () => {
  const { app, env } = await newApp();
  await seed(app, env, ONE_TOPIC);
  app.commands['session.nextScene']();
  app.setDraft('ビジョン ゴール 道のり 共有'); app.submitDraft();
  assert.equal(info(app).source, 'fixed');
  assert.deepEqual(info(app).selected, ['timeline']);
  app.setSettings({ layout: { mode: 'fixed', types: ['zone'] } });
  assert.deepEqual(info(app).selected, ['zone']);
  app.setLayoutTypes(['bubble']);
  assert.deepEqual(info(app).selected, ['bubble']);
  assert.equal(info(app).source, 'manual');
});

test('FR-028 AC-145 異常系: シーンがない・発話がないときも自動選択は 1 つ以上の型を返す', async () => {
  const { app } = await autoApp();
  assert.ok(info(app).selected.length >= 1 && info(app).selected.every((t) => TYPES.includes(t)));
});

// FR-031 AC-152
const rowsOf = (units) => { const rows = []; for (const u of [...units].sort((a, b) => a.order - b.order)) { const last = rows.at(-1); if (last && Math.abs(last[0].y - u.y) < 1) last.push(u); else rows.push([u]); } return rows; };
const monotone = (row) => { const xs = row.map((u) => u.x); return xs.every((x, i) => i === 0 || x >= xs[i - 1]) || xs.every((x, i) => i === 0 || x <= xs[i - 1]); };

for (const lv of ['major', 'middle', 'detail']) {
  test(`FR-031 AC-152: タイムライン型で、詳細度「${lv}」の各単位が話順に左上から右下へ Z 字または S 字に並び、順序が矢印か番号で分かる`, async () => {
    const { app, env } = await newApp();
    await seed(app, env, THREE_TOPICS);
    app.setLayoutTypes(['timeline']); app.setDetailLevel(lv);
    const L = app.getDiagramLayout();
    assert.equal(L.type, 'timeline');
    const expect = lv === 'major' ? app.getTopics().length : sceneOf(app).length;
    assert.equal(L.units.length, expect, lv === 'major' ? '各トピック' : '各シーン');
    assert.deepEqual(L.units.map((u) => u.order).sort((a, b) => a - b), L.units.map((_, i) => i));
    const rows = rowsOf(L.units);
    assert.ok(rows.every(monotone), '行ごとに x が一方向');
    assert.ok(rows.every((r, i) => i === 0 || r[0].y > rows[i - 1][0].y), '行は上から下');
    const sorted = [...L.units].sort((a, b) => a.order - b.order);
    const first = sorted[0]; const lastU = sorted.at(-1);
    assert.ok(L.units.every((u) => first.y <= u.y), '先頭が最も上');
    assert.ok(lastU.y >= Math.max(...L.units.map((u) => u.y)) - 1, '末尾が最も下の行');
    if (rows.length > 1) assert.ok(rows[0].length >= 1);
    const svg = app.renderSvg();
    if (L.orderMark === 'arrow' || L.orderMark === 'both') {
      assert.equal(L.arrows.length, L.units.length - 1);
      assert.ok((svg.match(/data-flow-from=/g) || []).length >= L.units.length - 1, '矢印が描かれる');
    } else assert.equal(L.orderMark, 'number');
    if (L.orderMark === 'number' || L.orderMark === 'both') for (const u of sorted) assert.ok(new RegExp(`data-order="${u.order}"`).test(svg));
  });
}

test('FR-031 AC-152 異常系: 単位が 1 つだけのとき矢印は無く、シーンが 0 件のとき単位も無い', async () => {
  const { app, env } = await newApp();
  app.setLayoutTypes(['timeline']);
  assert.equal(app.getDiagramLayout().units.length, 0);
  await seed(app, env, [['データ 分析 結果 確認']]);
  app.setDetailLevel('middle');
  const L = app.getDiagramLayout();
  assert.equal(L.units.length, 1); assert.equal(L.arrows.length, 0);
});

// FR-036 AC-167
const TITLE = { series: '週次の振り返り', theme: '予算とリリース', date: '2026-10-16', venue: '大会議室' };
for (const type of ['timeline', 'bubble', 'zone', 'metaphor']) {
  for (const lv of ['major', 'detail']) {
    test(`FR-036 AC-167: ${type} 型・詳細度「${lv}」で、タイトル欄が左上、本編が残りの領域にあり、各まとまりに小見出しと外枠が付く`, async () => {
      const { app, env } = await newApp();
      await seed(app, env, TWO_TOPICS);
      app.setLayoutTypes([type]); app.setDetailLevel(lv);
      assert.ok(app.setTitleInfo(TITLE).ok !== false);
      const L = app.getDiagramLayout();
      assert.equal(L.centered, false, '中央配置の例外ではない');
      assert.equal(L.title.visible, true);
      for (const r of [L.title, L.body, ...L.units, ...L.groups.map((g) => g.frame)]) assert.ok(inside(r, { x: 0, y: 0, ...L.canvas }), '図の内側');
      assert.ok(L.units.length && L.groups.length >= 1);
      for (const u of L.units) assert.ok(u.x >= L.title.x && u.y >= L.title.y, 'タイトルが左上');
      for (const g of L.groups) {
        assert.ok(g.frame.x >= L.title.x && g.frame.y >= L.title.y, 'タイトル欄が左上');
        assert.ok(!overlap(g.frame, L.title), 'タイトル欄と重ならない');
        assert.ok(inside(g.frame, L.body), '本編の領域の内側');
        assert.ok(g.heading.trim(), '小見出しがある');
        assert.ok(g.frame.w > 0 && g.frame.h > 0, '外枠がある');
      }
      assert.ok(!overlap(L.title, L.body), 'タイトルと本編は別の領域');
      assert.ok(L.body.x >= L.title.x && L.body.y >= L.title.y);
      const svg = app.renderSvg();
      for (const g of L.groups) {
        const m = svg.match(new RegExp(`<g[^>]*data-group-id="${g.id}"[^>]*>[\\s\\S]*?</g>`));
        assert.ok(m, `まとまり ${g.id} が描かれる`);
        assert.match(m[0], /data-role="subheading"/); assert.match(m[0], /data-role="frame"/);
        assert.ok(m[0].includes(g.heading), '小見出しが文字で描かれる');
      }
      const out = app.renderOutline();
      for (const g of L.groups) assert.ok(out.includes(g.heading), `一覧に小見出し「${g.heading}」がある`);
    });
  }
}

test('FR-036 AC-167 異常系: トピックが 1 つでも小見出しと外枠がある。シーンが 0 件では図にまとまりが無く、タイトル欄は入力があれば左上にある', async () => {
  const { app, env } = await newApp();
  app.setLayoutTypes(['zone']);
  assert.equal(app.getDiagramLayout().groups.length, 0);
  app.setTitleInfo({ theme: '演題だけ' });
  const T = app.getDiagramLayout().title;
  assert.equal(T.visible, true);
  await seed(app, env, ONE_TOPIC);
  const L = app.getDiagramLayout();
  assert.ok(L.groups.length >= 1 && L.groups.every((g) => g.heading.trim() && g.frame.w > 0));
  assert.ok(L.groups.every((g) => !overlap(g.frame, L.title)));
});
