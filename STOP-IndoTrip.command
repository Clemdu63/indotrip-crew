#!/bin/zsh
set -e

cd "$(dirname "$0")"
RUN_DIR="$PWD/.run"

if [ -f "$RUN_DIR/tunnel.pid" ]; then
  kill "$(cat "$RUN_DIR/tunnel.pid")" >/dev/null 2>&1 || true
  rm -f "$RUN_DIR/tunnel.pid"
fi

if [ -f "$RUN_DIR/server.pid" ]; then
  kill "$(cat "$RUN_DIR/server.pid")" >/dev/null 2>&1 || true
  rm -f "$RUN_DIR/server.pid"
fi

echo "IndoTrip arrete."
