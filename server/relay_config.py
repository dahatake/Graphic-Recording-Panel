"""中継サーバーの設定の読み込みと検証（FR-066 / NFR-SEC-003）。

環境変数が設定ファイル（config/llm.local.json）より優先する。
秘密（API キー・トークン）は Settings の中だけに持ち、文字列化・ログ・応答には出さない。
後続の項目（設定ファイル・Entra）は、この層を拡張する。
"""
import ipaddress
import json
import os
import re
import socket
from urllib.parse import urlsplit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_CONFIG_PATH = os.path.join(ROOT, "config", "llm.local.json")
DEFAULT_TIMEOUT_SEC = 30  # PARAM-069
DEFAULT_MAX_BYTES = 262144  # PARAM-071
AUTH_METHODS = ("apiKey", "entra")

_FIELDS = (
    ("endpoint", "LLM_ENDPOINT"),
    ("deployment", "LLM_DEPLOYMENT"),
    ("authMethod", "LLM_AUTH_METHOD"),
    ("apiKey", "LLM_API_KEY"),
)


class Settings(object):
    """読み込み済みの設定。repr に秘密を出さない。"""

    def __init__(self, endpoint, deployment, auth_method, api_key, allow_loopback, file_error=None):
        self.endpoint = endpoint
        self.deployment = deployment
        self.auth_method = auth_method
        self.api_key = api_key
        self.allow_loopback = allow_loopback
        self.file_error = file_error
        self.sources = {}

    def __repr__(self):
        return "Settings(endpoint=%r, deployment=%r, auth_method=%r)" % (
            self.endpoint, self.deployment, self.auth_method)


def _env_int(name, default):
    try:
        v = int(os.environ.get(name, ""))
        return v if v > 0 else default
    except ValueError:
        return default


def timeout_sec():
    return _env_int("RELAY_TIMEOUT_SEC", DEFAULT_TIMEOUT_SEC)


def max_bytes():
    return _env_int("RELAY_MAX_BYTES", DEFAULT_MAX_BYTES)


def load_settings():
    """環境変数 > 設定ファイル の順で設定を読む。要求のたびに呼ぶ（変更が即反映される）。"""
    path = os.environ.get("LLM_CONFIG_PATH") or DEFAULT_CONFIG_PATH
    data = {}
    file_error = None
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                data = loaded
            else:
                file_error = "設定ファイルの形式が不正です。"
        except (OSError, ValueError):
            file_error = "設定ファイルを読み込めません。"  # 内容は出さない
    values = {}
    sources = {}
    saved = None  # 画面での保存（FR-086）。上位に値がない項目にだけ使う。必要なときだけ読む
    for key, env in _FIELDS:
        src = "env"
        v = os.environ.get(env)
        if v is None or v == "":
            src = "file"
            v = data.get(key)
        v = v.strip() if isinstance(v, str) else None
        if not v:
            src = "ui"
            if saved is None:
                import relay_llmstore  # 循環を避けるため遅延 import
                saved = relay_llmstore.load()
            v = saved.get(key)
            v = v.strip() if isinstance(v, str) else None
        values[key] = v or None
        sources[key] = src if values[key] else None
    s = Settings(
        endpoint=values["endpoint"],
        deployment=values["deployment"],
        auth_method=values["authMethod"] or "apiKey",
        api_key=values["apiKey"],
        allow_loopback=os.environ.get("RELAY_ALLOW_LOOPBACK_UPSTREAM") == "1",  # AC-364。テスト専用・既定オフ
        file_error=file_error,
    )
    s.sources = sources  # 項目ごとの出どころ（ui / env / file / None）。秘密ではない
    return s


def _is_loopback_host(host):
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def validate_endpoint(endpoint, allow_loopback):
    """エンドポイントの検証。問題があれば秘密を含まない理由の文を、なければ None を返す。"""
    try:
        parts = urlsplit(endpoint)
        host = parts.hostname
        parts.port  # noqa: B018 （不正なポートで例外を出す）
    except ValueError:
        return "エンドポイントの URL が不正です。"
    if not host or parts.scheme not in ("http", "https") or parts.username or parts.password:
        return "エンドポイントは https の URL にしてください。"
    if allow_loopback and _is_loopback_host(host):
        return None  # AC-364: テスト用のループバックの上流だけ
    if parts.scheme != "https":
        return "エンドポイントは https にしてください。"
    low = host.lower().rstrip(".")
    if low == "localhost" or low.endswith(".localhost"):
        return "エンドポイントに localhost は使えません。"
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        # 10進・16進・8進・省略形の IPv4 表記（例: 2130706433、0x7f.1）は内部アドレスを隠せるので拒否する
        try:
            socket.inet_aton(host)
            return "エンドポイントに内部のアドレスは使えません。"
        except OSError:
            pass
        if re.fullmatch(r"(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+))*", low):
            return "エンドポイントに内部のアドレスは使えません。"
        return None
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped
    if not ip.is_global:
        return "エンドポイントに内部のアドレスは使えません。"
    return None


def resolves_to_public(host, port):
    """接続の直前の確認: 名前解決の結果が公開アドレスだけか（内部アドレスへの誘導を防ぐ）。"""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError:
        return False
    for info in infos:
        try:
            if not ipaddress.ip_address(info[4][0].split("%")[0]).is_global:
                return False
        except ValueError:
            return False
    return bool(infos)
