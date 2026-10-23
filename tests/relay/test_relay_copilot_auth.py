"""FR-088 GitHub Copilot の認証設定とサインイン（AC-509・AC-510 の中継サーバー側）と NFR-SEC-006 AC-515（トークンの秘匿）。

GitHub Copilot SDK は sys.modules に置いたスタブ、Copilot CLI のサインイン（copilot login --device-code）は
login_argv を差し替えた Python のスタブだけを使い、GitHub へは通信しない。トークンはテスト用のダミーの値だけを使う。
"""
import http.client
import json
import os
import re
import subprocess
import sys
import textwrap
import threading
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "server"))
sys.path.insert(0, os.path.dirname(__file__))

import relay  # noqa: E402
import relay_config as cfg  # noqa: E402
import relay_copilot  # noqa: E402
import relay_copilot_signin as signin  # noqa: E402
import relay_llmstore as store  # noqa: E402
from test_relay_copilot import SdkStub  # noqa: E402

DUMMY_TOKEN = "github_pat_DUMMY.FR088.not-a-real-token"  # 実値らしく見えないよう「.」を含める（AC-341）
CRED = "gho_DUMMYFR088CREDENTIAL0000notreal"
WEB = os.path.join(os.path.dirname(__file__), "..", "..", "web")
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
ENV_NAMES = ("LLM_ENDPOINT", "LLM_DEPLOYMENT", "LLM_AUTH_METHOD", "LLM_API_KEY", "LLM_PROVIDER", "COPILOT_AUTH_METHOD",
             "COPILOT_MODEL", "COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN", "COPILOT_CLI_PATH")

# Copilot CLI の `copilot login --device-code` のスタブ。確認コードを出力し、合図のファイルで結果を決める
CLI_STUB = textwrap.dedent('''
    import os, sys, time
    flag = sys.argv[1]
    # 引数・環境変数の記録を先に書く（確認コードの出力の後だと、負荷時にテストが記録より先に読むことがある）
    with open(flag + ".argv", "w") as f:
        f.write(" ".join(sys.argv[2:]) + "\\n" + "\\n".join(k for k in os.environ if "TOKEN" in k))
    print("To authenticate, visit https://github.com/login/device and enter code ABCD-1234", flush=True)
    print("Waiting for authorization...", flush=True)
    for _ in range(600):
        if os.path.exists(flag):
            mode = open(flag).read().strip()
            if mode == "ok":
                print("Signed in successfully as octo-dummy. credential " + "''' + CRED + '''", flush=True)
                sys.exit(0)
            if mode == "expired":
                print("Error: the device code expired", flush=True); sys.exit(1)
            if mode == "denied":
                print("Error: access_denied by the user", flush=True); sys.exit(1)
            print("Error: unexpected " + "''' + CRED + '''", flush=True); sys.exit(2)
        time.sleep(0.05)
    sys.exit(3)
''')


