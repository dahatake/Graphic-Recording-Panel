"""GitHub のサインイン（Copilot CLI の OAuth デバイスフロー）を中継サーバーから始める（FR-088 AC-509 / NFR-SEC-006 AC-515）。

- `copilot login --device-code` を子プロセスで起動し、その出力から確認のページの URL と確認コードだけを取り出して画面へ返す。
  利用者が GitHub のページで承認すると CLI が終わり（終了コード 0）、資格情報は Copilot CLI が OS の資格情報の保管庫に保存する。
  このアプリ（中継サーバーの保管先・応答・ログ）は、サインインで得た資格情報を受け取らず、保存・返却しない。
- 状態は none / pending / completed / expired / denied / cancelled / failed の分類だけを返す。CLI の出力の文面は返さない
  （パス・資格情報が混ざりうるため）。確認コードの有効期限（DEVICE_CODE_TTL_SEC）を過ぎたら子プロセスを止めて expired にする。
- 子プロセスには GitHub のトークンの環境変数・ほかの連携の秘密を渡さない（環境変数のトークンがあると OAuth を行わないため）。
  コマンドラインの引数に秘密は置かない。
- テストは login_argv を差し替えた Copilot CLI のスタブで行い、GitHub へは通信しない。
"""
import os
import re
import shutil
import subprocess
import threading
import time

import relay_copilot as _cp

DEVICE_CODE_TTL_SEC = 900  # GitHub のデバイスコードの有効期限（15 分）
START_WAIT_SEC = 20  # 確認コードが出力されるまで待つ上限
MAX_OUTPUT = 64 * 1024
STATES = ("none", "pending", "completed", "expired", "denied", "cancelled", "failed")
_URI_RE = re.compile(r"https://([A-Za-z0-9.-]+)/login/device(?![A-Za-z0-9])")
_CODE_RE = re.compile(r"(?<![A-Za-z0-9-])([A-Z0-9]{4}-[A-Z0-9]{4})(?![A-Za-z0-9-])")
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")
_HOST_OK = re.compile(r"^(github\.com|[A-Za-z0-9-]+\.ghe\.com)$")

_lock = threading.RLock()
_start_lock = threading.Lock()  # 同時のサインインの開始を 1 つずつにする（旧プロセスを残さない）
_flow = {"proc": None, "reader": None, "state": "none", "uri": None, "code": None, "started": 0.0, "out": "", "cancelled": False}


def cli_path():
    """Copilot CLI の実行ファイル（COPILOT_CLI_PATH ＞ PATH の copilot）。見つからなければ None。"""
    p = os.environ.get("COPILOT_CLI_PATH")
    if p and os.path.isfile(p):
        return p
    return shutil.which("copilot")


def login_argv():
    """サインインのコマンド。引数に秘密を含めない。"""
    cli = cli_path()
    return [cli, "login", "--device-code"] if cli else None


def _env():
    return _cp._child_env(None)  # サインインの方式の子プロセスの環境（GitHub のトークンの環境変数を除く）


def _reader(proc):
    out = proc.stdout
    while True:
        try:
            chunk = out.read1(4096) if hasattr(out, "read1") else out.read(1)
        except (OSError, ValueError):
            break
        if not chunk:
            break
        text = chunk.decode("utf-8", "replace")
        with _lock:
            if _flow["proc"] is not proc:
                continue
            buf = (_flow["out"] + text)[-MAX_OUTPUT:]
            _flow["out"] = buf
            clean = _ANSI_RE.sub("", buf)
            if _flow["uri"] is None:
                m = _URI_RE.search(clean)
                if m and _HOST_OK.match(m.group(1)):
                    _flow["uri"] = "https://%s/login/device" % m.group(1)
            if _flow["code"] is None:
                m = _CODE_RE.search(clean)
                if m:
                    _flow["code"] = m.group(1)


def _kill(proc):
    if proc is None:
        return
    try:
        if proc.poll() is None:
            proc.kill()
            proc.wait(5)
    except (OSError, subprocess.TimeoutExpired):
        pass


