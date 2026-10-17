// FR-052 AC-229 AC-230 AC-231 / FR-055 AC-237 AC-238 / FR-053 AC-232 AC-233 AC-234 / FR-054 AC-235 AC-236
// （System Test。契約: tests/system/CONTRACT.md「発言の種類の強調・関係線の根拠・一覧との一致」）
// 期待値は受入基準だけから決める。実装がなければ失敗するのが正常（not_run → 実装後に pass）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, toDetail } from './helpers.js';

async function feed(texts, { level = 'detail', lang } = {}) {
  const { app, env } = await newApp();
  if (lang) app.setLang(lang);
  app.commands['session.start']();
  for (const t of texts) { app.setDraft(t); assert.equal(app.submitDraft().ok, true, t); env.tick(1); }
  env.scheduler.advance(3000);
  toDetail(app, level);
  return { app, env };
}
const points = (app) => app.getDiagramStyle().scenes.flatMap((s) => s.points);
const stateTexts = (app) => new Map(app.getState().scenes.flatMap((s) => s.points).map((p) => [p.id, p.text]));
const pointOf = (app, text) => {
  const p = app.getState().scenes.flatMap((s) => s.points).find((q) => q.text === text);
  assert.ok(p, `要点「${text}」がある`);
  return points(app).find((q) => q.id === p.id);
};
const rkey = (r) => `${r.kind}|${r.from}|${r.to}|${r.basis}`;
const relSet = (list) => list.map(rkey).sort();

// ---- FR-052 ----
// FR-052 AC-229
test('FR-052 AC-229: 「案Aの採用を提案します。」「We propose adopting A.」は「提案」で、結論の強調が付かない', async () => {
  const { app } = await feed(['案Aの採用を提案します。', 'We propose adopting A.']);
  for (const t of ['案Aの採用を提案します。', 'We propose adopting A.']) {
    const p = pointOf(app, t);
    assert.equal(p.kind, 'proposal', t);
    assert.notEqual(p.kind, 'conclusion');
    assert.equal(p.emphasized, false, `${t} に結論の強調が付かない`);
  }
});

// FR-052 AC-230
test('FR-052 AC-230: 決定の否定・保留（「We have not decided to adopt A.」「Aを採用するかは未定です。」）は「未決定」で、結論の強調が付かない', async () => {
  const { app } = await feed(['We have not decided to adopt A.', 'Aを採用するかは未定です。']);
  for (const t of ['We have not decided to adopt A.', 'Aを採用するかは未定です。']) {
    const p = pointOf(app, t);
    assert.equal(p.kind, 'undecided', t);
    assert.equal(p.emphasized, false, t);
  }
});

// FR-052 AC-231
test('FR-052 AC-231: 合意済みの決定だけが「結論」として強調され、種類は文字のラベルで図と一覧に同じ語で示される', async () => {
  const concl = ['Aを採用すると決まりました。', 'We agreed to adopt A.'];
  const others = ['案Aの採用を提案します。', 'Aを採用するかは未定です。'];
  const { app } = await feed([...concl, ...others]);
  for (const t of concl) {
    const p = pointOf(app, t);
    assert.equal(p.kind, 'conclusion', t); assert.equal(p.emphasized, true, t);
  }
  for (const t of others) assert.equal(pointOf(app, t).emphasized, false, t);
  const labels = new Set(points(app).map((p) => p.kindLabel));
  for (const l of ['結論', '提案', '未決定']) assert.ok(labels.has(l), `ラベル ${l}`);
  assert.ok(points(app).every((p) => typeof p.kindLabel === 'string' && p.kindLabel.trim()), '色だけでなくラベルがある');
  const html = app.renderOutline();
  for (const p of points(app)) {
    const m = html.match(new RegExp(`data-point-id="${p.id}"[^]*?(?=data-point-id=|$)`));
    assert.ok(m && m[0].includes(p.kindLabel), `一覧に同じ語 ${p.kindLabel}`);
  }
});

test('FR-052 AC-229〜231 異常系: 英語表示でも提案・未決定・結論は別のラベルで、結論の強調は結論だけ', async () => {
  const { app } = await feed(['We propose adopting A.', 'We have not decided to adopt A.', 'We agreed to adopt A.'], { lang: 'en' });
  const ps = points(app);
  assert.equal(new Set(ps.map((p) => p.kindLabel)).size, 3);
  assert.deepEqual(ps.filter((p) => p.emphasized).map((p) => p.kind), ['conclusion']);
});

