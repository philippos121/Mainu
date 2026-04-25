"""Message Bridge — Verbindet Outlook + Teams mit OpenClaw's Workspace.

Drei Jobs laufen parallel:
1. IMAP-Poller: Holt neue Emails aus dem Weiterleitungs-Postfach → workspace/inbox/
2. Teams-Webhook: Empfängt Power-Automate-Nachrichten → workspace/inbox/
3. Outbox-Poller: Überwacht workspace/outbox/email/ und workspace/outbox/teams/
   → Sendet Emails per SMTP bzw. Teams-Nachrichten per Power Automate Webhook
   → Verschiebt gesendete Dateien nach workspace/sent/
"""

from __future__ import annotations

import asyncio
import email
import email.utils
import imaplib
import json
import logging
import os
import re
import shutil
import smtplib
import time
from datetime import datetime
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
)
log = logging.getLogger("bridge")

app = FastAPI(title="OpenClaw Message Bridge")

WORKSPACE = Path(os.environ.get("WORKSPACE_DIR", "/workspace"))
INBOX = WORKSPACE / "inbox"
OUTBOX_EMAIL = WORKSPACE / "outbox" / "email"
OUTBOX_TEAMS = WORKSPACE / "outbox" / "teams"
SENT = WORKSPACE / "sent"

for d in [INBOX, OUTBOX_EMAIL, OUTBOX_TEAMS, SENT]:
    d.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# IMAP Poller — Outlook-Emails abholen
# ---------------------------------------------------------------------------

def _sanitize(name: str) -> str:
    return re.sub(r'[^\w\-.]', '_', name)[:80]


def poll_imap_once() -> int:
    server = os.environ.get("IMAP_SERVER", "")
    user = os.environ.get("IMAP_USER", "")
    password = os.environ.get("IMAP_PASSWORD", "")
    folder = os.environ.get("IMAP_FOLDER", "INBOX")

    if not all([server, user, password]):
        return 0

    count = 0
    try:
        conn = imaplib.IMAP4_SSL(server)
        conn.login(user, password)
        conn.select(folder)
        _, msg_ids = conn.search(None, "UNSEEN")
        for mid in msg_ids[0].split():
            if not mid:
                continue
            _, data = conn.fetch(mid, "(RFC822)")
            raw = data[0][1]
            msg = email.message_from_bytes(raw)

            subject = msg.get("Subject", "(kein Betreff)")
            sender = msg.get("From", "unbekannt")
            date_str = msg.get("Date", "")
            body = _extract_body(msg)

            ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
            slug = _sanitize(subject)
            filename = f"{ts}_outlook_{slug}.md"

            content = (
                f"# E-Mail: {subject}\n\n"
                f"- **Von:** {sender}\n"
                f"- **Datum:** {date_str}\n"
                f"- **Quelle:** Outlook (IMAP)\n\n"
                f"---\n\n{body}\n"
            )
            (INBOX / filename).write_text(content, encoding="utf-8")
            conn.store(mid, "+FLAGS", "\\Seen")
            count += 1
            log.info("Neue Email: %s", filename)

        conn.close()
        conn.logout()
    except Exception as e:
        log.error("IMAP-Fehler: %s", e)

    return count


def _extract_body(msg: email.message.Message) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode("utf-8", errors="replace")
        for part in msg.walk():
            ct = part.get_content_type()
            if ct == "text/html":
                payload = part.get_payload(decode=True)
                if payload:
                    return f"(HTML-Email)\n\n{payload.decode('utf-8', errors='replace')}"
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            return payload.decode("utf-8", errors="replace")
    return "(Kein lesbarer Inhalt)"


# ---------------------------------------------------------------------------
# Teams Webhook — Power Automate sendet hierher
# ---------------------------------------------------------------------------

