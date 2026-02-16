"""Background scheduler for daily RIS scanning and notification generation."""

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session
from app.models.law_change import LawChange
from app.models.notification import Notification
from app.models.user import User
from app.services.openai_service import generate_law_summary
from app.services.ris_client import (
    COURT_SOURCES,
    LEGAL_CATEGORIES,
    fetch_court_rulings,
    fetch_law_changes,
    parse_judikatur_response,
    parse_ris_response,
)

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()


async def scan_law_changes():
    """Scan RIS for new law changes AND court rulings, store them in the database.

    For Bundesrecht/Landesrecht: uses ImRisSeit=EinerWoche (looks back 1 week).
    For Judikatur: uses EntscheidungsdatumVon/Bis (exact date range).
    """
    logger.info("Starting daily RIS scan (Bundesrecht + Landesrecht + Judikatur)...")

    yesterday = date.today() - timedelta(days=1)
    today = date.today()
    # Use 90-day lookback (maps to ImRisSeit=DreiMonaten) to catch more changes.
    # Duplicates are filtered by ris_doc_id, so a broad lookback is safe.
    law_lookback = date.today() - timedelta(days=90)

    new_ids: list[int] = []

    async with async_session() as session:
        # 1) Scan Bundesrecht (federal laws)
        bund_ids = await _scan_bundesrecht(session, law_lookback, today)

        # 2) Scan Landesrecht (state laws)
        land_ids = await _scan_landesrecht(session, law_lookback, today)

        # 3) Scan Judikatur (court rulings) from all court sources
        ruling_ids = await _scan_judikatur(session, yesterday, today)

        new_ids = bund_ids + land_ids + ruling_ids

    # 4) Generate AI summaries in parallel batches
    if new_ids:
        await _generate_ai_summaries(new_ids)

    # 5) Generate notifications for users
    async with async_session() as session:
        await _generate_user_notifications(session)

    logger.info(
        f"Daily RIS scan completed: {len(bund_ids)} Bundesrecht, "
        f"{len(land_ids)} Landesrecht, {len(ruling_ids)} Judikatur imported."
    )


async def _scan_bundesrecht(
    session: AsyncSession,
    date_from: date,
    date_to: date,
    keywords: str = "",
) -> list[int]:
    """Scan Bundesrecht and store new entries. Returns IDs of new records."""
    new_ids: list[int] = []
    scanned = 0
    for page in range(1, 11):  # Up to 10 pages (1000 results)
        try:
            raw = await fetch_law_changes(
                date_from=date_from,
                date_to=date_to,
                keywords=keywords,
                page=page,
                law_source="bundesrecht",
            )
            changes = parse_ris_response(raw, law_source="bundesrecht")

            if not changes:
                break

            scanned += len(changes)
            for change_data in changes:
                entry_id = await _store_change(session, change_data)
                if entry_id is not None:
                    new_ids.append(entry_id)

            await session.commit()
        except Exception as e:
            logger.error(f"Error scanning Bundesrecht page {page}: {e}")

    logger.info(f"Bundesrecht scan: {len(new_ids)} new / {scanned} scanned ({scanned - len(new_ids)} duplicates)")
    return new_ids


async def _scan_landesrecht(
    session: AsyncSession,
    date_from: date,
    date_to: date,
    keywords: str = "",
) -> list[int]:
    """Scan Landesrecht and store new entries. Returns IDs of new records."""
    new_ids: list[int] = []
    scanned = 0
    for page in range(1, 6):  # Up to 5 pages (500 results)
        try:
            raw = await fetch_law_changes(
                date_from=date_from,
                date_to=date_to,
                keywords=keywords,
                page=page,
                law_source="landesrecht",
            )
            changes = parse_ris_response(raw, law_source="landesrecht")

            if not changes:
                break

            scanned += len(changes)
            for change_data in changes:
                entry_id = await _store_change(session, change_data)
                if entry_id is not None:
                    new_ids.append(entry_id)

            await session.commit()
        except Exception as e:
            logger.error(f"Error scanning Landesrecht page {page}: {e}")

    logger.info(f"Landesrecht scan: {len(new_ids)} new / {scanned} scanned ({scanned - len(new_ids)} duplicates)")
    return new_ids


async def _scan_judikatur(
    session: AsyncSession,
    date_from: date,
    date_to: date,
    keywords: str = "",
    court_sources: list[str] | None = None,
) -> list[int]:
    """Scan Judikatur from specified (or all) court sources. Returns IDs of new records."""
    sources = court_sources or list(COURT_SOURCES.keys())
    new_ids: list[int] = []
    scanned = 0

    for source_key in sources:
        source_scanned = 0
        source_created = 0
        for page in range(1, 6):  # Up to 5 pages (500 results) per court
            try:
                raw = await fetch_court_rulings(
                    court_source=source_key,
                    date_from=date_from,
                    date_to=date_to,
                    keywords=keywords,
                    page=page,
                )
                rulings = parse_judikatur_response(raw, court_source=source_key)

                if not rulings:
                    break

                source_scanned += len(rulings)
                for ruling_data in rulings:
                    entry_id = await _store_change(session, ruling_data)
                    if entry_id is not None:
                        new_ids.append(entry_id)
                        source_created += 1

                await session.commit()
            except Exception as e:
                logger.error(f"Error scanning Judikatur {source_key} page {page}: {e}")

        if source_scanned > 0:
            logger.info(f"  {source_key}: {source_created} new / {source_scanned} scanned")
        scanned += source_scanned

    logger.info(f"Judikatur scan total: {len(new_ids)} new / {scanned} scanned ({scanned - len(new_ids)} duplicates)")
    return new_ids


