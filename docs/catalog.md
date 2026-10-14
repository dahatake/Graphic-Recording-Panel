# カタログ

既存の機能・API・テーブル・共通部品の対応表です。1 行 1 項目の短い表にし、詳細はリンク先のファイルに任せます。
機能の表は rd-author（要求 ID・題名・決定状態）と implementer（実装ファイル・テスト・共通部品）が更新します。
未実装の要求は、実装ファイルとテストの欄を「未実装」とします。

## 機能

| 要求 ID | 題名 | 決定状態 | 実装ファイル | テスト | 使っている共通部品 |
|---|---|---|---|---|---|
| FR-001 | 音声認識による発話の取込 | 承認済み | web/src/speech.js, web/src/commandbar.js, web/src/app.js, web/src/ui.js, web/index.html | tests/unit/speech.test.js, tests/system/input.test.js, tests/system/speech.test.js | 音声入力源, アプリ組立 |
| FR-002 | 代替入力（手入力・ファイル取込） | 承認済み | web/src/input.js, web/src/app.js, web/src/ui.js, web/index.html | tests/unit/core.test.js, tests/system/input.test.js | アプリ組立 |
| FR-003 | 発話のシーン分割と要点抽出 | 承認済み | web/src/scenes.js, web/src/app.js | tests/unit/core.test.js, tests/system/scenes.test.js | アプリ組立 |
| FR-004 | 2D のグラフィック・ファシリテーション表示 | 承認済み | web/src/diagram.js, web/src/emotion.js, web/styles/app.css | tests/unit/core.test.js, tests/system/scenes.test.js | アプリ組立, デザイン基盤, 感情語辞書 |
| FR-005 | 図の手修正 | 承認済み | web/src/edit.js, web/src/edit-ui.js, web/src/persist.js, web/src/app.js | tests/unit/export-edit.test.js | アプリ組立 |
| FR-006 | 画像としての保存 | 承認済み | web/src/export.js, web/src/edit-ui.js, web/src/app.js | tests/unit/export-edit.test.js, tests/system/export.test.js | アプリ組立, i18n |
| FR-007 | PDF としての保存 | 承認済み | web/src/export.js, web/src/app.js | tests/unit/export-edit.test.js, tests/system/export.test.js | アプリ組立 |
| FR-008 | 表示言語の切替（日本語・英語） | 承認済み | web/src/i18n.js, web/src/app.js, web/src/ui.js | tests/unit/shell.test.js, tests/system/i18n.test.js | i18n, アプリ組立 |
| FR-009 | 2D/3D の切替表示 | 承認済み | web/src/view3d.js, web/styles/view3d.css, web/src/app.js, web/src/main.js | tests/unit/view3d.test.js, tests/system/view.test.js | アプリ組立, 3D ビュー |
| FR-010 | ダイナミックカメラによるプレゼンテーション | 承認済み | web/src/view3d.js, web/src/keymap.js, web/src/ui.js | tests/unit/view3d.test.js, tests/system/view.test.js | アプリ組立, 3D ビュー |
| FR-011 | パネルのレイアウト変更と保存 | 承認済み | web/src/layout.js, web/src/app.js, web/src/ui.js, web/styles/app.css | tests/unit/shell.test.js, tests/system/layout.test.js | アプリ組立, デザイン基盤 |
| FR-012 | セッションの保存と復元 | 承認済み | web/src/persist.js, web/src/app.js, web/src/speech.js | tests/unit/speech.test.js, tests/system/persist.test.js | 音声入力源, アプリ組立 |
| NFR-OFFLINE-001 | 外部通信なしでの動作 | 承認済み | web/sw.js, web/src/main.js, web/src/speech.js | tests/unit/shell.test.js, tests/unit/speech.test.js, tests/system/offline.test.js, tests/system/speech.test.js | 音声入力源 |
| NFR-PRIV-001 | 音声データの扱い | 承認済み | web/src/speech.js, web/src/persist.js | tests/unit/speech.test.js, tests/system/speech.test.js | 音声入力源 |
| NFR-A11Y-001 | 視覚表現の代替手段 | 承認済み | web/src/keymap.js, web/src/outline.js, web/styles/app.css | tests/unit/shell.test.js, tests/system/view.test.js | キーマップ, デザイン基盤, アプリ組立 |
| NFR-PERF-001 | ほぼリアルタイムの表示 | 承認済み | web/src/app.js | tests/unit/speech.test.js | アプリ組立 |
| FR-013 | 右パネルでの認識文字列の表示とファイル取込 | 承認済み | web/src/transcript.js, web/src/layout.js, web/src/input.js, web/src/ui.js, web/index.html, web/styles/app.css, web/sw.js | tests/unit/transcript.test.js, tests/system/rightpanel.test.js | アプリ組立, デザイン基盤, 認識文字列 |
| FR-014 | 認識・取込の内容の図へのリアルタイム反映 | 承認済み | web/src/transcript.js, web/src/speech.js, web/src/input.js, web/src/app.js | tests/unit/transcript.test.js, tests/system/rightpanel.test.js | アプリ組立, 認識文字列 |
| NFR-BG-001 | バックグラウンドでの動作継続 | 承認済み | web/src/speech.js | tests/unit/background.test.js, tests/system/background.test.js, tests/system/speech.test.js | 音声入力源, アプリ組立 |
| NFR-UX-001 | Fluent 2 に沿った UI の振る舞い | 承認済み | web/styles/tokens.css, web/styles/app.css, web/styles/view3d.css, web/src/commandbar.js, web/src/ui.js, web/src/app.js, web/index.html, web/sw.js | tests/unit/ux.test.js, tests/system/ux.test.js | アプリ組立, デザイン基盤, コマンドバー |
| NFR-DOC-001 | 日本語の使い方ドキュメント | 承認済み | README.md, users-guide/README.md, users-guide/01-getting-started.md, users-guide/02-voice-and-import.md, users-guide/03-diagram.md, users-guide/04-export.md, users-guide/05-language-and-views.md, users-guide/06-troubleshooting.md | tests/unit/docs.test.js | - |
| NFR-UX-002 | コマンドバーのアイコンの簡易説明 | 承認済み | web/src/commandbar.js, web/src/ui.js, web/styles/app.css | tests/unit/tooltip.test.js, tests/system/tooltip.test.js | コマンドバー, i18n, デザイン基盤 |
| FR-015 | 図の演出（アイコン・色・手描き風・吹き出し・囲み・矢印・強調表示） | 承認済み | web/src/diagram.js, web/src/keymap.js, web/src/i18n.js | tests/unit/decoration.test.js, tests/unit/core.test.js, tests/system/decoration.test.js | アプリ組立, i18n, キーマップ, 感情語辞書 |
| FR-016 | 意味のある配置による 2D 整理（軸と見出し・ラベル） | 承認済み | 未実装 | 未実装 | - |
| FR-017 | パネルのタイル配置とフォーカス／最大化レイアウトの切替 | 承認済み | web/src/layout.js, web/src/app.js, web/src/ui.js, web/src/keymap.js, web/src/commandbar.js, web/src/i18n.js, web/index.html, web/styles/app.css | tests/unit/tile.test.js, tests/system/tile.test.js | アプリ組立, デザイン基盤, コマンドバー, キーマップ, i18n |