class Srv(object):
    def __init__(self):
        self.server = relay.make_server(0, WEB)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def call(self, method, path, body=None, origin=True, host=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        h = {"Host": host or "127.0.0.1:%d" % self.port}
        if origin is True:
            h["Origin"] = "http://127.0.0.1:%d" % self.port
        elif origin:
            h["Origin"] = origin
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
    signin.reset()
    yield tmp_path
    signin.reset()
    relay_copilot.reset()


@pytest.fixture
def sdk(env, monkeypatch):
    stub = SdkStub()
    stub.signed_in = False
    root, sess = stub.modules()
    monkeypatch.setitem(sys.modules, "copilot", root)
    monkeypatch.setitem(sys.modules, "copilot.session", sess)
    return stub


@pytest.fixture
def srv(env):
    s = Srv()
    yield s
    s.stop()


@pytest.fixture
def cli(env, monkeypatch):
    script = env / "copilot_stub.py"
    script.write_text(CLI_STUB, encoding="utf-8")
    flag = env / "signin-flag"
    monkeypatch.setattr(signin, "login_argv", lambda: [sys.executable, str(script), str(flag), "login", "--device-code"])
    return flag


def raw_store(env):
    p = env / "llm-ui.local.json"
    return p.read_bytes() if p.exists() else b""


def wait_state(srv, want, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        st, b, raw = srv.call("GET", "/api/llm/copilot/signin")
        if b and b.get("state") == want:
            return b, raw
        time.sleep(0.05)
    raise AssertionError("state %s not reached: %s" % (want, b))


# ---------------------------------------------------------------- AC-510 保存・削除・検査


# FR-088 AC-510 / NFR-SEC-006 AC-515: トークンは封をして保存され、応答・保管先のファイルに平文で含まれず、再起動しても保たれる
def test_fr088_ac510_ac515_save_token_sealed_and_not_returned(srv, env):
    st, b, raw = srv.call("POST", "/api/llm/copilot", {"authMethod": "token", "model": "dummy-model", "token": DUMMY_TOKEN})
    assert st == 200 and b["ok"] is True and b["result"] == "saved"
    assert b["copilot"]["tokenConfigured"] is True and b["copilot"]["tokenSource"] == "ui"
    assert b["copilot"]["authMethod"] == "token" and b["copilot"]["model"] == "dummy-model"
    assert DUMMY_TOKEN not in raw
    assert DUMMY_TOKEN.encode() not in raw_store(env) and b"dummy-model" not in raw_store(env)
    relay_copilot.reset()  # 再起動の代わり: 保管先から読み直す
    cs = cfg.load_copilot_settings()
    assert (cs.auth_method, cs.model, cs.token) == ("token", "dummy-model", DUMMY_TOKEN)
    st, b, raw = srv.call("GET", "/api/llm/status")
    assert st == 200 and DUMMY_TOKEN not in raw and "authorization" not in raw.lower()
    assert b["copilot"]["tokenConfigured"] is True and b["copilot"]["tokenSource"] == "ui"
    # 削除で画面での保存の値が消える
    st, b, raw = srv.call("DELETE", "/api/llm/copilot")
    assert st == 200 and b["result"] == "deleted"
    cs = cfg.load_copilot_settings()
    assert (cs.auth_method, cs.model, cs.token) == ("signin", "", None)


# FR-088 AC-510: 不正なトークン・モデル名・認証方式の不一致は拒否し、保存済みの値は変わらず、応答に入力値を含めない
@pytest.mark.parametrize("body,reason", [
    ({"authMethod": "token", "token": ""}, "token_format"),
    ({"authMethod": "token", "token": "   "}, "token_format"),
    ({"authMethod": "token", "token": "abc\u0000PROBE-CTRL"}, "token_format"),
    ({"authMethod": "token", "token": "P" * 513}, "token_format"),
    ({"authMethod": "token", "model": "   "}, "model_format"),
    ({"authMethod": "token", "model": "m\u0007PROBE-CTRL"}, "model_format"),
    ({"authMethod": "token", "model": "M" * 65}, "model_format"),
    ({"authMethod": "bogus"}, "auth_method_format"),
    ({"authMethod": "signin", "token": "PROBE-SIGNIN-TOKEN"}, "auth_method_mismatch"),
])
def test_fr088_ac510_reject_invalid_values(srv, env, body, reason):
    store.save({"copilotAuthMethod": "token", "copilotModel": "kept-model", "copilotToken": DUMMY_TOKEN})
    before = raw_store(env)
    st, b, raw = srv.call("POST", "/api/llm/copilot", body)
    assert st == 400 and b["ok"] is False and b["result"] == "invalid" and b["reason"] == reason
    assert raw_store(env) == before
    for v in body.values():
        if len(v) >= 4 and v not in ("token", "signin"):
            assert v not in raw
    assert DUMMY_TOKEN not in raw
    # 長さの上限ちょうどは受け付ける（PARAM-094・PARAM-096）
    st, b, _ = srv.call("POST", "/api/llm/copilot", {"authMethod": "token", "model": "M" * 64, "token": "T" * 512})
    assert st == 200 and b["result"] == "saved"


# FR-088 AC-510: 同一オリジン以外の保存・削除・サインインの要求は 403 で、保管済みの値は変わらない
def test_fr088_ac510_cross_origin_rejected(srv, env, sdk, cli):
    store.save({"copilotAuthMethod": "token", "copilotToken": DUMMY_TOKEN})
    before = raw_store(env)
    for method, path, body in (("POST", "/api/llm/copilot", {"authMethod": "signin", "model": ""}), ("DELETE", "/api/llm/copilot", None),
                               ("POST", "/api/llm/copilot/signin", {}), ("DELETE", "/api/llm/copilot/signin", None),
                               ("GET", "/api/llm/copilot/signin", None)):
        st, _, raw = srv.call(method, path, body, origin="http://evil.example")
        assert st == 403, (method, path)
        assert DUMMY_TOKEN not in raw
        if method != "GET":
            st, _, _ = srv.call(method, path, body, origin=None)
            assert st == 403, ("no origin", method, path)
        st, _, _ = srv.call(method, path, body, host="evil.example")
        assert st == 403, ("host", method, path)
    assert raw_store(env) == before
    assert not os.path.exists(str(cli) + ".argv"), "サインインは始まらない"


# FR-088 AC-510: 環境変数（COPILOT_GITHUB_TOKEN ＞ GH_TOKEN ＞ GITHUB_TOKEN）＞ 設定ファイル ＞ 画面。上位の値は画面から上書き・削除できない
def test_fr088_ac510_env_priority_and_locked(srv, env, monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "DUMMY-GITHUB-TOKEN-3")
    assert cfg.load_copilot_settings().token == "DUMMY-GITHUB-TOKEN-3"
    monkeypatch.setenv("GH_TOKEN", "DUMMY-GH-TOKEN-2")
    assert cfg.load_copilot_settings().token == "DUMMY-GH-TOKEN-2"
    monkeypatch.setenv("COPILOT_GITHUB_TOKEN", DUMMY_TOKEN)
    cs = cfg.load_copilot_settings()
    assert cs.token == DUMMY_TOKEN and cs.sources["token"] == "env"
    monkeypatch.setenv("COPILOT_AUTH_METHOD", "token")
    st, b, raw = srv.call("POST", "/api/llm/copilot", {"authMethod": "token", "model": "", "token": "DUMMY-UI-TOKEN"})
    assert st == 409 and b["result"] == "env_managed" and b["copilot"]["tokenSource"] == "env"
    assert DUMMY_TOKEN not in raw and "DUMMY-GH-TOKEN-2" not in raw
    assert store.load()["copilotToken"] is None
    st, b, _ = srv.call("POST", "/api/llm/copilot", {"authMethod": "signin", "model": ""})
    assert st == 409 and b["result"] == "env_managed"
    st, b, _ = srv.call("DELETE", "/api/llm/copilot")
    assert st == 409 and b["result"] == "env_managed"
    assert cfg.load_copilot_settings().token == DUMMY_TOKEN
    # 設定ファイルのモデル名は画面から変えられない（同じ値の再送は受け付ける）
    (env / "llm.local.json").write_text(json.dumps({"copilot": {"model": "file-model"}}), encoding="utf-8")
    st, b, _ = srv.call("POST", "/api/llm/copilot", {"authMethod": "token", "model": "other"})
    assert st == 409 and b["result"] == "env_managed" and b["copilot"]["modelSource"] == "file"
    st, b, _ = srv.call("POST", "/api/llm/copilot", {"authMethod": "token", "model": "file-model"})
    assert st == 200 and b["result"] == "saved"


# FR-088 AC-510: 認証方式がサインインのときは SDK（CLI）にトークンを渡さない。トークンのときはトークンを引数に置かない（AC-515）
def test_fr088_ac510_signin_does_not_pass_token(env, sdk, monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "copilot")
    monkeypatch.setenv("GITHUB_TOKEN", "DUMMY-OTHER-USE-TOKEN")
    cs = cfg.load_copilot_settings()
    assert cs.auth_method == "signin" and cs.token == "DUMMY-OTHER-USE-TOKEN"
    relay_copilot.probe(cs)
    kw = sdk.client_kwargs[-1]
    assert kw["use_logged_in_user"] is True and "github_token" not in kw
    assert not any(k in kw["env"] for k in ("COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"))
    assert "DUMMY-OTHER-USE-TOKEN" not in json.dumps(kw, default=str)
    relay_copilot.reset()
    monkeypatch.setenv("COPILOT_AUTH_METHOD", "token")
    cs = cfg.load_copilot_settings()
    relay_copilot.probe(cs)
    kw = sdk.client_kwargs[-1]
    assert kw["use_logged_in_user"] is False and kw["github_token"] == "DUMMY-OTHER-USE-TOKEN"
    assert not any("DUMMY-OTHER-USE-TOKEN" in str(a) for a in kw.get("cli_args", []) or [])


# ---------------------------------------------------------------- AC-509 サインイン（デバイスフロー）


# FR-088 AC-509: サインインを始めると確認のページの URL と確認コードを返し、承認で completed。資格情報は返さず保存しない
def test_fr088_ac509_device_flow_completes(srv, env, sdk, cli, monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "DUMMY-OTHER-USE-TOKEN")
    st, b, raw = srv.call("POST", "/api/llm/copilot/signin", {})
    assert st == 200 and b == {"ok": True, "state": "pending", "verificationUri": "https://github.com/login/device", "userCode": "ABCD-1234"}
    argv_file = str(cli) + ".argv"
    args, _, env_tokens = open(argv_file).read().partition("\n")
    assert args == "login --device-code", "引数に秘密を置かない"
    assert env_tokens.strip() == "", "子プロセスに GitHub のトークンの環境変数を渡さない"
    b, _ = wait_state(srv, "pending")
    cli.write_text("ok")
    sdk.signed_in = True
    b, raw = wait_state(srv, "completed")
    assert CRED not in raw and "octo-dummy" not in raw and "Signed" not in raw
    st, b, raw = srv.call("GET", "/api/llm/status")
    assert b["copilot"]["signedIn"] is True and b["copilot"]["account"]
    assert CRED.encode() not in raw_store(env)
    assert CRED not in raw


# FR-088 AC-509: 期限切れ・拒否・失敗・取り消しは分類だけを返し、もう一度始められる
@pytest.mark.parametrize("mode,state", [("expired", "expired"), ("denied", "denied"), ("boom", "failed"), (None, "cancelled")])
def test_fr088_ac509_device_flow_failures(srv, env, sdk, cli, mode, state):
    st, b, _ = srv.call("POST", "/api/llm/copilot/signin", {})
    assert st == 200 and b["state"] == "pending"
    if mode is None:
        st, b, raw = srv.call("DELETE", "/api/llm/copilot/signin")
        assert st == 200 and b["state"] == "cancelled"
    else:
        cli.write_text(mode)
    b, raw = wait_state(srv, state)
    assert CRED not in raw and set(b) == {"state"}
    if cli.exists():
        cli.unlink()
    st, b, _ = srv.call("POST", "/api/llm/copilot/signin", {})
    assert st == 200 and b["state"] == "pending", "もう一度始められる"


# FR-088 AC-509: 認証方式がトークンのとき・SDK がないときはサインインを始めない
def test_fr088_ac509_signin_refused(srv, env, cli, monkeypatch):
    monkeypatch.setitem(sys.modules, "copilot", None)
    st, b, _ = srv.call("POST", "/api/llm/copilot/signin", {})
    assert st == 409 and b["result"] == "sdk_missing"
    monkeypatch.setenv("COPILOT_AUTH_METHOD", "token")
    st, b, _ = srv.call("POST", "/api/llm/copilot/signin", {})
    assert st == 409 and b["result"] == "auth_method_mismatch"
    assert not os.path.exists(str(cli) + ".argv")


# FR-088 AC-509: 確認コードの期限を過ぎたら子プロセスを止めて expired
def test_fr088_ac509_device_code_ttl(srv, env, sdk, cli, monkeypatch):
    srv.call("POST", "/api/llm/copilot/signin", {})
    monkeypatch.setattr(signin, "DEVICE_CODE_TTL_SEC", 0)
    b, _ = wait_state(srv, "expired")
    assert b == {"state": "expired"}


# ---------------------------------------------------------------- AC-515 リポジトリ・ログ


# NFR-SEC-006 AC-515: 中継サーバーのログ（標準エラー）にトークンが出ない
def test_nfr_sec006_ac515_relay_log_has_no_token(env, tmp_path):
    code = textwrap.dedent('''
        import json, os, sys, threading, http.client
        sys.path.insert(0, %r)
        import relay
        s = relay.make_server(0, %r); port = s.server_address[1]
        threading.Thread(target=s.serve_forever, daemon=True).start()
        h = {"Host": "127.0.0.1:%%d" %% port, "Origin": "http://127.0.0.1:%%d" %% port, "Content-Type": "application/json"}
        for m, p, b in (("POST", "/api/llm/copilot", {"authMethod": "token", "token": %r}), ("POST", "/api/llm/copilot", {"authMethod": "token", "token": %r + "\\u0000"}), ("GET", "/api/llm/status", None)):
            c = http.client.HTTPConnection("127.0.0.1", port); c.request(m, p, body=None if b is None else json.dumps(b), headers=h); r = c.getresponse(); print(r.read().decode()); c.close()
        s.shutdown()
    ''') % (os.path.join(ROOT, "server"), WEB, DUMMY_TOKEN, DUMMY_TOKEN)
    e = {k: v for k, v in os.environ.items() if k not in ENV_NAMES}
    e["RELAY_LLM_STORE"] = str(tmp_path / "llm-ui.local.json")
    e["LLM_CONFIG_PATH"] = str(tmp_path / "llm.local.json")
    p = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60, env=e)
    assert p.returncode == 0, p.stderr[-500:]
    assert DUMMY_TOKEN not in p.stdout and DUMMY_TOKEN not in p.stderr
    assert "/api/llm/copilot" in p.stderr


# NFR-SEC-006 AC-515: リポジトリに GitHub のトークンの実値らしい文字列が 0 件
def test_nfr_sec006_ac515_no_real_github_token_in_repo():
    pat = re.compile(r"(github_pat_[A-Za-z0-9_]{60,}|\bgh[pousr]_[A-Za-z0-9]{36,})")
    hits = []
    for d in ("docs", "server", "web", "tests", "config", "users-guide", "scripts"):
        for base, dirs, files in os.walk(os.path.join(ROOT, d)):
            dirs[:] = [x for x in dirs if x not in ("node_modules", "__pycache__", ".venv")]
            for f in files:
                if not f.endswith((".md", ".py", ".js", ".json", ".css", ".html", ".txt", ".ps1", ".sh", ".example")):
                    continue
                try:
                    text = open(os.path.join(base, f), encoding="utf-8").read()
                except (OSError, UnicodeDecodeError):
                    continue
                hits += [(f, m.group(0)[:12]) for m in pat.finditer(text)]
    assert hits == []
