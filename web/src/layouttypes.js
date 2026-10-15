// FR-027 レイアウト型の登録構造（共通部品「レイアウト型レジストリ」）。DOM に依存しない。
// 5 つの型（タイムライン・吹き出し・発散・区画・比喩テンプレート）を登録し、型ごとの配置（layout）を差し替えられる。
// 型ごとの実装（FR-031〜035 など）は registry.register(id, { layout }) で足す。未実装の型は暫定でタイムラインの配置にフォールバックする。

export const LAYOUT_TYPE_IDS = ['timeline', 'bubble', 'diverge', 'zone', 'metaphor'];
export const DEFAULT_LAYOUT_TYPE = 'timeline';

// 名称ラベル（ja は全角換算 6 以内・en は半角 12 以内。型ごとに異なる）・ツールチップ・コマンド検索用の名称。
export const LAYOUT_TYPE_META = {
  timeline: {
    icon: 'M3 4h4v4H3zM13 12h4v4h-4zM7 6h6a2 2 0 0 1 2 2v4M3 12h6',
    ja: { label: 'タイムライン', tip: '話の順に左上から右下へ並べるタイムライン型で図を描きます', cmd: 'タイムライン型にする' },
    en: { label: 'Timeline', tip: 'Draw the diagram as a timeline, from top-left to bottom-right in talk order', cmd: 'Use the timeline layout' },
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
};

// 2D の時系列の配置（暫定の共通実装。タイムライン型の Z 字の並び）。
// input: { level:'major'|'middle'|'detail', topics:[{id,title,sceneIds}], scenes:[{id,heading}], titleInfo }
export function timelineLayout(input) {
  const W = 1280; const M = 24; const GAP = 32; const COLS = 3; const H = 96; const TITLE_H = 48;
  const info = input.titleInfo ?? {};
  const visible = ['series', 'theme', 'date', 'venue'].some((k) => String(info[k] ?? '').trim());
  const title = { x: M, y: M, w: W - M * 2, h: TITLE_H, visible };
  const src = input.level === 'major'
    ? input.topics.map((tp) => ({ id: tp.id, kind: 'topic' }))
    : input.scenes.map((sc) => ({ id: sc.id, kind: 'scene' }));
  const bodyY = M + TITLE_H + GAP / 2;
  const uw = Math.floor((W - M * 2 - GAP * (COLS - 1)) / COLS);
  const units = src.map((u, i) => ({ ...u, order: i, x: M + (i % COLS) * (uw + GAP), y: bodyY + Math.floor(i / COLS) * (H + GAP), w: uw, h: H }));
  const rows = Math.ceil(units.length / COLS);
  const bodyH = rows ? rows * H + (rows - 1) * GAP : 0;
  const arrows = units.slice(1).map((u, i) => ({ from: units[i].id, to: u.id, label: null }));
  return {
    canvas: { w: W, h: bodyY + bodyH + M }, title,
    body: { x: M, y: bodyY, w: W - M * 2, h: bodyH },
    units, arrows, orderMark: 'both', groups: [], centered: false,
  };
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
