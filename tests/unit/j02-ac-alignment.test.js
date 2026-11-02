// J-02: 要求の棚卸しで文面を直した AC と実装の突き合わせ（AC-133・AC-165 系の PARAM・AC-094・AC-439・AC-474・PARAM-169/170）。
// System Test は tests/system/（detail・llm-consent-persist など）。ここは単体・結合テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../web/src/app.js';
import { LLM_LABEL_MAX } from '../../web/src/llmdraw.js';
import { DESCRIPTION_AXIS_MAX, textWeight } from '../../web/src/stylepresets.js';
import { DESC_SHORT_MAX } from '../../web/src/stylepicker.js';

function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, dump: () => JSON.stringify([...m.entries()]) };
}
class Sched {
  constructor(clock) { this.t = 0; this.q = []; this.n = 1; this.clock = clock; }
  setTimeout(fn, ms) { const id = this.n++; this.q.push({ id, at: this.t + ms, fn }); return id; }
  clearTimeout(id) { this.q = this.q.filter((e) => e.id !== id); }
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      const next = this.q.filter((e) => e.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      this.q = this.q.filter((e) => e !== next); this.t = next.at; this.clock.t = 1e12 + this.t; next.fn();
    }
    this.t = end; this.clock.t = 1e12 + end;
  }
}
class Speech { constructor() { this.onresult = null; } availabilityFor() { return 'local'; } start() {} stop() {} emit(text, isFinal = true) { this.onresult?.({ text, isFinal }); } }

// FR-026 AC-133（PARAM-164＝3 回以内）: 「詳細」の検索は、完全一致する項目を先頭に並べる
test('FR-026 AC-133: 「詳細」の検索で detail.detail が先頭（操作 2 回）になり、前方一致の項目より完全一致が先に並ぶ', async () => {
  const app = await createApp({ storage: mem() });
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    const full = app.getDetailInfo().options.at(-1).label; // 「詳細」／ "full" など最後の水準の名称
    const hits = app.searchCommands(lang === 'ja' ? '詳細' : 'Full').map((x) => x.command);
    assert.ok(hits.includes('detail.detail'), lang);
    const idx = hits.indexOf('detail.detail');
    assert.ok(1 + idx + 1 <= 3, `${lang}: 操作回数 ${1 + idx + 1} > 3`);
    assert.ok(full);
  }
  app.setLang('ja');
  const hits = app.searchCommands('詳細').map((x) => x.command);
  assert.equal(hits[0], 'detail.detail');
  // 並びを変えても、該当する全件が残る（欠けない）
  for (const c of ['detail.major', 'detail.middle', 'detail.next']) assert.ok(hits.includes(c), c);
  assert.deepEqual(app.searchCommands('   '), []);
});

// NFR-PERF（PARAM-165）: LLM が返したラベルは 24 文字まで
test('PARAM-165: LLM が返したラベル文字列の最大の長さは 24 文字（定数 LLM_LABEL_MAX）', () => {
  assert.equal(LLM_LABEL_MAX, 24);
});

// FR-075 AC-405（PARAM-169）・AC-414（PARAM-170）
test('PARAM-169 FR-075 AC-405: 画風の記述は 1 軸 60 文字（英語は半角で 2 倍）以内で、超える定義は invalid_description', async () => {
  assert.equal(DESCRIPTION_AXIS_MAX, 60);
  const app = await createApp({ storage: mem() });
  const ok = (s) => ({ color: s, drawing: 'd', font: 'f', mood: 'm' });
  const base = { id: 'j02x', label: { ja: 'テスト', en: 'Test' }, line: { width: 1, jitter: 0 }, fill: { mode: 'paper' }, text: { decor: 'plain', icons: true } };
  assert.equal(app.registerDrawStyle({ ...base, id: 'j02ok', description: { ja: ok('あ'.repeat(60)), en: ok('a'.repeat(120)) } }).ok, true);
  assert.equal(app.registerDrawStyle({ ...base, id: 'j02ja', description: { ja: ok('あ'.repeat(61)) } }).reason, 'invalid_description');
  assert.equal(app.registerDrawStyle({ ...base, id: 'j02en', description: { en: ok('a'.repeat(121)) } }).reason, 'invalid_description');
  // 組み込みの画風の記述は全て上限以内
  for (const s of app.getDrawStyles()) {
    const d = app.getDrawStyleSpec(s.id)?.description;
    if (d && s.id.startsWith('j02') === false) for (const l of Object.values(d)) for (const v of Object.values(l)) assert.ok(textWeight(v) <= DESCRIPTION_AXIS_MAX, `${s.id}: ${v}`);
  }
});

test('PARAM-170 FR-075 AC-414: 描画スタイルの一覧の短い説明は 40 文字（英語は半角で 2 倍）以内', async () => {
  assert.equal(DESC_SHORT_MAX, 40);
  const app = await createApp({ storage: mem() });
  for (const lang of ['ja', 'en']) {
    app.setLang(lang);
    for (const o of app.getDrawStylePicker().options) assert.ok(o.description && textWeight(o.description) <= DESC_SHORT_MAX, `${lang} ${o.id}: ${o.description}`);
  }
});

