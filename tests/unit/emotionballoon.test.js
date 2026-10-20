// FR-076 AC-467・FR-032 AC-156 の単体・結合テスト（感情語を含むトピックの吹き出しのギザギザ。presetdiagram.js・export.js）。
// 画面の図（SVG）・PNG・PDF が同じ生成器（jaggedPoints）でギザギザを描き、通常の吹き出しの見た目は変えないことを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail, pdfTexts } from '../system/helpers.js';
import { jaggedPoints, emotionBalloonSceneIds, renderPresetDiagram, buildLook } from '../../web/src/presetdiagram.js';
import { exportLook, buildPdf, renderPng } from '../../web/src/export.js';

const SPEC = (balloon) => ({
  id: `t-${balloon}`, preset: true, paper: 'plain', font: 'gothic', headingDecoration: 'band', balloon, stroke: { wobble: 0, width: 2 }, figures: false, icons: true,
  palette: { background: '#ffffff', primary: '#1a1a1a', accent: ['#ffd400'], text: '#1a1a1a', secondary: '#757575' },
});
const SCENES = [
  { id: 's1', status: 'done', heading: '予算', points: [{ id: 'p1', text: 'コストが高くて困った' }], relations: [] },
  { id: 's2', status: 'done', heading: '計画', points: [{ id: 'p2', text: '来月のリリース計画を決める' }], relations: [] },
];
const balloonTags = (svg) => [...svg.matchAll(/<(\w+) data-style-role="balloon"[^>]*>/g)].map((m) => m[0]);

function recordingCanvas() {
  const ops = [];
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44]);
  const f = (w, h) => {
    const ctx = new Proxy({}, {
      get(t, p) {
        if (p === 'measureText') return (s) => ({ width: String(s).length * 8 });
        if (p === 'canvas') return canvas;
        if (p in t) return t[p];
        return (...a) => { ops.push([String(p), ...a.map((x) => (typeof x === 'number' ? Math.round(x) : String(x)))]); };
      },
      set(t, p, v) { t[p] = v; ops.push(['set', String(p), String(v)]); return true; },
    });
    const canvas = { width: w, height: h, getContext: () => ctx, toBytes: async () => png };
    return canvas;
  };
  return Object.assign(f, { ops });
}
// 要点の文字の直前の図形の描き方（arcTo=角丸・雲形、fillRect=付箋、lineTo=ギザギザ）
function pointShapes(ops, texts) {
  const out = {};
  for (const t of texts) {
    const at = ops.findIndex((o) => o[0] === 'fillText' && o[1] === t);
    const start = ops.slice(0, at).map((o) => o[0]).lastIndexOf('beginPath');
    const rect = ops.slice(0, at).map((o) => o[0]).lastIndexOf('fillRect');
    const seg = ops.slice(Math.max(start, rect), at).map((o) => o[0]);
    out[t] = rect > start ? 'rect' : seg.includes('arcTo') ? 'round' : seg.filter((o) => o === 'lineTo').length >= 8 ? 'jagged' : 'other';
  }
  return out;
}

// FR-076 AC-467
test('FR-076 AC-467: jaggedPoints は矩形の外に歯を並べた決定的な多角形で、歯の分だけ外に広がる', () => {
  const p = jaggedPoints(10, 20, 100, 40, 7, 14);
  assert.deepEqual(jaggedPoints(10, 20, 100, 40, 7, 14), p, '毎回同じ（AC-412）');
  assert.ok(p.length >= 16 && p.length % 2 === 0, '歯ごとに根元と先端の 2 点');
  const xs = p.map((q) => q[0]); const ys = p.map((q) => q[1]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [3, 117, 13, 67], '外形は歯の高さだけ外');
  assert.ok(p.some(([x, y]) => x === 10 && y === 20), '根元は矩形の角を通る');
});

test('FR-032 AC-156 FR-076 AC-467: 感情語を含むトピックのシーンは、吹き出し型を選んでいるときだけ対象で、トピックの全シーンに及ぶ', () => {
  const scenes = [...SCENES, { id: 's3', status: 'done', heading: '担当', points: [{ id: 'p3', text: '担当を確認' }], relations: [] }];
  const api = (selected, topics, applied = true) => ({ getLayoutInfo: () => ({ selected, applied }), getTopics: () => topics });
  const topics = [{ id: 't1', sceneIds: ['s1', 's2'] }];
  assert.deepEqual([...emotionBalloonSceneIds(api(['bubble'], topics), scenes)].sort(), ['s1', 's2'], 'トピックの全シーン。トピックに属さない s3 は単独で判定（感情語なし）');
  assert.deepEqual([...emotionBalloonSceneIds(api(['timeline', 'bubble'], topics), scenes)].sort(), ['s1', 's2'], '組み合わせの中の吹き出し型');
  assert.equal(emotionBalloonSceneIds(api(['timeline'], topics), scenes).size, 0, '吹き出し型でなければ対象外');
  assert.equal(emotionBalloonSceneIds(api(['bubble'], topics, false), scenes).size, 0, '整理の表示（配置を使わない）では対象外');
  assert.deepEqual([...emotionBalloonSceneIds(api(['bubble'], []), scenes)], ['s1'], 'トピックがなければシーンごと');
  assert.equal(emotionBalloonSceneIds(null, scenes).size, 0);
});

