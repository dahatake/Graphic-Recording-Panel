# 契約: 設定できる更新間隔・.vtt の再生取込・ライブ描画ショー・演出の音（FR-014 AC-053・AC-521・AC-522、FR-022 AC-671、FR-115 AC-672〜AC-675、FR-116 AC-676〜AC-679。2026-11-05）

System Test（`live.test.js`・`rightpanel.test.js`・`liveshow.test.js`・`showaudio.test.js`、共通部品 `liveshow-util.js`）が前提にする `web/src/app.js` の観察点。
期待値は要求定義書の受入基準だけから決めており、この契約は「テストが何を呼ぶか」だけを定める（内部構造は自由）。要求定義書にない名前はこの契約で定める（実装役はこれに合わせる）。
PARAM: PARAM-001＝60 秒、PARAM-098＝5 秒、PARAM-099＝60 秒、PARAM-100＝10 秒、PARAM-104＝2 秒、PARAM-182（描線 1200／1 字 80／運ぶ 800／お祝い 1500 ms、合計は更新間隔の 80%）、PARAM-183（1・2・4・8 倍）、PARAM-184（BGM 3 曲以上・BGM の音量 30・効果音の音量 PARAM-031＝50・ダッキング 30%・下げる 300 ms・戻す 1000 ms）、PARAM-164＝3 回、PARAM-011＝6。
`CONTRACT-LIVE-EXPORT.md` の「ライブ更新」の範囲（10〜15 秒・PARAM-001＝15 秒）は、この契約で置き換える。

## 時計
- 更新・再生取込・演出・音の時点は `options.scheduler.setTimeout`／`clearTimeout` と `options.now()` だけで計る（`Date`・`setInterval`・`requestAnimationFrame`・`performance.now` を使わない）。テストの時計（`rearrange-util.js` の `LinkedScheduler`）は、タイマーの発火の時刻に `now()` を合わせる。演出の途中の状態は、テストが時計を 10〜20 ms 刻みで進めて `getLiveShow()` を読んで観測する（読んだ時点の `now()` での状態を返す）。

## 更新間隔（FR-014 AC-521・AC-522・AC-053）
- `app.getLiveInterval()` → `{ sec, min:5, max:60, default:10 }`。`app.setLiveInterval(value)` → `{ ok, reason?:'empty'|'not_integer'|'range' }`（数値、または前後の空白を除いた 10 進の整数の文字列。受け付けないときは値と数え方を変えず、`getState().message.text` に理由）。
- 値が変わった時点（記録中なら変更の時点、記録の前なら記録の開始の時点）から `sec*1000*k` ms の各時点で、前回の更新以降に確定した発話が 1 件以上あるときだけ 1 回描き足す（`getLiveRefresh().count` が 1 増える）。**更新の時点より前に、その間の確定結果の要素は図（`renderSvg()`・`getDiagramElements()`）に加わらない**。描画が始まってから PARAM-104 以内に `renderSvg()`・`renderOutline()` に反映（ショーが ON のときは AC-675 の時間以内）。
- ［設定］: `getSettingsDialog().fields` に `{ id:'live.interval', label（PARAM-011 以内・表示言語）, value, min:5, max:60, step:1 }`。コマンド `settings.liveInterval`（設定画面を開き `focusedField='live.interval'`。`searchCommands(<その label>)` の先頭の候補）。`setSettingsFieldDraft('live.interval', text)` → `handleKey({key:'Enter'})` で `setLiveInterval(text)` と同じ判定で確定。
- 端末ごとの設定（`options.storage`、キーは `grp.` で始める）。セッションファイル（`file.save` の `data`）に含めず（`live`・`interval` の名前の項目を持たない）、`loadSessionFile`・`data.reset`（confirm）で変わらない。

## .vtt の再生取込（FR-022 AC-671）
- `app.getVttImportMode()` → `{ mode:'bulk'|'replay', speed:1|2|4|8, speeds:[1,2,4,8] }`（既定 `bulk`・1）。`app.setVttImportMode({ mode, speed? })` → `{ ok, reason? }`（不正な mode・speed、null は `ok:false` で変えない）。端末ごとの設定として保存し、`createApp` が復元する。
- `mode:'replay'` で `importTextFile(.vtt)` が `ok:true` のとき: 発話は AC-113 の規則で求めた受付時刻の差（最初の cue は 0）を `speed` で割った時間の経過ごとに、確定結果として順に届く（`getState().utterances` に入る）。最初の cue は取込の時点（`scheduler.advance(0)` で届く）。各発話の `receivedAt` は「取込の開始時刻＋cue の受付時刻の差」（速さによらない。一括と同じ）。図はライブと同じく更新間隔ごとにまとめて描き足す（一括のように取込の直後には描かない）。`ok:false` の取込では再生取込を始めない。
- `app.getVttReplay()` → `null`（一度も始めていない）`| { running, paused, done, total, text }`（`text` は進み具合の文字で、`done` と `total` の数字を含む）。終わると `running:false`。
- コマンド `vttReplay.pause`・`vttReplay.resume`・`vttReplay.cancel`。一時停止の間は時間が進んでも届かず、再開すると止めた時点の残りの時間から続く。中止すると残りは届かず、取り込み済みの発話は残る。

