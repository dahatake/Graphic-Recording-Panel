# FR-092「要確認」・FR-093 用語集・FR-024 元の発話の契約メモ

台帳に入れる System Test は system レベルの AC-546（確認操作）と AC-572（元の発話）だけ（`tests/system/review.test.js`）。
ほかの AC（AC-544・545・547・548・549〜552・573）は unit / integration のため、ケースは台帳に入れず、下の観察点を実装役の単体・結合テストが確かめる。

## app の公開面（新設。実装役はこの名前に従う）
- `app.getPointReview(pointId)` → `{ needsReview:boolean, reasons:['number'|'date'|'proper'|'ai'|'provisional'], status:'unconfirmed'|'confirmed', confirmedAt:string|null }`。`confirmedAt` は `YYYY-MM-DD HH:mm`（ゼロ埋め、端末のローカル時刻。`options.now` から算出）。`confirmed` のとき `needsReview:false`。
- `app.confirmPoint(pointId)` → `{ok}`。まとめた要点（AC-429。同シーンで同一文字列）はまとめた要点すべてを確認済みにする。不明な id は `ok:false` で不変。
- `app.confirmScene(sceneId)` → `{ok}`（含む要点すべて）。`app.getSceneReview(sceneId)` → `{ status:'unconfirmed'|'confirmed', confirmedAt, unconfirmedCount:number }`。
- コマンド `review.confirm`（keymap に割り当て。選択中のシーンの要点すべてを確認）。
- `app.editPoint(pointId, text)`（既存）で確認済みは `unconfirmed`・`confirmedAt:null` に戻り、印は再判定。`app.undoManualEdit()` → `{ok, reason?}`（コマンド `edit.undo`。直前の手修正を戻し、確認状態・確認日・印も手修正前の値。履歴なしは `ok:false` と `reason`。PARAM-123 件まで。AC-575）。
- 確認状態は `grp.session` と `file.save` / `loadSessionFile` に含まれ復元される。再配置・再描画・詳細度の切替で印は復活しない。
- `app.getReviewSummary()` → `{ confirmed:number, total:number, unconfirmed:[pointId] }`（AC-547 の出力の確認の状況・未確認 n 件の元）。
- 判定の純関数: `web/src/review.js` の `judgeReview(text, { glossary:[string], aiGuess:boolean, provisional:boolean })` → `{ needsReview, reasons }`（AC-544。決定的・外部通信なし）。

## 観察点（unit / integration）
- AC-544: 数字（半角・全角・漢数字）・日付（年月日・月日・曜日・来週・明日）・固有名詞らしい語（用語集の語、3 文字以上のカタカナ・英大文字、さん・様・株式会社）で `needsReview:true`、通常の文は false。同じ入力は同じ結果。
- AC-545: 図・ポップアップの印は文字「要確認」＋枠つきの記号（`<g data-review-mark>` 等。色だけにしない）。`renderOutline()` の同じ要点に「要確認」と理由の文字（数値・日付・固有名詞・AI の推測・暫定）。
- AC-547: Markdown・HTML の保存（FR-090）で、未確認の要点の行に「要確認」。確認済みには出ない。詳細度が要点を出さなくても Markdown の「要確認」の節（AC-528）に列挙、HTML に「未確認 n 件」。確認の状況（確認済み件数と全体の件数）が文字で載る。
- AC-548: 外部通信を遮断（fetch・WebSocket の呼び出し 0 件）でも動く。理由 `ai` は LLM 連携が有効で生成 AI が補った推測候補の関係線（FR-053）にだけ付く。
- AC-573: 生成 AI が言い換えた要点・見出しは、ポップアップ・テキスト一覧の両方に文字「AI 要約」と枠つきの記号、元の認識文字列と並べて表示。`app.getScenePopup().points[i].aiSummary:boolean`。無効・失敗してルールベースに復帰したときは付かない。

## 用語集（FR-093）
- `app.addGlossaryTerm({ term, variants?:[string] })` → `{ok, reason?}`（空・重複（前後の空白と全角・半角の違いを除く）・上限 PARAM-122 超は `ok:false`）。`app.updateGlossaryTerm(id, {term, variants})`、`app.removeGlossaryTerm(id)`、`app.getGlossary()` → `{ terms:[{id, term, variants}], count, limit }`。
- 発話の記録時（音声・手入力・ファイル取込）に別表記を `term` へ置換する。`getState().utterances[i]` は `{ id, text（置換後）, rawText（置換前の認識文字列）, receivedAt }`。
- AC-551: Azure Speech かつ同意（FR-081）があるときだけ、認識の開始時に `term` だけを phrase list として送る（variants・会議の内容は含めない）。同意なし・ブラウザ標準・LLM 送信には含めない（外部リクエスト 0 件）。
- AC-552: `grp.session`・`file.save` に含まれ復元後も有効。`data.reset` で消える。

## 元の発話（FR-024 AC-572）
- `getState().scenes[].points[]` と `getScenePopup().points[]` は `{ id, text, sources:[{ utteranceId, rawText, time:'HH:MM:SS' }], manual:boolean }`。手追加の要点は `sources:[]`、`manual:true`。`time` は `receivedAt` の端末ローカル時刻（24 時間・ゼロ埋め）。`sources` は話順（時刻の順）。
- `app.addManualPoint(sceneId, text)` → `{ok, pointId, reason?}`（FR-005。不明なシーン・空白だけは `ok:false`）。
- `getScenePopup().html` と `renderOutline()` は各要点の `rawText` と `time` を文字で含み、手追加には「手追加」を含む。
