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
`app.startSpeech()` が `start({lang})` を呼ぶ。`processLocally === false`（デバイス内処理でない）のときは、利用者の同意（下記「音声認識の日本語対応」）がない間は呼ばずに `{ok:false}` を返し理由メッセージを出す（同意があれば呼ぶ）。
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

## 右パネル・暫定結果・リアルタイム反映（FR-013 / FR-014、追記。既存の契約は変えない）
- 右パネル（認識文字列パネル）は既存のパネル `input`。既定レイアウトで `getLayout().panels.input.x > panels.diagram.x`、`visible:true`。パネル ID は増やさない。見出しは `app.t('panel.input')`。
- `app.getTranscript()` → `{ heading:string, interim:string|null, finals:[{id,text}] }`。`finals` は音声の確定結果とファイル取込の各行（受付順）。`interim` は直近の暫定結果で、確定結果が届く・記録中でなくなると `null`。
- 暫定結果（`isFinal:false`）は記録中のときだけ `interim` に入り、発話・シーン・図には影響しない。記録中でないときは無視する。確定結果は `interim` を `null` にし `finals` に加える。
- `app.renderTranscript()` → HTML 文字列。見出しを含み、暫定は `data-kind="interim"` の要素（クラス名に `interim` を含み、`app.t('transcript.interim')`（ja は「暫定」）の語を含む）、確定は `data-kind="final"` の要素（暫定とクラスが異なり、暫定の語を含まない）。
- 図への反映: 確定結果（音声・手入力・ファイル取込）は、受付（取込は完了）から 3 秒（PARAM-001）以内に `renderSvg()`・`renderOutline()` に現れる。テストは `scheduler.advance(3000)` の後に確認する（同期反映でもよい）。受け付けられなかった入力は何も変えない。
- ファイル取込の反映のテストは 100 行（各 40 文字以下）。上限サイズ全行の負荷は AC から決まらないため範囲外。

## バックグラウンド動作の継続（NFR-BG-001 AC-063 / AC-064 / AC-065、追記。既存の契約は変えない）
- SpeechSource に **認識の自動終了通知 `onend: null | () => void`** を足す（ブラウザが認識を自動終了したとき実装が呼ぶ。`app` が代入する）。
- `options.visibility`（省略可。省略時は実ブラウザの `document` の `visibilityState` / `visibilitychange`）: `{ hidden:boolean, onchange:null|()=>void }`。`app` が `onchange` を代入する。テストは `hidden` を書き換えて `onchange()` を呼ぶ（`FakeVisibility.set(bool)`）。
- 非表示の間も、記録中の `speechSource.onresult`（確定）は通常どおり発話・シーン・要点・`getTranscript().finals` に入り、取りこぼし・重複・並べ替えをしない（非表示を理由に破棄・遅延・バッファの欠落をしない）。可視に戻ってから 2 秒（PARAM-008）以内（テストは `scheduler.advance(2000)` の後）に `renderTranscript()`・`renderSvg()`・`renderOutline()` が最新を表す。
- `onend()` が来たとき、`session==='recording'` かつ `speechSource.processLocally===true` なら、2 秒以内（`scheduler.setTimeout` 使用可。テストは `advance(2000)` の後）に `speechSource.start({lang})`（現在の表示言語）を再度呼ぶ。`paused`/`stopped`/`preparing`（停止・一時停止の操作後を含む）や `processLocally===false` では呼ばない。再開で発話は増減しない。

## コマンドバーとステータス（NFR-UX-001 AC-057 / AC-060）
- `app.getCommandBar()` → `{ position:'top', items:[{command,label,tabbable:boolean}], status:{ role:'status', live:'polite'|'assertive', session:'preparing'|'recording'|'paused'|'stopped', speech:'available'|'consent'|'unavailable', text:string } }`。`items` は必須コマンドのうち `session.*`・`save.*`・`lang.*`・`view.*`・`presentation.*` を含む。`speech` は `getSpeechStatus().state`（`local`→`available`、`consent`→`consent`、`unavailable`→`unavailable`。日本語対応で `consent` を追加。デバイス内処理でなく API がある環境は、旧契約の `unavailable` ではなく `consent`）。`text` は `getSpeechStatus().text` を含む。`status.text` は状態が変わると変わる。
- `web/index.html` は、コマンドバー（`id="toolbar"` か `role="toolbar"`）と `role="status"` かつ `aria-live` のステータス要素を `<main>` より前に置く。正の `tabindex` を使わない。

## コマンドバーのツールチップ（NFR-UX-002 AC-071 / AC-072 / AC-073）
- `app.getCommandBar().items[i]` は `label`・`tabbable` に加え `tooltip:{ id:string, text:string }` を持つ。`text` は現在の表示言語の簡易な説明文（トリム後に非空、`label` と同一でなくてもよい、ボタンごとに異なる）。`items` の全ボタンが対象（アイコンのみのボタンを含む）。
- `app.showTooltip(command, trigger)`（`trigger` は `'hover'|'focus'`）→ `{visible:true, text, id}`。`app.hideTooltip(command, trigger)`（`'leave'|'blur'`）→ `{visible:false}`。`app.getTooltip()` → `null | {command, text, id, visible:true}`（表示中のものだけ。同時に 1 つ）。`hover` と `focus` の `text` は同一。表示言語の `text` に従う（`getCommandBar().items[i].tooltip.text` と同じ）。
- `blur`/`leave` で `getTooltip()` は `null`（別ボタンの表示は残さない）。`showTooltip` は不明なコマンドで `{visible:false}`。
- 各ボタンは `describedBy` を `tooltip.id` として持つ（`items[i].describedBy === items[i].tooltip.id`）。実 DOM では `aria-describedby` が説明文の要素の id を指し、その要素は `role="tooltip"`。
- `app.setLang` の直後（再読み込みなし）に `items[i].tooltip.text` と、表示中なら `getTooltip().text` が切替後の言語になる。`getStrings()` の `tooltip.<command>` キーは ja・en で同一集合（FR-008 AC-017〜019 と同じ）。
- `web/index.html`（または `web/src/ui.js`）は `role="tooltip"` を使い、`aria-describedby` を設定する。

