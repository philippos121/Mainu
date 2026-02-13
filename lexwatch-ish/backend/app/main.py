"""LexWatch — Austrian Law Change Tracker (iSH / SQLite edition)."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.api import auth, law_changes, users
from app.core.database import engine, Base
from app.services.scheduler import start_scheduler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables and start scheduler
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created (SQLite).")
    start_scheduler()
    yield
    # Shutdown
    logger.info("Shutting down...")


app = FastAPI(
    title="LexWatch API",
    description="Oesterreichischer Rechtsaenderungs-Tracker — iSH Edition (SQLite)",
    version="1.0.0-ish",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(law_changes.router, prefix="/api")


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "LexWatch API (iSH/SQLite)"}


# ── Serve Vue SPA frontend ──────────────────────────────────
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    """Serve the built Vue frontend. All non-API routes fall through here."""
    if not FRONTEND_DIR.exists():
        return {
            "message": "Frontend not built yet.",
            "hint": "Run: cd ../frontend && npm install && npm run build",
        }

    # Serve exact file if it exists (JS, CSS, images, etc.)
    file_path = FRONTEND_DIR / full_path
    if full_path and file_path.is_file() and ".." not in full_path:
        return FileResponse(file_path)

    # SPA fallback — return index.html for all routes
    index = FRONTEND_DIR / "index.html"
    if index.exists():
        return FileResponse(index)

    return {"message": "Frontend index.html not found."}
