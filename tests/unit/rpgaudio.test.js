// FR-049 AC-219 AC-220 AC-221 AC-222 AC-295 の単体・結合テスト（RPG風の BGM・効果音）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newApp, seedThreeScenes, toDetail } from '../system/helpers.js';
import { createAudioEngine, parseAudioPrefs, SONGS, SE_DEFS, RPG_AUDIO_KEY } from '../../web/src/rpgaudio.js';

function fakeCtx() {
  const log = { osc: 0, gains: [] };
  const mk = () => ({ gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} });
  return { log, ctx: { currentTime: 0, destination: {}, createGain() { const g = mk(); log.gains.push(g); return g; }, createOscillator() { log.osc++; return { frequency: {}, connect() {}, start() {}, stop() {} }; } } };
}

// FR-049 AC-219 AC-220: 3 種の BGM と 5 種の SE が合成で定義されている（外部ファイルなし）
test('FR-049 AC-219 AC-220: 曲と効果音は WebAudio の合成だけで定義される', () => {
  assert.deepEqual(Object.keys(SONGS).sort(), ['castle', 'field', 'town']);
  assert.deepEqual(Object.keys(SE_DEFS).sort(), ['cancel', 'confirm', 'cursor', 'step', 'talk']);
});

test('FR-049 AC-219 AC-295: エンジンは BGM を鳴らし、止め、再開できる。音量 0 の効果音は鳴らさない', () => {
  const { ctx, log } = fakeCtx();
  const timers = [];
  const e = createAudioEngine(() => ctx, { setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer() {} });
  e.setGain(0.5);
  e.playBgm('town');
  assert.equal(e.currentBgm(), 'town'); assert.ok(log.osc > 0);
  e.stopBgm(); assert.equal(e.currentBgm(), null);
  const n = log.osc; e.playBgm('town'); assert.ok(log.osc > n, '再開で再び鳴る');
  e.setGain(0); const m = log.osc; assert.equal(e.playSe('confirm'), false); assert.equal(log.osc, m);
});

// FR-049 AC-222: 音が使えなくても例外を出さない
test('FR-049 AC-222: AudioContext がない・壊れている端末でも例外を出さない', () => {
  for (const f of [undefined, () => null, () => { throw new Error('no audio'); }]) {
    const e = createAudioEngine(f); e.setGain(1);
    assert.doesNotThrow(() => { e.playBgm('field'); e.playSe('step'); e.stopBgm(); });
  }
});

test('FR-049 AC-221: 保存内容の検証（壊れていれば初期値 50・ミュートなし）', () => {
  assert.deepEqual(parseAudioPrefs(null), { volume: 50, muted: false });
  assert.deepEqual(parseAudioPrefs({ volume: 300, muted: 'x' }), { volume: 50, muted: false });
  assert.deepEqual(parseAudioPrefs({ volume: 20, muted: true }), { volume: 20, muted: true });
});

test('FR-049 AC-219 AC-221 AC-222 AC-295: アプリ結合（音声あり・ミュート・BGM 停止・保存と復元・音声なしでも移動できる）', async () => {
  const { log, ctx: ac } = fakeCtx();
  const c = await newApp({});
  // 音声ありのアプリを別に作る
  const env = c.env; env.options.audioFactory = () => ac;
  const app = await c.createApp(env.options);
  await seedThreeScenes(app, env); toDetail(app); app.setDrawStyle('rpg'); app.setRpgFocus(true);
  assert.equal(app.getRpgAudio().started, false); assert.equal(log.osc, 0, '操作前は鳴らない');
  assert.ok(app.rpgPress('down').ok || app.rpgPress('up').ok || app.rpgPress('left').ok || app.rpgPress('right').ok);
  const a = app.getRpgAudio();
  assert.equal(a.started, true); assert.ok(['field', 'town', 'castle'].includes(a.bgm)); assert.ok(log.osc > 0);
  // AC-295
  app.setRpgBgm(false); assert.equal(app.getRpgAudio().bgm, null); assert.equal(app.getRpgAudio().audible, true);
  app.setRpgBgm(true); assert.ok(app.getRpgAudio().bgm);
  // AC-221: 保存
  app.setRpgVolume(70); app.setRpgMuted(true);
  assert.deepEqual(JSON.parse(env.storage.getItem(RPG_AUDIO_KEY)), { volume: 70, muted: true });
  const app2 = await c.createApp(env.options);
  assert.equal(app2.getRpgAudio().volume, 70); assert.equal(app2.getRpgAudio().muted, true);
  // AC-222: 音声なしでも操作できる
  const env3 = (await newApp({})).env; env3.options.audioFactory = () => { throw new Error('x'); };
  const app3 = await c.createApp(env3.options);
  await seedThreeScenes(app3, env3); toDetail(app3); app3.setDrawStyle('rpg'); app3.setRpgFocus(true);
  const before = JSON.stringify(app3.getRpgMap().hero);
  for (const d of ['down', 'up', 'left', 'right']) app3.rpgPress(d);
  assert.ok(app3.getRpgMap().hero); assert.ok(before);
});
