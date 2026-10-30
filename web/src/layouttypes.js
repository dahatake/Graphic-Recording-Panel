// FR-027 レイアウト型の登録構造（共通部品「レイアウト型レジストリ」）。DOM に依存しない。
// 5 つの型（タイムライン・吹き出し・発散・区画・比喩テンプレート）を登録し、型ごとの配置（layout）を差し替えられる。
// 型ごとの実装（FR-031〜035 など）は registry.register(id, { layout }) で足す。未実装の型は暫定でタイムラインの配置にフォールバックする。

export const LAYOUT_TYPE_IDS = ['timeline', 'bubble', 'diverge', 'zone', 'metaphor', 'workshop'];
export const DEFAULT_LAYOUT_TYPE = 'timeline';

// 名称ラベル（ja は全角換算 6 以内・en は半角 12 以内。型ごとに異なる）・ツールチップ・コマンド検索用の名称。
export const LAYOUT_TYPE_META = {
  timeline: {
    icon: 'M3 4h4v4H3zM13 12h4v4h-4zM7 6h6a2 2 0 0 1 2 2v4M3 12h6',
    ja: { label: 'タイムライン', tip: '話の順に左上から右下へ並べるタイムライン型で図を描きます', cmd: 'タイムライン型にする' },
    en: { label: 'Time flow', tip: 'Draw the diagram as a timeline, from top-left to bottom-right in talk order', cmd: 'Use the timeline layout' },
  },
  bubble: {
    icon: 'M3 3h14v10H9l-4 4v-4H3z',
    ja: { label: '吹き出し', tip: '要点を吹き出しの形で並べる吹き出し型で図を描きます', cmd: '吹き出し型にする' },
    en: { label: 'Bubble', tip: 'Draw the diagram with points laid out as speech bubbles', cmd: 'Use the bubble layout' },
  },
  diverge: {
    icon: 'M10 10m-2 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M10 8V3M12 10h5M10 12v5M8 10H3',
    ja: { label: '発散', tip: '中心の話題から枝を広げる発散型で図を描きます', cmd: '発散型にする' },
    en: { label: 'Diverge', tip: 'Draw the diagram branching out from a central topic', cmd: 'Use the diverge layout' },
  },
  zone: {
    icon: 'M3 3h14v14H3zM3 10h14M10 3v14',
    ja: { label: '区画', tip: 'トピックごとの区画に分けて並べる区画型で図を描きます', cmd: '区画型にする' },
    en: { label: 'Zone', tip: 'Draw the diagram divided into one zone per topic', cmd: 'Use the zone layout' },
  },
  metaphor: {
    icon: 'M2 16l5-8 3 4 3-6 5 10zM14 3m-1.500 0a1.500 1.500 0 1 0 3 0 1.500 1.500 0 1 0-3 0',
    ja: { label: '比喩', tip: '道のりや山などの比喩の背景に重ねる比喩テンプレート型で図を描きます', cmd: '比喩テンプレート型にする' },
    en: { label: 'Metaphor', tip: 'Draw the diagram over a metaphor background such as a road or a mountain', cmd: 'Use the metaphor template layout' },
  },
  // FR-091: 手書きワークショップホワイトボード（クリーム色の紙・番号付きステージ・未解決の問い・7 つのレンズの注記）
  workshop: {
    icon: 'M3 3h14v10H3zM6 16l2-3M14 16l-2-3M6 6h3v3H6zM11 6h3M11 9h3',
    ja: { label: 'ボード', tip: '手描き風のホワイトボードに、番号付きの場面と未解決の問いを並べるワークショップ型で図を描きます', cmd: 'ワークショップホワイトボード型にする' },
    en: { label: 'Workshop', tip: 'Draw the diagram as a hand-drawn workshop whiteboard with numbered stages and open questions', cmd: 'Use the workshop whiteboard layout' },
  },
};

