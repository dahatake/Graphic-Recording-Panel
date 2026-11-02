# 契約メモ P2（FR-093 用語集の画面・FR-095 議題の画面・FR-106〜112 の増分。run 202611021028）

System Test（台帳）: AC-610（`glossary-agenda.test.js`）、AC-611（同）、AC-616（`vote.test.js`）、AC-639（`draw.test.js`。E2E-279。run 202611021246 で実装。台帳は not_run）。AC-036 は `view.test.js` に投票・役割・問いかけ・手描き・演出のキーを追加（E2E-023）。
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
- 投票者（AC-612・5cd447f）: `startVote({ options:[string|{label,pointId?}], voters?:[label] })`（`pointId` は選択肢の由来の要点。ラベルは任意で、空・省略は「投票者 1」…の連番。投票者は 1 人以上、話者の識別・認証ではなく発話に結びつけない）。`getVote().voters` → `[{ id, label, votesUsed, remaining }]`。持ち票数は投票者 1 人あたり、`castVote(optionId, voterId?)`（省略は最初の投票者）・`retractVote(optionId, voterId?)`、集計は投票者を合算。`votesUsed` は全投票者の合計。`options[].confidential`（由来の要点が機密のとき true）。機密の選択肢と結果は `setExcludeConfidential(true)` の保存（Markdown・HTML ほか 5 形式）から除かれ「機密の要点を除外: n 件」だけが載る。画面・セッションの保存は対象外（AC-606・AC-620）。
- pp.setVoteStance('reference'|'decision')`（既定 `reference`）、`app.castVote(optionId)` / `app.retractVote(optionId)`（持ち票数超は `ok:false`＋理由）、`app.rateOption(optionId, 'fit'|'impact'|'feasibility'|'risk', 1..5|null)`（範囲外は `ok:false`。null・未入力は「未評価」。自動で補わない）、`app.tallyVote()` → `{ ok, result? }`（決定的・外部通信なし）。`app.renderVote()` → html（票数・基準ごとの評価・「未評価」・「重大なリスク」の印と注記「少数意見・重大なリスクは票数だけで却下しない」を文字と枠つきの記号で）。
- 「決定」の集計は `getMeetingItems().decisions` に `state:'candidate'`（text に最上位の選択肢）を 1 件足すだけ。「参考」では足さない。注記・印は `addMeetingItem('objection', …)` で異論・懸念にできる（観察点）。
- 保存・復元・初期化・出力: `grp.session`・`file.save` に含む。`data.reset` で消える（`getVote()` は null）。`renderOutline()`・Markdown・HTML に「参考／決定」「重大なリスク」「未評価」。生成 AI への送信に含めない（観察点: `fetch` の本文）。
- キー（AC-036）: `vote.open`・`vote.tally`・`roles.open`・`question.open`（`keymap` にあり、`handleKey` が名前を返し、status に受け付けの文字）。

## 4. 手描き（FR-112 AC-635〜640。run 202611021246 で実装）
- `app.commands['draw.toggle']()`（描画のモード）、`app.getDrawState()` → `{ mode:boolean, colorName:string, ... }`、`app.getDrawColors()` → `[{id,name}]`（PARAM-150）、`app.setDrawColor(id)`、`app.drawPointer('down'|'move'|'up', {x,y})`（図の座標）、`app.getStrokes()` → `[{id,color,points:[{x,y}]}]`（PARAM-151 本まで）、`app.eraseStroke(id)`、`commands['draw.undo'|'draw.redo'|'draw.clear'|'draw.erase']`（`draw.clear` は確認つき）。
- 機密（AC-638・AC-606・5cd447f）: `app.getPointBox(pointId)` → 図の座標の外接矩形 `{x,y,width,height}`。`setExcludeConfidential(true)` の出力（`renderSvgForSave()` ほか）から、機密の要点の描画範囲と外接矩形が重なる線だけを除き、重ならない線は残す。残る線があれば `app.getSaveWarnings()`（文字の配列）に「手描きは図の座標に固定され要点に結びつかないため、要点と重ならない線は残ります」。除いた線は「機密の要点を除外: n 件」に数えず、「手描き n 本」は残った本数。アプリ内の線は変わらない（E2E-279）。重なりの判定（AC-638）: 線の外接矩形（線幅の半分を外側に含む）と機密の要点の外接矩形（`getPointBox`）が図の座標で 1 点でも交わる（辺・角が接するだけも重なる）。決定的。
- 手描きの表示／非表示（AC-640。**integration** なので System Test なし。実装役が確かめる）: 非表示でも線は消えず、再表示で同じ位置。表示の状態は端末ごとの設定。非表示のときも「手描き n 本」の件数と出力の線は変わらず、非表示であることを文字で示す。キーで切り替え可（AC-036）。API: `commands['draw.visibility']`（切替）、`getDrawState().visible`（boolean）・`.hiddenText`（非表示のときの文字。表示中は空）。
- 出力: `renderSvgForSave()` に `data-stroke-id="<id>"` を持つ線。Markdown・テキスト一覧は「手描き n 本」。観察点: 再配置・手修正・拡大縮小・シーン確定で位置不変、取り消し・やり直しの決定性、許可リスト、生成 AI へ送らない。
- AC-036 のキー対象（E2E-023 の view.test.js）: `draw.toggle`・`draw.color.next`・`draw.erase`・`draw.undo`・`draw.redo`・`draw.clear`（確認つき。キーはダイアログを開く）・`draw.visibility`・`cinematic.next`（演出の強さを なし→控えめ→標準 と巡回。設定画面の選択とは別にキーでも可）。物理キーの割り当ては実装役が決める（AC-036 §10.3 の仮定）。`handleKey` は名前を返し status に受け付けの文字。シーン詳細からの戻り（FR-108）は既存のキーで確認済み。

## 5. unit/integration の観察点（台帳に入れない）
- AC-612: 持ち票数・規則・位置づけが投票の前に文字で出る。入力・取り消し・位置づけの選択はキーだけで可。AC-613: 基準名・段階は文字。AC-614: 同じ入力から毎回同じ集計。同点は同順位（`rank` が同じ）、基準ごとの平均は未評価を除く。AC-615: 注記は常に出る。リスク ≥ 4 で `criticalRisk`。
- AC-617〜620（役割・問いかけ）: `app.setRole('recorder'|'facilitator'|'decider', name)`・`app.getRoles()`（未設定は「未定」）。決定者の名前は決定事項の決定者欄の候補（`getDeciderSuggestion()`）で、自動では補わない。`app.getQuestions()`・`app.askQuestion(index)`（PARAM-146 の定型文。status で読み上げ）・`app.answerQuestion(id, 'noConcern'|'concern'|'hold')`。回答がなければ「未回答」。「合意」「承認」と書かない。「懸念あり」→ `addMeetingItem('objection', …)`。保存・復元・出力（記録者・進行役・決定者・未定・未回答）。LLM 送信に含めない。
- AC-621〜623（画面の状態の復元）: `app.getViewState()`（絞り込み・スクロール・拡大率・中心。端末内の一時の状態）。詳細を開く直前を記録し、閉じる（Esc・戻る・キー）で復元し status で読み上げる。対象シーンが消えていれば絞り込み解除＋理由。保存・出力・送信・再読込に含まれない。
- AC-624〜628（指標）、AC-629〜631（人物の絵記号）、AC-632〜634（演出）の観察点は §6。AC-549（用語集の画面の操作）、AC-590（プレゼンの文字の下限）は、各 AC の本文のとおり実装役の単体・結合テストで確かめる（AC-628 は `renderOutline()` に指標名・現在値・目標・単位・望ましい方向）。

## 6. 指標・人物・演出の観察点（FR-109〜111。unit/integration。台帳に入れない）
- 指標（AC-624、PARAM-147）: `app.getGauges()` → `[{ pointId, name, value, unit, target, before, after, direction:'up'|'down'|null, kind:'bar'|'ring'|'label', reason, actualText, clamped }]`。同じ文字列は毎回同じ結果（決定的）。選び方: 前後の値が両方あれば `bar`（目標もあれば目標線）／前後の値がなく目標が数値で比率に向く単位（%・割・達成率）なら `ring`／それ以外（目標不明・単位が比率でない・方向語が 0 個または相反する・値が 0 以下）は `label`（文字だけ）で `reason` に理由（「目標が不明のため比率で示せない」「望ましい方向が決まらない」など）。100% 超は上限で描き `actualText` に実値、`clamped:true`。「達成」は方向語としてだけ数え、指標語には数えない。描画は `renderGauge(gauge)` → SVG 文字列（許可リストを満たす）。外部通信なし。AC-625〜628 は本文のとおり（`renderOutline()` に指標名・現在値・目標・単位・望ましい方向）。
- 人物（AC-629、PARAM-148・153）: `app.getPersonVariants()` → `[{ index, age:'young-middle'|'senior', gender:'masculine'|'feminine', svg }]`（PARAM-148 種類以上。4 つの組のそれぞれに 2 種類以上。特定の属性を既定にしない）。`app.personVariantFor(id)` → 要点の識別子（UTF-8）の FNV-1a 32 ビットのハッシュ値 % バリエーション数 の番号のバリエーション（話者・発話者は使わない。同じ id は毎回同じ）。偏り: 識別子 1000 件（連番）の割り当てで、各バリエーション・年齢区分・性別表現の比率が、均等の比率との差 PARAM-153 百分率の点以内。AC-630・631 は本文のとおり。
- 演出（AC-632、PARAM-149）: `app.getCinematic()` → `{ level:'none'|'subtle'|'standard', maxMs, maxZoom, presentationOnly:true }`。既定 `subtle`（300 ms・1.1 倍）、`standard`（600 ms・1.25 倍）、`none`（0 ms・動きなし）。`app.setCinematicLevel(level)` → `{ok}`（設定画面 FR-030 からキーだけでも可。端末ごとの設定として保存）。`app.getCinematicEvents()` → シーンの確定・トピックの切り替えで起きた `{ type:'zoom'|'fade', ms, zoom }`（プレゼンテーション中だけ記録。通常の 2D/3D では空。ms・zoom は上限以内）。AC-633・634 は本文のとおり。
- 投票の上限（PARAM-154）: 投票者 20 人・ラベル 40 文字・持ち票 99 票まで。超えると追加されず理由が文字で出る。
