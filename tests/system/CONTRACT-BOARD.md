# 契約: 会議ボード型（FR-114。AC-667 の System Test が実装を観察するための口。test-designer が置き、実装役が従う）

期待値は要求定義書（FR-114・AC-664〜AC-667・AC-669、PARAM-007・088・126・127・129・131・132・158・165・178〜181・001・104）だけから決めています。
既存の契約（`CONTRACT.md`「レイアウト型・描画スタイル・設定画面」、`CONTRACT-STYLE-PRESET.md`、`CONTRACT-LIVE-EXPORT.md`）は変えず、ここに書いたものを加えます。

## 型の識別子
- 型 id は `board`（FR-027 の 7 つ目。コマンドは `layoutType.board`）。`setLayoutTypes(['board'])` で選べ、先頭の型のとき `renderSvg()` のルートに `data-layout-head="board"`。

## 区画の識別子（9 つ。id の一覧。区画の順は下の PARAM-192 の並びの順で、この表の順ではない）
| id | 区画 |
|---|---|
| `purpose` | 目的・背景 |
| `members` | 参加メンバー |
| `flow` | 議論の流れ・主な発言 |
| `decisions` | 決定事項 |
| `open` | 未決事項 |
| `themes` | 主要テーマ・議論のポイント |
| `vision` | 最終的に目指す姿 |
| `actions` | 次アクション |
| `memo` | メモ・補足 |

## renderSvg()（先頭の型が board のとき）
- 区画: `<g data-board-section="<区画 id>">`。区画の枠・見出し・中の要素はすべてこの `g` の子孫。
- 要点: 要点を表す要素（またはその祖先・子孫のどれか 1 つ）に `data-point-id="<要点 id>"`（`getState().scenes[].points[].id`）。1 つの要点は 1 つの区画の `g` の中にだけ現れる。
- 部品の種類（AC-666 の 11 種類）: その部品を描く要素に `data-board-part="<種類>"`。種類は `title`（タイトル帯）・`frame`（区画の枠と見出し）・`badge`（番号バッジ）・`bubble`（吹き出し）・`check`（✓のリスト）・`question`（？のリスト）・`table`（表）・`arrow`（矢印）・`person`（人物）・`icon`（絵記号）・`emphasis`（マーカー・下線の強調）。
- 文字は `<text>`（`<tspan>` 可）。文字の色は `fill`（属性か `style` の `fill:`、祖先から継承）。背景になる面は `rect`・`circle`・`ellipse`・`path`・`polygon` の塗り（`fill`。`url(#id)` のグラデーションは `<linearGradient>`/`<radialGradient>` の `<stop stop-color>`）。座標の変換は `transform`（`translate`・`scale`・`matrix`・`rotate`）だけを使う。紙面の質感の図形は `data-style-role="paper-texture"`（`CONTRACT-STYLE-PRESET.md`。コントラストの測定から除く）。
- `<image>`・外部 URL（`http`・`//`）・外部の `url(` を含まない。

