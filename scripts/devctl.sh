#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${RUN_DIR:-$ROOT_DIR/.run}"
LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
TAIL_LINES="${TAIL_LINES:-80}"

APP_NAME="github-app"
WORKER_NAME="planner-worker"
APP_PID_FILE="$RUN_DIR/$APP_NAME.pid"
WORKER_PID_FILE="$RUN_DIR/$WORKER_NAME.pid"
APP_LOG_FILE="$LOG_DIR/$APP_NAME.log"
WORKER_LOG_FILE="$LOG_DIR/$WORKER_NAME.log"

cd "$ROOT_DIR"

load_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    return
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="$(printf '%s' "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    line="${line#export }"
    [[ "$line" != *=* ]] && continue

    local key="${line%%=*}"
    local val="${line#*=}"

    key="$(printf '%s' "$key" | sed -e 's/[[:space:]]//g')"
    if [[ -n "${!key+x}" ]]; then
      continue
    fi

    if [[ "$val" =~ ^\".*\"$ ]]; then
      val="${val:1:${#val}-2}"
    elif [[ "$val" =~ ^\'.*\'$ ]]; then
      val="${val:1:${#val}-2}"
    fi

    export "$key=$val"
  done < "$ENV_FILE"
}

ensure_dirs() {
  mkdir -p "$RUN_DIR" "$LOG_DIR"
}

is_running() {
  local pid_file="$1"

  if [[ ! -f "$pid_file" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$pid_file")"
  if [[ -z "$pid" ]]; then
    return 1
  fi

  if kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  rm -f "$pid_file"
  return 1
}

start_proc() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  shift 3

  if is_running "$pid_file"; then
    echo "$name already running (pid $(cat "$pid_file"))"
    return 0
  fi

  nohup "$@" >> "$log_file" 2>&1 &
  local pid=$!
  echo "$pid" > "$pid_file"

  sleep 0.6
  if kill -0 "$pid" 2>/dev/null; then
    echo "started $name (pid $pid)"
    return 0
  fi

  echo "failed to start $name; recent log output:"
  tail -n 40 "$log_file" || true
  return 1
}

stop_proc() {
  local name="$1"
  local pid_file="$2"

  if ! is_running "$pid_file"; then
    echo "$name not running"
    rm -f "$pid_file"
    return 0
  fi

  local pid
  pid="$(cat "$pid_file")"
  kill "$pid" 2>/dev/null || true

  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$pid_file"
      echo "stopped $name"
      return 0
    fi
    sleep 0.2
  done

  kill -9 "$pid" 2>/dev/null || true
  rm -f "$pid_file"
  echo "force-stopped $name"
}

status_proc() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"

  if is_running "$pid_file"; then
    echo "$name: running (pid $(cat "$pid_file")) log=$log_file"
  else
    echo "$name: stopped"
  fi
}

start_all() {
  ensure_dirs
  load_env_file

  if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
    echo "building TypeScript projects..."
    npm run build > "$LOG_DIR/build.log" 2>&1
    echo "build complete (log: $LOG_DIR/build.log)"
  fi

  start_proc "$WORKER_NAME" "$WORKER_PID_FILE" "$WORKER_LOG_FILE" node apps/planner-worker/dist/index.js
  start_proc "$APP_NAME" "$APP_PID_FILE" "$APP_LOG_FILE" node apps/github-app/dist/index.js
}

stop_all() {
  stop_proc "$APP_NAME" "$APP_PID_FILE"
  stop_proc "$WORKER_NAME" "$WORKER_PID_FILE"
}

status_all() {
  status_proc "$APP_NAME" "$APP_PID_FILE" "$APP_LOG_FILE"
  status_proc "$WORKER_NAME" "$WORKER_PID_FILE" "$WORKER_LOG_FILE"
}

logs_all() {
  local follow="${1:-}"

  if [[ "$follow" == "--follow" ]]; then
    tail -n "$TAIL_LINES" -f "$APP_LOG_FILE" "$WORKER_LOG_FILE"
    return
  fi

  echo "--- $APP_LOG_FILE ---"
  tail -n "$TAIL_LINES" "$APP_LOG_FILE" 2>/dev/null || echo "(no log file yet)"
  echo
  echo "--- $WORKER_LOG_FILE ---"
  tail -n "$TAIL_LINES" "$WORKER_LOG_FILE" 2>/dev/null || echo "(no log file yet)"
}

usage() {
  cat <<USAGE
Usage: scripts/devctl.sh <command>

Commands:
  start      Build (unless SKIP_BUILD=1) and start app + worker
  stop       Stop app + worker
  restart    Stop, then start
  status     Show process status
  logs       Show recent logs
  logs --follow  Follow logs live
USAGE
}

command="${1:-}"
case "$command" in
  start)
    start_all
    ;;
  stop)
    stop_all
    ;;
  restart)
    stop_all
    start_all
    ;;
  status)
    status_all
    ;;
  logs)
    logs_all "${2:-}"
    ;;
  *)
    usage
    exit 1
    ;;
esac
