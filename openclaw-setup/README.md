# OpenClaw Sandbox Setup Wizard

> **Minimum work to test OpenClaw.** A guided web wizard that sets up
> OpenClaw in a sandboxed Docker environment — you just bring an API key.

## What this does

1. Opens a 3-step web wizard at `http://localhost:9090`
2. You pick a provider (Anthropic/OpenAI/Google/DeepSeek) and paste your API key
3. Choose channels (Web UI, WhatsApp, Telegram, Discord)
4. Click "Start" — it pulls the OpenClaw Docker image, writes config, launches the container
5. OpenClaw is running at `http://localhost:18789`

Everything stays sandboxed in Docker. Config and data live in `data/`. Factory reset with one click.

## Quickstart

```bash
# Option A: Docker all-in-one (recommended)
./start.sh

# Option B: Local Python
./start.sh --no-docker

# Option C: Custom port
./start.sh --port 8080
```

Then open **http://localhost:9090** and follow the wizard.

## Prerequisites

- **Docker Desktop** (or Docker Engine + Compose v2)
- An API key from one of: Anthropic, OpenAI, Google, DeepSeek
- That's it.

## What gets created

```
openclaw-setup/
├── data/                 ← generated at runtime
│   ├── .env              ← API keys (gitignored)
│   ├── config/
│   │   └── openclaw.json ← OpenClaw config
│   └── workspace/        ← agent working directory
├── app/                  ← wizard FastAPI app
├── docker-compose.yml    ← OpenClaw + wizard containers
├── start.sh              ← one-command launcher
└── README.md
```

## Endpoints (Wizard API)

| Method | Path           | Description                            |
|--------|----------------|----------------------------------------|
| GET    | `/`            | Setup wizard UI                        |
| GET    | `/api/status`  | Container status + config check        |
| GET    | `/api/providers` | Available LLM providers + models     |
| POST   | `/api/setup`   | Write config from wizard input         |
| POST   | `/api/start`   | Start OpenClaw container               |
| POST   | `/api/stop`    | Stop OpenClaw container                |
| POST   | `/api/reset`   | Delete all config + data (factory reset)|
| GET    | `/api/logs`    | Last 100 lines of container logs       |

## Security

- API keys are stored **only** in `data/.env` (gitignored)
- The wizard never phones home — runs 100% locally
- Docker socket is mounted read/write for container management
- For production, don't expose port 9090 publicly

## Factory Reset

Click "Factory Reset" in the wizard, or:

```bash
docker compose down -v
rm -rf data/
```
