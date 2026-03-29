"""EUR-Lex client — EU legislation via CELLAR SPARQL endpoint.

Uses the Publications Office SPARQL endpoint to find recent EU legislation
(Verordnungen, Richtlinien, Beschlüsse) and retrieve metadata + summaries.

SPARQL endpoint: https://publications.europa.eu/webapi/rdf/sparql
Output format: application/sparql-results+json
"""

import logging
import re
from datetime import date, timedelta
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

SPARQL_ENDPOINT = "https://publications.europa.eu/webapi/rdf/sparql"

# Map our timeframe values to days
_TIMEFRAME_DAYS = {
    "EinerWoche": 7,
    "ZweiWochen": 14,
    "EinemMonat": 30,
    "DreiMonaten": 90,
    "EinemJahr": 366,
}


def _build_sparql_query(days: int = 30, limit: int = 50) -> str:
    """Build SPARQL query for recent EU legislative acts."""
    since = (date.today() - timedelta(days=days)).strftime("%Y-%m-%d")

    return f"""
PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

SELECT DISTINCT
  ?work
  ?title
  ?celex
  ?date_document
  ?date_entry_into_force
  ?resource_type
WHERE {{
  ?work cdm:work_has_resource-type ?type .

  # Legislative acts: regulations, directives, decisions
  VALUES ?type {{
    <http://publications.europa.eu/resource/authority/resource-type/REG>
    <http://publications.europa.eu/resource/authority/resource-type/DIR>
    <http://publications.europa.eu/resource/authority/resource-type/DEC>
    <http://publications.europa.eu/resource/authority/resource-type/REG_IMPL>
    <http://publications.europa.eu/resource/authority/resource-type/REG_DEL>
    <http://publications.europa.eu/resource/authority/resource-type/DIR_IMPL>
    <http://publications.europa.eu/resource/authority/resource-type/DIR_DEL>
  }}

  ?work cdm:work_date_document ?date_document .
  FILTER(?date_document >= "{since}"^^xsd:date)

  # Title in German (fallback to English)
  OPTIONAL {{
    ?work cdm:work_is_about_concept_eurovoc ?eurovoc .
  }}
  OPTIONAL {{
    ?exp cdm:expression_belongs_to_work ?work .
    ?exp cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/DEU> .
    ?exp cdm:expression_title ?title_de .
  }}
  OPTIONAL {{
    ?exp_en cdm:expression_belongs_to_work ?work .
    ?exp_en cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> .
    ?exp_en cdm:expression_title ?title_en .
  }}
  BIND(COALESCE(?title_de, ?title_en, "") AS ?title)

  # CELEX number
  OPTIONAL {{ ?work cdm:resource_legal_id_celex ?celex . }}

  # Entry into force
  OPTIONAL {{ ?work cdm:work_date_of_effect ?date_entry_into_force . }}

  # Resource type label
  OPTIONAL {{ ?type cdm:authority-code ?resource_type . }}
}}
ORDER BY DESC(?date_document)
LIMIT {limit}
"""


async def search_eurlex(im_ris_seit: str = "EinemMonat") -> list[dict]:
    """Search EUR-Lex for recent EU legislative acts.

    Returns results compatible with the report pipeline.
    """
    days = _TIMEFRAME_DAYS.get(im_ris_seit, 30)
    query = _build_sparql_query(days=days, limit=50)

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(
                SPARQL_ENDPOINT,
                params={
                    "query": query,
                    "format": "application/sparql-results+json",
                },
                headers={
                    "Accept": "application/sparql-results+json",
                    "User-Agent": "AIssociate-Monitoring/1.0",
                },
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.error(f"EUR-Lex SPARQL error: {e}")
            return []

    bindings = data.get("results", {}).get("bindings", [])
    results = []
    seen = set()

    for b in bindings:
        celex = b.get("celex", {}).get("value", "")
        work_uri = b.get("work", {}).get("value", "")
        title = b.get("title", {}).get("value", "")
        doc_date = b.get("date_document", {}).get("value", "")
        entry_force = b.get("date_entry_into_force", {}).get("value", "")
        res_type = b.get("resource_type", {}).get("value", "")

        # Deduplicate by CELEX or work URI
        dedup_key = celex or work_uri
        if dedup_key in seen or not title:
            continue
        seen.add(dedup_key)

        # Map resource type to German label
        typ_map = {
            "REG": "Verordnung",
            "DIR": "Richtlinie",
            "DEC": "Beschluss",
            "REG_IMPL": "Durchführungsverordnung",
            "REG_DEL": "Delegierte Verordnung",
            "DIR_IMPL": "Durchführungsrichtlinie",
            "DIR_DEL": "Delegierte Richtlinie",
        }
        typ = typ_map.get(res_type, res_type or "EU-Akt")

        # Build EUR-Lex URL
        if celex:
            url = f"https://eur-lex.europa.eu/legal-content/DE/ALL/?uri=CELEX:{celex}"
        elif work_uri:
            url = work_uri
        else:
            url = ""

        results.append({
            "id": f"EURLEX_{celex}" if celex else f"EURLEX_{len(results)}",
            "title": _clean_title(title),
            "long_title": title,
            "url": url,
            "date": entry_force or doc_date,
            "bgbl": celex,
            "typ": typ,
            "artikel": "",
            "source": "eurlex",
            "gesetzesnummer": "",
            "materialien": "",
        })

    logger.info(f"EUR-Lex: found {len(results)} acts (last {days} days)")
    return results


def _clean_title(title: str) -> str:
    """Shorten long EUR-Lex titles."""
    if len(title) > 200:
        return title[:197] + "…"
    return title


async def fetch_eurlex_summary(celex: str) -> str:
    """Fetch the summary/abstract of an EU act by CELEX number."""
    if not celex:
        return ""

    # Use EUR-Lex summary page
    url = f"https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:{celex}"

    async with httpx.AsyncClient(
        timeout=15.0,
        follow_redirects=True,
        headers={"User-Agent": "AIssociate-Monitoring/1.0", "Accept": "text/html"},
    ) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            html = resp.text
        except Exception as e:
            logger.warning(f"EUR-Lex summary fetch error for {celex}: {e}")
            return ""

    import html as html_mod

    # Extract text content
    clean = re.sub(r"<(script|style|nav|header|footer)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
    clean = re.sub(r"<[^>]+>", " ", clean)
    clean = html_mod.unescape(clean)
    clean = re.sub(r"\s+", " ", clean).strip()

    return clean[:3000] if len(clean) > 100 else ""
