"""ローカル中継サーバー（FR-066 / NFR-SEC-003）。標準ライブラリだけ。

  python server/relay.py --web web [--port N]   （省略で空きポートを自動選択。FR-083）

- 127.0.0.1 だけで待ち受ける。静的ファイルの配信と LLM の中継を同じオリジンで行う。
- Host・Origin が自分自身（127.0.0.1 / localhost の自分のポート）でない要求は 403。
- API キー・トークンはこのプロセスだけが持ち、応答・ログには出さない。
- 構成: relay_config（設定）・relay_security（入口の検証と応答の無害化）・relay_upstream（上流）・
  relay_speech（Azure Speech の設定・キーの保管・接続テスト・音声の中継。FR-082 / NFR-SEC-005）・
  relay_copilot（GitHub Copilot SDK を介したモデルの呼び出し。FR-087。SDK は任意の依存で、なくても起動する）。
"""
import argparse
import importlib
import json
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 同じフォルダーの自前モジュール（外部パッケージではない）。構成を分けて後続の項目で拡張しやすくする
cfg = importlib.import_module("relay_config")
sec = importlib.import_module("relay_security")
up = importlib.import_module("relay_upstream")
speech = importlib.import_module("relay_speech")
store = importlib.import_module("relay_llmstore")
copilot = importlib.import_module("relay_copilot")  # GitHub Copilot SDK を介した呼び出し（FR-087）。SDK は任意の依存
signin = importlib.import_module("relay_copilot_signin")  # Copilot CLI のサインイン（デバイスフロー。FR-088）
signin.on_completed = lambda: copilot.set_signed_out(False)  # サインインの完了でこのアプリでのサインアウトを解除（AC-511）
BIND_ADDRESS = "127.0.0.1"
MAX_REQUEST_BYTES = 1024 * 1024
LLM_PREFIX = "/api/llm/"
SPEECH_PREFIX = "/api/speech/"


def _host_of(endpoint):
    """エンドポイントのホスト名だけ（パス・クエリ・ユーザー情報は返さない）。"""
    if not endpoint:
        return ""
    try:
        return urlsplit(endpoint).hostname or ""
    except ValueError:
        return ""


def connection_view(s):
    """画面向けの接続設定の状態（AC-500）。キーの値・URL のパス・クエリ・認証ヘッダを含まない。"""
    src = getattr(s, "sources", {}) or {}
    has_key = bool(s.api_key)
    return {
        "configured": {
            "endpoint": bool(s.endpoint), "deployment": bool(s.deployment), "authMethod": bool(src.get("authMethod")),
            "key": has_key, "credential": has_key or s.auth_method == "entra",
        },
        "endpointHost": _host_of(s.endpoint),
        "authMethod": s.auth_method if s.auth_method in cfg.AUTH_METHODS else "apiKey",
        "sources": {"endpoint": src.get("endpoint"), "deployment": src.get("deployment"),
                    "authMethod": src.get("authMethod"), "key": src.get("apiKey")},
        "keyConfigured": has_key,
        "keySource": src.get("apiKey") if has_key else None,
    }


def copilot_view(cs, check=None):
    """プロバイダーの選択と GitHub Copilot の状態（FR-087 AC-505 / FR-088）。トークンの値を含まない。
    check（既定: プロバイダーが GitHub Copilot のとき）が真のときだけ、available・unavailableReason（sdk_missing /
    cli_unavailable）・signedIn・account を SDK・CLI に確かめる（AC-507 の例外の範囲）。偽のときは CLI を起動せず、
    SDK の導入の有無だけを返し、signedIn は null（未確認。Q-034 / AC-510）。
    missing は LLM 連携を有効にできない原因の分類（sdk / signin / token）。"""
    if check is None:
        check = cs.provider == "copilot"
    probed = copilot.probe(cs, check=check)
    src = cs.sources
    missing = copilot.readiness(cs, probed)
    return {
        "provider": cs.provider,
        "providerSource": src.get("provider"),
        "copilot": {
            "available": probed["available"], "unavailableReason": probed["unavailableReason"],
            "authMethod": cs.auth_method, "authMethodSource": src.get("authMethod"),
            "signedIn": probed["signedIn"], "account": probed["account"],
            "tokenConfigured": bool(cs.token), "tokenSource": src.get("token") if cs.token else None,
            "model": cs.model, "modelSource": src.get("model") if cs.model else None,
            "ready": not missing, "missing": missing,
        },
    }


