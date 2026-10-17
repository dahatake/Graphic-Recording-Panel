"""中継サーバーの単体テスト（FR-066 / NFR-SEC-003）。上流には通信しない。"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "server"))

import relay_config as cfg  # noqa: E402
import relay_security as sec  # noqa: E402


# FR-066 AC-344
def test_host_and_origin_same_origin_only():
    assert sec.host_ok("127.0.0.1:8080", 8080)
    assert sec.host_ok("localhost:8080", 8080)
    assert not sec.host_ok("evil.example", 8080)
    assert not sec.host_ok("127.0.0.1:9999", 8080)
    assert not sec.host_ok(None, 8080)
    assert sec.origin_ok("http://localhost:8080", 8080, required=True)
    assert not sec.origin_ok("http://evil.example", 8080, required=True)
    assert not sec.origin_ok(None, 8080, required=True)
    assert sec.origin_ok(None, 8080, required=False)


# FR-066 AC-343 FR-066 AC-345
def test_server_binds_loopback_only():
    src = open(os.path.join(os.path.dirname(__file__), "..", "..", "server", "relay.py"), encoding="utf-8").read()
    assert 'BIND_ADDRESS = "127.0.0.1"' in src
    assert "0.0.0.0" not in src


# FR-066 AC-344 応答の SVG のサニタイズ
def test_sanitize_svg_removes_active_content():
    dirty = ('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>alert(1)</script>'
             '<foreignObject><div/></foreignObject><a href="javascript:x()"><circle r="1" onclick="y()"/></a>'
             '<rect style="fill:url(http://e/x)" width="2"/><use href="http://e/s.svg#a"/></svg>')
    clean = sec.sanitize_text("前 " + dirty + " 後")
    low = clean.lower()
    for bad in ("script", "foreignobject", "onload", "onclick", "javascript:", "http://e/"):
        assert bad not in low
    assert clean.startswith("前 ") and clean.endswith(" 後")


def test_sanitize_json_walks_nested_values_and_drops_unparsable_svg():
    data = {"output": [{"t": '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'}, "<svg><b></svg>", 3]}
    out = sec.sanitize_json(data)
    assert "script" not in str(out)
    assert out["output"][1] == ""
    assert out["output"][2] == 3


def test_sanitize_svg_rejects_entities():
    assert sec.sanitize_svg('<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>') == ""


NS = 'xmlns="http://www.w3.org/2000/svg"'
EVIL = [
    '<svg %s><script>alert(1)</script><circle r="1"/></svg>' % NS,
    '<svg %s><SCRIPT>alert(1)</SCRIPT><circle r="1"/></svg>' % NS,
    '<svg %s><foreignObject><div onclick="x()"/></foreignObject></svg>' % NS,
    '<svg %s onload="x()"><circle r="1" onclick="y()" ONMOUSEOVER="z()"/></svg>' % NS,
    '<svg %s><a href="javascript:alert(1)"><circle r="1"/></a></svg>' % NS,
    '<svg %s><image href="http://e.example/x.png"/><image href="//e.example/x.png"/></svg>' % NS,
    '<svg %s><rect width="1" fill="url(http://e.example/x)" style="fill:url(//e.example)"/></svg>' % NS,
    '<svg %s><style>@import url(http://e.example/a.css);</style><circle r="1"/></svg>' % NS,
    '<svg %s><circle r="1" fill="&#106;avascript:alert(1)"/></svg>' % NS,
    '<svg %s><scr<script>ipt>alert(1)</scr</script>ipt><circle r="1"/></svg>' % NS,
    '<svg %s><use href="http://e.example/s.svg#a"/></svg>' % NS,
]


# NFR-SEC-004 AC-335 AC-336 許可リスト方式: 禁止項目が 0 件、解析できない入力は拒否
def test_sanitize_svg_allowlist_leaves_no_forbidden_items():
    import re
    forbidden = re.compile(r"<script|foreignobject|\son\w+\s*=|javascript:|https?:|//|url\(|@import|<image|<style|<use|<a[\s>]", re.I)
    for dirty in EVIL:
        out = sec.sanitize_svg(dirty).replace(NS, "")
        assert not forbidden.search(out), (dirty, out)
    for bad in ["", "abc", "<svg", "<svg %s><circle></svg>" % NS, "<?xml version='1.0'?><svg %s/>" % NS, "<div/>"]:
        assert sec.sanitize_svg(bad) == ""


# NFR-SEC-004 AC-338 正当な SVG はそのまま（意味を変えず）、2 回かけても変わらない
def test_sanitize_svg_is_idempotent_and_keeps_valid_svg():
    ok = '<svg %s viewBox="0 0 48 48" width="48" height="48"><g data-part-key="k"><title>t</title><circle cx="5" cy="5" r="4" fill="#c00"/></g></svg>' % NS
    once = sec.sanitize_svg(ok)
    assert once == ok
    assert sec.sanitize_svg(once) == once
    dirty_once = sec.sanitize_svg(EVIL[3])
    assert sec.sanitize_svg(dirty_once) == dirty_once


# FR-065 AC-332 NFR-SEC-004 AC-337 応答から SVG を取り出し、サニタイズして返す
def test_extract_svg_finds_and_sanitizes():
    body = {"output": [{"content": [{"text": '前 <svg %s onload="x()"><script/><circle r="1"/></svg> 後' % NS}]}]}
    svg = sec.extract_svg(sec.sanitize_json(body))
    assert svg.startswith("<svg") and "onload" not in svg and "script" not in svg
    assert sec.extract_svg({"a": "no svg"}) == ""


# NFR-SEC-003 AC-342
def test_redact_removes_secret_values():
    assert "SECRETVALUE" not in sec.redact('{"echo":"SECRETVALUE"}', ["SECRETVALUE"])


# FR-066 AC-347 / FR-067 AC-363 AC-364 のうち中継側の検証
@pytest.mark.parametrize("ep", [
    "http://example.com/openai/v1", "https://localhost/openai/v1", "https://127.0.0.1/openai/v1",
    "https://10.0.0.5/openai/v1", "https://169.254.169.254/x", "https://[::1]/x", "ftp://a/b", "https:///x",
])
def test_endpoint_rejects_internal_and_non_https(ep):
    assert cfg.validate_endpoint(ep, False)
    assert cfg.validate_endpoint(ep, False) != ""


def test_endpoint_public_https_ok_and_loopback_flag_is_narrow():
    assert cfg.validate_endpoint("https://res.services.ai.azure.com/openai/v1", False) is None
    assert cfg.validate_endpoint("http://127.0.0.1:9/openai/v1", False)
    assert cfg.validate_endpoint("http://127.0.0.1:9/openai/v1", True) is None
    assert cfg.validate_endpoint("http://example.com/openai/v1", True)
    assert cfg.validate_endpoint("https://10.0.0.5/openai/v1", True)


# FR-066 AC-345 設定なしでも読める / FR-067 AC-349 環境変数が優先
def test_load_settings_env_over_file_and_repr_hides_secret(tmp_path, monkeypatch):
    f = tmp_path / "llm.local.json"
    f.write_text('{"endpoint":"https://a/openai/v1","deployment":"d-file","apiKey":"KEYFILE1234"}', encoding="utf-8")
    for k in ("LLM_ENDPOINT", "LLM_DEPLOYMENT", "LLM_AUTH_METHOD", "LLM_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("LLM_CONFIG_PATH", str(f))
    monkeypatch.setenv("LLM_DEPLOYMENT", "d-env")
    s = cfg.load_settings()
    assert s.deployment == "d-env" and s.endpoint == "https://a/openai/v1" and s.api_key == "KEYFILE1234"
    assert "KEYFILE1234" not in repr(s)
    monkeypatch.setenv("LLM_CONFIG_PATH", str(tmp_path / "none.json"))
    for k in ("LLM_DEPLOYMENT",):
        monkeypatch.delenv(k)
    assert cfg.load_settings().endpoint is None


# FR-066 AC-346 既定の上限
def test_default_limits(monkeypatch):
    monkeypatch.delenv("RELAY_TIMEOUT_SEC", raising=False)
    monkeypatch.delenv("RELAY_MAX_BYTES", raising=False)
    assert cfg.timeout_sec() == 30 and cfg.max_bytes() == 262144
