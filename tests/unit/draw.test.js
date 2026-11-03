// FR-112 AC-635〜640 の単体・結合テスト（AC-635: 描画・色・コントラスト、AC-636: 図の座標に固定、AC-637: 消しゴム・取り消し・やり直し・全消去・上限、
// AC-638: 保存・復元・初期化・出力・機密、AC-640: 表示／非表示）。AC-639 は tests/system/draw.test.js（E2E-279）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail, keyFor, bytesToLatin1 } from '../system/helpers.js';
import { DRAW_COLORS, STROKE_MAX, MIN_CONTRAST, strokeBox, boxesOverlap, withoutOverlapping, haloFor, renderStrokesSvg } from '../../web/src/draw.js';
import { buildPdf } from '../../web/src/export.js';
import { contrastRatio } from '../../web/src/stylepresets.js';

const line = (app, from, to) => { app.drawPointer('down', from); app.drawPointer('move', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }); app.drawPointer('move', to); return app.drawPointer('up', to); };
const setup = async () => { const r = await newApp(); await seedThreeScenes(r.app, r.env); toDetail(r.app); return r; };

// FR-112 AC-635: 色は名前つきの一覧（6 色以上）。選んだ色の名前が文字で示される。描画のモードにしないと線は描けない
test('FR-112 AC-635: 名前つきの 6 色以上・色の選択（名前の文字）・描画のモードでだけ描ける', async () => {
  const { app } = await setup();
  const colors = app.getDrawColors();
  assert.ok(colors.length >= 6);
  assert.ok(colors.every((c) => c.name.length > 0));
  assert.deepEqual(colors.map((c) => c.name), ['黒', '赤', '青', '緑', '橙', '紫'], 'PARAM-150');
  const off = line(app, { x: 10, y: 10 }, { x: 50, y: 10 });
  assert.equal(off.ok, false, 'モードがオフなら描けない');
  assert.equal(app.getStrokes().length, 0);
  app.commands['draw.toggle']();
  assert.equal(app.getDrawState().mode, true);
  assert.equal(app.setDrawColor('red').ok, true);
  assert.equal(app.getDrawState().colorName, '赤');
  assert.equal(app.setDrawColor('nope').ok, false);
  assert.equal(line(app, { x: 10, y: 10 }, { x: 50, y: 10 }).ok, true);
  assert.equal(app.getStrokes()[0].color, 'red');
  app.commands['draw.color.next']();
  assert.equal(app.getDrawState().colorId, 'blue', '色を次へ（キーでも切り替え）');
  assert.match(app.getState().message.text, /青/, '状態メッセージに色の名前');
});

// FR-112 AC-635: すべての色が背景（白の紙面）とのコントラスト比 3 以上。満たさない背景では縁取り（白または黒）を付ける
test('FR-112 AC-635: どの色も白の紙面で PARAM-083 以上。暗い背景では縁取りを付ける', () => {
  assert.equal(MIN_CONTRAST, 3);
  for (const c of DRAW_COLORS) {
    assert.ok(contrastRatio(c.hex, '#ffffff') >= MIN_CONTRAST, `${c.id} は白の背景で足りる`);
    assert.equal(haloFor(c.hex, ['#ffffff']), null);
  }
  const dark = '#111111';
  const halos = DRAW_COLORS.map((c) => haloFor(c.hex, [dark]));
  assert.ok(halos.some((h) => h === '#ffffff' || h === '#000000'), '暗い背景では縁取り');
  const svg = renderStrokesSvg([{ id: 'd1', color: 'black', points: [{ x: 1, y: 1 }, { x: 5, y: 5 }] }], { background: dark });
  assert.match(svg, /data-halo="1"/);
  assert.match(svg, /stroke="#ffffff"/);
  const plain = renderStrokesSvg([{ id: 'd1', color: 'black', points: [{ x: 1, y: 1 }, { x: 5, y: 5 }] }], { background: '#ffffff' });
  assert.ok(!plain.includes('data-halo'));
});

// FR-112 AC-635 AC-036: 描画の管理にキー割り当てがあり、キーだけで切り替えられる
test('FR-112 AC-635: 描画のモード・色の切り替えにキーがあり、handleKey で実行できる', async () => {
  const { app } = await newApp();
  for (const c of ['draw.toggle', 'draw.color.next', 'draw.erase', 'draw.undo', 'draw.redo', 'draw.clear', 'draw.visibility']) assert.ok(keyFor(app, c), `keymap に ${c}`);
  assert.equal(app.handleKey(keyFor(app, 'draw.toggle')), 'draw.toggle');
  assert.equal(app.getDrawState().mode, true);
  assert.equal(app.handleKey(keyFor(app, 'draw.color.next')), 'draw.color.next');
  assert.equal(app.getDrawState().colorId, 'red');
});

