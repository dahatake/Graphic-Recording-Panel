"""FR-119 グラレコスタイルの固定 Prompt（AC-695・AC-698）の単体テスト。"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "server"))
import batch_styles as bs  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
IDS = ["talk", "dialogue", "brainstorm", "keypoints", "journey", "notes", "wsboard", "biz"]


def test_ac695_all_styles_fixed_and_deterministic():
    assert bs.style_ids() == IDS
    for sid in IDS:
        for lang in ("ja", "en"):
            a, b = bs.instruction_for(sid, lang), bs.instruction_for(sid, lang)
            assert a and a == b
            assert len(a) <= bs.MAX_LEN[lang]  # PARAM-199
            assert not re.search(r"https?://|www\.", a)
    assert bs.instruction_for("nope") is None and bs.instruction_for(None) is None


def test_ac695_contains_style_structure_and_text_rule():
    for sid in IDS:
        ja = bs.instruction_for(sid, "ja")
        assert "画風" in ja and "構成" in ja and "短く" in ja
        en = bs.instruction_for(sid, "en")
        assert "Style" in en and "Structure" in en and "short" in en


def test_ac698_no_source_names_and_no_long_overlap_with_sources():
    names = ["ai-nante", "nano banana", "riko-a", "buntobi", "SRC-", "SKILL", "Nano Banana"]
    text = open(os.path.join(ROOT, "docs", "requirements-definition.md"), encoding="utf-8").read()
    srcs = [ln for ln in text.splitlines() if re.match(r"\| SRC-(060|061|062|090) \|", ln)]
    assert srcs
    for sid in IDS:
        for lang in ("ja", "en"):
            ins = bs.instruction_for(sid, lang)
            assert not any(n.lower() in ins.lower() for n in names)
            n = 20 if lang == "ja" else 40  # PARAM-200（英語は半角で 2 倍）
            for i in range(len(ins) - n):
                assert ins[i:i + n + 1] not in "".join(srcs), (sid, lang, ins[i:i + n + 1])


# FR-118 AC-690: 抽出・SVG 生成の固定の指示（サーバー側）。汎用キャラの属性・区画 ID は web/src の定義と一致する。会議の内容・styleId の本文を含まない
def test_fr118_ac690_extract_instruction_matches_client_definitions():
    parts = open(os.path.join(ROOT, "web", "src", "parts.js"), encoding="utf-8").read()
    board = open(os.path.join(ROOT, "web", "src", "board.js"), encoding="utf-8").read()
    for key, values in bs.CHARACTER_OPTIONS.items():
        if key == "expression":
            continue
        assert re.search(r"%s: Object\.freeze\(\[%s\]\)" % (key, ", ".join("'%s'" % v for v in values)), parts), key
    ids = re.findall(r"\{ id: '(\w+)', ja: '[^']*', en: '[^']*', icon: '\w+' \}", board)
    assert ids[-9:] == bs.SECTION_IDS
    ins = bs.extract_instruction(["cloud", "tree", "bad key<", 3], allow_svg=True)
    assert "cloud, tree" in ins and "bad key" not in ins and "other" in ins
    assert "purpose|members|flow|decisions|open|themes|vision|actions|memo" in ins


def test_fr118_ac690_compose_instructions_rejects_unknown_style_and_drops_fields():
    payload = {"input": "x", "styleId": "talk", "styleName": "講演まとめ", "lang": "en", "partKeys": ["cloud"]}
    text, err = bs.compose_instructions("extract", payload)
    assert err is None and text.endswith(bs.instruction_for("talk", "en"))
    assert not {"styleId", "styleName", "lang"} & set(payload), "上流へ送らない項目は取り除く"
    assert bs.compose_instructions("extract", {"styleId": "nosuch"}) == (None, "未定義のスタイルです。")
    plain, err = bs.compose_instructions("extract", {"input": "x", "partKeys": ["cloud"]})
    assert err is None and not any(bs.instruction_for(s, "ja") in plain for s in bs.style_ids())
    svg, _ = bs.compose_instructions("svg", {"label": 'a"b<c>\n'})
    assert 'Draw "a b c' in svg and "<c>" not in svg