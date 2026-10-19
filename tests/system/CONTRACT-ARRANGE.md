# System Test 契約: 図の自動再配置と再配置の周期（FR-079・FR-080。AC-435・436・439・440、追記。既存の契約は変えない）

`tests/system/rearrange.test.js`・`tests/system/rearrange-settings.test.js`（共通部品 `tests/system/rearrange-util.js`）が前提にする `web/src/app.js` の公開 API。
期待値は要求定義書の受入基準（AC-435・436・439・440 と、AC-435 が参照する FR-079 の規則 AC-426・428・430・432・434）だけから決めており、この契約は「テストが何を呼ぶか」だけを定める（内部構造は自由）。
既存の契約（`CONTRACT.md`）の options・コマンド・設定画面・ポップアップ・詳細度・レイアウト型はそのまま使う。

## 時計（テスト用の時計の注入。AC-435「検証はテスト用の時計の注入で行う」）
- 再配置の時点（周期・会話の区切り・保留の上限・画面の復帰後の実行）は、`options.scheduler.setTimeout`／`clearTimeout` と `options.now()` だけで計る（`Date`・`setInterval`・`performance.now` を使わない）。
- 周期の起点は `createApp` の時点（起動時）、または周期を変更した時点（`setArrangeInterval` などで値が変わった時点）。周期 `P` 秒（`P>0`）では、起点から `P*1000*k` ms（`k=1,2,…`）の各時点で判定する。テストの時計（`rearrange-util.js` の `LinkedScheduler`）は `scheduler.advance(ms)` でタイマーを発火させ、発火の時刻に `now()` を合わせる。時点ちょうど（`at <= end`）のタイマーは発火する。
- 新しい要素の暫定の位置への表示（PARAM-001＝3 秒以内）は周期を待たない。テストは確定結果の受付から 3000 ms 以内（周期の時点を越えない範囲）で確かめる。

## 再配置の周期（FR-080）
- `app.getArrangeInterval()` → `{ sec:number（0〜300 の整数。PARAM-085）, auto:boolean（sec===0）, text:string（現在の周期の表示。sec===0 のとき ja は「自動（会話の区切り）」を含み、それ以外は秒数の数字を含む。表示言語に従う） }`。保存された設定がない初回の起動では `sec:10`（PARAM-084）。
- `app.setArrangeInterval(value)` → `{ ok:boolean, reason?:'empty'|'not_integer'|'range' }`。`value` は数値、または画面の入力欄の文字列（前後の空白を除いた 10 進の整数表記）。`''`・空白だけ・`null`・`undefined` は `'empty'`、`1.5`・`'1.5'`・`'abc'`・`NaN`・`Infinity` は `'not_integer'`、`-1`・`301` は `'range'`。受け付けないときは周期・数え方を変えず（直前の値が保たれる）、`getState().message.text` に理由（非空）を示す。受け付けたときは `getState().message.text` に新しい周期の `text` を含め、`getCommandBar().status.role==='status'`。
- 端末ごとの設定としてブラウザ内（`options.storage`、キーは `grp.` で始める）に保存し、`createApp` が復元する。セッションファイル（`file.save` の `data`）に含めず、`loadSessionFile` で変わらない。データの初期化（`data.reset` → `dialogAction('confirm')`）・`clearSavedSession()` で変わらない。
- 設定画面（`app.getSettingsDialog().fields`）に `{ id:'arrange.interval', label:string（全角 1・半角 0.5 で PARAM-011（6）以内。表示言語に従う）, value:number（現在の sec）, text:string（`getArrangeInterval().text` と同じ）, min:0, max:300, step:1 }` を持つ。
- キーボード: `app.getSettingsDialog().focusedField`（フォーカスのある項目の id。無ければ `null`）。`app.setSettingsFieldDraft('arrange.interval', text)` は入力欄への打鍵（入力中の文字列）で、`focusedField==='arrange.interval'` のときの `app.handleKey({key:'Enter'})` で `setArrangeInterval(text)` と同じ判定で確定する（返り値 `'settings.arrange.commit'`）。同じく `ArrowUp`／`ArrowDown` は 1 増減する（範囲外になる操作は受け付けず値は変わらない。返り値 `'settings.arrange.step'`）。
- マウス: `app.settingsFieldStep('arrange.interval', +1|-1)`（入力欄の増減ボタンのクリック）→ `{ok, reason?}`。範囲外になる操作は `ok:false`・`reason:'range'` で値は変わらない。
- コマンド: `settings.arrangeInterval`（設定画面を開き、`focusedField` を `'arrange.interval'` にする）を `app.commands` に持ち、`app.searchCommands(q)` で `getSettingsDialog()` の `arrange.interval` の `label` でも、ja「再配置」・en「arrange」の部分一致でも見つかる。文言キー `arrange.*` は `getStrings()` の ja と en で同一集合。

## 図の要素と再配置の状態（FR-079、AC-435・439）
- `app.getDiagramElements()` → 2D・時系列の表示で今の図に描かれている要素の外枠（図の座標。px）: `[{ id:string, kind:'topic'|'scene'|'point'|'subgroup', refIds:[string]（対応するトピック・シーン・要点の id。まとめた要点（AC-429）は複数）, parentId:string|null（親の要素の id。トピックのシーン、シーンの要点、下位のまとまりの要素の親）, topicId:string|null（属するトピックの id。`getTopics()` の id）, readIndex:number（親の中の読み順。0 始まり）, x, y, w, h, provisional:boolean（暫定の位置にある＝まだ再配置されていない） }]`。並びは読み順（深さ優先）。詳細度「詳細」ではシーンと要点の要素を含む。テキスト一覧・3D・ポップアップの位置は含まない。
- 親子（`parentId` をたどった祖先）でない 2 つの要素の外枠は重ならない（AC-430(c)。暫定の位置も同じ）。
- `app.getArrangeStatus()` → `{ count:number（起動からの再配置の回数）, pending:boolean（前の再配置以降に新しい要素が加わり、まだ再配置していない）, lastTransition:null|{ animated:boolean, durationMs:number } }`。`options.env.reducedMotion===true` のとき、再配置の `lastTransition` は `{animated:false, durationMs:0}`。
- 周期による再配置・会話の区切りによる再配置は `getState().message` を変えない（読み上げのメッセージを出さない。AC-440）。

## 図の拡大率と表示位置（2D。AC-439）
- `app.getDiagramView()` → `{ zoom:number, scrollX:number, scrollY:number }`。`app.setDiagramView({zoom, scrollX, scrollY})` → `{ok}`（テストは `zoom:1.5, scrollX:40, scrollY:30` を使う。正の数でない `zoom` は `ok:false` で不変）。再配置の前後で値は変わらない。
