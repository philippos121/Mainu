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
    LEGAL_CATEGORIES,
    fetch_law_changes,
    parse_ris_response,
)

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()


async def scan_law_changes():
    """Scan RIS for new law changes and store them in the database."""
    logger.info("Starting daily RIS law change scan...")

    yesterday = date.today() - timedelta(days=1)
    today = date.today()

    async with async_session() as session:
        # Fetch recent changes from RIS
        for page in range(1, 11):  # Up to 10 pages (1000 results)
            raw = await fetch_law_changes(
                date_from=yesterday,
                date_to=today,
                page=page,
            )
            changes = parse_ris_response(raw)

            if not changes:
                break

            for change_data in changes:
                # Check if already exists
                existing = await session.execute(
                    select(LawChange).where(
                        LawChange.ris_doc_id == change_data["ris_doc_id"]
                    )
                )
                if existing.scalar_one_or_none():
                    continue

                # Generate AI summary
                ai_summary = await generate_law_summary(
                    title=change_data["title"],
                    content_snippet=change_data["content_snippet"],
                    bgbl_number=change_data["bgbl_number"],
                    categories=change_data["categories"],
                )

                law_change = LawChange(
                    ris_doc_id=change_data["ris_doc_id"],
                    title=change_data["title"],
                    short_title=change_data["short_title"],
                    law_type=change_data["law_type"],
                    bgbl_number=change_data["bgbl_number"],
                    categories=change_data["categories"],
                    index_numbers=change_data["index_numbers"],
                    change_date=change_data["change_date"],
                    publication_date=change_data["publication_date"],
                    document_url=change_data["document_url"],
                    content_snippet=change_data["content_snippet"],
                    ai_summary=ai_summary,
                    ai_summary_generated_at=datetime.now(timezone.utc),
                )
                session.add(law_change)

            await session.commit()

        # Generate notifications for users
        await _generate_user_notifications(session)

    logger.info("Daily RIS scan completed.")


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
    logger.info("Scheduler started — daily scan at 06:00 UTC.")
