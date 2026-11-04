// FR-076 AC-670 / NFR-UX-012 AC-466 / FR-075 AC-407: 共通部品「字幅の見積もり」（web/src/glyphwidth.js）の単体テストと、
// 15 の描画スタイル × 7 つのレイアウト型で、手書き風の書体（PARAM-185）の幅でも図の文字が枠からはみ出さないことの結合テスト。
// 見積もりの値は書体のファイルの送り幅の実測（glyphwidth.js の注記）。実際の描画での測定は work/runs/<run-id>/ の証跡（ブラウザで描いた後に測る）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, toDetail } from '../system/helpers.js';
import { glyphWidth, textWidthOf, fitTextWidth, wrapTextWidth, HAND_ASCII_EM, SYNTH_BOLD_EM } from '../../web/src/glyphwidth.js';
import { textWidth as legacyTextWidth } from '../../web/src/diagram.js';
import { BUILTIN_STYLES } from '../../web/src/drawstyles.js';
import { LAYOUT_TYPE_IDS } from '../../web/src/layouttypes.js';

// FR-076 AC-670: 手書き風の系統は並びのどの書体でも収まる幅（欧文は実測の最大。日本語は 1 em。合成の太字の広がりを足す）
test('FR-076 AC-670: 手書き風の系統の字幅は実測の最大（W・M・m は 1 em 前後）で、日本語とそのほかの記号は 1 em', () => {
  assert.equal(HAND_ASCII_EM.length, 95, 'U+0020〜U+007E の 95 文字');
  for (let cp = 0x20; cp <= 0x7e; cp++) {
    const ch = String.fromCodePoint(cp);
    assert.ok(HAND_ASCII_EM[cp - 0x20] >= 0.5 && glyphWidth(ch, 10, 'handwriting') === 10 * HAND_ASCII_EM[cp - 0x20], `${ch}: 実測の最大（0.5 em 以上）`);
  }
  assert.ok(glyphWidth('W', 20, 'handwriting') >= 20, 'W（Segoe Print 1.01 em・Kaisei Decol 1.0 em）');
  assert.ok(glyphWidth('m', 20, 'handwriting') >= 20, 'm（Segoe Print 1.03 em）');
  assert.equal(glyphWidth('会', 14, 'handwriting'), 14, '日本語は 1 em');
  assert.equal(glyphWidth('…', 14, 'handwriting'), 14, 'そのほかの記号は 1 em');
  assert.equal(textWidthOf('', 14, 'handwriting'), 0);
  assert.equal(textWidthOf('会議', 10, 'handwriting'), 20 + 10 * SYNTH_BOLD_EM, '合成の太字の広がりを 1 行に 1 回足す');
});

// NFR-UX-012 AC-406（既存の見積もりを変えない）: 手書き風以外の系統は diagram.js の textWidth と同じ
test('NFR-UX-012 AC-466 AC-406: 手書き風以外の系統と未指定は従来の見積もりと同じ', () => {
  for (const s of ['Meeting WWW 2026', '予算の見直し', 'Mix 混在 text…']) {
    for (const k of [undefined, null, 'gothic', 'roundGothic']) assert.equal(textWidthOf(s, 13, k), legacyTextWidth(s, 13), `${s} ${k}`);
  }
  assert.deepEqual(wrapTextWidth('abcdefghijk', 30, 10, 'gothic', 2), ['abcde', 'fghi…'], '従来の折り返しと切り詰め（末尾の 1 文字を「…」に）');
});

// FR-076 AC-670: 切り詰め・折り返しは幅に収まる
test('FR-076 AC-670: fitTextWidth・wrapTextWidth の結果はどの行も幅に収まる（手書き風の系統）', () => {
  const s = 'WWWW MMMM 会議の議事録と mmmm の確認 Kaisei Decol';
  for (const w of [40, 80, 120, 300]) {
    const f = fitTextWidth(s, w, 13, 'handwriting');
    assert.ok(textWidthOf(f, 13, 'handwriting') <= w, `${w}: ${f}`);
    if (f !== s) assert.ok(f.endsWith('…') || f === '', '切ったときは「…」');
    const lines = wrapTextWidth(s, w, 13, 'handwriting', 3);
    assert.ok(lines.length <= 3);
    for (const ln of lines) assert.ok(textWidthOf(ln, 13, 'handwriting') <= Math.max(w, 13 * (1 + SYNTH_BOLD_EM)), `${w}: ${ln}`);
  }
  assert.equal(fitTextWidth('短い', 200, 13, 'handwriting'), '短い');
});

