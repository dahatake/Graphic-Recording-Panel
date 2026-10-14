#!/bin/sh
set -eu

here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
python=""
for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 &&
        "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)'; then
        python="$candidate"
        break
    fi
done
if [ -z "$python" ]; then
    echo "Python 3.7 or later is required. Install Python 3 and try again." >&2
    exit 1
fi
if [ ! -f "$here/web/index.html" ]; then
    echo "web/index.html is missing. Keep this script in the repository root." >&2
    exit 1
fi

echo "Open http://localhost:8080/ in your browser after the server starts."
echo "Press Ctrl+C in this window to stop the server."
exec "$python" -m http.server --bind 127.0.0.1 --directory "$here/web" 8080
