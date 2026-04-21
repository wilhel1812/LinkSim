#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p "$SCRIPT_DIR/.tmp"
PID_FILE="$SCRIPT_DIR/.tmp/local-edge.pid"
LOG_FILE="$SCRIPT_DIR/.tmp/local-edge.log"
VITE_PID_FILE="$SCRIPT_DIR/.tmp/local-vite.pid"
VITE_LOG_FILE="$SCRIPT_DIR/.tmp/local-vite.log"
VITE_PORT="5174"

start_servers() {
  : > "$LOG_FILE"
  : > "$VITE_LOG_FILE"
  nohup npm run dev:edge > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  nohup npm run dev -- --host 127.0.0.1 --port "$VITE_PORT" --strictPort > "$VITE_LOG_FILE" 2>&1 &
  echo $! > "$VITE_PID_FILE"
}

wait_for_servers() {
  READY=0
  for i in {1..150}; do
    if [ -f "$PID_FILE" ]; then
      PID="$(cat "$PID_FILE" 2>/dev/null || true)"
      if [ -n "${PID:-}" ] && ! kill -0 "$PID" 2>/dev/null; then
        echo "Edge server exited during startup."
        tail -n 80 "$LOG_FILE" || true
        break
      fi
    fi
    if [ -f "$VITE_PID_FILE" ]; then
      VITE_PID="$(cat "$VITE_PID_FILE" 2>/dev/null || true)"
      if [ -n "${VITE_PID:-}" ] && ! kill -0 "$VITE_PID" 2>/dev/null; then
        echo "Vite server exited during startup."
        tail -n 80 "$VITE_LOG_FILE" || true
        break
      fi
    fi
    if curl -fsS "http://127.0.0.1:8788" >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:$VITE_PORT" >/dev/null 2>&1; then
      READY=1
      break
    fi
    printf "."
    sleep 1
  done
  echo ""
}

stop_server() {
  local pid=""
  if [ -f "$PID_FILE" ]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" >/dev/null 2>&1 || true
      for _ in {1..20}; do
        if ! kill -0 "$pid" 2>/dev/null; then
          break
        fi
        sleep 0.2
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -KILL "$pid" >/dev/null 2>&1 || true
      fi
    fi
    rm -f "$PID_FILE"
  fi

  if [ -f "$VITE_PID_FILE" ]; then
    pid="$(cat "$VITE_PID_FILE" 2>/dev/null || true)"
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" >/dev/null 2>&1 || true
      for _ in {1..20}; do
        if ! kill -0 "$pid" 2>/dev/null; then
          break
        fi
        sleep 0.2
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -KILL "$pid" >/dev/null 2>&1 || true
      fi
    fi
    rm -f "$VITE_PID_FILE"
  fi

  local pids=""
  pids="$(lsof -ti tcp:8788 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -TERM >/dev/null 2>&1 || true
    sleep 1
    pids="$(lsof -ti tcp:8788 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      echo "$pids" | xargs kill -KILL >/dev/null 2>&1 || true
    fi
  fi

  pids="$(lsof -ti tcp:$VITE_PORT 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -TERM >/dev/null 2>&1 || true
    sleep 1
    pids="$(lsof -ti tcp:$VITE_PORT 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      echo "$pids" | xargs kill -KILL >/dev/null 2>&1 || true
    fi
  fi
}

# Stop old PID file process if present
stop_server

echo "Starting edge + Vite on fixed port $VITE_PORT ..."
start_servers
wait_for_servers

if [ "$READY" -eq 1 ]; then
  open "http://localhost:$VITE_PORT/"
  while true; do
    echo ""
    echo "Ready: app http://localhost:$VITE_PORT/  api http://127.0.0.1:8788"
    echo "R restart  Q quit  L edge log  V vite log"
    read -rs -k 1 response
    if [[ "$response" == "q" ]] || [[ "$response" == "Q" ]]; then
      stop_server
      exit 0
    fi
    if [[ "$response" == "l" ]] || [[ "$response" == "L" ]]; then
      tail -n 80 "$LOG_FILE" || true
      continue
    fi
    if [[ "$response" == "v" ]] || [[ "$response" == "V" ]]; then
      tail -n 80 "$VITE_LOG_FILE" || true
      continue
    fi
    if [[ "$response" == "r" ]] || [[ "$response" == "R" ]]; then
      echo "Restarting edge + Vite ..."
      stop_server
      start_servers
      wait_for_servers
      if [ "$READY" -eq 1 ]; then
        open "http://localhost:$VITE_PORT/"
        echo "Ready again."
      fi
    fi
  done
else
  osascript -e 'display alert "LinkSim start timed out" message "Open .tmp/local-edge.log and .tmp/local-vite.log for details." as warning'
fi

exit 0
