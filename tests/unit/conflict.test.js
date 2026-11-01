// FR-099 AC-585〜588 の単体・結合テスト（対立・トレードオフ・少数意見の表示。比較の 2 列）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, toDetail, keyFor } from '../system/helpers.js';
import { detectConflictCandidates, hasConflictPhrase, sideNames } from '../../web/src/conflict.js';
import { applyConflicts, subgroupLabel, sceneTree } from '../../web/src/infodesign.js';
import { markdownHead, htmlHead } from '../../web/src/meetingout.js';
import { RELATION_PHRASES } from '../../web/src/layoutkinds.js';

const SAY = ['A案に賛成です', 'しかし B案は反対です', '予算は来月決めます', '一方で C案も検討したい', 'D案のメリットは速さです'];
async function setup(texts = SAY) {
  const { app, env } = await newApp();
  app.commands['session.start']();
  for (const t of texts) { app.setDraft(t); app.submitDraft(); env.tick(1); }
  toDetail(app);
  const scene = () => app.getState().scenes[0];
  return { app, env, scene };
}
const pts = (...texts) => texts.map((text, i) => ({ id: `p${i}`, uid: `u${i}`, text }));

// AC-585
test('FR-099 AC-585: 言い回し（PARAM-133）のある要点と直前または直後の要点が、2 つの側に分けた候補になり、決定的', () => {
  const sc = { id: 's1', points: pts('A案は速い', 'しかし B案は安い') };
  const a = detectConflictCandidates(sc, [], 'ja');
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].sides.map((s) => [s.id, s.pointIds]), [['left', ['p0']], ['right', ['p1']]], '言い回しのある要点が対比の先（右）');
  assert.deepEqual(detectConflictCandidates(sc, [], 'ja'), a, '同じ入力から毎回同じ');
  // 賛成／反対: 名前と側
  const b = detectConflictCandidates({ id: 's1', points: pts('A案に賛成です', '予算の話', 'B案は反対です') }, [], 'ja');
  assert.equal(b.length, 1);
  assert.deepEqual(b[0].names, ['賛成', '反対']);
  assert.deepEqual(b[0].sides.map((s) => s.pointIds), [['p0'], ['p1']], '賛成の直後の要点が反対の側（直後）。言い回しのない要点も、対比される要点になる');
});
test('FR-099 AC-585: 言い回しがなければ候補はなく、英語の語は語境界あり・大文字小文字を区別しない。関係の種類「対立」と同じ言い回し', () => {
  assert.deepEqual(detectConflictCandidates({ id: 's', points: pts('予算を決める', '日程を決める') }, [], 'ja'), []);
  assert.equal(hasConflictPhrase('The canvas is big'), false);
  assert.equal(hasConflictPhrase('A VS B'), true);
  assert.equal(hasConflictPhrase('However, we agree'), true);
  assert.equal(hasConflictPhrase('whatsoever'), false);
  for (const w of RELATION_PHRASES.opposition) assert.equal(hasConflictPhrase(`xx ${w} yy`), true, w);
  assert.deepEqual(sideNames(['メリットは速さ'], 'ja'), ['メリット', 'デメリット']);
  assert.deepEqual(sideNames(['反対です'], 'en'), ['For', 'Against']);
});
test('FR-099 AC-585: アプリの候補は文字「候補」と形の印（◇）で、確定した組と区別され、生成 AI なしで検出される', async () => {
  const { app } = await setup();
  const c = app.getConflictCandidates();
  assert.ok(c.length >= 1);
  assert.equal(c[0].status, 'candidate');
  assert.equal(c[0].word, '候補');
  assert.equal(c[0].mark, '◇');
  assert.match(app.renderOutline(), /data-conflict-status="candidate"[\s\S]*?◇[\s\S]*?対立の候補/);
  assert.match(app.renderSvg(), /data-conflict-mark="candidate"/);
  assert.match(app.renderSvg(), /◇ 候補: /);
});

