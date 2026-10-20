"""FR-083 起動時の待ち受けポートの自動選択（AC-475〜AC-481）。期待値は受入基準だけから決める。

実際に server/relay.py を子プロセスで起動し、テスト内で 8080 を実際に占有して再現する。
契約: tests/system/CONTRACT-FR083.md
"""
import http.client
import os
import re
import socket
import subprocess
import sys
import time

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RELAY = os.path.join(ROOT, "server", "relay.py")
WEB = os.path.join(ROOT, "web")
URL_RE = re.compile(r"http://127\.0\.0\.1:(\d+)/")


def _spawn(*args):
    env = dict(os.environ, PYTHONUNBUFFERED="1")
    return subprocess.Popen(
        [sys.executable, RELAY, "--web", WEB] + list(args),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, cwd=ROOT,
        universal_newlines=True, encoding="utf-8", errors="replace",
    )


def _read_port(proc, timeout=15):
    """標準出力から実際の URL を読み、ポートを返す。"""
    import threading
    box = {}

    def reader():
        for line in proc.stdout:
            m = URL_RE.search(line)
            if m:
                box["port"] = int(m.group(1))
                box["line"] = line
                return

    t = threading.Thread(target=reader, daemon=True)
    t.start()
    t.join(timeout)
    return box.get("port")


def _stop(proc):
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()
    for f in (proc.stdout, proc.stderr):
        try:
            f.close()
        except Exception:
            pass


@pytest.fixture
def occupy_8080():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", 8080))
        s.listen(1)
    except OSError:
        pass  # すでに他のプロセスが 8080 を使っている（同じ状況）
    yield
    s.close()


def _get(port, host, origin=None, path="/"):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {"Host": host}
    if origin:
        headers["Origin"] = origin
    c.request("GET", path, headers=headers)
    r = c.getresponse()
    r.read()
    c.close()
    return r.status


# FR-083 AC-475 AC-476
@pytest.mark.parametrize("args", [[], ["--port", "0"]])
def test_auto_port_starts_while_8080_busy_and_prints_actual_url(occupy_8080, args):
    proc = _spawn(*args)
    try:
        port = _read_port(proc)
        assert port is not None, "標準出力に http://127.0.0.1:<port>/ が出ていない"
        assert port != 8080 and 1 <= port <= 65535
        assert proc.poll() is None
        assert _get(port, "127.0.0.1:%d" % port) == 200
    finally:
        _stop(proc)


# FR-083 AC-477（異常系: 使用中）
def test_explicit_port_in_use_exits_nonzero_without_fallback():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    s.listen(1)
    busy = s.getsockname()[1]
    proc = _spawn("--port", str(busy))
    try:
        out, err = proc.communicate(timeout=15)
        assert proc.returncode not in (0, None)
        assert (err or out).strip(), "理由が示されていない"
        assert not URL_RE.search(out or ""), "自動選択に切り替えてはならない"
    finally:
        _stop(proc)
        s.close()


# FR-083 AC-477（異常系: 範囲外）
@pytest.mark.parametrize("bad", ["65536", "-1", "99999"])
def test_explicit_port_out_of_range_exits_nonzero(bad):
    proc = _spawn("--port", bad)
    try:
        out, err = proc.communicate(timeout=15)
        assert proc.returncode not in (0, None)
        assert (err or out).strip()
        assert not URL_RE.search(out or "")
    finally:
        _stop(proc)


# FR-083 AC-477（正常系: 指定ポートで待ち受け）
def test_explicit_port_is_used():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    free = s.getsockname()[1]
    s.close()
    proc = _spawn("--port", str(free))
    try:
        port = _read_port(proc)
        assert port == free
    finally:
        _stop(proc)


# FR-083 AC-478
def test_host_origin_checked_against_actual_port(occupy_8080):
    proc = _spawn()
    try:
        port = _read_port(proc)
        assert port is not None
        ok = "127.0.0.1:%d" % port
        assert _get(port, ok) == 200
        assert _get(port, "localhost:%d" % port) == 200
        assert _get(port, ok, origin="http://localhost:%d" % port) == 200
        assert _get(port, "127.0.0.1:8080") == 403
        assert _get(port, "localhost:8080") == 403
        assert _get(port, ok, origin="http://127.0.0.1:8080") == 403
        assert _get(port, "evil.example") == 403
    finally:
        _stop(proc)


# FR-083 AC-479
@pytest.mark.parametrize("name", ["start.ps1", "start.sh"])
def test_start_scripts_do_not_fix_port_and_pass_args(name):
    src = open(os.path.join(ROOT, name), encoding="utf-8").read()
    assert "8080" not in src
    if name == "start.sh":
        assert '"$@"' in src
    else:
        assert "$args" in src or "@args" in src or "$Args" in src


# FR-083 AC-476
@pytest.mark.parametrize("name", ["start.ps1", "start.sh"])
def test_start_scripts_guide_refers_to_printed_url(name):
    src = open(os.path.join(ROOT, name), encoding="utf-8").read()
    assert "localhost:8080" not in src


# FR-083 AC-480
def test_docs_do_not_assume_fixed_8080():
    files = [os.path.join(ROOT, "README.md")]
    for d in ("users-guide", "EABK-docs"):
        for base, _, names in os.walk(os.path.join(ROOT, d)):
            files += [os.path.join(base, n) for n in names if n.endswith(".md")]
    bad = []
    mentions_port_opt = False
    for f in files:
        txt = open(f, encoding="utf-8", errors="replace").read()
        if "--port" in txt:
            mentions_port_opt = True
        for i, line in enumerate(txt.splitlines(), 1):
            if re.search(r"localhost:8080|127\.0\.0\.1:8080", line):
                bad.append("%s:%d" % (os.path.relpath(f, ROOT), i))
    assert not bad, bad
    assert mentions_port_opt, "`--port N` で固定できる説明がない"


# FR-083 AC-481
def test_auto_port_listens_on_loopback_only():
    proc = _spawn()
    try:
        port = _read_port(proc)
        assert port is not None
        others = set()
        try:
            for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
                ip = info[4][0]
                if not ip.startswith("127."):
                    others.add(ip)
        except OSError:
            pass
        if not others:
            pytest.skip("非ループバックの IPv4 アドレスがない")
        for ip in others:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(2)
            try:
                assert s.connect_ex((ip, port)) != 0, "%s から接続できてしまった" % ip
            finally:
                s.close()
    finally:
        _stop(proc)