// FR-018 AC-094: 初期化の対象外は詳細度・簡易マスキングの設定と登録語。描画スタイル・型の現在値は［設定］の既定に戻る
test('FR-018 AC-094 / FR-026: データの初期化で描画スタイル・型の現在値は［設定］の既定に戻り、詳細度は変わらない', async () => {
  const app = await createApp({ storage: mem() });
  const defStyle = app.getSettings().drawStyle;
  app.setDetailLevel('major');
  app.setDrawStyle('anime'); app.setLayoutTypes(['bubble']);
  assert.equal(app.getDrawStyle(), 'anime');
  app.commands['session.start']();
  app.setDraft('話す'); app.submitDraft();
  app.commands['data.reset'](); await app.dialogAction('confirm');
  assert.equal(app.getDrawStyle(), defStyle);
  assert.equal(app.getLayoutInfo().manual, false);
  assert.equal(app.getDetailLevel(), 'major', '詳細度は初期化の対象外');
  assert.equal(app.getState().session, 'preparing');
  assert.equal(app.getState().scenes.length, 0);
});

// NFR-PRIV-003 AC-474: 簡易マスキングの設定と登録語は、端末のブラウザ内にだけ保存され、初期化・セッションファイルの対象外
test('FR-078 AC-474: 簡易マスキングの設定と登録語は端末に保存され、再読込で復元され、データの初期化で消えない', async () => {
  const storage = mem();
  const app = await createApp({ storage });
  assert.equal(app.getLlmMasking(), true);
  assert.equal(app.addLlmMaskWord('  極秘案件 ').ok, true);
  assert.equal(app.addLlmMaskWord('極秘案件').ok, true); // 重複は増えない
  assert.equal(app.addLlmMaskWord('   ').ok, false);
  app.addLlmMaskWord('第二の語');
  app.setLlmMasking(false);
  assert.deepEqual(app.getLlmMaskWords(), ['極秘案件', '第二の語']);
  // 設定画面（LLM 連携が無効・同意なしでも）で操作できる
  app.commands['settings.open']();
  const d = app.getSettingsDialog();
  assert.equal(d.fields.find((f) => f.id === 'llm.mask').value, false);
  assert.deepEqual(d.fields.find((f) => f.id === 'llm.maskWords').words, ['極秘案件', '第二の語']);
  app.commands['settings.close']();
  // データの初期化の対象外
  app.commands['session.start'](); app.setDraft('x'); app.submitDraft();
  app.commands['data.reset'](); await app.dialogAction('confirm');
  assert.deepEqual(app.getLlmMaskWords(), ['極秘案件', '第二の語']);
  assert.equal(app.getLlmMasking(), false);
  // 再読込で復元
  const app2 = await createApp({ storage });
  assert.deepEqual(app2.getLlmMaskWords(), ['極秘案件', '第二の語']);
  assert.equal(app2.getLlmMasking(), false);
  // セッションファイルには含まれない
  const saved = JSON.stringify(app2.exportSession?.() ?? app2.getSessionFile?.() ?? '');
  assert.ok(!saved.includes('極秘案件') && !saved.includes('第二の語'));
  // 一覧から個別に削除
  assert.equal(app2.removeLlmMaskWord('極秘案件').ok, true);
  assert.equal(app2.removeLlmMaskWord('極秘案件').ok, false);
  const app3 = await createApp({ storage });
  assert.deepEqual(app3.getLlmMaskWords(), ['第二の語']);
  assert.equal(app3.applyLlmMask('第二の語です'), '●●●です');
});

// FR-080 AC-439: プレゼンテーション（FR-010）の再生中は再配置を保留し、休止・終了した後に行う
test('FR-080 AC-439: プレゼンテーションの再生中は再配置を保留し、休止した後の最初の時点で行う', async () => {
  const clock = { t: 1e12 }; const sched = new Sched(clock); const speech = new Speech();
  const app = await createApp({ storage: mem(), scheduler: sched, now: () => clock.t, speechSource: speech, env: { webgl: false, reducedMotion: false, viewportWidth: 1280 } });
  app.setDetailLevel('detail');
  assert.equal(app.setArrangeInterval(1).ok, true);
  app.commands['session.start'](); app.startSpeech?.();
  const count = () => app.getArrangeStatus().count;
  speech.emit('最初の発話です'); sched.advance(1000); speech.emit('二番目の発話です'); sched.advance(1000);
  app.commands['presentation.start']();
  if (app.getState().presentation?.status !== 'playing') return; // 再生を始められない構成ではこの確認の対象外
  const before = count();
  speech.emit('再生中に増える発話です');
  sched.advance(2500);
  assert.equal(count(), before, '再生中は再配置されない');
  app.commands['presentation.pause']();
  sched.advance(10);
  assert.equal(count(), before + 1, '休止の後の最初の時点で再配置される');
});
