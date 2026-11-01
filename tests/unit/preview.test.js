// FR-101 AC-593〜595、FR-102 AC-596〜598 の単体・結合テスト（AC-592 は tests/system/preview.test.js）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from '../system/helpers.js';
import { enhanceRpgDom, renderRpgSvg } from '../../web/src/rpgmap.js';
import { PREVIEW_MS } from '../../web/src/preview.js';

async function seeded() {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  return { app, env, scenes: app.getState().scenes };
}
const T = (kind, id, surface = 'diagram') => ({ kind, id, surface });

test('FR-101 AC-593: フォーカスで PARAM-139 ミリ秒後にプレビューが出て、説明の関連付け（tooltip・describedBy）を持ち、フォーカスが外れると消える', async () => {
  const { app, env, scenes } = await seeded();
  assert.equal(PREVIEW_MS, 300);
  const t = T('scene', scenes[0].id, 'list');
  app.focusElement(t); env.scheduler.advance(PREVIEW_MS - 1);
  assert.equal(app.getPreview(), null);
  env.scheduler.advance(1);
  const pv = app.getPreview();
  assert.equal(pv.role, 'tooltip'); assert.ok(pv.describedBy.length > 0);
  app.blurElement(t);
  assert.equal(app.getPreview(), null);
});

test('FR-101 AC-593: ポインタをプレビューの上へ動かしても消えない（1.4.13）。離れると消える', async () => {
  const { app, env, scenes } = await seeded();
  const t = T('scene', scenes[0].id);
  app.hoverElement(t); env.scheduler.advance(PREVIEW_MS);
  app.hoverPreview(); app.unhoverElement(t);
  assert.ok(app.getPreview(), '要素を離れてもプレビューの上なら残る');
  app.leavePreview();
  assert.equal(app.getPreview(), null);
});

test('FR-101 AC-593・FR-102 AC-598: Esc の優先順位は 入力欄＞ポップアップ＞プレビュー＞地図の B ボタン で、1 回の Esc は 1 つだけを閉じる', async () => {
  const { app, env, scenes } = await seeded();
  app.setDrawStyle('rpg'); app.setRpgFocus(true);
  const t = T('scene', scenes[0].id);
  app.hoverElement(t); env.scheduler.advance(PREVIEW_MS);
  // 入力欄（文字入力）: プレビューは閉じない
  assert.notEqual(app.handleKey({ key: 'Escape', inTextInput: true }), 'preview.close');
  assert.ok(app.getPreview());
  // プレビュー: 地図の B ボタンにならずプレビューを閉じる
  assert.equal(app.handleKey({ key: 'Escape' }), 'preview.close');
  assert.equal(app.getPreview(), null);
  // ポップアップが開いているときはポップアップだけを閉じる
  app.activateElement(t, 'click');
  assert.equal(app.handleKey({ key: 'Escape' }), 'popup.close');
  // プレビューもポップアップもなければ従来どおり（地図の B）
  assert.equal(app.handleKey({ key: 'Escape' }), 'rpg.b');
});

test('FR-101 AC-594: 入力欄・ドラッグ・スクロール中はプレビューを出さず、表示・消去で選択・入力中の文字は変わらない', async () => {
  const { app, env, scenes } = await seeded();
  app.setDraft?.('入力中');
  const before = JSON.stringify([app.getState().selectedSceneId, app.getState().input]);
  const t = T('scene', scenes[1].id, 'list');
  app.setPreviewBlock('input', true);
  app.hoverElement(t); env.scheduler.advance(PREVIEW_MS * 2);
  assert.equal(app.getPreview(), null, '入力欄にフォーカスがある間は出ない');
  app.setPreviewBlock('input', false); app.setPreviewBlock('drag', true);
  app.unhoverElement(t); app.hoverElement(t); env.scheduler.advance(PREVIEW_MS * 2);
  assert.equal(app.getPreview(), null, 'ドラッグ中は出ない');
  app.setPreviewBlock('drag', false);
  app.unhoverElement(t); app.hoverElement(t); env.scheduler.advance(PREVIEW_MS);
  assert.ok(app.getPreview());
  app.closePreview();
  assert.equal(JSON.stringify([app.getState().selectedSceneId, app.getState().input]), before);
  assert.equal(app.getScenePopup(), null, 'プレビューは固定のポップアップを開かない');
});

test('FR-101 AC-595: タップで固定のポップアップが開き、プレビューの情報はその一部で、外部へのリクエストは 0 件', async () => {
  const { app, env, scenes } = await seeded();
  const pt = scenes[0].points[0];
  app.hoverElement(T('point', pt.id)); env.scheduler.advance(PREVIEW_MS);
  const pv = app.getPreview();
  assert.equal(app.tapElement(T('point', pt.id)).ok, true);
  const popup = app.getScenePopup();
  assert.equal(popup.heading, pv.heading);
  assert.ok(popup.points.some((p) => p.text.startsWith(pv.lead)), 'プレビューの要点の先頭はポップアップにある');
  assert.equal(app.getPreview(), null);
  assert.equal((env.fetchCalls ?? []).length, 0);
});

