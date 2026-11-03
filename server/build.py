#!/usr/bin/env python3
"""起動のたびの検査（FR-113）。生成物は作らず、server/*.py と web/src/*.js の構文だけを調べる。

- 標準ライブラリだけで動く。外部通信はしない。cwd は問わない（このファイルの位置から探す）。
- server/*.py: py_compile（出力先は一時フォルダー。リポジトリには何も残さない）。
- web/src/*.js: node があれば `node --check`。なければ省略を表示して続行する。
- 成功は「build: OK」を表示して exit 0、失敗は理由（ファイル名と位置）を表示して exit 1。
"""
import glob
import os
import py_compile
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def check_python(files, tmp):
    errors = []
    for i, path in enumerate(files):
        try:
            py_compile.compile(path, cfile=os.path.join(tmp, "%d.pyc" % i), doraise=True)
        except py_compile.PyCompileError as e:
            errors.append("%s: %s" % (os.path.relpath(path, ROOT), str(e.msg).strip() or e.exc_type_name))
        except (OSError, SyntaxError, ValueError) as e:
            errors.append("%s: %s" % (os.path.relpath(path, ROOT), e))
    return errors


def check_js(files, node):
    errors = []
    for path in files:
        rel = os.path.relpath(path, ROOT)
        try:
            r = subprocess.run([node, "--check", path], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, universal_newlines=True, timeout=60)
        except (OSError, subprocess.SubprocessError) as e:
            errors.append("%s: node --check を実行できません: %s" % (rel, e))
            continue
        if r.returncode != 0:
            errors.append("%s: %s" % (rel, (r.stderr or r.stdout).strip()))
    return errors


def main():
    py_files = sorted(glob.glob(os.path.join(ROOT, "server", "*.py")))
    js_files = sorted(glob.glob(os.path.join(ROOT, "web", "src", "*.js")))
    errors = []
    tmp = tempfile.mkdtemp(prefix="grp-build-")
    try:
        errors += check_python(py_files, tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    node = shutil.which("node")
    if node:
        errors += check_js(js_files, node)
    else:
        print("build: node が見つからないため web/src/*.js の検査を省略しました（server/*.py は検査済み）")
    if errors:
        for line in errors:
            print("build: NG " + line, file=sys.stderr)
        print("build: FAILED（中継サーバーは起動しません）", file=sys.stderr)
        return 1
    print("build: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
