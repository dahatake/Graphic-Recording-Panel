// FR-075・FR-076: 画風プリセット（9 つの「〇〇風」と、見た目の項目を持つ追加の定義）の 2D の図。
// 契約: tests/system/CONTRACT-STYLE-PRESET.md。DOM に依存しない純粋な文字列の生成で、外部の画像・書体を使わない（紙面の質感・線画人物・絵記号は図形で描く）。
// 図の内容・配置・型・文字は既存の描画と同じで、見た目（配色・紙面・書体・見出しの飾り・吹き出し・線・線画人物）だけが変わる。
// 見た目の項目を持たない既存の定義（手書き調・アニメ調・シンプル・RPG風）は、従来の描画（diagram.js）のまま（AC-406）。
// 端末のハイコントラスト（強制カラー）が有効な間は、どの描画スタイルでも図の色を CSS のシステム色にする（AC-456）。
import { KINDS, STATUS_MARK, classifyPoint, kindLabelOf, textWidth, outline, rng, iconGlyph } from './diagram.js';
import { sceneEmotions } from './emotion.js';
import { matchParts, getPartGroup } from './parts.js';
import {
  presetOf, fontFamilyOf, fontStacks, parseColor, luminance, contrastRatio, mix, grayOf, isYellowish, isNeutralColor,
  MIN_TEXT_CONTRAST, MIN_OUTLINE_CONTRAST,
} from './stylepresets.js';

const MARGIN = 24; const HEAD_H = 44; const PT_H = 40; const PT_GAP = 22; const SCENE_GAP = 72; const ICON = 24;
const FS = 14; const FS_HEAD = 18; const FS_LABEL = 11;
const SELECTED_MARK = '▶';
const LEGACY_INK = '#15191f';
const r1 = (n) => Math.round(n * 10) / 10;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;');

// ---- 配色の役割（look）。紙面・文字・枠・帯・面（付箋・吹き出し・絵記号・強調）の色と、その上の文字の色を決める ----
const BLACK = '#000000'; const WHITE = '#ffffff'; const DARK_LINE = '#333333'; const LIGHT_LINE = '#d0d0d0';
const isBlackish = (c) => isNeutralColor(c) && Math.max(...parseColor(c)) <= 0x33;

export function buildLook(spec) {
  const pr = presetOf(spec);
  const P = pr.palette; const bg = P.background; const ink = P.text;
  const okText = (c, b) => contrastRatio(c, b) >= MIN_TEXT_CONTRAST;
  // 面の上の文字: 文字色で 4.5:1 に届かなければ黒か白。黄の面の上は黒（AC-410）。
  const textOn = (fill) => {
    if (!parseColor(fill)) return ink;
    if (isYellowish(fill)) return isBlackish(ink) && okText(ink, fill) ? ink : BLACK;
    if (okText(ink, fill)) return ink;
    return contrastRatio(BLACK, fill) >= contrastRatio(WHITE, fill) ? BLACK : WHITE;
  };
  const frame = contrastRatio(P.primary, bg) >= MIN_OUTLINE_CONTRAST ? P.primary : ink;
  // 黄の面の輪郭線（黒かグレーで、紙面と 3:1 以上）
  const neutral = isBlackish(frame) ? frame
    : contrastRatio(DARK_LINE, bg) >= MIN_OUTLINE_CONTRAST ? DARK_LINE
      : contrastRatio(LIGHT_LINE, bg) >= MIN_OUTLINE_CONTRAST ? LIGHT_LINE
        : (contrastRatio(DARK_LINE, bg) >= contrastRatio(LIGHT_LINE, bg) ? DARK_LINE : LIGHT_LINE);
  const outlineOf = (fill) => (isYellowish(fill) ? neutral : frame);
  const accents = P.accent;
  const mono = [bg, P.primary, ink, P.secondary, ...accents].every(isNeutralColor);
  const yellow = accents.find(isYellowish);
  const tint = (c, t) => mix(c, WHITE, t);
  const stickyFills = pr.balloon === 'sticky' ? accents : null;
  const balloonFill = pr.paper === 'chalkboard' ? 'none'
    : pr.balloon === 'sticky' ? accents[1 % accents.length]
      : (yellow ?? tint(accents[0], mono ? 0.1 : 0.2));
  // 強調の塗り: 黄があれば黄。付箋に載せる風は付箋と同じ色を避けて紙面の色にする
  const emph = stickyFills ? bg : (yellow ?? tint(accents[0], mono ? 0.14 : 0.28));
  const band = P.primary;
  const frameFill = pr.paper === 'grid' && okText(ink, P.secondary) ? P.secondary : bg;
  const shadow = isNeutralColor(P.secondary) ? P.secondary : mix(bg, BLACK, 0.78);
  const texture = pr.paper === 'kraft' ? mix(bg, BLACK, 0.68) : P.secondary;
  const base = pr.font === 'handwriting' ? 600 : pr.font === 'roundGothic' ? 500 : 400;
  return {
    forced: false, pr, bg, ink, frame, neutral, outlineOf, textOn, mono,
    band, bandText: okText(WHITE, band) ? WHITE : textOn(band),
    marker: accents[0], stickyFills, headSticky: accents[0],
    balloonFill, balloonText: textOn(balloonFill), balloonStroke: balloonFill === 'none' ? frame : outlineOf(balloonFill),
    iconFill: (i) => (mono ? bg : accents[i % accents.length]),
    emph, emphText: textOn(emph), frameFill,
    divider: P.secondary, shadow, texture, figure: frame, headFill: bg,
    weight: base, headWeight: pr.headingDecoration === 'classic' ? 900 : 800, labelWeight: Math.max(700, base),
  };
}
// 強制カラーの間の配色（OS のシステム色。AC-055・AC-456）
export function forcedLook(spec) {
  const pr = presetOf(spec);
  const textOn = (fill) => (fill === 'CanvasText' ? 'Canvas' : 'CanvasText');
  const base = pr.font === 'handwriting' ? 600 : pr.font === 'roundGothic' ? 500 : 400;
  return {
    forced: true, pr, bg: 'Canvas', ink: 'CanvasText', frame: 'CanvasText', neutral: 'CanvasText', outlineOf: () => 'CanvasText', textOn, mono: false,
    band: 'CanvasText', bandText: 'Canvas', marker: 'CanvasText', stickyFills: pr.balloon === 'sticky' ? ['Canvas'] : null, headSticky: 'Canvas',
    balloonFill: 'Canvas', balloonText: 'CanvasText', balloonStroke: 'CanvasText', iconFill: () => 'Canvas',
    emph: 'Canvas', emphText: 'CanvasText', frameFill: 'Canvas', divider: 'GrayText', shadow: 'GrayText', texture: 'GrayText', figure: 'CanvasText', headFill: 'Canvas',
    weight: base, headWeight: pr.headingDecoration === 'classic' ? 900 : 800, labelWeight: Math.max(700, base),
  };
}