def current_status(with_copilot=False):
    """LLM 連携の状態（秘密を含まない）。state は Microsoft Foundry の unconfigured / ready / error（FR-086 のまま）。
    with_copilot のとき、プロバイダーの選択と GitHub Copilot の状態（copilot_view）を加える。"""
    s, st = _base_status()
    st.update(connection_view(s))
    if with_copilot:
        st.update(copilot_view(cfg.load_copilot_settings()))
    return s, st


def _base_status():
    s = cfg.load_settings()
    missing = []
    if not s.endpoint:
        missing.append("endpoint")
    if not s.deployment:
        missing.append("deployment")
    if s.auth_method not in cfg.AUTH_METHODS:
        return s, {"state": "error", "missing": [], "configured": False,
                   "reason": "authMethod は apiKey か entra にしてください。"}
    if s.auth_method == "apiKey" and not s.api_key:
        missing.append("apiKey")
    if missing:
        if not s.endpoint and not s.deployment and not s.api_key and not s.file_error:
            return s, {"state": "unconfigured", "missing": missing, "configured": False,
                       "reason": "LLM 連携は設定されていません。"}
        return s, {"state": "unconfigured", "missing": missing, "configured": False,
                   "reason": s.file_error or "設定が足りません: " + ", ".join(missing)}
    problem = cfg.validate_endpoint(s.endpoint, s.allow_loopback)
    if problem:
        return s, {"state": "error", "missing": [], "configured": False, "reason": problem}
    if s.auth_method == "entra":
        try:
            up.get_entra_token()
        except up.UpstreamError as e:
            return s, {"state": "error", "missing": [], "configured": False, "reason": e.message}
    return s, {"state": "ready", "missing": [], "configured": True, "reason": "利用できます。"}


