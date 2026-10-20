# Azure Speech（FR-081・FR-082・NFR-SEC-005）System Test の契約（part 2/2）

`tests/system/azurespeech.test.js`（アプリ）・`tests/system/azurespeech-relay.test.js`（中継サーバー）・`tests/system/azurespeech-guide.test.js`（users-guide）が前提にする観察点。
CONTRACT.md・CONTRACT-LLM-*.md・RELAY-CONTRACT.md に**追加**する（上書きではない）。期待値は受入基準だけから決め、ここには「どこを通して観察するか」だけを書く。
ずれ（名前・形の衝突）は conductor が競合として調整する。実際の Azure Speech へは通信しない。キー・エンドポイントはテスト用のダミーだけを使う（AC-447）。

## 1. アプリ（`createApp(options)`）

### 注入
| キー | 形 | 意味 |
|---|---|---|
| `options.relay` | 既存（CONTRACT-LLM-FR062.md）`async ({method, path, body}) => ({status, body})` | Azure Speech の設定・接続テストの要求も、すべてこれ（同一オリジンの `/api/speech/...`）を通す。省略時は Azure Speech を使えない（未設定・中継サーバーなし扱い）。例外（throw）は「中継サーバーが応答しない」。 |
| `options.azureSpeechSource` | 下記 AzureSpeechSource | 方式が Azure Speech のときの音声認識。実ブラウザ用の実装は、マイクの音声を同一オリジンの中継サーバー（`/api/speech/recognize`）だけへ送る。テストは偽物を渡す。 |

AzureSpeechSource（SpeechSource と同じ考え方。`app` が `on*` を代入する）:
```js
{ start({lang}): void,                // lang は 'ja-JP' | 'en-US'。呼んでいる間だけ音声を中継サーバーへ送る
  stop(): void,
  onresult: null | ({text:string, isFinal:boolean}) => void,
  onerror:  null | ({code:'unconfigured'|'auth'|'network'|'mic'}) => void,   // 失敗（AC-444）
  onend:    null | ({reason:'upstream_end'|'token_expired'}) => void }       // 正常な終了・トークン期限（AC-458。失敗ではない）
```
- テストは「中継サーバーから Azure Speech への音声の送信が 0 件」を、`start` が呼ばれていない（または `stop` 後に再び呼ばれていない）ことで観察する。

### 方式
- `app.getSpeechMethod()` → `'browser' | 'azure'`（初期値 `'browser'`）。
- `app.setSpeechMethod(id)` → `{ok:boolean, reason?:'unconfigured'|'unknown'}`。Azure Speech は、最後に得た状態でエンドポイントとキーが設定済みのときだけ `ok:true`。失敗では方式は不変。
- 選んだ方式は `options.storage`（`grp.` で始まるキー）に保存し、`createApp`（同じ storage）で復元する。セッションファイル（`file.save` の `data`）には含めない。データの初期化（`data.reset`）では変えない。
- 方式が変わったとき（`setSpeechMethod`・キーの保存による自動の切替・キーの削除による戻り）と、方式が Azure Speech でエンドポイントのホストが変わったときは、`getSpeechConsent()` が `false` に戻る。記録中なら、それまでの方式の `stop()` を呼び、新しい方式の開始の条件を満たせば新しい方式の `start` を呼ぶ。
- 方式の状態の取得: `await app.refreshAzureSpeechStatus()` → `{ reachable:boolean, endpointHost:string|null, keyConfigured:boolean }`（`GET /api/speech/status`）。`createApp` の直後と `settings.open` でも実装が呼んでよいが、テストは必ずこれを `await` してから観察する。`app.getAzureSpeechSettings()` は同じ形の最後の値（同期）。

