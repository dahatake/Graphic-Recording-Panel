# 契約: 画風プリセット（FR-075・FR-076 の System Test。AC-406・407・408・409・410・411・412・413・425・456・467。関連: AC-146・AC-149・AC-061。NFR-UX-012 の AC-465・AC-466）

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
- `app.getFontStacks()` → `{ handwriting:[{name,kind}], roundGothic:[{name,kind}], gothic:[{name,kind}] }`。`kind` は `'handwriting'|'roundGothic'|'gothic'|'generic'`（その書体名の系統。`generic` は CSS の総称ファミリー `sans-serif`・`serif`・`system-ui`・`cursive` など）。並びの末尾は 1 件の `generic`。`Yu Gothic UI` の `kind` はテストが固定しない（NFR-UX-012。下の「日本語の字形の書体」）。

## 拡張点で追加する画風プリセット（AC-404・AC-466・AC-467）
- `app.registerDrawStyle(def)`（`CONTRACT-FR077-078.md`「拡張点」）の `def` は、FR-075 の見た目の項目を `getDrawStyleSpec()` と同じ名前で最上位に持てる: `paper`・`font`・`headingDecoration`・`balloon`・`stroke`・`figures`・`icons`・`palette`・`description`。これらを持つ定義は `getDrawStyleSpec(id)` が `preset:true` とその値を返し、図は 9 つの風と同じ観察点で描かれる。

## 日本語の字形の書体（NFR-UX-012。AC-465・AC-466。AC-061・AC-407・AC-408 の並びも同じ）
- 欧文専用の書体は PARAM-093（`Segoe UI`・`Segoe UI Variable`・`Segoe Print`・`Ink Free`・`Arial Rounded MT Bold`）。それ以外の書体名・総称の書体・システムの書体のキーワード（`system-ui`・`-apple-system`・`BlinkMacSystemFont`・`sans-serif` など）は「日本語の字形を持ち得る書体」。
- どの書体の指定も「従来の並びにあった欧文専用の書体（従来の順）→ `Yu Gothic UI` → 従来の並びの残り（従来の順）」。従来の並び（NFR-UX-012 の前、統合ブランチ de1f935 の記録）は `tests/system/jpfont-util.js` の `TRADITIONAL`（画面 `--font-sans`、既存の 4 つの描画スタイルの図・PNG・PDF・RPG風の地図、書体の系統 3 つ）。記録をやり直してはならない。
- 画面（AC-465）: `web/` の CSS（`<style>` を含む）のすべての書体の指定（`font-family`・`font` の一括指定・`--font-*` の書体の並びのトークン）が上の規則に従い、`--font-sans` は従来の並びから上の規則で並べ替えたもの。表示言語で書体の指定を切り替えない。
- 図と保存（AC-466）: `renderSvg()` のすべての `font-family` 属性、`save.svg` の `data`、PNG・PDF の保存で Canvas の `font` に代入する値の書体の部分（`options.canvasFactory` の 2D コンテキストへの代入で観察する）、`web/src` のスクリプトに書いた書体の指定の文字列が上の規則に従う。9 つの風と追加した画風プリセットは `getFontStacks()[font]` の並び、既存の 4 つは `TRADITIONAL.legacy` から並べ替えたもの（`Yu Gothic UI` が先頭）。
- 書体の有無（`options.fontCheck`。`Yu Gothic UI` がない場合を含む）で書体の指定・文字・`font-weight`・見出しの飾りは変わらない。書体のファイルを同梱せず、`@font-face`・`FontFace`・`document.fonts.load` を使わない。

