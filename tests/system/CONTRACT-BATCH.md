# System Test 契約: 入力モード・バッチモード（FR-117・FR-118・FR-119。run 202611062310、依頼 2026-11-06）

`CONTRACT-LIVE-EXPORT.md` の「`importTextFile` は 1 回の再描画で図へ反映する」（AC-523 旧）と `CONTRACT-LIVE-SHOW.md` の「再生取込」（`setVttImportMode`・`getVttImportMode`。AC-671 廃止）は、この文書で**廃止**する。
期待値は受入基準だけから決めており、この文書は「テストが何を呼ぶか」だけを定める（内部構造は自由）。

## 1. ファイル取込は図を更新しない（AC-054・AC-122・AC-181・AC-523・AC-686）
- `await app.importTextFile(file)`（.txt・.vtt）が `ok:true` のとき: 発話が `getState().utterances`・`getTranscript().finals` に追加される（PARAM-158 以内）。**`getState().scenes`・`renderSvg()`・`renderOutline()`・`getLiveRefresh().count` は変わらず、LLM 向けの要求（中継 `/api/llm/extract`・`/api/llm/svg`）は 0 件**。セッションの状態は変わらず、記録中でも記録は止まらない。
- `ok:false` の取込は何も変えない（従来どおり）。
- ライブ描画ショー（`getLiveShow().log`）にファイル由来の発話の描線・書き込みは現れない。

## 2. 入力モード（FR-117。AC-683〜685）
- `app.getInputMode()` → `{ mode:'live'|'batch', canSwitch:boolean, reason:string|null }`。初期値 `live`。`app.setInputMode('live'|'batch')` → `{ ok, reason? }`。不正な値（空・未知・非文字列）は `ok:false` で不変。`session==='recording'` のときは `ok:false`、`getState().message.text` と `reason` に「記録を停止してから切り替えてください」を含み、モードも記録も不変。
- `getCommandBar().items` に `group:'inputMode'`、`command:'inputMode.set:live'`・`'inputMode.set:batch'` の 2 項目（この順）。各項目は `CONTRACT-2026-11-04.md` 2. の画風の項目と同じ形: `label`（PARAM-011 以内）・`labelVisible:true`・`accessibleName`・`icon`（非空の文字列）・`description`（PARAM-170 以内の非空）・`tooltip`・`describedBy`・`tabbable:true`・`pressed:boolean`（現在のモードだけ真。実 DOM の `aria-pressed`）・`selectedMark`（現在だけ非空）。コマンドバーの最上部の領域（`getCommandBar().position==='top'`）。`getCommandBar().groups` に `id:'inputMode'` がある。`app.commands['inputMode.set:<mode>']`・`app.searchCommands(label)` で選べ、実 DOM では `<button>`。
- 保存: 端末の設定として `storage` に保存され、同じ `storage` で `createApp` し直すと復元される。データの初期化（`app.commands['data.reset']()` → `await app.dialogAction('confirm')`。FR-018）では変わらず、セッションファイル（`app.commands['file.save']()` が `env.downloads` に出す内容。FR-019。**発話が 0 件の空の状態では download せず `reason:'empty'` なので、発話を用意してから保存する**）に含まれない。切替で発話・シーン・図（`renderSvg()`。図の文言は表示言語に従うので、比較は同じ表示言語で行う）・選択中のオブジェクトは変わらない。
- 項目の名称（ja）は「音声取込」「ファイル取込」（AC-683 の「ファイル読込」は項目名の表記ゆれで、画面のボタンは「ファイル取込」。ファイルの保存・読込のコマンド `file.load` の「ファイル読込」とは別）。専用のキー割り当ては Ctrl+Alt+Shift+( ・ )。コマンドバーのグループは先頭に `inputMode` を加えた 11 個（`inputMode`・`import`・`session`・…・`environment`）。
- FR-117 のケースは FR-118 の API（`getBatchState`・`getBatchStyles`・`batchStyle` グループ）に依存しない。スタイルのボタンの表示は FR-118 のケース（batch.test.js）で検証する。
- バッチモードでは `getCommandBar().items` の `command:'session.start'`（と `session.resume`）が `enabled:false`・`disabledReason` に「音声取込モードで使えます」を含む。`app.commands['session.start']()` は `session` を変えない。ライブモードでは従来どおり。
- ライブモードで記録中でなく、ファイルを取り込むと自動でバッチモードに切り替わる（AC-685 (b)。integration）。

