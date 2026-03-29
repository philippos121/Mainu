"""Diff service: compare a provision with its previous version.

Simple approach:
1. Current version: fetch from RIS API by Gesetzesnummer + ArtikelParagraphAnlage (no FassungVom = today's version)
2. Previous version: same query + Fassung.FassungVom = (Inkrafttretensdatum - 1 day)
3. Both return metadata + ContentReference with HTML/XML URLs
4. Fetch the HTML content URLs to get the actual legal text
5. Diff the two texts
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
                         f'<div class="diff-current">{html_module.escape(current["text"])}</div>',
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
                         f'<div class="diff-current">{html_module.escape(ct)}</div>',
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
    result["current"] = {"text_len": len(cur["text"]) if cur else 0, "meta": cur} if cur else {"error": "no result"}
    return result


# ── Core: get provision text via RIS API + content URL ──

async def _get_version_text(gesetzesnummer: str, artikel: str, fassung_vom: str | None) -> dict | None:
    """Query RIS API, get content URL, fetch HTML, extract text."""

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

    # Step 2: Parse response
    refs = data.get("OgdSearchResult", {}).get("OgdDocumentResults", {}).get("OgdDocumentReference", [])
    if isinstance(refs, dict):
        refs = [refs]
    if not refs:
        logger.info(f"No results for FassungVom={fassung_vom}")
        return None

    ref = refs[0]
    d = ref.get("Data", {})
    meta = _flatten(d)
    inkraft = meta.get("Inkrafttretensdatum", "")

    # Step 3: Find content URL (HTML preferred)
    content_urls = _find_urls(d)
    logger.info(f"Content URLs: {len(content_urls)}")

    html_url = None
    for u in content_urls:
        if "html" in u.lower() or "Html" in u:
            html_url = u
            break
    if not html_url and content_urls:
        html_url = content_urls[0]

    if not html_url:
        # Fallback: try RIS website
        nor = meta.get("ID", "") or meta.get("Dokumentnummer", "")
        if nor:
            html_url = f"https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer={nor}"
            logger.info(f"Fallback to website: {html_url}")

    if not html_url:
        logger.warning("No content URL found")
        return None

    # Step 4: Fetch HTML content
    text = await _fetch_html(html_url)
    if not text:
        return None

    return {"text": text, "inkrafttreten": inkraft, "url": html_url}


async def _fetch_html(url: str) -> str:
    """Fetch HTML from URL, extract legal text."""
    logger.info(f"Fetch content: {url}")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=headers) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            raw = resp.text
    except Exception as e:
        logger.error(f"Fetch error: {type(e).__name__}: {e}")
        return ""

    # If it's a full RIS page (Dokument.wxe), extract the "Text" section
    if "Dokument.wxe" in url or len(raw) > 5000:
        text = _extract_text_section(raw)
        if text:
            return _clean_accessible(text)

    # Otherwise it's raw content from a ContentUrl
    return _clean_accessible(_strip_html(raw))


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
    """Recursively find ContentUrl values."""
    urls = []
    _walk(data_entry, urls, 0)
    return urls


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
    c = re.sub(r'<span[^>]*class="[^"]*(?:Gld[A-Z][a-z]+|ScreenReader)[^"]*"[^>]*>.*?</span>', '', c, flags=re.DOTALL | re.IGNORECASE)
    c = re.sub(r'<div[^>]*id="MainContent[^"]*"[^>]*/?>', '', c)
    c = re.sub(r'<(?:br|/p|/div|/tr|/li)\s*/?>', '\n', c, flags=re.IGNORECASE)
    c = re.sub(r'<[^>]+>', ' ', c)
    c = html_module.unescape(c)
    c = re.sub(r'[ \t]+', ' ', c)
    c = re.sub(r'\n[ \t]+', '\n', c)
    c = re.sub(r'\n{3,}', '\n\n', c)
    return c.strip()


def _clean_accessible(text: str) -> str:
    """Remove RIS accessible text duplicates."""
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


# ── Diff ──

def _diff(old: str, new: str) -> str:
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
            f'<div class="diff-side-text">{html_module.escape(old)}</div></div>'
            f'<div class="diff-side diff-side-new"><div class="diff-side-label">Neue Fassung</div>'
            f'<div class="diff-side-text">{html_module.escape(new)}</div></div></div>'
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
