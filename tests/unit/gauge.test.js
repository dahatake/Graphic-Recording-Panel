// FR-109 AC-624〜628 の単体・結合テスト（数値の指標のゲージ・棒グラフ。PARAM-147）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, toDetail } from '../system/helpers.js';
import { detectGauge, renderGauge, appendGaugeStrip, gaugeLine } from '../../web/src/gauge.js';
import { isAllowedPartSvg } from '../../web/src/parts.js';
import { enhanceGaugeDom } from '../../web/src/gauge-ui.js';

const text = (d) => (typeof d === 'string' ? d : Buffer.from(d).toString('utf8'));
async function withPoints(utterances, over = {}) {
  const { app, env } = await newApp(over);
  app.commands['session.start']();
  for (const u of utterances) { app.setDraft(u); app.submitDraft(); env.tick(25); }
  toDetail(app);
  return { app, env };
}

// FR-109 AC-624: 検出は決定的で、表現は規則で 1 つに決まる
test('FR-109 AC-624: 前後の値が両方あれば棒グラフ（目標があれば目標線）。リングにはしない', () => {
  const g = detectGauge('売上を 100万円から 150万円に増やす、目標 160万円');
  assert.equal(g.kind, 'bar');
  assert.deepEqual([g.before, g.after, g.target, g.unit, g.direction], [100, 150, 160, '万円', 'up']);
  assert.equal(g.clamped, false);
  assert.equal(detectGauge('残業を 20時間から 10時間に削減').kind, 'bar');
  assert.equal(detectGauge('残業を 20時間から 10時間に削減').direction, 'down');
});

test('FR-109 AC-624: 前後がなく目標が数値で比率に向く単位ならリングゲージ', () => {
  const g = detectGauge('稼働率を 85% に改善、目標 90%');
  assert.equal(g.kind, 'ring');
  assert.deepEqual([g.value, g.target, g.unit, g.direction, g.clamped], [85, 90, '%', 'up', false]);
  assert.equal(detectGauge('達成率 70% を改善する、目標は 8割').target, 8, '単位が割のときは割のまま持つ');
});

test('FR-109 AC-624: それ以外は数値ラベル（理由を文字で残す）', () => {
  const noTarget = detectGauge('稼働率が 85% に向上');
  assert.equal(noTarget.kind, 'label'); assert.match(noTarget.reason, /目標が不明のため比率で示せない/);
  const noUnit = detectGauge('売上を 120万円に増やす、目標 150万円');
  assert.equal(noUnit.kind, 'label'); assert.match(noUnit.reason, /単位が比率でない/);
  const noDir = detectGauge('稼働率は 85%、目標 90%');
  assert.equal(noDir.kind, 'label'); assert.match(noDir.reason, /望ましい方向が決まらない/);
  const both = detectGauge('稼働率の増加と削減を検討、85%、目標 90%');
  assert.equal(both.kind, 'label'); assert.match(both.reason, /望ましい方向が決まらない/, '上がる・下がるの両方は決まらない');
  const zero = detectGauge('不具合を 0件に削減、目標 0件');
  assert.equal(zero.kind, 'label');
  assert.equal(detectGauge('完了率 0% を改善、目標 90%').kind, 'label', '値が 0 以下');
  assert.equal(detectGauge('単位違いの前後 100万円から 150件に増やす').kind, 'label', '単位が異なる前後は前後としない');
});

test('FR-109 AC-624: 「達成」は方向語としてだけ数え、「達成率」は単位（方向語にも指標語にも数えない）', () => {
  assert.equal(detectGauge('目標を達成した、現在 85%、目標 90%').direction, 'up');
  assert.equal(detectGauge('達成率 85%、目標 90%').direction, null, '達成率は方向語ではない');
  assert.equal(detectGauge('達成した'), null, '数字がなければ指標ではない');
  assert.equal(detectGauge('3月5日に会議を開く'), null, '日付は指標ではない');
});

test('FR-109 AC-624: 100% 超はリングが 1 周で上限、棒は 200% で上限。実値を文字で示す', () => {
  const r = detectGauge('達成率が 120% に向上、目標 100%');
  assert.equal(r.kind, 'ring'); assert.equal(r.clamped, true); assert.equal(r.over, 20); assert.equal(r.actualText, '120%');
  const svg = renderGauge(r);
  assert.match(svg, /\+20%/, '超過分の文字');
  assert.match(svg, /stroke-dasharray="2 3"/, '二重の輪（超過の記号）');
  const b = detectGauge('売上を 100万円から 300万円に増やす、目標 100万円');
  assert.equal(b.kind, 'bar'); assert.equal(b.clamped, true);
  assert.match(renderGauge(b), /<polyline/, '切断の記号');
  assert.match(renderGauge(b), /300万円/, '実値の文字');
});

