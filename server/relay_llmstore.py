"""画面（接続キー画面）で保存した Microsoft Foundry の接続設定の保管先（FR-086 / NFR-SEC-006 AC-502）。

- エンドポイント・デプロイ名・認証方式・API キーを 1 つの JSON にまとめ、その全体を relay_speech と同じ封（Windows は DPAPI、
  ほかは所有者だけの読み書き 0600）で保存する。保管先のファイルにキーもエンドポイントも平文では含まれない。
- 保管先は git 管理外（config/llm-ui.local.json。.gitignore に載せる）。RELAY_LLM_STORE で差し替えられる（テスト用）。
- 値の優先順位（環境変数 ＞ config/llm.local.json ＞ ここ）は relay_config.load_settings が決める。
- 秘密は戻り値の dict の中だけに持つ。ログ・応答には出さない（呼び出し側の責務）。
"""
import json
import os
import re
import tempfile
import threading

import relay_speech as _sp
from relay_config import ROOT, AUTH_METHODS, PROVIDERS, COPILOT_AUTH_METHODS, validate_endpoint

DEFAULT_STORE_PATH = os.path.join(ROOT, "config", "llm-ui.local.json")
MAX_ENDPOINT_LEN = 2048  # PARAM-095
MAX_DEPLOYMENT_LEN = 64  # PARAM-096
MAX_KEY_LEN = 512  # PARAM-094
_KEY_OK = re.compile(r"^[\x21-\x7e]+$")  # 表示可能な ASCII だけ（ヘッダへの注入を防ぐ）
# provider と copilot* は FR-068 / FR-088（LLM のプロバイダーの選択と GitHub Copilot の設定）。トークンも同じ封で保存する
FIELDS = ("endpoint", "deployment", "authMethod", "apiKey", "provider", "copilotAuthMethod", "copilotModel", "copilotToken")
MAX_COPILOT_MODEL_LEN = 128
MAX_COPILOT_TOKEN_LEN = 512
_lock = threading.Lock()


def store_path():
    return os.environ.get("RELAY_LLM_STORE") or DEFAULT_STORE_PATH


def load():
    """保存済みの値（なければ None の項目）。読めない・壊れているときは全項目 None。"""
    out = dict.fromkeys(FIELDS)
    try:
        with open(store_path(), "r", encoding="utf-8") as f:
            data = json.load(f)
        plain = _sp._unseal(data.get("sealed")) if isinstance(data, dict) else None
        inner = json.loads(plain) if plain else None
    except (OSError, ValueError):
        return out
    if not isinstance(inner, dict):
        return out
    for k in FIELDS:
        v = inner.get(k)
        out[k] = v if isinstance(v, str) and v else None
    return out


def _write(values):
    path = store_path()
    folder = os.path.dirname(os.path.abspath(path))
    os.makedirs(folder, exist_ok=True)
    if not any(values.get(k) for k in FIELDS):
        try:
            os.remove(path)
        except OSError:
            pass
        return
    inner = json.dumps({k: values.get(k) for k in FIELDS}, ensure_ascii=False)
    payload = {"version": 1, "sealed": _sp._seal(inner)}
    fd, tmp = tempfile.mkstemp(prefix=".llm-ui-", suffix=".tmp", dir=folder)  # mkstemp は 0600 で作る
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        if not _sp._is_windows():
            os.chmod(tmp, 0o600)
        os.replace(tmp, path)
        if not _sp._is_windows():
            os.chmod(path, 0o600)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------- 検査（理由は分類だけ。入力値を含めない）


def check_endpoint(value, allow_loopback):
    """問題があれば 'endpoint_format' / 'endpoint_internal' を、なければ None を返す。"""
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > MAX_ENDPOINT_LEN:
        return "endpoint_format"
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in value):
        return "endpoint_format"
    problem = validate_endpoint(value.strip(), allow_loopback)
    if problem is None:
        return None
    return "endpoint_internal" if ("内部" in problem or "localhost" in problem) else "endpoint_format"


def check_deployment(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > MAX_DEPLOYMENT_LEN:
        return "deployment_format"
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in value):
        return "deployment_format"
    return None


def check_auth_method(value):
    return None if value in AUTH_METHODS else "auth_method_format"


def check_key(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > MAX_KEY_LEN or not _KEY_OK.match(value.strip()):
        return "key_format"
    return None


def check_provider(value):
    return None if value in PROVIDERS else "provider_format"


def check_copilot_auth_method(value):
    return None if value in COPILOT_AUTH_METHODS else "auth_method_format"


def check_copilot_model(value):
    """空文字は「SDK の既定のモデル」。空白だけ・制御文字・長すぎるものは不正。"""
    if not isinstance(value, str) or len(value) > MAX_COPILOT_MODEL_LEN:
        return "model_format"
    if value and (not value.strip() or any(ord(c) < 0x20 or ord(c) == 0x7F for c in value)):
        return "model_format"
    return None


def check_copilot_token(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > MAX_COPILOT_TOKEN_LEN or not _KEY_OK.match(value.strip()):
        return "token_format"
    return None


# ---------------------------------------------------------------- 保存・削除


def save(values):
    """values: endpoint / deployment / authMethod / apiKey のうち更新するもの。検査は呼び出し側。"""
    with _lock:
        cur = load()
        for k in FIELDS:
            if k in values and values[k] is not None:
                cur[k] = values[k].strip()
        _write(cur)


def delete(fields):
    """fields の項目だけを消す。"""
    with _lock:
        cur = load()
        for k in fields:
            cur[k] = None
        _write(cur)
