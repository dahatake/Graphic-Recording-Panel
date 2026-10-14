// FR-018 / FR-019 / NFR-UX-003 の単体・結合テスト（System Test は tests/system/reset.test.js, sessionfile.test.js, cmdlabel.test.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newApp, seedThreeScenes } from '../system/helpers.js';
import { parseSessionFile, FORMAT, VERSION, MAX_FILE_BYTES } from '../../web/src/session.js';

const good = (over = {}) => ({
  name: 's.json', type: 'application/json',
  text: JSON.stringify({ format: FORMAT, version: VERSION, utterances: [], scenes: [], selectedSceneId: null, seq: 0, ...over }),
});
const withSize = (f) => ({ ...f, size: f.text.length });

// FR-019 AC-101
test('FR-019 AC-101: セッションファイルでない・壊れた・未対応の版・上限超過のファイルは理由つきで拒否される', () => {
  assert.equal(parseSessionFile(withSize({ name: 'a.txt', type: 'text/plain', text: '行' })).reason, 'not_session');
  assert.equal(parseSessionFile(withSize({ name: 'a.json', type: 'application/json', text: '{ざ' })).reason, 'not_json');
  assert.equal(parseSessionFile(withSize({ name: 'a.json', text: '{"x":1}' })).reason, 'not_session');
  assert.equal(parseSessionFile(withSize(good({ version: 99 }))).reason, 'bad_version');
  assert.equal(parseSessionFile(withSize(good({ scenes: 'x' }))).reason, 'broken');
  assert.equal(parseSessionFile({ ...good(), size: MAX_FILE_BYTES + 1 }).reason, 'too_large');
  assert.ok(parseSessionFile(withSize(good())).session);
});

test('FR-019 AC-101 異常系: 読込に失敗しても現在のデータ・セッションの状態は変わらず、その後も操作できる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const before = JSON.stringify(app.getState().scenes);
  for (const text of ['{ざ', '{"format":"other"}', JSON.stringify({ format: FORMAT, version: 9 })]) {
    const r = await app.loadSessionFile({ name: 'x.json', type: 'application/json', size: text.length, text });
    assert.equal(r.ok, false);
    assert.ok(app.getState().message.text.trim());
  }
  assert.equal(JSON.stringify(app.getState().scenes), before);
  assert.equal(app.getState().session, 'recording');
  app.setDraft('続けて入力'); assert.equal(app.submitDraft().ok, true);
});

// FR-018 AC-093〜096（結合）
test('FR-018 AC-094: 初期化は確認を経た場合だけ行われ、レイアウト・言語は保たれる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.setLang('en');
  assert.equal(app.getDialog(), null);
  app.commands['data.reset']();
  assert.ok(app.getDialog().buttons.find((b) => b.id === 'confirm').label === 'Reset');
  await app.dialogAction('confirm');
  assert.equal(app.getState().scenes.length, 0);
  assert.equal(app.getState().lang, 'en');
});

// NFR-UX-003 AC-092
test('NFR-UX-003 AC-092: 幅 600px でも全ボタンのラベルが残り、横スクロールなしで全ボタンへ到達できる。ラベルは CSS で隠さない', async () => {
  const { app } = await newApp();
  const n = app.getCommandBar().items.length;
  for (const viewportWidth of [600, 1280]) {
    const lay = app.getCommandBarLayout({ viewportWidth });
    assert.equal(lay.items.length, n);
    assert.equal(lay.scrollsHorizontally, false);
  }
  const css = fs.readFileSync(new URL('../../web/styles/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.commandbar \.toolbar-group \{ flex-wrap: wrap/);
  assert.match(css, /\.commandbar \.btn \.btn-label[^}]*position: static/);
});

// FR-019 AC-098（結合）: ファイルは音声を含まず、軸の選択を含む
test('FR-019 AC-098: セッションファイルに format・version・軸の選択が含まれる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.setAxis3D('x', 'utterances');
  await app.commands['file.save']();
  const d = JSON.parse(env.downloads.at(-1).data);
  assert.equal(d.format, FORMAT); assert.equal(d.version, VERSION); assert.equal(d.axes3d.x, 'utterances');
});