test('FR-109 AC-624: 同じ文字列は毎回同じ結果で、外部通信を使わない', () => {
  const t = '稼働率を 85% に改善、目標 90%';
  assert.deepEqual(detectGauge(t), detectGauge(t));
  assert.equal(detectGauge('English: reduce cost from 10 hours to 6 hours', 'en').kind, 'bar');
});

// FR-109 AC-625: 契約の getGauges と図の中の描画
test('FR-109 AC-625: getGauges が指標を返し、図の中に単位・目標・方向を文字でそろえたゲージ・棒を描く（許可リストの SVG）', async () => {
  const { app } = await withPoints(['稼働率を 85% に改善、目標 90%', '売上を 100万円から 150万円に増やす', '提案を採用しました']);
  const gs = app.getGauges();
  assert.equal(gs.length, 2);
  assert.deepEqual(gs.map((g) => g.kind), ['ring', 'bar']);
  for (const k of ['pointId', 'name', 'value', 'unit', 'target', 'before', 'after', 'direction', 'kind', 'reason', 'actualText', 'clamped']) assert.ok(k in gs[0], k);
  const svg = app.renderSvg();
  assert.match(svg, /data-gauge-strip="2"/);
  assert.match(svg, /data-gauge-point="/);
  assert.match(svg, /目標 90%/); assert.match(svg, /↑ 望ましい方向: 上がる/); assert.match(svg, /リングゲージ/);
  for (const g of gs) assert.ok(isAllowedPartSvg(app.renderGauge(g)), '許可リスト');
  assert.doesNotMatch(svg.replace(/xmlns="[^"]*"/g, ''), /https?:|<image|<use|href=|<script/i);
  // 再配置（整理の表示）でも指標は図に残る
  const m = (await withPoints(['達成率が 80% に向上、目標 90%'])).app;
  assert.match(m.renderSvg(), /data-gauge-strip/);
});

test('FR-109 AC-625: 指標のない図は変えない', async () => {
  const { app } = await withPoints(['提案を採用しました']);
  assert.deepEqual(app.getGauges(), []);
  assert.doesNotMatch(app.renderSvg(), /data-gauge-strip/);
  assert.equal(appendGaugeStrip('<svg viewBox="0 0 10 10" width="10" height="10"></svg>', []), '<svg viewBox="0 0 10 10" width="10" height="10"></svg>');
});

// FR-109 AC-626: ホバー・フォーカスで数値を示し、Esc で閉じる
test('FR-109 AC-626: ホバー・フォーカスで現在値・目標・単位・方向を示し、Esc で閉じる', async () => {
  const { app } = await withPoints(['稼働率を 85% に改善、目標 90%']);
  const tip = app.getGaugeTip(app.getGauges()[0].pointId);
  assert.ok(tip.lines.some((l) => /現在値 85%/.test(l)) && tip.lines.some((l) => /目標 90%/.test(l)) && tip.lines.some((l) => /↑ 上がる/.test(l)) && tip.lines.some((l) => /単位 %/.test(l)));
  // 最小の DOM で、イベントの経路を確かめる
  const listeners = {}; const attrs = {}; let tipEl = null;
  const mkEl = (tag) => { const el = { tag, children: [], style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, append(...c) { this.children.push(...c); }, remove() { tipEl = null; }, set textContent(v) { this.t = v; } }; return el; };
  const docListeners = {};
  const doc = { createElement: mkEl, body: { append(e) { tipEl = e; } }, addEventListener(t, f) { docListeners[t] = f; } };
  const cell = { ownerDocument: doc, attrs: { 'data-gauge-point': app.getGauges()[0].pointId }, setAttribute(k, v) { attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, addEventListener(t, f) { listeners[t] = f; }, getBoundingClientRect: () => ({ left: 10, bottom: 50 }) };
  const svg = { ownerDocument: doc, querySelectorAll: () => [cell] };
  assert.equal(enhanceGaugeDom(svg, null, app), 1);
  assert.equal(attrs.tabindex, '0', 'キーボードでフォーカスできる');
  listeners.focus();
  assert.ok(tipEl && tipEl.attrs.role === 'tooltip', 'フォーカスで示す');
  listeners.keydown({ key: 'Escape', stopPropagation() {} });
  assert.equal(tipEl, null, 'Esc で閉じる');
  listeners.pointerenter();
  assert.ok(tipEl, 'ホバーで示す');
  listeners.pointerleave();
  assert.equal(tipEl, null);
});

// FR-109 AC-627: 要確認の印と元の数値
test('FR-109 AC-627: 確認前も「要確認」の印を隠さず、元の数値をテキスト一覧に出し、確認済みでも元の数値は変わらない', async () => {
  const { app } = await withPoints(['稼働率を 85% に改善、目標 90%']);
  const g = app.getGauges()[0];
  assert.equal(g.needsReview, true);
  assert.match(app.renderSvg(), /▲ 要確認/, '図のゲージにも印');
  const html = app.renderOutline();
  assert.match(html, /data-gauge-point[^>]*>[^<]*元の数値: 稼働率を 85% に改善、目標 90%/);
  assert.match(html, /data-review-mark="1"/, '印が付いたまま');
  app.confirmScene(app.getState().scenes[0].id);
  const g2 = app.getGauges()[0];
  assert.equal(g2.needsReview, false);
  assert.equal(g2.original, g.original, '元の数値は変わらない');
  assert.doesNotMatch(app.renderSvg(), /▲ 要確認/);
});

// FR-109 AC-628: テキスト一覧・出力・機密
test('FR-109 AC-628: テキスト一覧に指標の語が出て、Markdown・HTML・SVG にも出る', async () => {
  const { app, env } = await withPoints(['稼働率を 85% に改善、目標 90%', '売上が 120万円']);
  const html = app.renderOutline();
  for (const w of ['現在値 85%', '目標 90%', '単位 %', '望ましい方向 ↑ 上がる', 'リングゲージ', '数値ラベル', '目標が不明のため比率で示せない']) assert.ok(html.includes(w), w);
  for (const c of ['save.markdown', 'save.html', 'save.svg']) await app.commands[c]();
  const by = Object.fromEntries(env.downloads.map((d) => [d.filename.split('.').pop(), text(d.data)]));
  assert.match(by.md, /## 指標[\s\S]*現在値 85%・目標 90%・単位 %/);
  assert.match(by.md, /元の数値: 稼働率を 85% に改善、目標 90%/);
  assert.match(by.md, /▲ 要確認/, 'Markdown にも要確認の文字');
  assert.match(by.html, /data-gauges/);
  assert.match(by.html, /data-gauge-strip/, 'HTML の図にもゲージ');
  assert.match(by.svg, /data-gauge-strip/);
  assert.doesNotMatch(by.html.replace(/xmlns="[^"]*"/g, ''), /<(?:link|img)\b|src="http|href="http/i);
});

test('FR-109 AC-628: 機密の要点の指標は「除く」の保存の 5 形式から除かれ、画面・テキスト一覧には残る', async () => {
  const { app, env } = await withPoints(['極秘の稼働率を 77% に改善、目標 99%', '公開の稼働率を 85% に改善、目標 90%']);
  const secret = app.getState().scenes.flatMap((s) => s.points).find((p) => p.text.includes('極秘'));
  app.setPointConfidential(secret.id, true);
  assert.equal(app.getGauges().length, 2, '画面には残る');
  assert.ok(app.renderOutline().includes('目標 99%'), 'テキスト一覧にも残る');
  assert.equal(app.setExcludeConfidential(true).ok, true);
  for (const c of ['save.png', 'save.svg', 'save.pdf', 'save.markdown', 'save.html']) await app.commands[c]();
  assert.equal(env.downloads.length, 5);
  for (const d of env.downloads) {
    const s = d.filename.endsWith('.png') || d.filename.endsWith('.pdf') ? Buffer.from(d.data).toString('latin1') : text(d.data);
    assert.ok(!s.includes('99%') && !s.includes('77%'), `${d.filename} に機密の数値が残らない`);
  }
  const svgOut = text(env.downloads.find((d) => d.filename.endsWith('.svg')).data);
  assert.match(svgOut, /85%/, '機密でない指標は残る');
  assert.equal(app.getGauges().length, 2, '保存のあとで元に戻る');
});

test('FR-109: gaugeLine は指標名・現在値・目標・単位・望ましい方向・種類と理由を同じ語で出す', () => {
  const l = gaugeLine({ ...detectGauge('稼働率を 85% に改善、目標 90%'), original: '稼働率を 85% に改善、目標 90%', needsReview: true });
  for (const w of ['現在値 85%', '目標 90%', '単位 %', '望ましい方向 ↑ 上がる', 'リングゲージ', '要確認']) assert.ok(l.includes(w), w);
  assert.match(gaugeLine(detectGauge('rate improved to 85%, target 90%', 'en'), 'en'), /Current 85%.*Target 90%/);
});
