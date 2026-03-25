"""RIS Tracker — Austrian Legal Change Tracker."""

import logging
from datetime import date

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from app.services.ris_client import (
    LEGAL_CATEGORIES,
    TIMEFRAMES,
    COURT_SOURCES,
    search_gesetze,
    search_gerichtsentscheidungen,
    parse_bundesrecht_response,
)
from app.services.openai_service import summarise_results, generate_report_markdown
from app.services.diff_service import fetch_provision_diff, debug_document  # noqa: E402

logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="RIS Tracker API",
    version="3.0.0",
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
    category: str = Query("", description="Rechtsgebiet ID, empty for all"),
    im_ris_seit: str = Query("EinemMonat", description="Timeframe filter"),
    page: int = Query(1, ge=1),
):
    """Search Gesetze und Verordnungen (Bundesrecht consolidated)."""
    raw = await search_gesetze(category=category, im_ris_seit=im_ris_seit, page=page)
    return parse_bundesrecht_response(raw)


@app.get("/api/search/gerichtsentscheidungen")
async def api_search_gerichtsentscheidungen(
    category: str = Query("", description="Rechtsgebiet ID, empty for all"),
    im_ris_seit: str = Query("EinemMonat", description="Timeframe filter"),
    page: int = Query(1, ge=1),
):
    """Search Gerichtsentscheidungen (court decisions)."""
    return await search_gerichtsentscheidungen(
        category=category, im_ris_seit=im_ris_seit, page=page
    )


# ── Version Diff endpoint ──


@app.get("/api/diff")
async def api_diff(
    doc_id: str = Query(..., description="NOR document number from search results"),
    gesetzesnummer: str = Query(..., description="Gesetzesnummer"),
    artikel: str = Query(..., description="ArtikelParagraphAnlage"),
    inkrafttreten: str = Query("", description="Inkrafttretensdatum"),
):
    """Fetch current and previous version of a provision and compute diff."""
    result = await fetch_provision_diff(
        doc_id=doc_id,
        gesetzesnummer=gesetzesnummer,
        artikel=artikel,
        inkrafttreten=inkrafttreten,
    )
    return result


@app.get("/api/debug/doc")
async def api_debug_doc(
    gesetzesnummer: str = Query(..., description="Gesetzesnummer"),
    artikel: str = Query("", description="ArtikelParagraphAnlage"),
):
    """DEBUG: Show raw API response for a provision."""
    return await debug_document(gesetzesnummer=gesetzesnummer, artikel=artikel)


# ── GPT Summary & Report endpoints ──


class SummaryRequest(BaseModel):
    api_key: str
    results: list[dict]
    doc_type: str = "gesetze"


class ReportRequest(BaseModel):
    api_key: str
    results: list[dict]
    doc_type: str = "gesetze"
    category_label: str = "Alle Rechtsgebiete"
    timeframe_label: str = ""
    total_hits: int = 0


@app.post("/api/summarise")
async def api_summarise(req: SummaryRequest):
    """Generate a GPT summary of search results. API key provided by frontend."""
    if not req.api_key or len(req.api_key) < 10:
        raise HTTPException(status_code=400, detail="Bitte geben Sie einen gültigen OpenAI API-Key ein.")
    if not req.results:
        raise HTTPException(status_code=400, detail="Keine Ergebnisse zum Zusammenfassen.")
    try:
        summary = await summarise_results(
            results=req.results,
            doc_type=req.doc_type,
            api_key=req.api_key,
        )
        return {"summary": summary}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/report")
