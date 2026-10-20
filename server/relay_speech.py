"""Azure Speech の設定・キーの保管・接続テスト・音声の中継（FR-082 / NFR-SEC-005。FR-081 の音声の中継の入口）。

標準ライブラリだけ。契約: tests/system/CONTRACT-AZURE-SPEECH.md の「2. 中継サーバー」。
- キーは中継サーバーだけが、git 管理外の保管先（既定 config/azure-speech.local.json、環境変数 RELAY_SPEECH_STORE）に保存する。
  Windows では現在の利用者に結び付いた DPAPI（CryptProtectData）で暗号化し、ほかの OS では所有者だけが読み書きできる権限（0600）で保存する。
- どの応答・ログにも、キー・上流への認証ヘッダ・上流から得たアクセストークンを出さない（応答は「設定済み／未設定」とホスト名と結果の分類だけ）。
- キーは「キーを付けてよいホスト」への要求にだけ付ける: カスタムドメインならそのホスト、リージョン名ならトークンの発行のホスト
  （<region>.api.cognitive.microsoft.com）。認識のホスト（<region>.stt.speech.microsoft.com）には発行したアクセストークンだけを付ける。
- エンドポイントは https の Azure Speech のドメインかリージョン名だけ（AC-449）。ループバックの上流のモックは
  RELAY_ALLOW_LOOPBACK_UPSTREAM=1（テスト専用・既定オフ。要求の本文からは変えられない）のときだけ受け付ける。
"""
import base64
import http.client
import ipaddress
import json
import os
import re
import ssl
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit

from relay_config import ROOT, resolves_to_public

DEFAULT_STORE_PATH = os.path.join(ROOT, "config", "azure-speech.local.json")
TEST_TIMEOUT_SEC = 9.0  # PARAM-074（10 秒）以内に応答するため、上流の待ちは 9 秒で打ち切る
RECOGNIZE_TIMEOUT_SEC = 20.0
DEFAULT_TOKEN_TTL_SEC = 9 * 60  # Azure Speech のアクセストークンの有効期間（10 分）より短く使う
MAX_AUDIO_BYTES = 4 * 1024 * 1024
MAX_UPSTREAM_BYTES = 256 * 1024
LANGUAGES = ("ja-JP", "en-US")
RESULTS = ("success", "unconfigured", "auth", "network", "timeout")

# AC-449: 受け付けるドメイン（先頭のラベルは 1 つ以上の英小文字・数字・ハイフン）
CUSTOM_DOMAIN = ".cognitiveservices.azure.com"
TOKEN_DOMAIN = ".api.cognitive.microsoft.com"
STT_DOMAIN = ".stt.speech.microsoft.com"
_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_REGION = re.compile(r"^[a-z0-9]{1,40}$")
_KEY_OK = re.compile(r"^[\x21-\x7e]{1,256}$")  # 表示可能な ASCII だけ（ヘッダへの注入を防ぐ）

_DPAPI_ENTROPY = b"Graphic-Recording-Panel/AzureSpeech/v1"
_lock = threading.Lock()
_token = {"fp": None, "token": None, "until": 0.0}


class InvalidInput(Exception):
    """利用者に示してよい（秘密を含まない）理由の文を持つ。"""


# ---------------------------------------------------------------- 設定・保管先


def store_path():
    return os.environ.get("RELAY_SPEECH_STORE") or DEFAULT_STORE_PATH


def allow_loopback():
    return os.environ.get("RELAY_ALLOW_LOOPBACK_UPSTREAM") == "1"  # AC-364・AC-449 の例外。テスト専用・既定オフ


def token_ttl_sec():
    try:
        v = float(os.environ.get("RELAY_SPEECH_TOKEN_TTL_SEC", ""))
        return v if v > 0 else DEFAULT_TOKEN_TTL_SEC
    except ValueError:
        return DEFAULT_TOKEN_TTL_SEC


def _is_windows():
    return sys.platform == "win32"


def _dpapi(data, protect):
    """Windows の DPAPI（現在の利用者に結び付いた暗号化）。失敗は OSError。"""
    import ctypes
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    def blob(b):
        buf = ctypes.create_string_buffer(b, len(b))
        return Blob(len(b), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf

    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    src, _keep1 = blob(data)
    ent, _keep2 = blob(_DPAPI_ENTROPY)
    out = Blob()
    flags = 0x1  # CRYPTPROTECT_UI_FORBIDDEN
    if protect:
        ok = crypt32.CryptProtectData(ctypes.byref(src), None, ctypes.byref(ent), None, None, flags, ctypes.byref(out))
    else:
        ok = crypt32.CryptUnprotectData(ctypes.byref(src), None, ctypes.byref(ent), None, None, flags, ctypes.byref(out))
    if not ok:
        raise OSError("dpapi failed")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)


