"""FR-086 Foundry 接続設定の画面での保存（AC-497〜AC-501）と NFR-SEC-006 AC-502。中継サーバーを同じプロセスで起動し、上流はモックにする。

テスト用のダミーの値だけを使う（実キーは使わない）。
"""
import http.client
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "server"))

import relay  # noqa: E402
import relay_upstream as up  # noqa: E402

DUMMY_KEY = "DUMMY-FR086-KEY-0123456789"
DUMMY_ENV_KEY = "DUMMY-FR086-ENVKEY-9876543210"
EP = "https://contoso-dummy-fr086.openai.azure.com/openai/v1?api-version=dummy-secret-path"
HOST = "contoso-dummy-fr086.openai.azure.com"
SECRET_PARTS = ["/openai/v1", "dummy-secret-path", "https://contoso-dummy"]


@pytest.fixture
def env(tmp_path, monkeypatch):
    for n in ("LLM_ENDPOINT", "LLM_DEPLOYMENT", "LLM_AUTH_METHOD", "LLM_API_KEY", "RELAY_ALLOW_LOOPBACK_UPSTREAM"):
        monkeypatch.delenv(n, raising=False)
    monkeypatch.setenv("RELAY_LLM_STORE", str(tmp_path / "llm-ui.local.json"))
    monkeypatch.setenv("LLM_CONFIG_PATH", str(tmp_path / "llm.local.json"))
    return tmp_path


class Srv(object):
    def __init__(self):
        self.server = relay.make_server(0, os.path.join(os.path.dirname(__file__), "..", "..", "web"))
        self.stopped = False
        self.port = self.server.server_address[1]
        self.t = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.t.start()

    def call(self, method, path, body=None, origin="same", host="same"):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"Host": "127.0.0.1:%d" % self.port if host == "same" else host}
        if origin == "same":
            h["Origin"] = "http://127.0.0.1:%d" % self.port
        elif origin:
            h["Origin"] = origin
        data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode("utf-8"))
        if data is not None:
            h["Content-Type"] = "application/json"
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        raw = r.read()
        c.close()
        try:
            return r.status, json.loads(raw.decode("utf-8")), raw.decode("utf-8")
        except ValueError:
            return r.status, None, raw.decode("utf-8")

    def stop(self):
        if self.stopped:
            return
        self.stopped = True
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def srv(env):
    s = Srv()
    yield s
    s.stop()


def good(**over):
    b = {"endpoint": EP, "deployment": "dummy-deploy", "authMethod": "apiKey"}
    b.update(over)
    return b


def store_bytes(env):
    p = env / "llm-ui.local.json"
    return p.read_bytes() if p.exists() else b""


# FR-086 AC-497
@pytest.mark.parametrize("method,path,body", [
    ("POST", "/api/llm/key", {"key": DUMMY_KEY}), ("DELETE", "/api/llm/key", None),
    ("POST", "/api/llm/config", good()), ("DELETE", "/api/llm/config", None),
])
def test_fr086_ac497_routes_exist_for_same_origin(srv, method, path, body):
    status, payload, _ = srv.call(method, path, body)
    assert status not in (404, 405), "ルートがある"
    assert status in (200, 400) and isinstance(payload, dict)


# FR-086 AC-497 異常系: 同一オリジンでない要求は 403 で、保管済みの値は変わらない
@pytest.mark.parametrize("method,path,body", [
    ("POST", "/api/llm/key", {"key": "DUMMY-OTHER-KEY-0001"}), ("DELETE", "/api/llm/key", None),
    ("POST", "/api/llm/config", good(deployment="other")), ("DELETE", "/api/llm/config", None),
])
@pytest.mark.parametrize("origin,host", [("http://evil.example.com", "same"), (None, "same"), ("same", "evil.example.com:80")])
def test_fr086_ac497_rejects_cross_origin(env, srv, method, path, body, origin, host):
    assert srv.call("POST", "/api/llm/config", good())[0] == 200
    assert srv.call("POST", "/api/llm/key", {"key": DUMMY_KEY})[0] == 200
    before = store_bytes(env)
    status, _, _ = srv.call(method, path, body, origin=origin, host=host)
    assert status == 403
    assert store_bytes(env) == before


