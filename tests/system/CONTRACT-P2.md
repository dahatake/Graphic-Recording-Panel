# 契約メモ P2（FR-093 用語集の画面・FR-095 議題の画面・FR-106〜112 の増分。run 202611021028）

System Test（台帳）: AC-610（`glossary-agenda.test.js`）、AC-611（同）、AC-616（`vote.test.js`）、AC-639（`draw.test.js`。**次の run で実装。台帳は blocked**）。AC-036 は `view.test.js` に投票・役割・問いかけのキーを追加（E2E-023）。
既存の API（CONTRACT-REVIEW.md `addGlossaryTerm` ほか、CONTRACT-MEETING.md `setMeetingContext`・`getMeetingItems`、CONTRACT-TIMER.md `getAgendaTimer`、CONTRACT.md `dialogAction`・`file.save`・`loadSessionFile`・`data.reset`）と整合する。画面の永続は `grp.session`（既存）。

## 1. 用語集の画面（FR-093 AC-549・AC-610）
- `app.commands['glossary.open']()`（キー Alt+Shift+,。status に `msg.glossaryOpen`）で開く。`app.getGlossaryView()` → `null | { open:true, role:'dialog', label, items:[{id,term,variants:[string]}], count, limit, countText:'n／500 件', error:string|null }`。
- 入力欄: `app.setGlossaryInput({ term:string, variants:string })`（variants は読点・カンマ区切りの 1 欄）、`app.submitGlossaryInput()` → `{ ok, reason? }`（空・重複・上限超は `ok:false` で理由。`getGlossaryView().error` にも同じ理由の文字）。編集・削除は既存 `updateGlossaryTerm`・`removeGlossaryTerm`。
- `app.renderGlossary()` → html（一覧・入力欄・件数・理由の文字）。閉じる: `handleKey({key:'Escape'})` → `'glossary.close'`。閉じるとフォーカスは開く前の位置（`app.getFocusedElement()`）。
- 記録時の置換（AC-550）: `getState().utterances[i].text`（置換後）・`rawText`（元）。重複は前後の空白・全角半角（NFKC）を除いて判定。

## 2. 議題の画面（FR-095 AC-611。FR-098 AC-568・569）
- `app.commands['agenda.open']()`（キー Alt+Shift+.。status に `msg.agendaOpen`）。`app.getAgendaView()` → `null | { open:true, role:'dialog', items:[{id,name,minutes}], count, limit:30, countText:'n／30 件', error, timer:{ state, currentName, remainingText, nextName } }`。`renderAgendaView()` → html（現在の議題・残り・次の議題を文字で含む）。
- `app.setAgendaInput({ name, minutes:string })` / `app.submitAgendaInput()` → `{ ok, reason? }`（名前が空白だけ、持ち時間が正の整数でない、30 件超は `ok:false`＋理由）。`app.editAgendaItem(id, { name, minutes })` → `{ok, reason?}`。`app.moveAgendaItem(id, 'up'|'down')` → `{ok}`。`app.removeAgendaItem(id)` → `{ok}`。タイマーの進行中の議題の削除は `{ ok:false, pending:true }` で `getDialog().kind === 'agenda-delete-current'`（`confirm`・`cancel`）。confirm で削除し次の議題へ進む（次がなければ待機）。
- 順は `getMeetingContext().agenda` と一致（`setMeetingContext` と同じ保存）。閉じる: Escape → `'agenda.close'`。フォーカスは開く前に戻る（`getFocusedElement()`）。
- 観察点（integration）: Tab・矢印・Enter・Esc・Delete だけで追加・編集・削除・並べ替えができる。進行しない議題の編集・並べ替えで `getAgendaTimer()` の現在の議題・残りは不変。