## 見た目の資産（NFR-UX-001 AC-057 / AC-061）
- `web/styles/tokens.css` に `:root`（ライト）と `:root[data-theme="dark"]` で `--color-bg` `--color-surface` `--color-focus` `--font-sans` を定義する。`:focus-visible` の規則は `outline: <2px 以上> solid var(--color-focus)` で、`--color-focus` は両テーマで `--color-bg`・`--color-surface` に対し 3:1 以上。
- `--font-sans` は先頭が `Segoe UI`・`system-ui`・`-apple-system`・`BlinkMacSystemFont` のいずれかで、`Segoe UI` を含む。`@font-face` の url・`@import` の外部・外部 URL の `href/src` を `web/` に置かない。

## 音声認識の日本語対応（FR-001 AC-040 / AC-066〜069、NFR-PRIV-001 AC-034、追記。processLocally が真なら従来どおり＝後方互換）
- SpeechSource の任意項目（省略時は括弧内の既定）: `supported:boolean`（SpeechRecognition API の有無。既定 true）、`availabilityFor(lang)->'local'|'downloadable'|'remote'|'unsupported'`（その言語（`'ja-JP'|'en-US'`）だけの判定。既定は `processLocally ? 'local' : 'remote'`。呼ぶたびに現在値を見る）、`install({lang}) -> Promise<{ok:boolean}>`（`downloadable` の言語モデルの導入＝SR.install）。判定は選択中の言語（`lang`→`ja-JP`/`en-US`）だけで行い、他の言語の `availabilityFor` に左右されない。
- `start(opts)` の `opts` は `{lang}` に加え、デバイス内で開始するとき `processLocally:true` を持つ。同意による外部送信可の開始では `opts` に `processLocally` キーを**持たない**（実装は rec.processLocally を設定しない）。
- `app.startSpeech()` → `{ok:boolean, reason?:'api_missing'|'language_unsupported'|'model_missing'|'consent_required'|'mic_denied'}` を返す。`downloadable` のときだけ `Promise<同じ形>`（テストは常に `await`）。それ以外は同期。`ok:false` では `start` を呼ばず、`getState().message` に理由別の文言（表示言語、理由ごとに異なる）を出す。
  - `supported===false` → `api_missing`。`unsupported` → `language_unsupported`。
  - `local` → 同意不要で `start({lang, processLocally:true})`。
  - `downloadable` → `install({lang})` を待ち、`ok` なら `start({lang, processLocally:true})`（導入が完了する前は `start` しない）。失敗は `model_missing`（`start` しない）。
  - `remote` → 同意がなければ `consent_required`（`start` しない）。同意があれば `start({lang})`（processLocally キーなし）。
- 同意: `app.setSpeechConsent(bool)` / `app.getSpeechConsent()`（既定 false）。`setSpeechConsent(false)` は記録中の認識を `speechSource.stop()` で止める。同意はそのページ利用中（メモリ内）だけ有効で**保存しない**（再読込＝同じ storage での再生成後は未同意）。`availabilityFor` が例外を投げる・未知の値を返す（判定不能）ときは `remote` と同じ（同意なしでは `consent_required`）。音声・認識結果（`onresult` の余分な項目を含む）は保存に含めない。
- `app.getSpeechStatus()` → `{ state:'local'|'consent'|'unavailable', reason:null|'api'|'language'|'model'|'consent'|'mic', startEnabled:boolean, alternative:boolean, text:string }`。
  - `local`（`availability` が `local`／`downloadable`）: `text` は「使えます（デバイス内）」を含む（en は ja と異なる非空）。`startEnabled:true`。
  - `consent`（`remote` で API あり）: `text` は「使えます（要同意・外部送信の可能性）」を含む。未同意は `reason:'consent'`・`startEnabled:false`、同意後は `reason:null`・`startEnabled:true`。
  - `unavailable`: `text` は「使えません」を含み、`reason` は `api`（API 非対応）/`language`（言語未対応）/`model`（導入失敗後）/`mic`（マイク拒否。`speechSource.onerror({code:'not-allowed'})` か `'service-not-allowed'` で）。`startEnabled:false`、`alternative:true`（手入力 FR-002 への誘導を表示）。理由ごとに `text`・メッセージは異なる。表示言語に合わせる。
  - 3 状態の `text` は互いに異なる。`app.setLang` で選択言語が変わると判定をやり直す。
