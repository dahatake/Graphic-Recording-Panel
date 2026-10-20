# FR-083 契約メモ（起動ポートの自動選択）

AC-475〜AC-481 はすべて検証レベルが integration / unit のため、台帳（System Test）にはケースを追加しない。
テストは `tests/relay/test_relay_port.py`（pytest）。`python -m pytest tests/relay/test_relay_port.py` で実行する。

契約（テストが前提にするもの）:
- `python server/relay.py --web web [--port N]`。`--port` 省略または 0 で空きポートを自動選択（8080 が使用中でも起動）。
- 標準出力に `http://127.0.0.1:<実際のポート>/` を含む行を出す（flush 済み）。
- `--port N` が使用中・範囲外（1〜65535 以外）なら理由を stderr か stdout に出し、0 以外で終了。URL は出さない。
- Host / Origin は実際のポートで検査し、別ポート（8080 など）は 403。
- 127.0.0.1 のみで待ち受ける。
- start.ps1 / start.sh は 8080 を含まず、引数（`"$@"` / `@args`・`$args`）を中継サーバーへ渡す。
- README・users-guide・EABK-docs に `localhost:8080` / `127.0.0.1:8080` を残さず、`--port` の説明がある。
