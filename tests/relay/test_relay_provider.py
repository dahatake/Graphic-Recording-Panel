"""FR-068 AC-514 LLMのプロバイダーの選択の保存（POST /api/llm/provider）の中継サーバー側。

GitHub Copilot SDK は sys.modules に置いたスタブ（test_relay_copilot.py と同じもの）だけを使い、GitHub・Copilot CLI・Foundry へは通信しない。
Foundry はループバックの上流モックで要求の件数だけを数える。テスト用のダミーの値だけを使う。
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "server"))

import relay_config as cfg  # noqa: E402
import relay_llmstore as store  # noqa: E402
from test_relay_copilot import (  # noqa: E402,F401 （fixture を共有する）
    DUMMY_FOUNDRY_KEY, DUMMY_TOKEN, EXTRACT, env, foundry, sdk, srv,
)


# FR-068 AC-514: 既定は Microsoft Foundry。画面で選んだプロバイダーは中継サーバーに保存され、再起動（読み直し）後も保たれる
def test_fr068_ac514_provider_saved_and_kept(sdk, foundry, srv):
    assert srv.call("GET", "/api/llm/status")[1]["provider"] == "foundry"
    assert srv.call("GET", "/api/llm/provider")[1] == {"provider": "foundry"}
    status, body, raw = srv.call("POST", "/api/llm/provider", {"provider": "copilot"})
    assert status == 200 and body["ok"] is True and body["result"] == "saved"
    assert body["provider"] == "copilot" and body["providerSource"] == "ui"
    assert "copilot" in body and DUMMY_FOUNDRY_KEY not in raw
    assert cfg.load_copilot_settings().provider == "copilot", "保存先から読み直しても保たれる"
    assert srv.call("GET", "/api/llm/status")[1]["provider"] == "copilot"
    assert srv.call("POST", "/api/llm/provider", {"provider": "foundry"})[1]["provider"] == "foundry"


# FR-068 AC-514: 選択を変えても、もう一方のプロバイダーの設定（Foundry の接続設定・GitHub Copilot の認証設定）は消えない
def test_fr068_ac514_switch_keeps_other_settings(sdk, srv):
    store.save({"endpoint": "https://foundry-dummy.example.test/openai/v1", "deployment": "dummy-deploy", "authMethod": "apiKey",
                "apiKey": DUMMY_FOUNDRY_KEY, "copilotAuthMethod": "token", "copilotToken": DUMMY_TOKEN, "copilotModel": "dummy-model"})
    for p in ("copilot", "foundry", "copilot"):
        status, body, raw = srv.call("POST", "/api/llm/provider", {"provider": p})
        assert status == 200 and body["provider"] == p
        assert DUMMY_FOUNDRY_KEY not in raw and DUMMY_TOKEN not in raw, "応答に秘密を含まない"
    saved = store.load()
    assert (saved["apiKey"], saved["endpoint"], saved["deployment"]) == (DUMMY_FOUNDRY_KEY, "https://foundry-dummy.example.test/openai/v1", "dummy-deploy")
    assert (saved["copilotAuthMethod"], saved["copilotToken"], saved["copilotModel"]) == ("token", DUMMY_TOKEN, "dummy-model")


# FR-068 AC-514: 選んだプロバイダーへ LLM 向けの要求（接続テストを含む）が送られる
def test_fr068_ac514_requests_go_to_selected_provider(sdk, foundry, srv):
    assert srv.call("POST", "/api/llm/responses", {"input": "ping"})[0] == 200
    assert foundry.hits == 1 and sdk.sent == []
    srv.call("POST", "/api/llm/provider", {"provider": "copilot"})
    assert srv.call("POST", "/api/llm/responses", {"input": "ping"})[0] == 200
    assert foundry.hits == 1 and len(sdk.sent) == 1


# FR-068 AC-514 異常系: 不正な値・形式は 400 で保存しない
@pytest.mark.parametrize("body", [{"provider": "openai"}, {"provider": ""}, {"provider": None}, {}, ["copilot"]])
def test_fr068_ac514_invalid_provider_rejected(sdk, srv, body):
    status, payload, _ = srv.call("POST", "/api/llm/provider", body)
    assert status == 400 and payload["ok"] is False and payload["result"] == "invalid"
    assert store.load()["provider"] is None and cfg.load_copilot_settings().provider == "foundry"


# FR-068 AC-514 異常系: 環境変数でプロバイダーを指定しているときは画面から変えられない（409）
def test_fr068_ac514_env_managed_provider(sdk, srv, monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "copilot")
    status, payload, _ = srv.call("POST", "/api/llm/provider", {"provider": "foundry"})
    assert status == 409 and payload["result"] == "env_managed" and payload["provider"] == "copilot"
    assert store.load()["provider"] is None


# FR-068 AC-514 異常系: Origin のない変更の要求は 403（NFR-SEC-003 と同じ入口の検証）
def test_fr068_ac514_requires_origin(sdk, srv):
    import http.client
    import json
    c = http.client.HTTPConnection("127.0.0.1", srv.port, timeout=20)
    c.request("POST", "/api/llm/provider", body=json.dumps({"provider": "copilot"}).encode(),
              headers={"Host": "127.0.0.1:%d" % srv.port, "Content-Type": "application/json"})
    r = c.getresponse()
    r.read()
    c.close()
    assert r.status == 403 and store.load()["provider"] is None
