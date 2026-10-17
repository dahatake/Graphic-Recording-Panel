# LLM 連携（FR-062・FR-068）System Test の契約（part 1/3）

`tests/system/llm-consent.test.js` が前提にするアプリの公開 API。期待値は要求定義書の受入基準だけから決め、
ここに書くのは「どこを通して観察するか」だけである（既存の CONTRACT.md と同じ方式。実 Foundry は呼ばない）。
ほかの part（FR-063〜067、NFR-SEC）が同じ名前を別の形で定義した場合は、conductor が競合として調整する。

## 注入する中継サーバー（同一オリジン。モック）
`createApp(options)` の `options.relay` : `async ({ method, path, body }) => ({ status, body })`。
アプリが LLM 連携のために発する要求は、すべてこの関数（同一オリジンの `/api/llm/...`）を通す。
- `GET /api/llm/status` → `{ configured: { endpoint, deployment, credential: boolean }, endpointHost: string }`（状態の確認。LLM 向けの要求には数えない）
- それ以外の `/api/llm/*`（抽出・接続テストなど）は「LLM 向けの要求」。
- `options.relay` が省略されたときは、LLM 連携は有効にできない（未設定）。

## アプリの公開 API
- `app.getLlmState()` → `{ status: 'disabled'|'enabled'|'unconfigured'|'error', enabled: boolean, missing: string[] }`（`missing` は `endpoint|deployment|credential`）
- `await app.requestLlmEnable()` → 有効化の操作（設定画面の切替）。未設定なら `{ ok:false, missing:[...] }`。設定済みなら同意の表示へ進み `{ ok:true, pending:'consent' }`（まだ有効ではない）
- `app.getLlmConsent()` → 同意の表示 `null | { open, role, label, kinds: string[], host: string, notSent: string[], actions: [{ id:'accept'|'decline', label, focusable }] }`
- `await app.answerLlmConsent(true|false)`／同意の表示で Esc は拒否
- `await app.disableLlm()` → 無効化
- `await app.flushLlm()` → 処理中の LLM 要求がすべて終わる（成功・失敗・タイムアウト）まで待つ（タイムアウトは `options.scheduler` の `setTimeout`。PARAM-069=30 秒）
- 設定画面（`app.getSettingsDialog()` / `getSettingsView()`）の `fields` に `id: 'llm.enabled'`（`role: 'switch'|'checkbox'`、`label`、`value`、`focusable`、`status: { id, text, icon }`）と `id: 'llm.credential'`（`status.text` は「設定済み／未設定」。入力欄なし＝`input` は `undefined`）。
- `app.focusSettingsField(id)` と `app.handleKey({ key })`（Enter／Space で操作、Esc で閉じる）
- 通知は `app.getState().message`（`text`、`role: 'status'`）。
