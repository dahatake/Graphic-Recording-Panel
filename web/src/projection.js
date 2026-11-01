// FR-100 AC-589〜AC-591: 投影のプリセット（画面の幅・視聴距離）と、最小文字サイズを下回る要素の警告。
// - 判定は、表示される文字のサイズ（図の幅の px）とプリセットの最小文字サイズの比べだけの決定的な計算（AC-591）。生成 AI・外部通信は使わない。
// - プリセットの最小文字サイズは、そのプリセットの幅の図での px で、換算しない（PARAM-138）。警告は図の内容・保存物を変えない（画面の表示だけ）。
// - プレゼンテーション（FR-010・FR-090）で保つ文字の最小サイズは PARAM-137（24 px。図の幅 1920 px 換算）で、プリセットを選んでいても変わらない（AC-590）。
import { readJson, writeJson } from './persist.js';
import { escapeHtml } from './outline.js';

export const PROJECTION_KEY = 'grp.projection';
export const PRESENTATION_MIN_PX = 24; // PARAM-137
export const PRESENTATION_BASE_WIDTH = 1920;
// PARAM-138: 投影のプリセット（既定は「使わない」＝ null）
export const PROJECTION_PRESETS = Object.freeze([
  Object.freeze({ id: 'meeting-small', widthPx: 1280, distanceM: 3, minPx: 18 }),
  Object.freeze({ id: 'meeting-large', widthPx: 1920, distanceM: 8, minPx: 28 }),
  Object.freeze({ id: 'hall', widthPx: 1920, distanceM: 15, minPx: 40 }),
]);
export const presetById = (id) => PROJECTION_PRESETS.find((p) => p.id === id) ?? null;

// 表示される文字の px（実際の表示幅）を、図の幅（既定 1920 px）に換算する（AC-591）
export const toFigureWidthPx = (px, shownWidth, figureWidth = PRESENTATION_BASE_WIDTH) => (shownWidth > 0 ? (px * figureWidth) / shownWidth : px);
// プレゼンテーションの表示の文字サイズ: 24 px（1920 px 換算）を下回らない。収まらない要素は縮めず、拡大・次のスライドへ分ける（AC-590）
export const presentationFontPx = (px) => Math.max(Number(px) || 0, PRESENTATION_MIN_PX);

// 小さい文字の要素の判定。elements: [{ id, name, size }]（size は図の幅の px）。同じ入力から毎回同じ結果（AC-591）
export function findSmallText(elements, preset, { presenting = false } = {}) {
  if (!preset) return [];
  const out = [];
  for (const e of elements) {
    const size = presenting ? presentationFontPx(e.size) : e.size;
    if (size < preset.minPx) out.push({ id: e.id, kind: e.kind ?? 'point', name: e.name, size, min: preset.minPx });
  }
  return out;
}

const STRINGS = {
  ja: {
    'projection.label': '投影', 'projection.none': '使わない',
    'projection.meeting-small': '会議室（小）', 'projection.meeting-large': '会議室（大）', 'projection.hall': 'ホール',
    'projection.small': '小さい文字', 'projection.unit': 'px',
    'projection.optionText': '{name}（幅 {w} px・{d} m・最小 {min} px）',
    'projection.status': '{name}。最小文字サイズ {min} px。小さい文字の要素 {n} 件',
    'projection.statusNone': '投影のプリセットを使いません',
    'projection.detail': '{name}（現在 {size} px／最小 {min} px）',
    'projection.invalid': '投影のプリセットは、リストの中から選んでください',
  },
  en: {
    'projection.label': 'Projection', 'projection.none': 'Not used',
    'projection.meeting-small': 'Small meeting room', 'projection.meeting-large': 'Large meeting room', 'projection.hall': 'Hall',
    'projection.small': 'Small text', 'projection.unit': 'px',
    'projection.optionText': '{name} (width {w} px, {d} m, minimum {min} px)',
    'projection.status': '{name}. Minimum text size {min} px. {n} elements with small text',
    'projection.statusNone': 'No projection preset is used',
    'projection.detail': '{name} (now {size} px / minimum {min} px)',
    'projection.invalid': 'Choose the projection preset from the list',
  },
};

