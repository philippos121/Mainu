#!/bin/sh
# ═══════════════════════════════════════════════════════════
# LexWatch — Start the app on iSH
# Open http://localhost:8000 in Safari after starting
# ═══════════════════════════════════════════════════════════

cd "$(dirname "$0")/backend"

echo ""
echo "Starting LexWatch..."
echo "Open Safari and go to: http://localhost:8000"
echo "Press Ctrl+C to stop"
echo ""

. .venv/bin/activate
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000
