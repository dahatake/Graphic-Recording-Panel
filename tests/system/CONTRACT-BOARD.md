# 契約: 会議ボード型（FR-114。AC-667 の System Test が実装を観察するための口。test-designer が置き、実装役が従う）

期待値は要求定義書（FR-114・AC-664〜AC-667・AC-669、PARAM-007・088・126・127・129・131・132・158・165・178〜181・001・104）だけから決めています。
既存の契約（`CONTRACT.md`「レイアウト型・描画スタイル・設定画面」、`CONTRACT-STYLE-PRESET.md`、`CONTRACT-LIVE-EXPORT.md`）は変えず、ここに書いたものを加えます。

## 型の識別子
- 型 id は `board`（FR-027 の 7 つ目。コマンドは `layoutType.board`）。`setLayoutTypes(['board'])` で選べ、先頭の型のとき `renderSvg()` のルートに `data-layout-head="board"`。

## 区画の識別子（9 つ。FR-114 の列挙の順）
| id | 区画 |
|---|---|
| `purpose` | 目的・背景 |
| `members` | 参加メンバー |
| `flow` | 議論の流れ・主な発言 |
| `decisions` | 決定事項 |
| `open` | 未決事項 |
| `themes` | 主要テーマ・議論のポイント |
| `vision` | 最終的に目指す姿 |
| `actions` | 次アクション |
| `memo` | メモ・補足 |

## renderSvg()（先頭の型が board のとき）
- 区画: `<g data-board-section="<区画 id>">`。区画の枠・見出し・中の要素はすべてこの `g` の子孫。
- 要点: 要点を表す要素（またはその祖先・子孫のどれか 1 つ）に `data-point-id="<要点 id>"`（`getState().scenes[].points[].id`）。1 つの要点は 1 つの区画の `g` の中にだけ現れる。
- 部品の種類（AC-666 の 11 種類）: その部品を描く要素に `data-board-part="<種類>"`。種類は `title`（タイトル帯）・`frame`（区画の枠と見出し）・`badge`（番号バッジ）・`bubble`（吹き出し）・`check`（✓のリスト）・`question`（？のリスト）・`table`（表）・`arrow`（矢印）・`person`（人物）・`icon`（絵記号）・`emphasis`（マーカー・下線の強調）。
- 文字は `<text>`（`<tspan>` 可）。文字の色は `fill`（属性か `style` の `fill:`、祖先から継承）。背景になる面は `rect`・`circle`・`ellipse`・`path`・`polygon` の塗り（`fill`。`url(#id)` のグラデーションは `<linearGradient>`/`<radialGradient>` の `<stop stop-color>`）。座標の変換は `transform`（`translate`・`scale`・`matrix`・`rotate`）だけを使う。紙面の質感の図形は `data-style-role="paper-texture"`（`CONTRACT-STYLE-PRESET.md`。コントラストの測定から除く）。
- `<image>`・外部 URL（`http`・`//`）・外部の `url(` を含まない。

## app.getBoardModel()（先頭の型が board のとき。それ以外は `null`）
```
{
  canvas: { w, h },                       // 図の領域
  band: { x, y, w, h } | null,             // タイトル帯（タイトル・サブタイトル・日付がすべて未入力なら null 可）
  sections: [{ id, frame: { x, y, w, h }, elements: [{ id, part, x, y, w, h, parent? }] }],
  assigned: [{ pointId, section }],       // 要点ごとの振り分け（AC-665）
  animations: [{ id, kind: 'appear' | 'move' }] // いま進行中の AC-669 のアニメーション（出現のフェードと拡大・詰め直しの移動）。ないときは []
}
```
- `animations`（2026-11-05 追加。AC-673）: AC-669 の出現・移動のアニメーションが進行中の要素。ライブ描画ショーが OFF・動きを減らす設定でないとき、新しい要点の出現の間（PARAM-181 以内）は `kind:'appear'` の項目が入る。ショーが ON のときは、AC-669 のアニメーションはショーの描線・書き込み（AC-673）と運ぶ動き（AC-674）に置き換わるので、常に `[]`。
- 座標は SVG の座標と同じ単位。`elements` はその区画の中に置かれた要素（リストの行・吹き出し・人物・表・矢印・絵記号・番号バッジなど）の**現在の表示位置**の外枠。
- `id` は図全体で一意で、同じ要素なら取込の前後で同じ（要点から作る要素は要点 id から決める）。
- 表と行のような親子は、子に `parent: <親の id>` を付ける（親子の包含は AC-430 (c) の重なりに含めない）。それ以外の 2 つの要素の外枠は重ならない。
- 区画の高さ（AC-669。2026-11-05 最終監査 202611050444 C-01）: 同じ横の並び（`frame.y` が同じ区画）の `frame.h` は揃う。空きを PARAM-186 行以下とする規定は、各横並びで最も中身の高い区画にだけ当てる（その区画の最後の要素の下端から枠の内側の下端までが PARAM-186 行分以下。見出し・枠の内側の余白を除く）。並びのほかの区画（要点 0 件の区画を含む）は並びの高さに合わせて広がってよい。並びのすべての区画で要点が 0 件のときは、見出しと PARAM-186 行分の空きだけの高さ。

