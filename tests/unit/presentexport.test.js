// FR-090 AC-529・AC-531 の単体・結合テスト（構造化 Markdown・HTML プレゼンテーションの保存物）。AC-528・AC-530 は tests/system/present-export.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from '../system/helpers.js';
import { buildMarkdown, buildHtml } from '../../web/src/presentexport.js';

// FR-090 AC-529: Markdown の内容は FR-054 のテキスト一覧（renderOutline）と一致する（見出し・要点の順序と文字）
test('FR-090 AC-529: Markdown の見出し・要点は renderOutline のテキスト一覧と同じ順序・同じ文字', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  await app.commands['save.markdown']();
  const md = String(env.downloads[0].data);
  const mdTexts = md.split('\n').filter((l) => /^### /.test(l)).map((l) => l.replace(/^### /, '').replace(/ \[要確認\]$/, '')); // 行末の印（AC-547）は要点の文字ではない
  const outline = app.renderOutline();
  const olTexts = [...outline.matchAll(/<li data-point-id="[^"]*">(?:<span[^>]*>[^<]*<\/span> )?([^<]*)(?:<(?!\/li>)[\s\S]*?)?<\/li>/g)].map((m) => m[1].replace(/\s*（元の発話[^）]*）\s*$/, '').trimEnd()); // 要点（トピックの見出しと末尾の節は Markdown 固有で一致の対象外。A-258）。要点の文字の後ろの元の発話・印（AC-572・AC-545）は文字の一致の対象外
  assert.deepEqual(mdTexts, olTexts);
});

test('FR-090 AC-529: Markdown に API キー・トークンの実値を含めない（保存対象は会議の内容だけ）', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  await app.commands['save.markdown']();
  const md = String(env.downloads[0].data);
  assert.ok(!/(api[-_ ]?key|token|secret)/i.test(md));
});

test('FR-090 AC-528: buildMarkdown は # 会議タイトル・## トピック、詳細で ### 要点と関係の箇条書き、末尾に決定事項・アクション項目の節を出す', () => {
  const scenes = [{ id: 's1', heading: 'H1', points: [{ id: 'p1', text: '課題A' }, { id: 'p2', text: '提案B' }, { id: 'p3', text: '採用を決定しました' }] }];
  const topics = [{ id: 't1', title: 'T1', sceneIds: ['s1'] }];
  const relations = [{ from: 'p1', to: 'p2', kindLabel: '課題→提案' }];
  const kindOf = (t) => (t.includes('決定') ? 'conclusion' : 'note');
  const tail = '## 決定事項\n\n- 採用を決定しました\n\n## アクション項目\n\n- なし\n';
  assert.equal(buildMarkdown({ scenes, topics, relations, level: 'major', title: 'M', kindOf }), `# M\n\n## T1\n\n${tail}`);
  assert.equal(buildMarkdown({ scenes, topics, relations, level: 'middle', title: 'M', kindOf }), `# M\n\n## T1\n\n- H1\n\n${tail}`);
  assert.equal(buildMarkdown({ scenes, topics, relations, level: 'detail', title: 'M', kindOf }),
    `# M\n\n## T1\n\n### 課題A\n\n- 課題→提案 → 提案B\n\n### 提案B\n\n### 採用を決定しました\n\n${tail}`);
});

test('FR-090 AC-530: buildHtml は概要 1 枚＋トピックごと 1 枚（スライド数 = トピック数 + 1）', () => {
  const scenes = [{ id: 's1', heading: 'H1', points: [{ id: 'p1', text: 'A' }] }, { id: 's2', heading: 'H2', points: [{ id: 'p2', text: 'B' }] }];
  const topics = [{ id: 't1', title: 'T1', sceneIds: ['s1'] }, { id: 't2', title: 'T2', sceneIds: ['s2'] }];
  const html = buildHtml({ scenes, topics, title: 'M', svgOf: () => '<svg></svg>' });
  assert.equal((html.match(/<section data-slide /g) ?? []).length, 3);
  assert.ok(html.includes('data-slide-kind="overview"'));
  assert.ok(html.includes('data-topic-id="t1"') && html.includes('data-topic-id="t2"'));
});
// FR-090 AC-531: 会議の文字列は文字としてだけ入る・外部参照なし
test('FR-090 AC-531: buildHtml は会議の文字列をエスケープし、外部の URL を参照しない', () => {
  const evil = '<script>alert(1)</script><img src=x onerror="y">"&';
  const html = buildHtml({ scenes: [{ id: 's1', heading: evil, points: [{ id: 'p', text: evil }] }], topics: [{ id: 't"1', title: evil, sceneIds: ['s1'] }], title: evil, svgOf: () => '<svg></svg>' });
  assert.equal((html.match(/<script>/g) ?? []).length, 1, '実行されるスクリプトは同梱の 1 つだけ');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('data-topic-id="t&quot;1"'));
  assert.ok(!/(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html));
  assert.ok(!/url\(|@import|@font-face/i.test(html));
});

test('FR-090 AC-530: 自動送りの滞在は PARAM-004 の 8 秒', () => {
  const html = buildHtml({ scenes: [{ id: 's1', heading: 'h', points: [] }], svgOf: () => '' });
  assert.ok(html.includes('D=8*1000'));
});

// FR-090 AC-547（観察点: 出力の文字列に対する検査）: 要点の行の印・確認の状況・未確認の件数・XSS
test('FR-090 AC-547: buildMarkdown/buildHtml は未確認の要点だけに [要確認] を付け、確認の状況と未確認 k 件を出す（詳細度 major でも節に列挙・会議の文字列は escape）', () => {
  const scenes = [{ id: 's1', heading: 'h', points: [{ id: 'p1', text: '発注は 12 月 3 日' }, { id: 'p2', text: '普通' }, { id: 'p3', text: '<img src=x onerror=1>' }] }];
  const topics = [{ id: 't1', title: 'T', sceneIds: ['s1'] }];
  const review = { confirmed: 1, total: 3, ids: new Set(['p1', 'p3']) };
  const md = buildMarkdown({ scenes, topics, level: 'detail', title: 'M', review });
  assert.ok(md.includes('確認の状況: 確認済み 1 件／全体 3 件'));
  assert.ok(md.includes('### 発注は 12 月 3 日 [要確認]\n'));
  assert.ok(md.includes('### 普通\n'));
  const major = buildMarkdown({ scenes, topics, level: 'major', title: 'M', review });
  assert.ok(!/^### /m.test(major));
  assert.ok(major.includes('## 要確認') && major.includes('- 発注は 12 月 3 日') && major.includes('確認の状況: 確認済み 1 件／全体 3 件'));
  const html = buildHtml({ scenes, topics, title: 'M', labels: { auto: 'a', hint: 'h' }, svgOf: () => '', review });
  assert.ok(html.includes('確認の状況: 確認済み 1 件／全体 3 件') && html.includes('未確認 2 件'));
  assert.ok(html.includes('<li>発注は 12 月 3 日 [要確認]</li>') && html.includes('<li>普通</li>'));
  assert.ok(!html.includes('<img src=x'));
  const zero = buildHtml({ scenes, topics, title: 'M', labels: { auto: 'a', hint: 'h' }, svgOf: () => '', review: { confirmed: 0, total: 3, ids: new Set() } });
  assert.ok(zero.includes('未確認 0 件'));
});
