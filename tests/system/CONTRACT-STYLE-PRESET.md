# 契約: 画風プリセット（FR-075・FR-076 の System Test。AC-406・407・408・409・410・411・412・413・425・456。関連: AC-146・AC-149・AC-061）

この契約は、System Test（`tests/system/stylepreset.test.js`）が実装を観察するための口です。期待値は要求定義書（FR-075・FR-076・3.6 の表）だけから決めています。既存の契約（`CONTRACT.md`「レイアウト型・描画スタイル・設定画面」「RPG風の描画スタイル」「図の演出」、`CONTRACT-LLM-CONSENT.md`）は変えず、ここに書いたものを加えます。

## 選択肢と識別子
- `app.getDrawStyles()` → 13 件の `[{id,label}]`（既存の 4 つ `handwritten`・`anime`・`simple`・`rpg` と 9 つの風）。風の `id` は実装が決める（テストは表示名で引く）。表示言語が日本語のとき、9 つの風の `label` は 3.6 の表の日本語名（`黄黒手書き風`・`黒板風`・`付箋ボード風`・`色鉛筆風`・`ミント風`・`ビジネス風`・`ミニマル風`・`ポップ風`・`クラフト紙風`）、`app.setLang('en')` の後は英語名（`Yellow Black`・`Chalkboard`・`Sticky Notes`・`Color Pencil`・`Mint Note`・`Business`・`Minimal`・`Pop Color`・`Kraft Paper`）。`label` は 13 件で互いに異なる。初期の既定は `handwritten` のまま。
- `app.setDrawStyle(id)`・`app.setSettings({drawStyle:id})` は 9 つの風の `id` も受け付ける。

## 定義の参照
- `app.getDrawStyleSpec(id)` → 未知の `id` は `null`。既存の 4 つは `{ id, preset:false }`（見た目の項目は持たない）。9 つの風は次の形:
  - `preset:true`
  - `paper`: `'plain'`（白紙）|`'grid'`（方眼）|`'ruled'`（ノート罫線）|`'chalkboard'`（黒板）|`'whiteboard'`（ホワイトボード）|`'kraft'`（クラフト紙）
  - `font`: `'handwriting'`（手書き風）|`'roundGothic'`（丸ゴシック）|`'gothic'`（ゴシック）
  - `headingDecoration`: `'band'`（帯に白抜き文字）|`'marker'`（マーカー下線）|`'sticky'`（付箋）|`'classic'`（従来の飾り）
  - `balloon`: `'cloud'`（雲形）|`'rounded'`（角丸）|`'sticky'`（付箋）
  - `stroke`: `{ wobble:number（0 で揺らぎなし、>0 で揺らぎあり）, width:number（px、>0）}`
  - `figures:boolean`（線画人物の有無）、`icons:boolean`（絵記号の有無）
  - `palette`: `{ background, primary, accent:[1 件以上], text, secondary }`（すべて `#rrggbb` か `#rgb`）
  - `description`: `{ ja:{color,drawing,font,mood}, en:{color,drawing,font,mood} }`（4 軸の短い文。非空の文字列）
- `app.getFontStacks()` → `{ handwriting:[{name,kind}], roundGothic:[{name,kind}], gothic:[{name,kind}] }`。`kind` は `'handwriting'|'roundGothic'|'gothic'|'generic'`（その書体名の系統。`generic` は CSS の総称ファミリー `sans-serif`・`serif`・`system-ui`・`cursive` など）。並びの末尾は 1 件の `generic`。

## 図（`renderSvg()`）の観察点（9 つの風を選んでいるとき）
既存の `data-role` などの属性はそのまま持ってよい。ここで加える属性は `data-style-role` ほかで、既存の 4 つの描画スタイルの図には現れない（AC-406: 既存の 4 つの図は拡張の前と同じ文字列）。
- ルートの `<svg>`: `data-draw-style="<id>"`・`data-paper="<paper>"`・`data-font-kind="<font>"`・`font-family="<書体の並び>"`（`getFontStacks()[font]` の `name` を、この順にカンマ区切り。空白を含む名前は引用符で囲む）。
- 紙面: `<g data-style-role="paper">` が、すべての `<text>` より前（文書順）にある。その中に `<rect data-style-role="paper-bg" fill="<palette.background>">`（viewBox 全体を覆う）と、質感の図形 `data-style-role="paper-texture"`（`line`・`path`・`rect`・`circle`・`ellipse`・`polyline`・`polygon` だけ）。`grid` は縦線（`<line>` で `x1==x2`）と横線（`y1==y2`）の両方、`ruled` は横線の `<line>` を 3 本以上、`chalkboard`・`kraft` は質感の図形を 1 つ以上持つ。
- 文字: `<defs>`・`<title>`・`<desc>` の外のすべての `<text>` は、`fill`（`#hex`）・`font-weight`（数値。「太め」は 600 以上）・`data-back`（その文字の直下の背景の色 `#hex`。紙面・帯・付箋・吹き出しの塗りのどれか）・`data-box="x y w h"`（文字の外接矩形）を持つ。
- 面と線: 次の要素は `data-style-role` を持ち、`fill` と `stroke`（`none` 可）を明示し、`stroke` が `none` でなければ `stroke-width` を持つ。`heading-band`・`heading-marker`・`heading-sticky`・`balloon`・`sticky`・`icon` は `data-box="x y w h"`（外接矩形）も持つ。`point-frame`・`balloon`・`sticky` は輪郭（`stroke` が `none` でなく `stroke-width>0`）を必ず持つ。
  - `heading-band`（見出しの帯）・`heading-marker`（見出しのマーカー下線）・`heading-sticky`（見出しの付箋）: `headingDecoration` が `band`／`marker`／`sticky` のとき各シーンに 1 つ以上。`classic` のときはどれもない。
  - `balloon`（吹き出し。通常の吹き出しは `data-shape="cloud|rounded|sticky"` で `balloon` と同じ値）: 各シーンに 1 つ以上（どの要点・発言を吹き出しにするかは実装が決める）。感情語を含むトピックの吹き出し（AC-156）を `balloon` として描くときは `data-emotional="true"` を付け、`data-shape` は通常の形と異なる値（例: `'jagged'`）にする（Q-026 A。AC-408・AC-409）。通常の吹き出しは `data-emotional` を持たないか `"false"`。
  - `point-frame`（要点の枠。各要点に 1 つ。付箋に載せる風でも、要点の輪郭は `point-frame` の要素にする）・`sticky`（付箋の面）・`icon`（絵記号）・`emphasis`（強調の塗り）・`divider`（区切り線）・`shadow`（影）。
  - 重なり: `heading-band`・`heading-marker`・`heading-sticky`・`balloon`・`sticky` は、重なる文字より文書順で前（下）にある。`figure`・`icon` の外接矩形は文字の外接矩形と重ならない。
  - 黄黒手書き風（AC-408）: `icon`・`emphasis`（結論の要点があるとき）を 1 つ以上、`divider` か `shadow` を 1 つ以上持つ。
  - 揺らぎ: `stroke.wobble` が 0 の風の `point-frame` は `<rect>`（角丸は `rx`）、0 より大きい風の `point-frame` は `<path>`。
