// NFR-UX-001 AC-057 AC-060: コマンドバー（画面上部）とステータス表示の定義。DOM を知らない（描画は ui.js）。
// アイコンはインライン SVG のパス（Fluent System Icons 風の 20px・線画）。外部の資産は使わない。
import { LAYOUT_TYPE_IDS, LAYOUT_TYPE_META } from './layouttypes.js';

// NFR-UX-011 AC-459〜462: 作業順（左→右）の 8 グループ [見出しの i18n キー, コマンド名, グループ ID]。1 グループは PARAM-092（7）個以内。
// DOM 順＝フォーカス順＝視覚順。取り消せない data.reset はデータの末尾。
export const GROUPS = [
  ['toolbar.import', ['import.file'], 'import'],
  // FR-084: 画面最上部の「接続キー」（Foundry・Azure Speech のキー）。取り込みと同じ形（アイコン＋常時の説明文字列）
  ['toolbar.apiKeys', ['apiKeys.open'], 'apiKeys'],
  ['toolbar.session', ['session.start', 'session.pause', 'session.resume', 'session.stop', 'session.nextScene', 'input.focus'], 'session'],
  // FR-077: 画風（描画スタイル。〇〇風）の一覧を開くボタンは「表示」の末尾（一覧・選択は stylepicker.js）
  ['toolbar.view', ['view.2d', 'view.3d', 'view.timeline', 'view.arrange', 'detail.next', 'drawStyle.pick'], 'view'],
  ['toolbar.layoutType', [...LAYOUT_TYPE_IDS.map((id) => `layoutType.${id}`), 'layoutType.clear', 'settings.open'], 'layoutType'],
  ['toolbar.presentation', ['presentation.start', 'presentation.pause', 'presentation.resume', 'presentation.stop', 'presentation.prev', 'presentation.next'], 'presentation'],
  // FR-078: 画像生成 AI 向けのプロンプトのコピーは、図の書き出し（PNG・SVG・PDF）の後ろ
  ['toolbar.export', ['save.png', 'save.svg', 'save.pdf', 'prompt.copy'], 'export'],
  ['toolbar.data', ['file.save', 'file.load', 'data.reset'], 'data'],
  ['toolbar.environment', ['layout.tile', 'layout.focus', 'layout.maximize', 'layout.reset', 'theme.toggle', 'lang.ja', 'lang.en'], 'environment'],
];

// NFR-UX-003: アイコンの下に常に表示する短いラベル（ja は全角換算 6 以内、en は半角 12 以内。ボタンごとに異なる）。
const LABELS = {
  'session.start': ['記録開始', 'Record'], 'session.pause': ['一時停止', 'Pause'], 'session.resume': ['再開', 'Resume'],
  'session.stop': ['記録終了', 'Stop'], 'session.nextScene': ['次シーン', 'Next scene'], 'input.focus': ['入力', 'Type'],
  'import.file': ['取り込み', 'Import'], 'apiKeys.open': ['接続キー', 'API Keys'],
  'save.png': ['PNG保存', 'Save PNG'], 'save.svg': ['SVG保存', 'Save SVG'], 'save.pdf': ['PDF保存', 'Save PDF'],
  'lang.ja': ['日本語', 'Japanese'], 'lang.en': ['英語', 'English'],
  'view.2d': ['2D表示', '2D view'], 'view.3d': ['3D表示', '3D view'], 'view.timeline': ['時系列', 'Timeline'], 'view.arrange': ['整理', 'Arrange'], 'detail.next': ['詳細度', 'Detail'],
  'theme.toggle': ['配色', 'Theme'], 'drawStyle.pick': ['画風', 'Art style'],
  'presentation.start': ['発表開始', 'Present'], 'presentation.pause': ['発表休止', 'Pause talk'], 'presentation.resume': ['発表再開', 'Resume talk'],
  'presentation.stop': ['発表終了', 'End talk'], 'presentation.prev': ['前へ', 'Previous'], 'presentation.next': ['次へ', 'Next'],
  'layout.tile': ['タイル', 'Tile'], 'layout.focus': ['集中', 'Focus'], 'layout.maximize': ['最大化', 'Maximize'], 'layout.reset': ['配置初期化', 'Reset layout'],
  'data.reset': ['データ初期化', 'Reset data'], 'file.save': ['ファイル保存', 'Save file'], 'file.load': ['ファイル読込', 'Load file'],
  // FR-027: レイアウト型のアイコンの名称ラベル（label.layoutType.clear・label.settings.open は settings.js が文言を足す）
  ...Object.fromEntries(LAYOUT_TYPE_IDS.map((id) => [`layoutType.${id}`, [LAYOUT_TYPE_META[id].ja.label, LAYOUT_TYPE_META[id].en.label]])),
};
export const labelKey = (command) => `label.${command}`;

