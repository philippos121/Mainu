"""OpenAI GPT integration for generating law change summaries."""

import logging
from datetime import datetime, timezone

from openai import AsyncOpenAI

from app.core.config import settings

logger = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    return _client


async def generate_law_summary(
    title: str,
    content_snippet: str,
    bgbl_number: str = "",
    categories: list[str] | None = None,
    court_name: str = "",
    case_number: str = "",
) -> str:
    """Generate a concise German-language summary of a law change or court ruling using GPT."""
    if not settings.OPENAI_API_KEY:
        return "KI-Zusammenfassung nicht verfügbar (API-Key fehlt)."

    categories_text = ", ".join(categories) if categories else ""
    is_ruling = bool(court_name or case_number)

    if is_ruling:
        prompt = f"""Analysiere die folgende gerichtliche Entscheidung und fasse sie
fachlich-präzise zusammen. Schreibe wie ein wissenschaftlicher Mitarbeiter an einem
österreichischen Gericht — sachlich, juristisch korrekt, ohne Floskeln.

Gericht: {court_name}
Geschäftszahl: {case_number}
Titel/Betreff: {title}
Schlagworte: {categories_text}
Entscheidungstext (Auszug): {content_snippet}

Fasse zusammen:
- Sachverhalt und Kernfrage in 1-2 Sätzen
- Entscheidung und tragende Begründung des Gerichts
- Rechtliche Bedeutung / Leitsatz

Beginne NICHT mit „Die Entscheidung betrifft" o.ä. — formuliere abwechslungsreich und
inhaltlich prägnant. Antworte auf Deutsch, max. 4-5 Sätze."""
        system_msg = (
            "Du bist ein erfahrener österreichischer Jurist und wissenschaftlicher Mitarbeiter. "
            "Du erstellst prägnante, fachlich fundierte Zusammenfassungen von Gerichtsentscheidungen. "
            "Vermeide Phrasen wie 'Die Änderung betrifft' oder 'Es handelt sich um'. "
            "Schreibe abwechslungsreich und substanziell."
        )
    else:
        prompt = f"""Analysiere die folgende Rechtsänderung und fasse sie fachlich-präzise zusammen.
Schreibe wie ein wissenschaftlicher Mitarbeiter in einer Kanzlei — sachlich, juristisch
korrekt, substanziell.

Titel: {title}
BGBl-Nummer: {bgbl_number}
Rechtsgebiet: {categories_text}
Gesetzestext (Auszug): {content_snippet}

Fasse zusammen:
- Was wird geändert und warum? (materieller Regelungsinhalt)
- Wer ist betroffen und welche Rechtsfolgen ergeben sich?
- Inkrafttreten, sofern erkennbar

Beginne NICHT mit „Die Änderung betrifft" o.ä. — formuliere abwechslungsreich und
inhaltlich prägnant. Antworte auf Deutsch, max. 4-5 Sätze."""
        system_msg = (
            "Du bist ein erfahrener österreichischer Jurist und wissenschaftlicher Mitarbeiter. "
            "Du erstellst prägnante, fachlich fundierte Zusammenfassungen von Gesetzesänderungen. "
            "Vermeide Phrasen wie 'Die Änderung betrifft' oder 'Es handelt sich um'. "
            "Schreibe abwechslungsreich und substanziell."
        )

    try:
        client = _get_client()
        response = await client.chat.completions.create(
            model="gpt-4.1-nano",
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": prompt},
            ],
            max_tokens=600,
            temperature=0.5,
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        logger.error(f"OpenAI API error: {e}")
        return f"Zusammenfassung konnte nicht erstellt werden: {e}"


async def generate_daily_digest(changes: list[dict]) -> str:
    """Generate a digest summary of multiple law changes for a user."""
    if not settings.OPENAI_API_KEY or not changes:
        return ""

    changes_text = "\n\n".join(
        f"- {c.get('title', 'Unbekannt')} (BGBl: {c.get('bgbl_number', 'N/A')}): "
        f"{c.get('content_snippet', '')[:200]}"
        for c in changes[:20]  # Limit to 20 changes for context
    )

    prompt = f"""Erstelle eine übersichtliche Tages-Zusammenfassung der folgenden Rechtsänderungen
in Österreich. Gruppiere sie nach Themengebieten und hebe die wichtigsten Änderungen hervor.

Rechtsänderungen:
{changes_text}

Formatiere die Zusammenfassung übersichtlich mit Aufzählungspunkten. Antworte auf Deutsch."""

    try:
        client = _get_client()
        response = await client.chat.completions.create(
            model="gpt-4.1-nano",
            messages=[
                {
                    "role": "system",
                    "content": "Du erstellst übersichtliche Tages-Zusammenfassungen von "
                    "österreichischen Rechtsänderungen.",
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=1000,
            temperature=0.3,
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        logger.error(f"OpenAI digest error: {e}")
        return ""