export function projectionModule(ctx) {
  const { api, state } = ctx;
  ctx.i18n.addStrings(STRINGS);
  const t = (k) => ctx.i18n.t(k);
  const fill = (s, m) => s.replace(/\{(\w+)\}/g, (_, k) => String(m[k] ?? ''));

  let preset = null; // 端末ごとの設定（既定は使わない）
  { const raw = readJson(ctx.storage, PROJECTION_KEY); if (raw && presetById(raw.presetId)) preset = presetById(raw.presetId); }

  const presetName = (p) => t(`projection.${p.id}`);
  const options = () => [
    { value: 'none', label: t('projection.none') },
    ...PROJECTION_PRESETS.map((p) => ({ value: p.id, label: fill(t('projection.optionText'), { name: presetName(p), w: p.widthPx, d: p.distanceM, min: p.minPx }) })),
  ];
  api.getProjectionPreset = () => ({ id: preset ? preset.id : null, name: preset ? presetName(preset) : t('projection.none'), minPx: preset ? preset.minPx : null, widthPx: preset ? preset.widthPx : null, distanceM: preset ? preset.distanceM : null, options: options() });

  // 文字の要素（シーンの見出し・要点）と、表示される文字のサイズ（図の幅の px）。図の演出の記述（getDiagramStyle）と同じ値
  const elements = () => {
    const style = api.getDiagramStyle?.();
    if (!style) return [];
    const els = [];
    for (const s of style.scenes) {
      const sc = state.scenes.find((x) => x.id === s.id);
      if (!sc) continue;
      els.push({ id: sc.id, kind: 'scene', name: sc.heading, size: s.heading.fontSize });
      for (const p of s.points) { const pt = sc.points.find((x) => x.id === p.id); if (pt) els.push({ id: pt.id, kind: 'point', name: pt.text, size: p.fontSize }); }
    }
    return els;
  };
  const presenting = () => (state.presentation?.status ?? 'idle') !== 'idle';

  let memo = null; // NFR-PERF-003: データの版数・プリセット・プレゼン状態が同じなら判定をやり直さない
  const NONE = { preset: null, minPx: null, count: 0, items: [], ids: new Set() };
  api.getProjectionWarnings = () => {
    if (!preset) return NONE;
    const key = `${ctx.getDataVersion?.() ?? 'x'}|${preset?.id ?? ''}|${presenting()}|${state.lang}`;
    if (memo && memo.key === key && memo.key.indexOf('x|') !== 0) return memo.value;
    const items = findSmallText(elements(), preset, { presenting: presenting() }).map((w) => ({
      ...w, label: t('projection.small'), text: `${t('projection.small')}: ${fill(t('projection.detail'), { name: w.name, size: w.size, min: w.min })}`,
    }));
    const value = { preset: preset ? preset.id : null, minPx: preset ? preset.minPx : null, count: items.length, items, ids: new Set(items.map((w) => w.id)) };
    memo = { key, value };
    return value;
  };
  api.getProjectionSignature = () => { const w = api.getProjectionWarnings(); return w.preset ? `${w.preset}:${w.items.map((i) => i.id).join(',')}` : ''; };

  const say = () => {
    const w = api.getProjectionWarnings();
    const text = preset ? fill(t('projection.status'), { name: presetName(preset), min: preset.minPx, n: w.count }) : t('projection.statusNone');
    state.message = { key: 'projection.status', text };
  };
  api.setProjectionPreset = (id) => {
    const next = id === null || id === 'none' || id === '' || id === undefined ? null : presetById(id);
    if (next === null && id != null && id !== 'none' && id !== '') { ctx.change(() => { state.message = { key: 'projection.invalid', text: t('projection.invalid') }; }); return { ok: false, reason: 'unknown' }; }
    preset = next; memo = null;
    writeJson(ctx.storage, PROJECTION_KEY, { presetId: preset ? preset.id : null });
    ctx.change(() => { say(); });
    return { ok: true };
  };
  ctx.on('lang', () => { if (state.message?.key === 'projection.status') ctx.change(() => { say(); }); });

  // ---- テキスト一覧・ポップアップの同じ項目に、同じ語（小さい文字）と、名前・現在の大きさ・最小の大きさを文字で示す（色だけに頼らない） ----
  const warnHtml = (id) => {
    const w = api.getProjectionWarnings();
    if (!w.ids.has(id)) return '';
    const it = w.items.find((x) => x.id === id);
    return ` <span class="badge badge-small-text" data-projection-warn="1"><span aria-hidden="true">▣</span> ${escapeHtml(it.text)}</span>`;
  };
  const basePoint = api.getPointExtraHtml;
  api.getPointExtraHtml = (p) => `${basePoint ? basePoint(p) : ''}${warnHtml(p.id)}`;
  const baseHead = api.getHeadingExtraHtml;
  api.getHeadingExtraHtml = (scene) => `${baseHead ? baseHead(scene) : ''}${warnHtml(scene.id)}`;

  // ---- ［設定］画面の項目（端末ごとに保存。既定は使わない） ----
  const FIELD_ID = 'projection.preset';
  const baseDialog = api.getSettingsDialog;
  api.getSettingsDialog = () => {
    const d = baseDialog();
    if (!d) return null;
    return { ...d, fields: [...d.fields, { id: FIELD_ID, label: t('projection.label'), value: preset ? preset.id : 'none', text: api.getProjectionPreset().name, options: options(), role: 'combobox', focusable: true }] };
  };
  const baseView = api.getSettingsView;
  api.getSettingsView = (...a) => { const v = baseView(...a); return { ...v, fields: [...v.fields, { id: FIELD_ID, visible: true }] }; };
}