// FR-112 AC-636: 図の座標に固定。再配置・拡大縮小・シーンの確定・再描画で消えず、位置が変わらない
test('FR-112 AC-636: 描いた線は拡大縮小・シーンの確定・再描画・再配置でも同じ位置のまま', async () => {
  const { app, env } = await setup();
  app.commands['draw.toggle']();
  line(app, { x: 100, y: 50 }, { x: 300, y: 90 });
  const before = JSON.stringify(app.getStrokes());
  app.setDiagramView?.({ zoom: 2 });
  app.setDiagramView?.({ zoom: 0.5 });
  app.commands['session.nextScene']();
  app.setDraft('新しい議題として人員計画を決める'); app.submitDraft(); env.tick(1);
  env.scheduler.advance(15000);
  app.commands['session.stop']();
  const a = app.renderSvg(); const b = app.renderSvg();
  assert.equal(JSON.stringify(app.getStrokes()), before);
  assert.equal(a, b, '再描画しても同じ');
  assert.ok(a.includes('M100 50L200 70L300 90'), '図の座標のままの経路');
});

// FR-112 AC-637: 消しゴム（1 本ずつ）・取り消し・やり直し・全消去（確認つき）。取り消し・やり直しは決定的
test('FR-112 AC-637: 消しゴム・取り消し・やり直し・全消去（確認）・決定的な履歴', async () => {
  const { app } = await setup();
  app.commands['draw.toggle']();
  line(app, { x: 10, y: 10 }, { x: 100, y: 10 });
  line(app, { x: 10, y: 100 }, { x: 100, y: 100 });
  const two = JSON.stringify(app.getStrokes());
  // 消しゴムの道具: 線の上でポインタを下ろすと、その線だけが消える
  app.commands['draw.erase']();
  assert.equal(app.getDrawState().tool, 'eraser');
  app.drawPointer('down', { x: 50, y: 12 }); app.drawPointer('up', { x: 50, y: 12 });
  assert.equal(app.getStrokes().length, 1);
  assert.equal(app.getStrokes()[0].points[0].y, 100);
  app.commands['draw.erase']();
  assert.equal(app.getDrawState().tool, 'pen');
  assert.equal(app.commands['draw.undo']().ok, true);
  assert.equal(JSON.stringify(app.getStrokes()), two, '取り消しで同じ順序・同じ位置に戻る');
  assert.equal(app.commands['draw.redo']().ok, true);
  assert.equal(app.getStrokes().length, 1);
  assert.equal(app.commands['draw.redo']().ok, false, 'やり直せる操作がなければ何も起きない');
  app.commands['draw.undo']();
  // 新しい操作でやり直しの記録は消える（決定的）
  line(app, { x: 200, y: 10 }, { x: 260, y: 10 });
  assert.equal(app.getDrawState().canRedo, false);
  // 全消去は確認つき。キャンセルで何も消えない。確認で消え、取り消しで戻る
  assert.equal(app.commands['draw.clear']().pending, true);
  assert.ok(app.getDrawDialog().text.length > 0);
  assert.equal(app.handleKey({ key: 'Escape' }), 'draw.cancel', 'Esc で確認を閉じる');
  assert.equal(app.getStrokes().length, 3);
  app.commands['draw.clear']();
  assert.equal(app.confirmDrawClear().ok, true);
  assert.equal(app.getStrokes().length, 0);
  assert.equal(app.undoDraw().ok, true);
  assert.equal(app.getStrokes().length, 3);
});

// FR-112 AC-637: 線は 1 セッションに PARAM-151（500）本まで。超えると描けず理由が示される
test('FR-112 AC-637: 上限 500 本を超えると描けず、理由（状態メッセージ）が示される', async () => {
  const { app } = await newApp();
  assert.equal(STROKE_MAX, 500);
  app.commands['draw.toggle']();
  for (let i = 0; i < STROKE_MAX; i++) { app.drawPointer('down', { x: i, y: 0 }); app.drawPointer('up', { x: i + 1, y: 1 }); }
  assert.equal(app.getStrokes().length, STROKE_MAX);
  assert.equal(app.getDrawState().limitReached, true);
  const r = app.drawPointer('down', { x: 1, y: 1 });
  assert.equal(r.ok, false); assert.equal(r.reason, 'limit');
  assert.match(app.getState().message.text, /500/);
  assert.equal(app.getStrokes().length, STROKE_MAX);
});

