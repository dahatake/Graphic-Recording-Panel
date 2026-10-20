# Graphic Recording Panel

会話をその場でシーン（見出しと要点）に整理し、グラフィックレコーディング風の図として表示するブラウザアプリです。
ビルド不要の静的ファイルだけで動き、外部のサーバー・CDN・外部オリジンへの通信は一切ありません（ネットワークを切断しても動作します）。

## 使い方ガイド

詳しい手順は [使い方ガイド](users-guide/README.md) にあります。

- [01 導入と起動](users-guide/01-getting-started.md)
- [02 音声入力とファイル取込](users-guide/02-voice-and-import.md)
- [03 図の見方](users-guide/03-diagram.md)
- [04 保存](users-guide/04-export.md)
- [05 言語切替・2D/3D・プレゼンテーション](users-guide/05-language-and-views.md)
- [06 トラブルシュート](users-guide/06-troubleshooting.md)
- [07 新機能の使い方](users-guide/07-new-features.md)
- [08 LLM 連携（方式2・任意）](users-guide/08-llm.md)
- [09 Azure Speech による音声認識（任意）](users-guide/09-azure-speech.md)

## 起動手順

1. Python 3.7 以上が使えるマシンで、リポジトリのルートにある OS 別のスクリプトを実行します。

   **Windows（PowerShell）**
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\start.ps1
   ```

   **macOS（ターミナル）**
   ```sh
   sh ./start.sh
   ```

2. ブラウザで <http://localhost:8080/> を開きます（Chrome / Edge の最新版を推奨）。
   初回表示後は Service Worker（`web/sw.js`）が画面一式を保存するため、以降はオフラインでも起動できます。

スクリプトは自身の場所を基準に `web/` を配信するため、別のフォルダーから絶対パスで実行しても使えます。サーバーは `127.0.0.1:8080` だけで待ち受けます。停止するには起動したターミナルで `Ctrl+C` を押してください。ポート 8080 が使用中というエラーが出た場合は、そのポートの使用を終了してから再実行してください。

手動で起動する場合は、リポジトリのルートで `python -m http.server --bind 127.0.0.1 -d web 8080`（macOS では `python3`）を実行できます。

### file:// での起動
`web/index.html` をダブルクリックして `file://` で開く方法は**使えません**。ブラウザが `file://` からの ES モジュールの読み込みと Service Worker の登録を拒否するためです。必ず上の静的サーバー（`localhost`）経由で開いてください。サーバーは Python 以外（`npx serve web` など）でもかまいません。

## 使い方

- **手入力**: 入力欄に発話を入力して確定します。シーンが自動で区切られ、図とシーン一覧に反映されます。
- **音声認識**: ブラウザが**デバイス内で処理する**音声認識を提供している場合にだけ有効です。提供していない環境ではボタンが無効になり、音声が外部へ送られることはありません。音声データは保存しません。無効のときは手入力を使ってください。
- **2D / 3D**: 「2D 表示」「3D 表示」で切り替えます。WebGL が使えない環境では 2D になります。
- **プレゼンテーション**: 開始・一時停止・再開・停止、前後のシーンへの移動ができます。動きを減らす設定（`prefers-reduced-motion`）に従います。
- **保存**: PNG・SVG・PDF で保存できます（ブラウザのダウンロードとして保存され、外部へは送信されません）。
- **言語切替**: 日本語 / English を切り替えられます。
- **配色・レイアウト**: ダーク／ライトの切替と、パネルの移動・大きさの変更ができます。「既定のレイアウトに戻す」で復元します。
- **シーン一覧**: 図と同じ順序のテキストの一覧です。画面読み上げでも同じ情報を確認できます。

## キーボード操作

すべての操作は `Alt + Shift + <キー>` で行えます。

| キー | 操作 | キー | 操作 |
|---|---|---|---|
| R | 記録を開始 | 1 / 2 / 3 | PNG / SVG / PDF で保存 |
| P / E | 一時停止 / 再開 | J / K | 日本語 / English |
| X | 終了 | D / V | 2D / 3D 表示 |
| N | 次のシーン | G / H / Y / T | プレゼン開始 / 一時停止 / 再開 / 停止 |
| I | 入力欄へ移動 | → / ← | プレゼンの次 / 前のシーン |
| S / W | 音声認識の開始 / 停止 | M | 配色の切替 |
| 0 | 既定のレイアウトに戻す | | |

## 開発者向け

```powershell
node --test tests/system/*.test.js tests/unit/*.test.js
python scripts/verify.py --quick
```

`web/` にファイルを足したら、`web/sw.js` の `SHELL` に追加して `VERSION` を上げてください（回帰テスト `tests/unit/nfr.test.js` が漏れを検出します）。
