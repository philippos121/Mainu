"""OpenAI GPT integration for summarising RIS search results.

The API key is passed per-request from the frontend — no server-side key needed.
"""

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

GPT_MODEL = "gpt-4.1"


async def summarise_results(
    results: list[dict[str, Any]],
    doc_type: str,
    api_key: str,
) -> str:
    """Call OpenAI Chat Completions to summarise a list of RIS results.

    Returns a German-language markdown summary.
    """
    if not results:
        return "Keine Ergebnisse zum Zusammenfassen."

    # Build a concise text block from the results
    lines: list[str] = []
    for i, r in enumerate(results[:20], 1):  # max 20
        parts = [f"{i}. **{r.get('title', 'Unbekannt')}**"]
        if r.get("date"):
            parts.append(f"Datum: {r['date']}")
        if r.get("typ"):
            parts.append(f"Typ: {r['typ']}")
        if r.get("bgbl"):
            parts.append(f"BGBl: {r['bgbl']}")
        if r.get("court"):
            parts.append(f"Gericht: {r['court']}")
        if r.get("case_number"):
            parts.append(f"GZ: {r['case_number']}")
        if r.get("normen"):
            parts.append(f"Normen: {r['normen']}")
        lines.append(" | ".join(parts))

    result_text = "\n".join(lines)
    type_label = "Gesetze und Verordnungen" if doc_type == "gesetze" else "Gerichtsentscheidungen"

    system_prompt = (
        "Du bist ein österreichischer Rechtsexperte. Fasse die folgenden "
        f"{type_label} prägnant auf Deutsch zusammen. "
        "Strukturiere die Zusammenfassung thematisch. "
        "Hebe besonders wichtige oder weitreichende Änderungen hervor. "
        "Verwende Markdown-Formatierung."
    )

    user_prompt = f"Fasse folgende {len(results)} {type_label} zusammen:\n\n{result_text}"

    return await _chat(api_key, system_prompt, user_prompt, max_tokens=1500)


async def generate_report_markdown(
    results: list[dict[str, Any]],
    doc_type: str,
    category_label: str,
    timeframe_label: str,
    total_hits: int,
    api_key: str,
) -> str:
    """Generate a scientific-style legal summary report in markdown."""
    if not results:
        return "Keine Ergebnisse für den Bericht."

    lines: list[str] = []
    for i, r in enumerate(results[:20], 1):
        parts = [f"{i}. **{r.get('title', 'Unbekannt')}**"]
        if r.get("date"):
            parts.append(f"Datum: {r['date']}")
        if r.get("typ"):
            parts.append(f"Typ: {r['typ']}")
        if r.get("bgbl"):
            parts.append(f"BGBl: {r['bgbl']}")
        if r.get("court"):
            parts.append(f"Gericht: {r['court']}")
        if r.get("case_number"):
            parts.append(f"GZ: {r['case_number']}")
        if r.get("normen"):
            parts.append(f"Normen: {r['normen']}")
        if r.get("url"):
            parts.append(f"URL: {r['url']}")
        lines.append(" | ".join(parts))

    result_text = "\n".join(lines)
    type_label = "Gesetze und Verordnungen" if doc_type == "gesetze" else "Gerichtsentscheidungen"

    system_prompt = (
        "Du bist ein österreichischer Rechtswissenschaftler und verfasst einen "
        "wissenschaftlichen Kurzbericht über aktuelle Rechtsänderungen. "
        "Der Bericht soll folgende Struktur haben:\n\n"
        "1. **Titel**: Wissenschaftlicher Titel\n"
        "2. **Zusammenfassung (Abstract)**: 3-5 Sätze Überblick\n"
        "3. **Methodik**: Kurzer Hinweis auf Datenquelle (RIS) und Zeitraum\n"
        "4. **Ergebnisse**: Thematisch gegliederte Analyse der Änderungen\n"
        "   - Wichtigste Änderungen hervorheben\n"
        "   - Betroffene Rechtsbereiche identifizieren\n"
        "   - Praktische Auswirkungen erläutern\n"
        "5. **Schlussfolgerungen**: Trends und Einschätzung\n"
        "6. **Quellenverzeichnis**: RIS-Fundstellen auflisten\n\n"
        "Verwende akademischen Stil auf Deutsch. Markdown-Formatierung."
    )

    user_prompt = (
        f"Erstelle einen wissenschaftlichen Bericht über die folgenden "
        f"{total_hits} {type_label}.\n\n"
        f"Rechtsgebiet: {category_label}\n"
        f"Zeitraum: {timeframe_label}\n"
        f"Gesamtanzahl Treffer: {total_hits}\n\n"
        f"Ergebnisse (erste {len(results)}):\n{result_text}"
    )

    return await _chat(api_key, system_prompt, user_prompt, max_tokens=3000)


async def _chat(api_key: str, system: str, user: str, max_tokens: int = 1500) -> str:
    """Execute an OpenAI chat completion request."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": GPT_MODEL,
        "temperature": 0.3,
        "max_tokens": max_tokens,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as e:
            logger.error(f"OpenAI HTTP {e.response.status_code}: {e.response.text[:500]}")
            if e.response.status_code == 401:
                raise ValueError("Ungültiger API-Key. Bitte prüfen Sie Ihren OpenAI API-Key.")
            raise ValueError(f"OpenAI Fehler: {e.response.status_code}")
        except httpx.RequestError as e:
            logger.error(f"OpenAI request error: {e}")
            raise ValueError("Verbindung zu OpenAI fehlgeschlagen.")
