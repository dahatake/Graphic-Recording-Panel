"""Unit-level contract checks for safe run cleanup."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
import json

import pytest


SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "clean-work.py"
SPEC = importlib.util.spec_from_file_location("clean_work", SCRIPT)
assert SPEC and SPEC.loader
clean_work = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = clean_work
SPEC.loader.exec_module(clean_work)

run_state = clean_work.h.load_script("run-state")


# FR-1009 AC-057
def test_report_authorization_requires_every_success_gate():
    report = """- result: 全件完了
    - main_integration: pass
    - cleanup_authorization: pass
    - main_commit: abc
- complete_check: pass
- final_verify: pass
- target_tests: pass
- post_integration_verify: pass
- cleanup_candidates:
- protected_assets:
- candidate_results: pending
"""
    assert clean_work.report_authorizes(report)
    assert not clean_work.report_authorizes(report.replace("final_verify: pass", "final_verify: fail"))


# FR-1009 AC-057 / FR-1010 AC-062
def test_structured_milestones_are_ordered_and_exact():
    milestones = [
        {"name": "complete-check", "exit_code": 0},
        {"name": "final-verify", "exit_code": 0},
        {"name": "target-system-tests", "exit_code": 0},
        {"name": "main-integration", "status": "success"},
        {"name": "post-integration-verify", "exit_code": 0},
        {"name": "pre-cleanup-report", "status": "finalized"},
    ]
    assert clean_work.milestones_authorize({"completion_milestones": milestones})
    assert not clean_work.milestones_authorize({"completion_milestones": milestones[:-1]})
    assert not clean_work.milestones_authorize({})


# FR-1009 AC-057 / FR-1010 AC-060
def test_current_run_marker_protects_active_but_not_finished_run():
    assert clean_work.protects_current_run("20261010", "20261010", {"status": "active"})
    assert not clean_work.protects_current_run("20261010", "20261010", {"status": "finished"})
    assert not clean_work.protects_current_run("20261010", "other", {"status": "active"})


# NFR-COMPAT-001 AC-066
def test_canonical_key_collapses_path_spelling_aliases(tmp_path):
    spaced = tmp_path / "path with spaces"
    spaced.mkdir()
    assert clean_work.key(spaced) == clean_work.key(spaced / ".")


# FR-1009 AC-059 / NFR-OPS-005 AC-063
def test_plan_requires_all_ownership_evidence_and_never_uses_prefix_alone(tmp_path, monkeypatch):
    root = tmp_path
    worktree = root / "work" / "worktrees" / "209901010101-w1"
    worktree.mkdir(parents=True)
    monkeypatch.setattr(clean_work, "worktree_map", lambda _root: {})
    queue = {
        "run_id": "different-run",
        "items": [{
            "branch": "work/209901010101/I-01",
            "worktree": str(worktree),
        }],
    }
    candidates = clean_work.plan(
        root, {"work": {"dir": "work"}}, "209901010101",
        {"integration_branch": ""}, queue,
    )
    branch = next(c for c in candidates if c.kind == "work-branch")
    assert branch.result == "未実行"
    assert "worktree" in branch.reason


# FR-1010 AC-061
def test_protected_candidate_is_distinct_from_failed_deletion(tmp_path):
    protected = clean_work.Candidate("pool-worktree", "owned", reason="dirty")
    ok, had_protected = clean_work.execute(
        tmp_path, {"work_dir": "work"}, "209901010101",
        {}, {"run_id": "209901010101", "items": []}, "", [protected],
    )
    assert ok and had_protected
    assert protected.result == "保持"


# FR-1010 AC-061
def test_deletion_error_stops_later_candidates_and_is_not_protection(tmp_path, monkeypatch):
    path = tmp_path / "work" / "worktrees" / "209901010101-w1"
    path.mkdir(parents=True)
    worktree = clean_work.Candidate(
        "pool-worktree", str(path), path, "work/209901010101/I-01"
    )
    later = clean_work.Candidate("integration-branch", "run/209901010101")
    monkeypatch.setattr(
        clean_work, "plan",
        lambda *_args, **_kwargs: [worktree, later],
    )
    monkeypatch.setattr(
        clean_work, "git_output",
        lambda *_args, **_kwargs: (1, "simulated delete failure"),
    )
    ok, had_protected = clean_work.execute(
        tmp_path, {}, "209901010101", {}, {}, "", [worktree, later],
    )
    assert not ok and not had_protected
    assert worktree.result == "失敗"
    assert later.result == "未実行"


# FR-1010 AC-062
def test_retry_accepts_missing_asset_only_with_matching_success_record(tmp_path, monkeypatch):
    root = tmp_path
    path = root / "work" / "worktrees" / "209901010101-w1"
    monkeypatch.setattr(clean_work, "worktree_map", lambda _root: {})
    queue = {
        "run_id": "209901010101",
        "items": [{"branch": "work/209901010101/I-01", "worktree": str(path)}],
    }
    without = clean_work.plan(root, {"work": {"dir": "work"}}, "209901010101",
                              {"integration_branch": ""}, queue)
    assert next(c for c in without if c.kind == "pool-worktree").reason
    previous = {("pool-worktree", str(path)): "削除済み"}
    with_record = clean_work.plan(root, {"work": {"dir": "work"}}, "209901010101",
                                 {"integration_branch": ""}, queue, previous)
    assert not next(c for c in with_record if c.kind == "pool-worktree").reason


# NFR-OPS-005 AC-065
def test_execute_rechecks_each_candidate_immediately_before_delete(tmp_path, monkeypatch):
    calls = []
    candidate = clean_work.Candidate("temporary-assets", str(tmp_path / "gone"))

    def changed(*_args, **_kwargs):
        calls.append(True)
        return [clean_work.Candidate(
            candidate.kind, candidate.value, reason="state changed"
        )]

    monkeypatch.setattr(clean_work, "plan", changed)
    ok, protected = clean_work.execute(
        tmp_path, {}, "209901010101", {}, {}, "", [candidate],
    )
    assert calls and ok and protected
    assert candidate.result == "保持" and candidate.reason == "state changed"


REPORT = """# run-report
- result: 全件完了
- main_integration: pass
- cleanup_authorization: pass
- main_commit: abc
- complete_check: pass
- final_verify: pass
- target_tests: pass
- post_integration_verify: pass
- 清掃前版 run-report 確定: pass
- cleanup_candidates:
- protected_assets:
- candidate_results: pending
"""


def _git(cwd, *args):
    import subprocess
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout


def _make_run_worktree(tmp_path, rid="209901010101"):
    import json
    primary = tmp_path / "repo"
    primary.mkdir()
    _git(primary, "init", "-b", "main")
    _git(primary, "config", "user.email", "t@example.com")
    _git(primary, "config", "user.name", "t")
    (primary / ".gitignore").write_text("/work/\n", encoding="utf-8", newline="\n")
    _git(primary, "add", ".")
    _git(primary, "commit", "-m", "init")
    wt = tmp_path / f"repo-run-{rid}"
    _git(primary, "worktree", "add", "-b", f"run/{rid}", str(wt))
    (wt / "feature.txt").write_text("x\n", encoding="utf-8", newline="\n")
    _git(wt, "add", ".")
    _git(wt, "commit", "-m", "feature")
    _git(primary, "merge", "--ff-only", f"run/{rid}")
    run = wt / "work" / "runs" / rid
    run.mkdir(parents=True)
    (run / "run-report.md").write_text(REPORT, encoding="utf-8", newline="\n")
    (run / "meta.json").write_text(json.dumps({
        "run_id": rid, "status": "finished", "result": "全件完了",
        "integration_branch": f"run/{rid}",
    }), encoding="utf-8", newline="\n")
    (run / "queue.json").write_text(json.dumps({"run_id": rid, "items": []}),
                                    encoding="utf-8", newline="\n")
    return primary, wt


# toolkit: run worktree cleanup
def test_clean_work_removes_own_run_worktree_and_keeps_report(tmp_path, monkeypatch, capsys):
    rid = "209901010101"
    primary, wt = _make_run_worktree(tmp_path, rid)
    monkeypatch.chdir(wt)
    assert clean_work.main(["--dry-run", "--root", str(wt)]) == 0
    assert "DELETE run-worktree" in capsys.readouterr().out
    assert wt.exists()
    assert clean_work.main(["--root", str(wt)]) == 0
    assert not wt.exists()
    assert _git(primary, "branch", "--list", f"run/{rid}").strip() == ""
    report = (primary / "work" / "runs" / rid / "run-report.md").read_text(encoding="utf-8")
    assert "候補別結果" in report
    assert "run-worktree" in report and "削除済み" in report


# toolkit: run worktree cleanup
def test_clean_work_keeps_dirty_run_worktree(tmp_path, monkeypatch):
    rid = "209901010101"
    primary, wt = _make_run_worktree(tmp_path, rid)
    (wt / "wip.txt").write_text("uncommitted\n", encoding="utf-8", newline="\n")
    monkeypatch.chdir(wt)
    assert clean_work.main(["--root", str(wt)]) == 1
    assert wt.exists()
    assert _git(primary, "branch", "--list", f"run/{rid}").strip() != ""
    report = (wt / "work" / "runs" / rid / "run-report.md").read_text(encoding="utf-8")
    assert "run-worktree" in report and "保持" in report


OLD = "209901010101"
NEW = "209901010102"
THIRD = "209901010103"


def _meta(wt, rid):
    return json.loads((wt / "work" / "runs" / rid / "meta.json").read_text(encoding="utf-8"))


def _save(wt, rid, meta):
    path = wt / "work" / "runs" / rid / "meta.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(meta), encoding="utf-8")


def _legacy_run(tmp_path):
    primary, wt = _make_run_worktree(tmp_path, OLD)
    old = _meta(wt, OLD)
    old.update(session_id="owner", started_at="2000-01-01T00:00:00+00:00",
               finished_at="2000-01-01T01:00:00+00:00",
               branch_at_start=f"run/{OLD}")
    _save(wt, OLD, old)
    return primary, wt


def _start(wt, rid=NEW, session="owner"):
    return run_state.main(["--root", str(wt), "start", "--new",
                           "--run-id", rid, "--session-id", session])


def _finish(wt, rid):
    meta = _meta(wt, rid)
    meta.update(status="finished", result="全件完了", finished_at=clean_work.h.now_iso())
    _save(wt, rid, meta)
    (wt / "work" / "runs" / rid / "run-report.md").write_text(REPORT, encoding="utf-8")


# toolkit maintenance AC1/AC2: immutable predecessor evidence, including blocked completion.
@pytest.mark.parametrize("result", ["全件完了", "blocked あり"])
def test_inherited_run_start_and_cleanup_preserve_predecessor(tmp_path, monkeypatch, result):
    primary, wt = _legacy_run(tmp_path)
    old = _meta(wt, OLD)
    old["result"] = result
    _save(wt, OLD, old)
    monkeypatch.chdir(wt)
    assert _start(wt) == 0
    meta = _meta(wt, NEW)
    assert meta["inherited_from"]["run_id"] == OLD
    assert meta["inherited_from"]["finished_at"] == old["finished_at"]
    assert meta["worktree_path"] == str(wt.resolve())
    assert _git(wt, "branch", "--show-current").strip() == f"run/{OLD}"
    assert _meta(wt, OLD) == old
    _finish(wt, NEW)
    assert clean_work.main(["--root", str(wt)]) == 0
    assert not wt.exists()
    assert _meta(primary, OLD) == old
    assert "削除済み" in (primary / "work" / "runs" / NEW / "run-report.md").read_text(encoding="utf-8")


# toolkit maintenance AC1/AC5: fail closed before creating any new run record.
@pytest.mark.parametrize("change", ["active", "session", "unknown", "branch", "tree", "missing", "timestamp"])
def test_start_rejects_unproven_predecessor(tmp_path, monkeypatch, change):
    _, wt = _legacy_run(tmp_path)
    meta = _meta(wt, OLD)
    if change == "active":
        meta["status"] = "active"
    elif change == "session":
        meta["session_id"] = "other"
    elif change == "unknown":
        meta.pop("session_id")
    elif change == "branch":
        meta["integration_branch"] = "run/unrelated"
    elif change == "tree":
        meta["worktree_path"] = str(tmp_path / "elsewhere")
    elif change == "timestamp":
        meta["finished_at"] = None
    _save(wt, OLD, meta)
    if change == "missing":
        (wt / "work" / "runs" / OLD / "meta.json").unlink()
    monkeypatch.chdir(wt)
    assert _start(wt) != 0
    assert not (wt / "work" / "runs" / NEW).exists()
    assert _git(wt, "branch", "--show-current").strip() == f"run/{OLD}"


# toolkit maintenance AC3: predecessor cleanup never touches a successor, even without inheritance records.
@pytest.mark.parametrize("status", ["active", "finished"])
def test_predecessor_cannot_delete_successor_tree_or_branch(tmp_path, monkeypatch, status):
    primary, wt = _legacy_run(tmp_path)
    _save(wt, NEW, {
        "run_id": NEW, "status": status, "result": "blocked あり",
        "started_at": "2000-01-02T00:00:00+00:00",
        "integration_branch": f"run/{OLD}", "session_id": "owner",
    })
    monkeypatch.chdir(wt)
    assert clean_work.main(["--root", str(wt)]) == 0
    assert wt.exists()
    assert _git(primary, "branch", "--list", f"run/{OLD}").strip()
    assert _meta(wt, NEW)["status"] == status


# toolkit maintenance AC2/AC5: absence, substitution and chain tampering cannot authorize cleanup.
@pytest.mark.parametrize("change", ["missing", "source", "session", "branch", "tree", "finished", "cycle"])
def test_cleanup_rejects_invalid_inheritance(tmp_path, monkeypatch, change):
    _, wt = _legacy_run(tmp_path)
    monkeypatch.chdir(wt)
    assert _start(wt) == 0
    _finish(wt, NEW)
    meta = _meta(wt, NEW)
    if change == "missing":
        meta.pop("inherited_from")
    elif change == "source":
        meta["inherited_from"]["run_id"] = "unrelated"
    elif change == "session":
        meta["session_id"] = "different"
    elif change == "branch":
        meta["branch_at_start"] = "run/unrelated"
    elif change == "tree":
        meta["worktree_path"] = str(tmp_path / "elsewhere")
    elif change == "cycle":
        meta["inherited_from"]["run_id"] = NEW
    else:
        old = _meta(wt, OLD)
        old["finished_at"] = "2000-01-01T02:00:00+00:00"
        _save(wt, OLD, old)
    _save(wt, NEW, meta)
    reason = clean_work.authorization(wt, "main", NEW, meta, REPORT)
    assert reason
    assert clean_work.main(["--root", str(wt)]) == 0
    assert wt.exists()


# toolkit maintenance AC4: explicit migration checks the live root, owner and source before writing.
@pytest.mark.parametrize("session", ["owner", "foreign"])
def test_repair_legacy_active_run_is_explicit_and_owner_checked(tmp_path, monkeypatch, session):
    _, wt = _legacy_run(tmp_path)
    current = {
        "run_id": NEW, "status": "active", "session_id": "owner",
        "started_at": "2000-01-02T00:00:00+00:00",
        "integration_branch": f"run/{OLD}", "branch_at_start": f"run/{OLD}",
    }
    _save(wt, NEW, current)
    (wt / "work" / "current-run.txt").write_text(NEW, encoding="utf-8")
    monkeypatch.chdir(wt)
    args = ["--root", str(wt), "repair-ownership", "--from-run", OLD, "--session-id", session]
    rc = run_state.main(args)
    if session == "foreign":
        assert rc != 0
        assert _meta(wt, NEW) == current
    else:
        assert rc == 0
        repaired = _meta(wt, NEW)
        assert repaired["inherited_from"]["run_id"] == OLD
        assert repaired["branch_at_start"] == current["branch_at_start"]
        assert run_state.main(args) == 0
        assert _meta(wt, NEW) == repaired


# toolkit maintenance AC1/AC5: each generation must validate, and all evidence survives cleanup.
def test_multigeneration_inheritance_validates_every_link(tmp_path, monkeypatch):
    primary, wt = _legacy_run(tmp_path)
    monkeypatch.chdir(wt)
    assert _start(wt) == 0
    _finish(wt, NEW)
    assert _start(wt, THIRD) == 0
    assert _meta(wt, THIRD)["inherited_from"]["run_id"] == NEW
    _finish(wt, THIRD)
    meta = _meta(wt, THIRD)
    assert not clean_work.authorization(wt, "main", THIRD, meta, REPORT)
    original = _meta(wt, OLD)
    broken = dict(original, session_id="foreign")
    _save(wt, OLD, broken)
    assert clean_work.authorization(wt, "main", THIRD, meta, REPORT)
    _save(wt, OLD, original)
    assert clean_work.main(["--root", str(wt)]) == 0
    assert not wt.exists()
    assert _meta(primary, OLD) == original
    assert _meta(primary, NEW)["inherited_from"]["run_id"] == OLD


# toolkit maintenance AC4/AC5: failed migration never rewrites active-run or predecessor metadata.
@pytest.mark.parametrize("change", ["branch", "tree", "source", "active", "unknown", "record"])
def test_repair_rejects_mismatched_evidence_without_writes(tmp_path, monkeypatch, change):
    _, wt = _legacy_run(tmp_path)
    current = {
        "run_id": NEW, "status": "active", "session_id": "owner",
        "started_at": "2000-01-02T00:00:00+00:00",
        "integration_branch": f"run/{OLD}", "branch_at_start": f"run/{OLD}",
    }
    source_id = OLD
    if change == "branch":
        _git(wt, "switch", "-c", "run/unrelated")
    elif change == "tree":
        current["worktree_path"] = str(tmp_path / "elsewhere")
    elif change == "source":
        source_id = "unrelated"
    elif change == "unknown":
        current["session_id"] = None
    elif change == "record":
        current["inherited_from"] = {"run_id": "unrelated"}
    else:
        old = _meta(wt, OLD)
        old["status"] = "active"
        _save(wt, OLD, old)
    _save(wt, NEW, current)
    (wt / "work" / "current-run.txt").write_text(NEW, encoding="utf-8")
    monkeypatch.chdir(wt)
    before_source = _meta(wt, OLD)
    assert run_state.main(["--root", str(wt), "repair-ownership", "--from-run",
                           source_id, "--session-id", "owner"]) != 0
    assert _meta(wt, NEW) == current
    assert _meta(wt, OLD) == before_source


# toolkit maintenance AC3/AC5: the immediate deletion recheck protects a successor created after planning.
def test_shared_branch_is_rechecked_before_delete(tmp_path, monkeypatch):
    primary, wt = _legacy_run(tmp_path)
    monkeypatch.chdir(primary)
    meta = _meta(wt, OLD)
    cfg = clean_work.h.load_config(wt)
    queue = {"run_id": OLD, "items": []}
    candidates = clean_work.plan(wt, cfg, OLD, meta, queue, run_wt=wt)
    assert all(not c.reason for c in candidates)
    _save(wt, NEW, {
        "run_id": NEW, "status": "active", "session_id": "owner",
        "integration_branch": f"run/{OLD}",
    })
    ok, protected = clean_work.execute(wt, cfg, OLD, meta, queue, REPORT, candidates, wt)
    assert ok and protected
    assert wt.exists()
    assert _git(primary, "branch", "--list", f"run/{OLD}").strip()


# toolkit maintenance AC2/AC5: a path field is not enough if Git now binds the branch elsewhere.
def test_recorded_native_tree_requires_live_branch_binding(tmp_path, monkeypatch):
    primary, wt = _legacy_run(tmp_path)
    meta = _meta(wt, OLD)
    meta["worktree_path"] = str(wt.resolve())
    _save(wt, OLD, meta)
    _git(wt, "checkout", "--detach")
    other = tmp_path / "other-tree"
    _git(primary, "worktree", "add", str(other), f"run/{OLD}")
    monkeypatch.chdir(wt)
    assert clean_work.authorization(wt, "main", OLD, meta, REPORT)
    assert clean_work.main(["--root", str(wt)]) == 0
    assert wt.exists() and other.exists()
    assert _git(primary, "branch", "--list", f"run/{OLD}").strip()


# toolkit maintenance AC2/AC3: stale caller metadata cannot authorize deletion after a record changes.
def test_current_ownership_record_is_reloaded_before_deletion(tmp_path, monkeypatch):
    primary, wt = _legacy_run(tmp_path)
    monkeypatch.chdir(primary)
    meta = _meta(wt, OLD)
    cfg = clean_work.h.load_config(wt)
    queue = {"run_id": OLD, "items": []}
    candidates = clean_work.plan(wt, cfg, OLD, meta, queue, run_wt=wt)
    assert all(not c.reason for c in candidates)
    _save(wt, OLD, dict(meta, session_id="foreign"))
    ok, protected = clean_work.execute(wt, cfg, OLD, meta, queue, REPORT, candidates, wt)
    assert ok and protected
    assert wt.exists()
    assert _git(primary, "branch", "--list", f"run/{OLD}").strip()