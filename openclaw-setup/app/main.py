"""OpenClaw Sandbox Setup Wizard.

A minimal web app that guides through setting up OpenClaw in Docker
with the least possible manual effort.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

app = FastAPI(title="OpenClaw Setup Wizard")

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"
STATIC_DIR = Path(__file__).resolve().parent / "static"

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class SetupConfig(BaseModel):
    provider: str = Field("anthropic", description="LLM provider")
    api_key: str = Field(..., description="API key for the chosen provider")
    model: str = Field("claude-sonnet-4-6", description="Model to use")
    channels: list[str] = Field(default_factory=lambda: ["web"])
    whatsapp_numbers: list[str] = Field(default_factory=list)
    telegram_token: Optional[str] = None
    discord_token: Optional[str] = None
    openclaw_port: int = Field(18789, ge=1024, le=65535)


PROVIDER_ENV_MAP = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "google": "GOOGLE_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
}

PROVIDER_MODELS = {
    "anthropic": [
        ("claude-opus-4-7", "Claude Opus 4.7 (most capable)"),
        ("claude-sonnet-4-6", "Claude Sonnet 4.6 (balanced)"),
        ("claude-haiku-4-5-20251001", "Claude Haiku 4.5 (fast & cheap)"),
    ],
    "openai": [
        ("gpt-4o", "GPT-4o"),
        ("gpt-4o-mini", "GPT-4o Mini"),
        ("o3", "o3"),
    ],
    "google": [
        ("gemini-2.5-pro", "Gemini 2.5 Pro"),
        ("gemini-2.5-flash", "Gemini 2.5 Flash"),
    ],
    "deepseek": [
        ("deepseek-chat", "DeepSeek Chat"),
        ("deepseek-reasoner", "DeepSeek Reasoner"),
    ],
}


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("wizard.html", {
        "request": request,
        "providers": PROVIDER_MODELS,
    })


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

@app.get("/api/status")
async def status():
    """Check if OpenClaw container is running and healthy."""
    container = os.environ.get("OPENCLAW_CONTAINER", "openclaw-sandbox")
    try:
        result = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.Status}}", container],
            capture_output=True, text=True, timeout=5,
        )
        docker_status = result.stdout.strip() if result.returncode == 0 else "not_found"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        docker_status = "docker_unavailable"

    config_exists = (DATA_DIR / ".env").exists()
    return {
        "container": docker_status,
        "config_exists": config_exists,
        "data_dir": str(DATA_DIR),
        "openclaw_url": f"http://localhost:{_read_port()}",
    }


@app.get("/api/providers")
async def providers():
    return PROVIDER_MODELS


@app.post("/api/setup")
async def setup(config: SetupConfig):
    """Generate config files, write .env, and optionally start OpenClaw."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "config").mkdir(exist_ok=True)
    (DATA_DIR / "workspace").mkdir(exist_ok=True)

    # .env
    env_key = PROVIDER_ENV_MAP.get(config.provider, "ANTHROPIC_API_KEY")
    env_lines = [
        f"{env_key}={config.api_key}",
        f"OPENCLAW_LOG_LEVEL=info",
    ]
    if config.telegram_token and "telegram" in config.channels:
        env_lines.append(f"TELEGRAM_BOT_TOKEN={config.telegram_token}")
    if config.discord_token and "discord" in config.channels:
        env_lines.append(f"DISCORD_BOT_TOKEN={config.discord_token}")
    (DATA_DIR / ".env").write_text("\n".join(env_lines) + "\n")

    # openclaw.json
    channels_config = {}
    channels_config["web"] = {"enabled": True}
    if "whatsapp" in config.channels:
        wa = {"enabled": True}
        if config.whatsapp_numbers:
            wa["allowFrom"] = config.whatsapp_numbers
        channels_config["whatsapp"] = wa
    if "telegram" in config.channels:
        channels_config["telegram"] = {"enabled": True}
    if "discord" in config.channels:
        channels_config["discord"] = {"enabled": True}

    oc_config = {
        "agents": {
            "defaults": {
                "workspace": "~/.openclaw/workspace",
                "model": config.model,
                "provider": config.provider,
            }
        },
        "channels": channels_config,
        "skills": {
            "install": {"nodeManager": "npm"},
            "entries": {},
        },
    }
    (DATA_DIR / "config" / "openclaw.json").write_text(
        json.dumps(oc_config, indent=2, ensure_ascii=False) + "\n"
    )

    # port override
    port_env = BASE_DIR / ".port"
    port_env.write_text(str(config.openclaw_port))

    return {
        "ok": True,
        "message": "Konfiguration geschrieben. OpenClaw kann gestartet werden.",
        "files": [
            str(DATA_DIR / ".env"),
            str(DATA_DIR / "config" / "openclaw.json"),
        ],
        "next_step": "start",
    }


@app.post("/api/start")
async def start():
    """Start the OpenClaw container via docker compose."""
    compose_file = BASE_DIR / "docker-compose.yml"
    if not (DATA_DIR / ".env").exists():
        return JSONResponse(
            status_code=400,
            content={"ok": False, "error": "Bitte zuerst /api/setup aufrufen."},
        )
    try:
        result = subprocess.run(
            ["docker", "compose", "-f", str(compose_file),
             "up", "-d", "openclaw"],
            capture_output=True, text=True, timeout=120,
            env={**os.environ, "OPENCLAW_PORT": str(_read_port())},
        )
        if result.returncode != 0:
            return JSONResponse(
                status_code=500,
                content={"ok": False, "error": result.stderr},
            )
        return {
            "ok": True,
            "message": "OpenClaw gestartet!",
            "url": f"http://localhost:{_read_port()}",
            "logs_cmd": "docker logs -f openclaw-sandbox",
        }
    except FileNotFoundError:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": "Docker nicht gefunden. Bitte Docker installieren."},
        )
    except subprocess.TimeoutExpired:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": "Timeout beim Starten. Prüfe docker compose logs."},
        )


@app.post("/api/stop")
async def stop():
    """Stop the OpenClaw container."""
    compose_file = BASE_DIR / "docker-compose.yml"
    subprocess.run(
        ["docker", "compose", "-f", str(compose_file), "stop", "openclaw"],
        capture_output=True, text=True, timeout=30,
    )
    return {"ok": True, "message": "OpenClaw gestoppt."}


@app.post("/api/reset")
async def reset():
    """Remove config and data (factory reset)."""
    if DATA_DIR.exists():
        shutil.rmtree(DATA_DIR)
    return {"ok": True, "message": "Alle Daten gelöscht. Setup kann erneut ausgeführt werden."}


@app.get("/api/logs")
async def logs():
    """Get last 100 lines of OpenClaw container logs."""
    container = os.environ.get("OPENCLAW_CONTAINER", "openclaw-sandbox")
    try:
        result = subprocess.run(
            ["docker", "logs", "--tail", "100", container],
            capture_output=True, text=True, timeout=10,
        )
        return {"logs": result.stdout + result.stderr}
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"logs": "(Docker nicht verfügbar)"}


def _read_port() -> int:
    port_file = BASE_DIR / ".port"
    if port_file.exists():
        try:
            return int(port_file.read_text().strip())
        except ValueError:
            pass
    return 18789