// 主要コマンド（Fluent の primary ボタン）。それ以外は subtle。
export const PRIMARY = new Set(['session.start', 'session.resume']);

const P = {
  rec: 'M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z',
  pause: 'M6 4h2.5v12H6zM11.5 4H14v12h-2.5z',
  play: 'M6 3.5v13l10-6.5z',
  stop: 'M5 5h10v10H5z',
  next: 'M4 4l8 6-8 6zM14 4h2v12h-2z',
  prev: 'M16 4l-8 6 8 6zM4 4h2v12H4z',
  edit: 'M3 17l1-4L14 3l3 3L7 16zM12 5l3 3',
  mic: 'M10 2a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM5 9v1a5 5 0 0 0 10 0V9M10 15v3',
  micOff: 'M10 2a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM5 9v1a5 5 0 0 0 10 0V9M3 3l14 14',
  save: 'M4 3h10l3 3v11H4zM7 3v5h6V3M7 17v-5h6v5',
  lang: 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM2 10h16M10 2c3 3 3 13 0 16M10 2c-3 3-3 13 0 16',
  square: 'M3 4h14v12H3zM3 8h14',
  cube: 'M10 2l7 4v8l-7 4-7-4V6zM10 10l7-4M10 10v8M10 10L3 6',
  theme: 'M10 2a8 8 0 1 0 0 16ZM10 2v16',
  present: 'M3 3h14v10H3zM10 13v4M6 17h8',
  reset: 'M4 10a6 6 0 1 1 2 4.5M4 5v5h5',
  tile: 'M3 3h14v14H3zM10 3v14M3 10h14',
  detail: 'M3 5h14M3 10h10M3 15h6',
  focus: 'M3 3h10v14H3zM13 3h4v14h-4zM13 10h4',
  maximize: 'M4 4h12v12H4zM4 7h12',
  trash: 'M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11M9 9v5M11 9v5',
  fileSave: 'M4 3h8l4 4v10H4zM12 3v4h4M10 9v5M8 12l2 2 2-2',
  fileLoad: 'M4 3h8l4 4v10H4zM12 3v4h4M10 14V9M8 11l2-2 2 2',
  key: 'M6.500 8a3.500 3.500 0 1 1 3.300 3.500L9 12.500H7.500V14H6v1.500H3.500V13L8.600 8.800A3.500 3.500 0 0 1 6.500 8ZM12.500 6.500h.01',
  palette: 'M10 2a8 8 0 1 0 0 16c1 0 1.5-.7 1.5-1.5 0-1-.8-1.4-.8-2.2 0-.8.7-1.3 1.5-1.3H14a4 4 0 0 0 4-4c0-3.900-3.600-7-8-7ZM5 9.500a1.200 1.200 0 1 0 2.400 0 1.200 1.200 0 1 0-2.400 0M7.800 5.800a1.200 1.200 0 1 0 2.400 0 1.200 1.200 0 1 0-2.400 0M11.800 5.800a1.200 1.200 0 1 0 2.400 0 1.200 1.200 0 1 0-2.400 0',
};
export const ICONS = {
  'session.start': P.rec, 'session.pause': P.pause, 'session.resume': P.play, 'session.stop': P.stop,
  'session.nextScene': P.next, 'input.focus': P.edit, 'import.file': P.fileLoad, 'apiKeys.open': P.key,
  'save.png': P.save, 'save.svg': P.save, 'save.pdf': P.save, 'lang.ja': P.lang, 'lang.en': P.lang,
  'view.2d': P.square, 'view.3d': P.cube, 'theme.toggle': P.theme, 'drawStyle.pick': P.palette, 'view.timeline': P.prev, 'view.arrange': P.tile, 'detail.next': P.detail,
  'presentation.start': P.present, 'presentation.pause': P.pause, 'presentation.resume': P.play,
  'presentation.stop': P.stop, 'presentation.prev': P.prev, 'presentation.next': P.next, 'layout.reset': P.reset,
  'layout.tile': P.tile, 'layout.focus': P.focus, 'layout.maximize': P.maximize,
  'data.reset': P.trash, 'file.save': P.fileSave, 'file.load': P.fileLoad,
  // FR-078: プロンプトのコピー（2 枚重ねの紙。ラベル・ツールチップの文言は imageprompt.js）
  'prompt.copy': 'M7 3h9v11H7zM4 6v11h9',
  'layoutType.clear': P.reset, 'settings.open': 'M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM10 2v2M10 16v2M2 10h2M16 10h2M4.500 4.500l1.500 1.500M14 14l1.500 1.500M4.500 15.500L6 14M14 6l1.500-1.500',
  ...Object.fromEntries(LAYOUT_TYPE_IDS.map((id) => [`layoutType.${id}`, LAYOUT_TYPE_META[id].icon])),
};