class RelayHandler(SimpleHTTPRequestHandler):
    server_version = "LocalRelay"
    sys_version = ""

    # ログ: メソッドと経路（クエリなし）と結果だけ。ヘッダ・本文・設定は出さない。
    def log_message(self, fmt, *args):
        pass

    def log_request(self, code="-", size="-"):
        path = (self.path or "").split("?", 1)[0][:200]
        sys.stderr.write("%s %s -> %s\n" % (self.command, path, code))

    def log_error(self, fmt, *args):
        sys.stderr.write("relay error\n")

    # --- 共通 ---
    def _port(self):
        return self.server.server_address[1]

    def _send_json(self, status, payload):
        body = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _forbidden(self):
        # 本文を読まずに閉じると、Windows では未読のデータのために接続がリセットされ、403 の応答が届かないことがある。
        # 上限内の本文は読み捨ててから応答する（上流へは送らない）
        try:
            n = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            n = 0
        if 0 < n <= MAX_REQUEST_BYTES:
            try:
                self.rfile.read(n)
            except OSError:
                pass
        self.close_connection = True
        self._send_json(403, sec.error_body("forbidden", "この要求は許可されていません。"))

    def _guard(self, is_llm):
        """Host（全要求）と Origin（LLM・Azure Speech 向けの GET 以外は必須）を検証する。通らなければ 403 を返して False。"""
        port = self._port()
        if not sec.host_ok(self.headers.get("Host"), port):
            self._forbidden()
            return False
        required = is_llm and self.command != "GET"
        if not sec.origin_ok(self.headers.get("Origin"), port, required=required):
            self._forbidden()
            return False
        return True

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        SimpleHTTPRequestHandler.end_headers(self)

    # --- メソッド ---
    def _is_api(self):
        return self.path.startswith(LLM_PREFIX) or self.path.startswith(SPEECH_PREFIX)

    def do_GET(self):
        is_llm = self._is_api()
        if not self._guard(is_llm):
            return
        if self.path.startswith(SPEECH_PREFIX):
            return self._speech()
        if is_llm:
            if self.path.split("?", 1)[0] == LLM_PREFIX + "status":
                s, st = current_status(with_copilot=True)
                text = sec.redact(json.dumps(st, ensure_ascii=False),
                                  up.secrets_of(s) + copilot.secrets_of(cfg.load_copilot_settings()))
                return self._send_json(200, text.encode("utf-8"))
            if self.path.split("?", 1)[0] == LLM_PREFIX + "copilot/signin":
                return self._copilot_admin()
            if self.path.split("?", 1)[0] == LLM_PREFIX + "copilot":
                # 接続キー画面の GitHub Copilot の分類を開いたときの状態の取得（CLI で確かめてよい時点。AC-507・Q-034）
                cs = cfg.load_copilot_settings()
                text = sec.redact(json.dumps(copilot_view(cs, check=True), ensure_ascii=False), copilot.secrets_of(cs))
                return self._send_json(200, text.encode("utf-8"))
            if self.path.split("?", 1)[0] == LLM_PREFIX + "provider":
                return self._send_json(200, {"provider": cfg.load_copilot_settings().provider})
            return self._send_json(404, sec.error_body("not_found", "見つかりません。"))
        SimpleHTTPRequestHandler.do_GET(self)

    def do_HEAD(self):
        is_llm = self._is_api()
        if not self._guard(is_llm):
            return
        if is_llm:
            return self._send_json(404, sec.error_body("not_found", "見つかりません。"))
        SimpleHTTPRequestHandler.do_HEAD(self)

    def do_POST(self):
        is_llm = self._is_api()
        if not self._guard(is_llm):
            return
        if self.path.startswith(SPEECH_PREFIX):
            return self._speech()
        # extract は FR-063 の抽出要求。responses と同じ中継（Responses 形式の本文）をする
        if self.command == "POST" and self.path.split("?", 1)[0] in (LLM_PREFIX + "responses", LLM_PREFIX + "extract", LLM_PREFIX + "svg"):
            return self._relay()
        if is_llm and self.command in ("POST", "DELETE") and self.path.split("?", 1)[0] in (LLM_PREFIX + "key", LLM_PREFIX + "config"):
            return self._llm_admin()
        # FR-088: GitHub Copilot の認証方式・モデル名・トークンの保存と削除、サインインの開始・取り消し
        if is_llm and self.command in ("POST", "DELETE") and self.path.split("?", 1)[0] in (LLM_PREFIX + "copilot", LLM_PREFIX + "copilot/signin"):
            return self._copilot_admin()
        if is_llm and self.command == "POST" and self.path.split("?", 1)[0] == LLM_PREFIX + "copilot/signout":
            return self._copilot_admin()
        if is_llm and self.command == "POST" and self.path.split("?", 1)[0] == LLM_PREFIX + "provider":
            return self._llm_provider()
        status = 405 if is_llm and self.path.startswith(LLM_PREFIX + "config") else 404
        self._send_json(status if is_llm else 405, sec.error_body("not_allowed", "この操作はできません。"))

    do_PUT = do_DELETE = do_PATCH = do_POST

    def _read_body(self):
        if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
            return self._read_chunked()
        try:
            n = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            return None
        if n < 0 or n > MAX_REQUEST_BYTES:
            return None
        return self.rfile.read(n)

    def _read_chunked(self):
        data = b""
        while True:
            line = self.rfile.readline(64)
            try:
                size = int(line.split(b";", 1)[0].strip() or b"x", 16)
            except ValueError:
                return None
            if size == 0:
                while self.rfile.readline(1024).strip():  # trailer
                    pass
                return data
            if len(data) + size > MAX_REQUEST_BYTES:
                return None
            data += self.rfile.read(size)
            self.rfile.readline(4)

    def _llm_admin(self):
        """画面からの Foundry の接続設定・キーの保存と削除（FR-086 / NFR-SEC-006）。応答は秘密を含まない。"""
        route = (self.command, self.path.split("?", 1)[0][len(LLM_PREFIX):])
        raw = self._read_body()
        s = cfg.load_settings()
        src = s.sources
        locked = lambda *names: any(src.get(n) in ("env", "file") for n in names)  # noqa: E731

        def reply(status, ok, result, reason=None):
            s2, st = current_status()
            body = dict(st)
            body.pop("reason", None)  # 状態の説明文ではなく、操作の結果の分類を返す
            body.update({"ok": ok, "result": result})
            if reason:
                body["reason"] = reason
            text = sec.redact(json.dumps(body, ensure_ascii=False), up.secrets_of(s2) + [s.api_key, store.load().get("apiKey")])
            self._send_json(status, text.encode("utf-8"))

        body = None
        if route[0] == "POST":
            try:
                body = json.loads(raw.decode("utf-8")) if raw else None
            except ValueError:
                body = None
            if not isinstance(body, dict):
                return reply(400, False, "invalid", "body_format")
        if route == ("POST", "key"):
            bad = store.check_key(body.get("key"))
            if bad:
                return reply(400, False, "invalid", bad)
            if s.auth_method != "apiKey":
                return reply(400, False, "invalid", "auth_method_mismatch")
            if locked("apiKey"):
                return reply(409, False, "env_managed")
            store.save({"apiKey": body["key"]})
            return reply(200, True, "saved")
        if route == ("DELETE", "key"):
            if locked("apiKey"):
                return reply(409, False, "env_managed")
            store.delete(["apiKey"])
            return reply(200, True, "deleted")
        if route == ("POST", "config"):
            checks = {"endpoint": lambda v: store.check_endpoint(v, s.allow_loopback),
                      "deployment": store.check_deployment, "authMethod": store.check_auth_method}
            present = [k for k in checks if k in body]
            if not present:
                return reply(400, False, "invalid", "body_format")
            for k in present:
                bad = checks[k](body[k])
                if bad:
                    return reply(400, False, "invalid", bad)
            if locked(*present):
                return reply(409, False, "env_managed")
            store.save({k: body[k] for k in present})
            return reply(200, True, "saved")
        # ("DELETE", "config")
        store.delete(["endpoint", "deployment", "authMethod"])
        if locked("endpoint", "deployment", "authMethod"):
            return reply(409, False, "env_managed")
        return reply(200, True, "deleted")

    def _copilot_admin(self):
        """GitHub Copilot の設定の保存・削除とサインイン（FR-088 AC-509・AC-510 / NFR-SEC-006 AC-515）。
        応答はトークン・資格情報を含まない（拒否の応答は原因の分類だけ）。設定の保存では SDK・CLI を起動しない（AC-507）。"""
        route = (self.command, self.path.split("?", 1)[0][len(LLM_PREFIX):])
        raw = self._read_body() if self.command != "GET" else None
        cs = cfg.load_copilot_settings()
        src = cs.sources
        upper = lambda name: src.get(name) in ("env", "file")  # noqa: E731

        def send(status, payload):
            cs2 = cfg.load_copilot_settings()
            secrets = copilot.secrets_of(cs) + copilot.secrets_of(cs2) + [store.load().get("copilotToken")]
            self._send_json(status, sec.redact(json.dumps(payload, ensure_ascii=False), secrets).encode("utf-8"))

        def reply(status, ok, result, reason=None):
            cs2 = cfg.load_copilot_settings()
            s2 = cs2.sources
            body = {"ok": ok, "result": result, "copilot": {
                "authMethod": cs2.auth_method, "authMethodSource": s2.get("authMethod"),
                "tokenConfigured": bool(cs2.token), "tokenSource": s2.get("token") if cs2.token else None,
                "model": cs2.model, "modelSource": s2.get("model") if cs2.model else None,
            }}
            if result == "signed_out":
                body["copilot"].update({"signedIn": False, "account": None})
            if reason:
                body["reason"] = reason
            send(status, body)

        if route[1] == "copilot/signin":
            if route[0] == "GET":
                return send(200, signin.status())
            if route[0] == "DELETE":
                return send(200, signin.cancel())
            if cs.auth_method != "signin":
                return send(409, {"ok": False, "result": "auth_method_mismatch"})
            if copilot.load_sdk() is not None and signin.status().get("state") != "pending":
                # Copilot CLI の資格情報が残っていれば、デバイスフローを始めずにサインイン済みにする（AC-511。このアプリでの
                # サインアウトの後に再び操作したとき）。確かめるのは利用者の操作による起動だけ（AC-507 の例外）
                probed = copilot.probe(cs, check=True, ignore_signout=True)
                if probed["signedIn"]:
                    copilot.set_signed_out(False)
                    return send(200, {"ok": True, "state": "completed"})
            r = signin.start()
            return send(200 if r.get("ok") else (409 if r.get("result") in ("sdk_missing", "cli_unavailable") else 502), r)

        if route == ("POST", "copilot/signout"):
            # このアプリでのサインアウト（AC-511。Q-033）: 状態を保存するだけで、Copilot CLI の資格情報は消さず、
            # CLI のサインアウトも呼ばない。再起動後も保つ（保管先の copilotSignedOut）
            if cs.auth_method != "signin":
                return reply(409, False, "auth_method_mismatch")
            signin.cancel(internal=True)
            copilot.set_signed_out(True)
            copilot.reset()  # CLI のクライアントを止め、状態のキャッシュを捨てる（資格情報には触れない）
            return reply(200, True, "signed_out")

        if route == ("DELETE", "copilot"):
            store.delete(["copilotAuthMethod", "copilotModel", "copilotToken"])
            copilot.reset()
            if any(upper(n) for n in ("authMethod", "model", "token")):
                return reply(409, False, "env_managed")
            return reply(200, True, "deleted")

        # ("POST", "copilot"): {authMethod, model, token?}
        try:
            body = json.loads(raw.decode("utf-8")) if raw else None
        except ValueError:
            body = None
        if not isinstance(body, dict):
            return reply(400, False, "invalid", "body_format")
        am = body.get("authMethod", cs.auth_method)
        model = body.get("model", cs.model)
        has_token = "token" in body
        bad = store.check_copilot_auth_method(am) or store.check_copilot_model(model)
        if not bad and has_token:
            bad = store.check_copilot_token(body.get("token"))
            if not bad and am != "token":
                bad = "auth_method_mismatch"  # トークンは認証方式がトークンのときだけ保存できる
        if bad:
            return reply(400, False, "invalid", bad)
        model = model.strip()
        if (am != cs.auth_method and upper("authMethod")) or (has_token and upper("token")) or (model != cs.model and upper("model")):
            return reply(409, False, "env_managed")
        values = {}
        if not upper("authMethod"):
            values["copilotAuthMethod"] = am
        if has_token:
            values["copilotToken"] = body["token"]
        if not upper("model"):
            if model:
                values["copilotModel"] = model
            else:
                store.delete(["copilotModel"])  # 空 = SDK の既定のモデル
        store.save(values)
        copilot.reset()  # 認証方式・トークンが変わったら CLI を起動し直す
        return reply(200, True, "saved")

    def _llm_provider(self):
        """LLMのプロバイダーの選択の保存（FR-068 AC-514）。もう一方のプロバイダーの設定は消さない。
        環境変数・設定ファイルで指定されているときは 409（env_managed）。応答は秘密を含まない状態（GET /api/llm/status と同じ形）。"""
        raw = self._read_body()
        try:
            body = json.loads(raw.decode("utf-8")) if raw else None
        except ValueError:
            body = None

        def reply(status, ok, result, reason=None):
            s2, st = current_status(with_copilot=True)
            out = dict(st)
            out.pop("reason", None)
            out.update({"ok": ok, "result": result})
            if reason:
                out["reason"] = reason
            text = sec.redact(json.dumps(out, ensure_ascii=False),
                              up.secrets_of(s2) + copilot.secrets_of(cfg.load_copilot_settings()))
            self._send_json(status, text.encode("utf-8"))

        if not isinstance(body, dict):
            return reply(400, False, "invalid", "body_format")
        bad = store.check_provider(body.get("provider"))
        if bad:
            return reply(400, False, "invalid", bad)
        cs = cfg.load_copilot_settings()
        if cs.sources.get("provider") in ("env", "file") and cs.provider != body["provider"]:
            return reply(409, False, "env_managed")
        store.save({"provider": body["provider"]})
        return reply(200, True, "saved")

    def _speech(self):
        """Azure Speech（FR-082 / NFR-SEC-005）。応答はキー・トークンを含まない（念のため秘密を除いてから返す）。"""
        route = (self.command, self.path.split("?", 1)[0][len(SPEECH_PREFIX):])
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        if route == ("GET", "status"):
            status, payload = 200, speech.status_body(speech.load())
        elif route == ("POST", "settings"):
            raw = self._read_body()
            try:
                body = json.loads(raw.decode("utf-8")) if raw else None
            except ValueError:
                body = None
            status, payload = speech.save_settings(body)
        elif route == ("DELETE", "key"):
            status, payload = speech.delete_key()
        elif route == ("POST", "test"):
            self._read_body()
            status, payload = speech.connection_test()
        elif route == ("POST", "recognize"):
            n = self.headers.get("Content-Length") or "0"
            if not n.isdigit() or int(n) > speech.MAX_AUDIO_BYTES:
                return self._send_json(413, {"ok": False, "result": "invalid", "reason": "音声の大きさが不正です。"})
            audio = self.rfile.read(int(n))
            lang = dict(p.split("=", 1) for p in query.split("&") if "=" in p).get("language", "")
            status, payload = speech.recognize(lang, audio)
        else:
            return self._send_json(404 if self.command in ("GET", "HEAD") else 405,
                                   {"ok": False, "result": "not_found", "reason": "見つかりません。"})
        out = sec.redact(json.dumps(payload, ensure_ascii=False), speech.secrets())
        self._send_json(status, out.encode("utf-8"))

    def _relay(self):
        # プロバイダー: 要求の body の provider（foundry / copilot）か、中継サーバーの設定（既定 foundry。FR-068）
        cs = cfg.load_copilot_settings()
        raw = self._read_body()
        payload = None
        if raw is not None:
            try:
                payload = json.loads(raw.decode("utf-8"))
            except ValueError:
                payload = None
        provider = cs.provider
        if isinstance(payload, dict):
            asked = payload.pop("provider", None)
            if asked in cfg.PROVIDERS:
                provider = asked
        is_svg = self.path.split("?", 1)[0] == LLM_PREFIX + "svg"
        if provider == "copilot":
            return self._relay_copilot(cs, raw, payload, is_svg)
        settings, st = current_status()
        if st["state"] != "ready":
            return self._send_json(503, sec.error_body("not_ready", st["reason"], state=st["state"]))
        if raw is None:
            return self._send_json(413, sec.error_body("bad_request", "要求の大きさが不正です。"))
        if not isinstance(payload, dict):
            return self._send_json(400, sec.error_body("bad_request", "要求は JSON のオブジェクトにしてください。"))
        payload["model"] = settings.deployment
        payload.pop("stream", None)
        for extra in ("allowSvg", "key", "label"):  # アプリ内部の項目は上流へ送らない
            payload.pop(extra, None)
        try:
            status, body = up.post_responses(settings, json.dumps(payload).encode("utf-8"))
        except up.UpstreamError as e:
            return self._send_json(e.status, sec.error_body(e.code, e.message))
        secrets = up.secrets_of(settings)
        if status < 200 or status >= 300:
            return self._send_json(502, sec.error_body("upstream_error", "上流がエラーを返しました。", upstreamStatus=status))
        try:
            data = json.loads(sec.redact(body.decode("utf-8", "replace"), secrets))
        except ValueError:
            return self._send_json(502, sec.error_body("upstream_invalid", "上流の応答を解釈できません。"))
        self._send_clean(data, is_svg, secrets)

    def _send_clean(self, data, is_svg, secrets):
        """応答の検査とサニタイズ（NFR-SEC-004）。Foundry と GitHub Copilot で共通。"""
        # 応答の SVG をサニタイズしてから返す。整形後にもう一度、秘密を除く
        clean = sec.sanitize_json(data)
        if is_svg and isinstance(clean, dict):  # 方式2: 応答から SVG を取り出し、サニタイズ済みのものを svg に置く（なければ空文字）
            clean["svg"] = sec.extract_svg(clean.get("svg") if isinstance(clean.get("svg"), str) and clean["svg"] else clean)
        out = sec.redact(json.dumps(clean, ensure_ascii=False), secrets)
        self._send_json(200, out.encode("utf-8"))

    def _relay_copilot(self, cs, raw, payload, is_svg):
        """GitHub Copilot SDK を介した呼び出し（FR-087 AC-503〜AC-505）。Foundry へは送らない。
        送るのは画面から来た instructions（システムメッセージ）と input（送信内容。NFR-PRIV-003）だけ。"""
        secrets = copilot.secrets_of(cs) + up.secrets_of(cfg.load_settings())

        def fail(status, code, message, **extra):
            return self._send_json(status, sec.redact(sec.error_body(code, message, **extra).decode("utf-8"), secrets).encode("utf-8"))

        if raw is None:
            return fail(413, "bad_request", "要求の大きさが不正です。")
        if not isinstance(payload, dict):
            return fail(400, "bad_request", "要求は JSON のオブジェクトにしてください。")
        prompt, instructions = payload.get("input"), payload.get("instructions")
        if not isinstance(prompt, str) or (instructions is not None and not isinstance(instructions, str)):
            return fail(400, "bad_request", "要求の形式が不正です。")
        probed = copilot.probe(cs)
        missing = copilot.readiness(cs, probed)
        if missing:  # 未導入・未サインイン・トークン未設定では送らない（AC-505・AC-506）
            code = {"sdk": probed["unavailableReason"] or "sdk_missing", "signin": "not_signed_in",
                    "token": "token_missing"}[missing[0]]
            return fail(503, code, "GitHub Copilot を利用できません。", state="unconfigured", missing=missing)
        try:
            text = copilot.generate(cs, instructions, prompt)
        except up.UpstreamError as e:
            return fail(e.status, e.code, e.message)
        self._send_clean(copilot.as_responses(sec.redact(text, secrets)), is_svg, secrets)


