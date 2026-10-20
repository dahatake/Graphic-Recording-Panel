// FR-075 画風プリセット（描画スタイルの定義の拡張）と FR-076 組み込みの 9 つの「〇〇風」。DOM に依存しない。
// 契約: tests/system/CONTRACT-STYLE-PRESET.md。定義の値は要求定義書 3.6 の表（色名）から、AC-410 の判読性を満たすように決めた。
// 見た目の項目（すべて任意。1 つでも持てば画風プリセット）:
//   palette { background, primary, accent:[1 件以上], text, secondary }（#rgb / #rrggbb）
//   paper 'plain'|'grid'|'ruled'|'chalkboard'|'whiteboard'|'kraft' ／ font 'handwriting'|'roundGothic'|'gothic'
//   headingDecoration 'band'|'marker'|'sticky'|'classic' ／ balloon 'cloud'|'rounded'|'sticky'
//   stroke { wobble>=0（0 で揺らぎなし）, width>0（px）} ／ figures:boolean（線画人物）／ icons:boolean（絵記号）
//   description { ja:{color,drawing,font,mood}, en:{…} }（画風の記述。見た目は変えない。FR-078 の画像生成プロンプトが使う）

export const PAPERS = ['plain', 'grid', 'ruled', 'chalkboard', 'whiteboard', 'kraft'];
export const FONT_KINDS = ['handwriting', 'roundGothic', 'gothic'];
export const HEADING_DECORATIONS = ['band', 'marker', 'sticky', 'classic'];
export const BALLOON_SHAPES = ['cloud', 'rounded', 'sticky'];
export const PALETTE_ROLES = ['background', 'primary', 'accent', 'text', 'secondary'];
export const DESCRIPTION_AXES = ['color', 'drawing', 'font', 'mood'];
export const VISUAL_KEYS = ['palette', 'paper', 'font', 'headingDecoration', 'balloon', 'stroke', 'figures', 'icons'];
// PARAM-007: 本文の文字の最小コントラスト比。PARAM-083: 要点の枠・吹き出しの輪郭と紙面の最小コントラスト比。
export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_OUTLINE_CONTRAST = 3;

