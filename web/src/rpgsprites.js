// FR-048 RPGのキャラクター（ドット絵スプライト）。画像ファイルは使わず、文字の型紙からコードで生成する（外部リクエスト 0 件・決定的）。
// FR-047 の地図と同じ 15 色のパレットを共有する（PARAM-054: 1 画面 16 色以下）。DOM に依存しない。

export const TILE = 16; // PARAM-053: 1 マスの 1 辺のドット数
// パレット（独自の配色。既存の作品の素材は使わない）。添字が型紙の文字 0〜e に対応する。
export const RPG_PALETTE = [
  '#0f1020', // 0 墨（輪郭・文字）
  '#f4f0e0', // 1 紙（文字の下地）
  '#3a8f3a', // 2 草
  '#2a6b2a', // 3 濃い草
  '#d8c08a', // 4 道
  '#3a5fcd', // 5 水
  '#8a5a2b', // 6 茶（壁・髪）
  '#c0392b', // 7 赤（屋根・旗）
  '#9a9a9a', // 8 石
  '#5a5a6a', // 9 濃い石
  '#f2c9a0', // a 肌
  '#e8b830', // b 金（勇者の髪）
  '#2f4fd0', // c 勇者の服
  '#ffffff', // d 白
  '#b04a8a', // e 村人の服
];
const CH = '0123456789abcde';
export const colorOf = (ch) => RPG_PALETTE[CH.indexOf(ch)];

// 16x16 の型紙（前向き）。H=髪・かぶと S=肌 E=目 C=服 D=靴・帯 .=透明
const BODY = [
  '................',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HSSSSSSH....',
  '....HSESSESH....',
  '....HSSSSSSH....',
  '.....SSSSSS.....',
  '....CCCCCCCC....',
  '...SCCCCCCCCS...',
  '...SCCCCCCCCS...',
  '....CCCCCCCC....',
  '....CCDDDDCC....',
  '....CCC..CCC....',
  '....DD....DD....',
  '................',
  '................',
];
// 歩行の 2 コマ目: 足の 3 行を入れ替える
const WALK2 = [
  ['....CCC..CCC....', '.....CC..CCC....'],
  ['....DD....DD....', '.....DD...DD....'],
];

// 種類ごとの色の割り当て（H・S・C・D・E と、武器などの追加 W）
const KINDS = {
  hero: { H: 'b', S: 'a', C: 'c', D: '0', E: '0', W: 'd' },
  villager: { H: '6', S: 'a', C: 'e', D: '6', E: '0', W: '4' },
  soldier: { H: '9', S: 'a', C: '8', D: '9', E: '0', W: '7' },
};
export const SPRITE_KINDS = Object.keys(KINDS);
export const DIRS = ['up', 'down', 'left', 'right'];

// 向きの違い: 後ろ向きは顔を髪で隠し、横向きは目を片側に 1 つだけ置いて体を少しずらす。
function oriented(dir) {
  const rows = BODY.map((r) => r);
  if (dir === 'up') for (const i of [3, 4, 5, 6]) rows[i] = rows[i].replace(/[SE]/g, 'H');
  else if (dir === 'left') {
    rows[4] = '....HESSSSH....';
    rows[5] = '....HSSSSSH....'; // 顔を左へ寄せる
    rows[3] = '....HSSSSSH.....'.slice(0, 16);
    rows[8] = '...CCCCCCCCS....'.slice(0, 16);
    rows[9] = '...CCCCCCCCS....'.slice(0, 16);
  } else if (dir === 'right') {
    rows[4] = '....HSSSSEH.....'.slice(0, 16);
    rows[5] = '....HSSSSSH.....'.slice(0, 16);
    rows[3] = '.....HSSSSSH....'.slice(0, 16);
    rows[8] = '....SCCCCCCCC...'.slice(0, 16);
    rows[9] = '....SCCCCCCCC...'.slice(0, 16);
  }
  return rows.map((x) => x.padEnd(16, '.').slice(0, 16));
}

