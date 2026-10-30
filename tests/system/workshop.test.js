// FR-091 AC-541 AC-542 AC-543（System Test。契約: tests/system/CONTRACT-WORKSHOP.md）
// 期待値は受入基準だけから決める。実装は未着手でも書ける契約の API だけを使う。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, keyFor, CJK } from './helpers.js';

const weight = (s) => [...s].reduce((n, ch) => n + (CJK.test(ch) ? 1 : 0.5), 0);
const PARAM_COLORS = ['0F2A43', '0E7490', '14B8A6', '1F7A54', 'E2632B', 'F3F7FA']; // PARAM-116〜121
const GREEN = '1F7A54';
const NEUTRAL = ['FFFFFF', '000000', 'NONE'];
const SIX = [['計画 日程 確認 完了'], ['予算 見積 確認 提出'], ['設計 画面 構成 決定'], ['開発 実装 担当 割当'], ['試験 品質 範囲 確認'], ['公開 告知 準備 実施']];
const info = (app) => app.getLayoutInfo();
const barItem = (app, id) => app.getCommandBar().items.find((i) => i.command === `layoutType.${id}`);
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const tags = (svg, attr) => [...svg.matchAll(new RegExp(`<[a-zA-Z][^>]*\\s${attr}(?:="[^"]*")?[^>]*>`, 'g'))].map((m) => m[0]);

async function seed(app, env, groups) {
  app.commands['session.start']();
  groups.forEach((g, i) => {
    g.forEach((t) => { app.setDraft(t); app.submitDraft(); env.tick(1); });
    if (i < groups.length - 1) app.commands['session.nextScene']();
  });
}
async function workshopApp(groups = SIX) {
  const r = await newApp();
  await seed(r.app, r.env, groups);
  assert.ok(r.app.setLayoutTypes(['workshop']).ok, 'workshop を選べる');
  return r;
}