## app.getBoardModel()（先頭の型が board のとき。それ以外は `null`）
```
{
  canvas: { w, h },                       // 図の領域
  band: { x, y, w, h } | null,             // タイトル帯（タイトル・サブタイトル・日付がすべて未入力なら null 可）
  lineHeight,                             // 1 行の高さ（SVG の座標の単位。PARAM-186 の「1 行」＝26。AC-669）
  columns,                                // 図の帯の数（3。AC-669。帯は幅 1 列の縦の帯 A・B・C）
  bands: [[sectionId, ...], [...], [...]],// 帯 A・B・C ごとの区画の列（上から順）。幅 2・3 列の区画は置く先のすべての帯に出る（例: 初期の並びは A=[purpose,flow,themes,actions]・B=[members,flow,themes,actions]・C=[vision,decisions,open,memo]）
  initialHeight,                          // 初期の並び（PARAM-192）を AC-669 (3) で置いたときの図の高さ（最も下の下端＋外側の余白 24。PARAM-194 と比べる値）
  reflowed,                               // 並びを決め直したか（initialHeight > 913 のときだけ true。AC-669 (4)）
  sections: [{ id, title, cols, band, contentTop, contentBottom, frame: { x, y, w, h }, elements: [{ id, part, x, y, w, h, parent? }] }], // 区画の順（PARAM-192: purpose, members, vision, flow, decisions, themes, open, actions, memo）。cols＝幅（1〜3）、band＝開始の帯（0=A・1=B・2=C）
  assigned: [{ pointId, section }],       // 要点ごとの振り分け（AC-665）
  animations: [{ id, kind: 'appear' | 'move' }] // いま進行中の AC-669 のアニメーション（出現のフェードと拡大・詰め直しの移動）。ないときは []
}
```
- `animations`（2026-11-05 追加。AC-673）: AC-669 の出現・移動のアニメーションが進行中の要素。ライブ描画ショーが OFF・動きを減らす設定でないとき、新しい要点の出現の間（PARAM-181 以内）は `kind:'appear'` の項目が入る。ショーが ON のときは、AC-669 のアニメーションはショーの描線・書き込み（AC-673）と運ぶ動き（AC-674）に置き換わるので、常に `[]`。
- 帯と区画の配置（AC-669 案 A。2026-11-05 全面改訂。旧: rows・stretch・横並びの下端を揃える・倍率・空きの最大の比較は廃止）。System Test: board.test.js の AC-669 のテスト。実装役と合わせる口は次のとおり。
  - `sections` は常に区画の順（PARAM-192）。`cols`（1〜3）と `band`（開始の帯 0〜2。`band + cols ≤ 3`）が割り当て。`frame.x = 24 + band×(400+16)`、`frame.w` ＝ 400（1 列）・816（2 列）・1232（3 列）（PARAM-191）。`bands` は割り当てから導かれる（区画の順に各帯へ並べた列）。
  - 積み方: 各区画は区画の順に、置く先の帯の積み上がりの下端のうち最も下のものの直下（間隔 16）に `frame.y` を置く。どの帯にも積まれていない最初の区画の上端はすべて同じ（またがる最初の区画も同じ）。帯の下端は揃えない。同じ帯の区画の `frame.y` は他の帯の高さに依存しない。
  - 枠の高さは自分の中身の高さ: 要点のある区画で `frame.y + frame.h − max(要素の y + h)` ＝ 枠の内側の余白 12（±1）で、枠の高さの 20% 以下（横に並ぶ区画に高さを揃えない・要素の間隔と表の行は広げない。`stretch` は出さない（出すなら 1））。`contentTop`＝見出しの下の内側の余白の直下の y（最初の要素の上端がここに一致する＝上の空き 0）。`contentBottom`＝枠の内側の下端の y。要点が 0 件の区画は見出し＋ 1 行（26）分の空きだけの高さ（62〜94）で空きの対象外。
  - 図の高さ ＝ `max(frame.y + frame.h) + 24`。`canvas.h` はこれ以上（足りないときは縦に伸ばす）。
  - 並びの決め直し（AC-669 (4)）: `initialHeight`（初期の並びの高さ）が 913（PARAM-194）以下なら `reflowed:false` で初期の並び（`purpose` 0/1・`members` 1/1・`vision` 2/1・`flow` 0/2・`decisions` 2/1・`themes` 0/2・`open` 2/1・`actions` 0/2・`memo` 2/1。band/cols）のまま、`initialHeight` と図の高さは一致。超えるときだけ `reflowed:true` で、図の高さが最小の割り当て（初期の並びも候補なので結果は `initialHeight` 以下）にする。候補は区画の順を保ち各区画を幅 1〜3・開始の帯に割り当てるすべての組み合わせから、次アクションの幅が 2 未満のものを除く。比較は (a) 図の高さが最小、(b) 同じなら区画の順に先頭から、開始の帯が左（A が先）、それも同じなら幅が大きい方。要点 0 件の区画も高さに含める。テストは観測できる結果（`reflowed` と `initialHeight` の関係・初期の並び・図の高さ ≤ `initialHeight`・次アクション 2 列以上・重ならない・各区画は自分の高さ・決定的）を確かめ、比較の内側（最小性の細部・同点の選び方）は確かめない。
  - 決定的・冪等: 入力（区画の中身の量と区画の順）が同じなら、取込の経路（1 発言ずつ・ファイル取込）・履歴によらず `bands`・`cols`・`band`・`frame` は同じ。契機（要点の追加・高さが変わる編集・削除・振り分けの変更）がなければ（時間・再描画・保存・選択・同じ文字への編集）、すべての要素と枠の位置は変わらない。
