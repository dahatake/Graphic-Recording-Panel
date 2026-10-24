# GitHub Copilot のプロバイダー（FR-062 AC-513・FR-068 AC-514・FR-087 AC-506・FR-088 AC-508〜AC-509・AC-511、NFR-OFFLINE-001 AC-031 の GitHub Copilot の分）System Test の契約

`tests/system/copilot.test.js` が前提にするアプリ（`createApp`）の観察点と、注入する中継サーバー（`options.relay`）のモックの形。
期待値は受入基準だけから決め、ここには「どこで観察するか」だけを書く（CONTRACT-LLM-FR062.md・CONTRACT-LLM-CONSENT.md・CONTRACT-API-KEYS.md に追加。上書きではない）。
GitHub Copilot SDK・Copilot CLI・GitHub へは通信しない。中継サーバーの内側（SDK の呼び出し）は AC-503〜505・507・510・515（integration）の範囲で、ここでは扱わない。
AC-511（Q-033）は下の「サインアウト」と「中継サーバーの実プロセスとスタブ」で扱う。AC-512 は unit のため台帳（System Test）にはケースを追加しない。

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
- プロバイダーが `'copilot'` のとき、`await app.requestLlmEnable()` は、SDK を使えない・Copilot CLI を起動できない・未サインイン（認証方式がサインイン）・トークン未設定（認証方式がトークン）なら `{ok:false, missing:[...]}`。`missing` の値は `'sdk'`（`copilot.unavailableReason:'sdk_missing'`）・`'cli'`（`copilot.unavailableReason:'cli_unavailable'`）・`'signin'`・`'token'`。`getLlmState()` は `status:'unconfigured'`・同じ `missing`。
- ［設定］の `llm.enabled` の `status.text` に原因の文（「GitHub Copilot SDK が導入されていない」「Copilot CLI を起動できない」「GitHub にサインインしていない」「トークンが未設定」）を含み、`status.actions:[{id, label}]` に次の行動を持つ:
  `'installGuide'`（導入の手順の案内。`href` または `text` が非空。原因が `'cli'` のときは SDK・Copilot CLI の導入・再導入の手順の案内で、`text`・`label` か `runSettingsAction('installGuide')` の戻り値の `text` に「Copilot CLI」を含む）、`'openApiKeys'`（接続キー画面の GitHub Copilot の分類を開く）。`app.runSettingsAction(id)` で実行する。`'openApiKeys'` の後は `getApiKeysDialog().selected === 'copilot'`。
- 失敗の通知は `getState().message`（`text` は 80 文字以内で、原因の分類の語「認証」「上限」「接続」「タイムアウト」「不正な応答」を含む）。
- モックの LLM 向けの要求の失敗の形: 認証 `401 {ok:false, error:{code:'auth'}}`、利用の上限 `429 {ok:false, error:{code:'rate_limit'}}`、接続 `502 {ok:false, error:{code:'connection'}}`、タイムアウト（応答しない。PARAM-069=30 秒）、不正な応答 `200 '<<not json>>'`、
  Copilot CLI を起動できない `503 {ok:false, error:{code:'cli_unavailable', message}}`（`message` にトークン・ファイルのパスの探針を混ぜる。このエラーを返した後は `GET /api/llm/status` の `copilot` が `available:false, unavailableReason:'cli_unavailable'`）。

## 有効なまま Copilot CLI を起動できなくなったとき（AC-506。監査 A-240・A-242）
- 503 `cli_unavailable` を受けたら: 該当のシーンはルールベース描画、`getState().message.text`（80 文字以内）に「Copilot CLI を起動できない」を含み「接続」を含まない。トークン・認証の情報・ファイルのパスはどの観察点（`surface`）にも出ない。
- `getLlmState().enabled` は `false` に戻る（自動）。同意の記録 `grp.llm.consent.copilot` は変えない。以後の LLM 向けの要求は 0 件。
- ［設定］の `llm.enabled` の `status.text` に「Copilot CLI を起動できない」、`status.actions` に `'installGuide'`（SDK・Copilot CLI の導入・再導入の案内。「Copilot CLI」を含む）。
- 「有効にできない」状態（監査 D-1）: クライアントは有効・無効のフラグや別の記録を持たず、`GET /api/llm/status` の `copilot.unavailableReason:'cli_unavailable'` から導く。その間は同意の記録（版が一致）があっても `getLlmState().enabled` は `false`、`requestLlmEnable()` は `{ok:false, missing:['cli']}`（AC-312 の例外）。再読込（同じ storage・同じ中継サーバーで `createApp` し直し、テストが `refreshCopilotStatus()` を呼ぶ）は状態を引き継がず、状態の取得の結果で決まる。
- 確かめ直し（`GET /api/llm/status`）の契機は、`commands['settings.open']()`（アプリが自ら状態の取得を送る。テストは `refreshCopilotStatus()` を呼ばない）・`await app.testLlmConnection()`・再読込だけ。利用者の操作なしに `env.scheduler` の時間を進めても `GET /api/llm/status` は送らない。
- 導入を直した後（モックの `copilot.available:true`・`unavailableReason:null`、LLM 向けの要求は成功）、上の契機のあとは `requestLlmEnable()` を呼ばずに `getLlmState().enabled` が `true`、`getLlmConsent()` は `null`、同意の記録は変わらない（再同意を求めない。AC-513）。

