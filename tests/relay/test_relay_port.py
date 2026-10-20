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


def _spawn(*args, home=None):
    env = dict(os.environ, PYTHONUNBUFFERED="1")
    if home is not None:  # ホームを一時ディレクトリへ差し替える（HOME / USERPROFILE）
        env["HOME"] = str(home)
        env["USERPROFILE"] = str(home)
    return subprocess.Popen(
        [sys.executable, RELAY, "--web", WEB] + list(args),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, cwd=ROOT,
        universal_newlines=True, encoding="utf-8", errors="replace",
    )


def _read_port(proc, timeout=15, more=None):
    """標準出力から実際の URL を読み、ポートを返す。more に dict を渡すと行と続きの出力を入れる。"""
    import threading
    box = {"lines": []}

    def reader():
        for line in proc.stdout:
            box["lines"].append(line)
            m = URL_RE.search(line)
            if m and "port" not in box:
                box["port"] = int(m.group(1))
                box["line"] = line
                box["ready"] = True

    t = threading.Thread(target=reader, daemon=True)
    t.start()
    end = time.time() + timeout
    while time.time() < end and "port" not in box:
        time.sleep(0.05)
    if more is not None:
        time.sleep(0.7)  # 案内の続きの行を待つ
        more.update(box)
    return box.get("port")


def _free_port():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def _last_port_file(home):
    return os.path.join(str(home), ".graphic-recording-panel", "last-port")


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
def test_auto_port_starts_while_8080_busy_and_prints_actual_url(occupy_8080, args, tmp_path):
    proc = _spawn(*args, home=tmp_path)
    try:
        info = {}
        port = _read_port(proc, more=info)
        assert port is not None, "標準出力に http://127.0.0.1:<port>/ が出ていない"
        assert port != 8080 and 1 <= port <= 65535
        assert proc.poll() is None
        assert _get(port, "127.0.0.1:%d" % port) == 200
        # AC-476: URL は 1 行（書式は http://127.0.0.1:<port>/）
        url_lines = [l for l in info["lines"] if URL_RE.search(l)]
        assert len(url_lines) == 1, url_lines
        assert url_lines[0].strip() == "http://127.0.0.1:%d/" % port or \
            url_lines[0].strip().endswith("http://127.0.0.1:%d/" % port)
        # AC-475: 待ち受け成功で last-port を実ポートに更新
        with open(_last_port_file(tmp_path), encoding="utf-8") as f:
            assert f.read().strip() == str(port)
    finally:
        _stop(proc)


# FR-083 AC-475（前回のポートを最初に試す）
def test_last_port_is_tried_first(tmp_path):
    want = _free_port()
    os.makedirs(os.path.dirname(_last_port_file(tmp_path)))
    with open(_last_port_file(tmp_path), "w", encoding="utf-8") as f:
        f.write(str(want))
    proc = _spawn(home=tmp_path)
    try:
        info = {}
        port = _read_port(proc, more=info)
        assert port == want
        # 同じポートなので「引き継がれない」旨は出さない
        assert not any("引き継" in l for l in info["lines"])
        with open(_last_port_file(tmp_path), encoding="utf-8") as f:
            assert f.read().strip() == str(want)
    finally:
        _stop(proc)


# FR-083 AC-475 AC-476（前回のポートが使用中: 別ポートで起動し、案内を表示し、保存を更新）
def test_last_port_busy_falls_back_and_warns_and_updates(tmp_path):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    s.listen(1)
    busy = s.getsockname()[1]
    os.makedirs(os.path.dirname(_last_port_file(tmp_path)))
    with open(_last_port_file(tmp_path), "w", encoding="utf-8") as f:
        f.write(str(busy))
    proc = _spawn(home=tmp_path)
    try:
        info = {}
        port = _read_port(proc, more=info)
        assert port is not None and port != busy
        text = "".join(info["lines"])
        assert "引き継" in text, "保存データが引き継がれない旨の案内がない"
        with open(_last_port_file(tmp_path), encoding="utf-8") as f:
            assert f.read().strip() == str(port)
    finally:
        _stop(proc)
        s.close()


# FR-083 AC-475（異常系: 値が不正・ファイルが読めない → 未保存として扱い起動する）
@pytest.mark.parametrize("content", ["abc", "0", "65536", "-5", "80.5", ""])
def test_invalid_last_port_treated_as_unsaved(tmp_path, occupy_8080, content):
    os.makedirs(os.path.dirname(_last_port_file(tmp_path)))
    with open(_last_port_file(tmp_path), "w", encoding="utf-8") as f:
        f.write(content)
    proc = _spawn(home=tmp_path)
    try:
        port = _read_port(proc)
        assert port is not None and 1 <= port <= 65535
        assert proc.poll() is None
    finally:
        _stop(proc)


# FR-083 AC-475（異常系: 保存に失敗しても起動は続ける）
def test_last_port_write_failure_does_not_stop_startup(tmp_path):
    # last-port をディレクトリにして読み書きを失敗させる
    os.makedirs(_last_port_file(tmp_path))
    proc = _spawn(home=tmp_path)
    try:
        port = _read_port(proc)
        assert port is not None
        assert proc.poll() is None
        assert _get(port, "127.0.0.1:%d" % port) == 200
    finally:
        _stop(proc)


# FR-083 AC-477（--port 指定は last-port を使わず、N で待ち受ける）
def test_explicit_port_ignores_saved_last_port(tmp_path):
    other = _free_port()
    os.makedirs(os.path.dirname(_last_port_file(tmp_path)))
    with open(_last_port_file(tmp_path), "w", encoding="utf-8") as f:
        f.write(str(other))
    want = _free_port()
    proc = _spawn("--port", str(want), home=tmp_path)
    try:
        assert _read_port(proc) == want
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
@pytest.mark.parametrize("bad", ["65536", "-1", "99999", "abc", "80.5", ""])
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
        assert _get(port, ok, origin="http://127.0.0.1:%d" % port) == 200
        assert _get(port, "127.0.0.1:%d" % (port + 1)) == 403
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
    # 対象は README・users-guide・start.ps1・start.sh のみ（EABK-docs は対象外）
    files = [os.path.join(ROOT, n) for n in ("README.md", "start.ps1", "start.sh")]
    for base, _, names in os.walk(os.path.join(ROOT, "users-guide")):
        files += [os.path.join(base, n) for n in names if n.endswith(".md")]
    bad = []
    mentions_port_opt = False
    mentions_lost_data = False
    for f in files:
        txt = open(f, encoding="utf-8", errors="replace").read()
        if "--port" in txt:
            mentions_port_opt = True
        if "引き継" in txt:
            mentions_lost_data = True
        for i, line in enumerate(txt.splitlines(), 1):
            if re.search(r"localhost:8080|127\.0\.0\.1:8080", line):
                bad.append("%s:%d" % (os.path.relpath(f, ROOT), i))
    assert not bad, bad
    assert mentions_port_opt, "`--port N` で固定できる説明がない"
    assert mentions_lost_data, "別ポートで起動すると保存データが引き継がれない旨の説明がない"


# FR-083 AC-481
@pytest.mark.parametrize("mode", ["last", "os"])
def test_auto_port_listens_on_loopback_only(tmp_path, mode):
    if mode == "last":  # 前回のポート経路
        os.makedirs(os.path.dirname(_last_port_file(tmp_path)))
        with open(_last_port_file(tmp_path), "w", encoding="utf-8") as f:
            f.write(str(_free_port()))
    else:  # OS 割り当て経路（ポート 0）
        pass
    proc = _spawn(*(["--port", "0"] if mode == "os" else []), home=tmp_path)
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
