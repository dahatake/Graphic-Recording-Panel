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

// FR-054 AC-236（2026-11-07 明確化: 一致を求めるのは「図の可視線」と「一覧のうち可視線に対応する部分」。一覧全体との完全一致は求めない。
// 図の線数上限（PARAM-136）で外れた関係は AC-584 のとおり一覧全体に種類・向き・相手の要点つきで残る（超過関係の保持を弱めない）。
const REL_CAP = 4; // PARAM-136: 1 つの要素に付けて描く関係線の本数の上限
// 図の可視線と、一覧の可視線対応部分の一致を確かめる。一覧にだけある関係は、上限で外れた（超過の）関係に限る。
function checkVisibleCorrespondence(app, label) {
  const d = app.getDiagramRelations(); const o = app.getOutlineRelations();
  const svg = app.renderSvg(); const html = app.renderOutline();
  const ds = new Set(d.map(rkey)); const os = new Set(o.map(rkey));
  // 図の可視の関係線（SVG に描かれた線）と getDiagramRelations の集合が同じ
  const drawn = [...svg.matchAll(/<[^>]*data-relation-from="([^"]+)"[^>]*>/g)].map((m) => m[0]);
  assert.equal(drawn.length, d.length, `${label}: 図の可視線の数`);
  for (const r of d) assert.ok(drawn.some((e) => e.includes(`data-relation-from="${r.from}"`) && e.includes(`data-relation-to="${r.to}"`) && e.includes(`data-relation-kind="${r.kind}"`) && e.includes(`data-relation-basis="${r.basis}"`)), `${label}: 可視線 ${rkey(r)} が図にある`);
  // 可視線対応部分 = 一覧のうち可視線と同じ（種類・始点・終点・明示/推測）の関係。可視線はすべて一覧にある
  const visiblePart = o.filter((r) => ds.has(rkey(r)));
  assert.deepEqual(relSet(visiblePart), relSet(d), `${label}: 可視線の集合と一覧の可視線対応部分が一致`);
  for (const r of d) assert.ok(os.has(rkey(r)), `${label}: 可視線 ${rkey(r)} が一覧にある`);
  // 一覧にだけある関係は、図の線数上限で外れた関係（端の要素に上限まで線が描かれている）に限り、可視線と食い違わない
  const perEl = new Map();
  for (const r of d) for (const id of [r.from, r.to]) perEl.set(id, (perEl.get(id) ?? 0) + 1);
  for (const r of o.filter((x) => !ds.has(rkey(x)))) {
    assert.ok(!d.some((v) => v.from === r.from && v.to === r.to), `${label}: 一覧の ${rkey(r)} は同じ始点・終点の可視線と種類・明示/推測が食い違わない`);
    if (d.length > 0) assert.ok((perEl.get(r.from) ?? 0) >= REL_CAP || (perEl.get(r.to) ?? 0) >= REL_CAP, `${label}: 一覧にだけある ${rkey(r)} は線数上限（PARAM-136）で外れた関係に限る`);
    // AC-584: 超過の関係は一覧に種類・向き・相手の要点つきで残る
    const t = stateTexts(app);
    const m = html.match(new RegExp(`<[^>]*data-relation-from="${r.from}"[^>]*data-relation-to="${r.to}"[^]*?(?=data-relation-from=|$)`));
    assert.ok(m && m[0].includes(r.kindLabel) && m[0].includes(t.get(r.to) ?? '\u0000'), `${label}: 超過の関係 ${rkey(r)} は一覧に種類・向き・相手の要点つきで残る`);
  }
  return { d, o };
}

