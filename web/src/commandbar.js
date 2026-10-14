// NFR-UX-001 AC-057 AC-060: コマンドバー（画面上部）とステータス表示の定義。DOM を知らない（描画は ui.js）。
// アイコンはインライン SVG のパス（Fluent System Icons 風の 20px・線画）。外部の資産は使わない。
export const GROUPS = [
  ['toolbar.session', ['session.start', 'session.pause', 'session.resume', 'session.stop', 'session.nextScene', 'input.focus']],
  ['toolbar.speech', ['speech.start', 'speech.stop']],
  ['toolbar.save', ['save.png', 'save.svg', 'save.pdf']],
  ['toolbar.language', ['lang.ja', 'lang.en']],
  ['toolbar.view', ['view.2d', 'view.3d', 'view.timeline', 'view.arrange', 'theme.toggle']],
  ['toolbar.presentation', ['presentation.start', 'presentation.pause', 'presentation.resume', 'presentation.stop', 'presentation.prev', 'presentation.next']],
  ['toolbar.layout', ['layout.tile', 'layout.focus', 'layout.maximize', 'layout.reset']],
  ['toolbar.data', ['data.reset', 'file.save', 'file.load']],
];

// NFR-UX-003: アイコンの下に常に表示する短いラベル（ja は全角換算 6 以内、en は半角 12 以内。ボタンごとに異なる）。
const LABELS = {
  'session.start': ['記録開始', 'Record'], 'session.pause': ['一時停止', 'Pause'], 'session.resume': ['再開', 'Resume'],
  'session.stop': ['記録終了', 'Stop'], 'session.nextScene': ['次シーン', 'Next scene'], 'input.focus': ['入力', 'Type'],
  'speech.start': ['音声開始', 'Mic on'], 'speech.stop': ['音声停止', 'Mic off'],
  'save.png': ['PNG保存', 'Save PNG'], 'save.svg': ['SVG保存', 'Save SVG'], 'save.pdf': ['PDF保存', 'Save PDF'],
  'lang.ja': ['日本語', 'Japanese'], 'lang.en': ['英語', 'English'],
  'view.2d': ['2D表示', '2D view'], 'view.3d': ['3D表示', '3D view'], 'view.timeline': ['時系列', 'Timeline'], 'view.arrange': ['整理', 'Arrange'],
  'theme.toggle': ['配色', 'Theme'],
  'presentation.start': ['発表開始', 'Present'], 'presentation.pause': ['発表休止', 'Pause talk'], 'presentation.resume': ['発表再開', 'Resume talk'],
  'presentation.stop': ['発表終了', 'End talk'], 'presentation.prev': ['前へ', 'Previous'], 'presentation.next': ['次へ', 'Next'],
  'layout.tile': ['タイル', 'Tile'], 'layout.focus': ['集中', 'Focus'], 'layout.maximize': ['最大化', 'Maximize'], 'layout.reset': ['配置初期化', 'Reset layout'],
  'data.reset': ['データ初期化', 'Reset data'], 'file.save': ['ファイル保存', 'Save file'], 'file.load': ['ファイル読込', 'Load file'],
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
  focus: 'M3 3h10v14H3zM13 3h4v14h-4zM13 10h4',
  maximize: 'M4 4h12v12H4zM4 7h12',
  trash: 'M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11M9 9v5M11 9v5',
  fileSave: 'M4 3h8l4 4v10H4zM12 3v4h4M10 9v5M8 12l2 2 2-2',
  fileLoad: 'M4 3h8l4 4v10H4zM12 3v4h4M10 14V9M8 11l2-2 2 2',
};
export const ICONS = {
  'session.start': P.rec, 'session.pause': P.pause, 'session.resume': P.play, 'session.stop': P.stop,
  'session.nextScene': P.next, 'input.focus': P.edit, 'speech.start': P.mic, 'speech.stop': P.micOff,
  'save.png': P.save, 'save.svg': P.save, 'save.pdf': P.save, 'lang.ja': P.lang, 'lang.en': P.lang,
  'view.2d': P.square, 'view.3d': P.cube, 'theme.toggle': P.theme, 'view.timeline': P.prev, 'view.arrange': P.tile,
  'presentation.start': P.present, 'presentation.pause': P.pause, 'presentation.resume': P.play,
  'presentation.stop': P.stop, 'presentation.prev': P.prev, 'presentation.next': P.next, 'layout.reset': P.reset,
  'layout.tile': P.tile, 'layout.focus': P.focus, 'layout.maximize': P.maximize,
  'data.reset': P.trash, 'file.save': P.fileSave, 'file.load': P.fileLoad,
};

