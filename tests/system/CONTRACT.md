# System Test 契約（web/ の公開 API）

System Test（`tests/system/*.test.js`、`node --test tests/system/`）が前提にする、`web/` の公開 API。実装者はこれに従う。
期待値は要求定義書の受入基準だけから決めており、この契約は「テストが何を呼ぶか」だけを定める（内部構造は自由）。
アプリは静的 Web（ビルド不要、ES モジュール）。`web/index.html` が `web/src/app.js` を読み込んで DOM に結び付ける。
`web/src/app.js` は DOM・グローバルに依存せずに import でき（Node で import できる）、副作用は注入された依存だけを通す。

## `web/src/app.js`

```js
export async function createApp(options) -> app   // await 可能（同期で返してもよい）
```

### options（すべてテストが注入。省略時は実ブラウザの既定を使う）
| キー | 型 | 意味 |
|---|---|---|
| `storage` | `{getItem,setItem,removeItem,key(i),length}` | Web Storage 互換。保存はこれだけ。キーはすべて `grp.` で始める（`grp.session`＝セッション、`grp.layout`＝レイアウト）。`createApp` は生成時に保存済みセッション・レイアウトを復元する |
| `scheduler` | `{setTimeout(fn,ms)->id, clearTimeout(id)}` | プレゼンの滞在時間はこれだけで計る（`setInterval`・`Date` 禁止） |
| `speechSource` | `SpeechSource` | 疑似音声認識（下記） |
| `now` | `() => ms` | 発話の受付時刻（FR-003 AC-007）。実時間ではこれを使う |
| `canvasFactory` | `(w,h) => canvas` | `canvas.getContext('2d')`（`fillText(text,x,y)` で見出し・要点を描く）と `await canvas.toBytes() -> Uint8Array`（PNG）を持つ。実ブラウザでは `toBlob` から作る |
| `download` | `({filename, mime, data}) => void` | 保存ファイルの受け渡し。`data` は PNG/PDF が `Uint8Array`、SVG が `string` |
| `origin` | string | 同一オリジン（既定 `location.origin`） |
| `env` | `{webgl:boolean, reducedMotion:boolean, viewportWidth:number}` | 実行環境の判定の注入 |

### SpeechSource（疑似音声認識の抽象。`web/src/speech.js` に実ブラウザ用の実装、テストは同じ形の偽物を渡す）
```js
{ processLocally: boolean,            // デバイス内処理を確認できるときだけ true
  start({lang}): void, stop(): void,  // lang は 'ja-JP' | 'en-US'
  onresult: null | ({text:string, isFinal:boolean}) => void,   // app が代入する
  onerror:  null | ({code:string}) => void }
```
`app.startSpeech()` が `start({lang})` を呼ぶ。`processLocally === false` のときは呼ばずに `{ok:false}` を返し理由メッセージを出す。
`isFinal:true` だけが発話になる。セッションが記録中でないときの `onresult` は無視する。

### app の公開面
状態・操作（同期。返り値のある操作は下記）
- `app.getState()` → `{ lang:'ja'|'en', session:'preparing'|'recording'|'paused'|'stopped', utterances:[{id,text,receivedAt}], scenes:[Scene], selectedSceneId:string|null, viewMode:'2d'|'3d', input:{draft:string}, message:{key:string,text:string}|null, presentation:{status:'idle'|'playing'|'paused'|'finished', index:number|null, sceneId:string|null} }`
  - `Scene = { id, heading:string(非空), points:[{id,text}](1 件以上), relations:[{from:pointId,to:pointId}], status:'in_progress'|'confirmed' }`。時系列順。
  - 要点の生成規則（FR-003 は別担当）に依存しないための取り決め: 発話が 40 文字以下なら、その発話のトリム済み文字列がちょうど 1 件の要点になる。1 シーンに要点が 2 件以上あれば `relations` は 1 件以上。
