"""G-5 denial diagnostics in scripts/hooks/gate.py must be read-only and must never change a verdict."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import time
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "hooks" / "gate.py"
SPEC = importlib.util.spec_from_file_location("gate_under_test", SCRIPT)
assert SPEC and SPEC.loader
gate = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = gate
SPEC.loader.exec_module(gate)


def _git_init(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", str(p)], check=True)


def _make_ctx(tmp_path: Path, sid: str = "S1"):
    root = tmp_path / "repo"
    _git_init(root)
    return root, gate.Ctx({"cwd": str(root), "sessionId": sid})


def _sibling(root: Path, status: str, owner: str) -> Path:
    """A fake run worktree <repo>-run-x with a meta.json (.git is a file, like a real worktree)."""
    sib = root.parent / f"{root.name}-run-x"
    sib.mkdir()
    (sib / ".git").write_text("gitdir: nowhere\n")
    ctx_cfg = gate.h.load_config(root)
    meta_dir = gate.h.work_dir(sib, ctx_cfg) / "runs" / "r1"
    meta_dir.mkdir(parents=True)
    (meta_dir / "meta.json").write_text(json.dumps({"status": status, "session_id": owner}))
    state = gate.h.work_dir(sib, ctx_cfg) / ".ebak"
    state.mkdir(parents=True, exist_ok=True)
    (state / "current-run").write_text("r1")
    return sib


def test_diag_without_sibling_and_agents(tmp_path):
    root, ctx = _make_ctx(tmp_path)
    s = gate.deny_diag(ctx, tmp_path / "elsewhere" / "f.txt")
    assert s.startswith(" | diag: ")
    assert "sid=S1" in s and "parent_resolved=False" in s
    assert "sibling=none" in s and "=none n=0" in s
    assert f"root={ctx.root}" in s and f"cwd={ctx.cwd}" in s and "croot=" in s


def test_diag_sibling_owner_mismatch_and_match(tmp_path, monkeypatch):
    root, ctx = _make_ctx(tmp_path)
    sib = _sibling(root, "active", "OTHER")
    monkeypatch.setattr(gate.h, "current_run", lambda tree, cfg: "r1" if Path(tree) == sib else "")
    monkeypatch.setattr(gate.h, "load_meta", lambda tree, cfg, rid: json.loads(
        (gate.h.work_dir(Path(tree), cfg) / "runs" / rid / "meta.json").read_text()))
    target = sib / "a.txt"
    s = gate.deny_diag(ctx, target)
    assert "sibling=repo-run-x" in s and "status=active" in s and "meta_session=OTHER" in s
    assert "owner_eq_sid=False" in s and "owned_by_other=True" in s and "authorized=False" in s
    # the diag recomputation agrees with the real predicates (and does not change them)
    assert ctx.sibling_owned_by_other(sib) is True and ctx.sibling_authorized(sib) is False
    (gate.h.work_dir(sib, ctx.cfg) / "runs" / "r1" / "meta.json").write_text(
        json.dumps({"status": "active", "session_id": "S1"}))
    s = gate.deny_diag(ctx, target)
    assert "owner_eq_sid=True" in s and "owned_by_other=False" in s and "authorized=True" in s
    assert ctx.sibling_owned_by_other(sib) is False and ctx.sibling_authorized(sib) is True


def test_diag_active_agents_found_and_missing(tmp_path):
    root, ctx = _make_ctx(tmp_path, sid="AG1")
    path = ctx.agents_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([{"agent_id": "AG1", "parent": "P1", "t": time.time() - 30}]))
    s = gate.deny_diag(ctx, tmp_path / "x.txt")
    assert "=found parent=P1 age_s=" in s
    path.write_text(json.dumps([{"agent_id": "ZZ", "parent": "P1", "t": time.time()}]))
    assert "=none n=1" in gate.deny_diag(ctx, tmp_path / "x.txt")


def test_diag_exception_is_swallowed_and_verdicts_unchanged(tmp_path, monkeypatch):
    root, ctx = _make_ctx(tmp_path)
    inside = root / "docs" / "a.md"
    outside = tmp_path / "elsewhere" / "f.txt"
    before = {
        "in": (gate.classify(ctx, str(inside)), ),
        "out": (gate.classify(ctx, str(outside)), ),
    }
    chk_before = [gate.check_write(ctx, *gate.classify(ctx, str(p))) for p in (inside, outside)]

    def boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(gate, "_diag_parts", boom)
    assert gate.deny_diag(ctx, outside) == " | diag: unavailable"
    monkeypatch.undo()
    monkeypatch.setattr(ctx, "sibling_runs", boom)
    assert gate.deny_diag(ctx, outside) == " | diag: unavailable"
    monkeypatch.undo()
    assert before["in"] == (gate.classify(ctx, str(inside)), )
    assert before["out"] == (gate.classify(ctx, str(outside)), )
    chk_after = [gate.check_write(ctx, *gate.classify(ctx, str(p))) for p in (inside, outside)]
    assert chk_before == chk_after
