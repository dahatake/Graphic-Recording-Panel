// 描画スタイルの定義を読む唯一の取り出し口（FR-077。契約: tests/system/CONTRACT-STYLE-PRESET.md「定義の参照」）。
// 契約の形: app.getDrawStyleSpec(id) → 未知の id は null、既存の 4 つは { id, preset:false }、画風プリセットは
//   { id, preset:true, palette, paper, font, headingDecoration, balloon, stroke, figures, icons, description:{ja:{color,drawing,font,mood}, en:{…}} }。
// FR-075 の統合前の getDrawStyleSpec() は引数を無視して現在の定義を返すため、id が一致するものだけを使う。
// 統合後は api.getDrawStyleSpec(id) をそのまま返す形に置き換えられる（呼び出し側は変えない）。
export function drawStyleSpecOf(api, id) {
  if (typeof id !== 'string' || typeof api?.getDrawStyleSpec !== 'function') return null;
  let spec = null;
  try { spec = api.getDrawStyleSpec(id); } catch { spec = null; }
  return spec && typeof spec === 'object' && spec.id === id ? spec : null;
}

// 画風プリセット（見た目の項目を持つ定義）かどうか（契約の preset フラグ）
export const isPresetSpec = (spec) => !!spec && spec.preset === true;
