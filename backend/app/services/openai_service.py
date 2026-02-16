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
) -> str:
    """Generate a concise German-language summary of a law change using GPT."""
    if not settings.OPENAI_API_KEY:
        return "KI-Zusammenfassung nicht verfügbar (API-Key fehlt)."

    categories_text = ", ".join(categories) if categories else "Keine Kategorien"

    prompt = f"""Du bist ein österreichischer Rechtsexperte. Fasse die folgende Rechtsänderung
klar und verständlich auf Deutsch zusammen. Die Zusammenfassung soll für juristische Laien
verständlich sein, aber trotzdem präzise.

Titel: {title}
BGBl-Nummer: {bgbl_number}
Kategorien/Schlagworte: {categories_text}
Inhaltsausschnitt: {content_snippet}

Bitte erstelle:
1. Eine kurze Zusammenfassung (2-3 Sätze) was sich geändert hat
2. Wen betrifft diese Änderung?
3. Ab wann gilt die Änderung?

Antworte auf Deutsch."""

    try:
        client = _get_client()
        response = await client.chat.completions.create(
            model="gpt-4.1-nano",
            messages=[
                {
                    "role": "system",
                    "content": "Du bist ein Experte für österreichisches Recht und erstellst "
                    "verständliche Zusammenfassungen von Rechtsänderungen.",
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=500,
            temperature=0.3,
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
