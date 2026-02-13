#!/bin/sh
# ═══════════════════════════════════════════════════════════
# LexWatch — iSH Setup Script
# Run this ONCE after cloning the repository on your iPhone
# ═══════════════════════════════════════════════════════════

set -e

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   LexWatch iSH Setup                ║"
echo "║   This will take a while on iSH     ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── 1. Install system packages ──────────────────────────
echo "[1/5] Installing system packages..."
apk update
apk add python3 py3-pip py3-virtualenv nodejs npm \
        gcc musl-dev python3-dev libffi-dev openssl-dev \
        make g++

# ── 2. Setup Python backend ─────────────────────────────
echo ""
echo "[2/5] Setting up Python backend..."
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate
cd ..

# ── 3. Build frontend ───────────────────────────────────
echo ""
echo "[3/5] Installing frontend dependencies (slow on iSH, please wait)..."
cd frontend
npm install

echo ""
echo "[4/5] Building frontend..."
npm run build
cd ..

# ── 4. Create .env ──────────────────────────────────────
echo ""
echo "[5/5] Creating .env config..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env from .env.example"
else
    echo ".env already exists, skipping"
fi

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   Setup complete!                   ║"
echo "║                                     ║"
echo "║   Optional: edit .env to add your   ║"
echo "║   OpenAI API key for AI summaries   ║"
echo "║                                     ║"
echo "║   Start with:  sh start.sh          ║"
echo "║   Open Safari: http://localhost:8000 ║"
echo "╚══════════════════════════════════════╝"
echo ""