// FR-112 AC-638: 保存（セッションの再読込）・復元・初期化。出力（SVG・Markdown・HTML・PDF）に含まれ、Markdown・一覧には「手描き n 本」の文字
test('FR-112 AC-638: 再読込で復元・初期化で消え、SVG・Markdown・HTML・PDF・テキスト一覧に含まれる', async () => {
  const { app, env, createApp } = await setup();
  app.commands['draw.toggle']();
  line(app, { x: 100, y: 50 }, { x: 300, y: 90 });
  app.setDrawColor('blue'); line(app, { x: 120, y: 200 }, { x: 330, y: 240 });
  const strokes = app.getStrokes();
  const svg = app.renderSvgForSave();
  for (const s of strokes) assert.ok(svg.includes(`data-stroke-id="${s.id}"`));
  assert.ok(!/https?:\/\//.test(svg.replace(/xmlns="[^"]*"/, '')), '外部の URL を含まない');
  assert.ok(!/<(script|image|foreignObject|use)\b/i.test(svg.slice(svg.indexOf('data-role="draw-layer"'))), '許可リストの要素だけ');
  assert.match(app.renderOutline(), /手描き 2 本（黒 1・青 1）/, 'テキスト一覧に件数と色名');
  await app.commands['save.markdown']();
  assert.match(String(env.downloads.at(-1).data), /手描き 2 本/);
  await app.commands['save.html']();
  const html = String(env.downloads.at(-1).data);
  assert.match(html, /手描き 2 本/);
  assert.ok(html.includes('data-stroke-id'), 'HTML の図にも線が含まれる');
  await app.commands['save.pdf']();
  assert.match(bytesToLatin1(env.downloads.at(-1).data), /RG/, 'PDF に線の描画が含まれる');
  const pdf0 = bytesToLatin1(buildPdf([{ id: 's', heading: 'h', points: [] }], {})); const pdf1 = bytesToLatin1(buildPdf([{ id: 's', heading: 'h', points: [] }], { strokes: app.getDrawExportStrokes() }));
  assert.ok(!pdf0.includes(' RG') && pdf1.includes(' RG'));
  app.flushSave();
  const app2 = await createApp(env.options);
  assert.deepEqual(app2.getStrokes(), strokes, '復元');
  assert.equal(app.commands['data.reset']().ok === false ? 0 : 1, 1);
  await app.dialogAction('confirm');
  assert.equal(app.getStrokes().length, 0, '初期化で消える');
  assert.equal(app.getDrawState().mode, false);
  assert.equal(app.getConflictOutlineHtml().includes('手描き'), false);
});

// FR-112 AC-638: 重なりの判定は決定的（線幅の半分を外側に含む外接矩形が、1 点でも交われば重なり。辺・角が接するだけも重なる）
test('FR-112 AC-638: 外接矩形の重なり（接するだけも重なる・離れていれば重ならない）', () => {
  const s = { id: 'd1', color: 'black', width: 3, points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] };
  assert.deepEqual(strokeBox(s), { x1: 8.5, y1: 8.5, x2: 21.5, y2: 21.5 }, '線幅の半分を外側に含む');
  const rect = (x, y, w, h) => ({ x1: x, y1: y, x2: x + w, y2: y + h });
  assert.equal(boxesOverlap(strokeBox(s), rect(21.5, 0, 10, 100)), true, '辺が接する');
  assert.equal(boxesOverlap(strokeBox(s), rect(21.5, 21.5, 5, 5)), true, '角が接する');
  assert.equal(boxesOverlap(strokeBox(s), rect(21.6, 0, 10, 100)), false, '離れている');
  assert.equal(boxesOverlap(strokeBox(s), rect(0, 0, 8.4, 8.4)), false);
  assert.deepEqual(withoutOverlapping([s], [{ x: 21.5, y: 21.5, width: 5, height: 5 }]), [], '接するだけで除かれる');
  assert.deepEqual(withoutOverlapping([s], [{ x: 40, y: 40, width: 5, height: 5 }]), [s]);
});

