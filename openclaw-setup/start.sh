#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# ================================================================
# Farben
# ================================================================
BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RED="\033[31m"
RESET="\033[0m"

ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; }
info() { echo -e "  ${CYAN}→${RESET} $1"; }
ask()  { echo -en "  ${YELLOW}?${RESET} $1"; }

# ================================================================
# Header
# ================================================================
echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║  OpenClaw — Legal AI Assistent (Sandboxed)           ║${RESET}"
echo -e "${BOLD}║  Outlook + Teams → Claude → WhatsApp                 ║${RESET}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════╝${RESET}"
echo ""

# ================================================================
# Docker Check
# ================================================================
if ! command -v docker &>/dev/null; then
  fail "Docker nicht gefunden."
  echo ""
  echo "  Installieren:"
  echo "    macOS:   brew install --cask docker"
  echo "    Ubuntu:  curl -fsSL https://get.docker.com | sh"
  echo "    Windows: https://docs.docker.com/desktop/install/windows-install/"
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  fail "Docker-Daemon läuft nicht. Bitte Docker Desktop starten."
  exit 1
fi
ok "Docker"

# ================================================================
# Interaktiver Setup (wenn .env fehlt oder --setup Flag)
# ================================================================
if [ ! -f .env ] || [ "${1:-}" = "--setup" ]; then
  echo ""
  echo -e "${BOLD}  Ersteinrichtung — 4 Fragen, dann läuft alles.${RESET}"
  echo ""

  # --- 1. API Key ---
  echo -e "  ${BOLD}1/4 Anthropic API Key${RESET}"
  echo -e "  ${DIM}Hol dir einen auf: https://console.anthropic.com → API Keys${RESET}"
  ask "API Key: "
  read -r API_KEY
  if [ -z "$API_KEY" ]; then
    fail "Ohne API Key geht nichts."
    exit 1
  fi
  ok "API Key"
  echo ""

  # --- 2. Email ---
  echo -e "  ${BOLD}2/4 Deine E-Mail-Adresse${RESET}"
  echo -e "  ${DIM}Dorthin sendet OpenClaw alle Entwürfe. Auch für IMAP/SMTP.${RESET}"
  ask "E-Mail (z.B. name@kanzlei.at): "
  read -r EMAIL
  if [ -z "$EMAIL" ]; then
    fail "E-Mail-Adresse benötigt."
    exit 1
  fi
  ok "$EMAIL"
  echo ""

  # --- Domain → Server ableiten ---
  DOMAIN="${EMAIL##*@}"
  case "$DOMAIN" in
    outlook.com|hotmail.com|live.com|*.onmicrosoft.com)
      IMAP_SRV="outlook.office365.com"
      SMTP_SRV="smtp.office365.com"
      SMTP_PRT="587"
      ;;
    gmail.com|googlemail.com)
      IMAP_SRV="imap.gmail.com"
      SMTP_SRV="smtp.gmail.com"
      SMTP_PRT="587"
      ;;
    *)
      # Microsoft 365 Custom Domain (häufigster Fall bei Kanzleien)
      IMAP_SRV="outlook.office365.com"
      SMTP_SRV="smtp.office365.com"
      SMTP_PRT="587"
      ;;
  esac
  info "Server erkannt: IMAP=${IMAP_SRV}, SMTP=${SMTP_SRV}"
  echo ""

  # --- 3. Passwort ---
  echo -e "  ${BOLD}3/4 App-Passwort${RESET}"
  echo ""
  echo -e "  ${DIM}Dein normales Passwort funktioniert NICHT (wegen MFA/2FA).${RESET}"
  echo -e "  ${DIM}So erstellst du ein App-Passwort:${RESET}"
  echo ""
  echo -e "  ${CYAN}Microsoft 365:${RESET}"
  echo "    1. https://mysignins.microsoft.com/security-info"
  echo "    2. '+ Anmeldemethode hinzufügen' → 'App-Kennwort'"
  echo "    3. Name vergeben (z.B. 'OpenClaw') → Passwort kopieren"
  echo ""
  echo -e "  ${CYAN}Gmail:${RESET}"
  echo "    1. https://myaccount.google.com/apppasswords"
  echo "    2. App-Name vergeben → Passwort kopieren"
  echo ""
  ask "App-Passwort: "
  read -rs APP_PW
  echo ""
  if [ -z "$APP_PW" ]; then
    fail "Passwort benötigt."
    exit 1
  fi
  ok "Passwort gespeichert (wird nie angezeigt)"
  echo ""

  # --- 4. Teams (optional) ---
  echo -e "  ${BOLD}4/4 Teams-Webhook (optional, Enter zum Überspringen)${RESET}"
  echo -e "  ${DIM}Teams → Kanal → ··· → Connectors → Incoming Webhook → URL${RESET}"
  ask "Teams-Webhook-URL (oder Enter): "
  read -r TEAMS_WH
  if [ -n "$TEAMS_WH" ]; then
    ok "Teams-Webhook gesetzt"
  else
    info "Teams übersprungen — kannst du später nachrüsten"
  fi
  echo ""

  # --- .env schreiben ---
  cat > .env <<ENVFILE
