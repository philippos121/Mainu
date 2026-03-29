"""Diff service: compare a provision with its previous version.

Approach:
1. Current version: fetch from RIS API by Gesetzesnummer + ArtikelParagraphAnlage
2. Previous version: same query + Fassung.FassungVom = (Inkrafttretensdatum - 1 day)
3. Extract text from API response Dokumentinhalt or ContentUrl HTML
4. Diff the two texts
"""

import difflib
import html as html_module
import logging
import re
from datetime import datetime, timedelta

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

BASE_URL = settings.RIS_API_BASE_URL


async def fetch_provision_diff(doc_id: str, gesetzesnummer: str, artikel: str, inkrafttreten: str) -> dict:
    """Compare current provision text with version from day before Inkrafttreten."""
    logger.info(f"DIFF: gesetzesnr={gesetzesnummer}, art={artikel}, inkraft={inkrafttreten}")

    if not gesetzesnummer or not artikel:
        return _err("Gesetzesnummer oder Artikel fehlt.")

    # Parse inkrafttreten to use as FassungVom for current version
    # CRITICAL: Without FassungVom, the API returns § 0 (table of contents)
    # instead of the specific paragraph. Always pass a date.
    inkraft_date = _parse_date(inkrafttreten)
    if not inkraft_date:
        return _err("Inkrafttretensdatum konnte nicht geparst werden.")

    current_fv = inkraft_date.strftime("%Y-%m-%d")
    prev_fv = (inkraft_date - timedelta(days=1)).strftime("%Y-%m-%d")

    # 1. Get current version text (using Inkrafttreten as FassungVom)
    current = await _get_version_text(gesetzesnummer, artikel, fassung_vom=current_fv)
    if not current or not current["text"]:
        return _err("Aktueller Text konnte nicht geladen werden.")

    # 2. Get previous version text (Inkrafttreten - 1 day)
    fv = prev_fv

    # 3. Get previous version text
    previous = await _get_version_text(gesetzesnummer, artikel, fassung_vom=fv)
    if not previous or not previous["text"]:
        return {
            "current": {"text": current["text"], "date": inkrafttreten},
            "previous": None,
            "diff_html": f'<p class="diff-info">Keine Vorversion vom {fv} verfügbar (Erstfassung?).</p>'
                         f'<div class="diff-current">{html_module.escape(current["text"][:500])}</div>',
            "has_changes": False,
        }

    # 4. Compare
    ct = current["text"].strip()
    pt = previous["text"].strip()

    if ct == pt:
        return {
            "current": {"text": ct, "date": inkrafttreten},
            "previous": {"text": pt, "date": previous.get("inkrafttreten", fv)},
            "diff_html": f'<p class="diff-info">Kein Textunterschied zur Fassung vom {fv}.</p>'
                         f'<div class="diff-current">{html_module.escape(ct[:500])}</div>',
            "has_changes": False,
        }

    return {
        "current": {"text": ct, "date": inkrafttreten},
        "previous": {"text": pt, "date": previous.get("inkrafttreten", fv)},
        "diff_html": _diff(pt, ct),
        "has_changes": True,
    }


async def debug_document(gesetzesnummer: str, artikel: str) -> dict:
    """Debug: show what the API returns."""
    result = {}
    cur = await _get_version_text(gesetzesnummer, artikel, fassung_vom=None)
    result["current"] = {"text_len": len(cur["text"]) if cur else 0, "text_preview": cur["text"][:300] if cur else "", "url": cur.get("url", "")} if cur else {"error": "no result"}
    return result


# ── Core: get provision text via RIS API ──