def _seal(key):
    if _is_windows():
        return {"scheme": "dpapi", "data": base64.b64encode(_dpapi(key.encode("utf-8"), True)).decode("ascii")}
    return {"scheme": "plain", "data": key}  # 保管先のファイルの権限を 0600 にする（_write_store）


def _unseal(sealed):
    if not isinstance(sealed, dict) or not isinstance(sealed.get("data"), str):
        return None
    try:
        if sealed.get("scheme") == "dpapi":
            if not _is_windows():
                return None
            return _dpapi(base64.b64decode(sealed["data"]), False).decode("utf-8")
        if sealed.get("scheme") == "plain" and not _is_windows():
            return sealed["data"]
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    return None


class Config(object):
    """保存済みの設定。repr にキーを出さない。"""

    def __init__(self, endpoint=None, key=None):
        self.endpoint = endpoint  # 正規化済みのエンドポイント（https://<host> かリージョン名）
        self.key = key

    def __repr__(self):
        return "SpeechConfig(endpoint=%r, key=%s)" % (self.endpoint, "set" if self.key else "unset")


def load():
    path = store_path()
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return Config()
    if not isinstance(data, dict):
        return Config()
    endpoint = data.get("endpoint") if isinstance(data.get("endpoint"), str) else None
    if endpoint is not None and parse_endpoint(endpoint, allow_loopback()) is None:
        endpoint = None
    key = _unseal(data.get("key")) if data.get("key") else None
    return Config(endpoint, key)


def _write_store(cfg):
    """保管先へ原子的に書く（一時ファイル→置き換え）。Windows 以外は 0600。"""
    path = store_path()
    folder = os.path.dirname(os.path.abspath(path))
    os.makedirs(folder, exist_ok=True)
    payload = {"version": 1, "endpoint": cfg.endpoint, "key": _seal(cfg.key) if cfg.key else None}
    fd, tmp = tempfile.mkstemp(prefix=".azure-speech-", suffix=".tmp", dir=folder)  # mkstemp は 0600 で作る
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        if not _is_windows():
            os.chmod(tmp, 0o600)
        os.replace(tmp, path)
        if not _is_windows():
            os.chmod(path, 0o600)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------- エンドポイント（AC-449）


def _is_loopback(host):
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def parse_endpoint(text, loopback_ok):
    """エンドポイントを解釈する。不正なら None。

    戻り値: dict(kind='custom'|'region'|'loopback', canonical, host(表示), token_url_base, stt_url_base, key_host)
    """
    if not isinstance(text, str):
        return None
    s = text.strip()
    if not s or len(s) > 300:
        return None
    if _REGION.match(s):
        return _region(s)
    try:
        parts = urlsplit(s)
        host = parts.hostname
        port = parts.port
    except ValueError:
        return None
    if not host or parts.username or parts.password or parts.query or parts.fragment or parts.path not in ("", "/"):
        return None
    if loopback_ok and parts.scheme == "http" and _is_loopback(host) and port:
        base = "http://%s:%d" % ("[%s]" % host if ":" in host else host, port)
        return {"kind": "loopback", "canonical": base, "host": host, "token": (base, host), "stt": (base, host),
                "stt_path": "/stt/speech/recognition/conversation/cognitiveservices/v1"}
    if parts.scheme != "https" or (port not in (None, 443)):
        return None
    low = host.lower()
    for suffix, kind in ((CUSTOM_DOMAIN, "custom"), (TOKEN_DOMAIN, "region"), (STT_DOMAIN, "region")):
        if low.endswith(suffix):
            label = low[: -len(suffix)]
            if kind == "custom":
                if not _LABEL.match(label):
                    return None
                base = "https://" + low
                return {"kind": "custom", "canonical": base, "host": low, "token": (base, low), "stt": (base, low),
                        "stt_path": "/stt/speech/recognition/conversation/cognitiveservices/v1"}
            return _region(label) if _REGION.match(label) else None
    return None


def _region(region):
    token_host = region + TOKEN_DOMAIN
    stt_host = region + STT_DOMAIN
    return {"kind": "region", "canonical": region, "host": stt_host,
            "token": ("https://" + token_host, token_host), "stt": ("https://" + stt_host, stt_host),
            "stt_path": "/speech/recognition/conversation/cognitiveservices/v1"}


