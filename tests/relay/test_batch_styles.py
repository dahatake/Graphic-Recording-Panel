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
