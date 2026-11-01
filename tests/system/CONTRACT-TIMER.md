# FR-097 種類別スタイル・FR-098 議題タイマー・FR-005 履歴と元に戻す・FR-091 進行の段階の契約メモ

台帳に入れる System Test は system レベルの AC-569 だけ（`tests/system/agenda-timer.test.js`）。
ほかの AC（AC-564〜568・570・571・574・575・576・577）は unit / integration のため台帳に入れず、下の観察点を実装役の単体・結合テストが確かめる。
議題の登録・取得は CONTRACT-MEETING.md の `setMeetingContext` / `getMeetingContext`（minutes 省略は PARAM-124 の 10 分で動く）。元に戻すは CONTRACT-REVIEW.md の `undoManualEdit`。

## 議題タイマー（FR-098。新設）
- コマンド（すべて `{ ok, reason? }`。keymap に割り当て、`app.handleKey(keyFor(app, cmd))` がコマンド名を返す）: `timer.start`（議題 0 件は `ok:false` と `reason`。状態は待機のまま）、`timer.pause`、`timer.resume`、`timer.next`（次の議題へ。最後の議題では `ok:false`）。
- `app.getAgendaTimer()` → `{ state:'idle'|'running'|'paused'|'finished', currentName:string|null, remainingSec:number, remainingText:string, nextName:string|null, overtimeSec:number, warning:boolean, expired:boolean, silent:boolean }`。
  - `remainingText` は `mm:ss`（ゼロ埋め。例 `05:00`）。0 以下は `00:00`、`overtimeSec` に超過秒。
  - `nextName` は次の議題の名前。最後の議題は `次の議題なし`。待機のときは `null`。
  - 残りは `options.now()` の差で求める（scheduler の `setTimeout` は表示の更新の契機で、1 秒ごと。`setInterval` は使わない）。`options.visibility` が非表示でも差で求めるためずれない。一時停止中は減らない。
- `app.renderAgendaTimer()` → html 文字列。現在の議題名・`remainingText`・次の議題名を文字で含む。`renderOutline()` にも同じ語で出る。
- 保存・復元: 議題と持ち時間（`minutes`）は `grp.session`・`file.save` に含まれる（AC-568）。タイマーの状態は保存せず、復元後は常に `idle`（AC-569）。切替の時点の記録（AC-571）は保存する。

## 観察点（unit / integration）
- AC-568: `minutes` は 1 以上の整数。省略は 10 分（PARAM-124）で `remainingText` が `10:00`。議題 0 件は `timer.start` が `ok:false`＋理由。再読込で `minutes` が復元される。
- AC-570: 残りが PARAM-125 秒以下で `warning:true`、`renderAgendaTimer()` に文字「まもなく終了」と枠つきの記号（色だけにしない）。0 で `expired:true`、文字「時間切れ」と超過時間。自動では次の議題に進まない。通知音は `options.mute`（ミュート）なら鳴らさない（音の呼び出し 0 件）。`env.reducedMotion` では点滅（アニメーション）せず文字だけ。
- AC-571: 進行中に `timer.next` すると進行中のシーンが確定し（`session.nextScene` と同じ結果）、次の発話から新しいシーン。議題名がシーン見出しの近くに文字で付く。シーン・トピックは議題をまたがない。切替前の要点は省かれない。`getState().utterances`（文字列・`receivedAt`）は切替で変わらない。`getState().agendaBoundaries`（切替で確定したシーンの境の記録。`[{ sceneId, agendaId, at }]`）は保存・復元され、再計算・復元後も同じ発話列＋同じ境から同じトピック分類（AC-127）。

## 種類別スタイル（FR-097）
- `app.setPointKindStyles({ enabled:boolean, assign?:{ conclusion, issue, proposal, idea, undecided, note } })` → `{ ok, reason? }`。値は手書き系スタイル ID（手書き調・黄黒手書き風・黒板風・付箋ボード風・色鉛筆風・クラフト紙風。`getDrawStyleList()` の手書き系）だけ。手書き系以外は `ok:false` で不変。`app.getPointKindStyles()` → `{ enabled, assign }`。`app.applyRecommendedPointKindStyles()` → 結論＝黄黒手書き風、課題＝付箋ボード風、提案＝クラフト紙風、アイデア＝クラフト紙風、未決定＝色鉛筆風、補足＝手書き調（AC-565。各組のコントラストは PARAM-007 以上）。
- AC-564・566・567: 同じ種類は図のどこでも同じスタイル、異なる種類は各スタイルの線・塗り・書体。再配置後も AC-430・431。`grp.session`・`file.save` に含まれ復元、無効に戻すと選択中の 1 スタイル。PNG・SVG・PDF に反映、`renderOutline()` の内容は不変、外部リクエスト 0 件。

## 手修正の履歴と元に戻す（FR-005。API の `undoManualEdit` は CONTRACT-REVIEW.md）
- `app.getEditHistory()` → `[{ id, kind:'edit'|'delete'|'add'|'merge'|'split'|'undo', before, after, at:'YYYY-MM-DD HH:mm' }]`（新しい順。最大 PARAM-123 件、超えた分は古い順に消える）。`grp.session`・`file.save` に含まれ復元、`data.reset` で消える（AC-574）。
- AC-575: `undoManualEdit()` は履歴の新しい順に最大 PARAM-123 件。戻した操作は履歴に `kind:'undo'`（表示「元に戻した」）。確認状態・確認日・「要確認」の印も直前の値。戻した結果は再配置で上書きされない。履歴なしは `ok:false`＋理由、コマンド `edit.undo` も無効。

## ワークショップホワイトボード型の進行の段階（FR-091）
- `app.setFacilitationPhase('diverge'|'classify'|'evaluate'|'decide')` → `{ ok }`。`app.getFacilitationPhase()`（初期 `diverge`）。この型以外では無効（`ok:false`）で他の型に影響しない。`renderOutline()` に現在の段階を文字（発散・分類・評価・決定）で含む。
- AC-576: 発散の間は話順に並べるだけで分類（AC-426・428・429）・強調は保留。分類以降へ切り替えると FR-079 の再配置が適用され、発散中に追加した要点も省かれない。
- AC-577: 種類の語に当てはまらない要点の種類は、追加時の段階が発散＝アイデア、分類＝補足、評価＝課題、決定＝補足（印「決定の段階」）。結論にしない。すでにある要点は変わらない。純関数 `web/src/pointkind.js` の `classifyKind(text, { phase })` 等で確かめる。
