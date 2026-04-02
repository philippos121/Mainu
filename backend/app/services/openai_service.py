"""OpenAI GPT integration for summarising RIS search results.

API key from OPENAI_API_KEY env var or per-request fallback.
"""

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

GPT_MODEL = "gpt-5.4"

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
            parts.append(f"  Rechtssatz: {r['rechtssatz']}")
        if r.get("entscheidungstext"):
            # Include full decision text (up to 2000 chars) directly in results
            et = r['entscheidungstext'][:2000]
            parts.append(f"  Entscheidungstext:\n  {et}")
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
        "Du verfasst als erfahrener österreichischer Rechtsanwalt eine gehaltvolle "
        "Analyse aktueller Rechtsänderungen.\n\n"
        "KRITISCH — KEINE HALLUZINATIONEN:\n"
        "- Beschreibe NUR Änderungen die in den unten aufgelisteten Daten vorkommen\n"
        "- Erfinde KEINE BGBl-Nummern, Paragrafen, Daten oder Inhalte\n"
        "- Wenn du zu einer Bestimmung keine Details hast, schreib nur was du weißt\n"
        "- Lieber weniger schreiben als etwas Falsches erfinden\n"
        "- Verwende NUR die BGBl-Nummern und Daten aus den gelieferten Ergebnissen\n\n"
        "STIL:\n"
        "- Sachlich, juristisch fundiert\n"
        "- KEINE Anrede, KEINE Grußformel\n"
        "- Direkt mit der inhaltlichen Analyse beginnen\n\n"
        "STRUKTUR (jeder Abschnitt wird als eigene Seite angezeigt):\n"
        "## Überblick\n"
        "Kurzer, gehaltvoller Teaser: Was hat sich geändert und warum ist es relevant.\n\n"
        "## [Kurzer, gehaltvoller Teaser-Titel — KEINE BGBl-Nummern, KEINE Paragrafen im Titel]\n"
        "Titel soll neugierig machen und den Kern der Änderung beschreiben, z.B.:\n"
        "  'Neue Meldepflichten für Kapitalerträge' statt 'BGBl. I Nr. 123/2024 — EStG'\n"
        "  'Strengere Regeln für GmbH-Gründungen' statt '§ 6 GmbHG idF BGBl I 45/2025'\n"
        "Pro wesentliche Änderung ein eigener Abschnitt:\n"
        "- WAS hat sich geändert (nur wenn aus Daten/Diffs ersichtlich)\n"
        "- WELCHE Bestimmungen betroffen (aus den Ergebnissen)\n"
        "- WARUM (nur wenn Materialien geliefert wurden)\n"
        "- WER ist betroffen\n"
        "WICHTIG: Maximal 2-3 kurze, prägnante Sätze pro Abschnitt. "
        "Die Texte werden als Vorschau im 3D-Flug angezeigt und müssen "
        "kompakt und vollständig lesbar sein — NICHT abschneiden.\n\n"
        "## Ausblick\n"
        "Nur wenn sich aus den Daten Trends ablesen lassen.\n\n"
        "REGELN:\n"
        "- NIEMALS BGBl-Nummern erfinden — nur die nennen die in den Daten stehen\n"
        "- NIEMALS Gesetzesänderungen beschreiben die nicht in den Daten vorkommen\n"
        "- Wenn VERSIONSVERGLEICHE vorliegen: beschreibe was sich geändert hat\n"
        "- Wenn MATERIALIEN vorliegen: fasse die Erläuterungen zusammen\n"
        "- Wenn zu wenig Information: ehrlich sagen 'Details nicht verfügbar'\n"
        "- Keine URL-Links, keine Quellenverzeichnisse"
    )

    user_prompt = (
        f"Analysiere AUSSCHLIESSLICH die folgenden {total_hits} "
        f"Rechtsakte im Bereich '{category_label}' "
        f"({timeframe_label}). Beschreibe NUR was in diesen Daten steht — "
        f"erfinde NICHTS dazu:\n\n{result_text}"
        f"{extra_context}"
    )

    return await _chat(api_key, system_prompt, user_prompt, max_tokens=8000)


async def _chat(api_key: str, system: str, user: str, max_tokens: int = 1500) -> str:
    """Execute an OpenAI chat completion request."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": GPT_MODEL,
        "temperature": 0.3,
        "max_completion_tokens": max_tokens,
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
