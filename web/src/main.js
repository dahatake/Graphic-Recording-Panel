// ブラウザの入口: 実ブラウザの既定で createApp し、画面に結び付ける。外部通信はしない（app shell のオフラインキャッシュだけ）。
import { createApp } from './app.js';
import { mountUI } from './ui.js';

const mq = (q) => (globalThis.matchMedia ? globalThis.matchMedia(q).matches : false);

function hasWebGL() {
  try { return !!globalThis.document?.createElement('canvas').getContext('webgl'); } catch { return false; }
}

const app = await createApp({
  env: {
    webgl: hasWebGL(),
    reducedMotion: mq('(prefers-reduced-motion: reduce)'),
    viewportWidth: globalThis.innerWidth,
    prefersDark: mq('(prefers-color-scheme: dark)'),
  },
});
mountUI(app);
globalThis.addEventListener('resize', () => { /* 幅の変化に合わせて再描画 */ app.setViewportWidth?.(globalThis.innerWidth); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* オフライン用。失敗しても動作は続ける */ });
}
globalThis.__app = app;