async def _get_version_text(gesetzesnummer: str, artikel: str, fassung_vom: str | None) -> dict | None:
    """Query RIS API for a specific provision and extract its text.

    Strategy:
    1. Query API to get the document with ContentReferences
    2. Find the MainDocument ContentUrl (XML with actual law text)
    3. Fetch XML, extract text content
    4. Skip Attachments (they contain only titles/annotations)
    """

    # Step 1: Query API
    params = {
        "Applikation": "BrKons",
        "Gesetzesnummer": gesetzesnummer,
        "ArtikelParagraphAnlage": artikel,
        "DokumenteProSeite": "Ten",
    }
    if fassung_vom:
        params["Fassung.FassungVom"] = fassung_vom

    api_url = f"{BASE_URL}/Bundesrecht"
    logger.info(f"DIFF query: {params}")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(api_url, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.error(f"API error: {type(e).__name__}: {e}")
        return None

    # Step 2: Find the matching provision
    refs = data.get("OgdSearchResult", {}).get("OgdDocumentResults", {}).get("OgdDocumentReference", [])
    if isinstance(refs, dict):
        refs = [refs]
    if not refs:
        logger.info(f"No results for GN={gesetzesnummer} Art={artikel} FV={fassung_vom}")
        return None

    best_ref = refs[0]
    for ref in refs:
        meta = _flatten(ref.get("Data", {}))
        ref_art = meta.get("ArtikelParagraphAnlage", "")
        if ref_art and artikel and _normalize_artikel(ref_art) == _normalize_artikel(artikel):
            best_ref = ref
            break

    d = best_ref.get("Data", {})
    meta = _flatten(d)
    inkraft = meta.get("Inkrafttretensdatum", "")
    doc_nr = meta.get("Dokumentnummer", "") or meta.get("ID", "")
    logger.info(f"Found doc: {doc_nr}, Inkraft: {inkraft}")

    # Step 3: Find MainDocument URL (contains actual law text)
    # ContentReferences have ContentType: "MainDocument" vs "Attachment"
    # MainDocument is XML with the full legal text
    # Attachments are PDF/HTML with annotations/titles — SKIP these
    main_url, attach_urls = _find_main_document_url(d)
    logger.info(f"MainDoc URL: {main_url}, Attachments: {len(attach_urls)}")

    best_text = ""
    best_url = ""

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=_FETCH_HEADERS) as client:
        # Try MainDocument first (XML with full law text)
        if main_url:
            try:
                resp = await client.get(main_url)
                resp.raise_for_status()
                text = _strip_html(resp.text)
                if text and len(text) > 50:
                    best_text = text
                    best_url = main_url
                    logger.info(f"Got MainDocument text for {doc_nr}: {len(text)} chars")
            except Exception as e:
                logger.warning(f"MainDocument fetch error for {doc_nr}: {e}")

        # If MainDocument failed or was short, try attachment URLs but only accept long text
        if not best_text or len(best_text) < 100:
            for u in attach_urls[:3]:
                try:
                    resp = await client.get(u)
                    resp.raise_for_status()
                    t = _extract_law_text(resp.text, u)
                    if t and len(t) > 200 and len(t) > len(best_text):
                        best_text = t
                        best_url = u
                except Exception as e:
                    logger.warning(f"Attachment fetch error: {e}")

        # Last resort: RIS website (may timeout from Docker but worth trying)
        if (not best_text or len(best_text) < 100) and doc_nr:
            try:
                doc_url = f"https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer={doc_nr}"
                resp = await client.get(doc_url, timeout=15.0)
                resp.raise_for_status()
                t = _extract_text_section(resp.text)
                if t and len(t) > 50:
                    best_text = t
                    best_url = doc_url
                    logger.info(f"Got text via Dokument.wxe for {doc_nr}: {len(t)} chars")
            except Exception as e:
                logger.warning(f"Dokument.wxe timeout/error for {doc_nr}: {e}")

    if best_text:
        return {"text": _clean_accessible(best_text), "inkrafttreten": inkraft, "url": best_url}

    logger.warning(f"No text found for {doc_nr}")
    return None


_FETCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def _normalize_artikel(art: str) -> str:
    """Normalize article/paragraph string for comparison."""
    return re.sub(r'\s+', '', art.lower().strip())


def _extract_inline_text(data_entry: dict) -> str:
    """Extract Dokumentinhalt text directly from API response (no HTTP fetch needed).

    The RIS API sometimes includes the law text inline in the response as:
    - Data.Dokumentinhalt (HTML or text)
    - Data.Dokumentliste.ContentReference.Nutzdaten.Abschnitt (structured XML)
    """
    # Try Dokumentinhalt
    for key in ("Dokumentinhalt", "DokumentInhalt"):
        content = data_entry.get(key, "")
        if isinstance(content, str) and len(content) > 20:
            return _strip_html(content)

    # Try structured content in Dokumentliste
    doku_liste = data_entry.get("Dokumentliste", {})
    if isinstance(doku_liste, dict):
        content_ref = doku_liste.get("ContentReference", [])
        if isinstance(content_ref, dict):
            content_ref = [content_ref]
        if isinstance(content_ref, list):
            for cr in content_ref:
                if isinstance(cr, dict):
                    nutzdaten = cr.get("Nutzdaten", {})
                    if isinstance(nutzdaten, dict):
                        # Look for Abschnitt text
                        text = _extract_from_nutzdaten(nutzdaten)
                        if text and len(text) > 20:
                            return text
                    elif isinstance(nutzdaten, str) and len(nutzdaten) > 20:
                        return _strip_html(nutzdaten)

    return ""


