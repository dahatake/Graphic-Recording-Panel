# System Test 契約: 画面上部での画風の選択（FR-077）・画像生成プロンプトのコピー（FR-078）

`tests/system/stylepicker.test.js`（FR-077 AC-414〜419）と `tests/system/imageprompt.test.js`（FR-078 AC-420〜424・AC-468・AC-469）が前提にする、`web/src/app.js` の公開 API の追記。
既存の契約（`CONTRACT.md`）は変えない。期待値は要求定義書の受入基準だけから決めており、この契約は「テストが何を呼ぶか」だけを定める（内部構造は自由）。
描画スタイルの ID は、既存の 4 つ（`handwritten`・`anime`・`simple`・`rpg`）以外は `getDrawStyles()` から得る（FR-076 の 9 つの風の ID はテストが固定しない）。

## 画面上部での画風の選択（FR-077）

### 選ぶボタン（AC-414・416・417）
- `getCommandBar().items` に `command:'drawStyle.pick'` を加える。`label`（全角 1・半角 0.5 と数えて PARAM-011（6）以内。英語は半角 12 文字以内）、`labelVisible:true`、`accessibleName`（`label` と一致）、`tooltip:{id,text}`・`describedBy`（NFR-UX-002 と同じ）、`tabbable:true`、`valueLabel`（現在の描画スタイルの名前。`getDrawStyles()` の `label` と同じ）を持つ。
- `keymap` に `drawStyle.pick` の割り当てを持つ（`handleKey` で一覧を開く。返り値 `'drawStyle.pick'`）。`app.commands['drawStyle.pick']()` は一覧を開く（開いているときは閉じる）。

### 一覧（AC-414・416）
- `app.getDrawStylePicker()` → `{ open:boolean, focus:'button'|'list'|null, current:styleId, activeId:styleId|null, role:'listbox'|'menu', label:string, options:[{ id, label, description, selected:boolean, selectedMark:string|null }] }`。
  - `options` は `getDrawStyles()` と同じ ID・名前・並び（登録されたすべての描画スタイル）。`label` は PARAM-011 以内、`description` は短い説明（非空）。どちらも表示言語に従い、`setLang` の直後（再生成なし）に切り替わる。
  - `selected` は現在の描画スタイルだけ `true`。`selectedMark` は選択中のとき色以外の手がかりを表す非空の文字列（例: `'check'`・`'frame'`）、それ以外は `null`。
  - 開いた直後は `open:true`・`focus:'list'`・`activeId===current`。閉じているとき `open:false`。
- 一覧が開いている間の `app.handleKey({key})`（返り値は実行した操作の非 null の名前）:
  - `ArrowDown`／`ArrowUp`: `activeId` を次／前の候補へ。`Home`／`End`: 先頭／末尾。
  - `Enter`: `activeId` の描画スタイルを選び、一覧を閉じ、`focus:'button'`。
  - `Escape`: 選ばずに一覧を閉じ、`focus:'button'`（返り値 `'drawStyle.pick.cancel'`）。描画スタイルは変わらない。
- `app.pickDrawStyle(id)` → `{ok, reason?}`（一覧の項目のクリック相当。選んで一覧を閉じ、`focus:'button'`。一覧が閉じているときに呼んでも同じく選ぶ）。未知の ID・非文字列は `ok:false` で何も変えない。

### 選んだ結果（AC-415・416・418）
- 選ぶ（`pickDrawStyle`・`Enter`・下記のコマンド）と、同期で `getDrawStyle()===id`、`renderSvg()` のルートの `data-draw-style` が `id`、`getDrawStylePicker().current===id`、ボタンの `valueLabel` がその名前になる。`getState().message.text` はその名前を含み、`getCommandBar().status.role==='status'`。
- 変えないもの: 発話・シーン・要点・`getDiagramLayout()`・`getLayoutInfo()`・`getDetailLevel()`・`selectedSceneId`・`getState().session`・`input.draft`・`renderOutline()`。`getSettings().drawStyle` と `grp.settings` も変えない（上部での選択は［設定］の既定を変えない）。
- コマンドの検索: 登録されたそれぞれの描画スタイルについてコマンド `drawStyle.select.<id>` を持ち、`app.searchCommands(その描画スタイルの label)`（ja・en）で見つかる。実行すると選ぶ。

### 狭い画面・1 行（AC-417）
- `app.getCommandBarLayout({viewportWidth})` の `items[i]` に `rect:{x,y,w,h}`（ラベルを含むボタンの外形。px）を加える。省かれた（表示されない）ボタンは `items` に含めない。
- `app.getDrawStylePickerView({viewportWidth})` → `{ options:[{ id, reachable:boolean }], scrollsHorizontally:boolean }`（一覧の全候補が横スクロールなしで到達できるなら、全件 `reachable:true`・`scrollsHorizontally:false`）。