// AC-586
test('FR-099 AC-586: 候補を確定・解除でき、確定した組は保存・復元され、初期化で消える', async () => {
  const { app, env } = await setup();
  const c = app.getConflictCandidates()[0];
  const before = app.getConflictCandidates().length;
  assert.equal(app.dismissConflict(c.id).ok, true);
  assert.equal(app.getConflictCandidates().length, before - 1, '解除した候補は再検出で戻らない');
  assert.equal(app.getConflictCandidates().some((x) => x.id === c.id), false);
  const { app: app2 } = await setup();
  const c2 = app2.getConflictCandidates()[0];
  const r = app2.confirmConflict(c2.id);
  assert.equal(r.ok, true);
  assert.equal(app2.getConflicts().filter((x) => x.status === 'confirmed').length, 1);
  assert.equal(app2.getConflictCandidates().some((x) => x.id === c2.id), false);
  void env;
});
test('FR-099 AC-586: 要点を 2 つ以上選んで組にし、側を割り当て・移し、解除できる。手動の指定は自動の検出より優先される', async () => {
  const { app } = await setup();
  const [p0, p1, p2] = app.getState().scenes[0].points;
  assert.equal(app.createConflict([p0.id]).ok, false, '1 つだけでは組にならない');
  const made = app.createConflict([p0.id, p1.id, p2.id], { sides: { [p0.id]: 'left', [p1.id]: 'right', [p2.id]: 'right' }, names: ['賛成', '反対'] });
  assert.equal(made.ok, true);
  const g = app.getConflicts().find((c) => c.id === made.id);
  assert.deepEqual(g.sides.map((s) => s.count), [1, 2]);
  assert.equal(app.createConflict([p0.id, p1.id]).reason, 'already_grouped');
  assert.equal(app.getConflictCandidates().some((c) => c.sides.some((s) => s.pointIds.some((id) => [p0.id, p1.id, p2.id].includes(id)))), false, '手動の組の要点は候補に出ない');
  assert.equal(app.setConflictSide(p2.id, 'left').ok, true);
  assert.deepEqual(app.getConflicts().find((c) => c.id === made.id).sides.map((s) => s.count), [2, 1]);
  assert.equal(app.createConflict([p0.id, p1.id], { sides: { [p0.id]: 'left', [p1.id]: 'left' } }).ok, false);
  assert.equal(app.ungroupConflict(made.id).ok, true);
  assert.equal(app.getConflicts().some((c) => c.id === made.id), false);
  assert.equal(app.ungroupConflict('nope').ok, false);
});
test('FR-099 AC-586: キーだけで、選択した要点を選んで組にし（もう一度押す）、候補は確定・解除できる', async () => {
  const { app } = await setup(['予算を決める', '日程を決める', '場所を決める', 'A案に賛成です', 'しかし B案は反対です']);
  const [p0, p1] = app.getState().scenes[0].points;
  const press = (c) => app.handleKey(keyFor(app, c));
  assert.equal(press('conflict.group'), 'conflict.group', '選択がなくても例外にならず、名前を返す');
  assert.equal(app.getConflictSelection().length, 0);
  // 候補に入っていない要点を探す
  const cand = new Set(app.getConflictCandidates().flatMap((c) => c.sides.flatMap((s) => s.pointIds)));
  const free = app.getState().scenes[0].points.filter((p) => !cand.has(p.id));
  assert.ok(free.length >= 2);
  app.selectPoint(free[0].id); press('conflict.group');
  app.selectPoint(free[1].id); press('conflict.group');
  assert.equal(app.getConflictSelection().length, 2);
  press('conflict.group'); // 選択済みの要点でもう一度
  assert.ok(app.getConflicts().some((c) => c.status === 'confirmed' && c.sides.flatMap((s) => s.pointIds).includes(free[0].id)));
  // 候補: 確定 → 解除
  const c = app.getConflictCandidates()[0];
  assert.ok(c);
  app.selectPoint(c.sides[0].pointIds[0]);
  press('conflict.group');
  assert.ok(app.getConflicts().some((x) => x.status === 'confirmed' && x.sides.some((s) => s.pointIds.includes(c.sides[0].pointIds[0]))));
  press('conflict.ungroup');
  assert.equal(app.getConflicts().some((x) => x.sides.some((s) => s.pointIds.includes(c.sides[0].pointIds[0]))), false);
  void p0; void p1;
});
test('FR-099 AC-586: 組と側はセッションの保存（FR-012・FR-019）に含まれて復元され、初期化で消える', async () => {
  const { app, env } = await setup();
  const [p0, p1] = app.getState().scenes[0].points;
  const made = app.createConflict([p0.id, p1.id], { names: ['賛成', '反対'] });
  assert.equal(made.ok, true);
  app.flushSave();
  const { app: app2 } = await newApp({ storage: env.storage });
  const g = app2.getConflicts().find((c) => c.status === 'confirmed');
  assert.ok(g, '復元される');
  assert.deepEqual(g.sides.map((s) => [s.name, s.pointIds]), [['賛成', [p0.id]], ['反対', [p1.id]]]);
  await app2.commands['data.reset']();
  await app2.dialogAction('confirm');
  assert.equal(app2.getConflicts().filter((c) => c.status === 'confirmed').length, 0, '初期化で消える');
});

