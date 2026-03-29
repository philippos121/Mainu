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
    search_begutachtung,
    search_regierungsvorlagen,
    parse_bundesrecht_response,
    _timeframe_to_days,
)
from app.services.openai_service import summarise_results, generate_report_markdown
from app.services.diff_service import fetch_provision_diff, debug_document
from app.services.report_builder import build_report
from app.services.materialien_service import fetch_materialien_for_results

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


@app.get("/api/debug/ris-test")
async def ris_test():
    """Test if RIS website is reachable from this container."""
    import httpx as hx
    results = {}
    urls = {
        "ris_api": "https://data.bka.gv.at/ris/api/v2.6/Bundesrecht?Applikation=BrKons&DokumenteProSeite=Ten&ImRisSeit=EinemMonat",
        "ris_www": "https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=NOR40275544",
        "ris_no_www": "https://ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer=NOR40275544",
    }
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    async with hx.AsyncClient(timeout=60.0, follow_redirects=True, headers=headers) as client:
        for name, url in urls.items():
            try:
                resp = await client.get(url)
                results[name] = {"status": resp.status_code, "length": len(resp.text), "url": str(resp.url)[:200]}
            except Exception as e:
                results[name] = {"error": f"{type(e).__name__}: {str(e)[:300]}"}
    return results


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


@app.get("/api/search/begutachtung")
async def api_search_begutachtung(
    suchworte: str = Query("", description="Suchworte"),
    im_ris_seit: str = Query("EinemJahr", description="Timeframe"),
    page: int = Query(1, ge=1),
):
    """Search Begutachtungsentwürfe."""
    return await search_begutachtung(suchworte=suchworte, im_ris_seit=im_ris_seit, page=page)


@app.get("/api/search/regierungsvorlagen")
async def api_search_regierungsvorlagen(
    suchworte: str = Query("", description="Suchworte"),
    im_ris_seit: str = Query("EinemJahr", description="Timeframe"),
    page: int = Query(1, ge=1),
):
    """Search Regierungsvorlagen."""
    return await search_regierungsvorlagen(suchworte=suchworte, im_ris_seit=im_ris_seit, page=page)


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


# ── Email Report endpoint ──


class EmailReportRequest(BaseModel):
    email: str
    api_key: str = ""
    results: list = []
    doc_type: str = "gesetze"
    category_label: str = "Alle Rechtsgebiete"
    timeframe_label: str = ""
    total_hits: int = 0
    diffs: dict = {}

    class Config:
        extra = "allow"


@app.post("/api/report/email")
async def api_report_email(req: EmailReportRequest):
    """Generate report and send via Resend API."""
    from app.core.config import settings as cfg

    if not req.email or "@" not in req.email:
        raise HTTPException(status_code=400, detail="Ungültige E-Mail-Adresse.")
    if not req.results:
        raise HTTPException(status_code=400, detail="Keine Ergebnisse.")
    if not cfg.MAILERSEND_API_KEY and not cfg.RESEND_API_KEY:
        raise HTTPException(status_code=501, detail="E-Mail nicht konfiguriert (MAILERSEND_API_KEY oder RESEND_API_KEY fehlt).")

    # Generate report
    report_md = ""
    if req.api_key and len(req.api_key) >= 10:
        try:
            report_md = await generate_report_markdown(
                results=req.results, doc_type=req.doc_type,
                category_label=req.category_label, timeframe_label=req.timeframe_label,
                total_hits=req.total_hits, api_key=req.api_key,
            )
        except Exception as e:
            report_md = f"*KI-Zusammenfassung nicht verfügbar: {str(e)[:100]}*"
    else:
        report_md = "*Kein API-Key — Report ohne KI-Zusammenfassung.*"

    today = date.today().strftime("%d.%m.%Y")
    html_report = build_report(
        report_md, req.results, today,
        req.category_label, req.timeframe_label, req.total_hits, req.doc_type,
        req.diffs,
    )

    # Send via MailerSend or Resend
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            if cfg.MAILERSEND_API_KEY:
                # MailerSend — no domain verification needed for trial
                resp = await client.post(
                    "https://api.mailersend.com/v1/email",
                    headers={
                        "Authorization": f"Bearer {cfg.MAILERSEND_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "from": {"email": "monitoring@test-3m5jgro09qzgdpyo.mlsender.net", "name": "AI:ssociate Monitoring"},
                        "to": [{"email": req.email}],
                        "subject": f"AI:ssociate Monitoring — {req.category_label} — {req.timeframe_label}",
                        "text": "Siehe HTML-Version.",
                        "html": html_report,
                    },
                )
            elif cfg.RESEND_API_KEY:
                # Resend fallback
                resp = await client.post(
                    "https://api.resend.com/emails",
                    headers={
                        "Authorization": f"Bearer {cfg.RESEND_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "from": "AI:ssociate <onboarding@resend.dev>",
                        "to": [req.email],
                        "subject": f"AI:ssociate Monitoring — {req.category_label} — {req.timeframe_label}",
                        "html": html_report,
                    },
                )
            else:
                raise HTTPException(status_code=501, detail="E-Mail nicht konfiguriert (MAILERSEND_API_KEY oder RESEND_API_KEY fehlt).")

            resp.raise_for_status()
            try:
                data = resp.json()
            except Exception:
                data = {"raw": resp.text[:200]}
            logging.info(f"Email sent to {req.email}: status={resp.status_code} {data}")
            return {"status": "sent", "email": req.email}
    except httpx.HTTPStatusError as e:
        err = e.response.text[:500]
        logging.error(f"Email error: {err}")
        raise HTTPException(status_code=500, detail=f"E-Mail-Versand fehlgeschlagen: {err}")
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Email error: {e}")
        raise HTTPException(status_code=500, detail=f"E-Mail-Fehler: {str(e)[:200]}")


