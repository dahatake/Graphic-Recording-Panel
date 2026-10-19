# カタログ

既存の機能・API・テーブル・共通部品の対応表です。1 行 1 項目の短い表にし、詳細はリンク先のファイルに任せます。
機能の表は rd-author（要求 ID・題名・決定状態）と implementer（実装ファイル・テスト・共通部品）が更新します。
未実装の要求は、実装ファイルとテストの欄を「未実装」とします。

## 機能

| 要求 ID | 題名 | 決定状態 | 実装ファイル | テスト | 使っている共通部品 |
|---|---|---|---|---|---|
| FR-001 | 音声認識による発話の取込 | 承認済み | web/src/speech.js, web/src/commandbar.js, web/src/app.js, web/src/ui.js, web/index.html | tests/unit/speech.test.js, tests/system/input.test.js, tests/system/speech.test.js | 音声入力源, アプリ組立 |
| FR-002 | 代替入力（手入力・ファイル取込） | 承認済み | web/src/input.js, web/src/app.js, web/src/ui.js, web/index.html | tests/unit/core.test.js, tests/system/input.test.js | アプリ組立 |
| FR-022 | 字幕ファイル（.vtt）の取込 | 承認済み | web/src/vtt.js, web/src/input.js | tests/unit/vtt.test.js, tests/system/vtt.test.js | アプリ組立 |
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
| NFR-OFFLINE-001 | 外部通信なしでの動作 | 承認済み | web/sw.js, web/src/main.js, web/src/speech.js | tests/unit/shell.test.js, tests/unit/sw-version.test.js, tests/unit/speech.test.js, tests/system/offline.test.js, tests/system/speech.test.js | 音声入力源 |
| NFR-PRIV-001 | 音声データの扱い | 承認済み | web/src/speech.js, web/src/persist.js | tests/unit/speech.test.js, tests/system/speech.test.js | 音声入力源 |
| NFR-A11Y-001 | 視覚表現の代替手段 | 承認済み | web/src/keymap.js, web/src/outline.js, web/styles/app.css | tests/unit/shell.test.js, tests/system/view.test.js | キーマップ, デザイン基盤, アプリ組立 |
| NFR-PERF-001 | ほぼリアルタイムの表示 | 承認済み | web/src/app.js | tests/unit/speech.test.js | アプリ組立 |
| FR-013 | 右パネルでの認識文字列の表示（ファイル取込は画面最上部） | 承認済み | web/src/transcript.js, web/src/layout.js, web/src/input.js, web/src/ui.js, web/index.html, web/styles/app.css, web/sw.js | tests/unit/transcript.test.js, tests/system/rightpanel.test.js | アプリ組立, デザイン基盤, 認識文字列 |
| FR-014 | 認識・取込の内容の図へのリアルタイム反映 | 承認済み | web/src/transcript.js, web/src/speech.js, web/src/input.js, web/src/app.js | tests/unit/transcript.test.js, tests/system/rightpanel.test.js | アプリ組立, 認識文字列 |
| NFR-BG-001 | バックグラウンドでの動作継続 | 承認済み | web/src/speech.js | tests/unit/background.test.js, tests/system/background.test.js, tests/system/speech.test.js | 音声入力源, アプリ組立 |
| NFR-UX-001 | Fluent 2 に沿った UI の振る舞い | 承認済み | web/styles/tokens.css, web/styles/app.css, web/styles/view3d.css, web/src/commandbar.js, web/src/ui.js, web/src/app.js, web/index.html, web/sw.js | tests/unit/ux.test.js, tests/system/ux.test.js | アプリ組立, デザイン基盤, コマンドバー |
| NFR-DOC-001 | 日本語の使い方ドキュメント | 承認済み | README.md, users-guide/README.md, users-guide/01-getting-started.md, users-guide/02-voice-and-import.md, users-guide/03-diagram.md, users-guide/04-export.md, users-guide/05-language-and-views.md, users-guide/06-troubleshooting.md, users-guide/07-new-features.md | tests/unit/docs.test.js, tests/unit/llmguide.test.js | - |
| NFR-UX-002 | コマンドバーのアイコンの簡易説明 | 承認済み | web/src/commandbar.js, web/src/ui.js, web/styles/app.css | tests/unit/tooltip.test.js, tests/system/tooltip.test.js | コマンドバー, i18n, デザイン基盤 |
| FR-015 | 図の演出（アイコン・色・手描き風・吹き出し・囲み・矢印・強調表示） | 承認済み | web/src/diagram.js, web/src/keymap.js, web/src/i18n.js | tests/unit/decoration.test.js, tests/unit/core.test.js, tests/system/decoration.test.js | アプリ組立, i18n, キーマップ, 感情語辞書 |
| FR-016 | 意味のある配置による 2D 整理（軸と見出し・ラベル） | 承認済み | web/src/arrange.js, web/src/diagram.js, web/src/export.js, web/src/outline.js, web/src/persist.js, web/src/app.js, web/src/commandbar.js, web/src/ui.js, web/src/i18n.js, web/sw.js | tests/unit/arrange.test.js, tests/system/arrange.test.js | アプリ組立, i18n, コマンドバー |
| FR-017 | パネルのタイル配置とフォーカス／最大化レイアウトの切替 | 承認済み | web/src/layout.js, web/src/app.js, web/src/ui.js, web/src/keymap.js, web/src/commandbar.js, web/src/i18n.js, web/index.html, web/styles/app.css | tests/unit/tile.test.js, tests/system/tile.test.js | アプリ組立, デザイン基盤, コマンドバー, キーマップ, i18n |
| FR-018 | データの初期化 | 承認済み | web/src/session.js, web/src/ui.js, web/src/speech.js, web/src/app.js, web/styles/app.css, web/src/i18n.js | tests/unit/session.test.js, tests/system/reset.test.js | アプリ組立, コマンドバー, i18n, キーマップ, 音声入力源, セッション, デザイン基盤 |
| FR-019 | 議論途中のデータのファイル保存と読込 | 承認済み | web/src/session.js, web/src/persist.js, web/src/export.js, web/src/speech.js, web/src/ui.js, web/sw.js | tests/unit/session.test.js, tests/system/sessionfile.test.js | アプリ組立, コマンドバー, i18n, キーマップ, 音声入力源, セッション |
| FR-020 | 3D 表現の評価軸の選択 | 承認済み | web/src/axes3d.js, web/src/view3d.js, web/styles/view3d.css, web/sw.js | tests/unit/axes3d.test.js, tests/system/axes3d.test.js | アプリ組立, 3D ビュー, i18n, デザイン基盤 |
| FR-021 | 3D 表現の画面操作と操作説明の表示 | 承認済み | web/src/view3d.js, web/src/i18n.js, web/styles/view3d.css | tests/unit/axes3d.test.js, tests/system/view3dhelp.test.js | アプリ組立, 3D ビュー, i18n, キーマップ, デザイン基盤 |
| NFR-UX-003 | コマンドバーのアイコンの常時ラベル | 承認済み | web/src/commandbar.js, web/src/ui.js, web/styles/app.css | tests/unit/session.test.js, tests/system/cmdlabel.test.js | コマンドバー, i18n, デザイン基盤, アプリ組立 |
| FR-023 | 字幕ファイル取込の処理中表示と再取込 | 承認済み | web/src/input.js, web/src/ui.js, web/index.html | tests/unit/importstatus.test.js, tests/system/importstatus.test.js | アプリ組立 |
| FR-024 | オブジェクト選択時のテキスト一覧のポップアップ表示 | 承認済み | web/src/popup.js, web/src/app.js, web/src/ui.js, web/src/i18n.js, web/styles/app.css, web/sw.js | tests/unit/popup.test.js, tests/system/scenepopup.test.js | アプリ組立, デザイン基盤 |
| FR-025 | シーンのトピックへの分類と集約 | 承認済み | web/src/topics.js, web/src/diagram.js, web/src/arrange.js, web/src/popup.js, web/src/outline.js, web/src/persist.js, web/src/session.js, web/src/edit-ui.js, web/src/app.js, web/src/i18n.js, web/styles/app.css, web/sw.js | tests/unit/topics.test.js, tests/system/detail.test.js | アプリ組立, i18n, キーマップ |
| FR-026 | 図の表示の詳細度の設定（初期値は大項目） | 承認済み | web/src/topics.js, web/src/diagram.js, web/src/arrange.js, web/src/popup.js, web/src/commandbar.js, web/src/ui.js, web/src/i18n.js, web/sw.js | tests/unit/topics.test.js, tests/system/detail.test.js | アプリ組立, デザイン基盤, i18n, コマンドバー, キーマップ |
| FR-027 | レイアウト型の切替（上部アイコン・名称ラベル・手動上書き・併用） | 承認済み | web/src/settings.js, web/src/layouttypes.js, web/src/commandbar.js, web/src/session.js, web/src/diagram.js, web/src/ui.js, web/src/app.js, web/styles/app.css, web/sw.js | tests/unit/layoutsettings.test.js, tests/system/layouttype.test.js | アプリ組立, デザイン基盤, コマンドバー, キーマップ, i18n, セッション, レイアウト型レジストリ |
| FR-028 | 会話の内容からのレイアウト型の自動選択 | 承認済み | web/src/autolayout.js, web/src/app.js, web/sw.js | tests/unit/autolayout.test.js, tests/system/layouttype.test.js | アプリ組立, レイアウト型レジストリ |
| FR-029 | 描画スタイルの選択（拡張可能） | 承認済み | web/src/drawstyles.js, web/src/settings.js, web/src/diagram.js, web/src/session.js, web/sw.js | tests/unit/layoutsettings.test.js, tests/system/drawstyle.test.js | アプリ組立, デザイン基盤, セッション, 描画スタイルの登録 |
| FR-030 | レイアウト・描画スタイルの［設定］画面での選択 | 承認済み | web/src/settings.js, web/src/ui.js, web/index.html, web/styles/app.css, web/src/commandbar.js | tests/unit/layoutsettings.test.js, tests/system/settings.test.js | アプリ組立, デザイン基盤, コマンドバー, キーマップ, i18n, レイアウト型レジストリ, 描画スタイルの登録 |
| FR-031 | タイムライン型の描画 | 承認済み | web/src/layoutkinds.js, web/src/diagram.js, web/src/settings.js, web/src/app.js, web/sw.js | tests/unit/layoutkinds.test.js, tests/system/layouttype.test.js | アプリ組立, レイアウト型レジストリ, 型ごとの配置 |
| FR-032 | 吹き出し型の描画 | 承認済み | web/src/layoutkinds.js, web/src/diagram.js, web/src/emotion.js | tests/unit/layoutkinds.test.js | アプリ組立, レイアウト型レジストリ, 型ごとの配置, 感情語辞書 |
| FR-033 | 発散型の描画 | 承認済み | web/src/layoutkinds.js, web/src/diagram.js, web/src/topics.js | tests/unit/layoutkinds.test.js | アプリ組立, レイアウト型レジストリ, 型ごとの配置 |
| FR-034 | 区画型の描画 | 承認済み | web/src/layoutkinds.js, web/src/diagram.js, web/styles/app.css | tests/unit/layoutzone.test.js | アプリ組立, レイアウト型レジストリ, 型ごとの配置 |
| FR-035 | 比喩テンプレート型の描画 | 承認済み | web/src/layoutkinds.js, web/src/diagram.js | tests/unit/layoutzone.test.js | アプリ組立, レイアウト型レジストリ, 型ごとの配置 |
| FR-036 | 共通配置（タイトル・登壇者・本編・小見出しと外枠） | 承認済み | web/src/layouttypes.js, web/src/settings.js, web/src/diagram.js, web/src/app.js, web/src/i18n.js | tests/unit/autolayout.test.js, tests/system/layouttype.test.js | アプリ組立, i18n, レイアウト型レジストリ |
| FR-039 | ファイル取込はセッションの状態によらずいつでも可能 | 承認済み | web/src/input.js, web/src/app.js | tests/unit/vtt.test.js, tests/unit/core.test.js, tests/unit/transcript.test.js, tests/system/importanystate.test.js | アプリ組立 |
| FR-047 | RPG風の描画スタイルとドット絵の地図 | 承認済み | web/src/rpgmap.js, web/src/rpg.js, web/src/drawstyles.js, web/src/diagram.js, web/src/export.js, web/src/settings.js, web/src/app.js, web/sw.js | tests/unit/rpgmap.test.js, tests/system/rpg.test.js | アプリ組立, 描画スタイルの登録, RPG風の地図とスプライト |
| FR-048 | RPGのキャラクター（ドット絵スプライト） | 承認済み | web/src/rpgsprites.js, web/src/rpgmap.js, web/src/rpg.js | tests/unit/rpgmap.test.js, tests/system/rpg.test.js | アプリ組立, RPG風の地図とスプライト |
| FR-049 | RPGのBGMと効果音（SE） | 承認済み | web/src/rpgaudio.js, web/src/app.js, web/sw.js | tests/unit/rpgaudio.test.js, tests/system/rpg.test.js | アプリ組立, RPG音響 |
| FR-050 | ファミコン風の操作と仮想パッド | 承認済み | web/src/rpg.js, web/src/ui.js, web/styles/app.css | tests/unit/rpginput.test.js, tests/system/rpginput.test.js | アプリ組立, デザイン基盤, RPG風の地図とスプライト, RPG音響 |
| FR-051 | RPG風のアクセシビリティ・保存・設定 | 承認済み | web/src/ui.js, web/src/rpgaudio.js, web/src/settings.js, web/styles/app.css | tests/unit/rpginput.test.js, tests/system/rpg.test.js | アプリ組立, デザイン基盤, RPG音響, 描画スタイルの登録 |
| FR-052 | 提案・未決定・合意済み決定の区別と意味に一致した強調 | 承認済み | web/src/diagram.js, web/src/outline.js, web/src/app.js, web/src/axes3d.js | tests/unit/emphasis.test.js, tests/system/emphasis.test.js | なし |
| FR-053 | 関係の種類・方向・原文上の根拠の区別と推測候補の明示 | 承認済み | web/src/layoutkinds.js, web/src/diagram.js, web/src/outline.js | tests/unit/emphasis.test.js, tests/system/emphasis.test.js | なし |
| FR-054 | 図の関係情報とテキスト一覧の一致 | 承認済み | web/src/outline.js, web/src/layoutkinds.js, web/src/app.js | tests/unit/emphasis.test.js, tests/system/emphasis.test.js | なし |
| FR-055 | 時間表現などの非因果を原因→結果から除外する意味的判定 | 承認済み | web/src/layoutkinds.js | tests/unit/emphasis.test.js, tests/system/emphasis.test.js | なし |
| FR-062 | LLM 連携の既定オフ・明示同意・自動復帰（G-002 の例外条件） | 承認済み | web/src/llm.js, web/src/relayclient.js, web/src/main.js, web/src/ui.js, web/sw.js | tests/unit/llmconsent.test.js, tests/system/llm-consent.test.js, tests/system/llm-consent-persist.test.js | アプリ組立, i18n, LLM 連携の制御 |
| FR-063 | 方式1: LLM による描くべき物の抽出と同梱部品への対応づけ | 承認済み | web/src/llmdraw.js, web/src/session.js, server/relay.py | tests/unit/llmdraw.test.js, tests/system/llm-draw.test.js, tests/system/llm-consent-persist.test.js | LLM 連携の制御, 同梱部品, 中継サーバー |
| FR-064 | 同梱部品の拡充と汎用キャラのビルダー | 承認済み | web/src/parts.js, web/src/diagram.js, web/sw.js | tests/unit/parts.test.js | 同梱部品, 感情語辞書 |
| FR-065 | 方式2（任意・既定オフ）: LLM による SVG の生成と挿入 | 承認済み | web/src/llmdraw.js, web/src/session.js, server/relay.py | tests/unit/svgsanitize.test.js, tests/system/llm-draw.test.js | SVG サニタイズ, 中継サーバー |
| FR-066 | ローカル中継サーバー | 承認済み | server/relay.py, server/relay_config.py, server/relay_security.py, server/relay_upstream.py, start.ps1, start.sh | tests/relay/test_relay_units.py, tests/system/llmrelay.test.js | 中継サーバー |
| FR-067 | LLM 連携の設定（エンドポイント・デプロイ名・認証方式） | 承認済み | server/relay_config.py, config/llm.example.json, .gitignore | tests/relay/test_llm_config_files.py, tests/relay/test_relay_units.py, tests/system/llmrelay.test.js | 中継サーバー |
| FR-068 | 設定画面での有効/無効と接続テスト | 承認済み | web/src/llm.js, web/src/ui.js, web/styles/app.css | tests/unit/llmconsent.test.js, tests/system/llm-consent.test.js, tests/system/llm-consent-persist.test.js | アプリ組立, デザイン基盤, i18n, LLM 連携の制御 |
| FR-069 | LLM 連携の使い方ガイド | 承認済み | users-guide/08-llm.md, users-guide/README.md | tests/unit/docs.test.js, tests/unit/llmguide.test.js | - |
| FR-072 | [記録開始] での音声開始の集約と、外部音声認識への同意の近接配置 | 承認済み | web/src/speech.js, web/src/commandbar.js, web/src/ui.js, web/index.html, web/src/i18n.js | tests/unit/startbar.test.js, tests/system/startbar.test.js | コマンドバー, 音声入力源, アプリ組立, i18n |
| FR-073 | 画面最上部の「取り込み」機能（アイコンと説明の文字列） | 承認済み | web/src/commandbar.js, web/src/input.js, web/src/ui.js, web/index.html, web/styles/app.css, web/src/i18n.js | tests/unit/startbar.test.js, tests/system/startbar.test.js | コマンドバー, アプリ組立, i18n, デザイン基盤 |
| FR-074 | 音声入力の開始時の認識文字列パネルの自動表示 | 承認済み | web/src/app.js, web/src/speech.js, web/src/ui.js, web/index.html | tests/unit/startbar.test.js, tests/system/startbar.test.js | アプリ組立 |
| NFR-SEC-003 | API キー・トークンの非露出 | 承認済み | server/relay.py, server/relay_security.py, server/relay_upstream.py, server/relay_config.py | tests/relay/test_relay_units.py, tests/system/llmrelay.test.js | 中継サーバー |
| NFR-SEC-004 | SVG の許可リストによる厳格なサニタイズ | 承認済み | web/src/svgsanitize.js, server/relay_security.py, web/src/session.js, web/src/parts.js | tests/unit/svgsanitize.test.js, tests/relay/test_relay_units.py | SVG サニタイズ, 同梱部品 |
| NFR-PRIV-003 | LLM への送信の最小化 | 承認済み | web/src/llmdraw.js, web/src/llm.js | tests/unit/llmdraw.test.js, tests/system/llm-draw.test.js, tests/system/llm-consent-persist.test.js | LLM 連携の制御 |
| FR-079 | 図の情報デザインによる自動再配置（何を・どこに） | 承認済み | web/src/infodesign.js, web/src/relayout.js, web/src/diagram.js, web/src/arrange.js, web/src/layoutkinds.js, web/src/settings.js, web/src/app.js | tests/unit/infodesign.test.js, tests/system/rearrange.test.js | アプリ組立, レイアウト型レジストリ, 型ごとの配置, 情報デザインの規則 |
| FR-080 | 再配置の周期の設定と、周期 0 での会話の区切りの自動判定 | 承認済み | 未実装 | 未実装 | - |
| FR-081 | Azure Speech による音声認識（方式の切替・同意・中継・失敗時の扱い） | 承認済み | 未実装 | 未実装 | - |
| FR-082 | Azure Speech の設定（エンドポイント・キーの設定・変更・削除と接続テスト） | 承認済み | 未実装 | 未実装 | - |
| NFR-SEC-005 | Azure Speech のキーの安全な保管と非露出 | 承認済み | 未実装 | 未実装 | - |

