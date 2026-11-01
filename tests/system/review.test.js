// FR-092 AC-546（確認の操作・確認日・手修正で未確認へ・元に戻す・再描画で復活しない・復元）
// FR-024 AC-572（元の発話の表示。用語集の置換前・まとめた要点・手追加）
// （System Test。契約: tests/system/CONTRACT-REVIEW.md）
// 期待値は受入基準だけから決める。実装がなければ失敗するのが正常（not_run → 実装後に pass）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, toDetail, keyFor } from './helpers.js';

const p2 = (n) => String(n).padStart(2, '0');
const stamp = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const hms = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
const pt = (app, text) => {
  const p = app.getState().scenes.flatMap((s) => s.points).find((q) => q.text === text);
  assert.ok(p, `要点「${text}」がある`);
  return p;
};
async function feed(texts, { gapSec = 1 } = {}) {
  const ctx = await newApp();
  const { app, env } = ctx;
  app.commands['session.start']();
  const times = [];
  for (const t of texts) { env.tick(gapSec); times.push(env.now()); app.setDraft(t); assert.equal(app.submitDraft().ok, true, t); }
  env.scheduler.advance(3000);
  toDetail(app);
  return { ...ctx, times };
}

// FR-092 AC-546
test('FR-092 AC-546: 確認の操作で印が外れ「確認済み」＋確認日（YYYY-MM-DD HH:mm・ローカル）が付き、手修正で未確認に戻り、元に戻すと直前の値に戻り、再配置・再読込で復活／消失しない', async () => {
  const { app, env, createApp } = await feed(['予算は100万円です', '普通に進めます', '田中さんが担当します']);
  const num = pt(app, '予算は100万円です'), plain = pt(app, '普通に進めます'), name = pt(app, '田中さんが担当します');

  // 確認前は「未確認」＋印
  assert.equal(app.getPointReview(num.id).needsReview, true);
  assert.equal(app.getPointReview(num.id).status, 'unconfirmed');
  assert.equal(app.getPointReview(plain.id).needsReview, false);

  // 確認（要点）→ 印が外れ、確認済み・確認日
  env.tick(60);
  assert.equal(app.confirmPoint(num.id).ok, true);
  let r = app.getPointReview(num.id);
  assert.equal(r.needsReview, false);
  assert.equal(r.status, 'confirmed');
  assert.equal(r.confirmedAt, stamp(env.now()));
  assert.match(r.confirmedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  const confirmedNum = r.confirmedAt;

  // キーボード: コマンド review.confirm（選択中のシーンの未確認の要点を確認）が keymap にあり handleKey で動く
  const scene = app.getState().scenes.find((s) => s.points.some((q) => q.id === name.id));
  app.selectScene(scene.id);
  const k = keyFor(app, 'review.confirm');
  assert.ok(k, 'review.confirm に keymap の割り当てがある');
  assert.equal(app.handleKey(k), 'review.confirm');
  assert.equal(app.getPointReview(name.id).status, 'confirmed');
  assert.equal(app.getSceneReview(scene.id).status, 'confirmed');
  assert.equal(app.getSceneReview(scene.id).unconfirmedCount, 0);

  // 再配置・再描画（詳細度の往復・追加発話）で印は復活しない
  app.setDetailLevel('major'); toDetail(app);
  app.commands['session.nextScene']();
  env.tick(1); app.setDraft('次の話題です'); app.submitDraft(); env.scheduler.advance(3000);
  assert.equal(app.getPointReview(num.id).needsReview, false);
  assert.equal(app.getPointReview(num.id).status, 'confirmed');

  // 手修正で未確認に戻り、印は再判定（数字が残るので再び印）
  assert.equal(app.editPoint(num.id, '予算は200万円です').ok, true);
  r = app.getPointReview(num.id);
  assert.equal(r.status, 'unconfirmed'); assert.equal(r.confirmedAt, null); assert.equal(r.needsReview, true);
  // 数値などを含まない文へ手修正 → 印なし（未確認のまま）
  assert.equal(app.editPoint(name.id, '担当は決まりました').ok, true);
  assert.equal(app.getPointReview(name.id).status, 'unconfirmed');
  assert.equal(app.getPointReview(name.id).needsReview, false);

  // 元に戻す: 直前の確認状態・確認日・印も手修正の前の値に戻る
  assert.equal(app.undoManualEdit().ok, true);
  r = app.getPointReview(name.id);
  assert.equal(r.status, 'confirmed'); assert.equal(r.needsReview, false); assert.ok(r.confirmedAt);
  assert.equal(app.undoManualEdit().ok, true);
  r = app.getPointReview(num.id);
  assert.equal(r.status, 'confirmed'); assert.equal(r.confirmedAt, confirmedNum, '確認日も手修正の前の値');
  assert.equal(app.getState().scenes.flatMap((s) => s.points).find((q) => q.id === num.id).text, '予算は100万円です');
  // 履歴がなければ無効で理由が示される（異常系）
  const none = app.undoManualEdit();
  assert.equal(none.ok, false); assert.ok(none.reason);

  // 異常系: 存在しない要点の確認は ok:false で状態不変
  assert.equal(app.confirmPoint('no-such-point').ok, false);

  // 復元: 再読込（同じ storage）後も確認状態・確認日が保たれる
  const before = app.getPointReview(num.id);
  const app2 = await createApp(env.options);
  const num2 = pt(app2, '予算は100万円です');
  assert.deepEqual(app2.getPointReview(num2.id), before);
  assert.equal(app2.getPointReview(pt(app2, '普通に進めます').id).needsReview, false);
});

// FR-092 AC-546（まとめた要点・シーンの確認）
test('FR-092 AC-546: シーンの確認操作は含む要点すべてを、まとめた要点（同一文字列）の確認はまとめた要点すべてを確認済みにする', async () => {
  const { app } = await feed(['来週の月曜に集まる', '来週の月曜に集まる', '田中さんに連絡する']);
  const dup = app.getState().scenes.flatMap((s) => s.points).filter((q) => q.text === '来週の月曜に集まる');
  assert.equal(dup.length, 2, 'テキスト一覧では元の件数のまま');
  assert.equal(app.getPointReview(dup[0].id).needsReview, true);
  assert.equal(app.confirmPoint(dup[0].id).ok, true);
  assert.equal(app.getPointReview(dup[0].id).status, 'confirmed');
  assert.equal(app.getPointReview(dup[1].id).status, 'confirmed', 'まとめた要点すべて');
  const scene = app.getState().scenes.find((s) => s.points.some((q) => q.text === '田中さんに連絡する'));
  assert.equal(app.confirmScene(scene.id).ok, true);
  for (const q of scene.points) assert.equal(app.getPointReview(q.id).status, 'confirmed', q.text);
  assert.equal(app.confirmScene('no-such-scene').ok, false);
});

// FR-024 AC-572
test('FR-024 AC-572: ポップアップとテキスト一覧に元の発話（認識文字列と HH:MM:SS）が示され、用語集の置換前の文字列・まとめた要点の話順・手追加も示される', async () => {
  const { app, env, times } = await (async () => {
    const c = await newApp();
    c.app.commands['session.start']();
    return { ...c, times: [] };
  })();
  assert.equal(app.addGlossaryTerm({ term: 'Kubernetes', variants: ['くべるねてす'] }).ok, true);
  const feedOne = (t) => { env.tick(2); times.push(env.now()); app.setDraft(t); assert.equal(app.submitDraft().ok, true, t); };
  feedOne('くべるねてす を導入します');
  feedOne('見積もりを確認する');
  feedOne('見積もりを確認する');
  env.scheduler.advance(3000);
  toDetail(app);

  const sc = app.getState().scenes[0];
  assert.equal(app.selectScene(sc.id) !== false, true);
  const popup = app.getScenePopup();
  assert.ok(popup && popup.open);
  const outline = app.renderOutline();

  // 用語集で置換された要点: 表示は正しい表記、元の認識文字列も示される
  const replaced = sc.points.find((q) => q.text.includes('Kubernetes'));
  assert.ok(replaced, '要点に正しい表記が使われる');
  const pp = popup.points.find((q) => q.id === replaced.id);
  assert.equal(pp.sources.length, 1);
  assert.equal(pp.sources[0].rawText, 'くべるねてす を導入します');
  assert.equal(pp.sources[0].time, hms(times[0]));
  for (const html of [popup.html, outline]) {
    assert.ok(html.includes('くべるねてす を導入します'), '元の認識文字列');
    assert.ok(html.includes(hms(times[0])), '受け付けた時刻 HH:MM:SS');
  }

  // まとめた要点（同一文字列 2 件）: 件数分すべて、時刻の順
  const dups = sc.points.filter((q) => q.text === '見積もりを確認する');
  assert.equal(dups.length, 2);
  for (const html of [popup.html, outline]) {
    const a = html.indexOf(hms(times[1])), b = html.indexOf(hms(times[2]));
    assert.ok(a >= 0 && b > a, '2 件の時刻が話順に並ぶ');
    assert.equal(html.split('見積もりを確認する').length - 1 >= 2, true, '件数分');
  }

  // 手で追加した要点（FR-005）は「手追加」
  const added = app.addManualPoint(sc.id, '手で足した要点');
  assert.equal(added.ok, true);
  const popup2 = app.getScenePopup();
  const mp = popup2.points.find((q) => q.id === added.pointId);
  assert.equal(mp.manual, true);
  assert.deepEqual(mp.sources, []);
  for (const html of [popup2.html, app.renderOutline()]) assert.ok(html.includes('手追加'), '「手追加」の表示');
  // 異常系: 存在しないシーン・空の文字列は追加されない
  assert.equal(app.addManualPoint('no-such-scene', 'x').ok, false);
  assert.equal(app.addManualPoint(sc.id, '   ').ok, false);
});
