"""Service for fetching and comparing versions of RIS Bundesrecht provisions.

Proven approach (validated with real data):
1. Fetch the NOR-specific page from ris.bka.gv.at → extract text (works: 12688 chars)
2. Parse "Alle Fassungen" links from same page → get previous NOR (works: found 6 NORs)
3. Fetch previous NOR's page → extract text
4. Compute word-level diff

Why other approaches failed:
- API ContentUrls → return entire law, not specific paragraph
- API Fassung.VonInkrafttretensdatum range → returns ALL paragraphs of the law
- API FassungVom → returns same consolidated NOR number
- Website FassungVom on Dokument.wxe → ignored when specific NOR given
"""

import difflib
import html as html_module
import logging
import re

import httpx

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-AT,de;q=0.9,en;q=0.5",
}

_DOC_URL = "https://www.ris.bka.gv.at/Dokument.wxe?Abfrage=Bundesnormen&Dokumentnummer="


async def fetch_provision_diff(
    doc_id: str,
    gesetzesnummer: str,
    artikel: str,
    inkrafttreten: str,
) -> dict:
    """Fetch current + previous version and return diff."""
    logger.info(f"=== DIFF: NOR={doc_id}, Art={artikel}, Inkraft={inkrafttreten}")

    if not doc_id:
        return _error("Dokumentnummer (NOR) fehlt.")

    # 1. Fetch current page → text + Alle Fassungen NOR list
    page = await _fetch_page(doc_id)
    if not page or not page["text"]:
        return _error(f"Text für {doc_id} konnte nicht geladen werden.")

    current_text = page["text"]
    all_nors = page["version_nors"]
    logger.info(f"Text: {len(current_text)} chars, Alle Fassungen: {all_nors}")

    # 2. Find previous NOR
    prev_nor = _next_nor(doc_id, all_nors)
    if not prev_nor:
        return {
            "current": {"text": current_text, "date": inkrafttreten, "nor_id": doc_id},
            "previous": None,
            "diff_html": _no_prev(
                "Keine Vorversion gefunden (Erstfassung oder einzige Version).",
                current_text),
            "has_changes": False,
        }

    logger.info(f"Previous NOR: {prev_nor}")

    # 3. Fetch previous version text
    prev_page = await _fetch_page(prev_nor)
    prev_text = prev_page["text"] if prev_page else ""
    if not prev_text:
        return {
            "current": {"text": current_text, "date": inkrafttreten, "nor_id": doc_id},
            "previous": None,
            "diff_html": _no_prev(f"Text für Vorversion {prev_nor} nicht ladbar.", current_text),
            "has_changes": False,
        }

    prev_inkraft = prev_page.get("inkrafttreten", "")

    # 4. Diff
    if current_text.strip() == prev_text.strip():
        return {
            "current": {"text": current_text, "date": inkrafttreten, "nor_id": doc_id},
            "previous": {"text": prev_text, "date": prev_inkraft, "nor_id": prev_nor},
            "diff_html": (
                f'<p class="diff-info">Identischer Text mit Vorversion ({prev_nor}, '
                f'Inkrafttreten {prev_inkraft}). Redaktionelle/formale Änderung.</p>'
                f'<div class="diff-current">{html_module.escape(current_text)}</div>'
            ),
            "has_changes": False,
        }

    return {
        "current": {"text": current_text, "date": inkrafttreten, "nor_id": doc_id},
        "previous": {"text": prev_text, "date": prev_inkraft, "nor_id": prev_nor},
        "diff_html": _word_diff(prev_text, current_text),
        "has_changes": True,
    }


async def debug_document(gesetzesnummer: str, artikel: str) -> dict:
    """DEBUG: pass NOR as artikel to inspect page parsing."""
    nor = artikel if artikel.startswith("NOR") else ""
    if not nor:
        return {"usage": "Pass NOR number as artikel, e.g. artikel=NOR40275544"}
    page = await _fetch_page(nor)
    if not page:
        return {"error": f"Could not fetch {nor}"}
    return {
        "text_length": len(page["text"]),
        "text_preview": page["text"][:400] + "..." if len(page["text"]) > 400 else page["text"],
        "version_nors": page["version_nors"],
        "inkrafttreten": page.get("inkrafttreten", ""),
        "ausserkrafttreten": page.get("ausserkrafttreten", ""),
    }


# ── Page fetch + parse ──

