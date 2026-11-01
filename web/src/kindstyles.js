// FR-097 1 つの図での複数の手書きスタイルの併用（要点の種類ごと）。DOM に依存しない。
// 設定で有効にすると、要点の種類（結論・課題・提案・アイデア・未決定・補足。FR-052）ごとに、手書き系のスタイル
// （手書き調・黄黒手書き風・黒板風・付箋ボード風・色鉛筆風・クラフト紙風）を 1 つ割り当てて、同じ図の中で併用できる。
// 既定は無効。無効のときは、選んだ 1 つのスタイルだけで描く（FR-029。AC-146 は変わらない）。
// 割り当てが異なる種類の要点は、それぞれのスタイルの線・塗り・文字の飾り・書体で描かれる（presetdiagram.js が要点ごとに look を使う）。
// 配置・文字の大きさの階層はスタイルによらず同じ（AC-430・AC-431 は再配置の規則のまま）。種類は色だけでなく形・絵記号・ラベルで見分けられる（AC-146）。
import { buildLook, renderPresetSvg } from './presetdiagram.js';
import { hasVisualFields } from './stylepresets.js';

export const KIND_IDS = ['conclusion', 'issue', 'proposal', 'idea', 'undecided', 'note'];
// 手書き系スタイル（AC-564）
export const HANDWRITTEN_STYLE_IDS = ['handwritten', 'yellowBlack', 'chalkboard', 'stickyNotes', 'colorPencil', 'kraftPaper'];
// AC-565: 推奨セット（強調の強い種類に太い輪郭のスタイルを当てる）
export const RECOMMENDED = Object.freeze({
  conclusion: 'yellowBlack', issue: 'stickyNotes', proposal: 'kraftPaper', idea: 'kraftPaper', undecided: 'colorPencil', note: 'handwritten',
});
const DEFAULT_ASSIGN = Object.freeze(Object.fromEntries(KIND_IDS.map((k) => [k, 'handwritten'])));

export function parseKindStyles(raw) {
  const out = { enabled: false, assign: { ...DEFAULT_ASSIGN } };
  if (!raw || typeof raw !== 'object') return out;
  out.enabled = raw.enabled === true;
  if (raw.assign && typeof raw.assign === 'object') for (const k of KIND_IDS) if (HANDWRITTEN_STYLE_IDS.includes(raw.assign[k])) out.assign[k] = raw.assign[k];
  return out;
}

// 見た目の項目を持たない既存の定義（手書き調など）を、画風プリセットと同じ形で描けるようにする（preset: true）
export function presetify(spec) {
  if (!spec || typeof spec !== 'object') return null;
  if (hasVisualFields(spec)) return { ...spec, preset: true };
  return { ...spec, paper: 'plain', font: spec.id === 'handwritten' ? 'handwriting' : 'gothic', preset: true };
}

