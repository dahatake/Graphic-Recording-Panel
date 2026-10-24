"""FR-087 GitHub Copilot SDK を介した呼び出し（AC-503〜AC-507 の中継サーバー側）と FR-066（SDK は任意の依存）。

GitHub Copilot SDK は sys.modules に置いたスタブだけを使い、GitHub・Copilot CLI・Foundry へは通信しない。
Foundry はループバックの上流モックで要求の件数だけを数える。テスト用のダミーの値だけを使う。
"""
import asyncio
import http.client
import json
import os
import sys
import threading
import types
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "server"))

import relay  # noqa: E402
import relay_config as cfg  # noqa: E402
import relay_copilot  # noqa: E402
import relay_llmstore as store  # noqa: E402

DUMMY_TOKEN = "github_pat_DUMMY.0123456789abcdef"  # 実値らしく見えないよう「.」を含める（AC-341）
DUMMY_FOUNDRY_KEY = "DUMMY-FR087-FOUNDRY-KEY-0001"
ACCOUNT = "octocat-dummy"
WEB = os.path.join(os.path.dirname(__file__), "..", "..", "web")
ENV_NAMES = ("LLM_ENDPOINT", "LLM_DEPLOYMENT", "LLM_AUTH_METHOD", "LLM_API_KEY", "RELAY_ALLOW_LOOPBACK_UPSTREAM",
             "LLM_PROVIDER", "COPILOT_AUTH_METHOD", "COPILOT_MODEL", "COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN",
             "RELAY_TIMEOUT_SEC", "RELAY_MAX_BYTES")


# ---------------------------------------------------------------- GitHub Copilot SDK のスタブ


class SdkStub(object):
    """CopilotClient・セッションの模擬。起動の回数・作成時の設定・送られた内容を記録する。"""

    def __init__(self):
        self.mode = "ok"
        self.reply = '{"points":["a"]}'
        self.signed_in = True
        self.start_fail = False
        self.starts = 0
        self.stops = 0
        self.client_kwargs = []
        self.sessions = []
        self.sent = []
        self.permission_answers = []

    def modules(self):
        stub = self

        class PermissionDecisionReject(object):
            def __init__(self, feedback=None):
                self.kind = "reject"
                self.feedback = feedback

        class Session(object):
            def __init__(self, opts):
                self.opts = opts

            async def send_and_wait(self, prompt, timeout=60.0):
                stub.sent.append(prompt)
                # CLI がツールの実行の許可を求めてきたことにする（AC-504: 拒否される）
                ans = self.opts["on_permission_request"]({"kind": "shell", "command": "dir"}, {"session_id": "s1"})
                stub.permission_answers.append(ans)
                m = stub.mode
                if m == "auth":
                    raise RuntimeError("401 Unauthorized: Bad credentials for token " + DUMMY_TOKEN)
                if m == "rate_limit":
                    raise RuntimeError("HTTP 429: rate limit exceeded")
                if m == "connection":
                    raise ConnectionError("ECONNRESET C:\\Users\\dummy\\secret-path")
                if m == "timeout":
                    await asyncio.sleep(30)
                if m == "none":
                    return None
                return types.SimpleNamespace(type="assistant.message", data=types.SimpleNamespace(content=stub.reply))

            async def disconnect(self):
                pass

        class CopilotClient(object):
            def __init__(self, **kwargs):
                stub.client_kwargs.append(kwargs)

            async def start(self):
                stub.starts += 1
                if stub.start_fail:
                    raise FileNotFoundError("copilot-runtime not found at C:\\Users\\dummy\\secret-path")

            async def stop(self):
                stub.stops += 1

            async def get_auth_status(self):
                return types.SimpleNamespace(is_authenticated=stub.signed_in, login=ACCOUNT if stub.signed_in else None)

            async def create_session(self, **opts):
                stub.sessions.append(opts)
                return Session(opts)

        root = types.ModuleType("copilot")
        root.CopilotClient = CopilotClient
        sess = types.ModuleType("copilot.session")
        sess.PermissionDecisionReject = PermissionDecisionReject
        root.session = sess
        return root, sess


