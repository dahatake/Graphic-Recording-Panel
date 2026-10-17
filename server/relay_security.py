"""中継サーバーの入口の検証・応答の無害化（FR-066 / NFR-SEC-003）。標準ライブラリだけ。"""
import json
import re

SVG_NS = "http://www.w3.org/2000/svg"
_SVG_FRAGMENT = re.compile(r"<svg\b.*?</svg\s*>", re.IGNORECASE | re.DOTALL)
REDACTED = "[redacted]"


def allowed_hosts(port):
    return ("127.0.0.1:%d" % port, "localhost:%d" % port)


def allowed_origins(port):
    return ("http://127.0.0.1:%d" % port, "http://localhost:%d" % port)


def host_ok(host_header, port):
    return (host_header or "").lower() in allowed_hosts(port)


def origin_ok(origin_header, port, required):
    """Origin が同一オリジンか。required のとき、Origin がなければ不可。"""
    if origin_header is None:
        return not required
    return origin_header.lower() in allowed_origins(port)


def redact(text, secrets):
    for s in secrets:
        if s and len(s) >= 4:
            text = text.replace(s, REDACTED)
    return text


# ---- NFR-SEC-004 許可リスト方式のサニタイズ（web/src/svgsanitize.js と同じ規則。parts.js の OK_TAGS・OK_ATTRS と同一）----
OK_TAGS = {"svg", "g", "title", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "text", "tspan"}
OK_ATTRS = {"xmlns", "viewBox", "width", "height", "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2", "d",
            "points", "transform", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
            "stroke-opacity", "fill-opacity", "stroke-dasharray", "opacity", "data-part-key", "data-expression",
            "data-character", "role", "aria-label", "aria-hidden", "font-size", "font-weight", "text-anchor",
            "font-family"}
_TEXT_TAGS = {"text", "tspan", "title"}
_MAX_DEPTH = 32
_TAG_RE = re.compile(r"""<(/?)([A-Za-z][A-Za-z0-9:_.-]*)((?:\s+[^\s"'=<>/]+(?:\s*=\s*(?:"[^"<]*"|'[^'<]*'))?)*)\s*(/?)>""")
_ATTR_RE = re.compile(r"""\s+([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"<]*)"|'([^'<]*)'))?""")
_NAMED = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'"}
_BAD_VALUE = re.compile(r"javascript:|vbscript:|data:|url\(|@import|https?:|//|expression\(|<script|&#")


def _decode(s):
    """5 つの名前つき参照だけ復号する。ほかの参照（数値参照を含む）があれば None。"""
    bad = []

    def rep(m):
        name = m.group(1)
        if m.group(0).endswith(";") and name in _NAMED:
            return _NAMED[name]
        bad.append(1)
        return m.group(0)
    out = re.sub(r"&([^;&\s]*);?", rep, s)
    return None if bad else out


def _esc_text(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _esc_attr(s):
    return _esc_text(s).replace('"', "&quot;")


def _compact(s):
    return re.sub(r"[\s\x00-\x1f\x7f]+", "", s).lower()


def _clean_attrs(raw, is_root):
    attrs, seen = [], set()
    for m in _ATTR_RE.finditer(raw):
        name = m.group(1)
        val = m.group(2) if m.group(2) is not None else m.group(3)
        if name not in OK_ATTRS or name in seen or val is None:
            continue
        v = _decode(val)
        if v is None or _BAD_VALUE.search(_compact(v)):
            continue
        if name == "xmlns" and (v != SVG_NS or not is_root):
            continue
        seen.add(name)
        attrs.append((name, v))
    return attrs


def _serialize(el):
    if isinstance(el, str):
        return _esc_text(el)
    a = "".join(' %s="%s"' % (n, _esc_attr(v)) for n, v in el["attrs"])
    if el["kids"]:
        return "<%s%s>%s</%s>" % (el["tag"], a, "".join(_serialize(k) for k in el["kids"]), el["tag"])
    return "<%s%s/>" % (el["tag"], a)


def sanitize_svg(svg_text):
    """SVG 断片を許可リストで無害化する。許可リストにない要素（子ごと）・属性を除き、解析できないものは空文字にする。"""
    if not isinstance(svg_text, str) or not svg_text.strip() or re.search(r"<[!?]", svg_text):
        return ""
    s = svg_text.strip()
    root = {"tag": None, "attrs": [], "kids": []}
    stack = [root]
    skip = 0
    saw_root = False
    i = 0
    while i < len(s):
        if s[i] != "<":
            j = s.find("<", i)
            j = len(s) if j < 0 else j
            text, i = s[i:j], j
            top = stack[-1]
            if skip:
                continue
            if top["tag"] is None:
                if text.strip():
                    return ""
                continue
            if top["tag"] not in _TEXT_TAGS:
                continue
            d = _decode(text)
            if d is not None and not _BAD_VALUE.search(_compact(d)):
                top["kids"].append(d)
            continue
        m = _TAG_RE.match(s, i)
        if not m:
            return ""
        i = m.end()
        close, tag, raw_attrs, self_close = m.groups()
        if close:
            if raw_attrs.strip() or self_close:
                return ""
            if skip:
                skip -= 1
                continue
            top = stack[-1]
            if top["tag"] is None or top["tag"] != tag:
                return ""
            stack.pop()
            continue
        if skip:
            if not self_close:
                skip += 1
            continue
        parent = stack[-1]
        if parent["tag"] is None and (saw_root or tag != "svg"):
            return ""
        if tag not in OK_TAGS or (tag == "svg" and parent["tag"] is not None):
            if not self_close:
                skip += 1
            continue
        if len(stack) > _MAX_DEPTH:
            return ""
        el = {"tag": tag, "attrs": _clean_attrs(raw_attrs, parent["tag"] is None), "kids": []}
        parent["kids"].append(el)
        if parent["tag"] is None:
            saw_root = True
        if not self_close:
            stack.append(el)
    if len(stack) != 1 or skip or not saw_root:
        return ""
    svg = root["kids"][0]
    svg["attrs"] = [("xmlns", SVG_NS)] + [a for a in svg["attrs"] if a[0] != "xmlns"]
    return _serialize(svg)


def extract_svg(value):
    """応答（JSON の値）の中から最初の SVG 断片を探し、サニタイズして返す。なければ空文字。"""
    if isinstance(value, str):
        m = _SVG_FRAGMENT.search(value)
        return sanitize_svg(m.group(0)) if m else ""
    items = value if isinstance(value, list) else list(value.values()) if isinstance(value, dict) else []
    for v in items:
        r = extract_svg(v)
        if r:
            return r
    return ""


def sanitize_text(text):
    if "<svg" not in text.lower():
        return text
    return _SVG_FRAGMENT.sub(lambda m: sanitize_svg(m.group(0)), text)


def sanitize_json(value):
    """JSON の値の中の文字列にある SVG を再帰的に無害化する。"""
    if isinstance(value, str):
        return sanitize_text(value)
    if isinstance(value, list):
        return [sanitize_json(v) for v in value]
    if isinstance(value, dict):
        return {k: sanitize_json(v) for k, v in value.items()}
    return value


def error_body(code, message, **extra):
    body = {"error": {"code": code, "message": message}}
    body["error"].update(extra)
    return json.dumps(body, ensure_ascii=False).encode("utf-8")
