# OpenClaw — Legal AI Assistent (Sandboxed)

> **Outlook + Teams → OpenClaw (GPT-4o) ← WhatsApp → E-Mail- & Teams-Entwürfe an dich**
>
> Ein-Kommando-Setup. Alles läuft lokal in Docker. OpenClaw kann
> **ausschließlich** E-Mails und Teams-Nachrichten an dich senden.
> Sonst nichts.

## Was das Setup macht

```
┌──────────┐  Outlook-Regel    ┌─────────┐   inbox/    ┌──────────┐
│ Outlook  │ ──weiterleiten──→ │  Bridge │ ─schreibt─→ │          │
└──────────┘                   │ (IMAP)  │             │ OpenClaw │
                               │         │   inbox/    │ (GPT-4o) │
┌──────────┐  Power Automate   │ (Webhook│ ─schreibt─→ │          │
│  Teams   │ ──POST JSON────→  │  :8080) │             │          │
└──────────┘                   └─────────┘             └────┬─────┘
                                    ▲                       │
                                    │                       │ WhatsApp
                               outbox/email/                │
                               outbox/teams/                ▼
                                    │                  ┌─────────┐
                               Bridge sendet           │   Du    │
                               per SMTP / Webhook      │(WhatsApp│
                               an DICH                 └─────────┘
```

**Du steuerst OpenClaw per WhatsApp.** Du fragst "Was liegt an?" —
OpenClaw liest `inbox/`, fasst zusammen. Du sagst "Entwurf schreiben
an Müller, Sache XY" — OpenClaw schreibt den Entwurf nach
`outbox/email/` — die Bridge sendet ihn dir per E-Mail. Du prüfst,
du leitest weiter. OpenClaw hat **keinen** Direktzugang zu Dritten.

---

## Setup (5 Minuten)

### Voraussetzungen

