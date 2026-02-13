"""Background scheduler for daily RIS scanning and notification generation."""

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
    # For Bundesrecht/Landesrecht, use a lookback of 3 days to catch anything missed
    law_lookback = date.today() - timedelta(days=3)

    async with async_session() as session:
        # 1) Scan Bundesrecht (federal laws)
        bund_count = await _scan_bundesrecht(session, law_lookback, today)

        # 2) Scan Landesrecht (state laws)
        land_count = await _scan_landesrecht(session, law_lookback, today)

        # 3) Scan Judikatur (court rulings) from all court sources
        ruling_count = await _scan_judikatur(session, yesterday, today)

        # 4) Generate notifications for users
        await _generate_user_notifications(session)

    logger.info(f"Daily RIS scan completed: {bund_count} Bundesrecht, {land_count} Landesrecht, {ruling_count} Judikatur imported.")


async def _scan_bundesrecht(
    session: AsyncSession,
    date_from: date,
    date_to: date,
    keywords: str = "",
) -> int:
    """Scan Bundesrecht and store new entries. Returns count of new records."""
    created = 0
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
                if await _store_change(session, change_data):
                    created += 1

            await session.commit()
        except Exception as e:
            logger.error(f"Error scanning Bundesrecht page {page}: {e}")

    logger.info(f"Bundesrecht scan: {created} new / {scanned} scanned ({scanned - created} duplicates)")
    return created


async def _scan_landesrecht(
    session: AsyncSession,
    date_from: date,
    date_to: date,
    keywords: str = "",
) -> int:
    """Scan Landesrecht and store new entries. Returns count of new records."""
    created = 0
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
                if await _store_change(session, change_data):
                    created += 1

            await session.commit()
        except Exception as e:
            logger.error(f"Error scanning Landesrecht page {page}: {e}")

    logger.info(f"Landesrecht scan: {created} new / {scanned} scanned ({scanned - created} duplicates)")
    return created


async def _scan_judikatur(
    session: AsyncSession,
    date_from: date,
    date_to: date,
    keywords: str = "",
    court_sources: list[str] | None = None,
) -> int:
    """Scan Judikatur from specified (or all) court sources. Returns count of new records."""
    sources = court_sources or list(COURT_SOURCES.keys())
    created = 0
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
                    if await _store_change(session, ruling_data):
                        source_created += 1

                await session.commit()
            except Exception as e:
                logger.error(f"Error scanning Judikatur {source_key} page {page}: {e}")

        if source_scanned > 0:
            logger.info(f"  {source_key}: {source_created} new / {source_scanned} scanned")
        created += source_created
        scanned += source_scanned

    logger.info(f"Judikatur scan total: {created} new / {scanned} scanned ({scanned - created} duplicates)")
    return created


async def _store_change(session: AsyncSession, change_data: dict) -> bool:
    """Store a single law change / court ruling. Returns True if new record created."""
    ris_doc_id = change_data.get("ris_doc_id", "")
    if not ris_doc_id:
        logger.warning("Skipping entry without ris_doc_id")
        return False

    try:
        # Check if already exists
        existing = await session.execute(
            select(LawChange).where(LawChange.ris_doc_id == ris_doc_id)
        )
        if existing.scalar_one_or_none():
            return False

        # Generate AI summary (non-blocking)
        try:
            ai_summary = await generate_law_summary(
                title=change_data.get("title", ""),
                content_snippet=change_data.get("content_snippet", ""),
                bgbl_number=change_data.get("bgbl_number", ""),
                categories=change_data.get("categories", []),
            )
        except Exception as e:
            logger.warning(f"AI summary failed for {ris_doc_id}: {e}")
            ai_summary = ""

        law_change = LawChange(
            ris_doc_id=ris_doc_id,
            title=change_data.get("title", ""),
            short_title=change_data.get("short_title", ""),
            law_type=change_data.get("law_type", ""),
            bgbl_number=change_data.get("bgbl_number", ""),
            categories=change_data.get("categories", []),
            index_numbers=change_data.get("index_numbers", []),
            change_date=change_data.get("change_date"),
            publication_date=change_data.get("publication_date"),
            document_url=change_data.get("document_url", ""),
            content_snippet=change_data.get("content_snippet", ""),
            court_name=change_data.get("court_name"),
            case_number=change_data.get("case_number"),
            ai_summary=ai_summary,
            ai_summary_generated_at=datetime.now(timezone.utc) if ai_summary else None,
        )
        session.add(law_change)
        logger.info(f"NEW: {ris_doc_id} - {change_data.get('short_title', '')[:50]} ({change_data.get('law_type', '')})")
        return True
    except Exception as e:
        logger.error(f"Error storing {ris_doc_id}: {e}")
        return False


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