class FoundryMock(object):
    """Foundry の上流モック（ループバック）。要求の件数だけを数える。"""

    def __init__(self):
        mock = self
        self.hits = 0

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                mock.hits += 1
                self.rfile.read(int(self.headers.get("Content-Length") or "0"))
                body = json.dumps({"output": [{"type": "message", "content": [{"type": "output_text", "text": "{}"}]}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = HTTPServer(("127.0.0.1", 0), H)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


class Srv(object):
    def __init__(self):
        self.server = relay.make_server(0, WEB)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def call(self, method, path, body=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=20)
        h = {"Host": "127.0.0.1:%d" % self.port, "Origin": "http://127.0.0.1:%d" % self.port}
        data = None if body is None else json.dumps(body).encode("utf-8")
        if data is not None:
            h["Content-Type"] = "application/json"
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        raw = r.read().decode("utf-8")
        c.close()
        try:
            return r.status, json.loads(raw), raw
        except ValueError:
            return r.status, None, raw

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def env(tmp_path, monkeypatch):
    for n in ENV_NAMES:
        monkeypatch.delenv(n, raising=False)
    monkeypatch.setenv("RELAY_LLM_STORE", str(tmp_path / "llm-ui.local.json"))
    monkeypatch.setenv("LLM_CONFIG_PATH", str(tmp_path / "llm.local.json"))
    relay_copilot.reset()
    yield tmp_path
    relay_copilot.reset()


@pytest.fixture
def sdk(env, monkeypatch):
    stub = SdkStub()
    root, sess = stub.modules()
    monkeypatch.setitem(sys.modules, "copilot", root)
    monkeypatch.setitem(sys.modules, "copilot.session", sess)
    return stub


@pytest.fixture
def no_sdk(env, monkeypatch):
    # SDK を読み込めない状態（未導入）を模擬する
    monkeypatch.setitem(sys.modules, "copilot", None)
    monkeypatch.setitem(sys.modules, "copilot.session", None)


@pytest.fixture
def foundry(env, monkeypatch):
    m = FoundryMock()
    monkeypatch.setenv("RELAY_ALLOW_LOOPBACK_UPSTREAM", "1")
    monkeypatch.setenv("LLM_ENDPOINT", "http://127.0.0.1:%d/openai/v1" % m.port)
    monkeypatch.setenv("LLM_DEPLOYMENT", "dummy-deploy")
    monkeypatch.setenv("LLM_AUTH_METHOD", "apiKey")
    monkeypatch.setenv("LLM_API_KEY", DUMMY_FOUNDRY_KEY)
    yield m
    m.stop()


@pytest.fixture
def srv(env):
    s = Srv()
    yield s
    s.stop()


def use_copilot(monkeypatch, auth="signin", model=None, token=None):
    monkeypatch.setenv("LLM_PROVIDER", "copilot")
    monkeypatch.setenv("COPILOT_AUTH_METHOD", auth)
    if model is not None:
        monkeypatch.setenv("COPILOT_MODEL", model)
    if token is not None:
        monkeypatch.setenv("COPILOT_GITHUB_TOKEN", token)


EXTRACT = {"instructions": "Reply with one JSON object only.", "input": "要点: 会議の要点のダミー", "scene": 1,
           "drawStyle": "handwritten", "partKeys": ["cloud"], "text": {"format": {"type": "json_object"}}}


def output_text(payload):
    return payload["output"][0]["content"][0]["text"]


# ---------------------------------------------------------------- 設定の読み取り（FR-087 / FR-088 の中継側）


# FR-087 AC-503: プロバイダー・認証方式・モデル名・トークンの既定値
def test_fr087_ac503_copilot_settings_defaults(env):
    cs = cfg.load_copilot_settings()
    assert (cs.provider, cs.auth_method, cs.model, cs.token) == ("foundry", "signin", "", None)
    assert cs.sources == {"provider": None, "authMethod": None, "model": None, "token": None}
    assert DUMMY_TOKEN not in repr(cs)


# FR-087 AC-503: 環境変数 > 設定ファイル > 画面での保存。不正な値は無いものとして次の出どころへ進む
def test_fr087_ac503_copilot_settings_priority(env, monkeypatch):
    store.save({"provider": "copilot", "copilotAuthMethod": "token", "copilotModel": "ui-model", "copilotToken": "ui-token"})
    cs = cfg.load_copilot_settings()
    assert (cs.provider, cs.auth_method, cs.model, cs.token) == ("copilot", "token", "ui-model", "ui-token")
    assert set(cs.sources.values()) == {"ui"}
    (env / "llm.local.json").write_text(json.dumps({"provider": "foundry", "copilot": {"model": "file-model", "authMethod": "bogus"}}), encoding="utf-8")
    cs = cfg.load_copilot_settings()
    assert (cs.provider, cs.model, cs.auth_method) == ("foundry", "file-model", "token")
    assert cs.sources["provider"] == "file" and cs.sources["authMethod"] == "ui"
    monkeypatch.setenv("COPILOT_GITHUB_TOKEN", DUMMY_TOKEN)
    monkeypatch.setenv("LLM_PROVIDER", "copilot")
    cs = cfg.load_copilot_settings()
    assert cs.token == DUMMY_TOKEN and cs.sources["token"] == "env" and cs.provider == "copilot"
    # 保管先のファイルにトークンは平文で含まれない（NFR-SEC-006）
    assert b"ui-token" not in (env / "llm-ui.local.json").read_bytes()


# FR-087 AC-503: 保存の前の検査（後続の画面からの保存で使う）
def test_fr087_ac503_copilot_store_checks():
    assert store.check_provider("copilot") is None and store.check_provider("x") == "provider_format"
    assert store.check_copilot_auth_method("token") is None and store.check_copilot_auth_method("apiKey")
    assert store.check_copilot_model("") is None and store.check_copilot_model("gpt-5") is None
    assert store.check_copilot_model("  ") and store.check_copilot_model("a\nb") and store.check_copilot_model(None)
    assert store.check_copilot_token(DUMMY_TOKEN) is None
    assert store.check_copilot_token(" ") and store.check_copilot_token("a b") and store.check_copilot_token("x\r\n")


# ---------------------------------------------------------------- AC-503・AC-504: 呼び出し


# FR-087 AC-503 AC-504: 同じ送信内容だけを SDK のセッションへ送り、Foundry への要求は 0 件
def test_fr087_ac503_ac504_copilot_call_sends_only_content(sdk, foundry, srv, monkeypatch):
    use_copilot(monkeypatch, model="gpt-dummy-model")
    status, payload, raw = srv.call("POST", "/api/llm/extract", EXTRACT)
    assert status == 200, raw
    assert output_text(payload) == sdk.reply
    assert foundry.hits == 0, "Microsoft Foundry への要求は 0 件"
    assert sdk.sent == [EXTRACT["input"]], "送るのは送信内容だけ"
    opts = sdk.sessions[0]
    assert opts["model"] == "gpt-dummy-model"
    # AC-504: ツールなし・権限の要求は拒否・作業フォルダーは空・システムメッセージは置き換え（端末の情報を加えない）
    assert opts["available_tools"] == []
    assert opts["system_message"] == {"mode": "replace", "content": EXTRACT["instructions"]}
    assert os.path.isdir(opts["working_directory"]) and os.listdir(opts["working_directory"]) == []
    assert not any(k in opts for k in ("mcp_servers", "tools", "custom_agents"))
    assert [getattr(a, "kind", None) for a in sdk.permission_answers] == ["reject"]
    assert DUMMY_FOUNDRY_KEY not in json.dumps(sdk.client_kwargs[0].get("env", {}))
    assert sdk.client_kwargs[0]["working_directory"] == opts["working_directory"]


# FR-087 AC-503: モデル名が空なら SDK の既定のモデル（model を渡さない）
def test_fr087_ac503_empty_model_uses_sdk_default(sdk, srv, monkeypatch):
    use_copilot(monkeypatch)
    assert srv.call("POST", "/api/llm/responses", {"input": "ping"})[0] == 200
    assert "model" not in sdk.sessions[0]


# FR-087 AC-503: トークンの認証方式ではトークンを SDK にだけ渡し、ログインユーザーを使わない
def test_fr087_ac503_token_auth_passes_token_to_sdk(sdk, srv, monkeypatch):
    use_copilot(monkeypatch, auth="token", token=DUMMY_TOKEN)
    status, _, raw = srv.call("POST", "/api/llm/responses", {"input": "ping"})
    assert status == 200 and DUMMY_TOKEN not in raw
    kw = sdk.client_kwargs[-1]
    assert kw["github_token"] == DUMMY_TOKEN and kw["use_logged_in_user"] is False


# FR-087 AC-503: 要求の body の provider でも選べる（provider は上流へ送らない）
def test_fr087_ac503_body_provider_selects_copilot(sdk, foundry, srv):
    body = dict(EXTRACT, provider="copilot")
    assert srv.call("POST", "/api/llm/extract", body)[0] == 200
    assert foundry.hits == 0 and len(sdk.sent) == 1


# FR-087 AC-503: 応答は Foundry と同じ検査を通す（方式2 の SVG は NFR-SEC-004 のサニタイズ）
def test_fr087_ac503_svg_response_is_sanitized(sdk, srv, monkeypatch):
    use_copilot(monkeypatch)
    sdk.reply = '<svg viewBox="0 0 48 48"><script>alert(1)</script><circle cx="1" cy="1" r="1" onclick="x()"/></svg>'
    status, payload, raw = srv.call("POST", "/api/llm/svg", {"input": "icon", "instructions": "Draw", "key": "k", "label": "l"})
    assert status == 200
    assert payload["svg"].startswith("<svg") and "<circle" in payload["svg"]
    assert "script" not in raw.lower() and "onclick" not in raw.lower()


# FR-087 AC-503: 時間超過・大きすぎる・形式が不正な応答は打ち切って秘密を含まないエラー（AC-346 と同じ）
@pytest.mark.parametrize("mode,status,code", [
    ("timeout", 504, "upstream_timeout"), ("big", 502, "upstream_too_large"), ("none", 502, "upstream_invalid"),
])
def test_fr087_ac503_abnormal_responses(sdk, srv, monkeypatch, mode, status, code):
    use_copilot(monkeypatch, auth="token", token=DUMMY_TOKEN)
    monkeypatch.setenv("RELAY_TIMEOUT_SEC", "1")
    if mode == "big":
        monkeypatch.setenv("RELAY_MAX_BYTES", "1000")
        sdk.reply = "x" * 1001
    else:
        sdk.mode = mode
    got, payload, raw = srv.call("POST", "/api/llm/extract", EXTRACT)
    assert (got, payload["error"]["code"]) == (status, code)
    assert DUMMY_TOKEN not in raw


# ---------------------------------------------------------------- AC-505: SDK がない・CLI を起動できない


# FR-087 AC-505 FR-066 AC-345: SDK を読み込めなくても起動し、静的配信と Foundry は従来どおり
def test_fr087_ac505_sdk_missing_relay_still_works(no_sdk, foundry, srv):
    status, _, _ = srv.call("GET", "/")
    assert status == 200, "静的配信"
    st = srv.call("GET", "/api/llm/status")[1]
    assert st["state"] == "ready" and st["provider"] == "foundry"
    assert st["copilot"]["available"] is False and st["copilot"]["unavailableReason"] == "sdk_missing"
    assert srv.call("POST", "/api/llm/extract", EXTRACT)[0] == 200 and foundry.hits == 1, "Foundry は従来どおり"


# FR-087 AC-505: プロバイダーが GitHub Copilot の要求には原因の分類を返し、上流へは送らない
def test_fr087_ac505_sdk_missing_copilot_request_rejected(no_sdk, foundry, srv, monkeypatch):
    use_copilot(monkeypatch, auth="token", token=DUMMY_TOKEN)
    status, payload, raw = srv.call("POST", "/api/llm/extract", EXTRACT)
    assert status == 503 and payload["error"]["code"] == "sdk_missing"
    assert payload["error"]["missing"] == ["sdk"]
    assert foundry.hits == 0 and DUMMY_TOKEN not in raw


# FR-087 AC-505: Copilot CLI を起動できないときは cli_unavailable（例外の文面・パスは返さない）
def test_fr087_ac505_cli_unavailable(sdk, srv, monkeypatch):
    sdk.start_fail = True
    st = srv.call("GET", "/api/llm/copilot")[1]  # CLI を起動してよい時点（GitHub Copilot の分類を開いた。AC-507・Q-034）
    assert st["copilot"]["available"] is False and st["copilot"]["unavailableReason"] == "cli_unavailable"
    use_copilot(monkeypatch)
    relay_copilot.reset()
    status, payload, raw = srv.call("POST", "/api/llm/extract", EXTRACT)
    assert status == 503 and payload["error"]["code"] == "cli_unavailable"
    assert "secret-path" not in raw and sdk.sent == []


# FR-087 AC-505 FR-088: 状態の取得の形（契約 CONTRACT-GITHUB-COPILOT.md）。トークンの値は含まない
def test_fr087_ac505_status_shape(sdk, srv, monkeypatch):
    use_copilot(monkeypatch, auth="token", model="gpt-dummy-model", token=DUMMY_TOKEN)
    status, st, raw = srv.call("GET", "/api/llm/status")
    assert status == 200 and DUMMY_TOKEN not in raw
    assert st["provider"] == "copilot" and st["providerSource"] == "env"
    cp = st["copilot"]
    assert cp == {"available": True, "unavailableReason": None, "authMethod": "token", "authMethodSource": "env",
                  "signedIn": True, "account": ACCOUNT, "tokenConfigured": True, "tokenSource": "env",
                  "model": "gpt-dummy-model", "modelSource": "env", "ready": True, "missing": []}
    assert "endpointHost" in st and "keyConfigured" in st, "Foundry の項目は従来どおり"


# ---------------------------------------------------------------- AC-506: 原因の分類（中継側）


# FR-087 AC-506: 未サインイン・トークン未設定では送らず、原因の分類を返す
@pytest.mark.parametrize("auth,signed,miss,code", [("signin", False, "signin", "not_signed_in"), ("token", True, "token", "token_missing")])
def test_fr087_ac506_unconfigured_not_sent(sdk, srv, monkeypatch, auth, signed, miss, code):
    use_copilot(monkeypatch, auth=auth)
    sdk.signed_in = signed
    st = srv.call("GET", "/api/llm/status")[1]
    assert st["copilot"]["missing"] == [miss] and st["copilot"]["ready"] is False
    status, payload, _ = srv.call("POST", "/api/llm/extract", EXTRACT)
    assert status == 503 and payload["error"]["code"] == code and payload["error"]["state"] == "unconfigured"
    assert sdk.sent == [], "LLM 向けの要求は 0 件"


# FR-087 AC-506: 認証・利用の上限・接続の失敗は分類だけを返し、トークン・例外の文面を含まない
@pytest.mark.parametrize("mode,status,code", [("auth", 401, "auth"), ("rate_limit", 429, "rate_limit"), ("connection", 502, "connection")])
def test_fr087_ac506_failure_classification(sdk, srv, monkeypatch, mode, status, code):
    use_copilot(monkeypatch, auth="token", token=DUMMY_TOKEN)
    sdk.mode = mode
    got, payload, raw = srv.call("POST", "/api/llm/extract", EXTRACT)
    assert (got, payload["error"]["code"]) == (status, code)
    assert DUMMY_TOKEN not in raw and "Bad credentials" not in raw and "secret-path" not in raw


# ---------------------------------------------------------------- AC-507: Foundry のときは起動しない


# FR-087 AC-507: プロバイダーが Foundry（既定）のとき、LLM 向けの要求で SDK・CLI を起動せず、送信は 0 件
def test_fr087_ac507_foundry_never_starts_copilot(sdk, foundry, srv):
    assert srv.call("GET", "/")[0] == 200
    for path in ("/api/llm/extract", "/api/llm/svg", "/api/llm/responses"):
        assert srv.call("POST", path, EXTRACT)[0] == 200
    assert foundry.hits == 3
    assert sdk.starts == 0 and sdk.sent == [] and sdk.sessions == []


# FR-087 AC-507: GitHub Copilot の分類を開いたときの状態の取得は CLI を起動してよいが、会議の内容は送らず、
# Foundry のときは確認の後に止める
def test_fr087_ac507_status_probe_sends_no_content(sdk, foundry, srv):
    st = srv.call("GET", "/api/llm/copilot")[1]
    assert st["copilot"]["signedIn"] is True and st["copilot"]["account"] == ACCOUNT
    assert sdk.starts == 1 and sdk.stops == 1, "Foundry のときは確認の後に止める"
    assert sdk.sent == [] and sdk.sessions == []
    srv.call("GET", "/api/llm/copilot")
    assert sdk.starts == 1, "短い間の状態の取得では起動し直さない"


# FR-087 AC-507 AC-505 / FR-088 AC-510（Q-034）: プロバイダーが Microsoft Foundry のままの GET /api/llm/status・
# 設定の保存・プロバイダーの取得では Copilot CLI を起動せず（起動 0 回・送信 0 件）、SDK の導入の有無と「未確認」だけを返す
def test_fr087_ac507_foundry_status_does_not_start_cli(sdk, foundry, srv):
    for _ in range(3):
        status, st, raw = srv.call("GET", "/api/llm/status")
        assert status == 200
        cp = st["copilot"]
        assert cp["available"] is True and cp["unavailableReason"] is None
        assert cp["signedIn"] is None and cp["account"] is None, "サインインの有無は未確認"
    srv.call("GET", "/api/llm/provider")
    srv.call("POST", "/api/llm/copilot", {"authMethod": "signin", "model": ""})
    srv.call("POST", "/api/llm/provider", {"provider": "foundry"})
    assert sdk.starts == 0 and sdk.sent == [] and sdk.sessions == [], "CLI を起動しない・GitHub へ送らない"
    srv.call("GET", "/api/llm/copilot")
    assert sdk.starts == 1, "GitHub Copilot の分類を開いたときだけ起動する"


# FR-087 AC-505（Q-034）: SDK を読み込めないときは、CLI を起動してよい時点かどうかに関係なく sdk_missing
def test_fr087_ac505_sdk_missing_without_cli_check(srv, foundry, monkeypatch):
    monkeypatch.setattr(relay_copilot, "load_sdk", lambda: None)
    relay_copilot.reset()
    for path in ("/api/llm/status", "/api/llm/copilot"):
        cp = srv.call("GET", path)[1]["copilot"]
        assert cp["available"] is False and cp["unavailableReason"] == "sdk_missing"


# FR-087 AC-507: プロバイダーが GitHub Copilot のときは CLI を使い回す（要求ごとに起動しない）
def test_fr087_ac507_copilot_client_reused(sdk, srv, monkeypatch):
    use_copilot(monkeypatch)
    for _ in range(3):
        assert srv.call("POST", "/api/llm/extract", EXTRACT)[0] == 200
    assert sdk.starts == 1 and len(sdk.sent) == 3
