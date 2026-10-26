# 契約: ライブ更新の間隔・バッチ描画・構造化 Markdown／HTML プレゼン出力（FR-014 AC-521、FR-022 AC-523、FR-090 AC-528・AC-530。2026-10-26）

System Test（live.test.js・present-export.test.js）が前提にする観察点。要求定義書にない名前はこの契約で定める（実装役はこれに合わせる）。PARAM は PARAM-098（10 秒）・PARAM-099（15 秒）・PARAM-100（10 秒）・PARAM-001（15 秒）・PARAM-004（8 秒）。

## ライブ更新（FR-014 AC-521、AC-522 は integration）
- `app.getLiveInterval()` → `{ sec:number（現在値。初期値 10）, min:10, max:15, default:10 }`。`app.setLiveInterval(sec)` → `{ ok, reason? }`（10〜15 の整数だけ受け付け、範囲外・非整数は `ok:false` で値を変えない）。
- `app.getLiveRefresh()` → `{ count:number }`。`count` は「記録中の定期更新で図を再描画した回数」。記録中、更新間隔（`scheduler.setTimeout`。`setInterval` は禁止）ごとに、前回の更新以降に確定した発話が 1 件以上あるときだけ 1 回増える（複数の発話は 1 回にまとまる）。発話がなかった間隔では増えない。
- 発話は確定した時点で `getState().utterances`・`getTranscript().finals` に入る（FR-014 の既存）。図（`renderSvg()`・`renderOutline()`）への反映は、確定の受付から PARAM-001（15 秒）以内。

## バッチ描画（FR-022 AC-523）
- `importTextFile`（.vtt／.txt）が `ok:true` を返したとき、取込んだ全発話の図への反映は 1 回の再描画（`getLiveRefresh().count` が取込の前後でちょうど 1 増える）で行い、記録中・準備中・停止のどの状態でも、定期更新の到来を待たない（`scheduler.advance(1000)` の後に全シーンが `renderSvg()` に現れる）。`ok:false` の取込は `count` を変えない。

## 保存（FR-090 AC-528・AC-530）
- `app.commands['save.markdown']()` → `options.download({ filename:*.md, mime:'text/markdown', data:string })` を 1 回呼ぶ（シーン 0 件では呼ばない）。内容は現在の詳細度（`getDetailLevel()`）に従う: 大項目＝トピックまで、中項目＝シーンの見出しまで、詳細＝要点まで。
  - トピック `# <title>`、シーン `## <heading>`、要点は `### <text>` の見出し、または `- <text>` の箇条書き（どちらでもよい。1 つのファイル内は一貫させる）。階層は トピック（#）→ シーン（##）→ 要点（### か箇条書き）で、要点はそのシーンの `##` の下に、シーンはそのトピックの `#` の下に、出現順で並ぶ。
  - 詳細で関係があるとき、始点の要点の箇条書き行（または直下の入れ子の行）に `getOutlineRelations()` の `kindLabel`・向き（`→`）・終点の要点の文字列を書く。
  - 要点・見出しの順序は `renderOutline()` と同じ。
- `app.commands['save.html']()` → `options.download({ filename:*.html, mime:'text/html', data:string })` を 1 回呼ぶ（シーン 0 件では呼ばない）。単一ファイルで、外部の URL（`http:`・`https:`・`//`）を参照しない（`<script src>`・`<link href>`・`<img src>`・`@import`・`url()`・`@font-face` の外部参照なし）。
  - シーンごとに 1 つの `<section data-slide data-scene-id="<id>">`。その中に見出し（`<h1>`〜`<h3>`）、要点（`<li>`）、図（`<svg>`）がある。
  - 実行時（ブラウザで開いたとき）: 現在のスライドの `section` は `data-active="true"`、他は `data-active="false"`（または属性なし）。初期は 1 枚目。`ArrowRight`／`ArrowLeft` で次／前のスライド（先頭・末尾で止まる）。自動送りは `[data-autoplay]` のボタンで入り（押すたびに切り替わる）、1 枚ごとに PARAM-004（8 秒）滞在して次へ進み、最後で止まる。
  - 会議の文字列はエスケープされて文字として入る（`<`・`>`・`&`・`"` が要素・属性として解釈されない。`<script>` タグ等が文字列に含まれていても、実行されず、DOM に要素として現れない）。