// 武器・持ち物（種類ごとの識別: 勇者=剣、兵士=槍、村人=なし）
function withProp(rows, kind, dir) {
  const r = rows.map((x) => x.split(''));
  const put = (x, y, c) => { if (y >= 0 && y < 16 && x >= 0 && x < 16) r[y][x] = c; };
  if (kind === 'hero' && dir !== 'up') { put(13, 7, 'W'); put(13, 8, 'W'); put(13, 9, 'W'); put(13, 10, 'D'); }
  if (kind === 'soldier') { for (let y = 3; y <= 12; y++) put(dir === 'left' ? 3 : 12, y, 'W'); }
  return r.map((x) => x.join(''));
}

// 型紙（16 行 x 16 文字）。同じ引数なら必ず同じ。frame は 0 か 1（歩行の絵）。
export function spriteRows(kind, dir, frame = 0) {
  if (!KINDS[kind] || !DIRS.includes(dir)) return null;
  let rows = oriented(dir);
  if ((frame | 0) % 2 === 1) rows = rows.map((r) => { const i = WALK2[0].indexOf(r); if (i >= 0) return WALK2[0][1]; const j = WALK2[1].indexOf(r); return j >= 0 ? WALK2[1][1] : r; });
  rows = withProp(rows, kind, dir);
  const map = KINDS[kind];
  return rows.map((r) => [...r].map((c) => (c === '.' ? '.' : (map[c] ?? c))).join(''));
}

// 色ごとの SVG パス（1 ドット = 1x1 の四角。同じ行の連続は 1 本にまとめる）。(ox, oy) は左上のドット座標。
export function spritePaths(kind, dir, frame = 0, ox = 0, oy = 0) {
  const rows = spriteRows(kind, dir, frame);
  if (!rows) return [];
  const byColor = new Map();
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      if (c === '.') { x++; continue; }
      let n = 1; while (x + n < row.length && row[x + n] === c) n++;
      const col = colorOf(c);
      if (!byColor.has(col)) byColor.set(col, []);
      byColor.get(col).push(`M${ox + x} ${oy + y}h${n}v1h-${n}z`);
      x += n;
    }
  });
  return [...byColor.entries()].map(([color, d]) => ({ color, d: d.join('') }));
}

// SVG 断片（地図上の位置 (cx, cy) はマス座標）
export function spriteSvg(kind, dir, frame, cx, cy) {
  return spritePaths(kind, dir, frame, cx * TILE, cy * TILE).map((p) => `<path d="${p.d}" fill="${p.color}"/>`).join('');
}

// 要点の種類ごとの目印（8x8 の型紙。色以外でも見分けられる形）
const MARKS = {
  conclusion: ['..7777..', '..77777.', '..7777..', '..6.....', '..6.....', '..6.....', '..6.....', '.666....'], // 旗
  issue: ['...77...', '..7dd7..', '..7dd7..', '.77dd77.', '.77dd77.', '77777777', '77777777', '........'], // 警告
  idea: ['..bbbb..', '.bbbbbb.', '.bbbbbb.', '.bbbbbb.', '..bbbb..', '...dd...', '...99...', '........'], // 電球
  note: ['.dddddd.', '.d0000d.', '.dddddd.', '.d0000d.', '.dddddd.', '.d0000d.', '.dddddd.', '........'], // 紙
};
export function markPaths(kind, ox = 0, oy = 0) {
  const rows = MARKS[kind] ?? MARKS.note;
  const byColor = new Map();
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    const col = colorOf(c);
    if (!byColor.has(col)) byColor.set(col, []);
    byColor.get(col).push(`M${ox + x * 2} ${oy + y * 2}h2v2h-2z`);
  }));
  return [...byColor.entries()].map(([color, d]) => ({ color, d: d.join('') }));
}