- 線画人物: `figures:true` の風は、各シーンに `<g data-style-role="figure" data-scene-id="<scene id>" data-box="x y w h">` を 1 つ以上持つ。中は `circle`（頭）を 1 つ以上と `line`・`path`・`polyline` だけで、`<text>`・`<image>`・`<use>` を含まない。子の線は `stroke-width` を持つ。`figures:false` の風は `figure` を持たない。
- 外部の素材: 図に `<image>`・`<foreignObject>`・`@import`・`@font-face` を含まず、`href`／`xlink:href` は `#` で始まる局所参照だけ、`url(...)` は `url(#...)` だけ。

## 書体の有無の注入（AC-407）
- `createApp(options)` の任意の `options.fontCheck(name) -> boolean`（`document.fonts.check` に相当）。実装は書体の有無を調べなくてもよい。調べるときはこれだけを使う。どの値を返しても例外にならず、図の書体の指定（`font-family`）・文字・`font-weight`・見出しの飾りは変わらない（ブラウザが並びの次の書体で表示する）。

## ハイコントラスト（強制カラー。AC-456）
- `options.env.forcedColors:boolean`（起動時の `matchMedia('(forced-colors: active)')`。省略時 `false`）。`app.setForcedColors(bool)` → `{ok}`（実行中の変化。真偽値以外は `ok:false` で不変）、`app.getForcedColors()` → boolean。
- 有効の間、`renderSvg()` のすべての `fill`・`stroke`・`stop-color`・`color` 属性と `style` 内のそれらの値は、CSS のシステム色（`Canvas`・`CanvasText`・`LinkText`・`VisitedText`・`ActiveText`・`ButtonFace`・`ButtonText`・`ButtonBorder`・`Field`・`FieldText`・`Highlight`・`HighlightText`・`SelectedItem`・`SelectedItemText`・`Mark`・`MarkText`・`GrayText`・`AccentColor`・`AccentColorText`）か `none`・`transparent`・`currentColor` だけ。`getDrawStyle()`・`getDiagramLayout()`・`renderOutline()` は変わらない。無効に戻すと、`renderSvg()` は有効にする前と同じ文字列。

## LLM 連携（AC-413）
- `CONTRACT-LLM-CONSENT.md` のとおり。風を選んでいるとき `/api/llm/extract` の `drawStyle` は `getDrawStyle()`（風の `id`）。どの LLM 向けの要求の body にも、風の `palette` の色の値と `description` の文は含まれない。body の項目の集合は既存の 4 つの描画スタイルのときと同じ。

## 既存の契約の更新（AC-146 の文面の変更による）
- `CONTRACT.md` の「`app.getDrawStyles()` → 4 件」は、FR-076 の追加後は 13 件と読み替える。`getDiagramStyle()` の `kind` ごとの区別は、9 つの風では色が同じでもよく（ミニマル風は単色）、`shape` か `icon` と `kindLabel` が異なること（白黒で見分けられる）で満たす。既存の 4 つでは従来どおり色も異なる。

## AC-406 の基準（拡張の前の図）
- `tests/system/golden/fr075-legacy/*.svg` は、FR-075 の実装の前（統合ブランチ 91a15b8）に、次の入力で `renderSvg()` を記録したもの。`newApp()` → `seedThreeScenes` →（`bubble-*` は `setLayoutTypes(['bubble'])`）→ `toDetail(app, 'detail'|'major')` → `setDrawStyle(<id>)`。比較では改行コードの違い（CRLF／LF）だけを無視する。記録をやり直してはならない（拡張の前の図が基準のため）。
