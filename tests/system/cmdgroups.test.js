// NFR-UX-011 AC-459〜464（System Test。契約: CONTRACT.md「コマンドバーの作業順グループ」）
// 期待値は受入基準だけから決める（PARAM-006=640px、PARAM-092=7 個）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, CJK } from './helpers.js';

const NARROW = 640; // PARAM-006（以下で折り返す）
const WIDE = 1280;
const MAX_PER_GROUP = 7; // PARAM-092
const ORDER = ['import', 'apiKeys', 'session', 'view', 'layoutType', 'presentation', 'export', 'data', 'environment'];
const JA = ['取り込み', '接続キー', '記録', '表示', 'レイアウト型', 'プレゼンテーション', '図の書き出し', 'データ', '画面・環境'];
const MEMBERS = {
  import: ['import.file'],
  apiKeys: ['apiKeys.open'], // FR-084 AC-482（画面最上部の「接続キー」）
  session: ['session.start', 'session.pause', 'session.resume', 'session.stop', 'session.nextScene', 'input.focus'],
  view: ['view.2d', 'view.3d', 'view.timeline', 'view.arrange', 'detail.next', 'drawStyle.pick'], // drawStyle.pick は末尾（FR-077）
  presentation: ['presentation.start', 'presentation.pause', 'presentation.resume', 'presentation.stop', 'presentation.prev', 'presentation.next'],
  export: ['save.png', 'save.svg', 'save.pdf', 'prompt.copy'], // prompt.copy は末尾（FR-078）
  data: ['file.save', 'file.load', 'data.reset'],
  environment: ['layout.tile', 'layout.focus', 'layout.maximize', 'layout.reset', 'theme.toggle', 'lang.ja', 'lang.en'],
};
const isLayoutType = (c) => c.startsWith('layoutType.') || c === 'settings.open';
const bar = (app) => app.getCommandBar();
const groupOf = (g) => g.commands;
const sameSet = (a, b) => assert.deepEqual([...a].sort(), [...b].sort());
const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const byLayout = (app, w) => app.getCommandBarLayout({ viewportWidth: w });

// NFR-UX-011 AC-459
test('NFR-UX-011 AC-459: グループは 取り込み→接続キー→記録→表示→レイアウト型→プレゼンテーション→図の書き出し→データ→画面・環境 の 9 つで、各ボタンが定められたグループに属する', async () => {
  const { app } = await newApp();
  const groups = bar(app).groups;
  assert.deepEqual(groups.map((g) => g.id), ORDER);
  for (const g of groups) {
    if (g.id === 'layoutType') {
      assert.ok(groupOf(g).every(isLayoutType), '型アイコン・クリア・設定だけ');
      for (const c of ['layoutType.clear', 'settings.open']) assert.ok(g.commands.includes(c), c);
      assert.ok(g.commands.length > 2, '型アイコンがある');
    } else sameSet(g.commands, MEMBERS[g.id]);
  }
  // items は DOM 順＝グループを順に並べたもの、各 item が属するグループ ID を持つ
  assert.deepEqual(bar(app).items.map((i) => i.command), groups.flatMap(groupOf));
  for (const g of groups) for (const c of g.commands) assert.equal(bar(app).items.find((i) => i.command === c).group, g.id, c);
});

// NFR-UX-011 AC-459（3ba5311: 描画スタイルの選択は「表示」の末尾、プロンプトのコピーは「図の書き出し」の末尾）
test('NFR-UX-011 AC-459: 描画スタイルの選択（drawStyle.pick）は「表示」の末尾、プロンプトのコピー（prompt.copy）は「図の書き出し」の末尾にある（DOM 順・視覚順とも）', async () => {
  const { app } = await newApp();
  const groups = bar(app).groups;
  const view = groups.find((g) => g.id === 'view');
  const exp = groups.find((g) => g.id === 'export');
  assert.equal(view.commands.at(-1), 'drawStyle.pick', '表示の末尾');
  assert.equal(exp.commands.at(-1), 'prompt.copy', '図の書き出しの末尾');
  for (const w of [WIDE, NARROW]) {
    const lay = byLayout(app, w);
    const pos = new Map(lay.items.map((i) => [i.command, i.rect]));
    for (const [last, others] of [['drawStyle.pick', MEMBERS.view.slice(0, -1)], ['prompt.copy', MEMBERS.export.slice(0, -1)]]) {
      const r = pos.get(last);
      assert.ok(r, `${w}px: ${last} が表示されている`);
      for (const c of others) {
        const o = pos.get(c);
        assert.ok(o.y < r.y || (o.y === r.y && o.x < r.x), `${w}px: ${last} は ${c} より後ろに視覚上もある`);
      }
    }
  }
});