async def _store_change(session: AsyncSession, change_data: dict) -> int | None:
    """Store a single law change / court ruling WITHOUT AI summary.

    Returns the new entry's ID, or None if duplicate/skipped.
    """
    ris_doc_id = change_data.get("ris_doc_id", "")
    if not ris_doc_id:
        logger.warning("Skipping entry without ris_doc_id")
        return None

    try:
        # Check if already exists
        existing = await session.execute(
            select(LawChange).where(LawChange.ris_doc_id == ris_doc_id)
        )
        if existing.scalar_one_or_none():
            return None

        # Helper: ensure value is a string (API sometimes returns dicts/lists)
        def _s(val, default=""):
            if val is None:
                return default
            return str(val) if not isinstance(val, str) else val

        # Truncate fields that have VARCHAR length limits
        short_title = _s(change_data.get("short_title", ""))[:500]
        law_type = _s(change_data.get("law_type", ""))[:100]
        court_name = _s(change_data.get("court_name"), None)
        if court_name:
            court_name = court_name[:255]
        case_number = _s(change_data.get("case_number"), None)
        if case_number:
            case_number = case_number[:255]

        law_change = LawChange(
            ris_doc_id=_s(ris_doc_id)[:255],
            title=_s(change_data.get("title", "")),
            short_title=short_title,
            law_type=law_type,
            bgbl_number=_s(change_data.get("bgbl_number", "")),
            categories=change_data.get("categories", []),
            index_numbers=change_data.get("index_numbers", []),
            change_date=change_data.get("change_date"),
            publication_date=change_data.get("publication_date"),
            document_url=_s(change_data.get("document_url", "")),
            content_snippet=_s(change_data.get("content_snippet", "")),
            court_name=court_name,
            case_number=case_number,
            ai_summary="",
            ai_summary_generated_at=None,
        )
        session.add(law_change)
        try:
            await session.flush()
        except Exception as e:
            logger.error(f"Flush failed for {ris_doc_id}: {e}")
            await session.rollback()
            return None
        logger.info(f"NEW: {ris_doc_id} - {short_title[:50]} ({law_type})")
        return law_change.id
    except Exception as e:
        logger.error(f"Error storing {ris_doc_id}: {e}")
        return None


async def _generate_ai_summaries(entry_ids: list[int]):
    """Generate AI summaries in parallel batches for newly stored entries."""
    BATCH_SIZE = 10  # concurrent requests

    logger.info(f"Generating AI summaries for {len(entry_ids)} entries...")
    generated = 0

    async with async_session() as session:
        for i in range(0, len(entry_ids), BATCH_SIZE):
            batch_ids = entry_ids[i : i + BATCH_SIZE]

            result = await session.execute(
                select(LawChange).where(LawChange.id.in_(batch_ids))
            )
            entries = list(result.scalars().all())

            tasks = [
                generate_law_summary(
                    title=entry.title,
                    content_snippet=entry.content_snippet or "",
                    bgbl_number=entry.bgbl_number or "",
                    categories=entry.categories or [],
                )
                for entry in entries
            ]
            summaries = await asyncio.gather(*tasks, return_exceptions=True)

            for entry, summary in zip(entries, summaries):
                if isinstance(summary, Exception):
                    logger.warning(f"AI summary failed for {entry.ris_doc_id}: {summary}")
                    continue
                if summary:
                    entry.ai_summary = summary
                    entry.ai_summary_generated_at = datetime.now(timezone.utc)
                    generated += 1

            await session.commit()

    logger.info(f"AI summaries done: {generated}/{len(entry_ids)} generated")


async def _generate_user_notifications(session: AsyncSession):
    """Create notifications for users based on their interests."""
    users = await session.execute(select(User).where(User.is_active.is_(True)))

    yesterday = datetime.now(timezone.utc) - timedelta(days=1)

    for user in users.scalars().all():
        if not user.interests and not user.keywords:
            continue

        # Build query for matching law changes
        query = select(LawChange).where(LawChange.created_at >= yesterday)

        recent_changes = await session.execute(query)
        changes = recent_changes.scalars().all()

        for change in changes:
            # Check if change matches user interests
            if not _matches_user_interests(change, user):
                continue

            # Check if notification already exists
            existing_notif = await session.execute(
                select(Notification).where(
                    Notification.user_id == user.id,
                    Notification.law_change_id == change.id,
                )
            )
            if existing_notif.scalar_one_or_none():
                continue

            notification = Notification(
                user_id=user.id,
                law_change_id=change.id,
                title=change.short_title or change.title,
                summary=change.ai_summary[:500] if change.ai_summary else "",
            )
            session.add(notification)

    await session.commit()


def _matches_user_interests(change: LawChange, user: User) -> bool:
    """Check if a law change matches the user's interests or keywords."""
    # Match by interest categories
    if user.interests:
        for interest in user.interests:
            cat = LEGAL_CATEGORIES.get(interest, {})
            index_prefix = cat.get("index", "")
            # Check if any index number starts with the category index
            if index_prefix and any(
                idx.startswith(index_prefix) for idx in (change.index_numbers or [])
            ):
                return True
            # Check categories/keywords
            label = cat.get("label", "").lower()
            if label and any(
                label in c.lower() for c in (change.categories or [])
            ):
                return True

    # Match by user-defined keywords
    if user.keywords:
        text = f"{change.title} {change.content_snippet} {change.short_title}".lower()
        if any(kw.lower() in text for kw in user.keywords):
            return True

    return False


def start_scheduler():
    """Start the background scheduler."""
    scheduler.add_job(
        scan_law_changes,
        "cron",
        hour=6,
        minute=0,
        id="daily_ris_scan",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Scheduler started — daily scan at 06:00 UTC (laws + court rulings).")
