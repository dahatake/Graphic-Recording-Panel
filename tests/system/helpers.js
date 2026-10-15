// System Test 共通ヘルパー。契約は tests/system/CONTRACT.md。
// 期待値は要求定義書の受入基準だけから決める。web/ の実装は import して呼ぶだけ。
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WEB = path.join(ROOT, 'web');
export const PARAM = { UPPER_SEC: 3, SCENE_GAP_SEC: 20, MAX_FILE_MB: 1, DWELL_SEC: 8 };
export const CJK = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/;

export async function loadApp() {
  const file = path.join(WEB, 'src', 'app.js');
  if (!fs.existsSync(file)) throw new Error('web/src/app.js がありません（CONTRACT.md の createApp が未実装）');
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.createApp !== 'function') throw new Error('web/src/app.js は createApp を export する必要があります');
  return mod.createApp;
}

export class FakeStorage {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(String(k), String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
  dump() { return [...this.m.entries()]; }
}

export class FakeScheduler {
  constructor() { this.t = 0; this.q = []; this.n = 1; }
  setTimeout(fn, ms) { const id = this.n++; this.q.push({ id, at: this.t + ms, fn }); return id; }
  clearTimeout(id) { this.q = this.q.filter((e) => e.id !== id); }
  setInterval() { throw new Error('契約: プレゼンは scheduler.setTimeout だけを使う'); }
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      const next = this.q.filter((e) => e.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      this.q = this.q.filter((e) => e !== next);
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}

// document.visibilityState / visibilitychange の偽装（契約: options.visibility）。
export class FakeVisibility {
  constructor() { this.hidden = false; this.onchange = null; }
  set(hidden) { this.hidden = hidden; if (this.onchange) this.onchange(); }
}

export class FakeSpeech {
  // 日本語対応（AC-066〜069）: supported（API の有無）、availability（言語ごとの 'local'|'downloadable'|'remote'|'unsupported'。
  // 省略した言語は processLocally から導く＝従来の疑似音声源と同じ）、installOk（install の結果）。
  constructor({ processLocally = true, supported = true, availability = {}, installOk = true } = {}) {
    this.processLocally = processLocally; this.supported = supported; this.availability = { ...availability };
    this.installOk = installOk; this.installCalls = []; this.startCalls = []; this.stopCalls = 0;
    this.onresult = null; this.onerror = null; this.onend = null;
  }
  availabilityFor(lang) { return this.availability[lang] ?? (this.processLocally ? 'local' : 'remote'); }
  async install(opts) {
    this.installCalls.push(opts);
    if (this.installOk) { this.availability[opts.lang] = 'local'; this.processLocally = true; }
    return { ok: this.installOk };
  }
  start(opts) { this.startCalls.push(opts); }
  stop() { this.stopCalls++; }
  // ブラウザによる音声認識の自動終了の模擬（NFR-BG-001）
  end() { if (this.onend) this.onend(); }
  emit(text, isFinal = true, extra = {}) { if (this.onresult) this.onresult({ text, isFinal, ...extra }); }
  fail(code) { if (this.onerror) this.onerror({ code }); }
}

// 何を呼ばれても記録して返す Canvas 2D コンテキストの代用。fillText の文字列を集める。
export function makeCanvasFactory() {
  const texts = [];
  const log = { texts, created: [] };
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44]);
  const factory = (w, h) => {
    log.created.push({ w, h });
    const ctx = new Proxy({}, {
      get(t, p) {
        if (p === 'fillText' || p === 'strokeText') return (s) => { texts.push(String(s)); };
        if (p === 'measureText') return (s) => ({ width: String(s).length * 8 });
        if (p === 'canvas') return canvas;
        if (p in t) return t[p];
        return () => undefined;
      },
      set(t, p, v) { t[p] = v; return true; },
    });
    const canvas = { width: w, height: h, getContext: () => ctx, toBytes: async () => png };
    return canvas;
  };
  return Object.assign(factory, { log });
}

export function makeEnv(over = {}) {
  const clock = { t: 1_700_000_000_000 };
  const env = {
    storage: new FakeStorage(),
    scheduler: new FakeScheduler(),
    speech: new FakeSpeech(),
    downloads: [],
    canvasFactory: makeCanvasFactory(),
    clock,
    now: () => clock.t,
    tick: (sec) => { clock.t += sec * 1000; },
    ...over,
  };
  env.options = {
    storage: env.storage, scheduler: env.scheduler, speechSource: env.speech, now: env.now,
    canvasFactory: env.canvasFactory, download: (f) => { env.downloads.push(f); },
    origin: 'http://localhost',
    env: { webgl: true, reducedMotion: false, viewportWidth: 1280 },
    ...(over.options || {}),
  };
  return env;
}

export async function newApp(over = {}) {
  const createApp = await loadApp();
  const env = makeEnv(over);
  const app = await createApp(env.options);
  return { app, env, createApp };
}

// 3 シーン（"次のシーン" で区切る）のセッションを作る。
export async function seedThreeScenes(app, env) {
  const texts = [['予算の見直しが必要です', 'コストが高くて困った'], ['来月のリリース計画を決める'], ['担当者の割り当てを確認する']];
  app.commands['session.start']();
  texts.forEach((group, i) => {
    group.forEach((t) => { app.setDraft(t); app.submitDraft(); env.tick(1); });
    if (i < texts.length - 1) app.commands['session.nextScene']();
  });
  return texts.flat();
}

// 詳細度の既定は「大項目」（AC-130）。要点・関係線・絵記号を図で確かめるテストは、冒頭でこれを呼んで「詳細」へ切り替える（FR-026、CONTRACT.md「図の詳細度」）。
export function toDetail(app, level = 'detail') {
  const r = app.setDetailLevel(level);
  if (!r || r.ok !== true || app.getDetailLevel() !== level) throw new Error(`詳細度を ${level} に切り替えられない`);
  return app;
}

export function visibleTexts(state) {
  const out = [];
  for (const s of state.scenes) { out.push(s.heading); for (const p of s.points) out.push(p.text); }
  return out;
}

export function bytesToLatin1(u8) { return Buffer.from(u8).toString('latin1'); }

// PDF から文字列を取り出す（契約: /ActualText <FEFF...> と (literal) / <hex> の Tj）
export function pdfTexts(u8) {
  const s = bytesToLatin1(u8);
  const out = [];
  for (const m of s.matchAll(/\/ActualText\s*<([0-9A-Fa-f\s]+)>/g)) {
    const hex = m[1].replace(/\s+/g, '');
    const buf = Buffer.from(hex, 'hex');
    let b = buf;
    if (b[0] === 0xfe && b[1] === 0xff) b = b.subarray(2);
    const sw = Buffer.from(b); sw.swap16();
    out.push(sw.toString('utf16le'));
  }
  for (const m of s.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) out.push(m[1]);
  return out.join('\n');
}

export function keyFor(app, command) {
  const b = app.keymap.find((k) => k.command === command);
  return b ? { key: b.key, ctrlKey: !!b.ctrl, altKey: !!b.alt, shiftKey: !!b.shift } : null;
}
