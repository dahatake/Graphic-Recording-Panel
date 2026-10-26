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

## 予算・単価・使用額・導入の案内（FR-089 AC-524〜526・AC-532・AC-533、FR-062 AC-534。tests/system/budget.test.js。2026-10-26）
既存の `budget.js`（`getBudget`／`setBudget`／`getBudgetUsage`／`addBudgetUsage`、設定項目 `budget.yen`、`grp.budget`）を前提に、次を追加する（実装役はこれに合わせる）。PARAM-101=10000 円、PARAM-102=入力 400 円、PARAM-103=出力 1600 円（いずれも 100 万トークンあたり）。
- 単価: `app.getPricing()` → `{ inputPer1M, outputPer1M, default:{ inputPer1M:400, outputPer1M:1600 } }`。`app.setPricing({ inputPer1M, outputPer1M })` → `{ ok }`（0 以上の整数だけ。不正は `{ ok:false, reason:'invalid' }`、`state.message.text` に理由、直前の値を保つ）。［設定］画面の `fields` に `id:'budget.priceIn'`・`'budget.priceOut'`（`value`）。保存は `grp.budget` に `budgetYen`・単価の数値だけ（キー・トークン・使用額を含めない。セッションファイルにも含めない）。
- 使用額: 中継モックの `/api/llm/extract`・`/api/llm/svg` の応答 body に `usage: { inputTokens:number, outputTokens:number }` が付く。アプリは `(inputTokens*inputPer1M + outputTokens*outputPer1M)/1e6` 円を `addBudgetUsage` で加算する（`getBudget().usedYen`・`getBudgetUsage().yen`）。`app.getBudgetStatus()` → `{ text, usedYen, budgetYen }`（記録中の画面に出す文字列。使用額の数値を含む）。
- 停止・警告: `usedYen >= budgetYen`（予算 0 円は常に）のとき `/api/llm/*`（status を除く）を呼ばない。`app.getBudgetWarning()` → 警告なしは `null`、到達は `{ key:'budget.reached', text }`、予算 0 円は `{ key:'budget.zero', text }`。図の描画（生成 AI なし）は続く。予算を `usedYen` より大きくする、または `session:start`（使用額 0）で `null` に戻り、呼び出しが再開される。予算を使用額以下に変えても再開しない。
- 導入の案内（AC-534）: `app.getLlmGuide()` → `{ visible:boolean, text }`（LLM の同意・設定が無いとき初期 true）。`await app.dismissLlmGuide()` で `visible:false`（LLM は無効のまま、`/api/llm/*`（status を除く）は 0 件）。保存しない（再読込で再び表示され、何度でも閉じられる）。有効化は従来どおり `requestLlmEnable`・設定画面 `llm.enabled`（AC-310）。

## 追記（2026-10-26。A-255・A-257・A-258）
- AC-053（FR-014）: 確定結果の受付から PARAM-001（15 秒）以内に図の更新の描画が始まり（`getLiveRefresh().count` が増える）、描画が始まってから PARAM-104（2 秒）以内に `renderSvg()`・`renderOutline()` に反映される。`tests/system/helpers.js` の `PARAM.RENDER_SEC`＝PARAM-104、`PARAM.WARN_PCT`＝PARAM-105。
- AC-528 Markdown（上の「保存」を置き換える）: `# <会議タイトル>`（`getTitleInfo().theme`。# はこの 1 行だけ）→ `## <トピックの title>`（`getTopics()` の順）→ 詳細度が詳細のとき `### <要点>`、要点の詳細・関係（`kindLabel`・`→`・終点の要点）は箇条書き。大項目は `###` なし。末尾に `## 決定事項`、続いて `## アクション項目`（`##`・`###` どちらの見出しでもよい。この順）。決定事項は結論の要点、アクション項目の中身の抽出規則は AC に無いので、System Test は節の存在と順序だけを確かめる。
- AC-530 HTML: 最初に概要 1 枚（`<section data-slide data-slide-kind="overview">`）、続いてトピックごとに 1 枚（`<section data-slide data-topic-id="<id>">`。見出しはトピックの title、`<li>` に要点、`<svg>`）。スライドの総数＝トピック数＋1。矢印・自動送り（PARAM-004＝8 秒）は従来どおり。
- AC-526 追記: `usedYen >= budgetYen × PARAM-105/100`（80%）かつ予算未満のとき `getBudgetWarning()` は `{ key:'budget.near', text }`（到達は従来どおり `budget.reached`）。80% では呼び出しは止めない。応答に `usage` が無いときは送受信の文字数から概算して加算し、`getBudgetStatus().text` に「概算」を含める（usage があれば含めない）。
- AC-527: 使用額（`usedYen`）はセッションの保存データに含まれ、`createApp` を同じ storage で作り直した後も `getBudgetUsage().yen`・`getBudgetWarning()`（到達）が保たれる。`data.reset`（確認 confirm 後）と `session.start` で 0 に戻り、予算（`getBudget().yen`）は保たれる。
