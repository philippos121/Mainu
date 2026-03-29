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

    # 1. Get current version text via API
    current = await _get_version_text(gesetzesnummer, artikel, fassung_vom=None)
    if not current or not current["text"]:
        return _err("Aktueller Text konnte nicht geladen werden.")

    # 2. Compute FassungVom = Inkrafttreten - 1 day
    fv = _day_before(inkrafttreten)
    if not fv:
        return _err("Inkrafttretensdatum konnte nicht geparst werden.")

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
    1. Try API with ArtikelParagraphAnlage filter
    2. Extract text from Dokumentinhalt (inline text in API response)
    3. If no inline text, fetch the best ContentUrl HTML
    4. Filter to pick the correct provision (matching artikel)
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
    logger.info(f"API query: {params}")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(api_url, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.error(f"API error: {type(e).__name__}: {e}")
        return None

    # Step 2: Parse response — find the matching provision
    refs = data.get("OgdSearchResult", {}).get("OgdDocumentResults", {}).get("OgdDocumentReference", [])
    if isinstance(refs, dict):
        refs = [refs]
    if not refs:
        logger.info(f"No results for GN={gesetzesnummer} Art={artikel} FV={fassung_vom}")
        return None

    # Pick the best matching reference (match ArtikelParagraphAnlage)
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

    # Step 3: Fetch law text from ContentUrl (most reliable for actual paragraph text)
    # DO NOT use inline Dokumentinhalt — it often contains only Kurzinformation/annotations
    content_urls = _find_urls(d)
    logger.info(f"Content URLs for {doc_nr}: {content_urls}")

    best_text = ""
    best_url = ""

    if content_urls:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=_FETCH_HEADERS) as client:
            for u in content_urls[:4]:
                try:
                    resp = await client.get(u)
                    resp.raise_for_status()
                    raw = resp.text
                    t = _extract_law_text(raw, u)
                    # Only accept substantial text (>200 chars = real law content)
                    if t and len(t) > 200 and len(t) > len(best_text):
                        best_text = t
                        best_url = u
                except Exception as e:
                    logger.warning(f"Content fetch error for {u}: {e}")

    if best_text:
        logger.info(f"Got law text from {best_url}: {len(best_text)} chars")
        return {"text": _clean_accessible(best_text), "inkrafttreten": inkraft, "url": best_url}

    # Step 4: Fallback — try RIS website Dokument.wxe
    if doc_nr:
        fallback_url = f"https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer={doc_nr}"
        logger.info(f"Fallback to website: {fallback_url}")
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=_FETCH_HEADERS) as client:
                resp = await client.get(fallback_url)
                resp.raise_for_status()
                t = _extract_text_section(resp.text)
                if t and len(t) > 100:
                    return {"text": _clean_accessible(t), "inkrafttreten": inkraft, "url": fallback_url}
        except Exception as e:
            logger.error(f"Fallback fetch error: {e}")

    # Step 5: Last resort — try inline text only if substantial (>500 chars)
    inline = _extract_inline_text(d)
    if inline and len(inline) > 500:
        logger.info(f"Using inline text for {doc_nr}: {len(inline)} chars")
        return {"text": _clean_accessible(inline), "inkrafttreten": inkraft, "url": ""}

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


def _find_urls(data_entry: dict) -> list[str]:
    """Recursively find ContentUrl values, prioritize HTML content URLs."""
    urls = []
    _walk(data_entry, urls, 0)
    # Sort: HTML files first, then by URL length (longer = more specific)
    html_urls = [u for u in urls if "html" in u.lower()]
    other_urls = [u for u in urls if u not in html_urls]
    return html_urls + other_urls


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
    """Extract the 'Text' section from a RIS Dokument.wxe page."""
    ends = ["Schlagworte", "Zuletzt aktualisiert", "Dokumentnummer",
            "European Legislation Identifier", "Navigation im Suchergebnis",
            "Zum Seitenanfang"]
    end_pat = "|".join(re.escape(s) for s in ends)
    m = re.search(rf'>\s*Text\s*</[^>]+>(.*?)({end_pat})', html, re.DOTALL | re.IGNORECASE)
    if m:
        return _strip_html(m.group(1))
    # Fallback: largest block with legal text patterns
    blocks = re.findall(r'<(?:td|div)[^>]*>(.*?)</(?:td|div)>', html, re.DOTALL)
    best = ""
    for b in blocks:
        c = _strip_html(b)
        if len(c) > len(best) and len(c) > 100 and re.search(r'\(\d+\)|§\s*\d+', c):
            best = c
    return best


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


def _day_before(date_str: str) -> str | None:
    if not date_str:
        return None
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(date_str.strip().split("+")[0].split(".000")[0], fmt)
            return (dt - timedelta(days=1)).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None