test('FR-054 AC-236: 図の可視の関係線の集合（種類・始点・終点・明示/推測）と、一覧のうち可視線に対応する関係情報の集合が一致する（一覧全体との完全一致は求めず、一覧にだけある関係は線数上限で外れたものに限る）', async () => {
  const seqs = [
    ['コストが高くて困った', '予算を再配分するアイデアを出します。', '雨が降っているから、中止にします。', '納期が迫っている。', '来月から広報を始める。'],
    ['Because the server is down, we postponed the release.', 'We start from next month.'],
    // 1 つの要素に関係が集まりやすい入力（明示の因果を連ねる。PARAM-136 を超えるときは超過の規則も確かめる）
    ['サーバーが落ちたから、リリースを延期します。', 'サーバーが落ちたから、告知を止めます。', 'サーバーが落ちたから、問い合わせ窓口を開きます。', 'サーバーが落ちたから、返金を検討します。', 'サーバーが落ちたから、謝罪文を出します。', 'サーバーが落ちたから、監視を強化します。'],
  ];
  for (const [i, seq] of seqs.entries()) {
    const { app } = await feed(seq);
    const { d } = checkVisibleCorrespondence(app, `列${i + 1}`);
    assert.ok(d.length >= 1, `列${i + 1}: 前提: 可視の関係線がある`);
  }
});

// FR-054 AC-236（2026-11-07 再明確化: 本 AC の関係線は FR-053 のシーン内の要素間の線。FR-025 AC-130・AC-135 のトピック間の「順」「関連」とは別で、
// 「大項目」ではトピック間の線・種類ラベル・一覧の文字を維持する。超過関係は固定入力で前提を確かめ、成立しなければ合格・省略にせず前提不成立で失敗する）
// 固定入力（テスト前に固定。実測に合わせて変えない）: 1 つの原因の要点に、明示の因果の結果が PARAM-136 本を超えて付く発話列。
// 入力の境界の調査（2026-11-07）: 契約上シーンの構造を注入できるのは loadSessionFile（CONTRACT.md の Scene.relations:[{from,to}]）だけだが、
// 正規の Scene.relations は種類・明示/推測を持たず、getDiagramRelations・getOutlineRelations の観察点とも結び付かないため、本 AC の超過関係の前提には使えない。
// 適切な境界が契約に無いので、前提不成立のまま失敗させる（条件付きの skip・私有 API の使用・合格扱いはしない）。
const OVERFLOW_SEQ = ['サーバーが落ちた。', 'サーバーが落ちたから、リリースを延期します。', 'サーバーが落ちたから、告知を止めます。', 'サーバーが落ちたから、問い合わせ窓口を開きます。', 'サーバーが落ちたから、返金を検討します。', 'サーバーが落ちたから、謝罪文を出します。', 'サーバーが落ちたから、監視を強化します。'];
// トピック間の関係がある入力（AC-135: 隣り合う 2 トピック → 「順」）。空白区切りの語を 2 語以上（PARAM-015）共有するシーンだけが同じトピック。
const TOPIC_GROUPS = [['予算 コスト 見直し 必要'], ['予算 コスト 削減 検討'], ['リリース 計画 決定 日程'], ['リリース 計画 担当 確認']];
const relLine = (html, r) => (html.match(new RegExp(`<[^>]*data-relation-from="${r.from}"[^>]*data-relation-to="${r.to}"[^]*?(?=data-relation-from=|$)`)) ?? [''])[0];

