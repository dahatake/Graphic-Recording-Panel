// FR-077 画面上部での画風（「〇〇風」）の選択（契約: tests/system/CONTRACT-2026-11-04.md §2）。DOM に依存しない（描画は ui.js）。
// 画風は描画スタイルの登録簿（settings.js の getDrawStyles。共通部品「描画スタイルの登録」）から毎回作り、数・名前を持たない。
// 選んだ値は FR-029 の描画スタイルの現在値（setDrawStyle）そのもの。［設定］の既定（grp.settings）は変えない。
//   - 常時表示のリボン「画風」グループ（commandbar.js の GROUPS）の各項目 = 通常ボタン + aria-pressed。コマンドは drawStyle.set:<id>
//   - ここでは、そのコマンドの登録（登録簿が増えたら足す）・検索・押下（pressed）と短い説明の付与だけを行う。一覧・開閉・専用キーはない
//   - 旧 drawStyle.pick・drawStyle.select.<id>・一覧（listbox）・Alt+Shift+S は廃止

export const SET_PREFIX = 'drawStyle.set:';
export const DESC_SHORT_MAX = 40; // PARAM-170: 画風の短い説明の最大の長さ

const weight = (s) => [...String(s ?? '')].reduce((n, ch) => n + (ch.codePointAt(0) >= 0x2e80 ? 1 : 0.5), 0);

// 組込みの画風の短い説明（既存の 4 つはこれを使う。それ以外は定義の description {ja,en} が優先）
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
      'cmd.drawStyle.select': '画風を選ぶ',
      ...Object.fromEntries(Object.entries(DESC).map(([id, v]) => [`drawStyle.desc.${id}`, v[0]])),
    },
    en: {
      'cmd.drawStyle.select': 'Art style',
      ...Object.fromEntries(Object.entries(DESC).map(([id, v]) => [`drawStyle.desc.${id}`, v[1]])),
    },
  });
  const t = ctx.t;
  const lang = () => state.lang;
  const list = () => api.getDrawStyles(); // [{id,label}]（表示言語。登録の順）
  const ids = () => list().map((s) => s.id);
  // 短い説明: 定義の description（表示言語。文字列か、FR-075 の画風の記述 {color,drawing,font,mood} なら描画の文）＞ 組込みの説明 ＞ 名前
  const textOf = (v) => {
    if (typeof v === 'string') return v.trim();
    if (v && typeof v === 'object') for (const k of ['drawing', 'mood', 'color', 'font']) if (typeof v[k] === 'string' && v[k].trim()) return v[k].trim();
    return '';
  };
  // PARAM-170: 短い説明の最大の長さ（日本語の文字数。英語は半角で 2 倍）。長いときは最初の文にし、なお超えるときは切り詰める
  const shortOf = (s) => {
    const first = s.split(/(?<=[。.])\s*/)[0].replace(/[。.]$/, '').trim() || s;
    if (weight(first) <= DESC_SHORT_MAX) return first;
    let out = ''; let w = 0;
    for (const ch of first) { const cw = ch.codePointAt(0) >= 0x2e80 ? 1 : 0.5; if (w + cw > DESC_SHORT_MAX - 1) break; out += ch; w += cw; }
    return `${out.trimEnd()}…`;
  };
  // FR-078: 既存の 4 つは画像生成用の画風の記述（長い文）を持つが、短い説明は組込みの説明（DESC）を優先して変えない
  const describe = (id, label) => {
    if (Object.hasOwn(DESC, id)) return t(`drawStyle.desc.${id}`);
    const d = api.getDrawStyleSpec?.(id)?.description; // 契約の getDrawStyleSpec(id)（FR-075。画風の記述 {ja:{color,drawing,font,mood}}）
    const own = textOf(d) || (d && typeof d === 'object' ? textOf(d[lang()] ?? d.ja ?? d.en) : '');
    if (own) return shortOf(own);
    const key = `drawStyle.desc.${id}`; const v = t(key);
    return v && v !== key ? v : label;
  };
  // commandbar.js がリボンの項目の説明（description・tooltip）に使う
  api.getDrawStyleShortText = (id) => { const s = list().find((x) => x.id === id); return s ? describe(id, s.label) : ''; };

  // ---- コマンド: 登録簿の画風ごとに drawStyle.set:<id>（登録が増えたら足す）。実行は setDrawStyle と同じ ----
  const syncSet = () => {
    for (const id of ids()) { const name = `${SET_PREFIX}${id}`; if (typeof api.commands[name] !== 'function') ctx.registerCommand(name, () => api.setDrawStyle(id)); }
  };
  syncSet();
  const baseRegister = api.registerDrawStyle;
  api.registerDrawStyle = (def) => { const r = baseRegister(def); if (r.ok) syncSet(); return r; };

  // ---- コマンドの検索: 「画風を選ぶ: <名前>」 ----
  const baseSearch = api.searchCommands;
  api.searchCommands = (query) => {
    syncSet();
    const base = baseSearch(query).filter((c) => !c.command.startsWith(SET_PREFIX));
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return base;
    const hits = list().map((s) => ({ command: `${SET_PREFIX}${s.id}`, label: `${t('cmd.drawStyle.select')}: ${s.label}` }))
      .filter((c) => c.label.toLowerCase().includes(q));
    return [...base, ...hits];
  };

  // ---- コマンドバー: 現在の画風だけ pressed（色以外の印 selectedMark も付ける） ----
  const baseBar = api.getCommandBar;
  api.getCommandBar = () => {
    const bar = baseBar();
    const cur = api.getDrawStyle();
    return {
      ...bar,
      items: bar.items.map((it) => {
        if (!it.command.startsWith(SET_PREFIX)) return it;
        const on = it.command === `${SET_PREFIX}${cur}`;
        return { ...it, pressed: on, selectedMark: on ? 'check' : null };
      }),
    };
  };
}
