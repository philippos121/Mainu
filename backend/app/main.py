"""RIS Tracker — Austrian Legal Change Tracker."""

import logging
from datetime import date

import httpx
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
    _timeframe_to_days,
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
    days = _timeframe_to_days(im_ris_seit)
    return parse_bundesrecht_response(raw, timeframe_days=days)


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
    doc_id: str = Query("", description="NOR document number from search results"),
    gesetzesnummer: str = Query("", description="Gesetzesnummer"),
    artikel: str = Query("", description="ArtikelParagraphAnlage"),
    inkrafttreten: str = Query("", description="Inkrafttretensdatum"),
):
    """Fetch current and previous version of a provision and compute diff."""
    try:
        result = await fetch_provision_diff(
            doc_id=doc_id,
            gesetzesnummer=gesetzesnummer,
            artikel=artikel,
            inkrafttreten=inkrafttreten,
        )
        return result
    except Exception as e:
        logging.error(f"Diff error: {e}", exc_info=True)
        return {
            "current": None, "previous": None,
            "diff_html": f'<p class="diff-info">Serverfehler: {str(e)[:200]}</p>',
            "has_changes": False,
        }


@app.get("/api/debug/doc")
async def api_debug_doc(
    gesetzesnummer: str = Query(..., description="Gesetzesnummer"),
    artikel: str = Query("", description="ArtikelParagraphAnlage"),
):
    """DEBUG: Show raw API response for a provision."""
    return await debug_document(gesetzesnummer=gesetzesnummer, artikel=artikel)