// FR-112 AC-638: 「機密の要点を除く」では重なる線を出力から除き、残る線があれば警告。除いた線は件数に数えず、Markdown の「手描き n 本」は残った本数
test('FR-112 AC-638: 機密の要点と重なる線は SVG・Markdown から除かれ、残る線があるとき getSaveWarnings に文字', async () => {
  const { app, env } = await setup();
  const p = app.getState().scenes.at(-1).points[0];
  app.selectPoint(p.id); app.commands['point.confidential']();
  const box = app.getPointBox(p.id);
  assert.ok(box && box.width > 0 && box.height > 0);
  app.commands['draw.toggle']();
  line(app, { x: box.x + 2, y: box.y + 2 }, { x: box.x + box.width - 2, y: box.y + box.height - 2 });
  line(app, { x: 5, y: 5 }, { x: 30, y: 8 });
  const [over, free] = app.getStrokes();
  const strokeWarnings = () => app.getSaveWarnings().filter((x) => !x.startsWith('未確認')); // 「未確認 k 件」の警告（FR-092 AC-649）は別の判定
  assert.deepEqual(strokeWarnings(), [], '「除く」でなければ警告なし');
  app.setExcludeConfidential(true);
  assert.equal(strokeWarnings().length, 1);
  await app.commands['save.svg']();
  const svg = String(env.downloads.at(-1).data);
  assert.ok(!svg.includes(`data-stroke-id="${over.id}"`) && svg.includes(`data-stroke-id="${free.id}"`));
  await app.commands['save.markdown']();
  const md = String(env.downloads.at(-1).data);
  assert.match(md, /手描き 1 本/, '残った本数');
  await app.commands['save.html']();
  const html = String(env.downloads.at(-1).data);
  assert.ok(!html.includes(`data-stroke-id="${over.id}"`) && html.includes(`data-stroke-id="${free.id}"`));
  // 重なる線だけがあるときは、残る線がないので警告は出ない
  app.eraseStroke(free.id);
  assert.deepEqual(strokeWarnings(), []);
  assert.equal(app.getStrokes().length, 1, 'アプリ内の線は除かれていない');
});

// FR-112 AC-640: 表示／非表示。非表示でも線は消えず、再表示で同じ位置。端末ごとの設定。件数・出力は変わらず、非表示は文字で示す
test('FR-112 AC-640: 非表示でも線・件数・出力は変わらず、非表示は文字で示され、再表示で同じ位置。端末ごとの設定として保存', async () => {
  const { app, env, createApp } = await setup();
  assert.equal(app.getDrawState().visible, true); assert.equal(app.getDrawState().hiddenText, '');
  app.commands['draw.toggle']();
  line(app, { x: 100, y: 50 }, { x: 300, y: 90 });
  const strokes = JSON.stringify(app.getStrokes());
  const shown = app.renderSvg();
  assert.ok(!/data-role="draw-layer"[^>]*display="none"/.test(shown));
  assert.equal(app.handleKey(keyFor(app, 'draw.visibility')), 'draw.visibility');
  const st = app.getDrawState();
  assert.equal(st.visible, false);
  assert.match(st.hiddenText, /非表示/);
  assert.equal(st.count, 1);
  assert.match(app.renderSvg(), /data-role="draw-layer"[^>]*display="none"/, '画面では隠す（線は残る）');
  assert.ok(!/display="none"/.test(app.renderSvgForSave().slice(app.renderSvgForSave().indexOf('data-role="draw-layer"'), app.renderSvgForSave().indexOf('data-role="draw-layer"') + 80)), '保存物には含まれる');
  assert.ok(app.renderSvgForSave().includes('data-stroke-id'));
  assert.match(app.renderOutline(), /手描き 1 本/, '件数は変わらない');
  assert.match(app.renderOutline(), /非表示/);
  assert.equal(app.drawPointer('down', { x: 1, y: 1 }).ok, false, '非表示の間は描けない');
  assert.equal(JSON.stringify(app.getStrokes()), strokes);
  // 端末ごとの設定: 再読込しても非表示のまま。データの初期化では変わらない
  app.flushSave();
  const app2 = await createApp(env.options);
  assert.equal(app2.getDrawState().visible, false);
  assert.equal(app2.getStrokes().length, 1);
  app.commands['draw.visibility']();
  assert.equal(app.getDrawState().visible, true); assert.equal(app.getDrawState().hiddenText, '');
  assert.equal(JSON.stringify(app.getStrokes()), strokes, '同じ位置に戻る');
  assert.equal(app.renderSvg(), shown);
});