def endpoint_host(cfg):
    ep = parse_endpoint(cfg.endpoint, True) if cfg.endpoint else None
    return ep["host"] if ep else None


def status_body(cfg):
    return {"endpointHost": endpoint_host(cfg), "keyConfigured": bool(cfg.key)}


# ---------------------------------------------------------------- 操作


def save_settings(body):
    """POST /api/speech/settings。戻り値 (status, payload)。不正なら保存済みの設定を変えない。"""
    if not isinstance(body, dict):
        return 400, {"ok": False, "result": "invalid", "reason": "要求は JSON のオブジェクトにしてください。"}
    with _lock:
        cfg = load()
        new_endpoint, new_key = cfg.endpoint, cfg.key
        if "endpoint" in body and body["endpoint"] is not None:
            ep = parse_endpoint(body["endpoint"], allow_loopback())
            if ep is None:
                return 400, {"ok": False, "result": "invalid",
                             "reason": "エンドポイントは https の Azure Speech のドメイン（*.cognitiveservices.azure.com など）か、"
                                       "リージョン名（英小文字と数字）にしてください。"}
            new_endpoint = ep["canonical"]
        if "key" in body and body["key"] is not None and body["key"] != "":
            k = body["key"].strip() if isinstance(body["key"], str) else None
            if not k or not _KEY_OK.match(k):
                return 400, {"ok": False, "result": "invalid", "reason": "キーの形式が正しくありません（空白を含まない英数字・記号）。"}
            new_key = k
        changed = Config(new_endpoint, new_key)
        try:
            _write_store(changed)
        except (OSError, ValueError):
            return 500, {"ok": False, "result": "error", "reason": "キーを安全に保管できませんでした。"}
        _forget_token()
        return 200, dict({"ok": True, "result": "saved"}, **status_body(changed))


def delete_key():
    """DELETE /api/speech/key。エンドポイントは残し、キーだけを消す。"""
    with _lock:
        cfg = load()
        changed = Config(cfg.endpoint, None)
        try:
            _write_store(changed)
        except (OSError, ValueError):
            return 500, {"ok": False, "result": "error", "reason": "キーを削除できませんでした。"}
        _forget_token()
        return 200, dict({"ok": True, "result": "deleted"}, **status_body(changed))


def _forget_token():
    _token.update({"fp": None, "token": None, "until": 0.0})


# ---------------------------------------------------------------- 上流


class _Fail(Exception):
    def __init__(self, result):
        Exception.__init__(self, result)
        self.result = result


def _connect_target(base, host):
    """上流の接続先 (scheme, connect_host, port)。RELAY_SPEECH_UPSTREAM はテスト専用（ループバックの許可があるときだけ）。"""
    parts = urlsplit(base)
    mock = os.environ.get("RELAY_SPEECH_UPSTREAM")
    if mock and allow_loopback():
        m = urlsplit(mock)
        if m.scheme == "http" and m.hostname and _is_loopback(m.hostname) and m.port:
            return "http", m.hostname, m.port
    port = parts.port or (443 if parts.scheme == "https" else 80)
    if parts.scheme == "http":
        if not (allow_loopback() and _is_loopback(parts.hostname or "")):
            raise _Fail("network")
        return "http", parts.hostname, port
    if not resolves_to_public(host, port):
        raise _Fail("network")
    return "https", host, port


def _request(base, host, method, path, headers, body, deadline):
    """1 回の上流への要求。(status, body bytes)。失敗は _Fail（network / timeout）。リダイレクトは追わない。"""
    scheme, connect_host, port = _connect_target(base, host)
    remaining = deadline - time.time()
    if remaining <= 0:
        raise _Fail("timeout")
    conn = None
    try:
        if scheme == "https":
            conn = http.client.HTTPSConnection(connect_host, port, timeout=remaining, context=ssl.create_default_context())
        else:
            conn = http.client.HTTPConnection(connect_host, port, timeout=remaining)
        hdrs = {"Host": host if scheme == "https" or os.environ.get("RELAY_SPEECH_UPSTREAM") else "%s:%d" % (host, port)}
        hdrs.update(headers)
        hdrs["Content-Length"] = str(len(body))
        conn.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
        for k, v in hdrs.items():
            conn.putheader(k, v)
        conn.endheaders(body if body else None)
        resp = conn.getresponse()
        chunks, size = [], 0
        while True:
            left = deadline - time.time()
            if left <= 0:
                raise _Fail("timeout")
            if conn.sock is not None:
                conn.sock.settimeout(left)
            chunk = resp.read(8192)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_UPSTREAM_BYTES:
                raise _Fail("network")
            chunks.append(chunk)
        return resp.status, b"".join(chunks)
    except _Fail:
        raise
    except (OSError, http.client.HTTPException):
        # 例外の文面に URL・ヘッダが入りうるので、型と時刻だけで分類する
        if time.time() >= deadline - 0.05:
            raise _Fail("timeout")
        raise _Fail("network")
    finally:
        if conn is not None:
            conn.close()