class RelayServer(ThreadingHTTPServer):
    daemon_threads = True
    # Windows の SO_REUSEADDR は使用中のポートにも bind できてしまうため、そこでは使わない
    allow_reuse_address = (os.name != "nt")

    def handle_error(self, request, client_address):
        # ブラウザー側が接続を切った（中断・リセット）場合はトレースバックを出さない
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionError, TimeoutError)):
            return
        sys.stderr.write("relay error\n")


def make_server(port, web_dir):
    """127.0.0.1 の port に bind して待ち受ける（port=0 は OS が割り当てる）。
    Host・Origin の検査は server_address の実ポートで行うため、bind が済んでから要求を受け付ける。"""
    handler = partial(RelayHandler, directory=web_dir)
    server = RelayServer((BIND_ADDRESS, port), handler, bind_and_activate=False)
    try:
        server.server_bind()
        server.server_activate()
    except BaseException:
        server.server_close()
        raise
    return server


DEFAULT_PORT = 8080
LAST_PORT_NAME = os.path.join(".graphic-recording-panel", "last-port")


def _home_dir():
    return os.environ.get("HOME") or os.environ.get("USERPROFILE") or os.path.expanduser("~")


def last_port_path():
    return os.path.join(_home_dir(), LAST_PORT_NAME)


