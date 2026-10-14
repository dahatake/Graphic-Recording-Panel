// FR-020 3D 表現の評価軸（契約: tests/system/CONTRACT.md「3D の評価軸」）。DOM に依存しない純関数。
// 議論のデータ（シーン・要点・感情・整理の割り当て）から、評価軸の候補と各シーンの値・位置を算出する。
import { classifyPoint, KINDS } from './diagram.js';
import { sceneEmotions } from './emotion.js';

export const DEFAULT_AXES = Object.freeze({ x: 'pointCount', y: 'emotion', z: 'time' });
export const SLOTS = ['x', 'y', 'z'];
export const KIND_IDS = Object.keys(KINDS); // conclusion, issue, idea, note（FR-015）
export const kindCountId = (k) => `kindCount.${k}`;

const RANGE = { x: 560, y: 280 };
const SPACING_Z = 180; // 深さの 1 シーンあたりの目安（従来の配置と同じ）
const DUP_DX = 30; const DUP_DY = 22;

export function parseAxes(raw) {
  const ids = SLOTS.map((s) => raw?.[s]);
  const ok = ids.every((v) => typeof v === 'string') && new Set(ids).size === 3;
  return ok ? { x: raw.x, y: raw.y, z: raw.z } : { ...DEFAULT_AXES };
}

// arr: app.getArrangement() の結果（なければ null）。t: 文言の取得。
export function buildCandidates(scenes, arr, t) {
  const num = (id, label, values) => ({ id, label, values, valueLabels: values.map(String), kind: 'number' });
  const list = [
    { id: 'time', label: t('axes3d.axis.time'), values: scenes.map((_, i) => i), valueLabels: scenes.map((s, i) => `${i + 1}: ${s.heading}`), kind: 'order' },
    num('pointCount', t('axes3d.axis.pointCount'), scenes.map((s) => s.points.length)),
    num('utterances', t('axes3d.axis.utterances'), scenes.map((s) => s.points.reduce((n, p) => n + [...p.text].length, 0))),
    num('emotion', t('axes3d.axis.emotion'), scenes.map((s) => sceneEmotions(s).length)),
  ];
  for (const k of KIND_IDS) {
    list.push(num(kindCountId(k), `${t('axes3d.axis.kindCount')}: ${t(`axes3d.kind.${k}`)}`, scenes.map((s) => s.points.filter((p) => classifyPoint(p.text) === k).length)));
  }
  for (const [id, key, axisKey] of [['arrangeV', 'vertical', 'v'], ['arrangeH', 'horizontal', 'h']]) {
    const A = arr?.axes?.[key];
    const un = arr?.unclassified?.label ?? t('arrange.unclassified');
    const n = A ? A.sections.length : 0;
    const assigned = new Map((arr?.assignments ?? []).filter((a) => a.kind === 'scene').map((a) => [a.objectId, a[axisKey]]));
    const idx = scenes.map((s) => { const i = A ? A.sections.findIndex((x) => x.id === assigned.get(s.id)) : -1; return i < 0 ? n : i; });
    list.push({
      id, label: `${t(`axes3d.axis.${id}`)}${A ? `「${A.name}」` : ''}`, values: idx, kind: 'section',
      valueLabels: idx.map((i) => (i < n ? A.sections[i].label : un)),
      assignKey: axisKey,
    });
  }
  for (const c of list) {
    const distinct = new Set(c.values).size;
    c.available = c.id === 'time' ? scenes.length > 0 : distinct >= 2;
    c.reason = c.available ? null : t(c.kind === 'section' ? 'axes3d.reason.noAssign' : 'axes3d.reason.same');
  }
  return list;
}

// 軸の組から各シーンの位置・値を求める。位置は値が大きいほど大きい座標（同値は同座標）。重なる場合は少しずらす。
export function placeScenes(scenes, axes, cands) {
  const by = new Map(cands.map((c) => [c.id, c]));
  const zr = SPACING_Z * Math.max(2, scenes.length - 1);
  const coord = (slot, c, i) => {
    const vs = c.values; const min = Math.min(...vs); const max = Math.max(...vs);
    if (max === min) return 0;
    const f = (vs[i] - min) / (max - min);
    return slot === 'z' ? Math.round((f - 1) * zr) : Math.round(f * RANGE[slot] - RANGE[slot] / 2);
  };
  const seen = new Map();
  return scenes.map((s, i) => {
    const position = {}; const values = {};
    for (const slot of SLOTS) {
      const c = by.get(axes[slot]);
      position[slot] = c ? coord(slot, c, i) : 0;
      values[slot] = c ? { axis: c.id, axisLabel: c.label, value: c.values[i], text: c.valueLabels[i] } : null;
    }
    const key = `${position.x},${position.y},${position.z}`;
    const k = seen.get(key) ?? 0; seen.set(key, k + 1);
    position.x += k * DUP_DX; position.y += k * DUP_DY;
    return { sceneId: s.id, position, values };
  });
}

// 軸ごとの目盛り・区分の見出し（値の昇順・重複なし）
export function buildTicks(axes, cands) {
  const by = new Map(cands.map((c) => [c.id, c]));
  const out = {};
  for (const slot of SLOTS) {
    const c = by.get(axes[slot]);
    const seen = new Map();
    if (c) c.values.forEach((v, i) => { if (!seen.has(v)) seen.set(v, c.valueLabels[i]); });
    out[slot] = [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([value, label]) => ({ value, label }));
  }
  return out;
}