## 時間（アニメーション。AC-669・AC-667 (f)）
- 要素の現在の表示位置は `options.now()` の時刻で決まる。位置が変わる要素は、移動の開始時刻から {PARAM-181}=600 ミリ秒以内に新しい位置へ着き、その間の時刻では途中の位置（古い位置と新しい位置の間）を返す。タイマーを使う実装は `options.scheduler.setTimeout` を使う（テストは `now` と `scheduler.advance` を同じ量だけ進める）。
- `options.env.reducedMotion === true` のときは、取込の直後から新しい位置を返す（途中の位置はない）。

## 取込
- 手入力（`setDraft`・`submitDraft`）・`importTextFile`（.txt。`CONTRACT.md`）・ライブ（`session.start` 後の `speechSource` の確定結果）は既存の契約のとおり。40 文字以下の発話は 1 要点（`CONTRACT.md`）。
- LLM 連携は既定のまま無効（同意なし）。このとき外部へのリクエスト（`fetch`・`XMLHttpRequest`・`WebSocket`・`EventSource`・`navigator.sendBeacon`）は 0 件。

## 固定の文字起こし（AC-667）
- `tests/system/fixtures/teama-meeting.txt`（23 発言。1 行 1 発言・各 24 文字以内）と、期待の区画の表 `tests/system/fixtures/teama-meeting.expected.json`。
- 期待の表は AC-665 の規則（(2) 決定事項 PARAM-126 → (3) 次アクション PARAM-129 → (4) 未決事項 PARAM-127・131 → (5) PARAM-178 の区画の順 → (6) 根拠 PARAM-132 → メモ・補足 → (7) 議論の流れ）を各発言の文字に当てはめたもの。各発言は規則の語の組のちょうど 1 つ（議論の流れの発言は 0）にだけ当たるよう作ってあり、種類（結論・行動・未決定・質問・根拠）の判定と区画の振り分けが食い違わない。テストが PARAM から作り直して一致を確かめる。

## 議論の流れのステップ（AC-667 (i)・AC-666。2026-11-05 追加）
- `flow` の区画の各ステップの部品は `<g data-board-step="<stepIndex>">` の子孫に置く（`stepIndex` は 1 始まりの整数。ステップごとに別の値。同じ値の `g` を部品ごとに複数置いてもよい）。そのステップの番号バッジ（`data-board-part="badge"`。番号の文字 ①②③… をこの要素の子孫の `<text>` に持つ）・吹き出し（`bubble`）・人物（`person`）は、この `g` の子孫に**部品ごとに 1 つの要素**として置く（1 つの部品に `data-board-part` を付ける要素は 1 つだけ）。ステップの最初の要点の `data-point-id` もこの `g` の子孫に置く。
- ステップの間の矢印（⇒）は `data-board-part="arrow"` に `data-between="<前の stepIndex>,<次の stepIndex>"` を付け、どのステップの `g` にも含めずに（`flow` の区画の中に）置く。隣り合うステップの組ごとに 1 つ。
- `getBoardModel()` の `elements` では、ステップの部品に `stepIndex`（数）を、ステップの間の矢印に `between: [前, 次]` を付ける。
- 別々のトピック（FR-025）の発言は別々のステップになる。テストは流れの 4 発言の前に `session.nextScene`（AC-008 の［次のシーン］）を実行して取り込む。