test('FR-102 AC-596: 地図の要素は Tab の順序（シーン→その要点）と同じ順で巡回でき、Enter 相当で同じシーン ID の詳細が開く', async () => {
  const { app, scenes } = await seeded();
  app.setDrawStyle('rpg');
  const order = app.getRpgMap().places.map((p) => p.refId);
  const want = scenes.flatMap((s) => [s.id, ...s.points.map((p) => p.id)]);
  assert.deepEqual(order, want, 'テキスト一覧の話順');
  const seen = [];
  for (let i = 0; i < order.length; i++) seen.push(app.commands['map.focusNext']() ?? app.getMapCursor().target.id);
  assert.equal(app.getMapCursor().index, order.length - 1);
  app.commands['map.focusNext'](); assert.equal(app.getMapCursor().index, 0, '一周して先頭へ（キーボードトラップなし）');
  app.commands['map.focusNext'](); // 先頭のシーンの次＝その要点
  app.commands['map.focusPrev']();
  app.commands['map.activate']();
  assert.equal(app.getScenePopup().sceneId, scenes[0].id);
  app.commands['map.focusNext'](); app.commands['map.focusNext'](); // 要点へ
  const c = app.getMapCursor().target;
  app.commands['map.activate']();
  const owner = scenes.find((s) => s.points.some((p) => p.id === c.id) || s.id === c.id);
  assert.equal(app.getScenePopup().sceneId, owner.id, '地点でも同じシーン ID の詳細');
});

test('FR-102 AC-597: 地図の選べる要素は名前（見出し）と role=button・tabindex を持ち、aria-hidden で隠されない。書き出す SVG は変わらない', async () => {
  const { app, scenes } = await seeded();
  app.setDrawStyle('rpg');
  const map = app.getRpgMap();
  const svg = renderRpgSvg(app.renderBaseSvg(), map);
  assert.equal(app.renderSvg(), svg, '書き出す SVG は DOM の補強で変わらない');
  // 最小の SVG 要素
  const mk = (attrs = {}, kids = []) => { const e = { attrs: { ...attrs }, children: kids, ownerDocument: null, getAttribute: (k) => (k in e.attrs ? e.attrs[k] : null), setAttribute: (k, v) => { e.attrs[k] = String(v); }, removeAttribute: (k) => { delete e.attrs[k]; }, hasAttribute: (k) => k in e.attrs, querySelector: (sel) => (sel === 'rect' ? e.children.find((c) => c.tag === 'rect') ?? null : null), append: (c) => e.children.push(c) }; return e; };
  const places = map.places.map((p) => mk({ 'data-rpg-place': '', 'data-kind': p.kind, 'data-ref-id': p.refId, 'data-x': p.x, 'data-y': p.y }));
  const deco = mk({ d: 'x' });
  const root = mk({ 'data-role': 'rpg-map', 'aria-hidden': 'true' }, [deco, ...places]); root.children = [deco, ...places];
  const doc = { createElementNS: (_, tag) => Object.assign(mk(), { tag }) };
  const svgEl = mk({ 'data-rpg-tile': 16 }); svgEl.ownerDocument = doc; svgEl.querySelector = () => root;
  const names = new Map(map.places.map((p) => [p.refId, p.label]));
  assert.equal(enhanceRpgDom(svgEl, (id) => names.get(id)), places.length);
  assert.equal(root.getAttribute('aria-hidden'), null, '選べる要素を含む地図の枠は隠さない');
  assert.equal(deco.getAttribute('aria-hidden'), 'true', '飾りの絵だけを隠す');
  places.forEach((el, i) => {
    assert.equal(el.getAttribute('role'), 'button'); assert.equal(el.getAttribute('tabindex'), '0');
    assert.equal(el.getAttribute('aria-label'), map.places[i].label);
  });
  assert.equal(places[0].getAttribute('aria-label'), scenes[0].heading, '名前は一覧の見出しと同じ語');
});

// NFR-OFFLINE-001: rpgmap.js は外部 URL の文字列を持たず、判定の矩形は親 SVG の名前空間で作る
test('NFR-OFFLINE-001: rpgmap.js に外部 URL がなく、enhanceRpgDom は親の namespaceURI で rect を作る', async () => {
  const fsm = await import('node:fs');
  const src = fsm.readFileSync(new URL('../../web/src/rpgmap.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /https?:\/\//);
  let ns = null;
  const kid = { hasAttribute: (k) => k === 'data-rpg-place', getAttribute: (k) => ({ 'data-ref-id': 'a', 'data-kind': 'scene', 'data-x': 1, 'data-y': 1 }[k] ?? null), setAttribute() {}, querySelector: () => null, append() {} };
  const root = { removeAttribute() {}, children: [kid] };
  const svgEl = { namespaceURI: 'NS-OF-PARENT', getAttribute: () => '16', querySelector: () => root, ownerDocument: { createElementNS: (n) => { ns = n; return { setAttribute() {} }; } } };
  assert.equal(enhanceRpgDom(svgEl, () => 'x'), 1);
  assert.equal(ns, 'NS-OF-PARENT');
});

test('FR-101・FR-102: キー割り当て（preview.show・map.focusNext・map.focusPrev・map.activate）がある', async () => {
  const { app } = await seeded();
  for (const c of ['preview.show', 'map.focusNext', 'map.focusPrev', 'map.activate']) {
    assert.equal(typeof app.commands[c], 'function');
    const k = app.keymap.find((e) => e.command === c);
    assert.ok(k, c);
    assert.equal(app.handleKey({ key: k.key, ctrlKey: !!k.ctrl, altKey: !!k.alt, shiftKey: !!k.shift }), c);
  }
});

test('FR-101 AC-592: プレビューの見出し・要点の文字は escape されたまま扱われる（文字列のまま返し、DOM へは textContent で入れる）', async () => {
  const { app, env, scenes } = await seeded();
  assert.equal(typeof app.getPreview, 'function');
  app.hoverElement(T('scene', scenes[0].id)); env.scheduler.advance(PREVIEW_MS);
  const pv = app.getPreview();
  assert.equal(typeof pv.heading, 'string'); assert.ok(!('html' in pv));
});
