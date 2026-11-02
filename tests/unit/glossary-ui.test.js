// FR-093 AC-549（用語集の画面をキーだけで操作できる）の単体テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, keyFor } from '../system/helpers.js';

const open = (app) => app.handleKey(keyFor(app, 'glossary.open'));
const type = (app, term, variants = '') => { app.setGlossaryInput({ term, variants }); return app.submitGlossaryInput(); };

// FR-093 AC-549: Tab・Enter・Delete・Esc だけで登録・編集・削除・閉じるができ、フォーカスが戻る
test('FR-093 AC-549: キーだけで開く・登録・編集・削除・閉じるができ、閉じるとフォーカスが元に戻る', async () => {
  const { app } = await newApp();
  const before = app.getFocusedElement();
  assert.equal(open(app), 'glossary.open');
  assert.equal(app.getFocusedElement(), 'glossary.term', '開くと入力欄へフォーカス');
  // Tab で 入力欄 → 別表記 → 追加 → 閉じる と進み、一周して戻る
  const order = app.getGlossaryView().tabOrder;
  assert.deepEqual(order.slice(0, 4), ['glossary.term', 'glossary.variants', 'glossary.add', 'glossary.close']);
  app.handleKey({ key: 'Tab' }); assert.equal(app.getFocusedElement(), 'glossary.variants');
  app.handleKey({ key: 'Tab', shiftKey: true }); assert.equal(app.getFocusedElement(), 'glossary.term');
  // Enter で登録
  app.setGlossaryInput({ term: 'Azure', variants: 'アジュール、あじゅーる' });
  assert.equal(app.handleKey({ key: 'Enter' }), 'glossary.submit');
  let v = app.getGlossaryView();
  assert.equal(v.items.length, 1);
  assert.deepEqual(v.items[0].variants, ['アジュール', 'あじゅーる']);
  assert.equal(v.input.term, '', '登録後は入力欄が空に戻る');
  const id = v.items[0].id;
  // 一覧へ Tab で進み Enter で編集（入力欄へ値が入りフォーカスが移る）
  while (app.getFocusedElement() !== `glossary.item.${id}`) app.handleKey({ key: 'Tab' });
  assert.equal(app.handleKey({ key: 'Enter' }), 'glossary.edit');
  v = app.getGlossaryView();
  assert.equal(v.editingId, id); assert.equal(v.input.term, 'Azure');
  assert.equal(app.getFocusedElement(), 'glossary.term');
  // 編集して Enter で更新
  app.setGlossaryInput({ term: 'Microsoft Azure' });
  assert.equal(app.handleKey({ key: 'Enter' }), 'glossary.submit');
  assert.equal(app.getGlossary().terms[0].term, 'Microsoft Azure');
  assert.equal(app.getGlossaryView().editingId, null);
  // Delete で削除（一覧の語にフォーカスがあるとき）
  assert.ok(app.focusGlossary(`glossary.item.${id}`));
  assert.equal(app.handleKey({ key: 'Delete' }), 'glossary.delete');
  assert.equal(app.getGlossary().count, 0);
  assert.equal(app.getFocusedElement(), 'glossary.term', '一覧が空ならフォーカスは入力欄へ');
  // Esc で閉じてフォーカスが開く前へ戻る
  assert.equal(app.handleKey({ key: 'Escape' }), 'glossary.close');
  assert.equal(app.getGlossaryView(), null);
  assert.equal(app.getFocusedElement(), before, 'フォーカスが開く前の要素へ戻る');
});

