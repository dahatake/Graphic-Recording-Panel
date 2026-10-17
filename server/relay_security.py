"""中継サーバーの入口の検証・応答の無害化（FR-066 / NFR-SEC-003）。標準ライブラリだけ。"""
import json
import re
import xml.etree.ElementTree as ET

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
_DROP_TAGS = {"script", "foreignobject", "iframe", "object", "embed", "style", "animate", "set",
              "animatetransform", "animatemotion", "handler", "listener", "image", "a"}
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


def _local(tag):
    return tag.rsplit("}", 1)[-1].lower() if isinstance(tag, str) else ""


def _clean_element(el):
    for child in list(el):
        if _local(child.tag) in _DROP_TAGS:
            el.remove(child)
        else:
            _clean_element(child)
    for name in list(el.attrib):
        local = _local(name)
        value = el.attrib[name].strip().lower()
        if local.startswith("on"):
            del el.attrib[name]
        elif local == "href" and not value.startswith("#"):
            del el.attrib[name]
        elif local == "style" and re.search(r"url\(|expression|javascript:|@import", value):
            del el.attrib[name]
        elif "javascript:" in value or "data:text/html" in value:
            del el.attrib[name]


def sanitize_svg(svg_text):
    """SVG 断片を無害化する。解析できないものは空文字にする（そのまま通さない）。"""
    if re.search(r"<!DOCTYPE|<!ENTITY", svg_text, re.IGNORECASE):
        return ""
    ET.register_namespace("", SVG_NS)
    ET.register_namespace("xlink", XLINK_NS)
    try:
        root = ET.fromstring(svg_text)
    except ET.ParseError:
        return ""
    if _local(root.tag) != "svg":
        return ""
    _clean_element(root)
    return ET.tostring(root, encoding="unicode")


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
