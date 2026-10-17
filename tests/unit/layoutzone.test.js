// FR-034 AC-161〜163（区画型）/ FR-035 AC-164 AC-165（比喩テンプレート型）の単体・結合テスト
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneLayout, metaphorLayout } from '../../web/src/layoutkinds.js';
import { newApp } from '../system/helpers.js';

const sc = (id, ...texts) => ({ id, heading: `見出し${id}`, points: texts.map((t, i) => ({ id: `${id}p${i}`, text: t })) });
const tp = (id, ...ids) => ({ id, title: `話題${id}`, sceneIds: ids });
const input = (scenes, topics, level = 'middle', extra = {}) => ({ level, scenes, topics, titleInfo: null, lang: 'ja', ...extra });
const mk = (n) => ({ scenes: Array.from({ length: n }, (_, i) => sc(`s${i}`, `点${i}`)), topics: Array.from({ length: n }, (_, i) => tp(`t${i}`, `s${i}`)) });

// FR-034 AC-161
test('FR-034 AC-161: トピック数 1 は区画 1 で区切り線なし、2〜4 は n 区画、超えた分は最後の区画にまとめる', () => {
  for (const [n, zones, lines] of [[1, 1, 0], [2, 2, 1], [3, 3, 2], [4, 4, 3], [6, 4, 3]]) {
    const { scenes, topics } = mk(n);
    const L = zoneLayout(input(scenes, topics));
    assert.equal(L.groups.length, zones, `n=${n}`);
    assert.equal(L.dividers.length, lines, `n=${n}`);
    assert.ok(L.groups.every((g) => g.kind === 'zone' && g.heading));
    assert.equal(L.units.length, n, '省かれない');
  }
  const { scenes, topics } = mk(6);
  const L = zoneLayout(input(scenes, topics));
  const last = L.groups[3].frame;
  const inLast = L.units.filter((u) => u.x >= last.x && u.x < last.x + last.w);
  assert.equal(inLast.length, 3);
});

// FR-034 AC-162
test('FR-034 AC-162: 区切り線はグレーで、区画の外枠は線にしない。SVG に反映される', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  for (const t of ['納期が遅れている', '人を増やす案を出そう']) { app.setDraft(t); app.submitDraft(); env.tick(1); app.commands['session.nextScene'](); }
  app.setLayoutTypes(['zone']);
  const L = app.getDiagramLayout();
  const svg = app.renderSvg();
  assert.equal(L.type, 'zone');
  if (L.groups.length > 1) assert.match(svg, /data-role="zone-divider"[^>]*stroke="#8a8a8a"/);
  assert.match(svg, /data-group-kind="zone"/);
});

// FR-034 AC-163
test('FR-034 AC-163: 同じ入力から毎回同じ配置になり、トピックの題名の修正が反映される', () => {
  const { scenes, topics } = mk(3);
  assert.equal(JSON.stringify(zoneLayout(input(scenes, topics))), JSON.stringify(zoneLayout(input(scenes, topics))));
  const edited = topics.map((t, i) => (i === 1 ? { ...t, title: '修正済み' } : t));
  assert.equal(zoneLayout(input(scenes, edited)).groups[1].heading, '修正済み');
});

// FR-035 AC-164
test('FR-035 AC-164: ゴールの語があれば道・山・橋・太陽が描かれ、課題→解決策→成果の順に要点が載る', () => {
  const scenes = [sc('a', '遅れが課題'), sc('b', '案を出そう'), sc('c', '成果が出た'), sc('d', 'ゴールは来月')];
  const L = metaphorLayout(input(scenes, [tp('t', 'a', 'b', 'c', 'd')], 'detail'));
  assert.equal(L.metaphor.kind, 'journey');
  assert.deepEqual(L.metaphor.elements.map((e) => e.type).sort(), ['bridge', 'mountain', 'road', 'sun']);
  assert.deepEqual(L.metaphor.sections.map((g) => g.heading), ['課題', '解決策', '成果']);
  assert.ok(L.units.every((u) => u.text.includes('：')), '詳細は要点を載せる');
  assert.deepEqual(L.units.map((u) => u.order), [0, 1, 2, 3]);
});

// FR-035 AC-165
test('FR-035 AC-165: ゴールの語がなければ 4 象限で、区分と軸に文字のラベルがあり、全要点が省かれない', () => {
  const scenes = [sc('a', '良い反応だった'), sc('b', '遅れが課題'), sc('c', '案を出そう'), sc('d', '方針に決定します')];
  const L = metaphorLayout(input(scenes, [tp('t', 'a', 'b', 'c', 'd')]));
  assert.equal(L.metaphor.kind, 'quadrant');
  assert.equal(L.metaphor.sections.length, 4);
  assert.equal(L.units.length, 4);
  assert.ok(L.metaphor.axes.x.label && L.metaphor.axes.y.label);
  const en = metaphorLayout(input(scenes, [tp('t', 'a', 'b', 'c', 'd')], 'middle', { lang: 'en' }));
  assert.ok(en.metaphor.sections.every((g) => /^[\x20-\x7e]+$/.test(g.heading)));
});

test('FR-035 AC-164 AC-165: 比喩は先に描かれ、外部への参照を含まない', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  for (const t of ['私たちのゴールを決めよう', '遅れが課題です']) { app.setDraft(t); app.submitDraft(); env.tick(1); app.commands['session.nextScene'](); }
  app.setLayoutTypes(['metaphor']);
  const svg = app.renderSvg();
  assert.match(svg, /data-metaphor-element="sun"/);
  assert.ok(svg.indexOf('data-role="metaphor"') < svg.indexOf('data-unit-id'));
  assert.doesNotMatch(svg.replace(/xmlns="[^"]*"/, ''), /https?:|<image|href=/);
  assert.match(svg, /data-role="metaphor-label"/);
});

// FR-052 AC-231 / FR-035 AC-165: 提案はアイデアの区画、合意済みの決定は結論
test('FR-052 AC-231 FR-035 AC-165: 提案はアイデアの象限に入る', () => {
  const scenes = [sc('a', '良い反応だった'), sc('b', '遅れが課題'), sc('c', '案を出そう'), sc('d', '新しい進め方を提案します')];
  const L = metaphorLayout(input(scenes, [tp('t', 'a', 'b', 'c', 'd')]));
  const at = (i) => L.units.find((u) => u.order === i);
  assert.equal(at(3).x, at(2).x);
  assert.equal(at(3).y > at(1).y, true);
});
