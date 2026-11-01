"""FR-093 AC-551: x-grp-phrases ヘッダーの解析と上限（上流には通信しない）。"""
import json
import os
import sys
from urllib.parse import quote

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "server"))

import relay_speech as sp  # noqa: E402


def enc(v):
    return quote(json.dumps(v, ensure_ascii=False), safe="")


# FR-093 AC-551
def test_parse_phrases_decodes_utf8_json():
    assert sp.parse_phrases(enc(["カプセル", "API"])) == ["カプセル", "API"]


# FR-093 AC-551
def test_parse_phrases_ignores_invalid():
    for bad in ["", None, "%E0%A4%A", "notjson", enc({"a": 1}), enc("x"), "a" * (sp.PHRASE_HEADER_MAX + 1)]:
        assert sp.parse_phrases(bad) == []


# FR-093 AC-551
def test_parse_phrases_limits():
    many = ["w%d" % i for i in range(300)]
    assert len(sp.parse_phrases(enc(many))) == sp.PHRASE_MAX_COUNT
    got = sp.parse_phrases(enc(["x" * (sp.PHRASE_MAX_LEN + 1), "ok", "ok", "", 5, "a\nb"]))
    assert got == ["ok"]