- 同意 UI: `app.getConsentUi()` → `{ visible:boolean, role:'switch'|'checkbox', checked:boolean, tabbable:true, label:string, notice:string, stateText:string, colorOnly:false }`。`visible` は `consent` 状態のとき真。`notice` は `app.t('speech.consent.notice')` と同じ（音声が外部の音声認識サービスへ送られる可能性。ja は「外部」を含み、en は `external` を含む。ja と en で異なる）。`stateText` は同意状態を文字で示す（色だけにしない。同意済み／未同意で異なる）。`checked` は `getSpeechConsent()` と一致。
- キーボード: コマンド `speech.consent`（`app.commands['speech.consent']()` で同意を切り替える）を `keymap` に持ち、`handleKey` で実行できる。
- `web/index.html` に同意の操作要素 `id="speech-consent"`（`<input type="checkbox">` か `role="switch"`/`checkbox`）。ネイティブ入力でなければ `aria-checked` と `tabindex="0"`。名前（`<label for>` か `aria-label`）と説明（`aria-describedby`）を持つ。正の `tabindex` は不可。
- `onend()` の自動再開（NFR-BG-001 AC-064）の条件を次に改める: `session==='recording'` かつ（`availabilityFor`＝`local`、または `remote` かつ同意済み）のときだけ `start`（同意による再開は `processLocally` キーなし）。未同意の `remote`、`unsupported`、停止・一時停止後は再開しない。
- 外部通信（NFR-OFFLINE-001 AC-031）: 同意による外部送信可の認識を使っても、アプリ自身は `fetch`/`XMLHttpRequest`/`WebSocket`/`EventSource`/`sendBeacon` を呼ばない（ブラウザの認識通信は含めない）。

## 図の演出（FR-015 AC-074 / AC-076、追記）
- `app.getDiagramStyle()` → `{ scenes:[{ id, heading:{fontSize:number, fontWeight:number, framed:boolean}, points:[{ id, kind:string, color:string, shape:string, icon:string, fontSize:number, fontWeight:number }] }] }`。見出しは `fontSize` が要点より大きく `fontWeight` が要点より大きい、または `framed:true`（囲み・色帯）。`kind` は要点の種類（結論・課題・アイデア・補足など）。種類が異なる要点は、`color` が異なり、かつ `shape` か `icon` のどちらかも異なる（白黒でも見分けられる）。テストの入力は課題の語（「困った」）と決定の語（「決める」）を含む。
- 強調: `app.highlightPoint(pointId, source)`（`source` は `'pointer'|'keyboard'`）、`app.clearHighlight()`、`app.getHighlight()` → `null | { pointId, relations:[{from,to}]（その要点とつながる関係線）, point:{strokeWidth:number, framed:boolean, icon:string, color:string}, others:{strokeWidth:number, framed:boolean, color:string}, textLegible:boolean }`。キーボード: コマンド `highlight.next` `highlight.prev` `highlight.clear` を `keymap` に持つ（`handleKey` で実行）。強調中も `renderSvg()` は全要点の文字列を `<text>` に含む。

## 意味のある配置による 2D 整理（FR-016 AC-078〜081、追記）
- `app.setDisplayMode('timeline'|'arrange')` / `app.getDisplayMode()`（既定 `'timeline'`）。
- `app.getArrangement()` → `{ mode, presets:[{id,label}], axes:{ vertical:{name, sections:[{id,label}]}, horizontal:{name, sections:[{id,label}]} }, unclassified:{label:string}, assignments:[{ objectId, kind:'point'|'scene', v:sectionId|null, h:sectionId|null, unclassified:boolean, position:{x,y} }] }`。既定の組 `presets` に `id:'logical-physical_workflow'`（縦軸「論理層→物理層」、横軸「ワークフロー／部署のステップ」）を含み、`app.setArrangePreset(id)` で選ぶ。各軸の `sections` は 2 件以上で `label` は非空。`app.setAxis('vertical'|'horizontal', {name, sections:[label,...]})` で編集（`ok` を返す）。
- `app.assignObject(objectId, {v, h})` → `{ok}`（区分 ID。`null` で未分類）。`app.describeObject(objectId)` → `{ vertical:label|null, horizontal:label|null, text:string }`（位置の理由。未分類は `text` が `unclassified.label` を含む）。割り当てのない要点は `unclassified:true`。
- 整理の表示の `renderSvg()` は、両軸の名前・各区分の `label`・未分類の領域の `label` を `<text>` に含む。
- ドラッグなしの移動: `app.arrangeCommand(objectId, 'section-up'|'section-down'|'section-left'|'section-right')`（隣の区分へ。`ok`）。コマンド `arrange.up` `arrange.down` `arrange.left` `arrange.right`（選択中の要点を対象）を `keymap` に持つ。手動の割り当ては以後の自動処理（新しい発話の取込）で変わらない。

## パネルのタイル配置とフォーカス（FR-017 AC-083〜086、追記）
- `app.getLayout()` に `workArea:{w,h}`、`kind:'tile'|'focus'|'maximized'`（現在のレイアウトの種類。表示用）、`mainPanel:string|null` を加える。表示中（`visible`）のパネルの矩形 `{x,y,w,h}` は区切り線を含めた領域で、互いに重ならず、作業領域（原点 0,0）を隙間なく埋める（面積の合計が `w*h` に等しい）。既定のレイアウトとタイル配置の直後、表示/非表示の変更の直後に成り立つ。
- `app.layoutCommand('tile')`＝タイル配置に整列、`app.layoutCommand('focus', panelId)`＝フォーカス（メインに指定）、`app.layoutCommand('maximize', panelId)`＝最大化。コマンド `layout.tile` `layout.focus` `layout.maximize` を `keymap` に持つ（`layout.focus` は現在のメインか、未指定なら `diagram`）。`app.searchCommands(query)` → `[{command,label}]`（コマンドの検索。表示言語の `label` の部分一致）。
- フォーカスではメインの面積が作業領域の 75%（PARAM-009）、ほかの表示中のパネルは残りを均等な面積で分ける。1 パネルだけ表示なら全領域。
- ドラッグなしの移動は `panelCommand`（FR-011）。