### 保存への反映・外部通信（AC-419）
- `save.png`・`save.svg`・`save.pdf` は現在の描画スタイル（上部で選んだもの）で描く。SVG の `data` は `renderSvg()` と同じ文字列。
- 選択・描き替え・保存は `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`sendBeacon` で同一オリジン以外へ要求せず、`options.relay` も呼ばない。

### 現在値・［設定］との関係（AC-418）
- 上部で選んだ値は描画スタイルの現在値（FR-029）。`file.save` の `data` に現在の描画スタイルの ID（JSON の文字列）を含め、`loadSessionFile` で復元する。読み込んだ ID が登録にないときは `getSettings().drawStyle` で表示し、読込は `{ok:true}`（議論の内容は復元する）。
- 現在値は `grp.*` に保存しない。再読込（同じ `storage` で `createApp`）後と保存がない起動時は `getSettings().drawStyle`。
- ［設定］で既定の描画スタイルを変える（`setSettings({drawStyle})`）と、現在値もそれになる（後から操作した方が現在の描画スタイル）。
- `getSettingsDialog().fields` の `id:'drawStyle'` は `options:[{ value:styleId, label }]`（上部の一覧と同じ ID・名前・並び）を持つ。

### 拡張点（FR-078 AC-421 で使う）
- `app.registerDrawStyle(def)` → `{ok, reason?}`。`def` は FR-029 の描画スタイルの定義（`{ id, label:{ja,en}, line:{width,jitter}, fill:{mode:'paper'|'tint'}, text:{decor:'standard'|'bold'|'plain', icons:boolean} }`。FR-075 の任意の項目は省略可）。加えた描画スタイルは `getDrawStyles()`・一覧・`setDrawStyle` で選べる。

## 画像生成プロンプトのコピー（FR-078）

### options の追加
| キー | 型 | 意味 |
|---|---|---|
| `clipboard` | `{ writeText(text) => Promise }` か `null` | クリップボード。`writeText` の Promise が reject されたら「拒否」、`null`（または `writeText` がない）なら「使えない」。省略時は実ブラウザの `navigator.clipboard` |

### 操作（AC-420・423・468）
- `getCommandBar().items` に `command:'prompt.copy'`（`label` は PARAM-011 以内、`labelVisible:true`、`accessibleName`、`tooltip:{id,text}`、`describedBy`、`tabbable:true`）。`keymap` に `prompt.copy` の割り当てを持ち、`searchCommands(label)` で見つかる。`handleKey` からの実行は、マイクロタスク・`setImmediate` 1 回の後に注意が開いている（コピーは注意でコピーを選んでから）。
- `await app.commands['prompt.copy']()` → シーンが 1 つ以上: クリップボードに書き込まずに注意（下記）を開き `{ok:true, pending:'notice'}`。シーン 0: 注意を開かず `{ok:false, reason:'empty'}`。
- `await app.confirmPromptCopy()`（注意の「コピー」）→ 成功 `{ok:true, truncated:boolean, masked:boolean}`、クリップボードの拒否・使えない `{ok:false, reason:'clipboard'}`、注意が開いていない `{ok:false, reason:'notice'}`（何もしない）。どの場合も注意を閉じる。
  - 成功: `clipboard.writeText` を 1 回、`getImagePrompt({mask})`（`mask` は注意の選択）の `text` と同じ文字列で呼ぶ。`getState().message`（`key` は切り詰めなし `'prompt.copied'`、切り詰め `'prompt.truncated'`。`text` は非空）と `getCommandBar().status.role==='status'`。
  - シーン 0: `writeText` を呼ばず、`message.text` に内容がないことを示す。
  - 拒否・使えない: `app.getPromptFallback()` → `{ open:true, text:string（コピーするはずだった文章。getImagePrompt({mask}).text と同じ）, selectable:true, role:'dialog'|'region', label:string }` を開き、`message.text`（非空）で手でコピーできることを示す。それ以外のときは `getPromptFallback()` は `null`。
  - どの場合も、発話・シーン・要点・`selectedSceneId`・`input.draft`・`session` は変えない。

### コピー前の注意と簡易マスキング（AC-468・469）
- `app.getPromptCopyNotice()` → `{ open:boolean, focus:'notice'|'button'|null, role:'dialog'|'alertdialog', modal:true, label:string, text:string, live:'polite'|'assertive', mask:boolean, maskNote:string, controls:[{ id:'mask'|'copy'|'cancel', kind:'checkbox'|'button', label:string, checked?:boolean }], active:'mask'|'copy'|'cancel'|null }`。
  - 開いた直後: `open:true`・`focus:'notice'`・`mask:true`（初期は適用する。LLM 連携の有効・無効と `getLlmMasking()` に関係しない）・`active` は `controls` のどれか。`text` は会議の内容が含まれ貼り付け先の外部サービスへ渡ることの注意、`maskNote` は検出は簡易で完全な除去は保証しない旨（ja は「保証しない」か「保証しません」、en は "not guarantee" などを含む）。`label`・`text`・`maskNote`・`controls[].label` は表示言語。`controls` の `mask` は `kind:'checkbox'`・`checked`（`mask` と同じ）。
  - 閉じているとき `open:false`。注意を閉じた直後は `focus:'button'`（コピーの操作のボタンに戻る）。開いたことがなければ `focus:null`。注意が開いている間に `prompt.copy` をもう一度実行しても、注意は 1 つで書き込まない。
- `app.setPromptCopyMask(bool)` → `{ok}`（真偽値以外・注意が閉じているときは `ok:false` で不変）。`app.cancelPromptCopy()` → `{ok:true}`（取りやめ。注意を閉じる）。
- 注意が開いている間の `app.handleKey({key, shiftKey?})`（返り値は非 null の名前）: `Tab`／`Shift+Tab` は `active` を `controls` の中で次／前へ巡らせる（注意の外へ出ない）。`' '`（Space）は `active==='mask'` のとき適用を切り替える。`Enter` は `active` の操作（`copy` はコピー、`cancel` は取りやめ、`mask` は切り替え）。`Escape` は取りやめ（返り値 `'prompt.copy.cancel'`）。Enter のコピーは、マイクロタスク・`setImmediate` 1 回の後に終わっている。
- 取りやめでは `writeText` を呼ばず、`getPromptFallback()` は `null` のまま、発話・シーン・要点・`selectedSceneId`・`input.draft`・`session` を変えない。
- 簡易マスキング（AC-469）: `app.getImagePrompt({ mask:true })` は、`content` の body の、`setLlmMaskWords()` で登録した語・敬称付きの人名らしい語（例: 「山田様」）・メールアドレス・電話番号を、AC-359 と同じ規則で伏せ字に置き換えた文章（元の語を含まない）。`content` 以外の `sections` は `mask:false` と同じ。`getImagePrompt()`・`getImagePrompt({mask:false})` は伏せ字なし。PARAM-082 の判定と切り詰めは伏せ字の後の `content` で行う。伏せ字は `renderSvg()`・`renderOutline()`・`getState()`・`file.save` の `data` に反映しない。

### 文章（AC-420・421・422）
- `app.getImagePrompt({ mask }?)` → シーン 0 は `null`。それ以外は `{ text:string, truncated:boolean, sections:[{ key, heading:string, body:string, typeIds?:[typeId] }] }`（`mask:true` は上の簡易マスキングを適用。省略・`false` は適用しない）。
  - `sections` の `key` は順に `'purpose'`（目的）・`'palette'`（配色）・`'typography'`（文字）・`'illustration'`（イラスト）・`'mood'`（雰囲気）・`'composition'`（構成）・`'content'`（内容）。`text` は各 `heading` と `body` をこの順に含む。`heading` は表示言語（ja は上の括弧の語を含む）。
  - 配色・文字・イラスト・雰囲気の `body` は、選んでいる描画スタイルの画風の記述のそれぞれ配色・書体・描画・雰囲気を含む。画風の記述を持たない描画スタイルでは、その 4 つの `body` は空かその描画スタイルの名前だけ（少なくとも 1 つは名前）。
  - `composition` は `typeIds`（`getLayoutInfo().selected` と同じ）を持ち、`body` は各型の名称（`getCommandBar()` の `layoutType.<id>` の `label`）と説明を含む。
  - `content` の `body` は、トピックの題名（`getTopics()`）・シーンの見出し・要点（手修正後の文字）を、テキスト一覧（`renderOutline()`）と同じ順序で含む。PARAM-082（2000）文字を超えるときは、シーンの区切りで切り詰め（先頭のシーンから入れ、途中のシーンの一部だけを入れない）、`body` は 2000 文字以内、`truncated:true`、`text` の最後の行に `app.t('prompt.truncatedNote')`（非空）を含む。
- `app.getDrawStyleDescription(id)` → `{ palette, drawing, typography, mood }`（表示言語の短い文。非空）か、画風の記述がなければ `null`。

### 送信・保存しない（AC-424）
- 文章は `options.storage`（`grp.*`）・`file.save` の `data`・LLM 連携の中継（`options.relay`）への要求に含めない。コピーの操作は `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`sendBeacon`・`options.relay` を呼ばない。LLM 連携の有効・無効で文章は変わらない。
