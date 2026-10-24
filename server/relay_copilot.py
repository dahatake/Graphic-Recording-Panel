"""GitHub Copilot SDK を介したモデルの呼び出し（FR-087 / FR-066 / NFR-PRIV-003 / NFR-SEC-006）。

- GitHub Copilot SDK（pip の github-copilot-sdk。import 名 copilot）は任意の依存。読み込めなくても中継サーバーは起動し、
  状態の取得で「SDK 未導入（sdk_missing）」を、Copilot CLI を起動できなければ「cli_unavailable」を返す（AC-505）。
- SDK・Copilot CLI を起動するのは、プロバイダーが GitHub Copilot の LLM 向けの要求と状態の取得、接続キー画面の GitHub Copilot の
  分類を開いたときの状態の取得（GET /api/llm/copilot）とサインインの操作だけ（AC-507。Q-034）。それ以外の状態の取得（プロバイダーが
  Microsoft Foundry のときの GET /api/llm/status）は SDK の導入の有無だけを返し、サインインの有無は「未確認」（signedIn: null）にする。
  プロバイダーが Microsoft Foundry のときに分類を開いて起動した CLI は、確認の後に止める。
- このアプリでのサインアウト（AC-511。Q-033）は保管先の copilotSignedOut だけで表し、Copilot CLI の資格情報は消さずサインアウトも呼ばない。
- セッションでは組み込みのツール・MCP を 1 つも使わせず（available_tools=[]）、権限の要求はすべて拒否し、
  作業フォルダーは空の専用フォルダー、システムメッセージは画面から来た instructions で置き換える（AC-504。端末・作業フォルダーの情報を送らない）。
- 失敗は秘密を含まない分類（auth / rate_limit / connection / upstream_timeout / upstream_too_large / upstream_invalid）だけを返す。
- Copilot CLI は、利用状況の送信（クライアント側のテレメトリ）と自動更新を無効にして起動する（引数 CLI_ARGS・環境変数
  COPILOT_AUTO_UPDATE=false。AC-516。SRC-075）。止めるときはプロセスの木ごと止める（relay_proctree。AC-517）。
- LLM 向けの要求は、CLI の起動・SDK の初期化・認証の状態の確認を含めて PARAM-069（timeout_sec）で打ち切り、タイムアウトの
  エラーにする（AC-518）。打ち切った要求の後も、起動中の CLI・SDK の初期化は止めずに背景で続け（上限 START_LIMIT_SEC）、
  済んだクライアントを次の要求で使い回す（毎回起動し直してタイムアウトし続けることを防ぐ。監査 U-1）。
"""
import asyncio
import concurrent.futures
import hashlib
import importlib
import inspect
import os
import tempfile
import threading
import time

from relay_config import max_bytes, timeout_sec
from relay_upstream import UpstreamError
import relay_llmstore as _store
import relay_proctree as _pt

SDK_MODULE = "copilot"
STATUS_TTL_SEC = 10  # 状態の取得で CLI を何度も起動しないための短いキャッシュ
START_LIMIT_SEC = 120  # 背景で続ける CLI の起動・SDK の初期化の上限。超えたら木ごと止めて cli_unavailable にする
STATUS_START_WAIT_SEC = 30  # 状態の取得（要求の期限がない）で、CLI の起動を待つ上限
STOP_GRACE_SEC = 5  # SDK の停止（stop）を待つ上限。過ぎたら木ごと止める
# Copilot CLI の利用状況の送信と自動更新を無効にする引数（AC-516。SRC-075）。サインイン（login）の起動にも付ける
CLI_ARGS = ("--disable-client-telemetry", "--no-auto-update")
_DEFAULT_SYSTEM = "Reply with the requested content only."
# CLI の子プロセスへ渡さない環境変数（ほかの連携の秘密）
_CHILD_ENV_DROP = ("LLM_API_KEY", "AZURE_SPEECH_KEY", "SPEECH_KEY")
_GITHUB_TOKEN_ENV = ("COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN")

_lock = threading.RLock()
_state = {"loop": None, "thread": None, "client": None, "key": None, "pids": [], "pending": None, "workdir": None}
_status_cache = {"key": None, "at": 0.0, "value": None}


# ---------------------------------------------------------------- SDK の読み込み


def load_sdk():
    """SDK のモジュール。読み込めないときは None（例外の内容は扱わない）。"""
    try:
        return importlib.import_module(SDK_MODULE)
    except Exception:  # noqa: BLE001 — ImportError 以外（依存の不整合など）も「未導入」と同じに扱う
        return None


