# 中継サーバーの System Test 契約（FR-066・FR-067・NFR-SEC-003 の担当分）

要求定義書に起動方法・場所の指定がないため、テストが前提にする公開面を、ここで決める（実装者はこれに従う。内部は自由）。期待値は受入基準だけから決める。

## 起動
`python server/relay.py --port <N> --web <静的配信のディレクトリ>`（標準ライブラリだけ。127.0.0.1 だけで待ち受ける）。
start.ps1・start.sh は同じ `server/relay.py` を起動する（既定ポート 8080）。LLM 連携の設定がなくても静的配信だけで起動する。

## 設定（環境変数が config/llm.local.json より優先。AC-349）
| 環境変数 | config/llm.local.json のキー | 内容 |
|---|---|---|
| LLM_ENDPOINT | endpoint | ベース URL（例 `https://<your-resource>.services.ai.azure.com/openai/v1`） |
| LLM_DEPLOYMENT | deployment | デプロイ名（model に指定） |
| LLM_AUTH_METHOD | authMethod | `apiKey` または `entra` |
| LLM_API_KEY | apiKey | API キー（authMethod が apiKey のとき） |
| LLM_CONFIG_PATH | - | 設定ファイルの場所（省略時 config/llm.local.json）。テスト用 |
| RELAY_AZ_COMMAND | - | az の代わりに実行する Python スクリプトのパス（テスト用のモック。実行は `python <path> account get-access-token ... --scope https://ai.azure.com/.default` 相当。引数に `https://ai.azure.com/.default` を含め、標準出力の JSON の `accessToken` を使う） |
| RELAY_ALLOW_LOOPBACK_UPSTREAM | - | `1` のときだけ、ループバックの上流（http も可）を許可（AC-364。テスト専用。既定オフ） |
| RELAY_TIMEOUT_SEC / RELAY_MAX_BYTES | - | 既定 30 / 262144（PARAM-069・071）。テストだけが短縮する |

## HTTP
- `GET /` ほか: 静的配信。
- `GET /api/llm/status` → `{ "state": "unconfigured"|"ready"|"error", "missing": [..項目名..], "reason": "秘密を含まない文" }`。キー・トークンは返さない（「設定済み」は `configured` の真偽だけ）。
- `POST /api/llm/responses`（JSON）→ 上流 `<endpoint>/responses` へ `model=<deployment>` を付けて中継し、上流の JSON を返す。Origin・Host が同一オリジン（127.0.0.1 または localhost の自分のポート）でない、または Origin がない → 403（上流へ送らない）。状態が ready でない・上流の失敗・打ち切り → 4xx/5xx の JSON エラー（秘密を含まない）。
- 認証の付け方: apiKey のとき上流への要求の `api-key` ヘッダ（または `Authorization: Bearer`）にキー、entra のとき `Authorization: Bearer <トークン>`。