// FR-091 AC-541
test('FR-091 AC-541: ワークショップホワイトボード型は、クリーム色の紙・見出しリボン・番号付きの 5〜6 ステージ・ラベルを SVG だけで描き、意味色以外とグリーンの 2 回目以降を使わない', async () => {
  const { app } = await workshopApp();
  assert.equal(info(app).head, 'workshop');
  const svg = app.renderSvg();
  assert.match(svg, /data-layout-head="workshop"/);
  const paper = tags(svg, 'data-ws-paper')[0];
  assert.ok(paper, '紙の背景がある');
  const fill = (attrs(paper).fill || '').replace('#', '');
  assert.match(fill, /^[0-9a-fA-F]{6}$/);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(fill.slice(i, i + 2), 16));
  assert.ok(r >= 0xf0 && b < 0xf0 && r >= g && g >= b, `クリーム色（${fill}）`);
  assert.ok(tags(svg, 'data-ws-ribbon').length >= 1, '見出しリボンがある');
  const stages = tags(svg, 'data-ws-stage').map((t) => Number(attrs(t)['data-ws-stage']));
  assert.ok(stages.length >= 5 && stages.length <= 6, `ステージは 5〜6 個（${stages.length}）`);
  assert.deepEqual(stages, stages.map((_, i) => i + 1), '番号は 1 から連番');
  const labels = [...svg.matchAll(/<text[^>]*data-ws-label[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].trim());
  assert.equal(labels.length, stages.length, '各ステージにラベル');
  assert.ok(labels.every((l) => l), '空のラベルはない');
  // 色: 意味色だけ。グリーンは全体で 1 要素
  const colors = [...svg.matchAll(/\b(?:fill|stroke)="#?([0-9a-fA-F]{6}|none)"/g)].map((m) => m[1].toUpperCase());
  const stray = colors.filter((c) => !PARAM_COLORS.includes(c) && !NEUTRAL.includes(c) && c !== fill.toUpperCase());
  assert.deepEqual(stray, [], '意味色以外の色がない');
  const greenEls = [...svg.matchAll(/<[a-zA-Z][^>]*\b(?:fill|stroke)="#?1F7A54"[^>]*>/gi)].length;
  assert.equal(greenEls, 1, 'グリーンは図全体で 1 回だけ');
  // SVG だけ・外部通信なし
  assert.ok(!/<image\b|<foreignObject\b|href="(?:https?:)?\/\//i.test(svg) && !/url\(\s*['"]?(?:https?:)?\/\//i.test(svg), '外部参照なし');
  assert.ok(!/https?:\/\//.test(svg.replace(/xmlns(?::\w+)?="[^"]*"/g, '')), '外部 URL がない');
});

test('FR-091 AC-541 異常系: 英語ではラベルが大文字になり、会話にない要素は描かれない（発話がないときはステージがない・シーン数を超えない）', async () => {
  const { app, env } = await workshopApp();
  app.setLang('en');
  const labels = [...app.renderSvg().matchAll(/<text[^>]*data-ws-label[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].trim());
  assert.ok(labels.length >= 5);
  for (const l of labels) assert.equal(l, l.toUpperCase(), `英語は大文字（${l}）`);
  app.setLang('ja');
  const empty = await newApp();
  assert.ok(empty.app.setLayoutTypes(['workshop']).ok);
  assert.equal(tags(empty.app.renderSvg(), 'data-ws-stage').length, 0, '会話がなければステージを作らない');
  const few = await workshopApp(SIX.slice(0, 2));
  assert.ok(tags(few.app.renderSvg(), 'data-ws-stage').length <= 2, 'シーンにないステージは作らない');
  assert.ok(env);
});

// FR-091 AC-542
test('FR-091 AC-542: 問いは 1 タイルにつき最大 1 つ、7 つのレンズの注記を付けられ、ラベル・問い・注記がテキスト一覧でも文字で確認できる（色だけに頼らない）', async () => {
  const { app } = await workshopApp();
  const lenses = app.getWorkshopLenses();
  assert.equal(lenses.length, 7, 'レンズは 7 つ');
  assert.ok(lenses.every((l) => l.id && l.label?.trim()));
  assert.equal(new Set(lenses.map((l) => l.id)).size, 7);
  const sceneId = app.getState().scenes[0].id;
  lenses.forEach((l, i) => assert.ok(app.addWorkshopNote({ sceneId, lens: l.id, text: `注記${i}` }).ok, `${l.id} の注記`));
  for (const bad of [{ sceneId, lens: 'nosuch', text: 'x' }, { sceneId, lens: lenses[0].id, text: '' }, { sceneId: 'nosuch', lens: lenses[0].id, text: 'x' }]) {
    let r; try { r = app.addWorkshopNote(bad); } catch { r = { ok: false }; }
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
  const svg = app.renderSvg();
  const stageTags = [...svg.matchAll(/<g[^>]*data-ws-stage="\d+"[^>]*>([\s\S]*?)<\/g>/g)].map((m) => m[1]);
  for (const body of stageTags) assert.ok((body.match(/data-ws-question/g) || []).length <= 1, '問いは 1 タイルにつき最大 1 つ');
  const qs = tags(svg, 'data-ws-question');
  assert.ok(qs.length >= 1 && qs.length <= stageTags.length, '問いが描かれる');
  assert.equal(tags(svg, 'data-ws-note').length >= 7, true, '注記が描かれる');
  const outline = app.renderOutline();
  const svgTexts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].trim()).filter(Boolean);
  for (const t of svgTexts) assert.ok(outline.includes(t), `テキスト一覧に図の文字がある: ${t}`);
  for (const l of lenses) assert.ok(outline.includes(l.label), `テキスト一覧にレンズ名: ${l.label}`);
  for (let i = 0; i < 7; i++) assert.ok(outline.includes(`注記${i}`));
  const q = qs[0] && svg.slice(svg.indexOf(qs[0]), svg.indexOf(qs[0]) + 600);
  assert.ok(/\?|？/.test(q), '問いのタイルは文字（?）でも識別できる');
});

// FR-091 AC-543
test('FR-091 AC-543: 6 つ目の型として上部アイコン・コマンド検索・キー・［設定］に他の型と同じ扱いで現れ、ラベルは PARAM-011 以内で日英がある', async () => {
  const { app } = await newApp();
  const it = barItem(app, 'workshop');
  assert.ok(it, 'workshop のアイコンがある');
  assert.ok(it.label.trim() && weight(it.label) <= 6, `ラベル 6 文字以内（${it.label}）`);
  assert.ok(it.tooltip?.text?.trim() && it.describedBy === it.tooltip.id);
  assert.ok(typeof app.commands['layoutType.workshop'] === 'function', 'コマンド名がある');
  assert.ok(keyFor(app, 'layoutType.workshop'), 'キーの割当がある');
  assert.ok(app.searchCommands(it.label).some((x) => x.command === 'layoutType.workshop'), 'コマンド検索で見つかる');
  assert.equal(app.handleKey(keyFor(app, 'layoutType.workshop')), 'layoutType.workshop');
  assert.deepEqual(info(app).selected, ['workshop']);
  assert.ok(barItem(app, 'workshop').selected && barItem(app, 'workshop').selectedMark && barItem(app, 'workshop').pressed === true);
  const ja = it.label;
  app.setLang('en');
  const en = barItem(app, 'workshop').label;
  assert.ok(en.trim() && !CJK.test(en) && weight(en) <= 6 && en !== ja, `英語ラベル（${en}）`);
  app.setLang('ja');
  assert.ok(app.setSettings({ layout: { mode: 'fixed', types: ['workshop'] } }) !== false);
  assert.deepEqual(app.getSettings().layout.types, ['workshop'], '［設定］の既定のレイアウトに選べる');
  app.commands['settings.open']();
  const f = app.getSettingsDialog().fields.find((x) => x.id === 'layout.types');
  assert.ok(f && JSON.stringify(f).includes('workshop'), '［設定］の型の選択肢に workshop がある');
  app.commands['settings.close']();
});

test('FR-091 AC-543: 音声認識の取込中・ファイル読込後も状態を失わずに切り替えられ、他の型と併用でき、自動選択では選ばれない', async () => {
  const { app, env } = await newApp();
  app.commands['session.start']();
  await app.startSpeech();
  env.speech.emit('計画 日程 確認 完了', true);
  const before = JSON.stringify([app.getState().utterances.map((u) => u.text), app.getState().session]);
  assert.ok(app.toggleLayoutType('workshop').ok);
  assert.ok(info(app).selected.includes('workshop'));
  assert.equal(JSON.stringify([app.getState().utterances.map((u) => u.text), app.getState().session]), before, '取込中の状態が保たれる');
  env.speech.emit('予算 見積 確認 提出', true);
  assert.equal(app.getState().utterances.length, 2, '切替後も発話を受け付ける');
  const r = await app.importTextFile({ name: 'a.vtt', type: 'text/vtt', size: 80, text: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nこんにちは 設計 画面\n' });
  assert.equal(r.ok, true);
  assert.ok(info(app).selected.includes('workshop'), '取込後も選択が保たれる');
  assert.ok(app.setLayoutTypes(['workshop', 'bubble']).ok, '併用できる');
  assert.equal(info(app).head, 'workshop');
  assert.ok(app.toggleLayoutType('workshop').ok);
  assert.equal(app.toggleLayoutType('bubble').ok, false, '最後の 1 つは外せない');
  assert.equal(app.toggleLayoutType('nosuch').ok, false);
});

test('FR-091 AC-543 異常系: 自動選択（FR-028）はどの会話でも workshop を選ばない', async () => {
  const groups = [SIX, SIX.slice(0, 2), [['ビジョン ゴール 道のり 共有'], ['最初に 次に 最後に 確認']], [['データ 分析 結果 確認'], ['データ 分析 方法 共有']]];
  for (const g of groups) {
    const { app, env } = await newApp();
    app.setSettings({ layout: { mode: 'auto' } });
    await seed(app, env, g);
    assert.ok(!info(app).selected.includes('workshop'), `自動選択は workshop を含まない（${info(app).selected}）`);
  }
});