def _sdk_session_module():
    try:
        return importlib.import_module(SDK_MODULE + ".session")
    except Exception:  # noqa: BLE001
        return None


def _reject_result():
    """権限の要求への応答: 拒否（AC-504）。SDK の型があればそれを、なければ同じ意味の dict を返す。"""
    mod = _sdk_session_module()
    cls = getattr(mod, "PermissionDecisionReject", None) if mod else None
    if cls is not None:
        try:
            return cls(feedback="Tools are disabled in this application.")
        except TypeError:
            try:
                return cls()
            except TypeError:
                pass
    return {"kind": "reject", "feedback": "Tools are disabled in this application."}


def deny_permission(request=None, invocation=None):
    """SDK・Copilot CLI からの権限の要求（ツールの実行の許可など）をすべて拒否する（AC-504）。"""
    return _reject_result()


# ---------------------------------------------------------------- イベントループと CLI のクライアント


def _loop():
    with _lock:
        if _state["loop"] is None:
            loop = asyncio.new_event_loop()
            t = threading.Thread(target=loop.run_forever, name="copilot-sdk", daemon=True)
            t.start()
            _state["loop"], _state["thread"] = loop, t
        return _state["loop"]


def _run(coro, timeout):
    fut = asyncio.run_coroutine_threadsafe(coro, _loop())
    try:
        return fut.result(timeout)
    except concurrent.futures.TimeoutError:
        fut.cancel()
        raise UpstreamError(504, "upstream_timeout", "GitHub Copilot の応答が時間内に完了しませんでした。")


def _workdir():
    """会話の内容以外を送らないための、空の専用の作業フォルダー（AC-504）。"""
    with _lock:
        if not _state["workdir"] or not os.path.isdir(_state["workdir"]):
            _state["workdir"] = tempfile.mkdtemp(prefix="grp-copilot-")
        return _state["workdir"]


def _child_env(cs=None):
    """CLI の子プロセスの環境変数。ほかの連携の秘密は渡さない。認証方式がサインインのときは GitHub のトークンの
    環境変数も渡さず、Copilot CLI の保管のサインイン済みの資格情報を使わせる（FR-088 AC-510 の ASSUMPTION）。"""
    drop = set(_CHILD_ENV_DROP)
    if cs is None or cs.auth_method != "token":
        drop.update(_GITHUB_TOKEN_ENV)
    env = {k: v for k, v in os.environ.items() if k not in drop}
    env["COPILOT_GITHUB_TELEMETRY_DISABLED"] = "true"
    env["COPILOT_AUTO_UPDATE"] = "false"  # CLI と第一者のプラグインの自動更新を無効にする（AC-516。SRC-075）
    return env


def _client_key(cs):
    tok = hashlib.sha256(cs.token.encode("utf-8")).hexdigest() if (cs.auth_method == "token" and cs.token) else ""
    return (cs.auth_method, tok)


def _accepts(fn, name):
    """呼び出し可能なものが引数 name（または **kwargs）を受け付けるか。"""
    try:
        params = inspect.signature(fn).parameters.values()
    except (TypeError, ValueError):
        return False
    return any(p.name == name or p.kind == p.VAR_KEYWORD for p in params)


def _connection(sdk, env):
    """CLI を子プロセスで起動する SDK の接続（RuntimeConnection.for_stdio）に、CLI_ARGS と環境変数を付ける（AC-516）。
    SDK がその形を持たなければ None。"""
    conn_cls = getattr(sdk, "RuntimeConnection", None)
    factory = getattr(conn_cls, "for_stdio", None) if conn_cls is not None else None
    if factory is None:
        return None
    try:
        conn = factory(args=list(CLI_ARGS))
        conn.env = env
    except Exception:  # noqa: BLE001 — 使えない版は従来の引数の形にする
        return None
    return conn


def _client_options(cs, sdk=None):
    env = _child_env(cs)
    opts = {"working_directory": _workdir()}
    conn = _connection(sdk, env) if sdk is not None else None
    if conn is not None:
        opts["connection"] = conn  # 接続の env と、クライアントの env の両方は渡せない（SDK の仕様）
    else:
        opts["env"] = env
        if sdk is not None and _accepts(getattr(sdk, "CopilotClient", None), "cli_args"):
            opts["cli_args"] = list(CLI_ARGS)
    if cs.auth_method == "token":
        opts["use_logged_in_user"] = False
        if cs.token:
            opts["github_token"] = cs.token
    else:
        opts["use_logged_in_user"] = True
    return opts


