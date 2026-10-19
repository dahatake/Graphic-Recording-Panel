// 描画の合流（NFR-PERF-002/003）。状態の変更が続いても、画面の再構築は 1 フレームに 1 回だけにする。
// 変更の通知がなければ何も予約しない（アイドル時にタイマー・rAF を回さない: NFR-PERF-004 AC-403）。
// raf が無い環境（Node のテストなど）では、その場で同期に実行する。
export function coalesceFrame(fn, raf = globalThis.requestAnimationFrame?.bind(globalThis), caf = globalThis.cancelAnimationFrame?.bind(globalThis)) {
  if (typeof raf !== 'function') {
    const direct = (...a) => fn(...a);
    direct.flush = () => {}; direct.pending = () => false;
    return direct;
  }
  let id = null;
  const run = () => { id = null; fn(); };
  const scheduled = () => { if (id === null) id = raf(run); };
  scheduled.flush = () => { if (id !== null) { caf?.(id); run(); } };
  scheduled.pending = () => id !== null;
  return scheduled;
}