# FR-086 AC-498 / AC-502 異常系
@pytest.mark.parametrize("body,reason", [
    (good(endpoint="http://contoso-dummy-fr086.openai.azure.com/"), "endpoint_format"),
    (good(endpoint=""), "endpoint_format"), (good(endpoint="not a url"), "endpoint_format"),
    (good(endpoint="https://user:pw@contoso-dummy-fr086.openai.azure.com/"), "endpoint_format"),
    (good(endpoint="https://localhost/"), "endpoint_internal"), (good(endpoint="https://10.0.0.5/"), "endpoint_internal"),
    (good(endpoint="https://169.254.169.254/"), "endpoint_internal"), (good(endpoint="https://2130706433/"), "endpoint_internal"),
    (good(endpoint="http://127.0.0.1:9/"), "endpoint_format"),  # テスト用ループバックの例外が無効のとき
    (good(endpoint="https://" + "a" * 2050 + ".example.com/"), "endpoint_format"),
    (good(deployment=""), "deployment_format"), (good(deployment="   "), "deployment_format"),
    (good(deployment="a\u0000b"), "deployment_format"), (good(deployment="d" * 65), "deployment_format"),
    (good(authMethod="bogus"), "auth_method_format"), (good(authMethod=None), "auth_method_format"),
])
def test_fr086_ac498_config_validation_leaves_store_unchanged(env, srv, body, reason):
    assert srv.call("POST", "/api/llm/config", good(deployment="keep-me"))[0] == 200
    before = store_bytes(env)
    status, payload, text = srv.call("POST", "/api/llm/config", body)
    assert status == 400 and payload["ok"] is False and payload["result"] == "invalid" and payload["reason"] == reason
    assert store_bytes(env) == before
    for v in (body.get("endpoint"), body.get("deployment")):
        if isinstance(v, str) and len(v) > 3:
            assert v not in text, "入力値を応答に含めない"


# FR-086 AC-498: 上限ちょうどは通る
def test_fr086_ac498_boundary_lengths_accepted(srv):
    assert srv.call("POST", "/api/llm/config", good(deployment="d" * 64))[0] == 200
    ep = "https://a.example.com/" + "p" * (2048 - len("https://a.example.com/"))
    assert len(ep) == 2048
    assert srv.call("POST", "/api/llm/config", good(endpoint=ep))[0] == 200


# FR-086 AC-498 キーの検査と、認証方式が API キーでないときの拒否
@pytest.mark.parametrize("key", ["", "   ", "has space inside", "bad\u0000key", "k" * 513, 5, None, "日本語キー"])
def test_fr086_ac498_key_validation(env, srv, key):
    assert srv.call("POST", "/api/llm/key", {"key": DUMMY_KEY})[0] == 200
    before = store_bytes(env)
    status, payload, text = srv.call("POST", "/api/llm/key", {"key": key})
    assert status == 400 and payload["result"] == "invalid" and payload["reason"] == "key_format"
    assert store_bytes(env) == before
    assert DUMMY_KEY not in text


def test_fr086_ac498_key_boundary_and_auth_mismatch(env, srv):
    assert srv.call("POST", "/api/llm/key", {"key": "k" * 512})[0] == 200
    assert srv.call("POST", "/api/llm/config", good(authMethod="entra"))[0] == 200
    before = store_bytes(env)
    status, payload, _ = srv.call("POST", "/api/llm/key", {"key": DUMMY_KEY})
    assert status == 400 and payload["reason"] == "auth_method_mismatch"
    assert store_bytes(env) == before


# FR-086 AC-498: 本体が JSON のオブジェクトでないとき
@pytest.mark.parametrize("raw", [b"not json", b"[]", b"", b"{}"])
def test_fr086_ac498_bad_body(srv, raw):
    for path in ("/api/llm/key", "/api/llm/config"):
        status, payload, _ = srv.call("POST", path, raw)
        assert status == 400 and payload["result"] == "invalid"


# FR-086 AC-499: 環境変数 ＞ 設定ファイル ＞ 画面での保存
def test_fr086_ac499_precedence_env_file_ui(env, monkeypatch, srv):
    assert srv.call("POST", "/api/llm/config", good())[0] == 200
    assert srv.call("POST", "/api/llm/key", {"key": DUMMY_KEY})[0] == 200
    s = srv.call("GET", "/api/llm/status")[1]
    assert s["sources"] == {"endpoint": "ui", "deployment": "ui", "authMethod": "ui", "key": "ui"}
    (env / "llm.local.json").write_text(json.dumps({"deployment": "file-deploy", "apiKey": "DUMMY-FILE-KEY-0001"}), encoding="utf-8")
    monkeypatch.setenv("LLM_ENDPOINT", "https://env-dummy.openai.azure.com/")
    s = srv.call("GET", "/api/llm/status")[1]
    assert s["sources"] == {"endpoint": "env", "deployment": "file", "authMethod": "ui", "key": "file"}
    assert s["endpointHost"] == "env-dummy.openai.azure.com" and s["keySource"] == "file"
    eff = relay.cfg.load_settings()
    assert (eff.endpoint, eff.deployment, eff.api_key) == ("https://env-dummy.openai.azure.com/", "file-deploy", "DUMMY-FILE-KEY-0001")
    # 上位が消えたら、画面で保存した値が有効になる
    monkeypatch.delenv("LLM_ENDPOINT")
    (env / "llm.local.json").unlink()
    eff = relay.cfg.load_settings()
    assert (eff.endpoint, eff.deployment, eff.api_key, eff.auth_method) == (EP, "dummy-deploy", DUMMY_KEY, "apiKey")