async def _astop(client):
    try:
        await asyncio.wait_for(client.stop(), STOP_GRACE_SEC)
    except BaseException:  # noqa: BLE001 — 停止の失敗・時間切れは木ごと止めて片づける
        pass


def _tree(pids):
    """止める前に、CLI のプロセスとその子・孫のプロセス ID を集める（親が先に終わっても子を見失わない）。"""
    found = []
    for pid in pids or []:
        for p in [pid] + _pt.descendants(pid):
            if p not in found:
                found.append(p)
    return found


def _stop_one(client, pids):
    """SDK のクライアントを止め、CLI に由来するプロセスを木ごと終了させる（AC-517）。"""
    tree = _tree(pids)
    if client is not None:
        try:
            _run(_astop(client), STOP_GRACE_SEC + 2)
        except UpstreamError:
            pass
    for p in tree:
        if _pt.alive(p):
            _pt.kill_tree(p)


def _stop_client():
    """使っているクライアントを止める。起動中のものは、起動が済んだ時点で止めるように印を付ける。"""
    with _lock:
        client, pids = _state["client"], _state["pids"]
        _state.update({"client": None, "key": None, "pids": []})
        pend, _state["pending"] = _state["pending"], None
        if pend is not None:
            pend["abandon"] = True
    if client is not None or pids:
        _stop_one(client, pids)


def _on_started(pend, fut):
    """背景の起動が済んだとき: 待っている設定のままならクライアントを使い回せるように残し、そうでなければ止める。"""
    if fut.cancelled() or fut.exception() is not None:
        with _lock:
            if _state["pending"] is pend:
                _state["pending"] = None
        return
    client = fut.result()
    pids = _pt.find_child_pids(client)
    with _lock:
        if _state["client"] is client:
            return  # 待っていた要求がすでに使い始めた
        keep = not pend["abandon"] and _state["client"] is None
        if _state["pending"] is pend:
            _state["pending"] = None
        if keep:
            _state.update({"client": client, "key": pend["key"], "pids": pids})
            return
    # イベントループのスレッドから同期で止めると待ち合わせが詰まるので、別のスレッドで止める
    threading.Thread(target=_stop_one, args=(client, pids), name="copilot-stop", daemon=True).start()


def _begin_start(sdk, cs, key):
    """CLI の起動・SDK の初期化を背景で始める。要求の打ち切りでは止めず、START_LIMIT_SEC を超えたら木ごと止める。"""
    opts = _client_options(cs, sdk)

    async def start():
        client = sdk.CopilotClient(**opts)
        try:
            await asyncio.wait_for(client.start(), START_LIMIT_SEC)
        except BaseException:
            pids = _pt.find_child_pids(client)
            tree = _tree(pids)
            await _astop(client)
            await asyncio.get_running_loop().run_in_executor(None, lambda: [_pt.kill_tree(p) for p in tree if _pt.alive(p)])
            raise
        return client

    pend = {"key": key, "abandon": False}
    pend["future"] = fut = asyncio.run_coroutine_threadsafe(start(), _loop())
    with _lock:
        _state["pending"] = pend
    fut.add_done_callback(lambda f: _on_started(pend, f))
    return pend


def _timeout_error():
    return UpstreamError(504, "upstream_timeout", "GitHub Copilot の応答が時間内に完了しませんでした。")


def _remaining(deadline):
    return deadline - time.monotonic()


def _get_client(sdk, cs, deadline=None):
    """設定（認証方式・トークン）ごとに 1 つのクライアントを使い回す。起動できなければ cli_unavailable。
    deadline（time.monotonic の時刻）までに起動が済まなければ upstream_timeout にするが、起動は背景で続ける（AC-518）。"""
    key = _client_key(cs)
    with _lock:
        if _state["client"] is not None and _state["key"] == key:
            return _state["client"]
        pend = _state["pending"]
        if pend is None or pend["key"] != key or pend["abandon"]:
            pend = None
    if pend is None:
        _stop_client()
        pend = _begin_start(sdk, cs, key)
    fut = pend["future"]
    wait = STATUS_START_WAIT_SEC if deadline is None else _remaining(deadline)
    try:
        client = fut.result(max(wait, 0))  # 打ち切っても fut は取り消さない（次の要求で使い回す）
    except concurrent.futures.TimeoutError:
        raise _timeout_error()
    except Exception:  # noqa: BLE001 — 例外の文面にパス・資格情報が入りうるので分類だけ返す
        raise UpstreamError(503, "cli_unavailable", "GitHub Copilot CLI を起動できません。")
    with _lock:
        if _state["client"] is None and not pend["abandon"]:
            _state.update({"client": client, "key": key, "pids": _pt.find_child_pids(client)})
        if _state["pending"] is pend:
            _state["pending"] = None
    return client