@app.post("/webhook/teams")
async def teams_webhook(request: Request):
    """Empfängt eine Teams-Nachricht von Power Automate.

    Erwartetes JSON:
    {
      "from": "Max Mustermann",
      "channel": "#legal-team",
      "message": "...",
      "timestamp": "2026-04-25T14:30:00Z"
    }
    """
    try:
        data = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid JSON"})

    sender = data.get("from", "unbekannt")
    channel = data.get("channel", "")
    message = data.get("message", "")
    timestamp = data.get("timestamp", "")

    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    slug = _sanitize(channel or sender)
    filename = f"{ts}_teams_{slug}.md"

    content = (
        f"# Teams-Nachricht\n\n"
        f"- **Von:** {sender}\n"
        f"- **Kanal:** {channel}\n"
        f"- **Datum:** {timestamp}\n"
        f"- **Quelle:** Microsoft Teams\n\n"
        f"---\n\n{message}\n"
    )
    (INBOX / filename).write_text(content, encoding="utf-8")
    log.info("Neue Teams-Nachricht: %s", filename)
    return {"ok": True, "file": filename}


@app.get("/health")
async def health():
    inbox_count = len(list(INBOX.glob("*.md")))
    outbox_email_count = len(list(OUTBOX_EMAIL.glob("*.md")))
    outbox_teams_count = len(list(OUTBOX_TEAMS.glob("*.md")))
    sent_count = len(list(SENT.glob("*.md")))
    return {
        "status": "ok",
        "inbox": inbox_count,
        "outbox_email": outbox_email_count,
        "outbox_teams": outbox_teams_count,
        "sent": sent_count,
    }


# ---------------------------------------------------------------------------
# Outbox Poller — Sendet Emails und Teams-Nachrichten
# ---------------------------------------------------------------------------

def send_outbox_emails() -> int:
    smtp_server = os.environ.get("SMTP_SERVER", "")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_password = os.environ.get("SMTP_PASSWORD", "")
    recipient = os.environ.get("MY_EMAIL", "")

    if not all([smtp_server, smtp_user, smtp_password, recipient]):
        return 0

    count = 0
    for f in sorted(OUTBOX_EMAIL.glob("*.md")):
        try:
            text = f.read_text(encoding="utf-8")
            subject = _extract_subject(text) or f"OpenClaw Entwurf: {f.stem}"

            msg = MIMEText(text, "plain", "utf-8")
            msg["From"] = smtp_user
            msg["To"] = recipient
            msg["Subject"] = subject
            msg["X-OpenClaw"] = "draft"

            with smtplib.SMTP(smtp_server, smtp_port) as srv:
                srv.starttls()
                srv.login(smtp_user, smtp_password)
                srv.send_message(msg)

            dest = SENT / f"email_{f.name}"
            shutil.move(str(f), str(dest))
            count += 1
            log.info("Email gesendet: %s → %s", f.name, recipient)
        except Exception as e:
            log.error("Email-Sende-Fehler (%s): %s", f.name, e)

    return count


def send_outbox_teams() -> int:
    webhook_url = os.environ.get("TEAMS_OUTGOING_WEBHOOK", "")
    if not webhook_url:
        return 0

    count = 0
    for f in sorted(OUTBOX_TEAMS.glob("*.md")):
        try:
            text = f.read_text(encoding="utf-8")

            payload = {"text": text}
            resp = httpx.post(webhook_url, json=payload, timeout=15)
            resp.raise_for_status()

            dest = SENT / f"teams_{f.name}"
            shutil.move(str(f), str(dest))
            count += 1
            log.info("Teams-Nachricht gesendet: %s", f.name)
        except Exception as e:
            log.error("Teams-Sende-Fehler (%s): %s", f.name, e)

    return count


def _extract_subject(text: str) -> Optional[str]:
    for line in text.split("\n"):
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()
        if line.lower().startswith("betreff:"):
            return line.split(":", 1)[1].strip()
    return None


# ---------------------------------------------------------------------------
# Background polling loop
# ---------------------------------------------------------------------------

async def _poll_loop():
    interval = int(os.environ.get("POLL_INTERVAL_SECONDS", "30"))
    log.info(
        "Bridge gestartet — IMAP-Poll alle %ds, Outbox-Check alle %ds",
        interval, interval,
    )
    while True:
        try:
            poll_imap_once()
            send_outbox_emails()
            send_outbox_teams()
        except Exception as e:
            log.error("Poll-Loop-Fehler: %s", e)
        await asyncio.sleep(interval)


@app.on_event("startup")
async def startup():
    asyncio.create_task(_poll_loop())
