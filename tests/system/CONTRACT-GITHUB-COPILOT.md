# GitHub Copilot のプロバイダー（FR-062 AC-513・FR-068 AC-514・FR-087 AC-506・FR-088 AC-508〜AC-509）System Test の契約

`tests/system/copilot.test.js` が前提にするアプリ（`createApp`）の観察点と、注入する中継サーバー（`options.relay`）のモックの形。
期待値は受入基準だけから決め、ここには「どこで観察するか」だけを書く（CONTRACT-LLM-FR062.md・CONTRACT-LLM-CONSENT.md・CONTRACT-API-KEYS.md に追加。上書きではない）。
GitHub Copilot SDK・Copilot CLI・GitHub へは通信しない。中継サーバーの内側（SDK の呼び出し）は AC-503〜505・507・510・515（integration）の範囲で、ここでは扱わない。
AC-511 は BLOCKED（Q-033）のため扱わない。AC-512 は unit のため台帳（System Test）にはケースを追加しない。

## 中継サーバー（モック）の状態の応答 `GET /api/llm/status`
従来の項目（`configured`・`endpointHost`・`keyConfigured`・`keySource` ほか）に、次を加える。
```
provider?: 'foundry' | 'copilot'          // 中継サーバーに保存された選択。無いときは 'foundry'（既定）
copilot: {
  available: boolean,                     // GitHub Copilot SDK を使えるか
  unavailableReason: null | 'sdk_missing' | 'cli_unavailable',
  authMethod: 'signin' | 'token',         // 既定 'signin'
  authMethodSource: 'ui'|'env'|'file'|null,
  signedIn: boolean, account: string|null,// サインイン済みのときの GitHub のアカウント名
  tokenConfigured: boolean, tokenSource: 'ui'|'env'|'file'|null,
  model: string, modelSource: 'ui'|'env'|'file'|null   // 空文字＝SDK の既定のモデル
}
```
モックは漏れの探針として、状態・サインイン・エラーの応答にトークン・資格情報らしい値を混ぜる。アプリはこれを表示・保存しない。

## LLM のプロバイダーの選択（AC-514）
- `await app.refreshCopilotStatus()` → `GET /api/llm/status` を読み直し、プロバイダーの選択と `copilot` の状態を画面に反映する（`createApp` の直後・接続キー画面を開いたときにテストが呼ぶ）。
- `app.getLlmProvider()` → `'foundry'|'copilot'`（初期値 `'foundry'`）。`await app.setLlmProvider(id)` → `{ok:boolean}`。
- 選択は再読込（同じ `options.storage`・同じ中継サーバーで `createApp` し直す）・再起動の後も保たれ、`data.reset` では変わらない。
  保存先は中継サーバー（`POST /api/llm/provider` `{provider}` → `GET /api/llm/status` の `provider`）を用いてよい。ブラウザ内に保存する場合も、同意の記録以外の LLM の保存の規則（CONTRACT-LLM-CONSENT.md）に反しない形にする。
- LLM 向けの要求は、選ばれたプロバイダーを中継サーバーが知る形で送る（中継サーバーに保存した `provider`、または要求の body の `provider`）。モックは要求ごとに「その時点のプロバイダー」を記録する。
- ［設定］画面の `fields` に `id:'llm.provider'`（`role:'radiogroup'|'combobox'|'listbox'`、`label`（PARAM-011 以内、表示言語に従う）、`value`、`options:[{value:'foundry', label}, {value:'copilot', label}]`、`focusable:true`）。
  `app.focusSettingsField('llm.provider')` の後、`handleKey({key:'ArrowDown'|'ArrowRight'})` で次、`'ArrowUp'|'ArrowLeft'` で前の選択肢を選ぶ。
- 選択の切替では、もう一方のプロバイダーの設定を消す要求（`DELETE /api/llm/key`・`/api/llm/config`・`/api/llm/copilot`）を送らない。
- 接続テスト（`app.testLlmConnection()`）は選ばれたプロバイダーへの要求として送る。

## 未設定と原因の表示（AC-506・AC-313）
- プロバイダーが `'copilot'` のとき、`await app.requestLlmEnable()` は、SDK を使えない・未サインイン（認証方式がサインイン）・トークン未設定（認証方式がトークン）なら `{ok:false, missing:[...]}`。`missing` の値は `'sdk'`・`'signin'`・`'token'`。`getLlmState()` は `status:'unconfigured'`・同じ `missing`。
- ［設定］の `llm.enabled` の `status.text` に原因の文（「GitHub Copilot SDK が導入されていない」「GitHub にサインインしていない」「トークンが未設定」）を含み、`status.actions:[{id, label}]` に次の行動を持つ:
  `'installGuide'`（導入の手順の案内。`href` または `text` が非空）、`'openApiKeys'`（接続キー画面の GitHub Copilot の分類を開く）。`app.runSettingsAction(id)` で実行する。`'openApiKeys'` の後は `getApiKeysDialog().selected === 'copilot'`。
