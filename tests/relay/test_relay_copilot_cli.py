"""FR-087 / FR-088 Copilot CLI の起動の取り扱い（AC-516・AC-517・AC-518、AC-505・AC-506・AC-507 の中継サーバー側）。

Copilot CLI は一時フォルダーに書く Python のスタブ（Windows は copilot.cmd → python → 子の python のプロセスの木、
それ以外はシェルスクリプト → python → 子の python）。GitHub Copilot SDK は sys.modules に置いたスタブで、start() で
CLI のスタブを子プロセスとして起動する（実の SDK と同じく、接続 RuntimeConnection.for_stdio の args・env を使う）。
GitHub へは通信しない。
"""
import asyncio
import json
import os
import subprocess
import sys
import textwrap
import time
import types

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "server"))
sys.path.insert(0, os.path.dirname(__file__))

import relay_copilot  # noqa: E402
import relay_copilot_signin as signin  # noqa: E402
import relay_proctree as proctree  # noqa: E402
from test_relay_copilot import EXTRACT, ENV_NAMES, Srv, use_copilot  # noqa: E402

CLI_FLAGS = ["--disable-client-telemetry", "--no-auto-update"]

# Copilot CLI のスタブ: 起動時の引数・環境変数・自分と子のプロセス ID を JSON Lines で記録し、子のプロセスを起動して待つ
CLI_STUB = textwrap.dedent('''
    import json, os, subprocess, sys, time
    log = os.environ["GRP_TEST_CLI_LOG"]
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
    with open(log, "a", encoding="utf-8") as f:
        f.write(json.dumps({"argv": sys.argv[1:], "autoUpdate": os.environ.get("COPILOT_AUTO_UPDATE"),
                            "pid": os.getpid(), "child": child.pid}) + "\\n")
    if sys.argv[1:2] == ["login"]:
        print("To authenticate, visit https://github.com/login/device and enter code ABCD-1234", flush=True)
    time.sleep(120)
''')


def _write_cli(tmp_path):
    py = tmp_path / "copilot_cli_stub.py"
    py.write_text(CLI_STUB, encoding="utf-8")
    if os.name == "nt":
        cli = tmp_path / "copilot.cmd"
        cli.write_text('@"%s" "%s" %%*\r\n' % (sys.executable, py), encoding="utf-8")
    else:
        cli = tmp_path / "copilot"
        cli.write_text('#!/bin/sh\n"%s" "%s" "$@"\n' % (sys.executable, py), encoding="utf-8")  # exec しない: 木にする
        cli.chmod(0o755)
    return str(cli)


