"""FR-119 グラレコスタイルの LLM への指示（Prompt）の固定文。

Prompt 本文はアプリが独自に書いた固定文で、端末（クライアント）には置かない。端末が送るのは styleId だけで、
中継サーバーがここから引いて付与する（AC-690・AC-695・AC-358）。同じ (style_id, lang) からは毎回同じ文面で、
会議の内容・利用者の入力・URL・端末の情報・出典の URL・作者名・サービス名を含まない（AC-698）。
収集元の文面は転載しない（要旨と分類だけを使う）。スタイルは INSTRUCTIONS に足すだけで増やせる。
各指示は、画風・構成の方針・文字の規則（図に出す文言は描かれた物の名前で短く）を含む。
"""
from __future__ import annotations

import re

MAX_LEN = {"ja": 600, "en": 1200}  # PARAM-199（日本語 600 文字。英語は半角で 2 倍）
LANGS = ("ja", "en")
DEFAULT_LANG = "ja"

_TEXT_JA = "図に出す文言は、描かれた物の名前にして短く書く。長い文は使わない。"
_TEXT_EN = "Keep every label in the figure short, and name the drawn object. Do not use long sentences."

INSTRUCTIONS: dict[str, dict[str, str]] = {
    "talk": {
        "ja": "画風は、黄と黒を基調にした温かい手書き風。構成は時間の流れに沿うタイムライン型で、話の順に要点を並べ、原因と結果や課題と提案は矢印でつなぐ。冒頭と結論は目立たせる。" + _TEXT_JA,
        "en": "Style: warm hand-drawn look based on yellow and black. Structure: a timeline that follows the order of the talk; connect cause and effect or problem and proposal with arrows, and make the opening and the conclusion stand out. " + _TEXT_EN,
    },
    "dialogue": {
        "ja": "画風は、暖色のカードを重ねた柔らかい見た目。構成は吹き出し型で、質問と答えの関係を保って重ねてつなぎ、話題が変わるところには余白を置く。感情を表す語は目立たせる。" + _TEXT_JA,
        "en": "Style: soft look with stacked warm-colored cards. Structure: speech bubbles that keep the relation between question and answer, with blank space where the topic changes. Emphasize words that express emotion. " + _TEXT_EN,
    },
    "brainstorm": {
        "ja": "画風は、付箋を貼ったボード風。構成は発散型で、中央にテーマを置き、意見は取捨選択せず平等に周りへ置く。同じ種類の意見は囲んでまとめ、共感の多い意見は強調する。" + _TEXT_JA,
        "en": "Style: a board covered with sticky notes. Structure: diverging layout with the theme in the center; place every idea around it equally without filtering. Enclose ideas of the same kind and emphasize the ones many people agree with. " + _TEXT_EN,
    },
    "keypoints": {
        "ja": "画風は、すっきりしたミント色の整ったノート風。構成は区画型で、論点の数を数え、2〜4 の区画に分ける。1 区画に 1 つの見出しと短い要点だけを置く。" + _TEXT_JA,
        "en": "Style: tidy notebook look in fresh mint tones. Structure: sections; count the issues and split them into 2 to 4 sections, each with one heading and a short key point. " + _TEXT_EN,
    },
    "journey": {
        "ja": "画風は、クラフト紙に描いた素朴な見た目。構成は比喩型で、道・山・橋・太陽などのたとえを 1 つ選び、その上に課題から成果へ向かう道のりとして内容を置く。" + _TEXT_JA,
        "en": "Style: plain look drawn on kraft paper. Structure: a metaphor; choose one image such as a road, mountain, bridge or sun and place the content on it as a journey from problems to results. " + _TEXT_EN,
    },
    "notes": {
        "ja": "画風は、黒板に色チョークで書いたような見た目。構成は順を追って書き留める流れで、学んだことを見出しと短い文で並べ、重要な語は強調する。" + _TEXT_JA,
        "en": "Style: looks like colored chalk on a blackboard. Structure: write things down step by step; list what was learned with headings and short sentences, and emphasize the important words. " + _TEXT_EN,
    },
    "wsboard": {
        "ja": "画風は、色鉛筆で描いたやわらかい線のボード風。構成は区画型で、課題・摩擦・判断・次の一歩などの視点ごとに区画を分けて整理する。未解決の問いは 1 区画につき 1 つまでにする。" + _TEXT_JA,
        "en": "Style: board drawn with soft colored-pencil lines. Structure: sections divided by viewpoints such as issue, friction, decision and next step. Put at most one unresolved question in each section. " + _TEXT_EN,
    },
    "biz": {
        "ja": "画風は、余白を生かした簡潔で洗練されたビジネス資料風。構成は結論を先に置くタイムライン型で、階層をはっきりさせる。色は意味（構造・流れ・課題）で使い分ける。" + _TEXT_JA,
        "en": "Style: concise, refined business brief with generous margins. Structure: a timeline that puts the conclusion first and makes the hierarchy clear. Use color by meaning (structure, flow, issue). " + _TEXT_EN,
    },
}


