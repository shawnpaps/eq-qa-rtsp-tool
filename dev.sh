#!/usr/bin/env bash
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

function info() { echo -e "${BLUE}ℹ${NC}  $1"; }
function success() { echo -e "${GREEN}✔${NC}  $1"; }
function warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
function error() { echo -e "${RED}✖${NC}  $1"; }

# Check dependencies
function check_deps() {
  local missing=()
  command -v node >/dev/null 2>&1 || missing+=("Node.js")
  command -v npm >/dev/null 2>&1 || missing+=("npm")
  command -v ffmpeg >/dev/null 2>&1 || missing+=("FFmpeg")

  if [ ${#missing[@]} -ne 0 ]; then
    error "Missing dependencies: ${missing[*]}"
    echo "   Install them first, then re-run this script."
    exit 1
  fi
}

# Start MediaMTX via Docker
dev_mediamtx=""
function start_mediamtx() {
  if docker compose ps mediamtx 2>/dev/null | grep -q "Up"; then
    info "MediaMTX is already running via Docker Compose"
    dev_mediamtx="already-running"
    return
  fi

  info "Starting MediaMTX via Docker..."
  if ! docker compose up -d mediamtx 2>/tmp/mediamtx.log; then
    warn "Docker Compose failed to start MediaMTX. Is Docker running?"
    dev_mediamtx="failed"
    return
  fi
  sleep 2

  if docker compose ps mediamtx 2>/dev/null | grep -q "Up"; then
    success "MediaMTX started on port 8554"
    dev_mediamtx="started"
  else
    warn "MediaMTX container did not come up — RTSP streaming will not work"
    if [ -f /tmp/mediamtx.log ]; then
      echo
      cat /tmp/mediamtx.log
      echo
    fi
    docker compose logs mediamtx --tail=10 2>/dev/null || true
  fi
}

# Install dependencies if node_modules missing
function ensure_deps() {
  local dir=$1
  if [ ! -d "$dir/node_modules" ]; then
    info "Installing dependencies in $dir/ ..."
    (cd "$dir" && npm install)
    success "Dependencies installed for $dir"
  fi
}

function kill_port() {
  local port=$1
  lsof -ti :"$port" | xargs kill -9 2>/dev/null || true
}

# Cleanup on exit / signal
cleanup_ran=false
function cleanup() {
  if [ "$cleanup_ran" = true ]; then return; fi
  cleanup_ran=true

  echo
  info "Shutting down dev servers..."
  if [ -n "${backend_pid:-}" ]; then kill "$backend_pid" 2>/dev/null || true; fi
  if [ -n "${frontend_pid:-}" ]; then kill "$frontend_pid" 2>/dev/null || true; fi
  # Also kill by port in case PIDs are stale
  kill_port 3000
  kill_port 5173
  if [ "$dev_mediamtx" = "started" ]; then
    docker compose down mediamtx >/dev/null 2>&1 || true
  fi
  success "Done."
}
trap cleanup EXIT INT TERM

# ── Main ──
echo -e "${GREEN}RTSP Stream Tool — Dev Mode${NC}"
echo

check_deps

# Clear stale ports from previous runs
for port in 3000 5173; do
  if lsof -ti :"$port" >/dev/null 2>&1; then
    info "Clearing stale process on port $port ..."
    kill_port "$port"
  fi
done

ensure_deps "backend"
ensure_deps "frontend"
start_mediamtx

echo
info "Starting backend (node --watch) ..."
cd backend
NODE_ENV=development PORT=3000 \
  MEDIAMTX_HOST=localhost MEDIAMTX_PORT=8554 DATA_DIR=../data \
  npm run dev &
backend_pid=$!
cd ..
success "Backend PID: $backend_pid  → http://localhost:3000"

sleep 1

info "Starting frontend (vite) ..."
cd frontend
npm run dev &
frontend_pid=$!
cd ..
success "Frontend PID: $frontend_pid  → http://localhost:5173"

echo
info "Press Ctrl+C to stop everything."
wait || true