def _outcome(rc, out):
    """CLI の終了から状態の分類を決める（出力の文面は返さない）。"""
    if rc == 0:
        return "completed"
    low = _ANSI_RE.sub("", out).lower()
    if "expired" in low or "expire" in low:
        return "expired"
    if "denied" in low or "access_denied" in low or "declined" in low:
        return "denied"
    return "failed"


def _refresh():
    """状態（GET /api/llm/status）のキャッシュを捨て、サインイン済みかを CLI に確かめ直させる。"""
    try:
        _cp.reset()
    except Exception:  # noqa: BLE001
        pass


def start():
    """サインインを始める。{ok, state, verificationUri, userCode} か {ok: False, result}。同時の開始は 1 つずつ行う。"""
    with _start_lock:
        return _start()


def _start():
    if _cp.load_sdk() is None:
        return {"ok": False, "result": "sdk_missing"}
    argv = login_argv()
    if not argv:
        return {"ok": False, "result": "cli_unavailable"}
    cancel(internal=True)
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                env=_env(), cwd=_cp._workdir(), creationflags=flags)
    except (OSError, ValueError):
        return {"ok": False, "result": "cli_unavailable"}
    reader = threading.Thread(target=_reader, args=(proc,), name="copilot-signin", daemon=True)
    with _lock:
        old = _flow["proc"]
        _flow.update({"proc": proc, "reader": reader, "state": "pending", "uri": None, "code": None, "started": time.time(), "out": "", "cancelled": False})
    if old is not None and old is not proc:
        _kill(old)  # 念のため: 先に動いていたサインインの子プロセスを残さない
    reader.start()
    deadline = time.time() + START_WAIT_SEC
    while time.time() < deadline:
        with _lock:
            ready = _flow["uri"] and _flow["code"]
        if ready or proc.poll() is not None:
            break
        time.sleep(0.05)
    with _lock:
        if _flow["uri"] and _flow["code"]:
            return {"ok": True, "state": "pending", "verificationUri": _flow["uri"], "userCode": _flow["code"]}
    _kill(proc)
    time.sleep(0.05)
    with _lock:
        rc = proc.poll()
        state = "completed" if rc == 0 else "failed"
        _flow.update({"proc": None, "state": state, "out": ""})
    if state == "completed":  # すでにサインイン済みで、確認コードなしに終わった
        _refresh()
        return {"ok": True, "state": "completed"}
    return {"ok": False, "result": "failed", "state": "failed"}


def status():
    """{state}。期限切れ・CLI の終了を反映する。資格情報・出力の文面は含めない。"""
    done = False
    with _lock:
        proc, reader = _flow["proc"], _flow["reader"]
    if proc is not None and proc.poll() is not None and reader is not None:
        reader.join(5)  # 終了した CLI の最後の出力（期限切れ・拒否など）を読み終えてから分類する
    with _lock:
        if proc is not None and _flow["proc"] is proc and _flow["state"] == "pending":
            rc = proc.poll()
            if rc is None and time.time() - _flow["started"] > DEVICE_CODE_TTL_SEC:
                _kill(proc)
                _flow.update({"proc": None, "state": "expired", "out": ""})
            elif rc is not None:
                state = "cancelled" if _flow["cancelled"] else _outcome(rc, _flow["out"])
                _flow.update({"proc": None, "state": state, "out": ""})
                done = state == "completed"
        state = _flow["state"]
    if done:
        _refresh()
    return {"state": state if state in STATES else "failed"}


def cancel(internal=False):
    """進行中のサインインを止める。{ok, state}。"""
    with _lock:
        proc = _flow["proc"]
        if proc is not None:
            _flow["cancelled"] = True
    _kill(proc)
    with _lock:
        if proc is not None or not internal:
            if _flow["state"] == "pending" or proc is not None:
                _flow.update({"proc": None, "state": "cancelled", "out": ""})
        state = _flow["state"]
    return {"ok": True, "state": state}


def reset():
    """テスト・終了時: 子プロセスを止め、状態を消す。"""
    with _lock:
        proc = _flow["proc"]
        _flow.update({"proc": None, "state": "none", "uri": None, "code": None, "started": 0.0, "out": "", "cancelled": False})
    _kill(proc)
