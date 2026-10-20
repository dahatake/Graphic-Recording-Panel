// NFR-OFFLINE-001: app shell をキャッシュして、ネットワークなしでも起動できるようにする。
// 外部へのリクエストは一切しない（キャッシュにある同一オリジンの資産だけを返す）。
// 後続の項目が資産（ファイル）を足したら SHELL に追加し、VERSION を上げる。
const VERSION = 'grp-shell-v22';
const SHELL = [
  './', './index.html', './styles/tokens.css', './styles/app.css',
  './src/main.js', './src/app.js', './src/ui.js', './src/i18n.js', './src/layout.js',
  './src/keymap.js', './src/outline.js', './src/popup.js', './src/persist.js', './src/scenes.js',
  './src/diagram.js', './src/emotion.js', './src/parts.js', './src/svgsanitize.js', './src/input.js', './src/vtt.js', './src/speech.js', './src/view3d.js', './styles/view3d.css',
  './src/edit.js', './src/edit-ui.js', './src/export.js', './src/transcript.js', './src/commandbar.js', './src/arrange.js', './src/axes3d.js',   './src/session.js', './src/topics.js', './src/settings.js', './src/layouttypes.js', './src/autolayout.js', './src/layoutkinds.js', './src/drawstyles.js', './src/rpgmap.js', './src/rpgsprites.js', './src/rpg.js', './src/rpgaudio.js', './src/llm.js', './src/llmdraw.js', './src/relayclient.js', './src/infodesign.js', './src/relayout.js', './src/speechsettings.js', './src/azurespeech.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // 外部は触らない
  if (url.pathname.startsWith('/api/')) return; // 中継サーバー（LLM 連携 FR-062）は SW を通さず、同一オリジンのネットワークへそのまま出す
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || Response.error()));
});