class ProcSdkStub(object):
    """CLI のスタブを子プロセスとして起動する SDK のスタブ。stop() は直接の子だけを止める（孫は残す: 木ごと止めるのは中継サーバーの役目）。"""

    def __init__(self, cli, with_connection=True):
        self.cli = cli
        self.with_connection = with_connection
        self.start_delay = 0.0
        self.start_fail = False
        self.starts = 0
        self.client_kwargs = []
        self.procs = []
        self.sent = []

    def modules(self):
        stub = self

        class RuntimeConnection(object):
            def __init__(self, path, args):
                self.path, self.args, self.env = path, list(args or []), None

            @classmethod
            def for_stdio(cls, path=None, args=None):
                return cls(path, args)

        class Session(object):
            async def send_and_wait(self, prompt, timeout=60.0):
                stub.sent.append(prompt)
                return types.SimpleNamespace(type="assistant.message", data=types.SimpleNamespace(content='{"points":["a"]}'))

            async def disconnect(self):
                pass

        class CopilotClient(object):
            def __init__(self, **kwargs):
                stub.client_kwargs.append(kwargs)
                self.kw = kwargs
                self._process = None

            async def start(self):
                stub.starts += 1
                if stub.start_fail:
                    raise FileNotFoundError("copilot not found at C:\\Users\\dummy\\secret-path")
                conn = self.kw.get("connection")
                args = list(conn.args) if conn is not None else list(self.kw.get("cli_args") or [])
                env = conn.env if conn is not None else self.kw.get("env")
                self._process = await asyncio.create_subprocess_exec(
                    stub.cli, "--headless", "--stdio", *args, env=env,
                    stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
                stub.procs.append(self._process.pid)
                if stub.start_delay:
                    await asyncio.sleep(stub.start_delay)

            async def stop(self):
                if self._process is not None and self._process.returncode is None:
                    try:
                        self._process.terminate()  # 直接の子だけ（copilot.cmd・シェル）。node に当たる孫は残る
                    except ProcessLookupError:
                        pass

            async def get_auth_status(self):
                return types.SimpleNamespace(is_authenticated=True, login="octo-dummy")

            async def create_session(self, **opts):
                return Session()

        root = types.ModuleType("copilot")
        root.CopilotClient = CopilotClient
        if self.with_connection:
            root.RuntimeConnection = RuntimeConnection
        sess = types.ModuleType("copilot.session")
        root.session = sess
        return root, sess


@pytest.fixture
def env(tmp_path, monkeypatch):
    for n in ENV_NAMES + ("COPILOT_CLI_PATH", "COPILOT_AUTO_UPDATE"):
        monkeypatch.delenv(n, raising=False)
    monkeypatch.setenv("RELAY_LLM_STORE", str(tmp_path / "llm-ui.local.json"))
    monkeypatch.setenv("LLM_CONFIG_PATH", str(tmp_path / "llm.local.json"))
    monkeypatch.setenv("GRP_TEST_CLI_LOG", str(tmp_path / "cli-log.jsonl"))
    cli = _write_cli(tmp_path)
    monkeypatch.setenv("COPILOT_CLI_PATH", cli)
    relay_copilot.reset()
    signin.reset()
    yield tmp_path
    signin.reset()
    relay_copilot.reset()
    for rec in _cli_log(tmp_path):  # 念のため: テストの後に残さない
        for p in (rec["pid"], rec["child"]):
            if proctree.alive(p):
                proctree.kill_tree(p)


def _cli_log(tmp_path):
    f = tmp_path / "cli-log.jsonl"
    return [json.loads(x) for x in f.read_text(encoding="utf-8").splitlines() if x.strip()] if f.exists() else []


def _wait_log(tmp_path, n, sec=20):
    t0 = time.time()
    while time.time() - t0 < sec:
        if len(_cli_log(tmp_path)) >= n:
            return _cli_log(tmp_path)
        time.sleep(0.05)
    return _cli_log(tmp_path)


def _install(monkeypatch, stub):
    root, sess = stub.modules()
    monkeypatch.setitem(sys.modules, "copilot", root)
    monkeypatch.setitem(sys.modules, "copilot.session", sess)
    return stub


@pytest.fixture
def psdk(env, monkeypatch):
    return _install(monkeypatch, ProcSdkStub(os.environ["COPILOT_CLI_PATH"]))


@pytest.fixture
def srv(env):
    s = Srv()
    yield s
    s.stop()


def _all_dead(pids, sec=10):
    t0 = time.time()
    while time.time() - t0 < sec:
        if not any(proctree.alive(p) for p in pids):
            return True
        time.sleep(0.1)
    return not any(proctree.alive(p) for p in pids)


# ---------------------------------------------------------------- AC-516: 利用状況の送信・自動更新を無効にして起動


# FR-087 AC-516 AC-507: 状態の確認・LLM 向けの要求・サインインのどの起動でも、引数に --disable-client-telemetry と
# --no-auto-update、環境変数に COPILOT_AUTO_UPDATE=false が含まれる
def test_fr087_ac516_cli_started_with_telemetry_and_autoupdate_disabled(psdk, srv, env, monkeypatch):
    use_copilot(monkeypatch)
    # 状態の確認（プロバイダーが GitHub Copilot のときの GET /api/llm/status。AC-507 で起動してよい時点）
    st = srv.call("GET", "/api/llm/status")[1]
    assert st["copilot"]["available"] is True
    assert len(_wait_log(env, 1)) == 1, "状態の確認で CLI を起動した"
    # LLM 向けの要求（設定の変更で CLI を起動し直させてから）
    relay_copilot.reset()
    assert srv.call("POST", "/api/llm/extract", EXTRACT)[0] == 200
    assert len(_wait_log(env, 2)) == 2, "LLM 向けの要求で CLI を起動した"
    # サインイン（copilot login --device-code）
    relay_copilot.reset()
    r = signin.start()
    assert r["ok"] is True and r["state"] == "pending", r
    signin.cancel()
    recs = _wait_log(env, 3)
    assert len(recs) == 3, recs
    for rec in recs:
        assert all(f in rec["argv"] for f in CLI_FLAGS), rec["argv"]
        assert rec["autoUpdate"] == "false"
    assert recs[2]["argv"][:2] == ["login", "--device-code"], "サインインのコマンドは login が先頭"
    conn = psdk.client_kwargs[0]["connection"]
    assert conn.args == CLI_FLAGS and conn.env["COPILOT_AUTO_UPDATE"] == "false"
    assert "env" not in psdk.client_kwargs[0], "接続の env とクライアントの env を両方は渡さない（SDK の仕様）"


# FR-087 AC-516: RuntimeConnection を持たない SDK では、クライアントの cli_args・env で同じ引数・環境変数を渡す
def test_fr087_ac516_cli_args_without_runtime_connection(env, srv, monkeypatch):
    stub = _install(monkeypatch, ProcSdkStub(os.environ["COPILOT_CLI_PATH"], with_connection=False))
    use_copilot(monkeypatch)
    assert srv.call("POST", "/api/llm/extract", EXTRACT)[0] == 200
    kw = stub.client_kwargs[0]
    assert kw["cli_args"] == CLI_FLAGS and kw["env"]["COPILOT_AUTO_UPDATE"] == "false"
    rec = _wait_log(env, 1)[0]
    assert all(f in rec["argv"] for f in CLI_FLAGS) and rec["autoUpdate"] == "false"


# FR-087 AC-507 AC-516: プロバイダーが Microsoft Foundry のときの状態の取得では CLI を起動しない（起動の記録 0 件）
def test_fr087_ac507_foundry_status_records_no_cli_start(psdk, srv, env):
    for _ in range(2):
        cp = srv.call("GET", "/api/llm/status")[1]["copilot"]
        assert cp["available"] is True and cp["signedIn"] is None
    time.sleep(0.3)
    assert _cli_log(env) == [] and psdk.starts == 0


# ---------------------------------------------------------------- AC-517: プロセスの木ごと止める


# FR-087 AC-517: 中継サーバーが CLI を止めるとき（設定の変更・終了）、copilot.cmd（シェル）・CLI・その子のプロセスが残らない
def test_fr087_ac517_stop_kills_cli_process_tree(psdk, srv, env, monkeypatch):
    use_copilot(monkeypatch)
    assert srv.call("POST", "/api/llm/extract", EXTRACT)[0] == 200
    rec = _wait_log(env, 1)[0]
    pids = [psdk.procs[0], rec["pid"], rec["child"]]
    assert all(proctree.alive(p) for p in pids), "前提: CLI のスタブとその子が動いている"
    relay_copilot.shutdown()  # 中継サーバーの終了と同じ止め方
    assert _all_dead(pids), [p for p in pids if proctree.alive(p)]


# FR-088 AC-517: サインインの取り消しで、copilot login のプロセスとその子のプロセスが残らない
def test_fr088_ac517_signin_cancel_kills_process_tree(psdk, env):
    r = signin.start()
    assert r["ok"] is True and r["state"] == "pending", r
    rec = _wait_log(env, 1)[0]
    pids = [rec["pid"], rec["child"]]
    assert all(proctree.alive(p) for p in pids)
    assert signin.cancel()["state"] == "cancelled"
    assert _all_dead(pids), [p for p in pids if proctree.alive(p)]


# FR-087 AC-517: 木ごと止める部品（relay_proctree）は、子のプロセスを起動したプロセスの子・孫まで止める
def test_fr087_ac517_kill_tree_unit(tmp_path):
    log = tmp_path / "pids.txt"
    code = ("import subprocess,sys,time;c=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']);"
            "open(sys.argv[1],'w').write(str(c.pid));time.sleep(60)")
    p = subprocess.Popen([sys.executable, "-c", code, str(log)], **proctree.popen_kwargs())
    t0 = time.time()
    while not (log.exists() and log.read_text().strip()) and time.time() - t0 < 20:
        time.sleep(0.05)
    child = int(log.read_text())
    assert child in proctree.descendants(p.pid)
    proctree.stop_popen(p)
    assert _all_dead([p.pid, child])


# ---------------------------------------------------------------- AC-518: 初回の起動を含めて PARAM-069 で打ち切る


# FR-087 AC-518 AC-506: 起動が遅い初回の要求も PARAM-069 秒で打ち切ってタイムアウトのエラーを返す。起動は背景で続け、
# 次の要求では起動し直さずに使い回す（監査 U-1）
def test_fr087_ac518_first_request_times_out_including_cli_start(psdk, srv, env, monkeypatch):
    use_copilot(monkeypatch)
    monkeypatch.setenv("RELAY_TIMEOUT_SEC", "1")  # PARAM-069 を短くした設定
    psdk.start_delay = 3.0
    t0 = time.monotonic()
    status, payload, raw = srv.call("POST", "/api/llm/extract", EXTRACT)
    elapsed = time.monotonic() - t0
    assert (status, payload["error"]["code"]) == (504, "upstream_timeout"), raw
    assert elapsed < 1.0 + 0.8, "要求の受け付けから PARAM-069 秒で打ち切る: %.2f" % elapsed
    assert "secret-path" not in raw and psdk.sent == []
    time.sleep(3.0)  # 背景の起動が済むのを待つ
    monkeypatch.setenv("RELAY_TIMEOUT_SEC", "10")
    assert srv.call("POST", "/api/llm/extract", EXTRACT)[0] == 200
    assert psdk.starts == 1, "打ち切った後も起動を続け、次の要求で使い回す（起動し直さない）"
    assert len(_cli_log(env)) == 1


# FR-087 AC-518: 起動が済むまでに来た続きの要求も、同じ起動を待ち（二重に起動しない）、それぞれ PARAM-069 秒で打ち切る
def test_fr087_ac518_pending_start_is_shared(psdk, srv, monkeypatch):
    use_copilot(monkeypatch)
    monkeypatch.setenv("RELAY_TIMEOUT_SEC", "1")
    psdk.start_delay = 2.5
    for _ in range(2):
        assert srv.call("POST", "/api/llm/extract", EXTRACT)[1]["error"]["code"] == "upstream_timeout"
    assert psdk.starts == 1


# ---------------------------------------------------------------- AC-505・AC-506: CLI を起動できない


# FR-087 AC-505 AC-506: SDK は導入済みで CLI を起動できないときは missing:['cli']（SDK 未導入の ['sdk'] と区別）、
# 要求は cli_unavailable で上流へ送らない
def test_fr087_ac506_cli_unavailable_is_cli_not_sdk(psdk, srv, monkeypatch):
    psdk.start_fail = True
    use_copilot(monkeypatch)
    cp = srv.call("GET", "/api/llm/status")[1]["copilot"]
    assert cp["available"] is False and cp["unavailableReason"] == "cli_unavailable"
    assert cp["missing"] == ["cli"] and cp["ready"] is False
    relay_copilot.reset()
    status, payload, raw = srv.call("POST", "/api/llm/extract", EXTRACT)
    assert status == 503 and payload["error"]["code"] == "cli_unavailable" and payload["error"]["missing"] == ["cli"]
    assert "secret-path" not in raw and psdk.sent == []
