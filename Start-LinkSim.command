#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p "$SCRIPT_DIR/.tmp"
PID_FILE="$SCRIPT_DIR/.tmp/local-edge.pid"
LOG_FILE="$SCRIPT_DIR/.tmp/local-edge.log"

echo "Stopping any previous local server first..."
"$SCRIPT_DIR/Stop-LinkSim.command" || true

if command -v sqlite3 >/dev/null 2>&1; then
  D1_DIR="$SCRIPT_DIR/.wrangler/state/v3/d1/miniflare-D1DatabaseObject"
  if [ -d "$D1_DIR" ]; then
    echo "Applying local schema patch (if needed)..."
    find "$D1_DIR" -type f -name "*.sqlite" | while read -r DB; do
      sqlite3 "$DB" "ALTER TABLE resource_changes ADD COLUMN details_json TEXT;" >/dev/null 2>&1 || true
      sqlite3 "$DB" "ALTER TABLE resource_changes ADD COLUMN snapshot_json TEXT;" >/dev/null 2>&1 || true
    done
  fi
fi

echo "Starting LinkSim local edge server (host wrangler)..."
: > "$LOG_FILE"
nohup npm run dev:edge > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

echo "Waiting for http://127.0.0.1:8788 ..."
READY=0
for i in {1..150}; do
  if [ -f "$PID_FILE" ]; then
    PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "${PID:-}" ] && ! kill -0 "$PID" 2>/dev/null; then
      echo "Local server process exited during startup. Recent logs:"
      tail -n 80 "$LOG_FILE" || true
      break
    fi
  fi
  if curl -sS -o /dev/null "http://127.0.0.1:8788"; then
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -eq 1 ]; then
  echo "LinkSim is ready at http://localhost:8788"
  open "http://localhost:8788"
else
  echo "Server did not become ready in time. Check logs: $LOG_FILE"
  osascript -e 'display alert "LinkSim start timed out" message "Open .tmp/local-edge.log for details." as warning'
fi
