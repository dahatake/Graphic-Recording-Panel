"""上流（Foundry）への中継と、認証の取得（FR-066 / NFR-SEC-003）。標準ライブラリだけ。

認証情報は上流への要求にだけ付ける。リダイレクトは追わない（認証ヘッダの転送を防ぐ）。
"""
import http.client
import json
import os
import shutil
import ssl
import subprocess
import sys
import time
from urllib.parse import urlsplit

from relay_config import resolves_to_public, max_bytes, timeout_sec

ENTRA_SCOPE = "https://ai.azure.com/.default"
_TOKEN_TTL_SEC = 50 * 60
_token_cache = {"token": None, "until": 0.0}


class UpstreamError(Exception):
    """秘密を含まないメッセージだけを持つ。status は利用者へ返す HTTP ステータス。"""

    def __init__(self, status, code, message):
        Exception.__init__(self, message)
        self.status = status
        self.code = code
        self.message = message


def _az_command():
    custom = os.environ.get("RELAY_AZ_COMMAND")
    if custom:
        return [sys.executable, custom]
    found = shutil.which("az")
    return [found] if found else None


def get_entra_token():
    """az account get-access-token でトークンを得る。失敗は UpstreamError（理由に秘密を含めない）。"""
    now = time.time()
    if _token_cache["token"] and _token_cache["until"] > now:
        return _token_cache["token"]
    cmd = _az_command()
    if not cmd:
        raise UpstreamError(503, "entra_unavailable", "az コマンドが見つかりません。Azure CLI を導入してください。")
    cmd = cmd + ["account", "get-access-token", "--scope", ENTRA_SCOPE, "--output", "json"]
    try:
        done = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=max(timeout_sec(), 20))
    except (OSError, subprocess.SubprocessError):
        raise UpstreamError(503, "entra_unavailable", "az コマンドを実行できません。")
    if done.returncode != 0:
        raise UpstreamError(503, "entra_not_signed_in", "Entra ID のトークンを取得できません。az login でサインインしてください。")
    try:
        token = json.loads(done.stdout.decode("utf-8", "replace")).get("accessToken")
    except ValueError:
        token = None
    if not token or not isinstance(token, str):
        raise UpstreamError(503, "entra_unavailable", "Entra ID のトークンを取得できません。")
    _token_cache["token"] = token
    _token_cache["until"] = now + _TOKEN_TTL_SEC
    return token


def auth_headers(settings):
    if settings.auth_method == "entra":
        return {"Authorization": "Bearer " + get_entra_token()}
    return {"api-key": settings.api_key}


def secrets_of(settings):
    s = [settings.api_key]
    if _token_cache["token"]:
        s.append(_token_cache["token"])
    return [x for x in s if x]


def post_responses(settings, body_bytes):
    """<endpoint>/responses へ POST し、(status, 応答本文 bytes) を返す。打ち切り・失敗は UpstreamError。"""
    headers = auth_headers(settings)
    headers["Content-Type"] = "application/json"
    headers["Accept"] = "application/json"
    parts = urlsplit(settings.endpoint)
    host = parts.hostname
    port = parts.port or (443 if parts.scheme == "https" else 80)
    loopback_ok = settings.allow_loopback and host in ("127.0.0.1", "localhost", "::1")
    if not loopback_ok and not resolves_to_public(host, port):
        raise UpstreamError(502, "upstream_blocked", "上流のアドレスが許可されていません。")
    path = parts.path.rstrip("/") + "/responses"
    limit = max_bytes()
    total = timeout_sec()
    deadline = time.time() + total
    conn = None
    try:
        if parts.scheme == "https":
            conn = http.client.HTTPSConnection(host, port, timeout=total, context=ssl.create_default_context())
        else:
            conn = http.client.HTTPConnection(host, port, timeout=total)
        conn.request("POST", path, body=body_bytes, headers=headers)
        resp = conn.getresponse()
        chunks, size = [], 0
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                raise UpstreamError(504, "upstream_timeout", "上流の応答が時間内に完了しませんでした。")
            if conn.sock is not None:
                conn.sock.settimeout(remaining)
            chunk = resp.read(8192)
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                raise UpstreamError(502, "upstream_too_large", "上流の応答が大きすぎます。")
            chunks.append(chunk)
        return resp.status, b"".join(chunks)
    except UpstreamError:
        raise
    except (OSError, http.client.HTTPException):
        # socket.timeout も OSError。例外の文面に URL・ヘッダが入りうるので、型だけで判断する
        if time.time() >= deadline - 0.05:
            raise UpstreamError(504, "upstream_timeout", "上流の応答が時間内に完了しませんでした。")
        raise UpstreamError(502, "upstream_unreachable", "上流へ接続できません。")
    finally:
        if conn is not None:
            conn.close()
