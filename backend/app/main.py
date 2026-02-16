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


async def _run_migrations(conn):
    """Add new columns to existing tables if they don't exist yet."""
    # Add court_name and case_number to law_changes if missing
    for col, col_type in [("court_name", "VARCHAR(255)"), ("case_number", "VARCHAR(255)")]:
        result = await conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'law_changes' AND column_name = :col"
            ),
            {"col": col},
        )
        if not result.fetchone():
            await conn.execute(text(f"ALTER TABLE law_changes ADD COLUMN {col} {col_type}"))
            logger.info(f"Added column '{col}' to law_changes table.")

    # Widen bgbl_number from VARCHAR(100) to TEXT (law amendment histories can be very long)
    result = await conn.execute(
        text(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name = 'law_changes' AND column_name = 'bgbl_number'"
        )
    )
    row = result.fetchone()
    if row and row[0] != "text":
        await conn.execute(text("ALTER TABLE law_changes ALTER COLUMN bgbl_number TYPE TEXT"))
        logger.info("Widened bgbl_number column to TEXT.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables and start scheduler
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _run_migrations(conn)
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
