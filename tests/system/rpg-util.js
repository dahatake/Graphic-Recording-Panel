// RPG風（FR-047〜051）System Test の共通部品。契約: tests/system/CONTRACT.md「RPG風の描画スタイル」。
// 期待値は受入基準だけから決める。通れないマスは AC-223 の定義（壁・水・建物の外壁・範囲外）に従う。
import { newApp, seedThreeScenes, toDetail } from './helpers.js';

export const BLOCKED_TYPES = ['wall', 'water', 'building'];
export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export async function rpgApp(over) {
  const ctx = await newApp(over);
  await seedThreeScenes(ctx.app, ctx.env);
  toDetail(ctx.app);
  const r = ctx.app.setDrawStyle('rpg');
  if (!r || r.ok !== true) throw new Error('描画スタイル rpg を選べない');
  ctx.app.setRpgFocus(true);
  return ctx;
}

export const cellAt = (map, x, y) => map.cells.find((c) => c.x === x && c.y === y) || null;
export const isWalkableType = (c) => !!c && !BLOCKED_TYPES.includes(c.type);

// 通れるマスだけをたどり、目標を満たすマスまでの十字キー列を求める（住人のマスは通れないものとして避ける）。
export function findPath(map, goal) {
  const occ = new Set(map.residents.map((r) => `${r.x},${r.y}`));
  const start = map.hero;
  const seen = new Set([`${start.x},${start.y}`]);
  const q = [{ x: start.x, y: start.y, path: [] }];
  while (q.length) {
    const cur = q.shift();
    if (goal(cur.x, cur.y, cellAt(map, cur.x, cur.y))) return cur.path;
    for (const [d, [dx, dy]] of Object.entries(DIRS)) {
      const nx = cur.x + dx, ny = cur.y + dy, k = `${nx},${ny}`;
      if (seen.has(k) || occ.has(k)) continue;
      if (!isWalkableType(cellAt(map, nx, ny))) continue;
      seen.add(k);
      q.push({ x: nx, y: ny, path: [...cur.path, d] });
    }
  }
  return null;
}

export function walk(app, path, press = (b) => app.rpgPress(b)) {
  for (const d of path) {
    const before = app.getRpgMap().hero;
    press(d);
    const after = app.getRpgMap().hero;
    if (after.x === before.x && after.y === before.y) throw new Error(`勇者が ${d} へ進めない`);
  }
}

export const plain = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
export const svgTexts = (svg) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).sort();
export const snap = (app) => { const s = app.getState(); return JSON.stringify([s.utterances.map((u) => u.text), s.scenes, s.selectedSceneId, s.session, s.input.draft, app.getDetailLevel(), s.viewMode, app.getDisplayMode()]); };