test('FR-076 AC-467: 画面の図で感情の吹き出しは polygon のギザギザ（data-balloon-kind="emotion"）で、通常の吹き出しの描画は変わらない', () => {
  for (const b of ['cloud', 'rounded', 'sticky']) {
    const look = buildLook(SPEC(b));
    const plain = renderPresetDiagram(SCENES, { lang: 'ja' }, look).body;
    assert.equal(renderPresetDiagram(SCENES, { lang: 'ja', emotionScenes: new Set() }, look).body, plain, `${b}: 対象がなければ従来と同じ`);
    const body = renderPresetDiagram(SCENES, { lang: 'ja', emotionScenes: new Set(['s1']) }, look).body;
    const tags = balloonTags(body);
    assert.equal(tags.length, 2);
    assert.match(tags[0], /^<polygon [^>]*data-shape="jagged" data-balloon-kind="emotion"/, `${b}: 感情の吹き出し`);
    assert.match(tags[0], new RegExp(`fill="${look.balloonFill}" stroke="${look.balloonStroke}"`), `${b}: 同じ配色と輪郭線`);
    assert.doesNotMatch(tags[1], /data-balloon-kind/, `${b}: 通常の吹き出し`);
    assert.match(tags[1], new RegExp(`data-shape="${b}"`));
    const s2 = (svg) => svg.slice(svg.indexOf('data-scene-id="s2"'));
    assert.equal(s2(body).replace(/x="[\d.]+"|x1="[\d.]+"|x2="[\d.]+"|d="[^"]*"|data-box="[^"]*"|points="[^"]*"/g, ''), s2(plain).replace(/x="[\d.]+"|x1="[\d.]+"|x2="[\d.]+"|d="[^"]*"|data-box="[^"]*"|points="[^"]*"/g, ''), `${b}: 通常のシーンの見た目（位置以外）は同じ`);
    // 吹き出しの文字は外接矩形の中（歯の内側の矩形に収まる）
    const [bx, by, bw, bh] = /data-box="([^"]*)"/.exec(tags[0])[1].split(' ').map(Number);
    const word = /<text [^>]*data-box="([^"]*)"[^>]*data-emotion="trouble"/.exec(body)[1].split(' ').map(Number);
    assert.ok(word[0] >= bx + 7 && word[0] + word[2] <= bx + bw - 7 && word[1] >= by + 7 && word[1] + word[3] <= by + bh - 7, `${b}: 文字はギザギザの内側`);
  }
});

test('FR-076 AC-467: PNG は感情のシーンの吹き出しをギザギザ（線分の多角形）で描き、ほかは画風の形のまま', async () => {
  for (const [b, normal] of [['cloud', 'round'], ['rounded', 'round'], ['sticky', 'rect']]) {
    const look = exportLook(SPEC(b));
    const cv = recordingCanvas();
    await renderPng(SCENES, cv, { look, emotion: new Set(['s1']) });
    assert.deepEqual(pointShapes(cv.ops, ['コストが高くて困った', '来月のリリース計画を決める']), { コストが高くて困った: 'jagged', 来月のリリース計画を決める: normal }, b);
    const base = recordingCanvas(); await renderPng(SCENES, base, { look });
    const none = recordingCanvas(); await renderPng(SCENES, none, { look, emotion: new Set() });
    assert.deepEqual(none.ops, base.ops, `${b}: 対象がなければ従来と同じ`);
  }
});

test('FR-076 AC-467: PDF は感情のシーンの吹き出しをギザギザ（m・l の多角形）で描き、文字は欠けない', () => {
  const look = exportLook(SPEC('rounded'));
  const pdf = Buffer.from(buildPdf(SCENES, { look, emotion: new Set(['s1']) })).toString('latin1');
  assert.equal((pdf.match(/ h B\n/g) ?? []).length, 1, '感情の要点は 1 つ');
  assert.match(pdf, /( [\d.]+ [\d.]+ l){15,} h B/, 'ギザギザの多角形');
  assert.ok(pdf.includes(' re B'), '通常の要点は矩形');
  for (const s of ['予算', 'コストが高くて困った', '計画', '来月のリリース計画を決める']) assert.ok(pdfTexts(Buffer.from(pdf, 'latin1')).includes(s), s);
  assert.equal(Buffer.from(buildPdf(SCENES, { look, emotion: new Set() })).toString('latin1'), Buffer.from(buildPdf(SCENES, { look })).toString('latin1'), '対象がなければ従来と同じ');
});

test('FR-032 AC-156 FR-076 AC-467 結合: 吹き出し型で保存した PNG・PDF に感情の吹き出しのギザギザがあり、吹き出し型でなければない', async () => {
  const cv = recordingCanvas();
  const { app, env } = await newApp({ canvasFactory: cv, options: { canvasFactory: cv } });
  app.setLang('ja');
  await seedThreeScenes(app, env);
  toDetail(app);
  const ids = app.getDrawStyles().filter((s) => app.getDrawStyleSpec(s.id)?.preset).map((s) => s.id);
  assert.ok(ids.length >= 9, '9 つの風');
  const save = async () => {
    cv.ops.length = 0; const n = env.downloads.length;
    await app.commands['save.png'](); await app.commands['save.pdf']();
    const [, pdf] = env.downloads.slice(n);
    return { shape: pointShapes(cv.ops, ['コストが高くて困った'])['コストが高くて困った'], pdf: Buffer.from(pdf.data).toString('latin1') };
  };
  for (const id of ids) {
    assert.equal(app.setDrawStyle(id).ok, true);
    assert.equal(app.setLayoutTypes(['bubble']).ok, true);
    let r = await save();
    assert.equal(r.shape, 'jagged', `${id}: 吹き出し型の PNG`);
    assert.match(r.pdf, / l h B\n/, `${id}: 吹き出し型の PDF`);
    assert.equal(app.setLayoutTypes(['timeline']).ok, true);
    r = await save();
    assert.notEqual(r.shape, 'jagged', `${id}: 吹き出し型でなければ通常`);
    assert.doesNotMatch(r.pdf, / l h B\n/, `${id}: 吹き出し型でなければ通常（PDF）`);
  }
});
