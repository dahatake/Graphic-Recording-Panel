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
}
