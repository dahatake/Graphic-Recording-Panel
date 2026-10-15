// FR-031 AC-152〜154 / FR-032 AC-155 AC-156 / FR-033 AC-158〜160 の単体・結合テスト（型ごとの配置と SVG への反映）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timelineTypeLayout, bubbleLayout, divergeLayout } from '../../web/src/layoutkinds.js';
import { newApp } from '../system/helpers.js';

const pt = (id, text) => ({ id, text });
const sc = (id, ...texts) => ({ id, heading: `見出し${id}`, points: texts.map((t, i) => pt(`${id}p${i}`, t)) });
const tp = (id, ...ids) => ({ id, title: `話題${id}`, sceneIds: ids });
const input = (scenes, topics, level = 'detail', extra = {}) => ({ level, scenes, topics, titleInfo: null, lang: 'ja', ...extra });
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const SCENES = [sc('s1', '納期が遅れている'), sc('s2', '人を増やす案を出そう'), sc('s3', '予算が足りないから難しい'), sc('s4', 'この方針に決定します')];
const TOPICS = [tp('t1', 's1', 's2'), tp('t2', 's3', 's4')];

// FR-031 AC-153: 原因→結果・課題→提案が矢印と文字のラベルでつながり、冒頭と結論が強調される（詳細のとき）
test('FR-031 AC-153: 詳細で原因→結果・課題→提案の矢印ラベルと、冒頭・結論の強調が付く', () => {
  const L = timelineTypeLayout(input(SCENES, TOPICS));
  const label = (a, b) => L.arrows.find((x) => x.from === a && x.to === b)?.label;
  assert.equal(label('s1', 's2'), '課題→提案');
  assert.equal(label('s2', 's3'), '原因→結果');
  assert.equal(L.units[0].emphasis, 'opening');
  assert.equal(L.units[3].emphasis, 'conclusion');
  assert.equal(L.units[3].badge, '結論');
  const en = timelineTypeLayout(input([sc('a', 'cost problem'), sc('b', 'maybe cut scope'), sc('c', 'late because tests fail')], [tp('t', 'a', 'b', 'c')], 'detail', { lang: 'en' }));
  assert.equal(en.arrows[0].label, 'Issue→Proposal'); assert.equal(en.arrows[1].label, 'Cause→Effect');
});

test('FR-031 AC-153: 大項目・中項目では矢印のラベルと結論の強調は付かず、冒頭だけ強調される', () => {
  for (const lv of ['major', 'middle']) {
    const L = timelineTypeLayout(input(SCENES, TOPICS, lv));
    assert.ok(L.arrows.every((a) => a.label === null));
    assert.deepEqual(L.units.map((u) => u.emphasis), L.units.map((_, i) => (i === 0 ? 'opening' : null)));
  }
});

test('FR-031 AC-153: 同じシーン内の因果は単位の中のラベルになり、矢印の本数は変わらない', () => {
  const L = timelineTypeLayout(input([sc('a', '遅れた', '人が足りないから')], [tp('t', 'a')]));
  assert.equal(L.units[0].relations[0].label, '原因→結果');
  assert.equal(L.arrows.length, 0);
});

// FR-031 AC-154: 決定的
test('FR-031 AC-154: 同じ入力から毎回同じ配置・矢印・強調になる', () => {
  const a = JSON.stringify(timelineTypeLayout(input(SCENES, TOPICS)));
  assert.equal(a, JSON.stringify(timelineTypeLayout(input(SCENES, TOPICS))));
});

// FR-032 AC-155: 質問に答えが重なって接続され、話題の切替に余白がある
test('FR-032 AC-155: 質問の吹き出しに答えの吹き出しが重なって接続され、話題が替わる所に余白がある', () => {
  const L = bubbleLayout(input([sc('s1', 'いつ出せますか？', '来週です'), sc('s2', '次の話題を始める')], [tp('t1', 's1'), tp('t2', 's2')]));
  const [q, a, n] = L.units;
  assert.equal(q.role, 'question'); assert.equal(a.role, 'answer'); assert.equal(a.attachedTo, q.id);
  assert.ok(overlap(q, a), '答えは質問に重なる');
  assert.deepEqual(L.arrows, [{ from: q.id, to: a.id, label: null }]);
  assert.ok(n.y - (a.y + a.h) >= 40, '話題の切替の余白');
  assert.equal(L.groups.length, 2);
});