// 2D の時系列の配置（暫定の共通実装。タイムライン型の Z 字の並び）。
// input: { level:'major'|'middle'|'detail', topics:[{id,title,sceneIds}], scenes:[{id,heading}], titleInfo }
export function timelineLayout(input) {
  const W = 1280; const M = 24; const GAP = 32; const COLS = 3; const H = 96; const TITLE_H = 48;
  const info = input.titleInfo ?? {};
  const visible = ['series', 'theme', 'date', 'venue'].some((k) => String(info[k] ?? '').trim());
  const title = { x: M, y: M, w: W - M * 2, h: TITLE_H, visible };
  // FR-036 AC-167: 各まとまり（トピック）に小見出しと外枠が付く。大項目では 1 トピック 1 単位、それ以外ではトピックごとに行を改めて並べる。
  const topicOf = new Map();
  for (const tp of input.topics) for (const id of tp.sceneIds) topicOf.set(id, tp);
  const src = input.level === 'major'
    ? input.topics.map((tp) => ({ id: tp.id, kind: 'topic', run: tp.id, heading: tp.title }))
    : input.scenes.map((sc) => ({ id: sc.id, kind: 'scene', run: topicOf.get(sc.id)?.id ?? `scene:${sc.id}`, heading: topicOf.get(sc.id)?.title ?? sc.heading }));
  const bodyY = M + TITLE_H + GAP / 2;
  const uw = Math.floor((W - M * 2 - GAP * (COLS - 1)) / COLS);
  const cells = []; let row = -1; let col = COLS; let prev = null;
  src.forEach((u, i) => {
    if (u.run !== prev || col >= COLS) { row += 1; col = 0; } // トピックが変わるか行が埋まったら次の行
    prev = u.run;
    cells.push({ ...u, order: i, row, x: M + col * (uw + GAP), y: bodyY + row * (H + GAP), w: uw, h: H });
    col += 1;
  });
  const rows = row + 1;
  const bodyH = rows ? rows * H + (rows - 1) * GAP : 0;
  const runs = []; // 連続した同じトピックの範囲 = 1 つのまとまり
  for (const c of cells) {
    const last = runs.at(-1);
    if (last && last.run === c.run) last.cells.push(c); else runs.push({ run: c.run, heading: c.heading, cells: [c] });
  }
  const seen = new Map();
  const groups = runs.map((r) => {
    const n = (seen.get(r.run) ?? 0) + 1; seen.set(r.run, n);
    const x0 = Math.min(...r.cells.map((c) => c.x)); const y0 = Math.min(...r.cells.map((c) => c.y));
    const x1 = Math.max(...r.cells.map((c) => c.x + c.w)); const y1 = Math.max(...r.cells.map((c) => c.y + c.h));
    const frame = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    return { id: n === 1 ? r.run : `${r.run}#${n}`, kind: 'topic', heading: String(r.heading ?? '').trim() || String(r.run), frame, headingRect: { x: x0 + 8, y: y0 + 4, w: x1 - x0 - 16, h: 18 }, top: y0 };
  });
  const units = cells.map(({ run, heading, row: rw, ...c }) => {
    const top = groups.find((g) => g.top === c.y && c.x >= g.frame.x && c.x + c.w <= g.frame.x + g.frame.w) ? 24 : 6; // 小見出しの下に収める
    return { ...c, x: c.x + 8, w: c.w - 16, y: c.y + top, h: c.h - top - 6 };
  });
  const arrows = units.slice(1).map((u, i) => ({ from: units[i].id, to: u.id, label: null }));
  return {
    canvas: { w: W, h: bodyY + bodyH + M }, title,
    body: { x: M, y: bodyY, w: W - M * 2, h: bodyH },
    units, arrows, orderMark: 'both', groups: groups.map(({ top, ...g }) => g), centered: false,
    titleLines: ['series', 'theme', 'date', 'venue'].map((k) => String(info[k] ?? '').trim()).filter(Boolean),
  };
}