// NFR-UX-002 AC-071〜073: 各ボタンの簡易説明（ツールチップ）。文言キーは tooltip.<command>（ja・en 同一集合）。
const TIP = {
  'session.start': ['記録を開始します。音声と入力から図を作り始めます', 'Start recording; build the diagram from speech and typing'],
  'session.pause': ['記録を一時停止します', 'Pause recording'],
  'session.resume': ['一時停止した記録を再開します', 'Resume the paused recording'],
  'session.stop': ['記録を終了します', 'End the recording'],
  'session.nextScene': ['次のシーンに区切って新しい場面を始めます', 'Close this scene and start the next one'],
  'input.focus': ['テキスト入力欄に移動して文字で入力します', 'Jump to the text field to type input'],
  'import.file': ['テキスト・字幕のファイルを選んで、発話として取り込みます', 'Pick a text or caption file and import it as utterances'],
  'save.png': ['図を PNG 画像として保存します', 'Save the diagram as a PNG image'],
  'apiKeys.open': ['Microsoft Foundry・Azure Speech のキーと GitHub Copilot の認証を登録・変更・削除する画面を開きます', 'Open the screen to register, change or delete the Microsoft Foundry and Azure Speech keys and the GitHub Copilot sign-in'],
  'save.svg': ['図を SVG ファイルとして保存します', 'Save the diagram as an SVG file'],
  'save.pdf': ['図を PDF として保存します', 'Save the diagram as a PDF'],
  'lang.ja': ['表示言語を日本語に切り替えます', 'Switch the display language to Japanese'],
  'lang.en': ['表示言語を英語に切り替えます', 'Switch the display language to English'],
  'view.2d': ['図を平面（2D）で表示します', 'Show the diagram in flat 2D'],
  'view.3d': ['図を立体（3D）で表示します', 'Show the diagram in 3D'],
  'view.timeline': ['図を時系列の配置で表示します', 'Show the diagram in timeline order'],
  'view.arrange': ['図を縦軸・横軸の区分に整理して表示します', 'Show the diagram arranged by vertical and horizontal axes'],
  'detail.next': ['図の詳細度（大項目・中項目・詳細）を次へ切り替えます', 'Switch the diagram detail level (topics, scenes, full) to the next one'],
  'theme.toggle': ['画面の配色をダークとライトで切り替えます', 'Toggle the screen colors between dark and light'],
  'drawStyle.pick': ['図の画風（〇〇風などの描画スタイル）を一覧から選び、図をすぐに描き替えます', 'Pick the art style of the diagram from a list and redraw it at once'],
  'presentation.start': ['シーンを順に見せるプレゼンテーションを始めます', 'Start a presentation that plays the scenes in order'],
  'presentation.pause': ['プレゼンテーションを一時停止します', 'Pause the presentation'],
  'presentation.resume': ['一時停止したプレゼンテーションを再開します', 'Resume the paused presentation'],
  'presentation.stop': ['プレゼンテーションを終了します', 'End the presentation'],
  'presentation.prev': ['プレゼンテーションで前のシーンに戻ります', 'Go back to the previous scene in the presentation'],
  'presentation.next': ['プレゼンテーションで次のシーンに進みます', 'Go on to the next scene in the presentation'],
  'layout.reset': ['パネルの配置を初期状態に戻します', 'Restore the panels to the default layout'],
  'layout.tile': ['全パネルを隙間なく並べるタイル配置に整列します', 'Arrange all panels as gapless tiles'],
  'layout.focus': ['選んだパネルを全体の 75% に広げ、ほかを残りに均等に並べます', 'Enlarge the main panel to 75% and share the rest equally'],
  'layout.maximize': ['パネルを作業領域いっぱいに最大化します', 'Maximize the panel to fill the work area'],
  'data.reset': ['確認のうえ、議論の内容と保存されたセッションを消去して初期状態に戻します。元に戻せません', 'After confirmation, erase the discussion and the saved session and return to the initial state. Cannot be undone'],
  'file.save': ['議論の途中のデータを 1 つのセッションファイルとして端末に保存します', 'Save the discussion in progress as one session file on this device'],
  'file.load': ['保存したセッションファイルを読み込んで議論の途中を復元します', 'Load a saved session file to restore the discussion in progress'],
  ...Object.fromEntries(LAYOUT_TYPE_IDS.map((id) => [`layoutType.${id}`, [LAYOUT_TYPE_META[id].ja.tip, LAYOUT_TYPE_META[id].en.tip]])),
};
export const tooltipId = (command) => `tooltip-${command.replace(/[^a-zA-Z0-9]+/g, '-')}`;

