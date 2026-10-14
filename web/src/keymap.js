// NFR-A11Y-001 AC-036: 全操作のキー割り当て。Alt+Shift+<キー> に統一し、ブラウザの標準ショートカットと衝突させない。
// コマンドの実装は各モジュールが registerCommand で足す。ここは割り当てだけ。

const AS = { alt: true, shift: true };

export const KEYMAP = [
  { key: 'r', ...AS, command: 'session.start' },
  { key: 'p', ...AS, command: 'session.pause' },
  { key: 'e', ...AS, command: 'session.resume' },
  { key: 'x', ...AS, command: 'session.stop' },
  { key: 'n', ...AS, command: 'session.nextScene' },
  { key: 'i', ...AS, command: 'input.focus' },
  { key: '1', ...AS, command: 'save.png' },
  { key: '2', ...AS, command: 'save.svg' },
  { key: '3', ...AS, command: 'save.pdf' },
  { key: 'j', ...AS, command: 'lang.ja' },
  { key: 'k', ...AS, command: 'lang.en' },
  { key: 'd', ...AS, command: 'view.2d' },
  { key: 'v', ...AS, command: 'view.3d' },
  { key: 'g', ...AS, command: 'presentation.start' },
  { key: 'h', ...AS, command: 'presentation.pause' },
  { key: 'y', ...AS, command: 'presentation.resume' },
  { key: 't', ...AS, command: 'presentation.stop' },
  { key: 'ArrowRight', ...AS, command: 'presentation.next' },
  { key: 'ArrowLeft', ...AS, command: 'presentation.prev' },
  { key: 'm', ...AS, command: 'theme.toggle' },
  { key: '0', ...AS, command: 'layout.reset' },
  { key: 'l', ...AS, command: 'layout.tile' },
  { key: 'f', ...AS, command: 'layout.focus' },
  { key: 'z', ...AS, command: 'layout.maximize' },
];

export function matchKey(keymap, ev) {
  const key = String(ev?.key ?? '').toLowerCase();
  return keymap.find((k) => k.key.toLowerCase() === key
    && !!k.ctrl === !!ev.ctrlKey && !!k.alt === !!ev.altKey && !!k.shift === !!ev.shiftKey) || null;
}