// FR-036 AC-166・FR-079 AC-431: タイトル欄の文字（階層の最上位の大きさ fontSize）を欄の幅で折り返して並べ、
// 行が増えて欄に収まらないときは欄を高くし、本編（まとまり・単位・中心・区切り線・比喩）をその分だけ下へずらす。
// 入力 L は型の配置（timelineLayout などの返り値）。L.titleRows = [{ text, x, y（ベースライン）, w }] を足す。
const charW = (ch, size) => (ch.codePointAt(0) >= 0x2e80 ? size : size * 0.56);
export const titleTextWidth = (s, size) => [...String(s)].reduce((w, ch) => w + charW(ch, size), 0);
export const TITLE_LINE_H = 1.3; // 行の高さ（文字の大きさの倍率）
export function fitTitle(L, fontSize) {
  const t = L.title; const lines = L.titleLines ?? [];
  if (!t || !t.visible || !lines.length) { L.titleRows = []; return L; }
  const GAP_X = 24; const PAD = 6; const lh = Math.ceil(fontSize * TITLE_LINE_H);
  const rows = []; let row = 0; let x = t.x; let rowUsed = false;
  const push = (text) => {
    const w = titleTextWidth(text, fontSize);
    if (rowUsed && x + w > t.x + t.w) { row += 1; x = t.x; rowUsed = false; }
    rows.push({ text, x, row, w }); x += w + GAP_X; rowUsed = true;
  };
  for (const line of lines) {
    // 欄の幅より長い 1 項目は、文字の単位で欄の幅に収まる長さに分ける
    let cur = ''; let cw = 0;
    const parts = [];
    for (const ch of [...line]) {
      const c = charW(ch, fontSize);
      if (cur && cw + c > t.w) { parts.push(cur); cur = ''; cw = 0; }
      cur += ch; cw += c;
    }
    if (cur) parts.push(cur);
    parts.forEach((p, i) => { if (i > 0) { row += 1; x = t.x; rowUsed = false; } push(p); });
  }
  const n = row + 1;
  const need = PAD * 2 + n * lh;
  const dy = Math.max(0, need - t.h);
  L.titleRows = rows.map((r) => ({ text: r.text, x: Math.round(r.x * 10) / 10, y: t.y + PAD + r.row * lh + Math.round(fontSize * 0.95), w: Math.round(r.w * 10) / 10, size: fontSize }));
  if (dy > 0) shiftBody(L, dy);
  t.h += dy;
  return L;
}
// 本編を dy だけ下へずらす（タイトル欄より下にあるものすべて）
export function shiftBody(L, dy) {
  const sy = (o, ...ks) => { if (o) for (const k of ks) if (typeof o[k] === 'number') o[k] += dy; };
  sy(L.body, 'y'); sy(L.center, 'y');
  for (const u of L.units ?? []) sy(u, 'y');
  for (const g of L.groups ?? []) { sy(g.frame, 'y'); sy(g.headingRect, 'y'); }
  for (const d of L.dividers ?? []) sy(d, 'y1', 'y2');
  if (L.metaphor) {
    for (const e of L.metaphor.elements ?? []) sy(e, 'y');
    for (const s of L.metaphor.sections ?? []) { sy(s.frame, 'y'); sy(s.headingRect, 'y'); }
    if (L.metaphor.axes) { sy(L.metaphor.axes.x, 'y1', 'y2'); sy(L.metaphor.axes.y, 'y1', 'y2'); }
  }
  if (L.canvas) L.canvas.h += dy;
  return L;
}

// 登録簿（アプリごとに 1 つ）。
export function createLayoutTypeRegistry() {
  const impls = new Map(LAYOUT_TYPE_IDS.map((id) => [id, {}]));
  return {
    ids: () => [...LAYOUT_TYPE_IDS],
    has: (id) => typeof id === 'string' && impls.has(id),
    // 型の実装を足す（{ layout(input) }）。未知の型 ID は拒否する。
    register(id, impl) {
      if (!impls.has(id) || !impl || typeof impl !== 'object') return { ok: false, reason: 'unknown_type' };
      impls.set(id, { ...impls.get(id), ...impl });
      return { ok: true };
    },
    isImplemented: (id) => typeof impls.get(id)?.layout === 'function',
    // 型の配置。未実装の型は暫定でタイムライン相当。
    layoutFor: (id) => impls.get(id)?.layout ?? timelineLayout,
    // 先頭以外の型の特徴を重ねる処理（併用。後続の項目が登録する）。なければ何も重ねない。
    overlayFor: (id) => impls.get(id)?.overlay ?? null,
  };
}

// 型 ID の並びの検証: 配列・1 件以上・既知・重複なし。
export function validTypeList(ids, registry) {
  return Array.isArray(ids) && ids.length >= 1 && ids.every((x) => registry.has(x)) && new Set(ids).size === ids.length;
}
