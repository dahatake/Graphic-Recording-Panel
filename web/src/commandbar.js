// NFR-UX-001 AC-057 AC-060: コマンドバー（画面上部）とステータス表示の定義。DOM を知らない（描画は ui.js）。
// アイコンはインライン SVG のパス（Fluent System Icons 風の 20px・線画）。外部の資産は使わない。
export const GROUPS = [
  ['toolbar.session', ['session.start', 'session.pause', 'session.resume', 'session.stop', 'session.nextScene', 'input.focus']],
  ['toolbar.speech', ['speech.start', 'speech.stop']],
  ['toolbar.save', ['save.png', 'save.svg', 'save.pdf']],
  ['toolbar.language', ['lang.ja', 'lang.en']],
  ['toolbar.view', ['view.2d', 'view.3d', 'theme.toggle']],
  ['toolbar.presentation', ['presentation.start', 'presentation.pause', 'presentation.resume', 'presentation.stop', 'presentation.prev', 'presentation.next']],
  ['toolbar.layout', ['layout.reset']],
];

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
};
export const ICONS = {
  'session.start': P.rec, 'session.pause': P.pause, 'session.resume': P.play, 'session.stop': P.stop,
  'session.nextScene': P.next, 'input.focus': P.edit, 'speech.start': P.mic, 'speech.stop': P.micOff,
  'save.png': P.save, 'save.svg': P.save, 'save.pdf': P.save, 'lang.ja': P.lang, 'lang.en': P.lang,
  'view.2d': P.square, 'view.3d': P.cube, 'theme.toggle': P.theme,
  'presentation.start': P.present, 'presentation.pause': P.pause, 'presentation.resume': P.play,
  'presentation.stop': P.stop, 'presentation.prev': P.prev, 'presentation.next': P.next, 'layout.reset': P.reset,
};

export function commandBarModule(ctx) {
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
  api.getCommandBar = () => ({
    position: 'top',
    items: GROUPS.flatMap(([, names]) => names)
      .filter((name) => typeof api.commands[name] === 'function')
      .map((command) => ({ command, label: ctx.t(`cmd.${command}`), tabbable: true })),
    status: api.getCommandStatus(),
  });
}