def _fingerprint(cfg):
    import hashlib
    return hashlib.sha256(("%s\n%s" % (cfg.endpoint, cfg.key)).encode("utf-8")).hexdigest()


def _issue_token(cfg, ep, deadline):
    """STS（/sts/v1.0/issueToken）にキーを付けて、本文なしの要求を送る。キーを付けるのはトークンの発行のホストだけ。"""
    base, host = ep["token"]
    status, body = _request(base, host, "POST", "/sts/v1.0/issueToken",
                            {"Ocp-Apim-Subscription-Key": cfg.key}, b"", deadline)
    if status in (401, 403):
        raise _Fail("auth")
    if status != 200:
        raise _Fail("network")
    token = body.decode("ascii", "replace").strip()
    if not token or len(token) > 8192 or not _KEY_OK.match(token[:256]):
        raise _Fail("network")
    return token


def _get_token(cfg, ep, deadline, fresh=False):
    fp = _fingerprint(cfg)
    now = time.time()
    if not fresh and _token["fp"] == fp and _token["token"] and _token["until"] > now:
        return _token["token"]
    token = _issue_token(cfg, ep, deadline)
    _token.update({"fp": fp, "token": token, "until": time.time() + token_ttl_sec()})
    return token


def connection_test():
    """POST /api/speech/test。会議の音声・文字を含まない最小の要求（キーの検証）だけを送る。"""
    cfg = load()
    ep = parse_endpoint(cfg.endpoint, allow_loopback()) if cfg.endpoint else None
    if not ep or not cfg.key:
        return 200, {"ok": False, "result": "unconfigured"}  # 上流へは送らない
    try:
        _issue_token(cfg, ep, time.time() + TEST_TIMEOUT_SEC)
    except _Fail as e:
        return 200, {"ok": False, "result": e.result}
    return 200, {"ok": True, "result": "success"}


def recognize(language, audio):
    """POST /api/speech/recognize。音声を認識のホストだけへ送り、確定結果の文字列を返す。音声・文字列は保存・ログ出力しない。"""
    if language not in LANGUAGES:
        return 400, {"ok": False, "result": "invalid", "reason": "language は ja-JP か en-US にしてください。"}
    cfg = load()
    ep = parse_endpoint(cfg.endpoint, allow_loopback()) if cfg.endpoint else None
    if not ep or not cfg.key:
        return 200, {"ok": False, "result": "unconfigured"}
    deadline = time.time() + RECOGNIZE_TIMEOUT_SEC
    base, host = ep["stt"]
    path = "%s?language=%s&format=simple" % (ep["stt_path"], language)
    headers = {"Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000", "Accept": "application/json"}
    try:
        for attempt in (0, 1):
            token = _get_token(cfg, ep, deadline, fresh=attempt == 1)
            status, body = _request(base, host, "POST", path, dict(headers, Authorization="Bearer " + token), audio, deadline)
            if status in (401, 403) and attempt == 0:
                continue  # トークンの期限切れ。取り直して 1 回だけ再送する
            break
    except _Fail as e:
        return 200, {"ok": False, "result": e.result}
    if status in (401, 403):
        _forget_token()
        return 200, {"ok": False, "result": "auth"}
    if status != 200:
        return 200, {"ok": False, "result": "network"}
    try:
        data = json.loads(body.decode("utf-8"))
    except ValueError:
        return 200, {"ok": False, "result": "network"}
    if not isinstance(data, dict):
        return 200, {"ok": False, "result": "network"}
    text = data.get("DisplayText") if data.get("RecognitionStatus") == "Success" else ""
    return 200, {"ok": True, "result": "success", "text": text if isinstance(text, str) else ""}


def secrets():
    """応答・ログから除くべき秘密（キーとアクセストークン）。"""
    out = []
    try:
        k = load().key
        if k:
            out.append(k)
    except Exception:  # noqa: BLE001 秘密の列挙の失敗で応答を止めない
        pass
    if _token["token"]:
        out.append(_token["token"])
    return out