@app.get("/api/debug/index")
async def api_debug_index():
    """DEBUG: Test which Index parameter formats work with BrKons."""
    from app.core.config import settings as cfg
    results = {}
    base = f"{cfg.RIS_API_BASE_URL}/Bundesrecht"

    test_cases = [
        # Index + ImRisSeit (current approach)
        ("Index=90/01+ImRisSeit", {"Index": "90/01", "ImRisSeit": "EinemJahr"}),
        # Index + Fassung date range (desired approach)
        ("Index=90/01+Fassung", {"Index": "90/01",
         "Fassung.VonInkrafttretensdatum": "2025-03-25",
         "Fassung.BisInkrafttretensdatum": "2026-03-25"}),
        # Index + Fassung for GmbH
        ("Index=21/03+Fassung", {"Index": "21/03",
         "Fassung.VonInkrafttretensdatum": "2025-03-25",
         "Fassung.BisInkrafttretensdatum": "2026-03-25"}),
        # Index + Fassung for ABGB
        ("Index=20/01+Fassung", {"Index": "20/01",
         "Fassung.VonInkrafttretensdatum": "2025-03-25",
         "Fassung.BisInkrafttretensdatum": "2026-03-25"}),
        # Titel + Fassung
        ("Titel=StGB+Fassung", {"Titel": "StGB",
         "Fassung.VonInkrafttretensdatum": "2025-03-25",
         "Fassung.BisInkrafttretensdatum": "2026-03-25"}),
        # Just ImRisSeit for comparison
        ("Index=90/01+ImRisSeit", {"Index": "90/01", "ImRisSeit": "EinemJahr"}),
        ("Index=21/03+ImRisSeit", {"Index": "21/03", "ImRisSeit": "EinemJahr"}),
    ]

    async with httpx.AsyncClient(timeout=15.0) as client:
        for label, extra in test_cases:
            params = {"Applikation": "BrKons",
                      "DokumenteProSeite": "Ten", "Seitennummer": "1"}
            params.update(extra)
            try:
                resp = await client.get(base, params=params)
                data = resp.json()
                hr = data.get("OgdSearchResult", {}).get("OgdDocumentResults", {}).get("Hits", {})
                hits = int(hr.get("#text", "0")) if isinstance(hr, dict) else 0
                refs = data.get("OgdSearchResult", {}).get("OgdDocumentResults", {}).get("OgdDocumentReference", [])
                if isinstance(refs, dict):
                    refs = [refs]
                first = ""
                if refs:
                    d = refs[0].get("Data", {}).get("Metadaten", {})
                    for sk in ("Bundesrecht", "Allgemein"):
                        sec = d.get(sk)
                        if isinstance(sec, list) and sec:
                            sec = sec[0]
                        if isinstance(sec, dict):
                            first = first or sec.get("Kurztitel", "")
                            for sub in ("BrKons",):
                                ss = sec.get(sub)
                                if isinstance(ss, list) and ss:
                                    ss = ss[0]
                                if isinstance(ss, dict):
                                    first = first or ss.get("Kurztitel", "")
                results[label] = {"hits": hits, "first_title": str(first)[:80]}
            except Exception as e:
                results[label] = {"error": str(e)[:200]}

    return results


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

        # Build interactive HTML report
        today = date.today().strftime("%d.%m.%Y")
        html = _build_interactive_report(
            report_md, req.results, today,
            req.category_label, req.timeframe_label, req.total_hits, req.doc_type
        )
        return {"report_markdown": report_md, "report_html": html}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _build_interactive_report(
    summary_md: str, results: list[dict], date_str: str,
    category: str, timeframe: str, total_hits: int, doc_type: str,
) -> str:
    """Build an interactive animated HTML report with collapsible change details."""
    import re as _re
    import html as _html

    # Convert markdown summary to HTML
    s = summary_md
    s = _re.sub(r'^#{3}\s+(.+)$', r'<h4>\1</h4>', s, flags=_re.MULTILINE)
    s = _re.sub(r'^#{2}\s+(.+)$', r'<h3>\1</h3>', s, flags=_re.MULTILINE)
    s = _re.sub(r'^#{1}\s+(.+)$', r'<h2>\1</h2>', s, flags=_re.MULTILINE)
    s = _re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
    s = _re.sub(r'\*(.+?)\*', r'<em>\1</em>', s)
    s = _re.sub(r'^[-•]\s+(.+)$', r'<li>\1</li>', s, flags=_re.MULTILINE)
    s = _re.sub(r'\n\n', '</p><p>', s)
    s = f'<p>{s}</p>'
    s = _re.sub(r'((?:<li>.*?</li>\s*)+)', r'<ul>\1</ul>', s, flags=_re.DOTALL)
    summary_html = s

    # Build change cards
    type_label = "Gesetze" if doc_type == "gesetze" else "Entscheidungen"
    cards_html = ""
    for i, r in enumerate(results[:50]):
        title = _html.escape(r.get("title", "Unbekannt"))
        artikel = _html.escape(r.get("artikel", ""))
        typ = _html.escape(r.get("typ", ""))
        bgbl = _html.escape(r.get("bgbl", ""))
        inkraft = _html.escape(r.get("date", ""))
        url = _html.escape(r.get("url", ""))
        nor = _html.escape(r.get("id", ""))

        cards_html += f"""
    <div class="card" style="animation-delay: {i * 0.05}s">
      <div class="card-header" onclick="this.parentElement.classList.toggle('open')">
        <div class="card-title">
          <span class="card-typ">{typ}</span>
          <strong>{title}</strong>
          {f'<span class="card-artikel">{artikel}</span>' if artikel else ''}
        </div>
        <div class="card-meta">
          <span class="chip">In Kraft: {inkraft}</span>
          {f'<span class="chip chip-bgbl">{bgbl}</span>' if bgbl else ''}
        </div>
        <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="card-detail">
        <div class="detail-row">
          <span class="detail-label">Dokumentnummer</span>
          <span>{nor}</span>
        </div>
        {f'<div class="detail-row"><span class="detail-label">BGBl</span><span>{bgbl}</span></div>' if bgbl else ''}
        {f'<a href="{url}" target="_blank" class="detail-link">Im RIS anzeigen &rarr;</a>' if url else ''}
      </div>
    </div>"""

    return f"""<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RIS Tracker — {category} — {timeframe}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&display=swap');

* {{ box-sizing: border-box; margin: 0; padding: 0; }}

body {{
  font-family: 'IBM Plex Sans', -apple-system, sans-serif;
  background: #f0f2f5;
  color: #1a1a1a;
  line-height: 1.6;
}}

.hero {{
  background: linear-gradient(135deg, #0f3d49 0%, #007993 100%);
  color: white;
  padding: 48px 24px 40px;
  text-align: center;
  position: relative;
  overflow: hidden;
}}
.hero::after {{
  content: '';
  position: absolute;
  top: -50%; left: -50%;
  width: 200%; height: 200%;
  background: radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 70%);
  animation: shimmer 8s ease-in-out infinite;
}}
@keyframes shimmer {{
  0%, 100% {{ transform: translate(0, 0); }}
  50% {{ transform: translate(5%, 5%); }}
}}
.hero h1 {{
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 8px;
  position: relative;
  z-index: 1;
}}
.hero .subtitle {{
  font-size: 15px;
  opacity: 0.8;
  position: relative;
  z-index: 1;
}}
.hero .stats {{
  display: flex;
  justify-content: center;
  gap: 32px;
  margin-top: 24px;
  position: relative;
  z-index: 1;
}}
.hero .stat {{
  text-align: center;
}}
.hero .stat-num {{
  font-size: 32px;
  font-weight: 700;
  display: block;
  animation: countUp 1s ease-out;
}}
.hero .stat-label {{
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  opacity: 0.7;
}}
@keyframes countUp {{
  from {{ opacity: 0; transform: translateY(10px); }}
  to {{ opacity: 1; transform: translateY(0); }}
}}

.container {{
  max-width: 800px;
  margin: -24px auto 40px;
  padding: 0 16px;
  position: relative;
  z-index: 2;
}}

.summary-box {{
  background: white;
  border-radius: 12px;
  padding: 28px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  margin-bottom: 24px;
  animation: fadeUp 0.6s ease-out;
}}
.summary-box h2 {{
  font-size: 16px;
  color: #007993;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}}
.summary-box p {{ margin-bottom: 12px; font-size: 14px; color: #374151; }}
.summary-box h3 {{ font-size: 15px; color: #0f3d49; margin: 16px 0 8px; }}
.summary-box h4 {{ font-size: 14px; color: #374151; margin: 12px 0 6px; }}
.summary-box strong {{ color: #0f3d49; }}
.summary-box ul {{ padding-left: 20px; margin: 8px 0; }}
.summary-box li {{ font-size: 14px; margin-bottom: 4px; color: #374151; }}

@keyframes fadeUp {{
  from {{ opacity: 0; transform: translateY(20px); }}
  to {{ opacity: 1; transform: translateY(0); }}
}}

.section-title {{
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #9ca3af;
  margin: 24px 0 12px;
  padding-left: 4px;
}}

.card {{
  background: white;
  border-radius: 10px;
  margin-bottom: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  overflow: hidden;
  animation: fadeUp 0.4s ease-out both;
  border: 1px solid #e5e7eb;
  transition: border-color 0.2s;
}}
.card:hover {{ border-color: #007993; }}

.card-header {{
  padding: 14px 18px;
  cursor: pointer;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  position: relative;
}}
.card-title {{
  flex: 1;
  min-width: 0;
}}
.card-title strong {{
  font-size: 14px;
  color: #111827;
  display: block;
}}
.card-typ {{
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  background: rgba(0,121,147,0.08);
  color: #007993;
  margin-right: 6px;
}}
.card-artikel {{
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  background: rgba(239,96,7,0.08);
  color: #ef6007;
  margin-left: 6px;
}}
.card-meta {{
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 6px;
}}
.chip {{
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  background: #f3f4f6;
  color: #6b7280;
  white-space: nowrap;
}}
.chip-bgbl {{ background: rgba(0,121,147,0.06); color: #007993; }}

.chevron {{
  flex-shrink: 0;
  margin-top: 4px;
  color: #9ca3af;
  transition: transform 0.3s ease;
}}
.card.open .chevron {{ transform: rotate(180deg); }}

.card-detail {{
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease, padding 0.3s ease;
  padding: 0 18px;
  background: #fafafa;
  border-top: 1px solid transparent;
}}
.card.open .card-detail {{
  max-height: 500px;
  padding: 14px 18px;
  border-top: 1px solid #e5e7eb;
}}
.detail-row {{
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 4px 0;
  color: #374151;
}}
.detail-label {{
  font-weight: 500;
  color: #6b7280;
}}
.detail-link {{
  display: inline-block;
  margin-top: 8px;
  font-size: 13px;
  color: #007993;
  text-decoration: none;
  font-weight: 500;
}}
.detail-link:hover {{ text-decoration: underline; }}

.footer {{
  text-align: center;
  padding: 24px;
  font-size: 12px;
  color: #9ca3af;
  border-top: 1px solid #e5e7eb;
  margin-top: 40px;
}}
.footer a {{ color: #007993; text-decoration: none; }}

@media print {{
  .hero {{ background: #0f3d49 !important; -webkit-print-color-adjust: exact; }}
  .card-detail {{ max-height: none !important; padding: 14px 18px !important; }}
  .chevron {{ display: none; }}
  body {{ background: white; }}
}}
</style>
</head>
<body>

<div class="hero">
  <h1>Rechtsänderungen — {_html.escape(category)}</h1>
  <div class="subtitle">{_html.escape(timeframe)} · Erstellt am {date_str}</div>
  <div class="stats">
    <div class="stat">
      <span class="stat-num">{total_hits}</span>
      <span class="stat-label">{type_label}</span>
    </div>
    <div class="stat">
      <span class="stat-num">{min(len(results), 50)}</span>
      <span class="stat-label">Analysiert</span>
    </div>
  </div>
</div>

<div class="container">
  <div class="summary-box">
    <h2>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#007993" stroke-width="2">
        <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 12 18.469"/>
      </svg>
      KI-Zusammenfassung
    </h2>
    {summary_html}
  </div>

  <div class="section-title">{total_hits} {type_label} im Detail</div>
  {cards_html}
</div>

<div class="footer">
  Datenquelle: <a href="https://data.bka.gv.at">Rechtsinformationssystem des Bundes (RIS)</a><br>
  Zusammenfassung generiert durch GPT · {date_str}
</div>

</body>
</html>"""