# FR-086 AC-499 異常系: 環境変数・設定ファイル由来の項目は上書き・削除されない（409）
def test_fr086_ac499_env_managed_items_are_not_overwritten_or_deleted(env, monkeypatch, srv):
    monkeypatch.setenv("LLM_ENDPOINT", "https://env-dummy.openai.azure.com/")
    monkeypatch.setenv("LLM_API_KEY", DUMMY_ENV_KEY)
    (env / "llm.local.json").write_text(json.dumps({"deployment": "file-deploy"}), encoding="utf-8")
    status, payload, text = srv.call("POST", "/api/llm/config", good())
    assert status == 409 and payload["result"] == "env_managed"
    assert srv.call("POST", "/api/llm/config", {"authMethod": "apiKey"})[0] == 200  # 上位に値がない項目は設定できる
    status, payload, text = srv.call("POST", "/api/llm/key", {"key": DUMMY_KEY})
    assert status == 409 and payload["result"] == "env_managed"
    status, payload, text = srv.call("DELETE", "/api/llm/key")
    assert status == 409 and payload["result"] == "env_managed"
    status, payload, text = srv.call("DELETE", "/api/llm/config")
    assert status == 409 and payload["result"] == "env_managed"
    eff = relay.cfg.load_settings()
    assert eff.endpoint == "https://env-dummy.openai.azure.com/" and eff.deployment == "file-deploy" and eff.api_key == DUMMY_ENV_KEY
    assert DUMMY_ENV_KEY not in text
    assert store.load().get("apiKey") is None


store = relay.store


# FR-086 AC-499: 画面で保存した接続設定は、データの初期化（ブラウザ内のデータ消去）の影響を受けない = 中継サーバーの保管先にあり、削除は明示の DELETE だけ
def test_fr086_ac499_store_survives_until_explicit_delete(env, srv):
    srv.call("POST", "/api/llm/config", good())
    srv.call("POST", "/api/llm/key", {"key": DUMMY_KEY})
    assert srv.call("DELETE", "/api/llm/config")[0] == 200
    s = srv.call("GET", "/api/llm/status")[1]
    assert s["configured"]["endpoint"] is False and s["keyConfigured"] is True  # キーは別に削除する
    assert srv.call("DELETE", "/api/llm/key")[0] == 200
    assert srv.call("GET", "/api/llm/status")[1]["keyConfigured"] is False
    assert not (env / "llm-ui.local.json").exists()


# FR-086 AC-500
def test_fr086_ac500_status_shape_and_no_secrets(srv):
    s = srv.call("GET", "/api/llm/status")[1]
    assert s["configured"]["endpoint"] is False and s["configured"]["key"] is False
    assert s["endpointHost"] == "" and s["keyConfigured"] is False and s["keySource"] is None
    srv.call("POST", "/api/llm/config", good())
    srv.call("POST", "/api/llm/key", {"key": DUMMY_KEY})
    status, s, text = srv.call("GET", "/api/llm/status")
    assert status == 200
    assert s["configured"] == {"endpoint": True, "deployment": True, "authMethod": True, "key": True, "credential": True}
    assert s["endpointHost"] == HOST and s["keyConfigured"] is True and s["keySource"] == "ui"
    assert s["sources"] == {"endpoint": "ui", "deployment": "ui", "authMethod": "ui", "key": "ui"}
    for part in SECRET_PARTS + [DUMMY_KEY, "api-key"]:
        assert part not in text


# FR-086 AC-500: 認証方式が Entra ID でも、保存されているキーの有無と出どころを正しく示す
def test_fr086_ac500_key_state_when_entra(srv):
    srv.call("POST", "/api/llm/key", {"key": DUMMY_KEY})
    srv.call("POST", "/api/llm/config", good(authMethod="entra"))
    s = srv.call("GET", "/api/llm/status")[1]
    assert s["authMethod"] == "entra" and s["keyConfigured"] is True and s["keySource"] == "ui"
    srv.call("DELETE", "/api/llm/key")
    s = srv.call("GET", "/api/llm/status")[1]
    assert s["keyConfigured"] is False and s["keySource"] is None and s["configured"]["credential"] is True