async def _fetch_page(nor: str) -> dict | None:
    """Fetch RIS Dokument.wxe page, extract text + version NORs."""
    url = f"{_DOC_URL}{nor}"
    logger.info(f"Fetch: {url}")
    async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, headers=_HEADERS) as client:
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            return _parse(resp.text, nor)
        except Exception as e:
            logger.error(f"Fetch {nor}: {e}")
            return None


def _parse(html: str, current_nor: str = "") -> dict:
    """Parse RIS page: text, version NORs, metadata."""
    r = {"text": "", "version_nors": [], "inkrafttreten": "", "ausserkrafttreten": ""}
    if not html or len(html) < 200:
        return r

    # ── Text ──
    # Find >Text</tag> then content until next section label
    ends = ["Schlagworte", "Zuletzt aktualisiert", "Dokumentnummer",
            "European Legislation Identifier", "Navigation im Suchergebnis",
            "Zum Seitenanfang"]
    end_pat = "|".join(re.escape(s) for s in ends)
    m = re.search(rf'>\s*Text\s*</[^>]+>(.*?)({end_pat})', html, re.DOTALL | re.IGNORECASE)
    if m:
        raw = m.group(1)
        # Remove any stray <div> tags that start with MainContent (page structure artifacts)
        raw = re.sub(r'<div[^>]*id="MainContent[^"]*"[^>]*/?\s*>?', '', raw)
        t = _clean(raw)
        if len(t) > 20:
            r["text"] = _dedup_accessible(t)

    if not r["text"]:
        blocks = re.findall(r'<(?:td|div)[^>]*>(.*?)</(?:td|div)>', html, re.DOTALL)
        best = ""
        for b in blocks:
            c = _clean(b)
            if len(c) > len(best) and len(c) > 100 and re.search(r'\(\d+\)|§\s*\d+', c):
                best = c
        if best:
            r["text"] = _dedup_accessible(best)

    # ── Metadata ──
    for label, key in [("Inkrafttretensdatum", "inkrafttreten"),
                       ("Außerkrafttretensdatum", "ausserkrafttreten")]:
        mm = re.search(rf'>\s*{re.escape(label)}\s*</[^>]+>\s*(?:<[^>]+>\s*)*([^<]+)', html, re.IGNORECASE)
        if mm:
            r[key] = html_module.unescape(mm.group(1).strip())

    # ── Alle Fassungen NORs ──
    # CRITICAL: Each § on the page has its OWN version list in a
    # <div class="...documentVersionsDialogBody..."> containing an <ol> with <li> entries.
    # We must find the div that contains the CURRENT NOR to avoid mixing up
    # version lists from different paragraphs (ABGB has 1000+ §§).
    #
    # HTML structure (from real debug):
    # <div id="...DocumentVersionList_0_DialogBody_0" class="ui-helper-hidden documentVersionsDialogBody">
    #   <ol>
    #     <li class="selectedDocumentVersion">
    #       <a href="/eli/rgbl/1906/58/P30g/NOR40275544">§ 30g gültig ab 19.02.2026</a>
    #     </li>
    #     <li><a href="/eli/rgbl/1906/58/P30g/NOR40181338">§ 30g gültig von ...</a></li>
    #   </ol>
    # </div>
    nors = []

    # Strategy 1: Find the documentVersionsDialogBody div containing current NOR
    if current_nor:
        # Find all version dialog divs
        dialog_pattern = r'<div[^>]*class="[^"]*documentVersionsDialogBody[^"]*"[^>]*>(.*?)</div>'
        dialogs = re.findall(dialog_pattern, html, re.DOTALL | re.IGNORECASE)
        for dialog_content in dialogs:
            if current_nor in dialog_content:
                # This is OUR version list! Extract all NOR numbers from it.
                found = re.findall(r'/(NOR\d+)', dialog_content)
                nors = _unique(found)
                logger.info(f"Found version dialog with current NOR: {nors}")
                break

    # Strategy 2: Find "Alle Fassungen" link with current NOR's anchor, then look at nearby dialog
    if not nors and current_nor:
        # The "Alle Fassungen" link has href="...#alleFassungen" with the current NOR
        afl_idx = html.find(f'{current_nor}#alleFassungen')
        if afl_idx >= 0:
            # The dialog div is right after this link
            chunk = html[afl_idx:afl_idx + 5000]
            found = re.findall(r'/(NOR\d+)', chunk)
            # Remove current NOR's duplicate from the anchor itself and keep unique
            nors = _unique(found)
            logger.info(f"Found via Alle Fassungen anchor: {nors}")

    # Strategy 3: Broader — find all NOR-containing eli links near "selectedDocumentVersion"
    if not nors:
        sel_idx = html.find('selectedDocumentVersion')
        if sel_idx >= 0:
            # Search within 3000 chars around the selectedDocumentVersion
            start = max(0, sel_idx - 500)
            chunk = html[start:start + 4000]
            found = re.findall(r'/(NOR\d+)', chunk)
            nors = _unique(found)
            logger.info(f"Found via selectedDocumentVersion: {nors}")

    r["version_nors"] = nors
    logger.info(f"Parsed: text={len(r['text'])}ch, nors={nors}, inkraft={r['inkrafttreten']}")
    return r