// NFR-UX-012 日本語の文字の書体（Yu Gothic UI）。書体の指定の並びは、従来の並びにあった欧文専用の書体（PARAM-093。従来の順のまま）
// → Yu Gothic UI → 従来の並びの残り（日本語の字形を持ち得る書体。従来の順のまま）。Yu Gothic UI より前に日本語の字形を持ち得る書体
// （総称の書体・システムの書体のキーワード・日本語の書体）を置かない。書体は同梱せず外部からも取得しない（NFR-OFFLINE-001）。
export const JP_FONT = 'Yu Gothic UI';
// PARAM-093: 欧文専用の書体の一覧（書体の指定で Yu Gothic UI より前に置いてよい書体）
export const LATIN_ONLY_FONTS = ['Segoe UI', 'Segoe UI Variable', 'Segoe Print', 'Ink Free', 'Arial Rounded MT Bold'];
const LATIN_SET = new Set(LATIN_ONLY_FONTS.map((n) => n.toLowerCase()));
export const isLatinOnlyFont = (name) => LATIN_SET.has(String(name).trim().toLowerCase());
// 従来の並び（書体名の配列、または { name } の配列）を NFR-UX-012 の並びにする。jp は Yu Gothic UI の要素（既にあればそれを使う）。
export function jpFontOrder(list, jp) {
  const nameOf = (x) => (typeof x === 'string' ? x : x.name);
  const yu = list.find((x) => nameOf(x) === JP_FONT) ?? jp ?? JP_FONT;
  const rest = list.filter((x) => nameOf(x) !== JP_FONT);
  return [...rest.filter((x) => isLatinOnlyFont(nameOf(x))), yu, ...rest.filter((x) => !isLatinOnlyFont(nameOf(x)))];
}
const quoteFont = (name) => (/\s/.test(name) ? `'${name}'` : name);
// 書体名の並び → CSS・SVG・Canvas の書体の指定の値（空白を含む名前は引用符で囲む）
export const fontFamilyValue = (names) => names.map(quoteFont).join(', ');
// 既存の 4 つの描画スタイル（手書き調・アニメ調・シンプル・RPG風）の図（SVG）・PNG・PDF・RPG風の地図の文字の書体の指定（NFR-UX-012 AC-466）
export const LEGACY_FONT_NAMES = jpFontOrder(['system-ui', 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', 'sans-serif']);
export const LEGACY_FONT_FAMILY = fontFamilyValue(LEGACY_FONT_NAMES);

// 書体の系統ごとの並び（端末に入っている書体の名前だけ。書体のファイルは同梱せず外部からも取得しない）。
// 手書き風 → 丸ゴシック → 端末の標準の書体、丸ゴシック → 端末の標準の書体 の順に、ブラウザが最初に見つかったものを使う。
// 日本語の字形は、欧文専用の書体の次の Yu Gothic UI が先に受け持つ（NFR-UX-012。系統の順は欧文専用の書体どうし・残りどうしで保つ）。
const HAND = [['Klee One', 'handwriting'], ['Klee', 'handwriting'], ['Yomogi', 'handwriting'], ['Zen Kurenaido', 'handwriting'], ['Segoe Print', 'handwriting'], ['Ink Free', 'handwriting']];
const ROUND = [['Zen Maru Gothic', 'roundGothic'], ['M PLUS Rounded 1c', 'roundGothic'], ['Kosugi Maru', 'roundGothic'], ['Hiragino Maru Gothic ProN', 'roundGothic'], ['Arial Rounded MT Bold', 'roundGothic']];
const GOTHIC = [['BIZ UDPGothic', 'gothic'], ['Hiragino Sans', 'gothic'], ['Yu Gothic UI', 'gothic'], ['Meiryo', 'gothic'], ['Noto Sans JP', 'gothic']];
const GENERIC = [['sans-serif', 'generic']];
const toStack = (list) => jpFontOrder(list.map(([name, kind]) => ({ name, kind })), { name: JP_FONT, kind: 'gothic' });
export const FONT_STACKS = {
  handwriting: toStack([...HAND, ...ROUND, ...GENERIC]),
  roundGothic: toStack([...ROUND, ...GENERIC]),
  gothic: toStack([...GOTHIC, ...GENERIC]),
};
export const fontStacks = () => JSON.parse(JSON.stringify(FONT_STACKS));
// SVG の font-family 属性の値（空白を含む名前は引用符で囲む）
export const fontFamilyOf = (kind) => fontFamilyValue((FONT_STACKS[kind] ?? FONT_STACKS.gothic).map((f) => f.name));

// ---- 色 ----
export function parseColor(c) {
  if (typeof c !== 'string') return null;
  const s = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [0, 1, 2].map((i) => parseInt(m[1][i] + m[1][i], 16));
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return null;
}
export const isColor = (c) => parseColor(c) != null;
export function luminance(c) {
  const v = parseColor(c);
  if (!v) return 0;
  const [r, g, b] = v.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const hex = (v) => `#${v.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
// c を w に t の割合で混ぜる（t=1 で c、t=0 で w）
export function mix(c, w, t) {
  const a = parseColor(c); const b = parseColor(w);
  if (!a || !b) return c;
  return hex(a.map((x, i) => x * t + b[i] * (1 - t)));
}
// 輝度を保った無彩色（単色の風で、部品の色を白黒に寄せる）
export function grayOf(c) {
  const v = parseColor(c);
  if (!v) return c;
  const y = Math.round(0.299 * v[0] + 0.587 * v[1] + 0.114 * v[2]);
  return hex([y, y, y]);
}
export function isNeutralColor(c) { const v = parseColor(c); return !!v && Math.max(...v) - Math.min(...v) <= 24; }
// 黄色系（黄の面には必ず黒かグレーの輪郭線を付ける。AC-410・AC-411）。判定は広めにとる。
export function isYellowish(c) {
  const v = parseColor(c);
  if (!v) return false;
  const [r, g, b] = v.map((x) => x / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
  if (!max || d / max < 0.35 || max < 0.6) return false;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return h >= 35 && h <= 72;
}

// ---- 定義の検証（FR-075 AC-405） ----
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const hasVisualFields = (def) => isObj(def) && VISUAL_KEYS.some((k) => def[k] !== undefined);
// 持っている項目だけを確かめる。{ ok:true } か { ok:false, reason }。
export function validatePresetFields(def) {
  if (!isObj(def)) return { ok: true };
  if (def.palette !== undefined) {
    const p = def.palette;
    if (!isObj(p)) return { ok: false, reason: 'invalid_palette' };
    for (const k of ['background', 'primary', 'text', 'secondary']) if (!isColor(p[k])) return { ok: false, reason: 'invalid_palette' };
    if (!Array.isArray(p.accent) || !p.accent.length || !p.accent.every(isColor)) return { ok: false, reason: 'invalid_palette' };
    if (contrastRatio(p.text, p.background) < MIN_TEXT_CONTRAST) return { ok: false, reason: 'low_contrast' };
  }
  if (def.paper !== undefined && !PAPERS.includes(def.paper)) return { ok: false, reason: 'invalid_paper' };
  if (def.font !== undefined && !FONT_KINDS.includes(def.font)) return { ok: false, reason: 'invalid_font' };
  if (def.headingDecoration !== undefined && !HEADING_DECORATIONS.includes(def.headingDecoration)) return { ok: false, reason: 'invalid_heading' };
  if (def.balloon !== undefined && !BALLOON_SHAPES.includes(def.balloon)) return { ok: false, reason: 'invalid_balloon' };
  if (def.stroke !== undefined && (!isObj(def.stroke) || !(isNum(def.stroke.wobble) && def.stroke.wobble >= 0) || !(isNum(def.stroke.width) && def.stroke.width > 0))) return { ok: false, reason: 'invalid_stroke' };
  if (def.figures !== undefined && typeof def.figures !== 'boolean') return { ok: false, reason: 'invalid_figures' };
  if (def.icons !== undefined && typeof def.icons !== 'boolean') return { ok: false, reason: 'invalid_icons' };
  if (def.description !== undefined) {
    const d = def.description;
    const axesOk = (o) => isObj(o) && DESCRIPTION_AXES.every((a) => typeof o[a] === 'string' && o[a].trim());
    if (!isObj(d) || !Object.keys(d).length || !Object.values(d).every(axesOk)) return { ok: false, reason: 'invalid_description' };
  }
  return { ok: true };
}

// 画風プリセットの見た目（欠けている項目は既定値で補う）。見た目の項目を持たない定義は null。
export function presetOf(def) {
  if (!hasVisualFields(def)) return null;
  const line = def.line ?? { width: 1, jitter: 0 };
  return {
    palette: def.palette ?? { background: '#ffffff', primary: '#1a1a1a', accent: ['#1a1a1a'], text: '#1a1a1a', secondary: '#9e9e9e' },
    paper: def.paper ?? 'plain',
    font: def.font ?? 'gothic',
    headingDecoration: def.headingDecoration ?? 'classic',
    balloon: def.balloon ?? 'rounded',
    stroke: def.stroke ?? { wobble: line.jitter, width: Math.max(0.5, 2 * line.width) },
    figures: def.figures ?? false,
    icons: def.icons ?? def.text?.icons ?? true,
  };
}

// ---- 組み込みの 9 つの風（3.6 の表。名前は日本語 6 文字・英語 12 文字以内） ----
const legacy = (width, jitter, decor) => ({ line: { width, jitter }, fill: { mode: 'paper' }, text: { decor, icons: true } });
const d = (color, drawing, font, mood) => ({ color, drawing, font, mood });
export const PRESET_STYLES = [
  {
    id: 'yellowBlack', label: { ja: '黄黒手書き風', en: 'Yellow Black' }, ...legacy(1.3, 1, 'bold'),
    palette: { background: '#ffffff', primary: '#1a1a1a', accent: ['#ffd400'], text: '#1a1a1a', secondary: '#9e9e9e' },
    paper: 'plain', font: 'handwriting', headingDecoration: 'band', balloon: 'cloud', stroke: { wobble: 1, width: 3.2 }, figures: true, icons: true,
    description: {
      ja: d('白い紙に黄色・黒・グレーの 3 色。黄色は強調・吹き出し・アイコンの塗り、黒は文字と枠、グレーは区切り線と影', '揺らぎのある太めの手描きの線。黄色い雲形の吹き出しに黒の輪郭線。丸い頭と細い線のシンプルな人物の線画と小さなアイコン', '手書き風の柔らかく少し太めで丸みのある文字。見出しは黒い帯に白抜きの文字', 'やさしく温かく親しみやすい'),
      en: d('Three colors on white paper: yellow, black and gray. Yellow for highlights, speech balloons and icon fills, black for text and frames, gray for dividers and shadows', 'Bold hand-drawn lines with a slight wobble. Yellow cloud speech balloons with black outlines. Simple line-art people with round heads and thin lines, plus small icons', 'Soft, slightly bold and rounded handwritten lettering. Headings in white letters on black bands', 'Gentle, warm and friendly'),
    },
  },
  {
    id: 'chalkboard', label: { ja: '黒板風', en: 'Chalkboard' }, ...legacy(1.2, 1, 'bold'),
    palette: { background: '#1e3d2f', primary: '#f4f4ee', accent: ['#ffe066', '#ff9ecb', '#8fd3ff'], text: '#f4f4ee', secondary: '#a9b8b0' },
    paper: 'chalkboard', font: 'handwriting', headingDecoration: 'marker', balloon: 'rounded', stroke: { wobble: 1.2, width: 3 }, figures: true, icons: true,
    description: {
      ja: d('濃い緑の黒板に白いチョーク。強調は黄・ピンク・水色の色チョーク、薄い白の消し跡', 'やや太めで揺らぎのあるチョークの線。粉っぽい質感。チョークで描いた角丸の吹き出しと人物の線画・絵記号', '手書き風のチョークの文字。見出しはチョークの下線で強調', '授業のような親しみ'),
      en: d('White chalk on a dark green chalkboard. Yellow, pink and light blue colored chalk for emphasis, with faint white eraser marks', 'Slightly thick, wobbly chalk lines with a dusty texture. Rounded chalk speech balloons, line-art people and pictograms', 'Handwritten chalk lettering. Headings underlined with chalk', 'Friendly, like a classroom lesson'),
    },
  },
  {
    id: 'stickyNotes', label: { ja: '付箋ボード風', en: 'Sticky Notes' }, ...legacy(1, 0.8, 'standard'),
    palette: { background: '#fafafa', primary: '#1f5fbf', accent: ['#ffe45c', '#ffb3cf', '#a8dcff'], text: '#1b1b1b', secondary: '#9a9a9a' },
    paper: 'whiteboard', font: 'handwriting', headingDecoration: 'sticky', balloon: 'sticky', stroke: { wobble: 0.8, width: 2.2 }, figures: false, icons: true,
    description: {
      ja: d('白いホワイトボードに青のマーカー。黄・ピンク・水色の付箋、グレーの付箋の影と折り目', '中くらいの太さで少し揺らぐマーカーの線。付箋を重ねて貼った吹き出しと見出し。人物はなく絵記号を添える', '手書き風のマーカーの文字', '会議室のブレインストーミング'),
      en: d('Blue marker on a white whiteboard. Yellow, pink and light blue sticky notes with gray shadows and folds', 'Medium, slightly wobbly marker lines. Headings and speech balloons on layered sticky notes. No people, with pictograms', 'Handwritten marker lettering', 'A brainstorming session in a meeting room'),
    },
  },
  {
    id: 'colorPencil', label: { ja: '色鉛筆風', en: 'Color Pencil' }, ...legacy(0.7, 1.4, 'standard'),
    palette: { background: '#ffffff', primary: '#2f5fa7', accent: ['#d64545', '#e8892b'], text: '#3a3a3a', secondary: '#a9c6e8' },
    paper: 'ruled', font: 'handwriting', headingDecoration: 'marker', balloon: 'rounded', stroke: { wobble: 1.6, width: 1.4 }, figures: true, icons: true,
    description: {
      ja: d('薄い青の罫線のノートに青の色鉛筆。強調は赤・橙の色鉛筆、文字は濃いグレーの鉛筆', '細めで揺らぎの大きい色鉛筆の線。角丸の吹き出し、人物の線画と絵記号', '手書き風の少し歪んだ鉛筆の文字。見出しは色鉛筆の下線で強調', '柔らかい手描きのノート'),
      en: d('Blue colored pencil on a notebook with light blue ruled lines. Red and orange pencil for emphasis, dark gray pencil for text', 'Thin, noticeably wobbly colored-pencil lines. Rounded speech balloons, line-art people and pictograms', 'Slightly uneven handwritten pencil lettering. Headings underlined in colored pencil', 'A soft hand-drawn notebook'),
    },
  },
  {
    id: 'mintNote', label: { ja: 'ミント風', en: 'Mint Note' }, ...legacy(1, 0.4, 'bold'),
    palette: { background: '#bfe8d6', primary: '#3a3f44', accent: ['#f2727f'], text: '#33383d', secondary: '#ffffff' },
    paper: 'grid', font: 'roundGothic', headingDecoration: 'marker', balloon: 'rounded', stroke: { wobble: 0.4, width: 2.2 }, figures: false, icons: true,
    description: {
      ja: d('ミントグリーンの方眼紙に、コーラルピンク・白・チャコールグレー', '揺らぎの小さい中くらいの線。ノートの切り抜き風の破線の枠の角丸の吹き出し。人物はなく絵記号を添える', '丸ゴシック。見出しは太めの文字にマーカーの下線', '明るくクリアなノート'),
      en: d('Mint green grid paper with coral pink, white and charcoal gray', 'Medium lines with a slight wobble. Rounded speech balloons with dashed, cut-out style frames. No people, with pictograms', 'Rounded gothic type. Bold headings with a marker underline', 'A bright, clear notebook'),
    },
  },
  {
    id: 'business', label: { ja: 'ビジネス風', en: 'Business' }, ...legacy(0.6, 0, 'standard'),
    palette: { background: '#ffffff', primary: '#0f5c63', accent: ['#ff6b1a'], text: '#333a40', secondary: '#ff8a7a' },
    paper: 'plain', font: 'gothic', headingDecoration: 'band', balloon: 'rounded', stroke: { wobble: 0, width: 1.4 }, figures: false, icons: true,
    description: {
      ja: d('白い背景に濃いティールを主に、ビビッドオレンジとコーラルを差し色', '揺らぎのない細いクリーンな線と角丸の枠。簡素なモダンなアイコン。余白を多くとる', 'ゴシック。見出しは濃いティールの帯に白抜きの文字', '余白が多く洗練されたビジネス向け'),
      en: d('White background with dark teal as the main color and vivid orange and coral accents', 'Thin, clean lines without wobble and rounded frames. Simple modern icons with plenty of white space', 'Gothic sans-serif type. Headings in white letters on dark teal bands', 'Refined and business-like, with generous white space'),
    },
  },
  {
    id: 'minimal', label: { ja: 'ミニマル風', en: 'Minimal' }, ...legacy(0.5, 0, 'plain'),
    palette: { background: '#ffffff', primary: '#111111', accent: ['#111111'], text: '#111111', secondary: '#d6d6d6' },
    paper: 'plain', font: 'gothic', headingDecoration: 'classic', balloon: 'rounded', stroke: { wobble: 0, width: 1.2 }, figures: false, icons: true,
    description: {
      ja: d('白い背景に黒の単色と薄いグレー。強調は色ではなく太さと枠で示す', '揺らぎのない細い線と角丸の枠。単色のアイコン。余白を多くとる', 'ゴシック。見出しは太字', '余白が多く簡潔'),
      en: d('Monochrome black and light gray on a white background. Emphasis is shown by weight and frames, not color', 'Thin lines without wobble and rounded frames. Single-color icons with plenty of white space', 'Gothic sans-serif type. Bold headings', 'Simple and spacious'),
    },
  },
  {
    id: 'popColor', label: { ja: 'ポップ風', en: 'Pop Color' }, ...legacy(1.4, 0, 'bold'),
    palette: { background: '#ffffff', primary: '#1d4ed8', accent: ['#e63946', '#ffd60a'], text: '#111111', secondary: '#2a9d4b' },
    paper: 'plain', font: 'roundGothic', headingDecoration: 'band', balloon: 'cloud', stroke: { wobble: 0, width: 3.4 }, figures: true, icons: true,
    description: {
      ja: d('白い背景に原色の青・赤・黄と緑', '揺らぎのない太い線。ポップアート風の枠と雲形の吹き出し。人物の線画と原色のアイコン', '丸ゴシック。見出しは青い帯に白抜きの文字', '明るく元気'),
      en: d('Primary blue, red and yellow with green on a white background', 'Thick lines without wobble. Pop-art style frames and cloud speech balloons. Line-art people and primary-colored icons', 'Rounded gothic type. Headings in white letters on blue bands', 'Bright and energetic'),
    },
  },
  {
    id: 'kraftPaper', label: { ja: 'クラフト紙風', en: 'Kraft Paper' }, ...legacy(1, 1, 'standard'),
    palette: { background: '#c8a27a', primary: '#5a3a1e', accent: ['#ffffff', '#c0392b'], text: '#2b1a0e', secondary: '#e8d8bf' },
    paper: 'kraft', font: 'handwriting', headingDecoration: 'sticky', balloon: 'sticky', stroke: { wobble: 1, width: 2.2 }, figures: true, icons: true,
    description: {
      ja: d('茶色のクラフト紙にこげ茶。差し色は白と赤、ベージュを補助に使う', '中くらいの太さで揺らぐ線。手で切ったような縁取りの付箋の見出しと吹き出し。人物の線画と絵記号', '手書き風の文字', '温かい手作り'),
      en: d('Dark brown on brown kraft paper, with white and red accents and beige as a support color', 'Medium, wobbly lines. Headings and speech balloons on sticky notes with hand-torn edges. Line-art people and pictograms', 'Handwritten lettering', 'Warm and handmade'),
    },
  },
];