## 3. バッチモードのスタイル選択と図式化（FR-118・FR-119。AC-686〜691・694・695）
- `app.getBatchStyles()` → 8 件の `{ id, icon, label, description, drawStyle, sources:string[]（SRC-ID）, pressed, selectedMark, enabled, disabledReason }`（`instruction` は持たない。Prompt 本文は端末（クライアント）に置かず、中継サーバーが ID からアプリ定義の固定文を引いて付与する。AC-690・AC-695・AC-358。2026-11-06）。`drawStyle` は `getDrawStyles()` の ID のいずれか（新しい描画スタイルは作らない。15 のまま）。
- `getCommandBar().items` に `group:'batchStyle'`、`command:'batchStyle.set:<id>'` の 8 項目（`getBatchStyles()` の並び）。形は 2. と同じ。`getCommandBar().groups` に `id:'batchStyle'`。グループはバッチモードのときだけ表示（`visible`）。ライブモードでは `visible:false`（項目は残ってよいが `hidden:true`）。
- `app.getBatchState()` → `{ state:'idle'|'loaded'|'running'|'done', visible:boolean, total:number（全シーン数）, done:number（処理済み）, percent:number, progressText:string, cancelEnabled:boolean, message:string }`。`idle`＝発話 0 件（スタイルのボタンは `enabled:false`、`disabledReason` に「ファイルを読み込んでください」）。発話があると `loaded`。実行中は `running`（スタイルのボタンは `enabled:false`）、完了で `done`（`message` に描いたシーンの数。`loaded` と同じくスタイルを再選択できる）。
- `await app.runBatch(styleId)`（コマンド `batchStyle.set:<id>` と同じ。Promise は完了・取消・失敗で解決し `{ ok, drawn:number, cancelled?:boolean }`）。未知の ID・`idle`・実行中・ライブモードは `{ ok:false, reason }` で不変。実行の開始時に `getDrawStyle()` を `getBatchStyles()` の該当の `drawStyle` にする（画風メニューの押下と一致）。
- 実行（LLM 有効・同意済み）: 全シーンについて、中継 `POST /api/llm/extract` に `body.styleId`（選んだスタイルの `id`）と `body.styleName`（その `label`）を含む要求を 1 件以上送る。クライアントは `body.instruction`（Prompt 本文）を送らない（`body` のどの階層にも `instruction` の項目がない）。Prompt 本文はサーバーが `styleId` から固定文を引いて付与し、未定義の ID は拒否する（サーバー側の観察は実装役の単体・結合テスト）。`body.input` は要点の文字・シーン番号・描画スタイル名・部品キーの候補だけ（発話の逐語・ファイルの全文・話者名を含まない）。応答は FR-063 の形式（`{ objects, people, emotions, metaphors, points? }`）。`await app.flushLlm()` で待てる。要求は `scheduler.setTimeout` の PARAM-069（30 秒）で打ち切る。
- 実行（LLM 無効・未同意・未設定）: 要求 0 件でルールベース描画（FR-004）。`message` に有効化の案内。失敗（HTTP 500・不正な応答・タイムアウト）: 該当のシーンはルールベース描画で、原因の分類を `getState().message.text` に通知する。どれでも図（`getState().scenes`・`renderSvg()`）は空にならず、発話は残る。
- 抽出済みの要点（AC-692 の観測点。2026-11-07）: `app.getBatchState().extracted` → `[{ scene:number, points:string[] }]`。スタイル実行で FR-003 により抽出した、その実行で使う全シーンの要点の文字（送信向けの伏せ字・「…」の省略を行う前）。最初の `POST /api/llm/extract` を送る前から、実行中・完了後に得られる（図への反映＝`getState().scenes` の更新とは独立。AC-523 により図は最後の確定まで更新しない）。実行前は `[]`。
- 複数要求の一括反映（AC-523・AC-697。2026-11-07）: 要求は 1 シーンずつ・並行のどちらでもよい。途中の応答・失敗では `getState().scenes`・`renderSvg()`・`getLiveRefresh().count` を変えない。全要求の応答受領または失敗・タイムアウト（PARAM-069。`scheduler.setTimeout`）の確定が揃った最後の時点から PARAM-158 秒以内に、失敗したシーン・予算停止で要求を出せなかったシーンのルールベース描画を含めて一括反映する。`cancelBatch()` の後は一括反映せず、後着の応答も反映しない（`runBatch` は `{ cancelled:true }` で解決）。
- 実行中: `getBatchState().state==='running'` が操作から PARAM-014（1 秒）以内に出て、`progressText`（進み具合の文字）が出る。`app.cancelBatch()`（コマンド `batch.cancel`）→ 取消で `loaded` に戻り、図は実行前のまま。実行中に別のスタイルを選んでも重ねて実行されない。
- 完了後に別のスタイルを `runBatch` すると、発話は変わらず、図だけが置き換わる。
- 実 DOM: スタイルの項目は `<button data-command="batchStyle.set:<id>" aria-pressed>`、入力モードは `<button data-command="inputMode.set:<mode>" aria-pressed>`。`globalThis.__app`（`perf-util.js` の `openApp`）で参照する。

## 4. 時間（AC-697）
- バッチの描画は、`runBatch` の呼び出し（ルールベース）、または LLM 有効ではその実行の全要求の応答受領または失敗・タイムアウトの確定が揃った最後の時点（予算 0 円などで要求 0 件なら `runBatch` の呼び出し）から PARAM-158（3 秒）以内に `renderSvg()` へ反映される（実時間とアプリの時刻の両方）。取込上限サイズ（PARAM-003＝1 MB）ちょうどのファイルでも同じ。LLM の応答を待つ間も `state==='running'` と進み具合が出て、`app.setViewMode`・パネルの移動などほかの操作は止まらない。