// ---- 結合: 15 の描画スタイル × 7 つのレイアウト型 ----
const LONG = [
  ['WWW MMM Quarterly KPI review 2026 Q3 の予算の見直し', 'Make the onboarding flow 50% faster（mmm）'],
  ['Kaisei Decol Yomogi Zen Kurenaido の書体で WWWWWW を描く'],
  ['Assign owners: Mike Williams さん・Wendy Moore さん 来月まで'],
];
async function seedLong() {
  const { app, env } = await newApp();
  app.setLang('ja');
  app.commands['session.start']();
  LONG.forEach((group, i) => {
    group.forEach((t) => { app.setDraft(t); app.submitDraft(); env.tick(1); });
    if (i < LONG.length - 1) app.commands['session.nextScene']();
  });
  toDetail(app);
  return app;
}
const num = (a, n) => Number((new RegExp(`\\s${n}="([^"]*)"`).exec(a) ?? [])[1]);
const boxOf = (a) => { const m = /\sdata-box="([^"]*)"/.exec(a); return m ? m[1].split(' ').map(Number) : null; };
function frameOf(tag) {
  if (/^<rect/.test(tag)) return [num(tag, 'x'), num(tag, 'y'), num(tag, 'width'), num(tag, 'height')];
  return null; // ギザギザの外形（path）は外接の矩形が文字より広い（対象外）
}
// <g ATTR="...">…</g> の中身（入れ子の g を数えて閉じる）
function groups(svg, attrName) {
  const out = []; const re = new RegExp(`<g [^>]*${attrName}="[^"]*"[^>]*>`, 'g'); let m;
  while ((m = re.exec(svg))) {
    let depth = 1; let i = m.index + m[0].length; const tagRe = /<\/?g[\s>]/g; tagRe.lastIndex = i;
    let t;
    while (depth && (t = tagRe.exec(svg))) { depth += t[0].startsWith('</') ? -1 : 1; i = t.index; }
    out.push(svg.slice(m.index, i));
  }
  return out;
}
const texts = (s) => [...s.matchAll(/<text [^>]*>/g)].map((x) => x[0]);
function assertInside(svg, where) {
  let n = 0;
  const check = (gs, frameRe, label) => {
    for (const g of gs) {
      const ft = (frameRe.exec(g) ?? [])[0]; frameRe.lastIndex = 0;
      const f = ft && (boxOf(ft) ?? frameOf(ft));
      if (!f) continue;
      for (const t of texts(g)) {
        const b = boxOf(t);
        if (!b) continue;
        n += 1;
        assert.ok(b[0] >= f[0] - 0.5 && b[0] + b[2] <= f[0] + f[2] + 0.5, `${where} ${label}: 文字の幅 ${b.join(' ')} は枠 ${f.join(' ')} の中: ${t.slice(0, 160)}`);
      }
    }
  };
  check(groups(svg, 'data-unit-id'), /<(rect|path) data-role="unit-frame"[^>]*>/, '単位（カード・吹き出し）');
  check(groups(svg, 'data-group-id'), /<rect data-role="frame"[^>]*>/, 'まとまり・区画の見出し');
  check(groups(svg, 'data-metaphor-section'), /<rect data-role="frame"[^>]*>/, '比喩の区画の見出し');
  check(groups(svg, 'data-point-id'), /<[a-z]+ data-style-role="point-frame"[^>]*>/, '要点のカード');
  return n;
}

// FR-076 AC-670 / NFR-UX-012 AC-466: 15 × 7 の組み合わせで、図の文字（見積もりの幅）が区画・カード・吹き出し・まとまりの枠の中にある
test('FR-076 AC-670: 15 の描画スタイル × 7 つのレイアウト型で、手書き風の書体の幅でも文字が枠からはみ出さない', async () => {
  assert.equal(BUILTIN_STYLES.length, 15); assert.equal(LAYOUT_TYPE_IDS.length, 7);
  const app = await seedLong();
  let handChecked = 0;
  for (const type of LAYOUT_TYPE_IDS) {
    assert.equal(app.setLayoutTypes([type]).ok, true, type);
    for (const st of BUILTIN_STYLES) {
      assert.equal(app.setDrawStyle(st.id).ok, true, st.id);
      const svg = app.renderSvg();
      const n = assertInside(svg, `${st.id}×${type}`);
      if (st.font === 'handwriting') handChecked += n;
    }
  }
  assert.ok(handChecked > 0, '手書き風の系統の風で枠の中の文字を確かめた');
});

// FR-076 AC-670: 手書き風の系統の風では、同じ文字でも枠が手書き風の幅に合わせて広がる（または折り返す）。描画は決定的（AC-412）
test('FR-076 AC-670 AC-412: 手書き風の系統の要点のカードは手書き風の字幅で広がり、再描画でも同じ', async () => {
  const app = await seedLong();
  const hand = BUILTIN_STYLES.find((s) => s.font === 'handwriting');
  const round = BUILTIN_STYLES.find((s) => s.font && s.font !== 'handwriting');
  const widthOf = (id) => { app.setDrawStyle(id); const svg = app.renderSvg(); return [svg, Math.max(...[...svg.matchAll(/data-style-role="point-frame" data-box="([^"]*)"/g)].map((m) => Number(m[1].split(' ')[2])))]; };
  const [a, wh] = widthOf(hand.id); const [, wr] = widthOf(round.id); const [b] = widthOf(hand.id);
  assert.ok(wh > wr, `手書き風 ${wh} > ${round.id} ${wr}`);
  assert.equal(a, b, '決定的');
});