## コマンドバーの常時ラベル（NFR-UX-003 AC-090・091、追記）
- `getCommandBar().items` に `data.reset`（データの初期化）・`file.save`（ファイルに保存）・`file.load`（ファイルから読込）を加える。各 `items[i]` は `label`（アイコンの下に常に表示する短い文字。非空、ボタンごとに異なる）、`labelVisible:true`（ホバー・フォーカス不要）、`accessibleName`（ボタンのアクセシブルな名前。`label` と一致）、`tooltip`（NFR-UX-002 のまま）を持つ。
- `app.getCommandBarLayout({viewportWidth})` → `{ items:[{command, labelLines:number}], scrollsHorizontally:boolean }`（`viewportWidth` 省略時は `env.viewportWidth`）。
- ラベルの長さは全角 1・半角 0.5 と数え、PARAM-011（6）以内。表示言語の切替は再生成なしで `label`・`accessibleName` に反映される。

## データの初期化（FR-018 AC-093〜096、追記）
- `app.commands['data.reset']()` → `{ok:true, pending:true}`。確認を開くだけで、データは変えない。`app.getDialog()` → `null | { kind:'reset'|'load-replace', text:string, buttons:[{id:'confirm'|'cancel', label:string}], defaultFocus:'cancel', keyboard:true }`（`reset` の `text` は、消える内容と元に戻せない旨を含む。`confirm` の `label` は ja「初期化する」、`cancel` は「キャンセル」）。
- `app.dialogAction('confirm'|'cancel')`（`load-replace` の confirm は Promise。常に `await`）。`app.handleKey({key:'Escape'})` は開いている確認を `cancel` と同じに閉じる（返り値 `'dialog.cancel'`）。確認が開いている間は、状態は何も変わらない。
- 手修正: `app.editPoint(pointId, text)` → `{ok}`、`app.getManualEdits()` → `[{pointId, text}]`。
- 初期化の結果: `utterances=[]`、`scenes=[]`、`selectedSceneId=null`、`session:'preparing'`、`viewMode:'2d'`、`getDisplayMode()==='timeline'`、`getArrangement().assignments=[]`、`getAxes3D().axes` は既定、`getManualEdits()=[]`。記録中の認識は `speechSource.stop()` で止める。`getState().message`（`{key,text}`）に結果を示し、`getCommandBar().status.role==='status'`。`grp.session` は空の内容か無し、`grp.layout`・`lang`・`getLayout()` は不変。

## セッションファイル（FR-019 AC-097〜102、追記）
- `await app.commands['file.save']()` → `{ok, reason?:'empty'}`。成功で `options.download({filename, mime:'application/json', data:string})` を 1 回。シーンも発話もない場合は `ok:false`、`reason:'empty'`、download を呼ばず `message` に理由。`data` は音声（`audio` を名前に持つ項目、バイナリ）を含まない JSON 文字列。
- `await app.loadSessionFile({name,type,size,text})` → データなしなら `{ok:true}` で読込。現在のデータがあれば `{ok:false, pending:true}` で `getDialog().kind==='load-replace'` を開く（`await app.dialogAction('confirm')` で置換し `{ok:true}`、`cancel` で不変）。不正は `{ok:false, reason:string}`（`message` に理由）で状態不変。`.txt` は受け付けず、`importTextFile` はセッションファイルを受け付けない。
- 読込の復元: 発話・シーン・要点・手修正・整理の割り当て（と軸）・`viewMode`・`getDisplayMode()`・`getAxes3D().axes`・`selectedSceneId`。復元後の `session` は `paused`。`renderSvg()`・`renderOutline()` は保存時と同一。完了・失敗は `getState().message` で示す。
- キーボード: コマンド `file.save`・`file.load` を `keymap` に持つ。`app.searchCommands(label)` で見つかる。

## 3D の評価軸（FR-020 AC-103・104・106、追記）
- `app.getAxes3D()` → `{ axes:{x,y,z}（候補 ID）, candidates:[{id, label, available:boolean, reason:string|null}] }`。候補 ID は `time`・`pointCount`・`utterances`・`emotion`・`arrangeV`・`arrangeH` と、要点の種類ごとの数（`kindCount` で始まる ID が 1 件以上）。既定は `{x:'pointCount', y:'emotion', z:'time'}`。値が得られない候補は `available:false` で `reason` が非空。
- `app.setAxis3D('x'|'y'|'z', id)` → `{ok, reason?}`。同じ候補を 2 方向に選ぶ・`available:false` の候補は `ok:false`（不変）。記録中も変更できる。
- `get3D().nodes[i].position` は選んだ軸の値の順序・数値に従う（値が大きいほど大きい座標。同値は同座標軸値。3 軸の組が同じシーンでも位置は重ならない）。
- 軸の選択は `grp.session` に含めない（再読込で既定）。

