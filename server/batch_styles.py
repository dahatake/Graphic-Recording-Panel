"""FR-119 グラレコスタイルの LLM への指示（Prompt）の固定文。

Prompt 本文はアプリが独自に書いた固定文で、端末（クライアント）には置かない。端末が送るのは styleId だけで、
中継サーバーがここから引いて付与する（AC-690・AC-695・AC-358）。同じ (style_id, lang) からは毎回同じ文面で、
会議の内容・利用者の入力・URL・端末の情報・出典の URL・作者名・サービス名を含まない（AC-698）。
収集元の文面は転載しない（要旨と分類だけを使う）。スタイルは INSTRUCTIONS に足すだけで増やせる。
各指示は、画風・構成の方針・文字の規則（図に出す文言は描かれた物の名前で短く）を含む。
"""
from __future__ import annotations

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


def style_ids() -> list[str]:
    return list(INSTRUCTIONS)


def instruction_for(style_id, lang: str = DEFAULT_LANG):
    """styleId と表示言語から固定の指示文を返す。未知の ID は None（呼び出し側が 400 にする）。
    未対応の言語は日本語にする。"""
    if not isinstance(style_id, str) or style_id not in INSTRUCTIONS:
        return None
    return INSTRUCTIONS[style_id].get(lang if lang in LANGS else DEFAULT_LANG)