def _extract_from_nutzdaten(nutzdaten: dict) -> str:
    """Extract text from Nutzdaten XML structure."""
    parts = []

    def _collect(obj, depth=0):
        if depth > 10:
            return
        if isinstance(obj, str):
            clean = obj.strip()
            if clean and len(clean) > 2:
                parts.append(clean)
        elif isinstance(obj, dict):
            # Skip metadata keys
            for k, v in obj.items():
                if k.lower() in ("@xmlns", "@id", "@type", "#comment"):
                    continue
                if k.lower() in ("#text", "text", "inhalt", "absatz", "abs", "content"):
                    _collect(v, depth + 1)
                elif isinstance(v, (dict, list)):
                    _collect(v, depth + 1)
        elif isinstance(obj, list):
            for item in obj:
                _collect(item, depth + 1)

    _collect(nutzdaten)
    return "\n".join(parts)


# ── Response parsing ──

def _flatten(data_entry: dict) -> dict:
    """Flatten nested API metadata."""
    metadata = data_entry.get("Metadaten", {})
    merged = {}
    for key in ("Technisch", "Allgemein", "Bundesrecht"):
        section = metadata.get(key)
        if isinstance(section, list) and section:
            section = section[0]
        if isinstance(section, dict):
            merged.update(section)
            for sub in ("BrKons",):
                s = section.get(sub)
                if isinstance(s, list) and s:
                    s = s[0]
                if isinstance(s, dict):
                    merged.update(s)
    return merged


def _find_main_document_url(data_entry: dict) -> tuple[str, list[str]]:
    """Find the MainDocument URL (law text XML) and Attachment URLs separately.

    RIS API ContentReferences have:
    - ContentType: "MainDocument" → XML with actual law text
    - ContentType: "Attachment" → PDF/HTML with annotations, titles
    """
    main_url = ""
    attach_urls = []

    def _search(obj, depth=0):
        nonlocal main_url
        if depth > 12:
            return
        if isinstance(obj, dict):
            content_type = obj.get("ContentType", "")
            url = ""
            # Check for Url in ContentUrl
            cu = obj.get("ContentUrl")
            if isinstance(cu, str) and cu.startswith("http"):
                url = cu
            elif isinstance(cu, dict) and "Url" in cu:
                url = cu["Url"]
            elif isinstance(cu, list):
                for item in cu:
                    if isinstance(item, dict) and "Url" in item:
                        url = url or item["Url"]
                    elif isinstance(item, str) and item.startswith("http"):
                        url = url or item

            if not url and "Url" in obj and "DataType" in obj:
                url = obj["Url"]

            if url and isinstance(url, str) and url.startswith("http"):
                if content_type == "MainDocument" or obj.get("DataType") == "Xml":
                    if not main_url:
                        main_url = url
                else:
                    attach_urls.append(url)

            for val in obj.values():
                _search(val, depth + 1)
        elif isinstance(obj, list):
            for item in obj:
                _search(item, depth + 1)

    _search(data_entry)
    return main_url, attach_urls


def _find_urls(data_entry: dict) -> list[str]:
    """Recursively find all ContentUrl values (fallback)."""
    main, attachments = _find_main_document_url(data_entry)
    result = []
    if main:
        result.append(main)
    result.extend(attachments)
    return result


