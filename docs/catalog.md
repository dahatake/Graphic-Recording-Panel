# カタログ

既存の機能・API・テーブル・共通部品の対応表です。1 行 1 項目の短い表にし、詳細はリンク先のファイルに任せます。
機能の表は rd-author（要求 ID・題名・決定状態）と implementer（実装ファイル・テスト・共通部品）が更新します。
未実装の要求は、実装ファイルとテストの欄を「未実装」とします。

## 機能

| 要求 ID | 題名 | 決定状態 | 実装ファイル | テスト | 使っている共通部品 |
|---|---|---|---|---|---|
| FR-001 | 音声認識による発話の取込 | 承認済み | 未実装 | 未実装 | - |
| FR-002 | 代替入力（手入力・ファイル取込） | 承認済み | web/src/input.js, web/src/app.js, web/src/ui.js, web/index.html | tests/unit/core.test.js, tests/system/input.test.js | アプリ組立 |
| FR-003 | 発話のシーン分割と要点抽出 | 承認済み | web/src/scenes.js, web/src/app.js | tests/unit/core.test.js, tests/system/scenes.test.js | アプリ組立 |
| FR-004 | 2D のグラフィック・ファシリテーション表示 | 承認済み | web/src/diagram.js, web/src/emotion.js, web/styles/app.css | tests/unit/core.test.js, tests/system/scenes.test.js | アプリ組立, デザイン基盤, 感情語辞書 |
| FR-005 | 図の手修正 | 承認済み | web/src/edit.js, web/src/edit-ui.js, web/src/persist.js, web/src/app.js | tests/unit/export-edit.test.js | アプリ組立 |
| FR-006 | 画像としての保存 | 承認済み | web/src/export.js, web/src/edit-ui.js, web/src/app.js | tests/unit/export-edit.test.js, tests/system/export.test.js | アプリ組立, i18n |
| FR-007 | PDF としての保存 | 承認済み | web/src/export.js, web/src/app.js | tests/unit/export-edit.test.js, tests/system/export.test.js | アプリ組立 |
| FR-008 | 表示言語の切替（日本語・英語） | 承認済み | web/src/i18n.js, web/src/app.js, web/src/ui.js | tests/unit/shell.test.js, tests/system/i18n.test.js | i18n, アプリ組立 |
| FR-009 | 2D/3D の切替表示 | 承認済み | 未実装 | 未実装 | - |
| FR-010 | ダイナミックカメラによるプレゼンテーション | 承認済み | 未実装 | 未実装 | - |
| FR-011 | パネルのレイアウト変更と保存 | 承認済み | web/src/layout.js, web/src/app.js, web/src/ui.js, web/styles/app.css | tests/unit/shell.test.js, tests/system/layout.test.js | アプリ組立, デザイン基盤 |
| FR-012 | セッションの保存と復元 | 承認済み | 未実装 | 未実装 | - |
| NFR-OFFLINE-001 | 外部通信なしでの動作 | 承認済み | web/sw.js, web/src/main.js | tests/unit/shell.test.js, tests/system/offline.test.js | - |
| NFR-PRIV-001 | 音声データの扱い | 承認済み | 未実装 | 未実装 | - |
| NFR-A11Y-001 | 視覚表現の代替手段 | 承認済み | web/src/keymap.js, web/src/outline.js, web/styles/app.css | tests/unit/shell.test.js, tests/system/view.test.js | キーマップ, デザイン基盤, アプリ組立 |
| NFR-PERF-001 | ほぼリアルタイムの表示 | 承認済み | 未実装 | 未実装 | - |

## API・イベント

| 名前 | 定義ファイル | 関連する要求 ID |
|---|---|---|

## テーブル

| テーブル名 | 定義ファイル | 正本のシステム | 関連する要求 ID |
|---|---|---|---|

## 共通部品

| 部品名 | ファイル | 用途 | 使っている要求 ID |
|---|---|---|---|
| アプリ組立 | web/src/app.js | 状態・コマンド・キー割り当て・パネル描画の拡張点（modules / registerCommand / registerPanelRenderer / addUtterance / addUtterances）。後続の機能はここへ足す | FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-011, NFR-A11Y-001 |
| i18n | web/src/i18n.js | ja/en の UI 文言（addStrings で後続が追加） | FR-006, FR-008 |
| デザイン基盤 | web/styles/tokens.css, web/styles/app.css | CSS 変数・ダーク/ライト・コントラスト・フォーカス・積み重ね | FR-004, FR-011, NFR-A11Y-001 |
| キーマップ | web/src/keymap.js | 全操作の Alt+Shift+キー割り当て | NFR-A11Y-001 |
| 感情語辞書 | web/src/emotion.js | 日英の感情・様子の語 → 絵記号の対応（決定的） | FR-004 |