## ライブ描画ショー（FR-115 AC-672〜AC-675）
- `app.setLiveShow(on:boolean)` → `{ ok }`（boolean 以外は `ok:false`）。［設定］の `fields` に `{ id:'show.enabled', label, value:boolean }`、`app.setSettingsField(id, value)` → `{ ok, reason? }`（［設定］の項目の値の変更。`show.enabled`・`live.interval`・`showSound.*` で使う）。コマンドバーに `{ command:'show.toggle', label（PARAM-011 以内・表示言語）, accessibleName（label を含む）, pressed:boolean, stateText:'ON'|'OFF', tabbable:true }`。`app.operateBarItem('show.toggle')`・`app.commands['show.toggle']()` で切り替え、`searchCommands(<その label>)` の先頭の候補。既定 OFF、端末ごとの設定（保存・復元。セッションファイル・`data.reset` で変わらない）。
- `app.getLiveShow()` →
  - `on:boolean`、`running:boolean`（演出の途中なら true）、`lastAddedCount:number`（直近の描き足しで加えた要素の数）
  - `items:[{ id, text, phase:'pending'|'stroke'|'write'|'done', stroke:0..1（輪郭の描かれた割合）, shown:string（書き込まれた文字。text の先頭からの部分） }]` … 直近の描き足しの新しい要素を**読み順**に並べたもの。`stroke`（描線）→ `write`（1 字ずつの書き込み）→ `done` の順。文字のない要素は `write` を経なくてよい。同時に `stroke`／`write` にある要素は 1 つ以下。
  - `moves:[{ id（getDiagramElements の id）, phase:'pending'|'carry'|'done', from:{x,y}, to:{x,y}, at:{x,y}（今の位置） }]` … 直近の再配置・詰め直しで運ぶ既存の要素。
  - `overlays:[{ kind:'pen'|'hand'|'confetti'|'sparkle', x, y, targetId, systemColor:boolean }]` … 今、画面に出ている演出の絵。描線の間は `pen`、運ぶ間は `targetId` がその要素の `hand`（または `pen`）、お祝いは `confetti`／`sparkle`（`targetId` はその区画・要点）。演出がないときは `[]`。`renderSvg()` に描くときは `data-show-overlay="<kind>"` を付け、演出が終わったら残さない。
  - `log:[{ type:'stroke'|'appear'|'move'|'decision'|'celebrate', id, at:now() }]` … 起きた出来事（描線の開始・要素が現れた・運ぶ動きの開始・決定事項の追加・お祝いの開始）。
- 演出が終わった後の `renderSvg()`・`renderOutline()`・`getDiagramElements()`・`save.svg` の `data` は OFF のときと同じ。OFF のときは `overlays` は常に `[]`。
- 動きを減らす設定（`options.env.reducedMotion:true`）では、ON でも `overlays` は `[]`、`items` は `stroke`／`write` を経ずに `done`、要素は更新の時点で即時に現れ・移る。`getState().message.text` に `lastAddedCount` の数字を含め、`getCommandBar().status.role==='status'`。
- 強制カラー（`options.env.forcedColors:true`）では、出す `overlays` はすべて `systemColor:true`（出さなくてもよい）。

## 演出の音（FR-116 AC-676〜AC-679）
- 音の合成は `options.audioFactory()`（無ければ `globalThis.AudioContext`）で作る AudioContext だけで行う。テストは偽物を注入して、作られた数、音源（Oscillator・BufferSource・ConstantSource）の `start`、destination までの経路の GainNode の `gain` の積（出力の大きさ）を数える。音量・ミュートは GainNode の `gain`（`value`・`setValueAtTime`・`linearRampToValueAtTime`・`exponentialRampToValueAtTime`・`setTargetAtTime`）か `suspend()`／`close()` で表す。`decodeAudioData`・音のファイル・外部への通信は使わない。`audioFactory` が例外を出す・null を返す端末でも、例外を外に出さずに全機能が動く。
- 利用者の操作は `app.notifyUserGesture()`（`main.js` が pointerdown・keydown で呼ぶ）。**プログラムからの `app.commands[...]()`・`setLiveShow` などの呼び出しは操作とみなさない**。最初の操作の前は `audioFactory` を呼ばない。
- `app.getShowAudio()` → `{ muted（AC-228 のミュートと共通。setRpgMuted）, bgmOn, bgmVolume:0..100, sfxVolume:0..100, track, tracks:[{id,label}], bgmPlaying:boolean, bgmLevel:number（今の BGM の大きさ。ダッキングを含む）, ducked:boolean, sfx:[{ kind:'pen'|'pop'|'whoosh'|'chime'|'sparkle', at:now(), wave, freq, durMs }] }`。`sfx` は鳴らした効果音（鳴らさなかったものは含めない）。出来事と効果音: stroke→pen、appear→pop、move→whoosh、decision→chime、celebrate→sparkle（`at` は `getLiveShow().log` の同じ出来事の `at` と同じ）。5 種類の `wave|freq|durMs` は互いに異なる。
- `app.setShowBgm(on)`・`app.setShowBgmTrack(id)`・`app.setShowBgmVolume(0..100 の整数)`・`app.setShowSfxVolume(0..100 の整数)` → `{ ok, reason? }`（不正は `ok:false` で変えない）。［設定］の `fields` に `showSound.bgmVolume`・`showSound.sfxVolume`（と `showSound.bgm`・`showSound.track`）、ミュートは既存の `sound.muted`。コマンド `settings.showBgmVolume`・`settings.showSfxVolume`（設定画面を開き、その項目にフォーカス。`searchCommands(<その label>)` の先頭の候補）。`setSettingsFieldDraft(id, text)` → `handleKey({key:'Enter'})` で確定。端末ごとの設定（保存・復元。セッションファイル・`data.reset` で変わらない）。
- ダッキング: 音声入力の暫定結果・確定結果が届くと `bgmLevel` を（ダッキングなしの大きさの）30% まで 300 ms で下げ（`ducked:true`）、無音が続くと 1000 ms で戻す。RPG風（`getDrawStyle()==='rpg'`）のときは `bgmPlaying:false`。
- ミュート中は FR-049（`getRpgAudio().audible:false`）・FR-111（`getCinematicState().muted:true`）の音も止まる。
