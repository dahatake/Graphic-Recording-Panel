// NFR-OFFLINE-001: app shell をキャッシュして、ネットワークなしでも起動できるようにする。
// 外部へのリクエストは一切しない（キャッシュにある同一オリジンの資産だけを返す）。
// 後続の項目が資産（ファイル）を足したら SHELL に追加し、VERSION を上げる。
const VERSION = 'grp-shell-v3';
const SHELL = [
  './', './index.html', './styles/tokens.css', './styles/app.css',
  './src/main.js', './src/app.js', './src/ui.js', './src/i18n.js', './src/layout.js',
  './src/keymap.js', './src/outline.js', './src/persist.js', './src/scenes.js',
  './src/diagram.js', './src/emotion.js', './src/input.js', './src/view3d.js', './styles/view3d.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // 外部は触らない
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || Response.error()));
});
