#!/bin/sh
cd "$(dirname "$0")" || exit 1
sh ./start.sh "$@"
status=$?
if [ "$status" -ne 0 ]; then
  echo ""
  echo "Startup failed (exit $status). Press Enter to close."
  read -r _
fi
exit "$status"