// FR-032 AC-156: 感情語のトピックは形が違う
test('FR-032 AC-156: 感情語を含む吹き出しは通常と異なる形（jagged）になる', () => {
  const L = bubbleLayout(input([sc('s1', '不安で仕方ない'), sc('s2', '普通の連絡です')], [tp('t1', 's1'), tp('t2', 's2')]));
  assert.deepEqual(L.units.map((u) => u.shape), ['jagged', 'round']);
});

// FR-033 AC-158〜160
const MANY = Array.from({ length: 30 }, (_, i) => sc(`s${i}`, `意見${i} 項目${i % 5}`));
test('FR-033 AC-158: 中央にテーマ（最初のシーンの見出し）が最も大きく、すべての要点が中心からの線でつながる', () => {
  const L = divergeLayout(input([sc('a', '一つ目', '二つ目'), sc('b', '三つ目')], [tp('t', 'a', 'b')]));
  assert.equal(L.center.text, '見出しa');
  assert.equal(L.units.length, 3);
  assert.ok(L.units.every((u) => L.center.w * L.center.h > u.w * u.h));
  assert.equal(L.arrows.filter((x) => x.from === 'center').length, 3);
});

test('FR-033 AC-159: 同じトピックは 1 つの囲み（ラベル付き）、共感（2 シーン以上で同じ語句）は強調、大きさは全員同じ', () => {
  const L = divergeLayout(input([sc('a', 'コスト 削減'), sc('b', 'コスト 見直し'), sc('c', '品質 確認')], [tp('t1', 'a', 'b'), tp('t2', 'c')]));
  assert.deepEqual(L.groups.map((g) => [g.kind, g.heading]), [['enclosure', '話題t1'], ['enclosure', '話題t2']]);
  assert.deepEqual(L.units.map((u) => u.emphasis), ['echo', 'echo', null]);
  assert.equal(new Set(L.units.map((u) => `${u.w}x${u.h}`)).size, 1);
});

test('FR-033 AC-160: 同じ入力で同じ配置になり、意見が増えても重ならず、枠は本編の内側にある', () => {
  const topics = [tp('t', ...MANY.map((s) => s.id))];
  const L = divergeLayout(input(MANY, topics));
  assert.equal(JSON.stringify(L), JSON.stringify(divergeLayout(input(MANY, topics))));
  for (let i = 0; i < L.units.length; i++) {
    assert.ok(!overlap(L.units[i], L.center), '中央と重ならない');
    for (let j = i + 1; j < L.units.length; j++) assert.ok(!overlap(L.units[i], L.units[j]), `${i} と ${j}`);
  }
  for (const u of L.units) assert.ok(u.x >= L.body.x && u.x + u.w <= L.body.x + L.body.w + 0.5 && u.y >= L.body.y && u.y + u.h <= L.body.y + L.body.h + 0.5);
  assert.equal(divergeLayout(input([], [])).units.length, 0);
});

// 結合: 型の配置が renderSvg に反映される
test('FR-031 FR-032 FR-033: renderSvg に各型の単位・矢印・強調が data 属性つきで描かれる', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  for (const t of ['納期が遅れている', '人を増やす案を出そう', 'いつ出せますか？', '不安です']) { app.setDraft(t); app.submitDraft(); env.tick(1); app.commands['session.nextScene'](); }
  app.setDetailLevel('detail');
  app.setLayoutTypes(['timeline']);
  let svg = app.renderSvg();
  assert.match(svg, /data-unit-id=/); assert.match(svg, /data-flow-from=/); assert.match(svg, /data-role="arrow-label"/); assert.match(svg, /data-emphasis="opening"/);
  app.setLayoutTypes(['bubble']);
  svg = app.renderSvg();
  assert.match(svg, /data-layout-head="bubble"/); assert.match(svg, /data-bubble-shape="jagged"/);
  app.setLayoutTypes(['diverge']);
  svg = app.renderSvg();
  assert.match(svg, /data-role="center"/); assert.match(svg, /data-flow-from="center"/);
});