// ---- 図形の部品 ----
// 決定的な揺らぎの線（同じ種なら同じ形。乱数・時刻に依存しない。AC-412）
function wobD(pts, seed, closed, amp) {
  const rand = rng(seed); const out = []; const n = pts.length; const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const [ax, ay] = pts[i]; const [bx, by] = pts[(i + 1) % n];
    const k = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 26));
    for (let j = 0; j < k; j++) { const f = j / k; out.push([ax + (bx - ax) * f + (rand() - 0.5) * 2 * amp, ay + (by - ay) * f + (rand() - 0.5) * 2 * amp]); }
  }
  if (!closed) { const [lx, ly] = pts[n - 1]; out.push([lx + (rand() - 0.5) * amp, ly + (rand() - 0.5) * amp]); }
  return out.map(([x, y], i) => `${i ? 'L' : 'M'}${r1(x)} ${r1(y)}`).join('') + (closed ? 'Z' : '');
}
const box = (x, y, w, h) => `${r1(x)} ${r1(y)} ${r1(w)} ${r1(h)}`;
// 枠: 揺らぎがあれば path、なければ角丸の rect
function shapeEl(look, a, x, y, w, h, shape, seed, rx = 6) {
  const { wobble } = look.pr.stroke;
  if (wobble > 0) return `<path ${a} d="${wobD(outline(shape, x, y, w, h), seed, true, 1.1 * wobble)}"/>`;
  return `<rect ${a} x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="${rx}"/>`;
}
// 手で切ったような縁（クラフト紙の付箋）
function tornD(x, y, w, h, seed) {
  const rand = rng(seed); const pts = []; const step = 9;
  for (let i = 0; i <= Math.ceil(w / step); i++) pts.push([Math.min(x + i * step, x + w), y + (i % 2 ? 2.4 : 0) + rand() * 1.2]);
  for (let i = Math.ceil(w / step); i >= 0; i--) pts.push([Math.min(x + i * step, x + w), y + h - (i % 2 ? 2.4 : 0) - rand() * 1.2]);
  return pts.map(([px, py], i) => `${i ? 'L' : 'M'}${r1(px)} ${r1(py)}`).join('') + 'Z';
}
// 付箋（右下が折れた形）
function stickyEl(look, a, x, y, w, h, seed) {
  if (look.pr.paper === 'kraft') return `<path ${a} d="${tornD(x, y, w, h, seed)}"/>`;
  const f = 10;
  return `<path ${a} d="${look.pr.stroke.wobble > 0 ? wobD([[x, y], [x + w, y], [x + w, y + h - f], [x + w - f, y + h], [x, y + h]], seed, true, 0.6 * look.pr.stroke.wobble) : `M${r1(x)} ${r1(y)}H${r1(x + w)}V${r1(y + h - f)}L${r1(x + w - f)} ${r1(y + h)}H${r1(x)}Z`}"/>`;
}
// 雲形（楕円の周りに弧を連ねる。外接矩形は弧のふくらみを含む）
function cloud(x, y, w, h, seed) {
  const rand = rng(seed); const cx = x + w / 2; const cy = y + h / 2;
  const n = Math.max(9, Math.round((w + h) / 26));
  const pts = Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [cx + (w / 2) * Math.cos(a), cy + (h / 2) * Math.sin(a)]; });
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`; let bulge = 0;
  for (let i = 0; i < n; i++) {
    const [bx, by] = pts[(i + 1) % n]; const [ax, ay] = pts[i]; const c = Math.hypot(bx - ax, by - ay);
    const r = c * (0.6 + rand() * 0.08); bulge = Math.max(bulge, r - Math.sqrt(Math.max(0, r * r - (c * c) / 4)));
    d += `A${r1(r)} ${r1(r)} 0 0 1 ${r1(bx)} ${r1(by)}`;
  }
  const m = Math.ceil(bulge + 1);
  return { d: `${d}Z`, box: [x - m, y - m, w + 2 * m, h + 2 * m] };
}

// FR-076 AC-467・FR-032 AC-156: 感情語を含むトピックの吹き出しの形（ギザギザ）。矩形の辺に沿って外向きの歯を並べた多角形の頂点。
// 通常の吹き出し（雲形・角丸・付箋）と、要素の種類（polygon）と輪郭（歯）の両方で異なる。画面の SVG・PNG・PDF で同じ生成器を使う（同じ形）。
// 乱数・時刻を使わない（決定的。AC-412）。depth は歯の高さ、tooth は歯の幅の目安。
export function jaggedPoints(x, y, w, h, depth = 7, tooth = 14) {
  const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const normals = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const pts = [];
  for (let e = 0; e < 4; e++) {
    const [ax, ay] = corners[e]; const [bx, by] = corners[(e + 1) % 4]; const [nx, ny] = normals[e];
    const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / tooth));
    for (let k = 0; k < n; k++) {
      pts.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
      const f = (k + 0.5) / n;
      pts.push([ax + (bx - ax) * f + nx * depth, ay + (by - ay) * f + ny * depth]);
    }
  }
  return pts.map(([px, py]) => [r1(px), r1(py)]);
}
// 吹き出し型（FR-032）を選んでいるとき、感情語（FR-004 の辞書）を含むトピックに属するシーンの id。吹き出し型でなければ空。
// トピック（FR-025）に属さないシーンは、そのシーンだけを 1 つのトピックとして扱う（layoutkinds.js の吹き出し型と同じ）。
export function emotionBalloonSceneIds(api, scenes) {
  const out = new Set();
  const info = api?.getLayoutInfo?.();
  if (!info?.applied || !(info.selected ?? []).includes('bubble')) return out;
  const byId = new Map((scenes ?? []).map((s) => [s.id, s]));
  const groups = []; const seen = new Set();
  for (const tp of api.getTopics?.() ?? []) { const ids = (tp.sceneIds ?? []).filter((id) => byId.has(id)); ids.forEach((id) => seen.add(id)); groups.push(ids); }
  for (const s of scenes ?? []) if (!seen.has(s.id)) groups.push([s.id]);
  for (const ids of groups) if (ids.some((id) => sceneEmotions(byId.get(id)).length > 0)) ids.forEach((id) => out.add(id));
  return out;
}

// 文字（直下の背景の色 data-back と外接矩形 data-box を持つ）
function textEl(x, y, s, { size = FS, weight, fill, back, anchor = 'start', extra = '', dy = 0, boxes }) {
  const str = String(s ?? '');
  if (!str) return '';
  const tw = textWidth(str, size); const bx = anchor === 'end' ? x - tw : anchor === 'middle' ? x - tw / 2 : x;
  const b = [bx, y + dy - size * 0.9, tw, size * 1.2];
  boxes?.push(b);
  return `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}" data-back="${back}" data-box="${box(...b)}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${extra}>${esc(str)}</text>`;
}
const overlaps = (a, b) => Math.min(a[0] + a[2], b[0] + b[2]) > Math.max(a[0], b[0]) && Math.min(a[1] + a[3], b[1] + b[3]) > Math.max(a[1], b[1]);

// 絵記号（塗りの円に要点の種類の図形。黄の塗りには黒かグレーの輪郭線）
function iconEl(look, glyph, x, y, i, blocked) {
  const fill = look.iconFill(i); const sw = r1(Math.max(1.2, look.pr.stroke.width * 0.6));
  blocked.push([x - 1, y - 1, ICON + 2, ICON + 2]);
  return `<g data-style-role="icon" data-box="${box(x - 1, y - 1, ICON + 2, ICON + 2)}" fill="${fill}" stroke="${look.outlineOf(fill)}" stroke-width="${sw}" transform="translate(${r1(x)} ${r1(y)})" aria-hidden="true">`
    + `<circle cx="12" cy="12" r="11.5"/><g fill="none" stroke="${look.textOn(fill)}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" transform="translate(4.5 4.5) scale(0.625)">${iconGlyph(glyph)}</g></g>`;
}
// 線画人物（丸い頭・細い線・表情は最小限。図形だけで描き、実在の人物や既存の素材を使わない。AC-425）
const FIG_W = 36; const FIG_H = 58;
function figureEl(look, sceneId, x, y, blocked, key = 'data-scene-id') {
  const c = look.figure; const fw = r1(Math.max(0.8, look.pr.stroke.width * 0.45));
  const pose = rng(`${sceneId}:pose`)() < 0.5;
  const L = (d) => `<path d="${d}" stroke-width="${fw}"/>`;
  blocked.push([x, y, FIG_W, FIG_H]);
  return `<g data-style-role="figure" ${key}="${attr(sceneId)}" data-box="${box(x, y, FIG_W, FIG_H)}" fill="none" stroke="${c}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
    + `<circle cx="${x + 18}" cy="${y + 10}" r="9" fill="${look.headFill}" stroke-width="${fw}"/>`
    + `<circle cx="${x + 15}" cy="${y + 9}" r="1" fill="${c}" stroke-width="${fw}"/><circle cx="${x + 21}" cy="${y + 9}" r="1" fill="${c}" stroke-width="${fw}"/>`
    + L(`M${x + 15} ${y + 13}Q${x + 18} ${y + 15.5} ${x + 21} ${y + 13}`)
    + `<line x1="${x + 18}" y1="${y + 19}" x2="${x + 18}" y2="${y + 39}" stroke-width="${fw}"/>`
    + `<polyline points="${x + 6},${y + (pose ? 33 : 22)} ${x + 18},${y + 26} ${x + 32},${y + (pose ? 18 : 30)}" stroke-width="${fw}"/>`
    + `<polyline points="${x + 9},${y + 57} ${x + 18},${y + 39} ${x + 27},${y + 57}" stroke-width="${fw}"/></g>`;
}

