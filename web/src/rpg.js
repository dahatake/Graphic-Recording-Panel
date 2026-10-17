// FR-047・FR-048: RPG風の描画スタイルのアプリ組立（getRpgMap・勇者の移動）。後続の項目（会話・BGM・SE・操作）は、この module の api に足す。
import { buildRpgMap, stepHero, isWalkable, RPG_STYLE_ID } from './rpgmap.js';
import { classifyPoint } from './diagram.js';

export function rpgModule(ctx) {
  ctx.i18n.addStrings({
    ja: { 'rpg.mapLabel': 'RPG風の地図（街・城はトピック、地点は要点、道は関係線）', 'rpg.focus': '地図を操作' },
    en: { 'rpg.mapLabel': 'RPG-style map (towns and castles are topics, spots are points, roads are relations)', 'rpg.focus': 'Control the map' },
  });
  let focus = false; // 地図へのフォーカスの有無（表示だけの状態。保存しない）
  let hero = null; // 勇者の位置・向き・歩行の絵（地図が変わって通れなくなったら始点へ戻す）
  const isRpg = () => ctx.api.getDrawStyle?.() === RPG_STYLE_ID;
  const sizeOf = (svg) => { const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg ?? ''); return m ? { w: +m[1], h: +m[2] } : { w: 0, h: 0 }; };

  ctx.api.getRpgMap = () => {
    if (!isRpg()) return null;
    const scenes = ctx.state.scenes.map((s) => ({ id: s.id, heading: s.heading, status: s.status, points: s.points.map((p) => ({ id: p.id, text: p.text })), relations: (s.relations ?? []).map((r) => ({ from: r.from, to: r.to })) }));
    const map = buildRpgMap(scenes, { size: sizeOf(ctx.api.renderBaseSvg?.()), kindOf: classifyPoint });
    const ok = hero && isWalkable(map, hero.x, hero.y) && !map.residents.some((r) => r.x === hero.x && r.y === hero.y);
    if (ok) map.hero = { ...hero }; else hero = { ...map.hero };
    return map;
  };
  ctx.api.getRpgFocus = () => focus;
  ctx.api.setRpgFocus = (on) => { focus = on === true; return { ok: true, focus }; };
  // 十字キー（up/down/left/right）で勇者を 1 マス動かす。ほかのボタンは後続の項目が足す（rpgButtons）。
  const buttons = new Map();
  ctx.api.registerRpgButton = (name, fn) => { buttons.set(name, fn); };
  ctx.api.rpgPress = (button) => {
    const map = ctx.api.getRpgMap();
    if (!map) return { ok: false, reason: 'not_rpg' };
    if (['up', 'down', 'left', 'right'].includes(button)) {
      const r = stepHero(map, hero, button);
      hero = r.hero;
      ctx.change(() => {});
      return { ok: true, moved: r.moved };
    }
    const fn = buttons.get(button);
    return fn ? fn(map) : { ok: false, reason: 'unknown_button' };
  };

  // ---- FR-050: ファミコン風の操作（キー・仮想パッド・コマンドウィンドウ） ----
  ctx.i18n.addStrings({
    ja: { 'rpg.pad.label': '仮想パッド（十字キーと A・B ボタン）', 'rpg.pad.up': '上', 'rpg.pad.down': '下', 'rpg.pad.left': '左', 'rpg.pad.right': '右', 'rpg.pad.a': 'A', 'rpg.pad.b': 'B', 'rpg.dialog.label': '会話ウィンドウ', 'rpg.dialog.hint': 'A: 次へ　B: 閉じる' },
    en: { 'rpg.pad.label': 'Virtual pad (D-pad and A / B buttons)', 'rpg.pad.up': 'Up', 'rpg.pad.down': 'Down', 'rpg.pad.left': 'Left', 'rpg.pad.right': 'Right', 'rpg.pad.a': 'A', 'rpg.pad.b': 'B', 'rpg.dialog.label': 'Dialog window', 'rpg.dialog.hint': 'A: next  B: close' },
  });
  const CHAR_MS = 50; // PARAM-030（1 文字あたりの ms）
  const PAD_SIZE = 48; // PARAM-032（44 px 以上）
  const PAD_IDS = ['up', 'down', 'left', 'right', 'a', 'b'];
  ctx.api.getRpgPad = () => ({ buttons: PAD_IDS.map((id) => ({ id, label: ctx.t(`rpg.pad.${id}`), width: PAD_SIZE, height: PAD_SIZE })) });

  const sched = ctx.options.scheduler ?? { setTimeout: (f, ms) => globalThis.setTimeout(f, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  let dlg = null; // { sentences, index, shown }
  let timer = null;
  const stopTimer = () => { if (timer != null) { sched.clearTimeout(timer); timer = null; } };
  const notify = () => ctx.emit('change', ctx.api);
  const chars = (s) => [...s];
  function tick() {
    timer = null;
    if (!dlg) return;
    const cs = chars(dlg.sentences[dlg.index]);
    const n = chars(dlg.shown).length;
    if (n >= cs.length) return;
    dlg.shown = cs.slice(0, n + 1).join('');
    notify();
    if (n + 1 < cs.length) timer = sched.setTimeout(tick, CHAR_MS);
  }
  function startTyping() {
    stopTimer();
    if (ctx.env.reducedMotion) { dlg.shown = dlg.sentences[dlg.index]; return; } // AC-294: 動きを減らす設定では即時に全文
    dlg.shown = '';
    if (dlg.sentences[dlg.index].length) timer = sched.setTimeout(tick, CHAR_MS);
  }
  const close = () => { stopTimer(); dlg = null; };
  const sentencesFor = (refId) => {
    const sc = ctx.state.scenes.find((s) => s.id === refId);
    if (sc) return [sc.heading, ...sc.points.map((p) => p.text)];
    for (const s of ctx.state.scenes) { const p = s.points.find((q) => q.id === refId); if (p) return [p.text]; }
    return null;
  };
  ctx.api.getRpgDialog = () => (dlg && isRpg() ? { open: true, theme: { bg: '#000000', frame: '#ffffff' }, sentences: [...dlg.sentences], index: dlg.index, shown: dlg.shown } : null);
  ctx.on('change', () => { if (dlg && !isRpg()) close(); });

  registerA();
  function registerA() {
    ctx.api.registerRpgButton('a', (map) => {
      if (dlg) {
        if (chars(dlg.shown).length < chars(dlg.sentences[dlg.index]).length) { stopTimer(); dlg.shown = dlg.sentences[dlg.index]; } // AC-293: 残りを全文表示
        else if (dlg.index < dlg.sentences.length - 1) { dlg.index += 1; startTyping(); }
        else close();
        notify();
        return { ok: true };
      }
      const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[map.hero.dir] ?? [0, 0];
      const res = map.residents.find((r) => r.x === map.hero.x + dx && r.y === map.hero.y + dy);
      const sentences = res ? sentencesFor(res.refId) : null;
      if (!sentences || !sentences.length) return { ok: true, opened: false };
      dlg = { sentences, index: 0, shown: '' };
      startTyping();
      ctx.api.playRpgSe?.('talk');
      notify();
      return { ok: true, opened: true };
    });
    ctx.api.registerRpgButton('b', () => { const was = !!dlg; close(); if (was) notify(); return { ok: true }; });
  }
  // 会話中の十字キーは動かさない
  const move = ctx.api.rpgPress;
  ctx.api.rpgPress = (button) => (dlg && ['up', 'down', 'left', 'right'].includes(button) && isRpg() ? { ok: true, moved: false } : move(button));

  // キー: 地図にフォーカスがあり、入力欄・ダイアログ・ポップアップがないときだけ奪う
  const KEYS = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', z: 'a', enter: 'a', x: 'b', escape: 'b' };
  const baseKey = ctx.api.handleKey;
  ctx.api.handleKey = (ev) => {
    const b = KEYS[String(ev?.key ?? '').toLowerCase()];
    const blocked = ev?.inTextInput === true ||     ev?.ctrlKey || ev?.altKey      || ctx.api.getSettingsDialog?.() || ctx.api.getDialog?.() || ctx.api.getScenePopup?.();
    if (b && focus && isRpg() && !blocked) { ctx.api.rpgPress(b); return `rpg.${b}`; }
    return baseKey(ev);
  };
}
