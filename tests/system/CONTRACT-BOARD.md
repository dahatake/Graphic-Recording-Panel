# 契約: 会議ボード型（FR-114。AC-667 の System Test が実装を観察するための口。test-designer が置き、実装役が従う）

期待値は要求定義書（FR-114・AC-664〜AC-667・AC-669、PARAM-007・088・126・127・129・131・132・158・165・178〜181・001・104）だけから決めています。
既存の契約（`CONTRACT.md`「レイアウト型・描画スタイル・設定画面」、`CONTRACT-STYLE-PRESET.md`、`CONTRACT-LIVE-EXPORT.md`）は変えず、ここに書いたものを加えます。

## 型の識別子
- 型 id は `board`（FR-027 の 7 つ目。コマンドは `layoutType.board`）。`setLayoutTypes(['board'])` で選べ、先頭の型のとき `renderSvg()` のルートに `data-layout-head="board"`。

## 区画の識別子（9 つ。FR-114 の列挙の順）
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
  sections: [{ id, frame: { x, y, w, h }, elements: [{ id, part, x, y, w, h, parent? }] }],
  assigned: [{ pointId, section }]        // 要点ごとの振り分け（AC-665）
}
```
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