// ---- 紙面（背景と質感。すべての文字より先に描く） ----
function paperSvg(look, W, H) {
  const { paper } = look.pr; const tex = look.texture; const out = [];
  const T = 'data-style-role="paper-texture"';
  const rand = rng(`paper:${paper}:${W}x${H}`);
  if (paper === 'grid') {
    for (let x = 24; x < W; x += 24) out.push(`<line ${T} x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${tex}" stroke-width="1" stroke-opacity="0.75" fill="none"/>`);
    for (let y = 24; y < H; y += 24) out.push(`<line ${T} x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${tex}" stroke-width="1" stroke-opacity="0.75" fill="none"/>`);
  } else if (paper === 'ruled') {
    for (let y = 30; y < H; y += 28) out.push(`<line ${T} x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${tex}" stroke-width="1" fill="none"/>`);
    out.push(`<line ${T} x1="12" y1="0" x2="12" y2="${H}" stroke="${look.forced ? tex : look.pr.palette.accent[0]}" stroke-width="1" stroke-opacity="0.45" fill="none"/>`);
  } else if (paper === 'chalkboard') {
    const n = Math.min(80, Math.max(6, Math.round((W * H) / 26000)));
    for (let i = 0; i < n; i++) {
      const x = rand() * W; const y = rand() * H; const rx = 40 + rand() * 90; const ry = 10 + rand() * 26;
      out.push(`<ellipse ${T} cx="${r1(x)}" cy="${r1(y)}" rx="${r1(rx)}" ry="${r1(ry)}" fill="${tex}" fill-opacity="0.05" stroke="none"/>`);
    }
    const m = Math.min(40, Math.max(3, Math.round((W * H) / 60000)));
    for (let i = 0; i < m; i++) {
      const x = rand() * W; const y = rand() * H; const len = 60 + rand() * 120;
      out.push(`<path ${T} d="M${r1(x)} ${r1(y)}q${r1(len / 2)} ${r1((rand() - 0.5) * 16)} ${r1(len)} 0" fill="none" stroke="${tex}" stroke-opacity="0.1" stroke-width="14" stroke-linecap="round"/>`);
    }
  } else if (paper === 'whiteboard') {
    for (let i = 0; i < 4; i++) {
      const x = (W / 4) * i + rand() * 60;
      out.push(`<line ${T} x1="${r1(x)}" y1="0" x2="${r1(x + H * 0.35)}" y2="${H}" stroke="${tex}" stroke-opacity="0.05" stroke-width="14" fill="none"/>`);
    }
    out.push(`<rect ${T} x="3" y="3" width="${W - 6}" height="${H - 6}" rx="6" fill="none" stroke="${tex}" stroke-opacity="0.6" stroke-width="2"/>`);
  } else if (paper === 'kraft') {
    const n = Math.min(320, Math.max(40, Math.round((W * H) / 2400)));
    for (let i = 0; i < n; i++) {
      const x = rand() * W; const y = rand() * H; const a = rand() * Math.PI; const len = 4 + rand() * 10;
      out.push(`<line ${T} x1="${r1(x)}" y1="${r1(y)}" x2="${r1(x + Math.cos(a) * len)}" y2="${r1(y + Math.sin(a) * len)}" stroke="${tex}" stroke-opacity="0.35" stroke-width="0.8" fill="none"/>`);
    }
  }
  return `<g data-style-role="paper" aria-hidden="true"><rect data-style-role="paper-bg" x="0" y="0" width="${W}" height="${H}" fill="${look.bg}" stroke="none"/>${out.join('')}</g>`;
}

// ---- 見出しの飾り（band・marker・sticky・classic） ----
function headingSvg(look, id, x, y, w, status, heading, selected, boxes) {
  const pr = look.pr; const out = [];
  const head = (fill, back) => textEl(x + 14, y + 29, status, { size: FS_HEAD, weight: look.headWeight, fill, back, boxes, extra: ' data-role="status"' })
    + textEl(x + (status ? 44 : 14), y + 29, heading, { size: FS_HEAD, weight: look.headWeight, fill, back, boxes, extra: ' data-role="heading"' });
  const sw = r1(pr.stroke.width * (selected ? 1.8 : 1));
  if (pr.headingDecoration === 'band') {
    out.push(shapeEl(look, `data-style-role="heading-band" data-box="${box(x, y, w, HEAD_H)}" fill="${look.band}" stroke="${selected ? look.ink : look.band}" stroke-width="${sw}"`, x, y, w, HEAD_H, 'rect', `${id}:hb`, 4));
    out.push(head(look.bandText, look.band));
  } else if (pr.headingDecoration === 'sticky') {
    const fill = look.headSticky;
    out.push(`<rect data-style-role="shadow" x="${x + 4}" y="${y + 4}" width="${w}" height="${HEAD_H}" fill="${look.shadow}" stroke="none" fill-opacity="0.55"/>`);
    out.push(stickyEl(look, `data-style-role="heading-sticky" data-box="${box(x, y, w, HEAD_H)}" fill="${fill}" stroke="${look.outlineOf(fill)}" stroke-width="${sw}"`, x, y, w, HEAD_H, `${id}:hs`));
    out.push(head(look.textOn(fill), fill));
  } else if (pr.headingDecoration === 'marker') {
    const tw = Math.min(w - 16, textWidth(`${status}${heading}`, FS_HEAD) + 48);
    const my = y + 37; const mw = Math.max(6, pr.stroke.width * 2.4);
    const d = pr.stroke.wobble > 0 ? wobD([[x + 8, my], [x + 8 + tw, my]], `${id}:hm`, false, 0.8 * pr.stroke.wobble) : `M${x + 8} ${my}H${r1(x + 8 + tw)}`;
    out.push(`<path data-style-role="heading-marker" data-box="${box(x + 8 - mw / 2, my - mw / 2 - 2, tw + mw, mw + 4)}" d="${d}" fill="none" stroke="${look.marker}" stroke-width="${r1(mw)}" stroke-linecap="round" stroke-opacity="0.9"/>`);
    out.push(head(look.ink, look.bg));
    if (selected) out.push(`<rect x="${x}" y="${y}" width="${w}" height="${HEAD_H}" rx="6" fill="none" stroke="${look.frame}" stroke-width="${sw}" stroke-dasharray="4 3"/>`);
  } else {
    out.push(head(look.ink, look.bg));
    out.push(`<line x1="${x + 8}" y1="${y + 38}" x2="${x + w - 8}" y2="${y + 38}" stroke="${look.frame}" stroke-width="${r1(pr.stroke.width * (selected ? 2.4 : 1.4))}" fill="none"/>`);
  }
  return out.join('');
}