### 設定画面（`app.getSettingsDialog().fields` に追加する項目。FR-030 の 3 項目・LLM の項目は残す）
| id | 主な項目 |
|---|---|
| `speech.method` | `label`、`value:'browser'|'azure'`、`options:[{id:'browser',label,enabled:true},{id:'azure',label,enabled:boolean,reason:string|null}]`（未設定で選べないときは `enabled:false` と、トリム後に非空の `reason`） |
| `azureSpeech.endpoint` | `label`、`input:{type:'text', value:string}`、`disabled:boolean`、`focusable` |
| `azureSpeech.key` | `label`、`input:{type:'password', value:string, autocomplete:'off'|'new-password', writeOnly:true}`、`disabled`、`focusable`、`status:{id:'set'|'unset', text, icon}`（キーの値そのものはどこにも持たない） |
| `azureSpeech.status` | `label`、`status:{id:'set'|'unset'|'unavailable', text, icon}`（`text` はエンドポイントのホスト名と「設定済み」「未設定」を文字で含む。中継サーバーが応答しないときは `id:'unavailable'` で理由の文） |
| `azureSpeech.save` / `azureSpeech.delete` / `azureSpeech.test` | `label`、`role:'button'`、`focusable`、`disabled:boolean`、`azureSpeech.test` は実行後に `status:{id:'ok'|'unconfigured'|'auth'|'network'|'timeout', text, icon}` |
- 中継サーバーが応答しないとき（`relay` が throw）、`azureSpeech.*` の操作の項目（endpoint・key・save・delete・test）は `disabled:true` で、`azureSpeech.status.status.text` か各項目の `reason` に理由の文がある。
- 各項目の `label` は全角 1・半角 0.5 で数えて PARAM-011（6）以内で、表示言語に従う（`setLang` の直後に切り替わる）。`accessibleName`（非空。`label` を含む）を持つ。状態は `status.text`（文字）でも示す。
- 入力: `app.setAzureSpeechEndpointInput(text)`、`app.setAzureSpeechKeyInput(text)`（入力中の一時的な値。`fields` の `azureSpeech.key.input.value` は伏せ字の表示用で、テストはキーの文字列そのものが現れないことだけを確かめる）。
- キーボード: `app.focusSettingsField(id)` の後の `app.handleKey({key:'Enter'})` で `azureSpeech.save`・`azureSpeech.delete`・`azureSpeech.test` を実行する（`azureSpeech.delete` は確認を開く）。
- 保存: `await app.saveAzureSpeech()` → `{ok:boolean, result:string}`。`POST /api/speech/settings` に `{endpoint, key}`（キー欄が空なら `key` を送らない＝キーは変えない）を送る。送った後は成功・失敗によらずキーの入力欄を空にする。成功でキーを保存した（`key` を送った）ときは方式が Azure Speech に切り替わり、`getState().message.text` に「Azure Speech」を含むその旨が出る（Q-025 A）。
- 削除: `app.commands['azureSpeech.deleteKey']()` → 確認を開く（`app.getDialog().kind === 'azure-key-delete'`、`buttons` に `confirm`・`cancel`）。`await app.dialogAction('confirm')` で `DELETE /api/speech/key` を送る。`cancel` では何も送らない。削除が成功すると方式は `'browser'` に戻る。
- 接続テスト: `await app.testAzureSpeech()` → `{ok:boolean, result:'success'|'unconfigured'|'auth'|'network'|'timeout'}`。`POST /api/speech/test` を送り、PARAM-074（10 秒。`options.scheduler`）で打ち切って `timeout`。方式・同意・図は変えない。

### 同意と状態表示（方式が Azure Speech のとき）
- 同意は既存の `app.setSpeechConsent(bool)` / `getSpeechConsent()`（既定 false、保存しない）を Azure Speech の同意に読み替える。
- `app.getConsentUi()`: 方式が Azure Speech なら、`speechSource` のデバイス内処理の可否によらず `visible:true`。`label` は「Azure Speech」と「同意」を含み、`notice` は設定されたエンドポイントのホスト名を含む。`region:'top'`、`nearCommand:'session.start'`。
- `app.getSpeechStatus()` に `method:'browser'|'azure'` を加える。Azure Speech では `state`: 同意済み `'available'`、未同意 `'consent'`（`reason:'consent'`）、失敗 `'unavailable'`（`reason:'unconfigured'|'auth'|'network'|'mic'`）。`text` は互いに異なり、表示言語に従う。失敗のとき `actions:[{command:'speech.retryAzure', label}, {command:'speech.useBrowser', label}]`（1 回の操作。`app.commands[command]()`）。
- `getCommandBar().status.speech` は `'available'|'consent'|'unavailable'` で上記に従う。
- 自動の再開（AC-458）: `onend({reason})` を受けたとき、記録中・同意済み・方式が Azure Speech・失敗で停止していないなら、PARAM-008（2 秒。`options.scheduler`）以内に `start({lang})` を再び呼ぶ。`onerror` を受けたら `stop()` し、それ以後は利用者の操作（`speech.retryAzure`・記録の再開など）までは `start` を呼ばない。