## API・イベント

| 名前 | 定義ファイル | 関連する要求 ID |
|---|---|---|
| GET /api/llm/status | server/relay.py | FR-066, NFR-SEC-003 |
| POST /api/llm/responses | server/relay.py | FR-066, NFR-SEC-003 |
| POST /api/llm/svg | server/relay.py | FR-065, NFR-SEC-004 |

## テーブル

| テーブル名 | 定義ファイル | 正本のシステム | 関連する要求 ID |
|---|---|---|---|

## 共通部品

| 部品名 | ファイル | 用途 | 使っている要求 ID |
|---|---|---|---|
| 中継サーバー | server/relay.py, server/relay_config.py, server/relay_security.py, server/relay_upstream.py | 127.0.0.1 だけの静的配信＋LLM 中継。設定は relay_config（環境変数>設定ファイル）、Host/Origin 検証と SVG サニタイズ・秘密の除去は relay_security、上流呼び出しと Entra トークンは relay_upstream。後続の設定・Entra の項目はここを拡張する | FR-063, FR-065, FR-066, FR-067, NFR-SEC-003 |
| LLM 連携の制御 | web/src/llm.js, web/src/relayclient.js | 既定オフ・同意の表示と同意後だけ有効（同意の事実・版・日時だけを grp.llm.consent に保存し、版が違えば再同意・無効化で撤回）・失敗時のルールベース復帰と短い通知・接続テスト・設定画面の項目（getLlmState / requestLlmEnable / getLlmConsent / answerLlmConsent / disableLlm / flushLlm / llmCall / testLlmConnection / getLlmLastSent）。FR-063・FR-065 は api.llmCall と 'llm:result' を使う | FR-062, FR-063, FR-068, NFR-PRIV-003 |
| アプリ組立 | web/src/app.js | 状態・コマンド・キー割り当て・パネル描画の拡張点（modules / registerCommand / registerPanelRenderer / addUtterance / addUtterances）。後続の機能はここへ足す | FR-001、FR-002、FR-003、FR-004、FR-005、FR-006、FR-007、FR-008、FR-009、FR-010、FR-011、FR-012、FR-013、FR-014、FR-015、FR-016、FR-017、FR-018、FR-019、FR-020、FR-021、FR-022、FR-023、FR-024、FR-025、FR-026、FR-027、FR-028、FR-029、FR-030、FR-031、FR-032、FR-033、FR-034、FR-035、FR-036、FR-039、FR-047、FR-048、FR-049、FR-050、FR-051、FR-062、FR-068、FR-072、FR-073、FR-074、FR-079、NFR-A11Y-001、NFR-BG-001、NFR-PERF-001、NFR-UX-001、NFR-UX-003 |
| i18n | web/src/i18n.js | ja/en の UI 文言（addStrings で後続が追加） | FR-006、FR-008、FR-015、FR-016、FR-017、FR-018、FR-019、FR-020、FR-021、FR-025、FR-026、FR-027、FR-030、FR-036、FR-062、FR-068、FR-072、FR-073、NFR-UX-002、NFR-UX-003 |
| デザイン基盤 | web/styles/tokens.css, web/styles/app.css, web/styles/view3d.css | Fluent 2 のトークン（colorNeutral/Brand 系・角丸 4/8・4px 余白・Type ramp・影・モーション）・ライト/ダーク/forced-colors・フォーカス 3px・積み重ね・カード風パネル・ボタン（primary/subtle） | FR-004、FR-011、FR-013、FR-017、FR-018、FR-020、FR-021、FR-024、FR-026、FR-027、FR-029、FR-030、FR-050、FR-051、FR-068、FR-073、NFR-A11Y-001、NFR-UX-001、NFR-UX-002、NFR-UX-003 |
| コマンドバー | web/src/commandbar.js | コマンドのグループ・インライン SVG アイコン・主要コマンド（getCommandBar / getCommandStatus）。ステータスバーの文言（記録状態・音声認識・言語・表示）。ボタンの簡易説明（showTooltip / hideTooltip / getTooltip、tooltip.<command>） | FR-016、FR-017、FR-018、FR-019、FR-026、FR-027、FR-030、FR-072、FR-073、NFR-UX-001、NFR-UX-002、NFR-UX-003 |
| 認識文字列 | web/src/transcript.js | 右パネル（パネル ID input）の確定結果一覧・暫定結果の区別表示（getTranscript / renderTranscript） | FR-013, FR-014 |
| キーマップ | web/src/keymap.js | 全操作の Alt+Shift+キー割り当て | NFR-A11Y-001, FR-015, FR-017, FR-021, FR-018, FR-019, FR-025, FR-026, FR-027, FR-030 |
| 感情語辞書 | web/src/emotion.js | 日英の感情・様子の語 → 絵記号の対応（決定的） | FR-004, FR-015, FR-032, FR-064 |
| SVG サニタイズ | web/src/svgsanitize.js, server/relay_security.py | 許可リスト（parts.js の OK_TAGS・OK_ATTRS と同一）で SVG を無害化。アプリ側は sanitizeSvg・acceptGeneratedSvg（上限 PARAM-072）、中継サーバー側は sanitize_svg・extract_svg。同じ規則を両方で二重に行い、セッション読込時にも再サニタイズする | FR-065, NFR-SEC-004 |
| 同梱部品 | web/src/parts.js | 同梱の汎用物体の SVG 部品 134 点（部品キーで引く: getPartKeys・getPartInfo・getPartSvg・getPartGroup・isPartKey）、語の辞書 → 部品（matchParts）、許可リスト検査（isAllowedPartSvg）、実在人物を特定しない汎用キャラのビルダー（buildCharacter・expressionForText。候補は CHARACTER_OPTIONS）。後続の LLM 抽出はキーを isPartKey で検証して対応づける | FR-063, FR-064, NFR-SEC-004 |
| 3D ビュー | web/src/view3d.js, web/src/axes3d.js | CSS 3D transforms による 3D 配置（get3D）、評価軸の候補・位置（getAxes3D / setAxis3D）、視点操作と操作説明（viewControl / getViewControls / getViewpoint、view.<op> のキー）、プレゼンのカメラ・タイマー（presentation.*）、WebGL なしの 2D 代替 | FR-009, FR-010, FR-020, FR-021 |
| セッション | web/src/session.js | データの初期化（data.reset・getDialog・dialogAction）、セッションファイルの保存・読込（file.save・file.load・loadSessionFile。版・上限 PARAM-010 の検証）、手修正の一覧（getManualEdits）。手動の型・描画スタイルの現在値の保存・復元（FR-027・FR-029） | FR-018, FR-019, FR-027, FR-029 |
| レイアウト型レジストリ | web/src/layouttypes.js, web/src/settings.js | 5 つの型（timeline・bubble・diverge・zone・metaphor）の登録簿。型ごとの配置（layout）・併用の重ね（overlay）を registerLayoutType で差し替える。未実装の型は暫定でタイムライン相当（timelineLayout）。型の決まり方は 手動＞設定の既定（getLayoutInfo・getDiagramLayout・setAutoLayoutSelector）。自動選択は web/src/autolayout.js が登録（FR-028）。timelineLayout はトピックごとのまとまり・小見出し・外枠を持つ（FR-036）。getDiagramLayout の入力 arranged に再配置の木を渡す（FR-079） | FR-027, FR-028, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-079 |
| 描画スタイルの登録 | web/src/drawstyles.js, web/src/settings.js | 描画スタイル（アニメ調・手書き調・シンプル・RPG風）の定義（名前・線・塗り・文字の飾り）の登録簿。registerDrawStyle で定義を足すだけで選択肢に現れ、重複・欠けた定義は拒否（getDrawStyles・setDrawStyle・getSettings・setSettings） | FR-029, FR-030, FR-047, FR-051 |
| 音声入力源 | web/src/speech.js | SpeechSource 抽象と実ブラウザ実装。選択言語だけで判定（local／downloadable は同意不要、remote は同意後のみ開始）。同意 UI・状態表示を含む。注入で差し替え可能 | FR-001、FR-012、FR-018、FR-019、FR-072、NFR-BG-001、NFR-OFFLINE-001、NFR-PRIV-001 |
| 型ごとの配置 | web/src/layoutkinds.js, web/src/diagram.js | タイムライン（Z 字・矢印ラベル・強調）・吹き出し（質問と答えの重なり・感情語は形を変える）・発散（中央のテーマと放射状・共感の強調 PARAM-019）・区画（縦のグレーの区切り線 dividers・2〜4 区画 PARAM-017）・比喩テンプレート（道・山・橋・太陽／4 象限の metaphor 要素）の配置を registerLayoutType で登録（layoutKindsModule）。配置の units・arrows・center は diagram.js の commonPlacementSvg が data-unit-id・data-flow-from で描く。発散型の詳細は再配置の木の読み順（FR-079） | FR-031, FR-032, FR-033, FR-034, FR-035, FR-079 |
| 情報デザインの規則 | web/src/infodesign.js, web/src/relayout.js | FR-079 の再配置の規則（種類の順 KIND_ORDER・結論の昇格・同一の要点のまとめ sameTextKey・下位のまとまり sceneTree/topicChunks（上限 PARAM-088）・暫定の木 provisionalTree・文字の大きさの階層 TYPE_SCALE）と、再配置の時点・図の要素（getDiagramElements・getArrangeStatus・getArrangeView・rearrangeNow・selectDiagramElement・editDiagramElement・deleteDiagramElement・getArrangeInterval）。幾何は diagram.js の detailGeometry・topicsGeometry。FR-080 の周期の設定・会話の区切りはここへ足す | FR-079 |
| RPG風の地図とスプライト | web/src/rpgmap.js, web/src/rpgsprites.js, web/src/rpg.js | ドット絵の俯瞰マップ（buildRpgMap・renderRpgSvg・paintRpgCanvas・stepHero）、16 色のパレットとコード生成のスプライト（勇者・村人・兵士）、getRpgMap・setRpgFocus・rpgPress・registerRpgButton。後続の項目（会話・BGM・操作）はここへ足す。FR-050: 十字キー・A・B のキー割り当て（handleKey）、getRpgPad、getRpgDialog（1 文字 50ms・動きを減らす設定では即時）| FR-047, FR-048, FR-050 |
| RPG音響 | web/src/rpgaudio.js | WebAudio 合成の BGM（フィールド・街・城）と SE（決定・キャンセル・カーソル・歩行・会話送り）。getRpgAudio・setRpgVolume・setRpgMuted・setRpgBgm・playRpgSe。音量・ミュートは端末ごとに grp.rpgaudio へ保存。後続の会話・操作の項目は playRpgSe を使う | FR-049, FR-050, FR-051 |