# ---- 抽出・SVG 生成の固定の指示（FR-063・FR-065。AC-358・AC-690: 端末は Prompt 本文を送らず、ここで付与する） ----
# 汎用キャラの属性と区画 ID は web/src/parts.js・board.js の定義と同じ（tests/relay/test_batch_styles.py が一致を検査する）。
CHARACTER_OPTIONS = {
    "hair": ["short", "long", "bob", "ponytail", "spiky", "bun"],
    "hairColor": ["black", "brown", "blonde", "red", "blue", "gray"],
    "outfit": ["shirt", "suit", "dress", "hoodie", "uniform", "apron"],
    "expression": ["neutral", "confused", "trouble", "anxious", "angry", "happy", "idea", "surprised", "tired"],
}
SECTION_IDS = ["purpose", "members", "flow", "decisions", "open", "themes", "vision", "actions", "memo"]
_KEY_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")
MAX_PART_KEYS = 500


def _part_keys(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [k for k in value[:MAX_PART_KEYS] if isinstance(k, str) and _KEY_RE.match(k)]


def extract_instruction(part_keys=None, allow_svg: bool = False) -> str:
    """要点から描く物を抽出するための固定の指示（会議の内容を含まない）。部品キーの候補は端末の一覧（検査済み）。"""
    emotions = "|".join(e for e in CHARACTER_OPTIONS["expression"] if e != "neutral")
    text = (
        "You extract what to draw from key points of a conversation. Reply with one JSON object only: "
        '{"objects":[{"key"}],"people":[{"hair","hairColor","outfit","expression"}],"emotions":[{"key"}],"metaphors":[{"key"}]}. '
        f'"key" of objects and metaphors must be one of these part keys: {", ".join(_part_keys(part_keys))}. '
        f'people use only: hair {"|".join(CHARACTER_OPTIONS["hair"])}; hairColor {"|".join(CHARACTER_OPTIONS["hairColor"])}; '
        f'outfit {"|".join(CHARACTER_OPTIONS["outfit"])}; expression {"|".join(CHARACTER_OPTIONS["expression"])}. '
        f"emotions keys: {emotions}. Never include names of real people."
    )
    if allow_svg:
        text += ' For an object that has no suitable part, use key "other" and give a short "label" naming it.'
    text += (' Lines after the first line are key points numbered from 1. Optionally add '
             '"sections":[{"point":<number>,"section":"<id>","emphasis":"<one word from the point>"}] '
             f'where id is one of: {"|".join(SECTION_IDS)}.')
    return text


def svg_instruction(label) -> str:
    name = re.sub(r"[\"\\\u0000-\u001f<>&]", " ", label if isinstance(label, str) else "")[:48].strip()
    return (f'Draw "{name}" as one simple flat icon SVG (viewBox 0 0 48 48). Use only svg, g, path, circle, ellipse, rect, line, '
            "polyline, polygon, text. No script, no external references. Reply with the <svg> only.")


def compose_instructions(kind: str, payload: dict):
    """中継サーバーが付与する指示。kind は 'extract' / 'svg'。戻り値は (指示 | None, エラー文 | None)。
    styleId は取り除く（上流へ送らない）。未定義の styleId は拒否する（AC-690）。"""
    style_id = payload.pop("styleId", None)
    payload.pop("styleName", None)
    lang = payload.pop("lang", None)
    if style_id is not None and instruction_for(style_id) is None:
        return None, "未定義のスタイルです。"
    if kind == "svg":
        return svg_instruction(payload.get("label") or payload.get("input")), None
    text = extract_instruction(payload.get("partKeys"), payload.get("allowSvg") is True)
    if style_id is not None:
        text += " " + instruction_for(style_id, lang if isinstance(lang, str) else DEFAULT_LANG)
    return text, None


def style_ids() -> list[str]:
    return list(INSTRUCTIONS)


def instruction_for(style_id, lang: str = DEFAULT_LANG):
    """styleId と表示言語から固定の指示文を返す。未知の ID は None（呼び出し側が 400 にする）。
    未対応の言語は日本語にする。"""
    if not isinstance(style_id, str) or style_id not in INSTRUCTIONS:
        return None
    return INSTRUCTIONS[style_id].get(lang if lang in LANGS else DEFAULT_LANG)
