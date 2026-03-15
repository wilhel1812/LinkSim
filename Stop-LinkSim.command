#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
PID_FILE="$SCRIPT_DIR/.tmp/local-edge.pid"

echo "Stopping LinkSim local edge server..."

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then
    kill -TERM "$PID" >/dev/null 2>&1 || true
    for _ in {1..20}; do
      if ! kill -0 "$PID" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done
    if kill -0 "$PID" 2>/dev/null; then
      kill -KILL "$PID" >/dev/null 2>&1 || true
    fi
  fi
  rm -f "$PID_FILE"
fi

# Backward compatibility with old Docker-based launcher
docker compose down --remove-orphans >/dev/null 2>&1 || true

# Also kill any local process still bound to 8788 (wrangler/pages dev outside docker)
PIDS="$(lsof -ti tcp:8788 2>/dev/null || true)"
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill -TERM >/dev/null 2>&1 || true
  sleep 1
  PIDS2="$(lsof -ti tcp:8788 2>/dev/null || true)"
  if [ -n "$PIDS2" ]; then
    echo "$PIDS2" | xargs kill -KILL >/dev/null 2>&1 || true
  fi
fi

echo "LinkSim local server stopped."