# ── GPT Summary & Report endpoints ──


class SummaryRequest(BaseModel):
    api_key: str = ""
    results: list = []
    doc_type: str = "gesetze"


class ReportRequest(BaseModel):
    api_key: str = ""
    results: list = []
    doc_type: str = "gesetze"
    category_label: str = "Alle Rechtsgebiete"
    timeframe_label: str = ""
    total_hits: int = 0
    diffs: dict = {}

    class Config:
        extra = "allow"  # Accept any extra fields without error


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
    """Generate an interactive summary report with optional GPT summary."""
    logging.info(f"Report request: {len(req.results)} results, {len(req.diffs)} diffs, api_key={'yes' if req.api_key else 'no'}")
    if not req.results:
        raise HTTPException(status_code=400, detail="Keine Ergebnisse für den Bericht.")

    # Fetch Gesetzesmaterialien (Erläuterungen) per unique BGBl number
    materialien = {}
    parliamentary = []
    try:
        import asyncio as _aio

        # Materialien (Erläuterungen from parlament.gv.at)
        mat_task = fetch_materialien_for_results(req.results)
        # Begutachtung + Regierungsvorlagen (from RIS)
        begut_task = search_begutachtung(suchworte=req.category_label, im_ris_seit="EinemJahr")
        regv_task = search_regierungsvorlagen(suchworte=req.category_label, im_ris_seit="EinemJahr")

        mat_results, begut_results, regv_results = await _aio.gather(
            mat_task, begut_task, regv_task, return_exceptions=True
        )
        if isinstance(mat_results, dict):
            materialien = mat_results
        if isinstance(begut_results, list):
            parliamentary.extend(begut_results[:5])
        if isinstance(regv_results, list):
            parliamentary.extend(regv_results[:5])
        logging.info(f"Materialien: {len(materialien)} BGBl, Parliamentary: {len(parliamentary)}")
    except Exception as e:
        logging.error(f"Materialien/Parliamentary error: {e}")

    # GPT summary with Materialien + parliamentary context
    report_md = ""
    if req.api_key and len(req.api_key) >= 10:
        try:
            # Build Materialien context for GPT
            extra_context = ""

            # Gesetzesmaterialien (Erläuterungen per BGBl)
            if materialien:
                mat_lines = []
                for key, mat in materialien.items():
                    line = f"- {mat.get('bgbl', key)}"
                    if mat.get('titel'):
                        line += f": {mat['titel']}"
                    if mat.get('rv_nr'):
                        line += f" (RV {mat['rv_nr']} d.B. {mat.get('gp', '')} GP)"
                    if mat.get('parlament_url'):
                        line += f" → {mat['parlament_url']}"
                    mat_lines.append(line)
                extra_context += (
                    "\n\n--- GESETZESMATERIALIEN ---\n"
                    "Folgende Erläuterungen (Materialien) zu den Novellen sind verfügbar:\n"
                    + "\n".join(mat_lines)
                    + "\nFasse die Intention des Gesetzgebers zusammen. "
                    "Was war die zugrundeliegende Rechtsfrage die die Novelle adressiert? "
                    "Verwende die Materialien als Kontext für die Analyse.\n"
                )

            # Parliamentary materials (Begut + RegV)
            if parliamentary:
                parl_lines = []
                for p in parliamentary:
                    parl_lines.append(f"- [{p['typ']}] {p['title']}" +
                                      (f" ({p['stelle']})" if p.get('stelle') else ""))
                extra_context += (
                    "\n\n--- PARLAMENTARISCHE MATERIALIEN ---\n"
                    "Folgende Regierungsvorlagen und Begutachtungsentwürfe sind im Zusammenhang relevant:\n"
                    + "\n".join(parl_lines)
                    + "\nBerücksichtige diese in deiner Analyse (welche Gesetze stehen vor einer Änderung?)."
                )

            report_md = await generate_report_markdown(
                results=req.results,
                doc_type=req.doc_type,
                category_label=req.category_label,
                timeframe_label=req.timeframe_label,
                total_hits=req.total_hits,
                api_key=req.api_key,
                extra_context=extra_context,
            )
        except Exception as e:
            logging.error(f"GPT report error: {e}")
            report_md = f"*KI-Zusammenfassung konnte nicht erstellt werden: {str(e)[:100]}*"
    else:
        report_md = "*Kein OpenAI API-Key angegeben — Report ohne KI-Zusammenfassung.*"

    # Auto-fetch diffs for Gesetze results that don't have diffs yet
    # IMPORTANT: fetch sequentially (max 5) to avoid overwhelming the RIS website
    all_diffs = dict(req.diffs)
    if req.doc_type == "gesetze":
        import asyncio
        missing = [r for r in req.results[:10]
                   if r.get("id") and r["id"] not in all_diffs
                   and r.get("gesetzesnummer") and r.get("artikel")]
        if missing:
            logging.info(f"Auto-fetching {len(missing)} diffs for report (sequential)...")
            for r in missing[:5]:  # Max 5 to keep it fast
                try:
                    diff_result = await fetch_provision_diff(
                        doc_id=r["id"], gesetzesnummer=r.get("gesetzesnummer", ""),
                        artikel=r.get("artikel", ""), inkrafttreten=r.get("date", ""),
                    )
                    if isinstance(diff_result, dict) and diff_result.get("has_changes"):
                        all_diffs[r["id"]] = diff_result
                except Exception as e:
                    logging.error(f"Diff fetch error for {r.get('id')}: {e}")
                await asyncio.sleep(0.5)  # Be nice to RIS website

    try:
        today = date.today().strftime("%d.%m.%Y")
        html = build_report(
            report_md, req.results, today,
            req.category_label, req.timeframe_label, req.total_hits, req.doc_type,
            all_diffs, parliamentary, materialien,
        )
        return {"report_markdown": report_md, "report_html": html,
                "parliamentary": parliamentary, "materialien": materialien}
    except Exception as e:
        logging.error(f"Report build error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Report-Generierung fehlgeschlagen: {str(e)[:200]}")