- `app.setDraft(text)` / `app.submitDraft()` → `{ok:boolean, reason?:string}`（記録中でなければ `ok:false`、`reason:'not_recording'`、`message` に「記録を開始・再開してください」（ja）を出し、draft は保つ。空白だけは `reason:'empty'`。成功で draft は `''`）
- `await app.importTextFile({name,type,size,text})` → `{ok, added?:number, reason?}`。`.txt` かつ `size` が 1 MB 以下のとき、空でない行ごとに発話を追加。上限超過・テキストでない・空は `ok:false` で既存の発話は不変。
- `app.selectScene(id)`、`app.setViewMode('2d'|'3d')`（WebGL 無しでは 3D の代替表示または 2D になる）、`app.setLang('ja'|'en')`、`app.t(key)`、`app.getStrings()` → 現在の表示言語の UI 文言の全量 `{key:string}`（操作名・メッセージ・`app.title` を含む）。ja と en はキー集合が同一。
- `app.startSpeech()` / `app.stopSpeech()`。
- `app.renderSvg()` → 2D の図の SVG 文字列。各シーンは `<g data-scene-id="<id>">` で、見出しと要点を `<text>` として含み、関係線は `<line>` か `<path>`。シーンは時系列順。
- `app.renderOutline()` → 図と同順序の、見出し・要点のテキスト一覧（HTML 文字列）。
- `app.get3D()` → `{ nodes:[{sceneId, position:{x,y,z}}], selectedSceneId, camera:{targetSceneId:string|null, animated:boolean} }`。2 シーン以上のとき `z` は全て同一にしない。`viewMode==='3d'` でない場合も呼べる。
- `app.getLayout()` → `{panels:{input,diagram,outline}}`（各 `{x,y,w,h,visible:boolean,maximized:boolean}`）。`app.movePanel(id,{x,y})`、`app.resizePanel(id,{w,h})`、`app.setPanelVisible(id,bool)`、`app.setPanelMaximized(id,bool)`、`app.resetLayout()`。
  メニュー/キーボード用: `app.panelCommand(id, 'move-left'|'move-right'|'move-up'|'move-down'|'grow'|'shrink')`（move-right は x 増、move-left は x 減、move-down は y 増、move-up は y 減、grow は w・h 増、shrink は w・h 減）。
- `app.clearSavedSession()`：`grp.session` を取り除く。レイアウトは対象外。
- 保存: 状態が変わるたびに `grp.session` へ自動保存（発話・シーン・要点。音声は含めない）。`createApp` が復元したセッションの状態は必ず `paused`。`resume` で `startSpeech` 相当（`speechSource.start`）を改めて行う。

### コマンドとキーボード（NFR-A11Y-001 AC-036、FR-010 AC-023）
`app.commands[name]()`（ボタン相当）。`app.keymap = [{key, ctrl?, alt?, shift?, command}]`。`app.handleKey({key,ctrlKey,altKey,shiftKey})` は実行したコマンド名を返す（該当なしは `null`）。
必須コマンド（すべて `keymap` に割り当てを持つ）:
`session.start` `session.pause` `session.resume` `session.stop` `session.nextScene` `input.focus`
`save.png` `save.svg` `save.pdf` `lang.ja` `lang.en` `view.2d` `view.3d`
`presentation.start` `presentation.pause` `presentation.resume` `presentation.stop` `presentation.next` `presentation.prev`
`save.*` は `Promise` を返し、`options.download({filename,mime,data})` を 1 回呼ぶ（シーン 0 件では無効＝呼ばない）。

### プレゼンテーション（FR-010）
`presentation.start` は 1 シーン目へカメラ（`get3D().camera.targetSceneId`）を向け、`scheduler.setTimeout` で 8 秒（PARAM-004）後に次へ。最後のシーンの 8 秒後に `status:'finished'`。`pause` で停止、`resume` で残りではなく当該シーンの滞在を再開してよい（残り時間でも可）。`next`/`prev` は即時移動（先頭・末尾で止まる）。`stop` で `idle`。`env.reducedMotion` が真なら `camera.animated===false`。

### 保存ファイル
- SVG: `renderSvg()` と同内容の文字列。
- PNG: `canvasFactory` で全シーンの見出しと要点を `fillText` で描き、`toBytes()` の結果を `download` に渡す（`mime:'image/png'`）。
- PDF（`mime:'application/pdf'`、`.pdf`）: 先頭 `%PDF-`、末尾 `%%EOF`、`xref`・`trailer`・`startxref` を持ち、`/Type /Page` が 1 件以上。全シーンの見出しと要点を、内容ストリーム（無圧縮）に `/Span <</ActualText <FEFF…>>> BDC … EMC`（UTF-16BE の 16 進）として含む（ASCII だけなら `(text) Tj` でも可）。`/URI` や `http` の外部参照を含めない。

### 外部通信
実装は `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`navigator.sendBeacon`/外部オリジンの `<script>`・`<link>`・`<img>`・`import` を使わない。`web/` 配下に外部 URL（`xmlns` の名前空間 URI を除く）を書かない。

## 実ブラウザでしか確認できないこと
`tests/system/MANUAL-SUPPLEMENT.md`。
