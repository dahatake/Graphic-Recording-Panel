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