def read_last_port():
    """前回のポート。ない・読めない・1〜65535 の整数でないときは None（未保存）。"""
    try:
        with open(last_port_path(), "r", encoding="utf-8") as f:
            text = f.read().strip()
    except (OSError, ValueError):
        return None
    if not re.fullmatch(r"[0-9]{1,5}", text):
        return None
    n = int(text)
    return n if 1 <= n <= 65535 else None


def write_last_port(port):
    """失敗しても起動は続ける。"""
    try:
        path = last_port_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write("%d\n" % port)
    except (OSError, ValueError):
        pass


def parse_port(text):
    """--port の値を検査する。1〜65535 は指定ポート、0 は自動選択。不正なら ValueError。"""
    if not re.fullmatch(r"[0-9]+", text or "") or int(text) > 65535:
        raise ValueError("--port は 0〜65535 の整数で指定してください（指定値: %r）。" % (text,))
    return int(text)


def start_server(port, web_dir):
    """(server, 前回のポートと別のポートで起動したか) を返す。指定ポートが使えなければ OSError。"""
    if port != 0:
        return make_server(port, web_dir), False
    first = read_last_port() or DEFAULT_PORT
    try:
        return make_server(first, web_dir), False
    except OSError:
        return make_server(0, web_dir), True


def main(argv=None):
    ap = argparse.ArgumentParser(description="ローカル中継サーバー（127.0.0.1 のみ）")
    ap.add_argument("--port", default="0",
                    help="待ち受けるポート（1〜65535）。省略または 0 で前回のポート（なければ 8080）、使用中なら空いているポートを自動選択")
    ap.add_argument("--web", default=os.path.join(cfg.ROOT, "web"))
    args = ap.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):  # 案内の日本語を端末の既定コードページに依らず UTF-8 で出す
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    try:
        want = parse_port(args.port)
    except ValueError as e:
        sys.stderr.write(str(e) + "\n")
        return 2
    try:
        server, moved = start_server(want, os.path.abspath(args.web))
    except OSError as e:
        sys.stderr.write("ポート %d で待ち受けられません（使用中の可能性があります）: %s\n"
                         "別のポートを指定するか、--port を省略して自動選択にしてください。\n" % (want, e))
        return 1
    port = server.server_address[1]
    if want == 0:
        write_last_port(port)
    print("http://127.0.0.1:%d/" % port)
    if moved:
        print("ポートが変わったため、前回までのブラウザ内の保存データ（セッション・レイアウト・LLM 利用の同意）は"
              "この URL では引き継がれません。固定したいときは --port N を指定してください。")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        copilot.shutdown()  # 起動していれば Copilot CLI を止める
        signin.reset()  # 進行中のサインイン（copilot login）を止める
    return 0


if __name__ == "__main__":
    sys.exit(main())