export function kindStylesModule(ctx) {
  const { state, api } = ctx;
  ctx.i18n.addStrings({
    ja: {
      'kindStyle.title': '種類別スタイル', 'kindStyle.on': '有効', 'kindStyle.off': '無効', 'msg.kindStyleSet': '種類別スタイルを設定しました', 'msg.kindStyleInvalid': '種類別スタイルには手書き系のスタイルだけを割り当てられます',
      'msg.kindStyleRecommended': '推奨セットを適用しました', 'cmd.kindStyle.toggle': '種類別スタイルの有効・無効を切り替え', 'cmd.kindStyle.recommend': '種類別スタイルの推奨セットを適用',
    },
    en: {
      'kindStyle.title': 'Styles by kind', 'kindStyle.on': 'On', 'kindStyle.off': 'Off', 'msg.kindStyleSet': 'Styles by kind were set', 'msg.kindStyleInvalid': 'Only hand-drawn styles can be assigned to a kind',
      'msg.kindStyleRecommended': 'The recommended set was applied', 'cmd.kindStyle.toggle': 'Toggle styles by kind', 'cmd.kindStyle.recommend': 'Apply the recommended styles by kind',
    },
  });
  state.kindStyles = parseKindStyles(null);

  api.getPointKindStyles = () => ({ enabled: state.kindStyles.enabled, assign: { ...state.kindStyles.assign } });
  api.setPointKindStyles = (input = {}) => {
    if (!input || typeof input !== 'object') return { ok: false, reason: 'invalid' };
    if (Object.hasOwn(input, 'enabled') && typeof input.enabled !== 'boolean') return { ok: false, reason: 'invalid' };
    const next = { ...state.kindStyles.assign };
    if (Object.hasOwn(input, 'assign')) {
      if (!input.assign || typeof input.assign !== 'object') return { ok: false, reason: 'invalid' };
      for (const [k, id] of Object.entries(input.assign)) {
        if (!KIND_IDS.includes(k)) return { ok: false, reason: 'invalid_kind' };
        if (!HANDWRITTEN_STYLE_IDS.includes(id) || !api.getDrawStyleSpec?.(id)) { ctx.change(() => ctx.setMessage('msg.kindStyleInvalid')); return { ok: false, reason: 'not_handwritten' }; }
        next[k] = id;
      }
    }
    ctx.change((s) => {
      if (typeof input.enabled === 'boolean') s.kindStyles.enabled = input.enabled;
      s.kindStyles.assign = next;
      ctx.setMessage('msg.kindStyleSet');
    });
    return { ok: true };
  };
  api.applyRecommendedPointKindStyles = () => {
    ctx.change((s) => { s.kindStyles.assign = { ...RECOMMENDED }; ctx.setMessage('msg.kindStyleRecommended'); });
    return { ok: true };
  };
  ctx.registerCommand('kindStyle.toggle', () => api.setPointKindStyles({ enabled: !state.kindStyles.enabled }));
  ctx.registerCommand('kindStyle.recommend', () => api.applyRecommendedPointKindStyles());
  ctx.registerKey({ key: '.', ctrl: true, alt: true, shift: true, command: 'kindStyle.toggle' });
  ctx.registerKey({ key: '/', ctrl: true, alt: true, shift: true, command: 'kindStyle.recommend' });

  // 描画に使えるか: 有効で、現在のスタイルが RPG風でなく、整理の表示でなく、ワークショップ型の描画に取られていないとき
  const eligible = () => {
    if (!state.kindStyles.enabled) return false;
    if (api.getDrawStyle?.() === 'rpg') return false;
    if (state.displayMode === 'arrange') return false;
    const info = api.getLayoutInfo?.();
    return !(info && info.applied && info.head === 'workshop');
  };
  api.presetifyStyleSpec = presetify;
  // 種類 → 画風の定義（有効なときだけ。無効なら null）。保存（PNG・PDF）も同じ値を使う
  api.getKindStyleSpecs = () => {
    if (!state.kindStyles.enabled) return null;
    const out = {};
    for (const k of KIND_IDS) out[k] = presetify(api.getDrawStyleSpec?.(state.kindStyles.assign[k]));
    return out;
  };
  // 種類 → look（描画用。強制カラーの間は従来どおりシステム色）
  api.getKindLooks = () => {
    if (!eligible() || api.getForcedColors?.() === true) return null;
    const specs = api.getKindStyleSpecs();
    const out = {};
    for (const k of KIND_IDS) out[k] = { ...buildLook(specs[k]), styleId: specs[k].id };
    return out;
  };

  const prev = api.renderBaseSvg;
  api.renderBaseSvg = () => {
    if (!eligible()) return prev();
    const spec = presetify(api.getDrawStyleSpec?.());
    if (!spec) return prev();
    return renderPresetSvg(ctx, spec, api.getForcedColors?.() === true, prev);
  };

  ctx.registerPersist('kindStyles', {
    export: () => {
      const ks = state.kindStyles;
      const dflt = KIND_IDS.every((k) => ks.assign[k] === DEFAULT_ASSIGN[k]);
      return ks.enabled || !dflt ? { enabled: ks.enabled, assign: { ...ks.assign } } : undefined;
    },
    import: (v) => { state.kindStyles = parseKindStyles(v); },
    reset: () => { state.kindStyles = parseKindStyles(null); },
  });
}
