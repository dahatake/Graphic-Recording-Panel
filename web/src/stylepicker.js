// FR-077 画面上部での画風（「〇〇風」）の選択（契約: tests/system/CONTRACT-FR077-078.md「画面上部での画風の選択」）。DOM に依存しない（描画は ui.js）。
// 一覧は描画スタイルの登録簿（settings.js の getDrawStyles。共通部品「描画スタイルの登録」）から毎回作り、数・名前を持たない。
// 選んだ値は FR-029 の描画スタイルの現在値（setDrawStyle）そのもの。［設定］の既定（grp.settings）は変えない。
//   - ボタン: コマンドバーの drawStyle.pick（commandbar.js の GROUPS）。現在の画風の名前を valueLabel で出す
//   - 一覧: role=listbox。開いている間は ↑↓・Home・End で候補の移動、Enter・Space で決定、Esc で取り消し（ボタンへ戻る）
//   - コマンドの検索: 登録された画風ごとに drawStyle.select.<id>。名称は「画風を選ぶ: <名前>」（登録簿の名前から作る）

import { drawStyleSpecOf } from './stylespec.js';

export const PICK = 'drawStyle.pick';
export const SELECT_PREFIX = 'drawStyle.select.';

// 一覧の寸法の見積もり（px。app.css の .drawstyle-list・.drawstyle-option とトークンに合わせる）
const VIEW = { margin: 8, gap: 4, maxW: 352, chrome: 56, listPad: 10, optPad: 20, nameLine: 21, descLine: 17, emName: 14, emDesc: 12 };
const weight = (s) => [...String(s ?? '')].reduce((n, ch) => n + (ch.codePointAt(0) >= 0x2e80 ? 1 : 0.5), 0);

// 組込みの画風の短い説明（定義に description がないときに使う。定義の description {ja,en} が優先）
const DESC = {
  handwritten: ['手描きの揺らぎのある線と白い紙面', 'Wobbly hand-drawn lines on white paper'],
  anime: ['太い輪郭線と色の淡い塗り', 'Bold outlines with soft color fills'],
  simple: ['揺らぎと絵記号を抑えた見た目', 'Clean lines without icons or wobble'],
  rpg: ['ゲームの地図と会話の窓で見せる', 'Shown as a game map with dialog windows'],
};