// ---- FR-055 ----
// FR-055 AC-237
test('FR-055 AC-237: 「納期が迫っている。」→「来月から広報を始める。」は原因→結果にならない（英語の起点 from も同様）', async () => {
  for (const seq of [['納期が迫っている。', '来月から広報を始める。'], ['The deadline is near.', 'We start the campaign from next month.']]) {
    const { app } = await feed(seq);
    assert.equal(app.getDiagramRelations().filter((r) => r.kind === 'cause-effect').length, 0, seq.join(' → '));
    assert.equal(app.getOutlineRelations().filter((r) => r.kind === 'cause-effect').length, 0);
  }
});

// FR-055 AC-238
test('FR-055 AC-238: 理由を述べる発話は原因→結果（明示）が付く。因果か不明な「から」は明示にならない', async () => {
  for (const seq of [['雨が降っているから、中止にします。'], ['Because the server is down, we postponed the release.']]) {
    const { app } = await feed(seq.length === 1 ? ['準備を始めます。', ...seq] : seq);
    const r = app.getDiagramRelations().filter((x) => x.kind === 'cause-effect' && x.basis === 'explicit');
    assert.ok(r.length >= 1, seq[0]);
  }
  const { app } = await feed(['3時から会議です。', '資料を配ります。']);
  assert.equal(app.getDiagramRelations().filter((r) => r.basis === 'explicit' && r.kind === 'cause-effect').length, 0);
});

// ---- FR-053 ----
// FR-053 AC-232
test('FR-053 AC-232: 関係線は種類のラベル・向き・根拠を持ち、根拠のない線は「明示」にならない', async () => {
  const { app } = await feed(['雨が降っているから、中止にします。', 'コストが高くて困った', '予算を再配分するアイデアを出します。']);
  const rels = app.getDiagramRelations();
  assert.ok(rels.length >= 1);
  const texts = stateTexts(app);
  for (const r of rels) {
    assert.ok(r.kindLabel && r.kindLabel.trim(), '種類のラベル');
    assert.ok(texts.has(r.from) && texts.has(r.to) && r.from !== r.to, '始点・終点が要点');
    if (r.basis === 'explicit') assert.ok(r.evidence && r.evidence.text && ['word', 'kinds'].includes(r.evidence.type), '明示は根拠を持つ');
  }
  const svg = app.renderSvg();
  assert.match(svg, /data-relation-kind=/); assert.match(svg, /marker-end=/); assert.match(svg, /data-relation-label/);
  for (const r of rels) assert.ok(svg.includes(`data-relation-from="${r.from}"`) && svg.includes(`data-relation-to="${r.to}"`), '図に向き付きの線');
});

// FR-053 AC-233
test('FR-053 AC-233: 根拠のない話順だけの候補は「推測」の文字ラベルが付き、「明示」と見分けられる', async () => {
  const { app } = await feed(['新しい名刺を作ります。', '会場の地図を印刷します。', '懇親会の席を決めます。']);
  const inferred = app.getDiagramRelations().filter((r) => r.basis === 'inferred');
  for (const r of inferred) {
    assert.ok(r.basisLabel.includes('推測'));
    assert.equal(r.evidence, null);
    assert.match(app.renderSvg(), new RegExp(`推測`));
  }
  const { app: a2 } = await feed(['雨が降っているから、中止にします。', '準備を始めます。']);
  for (const r of a2.getDiagramRelations().filter((x) => x.basis === 'explicit')) assert.ok(r.basisLabel.includes('明示') && !r.basisLabel.includes('推測'));
});