- 座標は SVG の座標と同じ単位。`elements` はその区画の中に置かれた要素（リストの行・吹き出し・人物・表・矢印・絵記号・番号バッジなど）の**現在の表示位置**の外枠。
- `id` は図全体で一意で、同じ要素なら取込の前後で同じ（要点から作る要素は要点 id から決める）。
- 表と行のような親子は、子に `parent: <親の id>` を付ける（親子の包含は AC-430 (c) の重なりに含めない）。それ以外の 2 つの要素の外枠は重ならない。

## 時間（アニメーション。AC-669・AC-667 (f)）
- 要素の現在の表示位置は `options.now()` の時刻で決まる。位置が変わる要素は、移動の開始時刻から {PARAM-181}=600 ミリ秒以内に新しい位置へ着き、その間の時刻では途中の位置（古い位置と新しい位置の間）を返す。タイマーを使う実装は `options.scheduler.setTimeout` を使う（テストは `now` と `scheduler.advance` を同じ量だけ進める）。
- `options.env.reducedMotion === true` のときは、取込の直後から新しい位置を返す（途中の位置はない）。

## 取込
- 手入力（`setDraft`・`submitDraft`）・`importTextFile`（.txt。`CONTRACT.md`）・ライブ（`session.start` 後の `speechSource` の確定結果）は既存の契約のとおり。40 文字以下の発話は 1 要点（`CONTRACT.md`）。
- LLM 連携は既定のまま無効（同意なし）。このとき外部へのリクエスト（`fetch`・`XMLHttpRequest`・`WebSocket`・`EventSource`・`navigator.sendBeacon`）は 0 件。

## 固定の文字起こし（AC-667）
- `tests/system/fixtures/teama-meeting.txt`（23 発言。1 行 1 発言・各 24 文字以内）と、期待の区画の表 `tests/system/fixtures/teama-meeting.expected.json`。
- 期待の表は AC-665 の規則（(2) 決定事項 PARAM-126 → (3) 次アクション PARAM-129 → (4) 未決事項 PARAM-127・131 → (5) PARAM-178 の区画の順 → (6) 根拠 PARAM-132 → メモ・補足 → (7) 議論の流れ）を各発言の文字に当てはめたもの。各発言は規則の語の組のちょうど 1 つ（議論の流れの発言は 0）にだけ当たるよう作ってあり、種類（結論・行動・未決定・質問・根拠）の判定と区画の振り分けが食い違わない。テストが PARAM から作り直して一致を確かめる。

