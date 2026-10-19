// FR-029 描画スタイルの登録構造（共通部品「描画スタイルの登録」）。DOM に依存しない。
// スタイルの定義: { id, label: string | {ja,en}, line: {width, jitter}, fill: {mode}, text: {decor, icons} }
//   line.width  線の太さの倍率（> 0）／ line.jitter  手描き風の揺らぎの倍率（>= 0。0 で揺らぎなし）
//   fill.mode   'paper'（白地）| 'tint'（種類の色の淡い塗り）
//   text.decor  見出しの文字の飾り 'standard' | 'bold' | 'plain' ／ text.icons  要点・様子の絵記号を描くか
// 新しいスタイルは register(def) で足すだけで選択肢に現れる（既存の処理は変えない）。不正な定義は加えられない。
// FR-075: 見た目の項目（配色・紙面・書体・見出しの飾り・吹き出し・線・線画人物・画風の記述）を任意で持てる（stylepresets.js）。
import { PRESET_STYLES, validatePresetFields, hasVisualFields } from './stylepresets.js';

export const FILL_MODES = ['paper', 'tint'];
export const TEXT_DECORS = ['standard', 'bold', 'plain'];
export const DEFAULT_STYLE_ID = 'handwritten';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const BUILTIN_STYLES = [
  // 手書き調: FR-015 の手描き風（線の揺らぎ。従来の見た目）
  { id: 'handwritten', label: { ja: '手書き調', en: 'Hand-drawn' }, line: { width: 1, jitter: 1 }, fill: { mode: 'paper' }, text: { decor: 'standard', icons: true } },
  // アニメ調: 揺らぎのない太めの輪郭線と角の丸い塗りの面（絵記号は維持）
  { id: 'anime', label: { ja: 'アニメ調', en: 'Anime' }, line: { width: 1.6, jitter: 0 }, fill: { mode: 'tint' }, text: { decor: 'bold', icons: true } },
  // シンプル: 揺らぎ・装飾の絵記号を抑えた見た目
  { id: 'simple', label: { ja: 'シンプル', en: 'Simple' }, line: { width: 0.8, jitter: 0 }, fill: { mode: 'paper' }, text: { decor: 'plain', icons: false } },
  // RPG風（FR-047）: 拡張点（register）の定義の追加。描画は rpgmap.js が行う（既存 3 つの定義・処理は変えない）。選択肢の並びは末尾。
  { id: 'rpg', label: { ja: 'RPG風', en: 'RPG' }, line: { width: 1, jitter: 0 }, fill: { mode: 'paper' }, text: { decor: 'plain', icons: true } },
  // FR-076: 9 つの「〇〇風」（画風プリセット）。拡張点（register）の定義の追加で、既存の 4 つの定義・処理は変えない。
  ...PRESET_STYLES,
];

// 定義の検証。{ ok:true } か { ok:false, reason }（invalid_id / invalid_label / missing_line / missing_fill / missing_text、
// FR-075 AC-405 の見た目の項目: invalid_palette / low_contrast / invalid_paper / invalid_font / invalid_heading / invalid_balloon / invalid_stroke / invalid_figures / invalid_icons / invalid_description）。
export function validateStyle(def) {
  if (!isObj(def)) return { ok: false, reason: 'invalid_id' };
  if (typeof def.id !== 'string' || !def.id.trim()) return { ok: false, reason: 'invalid_id' };
  const lab = def.label;
  const labOk = (typeof lab === 'string' && lab.trim()) || (isObj(lab) && Object.values(lab).some((v) => typeof v === 'string' && v.trim()));
  if (!labOk) return { ok: false, reason: 'invalid_label' };
  if (!isObj(def.line) || !(isNum(def.line.width) && def.line.width > 0) || !(isNum(def.line.jitter) && def.line.jitter >= 0)) return { ok: false, reason: 'missing_line' };
  if (!isObj(def.fill) || !FILL_MODES.includes(def.fill.mode)) return { ok: false, reason: 'missing_fill' };
  if (!isObj(def.text) || !TEXT_DECORS.includes(def.text.decor) || typeof def.text.icons !== 'boolean') return { ok: false, reason: 'missing_text' };
  return validatePresetFields(def);
}

const freeze = (def) => JSON.parse(JSON.stringify(def));

// 登録簿（アプリごとに 1 つ。既定で 3 つの組込みスタイルを持つ）。
export function createDrawStyleRegistry(initial = BUILTIN_STYLES) {
  const map = new Map();
  const api = {
    // 名前が重複する定義・検証に通らない定義は加えず、既存の登録は変えない。
    register(def) {
      const v = validateStyle(def);
      if (!v.ok) return v;
      if (map.has(def.id)) return { ok: false, reason: 'duplicate' };
      map.set(def.id, freeze(def));
      return { ok: true };
    },
    has: (id) => typeof id === 'string' && map.has(id),
    get: (id) => (typeof id === 'string' && map.has(id) ? map.get(id) : null),
    // FR-075: 定義の参照（写し）。preset は見た目の項目を持つか。未知は null。
    spec: (id) => (typeof id === 'string' && map.has(id) ? { ...freeze(map.get(id)), preset: hasVisualFields(map.get(id)) } : null),
    ids: () => [...map.keys()],
    label(id, lang = 'ja') {
      const d = map.get(id); if (!d) return '';
      if (typeof d.label === 'string') return d.label;
      return d.label[lang] ?? d.label.ja ?? Object.values(d.label).find((v) => typeof v === 'string' && v.trim()) ?? d.id;
    },
    list(lang = 'ja') { return [...map.keys()].map((id) => ({ id, label: api.label(id, lang) })); },
  };
  for (const d of initial) api.register(d);
  return api;
}