// AC-587
test('FR-099 AC-587: 確定した組は「比較」の見出しの下に側ごとの 2 列で、少数の側も同じ大きさで描かれ、結論が列の先頭になる', async () => {
  const { app } = await setup(['A案に賛成です', 'しかし B案は反対です', 'B案は高いので反対です', 'まとめると、A案を採用すると決まりました']);
  const [p0, p1, p2, p3] = app.getState().scenes[0].points;
  const made = app.createConflict([p0.id, p3.id, p1.id, p2.id], { sides: { [p0.id]: 'left', [p3.id]: 'left', [p1.id]: 'right', [p2.id]: 'right' }, names: ['賛成', '反対'] });
  assert.equal(made.ok, true);
  const svg = app.renderSvg();
  assert.match(svg, /data-subgroup-kind="compare"/);
  assert.match(svg, />⇄ 比較: 賛成 2／反対 2</);
  assert.match(svg, /◀ 賛成（2）/);
  assert.match(svg, /▶ 反対（2）/);
  assert.equal((svg.match(/data-role="compare-column-frame"/g) ?? []).length, 2);
  const els = app.getDiagramElements().filter((e) => e.kind === 'point');
  const w = new Set(els.map((e) => e.w));
  assert.equal(w.size, 1, '全員同じ幅');
  const order = app.getArrangedPointOrder(app.getState().scenes[0].id).map((r) => r[0]);
  assert.equal(order[0], p3.id, '左の列の先頭は結論（AC-426）');
  assert.equal(order[1], p0.id, '左の列は結論の次に賛成');
  assert.deepEqual(order.slice(2).sort(), [p1.id, p2.id].sort(), '右の列の 2 件は種類の順（同じ幅で並ぶ）');
  // 左の列が右の列より左にある
  const x = (id) => els.find((e) => e.refIds.includes(id)).x;
  assert.ok(x(p0.id) < x(p1.id));
  assert.equal(x(p0.id), x(p3.id));
  // テキスト一覧にも同じ語
  const html = app.renderOutline();
  assert.match(html, /data-conflict-status="confirmed"/);
  assert.match(html, /⇄[\s\S]*?対立（比較）: 賛成 2／反対 2/);
  assert.match(html, /◀<\/span> 賛成（2）/);
  assert.match(html, /data-conflict-badge="confirmed"[^>]*data-conflict-side="left"[^>]*>[\s\S]*?対立: 賛成/);
  // 再配置後も維持される
  app.flushSave();
  assert.deepEqual(app.getArrangedPointOrder(app.getState().scenes[0].id).map((r) => r[0]), order);
});
test('FR-099 AC-587: applyConflicts は組の要点をまとまりの外から抜き、外の並び（結論が先頭）はそのまま。0 件の側も残す', () => {
  const scene = { id: 's', points: pts('決定しました。A案にします', '課題は予算です', 'A案に賛成です', 'B案は反対です') };
  const tree = sceneTree(scene);
  const out = applyConflicts(tree, scene, [{ id: 'g1', sides: [{ id: 'left', name: '賛成', pointIds: ['p2'] }, { id: 'right', name: '反対', pointIds: ['p3'] }] }]);
  assert.equal(out.children.some((n) => n.compare), true);
  assert.equal(out.children.filter((n) => n.type === 'point').length, 2, '外の要点は 2 つ');
  const cmp = out.children.find((n) => n.compare);
  assert.equal(subgroupLabel(cmp, 'ja', 2), '⇄ 比較: 賛成 1／反対 1');
  assert.equal(subgroupLabel(cmp, 'en', 2), '⇄ Compare: 賛成 1 / 反対 1');
  const zero = applyConflicts(tree, scene, [{ id: 'g2', sides: [{ id: 'left', name: '賛成', pointIds: ['p2', 'p3'] }, { id: 'right', name: '反対', pointIds: [] }] }]);
  assert.equal(zero.children.find((n) => n.compare).compare.sides[1].count, 0);
  assert.equal(applyConflicts(tree, scene, null), tree);
});

