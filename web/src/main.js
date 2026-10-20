// ブラウザの入口: 実ブラウザの既定で createApp し、画面に結び付ける。外部通信はしない（app shell のオフラインキャッシュだけ）。
import { createApp } from './app.js';
import { mountUI } from './ui.js';
import { mountEditUI } from './edit-ui.js';
import { mountPromptFallback, mountPromptCopyNotice } from './imageprompt-ui.js';
import { relayRequest } from './relayclient.js';

const mq = (q) => (globalThis.matchMedia ? globalThis.matchMedia(q).matches : false);

function hasWebGL() {
  try { return !!globalThis.document?.createElement('canvas').getContext('webgl'); } catch { return false; }
}

// LLM 連携は既定オフ。有効にしても、要求は同一オリジンの中継サーバー（/api/llm/...）だけに出す（FR-062。relayclient.js）。
const app = await createApp({
  relay: relayRequest,
  env: {
    webgl: hasWebGL(),
    reducedMotion: mq('(prefers-reduced-motion: reduce)'),
    viewportWidth: globalThis.innerWidth,
    prefersDark: mq('(prefers-color-scheme: dark)'),
    forcedColors: mq('(forced-colors: active)'), // FR-076 AC-456: ハイコントラスト（強制カラー）
  },
});
const ui = mountUI(app);
mountEditUI(app);
mountPromptFallback(app); // FR-078 AC-423: クリップボードに書けないときの手でコピーする表示
mountPromptCopyNotice(app); // FR-078 AC-468・AC-469: コピー前の注意と簡易マスキングの選択
ui.measureWorkArea();
// FR-076 AC-456: 実行中にハイコントラストを切り替えたら、図の配色をシステム色と風の配色の間で切り替える
globalThis.matchMedia?.('(forced-colors: active)').addEventListener?.('change', (e) => app.setForcedColors?.(e.matches));
globalThis.addEventListener('resize', () => { /* 幅の変化に合わせて再描画 */ app.setViewportWidth?.(globalThis.innerWidth); });

if ('serviceWorker' in navigator) {
  // 旧版のキャッシュで開いたあとに新しい SW が有効になったら、1 回だけ読み直して新しい資産に切り替える（旧 UI が残り続けるのを防ぐ）。
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener?.('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    globalThis.location?.reload?.();
  });
  navigator.serviceWorker.register('./sw.js').catch(() => { /* オフライン用。失敗しても動作は続ける */ });
}
globalThis.__app = app;
