"""FR-113 起動のたびの検査（server/build.py）と /sw.js の配信（AC-653〜AC-658）。

壊す対象は常に一時フォルダーへのコピー。リポジトリのファイルは変更しない。外部通信はしない。
"""
import http.client
import os
import re
import shutil
import socket
import subprocess
import sys
import time

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WIN = os.name == "nt"
NODE = shutil.which("node")
PWSH = shutil.which("pwsh") or shutil.which("powershell")
SH = None if WIN else shutil.which("sh")


def _sandbox(tmp_path):
    dst = tmp_path / "repo"
    dst.mkdir()
    for f in ("start.ps1", "start.sh", "start.cmd"):
        shutil.copy(os.path.join(ROOT, f), dst / f)
    ign = shutil.ignore_patterns("__pycache__")
    shutil.copytree(os.path.join(ROOT, "server"), dst / "server", ignore=ign)
    shutil.copytree(os.path.join(ROOT, "web"), dst / "web", ignore=ign)
    return dst


def _build(dst, env=None, cwd=None):
    return subprocess.run([sys.executable, str(dst / "server" / "build.py")], cwd=str(cwd or dst), env=env,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True,
                          encoding="utf-8", errors="replace", timeout=120)


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def _listening(port):
    try:
        socket.create_connection(("127.0.0.1", port), timeout=1).close()
        return True
    except OSError:
        return False


def _launchers(dst):
    ls = []
    if PWSH:
        ls.append(("start.ps1", [PWSH, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(dst / "start.ps1")]))
    if WIN:
        ls.append(("start.cmd", ["cmd.exe", "/c", str(dst / "start.cmd")]))
    if SH:
        ls.append(("start.sh", [SH, str(dst / "start.sh")]))
    return ls


def _kill(p):
    if p.poll() is None:
        if WIN:
            subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        else:
            p.kill()
    p.wait()