// ---- 2D の時系列（詳細度「詳細」）の図 ----
// scenes: アプリのシーン配列。opts: { lang, relations, selectedSceneId, highlightPointId, t, title }
export function renderPresetDiagram(scenes, opts, look) {
  const pr = look.pr; const t = opts.t ?? ((k) => k);
  const sel = opts.selectedSceneId ?? null; const hlId = opts.highlightPointId ?? null;
  const boxes = []; const blocked = []; const body = []; const rects = new Map(); const heads = [];
  const W0 = pr.stroke.width; const amp = pr.stroke.wobble;
  let x = MARGIN; let maxH = 0;
  scenes.forEach((s) => {
    const isSel = s.id === sel;
    const status = `${STATUS_MARK[s.status] ?? ''}${isSel ? SELECTED_MARK : ''}`;
    const emos = sceneEmotions(s);
    const kinds = s.points.map((p) => classifyPoint(p.text));
    const order = ['conclusion', 'issue', 'proposal', 'undecided', 'idea', 'note'];
    const main = kinds.length ? [...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] : null;
    // 吹き出しの中身: その場の様子の語（従来の絵記号の語）。なければ主な要点の種類の文字。
    const words = emos.length ? emos.map((e) => e.word) : main ? [kindLabelOf(main, opts.lang)] : [];
    const lineH = 20; const tw = Math.max(0, ...words.map((wd) => textWidth(wd, FS)));
    // FR-076 AC-467: 吹き出し型で感情語を含むトピックの吹き出しは、どの風でも通常の形と異なるギザギザ（歯の分だけ外に広がる）
    const emoBalloon = !!opts.emotionScenes?.has(s.id); const JAG = 7;
    const cloudy = !emoBalloon && pr.balloon === 'cloud';
    const bw = Math.ceil(cloudy ? tw * 1.45 + 34 : tw + 34); const bh = Math.ceil(words.length * lineH + (cloudy ? 26 : 16));
    const jagPad = emoBalloon ? JAG : 0;
    const figX = pr.figures ? FIG_W + 22 : 0;
    const w = Math.ceil(Math.max(250, textWidth(`${status}${s.heading}`, FS_HEAD) + 72,
      ...s.points.map((p, i) => 42 + textWidth(p.text, FS) + 16 + textWidth(kindLabelOf(kinds[i], opts.lang), FS_LABEL) + 14),
      figX + bw + 28 + jagPad * 2));
    const sb = [];
    sb.push(headingSvg(look, s.id, x, MARGIN, w, status, s.heading, isSel, boxes));
    sb.push(`<line data-style-role="divider" x1="${x + 6}" y1="${MARGIN + HEAD_H + 11}" x2="${x + w - 6}" y2="${MARGIN + HEAD_H + 11}" fill="none" stroke="${look.divider}" stroke-width="${r1(Math.max(1, W0 * 0.5))}" stroke-dasharray="${amp > 0 ? '2 5' : '1 0'}" stroke-linecap="round"/>`);
    // 要点（種類ごとの形・絵記号・種類の文字。強調（結論）は太い枠と強調の塗り。選んだ要点は太い枠と星）
    let y = MARGIN + HEAD_H + 26; const top = new Map();
    const dash = s.status === 'in_progress' ? ' stroke-dasharray="7 4"' : '';
    s.points.forEach((p, i) => {
      const kind = kinds[i]; const k = KINDS[kind]; const hl = p.id === hlId; const concl = kind === 'conclusion';
      top.set(p.id, y); rects.set(p.id, { x, y, w, sceneId: s.id });
      const g = [];
      let surface = look.frameFill;
      if (look.stickyFills) {
        surface = look.stickyFills[i % look.stickyFills.length];
        g.push(`<rect data-style-role="shadow" x="${x + 4}" y="${y + 4}" width="${w}" height="${PT_H}" fill="${look.shadow}" fill-opacity="0.5" stroke="none"/>`);
        g.push(stickyEl(look, `data-style-role="sticky" data-box="${box(x, y, w, PT_H)}" fill="${surface}" stroke="${look.outlineOf(surface)}" stroke-width="${r1(Math.max(1, W0 * 0.6))}"`, x, y, w, PT_H, `${p.id}:st`));
      }
      const sw = r1(W0 * (hl ? 1.8 : concl ? 1.3 : 1));
      g.push(shapeEl(look, `data-style-role="point-frame" data-box="${box(x, y, w, PT_H)}" fill="${look.stickyFills ? 'none' : surface}" stroke="${look.frame}" stroke-width="${sw}" stroke-linejoin="round"${dash}`, x, y, w, PT_H, k.shape, p.id));
      if (hl) g.push(`<path data-role="highlight-frame" d="${wobD(outline(k.shape, x - 6, y - 6, w + 12, PT_H + 12), `${p.id}:f`, true, 0.8)}" fill="none" stroke="${look.frame}" stroke-width="2" stroke-dasharray="3 3"/>`);
      const tx = x + 8 + ICON + 10;
      let back = surface;
      if (concl) {
        const ew = textWidth(p.text, FS) + 12;
        back = look.emph;
        g.push(shapeEl(look, `data-style-role="emphasis" data-box="${box(tx - 6, y + 9, ew, 22)}" fill="${look.emph}" stroke="${look.outlineOf(look.emph)}" stroke-width="${r1(Math.max(1, W0 * 0.5))}"`, tx - 6, y + 9, ew, 22, 'rect', `${p.id}:em`, 4));
      }
      if (pr.icons) g.push(iconEl(look, k.icon, x + 8, y + 8, Math.max(0, Object.keys(KINDS).indexOf(kind)), blocked));
      g.push(textEl(tx, y + 25, p.text, { size: FS, weight: concl ? 800 : look.weight, fill: concl ? look.emphText : look.textOn(back), back, boxes }));
      g.push(textEl(x + w - 8, y + 13, kindLabelOf(kind, opts.lang), { size: FS_LABEL, weight: look.labelWeight, fill: look.textOn(surface), back: surface, anchor: 'end', boxes, extra: ' data-role="kind-label"' }));
      if (hl) g.push(`<g data-role="highlight-icon" transform="translate(${r1(x + w - 18)} ${r1(y - 18)})" fill="none" stroke="${look.frame}" stroke-width="2" stroke-linejoin="round">${iconGlyph('star')}</g>`);
      sb.push(`<g data-point-id="${attr(p.id)}" data-kind="${kind}"${hl ? ' data-highlight="1"' : ''}>${g.join('')}</g>`);
      y += PT_H + PT_GAP;
    });
    // 要点どうしの関係線（シーンの中）
    const cx = x + w / 2;
    for (const r of s.relations) {
      const a = top.get(r.from); const b = top.get(r.to);
      if (a == null || b == null) continue;
      const [from, to] = a <= b ? [a, b] : [b, a];
      const hot = hlId != null && (r.from === hlId || r.to === hlId);
      sb.push(`<path data-relation="${attr(r.from)}>${attr(r.to)}"${hot ? ' data-highlight="1"' : ''} d="${amp > 0 ? wobD([[cx, from + PT_H + 3], [cx, to - 4]], `${r.from}>${r.to}`, false, 0.8 * amp) : `M${r1(cx)} ${from + PT_H + 3}V${to - 4}`}" fill="none" stroke="${look.frame}" stroke-width="${r1(W0 * (hot ? 1.8 : 0.9))}" stroke-linecap="round" marker-end="url(#preset-arrow)"/>`);
    }
    // 吹き出し（＋線画人物）
    const yb = y - PT_GAP + 18;
    if (pr.figures) sb.push(figureEl(look, s.id, x + 6, yb + 6, blocked));
    if (words.length) {
      const bx = x + 8 + figX + jagPad; const by = yb + (cloudy ? 6 : 2) + jagPad;
      const fill = look.balloonFill; const stroke = look.balloonStroke; const bsw = r1(Math.max(1.2, W0 * 0.8));
      const dashB = pr.paper === 'grid' ? ' stroke-dasharray="6 4"' : '';
      const jag = emoBalloon ? jaggedPoints(bx, by, bw, bh, JAG) : null;
      const ptsAttr = (pts, dx = 0) => pts.map(([px, py]) => `${r1(px + dx)},${r1(py + dx)}`).join(' ');
      if (look.pr.paper !== 'chalkboard' && fill !== 'none') {
        if (jag) sb.push(`<polygon data-style-role="shadow" points="${ptsAttr(jag, 4)}" fill="${look.shadow}" fill-opacity="0.5" stroke="none"/>`);
        else sb.push(`<path data-style-role="shadow" d="${cloudy ? cloud(bx + 4, by + 4, bw, bh, `${s.id}:bl`).d : `M${bx + 4} ${by + 4}h${bw}v${bh}h${-bw}Z`}" fill="${look.shadow}" fill-opacity="0.5" stroke="none"/>`);
      }
      if (jag) {
        sb.push(`<polygon data-style-role="balloon" data-shape="jagged" data-balloon-kind="emotion" data-box="${box(bx - JAG, by - JAG, bw + JAG * 2, bh + JAG * 2)}" points="${ptsAttr(jag)}" fill="${fill}" stroke="${stroke}" stroke-width="${bsw}" stroke-linejoin="miter"${dashB}/>`);
        if (pr.figures) sb.push(`<path data-style-role="balloon-tail" d="M${r1(bx - JAG + 2)} ${r1(by + bh * 0.5)}L${r1(bx - JAG - 9)} ${r1(by + bh * 0.85)}L${r1(bx - JAG + 3)} ${r1(by + bh * 0.75)}" fill="${fill}" stroke="${stroke}" stroke-width="${r1(bsw * 0.8)}" stroke-linejoin="round"/>`);
      } else if (cloudy) {
        const c = cloud(bx, by, bw, bh, `${s.id}:bl`);
        sb.push(`<path data-style-role="balloon" data-shape="cloud" data-box="${box(...c.box)}" d="${c.d}" fill="${fill}" stroke="${stroke}" stroke-width="${bsw}" stroke-linejoin="round"${dashB}/>`);
        if (pr.figures) sb.push(`<circle data-style-role="balloon-tail" cx="${r1(bx - 6)}" cy="${r1(by + bh * 0.72)}" r="4" fill="${fill}" stroke="${stroke}" stroke-width="${r1(bsw * 0.8)}"/><circle data-style-role="balloon-tail" cx="${r1(bx - 13)}" cy="${r1(by + bh * 0.9)}" r="2.4" fill="${fill}" stroke="${stroke}" stroke-width="${r1(bsw * 0.8)}"/>`);
      } else if (pr.balloon === 'sticky') {
        sb.push(stickyEl(look, `data-style-role="balloon" data-shape="sticky" data-box="${box(bx, by, bw, bh)}" fill="${fill}" stroke="${stroke}" stroke-width="${bsw}"`, bx, by, bw, bh, `${s.id}:bl`));
      } else {
        sb.push(shapeEl(look, `data-style-role="balloon" data-shape="rounded" data-box="${box(bx, by, bw, bh)}" fill="${fill}" stroke="${stroke}" stroke-width="${bsw}" stroke-linejoin="round"${dashB}`, bx, by, bw, bh, 'rect', `${s.id}:bl`, 12));
        if (pr.figures) sb.push(`<path data-style-role="balloon-tail" d="M${bx + 1} ${r1(by + bh * 0.55)}L${bx - 9} ${r1(by + bh * 0.8)}L${bx + 1} ${r1(by + bh * 0.75)}" fill="${fill}" stroke="${stroke}" stroke-width="${r1(bsw * 0.8)}" stroke-linejoin="round"/>`);
      }
      const back = fill === 'none' ? look.bg : fill;
      const ty0 = by + bh / 2 - ((words.length - 1) * lineH) / 2 + 5;
      words.forEach((wd, i) => sb.push(textEl(bx + bw / 2, ty0 + i * lineH, wd, { size: FS, weight: Math.max(700, look.weight), fill: look.textOn(back), back, anchor: 'middle', boxes, extra: emos[i] ? ` data-emotion="${attr(emos[i].id)}"` : '' })));
      y = Math.max(by + bh + (cloudy ? 10 : 4) + jagPad, pr.figures ? yb + 6 + FIG_H : 0) + 16;
    } else y = (pr.figures ? yb + 6 + FIG_H : yb) + 16;
    // FR-064: 同梱部品（語の辞書で対応づけた汎用の物体）
    const objs = matchParts([s.heading, ...s.points.map((p) => p.text)].join('\n'), 4);
    if (objs.length) {
      objs.forEach((o, n) => sb.push(`<g data-part-key="${attr(o.key)}" transform="translate(${x + 14 + n * 56} ${y})">${String(getPartGroup(o.key)).split(`stroke="${LEGACY_INK}"`).join(`stroke="${look.frame}"`)}</g>`));
      y += 56;
    }
    body.push(`<g data-scene-id="${attr(s.id)}" data-status="${attr(s.status)}"${isSel ? ' aria-current="true"' : ''}>${sb.join('')}</g>`);
    heads.push({ x, w });
    maxH = Math.max(maxH, y + MARGIN);
    x += w + SCENE_GAP;
  });
  // シーン間の矢印（時系列）
  heads.slice(0, -1).forEach((h, i) => {
    const y = MARGIN + HEAD_H / 2; const nx = heads[i + 1].x;
    body.push(`<path data-flow="${i}" d="${amp > 0 ? wobD([[h.x + h.w + 12, y], [nx - 14, y]], `flow${i}`, false, 0.8 * amp) : `M${h.x + h.w + 12} ${y}H${nx - 14}`}" fill="none" stroke="${look.frame}" stroke-width="${r1(W0 * 1.1)}" stroke-linecap="round" marker-end="url(#preset-arrow)"/>`);
  });
  // FR-053: 要点どうしの関係線（種類のラベル・向き・明示/推測）。ラベルは絵記号・線画人物に重ねない（AC-425）
  (opts.relations ?? []).forEach((r, ri) => {
    const a = rects.get(r.from); const b = rects.get(r.to);
    if (!a || !b) return;
    const inferred = r.basis === 'inferred';
    const ya = a.y + PT_H / 2; const yb = b.y + PT_H / 2;
    let d; let lx; let ly;
    if (a.sceneId === b.sceneId) {
      const ex = a.x + a.w; const off = 22 + (ri % 3) * 8;
      d = `M${r1(ex)} ${r1(ya)} C${r1(ex + off)} ${r1(ya)} ${r1(ex + off)} ${r1(yb)} ${r1(ex + 3)} ${r1(yb)}`; lx = ex + off + 4; ly = (ya + yb) / 2;
    } else {
      const fwd = b.x >= a.x; const x1 = fwd ? a.x + a.w : a.x; const x2 = fwd ? b.x - 3 : b.x + b.w + 3;
      d = `M${r1(x1)} ${r1(ya)} L${r1(x2)} ${r1(yb)}`; lx = (x1 + x2) / 2 - textWidth(`${r.kindLabel}（${r.basisLabel}）`, FS_LABEL) / 2; ly = (ya + yb) / 2 - 6;
    }
    const label = `${r.kindLabel}（${r.basisLabel}）`; const lw = textWidth(label, FS_LABEL);
    for (let k = 0; k < 40 && blocked.some((q) => overlaps(q, [lx, ly - FS_LABEL * 0.9, lw, FS_LABEL * 1.2])); k++) ly += 8;
    body.push(`<g data-role="point-relation"><path data-relation-kind="${attr(r.kind)}" data-relation-from="${attr(r.from)}" data-relation-to="${attr(r.to)}" data-relation-basis="${attr(r.basis)}" d="${d}" fill="none" stroke="${look.ink}" stroke-width="${r1(Math.max(1.2, W0 * 0.7))}"${inferred ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#preset-arrow-ink)"/>`
      + textEl(lx, ly, label, { size: FS_LABEL, weight: look.labelWeight, fill: look.ink, back: look.bg, boxes, extra: ' data-relation-label=""' }) + '</g>');
    maxH = Math.max(maxH, ly + MARGIN);
  });
  if (!scenes.length) body.push(textEl(MARGIN, MARGIN + 24, t('diagram.empty'), { size: FS, weight: look.weight, fill: look.ink, back: look.bg, boxes }));
  const emptyW = scenes.length ? 0 : MARGIN * 2 + Math.ceil(textWidth(t('diagram.empty'), FS));
  return { body: body.join(''), width: Math.max(320, emptyW, x - SCENE_GAP + MARGIN), height: Math.max(160, Math.ceil(maxH)) };
}

