# LLM 同意の永続化・送信内容（AC-311・312・358〜360・366・367・334）System Test の契約

`tests/system/llm-consent-persist.test.js` が前提にする観察点。CONTRACT-LLM-FR062.md・CONTRACT-LLM-FR063.md に追加する（上書きではない）。
期待値は受入基準だけから決め、ここには「どこを通して観察するか」だけを書く。ずれは conductor が競合として調整する。

## 同意の保存（AC-312・366・367）
- 保存先は `options.storage` の `grp.llm.consent` だけ。値は JSON `{ "version": string(非空), "at": number }` の 2 項目だけ（同意した時点の送信内容の版・同意日時。存在＝同意済み。有効フラグ・キー・会話内容は持たない）。
- 同意（`answerLlmConsent(true)`）で作られ、`disableLlm()` で削除される。拒否・Esc では作られない。
- `createApp` は生成時にこの記録を読む。記録があり、版が現在の送信内容の版と一致し、AC-313 の設定が揃っているときだけ有効。版の欠落・空・JSON の破損・不一致は無効（再同意が必要）で、例外にしない。
- 再読込 = 同じ `storage` で `createApp` を呼び直す。`file.save` の `data`・`renderSvg()` に同意の情報を含めない。

## 送信内容（AC-358）
- `POST /api/llm/extract` の body は次の項目だけを持つ: `input`（要点の文字。マスキング後）、`scene`（シーン番号。1 始まりの数値）、`drawStyle`（描画スタイルの id）、`partKeys`（部品キーの候補一覧。`getPartKeys()` の部分集合）。そのほか実装が加える固定の指示文は可。
- 会話の原文・音声・ファイルの全文・セッションファイル・端末やブラウザの識別情報に当たる項目名（`utterance`・`transcript`・`audio`・`session`・`file`・`userAgent` など）は持たない。

## 直近の送信内容・マスキング（AC-311・359・360）
- `app.getLlmLastSent()` → 有効のとき直近 1 回分 `{ text, ... }`（マスキング後）、無効・未送信・再読込後は `null`。保存しない。
- `app.getLlmMasking()`（既定 true）／`app.setLlmMasking(bool)`／`app.setLlmMaskWords(string[])`。設定画面の `fields` の `id: 'llm.mask'`（`value`、`note`）を Enter で切り替えられる。

## 生成 SVG の保存（AC-334）
- `file.save` の `data` は JSON で `generatedSvgs: [{ sceneId, label, svg }]`（サニタイズ済み）を持つ。読込（`loadSessionFile`）後は LLM 連携が無効でも同じ絵が `renderSvg()` に出る。読込時に再サニタイズする。
