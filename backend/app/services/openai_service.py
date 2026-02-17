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
    index_numbers: list[str] | None = None,
) -> str:
    """Generate a concise German-language summary of a law change or court ruling using GPT."""
    if not settings.OPENAI_API_KEY:
        return "KI-Zusammenfassung nicht verfügbar (API-Key fehlt)."

    categories_text = ", ".join(categories) if categories else ""
    indices_text = ", ".join(index_numbers) if index_numbers else ""
    is_ruling = bool(court_name or case_number)

    if is_ruling:
        prompt = f"""Du erhältst Metadaten einer österreichischen Gerichtsentscheidung aus dem RIS.
Erstelle eine fachlich-präzise Zusammenfassung. Stütze dich ausschließlich auf die
unten stehenden Informationen — erfinde NICHTS dazu. Falls die Daten nur Normen und
Schlagworte enthalten, erkläre, welche Rechtsfragen sich daraus ergeben und welche
Normen angewandt wurden.

Gericht: {court_name}
Geschäftszahl: {case_number}
Titel/Betreff: {title}
Schlagworte/Kategorien: {categories_text}
Indexe: {indices_text}
Rechtssatz / Inhalt: {content_snippet}

Fasse zusammen (max. 4-5 Sätze):
1. Welche Rechtsfrage wurde entschieden? (basierend auf Normen und Schlagworten)
2. Welches Gericht hat entschieden und zu welcher Geschäftszahl?
3. Kernaussage / Leitsatz, soweit aus den Daten ableitbar

WICHTIG: Erfinde keinen Sachverhalt und keine Begründung, die nicht aus den Daten hervorgeht.
Beginne NICHT mit „Die Entscheidung betrifft" oder „Es handelt sich um".
Antworte auf Deutsch."""
        system_msg = (
            "Du bist ein erfahrener österreichischer Jurist. Du fasst Gerichtsentscheidungen "
            "zusammen, die du aus RIS-Metadaten erhältst. Du arbeitest STRENG auf Basis der "
            "gegebenen Daten — du erfindest nie Fakten oder Sachverhalte. Wenn wenig Information "
            "vorliegt, erklärst du die relevanten Normen und den rechtlichen Kontext. "
            "Vermeide Phrasen wie 'Die Änderung betrifft' oder 'Es handelt sich um'."
        )
    else:
        prompt = f"""Du erhältst Metadaten einer österreichischen Rechtsänderung aus dem RIS.
Erstelle eine fachlich-präzise Zusammenfassung. Stütze dich ausschließlich auf die
unten stehenden Informationen — erfinde NICHTS dazu.

Titel: {title}
BGBl-Nummer: {bgbl_number}
Rechtsgebiet: {categories_text}
Indexe: {indices_text}
Gesetzestext / Schlagworte: {content_snippet}

Fasse zusammen (max. 4-5 Sätze):
1. Was wird geändert? (materieller Regelungsinhalt, basierend auf Titel und Schlagworten)
2. Welches Rechtsgebiet und welche Normen sind betroffen?
3. Inkrafttreten oder BGBl-Nummer, sofern erkennbar

WICHTIG: Erfinde keine Details, die nicht aus den Daten hervorgehen.
Beginne NICHT mit „Die Änderung betrifft" oder „Es handelt sich um".
Antworte auf Deutsch."""
        system_msg = (
            "Du bist ein erfahrener österreichischer Jurist. Du fasst Gesetzesänderungen "
            "zusammen, die du aus RIS-Metadaten erhältst. Du arbeitest STRENG auf Basis der "
            "gegebenen Daten — du erfindest nie Details. Wenn wenig Information vorliegt, "
            "erklärst du die relevanten Normen und den rechtlichen Kontext. "
            "Vermeide Phrasen wie 'Die Änderung betrifft' oder 'Es handelt sich um'."
        )

    try:
        client = _get_client()
        response = await client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": prompt},
            ],
            max_tokens=600,
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
