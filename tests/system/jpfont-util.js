// NFR-UX-012（日本語の文字の書体 Yu Gothic UI）の System Test の補助。契約: tests/system/CONTRACT-STYLE-PRESET.md「日本語の字形の書体（NFR-UX-012）」
// 期待値は要求定義書（NFR-UX-012 本文・AC-465・AC-466・AC-407・PARAM-093）だけから決める。
// 「従来の並び」は AC が基準にする NFR-UX-012 の前の書体の指定の並び（統合ブランチ de1f935 の記録）。記録をやり直してはならない。
import assert from 'node:assert/strict';
import { fontList } from './stylepreset-util.js';

export const YU = 'Yu Gothic UI';
// PARAM-093: 欧文専用の書体の一覧（書体の指定で Yu Gothic UI より前に置いてよい書体）
export const PARAM_093 = ['Segoe UI', 'Segoe UI Variable', 'Segoe Print', 'Ink Free', 'Arial Rounded MT Bold'];
const P93 = new Set(PARAM_093.map((s) => s.toLowerCase()));
export const isLatinOnly = (name) => P93.has(String(name).toLowerCase());

// 従来の並び（NFR-UX-012 の前。de1f935 の記録）
export const TRADITIONAL = {
  // 画面（UI）の書体の指定（AC-061。tokens.css の --font-sans）
  ui: ['Segoe UI', 'Segoe UI Variable', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', 'sans-serif'],
  // 既存の 4 つの描画スタイル（手書き調・アニメ調・シンプル・RPG風）の図（SVG）・PNG・PDF・RPG の地図の文字
  legacy: ['system-ui', 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', 'sans-serif'],
  // 書体の系統（FR-075 AC-407）
  handwriting: ['Klee One', 'Klee', 'Yomogi', 'Zen Kurenaido', 'Segoe Print', 'Ink Free', 'Zen Maru Gothic', 'M PLUS Rounded 1c', 'Kosugi Maru', 'Hiragino Maru Gothic ProN', 'Arial Rounded MT Bold', 'sans-serif'],
  roundGothic: ['Zen Maru Gothic', 'M PLUS Rounded 1c', 'Kosugi Maru', 'Hiragino Maru Gothic ProN', 'Arial Rounded MT Bold', 'sans-serif'],
  gothic: ['BIZ UDPGothic', 'Hiragino Sans', 'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', 'sans-serif'],
};

// NFR-UX-012 の並び: 従来の並びにあった欧文専用の書体（従来の順）→ Yu Gothic UI → 従来の並びの残り（従来の順）
export function expectedStack(traditional) {
  const t = traditional.filter((n) => n !== YU);
  return [...t.filter(isLatinOnly), YU, ...t.filter((n) => !isLatinOnly(n))];
}

const norm = (n) => String(n).trim();
// 規則の確認（AC-465・AC-466）: Yu Gothic UI があり、それより前は欧文専用の書体だけ
export function assertJpOrder(list, where) {
  const names = list.map(norm);
  const i = names.indexOf(YU);
  assert.ok(i >= 0, `${where}: 書体の指定に Yu Gothic UI がある: ${names.join(', ')}`);
  for (const n of names.slice(0, i)) assert.ok(isLatinOnly(n), `${where}: Yu Gothic UI より前は欧文専用の書体（PARAM-093）だけ。「${n}」は日本語の字形を持ち得る: ${names.join(', ')}`);
  assert.equal(names.filter((n) => n === YU).length, 1, `${where}: Yu Gothic UI は 1 回`);
  return i;
}

// 書体の指定の値（"700 16px 'Yu Gothic UI', sans-serif" など Canvas の font の値も可）→ 書体名の並び
export function familiesOfFont(fontValue) {
  const s = String(fontValue ?? '').trim();
  const m = /^(?:.*?\s)?\d+(?:\.\d+)?(?:px|pt|em|rem|%)(?:\/\S+)?\s+(.+)$/.exec(s);
  return fontList(m ? m[1] : s);
}

// Canvas 2D の代用（helpers.js の makeCanvasFactory と同じ振る舞い）。font の代入と描画の呼び出しを記録する。
export function makeRecordingCanvas() {
  const log = { texts: [], fonts: [], ops: [], created: [] };
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44]);
  const factory = (w, h) => {
    log.created.push({ w, h });
    let canvas;
    const ctx = new Proxy({}, {
      get(t, p) {
        if (p === 'fillText' || p === 'strokeText') return (s) => { log.texts.push({ text: String(s), font: t.font }); };
        if (p === 'measureText') return (s) => ({ width: String(s).length * 8 });
        if (p === 'canvas') return canvas;
        if (p in t) return t[p];
        return (...a) => { log.ops.push(String(p)); return undefined; };
      },
      set(t, p, v) { if (p === 'font') log.fonts.push(String(v)); t[p] = v; return true; },
    });
    canvas = { width: w, height: h, getContext: () => ctx, toBytes: async () => png };
    return canvas;
  };
  return Object.assign(factory, { log });
}

// 外部へのリクエストを数える（fetch・XMLHttpRequest・WebSocket・EventSource・sendBeacon）
export async function withNetSpy(fn) {
  const calls = []; const saved = {};
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: function (...a) { calls.push({ k, a }); throw new Error('network ' + k); } });
  }
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { ...(nav?.value || {}), sendBeacon: (...a) => { calls.push({ k: 'sendBeacon', a }); return false; } } });
  try { await fn(); } finally {
    for (const k of Object.keys(saved)) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
    if (nav) Object.defineProperty(globalThis, 'navigator', nav); else delete globalThis.navigator;
  }
  return calls;
}

// 画面の CSS の書体の指定を集める（font-family・--font-* の書体の並び・font の一括指定）
export function cssFontStacks(css) {
  const out = []; const vars = {};
  const blocks = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const [, sel, body] of blocks) for (const d of body.matchAll(/(--font-[\w-]+)\s*:\s*([^;]+);?/g)) vars[d[1]] = { value: d[2].trim(), sel: sel.trim() };
  const resolve = (v) => v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g, (m, name, fb) => (vars[name] ? vars[name].value : (fb ?? m)));
  const isStack = (v) => /,/.test(v) || /["']/.test(v);
  for (const [name, { value, sel }] of Object.entries(vars)) if (isStack(value) && !/^\s*var\(/.test(value)) out.push({ where: `${sel} ${name}`, list: fontList(value), raw: value });
  for (const [, sel, body] of blocks) {
    for (const d of body.matchAll(/(?:^|[;\s])font-family\s*:\s*([^;]+);?/g)) {
      const v = d[1].trim();
      if (/^(inherit|initial|unset|revert)$/i.test(v)) continue;
      out.push({ where: `${sel.trim()} font-family`, list: fontList(resolve(v)), raw: v });
    }
    for (const d of body.matchAll(/(?:^|[;\s])font\s*:\s*([^;]+);?/g)) {
      const v = resolve(d[1].trim());
      if (/^(inherit|initial|unset|revert)$/i.test(v) || !isStack(v)) continue;
      out.push({ where: `${sel.trim()} font`, list: familiesOfFont(v), raw: d[1].trim() });
    }
  }
  return { stacks: out, vars };
}