- 失敗の通知は `getState().message`（`text` は 80 文字以内で、原因の分類の語「認証」「上限」「接続」「タイムアウト」を含む）。
- モックの LLM 向けの要求の失敗の形: 認証 `401 {ok:false, error:{code:'auth'}}`、利用の上限 `429 {ok:false, error:{code:'rate_limit'}}`、接続 `502 {ok:false, error:{code:'connection'}}`、タイムアウト（応答しない。PARAM-069=30 秒）、不正な応答 `200 '<<not json>>'`。

## 同意（AC-513）
- 同意の記録は `options.storage` のキー `grp.llm.consent`（Microsoft Foundry。従来の `{version, at}`。2026-10-24 より前の記録＝`provider` なしも Foundry への同意）と、`grp.llm.consent.copilot`（GitHub Copilot。`{version, at, provider:'copilot'}`）に置く。値の項目は `version`・`at`・`provider` だけ。
- `getLlmConsent()` はプロバイダーが `'copilot'` のとき `host` に「GitHub Copilot」を含む文字、`model` に使うモデル名（空のときは SDK の既定である旨の文字）を持つ。

## 接続キー画面の GitHub Copilot の分類（AC-508・AC-509。CONTRACT-API-KEYS.md に追加）
- `getApiKeysDialog().categories` は `foundry`・`copilot`・`azureSpeech` の順（`label` は「Microsoft Foundry」「GitHub Copilot」「Azure Speech」）。
- `fields`（`copilot` を選んだとき）:
  - `apiKeys.copilot.authMethod`（`input:{type:'select', value:'signin'|'token', options:[{value:'signin'},{value:'token'}]}`。既定 `'signin'`）
  - `apiKeys.copilot.model`（`input:{type:'text', value}`、`note`: 空のときは SDK の既定のモデルを使う旨。非空）
  - `apiKeys.copilot.token`（`input:{type:'password', value, writeOnly:true, reveal:false, autocomplete:'off'|'new-password'}`。認証方式が `'signin'` のとき `disabled:true` と `reason`（非空））
  - `apiKeys.copilot.sdkStatus`（`status:{id:'available'|'missing', text, icon}`、`guide`: SDK がないときの導入の手順の案内。非空）
  - `apiKeys.copilot.signinStatus`（`status:{id:'signedIn'|'signedOut', text, account}`。`text` はサインイン済みのときアカウント名を含む）
  - `apiKeys.copilot.tokenStatus`（`status:{id:'set'|'unset', text, source:'ui'|'env'|'file'|null}`。`text` は出どころを文字で含む）
  - `apiKeys.copilot.signin`（「GitHub でサインイン」）、`apiKeys.copilot.save`、`apiKeys.copilot.delete`（`role:'button'`）
  - どの項目も `label`・`accessibleName`（非空、表示言語に従う）と `disabled` を持つ。中継サーバーが応答しないときは操作の項目が `disabled:true` で、`sdkStatus` か `signinStatus` の `status.text` に理由。
- 操作: `app.setCopilotAuthMethod('signin'|'token')`、`app.setCopilotModelInput(text)`、`app.setCopilotTokenInput(text)`、`await app.saveCopilotSettings()` → `{ok, result:'saved'|'invalid'|'unavailable'|'failed'|'env_managed'}`
  （`POST /api/llm/copilot` に `{authMethod, model}` と、認証方式がトークンで入力があるときだけ `token`。送った後は成功・失敗によらずトークン欄を空にする。
  空・空白だけ・制御文字のトークン、空白だけ・制御文字のモデル名はクライアントでも `invalid` とし送らない。環境変数・設定ファイル由来の項目の変更は `env_managed` とし送らない）、
  `app.commands['copilot.delete']()` → 確認（`getDialog().kind === 'copilot-delete'`、`confirm`・`cancel`）。`confirm` で `DELETE /api/llm/copilot`。
- サインイン（AC-509）: `await app.startCopilotSignin()`（`apiKeys.copilot.signin` と同じ）→ `POST /api/llm/copilot/signin`。
  モックの応答 `{ok:true, state:'pending', verificationUri, userCode}`。アプリは `options.scheduler.setTimeout` で `GET /api/llm/copilot/signin`（`{state:'pending'|'completed'|'expired'|'denied'|'cancelled'|'failed', account?}`）を 10 秒以内の間隔で確かめ、完了で状態を更新する（再読込なし）。
  `app.getCopilotSignin()` → `null | {state, verificationUri, link:{href, target:'_blank'}, userCode, copy:{label}, cancel:{label}, text}`（`text` は待機中・原因の文）。
  `await app.copyCopilotUserCode()` は `options.clipboard.writeText(userCode)`。`await app.cancelCopilotSignin()` → `DELETE /api/llm/copilot/signin`。
  失敗・取り消しの後は `state` が `'expired'|'denied'|'cancelled'|'failed'`、`text` に秘密を含まない原因、もう一度 `startCopilotSignin()` できる。
