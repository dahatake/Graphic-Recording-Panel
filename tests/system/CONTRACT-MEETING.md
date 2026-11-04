# FR-094 議事項目・FR-095 会議の文脈・FR-096 画像の説明（AC-166・AC-528 の変更）の契約メモ

台帳に入れる System Test: AC-560（全出力の表題・日付・議題。AC-166・AC-559 の保存と復元を同じケースで）と AC-528（Markdown の節・冒頭）。
`tests/system/meeting-context.test.js`（AC-166・AC-559・AC-560）と `tests/system/present-export.test.js`（AC-528）。
ほかの AC（AC-553〜557・558・578・561〜563）は unit / integration のため台帳に入れず、下の観察点を実装役の単体・結合テストが確かめる。
FR-098（議題タイマー。part 3 が決める API）は、議題の登録・取得を下の `setMeetingContext` / `getMeetingContext` で行い、これを参照する。

## 会議の文脈（FR-095。新設）
- `app.setTitleInfo({ series, theme, date, venue })`（既存）・`app.getTitleInfo()`。`date` は利用者が入れた文字列のまま（例 `2026-11-03`）。未入力は空文字。出力日を自動で補わない。
- `app.setMeetingContext({ purpose?:string, audience?:string, agenda?:[{ name:string, minutes?:number|null }] })` → `{ ok, reason? }`。渡した項目だけ置き換える（`agenda` は丸ごと置換）。`name` が空白だけの項目は `ok:false` で全体不変（reason あり）。`minutes` は 1 以上の整数（分。FR-098 の持ち時間）。省略・null は「既定」（PARAM-124 の 10 分で動くが、保存値は null のまま）。
- `app.getMeetingContext()` → `{ purpose:string, audience:string, agenda:[{ id:string, name:string, minutes:number|null }] }`（並びは入力順。`id` は項目ごとに一意・再読込後も不変）。未入力は空文字・空配列。
- 保存・復元: `grp.session`（ブラウザ内の保存）と `file.save` / `loadSessionFile` に、タイトル情報（AC-166 の変更）と `getMeetingContext()` の値が含まれる。再読込（同じ `storage` で `createApp`）・読込の後に復元される。`data.reset`（確認 `confirm`）で消える（タイトル情報は空、`getMeetingContext()` は空）。
- 表示: 未入力の項目は図に出ない。出力（PNG・PDF・SVG・Markdown・HTML）は、表題（`theme`。未入力は従来の表題 `t('app.title')`）・日付（`date` が空なら日付欄を出さない）・議題（`agenda` の `name` の並び。0 件なら議題欄を出さない）を文字で含む。目的・対象読者は Markdown・HTML の冒頭と画像の説明（FR-096）に含む（AC-578。文字としてだけ扱う）。

## 議事項目（FR-094。新設。part 3 の AC-571 も議題をここから取る）
- `app.getMeetingItems()` → `{ decisions:[Item], pendings:[Item], objections:[Item], actions:[Item], candidateCount:number }`。`Item` は `{ id, kind:'decision'|'pending'|'objection'|'action', state:'candidate'|'confirmed', text, sourceUtteranceId:string|null, ... }`。
  - 決定事項: `reason`・`decider`（空は `null`。表示は「未定」）。異論・懸念: `relatedDecisionId:string|null`。アクション項目: `assignee`・`due`・`doneCriteria`（空は `null`。表示は「未定」。自動で補わない）。
  - 候補（`state:'candidate'`）の `text` は元の発話の文字列。言い回しは PARAM-126〜129（複数に当てはまる発話は該当する種類すべての候補）。
  - 並びは出現順。`candidateCount` は全種類の `candidate` の合計。