# Generiert von start.sh am $(date +%Y-%m-%d)
ANTHROPIC_API_KEY=${API_KEY}
MY_EMAIL=${EMAIL}
IMAP_SERVER=${IMAP_SRV}
IMAP_USER=${EMAIL}
IMAP_PASSWORD=${APP_PW}
IMAP_FOLDER=INBOX
SMTP_SERVER=${SMTP_SRV}
SMTP_PORT=${SMTP_PRT}
SMTP_USER=${EMAIL}
SMTP_PASSWORD=${APP_PW}
TEAMS_OUTGOING_WEBHOOK=${TEAMS_WH}
POLL_INTERVAL_SECONDS=30
ENVFILE

  ok ".env geschrieben"
  echo ""
fi

# ================================================================
# Validierung
# ================================================================
source .env 2>/dev/null || true

if [ -z "${ANTHROPIC_API_KEY:-}" ] || [ "$ANTHROPIC_API_KEY" = "sk-ant-HIER-DEINEN-KEY" ]; then
  fail "ANTHROPIC_API_KEY fehlt. Nochmal: ./start.sh --setup"
  exit 1
fi

if [ -z "${MY_EMAIL:-}" ] || [ "$MY_EMAIL" = "du@deinekanzlei.at" ]; then
  fail "MY_EMAIL fehlt. Nochmal: ./start.sh --setup"
  exit 1
fi

if [ -z "${IMAP_PASSWORD:-}" ] || [ "$IMAP_PASSWORD" = "HIER-DEIN-PASSWORT" ]; then
  fail "IMAP_PASSWORD fehlt. Nochmal: ./start.sh --setup"
  exit 1
fi

ok "Konfiguration"

# ================================================================
# Start
# ================================================================
echo ""
info "Starte Bridge + OpenClaw ..."
docker compose up -d --build 2>&1 | tail -5

echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "  ${GREEN}${BOLD}✓ Alles läuft!${RESET}"
echo ""
echo "  OpenClaw Web UI:   http://localhost:18789"
echo "  Bridge Health:     http://localhost:8080/health"
echo ""
echo -e "  ${BOLD}Nächster Schritt: WhatsApp verbinden${RESET}"
echo "  Führe aus:  docker logs -f openclaw-sandbox"
echo "  Dann QR-Code mit WhatsApp scannen."
echo ""
if [ -n "${TEAMS_OUTGOING_WEBHOOK:-}" ] && [ "$TEAMS_OUTGOING_WEBHOOK" != "https://deinefirma.webhook.office.com/webhookb2/..." ]; then
  echo "  Teams-Webhook empfängt auf:"
  echo "    http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'DEIN-LAPTOP'):8080/webhook/teams"
  echo ""
fi
echo "  Stoppen:       docker compose down"
echo "  Neu einrichten: ./start.sh --setup"
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════${RESET}"