// AC-588
test('FR-099 AC-588: 異論・少数の側が 0 件でも「合意」「全員一致」と書かず、「異論の記録なし」と文字で書く（図・一覧・Markdown・HTML）', async () => {
  const { app } = await setup(['A案に賛成です', 'B案にも賛成です', '日程は来週です']);
  const [p0, p1] = app.getState().scenes[0].points;
  const made = app.createConflict([p0.id, p1.id], { sides: { [p0.id]: 'left', [p1.id]: 'left' } });
  assert.equal(made.ok, false, '片側だけの組は作れない');
  const ok = app.createConflict([p0.id, p1.id], { names: ['賛成', '反対'] });
  assert.equal(ok.ok, true);
  app.setConflictSide(p1.id, 'left'); // 右の側が 0 件
  const g = app.getConflicts().find((c) => c.status === 'confirmed');
  assert.equal(g.sides[1].count, 0);
  const svg = app.renderSvg();
  const outline = app.renderOutline();
  const mo = app.getMeetingOutput();
  const md = markdownHead(mo, 'ja').join('\n');
  const html = htmlHead(mo, 'ja', (s) => String(s));
  for (const s of [svg, outline, md, html]) {
    assert.match(s, /異論の記録なし/);
    assert.doesNotMatch(s, /全員一致/);
  }
  assert.doesNotMatch(outline, /合意/);
  assert.doesNotMatch(md + html, /合意/);
  assert.match(svg, /data-role="compare-empty"[^>]*>異論の記録なし</);
  assert.match(outline, /data-conflict-empty="1"[^>]*>異論の記録なし</);
  assert.match(mo.objectionLine, /異論・懸念: 異論の記録なし/);
  assert.match(mo.conflictLine, /対立（比較）: 1 組/);
});
test('FR-099 AC-588: 異論・懸念の項目があれば件数を書く。組も異論もなければ何も足さない（出力は従来のまま）', async () => {
  const { app } = await setup(['予算は十分です', '日程は来週です']);
  assert.deepEqual(app.getConflictLines(), {});
  assert.doesNotMatch(app.renderOutline(), /outline-conflicts/);
  const { app: app2 } = await setup();
  app2.addMeetingItem('objection', { text: 'B案はコストが心配です' });
  const [p0, p1] = app2.getState().scenes[0].points;
  app2.createConflict([p0.id, p1.id]);
  assert.match(app2.getConflictLines().objectionLine, /異論・懸念: 1 件/);
});