test('FR-054 AC-236 異常系: 図に可視線がないときは可視線対応部分も空。超過関係のある固定入力で、図に残った関係と可視線対応部分が一致し、外れた関係は種類・向き・相手の要点つきで一覧に残り、詳細度（FR-026）を変えても保持される。「大項目」では要素間の線と対応部分が空でも、トピック間の関係（AC-130・AC-135）の線・種類ラベル・一覧の文字は残る', async () => {
  // (1) 関係のない入力: 可視線も対応部分も空（これだけでは以下の確認を代替しない）
  const { app } = await feed(['納期が迫っている。', '来月から広報を始める。']);
  assert.equal(app.getDiagramRelations().length, 0);
  const { o } = checkVisibleCorrespondence(app, '関係なし');
  assert.equal(o.filter((r) => app.getDiagramRelations().some((v) => rkey(v) === rkey(r))).length, 0, '可視線対応部分は空');
  assert.ok(!/data-relation-from=/.test(app.renderSvg()), '図に要素間の線はない');

  // (2) 超過関係の固定入力: 前提（一覧に、1 つの要素へ PARAM-136 本を超える関係がある）を確かめる。成立しなければ前提不成立で失敗
  const { app: b } = await feed(OVERFLOW_SEQ);
  const all = b.getOutlineRelations();
  const perAll = new Map();
  for (const r of all) for (const id of [r.from, r.to]) perAll.set(id, (perAll.get(id) ?? 0) + 1);
  const hub = [...perAll].find(([, n]) => n > REL_CAP);
  assert.ok(hub, `前提不成立: 固定入力（OVERFLOW_SEQ）で 1 つの要素に PARAM-136（${REL_CAP}）本を超える関係が一覧にない（要素ごとの最大 ${Math.max(0, ...perAll.values())} 本）。合格・検証省略にしない（AC-236 検証の前提。契約に超過関係を注入できる入力の境界が無い）`);
  const { d } = checkVisibleCorrespondence(b, '超過・詳細');
  const ds = new Set(d.map(rkey));
  const outside = all.filter((r) => !ds.has(rkey(r)));
  assert.ok(outside.length >= 1, '前提不成立: 線数上限で図から外れた関係がない');
  const perVis = new Map();
  for (const r of d) for (const id of [r.from, r.to]) perVis.set(id, (perVis.get(id) ?? 0) + 1);
  assert.ok([...perVis.values()].every((n) => n <= REL_CAP), '図に残った線は 1 要素あたり PARAM-136 本まで');
  const texts = stateTexts(b);
  const keep = () => { const html = b.renderOutline(); for (const r of outside) { const m = relLine(html, r); assert.ok(m && m.includes(r.kindLabel) && m.includes(texts.get(r.from)) && m.includes(texts.get(r.to)), `外れた関係 ${rkey(r)} は一覧に種類・向き（始点→終点）・相手の要点つきで残る`); } };
  keep();
  const first = { d: relSet(d), o: relSet(all) };
  for (const lv of ['major', 'middle', 'detail', 'major', 'detail']) {
    toDetail(b, lv);
    const { d: dv } = checkVisibleCorrespondence(b, `超過・${lv}`);
    if (lv !== 'detail') {
      assert.equal(dv.length, 0, `${lv}: 要素間の線と、その可視線対応部分は空`);
      const html = b.renderOutline();
      for (const r of outside) assert.ok(html.includes(texts.get(r.to)) || html.includes(r.kindLabel), `${lv}: 切替で AC-584 の一覧全体の情報（外れた関係 ${rkey(r)}）を消さない`);
    } else {
      assert.deepEqual(relSet(b.getDiagramRelations()), first.d, '詳細に戻すと同じ可視線');
      assert.deepEqual(relSet(b.getOutlineRelations()), first.o, '詳細に戻すと一覧全体（超過関係を含む）も元のまま');
      keep();
    }
  }

  // (3) トピック間の関係（FR-025 AC-130・AC-135）は本 AC の対象外で、「大項目」では線・種類ラベル・一覧の文字で確認できる
  const { app: c, env } = await newApp();
  c.commands['session.start']();
  TOPIC_GROUPS.forEach((g, i) => { for (const t of g) { c.setDraft(t); c.submitDraft(); env.tick(1); } if (i < TOPIC_GROUPS.length - 1) c.commands['session.nextScene'](); });
  env.scheduler.advance(3000);
  toDetail(c, 'major');
  assert.ok(c.getTopics().length >= 2, '前提不成立: トピックが 2 つ以上にならない');
  const svg = c.renderSvg(); const outline = c.renderOutline();
  assert.ok(/data-topic-relation/.test(svg), '大項目: トピック間の関係の線が図にある');
  assert.ok(/>[^<]*順[^<]*</.test(svg), '大項目: 隣り合うトピックの関係に種類の文字ラベル「順」がある（色だけで示さない）');
  assert.ok(/>[^<]*順[^<]*</.test(outline), '大項目: テキスト一覧でもトピック間の関係「順」を文字で確認できる');
  assert.equal(c.getDiagramRelations().length, 0, '大項目: 要素間の関係線（本 AC の対象）は空');
  assert.ok(!/data-relation-from=/.test(svg), '大項目: 図に要素間の線はない');
});