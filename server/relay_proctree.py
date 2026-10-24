"""子プロセスをプロセスの木ごと止める（FR-087 / FR-088 AC-517）。標準ライブラリだけを使う（psutil に依存しない）。

Copilot CLI は別のプロセスを介して起動されることがある（Windows で npm から導入した copilot.cmd が cmd.exe を介して
子の node を起動するなど）。親だけを止めると子・孫が残るため、止めるときは木ごと終了させる。
- Windows: `taskkill /PID <pid> /T /F`（子・孫まで）。起動側は CREATE_NEW_PROCESS_GROUP で別のグループにする。
- それ以外: 起動側は start_new_session でプロセスグループを分け、`killpg` で止める。グループの外へ出た子孫は
  `ps` の親子関係からたどって止める。
"""
import asyncio
import os
import signal
import subprocess
import time
import types

_WIN = os.name == "nt"


def popen_kwargs():
    """木ごと止められるように子プロセスを起動するための Popen の引数（画面は出さない）。"""
    if _WIN:
        flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0)
        return {"creationflags": flags}
    return {"start_new_session": True}


def alive(pid):
    """プロセス ID が動いているか（終了済み・存在しなければ偽）。"""
    if not isinstance(pid, int) or pid <= 0:
        return False
    if _WIN:
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.OpenProcess.restype = wintypes.HANDLE
        k32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        k32.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
        k32.CloseHandle.argtypes = (wintypes.HANDLE,)
        h = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        try:
            code = wintypes.DWORD()
            if not k32.GetExitCodeProcess(h, ctypes.byref(code)):
                return False
            return code.value == 259  # STILL_ACTIVE
        finally:
            k32.CloseHandle(h)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    try:  # 終了済みで回収されていない子（ゾンビ）は止まったものとみなす
        out = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True, timeout=5).stdout
        return bool(out.strip()) and not out.strip().startswith("Z")
    except (OSError, subprocess.SubprocessError):
        return True


def _win_parent_map():
    """Windows: {pid: ppid}（ToolHelp のスナップショット）。"""
    import ctypes
    from ctypes import wintypes

    class PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
                    ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD),
                    ("cntThreads", wintypes.DWORD), ("th32ParentProcessID", wintypes.DWORD),
                    ("pcPriClassBase", ctypes.c_long), ("dwFlags", wintypes.DWORD), ("szExeFile", ctypes.c_wchar * 260)]

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    k32.CreateToolhelp32Snapshot.argtypes = (wintypes.DWORD, wintypes.DWORD)
    k32.Process32FirstW.argtypes = (wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W))
    k32.Process32NextW.argtypes = (wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W))
    k32.CloseHandle.argtypes = (wintypes.HANDLE,)
    snap = k32.CreateToolhelp32Snapshot(0x2, 0)  # TH32CS_SNAPPROCESS
    if not snap or snap == wintypes.HANDLE(-1).value:
        return {}
    out = {}
    try:
        e = PROCESSENTRY32W()
        e.dwSize = ctypes.sizeof(PROCESSENTRY32W)
        ok = k32.Process32FirstW(snap, ctypes.byref(e))
        while ok:
            out[int(e.th32ProcessID)] = int(e.th32ParentProcessID)
            ok = k32.Process32NextW(snap, ctypes.byref(e))
    finally:
        k32.CloseHandle(snap)
    return out


def _parent_map():
    if _WIN:
        try:
            return _win_parent_map()
        except (OSError, AttributeError, ValueError):
            return {}
    try:
        out = subprocess.run(["ps", "-A", "-o", "pid=,ppid="], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return {}
    pm = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
            pm[int(parts[0])] = int(parts[1])
    return pm


def descendants(pid):
    """pid の子・孫のプロセス ID（動いているもの）。止める前に集めておき、親が先に終わっても子を見失わないようにする。"""
    if not isinstance(pid, int) or pid <= 0:
        return []
    children = {}
    for c, parent in _parent_map().items():
        if c != parent:
            children.setdefault(parent, []).append(c)
    found, todo = [], [pid]
    while todo:
        for c in children.get(todo.pop(), []):
            if c not in found and c != pid:
                found.append(c)
                todo.append(c)
    return found


def kill_tree(pid, wait=5.0):
    """pid とその子・孫のプロセスを終了させる。終了を待つ（最大 wait 秒）。例外は出さない。"""
    if not isinstance(pid, int) or pid <= 0:
        return
    targets = [pid] + descendants(pid)
    if _WIN:
        for p in targets:  # 親が先に終わっていても子を止められるよう、集めた ID ごとに /T で止める
            if not alive(p):
                continue
            try:
                subprocess.run(["taskkill", "/PID", str(p), "/T", "/F"], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=max(wait, 5), creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except (OSError, subprocess.SubprocessError):
                pass
    else:
        try:
            pgid = os.getpgid(pid)
            if pgid != os.getpgid(0):
                os.killpg(pgid, signal.SIGKILL)
        except (OSError, AttributeError):
            pass
        for p in targets:
            try:
                os.kill(p, signal.SIGKILL)
            except OSError:
                pass
    deadline = time.time() + wait
    while time.time() < deadline and any(alive(p) for p in targets):
        time.sleep(0.05)


def stop_popen(proc, wait=5.0):
    """subprocess.Popen を木ごと止めて回収する。"""
    if proc is None:
        return
    try:
        if proc.poll() is None:
            kill_tree(proc.pid, wait)
        if proc.poll() is None:
            proc.kill()
        proc.wait(wait)
    except (OSError, subprocess.SubprocessError, ValueError):
        pass


def find_child_pids(obj, depth=3, _seen=None):
    """SDK のクライアントが持つ子プロセス（pid と returncode を持つもの: subprocess.Popen・asyncio の Process）の pid。
    SDK の内部の属性名に依存しないよう、属性を浅くたどって探す。自分自身の pid は含めない。"""
    seen = _seen if _seen is not None else set()
    if obj is None or id(obj) in seen or depth < 0:
        return []
    seen.add(id(obj))
    pid = getattr(obj, "pid", None) if not isinstance(obj, (str, bytes, int, float, dict, list, tuple)) else None
    if isinstance(pid, int) and pid > 0 and pid != os.getpid() and hasattr(obj, "returncode"):
        return [pid]
    found = []
    try:
        values = list(vars(obj).values())
    except TypeError:
        values = []
    if isinstance(obj, dict):
        values = list(obj.values())
    elif isinstance(obj, (list, tuple)):
        values = list(obj)
    for v in values:
        if isinstance(v, (str, bytes, int, float, bool, type, types.ModuleType, types.FunctionType, types.MethodType)) or v is None:
            continue
        if isinstance(v, asyncio.AbstractEventLoop):
            continue
        for p in find_child_pids(v, depth - 1, seen):
            if p not in found:
                found.append(p)
    return found


__all__ = ["popen_kwargs", "alive", "kill_tree", "stop_popen", "find_child_pids"]