## 3D の画面操作と操作説明（FR-021 AC-108・109、追記）
- `app.getViewpoint()` → `{azimuth, elevation, distance, panX, panY}`。`app.viewControl(op, source)`（`op`: `rotate-left|rotate-right|rotate-up|rotate-down|zoom-in|zoom-out|pan-left|pan-right|pan-up|pan-down|reset`、`source`: `'pointer'|'keyboard'`）→ `{ok}`。3D 表示でないときは `ok:false`。`op` のコマンド `view.<op>` を `keymap` に持つ（`handleKey` は `source:'keyboard'` 相当）。`reset` は初期の視点に戻す。操作はシーンの選択・軸の選択を変えない。
- `app.getViewControls()` → `{ visible:boolean, role:string, region:'bottom', wrap:'wrap'|'collapsible', hidesOthers:boolean, operations:[{id:'rotate'|'zoom'|'pan'|'reset', mouse:string, touch:string, keyboard:string}] }`。`viewMode==='3d'` かつ WebGL ありのときだけ `visible:true`。幅が PARAM-006 以下でも `visible` のまま `hidesOthers:false`。

## 取込の処理中表示と再取込（FR-023 AC-118〜122、追記）
- `options.importYield`（省略可、`() => Promise`）: 取込は 50 cue（行）処理するごとに `await options.importYield()` を 1 回呼ぶ（省略時は即時に解決）。テストはこれで処理の途中を観測する。
- `app.getImportStatus()` → `{ state:'idle'|'processing'|'done'|'failed', label:string, processed:number, total:number, added:number|null, reason:string|null, nextAction:string|null, text:string, role:'status'|'alert', live:'polite'|'assertive', inputReset:boolean }`。
  - `importTextFile` を呼んだ同期の時点で `state:'processing'`、`total`＝cue（.txt は空でない行）数、`processed` は処理済みの数（0 以上 total 以下、単調増加）。完了で `done`（`added` 件数、`text` に件数）、失敗で `failed`（`reason`、`nextAction` は空でない文字列、`text` に原因と次の操作）。完了・失敗で `processing` ではなくなる。
  - `label` は文字による状態名（ja: `処理中`・`完了`・`失敗`）。`text` は `label` を含む（色だけで示さない）。
  - `done`・`failed` の後は `inputReset:true`（ファイル入力の選択値を空に戻し、同じファイルの再選択が通る）。
- 実 DOM: `web/index.html` に `id="import-status"` の要素（`role="status"` か `role="alert"`、`aria-live` あり）と、`id="import-file"` の `<input type="file">`（名前を持ち、正の `tabindex` なし）。コマンド `file.import`（`keymap` と `searchCommands` にあり、ファイル選択を開く）。

## オブジェクト選択のポップアップ（FR-024 AC-123〜125、追記）
- `app.getScenePopup()` → `null | { open:true, sceneId, heading, points:[{id,text}], html:string, role:'dialog'|'region'|'tooltip', label:string, focused:boolean, placement:{x,y,w,h,maxHeight:number, scrollable:boolean} }`。`selectScene(id)`（2D・3D とも、存在するシーン id）で開く。存在しない id・`null` では開かず、`null` は選択も解除する（選択の解除でポップアップは閉じる）。
- `heading`・`points` は `getState().scenes` のそのシーンと同じで、`html` に含まれる。
- コマンド（`keymap` に割り当てあり）: `scene.next` `scene.prev`（選択を移す）、`popup.open`、`popup.focusContent`（内容へ移る。`focused:true`）、`popup.close`。`handleKey({key:'Escape'})` は開いていれば `'popup.close'` を返して閉じる。`app.popupOutside()` は外側の操作で閉じる。閉じても `selectedSceneId`・draft・`getLayout()`・`getDisplayMode()`・`renderSvg()` は変わらない。
- ドラッグを要する操作はない。`html` に `draggable` を含めない。

## 図の詳細度（FR-026 AC-130・131・133・009・010・078〜082・089・094・123、FR-025 AC-128・137、追記）
詳細度は 3 段階 `'major'`（大項目）・`'middle'`（中項目）・`'detail'`（詳細）。**起動時の既定は `'major'`**（保存された設定がないとき）。既存の System Test（AC-009・010・078〜081・094・123）は要点・関係線・絵記号を図で確かめるため、各テストの冒頭で必ず `app.setDetailLevel('detail')` で「詳細」へ切り替える（`helpers.js` の `toDetail(app)`）。同じく冒頭で `toDetail(app)` を呼ぶ既存テスト: axes3d.test.js「FR-020 AC-103」、background.test.js「NFR-BG-001 AC-063」、decoration.test.js「FR-015 AC-076」（ポインタ）、export.test.js「FR-007 AC-015 補助」、importstatus.test.js「FR-023 AC-122」（反映）、rightpanel.test.js「FR-014 AC-054」（手入力・取込の 2 件）。大項目・中項目での図は AC-130・131・137 のテスト（`detail.test.js`）が確かめる。
- `app.getDetailLevel()` → `'major'|'middle'|'detail'`。`app.setDetailLevel(level)` → `{ok}`（不正な値は `ok:false` で不変）。端末ごとの設定として `grp.detail`（保存キー。値は level 文字列）に保存し、`createApp` が復元する（再読込後も保たれる）。セッションファイル（`file.save` の `data`）には含まれず、`file.load`・`data.reset`・`clearSavedSession` でも変わらない。変更しても発話・シーン・要点・手修正・割り当て・`selectedSceneId`・`getState().session`・draft・`getDisplayMode()` は不変。記録中（発話の追加中）でも変更でき、直後の発話も受け付ける。
- `app.getDetailInfo()` → `{ level, label, options:[{level,label,current:boolean}] }`（現在の詳細度の表示。`label` は表示言語で、全角 1・半角 0.5 と数えて PARAM-011（6）以内。ja は「大項目」「中項目」「詳細」）。
- コマンド（すべて `keymap` に割り当てを持ち、`app.searchCommands(label)` で見つかる）: `detail.major` `detail.middle` `detail.detail`、および 1 段階ずつ切り替える `detail.next`。実行すると `getState().message.text` に変更の結果（新しい詳細度の `label` を含む）が出て、`getCommandBar().status.role==='status'`。
- `app.getTopics()` → `[{ id, title, sceneIds:[sceneId], pointIds:[pointId] }]`（FR-025、時系列順）。すべてのシーンはちょうど 1 つのトピックに属し、トピック数はシーン数以下。シーンが 1 つだけのトピックの `title` はそのシーンの見出し。
- `renderSvg()`（2D）:
  - `'major'`: トピックごとに `<g data-topic-id="<id>">` があり `title` を `<text>` に含む。トピック間の関係は `<line>`／`<path>` で `data-topic-relation`。**要点の文字列・シーンの見出し（トピックの題名と同じ場合を除く）は含まない**。`data-scene-id` を持つ要素は無い。
  - `'middle'`: `'major'` に加え、各トピックの下に属するシーンの見出しを `<text>`（`data-scene-id` 付き）で含む。要点は含まない。
  - `'detail'`: 従来どおり（見出し・要点・関係線・絵記号）。
  - どの詳細度でも `renderOutline()`（テキスト一覧）は全シーンの見出し・全要点を時系列順で含み、3D（`get3D()`）・ポップアップ（`getScenePopup()`）は詳細度の影響を受けない。
