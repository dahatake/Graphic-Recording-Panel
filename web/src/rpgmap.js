// FR-047 RPG風の描画スタイル: ドット絵の俯瞰マップ（トピック=街・城、要点=地点、関係線=道）。DOM に依存せず、同じ入力からは毎回同じ結果（決定的）。
// 契約: tests/system/CONTRACT.md「RPG風の描画スタイル」（getRpgMap の形）。後続の項目（会話・音・操作）は、ここの map の形を変えずに足す。
import { TILE, RPG_PALETTE, colorOf, spriteSvg, spritePaths, markPaths } from './rpgsprites.js';

export { TILE, RPG_PALETTE };
export const RPG_STYLE_ID = 'rpg';
export const BLOCKED_TYPES = ['wall', 'water', 'building']; // 通れないマス（AC-223 の定義）
export const DIR_VEC = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const INK = RPG_PALETTE[0];
const PAPER = RPG_PALETTE[1];
const BLOCK_W = 5; const BLOCK_H = 4; const TOP = 2; const MIN_COLS = 20; const MIN_ROWS = 14; const REGION_W = 7;

// 街・城の 5x4 のかたまり。ゲートは下辺の中央。
function stamp(cells, cols, bx, by, kind) {
  const set = (x, y, type, area) => { const c = cells[y * cols + x]; c.type = type; c.area = area; };
  const area = kind === 'castle' ? 'castle' : 'town';
  for (let y = 0; y < BLOCK_H; y++) {
    for (let x = 0; x < BLOCK_W; x++) {
      const gx = bx + x; const gy = by + y;
      const gate = x === 2 && y === BLOCK_H - 1;
      if (kind === 'castle') set(gx, gy, !gate && (x === 0 || x === BLOCK_W - 1 || y === 0 || y === BLOCK_H - 1) ? 'wall' : 'floor', area);
      else set(gx, gy, y === 0 && x !== 2 ? 'building' : 'floor', area);
    }
  }
}

// 地図を作る。scenes: [{id,heading,status,points:[{id,text}],relations:[{from,to}]}]、size: 図の幅・高さ（px）、kindOf: 要点の種類を返す関数。
export function buildRpgMap(scenes = [], { size = { w: 0, h: 0 }, kindOf = () => 'note' } = {}) {
  const n = scenes.length;
  const maxPts = Math.max(0, ...scenes.map((s) => s.points.length));
  const region = Math.max(REGION_W, n ? Math.floor((Math.ceil((size.w || 0) / TILE) - 2) / n) : REGION_W);
  const cols = Math.max(MIN_COLS, 2 + n * region);
  const spotTop = TOP + BLOCK_H + 3;
  const rows = Math.max(MIN_ROWS, Math.ceil((size.h || 0) / TILE), spotTop + Math.max(0, maxPts - 1) * 2 + 3);
  const cells = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) cells.push({ x, y, type: x === 0 || y === 0 || x === cols - 1 || y === rows - 1 ? 'water' : 'floor', area: 'field' });
  const at = (x, y) => (x >= 0 && y >= 0 && x < cols && y < rows ? cells[y * cols + x] : null);
  const road = (x, y) => { const c = at(x, y); if (c && c.type === 'floor' && c.area === 'field') c.type = 'road'; };
  const hline = (y, a, b) => { for (let x = Math.min(a, b); x <= Math.max(a, b); x++) road(x, y); };
  const vline = (x, a, b) => { for (let y = Math.min(a, b); y <= Math.max(a, b); y++) road(x, y); };

  const places = []; const roads = []; const residents = [];
  const spotPos = new Map(); const gates = [];
  scenes.forEach((s, i) => {
    const kind = s.status === 'confirmed' ? 'castle' : 'town';
    const bx = 1 + i * region + Math.floor((region - BLOCK_W) / 2);
    stamp(cells, cols, bx, TOP, kind);
    const gx = bx + 2; const gy = TOP + BLOCK_H - 1;
    gates.push({ x: gx, y: gy, id: `town:${s.id}` });
    places.push({ id: `town:${s.id}`, kind, refId: s.id, x: gx, y: gy, label: s.heading });
    // 住人（ゲートの正面の列は空けて、勇者が通れるようにする）
    const spots = kind === 'castle' ? [[bx + 1, TOP + 1, 'soldier'], [bx + 3, TOP + 1, 'soldier'], [bx + 1, TOP + 2, 'soldier']] : [[bx + 1, TOP + 2, 'villager'], [bx + 3, TOP + 1, 'villager']];
    const count = Math.min(spots.length, Math.max(1, kind === 'castle' ? 2 : 1 + Math.min(1, s.points.length)));
    spots.slice(0, count).forEach(([x, y, k], j) => residents.push({ id: `res:${s.id}:${j}`, kind: k, x, y, refId: s.points[j]?.id ?? s.id }));
    s.points.forEach((p, k) => {
      const sx = gx + (k % 2 === 0 ? -2 : 2); const sy = spotTop + k * 2;
      spotPos.set(p.id, { x: sx, y: sy });
      places.push({ id: `spot:${p.id}`, kind: 'spot', refId: p.id, x: sx, y: sy, mark: kindOf(p.text), label: p.text });
      vline(gx, gy + 1, sy); hline(sy, gx, sx);
      roads.push({ from: `town:${s.id}`, to: `spot:${p.id}` });
    });
    for (const r of s.relations ?? []) {
      const a = spotPos.get(r.from); const b = spotPos.get(r.to);
      if (!a || !b) continue;
      vline(a.x, a.y, b.y); hline(b.y, a.x, b.x);
      roads.push({ from: `spot:${r.from}`, to: `spot:${r.to}` });
    }
  });
  for (let i = 0; i + 1 < gates.length; i++) { hline(gates[i].y + 1, gates[i].x, gates[i + 1].x); roads.push({ from: gates[i].id, to: gates[i + 1].id }); }
  for (const g of gates) road(g.x, g.y + 1);
  const start = gates[0] ? { x: gates[0].x, y: gates[0].y + 1 } : { x: Math.floor(cols / 2), y: Math.floor(rows / 2) };
  return {
    tile: TILE, colors: [...RPG_PALETTE], cols, rows, cells, places, roads,
    hero: { x: start.x, y: start.y, dir: 'down', frame: 0 }, residents,
  };
}