def shutdown():
    """中継サーバーの終了時に CLI を止める。"""
    _stop_client()


def reset():
    """CLI を止め、状態のキャッシュを捨てる（設定の変更の後・テスト）。"""
    _stop_client()
    with _lock:
        _status_cache.update({"key": None, "at": 0.0, "value": None})


# ---------------------------------------------------------------- 状態（AC-505・AC-507）


def _field(obj, *names):
    for n in names:
        if isinstance(obj, dict) and n in obj:
            return obj[n]
        if hasattr(obj, n):
            return getattr(obj, n)
    return None


def signed_out():
    """このアプリでサインアウトした状態か（AC-511。再起動後も保つ）。"""
    return bool(_store.load().get("copilotSignedOut"))


def set_signed_out(value):
    """このアプリでのサインアウトの状態を保存・解除する。Copilot CLI の資格情報には触れない（Q-033）。"""
    if value:
        _store.save({"copilotSignedOut": "1"})
    else:
        _store.delete(["copilotSignedOut"])
    with _lock:
        _status_cache.update({"key": None, "at": 0.0, "value": None})


def probe(cs, check=True, ignore_signout=False, deadline=None):
    """{available, unavailableReason, signedIn, account}。会議の内容は送らない（AC-507 の例外の範囲）。
    check が偽のときは Copilot CLI を起動せず、SDK の導入の有無だけを返す（signedIn は None = 未確認。Q-034）。
    このアプリでサインアウトしているとき（認証方式がサインイン）は、CLI のサインインが残っていても未サインインにする
    （ignore_signout のときを除く。AC-511）。"""
    sdk = load_sdk()
    if sdk is None:
        return {"available": False, "unavailableReason": "sdk_missing", "signedIn": False, "account": None}
    if not check:
        return {"available": True, "unavailableReason": None, "signedIn": None, "account": None}
    value = _probe_cli(sdk, cs, deadline)
    if not ignore_signout and cs.auth_method != "token" and value["signedIn"] and signed_out():
        value.update({"signedIn": False, "account": None})
    return value


def _probe_cli(sdk, cs, deadline=None):
    """CLI に認証の状態を確かめる。deadline（LLM 向けの要求の期限）があれば、起動・確認がそれまでに済まないとき
    upstream_timeout を送出する（AC-518）。期限がない状態の取得では、時間内に起動しなければ cli_unavailable を返す。"""
    key = (_client_key(cs), cs.provider)
    with _lock:
        if _status_cache["key"] == key and time.time() - _status_cache["at"] < STATUS_TTL_SEC:
            return dict(_status_cache["value"])
    cache = True
    try:
        client = _get_client(sdk, cs, deadline)
    except UpstreamError as e:
        if deadline is not None and e.code == "upstream_timeout":
            raise
        value = {"available": False, "unavailableReason": "cli_unavailable", "signedIn": False, "account": None}
        cache = e.code != "upstream_timeout"  # 起動中（背景で続けている）のときは覚えない
    else:
        value = {"available": True, "unavailableReason": None, "signedIn": False, "account": None}
        limit = max(timeout_sec(), 20) if deadline is None else _remaining(deadline)
        try:
            if limit <= 0:
                raise _timeout_error()
            auth = _run(client.get_auth_status(), limit)
            signed = bool(_field(auth, "is_authenticated", "isAuthenticated"))
            login = _field(auth, "login") if signed else None
            value["signedIn"] = signed
            value["account"] = login if isinstance(login, str) and login.strip() else None
        except UpstreamError as e:
            if deadline is not None and e.code == "upstream_timeout":
                raise
            cache = False
        except Exception:  # noqa: BLE001
            pass
        if cs.provider != "copilot":
            _stop_client()  # Foundry を使っている間は CLI を動かし続けない（AC-507）
    if not cache:
        if cs.provider != "copilot":
            _stop_client()
        return value
    with _lock:
        _status_cache.update({"key": key, "at": time.time(), "value": dict(value)})
    return value


