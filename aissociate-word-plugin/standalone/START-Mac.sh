#!/bin/bash
# AI:ssociate - Legal AI Word Plugin — Mac/Linux starter

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=3000

echo ""
echo " ============================================="
echo "  AI:ssociate - Legal AI Word Plugin"
echo " ============================================="
echo ""
echo " Starting local server at http://localhost:$PORT"
echo " Keep this window open while using Word."
echo " Press Ctrl+C to stop."
echo ""

# Python 3 (comes pre-installed on macOS)
if command -v python3 &>/dev/null; then
    echo " Using Python3"
    cd "$DIR" && python3 -m http.server $PORT
    exit 0
fi

if command -v python &>/dev/null; then
    echo " Using Python"
    cd "$DIR" && python -m http.server $PORT
    exit 0
fi

# Node.js fallback
if command -v node &>/dev/null; then
    echo " Using Node.js"
    npx --yes http-server "$DIR" -p $PORT --cors -o
    exit 0
fi

echo " ERROR: Python or Node.js is required but not found."
echo ""
echo " Install Python (free): https://www.python.org/downloads/"
echo " Or Node.js (free):     https://nodejs.org/"
echo ""
read -p "Press Enter to close..."