export const cellAt = (map, x, y) => (x >= 0 && y >= 0 && x < map.cols && y < map.rows ? map.cells[y * map.cols + x] : null);
export const isWalkable = (map, x, y) => { const c = cellAt(map, x, y); return !!c && !BLOCKED_TYPES.includes(c.type); };

// 勇者を 1 マス動かす。向きは必ず変わり、通れるマス（住人のいないマス）なら進んで歩行の絵が切り替わる。
export function stepHero(map, hero, dir) {
  const v = DIR_VEC[dir];
  if (!v) return { hero, moved: false };
  const nx = hero.x + v[0]; const ny = hero.y + v[1];
  const blocked = !isWalkable(map, nx, ny) || map.residents.some((r) => r.x === nx && r.y === ny);
  if (blocked) return { hero: { ...hero, dir }, moved: false };
  return { hero: { x: nx, y: ny, dir, frame: (hero.frame + 1) % 2 }, moved: true };
}

// ---- 描画（四角の集合 → SVG／Canvas） ----
// 地形・目印の四角を色ごとにまとめる。ops: Map<色, [x,y,w,h][]>（ドット座標）
export function mapOps(map) {
  const ops = new Map();
  const add = (color, x, y, w, h) => { if (!ops.has(color)) ops.set(color, []); ops.get(color).push([x, y, w, h]); };
  const C = { grass: colorOf('2'), grass2: colorOf('3'), sand: colorOf('4'), water: colorOf('5'), wood: colorOf('6'), roof: colorOf('7'), stone: colorOf('8'), dark: colorOf('9'), white: colorOf('d'), ink: INK };
  for (const c of map.cells) {
    const px = c.x * TILE; const py = c.y * TILE;
    const h = (c.x * 7 + c.y * 13) % 5;
    if (c.type === 'water') { add(C.water, px, py, TILE, TILE); add(C.white, px + 3 + h, py + 5, 4, 1); add(C.white, px + 9 - h, py + 11, 4, 1); }
    else if (c.type === 'wall') { add(C.dark, px, py, TILE, TILE); add(C.stone, px, py + 7, TILE, 1); add(C.stone, px + 7, py, 1, 7); add(C.stone, px + 3, py + 8, 1, 8); }
    else if (c.type === 'building') { add(C.wood, px, py, TILE, TILE); add(C.roof, px, py, TILE, 7); add(C.ink, px, py + 7, TILE, 1); add(C.white, px + 3, py + 10, 3, 3); add(C.white, px + 10, py + 10, 3, 3); }
    else if (c.type === 'road') { add(C.sand, px, py, TILE, TILE); add(C.wood, px + 2 + h, py + 4, 2, 1); add(C.wood, px + 10 - h, py + 11, 2, 1); }
    else if (c.area === 'castle') { add(C.stone, px, py, TILE, TILE); add(C.dark, px, py + 15, TILE, 1); }
    else if (c.area === 'town') { add(C.sand, px, py, TILE, TILE); add(C.wood, px, py + 15, TILE, 1); }
    else { add(C.grass, px, py, TILE, TILE); add(C.grass2, px + 2 + h, py + 3, 1, 2); add(C.grass2, px + 9 - h, py + 10, 1, 2); add(C.grass2, px + 10, py + 10, 1, 1); }
  }
  for (const p of map.places) {
    const px = p.x * TILE; const py = p.y * TILE;
    if (p.kind === 'spot') { for (const m of markPaths(p.mark, px, py)) for (const r of rectsOfPath(m.d)) add(m.color, ...r); }
    else { add(C.ink, px + 4, py + 4, 8, 12); add(C.wood, px + 5, py + 5, 6, 11); add(p.kind === 'castle' ? C.roof : C.white, px + 7, py + 8, 2, 2); } // 街・城の門
  }
  return ops;
}
export function rectsOfPath(d) {
  const out = [];
  for (const m of String(d).matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-\d+z/g)) out.push([+m[1], +m[2], +m[3], +m[4]]);
  return out;
}
const pathOfRects = (rs) => rs.map(([x, y, w, h]) => `M${x} ${y}h${w}v${h}h-${w}z`).join('');
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const textW = (s, fs) => { let w = 0; for (const ch of unesc(s)) w += ch.codePointAt(0) >= 0x2e80 ? fs : fs * 0.56; return w; };