## 議論の流れのステップ（AC-667 (i)・AC-666。2026-11-05 追加）
- `flow` の区画の各ステップの部品は `<g data-board-step="<stepIndex>">` の子孫に置く（`stepIndex` は 1 始まりの整数。ステップごとに別の値。同じ値の `g` を部品ごとに複数置いてもよい）。そのステップの番号バッジ（`data-board-part="badge"`。番号の文字 ①②③… をこの要素の子孫の `<text>` に持つ）・吹き出し（`bubble`）・人物（`person`）は、この `g` の子孫に**部品ごとに 1 つの要素**として置く（1 つの部品に `data-board-part` を付ける要素は 1 つだけ）。ステップの最初の要点の `data-point-id` もこの `g` の子孫に置く。
- ステップの間の矢印（⇒）は `data-board-part="arrow"` に `data-between="<前の stepIndex>,<次の stepIndex>"` を付け、どのステップの `g` にも含めずに（`flow` の区画の中に）置く。隣り合うステップの組ごとに 1 つ。
- `getBoardModel()` の `elements` では、ステップの部品に `stepIndex`（数）を、ステップの間の矢印に `between: [前, 次]` を付ける。
- 別々のトピック（FR-025）の発言は別々のステップになる。テストは流れの 4 発言の前に `session.nextScene`（AC-008 の［次のシーン］）を実行して取り込む。
- シーンの区切りがない会議（AC-666。2026-11-05 追加）: ［次のシーン］なし（1 シーン）でも、同じステップの中で (1) 無音: 発話の受付時刻（`options.now()`）が直前の要点の発話と PARAM-190（10 秒）以上離れる、(2) 話題語の入れ替わり: 同じステップのそれまでの要点と異なる語句を PARAM-015（2 語）以上共有しない、のいずれかが成り立つ位置で次のステップに区切る（ちょうど 10 秒を含む。9 秒で話題語が同じなら区切らない）。区切りは要点が加わる時点で決まり、同じ発話列なら毎回同じ。テストは `setDraft`・`submitDraft` の間に `now` と `scheduler.advance` を同じ量だけ進めて受付時刻の差を作る（PARAM-002 の 20 秒より短くし、シーンは分かれない）。語句は空白区切りの英単語で作る（共有する語句の数え方が日本語の分かち書きに依存しないように）。
- 次アクションの表（AC-666）: `renderSvg()` の `actions` の区画の文字に「…」を含まず、24 文字（PARAM-165）以内の各要点の文字（内容・担当・期限）が全文描かれる（teama-meeting の 5 行）。次アクションの区画は常に 2 列以上（初期の並びは A と B にまたがる）。
- 図の高さ（AC-669 (7)(e)）: teama-meeting を取り込んだ後の図の高さ（`max(frame.y + frame.h) + 24`）は 913（PARAM-194）以下で、初期の並びのまま（`reflowed:false`。帯は上の `bands` の例のとおり）。15 の描画スタイルのどれでも ≤ 913。
- 区画の余白（AC-669 (2)(7)(b)。案 A）: 要点のある各区画の下の空きは枠の内側の余白（12）だけで、枠の高さの 20%（PARAM-188）以下。最も高い区画の除外はない。要素の間隔・表の行の高さは広げない（PARAM-189 は使わない）。詰め直しの後（アニメーションの完了後）と、全 15 の描画スタイルで成り立つ。

## 強調（AC-667 (h)。2026-11-05 追加）
- `data-board-part="emphasis"` の要素（マーカーの面・下線）には、`data-emph-word="<強調語>"` と `data-emph-start="<強調語の最初の文字の位置>"`（強調語を含む `<text>` の文字列（`textContent`）の中での 0 始まりの位置。UTF-16 の単位）を付ける。強調語の `<text>` は、強調の要素の祖先の `g` のどれかの子孫に置く（強調の要素の直近のまとまり）。
- テストは実ブラウザ（`tests/system/perf-util.js` の `launch`）で SVG を描き、`getExtentOfChar` で測った強調語の最初の文字の左端・最後の文字の右端と、強調の要素の `getBoundingClientRect()` の左端・右端を比べる（ずれはそれぞれ PARAM-187×その text の font-size 以下）。文字幅の見積もりで位置を決めず、表示に使われた書体で描いた結果に合うようにする。