- `app.confirmMeetingItem(id)` → `{ ok }`（候補→確定。操作なしに確定にならない）。`app.rejectMeetingItem(id)` → `{ ok }`（却下。同じ `sourceUtteranceId` と種類からは再び候補にならない）。`app.editMeetingItem(id, fields)` → `{ ok, reason? }`（`text` と、種類ごとの欄）。`app.addMeetingItem(kind, { text, ...fields })` → `{ ok, id, reason? }`（手入力は最初から `confirmed`。`text` が空白だけは `ok:false`）。不明な id は `ok:false` で不変。
- 保存・復元: `grp.session`・`file.save` / `loadSessionFile` に含まれ、`data.reset` で消える。生成 AI への送信（LLM 連携・画像プロンプト）には含めない（NFR-PRIV-003）。
- テキスト一覧（`renderOutline()`）は「決定事項」「保留事項」「異論・懸念」「アクション項目」「候補」「未定」の語で同じ内容を出す。候補は文字「候補」＋枠つきの記号（`<g data-candidate-mark>` 等。色だけにしない）。

## Markdown の構成（AC-528 の変更。AC-556・AC-547）
- 冒頭（最初の `##` の前）: `# <表題>`（1 行だけ）、日付（入力があるときだけ）、議題（入力した項目の並び。0 件なら出さない）、目的・対象読者（入力があるときだけ）。
- 末尾（トピック・要点の後。この順）: `## 決定事項`、`## 保留事項`、`## 異論・懸念`、`## アクション項目`、`## 要確認`（見出しの `##`・`###` はどちらでもよい）。前の 4 節は確定した項目だけ（候補は出ない）。0 件の節は見出しと「なし」。アクション項目は担当者・期限・完了条件を持ち、無い欄は「未定」。未確定の候補があるとき「未確定の候補 n 件」の文字（n は `candidateCount`）。`## 要確認` は確認されていない要点（`getPointReview(id).needsReview`）の一覧で、図の詳細度によらず常に出し、0 件なら見出しと「なし」。

## 画像の説明（FR-096。AC-561〜563 の観察点。unit / integration）
- 説明の純関数: `web/src/figuredesc.js` の `buildFigureDescription({ title, purpose, audience, topics, relations, conclusions, unresolved, lang })` → `{ title:string, text:string }`。テーマ・関係・結論・未解決事項の 4 項目（該当がなければ「なし」）。同じ入力は同じ文章（決定的）、外部通信なし、説明の対象は画面の詳細度（FR-026）に従う（AC-561・562）。大項目＝トピックの題名まで、中項目＝加えてシーンの見出しまで、詳細＝要点まで。その詳細度で図に出ない要点は、結論・未解決事項にも含めない。観察点は `app.getFigureDescription()`（現在の詳細度の説明）と、`renderSvgForSave()` の `<desc>`。
- SVG: `renderSvgForSave()` の結果に `<title>`（表題）と `<desc>`（説明）が含まれ、文字は XML エスケープされ、許可リスト（NFR-SEC-004）を満たす（`title`・`desc` は許可）。
- PNG: iTXt チャンク（UTF-8）のキーワード `Title`・`Description`。PDF: 文書情報の `/Title`・`/Subject`（UTF-16BE の PDF 文字列）と、末尾の「図の説明」の項。内容は SVG の説明と同じ。

## 観察点（AC 別。unit / integration）
- AC-553: PARAM-126〜129 の言い回し（部分一致・大文字小文字を区別しない）で候補。複数該当は複数種の候補。確定・却下・編集は利用者の操作だけ。却下した候補は同じ発話から再び出ない。確定するまで Markdown・HTML に出ない。
- AC-554: 決定事項の理由・決定者、異論の関連する決定事項を編集できる。空は表示「未定」で自動で補わない。
- AC-555: アクション項目の担当者・期限・完了条件が空なら表示「未定」。発話に日付の語があっても `due` は `null` のまま（候補・確定のどの段階でも）。
- AC-556: HTML にも同じ節（見出し付き）。候補は含まれず「未確定の候補 n 件」。
- AC-557: 保存・復元・テキスト一覧・色だけに頼らない・生成 AI への送信に含まれない（`fetch` 等の呼び出しの本文に議事項目・会議の文脈が無い）。
- AC-558: タイトル欄と同じ場所（`getTitleBar()` 等、既存のタイトル欄の部品）に目的・対象読者・議題の入力欄。未入力は図に出ない。
- AC-578: 目的・対象読者・議題名は `<script>`・`<img onerror>` を含めても文字としてだけ出力される。

