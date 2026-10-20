"""Azure Speech の中継（server/relay_speech.py）の単体テスト（FR-082 / NFR-SEC-005）。上流には通信しない（_request を差し替える）。"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "server"))

import relay_speech as sp  # noqa: E402

DUMMY_KEY = "DUMMY-UNIT-SPEECH-KEY-0001"
CUSTOM = "https://contoso-dummy-unit.cognitiveservices.azure.com"


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / "azure-speech.store.json"
    monkeypatch.setenv("RELAY_SPEECH_STORE", str(path))
    monkeypatch.delenv("RELAY_ALLOW_LOOPBACK_UPSTREAM", raising=False)
    monkeypatch.delenv("RELAY_SPEECH_UPSTREAM", raising=False)
    monkeypatch.delenv("RELAY_SPEECH_TOKEN_TTL_SEC", raising=False)
    sp._forget_token()
    return path


# FR-082 AC-449
@pytest.mark.parametrize("text,kind,host", [
    (CUSTOM, "custom", "contoso-dummy-unit.cognitiveservices.azure.com"),
    (CUSTOM + "/", "custom", "contoso-dummy-unit.cognitiveservices.azure.com"),
    ("japaneast", "region", "japaneast.stt.speech.microsoft.com"),
    ("https://westus2.api.cognitive.microsoft.com", "region", "westus2.stt.speech.microsoft.com"),
    ("https://westus2.stt.speech.microsoft.com", "region", "westus2.stt.speech.microsoft.com"),
])
def test_fr082_ac449_accepts_azure_speech_domains_and_regions(text, kind, host):
    ep = sp.parse_endpoint(text, False)
    assert ep and ep["kind"] == kind and ep["host"] == host


# FR-082 AC-449 異常系
@pytest.mark.parametrize("text", [
    "http://contoso-dummy.cognitiveservices.azure.com", "https://evil.example.com", "https://cognitiveservices.azure.com",
    "https://x.cognitiveservices.azure.com.evil.example.com", "https://203.0.113.10", "https://127.0.0.1", "https://localhost",
    "https://[::1]", "https://10.0.0.5", "https://169.254.169.254", "http://127.0.0.1:9", "Japan East", "JAPANEAST",
    "japan-east", "japaneast.evil", "../etc", "", "   ", "ftp://x.cognitiveservices.azure.com",
    "https://user:pw@x.cognitiveservices.azure.com", "https://x.cognitiveservices.azure.com:8443",
    "https://x.cognitiveservices.azure.com/path", "https://x.cognitiveservices.azure.com/?q=1", "https://-x.cognitiveservices.azure.com",
    "https://evil.example.api.cognitive.microsoft.com", None, 123,
])
def test_fr082_ac449_rejects_other_endpoints(text):
    assert sp.parse_endpoint(text, False) is None


# FR-082 AC-449 ループバックのモックはテスト専用の設定がオンのときだけ
def test_fr082_ac449_loopback_only_with_test_flag(store, monkeypatch):
    assert sp.parse_endpoint("http://127.0.0.1:5000", False) is None
    assert sp.parse_endpoint("http://127.0.0.1:5000", True)["kind"] == "loopback"
    status, body = sp.save_settings({"endpoint": "http://127.0.0.1:5000", "allowLoopback": True})
    assert status == 400 and body["result"] == "invalid"
    monkeypatch.setenv("RELAY_ALLOW_LOOPBACK_UPSTREAM", "1")
    assert sp.save_settings({"endpoint": "http://127.0.0.1:5000"})[0] == 200


# FR-082 AC-449 異常系: 不正な値では保存済みの設定が変わらない
def test_fr082_ac449_invalid_does_not_change_saved_settings(store):
    assert sp.save_settings({"endpoint": CUSTOM, "key": DUMMY_KEY})[0] == 200
    before = store.read_bytes()
    for body in ({"endpoint": "https://evil.example.com", "key": "OTHER-DUMMY"}, {"key": "bad key with spaces"}, {"key": 5}, "x", None):
        status, payload = sp.save_settings(body)
        assert status == 400 and payload["ok"] is False and payload["reason"]
    assert store.read_bytes() == before


# FR-082 AC-448 変更（置き換え）・エンドポイントだけの保存・削除はエンドポイントを残す
def test_fr082_ac448_replace_key_keep_endpoint_and_delete(store):
    sp.save_settings({"endpoint": "japaneast", "key": DUMMY_KEY})
    sp.save_settings({"key": "DUMMY-UNIT-SPEECH-KEY-0002"})
    assert sp.load().key == "DUMMY-UNIT-SPEECH-KEY-0002"
    sp.save_settings({"endpoint": CUSTOM})
    cfg = sp.load()
    assert cfg.endpoint == CUSTOM and cfg.key == "DUMMY-UNIT-SPEECH-KEY-0002"
    status, body = sp.delete_key()
    assert status == 200 and body == {"ok": True, "result": "deleted", "endpointHost": "contoso-dummy-unit.cognitiveservices.azure.com", "keyConfigured": False}
    assert sp.load().key is None and sp.load().endpoint == CUSTOM


# NFR-SEC-005 AC-454
def test_nfrsec005_ac454_store_is_protected(store):
    sp.save_settings({"endpoint": CUSTOM, "key": DUMMY_KEY})
    raw = store.read_bytes()
    assert DUMMY_KEY.encode() not in raw
    data = json.loads(raw)
    if sys.platform == "win32":
        assert data["key"]["scheme"] == "dpapi"
        assert DUMMY_KEY.encode("utf-16le") not in raw
    else:
        assert (os.stat(store).st_mode & 0o777) == 0o600
    assert sp.load().key == DUMMY_KEY, "再起動後（読み直し）も同じキー"
    assert not [p for p in os.listdir(store.parent) if p.endswith(".tmp")], "一時ファイルを残さない"


# NFR-SEC-005 AC-454 既定の保管先はリポジトリの config の下（.gitignore 済み）
def test_nfrsec005_ac454_default_store_path(monkeypatch):
    monkeypatch.delenv("RELAY_SPEECH_STORE", raising=False)
    assert sp.store_path().replace("\\", "/").endswith("config/azure-speech.local.json")
    gi = open(os.path.join(sp.ROOT, ".gitignore"), encoding="utf-8").read()
    assert "config/azure-speech.local.json" in gi


# NFR-SEC-005 AC-452 AC-453: 応答・repr にキーを含まない。壊れた保管先は未設定扱い
def test_nfrsec005_ac452_ac453_responses_never_contain_key(store):
    _, saved = sp.save_settings({"endpoint": CUSTOM, "key": DUMMY_KEY})
    for payload in (saved, sp.status_body(sp.load()), sp.delete_key()[1]):
        assert set(payload) <= {"ok", "result", "reason", "endpointHost", "keyConfigured"}
        assert DUMMY_KEY not in json.dumps(payload)
    sp.save_settings({"key": DUMMY_KEY})
    assert DUMMY_KEY not in repr(sp.load())
    store.write_text("{broken", encoding="utf-8")
    assert sp.status_body(sp.load()) == {"endpointHost": None, "keyConfigured": False}


class FakeUpstream(object):
    """_request の差し替え。要求を記録し、宛先ごとの応答を返す。"""

    def __init__(self, key=DUMMY_KEY, mode="ok"):
        self.calls, self.key, self.mode, self.n = [], key, mode, 0
        self.tokens, self.expired = set(), set()

    def __call__(self, base, host, method, path, headers, body, deadline):
        self.calls.append({"host": host, "path": path, "headers": dict(headers), "body": body})
        if self.mode == "timeout":
            raise sp._Fail("timeout")
        if self.mode == "network":
            raise sp._Fail("network")
        if path.endswith("/issueToken"):
            if headers.get("Ocp-Apim-Subscription-Key") != self.key:
                return 401, b"denied"
            self.n += 1
            tok = "DUMMY-UNIT-TOKEN-%d" % self.n
            self.tokens.add(tok)
            return 200, tok.encode()
        auth = headers.get("Authorization", "")
        tok = auth[7:] if auth.startswith("Bearer ") else None
        if tok not in self.tokens or tok in self.expired:
            return 401, b"denied"
        return 200, json.dumps({"RecognitionStatus": "Success", "DisplayText": "UNIT-TEXT"}).encode()


# FR-082 AC-450
def test_fr082_ac450_connection_test_classification(store, monkeypatch):
    up = FakeUpstream()
    monkeypatch.setattr(sp, "_request", up)
    assert sp.connection_test() == (200, {"ok": False, "result": "unconfigured"})
    assert up.calls == [], "未設定のときは送信 0 件"
    sp.save_settings({"endpoint": CUSTOM, "key": DUMMY_KEY})
    assert sp.connection_test()[1] == {"ok": True, "result": "success"}
    assert all(c["body"] == b"" and c["path"] == "/sts/v1.0/issueToken" for c in up.calls), "本文なしのキーの検証だけ"
    up.key = "OTHER"
    assert sp.connection_test()[1]["result"] == "auth"
    up.mode = "network"
    assert sp.connection_test()[1]["result"] == "network"
    up.mode = "timeout"
    assert sp.connection_test()[1]["result"] == "timeout"


# NFR-SEC-005 AC-455: キーはトークンの発行のホストだけ、認識のホストにはトークンだけ
def test_nfrsec005_ac455_key_only_to_token_host(store, monkeypatch):
    up = FakeUpstream()
    monkeypatch.setattr(sp, "_request", up)
    sp.save_settings({"endpoint": "japaneast", "key": DUMMY_KEY})
    status, body = sp.recognize("ja-JP", b"RIFF....")
    assert body == {"ok": True, "result": "success", "text": "UNIT-TEXT"}
    for c in up.calls:
        has_key = DUMMY_KEY in json.dumps(c["headers"])
        assert has_key == (c["host"] == "japaneast.api.cognitive.microsoft.com")
    stt = [c for c in up.calls if c["host"] == "japaneast.stt.speech.microsoft.com"]
    assert stt and stt[0]["headers"]["Authorization"].startswith("Bearer DUMMY-UNIT-TOKEN-")
    assert "language=ja-JP" in stt[0]["path"]
    assert sp.recognize("fr-FR", b"x")[1]["result"] == "invalid"


# FR-081 AC-458（中継サーバー側）・NFR-SEC-005 AC-453: トークンの期限切れでは取り直して 1 回だけ再送し、秘密は secrets() で除ける
def test_nfrsec005_ac453_token_refresh_and_secrets(store, monkeypatch):
    up = FakeUpstream()
    monkeypatch.setattr(sp, "_request", up)
    sp.save_settings({"endpoint": CUSTOM, "key": DUMMY_KEY})
    assert sp.recognize("en-US", b"a")[1]["ok"] is True
    up.expired |= set(up.tokens)
    assert sp.recognize("en-US", b"a")[1]["ok"] is True
    assert len([c for c in up.calls if c["path"].endswith("/issueToken")]) == 2
    assert DUMMY_KEY in sp.secrets() and any(t in sp.secrets() for t in up.tokens)
    up.key = "OTHER"
    up.expired |= set(up.tokens)
    assert sp.recognize("en-US", b"a")[1]["result"] == "auth"
    sp.delete_key()
    assert sp.recognize("en-US", b"a")[1]["result"] == "unconfigured"