// 図の SVG（baseSvg: 従来のスタイルで作った SVG）を RPG風の地図に置き換える。文字は 1 つも変えず、判読できる下地に載せて地図の上に置く。
export function renderRpgSvg(baseSvg, map) {
  const root = baseSvg.match(/<svg\b[^>]*>/)?.[0] ?? '<svg xmlns="http://www.w3.org/2000/svg">';
  const W = map.cols * TILE; const H = map.rows * TILE;
  let open = root.replace(/\s(viewBox|width|height)="[^"]*"/g, '');
  open = open.replace(/>$/, ` viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-rpg-tile="${TILE}" shape-rendering="crispEdges">`);
  const title = baseSvg.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '';
  const terrain = [...mapOps(map).entries()].map(([color, rs]) => `<path d="${pathOfRects(rs)}" fill="${color}"/>`).join('');
  const places = map.places.map((p) => `<g data-rpg-place data-kind="${p.kind}"${p.mark ? ` data-mark="${p.mark}"` : ''} data-ref-id="${String(p.refId).replace(/"/g, '&quot;')}" data-x="${p.x}" data-y="${p.y}"></g>`).join('');
  const residents = map.residents.map((r) => `<g data-rpg-resident data-kind="${r.kind}" data-x="${r.x}" data-y="${r.y}">${spriteSvg(r.kind, 'down', 0, r.x, r.y)}</g>`).join('');
  const h = map.hero;
  const hero = `<g data-rpg-hero data-dir="${h.dir}" data-frame="${h.frame}" data-x="${h.x}" data-y="${h.y}">${spriteSvg('hero', h.dir, h.frame, h.x, h.y)}</g>`;
  const labels = [...baseSvg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].map((m) => {
    const a = m[1];
    const x = parseFloat(/\sx="([^"]*)"/.exec(a)?.[1] ?? '0'); const y = parseFloat(/\sy="([^"]*)"/.exec(a)?.[1] ?? '0');
    const fs = parseFloat(/font-size="([^"]*)"/.exec(a)?.[1] ?? '14'); const w = textW(m[2], fs);
    const x0 = /text-anchor="end"/.test(a) ? x - w : /text-anchor="middle"/.test(a) ? x - w / 2 : x;
    const attrs = a.replace(/\sfill="[^"]*"/g, '');
    return `<rect x="${Math.round((x0 - 2) * 10) / 10}" y="${Math.round((y - fs) * 10) / 10}" width="${Math.ceil(w + 4)}" height="${Math.ceil(fs + 5)}" fill="${PAPER}" fill-opacity="0.9" stroke="${INK}" stroke-width="1"/><text${attrs} fill="${INK}">${m[2]}</text>`;
  }).join('');
  return `${open}${title}<g data-role="rpg-map" aria-hidden="true">${terrain}${places}${residents}${hero}</g><g data-role="rpg-labels">${labels}</g></svg>`;
}

// PNG 用: Canvas 2D に地図を描く（g は fillRect・fillText を持つ）。ラベルは街・城・地点の名前。
export function paintRpgCanvas(g, map) {
  for (const [color, rs] of mapOps(map)) { g.fillStyle = color; for (const [x, y, w, h] of rs) g.fillRect(x, y, w, h); }
  const sprite = (kind, dir, frame, cx, cy) => { for (const p of spritePaths(kind, dir, frame, cx * TILE, cy * TILE)) { g.fillStyle = p.color; for (const [x, y, w, h] of rectsOfPath(p.d)) g.fillRect(x, y, w, h); } };
  for (const r of map.residents) sprite(r.kind, 'down', 0, r.x, r.y);
  sprite('hero', map.hero.dir, map.hero.frame, map.hero.x, map.hero.y);
  g.textBaseline = 'alphabetic';
  for (const p of map.places) {
    const fs = p.kind === 'spot' ? 12 : 14;
    g.font = `700 ${fs}px system-ui, 'Hiragino Sans', 'Yu Gothic UI', Meiryo, sans-serif`;
    const w = g.measureText ? g.measureText(p.label ?? '').width : 0;
    const x = p.x * TILE + TILE + 2; const y = p.y * TILE + 12;
    g.fillStyle = PAPER; g.fillRect(x - 2, y - fs, (w || 0) + 4, fs + 4);
    g.fillStyle = INK; g.fillText(p.label ?? '', x, y);
  }
}