def _next_nor(current: str, nors: list[str]) -> str | None:
    """Find the NOR immediately after current in the list (= previous version)."""
    for i, n in enumerate(nors):
        if n == current and i + 1 < len(nors):
            return nors[i + 1]
    # Fallback: first NOR that differs
    for n in nors:
        if n != current:
            return n
    return None


def _unique(lst: list[str]) -> list[str]:
    seen = set()
    out = []
    for x in lst:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


# ── Text cleanup ──

def _dedup_accessible(text: str) -> str:
    text = re.sub(r'(§\s*\d+[a-z]?\.?)\s*Paragraph\s*\d+[a-z]?,?\s*', r'\1 ', text)
    text = re.sub(
        r'(\(\d+[a-z]?\))\s*Absatz\s*(?:eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|\d+\s*[a-z]?),?\s*',
        r'\1 ', text)
    text = re.sub(r'Anmerkung,?\s*aus Bundesgesetzblatt[^)]*\)\s*', '', text)
    text = re.sub(r'\bParagraph\s+\d+\s*[a-z]?,\s*', '', text)
    text = re.sub(r'\bAbsatz\s+\d+\s*[a-z]?,\s*', '', text)
    text = re.sub(r'\bZiffer\s+(?:eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|\d+)\s*', '', text)
    text = re.sub(r'\bLitera\s+[a-z]\s*', '', text)
    text = re.sub(r'  +', ' ', text)
    return text.strip()


def _word_diff(old: str, new: str) -> str:
    ow, nw = old.split(), new.split()
    if not ow and not nw:
        return '<p class="diff-info">Beide Versionen leer.</p>'

    sm = difflib.SequenceMatcher(None, ow, nw)
    ratio = sm.ratio()

    # If similarity < 40%, it's a complete rewrite → show side-by-side
    if ratio < 0.4:
        return (
            '<p class="diff-info">Umfassende Neufassung (weniger als 40% Textübereinstimmung). '
            'Gegenüberstellung statt Inline-Diff:</p>'
            '<div class="diff-sidebyside">'
            f'<div class="diff-side diff-side-old">'
            f'<div class="diff-side-label">Vorversion</div>'
            f'<div class="diff-side-text">{html_module.escape(old)}</div></div>'
            f'<div class="diff-side diff-side-new">'
            f'<div class="diff-side-label">Neue Fassung</div>'
            f'<div class="diff-side-text">{html_module.escape(new)}</div></div>'
            '</div>'
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


def _no_prev(msg: str, text: str) -> str:
    return (f'<p class="diff-info">{html_module.escape(msg)}</p>'
            f'<div class="diff-current">{html_module.escape(text)}</div>')


def _error(msg: str) -> dict:
    return {"current": None, "previous": None,
            "diff_html": f'<p class="diff-info">{html_module.escape(msg)}</p>',
            "has_changes": False}


def _clean(text: str) -> str:
    c = re.sub(r'<(script|style|noscript)[^>]*>.*?</\1>', '', text, flags=re.DOTALL | re.IGNORECASE)
    c = re.sub(r'<(?:br|/p|/div|/tr|/li)\s*/?>', '\n', c, flags=re.IGNORECASE)
    c = re.sub(r'<[^>]+>', ' ', c)
    c = html_module.unescape(c)
    c = re.sub(r'[ \t]+', ' ', c)
    c = re.sub(r'\n[ \t]+', '\n', c)
    c = re.sub(r'\n{3,}', '\n\n', c)
    return c.strip()