export function stylePickerModule(ctx) {
  const { api, state } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'drawStyle.picker.label': '画風の一覧', 'cmd.drawStyle.select': '画風を選ぶ', 'drawStyle.picker.current': '現在の画風',
      ...Object.fromEntries(Object.entries(DESC).map(([id, v]) => [`drawStyle.desc.${id}`, v[0]])),
    },
    en: {
      'drawStyle.picker.label': 'Art styles', 'cmd.drawStyle.select': 'Art style', 'drawStyle.picker.current': 'Current art style',
      ...Object.fromEntries(Object.entries(DESC).map(([id, v]) => [`drawStyle.desc.${id}`, v[1]])),
    },
  });
  const t = ctx.t;
  const lang = () => state.lang;
  const list = () => api.getDrawStyles(); // [{id,label}]（表示言語。登録の順）
  const ids = () => list().map((s) => s.id);
  const labelOf = (id) => list().find((s) => s.id === id)?.label ?? '';
  // 短い説明: 定義の description（表示言語。文字列か、FR-075 の画風の記述 {color,drawing,font,mood} なら描画の文）＞ 組込みの説明 ＞ 名前
  const textOf = (v) => {
    if (typeof v === 'string') return v.trim();
    if (v && typeof v === 'object') for (const k of ['drawing', 'mood', 'color', 'font']) if (typeof v[k] === 'string' && v[k].trim()) return v[k].trim();
    return '';
  };
  const describe = (id, label) => {
    const d = drawStyleSpecOf(api, id)?.description; // 契約の取り出し口（stylespec.js）
    const own = textOf(d) || (d && typeof d === 'object' ? textOf(d[lang()] ?? d.ja ?? d.en) : '');
    if (own) return own;
    const key = `drawStyle.desc.${id}`; const v = t(key);
    return v && v !== key ? v : label;
  };

  // ---- 一覧の状態（画面の状態。保存しない） ----
  let open = false;
  let focus = null; // 'button' | 'list' | null
  let activeId = null;
  const notify = () => ctx.emit('change', api);
  const openList = () => { open = true; focus = 'list'; activeId = api.getDrawStyle(); notify(); };
  const closeList = (to = 'button') => { open = false; focus = to; activeId = null; notify(); };

  api.getDrawStylePicker = () => {
    const current = api.getDrawStyle();
    return {
      open, focus, current, activeId: open ? activeId : null, role: 'listbox', label: t('drawStyle.picker.label'),
      options: list().map((s) => ({ id: s.id, label: s.label, description: describe(s.id, s.label), selected: s.id === current, selectedMark: s.id === current ? 'check' : null })),
    };
  };
  // 狭い画面・低い画面（AC-417）: 一覧は 1 列の縦並び（説明は折り返す）。ボタンの下に入りきらず上の方が広いときは上に開き、
  // 高さの上限は「画面の高さ − 一覧の上端 − 余白」。入りきらない分は一覧の中の縦スクロールとキーで届く。
  // opts: { viewportWidth, viewportHeight, anchor:{x,y,w,h}（ボタンの外形。省略時はコマンドバーの見積もり） }
  api.getDrawStylePickerView = (opts = {}) => {
    const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
    const vw = num(opts.viewportWidth ?? ctx.env.viewportWidth, 1280);
    const vh = num(opts.viewportHeight ?? ctx.env.viewportHeight, 720);
    const M = VIEW.margin;
    let a = opts.anchor;
    if (!a) { // 見積もり（コマンドバーの外形）。ボタンが画面の外なら、押せる位置（画面の上端）まで送られている前提で置く
      a = api.getCommandBarLayout?.({ viewportWidth: vw }).items.find((i) => i.command === PICK)?.rect ?? { x: M, y: M, w: 0, h: 0 };
      if (a.y < 0 || a.y + a.h > vh) a = { ...a, y: M };
    }
    const width = Math.max(1, Math.min(VIEW.maxW, vw - M * 2));
    const left = Math.max(M, Math.min(a.x, vw - M - width));
    const inner = Math.max(1, width - VIEW.chrome); // 名前・説明の欄の幅
    const p = api.getDrawStylePicker();
    const heights = p.options.map((o) => VIEW.optPad + VIEW.nameLine * Math.max(1, Math.ceil((weight(o.label) * VIEW.emName) / inner)) + VIEW.descLine * Math.max(1, Math.ceil((weight(o.description) * VIEW.emDesc) / inner)));
    const content = heights.reduce((x, y) => x + y, 0) + VIEW.listPad;
    const below = vh - (a.y + a.h + VIEW.gap) - M;
    const above = a.y - VIEW.gap - M;
    const placement = below >= content || below >= above ? 'below' : 'above';
    const maxHeight = Math.max(0, Math.min(content, placement === 'below' ? below : above));
    const top = placement === 'below' ? a.y + a.h + VIEW.gap : a.y - VIEW.gap - maxHeight;
    const inside = top >= 0 && top + maxHeight <= vh && left >= 0 && left + width <= vw;
    const reachable = inside && maxHeight >= Math.max(0, ...heights) + VIEW.listPad; // 候補が 1 つ以上見え、残りは縦のスクロールとキーで届く
    const scrollsHorizontally = !(left >= 0 && left + width <= vw) || p.options.some((o) => Math.max(...[...o.label].map((ch) => weight(ch) * VIEW.emName)) > inner);
    return { placement, top, left, width, maxHeight, scrollsVertically: maxHeight < content, columns: 1, scrollsHorizontally, options: p.options.map((o) => ({ id: o.id, reachable })) };
  };
  // 一覧の項目のクリック相当。選んで閉じ、ボタンへフォーカスを戻す。登録にない値・非文字列は何も変えない
  api.pickDrawStyle = (id) => {
    if (typeof id !== 'string' || !ids().includes(id)) return { ok: false, reason: 'invalid' };
    open = false; focus = 'button'; activeId = null;
    const r = api.setDrawStyle(id); // 現在値の更新・図の再描画・読み上げ対象のメッセージ（「描画スタイル: <名前>」）
    return r.ok ? { ok: true } : r;
  };
  api.closeDrawStylePicker = (to = null) => { if (open) closeList(to); }; // 一覧の外へフォーカスが移ったとき（ui.js）

  ctx.registerCommand(PICK, () => { if (open) closeList('button'); else openList(); });
  ctx.registerKey({ key: 's', alt: true, shift: true, command: PICK }); // Alt+Shift+S（Style）

  // ---- コマンドの検索: 画風ごとのコマンド（登録が増えたら足す） ----
  const syncSelect = () => {
    for (const id of ids()) { const name = `${SELECT_PREFIX}${id}`; if (typeof api.commands[name] !== 'function') ctx.registerCommand(name, () => api.pickDrawStyle(id)); }
  };
  syncSelect();
  const baseRegister = api.registerDrawStyle;
  api.registerDrawStyle = (def) => { const r = baseRegister(def); if (r.ok) syncSelect(); return r; };
  const baseSearch = api.searchCommands;
  api.searchCommands = (query) => {
    syncSelect();
    const base = baseSearch(query).filter((c) => !c.command.startsWith(SELECT_PREFIX));
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return base;
    const hits = list().map((s) => ({ command: `${SELECT_PREFIX}${s.id}`, label: `${t('cmd.drawStyle.select')}: ${s.label}` }))
      .filter((c) => c.label.toLowerCase().includes(q));
    return [...base, ...hits];
  };

  // ---- キー: 一覧が開いている間だけ、修飾なしの ↑↓ Home End Enter Space Esc を一覧で使う ----
  const baseKey = api.handleKey;
  api.handleKey = (ev) => {
    if (open && !ev?.ctrlKey && !ev?.altKey && !ev?.shiftKey) {
      const all = ids();
      const i = Math.max(0, all.indexOf(activeId));
      const move = (j, name) => { activeId = all[Math.min(all.length - 1, Math.max(0, j))]; notify(); return name; };
      switch (String(ev?.key ?? '')) {
        case 'ArrowDown': return move(i + 1, 'drawStyle.pick.next');
        case 'ArrowUp': return move(i - 1, 'drawStyle.pick.prev');
        case 'Home': return move(0, 'drawStyle.pick.first');
        case 'End': return move(all.length - 1, 'drawStyle.pick.last');
        case 'Enter': case ' ': api.pickDrawStyle(activeId); return 'drawStyle.pick.choose';
        case 'Escape': closeList('button'); return 'drawStyle.pick.cancel';
        default: break;
      }
    }
    return baseKey(ev);
  };

  // ---- コマンドバー: 現在の画風の名前と、一覧の開閉の状態 ----
  const baseBar = api.getCommandBar;
  api.getCommandBar = () => {
    const bar = baseBar();
    return { ...bar, items: bar.items.map((it) => (it.command === PICK ? { ...it, valueLabel: labelOf(api.getDrawStyle()), hasPopup: 'listbox', expanded: open } : it)) };
  };
}