// FR-053 AC-234
test('FR-053 AC-234: 同じ発話列からは毎回同じ関係線で、向きは原因・課題が始点・結果・提案が終点（一覧と図で逆にならない）', async () => {
  const seq = ['コストが高くて困った', '予算を再配分するアイデアを出します。', '雨が降っているから、中止にします。'];
  const a = await feed(seq); const b = await feed(seq);
  const norm = (app) => app.getDiagramRelations().map((r) => `${r.kind}|${app.getState().scenes.flatMap((s) => s.points).findIndex((p) => p.id === r.from)}|${app.getState().scenes.flatMap((s) => s.points).findIndex((p) => p.id === r.to)}|${r.basis}`).sort();
  assert.deepEqual(norm(a.app), norm(b.app));
  assert.ok(norm(a.app).length >= 1);
  const t = stateTexts(a.app);
  const ps = a.app.getDiagramRelations().filter((r) => r.kind === 'problem-proposal');
  assert.ok(ps.length >= 1);
  for (const r of ps) { assert.equal(t.get(r.from), 'コストが高くて困った'); assert.equal(t.get(r.to), '予算を再配分するアイデアを出します。'); }
  assert.deepEqual(relSet(a.app.getOutlineRelations()), relSet(a.app.getDiagramRelations()));
});

// ---- FR-054 ----
// FR-054 AC-235
test('FR-054 AC-235: 一覧に関係ごとに種類・始点・終点・明示/推測が文字で出て、根拠の語は PARAM-033 文字以内', async () => {
  const long = '在庫が足りない状態が続いており出荷の遅れが広がる見込みで追加の発注を急ぐ必要があるため、仕入れ先に連絡します。';
  const { app } = await feed(['雨が降っているから、中止にします。', long, 'コストが高くて困った', '予算を再配分するアイデアを出します。']);
  const rels = app.getOutlineRelations();
  assert.ok(rels.length >= 1);
  const t = stateTexts(app); const html = app.renderOutline();
  for (const r of rels) {
    const m = html.match(new RegExp(`<[^>]*data-relation-from="${r.from}"[^>]*data-relation-to="${r.to}"[^]*?(?=data-relation-from=|$)`));
    assert.ok(m, '一覧に関係の要素');
    for (const s of [r.kindLabel, t.get(r.from), t.get(r.to), r.basisLabel]) assert.ok(m[0].includes(s), `${s} が文字で表示`);
    if (r.evidence) assert.ok([...r.evidence.text].length <= 40, '根拠は 40 文字以内');
  }
});

// FR-054 AC-236
test('FR-054 AC-236: 図の関係線の集合（種類・始点・終点・明示/推測）と一覧の関係情報の集合が一致する', async () => {
  const seqs = [
    ['コストが高くて困った', '予算を再配分するアイデアを出します。', '雨が降っているから、中止にします。', '納期が迫っている。', '来月から広報を始める。'],
    ['Because the server is down, we postponed the release.', 'We start from next month.'],
  ];
  for (const seq of seqs) {
    const { app } = await feed(seq);
    const d = app.getDiagramRelations(); const o = app.getOutlineRelations();
    assert.ok(d.length >= 1);
    assert.deepEqual(relSet(o), relSet(d));
    const svg = app.renderSvg(); const html = app.renderOutline();
    for (const r of d) {
      assert.ok(svg.includes(`data-relation-from="${r.from}"`) && svg.includes(`data-relation-basis="${r.basis}"`));
      assert.ok(html.includes(`data-relation-from="${r.from}"`) && html.includes(`data-relation-to="${r.to}"`));
    }
    assert.equal((html.match(/data-relation-from=/g) || []).length, d.length, '一覧にだけある関係が無い');
  }
});

test('FR-054 AC-236 異常系: 関係線がないときは一覧にも関係情報が無く、詳細度を変えても図の線と一覧が食い違わない', async () => {
  const { app } = await feed(['納期が迫っている。', '来月から広報を始める。']);
  assert.equal(app.getDiagramRelations().length, 0);
  assert.equal(app.getOutlineRelations().length, 0);
  assert.ok(!app.renderOutline().includes('data-relation-from'));
  const { app: b } = await feed(['コストが高くて困った', '予算を再配分するアイデアを出します。', '雨が降っているから、中止にします。']);
  for (const lv of ['major', 'middle', 'detail', 'major']) {
    toDetail(b, lv);
    assert.deepEqual(relSet(b.getOutlineRelations()), relSet(b.getDiagramRelations()), lv);
    const drawn = (b.renderSvg().match(/data-relation-from=/g) || []).length;
    assert.equal((b.renderOutline().match(/data-relation-from=/g) || []).length, drawn, `${lv}: 図に描かれる線の数と一覧が同じ`);
  }
});