## 強調（AC-667 (h)。2026-11-05 追加）
- `data-board-part="emphasis"` の要素（マーカーの面・下線）には、`data-emph-word="<強調語>"` と `data-emph-start="<強調語の最初の文字の位置>"`（強調語を含む `<text>` の文字列（`textContent`）の中での 0 始まりの位置。UTF-16 の単位）を付ける。強調語の `<text>` は、強調の要素の祖先の `g` のどれかの子孫に置く（強調の要素の直近のまとまり）。
- テストは実ブラウザ（`tests/system/perf-util.js` の `launch`）で SVG を描き、`getExtentOfChar` で測った強調語の最初の文字の左端・最後の文字の右端と、強調の要素の `getBoundingClientRect()` の左端・右端を比べる（ずれはそれぞれ PARAM-187×その text の font-size 以下）。文字幅の見積もりで位置を決めず、表示に使われた書体で描いた結果に合うようにする。

## 人物の名前（AC-668・AC-671・AC-358・AC-680。2026-11-05 追加）
- 参加者名簿の入力: `app.setTitleInfo({ participants })`。`participants` は 1 行に 1 名の文字列（`\n` 区切り。配列も可）。既存の `theme`・`speaker` などの項目と同じ呼び出しで、渡さなかった項目は変えない。戻り値は `{ ok }`。`app.getTitleInfo().participants` は入力した文字列を返す。
- 名前の文字は `<text data-board-name="participant">`（参加メンバーの区画の名前。`members` の区画の中に、人物（`data-board-part="person"`）と組で、並びの順に文書の順で置く）と `<text data-board-name="speaker">`（議論の流れのステップの人物の名前）で描く。
- PNG（`canvasFactory` の `fillText`）・SVG・PDF（`/ActualText`）の保存にも、画面の図に載る名前を同じく含める（CONTRACT.md の書き出しの規則に名前の文字を加える）。テキスト一覧（`renderOutline()`）には AC-668 (d) の「参加メンバー: 名前、…」の行と「（発言: 名前）」を載せる。
- Markdown の保存（`save.markdown`。AC-529。2026-11-05 最終監査 202611050444 C-02）は名前の掲載がテキスト一覧と一致する: 名前を表示する間（`getHideNames() === false`）は、テキスト一覧と同じ「参加メンバー: 名前、…」の行と「（発言: 名前）」の添え書きが載る（行の頭の Markdown の記号を除いた文字が一覧の行と同じ）。オンのときと会議ボード型以外の型では載らない。
- 名前は LLM への送信（`options.relay` に渡す要求の全体）と `getImagePrompt()` の文字に含めない。`getImagePrompt({ mask })` は `mask` の値・名前を表示する設定（`getHideNames()`）・簡易マスキングの設定（`getLlmMasking()`）のどれによらず、「参加メンバー」の行・「（発言: 名前）」の添え書きを入れない（FR-078・AC-420）。
- 要点・見出しの文字の中に現れる参加者名簿と話者タグの名前は、簡易マスキングの設定（`setLlmMasking(false)` でも）と注意の伏せ字の選択（`mask:false` でも）によらず、LLM へ送る前（`/api/llm/extract` の `body.input`）と `getImagePrompt()`（内容と文字の部分の列挙）で、常に AC-359 と同じ伏せ字に置き換える（要点ごと除くのではない。AC-358・AC-359・AC-471・AC-668 (e)。最終監査 202611050444 C-03）。

## 名前を表示しない（AC-680。2026-11-05 追加）
- `app.getHideNames()` → 真偽値（既定 `false`＝名前を表示する）。`app.setHideNames(on)` → `{ ok }`。`on` が真偽値でないときは `{ ok:false }` で、直前の値を保つ。
- ［設定］の項目 `board.hideNames`（`getSettingsDialog().fields` の `{ id:'board.hideNames', value:<真偽値>, label }`。ラベルは PARAM-011 以内で表示言語に従う）。コマンド `settings.hideNames` は［設定］を開いてこの項目にフォーカスし（`getSettingsDialog().focusedField === 'board.hideNames'`）、`handleKey({ key: ' ' })` で切り替わる。
- 値は端末ごとの設定（`options.storage`）に保存され、再生成（再読込）後も保たれ、`data.reset`・`loadSessionFile` では変わらず、セッションファイルに含めない（`hideNames` などの項目名も出さない）。
- オンのとき、`data-board-name` の文字を図・テキスト一覧・PNG・SVG・PDF・Markdown のどれにも出さない（人物の絵記号は残す）。名簿の入力と話者タグの名前の保持は消さない。切り替えの値によらず、LLM への送信と `getImagePrompt()` に名前は入らない（上の「人物の名前」）。
