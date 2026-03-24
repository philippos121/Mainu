"""RIS Tracker — Austrian Legal Change Tracker."""

import logging

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from app.services.ris_client import (
    LEGAL_CATEGORIES,
    TIMEFRAMES,
    COURT_SOURCES,
    search_gesetze,
    search_gerichtsentscheidungen,
    parse_bundesrecht_response,
)

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="RIS Tracker API",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/categories")
async def get_categories():
    """Return all Rechtsgebiete (legal categories) available for filtering."""
    return LEGAL_CATEGORIES


@app.get("/api/timeframes")
async def get_timeframes():
    """Return all timeframe options."""
    return TIMEFRAMES


@app.get("/api/courts")
async def get_courts():
    """Return all court sources for Judikatur."""
    return COURT_SOURCES


@app.get("/api/search/gesetze")
async def api_search_gesetze(
    index: str = Query("", description="Rechtsgebiet index (1-24), empty for all"),
    im_ris_seit: str = Query("EinemMonat", description="Timeframe filter"),
    page: int = Query(1, ge=1),
):
    """Search Gesetze und Verordnungen (Bundesrecht consolidated)."""
    raw = await search_gesetze(index=index, im_ris_seit=im_ris_seit, page=page)
    return parse_bundesrecht_response(raw)


@app.get("/api/search/gerichtsentscheidungen")
async def api_search_gerichtsentscheidungen(
    index: str = Query("", description="Rechtsgebiet index (1-24), empty for all"),
    im_ris_seit: str = Query("EinemMonat", description="Timeframe filter"),
    page: int = Query(1, ge=1),
):
    """Search Gerichtsentscheidungen (court decisions)."""
    return await search_gerichtsentscheidungen(
        index=index, im_ris_seit=im_ris_seit, page=page
    )
