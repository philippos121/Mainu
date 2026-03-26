"""OpenAI GPT integration for summarising RIS search results.

The API key is passed per-request from the frontend — no server-side key needed.
"""

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

GPT_MODEL = "gpt-4.1"


def _build_result_text(results: list[dict[str, Any]], include_urls: bool = False) -> str:
    """Build a structured text block from RIS results for GPT context."""
    lines: list[str] = []
    for i, r in enumerate(results[:20], 1):
        parts = [f"{i}. {r.get('title', 'Unbekannt')}"]
        if r.get("artikel"):
            parts.append(f"  §/Artikel: {r['artikel']}")
        if r.get("date"):
            parts.append(f"  Inkrafttreten: {r['date']}")
        if r.get("typ"):
            parts.append(f"  Typ: {r['typ']}")
        if r.get("bgbl"):
            parts.append(f"  BGBl: {r['bgbl']}")
        if r.get("court"):
            parts.append(f"  Gericht: {r['court']}")
        if r.get("case_number"):
            parts.append(f"  GZ: {r['case_number']}")
        if r.get("normen"):
            parts.append(f"  Normen: {r['normen']}")
        if include_urls and r.get("url"):
            parts.append(f"  URL: {r['url']}")
        lines.append("\n".join(parts))

    return "\n\n".join(lines)


async def summarise_results(
    results: list[dict[str, Any]],
    doc_type: str,
    api_key: str,
) -> str:
    """Call OpenAI Chat Completions to summarise RIS results."""
    if not results:
        return "Keine Ergebnisse zum Zusammenfassen."

    result_text = _build_result_text(results)
    type_label = "Gesetze und Verordnungen" if doc_type == "gesetze" else "Gerichtsentscheidungen"

    system_prompt = (
        "Du bist ein erfahrener österreichischer Rechtsanwalt. "
        "Du analysierst aktuelle Rechtsänderungen für Mandanten.\n\n"
        "STIL:\n"
        "- Schreibe in der Sprache eines österreichischen Anwalts (sachlich, präzise, juristisch)\n"
        "- Fokus auf die zugrundeliegende RECHTSFRAGE jeder Änderung\n"
        "- Was ist die praktische Relevanz für die Rechtsanwendung?\n"
        "- Welche Rechtsprobleme werden gelöst oder geschaffen?\n\n"
        "REGELN:\n"
        "- Beschreibe NUR die konkret aufgelisteten Bestimmungen\n"
        "- Fasse NICHT das gesamte Gesetz zusammen\n"
        "- Identifiziere die zentrale Rechtsfrage jeder Änderung\n"
        "- Gliedere thematisch nach Rechtsgebieten\n"
        "- Verwende Markdown-Formatierung"
    )

    user_prompt = (
        f"Analysiere als österreichischer Rechtsanwalt die folgenden {len(results)} "
        f"{type_label}. Fokus auf die zugrundeliegenden Rechtsfragen und "
        f"die praktische Relevanz:\n\n{result_text}"
    )

    return await _chat(api_key, system_prompt, user_prompt, max_tokens=2000)


async def generate_report_markdown(
    results: list[dict[str, Any]],
    doc_type: str,
    category_label: str,
    timeframe_label: str,
    total_hits: int,
    api_key: str,
) -> str:
    """Generate a legal analysis report in markdown."""
    if not results:
        return "Keine Ergebnisse für den Bericht."

    result_text = _build_result_text(results, include_urls=True)
    type_label = "Gesetze und Verordnungen" if doc_type == "gesetze" else "Gerichtsentscheidungen"

    system_prompt = (
        "Du bist ein erfahrener österreichischer Rechtsanwalt und verfasst eine "
        "rechtliche Analyse aktueller Gesetzesänderungen für Mandanten.\n\n"
        "STIL: Wie ein Kanzlei-Rundschreiben an Mandanten — sachlich, präzise, "
        "juristisch fundiert, aber verständlich. Wie es eine renommierte "
        "österreichische Wirtschaftskanzlei formulieren würde.\n\n"
        "STRUKTUR:\n"
        "1. **Überblick**: 3-5 Sätze Zusammenfassung der wichtigsten Änderungen\n"
        "2. **Wesentliche Änderungen**: Für jede wichtige Änderung:\n"
        "   - Zugrundeliegende Rechtsfrage\n"
        "   - Was hat sich geändert (Kerngehalt der Novelle)\n"
        "   - Praktische Auswirkungen (wer ist betroffen, was ist zu tun)\n"
        "   - Handlungsbedarf für die Praxis\n"
        "3. **Weitere Änderungen**: Kürzere Darstellung der übrigen Änderungen\n"
        "4. **Ausblick und Empfehlung**: Trends, offene Fragen, Handlungsempfehlung\n\n"
        "REGELN:\n"
        "- Nur die konkret gelisteten Bestimmungen analysieren\n"
        "- Nicht das gesamte Gesetz zusammenfassen\n"
        "- Die zugrundeliegende Rechtsfrage ist von zentraler Bedeutung\n"
        "- BGBl-Nummern und Inkrafttretensdaten angeben\n"
        "- Markdown-Formatierung"
    )

    user_prompt = (
        f"Erstelle eine rechtliche Analyse der folgenden {total_hits} "
        f"{type_label} im Rechtsgebiet '{category_label}' "
        f"(Zeitraum: {timeframe_label}).\n\n"
        f"Fokus auf die zugrundeliegenden Rechtsfragen und die praktische "
        f"Relevanz für die Rechtsanwendung:\n\n{result_text}"
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
