# 契約: ［設定］への接続キーの統合とリボンへの設定項目の表示（FR-084・FR-030。2026-10-25）

System Test（apikeys.test.js・ribbon-settings.test.js）が前提にする観察点。要求定義書にない名前はこの契約で定める（実装役はこれに合わせる）。

## 接続キー（FR-084 AC-482〜486）
- リボン（`getCommandBar()`・`getCommandBarLayout()`）に `apiKeys.*` の項目・`id:'apiKeys'` のグループはない。実 DOM の最上部にも接続キーのボタンはない。
- `getSettingsDialog().categories` → `[{ id, label, icon, description, descriptionVisible, accessibleName }]`。`id:'apiKeys'`（ja「接続キー」・en「API Keys」）を常に含む。`app.selectSettingsCategory(id)` で選ぶ。
- `apiKeys` を選ぶと `getApiKeysDialog()`（従来どおり。`categories`＝foundry・copilot・azureSpeech、`selected`、`fields` ほか。CONTRACT-API-KEYS.md）が非 null になる。選ぶ前は `null`。
- `app.commands['apiKeys.open']()` はリボンの項目を持たないコマンドとして残り、［設定］を開いて `apiKeys` 分類を選ぶ（FR-088 などのテストが使う）。
- 閉じる（Esc・右上の閉じる・ダイアログ内の「閉じる」）で［設定］のダイアログごと閉じ、`getFocus()` は `{command:'settings.open'}`。Esc の `handleKey` の返り値は `'apiKeys.close'` または `'settings.close'`。

## リボンの設定項目（FR-030 AC-519・AC-520）
- `getSettingsDialog().fields` に `layout.mode`・`layout.types`・`drawStyle`・`sound.muted`（値 boolean。`getRpgAudio().muted`）・`sound.volume`（値 0〜100。`getRpgAudio().volume`）・`arrange.interval`（値 0〜300）がある。
- `getCommandBar().items[i]` は［設定］の項目に対応するとき `settingsField`（上の id）を持つ。型のチェックは `layoutType.<id>`（5 つ。`settingsField:'layout.types'`、`selected` が選択中）、描画スタイルは既存の `drawStyle.pick`（`settingsField:'drawStyle'`）。決め方・ミュート・音量・周期は新しい項目（`settingsField` が `layout.mode`・`sound.muted`・`sound.volume`・`arrange.interval`。コマンド名は実装が決める）で、1 つずつ。
- 項目は `kind`（`'button'|'toggle'|'select'|'slider'|'number'`。省略は button）、`value`（現在値。［設定］の同じ項目の `value` と常に一致）、スライダー・数値は `min`・`max`、`icon`、`accessibleName`、`tabbable`、`description`＋`descriptionVisible` または `tooltip.text`、無効な項目は `disabled:true` と `disabledReason` を持つ。
## 講演向けの初期値（FR-030 AC-648。2026-11-03）
- コマンド `settings.talkPreset`（`app.commands['settings.talkPreset']()`。返り値は `undefined`・`true`・`{ok:true}` のいずれか。失敗は `false`／`{ok:false}`）。1 回の呼び出しで、設定の `layout.mode` を `'auto'` にするだけ（`drawStyle`・詳細度・内容・選択・入力中・記録中・手動の型の選択は変えない。`layout.types` は固定へ戻したときのために保持してよい）。冪等。保存は FR-030 の設定と同じ。
- ［設定］画面: `getSettingsDialog().actions`（`[{ command, label, icon, accessibleName }]`）に `settings.talkPreset`（ja の label は「講演向けの初期値にする」）を含む。
- リボン: `getCommandBar().items` に `command:'settings.talkPreset'`（`kind:'button'`。ラベルは PARAM-011 文字以内の短縮でよい）を 1 つ。`accessibleName`・`tooltip.text`・`description` のいずれかに「講演向けの初期値にする」を含む。`operateBarItem('settings.talkPreset')` → `{ ok:true, effect:'figure' }`（効果は 'none' でない）。
- 講演専用の型・規則は新設しない（`getLayoutInfo().head` は FR-027 の既存の型（AC-139 の一覧。講演専用の型ではない）のいずれか）。型は FR-028・AC-143 の結果だけで選ばれ、論点の数や区画を優先する講演専用の規則はない（2026-11-03 監査。「論点が 2〜4 なら区画が先頭」は削除）。テストの期待値は、入力に AC-143 の規則を当てはめた結果（区画の条件＝トピック数が PARAM-016〜017 で各トピックが連続した区間、ビジョンの語は比喩、順序語はタイムライン、どれでもなければ発散）とする。

- `app.operateBarItem(command, value?)` → `{ ok:boolean, effect:'state'|'figure'|'display'|'dialog'|'none' }`。リボンの項目の操作（クリック・値の入力）に相当し、`value` はトグル・選択・スライダー・数値のときだけ渡す。不正な値は `ok:false` で値を変えず、`getState().message.text` に理由を示す。存在しない項目は `ok:false`。動作する項目は `ok:true` で `effect` が `'none'` でない（状態・図・表示が変わる、またはダイアログが開く）。