- **Docker Desktop** (macOS / Windows) oder Docker Engine (Linux)
- **OpenAI API Key** — [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **App-Passwort** für dein E-Mail-Konto (siehe Schritt 1)
- **WhatsApp** auf deinem Handy

### Schritt 1: Starten — das Skript fragt alles

```bash
cd openclaw-setup
./start.sh
```

Das Skript fragt interaktiv 4 Dinge:

| Frage | Was eintragen | Woher |
|-------|---------------|-------|
| **API Key** | `sk-...` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **E-Mail** | `name@kanzlei.at` | Deine Kanzlei-Adresse |
| **App-Passwort** | `xxxx-xxxx-xxxx` | Siehe unten |
| **Teams-Webhook** | URL oder Enter | Optional, überspringen mit Enter |

IMAP-Server, SMTP-Server und Port werden **automatisch** aus deiner
E-Mail-Domain abgeleitet (Microsoft 365, Gmail, etc.).

**App-Passwort erstellen (einmalig):**
- Microsoft 365: [mysignins.microsoft.com/security-info](https://mysignins.microsoft.com/security-info) → "+ Anmeldemethode hinzufügen" → "App-Kennwort"
- Gmail: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)

**Nochmal einrichten?** `./start.sh --setup`

### Schritt 2: Outlook-Weiterleitung einrichten

In Outlook (Desktop oder Web):

1. **Regeln** → Neue Regel erstellen
2. Bedingung: "Alle eingehenden Nachrichten" (oder ein Filter)
3. Aktion: **Weiterleiten an** deine eigene E-Mail-Adresse (die du in Schritt 1 angegeben hast)
4. Speichern

Die Bridge pollt dieses Postfach alle 30 Sekunden und legt neue
Nachrichten in `workspace/inbox/` ab.

### Schritt 3: Teams-Weiterleitung einrichten (optional)

In **Power Automate** (flow.microsoft.com):

1. Neuer Flow → "Wenn eine neue Nachricht in einem Kanal gepostet wird"
2. Trigger: Teams → Dein Kanal
3. Aktion: **HTTP** → POST
   - URL: `http://DEIN-LAPTOP-IP:8080/webhook/teams`
   - Body:
   ```json
   {
     "from": "@{triggerBody()?['from']?['user']?['displayName']}",
     "channel": "@{triggerBody()?['channelIdentity']?['channelName']}",
     "message": "@{triggerBody()?['body']?['content']}",
     "timestamp": "@{utcNow()}"
   }
   ```
4. Speichern & aktivieren

**Hinweis:** Dein Laptop muss im selben Netzwerk erreichbar sein
(VPN / lokales WLAN). Alternativ: ngrok oder Tailscale für externen
Zugang.

### Schritt 4: WhatsApp verbinden

```bash
docker logs -f openclaw-sandbox
```

Warte auf den **QR-Code** in den Logs. Scanne ihn mit WhatsApp
(Einstellungen → Verknüpfte Geräte → Gerät hinzufügen).

### Fertig!

Schreib auf WhatsApp: **"Was liegt an?"**

**Zusammenfassung: Du tippst `./start.sh`, beantwortest 4 Fragen, scannst einen QR-Code. Das war's.**

---

## Täglicher Gebrauch

| Du schreibst auf WhatsApp...              | OpenClaw macht...                              |
|-------------------------------------------|------------------------------------------------|
| "Was liegt an?"                           | Liest `inbox/`, fasst alle neuen Nachrichten zusammen |
| "Was kam von Müller?"                     | Filtert Nachrichten von Müller                  |
| "Schreib eine Antwort an Müller, Sache X" | Erstellt E-Mail-Entwurf → `outbox/email/`     |
| "Teams-Nachricht an Legal-Kanal, Thema Y" | Erstellt Teams-Entwurf → `outbox/teams/`      |
| "Zusammenfassung der Teams-Nachrichten"   | Fasst alle Teams-Nachrichten aus `inbox/` zusammen |

**Entwürfe kommen bei dir per E-Mail / Teams an. Du prüfst. Du leitest weiter.**

---

## Sicherheit

### Was OpenClaw darf

| Aktion                      | Erlaubt? |
|-----------------------------|----------|
| E-Mails an DICH senden      | Ja       |
| Teams-Nachrichten an DICH   | Ja       |
| `inbox/` lesen              | Ja       |
| `instructions.md` lesen     | Ja       |
| `outbox/` beschreiben       | Ja       |
| Alles andere                | **Nein** |

### Was OpenClaw NICHT darf

- Direkt an Mandanten / Gerichte / Dritte senden
- Auf externe APIs zugreifen (außer OpenAI)
- Dateien außerhalb des Workspace lesen oder ändern
- Skills installieren (gesperrt in `openclaw.json`)
- Neue Prozesse starten (PID-Limit)
- Mehr als 2 GB RAM / 2 CPUs nutzen
- Das Container-Dateisystem verändern (read-only)
- Privilegien eskalieren (no_new_privileges)

### Docker-Härtung im Detail

```yaml
read_only: true                 # Container-FS ist read-only
tmpfs: /tmp (100MB, noexec)     # Temp nur im RAM, kein exec
no-new-privileges: true         # Kein setuid/setgid möglich
cap_drop: ALL                   # Alle Linux-Capabilities weg
cap_add: CHOWN,SETUID,SETGID,  # Nur was Node.js braucht
         DAC_OVERRIDE
pids_limit: 256                 # Max 256 Prozesse (Fork-Bomb-Schutz)
mem_limit: 2g                   # Max 2 GB RAM, kein Swap
cpus: 2.0                       # Max 2 CPU-Kerne
logging: max 3×10MB             # Log-Rotation (kein Disk-Flooding)
network: openclaw-net (bridge)  # Eigenes Netzwerk (Isolation)
```

### API-Key-Sicherheit

- Dein OpenAI API Key liegt nur in `.env` (gitignored)
- Wird nie in Logs geschrieben
- Wird nie an die Bridge weitergegeben (nur OpenClaw bekommt ihn)

---

## Dateien

```
openclaw-setup/
├── start.sh                          ← Starten (ein Befehl)
├── docker-compose.yml                ← Beide Container (gehärtet)
├── .env.example                      ← Vorlage für Credentials
├── .env                              ← Deine echten Credentials (gitignored)
├── bridge/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app.py                        ← IMAP-Poller + Teams-Webhook + SMTP-Sender
├── openclaw-config/
│   └── openclaw.json                 ← OpenClaw-Config (WhatsApp + GPT-4o, Skills gesperrt)
├── workspace/
│   ├── instructions.md               ← Ton, Stil, Regeln (ANPASSEN!)
│   ├── inbox/                        ← Hier landen eingehende Nachrichten
│   ├── outbox/
│   │   ├── email/                    ← E-Mail-Entwürfe → Bridge sendet
│   │   └── teams/                    ← Teams-Entwürfe → Bridge sendet
│   └── sent/                         ← Archiv gesendeter Entwürfe
└── README.md                         ← Diese Datei
```

## Stoppen / Reset

```bash
# Stoppen
docker compose down

# Logs anschauen
docker compose logs -f

# Factory Reset (alles weg)
docker compose down -v
rm -rf workspace/inbox/* workspace/outbox/email/* workspace/outbox/teams/* workspace/sent/*
```

## Anpassen

### Ton ändern

Bearbeite `workspace/instructions.md`. OpenClaw liest die Datei bei
jeder neuen Konversation. Kein Neustart nötig.

### Polling-Intervall ändern

In `.env`: `POLL_INTERVAL_SECONDS=60` (Default: 30 Sekunden).

### Anderes GPT-Modell verwenden

In `openclaw-config/openclaw.json` → `agents.defaults.model`:
- `gpt-4o` — Standard (empfohlen)
- `gpt-4o-mini` — schneller, günstiger
- `o3` — stärkstes Reasoning
