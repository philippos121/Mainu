#!/usr/bin/env bash
#
# OpenClaw Setup Wizard — One-Command Launcher
#
# Usage:
#   ./start.sh              — Start wizard on port 9090
#   ./start.sh --port 8080  — Start wizard on custom port
#   ./start.sh --no-docker  — Run wizard directly (no Docker, needs Python 3.12+)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

WIZARD_PORT=9090
USE_DOCKER=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)    WIZARD_PORT="$2"; shift 2 ;;
    --no-docker) USE_DOCKER=false; shift ;;
    -h|--help)
      echo "Usage: $0 [--port PORT] [--no-docker]"
      echo ""
      echo "  --port PORT    Wizard-UI port (default: 9090)"
      echo "  --no-docker    Run wizard directly with Python (needs pip, Python 3.12+)"
      echo ""
      echo "After starting, open http://localhost:\$PORT in your browser."
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p data

echo "╔══════════════════════════════════════════════════╗"
echo "║       OpenClaw Sandbox Setup Wizard              ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Guided setup for OpenClaw in Docker.            ║"
echo "║  Minimum work. Maximum sandbox.                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# --- Check Docker ---
if ! command -v docker &>/dev/null; then
  echo "⚠ Docker not found."
  echo ""
  echo "Install Docker first:"
  echo "  macOS:   brew install --cask docker"
  echo "  Ubuntu:  curl -fsSL https://get.docker.com | sh"
  echo "  Windows: https://docs.docker.com/desktop/install/windows-install/"
  echo ""
  echo "Or run with --no-docker (needs Python 3.12+)."
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  echo "⚠ Docker daemon is not running. Please start Docker Desktop or dockerd."
  exit 1
fi

echo "✓ Docker OK"

if [ "$USE_DOCKER" = true ]; then
  echo "→ Building wizard image..."
  WIZARD_PORT="$WIZARD_PORT" docker compose build setup-wizard 2>&1 | tail -3
  echo "→ Starting wizard on port $WIZARD_PORT..."
  WIZARD_PORT="$WIZARD_PORT" docker compose up -d setup-wizard
  echo ""
  echo "════════════════════════════════════════════"
  echo "  Open http://localhost:${WIZARD_PORT}"
  echo "  to configure and start OpenClaw."
  echo "════════════════════════════════════════════"
else
  echo "→ Running without Docker (local Python)..."
  if ! command -v python3 &>/dev/null; then
    echo "⚠ Python 3 not found. Install Python 3.12+."
    exit 1
  fi
  if [ ! -d ".venv" ]; then
    echo "→ Creating virtualenv..."
    python3 -m venv .venv
  fi
  source .venv/bin/activate
  pip install -q -r requirements.txt
  echo ""
  echo "════════════════════════════════════════════"
  echo "  Open http://localhost:${WIZARD_PORT}"
  echo "════════════════════════════════════════════"
  echo ""
  uvicorn app.main:app --host 0.0.0.0 --port "$WIZARD_PORT"
fi
