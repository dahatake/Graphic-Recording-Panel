"""FR-093 AC-551: Azure Speech の認識の上流への要求に用語集の語が含まれない（ヘッダー・本文・URL）。上流には通信しない。"""
import inspect
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "server"))

import relay_speech as sp  # noqa: E402

GLOSSARY = ["カプセル", "くべるねてす", "Kubernetes"]


class Fake:
    def __init__(self):
        self.calls = []

    def __call__(self, base, host, method, path, headers, body, deadline):
        self.calls.append({"host": host, "path": path, "headers": headers, "body": body})
        if path.endswith("/issueToken"):
            return 200, b"DUMMY-TOKEN"
        return 200, json.dumps({"RecognitionStatus": "Success", "DisplayText": "REST-TEXT"}).encode()


def _setup(tmp_path, monkeypatch):
    monkeypatch.setenv("RELAY_SPEECH_STORE", str(tmp_path / "s.json"))
    monkeypatch.delenv("RELAY_ALLOW_LOOPBACK_UPSTREAM", raising=False)
    monkeypatch.delenv("RELAY_SPEECH_UPSTREAM", raising=False)
    sp._forget_token()
    up = Fake()
    monkeypatch.setattr(sp, "_request", up)
    sp.save_settings({"endpoint": "japaneast", "key": "DUMMY-UNIT-KEY-0001"})
    return up


# FR-093 AC-551
def test_recognize_has_no_phrases_parameter_and_no_fast_api():
    assert list(inspect.signature(sp.recognize).parameters) == ["language", "audio"]
    for name in ("parse_phrases", "build_fast_request", "parse_fast_response", "_recognize_fast", "FAST_PATH", "PHRASE_HEADER_MAX"):
        assert not hasattr(sp, name), name


# FR-093 AC-551
def test_upstream_request_contains_no_glossary_word(tmp_path, monkeypatch):
    up = _setup(tmp_path, monkeypatch)
    status, body = sp.recognize("ja-JP", b"RIFF", )
    assert body == {"ok": True, "result": "success", "text": "REST-TEXT"}
    assert not any(c["path"].startswith("/speechtotext/") for c in up.calls)
    for c in up.calls:
        blob = (c["path"] + json.dumps(c["headers"], ensure_ascii=False)).encode("utf-8") + (c["body"] or b"")
        for w in GLOSSARY:
            assert w.encode("utf-8") not in blob
        assert b"phraseList" not in blob and b"x-grp-phrases" not in blob.lower()


# FR-093 AC-551
def test_relay_handler_does_not_read_phrases_header():
    src = open(os.path.join(os.path.dirname(__file__), "..", "..", "server", "relay.py"), encoding="utf-8").read()
    assert "x-grp-phrases" not in src.lower() and "parse_phrases" not in src
