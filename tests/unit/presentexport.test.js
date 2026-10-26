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
  const mdTexts = md.split('\n').filter((l) => /^(## |- )/.test(l)).map((l) => l.replace(/^(## |- )/, ''));
  const outline = app.renderOutline();
  const olTexts = [...outline.matchAll(/<h3>([^<]*)<\/h3>|<li data-point-id="[^"]*">(?:<span[^>]*>[^<]*<\/span> )?([^<]*)<\/li>/g)].map((m) => m[1] ?? m[2]);
  assert.deepEqual(mdTexts, olTexts);
});

test('FR-090 AC-529: Markdown に API キー・トークンの実値を含めない（保存対象は会議の内容だけ）', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env); toDetail(app);
  await app.commands['save.markdown']();
  const md = String(env.downloads[0].data);
  assert.ok(!/(api[-_ ]?key|token|secret)/i.test(md));
});

test('FR-090 AC-528: buildMarkdown は大項目でトピックだけ、中項目でシーンの見出しまで、詳細で要点と関係まで出す', () => {
  const scenes = [{ id: 's1', heading: 'H1', points: [{ id: 'p1', text: '課題A' }, { id: 'p2', text: '提案B' }] }];
  const topics = [{ id: 't1', title: 'T1', sceneIds: ['s1'] }];
  const relations = [{ from: 'p1', to: 'p2', kindLabel: '課題→提案' }];
  assert.equal(buildMarkdown({ scenes, topics, relations, level: 'major' }), '# T1\n');
  assert.equal(buildMarkdown({ scenes, topics, relations, level: 'middle' }), '# T1\n\n## H1\n');
  assert.equal(buildMarkdown({ scenes, topics, relations, level: 'detail' }), '# T1\n\n## H1\n\n- 課題A\n  - 課題→提案 → 提案B\n- 提案B\n');
});

// FR-090 AC-531: 会議の文字列は文字としてだけ入る・外部参照なし
test('FR-090 AC-531: buildHtml は会議の文字列をエスケープし、外部の URL を参照しない', () => {
  const evil = '<script>alert(1)</script><img src=x onerror="y">"&';
  const html = buildHtml({ scenes: [{ id: 's"1', heading: evil, points: [{ id: 'p', text: evil }] }], title: evil, svgOf: () => '<svg></svg>' });
  assert.equal((html.match(/<script>/g) ?? []).length, 1, '実行されるスクリプトは同梱の 1 つだけ');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('data-scene-id="s&quot;1"'));
  assert.ok(!/(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html));
  assert.ok(!/url\(|@import|@font-face/i.test(html));
});

test('FR-090 AC-530: 自動送りの滞在は PARAM-004 の 8 秒', () => {
  const html = buildHtml({ scenes: [{ id: 's1', heading: 'h', points: [] }], svgOf: () => '' });
  assert.ok(html.includes('D=8*1000'));
});
