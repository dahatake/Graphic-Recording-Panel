// NFR-UX-001 の単体・結合テスト（AC-055 AC-056 AC-058 AC-059 AC-060 と、デザイン基盤の規則）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../web/src/app.js';
import { GROUPS, ICONS, PRIMARY } from '../../web/src/commandbar.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const read = (f) => fs.readFileSync(path.join(WEB, f), 'utf8');
const tokens = read('styles/tokens.css');
const app = read('styles/app.css');

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const block = (re) => Object.fromEntries([...tokens.match(re)[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));

// NFR-UX-001 AC-055: 色は名前付きトークン。アプリの CSS に色の直書きがなく、ハイコントラストはシステム色
test('NFR-UX-001 AC-055: 見た目の色はトークンに集約され、forced-colors ではシステム色を使う', () => {
  assert.doesNotMatch(app, /#[0-9a-fA-F]{3,8}\b/, 'app.css に色の直書きがない');
  assert.doesNotMatch(read('styles/view3d.css'), /#[0-9a-fA-F]{3,8}\b/);
  const fc = tokens.slice(tokens.indexOf('@media (forced-colors: active)'));
  for (const sys of ['Canvas', 'CanvasText', 'Highlight', 'ButtonText']) assert.ok(fc.includes(sys), sys);
  assert.match(tokens, /--color-primary-hover/);
  assert.match(tokens, /--duration-fast/);
  assert.match(tokens, /--easing-standard/);
  assert.match(tokens, /--radius-control:\s*4px/);
  assert.match(tokens, /--space-1:\s*4px/);
});

// NFR-UX-001 AC-056: ライト・ダークの本文・操作部品の文字は 4.5:1 以上（PARAM-007）
test('NFR-UX-001 AC-056: 本文・主ボタン・ブランド文字・操作部品の枠が基準のコントラスト以上', () => {
  const light = block(/:root, :root\[data-theme="light"\] \{([^}]*)\}/);
  const dark = { ...light, ...block(/:root\[data-theme="dark"\] \{([^}]*)\}/) };
  for (const [n, t] of [['light', light], ['dark', dark]]) {
    for (const bg of ['color-bg', 'color-surface', 'color-surface-2']) {
      assert.ok(ratio(t['color-text'], t[bg]) >= 4.5, `${n} text/${bg}`);
      assert.ok(ratio(t['color-text-muted'], t[bg]) >= 4.5, `${n} muted/${bg}`);
      assert.ok(ratio(t['color-brand-fg'], t[bg]) >= 4.5, `${n} brand/${bg}`);
    }
    for (const k of ['color-primary', 'color-primary-hover', 'color-primary-pressed']) assert.ok(ratio(t['color-on-primary'], t[k]) >= 4.5, `${n} on-${k}`);
    assert.ok(ratio(t['color-border'], t['color-surface']) >= 3, `${n} border`);
    assert.ok(ratio(t['color-focus'], t['color-surface']) >= 3 && ratio(t['color-focus'], t['color-bg']) >= 3, `${n} focus`);
    for (const k of ['color-ok', 'color-warn', 'color-danger']) assert.ok(ratio(t[k], t['color-surface']) >= 4.5, `${n} ${k}`);
  }
});

// NFR-UX-001 AC-058: 狭い画面（PARAM-006）でコマンドバーが縦積みになり、横スクロールを強いない
test('NFR-UX-001 AC-058: 狭い画面ではコマンドバーを縦積みにする規則がある', () => {
  assert.match(app, /@media \(max-width: 767px\)[^]*\.commandbar \{ flex-direction: column/);
  assert.match(app, /\.commandbar \{[^}]*flex-wrap: wrap/);
});

// NFR-UX-001 AC-059: 動きの軽減で遷移・アニメーションを省く。通常時は短い遷移を使う
test('NFR-UX-001 AC-059: prefers-reduced-motion で transition/animation を省き、通常時はトークンの短い遷移', () => {
  assert.match(app, /@media \(prefers-reduced-motion: reduce\)[^]*animation: none !important; transition: none !important/);
  assert.match(app, /transition: background-color var\(--duration-fast\) var\(--easing-standard\)/);
});

// NFR-UX-001 AC-060: コマンドバーの定義（アイコン・主要コマンド・状態文言）
test('NFR-UX-001 AC-060: すべてのコマンドにアイコンがあり、状態文言は日英で状態・音声認識・言語・表示を示す', async () => {
  for (const [, names] of GROUPS) for (const n of names) assert.ok(ICONS[n], `${n} のアイコン`);
  assert.ok(PRIMARY.has('session.start'));
  const a = await createApp({ storage: null ?? undefined, env: {}, speechSource: { processLocally: true, start() {}, stop() {} } });
  const ja = a.getCommandBar().status.text;
  assert.match(ja, /準備中/); assert.match(ja, /音声認識: 使えます/); assert.match(ja, /日本語/); assert.match(ja, /2D/);
  a.setLang('en'); a.setViewMode('3d');
  const en = a.getCommandBar().status.text;
  assert.match(en, /Getting ready/); assert.match(en, /Speech: available/); assert.match(en, /3D/);
  assert.doesNotMatch(en, /[\u3000-\u30ff\u3400-\u9fff]/);
  assert.ok(a.getCommandBar().items.every((i) => i.tabbable && i.label));
});
