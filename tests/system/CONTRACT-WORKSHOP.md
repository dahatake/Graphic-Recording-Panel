# 契約: ワークショップホワイトボード型（FR-091。test-designer が置いた System Test の前提。実装役が従う）

型 id は `workshop`（FR-027 の 6 つ目。コマンドは `layoutType.workshop`。先頭の型のときの `data-layout-head="workshop"`）。
他の型の公開 API（`setLayoutTypes`・`toggleLayoutType`・`getLayoutInfo`・`getCommandBar`・`renderSvg`・`renderOutline`）は CONTRACT.md のとおり。

## renderSvg()（先頭の型が workshop のとき）
- 背景の紙: `data-ws-paper` を持つ `<rect>`。fill は 6 桁の 16 進で、クリーム色（R≥F0・B<F0・R≥G≥B）。
- 見出しリボン: `data-ws-ribbon` を持つ要素が 1 つ以上。
- ステージ: `data-ws-stage="<1 始まりの番号>"` の要素。シーンが 5 つ以上あるとき 5〜6 個（シーン数を超えない）。番号は 1 から連番。
  - ラベル: ステージ内の `data-ws-label` の `<text>`。英語表示では大文字（`toUpperCase()` と同じ）。ラベルが空のステージはない。
  - 問い: ステージごとに `data-ws-question` の要素は 0〜1 個。問いのタイルには文字の記号（「?」）か文字の見出しがあり、色だけに頼らない。
- 色: fill／stroke の 6 桁の 16 進は、PARAM-116〜121（0F2A43・0E7490・14B8A6・1F7A54・E2632B・F3F7FA）と紙・白・黒・グレーの範囲。グリーン（1F7A54）は図全体で 1 要素だけ。
- `<image>`・外部 URL（`http`・`//`）・`url(` の外部参照を含まない。

## レンズの注記
- `app.getWorkshopLenses()` → 7 件 `[{ id, label }]`（課題／認知負荷と摩擦／人間の判断／リスク・信頼・結果／データと技術の依存／境界／AI 適合性の順。日英のラベル）。
- `app.addWorkshopNote({ sceneId, lens: <id>, text })` → `{ ok }`。不明なレンズ・空の text・不明な sceneId は `{ ok:false }`。
- 注記は SVG では `data-ws-note="<lens id>"` の要素、テキスト一覧（`renderOutline()`）では文字（レンズ名＋本文）で含まれる。

## 自動選択
- 自動選択（FR-028）の結果に `workshop` は含まれない。