def _build_interactive_report(
    summary_md: str, results: list[dict], date_str: str,
    category: str, timeframe: str, total_hits: int, doc_type: str,
    diffs: dict = None,
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
    diffs = diffs or {}
    cards_html = ""
    changes_count = 0
    for i, r in enumerate(results[:50]):
        title = _html.escape(r.get("title", "Unbekannt"))
        artikel = _html.escape(r.get("artikel", ""))
        typ = _html.escape(r.get("typ", ""))
        bgbl = _html.escape(r.get("bgbl", ""))
        inkraft = _html.escape(r.get("date", ""))
        url = _html.escape(r.get("url", ""))
        nor = r.get("id", "")

        # Check if we have a diff for this result
        diff_data = diffs.get(nor, {})
        diff_html = diff_data.get("diff_html", "")
        has_diff = bool(diff_html)
        if has_diff:
            changes_count += 1

        # Version info
        prev_info = ""
        if diff_data.get("previous"):
            prev_date = diff_data["previous"].get("date", "")
            prev_info = f'<div class="version-info"><span class="v-old">Vorversion: {_html.escape(prev_date)}</span> → <span class="v-new">Neue Fassung: {_html.escape(inkraft)}</span></div>'

        cards_html += f"""
    <div class="card {'card-has-diff' if has_diff else ''}" style="animation-delay: {i * 0.06}s">
      <div class="card-header" onclick="this.parentElement.classList.toggle('open')">
        <div class="card-left">
          <div class="card-title-row">
            <span class="card-typ">{typ}</span>
            <strong>{_html.escape(title)}</strong>
            {f'<span class="card-artikel">{artikel}</span>' if artikel else ''}
          </div>
          <div class="card-meta">
            <span class="chip chip-date">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              {inkraft}
            </span>
            {f'<span class="chip chip-bgbl">{bgbl}</span>' if bgbl else ''}
            {'<span class="chip chip-diff">Änderung</span>' if has_diff else ''}
          </div>
        </div>
        <svg class="chevron" width="18" height="18" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="card-detail">
        {prev_info}
        {f'<div class="diff-box">{diff_html}</div>' if has_diff else ''}
        <div class="detail-meta">
          <span>NOR: {_html.escape(nor)}</span>
          {f' · <span>{bgbl}</span>' if bgbl else ''}
          {f' · <a href="{_html.escape(url)}" target="_blank">Im RIS &rarr;</a>' if url else ''}
        </div>
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

.card-has-diff {{ border-left: 3px solid #007993; }}

.card-left {{ flex: 1; min-width: 0; }}
.card-title-row {{ display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }}

.chip-date {{
  display: inline-flex; align-items: center; gap: 4px;
  background: rgba(0,121,147,0.06); color: #007993;
}}
.chip-diff {{
  background: rgba(16,185,129,0.1); color: #059669;
  font-weight: 600;
}}

.version-info {{
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; margin-bottom: 12px;
  padding: 8px 12px; border-radius: 6px;
  background: linear-gradient(90deg, #fef2f2 0%, #f0fdf4 100%);
}}
.v-old {{ color: #991b1b; font-weight: 500; }}
.v-new {{ color: #166534; font-weight: 500; }}

.diff-box {{
  font-size: 13px;
  line-height: 1.8;
  padding: 12px 16px;
  background: #fafafa;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  max-height: 400px;
  overflow-y: auto;
  margin-bottom: 12px;
}}
.diff-box .diff-del {{
  background: #fecaca; color: #991b1b;
  text-decoration: line-through;
  padding: 1px 3px; border-radius: 3px;
}}
.diff-box .diff-ins {{
  background: #bbf7d0; color: #166534;
  padding: 1px 3px; border-radius: 3px;
}}
.diff-box .diff-info {{
  color: #6b7280; font-style: italic; margin-bottom: 8px;
}}
.diff-box .diff-sidebyside {{
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
}}
.diff-box .diff-side {{ padding: 10px; border-radius: 6px; font-size: 12px; line-height: 1.6; }}
.diff-box .diff-side-old {{ background: #fef2f2; border: 1px solid #fecaca; }}
.diff-box .diff-side-new {{ background: #f0fdf4; border: 1px solid #bbf7d0; }}
.diff-box .diff-side-label {{ font-weight: 600; font-size: 11px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }}
.diff-box .diff-side-old .diff-side-label {{ color: #991b1b; }}
.diff-box .diff-side-new .diff-side-label {{ color: #166534; }}
.diff-box .diff-side-text {{ white-space: pre-wrap; }}

.detail-meta {{
  font-size: 12px; color: #9ca3af; padding-top: 8px;
  border-top: 1px solid #e5e7eb;
}}
.detail-meta a {{ color: #007993; text-decoration: none; }}
.detail-meta a:hover {{ text-decoration: underline; }}

@media print {{
  .hero {{ background: #0f3d49 !important; -webkit-print-color-adjust: exact; }}
  .card-detail {{ max-height: none !important; padding: 14px 18px !important; }}
  .chevron {{ display: none; }}
  body {{ background: white; }}
  .diff-box {{ max-height: none; }}
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
    <div class="stat">
      <span class="stat-num">{changes_count}</span>
      <span class="stat-label">Mit Diff</span>
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