## 人物の名前（AC-668・AC-671・AC-358・AC-680。2026-11-05 追加）
- 参加者名簿の入力: `app.setTitleInfo({ participants })`。`participants` は 1 行に 1 名の文字列（`\n` 区切り。配列も可）。既存の `theme`・`speaker` などの項目と同じ呼び出しで、渡さなかった項目は変えない。戻り値は `{ ok }`。`app.getTitleInfo().participants` は入力した文字列を返す。
- 名前の文字は `<text data-board-name="participant">`（参加メンバーの区画の名前。`members` の区画の中に、人物（`data-board-part="person"`）と組で、並びの順に文書の順で置く）と `<text data-board-name="speaker">`（議論の流れのステップの人物の名前）で描く。
- PNG（`canvasFactory` の `fillText`）・SVG・PDF（`/ActualText`）の保存にも、画面の図に載る名前を同じく含める（CONTRACT.md の書き出しの規則に名前の文字を加える）。テキスト一覧（`renderOutline()`）には AC-668 (d) の「参加メンバー: 名前、…」の行と「（発言: 名前）」を載せる。
- Markdown の保存（`save.markdown`。AC-529。2026-11-05 最終監査 202611050444 C-02）は名前の掲載がテキスト一覧と一致する: 名前を表示する間（`getHideNames() === false`）は、テキスト一覧と同じ「参加メンバー: 名前、…」の行と「（発言: 名前）」の添え書きが載る（行の頭の Markdown の記号を除いた文字が一覧の行と同じ）。オンのときと会議ボード型以外の型では載らない。
- 名前は LLM への送信（`options.relay` に渡す要求の全体）と `getImagePrompt()` の文字に含めない。`getImagePrompt({ mask })` は `mask` の値・名前を表示する設定（`getHideNames()`）・簡易マスキングの設定（`getLlmMasking()`）のどれによらず、「参加メンバー」の行・「（発言: 名前）」の添え書きを入れない（FR-078・AC-420）。
- 要点・見出しの文字の中に現れる参加者名簿と話者タグの名前は、簡易マスキングの設定（`setLlmMasking(false)` でも）と注意の伏せ字の選択（`mask:false` でも）によらず、LLM へ送る前（`/api/llm/extract` の `body.input`）と `getImagePrompt()`（内容と文字の部分の列挙）で、常に AC-359 と同じ伏せ字に置き換える（要点ごと除くのではない。AC-358・AC-359・AC-471・AC-668 (e)。最終監査 202611050444 C-03）。

## 名前を表示しない（AC-680。2026-11-05 追加）
- `app.getHideNames()` → 真偽値（既定 `false`＝名前を表示する）。`app.setHideNames(on)` → `{ ok }`。`on` が真偽値でないときは `{ ok:false }` で、直前の値を保つ。
- ［設定］の項目 `board.hideNames`（`getSettingsDialog().fields` の `{ id:'board.hideNames', value:<真偽値>, label, description }`。ラベルは ja「名前を隠す」・en "Hide names"（AC-680）で PARAM-011 以内。`description`・`accessibleName`・`tooltip.text` のいずれかに「名前を表示しない」を含む）。コマンド `settings.hideNames` は［設定］を開いてこの項目にフォーカスし（`getSettingsDialog().focusedField === 'board.hideNames'`）、`handleKey({ key: ' ' })` で切り替わる。
- 値は端末ごとの設定（`options.storage`）に保存され、再生成（再読込）後も保たれ、`data.reset`・`loadSessionFile` では変わらず、セッションファイルに含めない（`hideNames` などの項目名も出さない）。
- オンのとき、`data-board-name` の文字を図・テキスト一覧・PNG・SVG・PDF・Markdown のどれにも出さない（人物の絵記号は残す）。名簿の入力と話者タグの名前の保持は消さない。切り替えの値によらず、LLM への送信と `getImagePrompt()` に名前は入らない（上の「人物の名前」）。