// ---- 2D の時系列（詳細度「大項目」「中項目」）の図 ----
export function renderPresetTopics(topics, relations, scenes, opts, look) {
  const pr = look.pr; const t = opts.t ?? ((k) => k);
  const level = opts.level === 'middle' ? 'middle' : 'major';
  const sel = opts.selectedSceneId ?? null; const byId = new Map(scenes.map((s) => [s.id, s]));
  const ROW = 32; const BOX_GAP = 96; const selText = t('topic.selected');
  const span = (r) => Math.abs(topics.findIndex((q) => q.id === r.to) - topics.findIndex((q) => q.id === r.from));
  const arcMax = Math.max(0, ...relations.filter((r) => r.kind === 'related').map((r) => 36 + 20 * span(r)));
  const top = MARGIN + (arcMax ? arcMax + 22 : 0);
  const boxes = []; const blocked = []; const groups = []; const pos = new Map();
  let x = MARGIN; let maxH = 0;
  topics.forEach((tp) => {
    const heads = tp.sceneIds.map((id) => byId.get(id)).filter(Boolean);
    const w = Math.ceil(Math.max(240, textWidth(tp.title, FS_HEAD) + 48,
      level === 'middle' ? Math.max(0, ...heads.map((s) => textWidth(`${STATUS_MARK[s.status] ?? ''}${s.id === sel ? SELECTED_MARK : ''} ${s.heading}`, FS) + 40)) : 0,
      tp.containsSelected && level === 'major' ? textWidth(`${SELECTED_MARK} ${selText}`, FS) + 40 : 0) + (pr.figures ? FIG_W + 12 : 0));
    const g = [];
    g.push(headingSvg(look, tp.id, x, top, w, '', tp.title, !!tp.containsSelected, boxes).replace('data-role="heading"', 'data-role="topic-title"'));
    let y = top + HEAD_H + 24;
    if (level === 'major' && tp.containsSelected) {
      g.push(textEl(x + 12, y, `${SELECTED_MARK} ${selText}`, { size: FS, weight: Math.max(700, look.weight), fill: look.textOn(look.frameFill), back: look.frameFill, boxes, extra: ' data-role="contains-selected"' }));
      y += ROW - 6;
    }
    if (level === 'middle') {
      for (const s of heads) {
        const on = s.id === sel;
        g.push(textEl(x + 12, y, `${STATUS_MARK[s.status] ?? ''}${on ? SELECTED_MARK : ''} ${s.heading}`, { size: FS, weight: on ? 800 : look.weight, fill: look.textOn(look.frameFill), back: look.frameFill, boxes, extra: ` data-scene-id="${attr(s.id)}" data-role="scene-heading"${on ? ' aria-current="true"' : ''}` }));
        y += ROW;
      }
    }
    if (pr.figures) { g.push(figureEl(look, tp.id, x + w - FIG_W - 8, Math.max(y - 10, top + HEAD_H + 8), blocked, 'data-figure-topic')); y = Math.max(y, top + HEAD_H + 8 + FIG_H + 10); }
    // 中身（選択中の印・見出しの一覧・線画人物）があるときだけ囲みを描く
    if (y > top + HEAD_H + 24) g.unshift(shapeEl(look, `data-role="topic-frame" fill="${look.frameFill}" stroke="${look.frame}" stroke-width="${r1(pr.stroke.width)}"`, x, top + HEAD_H + 4, w, y - top - HEAD_H - 4, 'rect', `${tp.id}:e`, 8));
    else y = top + HEAD_H + 8;
    groups.push(`<g data-topic-id="${attr(tp.id)}"${tp.containsSelected ? ' aria-current="true"' : ''}>${g.join('')}</g>`);
    pos.set(tp.id, { x, w });
    maxH = Math.max(maxH, y + MARGIN);
    x += w + BOX_GAP;
  });
  const lines = [];
  for (const r of relations) {
    const a = pos.get(r.from); const b = pos.get(r.to);
    if (!a || !b) continue;
    const label = r.label ?? t(`topic.rel.${r.kind}`);
    if (r.kind === 'order') {
      const y = top + HEAD_H / 2;
      lines.push(`<g data-topic-relation="${attr(r.id)}" data-kind="order"><path d="M${a.x + a.w + 10} ${y} L${b.x - 12} ${y}" fill="none" stroke="${look.frame}" stroke-width="${r1(pr.stroke.width * 1.1)}" stroke-linecap="round" marker-end="url(#preset-arrow)"/>`
        + textEl((a.x + a.w + b.x) / 2, y - 10, label, { size: FS, weight: Math.max(700, look.weight), fill: look.ink, back: look.bg, anchor: 'middle', boxes, extra: ' data-role="relation-label"' }) + '</g>');
    } else {
      const ax = a.x + a.w / 2; const bx = b.x + b.w / 2; const h = 36 + 20 * span(r);
      lines.push(`<g data-topic-relation="${attr(r.id)}" data-kind="related"><path d="M${ax} ${top - 10} C${ax} ${top - 10 - h} ${bx} ${top - 10 - h} ${bx} ${top - 12}" fill="none" stroke="${look.frame}" stroke-width="${r1(pr.stroke.width)}" stroke-dasharray="6 4" stroke-linecap="round" marker-end="url(#preset-arrow)"/>`
        + textEl((ax + bx) / 2, top - 10 - h * 0.75 - 4, label, { size: FS, weight: Math.max(700, look.weight), fill: look.ink, back: look.bg, anchor: 'middle', boxes, extra: ' data-role="relation-label"' }) + '</g>');
    }
  }
  return { body: groups.join('') + lines.join(''), width: Math.max(320, x - BOX_GAP + MARGIN), height: Math.max(160, Math.ceil(maxH)) };
}

