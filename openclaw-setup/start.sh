#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo ""
echo "╔═══════════════════════════════════════════════════════╗"
echo "║  OpenClaw — Legal AI Assistent (Sandboxed)           ║"
echo "║  Outlook + Teams → Claude → WhatsApp                 ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

# --- Checks ---
if ! command -v docker &>/dev/null; then
  echo "✗ Docker nicht gefunden."
  echo "  macOS:   brew install --cask docker"
  echo "  Ubuntu:  curl -fsSL https://get.docker.com | sh"
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  echo "✗ Docker-Daemon läuft nicht. Bitte Docker Desktop starten."
  exit 1
fi
echo "✓ Docker OK"

# --- .env ---
if [ ! -f .env ]; then
  echo ""
  echo "  Noch keine .env-Datei gefunden."
  echo "  Kopiere .env.example und trage deine Daten ein:"
  echo ""
  echo "    cp .env.example .env"
  echo "    nano .env            # oder vim / code"
  echo ""
  echo "  Mindestens nötig:"
  echo "    ANTHROPIC_API_KEY    — Claude API Key"
  echo "    MY_EMAIL             — Deine E-Mail-Adresse"
  echo "    IMAP_SERVER/USER/PW  — Für Outlook-Weiterleitung"
  echo "    SMTP_SERVER/USER/PW  — Für den Entwurf-Versand"
  echo ""
  cp .env.example .env
  echo "  .env.example wurde als .env kopiert. Bitte ausfüllen."
  exit 0
fi

echo "✓ .env vorhanden"

# --- Quick validation ---
source .env 2>/dev/null || true
if [ -z "${ANTHROPIC_API_KEY:-}" ] || [ "$ANTHROPIC_API_KEY" = "sk-ant-HIER-DEINEN-KEY" ]; then
  echo "✗ ANTHROPIC_API_KEY in .env ist leer oder Platzhalter."
  echo "  Bitte eintragen: nano .env"
  exit 1
fi
echo "✓ API Key gesetzt"

if [ -z "${MY_EMAIL:-}" ] || [ "$MY_EMAIL" = "du@deinekanzlei.at" ]; then
  echo "✗ MY_EMAIL in .env ist leer oder Platzhalter."
  exit 1
fi
echo "✓ E-Mail-Empfänger: ${MY_EMAIL}"

# --- Start ---
echo ""
echo "→ Starte Bridge + OpenClaw ..."
docker compose up -d --build

echo ""
echo "════════════════════════════════════════════════════════"
echo ""
echo "  ✓ Alles läuft!"
echo ""
echo "  OpenClaw Web UI:   http://localhost:18789"
echo "  Bridge Health:     http://localhost:8080/health"
echo ""
echo "  Nächster Schritt: WhatsApp verbinden"
echo "  → docker logs -f openclaw-sandbox"
echo "    (QR-Code scannen, wenn er erscheint)"
echo ""
echo "  Teams-Webhook empfängt auf:"
echo "    http://DEIN-LAPTOP:8080/webhook/teams"
echo ""
echo "  Stoppen:   docker compose down"
echo "  Logs:      docker compose logs -f"
echo "  Reset:     docker compose down -v && rm -rf workspace/sent/*"
echo ""
echo "════════════════════════════════════════════════════════"
