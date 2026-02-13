"""Law change routes — browse, search, get details, scan."""

import logging
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.law_change import LawChange
from app.models.notification import Notification
from app.models.user import User
from app.schemas.law_change import (
    LawChangeListResponse,
    LawChangeResponse,
    NotificationListResponse,
    NotificationResponse,
)
from app.services.openai_service import generate_law_summary
from app.services.ris_client import (
    COURT_SOURCES,
    fetch_court_rulings,
    fetch_law_changes,
    get_court_sources,
    get_legal_categories,
    parse_judikatur_response,
    parse_ris_response,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/law-changes", tags=["Rechtsänderungen"])


@router.get("/categories")
async def list_categories():
    """Return all available legal categories for interest selection."""
    return get_legal_categories()


@router.get("/courts")
async def list_courts():
    """Return all available court sources."""
    return get_court_sources()


@router.get("", response_model=LawChangeListResponse)
async def list_law_changes(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query("", description="Freitextsuche"),
    category: str = Query("", description="Kategorie-Filter"),
    source_type: str = Query("", description="Quellentyp: Bundesrecht, Judikatur, oder leer für alle"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List law changes with pagination and filters."""
    query = select(LawChange)

    if search:
        query = query.where(
            or_(
                LawChange.title.ilike(f"%{search}%"),
                LawChange.short_title.ilike(f"%{search}%"),
                LawChange.content_snippet.ilike(f"%{search}%"),
                LawChange.ai_summary.ilike(f"%{search}%"),
            )
        )
    if category:
        query = query.where(LawChange.categories.any(category))
    if source_type:
        query = query.where(LawChange.law_type == source_type)
    if date_from:
        query = query.where(
            LawChange.change_date >= datetime.combine(date_from, datetime.min.time()).replace(tzinfo=timezone.utc)
        )
    if date_to:
        query = query.where(
            LawChange.change_date <= datetime.combine(date_to, datetime.max.time()).replace(tzinfo=timezone.utc)
        )

    # Total count
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    # Paginated results
    query = query.order_by(desc(LawChange.change_date), desc(LawChange.id))
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    items = [LawChangeResponse.model_validate(c) for c in result.scalars().all()]

    return LawChangeListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/my-feed", response_model=LawChangeListResponse)
async def my_feed(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get law changes matching the current user's interests."""
    query = select(LawChange)

    # Filter by user interests if they have any
    if user.interests or user.keywords:
        conditions = []
        for interest in (user.interests or []):
            conditions.append(LawChange.categories.any(interest))
        for keyword in (user.keywords or []):
            conditions.append(LawChange.title.ilike(f"%{keyword}%"))
            conditions.append(LawChange.content_snippet.ilike(f"%{keyword}%"))
        if conditions:
            query = query.where(or_(*conditions))

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    query = query.order_by(desc(LawChange.change_date), desc(LawChange.id))
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    items = [LawChangeResponse.model_validate(c) for c in result.scalars().all()]

    return LawChangeListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/{change_id}", response_model=LawChangeResponse)
async def get_law_change(
    change_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single law change by ID."""
    result = await db.execute(select(LawChange).where(LawChange.id == change_id))
    change = result.scalar_one_or_none()
    if not change:
        raise HTTPException(status_code=404, detail="Rechtsänderung nicht gefunden.")
    return LawChangeResponse.model_validate(change)


@router.post("/scan")
async def trigger_scan(
    date_from: date = Query(default=None),
    date_to: date = Query(default=None),
    keywords: str = Query(""),
    source_type: str = Query("all", description="Was scannen: 'laws', 'rulings', oder 'all'"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger a scan of the RIS API (laws + court rulings)."""
    if date_from is None:
        date_from = date.today() - timedelta(days=7)
    if date_to is None:
        date_to = date.today()

    created_laws = 0
    created_rulings = 0

    # Scan Bundesrecht
    if source_type in ("all", "laws"):
        for page in range(1, 11):
            raw = await fetch_law_changes(date_from=date_from, date_to=date_to, keywords=keywords, page=page)
            changes = parse_ris_response(raw)
            if not changes:
                break
            for change_data in changes:
                count = await _store_and_count(db, change_data)
                created_laws += count
            await db.commit()

    # Scan Judikatur (all court sources)
    if source_type in ("all", "rulings"):
        for source_key in COURT_SOURCES:
            for page in range(1, 6):
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
                for ruling_data in rulings:
                    count = await _store_and_count(db, ruling_data)
                    created_rulings += count
                await db.commit()

    total_created = created_laws + created_rulings
    return {
        "message": f"{total_created} neue Einträge importiert ({created_laws} Gesetze, {created_rulings} Urteile).",
        "laws_created": created_laws,
        "rulings_created": created_rulings,
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
    }


async def _store_and_count(db: AsyncSession, change_data: dict) -> int:
    """Store a change if new; return 1 if created, 0 if duplicate."""
    existing = await db.execute(
        select(LawChange).where(LawChange.ris_doc_id == change_data["ris_doc_id"])
    )
    if existing.scalar_one_or_none():
        return 0

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
        court_name=change_data.get("court_name"),
        case_number=change_data.get("case_number"),
        ai_summary=ai_summary,
        ai_summary_generated_at=datetime.now(timezone.utc),
    )
    db.add(law_change)
    return 1


# ──────────────────────────────────────
# Notifications
# ──────────────────────────────────────

@router.get("/notifications/list", response_model=NotificationListResponse)
async def list_notifications(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all notifications for the current user."""
    query = (
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(desc(Notification.created_at))
        .limit(100)
    )
    result = await db.execute(query)
    items = [NotificationResponse.model_validate(n) for n in result.scalars().all()]

    unread_count_q = select(func.count()).where(
        Notification.user_id == user.id,
        Notification.is_read.is_(False),
    )
    unread_count = (await db.execute(unread_count_q)).scalar() or 0

    return NotificationListResponse(items=items, total=len(items), unread_count=unread_count)


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark a notification as read."""
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user.id,
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404, detail="Benachrichtigung nicht gefunden.")
    notif.is_read = True
    await db.commit()
    return {"message": "Als gelesen markiert."}


@router.post("/notifications/read-all")
async def mark_all_read(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Mark all notifications as read for the current user."""
    from sqlalchemy import update

    await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.is_read.is_(False))
        .values(is_read=True)
    )
    await db.commit()
    return {"message": "Alle Benachrichtigungen als gelesen markiert."}
