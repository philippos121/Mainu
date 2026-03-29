"""OpenAI GPT integration for summarising RIS search results.

API key from OPENAI_API_KEY env var or per-request fallback.
"""

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

GPT_MODEL = "gpt-4.1"

# Source labels for GPT context
_SOURCE_LABELS = {
    "findok": "Findok/BMF",
    "eurlex": "EUR-Lex/EU",
}


def _build_result_text(results: list[dict[str, Any]], include_urls: bool = False) -> str:
    """Build a structured text block from search results for GPT context."""
    lines: list[str] = []
    for i, r in enumerate(results[:30], 1):
        source = r.get("source", "")
        source_label = _SOURCE_LABELS.get(source, "RIS")
        parts = [f"{i}. [{source_label}] {r.get('title', 'Unbekannt')}"]
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
        if r.get("rechtssatz"):
            parts.append(f"  Rechtssatz: {r['rechtssatz'][:200]}")
        if include_urls and r.get("url"):
            parts.append(f"  Quelle: {r['url']}")
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
        "Du analysierst aktuelle Rechtsänderungen sachlich und präzise.\n\n"
        "STIL:\n"
        "- Sachlich, juristisch fundiert, direkt\n"
        "- KEINE Anrede, KEINE Grußformel\n"
        "- Fokus auf das Thema jeder Änderung und die rechtliche Aussage\n"
        "- Nicht den Verfahrensgang beschreiben\n\n"
        "REGELN:\n"
        "- Beschreibe NUR die konkret aufgelisteten Bestimmungen\n"
        "- Fasse NICHT das gesamte Gesetz zusammen\n"
        "- Gliedere thematisch\n"
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
    extra_context: str = "",
) -> str:
    """Generate a legal analysis report in markdown."""
    if not results:
        return "Keine Ergebnisse für den Bericht."

    result_text = _build_result_text(results, include_urls=True)
    type_label = "Gesetze und Verordnungen" if doc_type == "gesetze" else "Gerichtsentscheidungen"

    system_prompt = (
        "Du verfasst als erfahrener österreichischer Rechtsanwalt eine prägnante "
        "Analyse aktueller Rechtsänderungen.\n\n"
        "STIL:\n"
        "- Sachlich, präzise, juristisch fundiert\n"
        "- KEINE Anrede, KEINE Grußformel, KEIN Rundschreiben\n"
        "- Direkt mit der inhaltlichen Analyse beginnen\n"
        "- PRÄGNANT: Jeder Abschnitt max 3-4 Sätze. Auf den Punkt.\n"
        "- KEINE langen Quellenlisten oder URL-Aufzählungen\n\n"
        "STRUKTUR (jeder Abschnitt wird als eigene Seite angezeigt):\n"
        "## Überblick\n"
        "3-5 Sätze: Was hat sich geändert, was ist relevant.\n\n"
        "## [Thema der wichtigsten Änderung]\n"
        "Was hat sich geändert. Praktische Auswirkung. Max 4 Sätze.\n\n"
        "## [Thema der nächsten Änderung]\n"
        "(gleich — pro wesentliche Änderung ein eigener ## Abschnitt)\n\n"
        "## Ausblick\n"
        "Trends, offene Punkte. Kurz.\n\n"
        "REGELN:\n"
        "- Max 6-8 Abschnitte insgesamt\n"
        "- Jeder ## Abschnitt hat einen sprechenden Titel\n"
        "- BGBl-Nummer und Inkrafttreten im Fließtext nennen, nicht als Liste\n"
        "- Keine URL-Links, keine Quellenverzeichnisse\n"
        "- Wenn Versionsvergleiche vorliegen: konkret was sich geändert hat\n"
        "- Wenn Materialien vorliegen: Intention des Gesetzgebers in einem Satz\n"
        "- Fokus auf rechtliche Aussage, nicht Verfahrensgang"
    )

    user_prompt = (
        f"Analysiere prägnant die folgenden {total_hits} "
        f"Rechtsakte im Bereich '{category_label}' "
        f"({timeframe_label}). Pro wesentliche Änderung ein eigener "
        f"## Abschnitt mit sprechendem Titel:\n\n{result_text}"
        f"{extra_context}"
    )

    return await _chat(api_key, system_prompt, user_prompt, max_tokens=4000)


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