class Upstream(object):
    def __init__(self):
        self.requests = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                n = int(self.headers.get("Content-Length") or "0")
                outer.requests.append({"path": self.path, "headers": dict(self.headers), "body": json.loads(self.rfile.read(n) or b"{}")})
                body = json.dumps({"output": [{"type": "message", "content": [{"type": "output_text", "text": "ok"}]}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        self.httpd = HTTPServer(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()


# FR-086 AC-501: 画面で保存した設定だけで、上流の <endpoint>/responses へ model=デプロイ名、API キーで中継する
def test_fr086_ac501_relays_with_ui_saved_apikey(env, monkeypatch, srv):
    monkeypatch.setenv("RELAY_ALLOW_LOOPBACK_UPSTREAM", "1")
    ups = Upstream()
    try:
        ep = "http://127.0.0.1:%d/base" % ups.port
        assert srv.call("POST", "/api/llm/config", good(endpoint=ep, deployment="ui-deploy"))[0] == 200
        assert srv.call("POST", "/api/llm/key", {"key": DUMMY_KEY})[0] == 200
        assert ups.requests == [], "保存しただけでは上流への送信は 0 件"
        status, payload, text = srv.call("POST", "/api/llm/responses", {"input": "hi", "model": "ignored"})
        assert status == 200
        assert len(ups.requests) == 1
        r = ups.requests[0]
        assert r["path"] == "/base/responses" and r["body"]["model"] == "ui-deploy"
        assert r["headers"].get("api-key") == DUMMY_KEY
        assert DUMMY_KEY not in text
    finally:
        ups.stop()


# FR-086 AC-501: Entra ID のときは取得したトークンを付ける（キーは付けない）
def test_fr086_ac501_relays_with_ui_saved_entra(env, monkeypatch, srv):
    monkeypatch.setenv("RELAY_ALLOW_LOOPBACK_UPSTREAM", "1")
    monkeypatch.setattr(up, "get_entra_token", lambda: "DUMMY-ENTRA-TOKEN-0001")
    ups = Upstream()
    try:
        assert srv.call("POST", "/api/llm/config", good(endpoint="http://127.0.0.1:%d" % ups.port, authMethod="entra"))[0] == 200
        status, _, text = srv.call("POST", "/api/llm/responses", {"input": "hi"})
        assert status == 200
        h = ups.requests[0]["headers"]
        assert h.get("Authorization") == "Bearer DUMMY-ENTRA-TOKEN-0001" and "api-key" not in {k.lower() for k in h}
        assert "DUMMY-ENTRA-TOKEN-0001" not in text
    finally:
        ups.stop()


# FR-086 AC-501 異常系: 画面で保存した設定が未完了のときは上流へ送らない
def test_fr086_ac501_incomplete_ui_settings_do_not_reach_upstream(monkeypatch, srv):
    monkeypatch.setenv("RELAY_ALLOW_LOOPBACK_UPSTREAM", "1")
    ups = Upstream()
    try:
        srv.call("POST", "/api/llm/config", good(endpoint="http://127.0.0.1:%d" % ups.port))
        assert srv.call("POST", "/api/llm/responses", {"input": "hi"})[0] == 503  # キーが未設定
        assert ups.requests == []
    finally:
        ups.stop()


# NFR-SEC-006 AC-502: 保管先は封をされ、再起動後も保たれ、応答・ログにキーとエンドポイントの全体が出ない
def test_nfr_sec_006_ac502_sealed_store_persists_and_does_not_leak(env, srv, capsys):
    texts = []
    texts.append(srv.call("POST", "/api/llm/config", good())[2])
    texts.append(srv.call("POST", "/api/llm/key", {"key": DUMMY_KEY})[2])
    texts.append(srv.call("GET", "/api/llm/status")[2])
    texts.append(srv.call("POST", "/api/llm/key", {"key": "bad key"})[2])
    texts.append(srv.call("POST", "/api/llm/config", good(endpoint="https://10.0.0.1/"))[2])
    data = store_bytes(env).decode("utf-8")
    assert data
    for secret in [DUMMY_KEY, HOST, "dummy-deploy", "dummy-secret-path"]:
        if os.name == "nt":
            assert secret not in data, "保管先のファイルに平文で含まれない（DPAPI）"
    if os.name == "nt":
        assert json.loads(data)["sealed"]["scheme"] == "dpapi"
    else:
        assert (os.stat(env / "llm-ui.local.json").st_mode & 0o777) == 0o600
    err = capsys.readouterr().err
    for t in texts + [err]:
        for secret in [DUMMY_KEY] + SECRET_PARTS:
            assert secret not in t
    # 再起動（別のサーバーが同じ保管先を読む）
    srv.stop()
    s2 = Srv()
    try:
        s = s2.call("GET", "/api/llm/status")[1]
        assert s["keyConfigured"] is True and s["endpointHost"] == HOST and s["sources"]["endpoint"] == "ui"
    finally:
        s2.stop()
