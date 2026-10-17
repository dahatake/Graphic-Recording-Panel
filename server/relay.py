"""ローカル中継サーバー（FR-066 / NFR-SEC-003）。標準ライブラリだけ。

  python server/relay.py --port 8080 --web web

- 127.0.0.1 だけで待ち受ける。静的ファイルの配信と LLM の中継を同じオリジンで行う。
- Host・Origin が自分自身（127.0.0.1 / localhost の自分のポート）でない要求は 403。
- API キー・トークンはこのプロセスだけが持ち、応答・ログには出さない。
- 構成: relay_config（設定）・relay_security（入口の検証と応答の無害化）・relay_upstream（上流）。
"""
import argparse
import importlib
import json
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 同じフォルダーの自前モジュール（外部パッケージではない）。構成を分けて後続の項目で拡張しやすくする
cfg = importlib.import_module("relay_config")
sec = importlib.import_module("relay_security")
up = importlib.import_module("relay_upstream")

BIND_ADDRESS = "127.0.0.1"
MAX_REQUEST_BYTES = 1024 * 1024
LLM_PREFIX = "/api/llm/"


def current_status():
    """LLM 連携の状態（秘密を含まない）。state は unconfigured / ready / error。"""
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
        self._send_json(403, sec.error_body("forbidden", "この要求は許可されていません。"))

    def _guard(self, is_llm):
        """Host（全要求）と Origin（LLM 向けの POST は必須）を検証する。通らなければ 403 を返して False。"""
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
    def do_GET(self):
        is_llm = self.path.startswith(LLM_PREFIX)
        if not self._guard(is_llm):
            return
        if is_llm:
            if self.path.split("?", 1)[0] == LLM_PREFIX + "status":
                _, st = current_status()
                return self._send_json(200, st)
            return self._send_json(404, sec.error_body("not_found", "見つかりません。"))
        SimpleHTTPRequestHandler.do_GET(self)

    def do_HEAD(self):
        is_llm = self.path.startswith(LLM_PREFIX)
        if not self._guard(is_llm):
            return
        if is_llm:
            return self._send_json(404, sec.error_body("not_found", "見つかりません。"))
        SimpleHTTPRequestHandler.do_HEAD(self)

    def do_POST(self):
        is_llm = self.path.startswith(LLM_PREFIX)
        if not self._guard(is_llm):
            return
        if self.command == "POST" and self.path.split("?", 1)[0] == LLM_PREFIX + "responses":
            return self._relay()
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

    def _relay(self):
        settings, st = current_status()
        if st["state"] != "ready":
            return self._send_json(503, sec.error_body("not_ready", st["reason"], state=st["state"]))
        raw = self._read_body()
        if raw is None:
            return self._send_json(413, sec.error_body("bad_request", "要求の大きさが不正です。"))
        try:
            payload = json.loads(raw.decode("utf-8"))
        except ValueError:
            payload = None
        if not isinstance(payload, dict):
            return self._send_json(400, sec.error_body("bad_request", "要求は JSON のオブジェクトにしてください。"))
        payload["model"] = settings.deployment
        payload.pop("stream", None)
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
        # 応答の SVG をサニタイズしてから返す。整形後にもう一度、秘密を除く
        out = sec.redact(json.dumps(sec.sanitize_json(data), ensure_ascii=False), secrets)
        self._send_json(200, out.encode("utf-8"))


def make_server(port, web_dir):
    handler = partial(RelayHandler, directory=web_dir)
    return ThreadingHTTPServer((BIND_ADDRESS, port), handler)


def main(argv=None):
    ap = argparse.ArgumentParser(description="ローカル中継サーバー（127.0.0.1 のみ）")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--web", default=os.path.join(cfg.ROOT, "web"))
    args = ap.parse_args(argv)
    server = make_server(args.port, os.path.abspath(args.web))
    sys.stderr.write("Serving on http://localhost:%d/ (127.0.0.1 only)\n" % args.port)
    sys.stderr.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