// NFR-UX-002 AC-071〜073: 各ボタンの簡易説明（ツールチップ）。文言キーは tooltip.<command>（ja・en 同一集合）。
const TIP = {
  'session.start': ['記録を開始します。音声と入力から図を作り始めます', 'Start recording; build the diagram from speech and typing'],
  'session.pause': ['記録を一時停止します', 'Pause recording'],
  'session.resume': ['一時停止した記録を再開します', 'Resume the paused recording'],
  'session.stop': ['記録を終了します', 'End the recording'],
  'session.nextScene': ['次のシーンに区切って新しい場面を始めます', 'Close this scene and start the next one'],
  'input.focus': ['テキスト入力欄に移動して文字で入力します', 'Jump to the text field to type input'],
  'speech.start': ['マイクで音声認識を始めます', 'Start speech recognition with the microphone'],
  'speech.stop': ['音声認識を止めます', 'Stop speech recognition'],
  'save.png': ['図を PNG 画像として保存します', 'Save the diagram as a PNG image'],
  'save.svg': ['図を SVG ファイルとして保存します', 'Save the diagram as an SVG file'],
  'save.pdf': ['図を PDF として保存します', 'Save the diagram as a PDF'],
  'lang.ja': ['表示言語を日本語に切り替えます', 'Switch the display language to Japanese'],
  'lang.en': ['表示言語を英語に切り替えます', 'Switch the display language to English'],
  'view.2d': ['図を平面（2D）で表示します', 'Show the diagram in flat 2D'],
  'view.3d': ['図を立体（3D）で表示します', 'Show the diagram in 3D'],
  'view.timeline': ['図を時系列の配置で表示します', 'Show the diagram in timeline order'],
  'view.arrange': ['図を縦軸・横軸の区分に整理して表示します', 'Show the diagram arranged by vertical and horizontal axes'],
  'theme.toggle': ['画面の配色をダークとライトで切り替えます', 'Toggle the screen colors between dark and light'],
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
      'status.speech.label': '音声認識',
      'status.lang': '言語',
      'status.view': '表示',
      'status.region': '状態',
      'lang.name.ja': '日本語', 'lang.name.en': 'English',
      'view.name.2d': '2D', 'view.name.3d': '3D',
    },
    en: {
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
  api.getCommandBar = () => ({
    position: 'top',
    items: GROUPS.flatMap(([, names]) => names)
      .filter((name) => typeof api.commands[name] === 'function')
      .map((command) => {
        const label = ctx.t(labelKey(command));
        return { command, label, labelVisible: true, accessibleName: label, tabbable: true, tooltip: tip(command), describedBy: tooltipId(command) };
      }),
    status: api.getCommandStatus(),
  });
  // NFR-UX-003 AC-090: 幅ごとの 1 行の収まり。ラベルは全角 1・半角 0.5 と数え、PARAM-011 以内なら 1 行。グループは折り返すので横スクロールしない。
  api.getCommandBarLayout = (opts = {}) => {
    void (opts.viewportWidth ?? ctx.env.viewportWidth);
    const w = (s) => [...s].reduce((n, ch) => n + (ch.codePointAt(0) >= 0x2e80 ? 1 : 0.5), 0);
    return { items: api.getCommandBar().items.map((i) => ({ command: i.command, labelLines: w(i.label) <= 6 ? 1 : 2 })), scrollsHorizontally: false };
  };
}