## 登壇者名（FR-036・Q-041 A 2026-11-04。AC-166・AC-659・AC-559・AC-560・AC-358・AC-606 の観察点）
System Test（台帳）に入れるのは system の AC の AC-560（全出力の「登壇者」の項。E2E-272）と AC-358（送信に含まれない。E2E-176）。AC-166・AC-169・AC-529・AC-559・AC-562・AC-606・AC-659 は integration / unit のため台帳に入れず、同じテストファイル（`meeting-context.test.js`・`llm-consent-persist.test.js`）の観察点として、下の契約を実装役の単体・結合テストも確かめる。AC-652 は廃止（ケースなし）。
- 入力・取得: 登壇者名はタイトル情報の 1 項目 `speaker`（任意・文字列）。`app.setTitleInfo({ speaker })`・`app.getTitleInfo()` → `{ series, theme, date, venue, speaker }`（既定 `speaker:''`。渡した項目だけ置き換える既存の流儀。利用者の手入力だけで決まり、音声・取込ファイル・話者名（AC-117）・要点から推測・補完しない）。画面の入力欄は既存のタイトル欄の部品（`getTitleBar()` の項目 `id:'speaker'`、`kind:'title'`）で、右上に置く。
- 図の右上: `renderSvgForSave()` の SVG に、入力があるとき `<text data-role="speaker">名前</text>`（図の幅の右半分に置く。`x` が viewBox 幅の半分より大きい）。入力がない（空）とき `data-role="speaker"` の要素は無く、匿名の汎用アイコン `data-role="anon-icon"` だけがある。PNG は描画した文字（`canvasFactory.log.texts`）、PDF は取り出した文字に名前が含まれる（空のときは含まれない）。
- Markdown: 最初の `##` の前の冒頭に「登壇者」の項（例 `登壇者: 名前`）。HTML: 表題の近くに「登壇者」のラベルと名前。空のときは両方とも「登壇者」の語も名前も出ない。文字はエスケープされ、`<script>` などを含めても文字としてだけ出る（AC-578 と同じ）。
- 画像の説明（AC-561・AC-562）には載らない: SVG の `<desc>`・`getFigureDescription().text`・PNG の Description・PDF の Subject には名前を含めない。
- 保存・復元・初期化（AC-559・AC-659 d）: `grp.session`・`file.save` / `loadSessionFile` に `titleInfo.speaker` が含まれ、再読込・読込の後に復元され、`data.reset`（確認 `confirm`）で `''` に戻る。
- 生成 AI・画像プロンプト（AC-358・AC-659 e）: `/api/llm/extract` ほかの中継への要求の本文（`relay` の `calls` の `body` 全体）に名前を含めない。`app.getImagePrompt({ mask: true|false }).text` に名前を含めない（伏せ字の対象外）。名前の入力・表示・保存の間、`fetch`・`XMLHttpRequest`・`WebSocket`・`EventSource`・`sendBeacon` の呼び出しは 0 件。
- 機密の要点を除く保存（AC-606・AC-659 f）: `setExcludeConfidential(true)` でも名前は 5 形式の出力にそのまま残り、`getSaveWarnings()`（文字の配列）に「登壇者名」を含む警告が 1 つ以上ある（自由入力は機密の判定の対象外。名前を入力しているとき）。
- 話者名を含まない出力（AC-529）: 取込んだ話者名（AC-117）は Markdown に載らないが、手入力の登壇者名は載る（別のもの）。例外（2026-11-05 最終監査 202611050444 C-02）: 会議ボード型で名前を表示する設定（`getHideNames() === false`）の間は、参加者名簿と .vtt の話者タグの名前（AC-668）がテキスト一覧と同じ「参加メンバー: 名前、…」の行と「（発言: 名前）」として Markdown に載る（テキスト一覧と一致。CONTRACT-BOARD.md「人物の名前」）。`setHideNames(true)` のときと会議ボード型以外の型では載らない。画像生成プロンプト（`getImagePrompt`）には、名前を表示する設定・伏せ字の選択によらず名前は入らない。