def readiness(cs, probed):
    """LLM 連携を有効にできない原因（'sdk' / 'cli' / 'signin' / 'token'。AC-506 の画面の原因の分類）。
    SDK は導入済みで Copilot CLI を起動できないときは 'cli'（SDK 未導入の 'sdk' と区別する）。"""
    if not probed["available"]:
        return ["cli"] if probed.get("unavailableReason") == "cli_unavailable" else ["sdk"]
    if cs.auth_method == "token":
        return [] if cs.token else ["token"]
    return [] if probed["signedIn"] else ["signin"]


# ---------------------------------------------------------------- 呼び出し（AC-503・AC-504）


def classify(exc):
    """SDK・CLI の例外を秘密を含まない分類にする（文面は返さない）。"""
    if isinstance(exc, UpstreamError):
        return exc
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError, concurrent.futures.TimeoutError)):
        return UpstreamError(504, "upstream_timeout", "GitHub Copilot の応答が時間内に完了しませんでした。")
    text = ("%s %s %s" % (type(exc).__name__, getattr(exc, "code", ""), exc)).lower()
    if any(w in text for w in ("429", "rate limit", "rate_limit", "ratelimit", "quota", "too many")):
        return UpstreamError(429, "rate_limit", "GitHub Copilot の利用の上限に達しました。")
    if any(w in text for w in ("401", "403", "unauthor", "forbidden", "auth", "login", "credential",
                               "token", "entitle", "subscription", "not signed")):
        return UpstreamError(401, "auth", "GitHub Copilot の認証に失敗しました。")
    return UpstreamError(502, "connection", "GitHub Copilot へ接続できません。")


def session_options(cs, instructions):
    """セッションの作成時の設定（AC-504: ツールなし・権限は拒否・空の作業フォルダー・システムメッセージの置き換え）。"""
    opts = {
        "on_permission_request": deny_permission,
        "available_tools": [],
        "system_message": {"mode": "replace", "content": instructions or _DEFAULT_SYSTEM},
        "working_directory": _workdir(),
    }
    if cs.model:
        opts["model"] = cs.model
    return opts


def _content_of(event):
    data = _field(event, "data")
    content = _field(data, "content") if data is not None else None
    return content if isinstance(content, str) else None


def generate(cs, instructions, prompt, deadline=None):
    """instructions（システム）と prompt（送信内容）だけを Copilot のモデルへ送り、応答の文字を返す。
    deadline（time.monotonic の時刻。既定は今から PARAM-069 秒）までに、CLI の起動・SDK の初期化を含めて済まなければ
    upstream_timeout（AC-518）。"""
    sdk = load_sdk()
    if sdk is None:
        raise UpstreamError(503, "sdk_missing", "GitHub Copilot SDK が導入されていません。")
    if cs.auth_method == "token" and not cs.token:
        raise UpstreamError(503, "token_missing", "GitHub Copilot のトークンが設定されていません。")
    if deadline is None:
        deadline = time.monotonic() + timeout_sec()
    client = _get_client(sdk, cs, deadline)
    total = _remaining(deadline)
    if total <= 0:
        raise _timeout_error()

    async def go():
        session = await client.create_session(**session_options(cs, instructions))
        try:
            return await session.send_and_wait(prompt, timeout=total)
        finally:
            try:
                await session.disconnect()
            except Exception:  # noqa: BLE001
                pass

    try:
        event = _run(asyncio.wait_for(go(), total), total + 0.5)
    except Exception as e:  # noqa: BLE001
        err = classify(e)
        if err.code == "connection":
            _stop_client()  # 壊れた CLI を使い回さない
        raise err
    text = _content_of(event)
    if text is None:
        raise UpstreamError(502, "upstream_invalid", "GitHub Copilot の応答を解釈できません。")
    if len(text.encode("utf-8")) > max_bytes():
        raise UpstreamError(502, "upstream_too_large", "GitHub Copilot の応答が大きすぎます。")
    return text


def as_responses(text):
    """Foundry（Responses API）と同じ形にして、以降の検査・サニタイズを共通にする。"""
    return {"output": [{"type": "message", "role": "assistant",
                        "content": [{"type": "output_text", "text": text}]}]}


def secrets_of(cs):
    return [cs.token] if cs is not None and cs.token else []