## 3. 投票（FR-106 AC-612〜616）
- `app.startVote({ options:[string], votesPerPerson?:number })` → `{ ok, reason? }`（既定の持ち票数は PARAM-143＝3。選択肢は 2 件以上）。`app.getVote()` → `null | { options:[{ id, label, votes, ratings:{ fit,impact,feasibility,risk: 1..5|null }, ratingText, criticalRisk:boolean }], votesPerPerson, votesUsed, remaining, stance:'reference'|'decision', stanceLabel:'参考'|'決定', rulesText, noticeText, result:null|{ ranking:[{ optionId, votes, rank, avg:{...}, tie:boolean }], tie:boolean } }`。
- `app.setVoteStance('reference'|'decision')`（既定 `reference`）、`app.castVote(optionId)` / `app.retractVote(optionId)`（持ち票数超は `ok:false`＋理由）、`app.rateOption(optionId, 'fit'|'impact'|'feasibility'|'risk', 1..5|null)`（範囲外は `ok:false`。null・未入力は「未評価」。自動で補わない）、`app.tallyVote()` → `{ ok, result? }`（決定的・外部通信なし）。`app.renderVote()` → html（票数・基準ごとの評価・「未評価」・「重大なリスク」の印と注記「少数意見・重大なリスクは票数だけで却下しない」を文字と枠つきの記号で）。
- 「決定」の集計は `getMeetingItems().decisions` に `state:'candidate'`（text に最上位の選択肢）を 1 件足すだけ。「参考」では足さない。注記・印は `addMeetingItem('objection', …)` で異論・懸念にできる（観察点）。
- 保存・復元・初期化・出力: `grp.session`・`file.save` に含む。`data.reset` で消える（`getVote()` は null）。`renderOutline()`・Markdown・HTML に「参考／決定」「重大なリスク」「未評価」。生成 AI への送信に含めない（観察点: `fetch` の本文）。
- キー（AC-036）: `vote.open`・`vote.tally`・`roles.open`・`question.open`（`keymap` にあり、`handleKey` が名前を返し、status に受け付けの文字）。

## 4. 手描き（FR-112 AC-635〜639。次の run で実装）
- `app.commands['draw.toggle']()`（描画のモード）、`app.getDrawState()` → `{ mode:boolean, colorName:string, ... }`、`app.getDrawColors()` → `[{id,name}]`（PARAM-150）、`app.setDrawColor(id)`、`app.drawPointer('down'|'move'|'up', {x,y})`（図の座標）、`app.getStrokes()` → `[{id,color,points:[{x,y}]}]`（PARAM-151 本まで）、`app.eraseStroke(id)`、`commands['draw.undo'|'draw.redo'|'draw.clear'|'draw.erase']`（`draw.clear` は確認つき）。
- 出力: `renderSvgForSave()` に `data-stroke-id="<id>"` を持つ線。Markdown・テキスト一覧は「手描き n 本」。観察点: 再配置・手修正・拡大縮小・シーン確定で位置不変、取り消し・やり直しの決定性、許可リスト、生成 AI へ送らない。
- AC-036 のキー対象に次の run で足す: `draw.toggle`・`draw.erase`・`draw.undo`・`draw.redo`・`draw.clear`・`draw.color.next`、演出の強さ（FR-111）、シーン詳細からの戻り（FR-108）。

## 5. unit/integration の観察点（台帳に入れない）
- AC-612: 持ち票数・規則・位置づけが投票の前に文字で出る。入力・取り消し・位置づけの選択はキーだけで可。AC-613: 基準名・段階は文字。AC-614: 同じ入力から毎回同じ集計。同点は同順位（`rank` が同じ）、基準ごとの平均は未評価を除く。AC-615: 注記は常に出る。リスク ≥ 4 で `criticalRisk`。
- AC-617〜620（役割・問いかけ）: `app.setRole('recorder'|'facilitator'|'decider', name)`・`app.getRoles()`（未設定は「未定」）。決定者の名前は決定事項の決定者欄の候補（`getDeciderSuggestion()`）で、自動では補わない。`app.getQuestions()`・`app.askQuestion(index)`（PARAM-146 の定型文。status で読み上げ）・`app.answerQuestion(id, 'noConcern'|'concern'|'hold')`。回答がなければ「未回答」。「合意」「承認」と書かない。「懸念あり」→ `addMeetingItem('objection', …)`。保存・復元・出力（記録者・進行役・決定者・未定・未回答）。LLM 送信に含めない。
- AC-621〜623（画面の状態の復元）: `app.getViewState()`（絞り込み・スクロール・拡大率・中心。端末内の一時の状態）。詳細を開く直前を記録し、閉じる（Esc・戻る・キー）で復元し status で読み上げる。対象シーンが消えていれば絞り込み解除＋理由。保存・出力・送信・再読込に含まれない。
- AC-624〜628（指標）、AC-629〜631（人物の絵記号）、AC-632〜634（演出）、AC-549（用語集の画面の操作）、AC-590（プレゼンの文字の下限）は、各 AC の本文のとおり実装役の単体・結合テストで確かめる（AC-628 は `renderOutline()` に指標名・現在値・目標・単位・望ましい方向）。