def _walk(obj, urls, depth):
    if depth > 12:
        return
    if isinstance(obj, dict):
        if "Url" in obj and "DataType" in obj:
            u = obj["Url"]
            if isinstance(u, str) and u.startswith("http"):
                urls.append(u)
        if "ContentUrl" in obj:
            v = obj["ContentUrl"]
            if isinstance(v, str) and v.startswith("http"):
                urls.append(v)
            elif isinstance(v, list):
                for item in v:
                    if isinstance(item, dict) and "Url" in item:
                        urls.append(item["Url"])
                    elif isinstance(item, str) and item.startswith("http"):
                        urls.append(item)
        for val in obj.values():
            _walk(val, urls, depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            _walk(item, urls, depth + 1)


# ── Text extraction ──

def _extract_law_text(html: str, url: str) -> str:
    """Extract legal text from fetched HTML content.

    Distinguishes between:
    - Full RIS pages (Dokument.wxe) → extract "Text" section
    - Raw content URLs → strip HTML and check if it's actual law text
    """
    if "Dokument.wxe" in url or len(html) > 10000:
        return _extract_text_section(html)

    text = _strip_html(html)

    # Filter out non-law-text content (titles, metadata, navigation)
    # Real law text typically has numbered paragraphs, legal phrases, etc.
    if len(text) < 50:
        return ""

    # Check if this looks like actual law text vs. a title/index entry
    # Index entries are typically short and contain only headings
    lines = text.strip().split("\n")
    if len(lines) <= 3 and all(len(l.strip()) < 100 for l in lines):
        # Likely a title or index entry, not law text
        logger.info(f"Skipping short content (likely title): {text[:80]}")
        return ""

    return text


def _extract_text_section(html: str) -> str:
    """Extract the 'Text' section from a RIS page or content URL."""
    # Try to find the "Text" section marker (Dokument.wxe pages)
    ends = ["Schlagworte", "Zuletzt aktualisiert", "Dokumentnummer",
            "European Legislation Identifier", "Navigation im Suchergebnis",
            "Zum Seitenanfang"]
    end_pat = "|".join(re.escape(s) for s in ends)
    m = re.search(rf'>\s*Text\s*</[^>]+>(.*?)({end_pat})', html, re.DOTALL | re.IGNORECASE)
    if m:
        return _strip_metadata(_strip_html(m.group(1)))
    # Fallback: strip HTML and remove metadata header
    text = _strip_html(html)
    return _strip_metadata(text)


def _strip_metadata(text: str) -> str:
    """Remove RIS metadata header from extracted text.

    RIS pages include: "Bundesrecht konsolidiert www.ris.bka.gv.at Seite X von Y
    Kurztitel ... Kundmachungsorgan ... Typ ... §/Artikel/Anlage ...
    Inkrafttretensdatum ... Außerkrafttretensdatum ... Abkürzung ... Index ...
    Beachte ... Text <actual law text>"
    """
    # Method 1: Find "Text" marker followed by actual content
    m = re.search(r'\bText\s+((?:\d+\.\s*(?:TEIL|ABSCHNITT|Abschnitt)|§\s*\d+|Artikel|Anlage)\b.+)', text, re.DOTALL)
    if m and len(m.group(1)) > 50:
        return m.group(1).strip()

    # Method 2: Strip known metadata prefixes
    cleaned = text
    # Remove "Bundesrecht konsolidiert" header
    cleaned = re.sub(r'^.*?(?:www\.ris\.bka\.gv\.at\s+Seite\s+\d+\s+von\s+\d+\s*)+', '', cleaned, flags=re.DOTALL)
    # Remove metadata fields up to "Text" or first § marker
    cleaned = re.sub(
        r'^.*?(?:Kurztitel|Kundmachungsorgan|Inkrafttretensdatum|Abkürzung|Index|Beachte|Langtitel|Änderung|Präambel).*?(?=(?:\d+\.\s*(?:TEIL|ABSCHNITT)|§\s*\d+|\(\d+\)))',
        '', cleaned, count=1, flags=re.DOTALL
    )
    # Remove "Inhaltsverzeichnis" sections (§ 0 content)
    if 'Inhaltsverzeichnis' in cleaned and len(cleaned) < 3000:
        # This is likely the table of contents, not actual law text
        m2 = re.search(r'(§\s*\d+[a-z]?\.\s*\(\d+\).+)', cleaned, re.DOTALL)
        if m2:
            cleaned = m2.group(1)
        else:
            return ""  # Only table of contents, no real text

    return cleaned.strip()


def _strip_html(text: str) -> str:
    """Strip HTML tags to plain text."""
    c = re.sub(r'<(script|style|noscript)[^>]*>.*?</\1>', '', text, flags=re.DOTALL | re.IGNORECASE)
    c = re.sub(r'<span[^>]*class="[^"]*(?:Gld[A-Z][a-z]+|ScreenReader)[^"]*"[^>]*>.*?</span>', '', c, flags=re.DOTALL)
    c = re.sub(r'<div[^>]*id="MainContent[^"]*"[^>]*/?>', '', c)
    c = re.sub(r'<(?:br|/p|/div|/tr|/li)\s*/?>', '\n', c, flags=re.IGNORECASE)
    c = re.sub(r'<[^>]+>', ' ', c)
    c = html_module.unescape(c)
    c = re.sub(r'[ \t]+', ' ', c)
    c = re.sub(r'\n[ \t]+', '\n', c)
    c = re.sub(r'\n{3,}', '\n\n', c)
    return c.strip()


def _clean_accessible(text: str) -> str:
    """Remove RIS accessible text duplicates (screenreader content)."""
    text = re.sub(r'(§\s*\d+[a-z]?\.?)\s*Paragraph\s*\d+[a-z]?,?\s*', r'\1 ', text)
    text = re.sub(r'(\(\d+[a-z]?\))\s*Absatz\s*(?:eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|\d+\s*[a-z]?),?\s*', r'\1 ', text)
    text = re.sub(r'\bParagraph\s+\d+\s*[a-z]?,\s*', '', text)
    text = re.sub(r'\bAbsatz\s+\d+\s*[a-z]?,\s*', '', text)
    text = re.sub(r'\bAbsatz\s+(?:eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn),\s*', '', text)
    text = re.sub(r'\bZiffer\s+(?:eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|\d+)\s*', '', text)
    text = re.sub(r'\bLitera\s+[a-z]\s*', '', text)
    text = re.sub(r',?\s*Bundesgesetzblatt\s+Nr\.\s*\d+\s+aus\s+\d+,?\s*', ' ', text)
    text = re.sub(r'\brömisch\s+(?:eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|[IVXivx]+)\.?\s*', '', text)
    text = re.sub(r'<div[^>]*$', '', text)
    text = re.sub(r'\s*Im RIS seit\s+[\d.]+\s*$', '', text)
    text = re.sub(r'  +', ' ', text)
    return text.strip()


# ── Diff rendering ──

def _diff(old: str, new: str) -> str:
    """Generate word-level diff HTML."""
    ow, nw = old.split(), new.split()
    if not ow and not nw:
        return '<p class="diff-info">Beide Versionen leer.</p>'

    sm = difflib.SequenceMatcher(None, ow, nw)
    ratio = sm.ratio()

    if ratio < 0.4:
        return (
            '<p class="diff-info">Umfassende Neufassung (&lt;40% Übereinstimmung):</p>'
            '<div class="diff-sidebyside">'
            f'<div class="diff-side diff-side-old"><div class="diff-side-label">Vorversion</div>'
            f'<div class="diff-side-text">{html_module.escape(old[:2000])}</div></div>'
            f'<div class="diff-side diff-side-new"><div class="diff-side-label">Neue Fassung</div>'
            f'<div class="diff-side-text">{html_module.escape(new[:2000])}</div></div></div>'
        )

    parts = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            parts.append(html_module.escape(" ".join(ow[i1:i2])))
        elif op == "delete":
            parts.append(f'<span class="diff-del">{html_module.escape(" ".join(ow[i1:i2]))}</span>')
        elif op == "insert":
            parts.append(f'<span class="diff-ins">{html_module.escape(" ".join(nw[j1:j2]))}</span>')
        elif op == "replace":
            parts.append(f'<span class="diff-del">{html_module.escape(" ".join(ow[i1:i2]))}</span>')
            parts.append(f'<span class="diff-ins">{html_module.escape(" ".join(nw[j1:j2]))}</span>')
    return " ".join(parts)


def _err(msg: str) -> dict:
    return {"current": None, "previous": None,
            "diff_html": f'<p class="diff-info">{html_module.escape(msg)}</p>',
            "has_changes": False}


def _parse_date(date_str: str) -> datetime | None:
    """Parse a date string in various formats."""
    if not date_str:
        return None
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(date_str.strip().split("+")[0].split(".000")[0], fmt)
        except ValueError:
            continue
    return None


def _day_before(date_str: str) -> str | None:
    dt = _parse_date(date_str)
    return (dt - timedelta(days=1)).strftime("%Y-%m-%d") if dt else None
