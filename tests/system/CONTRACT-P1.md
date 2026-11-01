# 契約メモ P1（FR-099〜105・FR-053 の増分。run 202611020703）

System Test（`preview.test.js`・`onboarding.test.js`・`view.test.js` の AC-036）が使う API 名の案。実装役はこの名前で実装する。食い違いは `CONFLICTS:` で返す。

## 1. プレビュー（FR-101 AC-592、PARAM-139 = 300 ミリ秒）
- target = `{ kind:'scene'|'point', id, surface:'diagram'|'list' }`（`id` はシーン ID・要点 ID。`surface` は図かテキスト一覧）。
- `app.hoverElement(target)` / `app.unhoverElement(target)` / `app.focusElement(target)` / `app.blurElement(target)` → `{ ok }`（存在しない `id` は `ok:false` で何も変えない）。待ち時間は `scheduler.setTimeout`（PARAM-139）。
- `app.getPreview()` → `null | { open:true, target, heading, lead, kindLabel, needsReview:boolean, role:'tooltip', describedBy:string }`。`heading`＝そのシーンの見出し、`lead`＝要点の先頭（point のとき要点の文字の先頭から。scene のとき最初の要点の先頭）、`kindLabel`＝要点の種類のラベル（point のとき。FR-052・AC-231 と同じ語）。`needsReview`＝「要確認」の印（FR-092）。
- `app.activateElement(target, 'click'|'enter')` → `{ ok }`。固定のポップアップ（`getScenePopup()`、FR-024）を開き、プレビューは閉じる。point はその要点のシーンのポップアップ。閉じるのは `handleKey({key:'Escape'})`（`'popup.close'`）と `selectScene(null)`。
- キーボード: `preview.show`（フォーカス中の要素のプレビューを即時に出す）。

## 2. 初回の案内・ヘルプ・サンプル（FR-103 AC-599）
- `app.getOnboarding()` → `null | { open:true, step:1|2|3, total:3, steps:[{id:'mic'},{id:'interval'},{id:'save'}], id:'mic'|'interval'|'save', role:'dialog', label, focused:boolean, canLoadSample:boolean }`（`canLoadSample` は最後のステップだけ true）。終えた後は `null`。
- コマンド（すべて `keymap` に割り当てあり）: `onboarding.next`（最後のステップで完了）、`onboarding.back`（最初のステップでは何もしない）、`onboarding.skip`、`help.open`（初回の案内の 3 ステップを再び開く）、`sample.load`。`app.onboarding.next()/back()/skip()/loadSample()` も同じ（`{ok}`）。
- 終えた記録（完了・スキップ）は設定の保存（FR-012）の `grp.onboarding`（storage のキー。値は非空）。セッションファイル・`data.reset`・`clearSavedSession` では変わらない。記録がないときだけ起動で開く。
- `sample.load`: 読込後 `getState().sample === true`、`getState().session === 'paused'`、`getState().scenes.length > 0`、`renderOutline()` に全シーンの見出しが入る。音声入力は開始しない（`env.speech.startCalls` は 0）。

## 3. AC-036 のキー割り当て（追加分）
`glossary.open` `agenda.open` `preview.show` `map.focusNext` `map.focusPrev` `map.activate` `conflict.group` `conflict.ungroup` `point.confidential`。すべて `app.commands[...]` と `keymap` にあり、`handleKey` が名前を返す。`app.selectPoint(id)` → `{ok}`（要点を選ぶ。`point.confidential` の対象）。`point.confidential` は選択中の要点の機密の印を切り替え、`getState().scenes[].points[].confidential` が true/false になる。

## 4. unit/integration の観察点（台帳には入れない）
- AC-593（integration）: `getPreview().describedBy` が実 DOM の要素 ID に当たる。Esc で閉じる。ポインタをプレビュー上へ動かしても閉じない（`hoverPreview()`）。AC-594: `getPreview()` は PARAM-139 の前は null。AC-595: タッチのタップ＝`activateElement(target,'click')`。外部へのリクエスト 0 件（`fetch` 呼び出しなし）。
- AC-596〜598（RPG風の地図）: `getDiagramElements()` の地点に tabindex・role=button・名前（見出し）・`aria-hidden` なし。Esc の優先順: 入力欄＞ポップアップ＞プレビュー＞地図の B ボタン。
- AC-600〜602: `help.open` の外部リクエスト 0 件、`sample.load` は既存の議論があれば `getDialog()`（kind:'load-replace'）で確認し取り消せる。サンプルに実在の人物名・組織名なし、`data.reset` で消える。
- AC-585〜591（FR-099 対立・FR-100 ほか）・AC-603〜609（公開範囲・機密・議事・用語）・AC-582〜584（FR-053 関係「根拠」）・AC-580・581・427・564（種類 9 種類・スタイル）は unit/integration で実装役が確かめる。観察点はそれぞれの AC の本文のとおり。
- AC-427: 判定の順は 結論・課題・提案・アイデア・未決定 → 質問（PARAM-131）→ 根拠（PARAM-132）→ 行動（PARAM-129）→ 補足。`kindLabel` は `getDiagramStyle().scenes[].points[].kindLabel`（ja: 結論・課題・提案・アイデア・未決定・質問・根拠・行動・補足）。

## 5. AC-606 の機密除外が AC-528・AC-547（E2E-261）に与える影響
- 「機密の要点を除く」を選んだ保存では、機密の要点は Markdown の「要確認」の節（AC-528・AC-547）にも載らず、n・m・k は機密を除いた数で数える。除外した件数は文字「機密の要点を除外: n 件」だけが載る（AC-606 が AC-528・AC-547・AC-556 の列挙・件数・「詳細度によらず常に」より優先）。
- E2E-261 の既存の期待値（機密の印がない要点だけのセッション）は変わらない。機密の要点があって「除かない」（既定は公開範囲が「公開」でなければ除かない）のときも従来どおり。機密を除く出力の確認は unit/integration（AC-606）で行う。
- AC-546・AC-572 は書式の定義を用語へ移しただけで、E2E の期待値は不変（`ac_digests` のみ更新）。

## 6. AC-426 の種類の順（9 種類）
`rearrange-util.js` の `KIND_ORDER` は 結論・課題・提案・アイデア・未決定・質問・根拠・行動・補足。`T.question`（「どの会議室を予約しますか」）・`T.evidence`（「たとえば昨年は二十名でした」）・`T.action`（「田中さんが見積を共有します」）を加え、E2E-220（`AC-435` の pattern。FR-079 の AC-426 を含む）の同じテストを広げた。台帳の system ケースは E2E-220 のまま（AC-426 の検証レベルは integration）。
