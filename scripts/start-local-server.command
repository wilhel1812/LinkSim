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

cleanup_stale() {
  echo "Cleaning up stale processes..."
  local pids
  pids="$(lsof -ti tcp:8788 2>/dev/null || true)"
  [ -n "$pids" ] && echo "$pids" | xargs kill -TERM >/dev/null 2>&1 || true
  sleep 1
  pids="$(lsof -ti tcp:8788 2>/dev/null || true)"
  [ -n "$pids" ] && echo "$pids" | xargs kill -KILL >/dev/null 2>&1 || true

  pids="$(lsof -ti tcp:$VITE_PORT 2>/dev/null || true)"
  [ -n "$pids" ] && echo "$pids" | xargs kill -TERM >/dev/null 2>&1 || true
  sleep 1
  pids="$(lsof -ti tcp:$VITE_PORT 2>/dev/null || true)"
  [ -n "$pids" ] && echo "$pids" | xargs kill -KILL >/dev/null 2>&1 || true

  pkill -f "esbuild.*esbuild" >/dev/null 2>&1 || true
  pkill -f "workerd" >/dev/null 2>&1 || true
  echo "Done."
}

start_edge() {
  nohup npm run dev:edge > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
}

start_vite() {
  : > "$VITE_LOG_FILE"
  nohup npm run dev -- --host 127.0.0.1 --port "$VITE_PORT" --strictPort > "$VITE_LOG_FILE" 2>&1 &
  echo $! > "$VITE_PID_FILE"
}

wait_for_servers() {
  READY=0
  for i in {1..150}; do
    EDGE_OK=0
    VITE_OK=0
    if [ "$START_EDGE" -eq 1 ]; then
      if [ -f "$PID_FILE" ]; then
        PID="$(cat "$PID_FILE" 2>/dev/null || true)"
        if [ -n "${PID:-}" ] && ! kill -0 "$PID" 2>/dev/null; then
          echo "Edge server exited during startup."
          tail -n 80 "$LOG_FILE" || true
        else
          curl -fsS "http://127.0.0.1:8788" >/dev/null 2>&1 && EDGE_OK=1
        fi
      fi
    else
      EDGE_OK=1
    fi
    if [ "$START_VITE" -eq 1 ]; then
      if [ -f "$VITE_PID_FILE" ]; then
        VITE_PID="$(cat "$VITE_PID_FILE" 2>/dev/null || true)"
        if [ -n "${VITE_PID:-}" ] && ! kill -0 "$VITE_PID" 2>/dev/null; then
          echo "Vite server exited during startup."
          tail -n 80 "$VITE_LOG_FILE" || true
        else
          curl -fsS "http://127.0.0.1:$VITE_PORT" >/dev/null 2>&1 && VITE_OK=1
        fi
      fi
    else
      VITE_OK=1
    fi
    if [ "$EDGE_OK" -eq 1 ] && [ "$VITE_OK" -eq 1 ]; then
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

# Clean up stale processes from previous sessions, then stop old PID file process
cleanup_stale
stop_server

echo "Choose mode:"
echo "  E - Edge only (faster, no live CSS)"
echo "  B - Both edge + Vite (live reload)"
echo ""
printf "Mode [E/B]? "
read -rs -k 1 MODE
echo ""

START_EDGE=1
START_VITE=0
if [[ "$MODE" == "b" ]] || [[ "$MODE" == "B" ]]; then
  START_VITE=1
fi

echo "Starting..."
if [ "$START_EDGE" -eq 1 ]; then
  echo "  - Edge (http://127.0.0.1:8788)"
fi
if [ "$START_VITE" -eq 1 ]; then
  echo "  - Vite (http://localhost:$VITE_PORT)"
fi

: > "$LOG_FILE"
[ "$START_VITE" -eq 1 ] && : > "$VITE_LOG_FILE"

[ "$START_EDGE" -eq 1 ] && start_edge
[ "$START_VITE" -eq 1 ] && start_vite

wait_for_servers

if [ "$READY" -eq 1 ]; then
  if [ "$START_VITE" -eq 1 ]; then
    open "http://localhost:$VITE_PORT/"
  fi
  while true; do
    echo ""
    if [ "$START_VITE" -eq 1 ]; then
      echo "Ready: app http://localhost:$VITE_PORT/  api http://127.0.0.1:8788"
      echo "R restart  Q quit  L edge log  V vite log"
    else
      echo "Ready: api http://127.0.0.1:8788"
      echo "R restart  Q quit  L edge log"
    fi
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
      echo "Restarting..."
      stop_server
      [ "$START_EDGE" -eq 1 ] && start_edge
      [ "$START_VITE" -eq 1 ] && start_vite
      wait_for_servers
      if [ "$READY" -eq 1 ]; then
        [ "$START_VITE" -eq 1 ] && open "http://localhost:$VITE_PORT/"
        echo "Ready again."
      fi
    fi
  done
else
  osascript -e 'display alert "LinkSim start timed out" message "Open .tmp/local-edge.log and .tmp/local-vite.log for details." as warning'
fi

exit 0