## 2. 中継サーバー（`server/relay.py`。RELAY-CONTRACT.md に追加）

### 環境変数（テスト用。`RELAY_` で始まるので relay-util.js の startRelay が毎回消してから渡す）
| 環境変数 | 内容 |
|---|---|
| `RELAY_SPEECH_STORE` | エンドポイントとキーの保管先のファイル。省略時は `config/azure-speech.local.json`（.gitignore に載せる）。**テストは必ず一時ディレクトリを指定する** |
| `RELAY_SPEECH_UPSTREAM` | `http://127.0.0.1:<port>`。`RELAY_ALLOW_LOOPBACK_UPSTREAM=1` のときだけ有効。Azure Speech の上流への要求を、URL のホスト（`Host` ヘッダ）・パス・クエリを変えずに、このアドレスへ http で送る（宛先の解決だけを差し替える。テスト専用） |
| `RELAY_SPEECH_TOKEN_TTL_SEC` | 上流から得たアクセストークンを使う上限の秒数（テストが短縮する。既定は実装が決める） |
| `RELAY_ALLOW_LOOPBACK_UPSTREAM` | 既存（AC-364）。`1` のときだけ、エンドポイント `http://127.0.0.1:<port>`（ループバックのモック）も受け付ける（AC-449 の例外） |

### HTTP（同一オリジンの検証は AC-344 と同じ。`GET /api/speech/status` 以外は Origin が必須）
| 要求 | 応答（JSON。最上位の項目は `ok`・`result`・`reason`・`endpointHost`・`keyConfigured` だけ） |
|---|---|
| `GET /api/speech/status` | `{ endpointHost: string|null, keyConfigured: boolean }` |
| `POST /api/speech/settings` `{endpoint?:string, key?:string}` | 成功 200 `{ok:true, result:'saved', endpointHost, keyConfigured}`。エンドポイントが不正 400 `{ok:false, result:'invalid', reason}`（保存済みの設定は不変） |
| `DELETE /api/speech/key` | 200 `{ok:true, result:'deleted', endpointHost, keyConfigured:false}` |
| `POST /api/speech/test` | `{ok, result:'success'|'unconfigured'|'auth'|'network'|'timeout'}`（PARAM-074＝10 秒以内に応答） |
| `POST /api/speech/recognize?language=ja-JP|en-US`（本文は音声。`content-type: audio/wav`） | 成功 `{ok:true, result:'success', text}`、失敗 `{ok:false, result:'unconfigured'|'auth'|'network'|'timeout'}` |
- 同一オリジンでない・Origin なしの `POST`・`DELETE` は 403。保管・設定は変わらず、上流へは何も送らない。

### 上流（テストのモックが模す Azure Speech。宛先は Host ヘッダで観察する）
- エンドポイントの形: カスタムドメイン `https://<name>.cognitiveservices.azure.com`（ほか AC-449 のドメイン）なら上流のホストはそれだけ。リージョン名 `<region>` ならトークンの発行は `<region>.api.cognitive.microsoft.com`、認識は `<region>.stt.speech.microsoft.com`。
- トークンの発行: `POST /sts/v1.0/issueToken`、ヘッダ `Ocp-Apim-Subscription-Key: <key>` → 200 `text/plain` のトークン。誤ったキーは 401。
- 認識: パスに `/speech/recognition/` を含む `POST`（クエリ `language=<lang>`）、ヘッダ `Authorization: Bearer <token>`（カスタムドメインではキーのヘッダでもよい）、本文は受け取った音声 → 200 `{"RecognitionStatus":"Success","DisplayText":"..."}`。認証の誤りは 401。
- 接続テストは、本文が空の要求（キーの検証）だけを送る。

## 3. 実ブラウザでしか確かめられないこと（MANUAL-SUPPLEMENT に相当）
- 実際の DOM で、キーの入力欄が `<input type="password" autocomplete="new-password">`（または `off`）で、`<form>` の中にユーザー名の欄と組にされていないこと。保存の後、ブラウザの「戻る」・再読込で値が復元されないこと（テストは `fields` の記述と、`web/` の静的な検査で代える）。