test('NFR-UX-011 AC-459 異常系: 描画スタイルの選択・プロンプトのコピーはほかのグループ（レイアウト型・データなど）に入らず、各 1 個だけ', async () => {
  const { app } = await newApp();
  const groups = bar(app).groups;
  for (const [c, gid] of [['drawStyle.pick', 'view'], ['prompt.copy', 'export']]) {
    assert.deepEqual(groups.filter((g) => g.commands.includes(c)).map((g) => g.id), [gid], `${c} は ${gid} にだけ属する`);
    assert.equal(bar(app).items.filter((i) => i.command === c).length, 1, `${c} は 1 個`);
  }
  assert.ok(groups.find((g) => g.id === 'view').commands.length <= MAX_PER_GROUP);
  assert.ok(groups.find((g) => g.id === 'export').commands.length <= MAX_PER_GROUP);
});

test('NFR-UX-011 AC-459 異常系: 各グループは 7 個以内で、どのボタンも 1 つのグループにだけ属する（重複・未分類なし）', async () => {
  const { app } = await newApp();
  const groups = bar(app).groups;
  for (const g of groups) assert.ok(g.commands.length >= 1 && g.commands.length <= MAX_PER_GROUP, `${g.id}: ${g.commands.length} 個`);
  const all = groups.flatMap(groupOf);
  assert.equal(new Set(all).size, all.length, '重複なし');
  sameSet(all, bar(app).items.map((i) => i.command));
});

test('NFR-UX-011 AC-459 異常系: 折り返す幅でも（画面幅 640px 以下）グループの順序は上→下・左→右で 9 つのまま', async () => {
  const { app } = await newApp();
  const lay = byLayout(app, NARROW);
  assert.deepEqual(lay.groups.map((g) => g.id), ORDER);
});

// NFR-UX-011 AC-460
test('NFR-UX-011 AC-460: 各グループに見出しが表示され、グループの要素に同じ名前がアクセシブルな名前として付く（日本語）', async () => {
  const { app } = await newApp();
  app.setLang('ja');
  bar(app).groups.forEach((g, i) => {
    assert.equal(g.name, JA[i], g.id);
    assert.equal(g.headingVisible, true, `${g.id}: 見出しが見える`);
    assert.equal(g.accessibleName, g.name, `${g.id}: アクセシブルな名前が見出しと同じ`);
  });
});

test('NFR-UX-011 AC-460: 日本語⇄英語の切替で全グループ名が切替後の言語になり、再読み込みを要さない', async () => {
  const { app } = await newApp();
  app.setLang('ja');
  const ja = bar(app).groups.map((g) => g.name);
  app.setLang('en');
  const en = bar(app).groups;
  en.forEach((g, i) => {
    assert.ok(g.name.trim(), `${g.id}: 非空`);
    assert.ok(!CJK.test(g.name), `${g.id}: 英語に日本語が残らない (${g.name})`);
    assert.notEqual(g.name, ja[i], `${g.id}: 切替で変わる`);
    assert.equal(g.accessibleName, g.name, `${g.id}: アクセシブルな名前も追従`);
  });
  assert.equal(new Set(en.map((g) => g.name)).size, en.length, '英語名もグループごとに異なる');
  app.setLang('ja');
  assert.deepEqual(bar(app).groups.map((g) => g.name), ja, '日本語に戻る');
});

// NFR-UX-011 AC-461
test('NFR-UX-011 AC-461: データのグループでは、データの初期化がファイル保存・ファイル読込より後ろの最後（DOM 順・視覚順とも）にある', async () => {
  const { app } = await newApp();
  const g = bar(app).groups.find((x) => x.id === 'data');
  assert.equal(g.commands.at(-1), 'data.reset');
  assert.ok(g.commands.indexOf('file.save') < g.commands.indexOf('data.reset'));
  assert.ok(g.commands.indexOf('file.load') < g.commands.indexOf('data.reset'));
  for (const w of [WIDE, NARROW]) {
    const pos = new Map(byLayout(app, w).items.map((i) => [i.command, i.rect]));
    const r = pos.get('data.reset');
    for (const c of ['file.save', 'file.load']) {
      const o = pos.get(c);
      assert.ok(o.y < r.y || (o.y === r.y && o.x < r.x), `${w}px: ${c} より後ろに視覚上もある`);
    }
  }
});

test('NFR-UX-011 AC-461 異常系: 英語でもデータの初期化はグループの最後で、取り消せない操作が先頭や中間に来ない', async () => {
  const { app } = await newApp();
  app.setLang('en');
  const g = bar(app).groups.find((x) => x.id === 'data');
  assert.equal(g.commands.at(-1), 'data.reset');
  assert.equal(bar(app).items.filter((i) => i.command === 'data.reset').length, 1);
});