- 2D の図での選択: `app.selectTopic(topicId)` → `{ok}`（存在しない id は `ok:false` で不変）。2D・`'major'` で開く `getScenePopup()` は、`{ open:true, topicId, title, scenes:[{id,heading,points:[{id,text}]}], html }`（トピックの題名・属するシーンの見出し・要点を `html` に含む。`role`・`label`・`placement` は従来のポップアップと同じ）。閉じ方・選択の保持は AC-124 のとおり。`selectScene(id)` は `'detail'`・`'middle'`・3D で従来どおりシーンのポップアップを開く。
- 整理の表示（`getDisplayMode()==='arrange'`）: `getArrangement().assignments` に、`'major'`/`'middle'` で図に描かれる単位が `{ objectId: topicId|sceneId, kind:'topic'|'scene', v, h, unclassified, position, breakdown:[{v,h,count}] }` として加わる（要点の割り当てを集計。`v`・`h` は属する要点の割り当てのうち最も多い区分で、同数のときは区分の並び順で先のもの）。`describeObject(topicId|sceneId)` の `text` に置かれた区分のラベルと、`breakdown` の内訳（区分ラベルと件数）が文字で含まれる。軸の名前・各区分の見出し・未分類の領域の `label` は、どの詳細度でも `renderSvg()` の `<text>` にある。要点の移動（`assignObject`・`arrangeCommand`）は `'detail'` で行い、その後 `'major'`/`'middle'` に切り替えると位置に反映される。
- 画面の読み上げ: 変更結果は `getState().message`、図の `label`（`app.getStrings()` の ja・en）に新しいキーが両言語で存在する。

