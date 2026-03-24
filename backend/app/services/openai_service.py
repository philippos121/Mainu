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
        if r.get("ris_updated"):
            parts.append(f"  RIS-Aktualisierung: {r['ris_updated']}")
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
        if r.get("index"):
            parts.append(f"  Index: {r['index']}")
        if include_urls and r.get("url"):
            parts.append(f"  URL: {r['url']}")
        lines.append("\n".join(parts))

    return "\n\n".join(lines)


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

    result_text = _build_result_text(results)
    type_label = "Gesetze und Verordnungen" if doc_type == "gesetze" else "Gerichtsentscheidungen"

    system_prompt = (
        "Du bist ein österreichischer Rechtsexperte. Du erhältst eine Liste von "
        f"einzelnen RIS-Suchergebnissen ({type_label}).\n\n"
        "WICHTIGE REGELN:\n"
        "- Fasse NUR die konkret aufgelisteten Bestimmungen/Paragraphen zusammen.\n"
        "- Fasse NICHT das gesamte Gesetz zusammen, zu dem ein Paragraph gehört.\n"
        "  Beispiel: Wenn '§ 123 UGB' in der Liste steht, beschreibe NUR § 123 UGB, "
        "  NICHT das gesamte Unternehmensgesetzbuch.\n"
        "- Beachte: Das Feld 'Inkrafttreten' zeigt, wann die Fassung in Kraft trat. "
        "  Das Feld 'RIS-Aktualisierung' zeigt, wann der Eintrag im RIS zuletzt "
        "  technisch aktualisiert wurde. Eine RIS-Aktualisierung bedeutet NICHT "
        "  zwingend eine inhaltliche Gesetzesänderung — es kann sich um eine "
        "  redaktionelle Metadaten-Aktualisierung handeln.\n"
        "- Wenn das Inkrafttretensdatum deutlich älter ist als der Suchzeitraum, "
        "  weise darauf hin, dass es sich möglicherweise nur um ein "
        "  RIS-Metadaten-Update handelt und keine inhaltliche Änderung.\n"
        "- Strukturiere die Zusammenfassung thematisch nach Rechtsgebieten.\n"
        "- Verwende Markdown-Formatierung."
    )

    user_prompt = (
        f"Fasse die folgenden {len(results)} einzelnen RIS-Suchergebnisse zusammen. "
        f"Beschreibe nur den Inhalt der jeweils genannten Bestimmung, "
        f"nicht das gesamte Gesetz:\n\n{result_text}"
    )

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

    result_text = _build_result_text(results, include_urls=True)
    type_label = "Gesetze und Verordnungen" if doc_type == "gesetze" else "Gerichtsentscheidungen"

    system_prompt = (
        "Du bist ein österreichischer Rechtswissenschaftler und verfasst einen "
        "wissenschaftlichen Kurzbericht.\n\n"
        "WICHTIGE REGELN:\n"
        "- Analysiere NUR die konkret aufgelisteten Bestimmungen/Paragraphen.\n"
        "- Fasse NICHT das gesamte Gesetz zusammen, zu dem ein Paragraph gehört.\n"
        "  Wenn '§ 123 UGB' gelistet ist, beschreibe NUR was § 123 UGB regelt, "
        "  NICHT das gesamte Unternehmensgesetzbuch.\n"
        "- Beachte: 'Inkrafttreten' = wann die Fassung in Kraft trat. "
        "  'RIS-Aktualisierung' = wann der RIS-Eintrag zuletzt technisch "
        "  aktualisiert wurde. Unterscheide klar zwischen inhaltlichen "
        "  Gesetzesänderungen und bloßen RIS-Metadaten-Updates.\n"
        "- Wenn Inkrafttretensdaten deutlich vor dem Suchzeitraum liegen, "
        "  weise im Bericht darauf hin.\n\n"
        "STRUKTUR des Berichts:\n"
        "1. **Titel**: Wissenschaftlicher Titel\n"
        "2. **Zusammenfassung (Abstract)**: 3-5 Sätze Überblick\n"
        "3. **Methodik**: Datenquelle (RIS OGD API), Zeitraum, Hinweis dass "
        "   'ImRisSeit' RIS-Datenbankaktualisierungen filtert, nicht zwingend "
        "   inhaltliche Gesetzesänderungen\n"
        "4. **Ergebnisse**: Thematisch gegliederte Analyse der einzelnen "
        "   Bestimmungen — NUR die gelisteten Paragraphen beschreiben\n"
        "   - Tatsächliche Änderungen vs. Metadaten-Updates unterscheiden\n"
        "   - Betroffene Rechtsbereiche identifizieren\n"
        "   - Praktische Auswirkungen erläutern\n"
        "5. **Schlussfolgerungen**: Trends und Einschätzung\n"
        "6. **Quellenverzeichnis**: RIS-Fundstellen auflisten\n\n"
        "Verwende akademischen Stil auf Deutsch. Markdown-Formatierung."
    )

    user_prompt = (
        f"Erstelle einen wissenschaftlichen Bericht über die folgenden "
        f"einzelnen RIS-Suchergebnisse.\n\n"
        f"Rechtsgebiet: {category_label}\n"
        f"Zeitraum: {timeframe_label}\n"
        f"Gesamtanzahl Treffer: {total_hits}\n\n"
        f"Ergebnisse (erste {len(results)}) — beschreibe NUR diese "
        f"einzelnen Bestimmungen:\n\n{result_text}"
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
