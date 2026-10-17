"""LLM 設定の例ファイルと git 管理外の確認（FR-067）。"""
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "server"))

import relay_config as cfg  # noqa: E402

ROOT = cfg.ROOT


# FR-067 AC-351
def test_example_has_all_fields_without_secrets():
    p = os.path.join(ROOT, "config", "llm.example.json")
    text = open(p, encoding="utf-8").read()
    j = json.loads(text)
    for k in ("endpoint", "deployment", "authMethod", "apiKey"):
        assert k in j
    assert "<your-resource>" in j["endpoint"]
    assert not re.search(r"sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}|\b[0-9a-f]{32}\b", text)
    assert j["apiKey"].startswith("<")


# FR-067 AC-352
def test_local_config_is_gitignored_and_untracked():
    r = subprocess.run(["git", "check-ignore", "-q", "config/llm.local.json"], cwd=ROOT)
    assert r.returncode == 0
    out = subprocess.run(["git", "ls-files", "config/llm.local.json"], cwd=ROOT,
                         capture_output=True, text=True).stdout
    assert out.strip() == ""


# FR-067 AC-349
def test_env_overrides_config_file(tmp_path, monkeypatch):
    f = tmp_path / "llm.local.json"
    f.write_text(json.dumps({"endpoint": "https://a.example.com/v1", "deployment": "file-d",
                             "authMethod": "entra"}), encoding="utf-8")
    monkeypatch.setenv("LLM_CONFIG_PATH", str(f))
    monkeypatch.setenv("LLM_DEPLOYMENT", "env-d")
    monkeypatch.delenv("LLM_ENDPOINT", raising=False)
    monkeypatch.delenv("LLM_AUTH_METHOD", raising=False)
    s = cfg.load_settings()
    assert s.deployment == "env-d" and s.endpoint == "https://a.example.com/v1"
    assert s.auth_method == "entra"