## 図（`renderSvg()`）の観察点（9 つの風を選んでいるとき）
既存の `data-role` などの属性はそのまま持ってよい。ここで加える属性は `data-style-role` ほかで、既存の 4 つの描画スタイルの図には現れない（AC-406: 既存の 4 つの図は拡張の前と同じ文字列）。
- ルートの `<svg>`: `data-draw-style="<id>"`・`data-paper="<paper>"`・`data-font-kind="<font>"`・`font-family="<書体の並び>"`（`getFontStacks()[font]` の `name` を、この順にカンマ区切り。空白を含む名前は引用符で囲む）。
- 紙面: `<g data-style-role="paper">` が、すべての `<text>` より前（文書順）にある。その中に `<rect data-style-role="paper-bg" fill="<palette.background>">`（viewBox 全体を覆う）と、質感の図形 `data-style-role="paper-texture"`（`line`・`path`・`rect`・`circle`・`ellipse`・`polyline`・`polygon` だけ）。`grid` は縦線（`<line>` で `x1==x2`）と横線（`y1==y2`）の両方、`ruled` は横線の `<line>` を 3 本以上、`chalkboard`・`kraft` は質感の図形を 1 つ以上持つ。
- 文字: `<defs>`・`<title>`・`<desc>` の外のすべての `<text>` は、`fill`（`#hex`）・`font-weight`（数値。「太め」は 600 以上）・`data-back`（その文字の直下の背景の色 `#hex`。紙面・帯・付箋・吹き出しの塗りのどれか）・`data-box="x y w h"`（文字の外接矩形）を持つ。
- 面と線: 次の要素は `data-style-role` を持ち、`fill` と `stroke`（`none` 可）を明示し、`stroke` が `none` でなければ `stroke-width` を持つ。`heading-band`・`heading-marker`・`heading-sticky`・`balloon`・`sticky`・`icon` は `data-box="x y w h"`（外接矩形）も持つ。`point-frame`・`balloon`・`sticky` は輪郭（`stroke` が `none` でなく `stroke-width>0`）を必ず持つ。
  - `heading-band`（見出しの帯）・`heading-marker`（見出しのマーカー下線）・`heading-sticky`（見出しの付箋）: `headingDecoration` が `band`／`marker`／`sticky` のとき各シーンに 1 つ以上。`classic` のときはどれもない。
  - `balloon`（吹き出し。通常の吹き出しは `data-shape="cloud|rounded|sticky"` で `balloon` と同じ値）: 各シーンに 1 つ以上（どの要点・発言を吹き出しにするかは実装が決める）。感情語を含むトピックの吹き出し（下記）は、通常の形と異なる（Q-026 A。AC-408・AC-409・AC-467）。
  - 感情語を含むトピックの吹き出し（AC-467・AC-156）:  吹き出し型（`setLayoutTypes(['bubble'])`）で、感情語（FR-004 の辞書）を含むトピックのシーンの吹き出しは `data-balloon-kind="emotion"` を持ち、`data-shape` はその画風プリセットの `balloon` と異なる値（例: `'jagged'`）で、色を除いた形（要素の種類・パスの命令の種類と数・頂点の数・角丸）が通常の吹き出しと異なる。通常の吹き出しは `data-balloon-kind` を持たないか `"normal"`。吹き出しが属するシーンは、自身か祖先の `data-scene-id`。感情語の吹き出しも `fill`・`stroke`・`stroke-width`・`data-box` を持ち、AC-410 の規定（9 つの風）に従う。  `save.svg` の `data` でも同じ。テストは、`data-emotional="true"`（Q-026 A の取り込みで main 側に書かれた表記）を持つ吹き出しも感情語の吹き出しとして扱う。
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

## AC-406 の基準（画風プリセットの機能がない場合の図）
- AC-406 の改訂により、比較の基準は「同じ版のコードで画風プリセットの機能（FR-075・FR-076）がない場合の出力」。後から承認された要求（AC-431 の TYPE_SCALE、FR-079・FR-080 の data 属性など）による変化は基準に含める。
- `tests/system/golden/fr075-legacy/*.svg` は、main の 6d28c28（FR-079・FR-080 の統合済み。NFR-UX-012 の書体の変更を含まない。既存の 4 つの描画スタイルは画風プリセットの見た目の項目を使わない）で、次の入力で `renderSvg()` を記録したもの。`newApp()` → `seedThreeScenes` →（`bubble-*` は `setLayoutTypes(['bubble'])`）→ `toDetail(app, 'detail'|'major')` → `setDrawStyle(<id>)`。記録の `font-family` は従来の並び（`TRADITIONAL.legacy`）。以前の記録（統合ブランチ 91a15b8）は、後から承認された要求の変化を含まないため置き換えた。比較では属性を除外しない（`font-family` を除く）。
- 記録をやり直すのは、AC-406 の比較の基準が変わったときか、後から承認された別の要求で既存の 4 つの図が変わったときだけ。そのときも、書体の変更（NFR-UX-012）を含まない版のコードで記録する。
- 比較（AC-406 の改訂・NFR-UX-012）: 改行コードの違い（CRLF／LF）は無視する。変わってよいのは書体の指定の並び（`font-family` は `TRADITIONAL.legacy` を NFR-UX-012 の規則で並べ替えたものでなければならない）と、それによる文字幅から決まる文字を囲む枠の幅・文字の折り返しの位置だけ。`font-family` を除いて同じ文字列なら合格。そうでないときは、文字以外の要素の種類と順序、幾何（`x`・`y`・`width`・`height`・`d`・`points` など）以外の属性（配色・線・役割）、文字の内容と順序（空白を除いて連結）、文字の色・大きさ・太さの組が同じなら合格。
