// FR-111 AC-632〜634 の単体・結合テスト（映画的な演出。PARAM-149・PARAM-137）。契約: tests/system/CONTRACT-P2.md §6。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, keyFor } from '../system/helpers.js';
import { LEVEL_SPECS, DEFAULT_LEVEL, MIN_FONT_PX, safeZoom, parseLevel } from '../../web/src/cinematic.js';

const fakeAudio = () => { const log = []; const f = () => ({ currentTime: 0, destination: {}, createGain: () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, value: 0 }, connect() {} }), createOscillator: () => ({ frequency: {}, connect() {}, start() { log.push('start'); }, stop() {} }) }); return Object.assign(f, { log }); };

// FR-111 AC-632: 強さごとの上限・倍率、既定は控えめ、端末ごとに保存
test('FR-111 AC-632: 既定は控えめ（300 ms・1.1 倍）。なし・標準の値は PARAM-149 どおり', async () => {
  const { app } = await newApp();
  assert.equal(DEFAULT_LEVEL, 'subtle');
  assert.deepEqual(app.getCinematic(), { ...app.getCinematic(), level: 'subtle', maxMs: 300, maxZoom: 1.1, presentationOnly: true });
  assert.deepEqual(LEVEL_SPECS.standard, { maxMs: 600, maxZoom: 1.25 });
  assert.deepEqual(LEVEL_SPECS.none, { maxMs: 0, maxZoom: 1 });
  assert.equal(app.setCinematicLevel('standard').ok, true);
  assert.equal(app.getCinematic().maxMs, 600);
  assert.equal(app.setCinematicLevel('x').ok, false);
});

test('FR-111 AC-632: 強さは端末ごとの設定として保存され、再起動後も残る（保存物には入らない）', async () => {
  const r = await newApp();
  r.app.setCinematicLevel('none');
  const again = await r.createApp(r.env.options);
  assert.equal(again.getCinematic().level, 'none');
  assert.equal(parseLevel({ level: 'bad' }), 'subtle');
});

test('FR-111 AC-632: キー（cinematic.next）で なし→控えめ→標準 と巡回し、状態メッセージで示す', async () => {
  const { app } = await newApp();
  const seen = [app.getCinematic().level];
  for (let i = 0; i < 3; i++) { assert.equal(app.handleKey(keyFor(app, 'cinematic.next')), 'cinematic.next'); seen.push(app.getCinematic().level); assert.ok(app.getState().message.text.includes(app.getCinematicOptions().find((o) => o.current).label)); }
  assert.deepEqual(seen, ['subtle', 'standard', 'none', 'subtle']);
});

test('FR-111 AC-632: シーンの確定・トピックの切り替えの演出は、プレゼンテーション中だけ起き、上限以内', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  assert.deepEqual(app.getCinematicEvents(), [], '通常の表示では演出なし');
  assert.equal(app.getCinematicCamera(), null);
  app.commands['presentation.start']();
  app.commands['presentation.next']();
  const ev = app.getCinematicEvents();
  assert.ok(ev.length >= 2);
  for (const e of ev) { assert.ok(['zoom', 'fade'].includes(e.type)); assert.ok(e.ms <= 300 && e.zoom <= 1.1 && e.zoom >= 1); }
  assert.ok(app.getCinematicCamera().zoom <= 1.1);
  app.commands['presentation.stop']();
  assert.equal(app.getCinematicCamera(), null);
});

test('FR-111 AC-632: 「なし」は動きなし（イベントもカメラもない）', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.setCinematicLevel('none');
  app.commands['presentation.start'](); app.commands['presentation.next']();
  assert.deepEqual(app.getCinematicEvents(), []);
  assert.equal(app.getCinematicCamera(), null);
});

// FR-111 AC-633: reduced motion・ミュート・Esc
test('FR-111 AC-633: reduced motion では動きを止め、切り替わりを状態メッセージ（文字）で示す', async () => {
  const { app, env } = await newApp({ options: { env: { webgl: true, reducedMotion: true, viewportWidth: 1280 } } });
  await seedThreeScenes(app, env);
  app.commands['presentation.start']();
  assert.deepEqual(app.getCinematicEvents(), []);
  assert.equal(app.getCinematicCamera(), null);
  assert.equal(app.getState().message.key, 'msg.cinematicInstant');
  assert.ok(app.getState().message.text.length > 0);
});

test('FR-111 AC-633: ミュート（FR-049 と同じ設定）のときは演出の音を鳴らさない。ミュートでなければ鳴る', async () => {
  const audio = fakeAudio();
  const { app, env } = await newApp({ options: { audioFactory: audio } });
  await seedThreeScenes(app, env);
  app.setRpgMuted(true);
  app.commands['presentation.start'](); app.commands['presentation.next']();
  assert.equal(audio.log.length, 0);
  assert.equal(app.getCinematicState().soundCount, 0);
  assert.ok(app.getCinematicEvents().length > 0, '動きは続く（音だけ止まる）');
  app.commands['presentation.stop']();
  app.setRpgMuted(false);
  app.commands['presentation.start']();
  assert.ok(app.getCinematicState().soundCount >= 1);
});

test('FR-111 AC-633: 演出の中は Esc で中断できる', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  app.commands['presentation.start']();
  assert.ok(app.getCinematicState().running);
  assert.equal(app.handleKey({ key: 'Escape' }), 'cinematic.abort');
  assert.equal(app.getCinematicCamera(), null);
  assert.equal(app.getState().message.key, 'msg.cinematicAborted');
  assert.notEqual(app.handleKey({ key: 'Escape' }), 'cinematic.abort', '演出の外では何もしない');
});

// FR-111 AC-634: 文字の最小サイズ・内容を変えない・収束
test('FR-111 AC-634: 引きは最小文字サイズ（24 px・1920 px 換算）を下回る手前で止まる。寄りは上限まで', () => {
  assert.equal(MIN_FONT_PX, 24);
  assert.equal(safeZoom(0.5, 'standard', 48), 0.5);
  assert.equal(safeZoom(0.5, 'standard', 30), 0.8);
  assert.ok(30 * safeZoom(0.1, 'standard', 30) >= 24);
  assert.equal(safeZoom(2, 'subtle'), 1.1);
  assert.equal(safeZoom(2, 'standard'), 1.25);
});

test('FR-111 AC-634: 演出は図の内容・保存物・テキスト一覧を変えず、続けて切り替えても最後の状態に収束する', async () => {
  const { app, env } = await newApp();
  await seedThreeScenes(app, env);
  const before = JSON.stringify([app.renderSvg(), app.getState().scenes]);
  app.commands['presentation.start'](); app.commands['presentation.next'](); app.commands['presentation.next']();
  assert.equal(app.getCinematicCamera().sceneId, app.getState().scenes[2].id, '途中で次のシーンが確定しても最後のシーンへ収束');
  app.commands['presentation.stop']();
  assert.equal(JSON.stringify([app.renderSvg(), app.getState().scenes]), before);
});