## レイアウト型・描画スタイル・設定画面（FR-027〜030・034・036 の System Test、追記。AC-139・140・145・146・149・151・152・167）
- 型 ID は `'timeline'`（タイムライン）・`'bubble'`（吹き出し）・`'diverge'`（発散）・`'zone'`（区画）・`'metaphor'`（比喩テンプレート）。描画スタイル ID は `'anime'`・`'handwritten'`・`'simple'`・`'rpg'`（RPG風。FR-047）。
- `app.getLayoutInfo()` → `{ selected:[typeId]（選んだ順。1 件以上）, head:typeId（先頭＝配置を決める型。selected[0]）, manual:boolean, source:'manual'|'auto'|'fixed', applied:boolean（2D の時系列の表示で true。整理の表示で false）}`。型の決まり方: 手動（`manual:true`）＞ 設定の既定のレイアウト（`mode:'auto'` なら自動選択の結果で `source:'auto'`、`'fixed'` ならその型で `source:'fixed'`）。初期値は `source:'fixed'`、`selected:['timeline']`、`manual:false`。
- 手動選択: `app.setLayoutTypes(ids)` → `{ok, reason?}`（`ids` は選んだ順。空・未知の ID・重複は `ok:false` で不変）。`app.toggleLayoutType(id)` → `{ok, reason?}`（未選択なら末尾に加える＝併用、選択中なら外す。最後の 1 つは外せず `ok:false` で不変）。`app.clearManualLayout()` → `{ok}`（`manual:false` に戻り、設定の既定に従う）。手動で選ぶと `manual:true`・`source:'manual'`。手動の選択は発話・シーンが増えても自動では変わらない。現在値は `file.save` の `data` に含まれ `loadSessionFile` で復元される。`grp.*` のブラウザ内保存には含まれず、再読込（同じ `storage` で `createApp`）後は設定の既定になる。変更しても発話・シーン・要点・`selectedSceneId`・`getState().session`・`getDetailLevel()`・`viewMode`・`get3D()`・`renderOutline()`・`getScenePopup()` は不変。
- コマンド（すべて `keymap` に割り当てを持ち、`searchCommands(label)` で見つかる）: `layoutType.<typeId>`（その型だけを手動で選ぶ。`setLayoutTypes([id])` 相当）、`layoutType.add.<typeId>`（`toggleLayoutType` 相当）、`layoutType.clear`（`clearManualLayout` 相当）。実行すると `getState().message.text` に結果（型の `label`）が出る。
- `getCommandBar().items` に `command:'layoutType.<typeId>'` の 5 件を加える。`label`（名称。全角 1・半角 0.5 と数えて PARAM-011（6）以内、ボタンごとに異なる）、`tooltip:{id,text}`・`describedBy`（NFR-UX-002 と同じ）、`selected:boolean`（`getLayoutInfo().selected` に含まれるとき true）、`selectedMark:string|null`（選択中は色以外の手がかりを表す非空の文字列（例: `'check'`・`'frame'`）、非選択は `null`）、`pressed:boolean`（`aria-pressed` 相当。`selected` と一致）。位置は上部（`getCommandBar().position==='top'`）。
- `app.getDiagramLayout()` → 2D・時系列の表示の配置。`{ type:typeId（head）, types:[typeId], canvas:{w,h}, title:{x,y,w,h,visible:boolean}, body:{x,y,w,h}, units:[{id, kind:'topic'|'scene', order:number（0 始まり。話順）, x,y,w,h}], arrows:[{from:unitId,to:unitId,label:string|null}], orderMark:'arrow'|'number'|'both', groups:[{id, kind:'topic'|'zone'|'enclosure', heading:string（非空）, frame:{x,y,w,h}, headingRect:{x,y,w,h}}], centered:boolean }`。`units` は詳細度が「大項目」なら各トピック、それ以外は各シーン。`groups` は各まとまり（トピック・区画・囲み）。`renderSvg()` は同じ内容を `<g data-group-id="<id>" data-group-kind="...">`（中に `<text data-role="subheading">` と `<rect|path data-role="frame">`）、`<g data-unit-id="<id>" data-order="<n>">`、矢印は `<line|path data-flow-from data-flow-to>` で持ち、ルートの `<svg>` は `data-layout-types="<ids を空白区切り>"`・`data-layout-head`・`data-draw-style` を持つ。整理の表示では `data-layout-head` を持たない。
- 配置の幾何: すべての矩形は `canvas` の内側。`title` は左上（`title.x` と `title.y` が `units`・`groups` のどれより小さいか等しく、`title` は `body` と重ならない）、`units`・`groups` の枠は `body` の内側で `title` と重ならない（`centered:false` のとき）。`title.visible` はタイトル情報（`app.setTitleInfo({series,theme,date,venue})`、未入力の項目は表示されない）に 1 項目でも入力があるとき true。
- タイムライン型（AC-152）: `units` を `order` 順に並べると、`y` が単調非減少の行に分かれ、行ごとに `x` が単調（左→右の Z 字、または行ごとに向きが入れ替わる S 字）で、先頭の `units[0]` が最も左上、末尾が最も右下の行にある。`orderMark` が `'arrow'`・`'both'` なら隣り合う `units` を結ぶ矢印（`arrows`）が `units.length-1` 本、`'number'`・`'both'` なら各 `unit` の `<g data-order>` の中に順序の番号の `<text>` がある。
- 区画型の `groups` は `kind:'zone'`、タイムライン・吹き出し型は `kind:'topic'`（または囲み `'enclosure'`）、比喩テンプレート型は `kind:'zone'` か `'enclosure'`。`renderOutline()` は各 `groups[i].heading` を文字で含む。
- 自動選択の入力（AC-143 の規則。テストが使う入力）: 空白区切りの語を 2 語以上共有するシーンが同じトピック（PARAM-015）。トピック数が 2〜4 で各トピックのシーンが連続→区画、発話に「ビジョン」「ゴール」「道のり」「ロードマップ」（vision・goal・roadmap・journey）→比喩テンプレート、順序の語（「まず」「次に」「それから」「最後に」、first・then・next・finally）→タイムライン、どれにも当たらない→発散のみ。優先順位は比喩テンプレート＞区画＞順序の語のタイムライン＞発散。複数に当たると当たった型がすべて `selected` に入り、優先順位の高い順に並ぶ（先頭＝`head`）。
- `app.getDrawStyles()` → `[{id,label}]`（4 件。`rpg` の `label` は「RPG」を含む）、`app.getDrawStyle()` → id、`app.setDrawStyle(id)` → `{ok}`（未知の ID・非文字列は `ok:false` で不変）。初期値は `'handwritten'`。`renderSvg()` のルート `data-draw-style` に現在のスタイル。スタイルを変えても `renderSvg()` の `<text>` の文字列の集合・`getDiagramLayout()`・`renderOutline()`・発話・シーン・`selectedSceneId`・`getState().session` は不変で、`renderSvg()` の文字列は変わる。`getDiagramStyle()` の `kind` ごとの区別（色＋形か絵記号）はどのスタイルでも成り立つ。

