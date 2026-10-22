# 接続キー画面（FR-084・FR-085・NFR-SEC-006）契約メモ

System Test（`tests/system/apikeys.test.js`）が前提にする、アプリ（`createApp`）の観察点と操作。期待値は受入基準だけから決め、ここは「どこで観察するか」だけを定める（CONTRACT.md・CONTRACT-AZURE-SPEECH.md に追加）。
対象の AC: AC-482〜AC-487（system）、AC-490・AC-491（system）。AC-488・489・492・493・494 は integration、AC-495 は unit のため、台帳（System Test）にはケースを追加しない。

## 入口（AC-482）
- `getCommandBar().items` に `command:'apiKeys.open'` を持つ項目。`import.file` の項目（CONTRACT.md「最上部の取り込み」）と同じキーを持つ: `label`（ja「接続キー」、en「API Keys」。全角 1・半角 0.5 で PARAM-011（6）以内）、`icon`（非空）、`description`（Foundry と Azure Speech のキーを設定する旨。表示言語に従う）、`descriptionVisible:true`、`accessibleName`（`label` を含む）、`tabbable:true`。名称・説明・アクセシブルな名前に「設定」「Settings」を含まない。`settings.open` の項目は別に並存する。
- `app.commands['apiKeys.open']()` / `apiKeys.close`。

## ダイアログ（AC-483〜AC-485）
`app.getApiKeysDialog()` → `null | {`
- `open:true, role:'dialog', modal:true（aria-modal）, heading:string（非空。ダイアログの名前）, label:string`
- `overlay:{visible:true, dismissOnClick:false}`（背景全体を覆う半透明の層）, `backgroundInert:true`, `scrollLocked:true`
- `categories:[{id:'foundry', label, selected}, {id:'azureSpeech', label, selected}]`（この順。`label` は「Microsoft Foundry」「Azure Speech」）, `selected:'foundry'|'azureSpeech'`（開いた直後は `'foundry'`）
- `fields:[{id, label, accessibleName, role?, input?, status?, disabled, focusable}]`（選択中の分類の内容。id は下表）
- `closeButton:{label, accessibleName}`（右上の「閉じる」）, `focus:string|null`（フォーカスのある項目の id。`'apiKeys.close'`・`'apiKeys.category.<id>'`・`fields[].id`）, `focusInside:boolean`
- `motion:'animated'|'none'`（`env.reducedMotion` が真なら `'none'`）, `layout:'side-by-side'|'stacked'`（`options.env.viewportWidth` が狭い＝ NFR-UX-001 の狭い幅のとき `'stacked'`）
- `forcedColors:boolean`（forced-colors で判読できる指定を持つ）, `liveMessage:{text:string, role:'status'|'alert'}|null`（開閉・保存・削除の結果。読み上げ対象）
`}`

| 分類 | id |
|---|---|
| Microsoft Foundry | `apiKeys.foundry.key`（`input:{type:'password', value, autocomplete:'off'|'new-password', writeOnly:true, reveal:false}`）、`apiKeys.foundry.status`（`status:{id:'set'|'unset'|'unavailable', text, icon, source:'ui'|'env'|'file'|null}`。`text` は設定の出どころを文字で含む）、`apiKeys.foundry.save`、`apiKeys.foundry.delete`（`role:'button'`） |
| Azure Speech | `apiKeys.azureSpeech.endpoint`、`apiKeys.azureSpeech.key`、`apiKeys.azureSpeech.status`、`apiKeys.azureSpeech.save`、`apiKeys.azureSpeech.delete`、`apiKeys.azureSpeech.test`（形は CONTRACT-AZURE-SPEECH.md の `azureSpeech.*` と同じ） |