// FR-093 AC-549: 矢印で一覧の語を移動、Delete 後は隣へフォーカス
test('FR-093 AC-549: 矢印キーで一覧の語を移動でき、削除すると隣の語へフォーカスが移る', async () => {
  const { app } = await newApp();
  open(app);
  type(app, 'A'); type(app, 'B'); type(app, 'C');
  const ids = app.getGlossary().terms.map((t) => t.id);
  app.focusGlossary(`glossary.item.${ids[0]}`);
  app.handleKey({ key: 'ArrowDown' }); assert.equal(app.getFocusedElement(), `glossary.item.${ids[1]}`);
  app.handleKey({ key: 'ArrowUp' }); app.handleKey({ key: 'ArrowUp' });
  assert.equal(app.getFocusedElement(), `glossary.item.${ids[0]}`, '端で止まる');
  app.handleKey({ key: 'Delete' });
  assert.deepEqual(app.getGlossary().terms.map((t) => t.term), ['B', 'C']);
  assert.equal(app.getFocusedElement(), `glossary.item.${ids[1]}`);
});

// FR-093 AC-549: 空・重複は追加されず、理由と「n／上限 件」を文字で表示（日英）
for (const lang of ['ja', 'en']) {
  test(`FR-093 AC-549: 空・重複は追加されず理由と件数を文字で示す (${lang})`, async () => {
    const { app } = await newApp();
    app.setLang(lang);
    open(app);
    assert.ok(/0／500/.test(app.getGlossaryView().countText));
    assert.equal(lang === 'ja' ? app.getGlossaryView().countText.endsWith('件') : app.getGlossaryView().countText.endsWith('items'), true);
    let r = type(app, '   ');
    assert.equal(r.ok, false); assert.ok(r.reason.length > 0);
    const emptyMsg = app.getGlossaryView().error;
    assert.ok(emptyMsg && emptyMsg === r.reason, '理由が画面の状態にも出る');
    assert.ok(app.renderGlossary().includes(emptyMsg), '画面の文字に理由が出る');
    assert.equal(type(app, 'Azure').ok, true);
    r = type(app, ' Ａｚｕｒｅ ');
    assert.equal(r.ok, false);
    assert.notEqual(app.getGlossaryView().error, emptyMsg, '重複は別の理由');
    assert.equal(app.getGlossary().count, 1);
    assert.ok(/1／500/.test(app.getGlossaryView().countText));
    // 成功すると理由は消える
    assert.equal(type(app, 'GitHub').ok, true);
    assert.equal(app.getGlossaryView().error, null);
  });
}

// FR-093 AC-549: 編集中の Esc は編集の取り消し（画面は閉じない）
test('FR-093 AC-549: 編集中の Esc は取り消しで、もう 1 回で閉じる', async () => {
  const { app } = await newApp();
  open(app); type(app, 'Azure', 'アジュール');
  const id = app.getGlossary().terms[0].id;
  app.editGlossaryItem(id);
  app.setGlossaryInput({ term: '変更中' });
  assert.equal(app.handleKey({ key: 'Escape' }), 'glossary.cancelEdit');
  const v = app.getGlossaryView();
  assert.ok(v && v.editingId === null && v.input.term === '');
  assert.equal(app.getGlossary().terms[0].term, 'Azure', '登録は変わらない');
  assert.equal(app.handleKey({ key: 'Escape' }), 'glossary.close');
  assert.equal(app.getGlossaryView(), null);
});

// FR-093 AC-549: 語は escape される（HTML として解釈されない）
test('FR-093 AC-549: 画面の描画で語の < > & " \' は escape される', async () => {
  const { app } = await newApp();
  open(app);
  type(app, '<img src=x onerror=alert(1)>', '"&\'');
  const html = app.renderGlossary();
  assert.ok(!html.includes('<img'), 'タグがそのまま出ない');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&quot;') && html.includes('&amp;') && html.includes('&#39;'));
});

// FR-093 AC-549: 「閉じる」ボタンに Tab で移り Enter で閉じられる
test('FR-093 AC-549: 閉じるボタンへ Tab で移り Enter で閉じる', async () => {
  const { app } = await newApp();
  open(app);
  while (app.getFocusedElement() !== 'glossary.close') app.handleKey({ key: 'Tab' });
  assert.equal(app.handleKey({ key: 'Enter' }), 'glossary.close');
  assert.equal(app.getGlossaryView(), null);
});
