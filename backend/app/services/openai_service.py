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


def _parse_ruling_content(content_snippet: str) -> tuple[str, str]:
    """Split content_snippet into (normen, rechtssatz).

    Content is stored as: "Normen: §X, §Y. [Rechtssatz text]"
    or just "[Rechtssatz text]" or just keywords.
    Returns (normen_str, rechtssatz_str).
    """
    if not content_snippet:
        return "", ""
    snippet = content_snippet.strip()
    if snippet.startswith("Normen: "):
        rest = snippet[8:]
        dot_idx = rest.find(". ")
        if dot_idx != -1:
            return rest[:dot_idx], rest[dot_idx + 2:]
        else:
            return rest, ""  # only norms, no rechtssatz after it
    return "", snippet  # no norms prefix → treat entire text as rechtssatz


def has_meaningful_content(
    content_snippet: str,
    categories: list[str] | None,
    is_ruling: bool,
) -> bool:
    """Return True if there is enough content to produce a useful AI summary."""
    normen, rechtssatz = _parse_ruling_content(content_snippet) if is_ruling else ("", content_snippet or "")
    keywords = ", ".join(categories or [])

    # For rulings: need either a Rechtssatz of reasonable length, or at least norms + keywords
    if is_ruling:
        if rechtssatz and len(rechtssatz.strip()) >= 40:
            return True
        if normen and keywords:
            return True
        return False

    # For laws: need title + any snippet or keywords (title is always set, so check snippet)
    return bool((content_snippet and len(content_snippet.strip()) >= 20) or keywords)


async def generate_law_summary(
    title: str,
    content_snippet: str,
    bgbl_number: str = "",
    categories: list[str] | None = None,
    court_name: str = "",
    case_number: str = "",
    index_numbers: list[str] | None = None,
) -> str:
    """Generate a detailed German-language summary of a law change or court ruling using GPT."""
    if not settings.OPENAI_API_KEY:
        return "KI-Zusammenfassung nicht verfügbar (API-Key fehlt)."

    is_ruling = bool(court_name or case_number)
    categories_text = ", ".join(categories) if categories else "–"

    if is_ruling:
        normen, rechtssatz = _parse_ruling_content(content_snippet)
        schlagworte = categories_text

        if rechtssatz and len(rechtssatz.strip()) >= 40:
            # We have an actual Rechtssatz — use it as the primary source.
            # The Rechtssatz IS the court's legal headnote / decision principle.
            prompt = f"""Du bist juristischer Analytiker für österreichisches Recht.
Analysiere den folgenden Rechtssatz (Leitsatz/Entscheidungsprinzip) und erstelle eine
ausführliche fachliche Analyse der Entscheidung.

GERICHT: {court_name}
GESCHÄFTSZAHL: {case_number}
ANGEWANDTE NORMEN: {normen or '–'}
SCHLAGWORTE: {schlagworte}

RECHTSSATZ (die eigentliche Aussage des Gerichts):
{rechtssatz}

Analysiere und erkläre (5-7 Sätze):
1. Was hat das Gericht konkret entschieden? (Kernaussage des Rechtssatzes in eigenen Worten)
2. Welche Rechtsfrage war strittig und wie wurde sie vom Gericht gelöst?
3. Was ist juristisch NEU, bedeutsam oder klärend an dieser Entscheidung — was ändert/präzisiert sich?
4. Welche Normen wurden wie ausgelegt oder angewandt?
5. Welche praktischen Konsequenzen hat diese Entscheidung für Rechtsanwender?

Schreibe präzise und fachlich auf dem Niveau eines Kommentars in einer juristischen Fachzeitschrift.
Beginne direkt mit dem Inhalt — keine generische Einleitung.
Antworte ausschließlich auf Deutsch."""
            system_msg = (
                "Du bist ein erfahrener österreichischer Jurist und Rechtsprechungsanalytiker. "
                "Du erklärst Gerichtsurteile tiefgehend: was konkret entschieden wurde, "
                "was juristisch neu oder klärend ist, welche Normen wie ausgelegt wurden, "
                "und welche praktischen Folgen die Entscheidung hat. "
                "Du stützt dich ausschließlich auf den gegebenen Rechtssatz. "
                "Du erfindest keine Fakten. Du schreibst auf Fachzeitschriftenniveau."
            )
        else:
            # No Rechtssatz — only norms and/or keywords available.
            # Be honest about limited data; don't hallucinate a decision.
            prompt = f"""Du erhältst minimale Metadaten einer österreichischen Gerichtsentscheidung.
Kein Rechtssatz (Leitsatz) ist im RIS-OGD-Datensatz vorhanden.

GERICHT: {court_name}
GESCHÄFTSZAHL: {case_number}
ANGEWANDTE NORMEN: {normen or '–'}
SCHLAGWORTE: {schlagworte}

Beschreibe in 2-3 Sätzen:
1. Welche Rechtsgebiete und Normen sind betroffen und was regeln diese Normen?
2. Welcher typische Sachverhalt wird durch diese Normen erfasst?

Schreibe am Ende: „Der vollständige Entscheidungstext ist über den RIS-Link abrufbar."
Erfinde kein konkretes Entscheidungsergebnis. Antworte auf Deutsch."""
            system_msg = (
                "Du bist ein österreichischer Jurist. Du beschreibst Gerichtsentscheidungen "
                "sachlich auf Basis verfügbarer Metadaten ohne zu halluzinieren. "
                "Wenn kein Rechtssatz vorliegt, erklärst du die Normen und weist auf den RIS-Link hin."
            )
    else:
        # Law change (Bundesrecht / Landesrecht)
        prompt = f"""Du bist juristischer Analytiker für österreichisches Recht.
Analysiere folgende Rechtsänderung und erkläre sie fachlich ausführlich.

TITEL: {title}
BGBL-NUMMER: {bgbl_number or '–'}
RECHTSGEBIET / SCHLAGWORTE: {categories_text}
INHALT / TYP: {content_snippet or '–'}

Erkläre (5-7 Sätze):
1. Was wird geändert? Welcher materielle Regelungsinhalt ist betroffen?
2. Was ist NEU gegenüber der bisherigen Rechtslage — was ändert sich konkret?
3. Wer ist von der Änderung betroffen (Normadressaten, betroffene Rechtsgebiete)?
4. Welche Rechtsfolgen ergeben sich aus der Änderung?
5. Inkrafttreten oder BGBl-Nummer, sofern erkennbar.

Schreibe präzise auf dem Niveau eines juristischen Kanzlei-Newsletters.
Beginne direkt mit dem Inhalt — keine generische Einleitung wie „Diese Änderung betrifft...".
Antworte ausschließlich auf Deutsch."""
        system_msg = (
            "Du bist ein erfahrener österreichischer Jurist. Du erklärst Gesetzesänderungen "
            "detailliert: was sich materiell ändert, wer betroffen ist, welche Rechtsfolgen entstehen. "
            "Du stützt dich auf die gegebenen Daten. Du erfindest keine Details. "
            "Du schreibst auf dem Niveau eines juristischen Kanzlei-Newsletters."
        )

    try:
        client = _get_client()
        response = await client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": prompt},
            ],
            max_tokens=800,
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
