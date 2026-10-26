// FR-079・FR-080 の System Test の共通部品（契約: tests/system/CONTRACT-ARRANGE.md）。
// 期待値は要求定義書の受入基準だけから決める。web/ の実装は import して呼ぶだけ。
import assert from 'node:assert/strict';
import { FakeScheduler, FakeVisibility, newApp, toDetail } from './helpers.js';

export const P = {
  INTERVAL_DEFAULT_SEC: 10, // PARAM-084
  INTERVAL_MAX_SEC: 300, // PARAM-085
  SILENCE_SEC: 3, // PARAM-086
  HOLD_MAX_SEC: 30, // PARAM-087
  GROUP_MAX: 7, // PARAM-088
  ALIGN_PX: 1, // PARAM-091
  UPPER_SEC: 15, // PARAM-001（2026-10-26 に 3 から変更）
  RESUME_SEC: 2, // PARAM-008
  LABEL_MAX: 6, // PARAM-011（全角 1・半角 0.5）
};

// AC-426 の種類の順（ja のラベル。FR-052 の kindLabel）
export const KIND_ORDER = ['結論', '課題', '提案', 'アイデア', '未決定', '補足'];

// 合成データ（FR-052 の AC にある文例と、種類の語を含まない文）
export const T = {
  conclusion: 'Aを採用すると決まりました。',
  problem: 'コストが高くて困った',
  proposal: '案Aの採用を提案します。',
  plain1: '会議室は三階にあります',
  plain2: '資料は共有フォルダに置きました',
  plain3: '参加者は八名でした',
  plain4: '次回は木曜の午後です',
};

// タイマーの発火の時刻に now() を合わせる時計（テスト用の時計の注入）。
export class LinkedScheduler extends FakeScheduler {
  constructor(clock) { super(); this.clock = clock; this.base = clock.t; }
  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      const next = this.q.filter((e) => e.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!next) break;
      this.q = this.q.filter((e) => e !== next);
      this.t = next.at;
      this.clock.t = this.base + this.t;
      next.fn();
    }
    this.t = end;
    this.clock.t = this.base + end;
  }
  // 起動からの経過 ms がちょうど at になるまで進める
  advanceTo(at) { assert.ok(at >= this.t, `時計を戻せない（${this.t} → ${at}）`); this.advance(at - this.t); }
}

export async function arrangeApp({ storage, reducedMotion = false, visibility, lang } = {}) {
  const clock = { t: 1_700_000_000_000 };
  const scheduler = new LinkedScheduler(clock);
  const over = {
    clock, scheduler, now: () => clock.t, tick: (sec) => scheduler.advance(sec * 1000),
    options: { env: { webgl: true, reducedMotion, viewportWidth: 1280 }, ...(visibility ? { visibility } : {}) },
  };
  if (storage) over.storage = storage;
  const r = await newApp(over);
  if (lang) r.app.setLang(lang);
  return { ...r, clock, scheduler, at: () => scheduler.t };
}

export { FakeVisibility, toDetail };

// 注入した入力源（疑似音声認識）から確定結果を届ける
export function say(env, text) { env.speech.emit(text, true); }

export const elements = (app) => {
  const list = app.getDiagramElements();
  assert.ok(Array.isArray(list), 'getDiagramElements() は配列');
  return list;
};
export const box = (e) => ({ x: e.x, y: e.y, w: e.w, h: e.h });
export const posMap = (app) => new Map(elements(app).map((e) => [e.id, box(e)]));
export const pointIdOf = (app, text) => {
  const p = app.getState().scenes.flatMap((s) => s.points).find((q) => q.text === text);
  assert.ok(p, `要点「${text}」がある`);
  return p.id;
};
export const elementOfPoint = (app, pointId) => {
  const e = elements(app).find((x) => x.kind === 'point' && x.refIds.includes(pointId));
  assert.ok(e, `要点 ${pointId} の図の要素がある`);
  return e;
};
export const elementOfScene = (app, sceneId) => elements(app).find((x) => x.kind === 'scene' && x.refIds.includes(sceneId));

const ancestors = (byId, e) => { const out = new Set(); let p = e.parentId; while (p && !out.has(p)) { out.add(p); p = byId.get(p)?.parentId ?? null; } return out; };
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// 親子でない 2 つの要素の外枠は重ならない（AC-430(c)、AC-435 の暫定の位置）
export function assertNoOverlap(app, msg = '') {
  const list = elements(app);
  const byId = new Map(list.map((e) => [e.id, e]));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]; const b = list[j];
      if (ancestors(byId, a).has(b.id) || ancestors(byId, b).has(a.id)) continue;
      assert.ok(!overlap(a, b), `${msg} 要素 ${a.id} と ${b.id} の外枠が重なる`);
    }
  }
}

// 図の読み順の先頭か（同じシーンのほかの要点より上、同じ高さなら左）
export const before = (a, b) => a.y < b.y - P.ALIGN_PX || (Math.abs(a.y - b.y) <= P.ALIGN_PX && a.x < b.x);

// 同じ親の要素は、読み順の向きと直交する辺が PARAM-091 以内で揃う（縦並び→左端、横並び→上端）
export function assertAligned(siblings, msg = '') {
  if (siblings.length < 2) return;
  const xs = siblings.map((e) => e.x); const ys = siblings.map((e) => e.y);
  const vertical = Math.max(...xs) - Math.min(...xs) <= P.ALIGN_PX;
  const horizontal = Math.max(...ys) - Math.min(...ys) <= P.ALIGN_PX;
  assert.ok(vertical || horizontal, `${msg} 同じ親の要素の左端（縦並び）か上端（横並び）が ${P.ALIGN_PX}px 以内で揃う: ${JSON.stringify(siblings.map(box))}`);
}

export const gap = (a, b) => {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
};

export const kindLabelOf = (app, pointId) => {
  const p = app.getDiagramStyle().scenes.flatMap((s) => s.points).find((q) => q.id === pointId);
  assert.ok(p && typeof p.kindLabel === 'string', `要点 ${pointId} の種類のラベルがある`);
  return p.kindLabel;
};

// 記録を始め、詳細度を「詳細」にして、互いに語を共有しない 2 シーン（＝2 トピック）を作り、最初の再配置（起動から 10 秒）まで進める。
export async function seededDetail(opts = {}) {
  const r = await arrangeApp(opts);
  const { app, env, scheduler } = r;
  toDetail(app);
  app.commands['session.start']();
  scheduler.advanceTo(500); say(env, T.plain1);
  scheduler.advanceTo(1000); say(env, T.plain2);
  app.commands['session.nextScene']();
  scheduler.advanceTo(1500); say(env, T.plain3);
  scheduler.advanceTo(P.INTERVAL_DEFAULT_SEC * 1000);
  return r;
}
