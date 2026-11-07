"""Fail-closed ownership evidence for a run inheriting an existing integration tree.

No ownership is inferred from a session ID alone. Legacy native runs must still
occupy their original, Git-registered dedicated tree; newer runs record its
canonical path. Every inherited link is checked against the predecessor's record.
"""
from __future__ import annotations

import datetime as dt
import os
import re
from pathlib import Path

import ebaklib as h


class OwnershipError(ValueError):
    pass


def path_key(path: Path) -> str:
    return os.path.normcase(os.path.realpath(os.path.abspath(str(path))))


def timestamp(value) -> dt.datetime:
    try:
        result = dt.datetime.fromisoformat(value)
        if result.tzinfo is None:
            raise ValueError("timezone missing")
        return result
    except (TypeError, ValueError):
        raise OwnershipError("開始・終了日時の証跡が不明です") from None


def records(root: Path, cfg: dict) -> dict:
    result = {}
    runs = h.work_dir(root, cfg) / "runs"
    for directory in sorted(runs.iterdir()) if runs.is_dir() else []:
        if not directory.is_dir():
            continue
        try:
            meta = h.load_meta(root, cfg, directory.name)
        except (OSError, ValueError):
            raise OwnershipError(f"run {directory.name} の所有記録を読めません") from None
        if not isinstance(meta, dict) or meta.get("run_id") != directory.name:
            raise OwnershipError(f"run {directory.name} の所有記録が不明・不一致です")
        result[directory.name] = meta
    return result


def check_live_tree(root: Path, branch: str) -> None:
    rc, out = h.git(["worktree", "list", "--porcelain"], root)
    if rc:
        raise OwnershipError("Git worktree 登録を検証できません")
    matches = []
    path = None
    for line in out.splitlines():
        if line.startswith("worktree "):
            path = Path(line[9:])
        elif line == f"branch refs/heads/{branch}" and path is not None:
            matches.append(path_key(path))
    if matches != [path_key(root)] or path_key(root) == path_key(h.primary_tree_of(root)):
        raise OwnershipError("branch/tree の Git 所有登録が一致しません")


def check_path(root: Path, rid: str, meta: dict) -> None:
    recorded = meta.get("worktree_path")
    if "worktree_path" in meta:
        if not isinstance(recorded, str) or not recorded or path_key(Path(recorded)) != path_key(root):
            raise OwnershipError(f"run {rid} の tree 所有記録が一致しません")
    else:
        # Legacy native records have no path field. Require the original
        # dedicated tree name as well as local meta and the live Git binding.
        primary = h.primary_tree_of(root)
        if path_key(root) != path_key(primary.parent / f"{primary.name}-run-{rid}"):
            raise OwnershipError(f"run {rid} の legacy tree 所有証拠がありません")


def snapshot(root: Path, rid: str, meta: dict) -> dict:
    return {
        "run_id": rid, "finished_at": meta.get("finished_at"),
        "started_at": meta.get("started_at"),
        "integration_branch": meta.get("integration_branch"),
        "branch_at_start": meta.get("branch_at_start"),
        "session_id": meta.get("session_id"), "worktree_path": str(root.resolve()),
    }


