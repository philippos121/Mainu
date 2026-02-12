"""LexWatch — Austrian Law Change Tracker."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api import auth, law_changes, users
from app.core.database import engine, Base
from app.services.scheduler import start_scheduler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables and start scheduler
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created.")
    start_scheduler()
    yield
    # Shutdown
    logger.info("Shutting down...")


app = FastAPI(
    title="LexWatch API",
    description="Österreichischer Rechtsänderungs-Tracker — powered by RIS & GPT",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(law_changes.router, prefix="/api")


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "LexWatch API"}