## 同意（AC-513）
- 同意の記録は `options.storage` のキー `grp.llm.consent`（Microsoft Foundry。従来の `{version, at}`。2026-10-24 より前の記録＝`provider` なしも Foundry への同意）と、`grp.llm.consent.copilot`（GitHub Copilot。`{version, at, provider:'copilot'}`）に置く。Foundry の記録の項目は `version`・`at` だけ（`provider` を持たない）、GitHub Copilot の記録の項目は `version`・`at`・`provider` だけ。一方の記録の作成・削除（無効化 `disableLlm()` による取り消しを含む）は他方の記録を変えない。
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
- 同じ PC の Copilot CLI ですでにサインインしているときは、操作なしに `signinStatus` が `'signedIn'`（`GET /api/llm/status` の `copilot.signedIn`）。ただし、このアプリでサインアウトした後は除く（AC-511）。
  `startCopilotSignin()` の応答が `{ok:true, state:'completed'}`（確認コードなし。CLI の資格情報が残っているとき）なら、確認コードを示さずにサインイン済みへ進む（`getCopilotSignin()` は `null` か `userCode` を持たない）。

## サインアウト（AC-511。Q-033）
- `getApiKeysDialog().fields`（`copilot` を選んだとき）に `apiKeys.copilot.signout`（「サインアウト」。`role:'button'`、`label`・`accessibleName`（非空）、`disabled`）を加える。
- `app.commands['copilot.signout']()` → 確認（`getDialog().kind === 'copilot-signout'`、`text`、`buttons` に `confirm`・`cancel`）。`text` は、Copilot CLI の資格情報は消さず、このアプリで使わない状態にするだけである旨（「Copilot CLI」「資格情報」の語を含む）。
  `cancel` では何も送らない。`confirm` で `POST /api/llm/copilot/signout`（本体なし）→ `{ok:true, result:'signed_out', copilot:{...}}`（`copilot.signedIn:false`）。
  サインアウトでは `DELETE /api/llm/copilot`（保存した設定の削除）・`DELETE /api/llm/copilot/signin`（取り消し）を送らない。
- サインアウトの後は `signinStatus` が `'signedOut'`、`requestLlmEnable()` は `{ok:false, missing:['signin']}`、`llm.enabled` の `status.text` は AC-506 の「GitHub にサインインしていない」。LLM 向けの要求は送らない。
- 中継サーバーは、このアプリでのサインアウトを自分の保管先（`RELAY_LLM_STORE`）に保存し、再起動の後も `copilot.signedIn:false` を返す（CLI の資格情報が残っていても）。
  `POST /api/llm/copilot/signin` で解除し、CLI の資格情報が残っていれば `{ok:true, state:'completed'}` を返す。

## 中継サーバーの実プロセスとスタブ（`tests/system/copilot-relay.test.js`。AC-511・AC-031）
- `server/relay.py` を `startRelay`（relay-util.js）で起動し、画面の `options.relay` を同一オリジン（`Host`・`Origin` が `127.0.0.1:<port>`）の HTTP の要求で中継サーバーへつなぐ。
- GitHub Copilot SDK は、`PYTHONPATH` の先頭に置いたスタブの `copilot` モジュール（`CopilotClient(**kw)`・`start`・`stop`・`get_auth_status()`→`is_authenticated`・`login`・`create_session(**opts)`→`send_and_wait(prompt)`・`disconnect`。`copilot.session.PermissionDecisionReject`）。
  呼び出しを `GRP_ST_SDK_LOG` に記録し、未定義の属性（サインアウト・資格情報の削除に当たるもの）へのアクセスも記録する。認証の状態は、CLI の資格情報の保管（`GRP_ST_CLI_CRED` のファイル）の有無。
- Copilot CLI は `COPILOT_CLI_PATH` のスタブ（Windows は `.cmd`、それ以外は実行可能なシェルスクリプト）。引数を `GRP_ST_CLI_LOG` に記録する。`login` は、保管に資格情報があれば確認コードなしに終了コード 0、なければ確認コード（`TEST-0000`）を出して待つ。
- 中継サーバーの保管先は一時フォルダー（`RELAY_LLM_STORE`・`LLM_CONFIG_PATH`）。GitHub のトークンの環境変数は空、`HTTP(S)_PROXY` は到達しない宛先（GitHub へ通信しない）。
- AC-031（2026-10-24。監査 A-235）: 中継サーバーが Copilot CLI を起動すること自体は許される（AC-516 の付随する通信）。観察するのは、CLI の引数と SDK の送信（`send`）以外の呼び出しに会議の内容（発話の文）が含まれないこと、`send` が有効・同意済みのときだけであること、サインインの操作なしに `login` が呼ばれないこと。