// ---- FR-031〜036 の共通配置（タイトル・まとまり・単位・矢印・比喩）を、風の配色で図の下に描く ----
function wrapLines(text, w, fs, max) {
  const lines = []; let cur = ''; let cw = 0;
  for (const ch of [...String(text ?? '')]) {
    const c = ch.codePointAt(0) >= 0x2e80 ? fs : fs * 0.56;
    if (cw + c > w && cur) { lines.push(cur); cur = ''; cw = 0; }
    cur += ch; cw += c;
  }
  if (cur) lines.push(cur);
  if (lines.length > max) { lines.length = max; lines[max - 1] = `${lines[max - 1].slice(0, -1)}…`; }
  return lines;
}
export function renderPresetPlacement(L, look, dy) {
  if (!L) return { svg: '', height: 0, width: 0 };
  const boxes = []; const parts = []; const T = (x, y, s, o) => textEl(x, y, s, { dy, boxes, ...o });
  const card = look.frameFill; const onCard = look.textOn(card); const sw = r1(Math.max(1, look.pr.stroke.width * 0.6));
  if (L.title?.visible && L.titleLines?.length) parts.push(`<g data-role="title">${L.titleLines.map((line, i) => T(L.title.x, L.title.y + 14 + i * 16, line, { size: 13, weight: Math.max(700, look.weight), fill: look.ink, back: look.bg })).join('')}</g>`);
  if (L.metaphor) {
    const m = L.metaphor; const out = [];
    const lab = (e, x, y) => T(x, y, e.label, { size: 12, weight: Math.max(700, look.weight), fill: look.ink, back: look.bg, extra: ' data-role="metaphor-label"' });
    const sunFill = look.forced ? 'Canvas' : (look.pr.palette.accent.find(isYellowish) ?? look.pr.palette.accent[0]);
    for (const e of m.elements) {
      let shape = '';
      if (e.type === 'sun') {
        const cx = e.x + e.w / 2; const cy = e.y + e.h / 2 - 8; const r = 40;
        const rays = Array.from({ length: 8 }, (_, i) => { const a = (Math.PI * i) / 4; return `<line x1="${r1(cx + Math.cos(a) * (r + 6))}" y1="${r1(cy + Math.sin(a) * (r + 6))}" x2="${r1(cx + Math.cos(a) * (r + 20))}" y2="${r1(cy + Math.sin(a) * (r + 20))}" stroke="${look.frame}" stroke-width="${sw}"/>`; }).join('');
        shape = `${rays}<circle data-style-role="metaphor-sun" cx="${r1(cx)}" cy="${r1(cy)}" r="${r}" fill="${sunFill}" stroke="${look.outlineOf(sunFill)}" stroke-width="${sw}"/>${lab(e, cx - 18, cy + r + 36)}`;
      } else if (e.type === 'mountain') {
        shape = `<polygon points="${e.x},${e.y + e.h} ${r1(e.x + e.w * 0.45)},${e.y + 24} ${e.x + e.w},${e.y + e.h}" fill="none" stroke="${look.divider}" stroke-width="${sw}"/>${lab(e, e.x + e.w * 0.45 - 36, e.y + 20)}`;
      } else if (e.type === 'bridge') {
        shape = `<path d="M${e.x} ${e.y + e.h} Q${r1(e.x + e.w / 2)} ${e.y + e.h - 70} ${e.x + e.w} ${e.y + e.h}" fill="none" stroke="${look.divider}" stroke-width="5"/>${lab(e, e.x + e.w / 2 - 36, e.y + e.h - 36)}`;
      } else if (e.type === 'road') {
        shape = `<rect x="${e.x}" y="${e.y}" width="${r1(e.w)}" height="${e.h}" rx="18" fill="none" stroke="${look.divider}" stroke-width="${sw}"/><line x1="${e.x + 16}" y1="${e.y + e.h / 2}" x2="${r1(e.x + e.w - 16)}" y2="${e.y + e.h / 2}" stroke="${look.divider}" stroke-width="3" stroke-dasharray="14 10"/>${lab(e, e.x + 24, e.y + 14)}`;
      } else {
        shape = `<rect x="${r1(e.x)}" y="${r1(e.y)}" width="${r1(e.w)}" height="${r1(e.h)}" fill="none" stroke="${look.divider}" stroke-width="1" stroke-dasharray="4 4"/>`;
        if (m.axes) shape += `<line x1="${r1(e.x + e.w / 2)}" y1="${r1(e.y)}" x2="${r1(e.x + e.w / 2)}" y2="${r1(e.y + e.h)}" stroke="${look.frame}" stroke-width="1.5"/><line x1="${r1(e.x)}" y1="${r1(e.y + e.h / 2)}" x2="${r1(e.x + e.w)}" y2="${r1(e.y + e.h / 2)}" stroke="${look.frame}" stroke-width="1.5"/>`;
      }
      out.push(`<g data-metaphor-element="${attr(e.type)}">${shape}</g>`);
    }
    if (m.axes) out.push(`<g data-role="axes">${T(m.axes.x.x1, m.axes.x.y1, m.axes.x.label, { size: 12, weight: Math.max(700, look.weight), fill: look.ink, back: look.bg, extra: ' data-role="axis-label" data-axis="x"' })}${T(m.axes.y.x1, m.axes.y.y1 + 14, m.axes.y.label, { size: 12, weight: Math.max(700, look.weight), fill: look.ink, back: look.bg, extra: ' data-role="axis-label" data-axis="y"' })}</g>`);
    parts.push(`<g data-role="metaphor" data-metaphor-kind="${attr(m.kind)}">${out.join('')}${(m.sections ?? []).map((s) => `<g data-metaphor-section="${attr(s.id)}"><rect data-role="frame" x="${r1(s.frame.x)}" y="${r1(s.frame.y)}" width="${r1(s.frame.w)}" height="${r1(s.frame.h)}" rx="8" fill="none" stroke="${look.divider}" stroke-width="1"/>${T(s.headingRect.x, s.headingRect.y + 14, s.heading, { size: 13, weight: Math.max(700, look.weight), fill: look.ink, back: look.bg, extra: ' data-role="subheading"' })}</g>`).join('')}</g>`);
  }
  const divided = (L.dividers ?? []).length > 0;
  for (const g of L.groups ?? []) {
    parts.push(`<g data-group-id="${attr(g.id)}" data-group-kind="${attr(g.kind)}"><rect data-role="frame" x="${g.frame.x}" y="${g.frame.y}" width="${g.frame.w}" height="${g.frame.h}" rx="8" fill="none" stroke="${divided && g.kind === 'zone' ? 'none' : look.divider}" stroke-width="1.5"/>${T(g.headingRect.x, g.headingRect.y + 14, g.heading, { size: 13, weight: Math.max(700, look.weight), fill: look.ink, back: look.bg, extra: ' data-role="subheading"' })}</g>`);
  }
  for (const d of L.dividers ?? []) parts.push(`<line data-role="zone-divider" x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}" stroke="${look.divider}" stroke-width="1"/>`);
  const rectOf = (id) => (id === 'center' ? L.center : (L.units ?? []).find((u) => u.id === id));
  const clip = (r, tx, ty) => {
    const cx = r.x + r.w / 2; const cy = r.y + r.h / 2; const ddx = tx - cx; const ddy = ty - cy;
    if (!ddx && !ddy) return [cx, cy];
    const k = Math.min(ddx ? (r.w / 2) / Math.abs(ddx) : Infinity, ddy ? (r.h / 2) / Math.abs(ddy) : Infinity);
    return [cx + ddx * k, cy + ddy * k];
  };
  const unit = (u, fs) => {
    const emph = r1(u.emphasis ? look.pr.stroke.width * 1.6 : look.pr.stroke.width * 0.7);
    let frame;
    if (u.shape === 'jagged') {
      const pts = []; const n = 14; const cx = u.x + u.w / 2; const cy = u.y + u.h / 2;
      for (let i = 0; i < n * 2; i++) { const a = (Math.PI * i) / n; const k = i % 2 ? 0.88 : 1; pts.push(`${r1(cx + Math.cos(a) * (u.w / 2) * k)} ${r1(cy + Math.sin(a) * (u.h / 2) * k)}`); }
      frame = `<path data-role="unit-frame" d="M${pts.join('L')}Z" fill="${card}" stroke="${look.frame}" stroke-width="${emph}"/>`;
    } else frame = `<rect data-role="unit-frame" x="${u.x}" y="${u.y}" width="${u.w}" height="${u.h}" rx="${u.shape === 'round' || u.shape === 'cloud' ? Math.min(u.h / 2, 24) : 6}" fill="${card}" stroke="${look.frame}" stroke-width="${emph}"/>`;
    const inner = u.emphasis ? `<rect data-role="emphasis-frame" x="${u.x + 4}" y="${u.y + 4}" width="${u.w - 8}" height="${u.h - 8}" rx="4" fill="none" stroke="${look.frame}" stroke-width="1"/>` : '';
    const lines = wrapLines(u.text, u.w - 28, fs, Math.max(1, Math.floor((u.h - 8) / (fs + 3))));
    const text = lines.map((ln, i) => T(u.x + 14, u.y + 6 + fs + i * (fs + 3), ln, { size: fs, weight: u.emphasis ? 800 : look.weight, fill: onCard, back: card })).join('');
    const num = (L.orderMark === 'number' || L.orderMark === 'both') && u.order != null ? T(u.x + 4, u.y + 12, String(u.order + 1), { size: 11, weight: Math.max(700, look.weight), fill: onCard, back: card, extra: ' data-role="order"' }) : '';
    const badge = u.badge ? T(u.x + u.w - 6, u.y + 14, u.badge, { size: 11, weight: 800, fill: onCard, back: card, anchor: 'end', extra: ' data-role="emphasis-mark"' }) : '';
    const rel = (u.relations ?? []).map((rl, i) => T(u.x + u.w - 6, u.y + u.h - 6 - i * 12, rl.label, { size: 10, weight: look.weight, fill: onCard, back: card, anchor: 'end', extra: ' data-role="inner-relation"' })).join('');
    return `${frame}${inner}${text}${num}${badge}${rel}`;
  };
  if (L.center) parts.push(`<g data-unit-id="center" data-role="center">${unit({ ...L.center, emphasis: 'center', shape: 'round', text: L.center.text }, 20)}</g>`);
  for (const u of L.units ?? []) {
    parts.push(`<g data-unit-id="${attr(u.id)}" data-order="${u.order}" data-unit-kind="${attr(u.kind)}"${u.role ? ` data-role-kind="${u.role}"` : ''}${u.attachedTo ? ` data-attached-to="${attr(u.attachedTo)}"` : ''}${u.shape ? ` data-bubble-shape="${u.shape}"` : ''}${u.emphasis ? ` data-emphasis="${u.emphasis}"` : ''}>${unit(u, 12)}</g>`);
  }
  for (const a of L.arrows ?? []) {
    const f = rectOf(a.from); const to = rectOf(a.to);
    if (!f || !to) continue;
    const [x1, y1] = clip(f, to.x + to.w / 2, to.y + to.h / 2); const [x2, y2] = clip(to, f.x + f.w / 2, f.y + f.h / 2);
    const ang = Math.atan2(y2 - y1, x2 - x1); const hx = (k) => r1(x2 - Math.cos(ang + k) * 9); const hy = (k) => r1(y2 - Math.sin(ang + k) * 9);
    parts.push(`<g data-role="flow"><line data-flow-from="${attr(a.from)}" data-flow-to="${attr(a.to)}" x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${look.frame}" stroke-width="1.5"/><polygon points="${r1(x2)},${r1(y2)} ${hx(0.4)},${hy(0.4)} ${hx(-0.4)},${hy(-0.4)}" fill="${look.frame}" stroke="none"/>${a.label ? T((x1 + x2) / 2 + 4, (y1 + y2) / 2 - 4, a.label, { size: 11, weight: Math.max(700, look.weight), fill: look.ink, back: look.bg, extra: ' data-role="arrow-label"' }) : ''}</g>`);
  }
  return { svg: `<g data-role="placement" transform="translate(0 ${dy})">${parts.join('')}</g>`, height: L.canvas?.h ?? 0, width: L.canvas?.w ?? 0 };
}