- 操作: `app.selectApiKeysCategory(id)`、`app.focusApiKeysField(id)`、`app.handleKey({key, shiftKey?})`（ダイアログが開いている間は、`Tab`・`Shift+Tab` はダイアログ内で循環し、`ArrowDown`・`ArrowUp` は分類の切替、`Escape` は閉じる。返り値は処理したコマンド名または `null`）、`app.apiKeysClick('overlay'|'close'|'closeButton')`（`overlay` は閉じない）、`app.commands['apiKeys.close']()`。背景の操作（`app.commands[...]`・`handleKey` の背景向けのキー・`setDraft`）は開いている間 `{ok:false, reason:'modal'}` 相当で無効（状態を変えない）。
- 閉じると `getApiKeysDialog()` は `null`、`getState()` に `focusReturn:'apiKeys.open'` を持ち、フォーカスは「接続キー」の操作へ戻る（`app.getFocus()` → `{command:'apiKeys.open'}`）。
- Azure Speech の分類は既存の `app.setAzureSpeechEndpointInput`・`setAzureSpeechKeyInput`・`saveAzureSpeech`・`testAzureSpeech`・`commands['azureSpeech.deleteKey']`・`getAzureSpeechSettings`（CONTRACT-AZURE-SPEECH.md）と同じ状態を操作する（別の保管を作らない）。

## Microsoft Foundry のキー（FR-085）
- `await app.refreshFoundryKeyStatus()` → `{reachable:boolean, keyConfigured:boolean, source:'ui'|'env'|'file'|null}`（`GET /api/llm/status` の `keyConfigured`・`keySource`）。`app.getFoundryKeyStatus()` は最後の値（同期）。
- `app.setFoundryKeyInput(text)`、`await app.saveFoundryKey()` → `{ok:boolean, result:'saved'|'invalid'|'unavailable'|'failed'}`。`POST /api/llm/key` に `{key}`。送った後は成功・失敗によらず入力欄を空にする。形式の検査（空・空白だけ・制御文字・長さ超過）はクライアントでも拒否し、`result:'invalid'`、要求は送らない。
- 削除: `app.commands['foundry.deleteKey']()` → 確認（`app.getDialog().kind==='foundry-key-delete'`、`confirm`・`cancel`）。`dialogAction('confirm')` で `DELETE /api/llm/key`。`source` が `'env'`・`'file'` のときは削除できず（`getApiKeysDialog()` の `apiKeys.foundry.delete` が `disabled:true`、理由の文が `status.text` か `reason` にある）、要求を送らない。
- 中継サーバーの応答（モック）: `GET /api/llm/status` → `{configured:{...}, endpointHost, keyConfigured, keySource}`、`POST /api/llm/key` → `{ok, result:'saved'|'invalid'|'failed', keyConfigured, keySource}`、`DELETE /api/llm/key` → `{ok, result:'deleted'|'env_managed', keyConfigured, keySource}`。キーの値は応答に含まれない。
- キーの保存・削除は LLM 連携の有効化・同意・送信に影響しない。データの初期化（`data.reset`）でもキーは消えない（`DELETE` を送らない）。
- 中継サーバーが応答しない（`relay` が throw）とき、`apiKeys.foundry.*` の操作の項目は `disabled:true` で、理由の文がある。

## 観察の範囲（NFR-SEC-006 AC-490・AC-491）
画面の状態（`getState`・`getApiKeysDialog`・`getSettingsDialog`・`getDialog`・`getCommandBar`・`renderSvg`・`renderOutline`・`renderTranscript`・`getStrings`）、`options.storage` の全量、セッションファイル・PNG・SVG・PDF、`console.*`、`options.relay` に渡した要求（保存の要求の本体を除く）に、ダミーのキーの値を含まない。`web/` はキーを URL・sessionStorage・IndexedDB・Cookie・履歴に書く経路を持たない（AC-452 の静的検査と同じ）。実 DOM: `web/index.html` に `id="apikeys-dialog"`（`role="dialog"`・`aria-modal="true"` の `<dialog>` または同等）があり、キー欄に `autocomplete="off"`（または `new-password`）、`<form>` はログインの形（ユーザー名の欄との組）にしない。