export function commandBarModule(ctx) {
  ctx.i18n.addStrings({
    ja: {
      ...Object.fromEntries(Object.entries(TIP).map(([c, v]) => [`tooltip.${c}`, v[0]])),
      ...Object.fromEntries(Object.entries(LABELS).map(([c, v]) => [labelKey(c), v[0]])),
    },
    en: {
      ...Object.fromEntries(Object.entries(TIP).map(([c, v]) => [`tooltip.${c}`, v[1]])),
      ...Object.fromEntries(Object.entries(LABELS).map(([c, v]) => [labelKey(c), v[1]])),
    },
  });
  ctx.i18n.addStrings({
    ja: {
      'toolbar.import': '取り込み', 'toolbar.export': '図の書き出し', 'toolbar.environment': '画面・環境', 'toolbar.apiKeys': '接続キー',
      'import.description': 'テキストファイル（.txt）・字幕ファイル（.vtt）を取り込みます',
      'apiKeys.description': 'Foundry・Azure Speech のキーと GitHub Copilot の認証を登録します',
      'status.speech.label': '音声認識',
      'status.lang': '言語',
      'status.view': '表示',
      'status.region': '状態',
      'lang.name.ja': '日本語', 'lang.name.en': 'English',
      'view.name.2d': '2D', 'view.name.3d': '3D',
    },
    en: {
      'toolbar.import': 'Import', 'toolbar.export': 'Export diagram', 'toolbar.environment': 'Screen & environment', 'toolbar.apiKeys': 'API Keys',
      'import.description': 'Import a text file (.txt) or a caption file (.vtt)',
      'apiKeys.description': 'Register the Foundry and Azure Speech keys and GitHub Copilot sign-in',
      'status.speech.label': 'Speech',
      'status.lang': 'Language',
      'status.view': 'View',
      'status.region': 'Status',
      'lang.name.ja': 'Japanese', 'lang.name.en': 'English',
      'view.name.2d': '2D', 'view.name.3d': '3D',
    },
  });
  const api = ctx.api;
  api.getCommandStatus = () => {
    const st = ctx.state;
    const ss = api.getSpeechStatus();
    const speech = ss.state === 'local' ? 'available' : ss.state;
    const text = [
      `${ctx.t('session.statusLabel')}: ${ctx.t(`session.state.${st.session}`)}`,
      `${ctx.t('status.speech.label')}: ${ss.text}`,
      `${ctx.t('status.lang')}: ${ctx.t(`lang.name.${st.lang}`)}`,
      `${ctx.t('status.view')}: ${ctx.t(`view.name.${st.viewMode}`)}`,
      `${ctx.t('detail.label')}: ${api.getDetailInfo().label}`,
    ].join(' ｜ ');
    return { role: 'status', live: 'polite', session: st.session, speech, text };
  };
  const known = (c) => GROUPS.some(([, n]) => n.includes(c)) && typeof api.commands[c] === 'function';
  let shown = null; // 表示中の説明文のコマンド（同時に 1 つ）
  const tip = (command) => ({ id: tooltipId(command), text: ctx.t(`tooltip.${command}`) });
  api.showTooltip = (command, trigger) => {
    if (!known(command) || (trigger !== 'hover' && trigger !== 'focus')) return { visible: false };
    shown = command;
    return { visible: true, ...tip(command) };
  };
  api.hideTooltip = (command, trigger) => {
    if ((trigger === 'leave' || trigger === 'blur') && shown === command) shown = null;
    return { visible: false };
  };
  api.getTooltip = () => (shown && known(shown) ? { command: shown, ...tip(shown), visible: true } : null);
  // NFR-UX-011: 作業順のグループ。見出し（name）とアクセシブルな名前は表示言語に従い、呼ぶたびに作り直す（再読み込み不要）。
  const present = (name) => typeof api.commands[name] === 'function';
  api.getCommandBar = () => {
    const groups = GROUPS.map(([key, names, id]) => {
      const name = ctx.t(key);
      return { id, name, accessibleName: name, headingVisible: true, commands: names.filter(present) };
    }).filter((g) => g.commands.length);
    const groupOfCommand = new Map(groups.flatMap((g) => g.commands.map((c) => [c, g.id])));
    const items = groups.flatMap((g) => g.commands).map((command) => {
      const label = ctx.t(labelKey(command));
      const it = { command, group: groupOfCommand.get(command), label, labelVisible: true, accessibleName: label, tabbable: true, tabIndex: 0, tooltip: tip(command), describedBy: tooltipId(command), icon: ICONS[command] ?? '' };
      // FR-073 AC-388: 取り込みは、何を取り込めるかの説明を常時表示する（ホバー・フォーカスを待たない）
      if (command === 'import.file') { it.description = ctx.t('import.description'); it.descriptionVisible = true; }
      // FR-084 AC-482: 接続キーも同じ形（説明を常時表示。「設定」の語は使わない）
      if (command === 'apiKeys.open') { it.description = ctx.t('apiKeys.description'); it.descriptionVisible = true; }
      return it;
    });
    return { position: 'top', groups, items, focusOrder: items.map((i) => i.command), status: api.getCommandStatus() };
  };
  // NFR-UX-003 AC-090 / NFR-UX-011 AC-462・464: 幅ごとの 1 行の収まりと、各ボタン・見出しの表示範囲（コマンドバー内の座標）。
  // ラベルは全角 1・半角 0.5 と数え、PARAM-011 以内なら 1 行。グループは折り返すので横スクロールしない。
  // 配置の規則は CSS と同じ: 狭い画面（768px 未満）は 1 グループ 1 行帯でボタンが折り返し、広い画面はグループを左→右に並べ、入りきらなければ次の行帯へ。
  api.getCommandBarLayout = (opts = {}) => {
    const vw = opts.viewportWidth ?? ctx.env.viewportWidth;
    const w = (s) => [...s].reduce((n, ch) => n + (ch.codePointAt(0) >= 0x2e80 ? 1 : 0.5), 0);
    const bar = api.getCommandBar();
    const BTN_W = 72; const BTN_H = 56; const GAP = 4; const HEAD_H = 20; const PAD = 8; const HEAD_CH = 14;
    const width = Number.isFinite(vw) && vw > 0 ? vw : 1280;
    const narrow = width < 768;
    const avail = width - PAD * 2;
    const items = []; const heads = [];
    let x = PAD; let y = PAD; let bandH = 0;
    for (const g of bar.groups) {
      const perRow = Math.max(1, Math.floor((avail + GAP) / (BTN_W + GAP)));
      const cols = Math.min(g.commands.length, perRow);
      const rows = Math.ceil(g.commands.length / cols);
      const gw = cols * (BTN_W + GAP) - GAP;
      const gh = HEAD_H + rows * (BTN_H + GAP) - GAP;
      if (x > PAD && (narrow || x + gw > PAD + avail)) { x = PAD; y += bandH + GAP; bandH = 0; }
      const hw = Math.min(Math.max(gw, 1), Math.max(1, Math.ceil(w(g.name) * HEAD_CH * 2) / 2));
      heads.push({ id: g.id, headingRect: { x, y, w: Math.min(hw, gw), h: HEAD_H } });
      g.commands.forEach((command, i) => {
        items.push({ command, rect: { x: x + (i % cols) * (BTN_W + GAP), y: y + HEAD_H + Math.floor(i / cols) * (BTN_H + GAP), w: BTN_W, h: BTN_H } });
      });
      x += gw + PAD; bandH = Math.max(bandH, gh);
    }
    const label = new Map(bar.items.map((i) => [i.command, i.label]));
    return { items: items.map((it) => ({ ...it, labelLines: w(label.get(it.command)) <= 6 ? 1 : 2 })), groups: heads, scrollsHorizontally: false };
  };
}
