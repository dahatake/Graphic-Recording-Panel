# LLM 方式1・方式2（FR-063・FR-064・FR-065・NFR-SEC-004）System Test の契約（part 2/3）

`tests/system/llm-draw.test.js` が前提にするアプリの公開 API。期待値は受入基準だけから決め、ここに書くのは「どこを通して観察するか」だけである。
有効化・同意・中継サーバーの注入（`options.relay`、`requestLlmEnable`、`answerLlmConsent`、`flushLlm`、`getLlmState`）は
`CONTRACT-LLM-FR062.md`（part 1/3）に従う。実 Foundry は呼ばない。API キーの実値はテストに書かない。
ほかの part が同じ名前を別の形で定義した場合は、conductor が競合として調整する。

## 抽出（方式1）: `POST /api/llm/extract`
- 要求 body: `{ utterance: string, points: string[], lang: 'ja'|'en', allowSvg: boolean }`（`allowSvg` は方式2 がオンのときだけ true。SVG の生成を求めない）
- 応答 body（モック）: `{ objects:[{key,label?}], people:[{hair,hairColor,outfit,expression}], emotions:[{key}], metaphors:[{key}] }`
  - `key` は同梱部品の部品キー。応答は検証を通ったものだけが使われる。

## 方式2: `POST /api/llm/svg`
- 要求 body: `{ key: string, label: string }`。応答 body: `{ svg: string }`。方式2 がオフなら 0 件、同梱部品がある物体でも 0 件。

## 同梱部品
- `app.getPartKeys()` → `string[]`（同梱部品の部品キー。1 点以上）
- `app.getPartInfo(key)` → `{ key, label }`（`label` は表示言語での物の名前）

## 図・一覧・保存
- `app.renderSvg()` は、対応づけられた部品を `<g data-part-key="<key>">` として含む（その部品の SVG を子に持つ）。
- `app.renderOutline()` は、対応づけられた部品の `label` を含む。
- SVG の保存（`save.svg`）は `renderSvg()` と同内容。PNG の保存は `canvasFactory` の 2D コンテキストの `drawImage` を部品ごとに 1 回以上呼ぶ。
  PDF の保存は部品の絵を内容に含む（部品がないときの PDF と内容が異なる）。

## 方式2 の切替
- `app.getLlmState().svgGeneration: boolean`（既定 false）、`app.setLlmSvgGeneration(bool)`。

## 即時性（AC-323）
- 発話（`submitDraft` の成功）の直後、LLM の応答を待たずに `renderSvg()` にルールベース描画（発話の要点の文字）が出る。
  応答の到着後（`flushLlm`）に絵が加わる。時刻は `options.now` と `options.scheduler` だけで計る。