// ---- 後処理 ----
const TAG_RE = /<([A-Za-z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
const getAttr = (a, n) => { const m = new RegExp(`\\s${n}="([^"]*)"`).exec(a); return m ? m[1] : null; };
const setAttr = (a, n, v) => (getAttr(a, n) != null ? a.replace(new RegExp(`(\\s${n}=)"[^"]*"`), `$1"${v}"`) : `${a} ${n}="${v}"`);
// 黄の面には黒かグレーの輪郭線を付ける（同梱部品など、風の部品以外の黄の塗りも含む。AC-410・AC-411）。単色の風は無彩色に寄せる。
export function finishPresetSvg(svg, look) {
  if (look.forced) return svg;
  return svg.replace(TAG_RE, (all, tag, a, self) => {
    let out = a;
    if (look.mono) out = out.replace(/(\s(?:fill|stroke|stop-color|color)=)"(#[0-9a-fA-F]{3,6})"/g, (m, k, c) => `${k}"${grayOf(c)}"`);
    const fill = getAttr(out, 'fill');
    if (fill && isYellowish(fill)) {
      const st = getAttr(out, 'stroke');
      if (!st || !isNeutralColor(st) || contrastRatio(st, look.bg) < MIN_OUTLINE_CONTRAST) out = setAttr(out, 'stroke', look.neutral);
      const sw = Number.parseFloat(getAttr(out, 'stroke-width'));
      if (!(sw > 0)) out = setAttr(out, 'stroke-width', '1.5');
      if (getAttr(out, 'data-style-role') == null) out = setAttr(out, 'data-style-role', 'part');
    }
    return out === a ? all : `<${tag}${out}${self ? '/' : ''}>`;
  });
}
// 強制カラー: すべての色をシステム色にする（明るい塗りは Canvas、暗い塗りと線は CanvasText）。AC-456。
const SYSTEM = new Set(['canvas', 'canvastext', 'linktext', 'visitedtext', 'activetext', 'buttonface', 'buttontext', 'buttonborder', 'field', 'fieldtext', 'highlight', 'highlighttext', 'selecteditem', 'selecteditemtext', 'mark', 'marktext', 'graytext', 'accentcolor', 'accentcolortext', 'none', 'transparent', 'currentcolor']);
function lumOf(v) {
  const s = v.trim().toLowerCase();
  if (parseColor(s)) return luminance(s);
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (m) { const h = (n) => Number(n).toString(16).padStart(2, '0'); return luminance(`#${h(m[1])}${h(m[2])}${h(m[3])}`); }
  if (s === 'white') return 1;
  if (s === 'black') return 0;
  return null;
}
function systemColor(prop, value, tag) {
  const v = value.trim();
  if (SYSTEM.has(v.toLowerCase())) return v;
  const l = lumOf(v);
  if (prop === 'stroke') return l != null && l > 0.75 ? 'Canvas' : 'CanvasText';
  if (l == null) return prop === 'fill' && tag !== 'text' ? 'Canvas' : 'CanvasText';
  return l >= (tag === 'text' ? 0.6 : 0.35) ? 'Canvas' : 'CanvasText';
}
export function toSystemColors(svg) {
  return svg.replace(TAG_RE, (all, tag, a, self) => {
    let out = a.replace(/(\s)(fill|stroke|stop-color|color)="([^"]*)"/g, (m, sp, k, v) => `${sp}${k}="${systemColor(k, v, tag)}"`);
    out = out.replace(/(\sstyle=")([^"]*)"/g, (m, k, css) => `${k}${css.replace(/(^|;)\s*(fill|stroke|stop-color|color)\s*:\s*([^;]+)/g, (mm, sep, p, v) => `${sep}${p}:${systemColor(p, v, tag)}`)}"`);
    return out === a ? all : `<${tag}${out}${self ? '/' : ''}>`;
  });
}

// 既存の描画（整理の表示）を風の配色・紙面・書体に寄せる
function restyleLegacy(svg, look, spec) {
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const W = vb ? Number(vb[1]) : 320; const H = vb ? Number(vb[2]) : 160;
  const legacyBand = new Set(['#1346a8', '#0b5d2a', '#8a3c00', '#6b2a8f', '#9b1c1c', '#0b6070']);
  let out = svg.replace(/<rect width="100%" height="100%" fill="#ffffff"\/>/, paperSvg(look, W, H));
  out = out.replace(TAG_RE, (all, tag, a, self) => {
    if (tag === 'svg') return all;
    const r = a.replace(/(\s)(fill|stroke)="([^"]*)"/g, (m, sp, k, v) => {
      const c = v.toLowerCase();
      if (c === LEGACY_INK) return `${sp}${k}="${k === 'fill' ? look.ink : look.frame}"`;
      if (c === '#ffffff' || c === '#fff') return `${sp}${k}="${tag === 'text' ? look.bandText : k === 'fill' ? look.frameFill : look.bg}"`;
      if (legacyBand.has(c)) return `${sp}${k}="${k === 'fill' ? look.band : look.frame}"`;
      if (c === '#8a94a6') return `${sp}${k}="${look.divider}"`;
      if (c === '#f7f9fc' || c === '#fff7ed') return `${sp}${k}="${look.frameFill}"`;
      return m;
    });
    return r === a ? all : `<${tag}${r}${self ? '/' : ''}>`;
  });
  return out.replace(/<svg ([^>]*?)font-family="[^"]*"/, `<svg $1data-paper="${look.pr.paper}" data-font-kind="${look.pr.font}" font-family="${attr(fontFamilyOf(look.pr.font))}"`).replace(/data-draw-style="[^"]*"/, `data-draw-style="${attr(spec.id)}"`);
}

function markers(look) {
  return `<marker id="preset-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="${look.frame}" stroke="none"/></marker>`
    + `<marker id="preset-arrow-ink" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="${look.ink}" stroke="none"/></marker>`;
}

// アプリの描画（renderBaseSvg）の画風プリセット版。ctx は diagramModule と同じ。
export function renderPresetSvg(ctx, spec, forced, legacyBase) {
  const api = ctx.api;
  const look = forced ? forcedLook(spec) : buildLook(spec);
  if (ctx.state.displayMode === 'arrange' && api.getArrangement) return finishPresetSvg(restyleLegacy(legacyBase(), look, spec), look);
  const o = { lang: ctx.state.lang, relations: api.getDiagramRelations?.() ?? [], selectedSceneId: ctx.state.selectedSceneId, highlightPointId: api.getHighlight?.()?.pointId ?? null, t: ctx.t, emotionScenes: emotionBalloonSceneIds(api, ctx.state.scenes) };
  const level = api.getDetailLevel?.() ?? 'detail';
  const main = level !== 'detail' && ctx.state.scenes.length
    ? renderPresetTopics(api.getTopics(), api.getTopicRelations(), ctx.state.scenes, { ...o, level }, look)
    : renderPresetDiagram(ctx.state.scenes, o, look);
  const info = api.getLayoutInfo?.();
  const place = info && info.applied ? renderPresetPlacement(api.getDiagramLayout?.(), look, main.height) : { svg: '', height: 0, width: 0 };
  const W = Math.ceil(Math.max(main.width, place.width)); const H = Math.ceil(main.height + place.height);
  const title = ctx.t('app.title');
  const attrs = [`data-draw-style="${attr(spec.id)}"`];
  if (info && info.applied) attrs.push(`data-layout-types="${info.selected.join(' ')}"`, `data-layout-head="${info.head}"`);
  attrs.push(`data-paper="${look.pr.paper}"`, `data-font-kind="${look.pr.font}"`);
  const svg = `<svg ${attrs.join(' ')} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${attr(fontFamilyOf(look.pr.font))}" role="img" aria-label="${attr(title)}">`
    + `<title>${esc(title)}</title><defs>${markers(look)}</defs>${paperSvg(look, W, H)}${main.body}${place.svg}</svg>`;
  return finishPresetSvg(svg, look);
}

// アプリ組立の拡張: 画風プリセットの描画・書体の並び・強制カラー（契約: CONTRACT-STYLE-PRESET.md）
export function stylePresetModule(ctx) {
  const { api } = ctx;
  let forced = ctx.env?.forcedColors === true;
  api.getFontStacks = () => fontStacks();
  api.getForcedColors = () => forced;
  api.setForcedColors = (v) => {
    if (typeof v !== 'boolean') return { ok: false, reason: 'invalid' };
    if (v !== forced) { forced = v; ctx.emit('change', api); }
    return { ok: true };
  };
  // PNG・PDF の保存の配色は export.js の exportLook（buildLook を使う。保存は強制カラーに関係なく風の配色）
  const legacyBase = api.renderBaseSvg;
  api.renderBaseSvg = () => {
    const spec = api.getDrawStyleSpec?.();
    return spec?.preset ? renderPresetSvg(ctx, spec, forced, legacyBase) : legacyBase();
  };
  const baseRender = api.renderSvg;
  api.renderSvg = () => { const svg = baseRender(); return forced ? toSystemColors(svg) : svg; };
  // 保存用の SVG（save.svg）: 強制カラーのシステム色への変換は画面の表示だけにし、保存は風の配色で出す
  api.renderSvgForSave = () => { const was = forced; forced = false; try { return api.renderSvg(); } finally { forced = was; } };
}
