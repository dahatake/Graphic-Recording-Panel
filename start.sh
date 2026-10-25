#!/bin/sh
set -eu

here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
python=""
fallback=""
# Try every python on this device (versioned names included) and prefer one that has the
# optional GitHub Copilot SDK (import name "copilot"); otherwise use the first usable one.
for candidate in python3 python python3.14 python3.13 python3.12 python3.11 python3.10 python3.9 python3.8 python3.7; do
    if command -v "$candidate" >/dev/null 2>&1 &&
        "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)' >/dev/null 2>&1; then
        [ -n "$fallback" ] || fallback="$candidate"
        if "$candidate" -c 'import copilot' >/dev/null 2>&1; then
            python="$candidate"
            break
        fi
    fi
done
[ -n "$python" ] || python="$fallback"
if [ -z "$python" ]; then
    echo "Python 3.7 or later is required. Install Python 3 and try again." >&2
    exit 1
fi
if [ ! -f "$here/web/index.html" ]; then
    echo "web/index.html is missing. Keep this script in the repository root." >&2
    exit 1
fi

echo "Open the URL (http://127.0.0.1:<port>/) printed by the server below in your browser. Pass --port N to fix the port."
echo "Press Ctrl+C in this window to stop the server."
exec "$python" "$here/server/relay.py" --web "$here/web" "$@"