def _run_launcher_until_exit(cmd, port):
    p = subprocess.Popen(cmd + ["--port", str(port)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         universal_newlines=True, encoding="utf-8", errors="replace")
    try:
        out, _ = p.communicate(timeout=60)
    except subprocess.TimeoutExpired:
        _kill(p)
        pytest.fail("起動スクリプトが終了しない（検査の失敗で起動を止めていない）")
    return p.returncode, out


# AC-653 AC-655: server/*.py の構文エラーで失敗し、ファイル名と位置を表示する
def test_ac653_python_syntax_error_fails_with_file_and_line(tmp_path):
    dst = _sandbox(tmp_path)
    with open(dst / "server" / "relay_config.py", "a", encoding="utf-8") as f:
        f.write("\ndef broken(:\n    pass\n")
    r = _build(dst)
    assert r.returncode == 1
    assert "relay_config.py" in r.stdout + r.stderr
    assert re.search(r"\d+", r.stderr)
    assert "build: OK" not in r.stdout


# AC-653 AC-654 AC-658: 起動スクリプトは検査が失敗すれば起動せず 0 以外で終わり、成功すれば「build: OK」のあとで --port を渡して起動する
def test_ac653_ac654_ac658_launchers(tmp_path):
    dst = _sandbox(tmp_path)
    ls = _launchers(dst)
    assert ls, "起動スクリプトを実行できる環境がない"
    for name, cmd in ls:  # 成功: build: OK → 起動、引数が届く
        port = _free_port()
        p = subprocess.Popen(cmd + ["--port", str(port)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             universal_newlines=True, encoding="utf-8", errors="replace")
        try:
            end = time.time() + 30
            while time.time() < end and not _listening(port):
                assert p.poll() is None, name + ": 起動前に終了した"
                time.sleep(0.2)
            assert _listening(port), name + ": 指定した --port で待ち受けない"
        finally:
            _kill(p)
            out = p.stdout.read()
        assert len([ln for ln in out.splitlines() if ln.strip() == "build: OK"]) == 1, (name, out)
        assert out.index("build: OK") < out.index("127.0.0.1:%d" % port), name
    with open(dst / "server" / "relay_config.py", "a", encoding="utf-8") as f:
        f.write("\nx = (\n")
    for name, cmd in ls:  # 失敗: 起動しない・0 以外（毎回再検査）
        port = _free_port()
        code, out = _run_launcher_until_exit(cmd, port)
        assert code != 0, name
        assert not _listening(port), name
        assert "relay_config.py" in out, (name, out)
        assert "build: OK" not in out, name


# AC-655: node があれば web/src/*.js も検査し、なければ省略を表示して続行する
@pytest.mark.skipif(not NODE, reason="node がない環境")
def test_ac655_js_check_and_node_absent(tmp_path):
    dst = _sandbox(tmp_path)
    assert _build(dst).returncode == 0
    js = sorted(f for f in os.listdir(dst / "web" / "src") if f.endswith(".js"))
    with open(dst / "web" / "src" / js[-1], "a", encoding="utf-8") as f:
        f.write("\nconst = ;\n")
    bad = _build(dst)
    assert bad.returncode == 1 and js[-1] in bad.stderr and "build: OK" not in bad.stdout
    pydir = os.path.dirname(sys.executable)
    env = dict(os.environ, PATH=pydir, Path=pydir)
    skipped = _build(dst, env=env)
    assert skipped.returncode == 0 and "build: OK" in skipped.stdout and "node" in skipped.stdout
    with open(dst / "server" / "relay_config.py", "a", encoding="utf-8") as f:
        f.write("\ndef broken(:\n")
    assert _build(dst, env=env).returncode == 1


# AC-657: 生成物を残さず（git status に差分なし）、標準ライブラリだけ、cwd 不問
def test_ac657_no_artifacts_and_stdlib_only(tmp_path):
    dst = _sandbox(tmp_path)

    def listing(d):
        return sorted(os.path.relpath(os.path.join(b, f), d) for b, _, fs in os.walk(d) for f in fs)
    before = listing(dst)
    assert _build(dst, cwd=tmp_path).returncode == 0
    assert listing(dst) == before
    st = lambda: subprocess.run(["git", "status", "--porcelain", "--untracked-files=all"], cwd=ROOT,
                                stdout=subprocess.PIPE, universal_newlines=True).stdout
    s0 = st()
    r = subprocess.run([sys.executable, os.path.join(ROOT, "server", "build.py")], cwd=ROOT,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
    assert r.returncode == 0 and st() == s0
    src = open(os.path.join(ROOT, "server", "build.py"), encoding="utf-8").read()
    assert not re.search(r"^\s*(import|from)\s+(socket|urllib|http|ssl|requests|asyncio)\b", src, re.M)
    mods = re.findall(r"^\s*(?:import|from)\s+([A-Za-z_]\w*)", src, re.M)
    if hasattr(sys, "stdlib_module_names"):
        assert [m for m in mods if m not in sys.stdlib_module_names] == []


# AC-656: /sw.js の VERSION は要求のたびに資産の内容ハッシュが付き、内容で変わり、no-store
def test_ac656_sw_version_hash(tmp_path):
    dst = _sandbox(tmp_path)
    port = _free_port()
    p = subprocess.Popen([sys.executable, str(dst / "server" / "relay.py"), "--web", str(dst / "web"), "--port", str(port)],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        end = time.time() + 15
        while time.time() < end and not _listening(port):
            time.sleep(0.1)

        def get(method="GET", path="/sw.js", host=None):
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            c.request(method, path, headers={"Host": host or "127.0.0.1:%d" % port})
            r = c.getresponse()
            body = r.read().decode("utf-8")
            h = {k.lower(): v for k, v in r.getheaders()}
            c.close()
            return r.status, h, body

        orig = re.search(r"const VERSION = '([^']*)'", open(os.path.join(ROOT, "web", "sw.js"), encoding="utf-8").read()).group(1)
        st, h, body = get()
        v1 = re.search(r"const VERSION = '([^']*)'", body).group(1)
        assert st == 200 and "no-store" in h["cache-control"] and h["content-type"].startswith("text/javascript")
        assert re.fullmatch(re.escape(orig) + r"-[0-9a-f]{10}", v1)
        assert re.match(r"^grp-shell-v\d+", v1)
        assert re.search(r"const VERSION = '([^']*)'", get(path="/sw.js?x=1")[2]).group(1) == v1
        hst, hh, hb = get("HEAD")
        assert hst == 200 and hb == "" and int(hh["content-length"]) == len(body.encode("utf-8"))
        assert get(host="evil.example")[0] == 403  # Host 検証のあとで処理する
        main_js = dst / "web" / "src" / "main.js"
        data = main_js.read_bytes()
        main_js.write_bytes(data + b"\n// changed\n")
        v2 = re.search(r"const VERSION = '([^']*)'", get()[2]).group(1)
        assert v2 != v1 and v2.startswith(orig)
        main_js.write_bytes(data)
        assert re.search(r"const VERSION = '([^']*)'", get()[2]).group(1) == v1
        assert re.search(r"const VERSION = 'grp-shell-v\d+';", open(os.path.join(ROOT, "web", "sw.js"), encoding="utf-8").read())
    finally:
        _kill(p)
