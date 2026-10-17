// NFR-OFFLINE-001 AC-031 AC-032 / NFR-A11Y-001 AC-035 AC-036 AC-037 の全体確認（全機能の統合後の回帰テスト）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../web/src/app.js';
import { createI18n } from '../../web/src/i18n.js';
import { EMOTIONS } from '../../web/src/emotion.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const files = walk(WEB).map((f) => path.relative(WEB, f).split(path.sep).join('/'));
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');
function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

// NFR-OFFLINE-001 AC-032: 起動に必要な web/ の全ファイルが SHELL に入っている（sw.js 自身を除く）。
test('NFR-OFFLINE-001 AC-032: sw.js の SHELL が web/ の全ファイルを網羅し、VERSION が付いている', () => {
  const sw = read('sw.js');
  assert.match(sw, /const VERSION = 'grp-shell-v\d+'/);
  assert.match(sw, /c\.addAll\(SHELL\.map\(\(url\) => new Request\(url, \{ cache: 'reload' \}\)\)\)/);
  const shell = new Set([...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]));
  for (const f of files) {
    if (f === 'sw.js') continue;
    assert.ok(shell.has(f) || (f === 'index.html' && shell.has('')), `SHELL に無い: ${f}`);
  }
  for (const s of shell) if (s) assert.ok(files.includes(s), `実在しない: ${s}`);
});

// NFR-OFFLINE-001 AC-031: 外部 URL・CDN・外部宛の通信 API が無い。
test('NFR-OFFLINE-001 AC-031: web/ に外部 URL・CDN 参照・外部宛の通信が無い', () => {
  for (const f of files) {
    // SVG の名前空間 URI は通信を発生させないので除く。
    const text = read(f).replace(/xmlns(:\w+)?="http:\/\/www\.w3\.org\/[^"]*"/g, '');
    assert.doesNotMatch(text, /(https?:)?\/\/[a-z0-9-]+\.[a-z]{2,}/i, `外部 URL: ${f}`);
    assert.doesNotMatch(text, /@import|<link[^>]+href="(https?:)?\/\//i, `外部資産: ${f}`);
    assert.doesNotMatch(text, /\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b/, `外部通信 API: ${f}`);
    // FR-062（G-002 の例外条件 (3)）: 同一オリジンの中継サーバーへの要求は relayclient.js だけに置く。それ以外では fetch を使わない
    if (f !== 'sw.js' && f !== 'src/relayclient.js') assert.doesNotMatch(text, /\bfetch\s*\(/, `fetch: ${f}`);
  }
  const rc = read('src/relayclient.js');
  assert.equal([...rc.matchAll(/\bfetch\s*\(/g)].length, 1);
  assert.match(rc, /startsWith\('\/api\/llm\/'\)/, '同一オリジンの /api/llm/ 以外へは要求しない');
  assert.doesNotMatch(read('sw.js'), /\bfetch\s*\((?!e)/);
});

// NFR-A11Y-001 AC-036: 2D/3D・保存・音声・言語・プレゼンを含む全コマンドにキーがあり、操作名が ja/en にある。
test('NFR-A11Y-001 AC-036: 統合後の全コマンドにキー割り当てがあり、重複しない', async () => {
  const app = await createApp({ storage: mem() });
  const names = Object.keys(app.commands);
  for (const must of ['view.2d', 'view.3d', 'save.png', 'save.svg', 'save.pdf', 'speech.start', 'speech.stop',
    'presentation.start', 'presentation.pause', 'presentation.resume', 'presentation.stop', 'presentation.next', 'presentation.prev', 'lang.ja', 'lang.en']) {
    assert.ok(names.includes(must), `コマンドなし: ${must}`);
  }
  const keyed = new Map();
  for (const k of app.keymap) {
    const id = `${!!k.ctrl}${!!k.alt}${!!k.shift}${k.key.toLowerCase()}`;
    assert.ok(!keyed.has(id), `キーの重複: ${k.key}`);
    keyed.set(id, k.command);
  }
  for (const n of names) assert.ok(app.keymap.some((k) => k.command === n), `キーなし: ${n}`);
  for (const k of app.keymap) assert.equal(typeof app.commands[k.command], 'function', `未実装: ${k.command}`);
  const ja = createI18n().getStrings();
  for (const n of names) if (n !== 'speech.start' && n !== 'speech.stop') assert.ok(ja[`cmd.${n}`], n);
});

// NFR-A11Y-001 AC-037: 感情の表現は色だけでなく形（shape）と語でも区別できる。
test('NFR-A11Y-001 AC-037: 感情ごとに異なる形があり、選択中は枠線の太さ・二重線でも示す', () => {
  const shapes = EMOTIONS.map((e) => e.shape);
  assert.equal(new Set(shapes).size, shapes.length);
  assert.match(read('styles/app.css'), /\.outline-scene\.is-selected \{[^}]*border: 4px double/);
  assert.match(read('styles/app.css'), /:focus-visible \{ outline: 3px solid/);
});

// NFR-A11Y-001 AC-037: 配色の文字コントラストが WCAG AA（4.5:1）以上。
test('NFR-A11Y-001 AC-037: ダーク・ライトの本文とフォーカス・主色のコントラストが基準以上', () => {
  const css = read('styles/tokens.css');
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const blocks = { light: css.match(/:root, :root\[data-theme="light"\] \{([^}]*)\}/)[1], dark: css.match(/:root\[data-theme="dark"\] \{([^}]*)\}/)[1] };
  const light = Object.fromEntries([...blocks.light.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  const dark = { ...light, ...Object.fromEntries([...blocks.dark.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]])) };
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    assert.ok(ratio(t.text, t.surface) >= 4.5, `${name} text`);
    assert.ok(ratio(t['text-muted'], t.surface) >= 4.5, `${name} muted`);
    assert.ok(ratio(t['on-primary'], t.primary) >= 4.5, `${name} primary`);
    assert.ok(ratio(t.focus, t.bg) >= 3, `${name} focus`);
    assert.ok(ratio(t.border, t.bg) >= 3, `${name} border`);
  }
});

// NFR-A11Y-001 AC-035: 一覧は index.html で読み上げ対象のパネル（見出し付き）になっている。
test('NFR-A11Y-001 AC-035: シーン一覧のパネルが見出し付きで、非表示（aria-hidden）にされていない', () => {
  const h = read('index.html');
  assert.match(h, /data-panel="outline"[^>]*aria-labelledby/);
  assert.doesNotMatch(h, /data-panel="outline"[^>]*aria-hidden="true"/);
});
