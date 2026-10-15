// FR-028 AC-142 AC-143 / FR-036 AC-166 AC-167 の単体テスト（自動選択の規則・共通配置・タイトル情報）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectLayoutTypes } from '../../web/src/autolayout.js';
import { timelineLayout } from '../../web/src/layouttypes.js';
import { newApp } from '../system/helpers.js';

const sc = (id, text) => ({ id, heading: id, points: [{ id: `${id}p`, text }] });
const ut = (text) => ({ text });

// FR-028 AC-142: 決定的で、常に 1 つ以上
test('FR-028 AC-142: 同じ入力から毎回同じ結果で、空の入力でも 1 つ以上の型を返す', () => {
  assert.deepEqual(selectLayoutTypes({}), ['diverge']);
  const input = { scenes: [sc('a', 'x')], utterances: [ut('x')], topics: [{ id: 't', title: 't', sceneIds: ['a'] }] };
  assert.deepEqual(selectLayoutTypes(input), selectLayoutTypes(input));
});

// FR-028 AC-143: 規則と優先順位
test('FR-028 AC-143: 語の規則（比喩＞区画＞順序のタイムライン、流れなしは発散）と英語の語', () => {
  assert.deepEqual(selectLayoutTypes({ utterances: [ut('Our Vision is clear')] }), ['metaphor']);
  assert.deepEqual(selectLayoutTypes({ utterances: [ut('first we plan, then ship')] }), ['timeline']);
  assert.deepEqual(selectLayoutTypes({ utterances: [ut('ロードマップ まず 確認')] }), ['metaphor', 'timeline']);
  assert.deepEqual(selectLayoutTypes({ utterances: [ut('thenceforth firstly')] }), ['diverge'], '語の一部は順序の語にならない');
});

test('FR-028 AC-143: トピック数が 2〜4 で連続のとき区画、1 つ・5 つ・交互のときは区画にならない', () => {
  const mk = (n) => ({ scenes: Array.from({ length: n }, (_, i) => sc(`s${i}`, 'a')), topics: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, title: `t${i}`, sceneIds: [`s${i}`] })) });
  assert.deepEqual(selectLayoutTypes(mk(1)), ['diverge']);
  for (const n of [2, 3, 4]) assert.deepEqual(selectLayoutTypes(mk(n)), ['zone']);
  assert.deepEqual(selectLayoutTypes(mk(5)), ['diverge']);
  const alt = { scenes: ['s0', 's1', 's2'].map((id) => sc(id, 'a')), topics: [{ id: 'a', title: 'a', sceneIds: ['s0', 's2'] }, { id: 'b', title: 'b', sceneIds: ['s1'] }] };
  assert.deepEqual(selectLayoutTypes(alt), ['diverge'], '交互のトピックは区画にならない');
});

// FR-036 AC-167: 共通配置
test('FR-036 AC-167: タイムラインの配置はトピックごとに行を改め、各まとまりに小見出しと外枠が付く', () => {
  const scenes = ['s0', 's1', 's2', 's3'].map((id) => sc(id, 'a'));
  const topics = [{ id: 'A', title: '予算', sceneIds: ['s0', 's1'] }, { id: 'B', title: '計画', sceneIds: ['s2', 's3'] }];
  const L = timelineLayout({ level: 'detail', topics, scenes, titleInfo: { theme: '演題' } });
  assert.deepEqual(L.groups.map((g) => g.heading), ['予算', '計画']);
  assert.ok(L.groups[0].frame.y + L.groups[0].frame.h <= L.groups[1].frame.y, 'まとまりの枠は重ならない');
  assert.equal(L.title.visible, true);
  assert.deepEqual(L.titleLines, ['演題']);
  const M = timelineLayout({ level: 'major', topics, scenes, titleInfo: null });
  assert.equal(M.groups.length, 2); assert.equal(M.title.visible, false);
});

// FR-036 AC-166: タイトル情報はセッション内のみ（API）
test('FR-036 AC-166: タイトル情報を入力・編集でき、不正な値は拒否し、未入力は表示されない', async () => {
  const { app } = await newApp();
  assert.equal(app.getDiagramLayout().title.visible, false);
  assert.ok(app.setTitleInfo({ series: ' 週次 ', venue: '' }).ok);
  assert.equal(app.getTitleInfo().series, '週次');
  assert.equal(app.getDiagramLayout().title.visible, true);
  assert.equal(app.setTitleInfo({ series: 3 }).ok, false);
  assert.equal(app.setTitleInfo(null).ok, false);
  assert.match(app.renderSvg(), /週次/, '保存する SVG にも含まれる');
});