// NFR-UX-011 AC-462
test('NFR-UX-011 AC-462: DOM 順・Tab で巡る順・視覚順（グループの順、グループ内の順）が一致する', async () => {
  const { app } = await newApp();
  const b = bar(app);
  const dom = b.items.map((i) => i.command);
  assert.deepEqual(b.focusOrder, dom, 'Tab 順 = DOM 順');
  assert.ok(b.items.every((i) => i.tabbable === true && !(i.tabIndex > 0)), '正の tabindex を使わず、全ボタンが Tab で到達できる');
  const lay = byLayout(app, WIDE);
  const visual = [...lay.items].sort((a, c) => a.rect.y - c.rect.y || a.rect.x - c.rect.x).map((i) => i.command);
  assert.deepEqual(visual, dom, '視覚順 = DOM 順');
});

test('NFR-UX-011 AC-462 異常系: 画面幅 640px 以下で折り返しても、上→下・左→右の視覚順が DOM 順と一致しグループの順序は入れ替わらない', async () => {
  const { app } = await newApp();
  const dom = bar(app).items.map((i) => i.command);
  for (const w of [NARROW, 480, 360]) {
    const lay = byLayout(app, w);
    const visual = [...lay.items].sort((a, c) => a.rect.y - c.rect.y || a.rect.x - c.rect.x).map((i) => i.command);
    assert.deepEqual(visual, dom, `${w}px: 視覚順 = DOM 順`);
    assert.deepEqual(lay.groups.map((g) => g.id), ORDER, `${w}px: グループ順は不変`);
    const gy = lay.groups.map((g) => [g.headingRect.y, g.headingRect.x]);
    for (let i = 1; i < gy.length; i++) assert.ok(gy[i][0] > gy[i - 1][0] || (gy[i][0] === gy[i - 1][0] && gy[i][1] > gy[i - 1][1]), `${w}px: 見出し ${ORDER[i]} は前の見出しより後`);
  }
});

// NFR-UX-011 AC-463（integration。ここでは System 側から集合の不変を確認）
test('NFR-UX-011 AC-463: 並べ替え後もボタンの集合が過不足なく同じで、ラベル・ツールチップ・操作が従来どおり動く', async () => {
  const { app } = await newApp();
  const all = ['import.file', ...MEMBERS.session, ...MEMBERS.view, 'layoutType.clear', 'settings.open', ...MEMBERS.presentation, ...MEMBERS.export, ...MEMBERS.data, ...MEMBERS.environment];
  const cmds = bar(app).items.map((i) => i.command);
  for (const c of all) assert.ok(cmds.includes(c), `${c} が残っている`);
  assert.equal(new Set(cmds).size, cmds.length);
  for (const it of bar(app).items) {
    assert.ok(it.label?.trim() && it.labelVisible === true, `${it.command}: ラベル`);
    assert.equal(it.accessibleName, it.label);
    assert.ok(it.tooltip?.text?.trim(), `${it.command}: ツールチップ`);
    assert.ok(it.icon === undefined || String(it.icon).trim(), `${it.command}: アイコン`);
    assert.equal(typeof app.commands[it.command], 'function', `${it.command}: 操作がある`);
  }
});

// NFR-UX-011 AC-464（integration）
test('NFR-UX-011 AC-464: 画面幅 640px 以下でも横スクロールなしで全ボタンに到達でき、グループ見出しがボタンや他の見出しと重ならない', async () => {
  const { app } = await newApp();
  for (const w of [NARROW, 480, 360]) {
    const lay = byLayout(app, w);
    assert.equal(lay.scrollsHorizontally, false, `${w}px: 横スクロールなし`);
    assert.equal(lay.items.length, bar(app).items.length, `${w}px: 全ボタンが表示範囲にある`);
    for (const it of lay.items) assert.ok(it.rect.x >= 0 && it.rect.x + it.rect.w <= w, `${w}px: ${it.command} が画面幅内`);
    for (const g of lay.groups) {
      const h = g.headingRect;
      assert.ok(h.w > 0 && h.h > 0, `${w}px: ${g.id} 見出しに大きさがある`);
      for (const it of lay.items) assert.ok(!intersects(h, it.rect), `${w}px: 見出し ${g.id} が ${it.command} と重ならない`);
      for (const o of lay.groups) if (o !== g) assert.ok(!intersects(h, o.headingRect), `${w}px: 見出し ${g.id} が ${o.id} と重ならない`);
    }
  }
});

test('NFR-UX-011 AC-464 異常系: 英語（見出しが長くなる）でも 640px 以下で見出しがボタン・他の見出しと重ならず横スクロールしない', async () => {
  const { app } = await newApp();
  app.setLang('en');
  const lay = byLayout(app, NARROW);
  assert.equal(lay.scrollsHorizontally, false);
  for (const g of lay.groups) {
    for (const it of lay.items) assert.ok(!intersects(g.headingRect, it.rect), `見出し ${g.id} が ${it.command} と重ならない`);
    for (const o of lay.groups) if (o !== g) assert.ok(!intersects(g.headingRect, o.headingRect), `${g.id} と ${o.id}`);
  }
});
