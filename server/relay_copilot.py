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
"""
import asyncio
import concurrent.futures
import hashlib
import importlib
import os
import tempfile
import threading
import time

from relay_config import max_bytes, timeout_sec
from relay_upstream import UpstreamError
import relay_llmstore as _store

SDK_MODULE = "copilot"
STATUS_TTL_SEC = 10  # 状態の取得で CLI を何度も起動しないための短いキャッシュ
_DEFAULT_SYSTEM = "Reply with the requested content only."
# CLI の子プロセスへ渡さない環境変数（ほかの連携の秘密）
_CHILD_ENV_DROP = ("LLM_API_KEY", "AZURE_SPEECH_KEY", "SPEECH_KEY")
_GITHUB_TOKEN_ENV = ("COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN")

_lock = threading.RLock()
_state = {"loop": None, "thread": None, "client": None, "key": None, "workdir": None}
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
    return env


def _client_key(cs):
    tok = hashlib.sha256(cs.token.encode("utf-8")).hexdigest() if (cs.auth_method == "token" and cs.token) else ""
    return (cs.auth_method, tok)


def _client_options(cs):
    opts = {"working_directory": _workdir(), "env": _child_env(cs)}
    if cs.auth_method == "token":
        opts["use_logged_in_user"] = False
        if cs.token:
            opts["github_token"] = cs.token
    else:
        opts["use_logged_in_user"] = True
    return opts


async def _astop(client):
    try:
        await client.stop()
    except Exception:  # noqa: BLE001
        pass


def _stop_client():
    with _lock:
        client, _state["client"], _state["key"] = _state["client"], None, None
    if client is not None:
        try:
            _run(_astop(client), 15)
        except UpstreamError:
            pass


def _get_client(sdk, cs):
    """設定（認証方式・トークン）ごとに 1 つのクライアントを使い回す。起動できなければ cli_unavailable。"""
    key = _client_key(cs)
    with _lock:
        if _state["client"] is not None and _state["key"] == key:
            return _state["client"]
    _stop_client()

    async def start():
        client = sdk.CopilotClient(**_client_options(cs))
        await client.start()
        return client

    try:
        client = _run(start(), max(timeout_sec(), 30))
    except Exception:  # noqa: BLE001 — 例外の文面にパス・資格情報が入りうるので分類だけ返す
        raise UpstreamError(503, "cli_unavailable", "GitHub Copilot CLI を起動できません。")
    with _lock:
        _state["client"], _state["key"] = client, key
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


def probe(cs, check=True, ignore_signout=False):
    """{available, unavailableReason, signedIn, account}。会議の内容は送らない（AC-507 の例外の範囲）。
    check が偽のときは Copilot CLI を起動せず、SDK の導入の有無だけを返す（signedIn は None = 未確認。Q-034）。
    このアプリでサインアウトしているとき（認証方式がサインイン）は、CLI のサインインが残っていても未サインインにする
    （ignore_signout のときを除く。AC-511）。"""
    sdk = load_sdk()
    if sdk is None:
        return {"available": False, "unavailableReason": "sdk_missing", "signedIn": False, "account": None}
    if not check:
        return {"available": True, "unavailableReason": None, "signedIn": None, "account": None}
    value = _probe_cli(sdk, cs)
    if not ignore_signout and cs.auth_method != "token" and value["signedIn"] and signed_out():
        value.update({"signedIn": False, "account": None})
    return value


def _probe_cli(sdk, cs):
    key = (_client_key(cs), cs.provider)
    with _lock:
        if _status_cache["key"] == key and time.time() - _status_cache["at"] < STATUS_TTL_SEC:
            return dict(_status_cache["value"])
    try:
        client = _get_client(sdk, cs)
    except UpstreamError:
        value = {"available": False, "unavailableReason": "cli_unavailable", "signedIn": False, "account": None}
    else:
        value = {"available": True, "unavailableReason": None, "signedIn": False, "account": None}
        try:
            auth = _run(client.get_auth_status(), max(timeout_sec(), 20))
            signed = bool(_field(auth, "is_authenticated", "isAuthenticated"))
            login = _field(auth, "login") if signed else None
            value["signedIn"] = signed
            value["account"] = login if isinstance(login, str) and login.strip() else None
        except Exception:  # noqa: BLE001
            pass
        if cs.provider != "copilot":
            _stop_client()  # Foundry を使っている間は CLI を動かし続けない（AC-507）
    with _lock:
        _status_cache.update({"key": key, "at": time.time(), "value": dict(value)})
    return value


def readiness(cs, probed):
    """LLM 連携を有効にできない原因（'sdk' / 'signin' / 'token'。AC-506 の画面の原因の分類）。"""
    if not probed["available"]:
        return ["sdk"]
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


def generate(cs, instructions, prompt):
    """instructions（システム）と prompt（送信内容）だけを Copilot のモデルへ送り、応答の文字を返す。"""
    sdk = load_sdk()
    if sdk is None:
        raise UpstreamError(503, "sdk_missing", "GitHub Copilot SDK が導入されていません。")
    if cs.auth_method == "token" and not cs.token:
        raise UpstreamError(503, "token_missing", "GitHub Copilot のトークンが設定されていません。")
    client = _get_client(sdk, cs)
    total = timeout_sec()

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
        event = _run(asyncio.wait_for(go(), total), total + 2)
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