## RPG風の描画スタイル（FR-047〜051 の System Test、追記。AC-214・217・219・221・223・224・225・226。AC-146 は 4 択に更新）
- 前提: `app.setDrawStyle('rpg')` で選ぶ。ほかのスタイルのとき `app.getRpgMap()` は `null`。`app.setRpgFocus(bool)` は地図へのフォーカスの有無（既定 `false`）。`renderSvg()` のルートに `data-draw-style="rpg"`・`data-rpg-tile="16"`（PARAM-053）。図に使われる色（`#rrggbb`／`#rgb`）は 16 色以下（PARAM-054）。勇者は `data-rpg-hero`（`data-dir`・`data-frame`）、住人は `data-rpg-resident`（`data-kind`）の要素で描く。
- `app.getRpgMap()` → `{ tile:16, colors:[css 色]（16 件以下）, cols, rows, cells:[{x,y,type:'floor'|'road'|'wall'|'water'|'building',area:'field'|'town'|'castle'}]（cols×rows 件の全マス。`wall`・`water`・`building` が通れない。範囲外のマスは `cells` にない）, places:[{id,kind:'town'|'castle'|'spot',refId,x,y}]（トピック=town/castle、要点=spot で詳細度「詳細」の要点と同数）, roads:[{from,to}]（`places[].id` を結ぶ。関係線）, hero:{x,y,dir:'up'|'down'|'left'|'right',frame:number}, residents:[{id,kind:'villager'|'soldier',x,y,refId}]（街・城の `area` のマスにいる。`refId` は対応するシーンまたは要点の id）}`。同じ入力からは毎回同じ。
- 操作: `app.rpgPress('up'|'down'|'left'|'right'|'a'|'b')` → `{ok}`（未知の名前は `ok:false` で不変）。キー（`handleKey`）は `setRpgFocus(true)` かつ RPG風で、ポップアップ・ダイアログ（設定・初期化確認・シーンのポップアップなど）が開いておらず `inTextInput` が偽のときだけ、矢印・W/A/S/D → `'rpg.up'|'rpg.down'|'rpg.left'|'rpg.right'`、Z・Enter → `'rpg.a'`、X・Esc → `'rpg.b'` を返して実行する（大小文字を区別しない）。`handleKey({key, inTextInput:true})` はテキスト入力欄にフォーカスがある状態で、RPG の操作は実行しない。ダイアログが開いている間の Esc は既存の動作（例: `'settings.close'`）。十字キーは 1 押下で 1 マス。通れないマス・範囲外へは `hero.x/y` が不変（向き `dir` は押した向きになる）。連続して移動すると `hero.frame` が切り替わる。
- 仮想パッド: `app.getRpgPad()` → `{buttons:[{id:'up'|'down'|'left'|'right'|'a'|'b',label,width,height}]}`（px。PARAM-032 の 44 以上）。`rpgPress` はキーと同じ結果になる。
- コマンドウィンドウ: `app.getRpgDialog()` → `null | { open:true, theme:{bg:'#000000',frame:'#ffffff'}, sentences:[string], index, shown:string }`。向いている先のマスに住人がいるとき A で開き、`sentences` は対応するシーンなら `[見出し, ...要点の text]`、要点なら `[その要点の text]`。`shown` は開いた直後 `''` で、`scheduler.setTimeout` により 50 ms（PARAM-030）ごとに 1 文字増える。A で次の文（`index+1`、`shown` は `''`）、最後の文で A または B で `null`。閉じた後は文字が増えない。住人のいない向きの A は何も開かない。
- 音響: `app.getRpgAudio()` → `{started, volume(0〜100, 初期 50 = PARAM-031), muted, audible(=started && !muted && volume>0), bgm:null|'field'|'town'|'castle'}`。`started` は RPG風での最初の操作（`rpgPress`・RPG のキー）の後に真。それまで `bgm` は `null`。`bgm` は勇者のいるマスの `area` と同じで、移動して `area` が変わると切り替わる。RPG風でないときの操作は `started` を変えない。`app.setRpgVolume(n)`（0〜100 の数のみ）・`app.setRpgMuted(bool)`（真偽のみ）→ `{ok}`、不正値は `ok:false` で不変。ミュートの解除で音量は保たれる。
- テキスト一覧: RPG風でも `renderOutline()` は他のスタイルと同一で、`renderSvg()` の `<text>` も同じ文字の集合。- 設定画面: `app.getSettings()` → `{ layout:{mode:'auto'|'fixed', types:[typeId]（固定のときの型。1 件以上）}, drawStyle:styleId }`（初期値 `{layout:{mode:'fixed',types:['timeline']},drawStyle:'handwritten'}`）。`app.setSettings(partial)`（`{layout:{mode,types?}}` と `{drawStyle}` の一方または両方）→ `{ok, reason?}`（固定で `types` が空・未知の型・未知のスタイルは `ok:false` で不変）。設定は端末ごとの設定として `grp.settings` に保存し `createApp` が復元する。セッションファイル・`data.reset`・`clearSavedSession` では変わらない。変更しても発話・シーン・要点・`selectedSceneId`・`input.draft`・`session` は不変で、結果は `getState().message`（型・スタイルの `label` を含む）と `getCommandBar().status.role==='status'` で示す。
- `app.commands['settings.open']()` / `settings.close` → `app.getSettingsDialog()` → `null | { open:true, role:'dialog', label:string, focused:boolean, fields:[{ id:'layout.mode'|'layout.types'|'drawStyle', label:string（全角 1・半角 0.5 で PARAM-011（6）以内）, value }] }`。`settings.open` を `keymap` に持ち（`handleKey` で開く）、`searchCommands(label)` で見つかり、`getCommandBar().items` にボタン（`label`・`tooltip`）がある。`handleKey({key:'Escape'})` で閉じる（返り値 `'settings.close'`）。`app.getSettingsView({viewportWidth})` → `{ fields:[{id, visible:boolean}], scrollsHorizontally:boolean }`（画面が狭くても `fields` が欠けず全件 `visible:true`）。実 DOM: `web/index.html` に `id="settings-dialog"`（`role="dialog"` かラベルつきの `<dialog>`）。文言キー `settings.*`・`layoutType.*`・`drawStyle.*` は ja と en で同一集合。
