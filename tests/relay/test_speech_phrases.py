"""FR-093 AC-551: x-grp-phrases ヘッダーの解析と上限（上流には通信しない）。"""
import json
import os
import sys
from urllib.parse import quote

import pytest

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


class Fake:
    """上流の差し替え。fast=(status, body) か 'fail'。"""

    def __init__(self, fast):
        self.fast, self.calls = fast, []

    def __call__(self, base, host, method, path, headers, body, deadline):
        self.calls.append({"host": host, "path": path, "headers": headers, "body": body})
        if path.endswith("/issueToken"):
            return 200, b"DUMMY-TOKEN"
        if path.startswith("/speechtotext/"):
            if self.fast == "fail":
                raise sp._Fail("network")
            return self.fast
        return 200, json.dumps({"RecognitionStatus": "Success", "DisplayText": "REST-TEXT"}).encode()


def setup_fake(tmp_path, monkeypatch, fast):
    monkeypatch.setenv("RELAY_SPEECH_STORE", str(tmp_path / "s.json"))
    monkeypatch.delenv("RELAY_ALLOW_LOOPBACK_UPSTREAM", raising=False)
    monkeypatch.delenv("RELAY_SPEECH_UPSTREAM", raising=False)
    sp._forget_token()
    up = Fake(fast)
    monkeypatch.setattr(sp, "_request", up)
    sp.save_settings({"endpoint": "japaneast", "key": "DUMMY-UNIT-KEY-0001"})
    return up


# FR-093 AC-551
def test_build_fast_request_multipart_and_definition():
    ctype, body = sp.build_fast_request("ja-JP", b"RIFFwav", ["カプセル", "API"], boundary="BND")
    assert ctype == "multipart/form-data; boundary=BND"
    parts = body.split(b"--BND")
    audio = [p for p in parts if b'name="audio"' in p][0]
    assert b"RIFFwav" in audio
    d = [p for p in parts if b'name="definition"' in p][0].split(b"\r\n\r\n", 1)[1].rstrip(b"\r\n")
    assert json.loads(d.decode("utf-8")) == {"locales": ["ja-JP"], "phraseList": {"phrases": ["カプセル", "API"]}}
    assert body.endswith(b"--BND--\r\n")


# FR-093 AC-551
def test_fast_response_conversion():
    ok = json.dumps({"combinedPhrases": [{"text": "全文"}], "phrases": [{"text": "x"}]}).encode()
    assert sp.parse_fast_response(ok) == "全文"
    assert sp.parse_fast_response(json.dumps({"phrases": [{"text": "あ"}, {"text": "い"}]}).encode()) == "あい"
    assert sp.parse_fast_response(b"notjson") is None
    assert sp.parse_fast_response(b"[]") is None


# FR-093 AC-551
def test_recognize_with_phrases_uses_fast_api(tmp_path, monkeypatch):
    up = setup_fake(tmp_path, monkeypatch, (200, json.dumps({"combinedPhrases": [{"text": "FAST"}]}).encode()))
    status, body = sp.recognize("ja-JP", b"RIFF", ["語1"])
    assert body == {"ok": True, "result": "success", "text": "FAST"}
    fast = [c for c in up.calls if c["path"].startswith("/speechtotext/")]
    assert len(fast) == 1
    assert fast[0]["path"] == "/speechtotext/transcriptions:transcribe?api-version=2025-10-15"
    assert fast[0]["host"] == "japaneast.api.cognitive.microsoft.com"
    assert fast[0]["headers"]["Ocp-Apim-Subscription-Key"] == "DUMMY-UNIT-KEY-0001"
    assert fast[0]["headers"]["Content-Type"].startswith("multipart/form-data; boundary=")
    assert not any("phraseList" in c["path"] for c in up.calls)


# FR-093 AC-551
@pytest.mark.parametrize("fast", [(404, b"nf"), (400, b"bad"), "fail", (200, b"garbage")])
def test_recognize_falls_back_to_rest_on_failure(tmp_path, monkeypatch, fast):
    up = setup_fake(tmp_path, monkeypatch, fast)
    status, body = sp.recognize("ja-JP", b"RIFF", ["語1"])
    assert body == {"ok": True, "result": "success", "text": "REST-TEXT"}
    rest = [c for c in up.calls if c["host"].endswith(".stt.speech.microsoft.com")]
    assert len(rest) == 1 and "phraseList" not in rest[0]["path"]


# FR-093 AC-551
def test_recognize_without_phrases_skips_fast_api(tmp_path, monkeypatch):
    up = setup_fake(tmp_path, monkeypatch, (200, b"{}"))
    assert sp.recognize("ja-JP", b"RIFF", [])[1]["text"] == "REST-TEXT"
    assert not any(c["path"].startswith("/speechtotext/") for c in up.calls)


# FR-093 AC-551
def test_parse_phrases_limits():
    many = ["w%d" % i for i in range(300)]
    assert len(sp.parse_phrases(enc(many))) == sp.PHRASE_MAX_COUNT
    got = sp.parse_phrases(enc(["x" * (sp.PHRASE_MAX_LEN + 1), "ok", "ok", "", 5, "a\nb"]))
    assert got == ["ok"]
