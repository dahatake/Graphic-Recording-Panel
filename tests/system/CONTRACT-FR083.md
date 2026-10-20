# FR-083 契約メモ（起動ポートの自動選択）

AC-475〜AC-481 はすべて検証レベルが integration / unit のため、台帳（System Test）にはケースを追加しない。
テストは `tests/relay/test_relay_port.py`（pytest）。`python -m pytest tests/relay/test_relay_port.py` で実行する。

契約（テストが前提にするもの。文面は commit 7d1b9e1 以降）:
- `python server/relay.py --web web [--port N]`。`--port` 省略または 0 で自動選択: 前回のポート（なければ 8080）を先に試し、使用中のときだけ OS 割り当て（ポート 0）。bind 済みソケットでそのまま待ち受ける。
- 前回のポートは `~/.graphic-recording-panel/last-port`（ポート番号だけ）。テストは環境変数 `HOME` と `USERPROFILE` を一時ディレクトリに差し替えてホームを決める。待ち受け成功のたびに実ポートで更新。ない・読めない・1〜65535 の整数でない → 未保存扱い。書き込み失敗でも起動継続。`--port N` 指定時は last-port を使わない（保存の更新有無は検証しない）。
- 標準出力に `http://127.0.0.1:<実際のポート>/` を 1 行出す（flush 済み）。前回のポートと違うポートで起動したときは、続けて「引き継がれない」を含む案内行を出す（同じポートのときは出さない）。
- `--port N` が使用中・範囲外（1〜65535 以外）・非数値なら理由を stderr か stdout に出し、0 以外で終了。URL は出さない。
- Host / Origin は bind 後の実ポートで検査し、`127.0.0.1:<port>`・`localhost:<port>` のみ許可。別ポート（8080 など）・別ホストは 403。
- 前回ポート経路・OS 割り当て経路のどちらも 127.0.0.1 のみで待ち受ける。
- start.ps1 / start.sh は 8080 を含まず、引数（`"$@"` / `@args`・`$args`）を中継サーバーへ渡す。
- AC-480 の対象は README・users-guide・start.ps1・start.sh のみ（EABK-docs は対象外）。`localhost:8080` / `127.0.0.1:8080` を残さず、`--port` の説明と「引き継がれない」旨の説明がある。