async def api_report(req: ReportRequest):
    """Generate a scientific summary report. Returns markdown text."""
    if not req.api_key or len(req.api_key) < 10:
        raise HTTPException(status_code=400, detail="Bitte geben Sie einen gültigen OpenAI API-Key ein.")
    if not req.results:
        raise HTTPException(status_code=400, detail="Keine Ergebnisse für den Bericht.")
    try:
        report_md = await generate_report_markdown(
            results=req.results,
            doc_type=req.doc_type,
            category_label=req.category_label,
            timeframe_label=req.timeframe_label,
            total_hits=req.total_hits,
            api_key=req.api_key,
        )

        # Build an HTML report for download
        today = date.today().strftime("%d.%m.%Y")
        html = _markdown_to_html(report_md, today, req.category_label, req.timeframe_label)
        return {"report_markdown": report_md, "report_html": html}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _markdown_to_html(md: str, date_str: str, category: str, timeframe: str) -> str:
    """Convert markdown report to a styled HTML document for download."""
    # Simple markdown → HTML conversion (bold, headers, lists)
    import re
    html_body = md
    # Headers
    html_body = re.sub(r'^#{3}\s+(.+)$', r'<h3>\1</h3>', html_body, flags=re.MULTILINE)
    html_body = re.sub(r'^#{2}\s+(.+)$', r'<h2>\1</h2>', html_body, flags=re.MULTILINE)
    html_body = re.sub(r'^#{1}\s+(.+)$', r'<h1>\1</h1>', html_body, flags=re.MULTILINE)
    # Bold
    html_body = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', html_body)
    # Italic
    html_body = re.sub(r'\*(.+?)\*', r'<em>\1</em>', html_body)
    # List items
    html_body = re.sub(r'^[-•]\s+(.+)$', r'<li>\1</li>', html_body, flags=re.MULTILINE)
    # Numbered list
    html_body = re.sub(r'^\d+\.\s+(.+)$', r'<li>\1</li>', html_body, flags=re.MULTILINE)
    # Paragraphs
    html_body = re.sub(r'\n\n', '</p><p>', html_body)
    html_body = f'<p>{html_body}</p>'
    # Wrap <li> in <ul>
    html_body = re.sub(r'((?:<li>.*?</li>\s*)+)', r'<ul>\1</ul>', html_body, flags=re.DOTALL)

    return f"""<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>RIS Tracker — Wissenschaftlicher Bericht</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Serif:wght@400;500;600&display=swap');
  body {{
    font-family: 'IBM Plex Serif', Georgia, serif;
    max-width: 800px;
    margin: 40px auto;
    padding: 0 24px;
    color: #1a1a1a;
    line-height: 1.7;
    font-size: 15px;
  }}
  .header {{
    border-bottom: 2px solid #007993;
    padding-bottom: 16px;
    margin-bottom: 32px;
  }}
  .header h1 {{
    font-family: 'IBM Plex Sans', sans-serif;
    color: #007993;
    font-size: 14px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 2px;
    margin: 0 0 4px;
  }}
  .header .meta {{
    font-size: 13px;
    color: #6b7280;
  }}
  h1 {{ font-size: 22px; color: #0f3d49; margin-top: 28px; }}
  h2 {{ font-size: 18px; color: #007993; margin-top: 24px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }}
  h3 {{ font-size: 15px; color: #374151; margin-top: 20px; }}
  strong {{ color: #0f3d49; }}
  ul {{ padding-left: 20px; }}
  li {{ margin-bottom: 6px; }}
  .footer {{
    margin-top: 40px;
    padding-top: 16px;
    border-top: 1px solid #e5e7eb;
    font-size: 12px;
    color: #9ca3af;
    font-family: 'IBM Plex Sans', sans-serif;
  }}
  @media print {{
    body {{ margin: 20px; font-size: 12px; }}
  }}
</style>
</head>
<body>
<div class="header">
  <h1>RIS Tracker — Wissenschaftlicher Bericht</h1>
  <div class="meta">Rechtsgebiet: {category} · Zeitraum: {timeframe} · Erstellt am {date_str}</div>
</div>
{html_body}
<div class="footer">
  Datenquelle: Rechtsinformationssystem des Bundes (RIS) — data.bka.gv.at<br>
  Erstellt mit RIS Tracker · Zusammenfassung generiert durch GPT · {date_str}
</div>
</body>
</html>"""