def validate_chain(root: Path, cfg: dict, rid: str, meta: dict, *, live: bool = True) -> list[str]:
    branch = meta.get("integration_branch")
    if not isinstance(branch, str) or not re.fullmatch(r"run/[^/]+", branch):
        raise OwnershipError("統合ブランチの所有記録が不明です")
    if live:
        check_live_tree(root, branch)
    seen = set()
    ancestors = []
    while True:
        if rid in seen or meta.get("run_id") != rid:
            raise OwnershipError("継承チェーンの循環・run-id 不一致です")
        seen.add(rid)
        if meta.get("integration_branch") != branch:
            raise OwnershipError("継承チェーンの branch が一致しません")
        check_path(root, rid, meta)
        inherited = meta.get("inherited_from")
        if inherited is None:
            if branch != f"run/{rid}":
                raise OwnershipError("継承元の所有証跡がありません")
            if meta.get("branch_at_start") not in (branch, cfg.get("base_branch", "main"), "master"):
                raise OwnershipError("元 run の開始時 branch 証跡が一致しません")
            return ancestors
        if not meta.get("worktree_path") or meta.get("branch_at_start") != branch:
            raise OwnershipError("継承開始時の branch/tree 証跡が一致しません")
        if not isinstance(inherited, dict):
            raise OwnershipError("継承証跡の形式が不正です")
        source_id = inherited.get("run_id")
        if not isinstance(source_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", source_id):
            raise OwnershipError("継承元 run-id が不正です")
        try:
            source = h.load_meta(root, cfg, source_id)
        except (OSError, ValueError):
            raise OwnershipError("継承元の記録を読めません") from None
        check_predecessor(root, source_id, source, meta)
        if inherited != snapshot(root, source_id, source):
            raise OwnershipError("継承元の保存証跡と現在の記録が一致しません")
        ancestors.append(source_id)
        rid, meta = source_id, source


def check_predecessor(root: Path, rid: str, source: dict, child: dict) -> None:
    if not isinstance(source, dict) or source.get("run_id") != rid:
        raise OwnershipError("継承元の run 所有記録がありません")
    if source.get("status") != "finished":
        raise OwnershipError("継承元 run は未終了です")
    if not source.get("session_id") or source.get("session_id") != child.get("session_id"):
        raise OwnershipError("継承元の session 所有証拠が不明・不一致です")
    if source.get("integration_branch") != child.get("integration_branch"):
        raise OwnershipError("継承元の branch が一致しません")
    start = timestamp(source.get("started_at"))
    end = timestamp(source.get("finished_at"))
    if not start <= end <= timestamp(child.get("started_at")):
        raise OwnershipError("継承元の終了順序が一致しません")
    check_path(root, rid, source)


def build_inheritance(root: Path, cfg: dict, rid: str, meta: dict, source_id=None) -> dict:
    """Validate first, return evidence only; the caller owns the atomic write/lock."""
    branch = meta.get("integration_branch", "")
    if meta.get("branch_at_start") != branch:
        raise OwnershipError("継承開始時の branch 記録が一致しません")
    check_live_tree(root, branch)
    all_records = records(root, cfg)
    if any(value.get("status") == "active" for name, value in all_records.items() if name != rid):
        raise OwnershipError("同じ tree に未終了の run があるため継承できません")
    others = [(name, value) for name, value in all_records.items()
              if name != rid and value.get("integration_branch") == branch]
    if not others:
        raise OwnershipError("継承元の所有記録がありません")
    # A same-session older run is not sufficient: only the immediate, unique
    # predecessor may transfer ownership, and every ancestor must validate.
    ordered = sorted(others, key=lambda item: timestamp(item[1].get("started_at")))
    name, source = ordered[-1]
    if (source_id is not None and source_id != name) or (
        len(ordered) > 1 and timestamp(ordered[-2][1].get("started_at")) == timestamp(source.get("started_at"))
    ):
        raise OwnershipError("直前の継承元を一意に証明できません")
    check_predecessor(root, name, source, meta)
    ancestors = validate_chain(root, cfg, name, source)
    if {other_id for other_id, _ in others} != {name, *ancestors}:
        raise OwnershipError("同じ branch の別 run を継承チェーンで説明できません")
    return snapshot(root, name, source)


def shared_asset_reason(root: Path, cfg: dict, rid: str, meta: dict) -> str:
    """An earlier run must never delete a later run's shared branch or tree."""
    try:
        ancestors = (set(validate_chain(root, cfg, rid, meta, live=False))
                     if meta.get("inherited_from") is not None else set())
        all_records = records(root, cfg)
        if meta.get("integration_branch") and all_records.get(rid) != meta:
            return "削除直前の run 所有記録が欠損または変更されたため保護"
        for name, other in all_records.items():
            if name == rid or name in ancestors:
                continue
            same_branch = other.get("integration_branch") == meta.get("integration_branch")
            same_tree = other.get("worktree_path") and path_key(Path(other["worktree_path"])) == path_key(root)
            incomplete = other.get("status") != "finished" or other.get("result") != "全件完了"
            if same_branch or same_tree or incomplete:
                return f"後続または別 run {name} の branch/tree・未完了記録を保護"
    except (OwnershipError, TypeError, ValueError):
        return "別 run または継承チェーンの所有記録が不明なため保護"
    return ""