## API・イベント

| 名前 | 定義ファイル | 関連する要求 ID |
|---|---|---|

## テーブル

| テーブル名 | 定義ファイル | 正本のシステム | 関連する要求 ID |
|---|---|---|---|

## 共通部品

| 部品名 | ファイル | 用途 | 使っている要求 ID |
|---|---|---|---|
| アプリ組立 | web/src/app.js | 状態・コマンド・キー割り当て・パネル描画の拡張点（modules / registerCommand / registerPanelRenderer / addUtterance / addUtterances）。後続の機能はここへ足す | FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-017, NFR-PERF-001, NFR-BG-001, NFR-A11Y-001, NFR-UX-001 |
| i18n | web/src/i18n.js | ja/en の UI 文言（addStrings で後続が追加） | FR-006, FR-008, FR-015, FR-017, NFR-UX-002 |
| デザイン基盤 | web/styles/tokens.css, web/styles/app.css, web/styles/view3d.css | Fluent 2 のトークン（colorNeutral/Brand 系・角丸 4/8・4px 余白・Type ramp・影・モーション）・ライト/ダーク/forced-colors・フォーカス 3px・積み重ね・カード風パネル・ボタン（primary/subtle） | FR-004, FR-011, FR-013, FR-017, NFR-A11Y-001, NFR-UX-001, NFR-UX-002 |
| コマンドバー | web/src/commandbar.js | コマンドのグループ・インライン SVG アイコン・主要コマンド（getCommandBar / getCommandStatus）。ステータスバーの文言（記録状態・音声認識・言語・表示）。ボタンの簡易説明（showTooltip / hideTooltip / getTooltip、tooltip.<command>） | NFR-UX-001, NFR-UX-002, FR-017 |
| 認識文字列 | web/src/transcript.js | 右パネル（パネル ID input）の確定結果一覧・暫定結果の区別表示（getTranscript / renderTranscript） | FR-013, FR-014 |
| キーマップ | web/src/keymap.js | 全操作の Alt+Shift+キー割り当て | NFR-A11Y-001, FR-015, FR-017 |
| 感情語辞書 | web/src/emotion.js | 日英の感情・様子の語 → 絵記号の対応（決定的） | FR-004, FR-015 |
| 3D ビュー | web/src/view3d.js | CSS 3D transforms による 3D 配置（get3D）、プレゼンのカメラ・タイマー（presentation.*）、WebGL なしの 2D 代替 | FR-009, FR-010 |
| 音声入力源 | web/src/speech.js | SpeechSource 抽象と実ブラウザ実装。選択言語だけで判定（local／downloadable は同意不要、remote は同意後のみ開始）。同意 UI・状態表示を含む。注入で差し替え可能 | FR-001, FR-012, NFR-PRIV-001, NFR-OFFLINE-001, NFR-BG-001 |
