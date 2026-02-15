"""Law change routes — browse, search, get details, scan, debug."""

import logging
import traceback
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
    debug_ris_api_raw,
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


@router.get("/debug-ris")
async def debug_ris_api(
    endpoint: str = Query("bundesrecht", description="bundesrecht, landesrecht, or a court source key"),
    mode: str = Query("raw", description="'raw' = test all param combinations, 'parse' = fetch+parse like scan does"),
    page: int = Query(1, ge=1),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    keywords: str = Query(""),
    user: User = Depends(get_current_user),
):
    """Debug endpoint: Test RIS API parameter combinations to find which ones work.

    mode=raw: Tests 6 different parameter combinations and shows raw HTTP responses.
              This is the PRIMARY diagnostic tool — check the 'summary' field first.
    mode=parse: Fetches with auto-fallback (like scan does) and shows parsed results.
    """
    if mode == "raw":
        return await debug_ris_api_raw(endpoint)

    # mode=parse: Normal fetch+parse flow (uses auto-fallback)
    if endpoint in ("bundesrecht", "landesrecht"):
        raw = await fetch_law_changes(
            date_from=date_from,
            date_to=date_to,
            keywords=keywords,
            page=page,
            law_source=endpoint,
        )
        parsed = parse_ris_response(raw, law_source=endpoint)
    else:
        raw = await fetch_court_rulings(
            court_source=endpoint,
            date_from=date_from,
            date_to=date_to,
            keywords=keywords,
            page=page,
        )
        parsed = parse_judikatur_response(raw, court_source=endpoint)

    search_result = raw.get("OgdSearchResult", {})
    hits = search_result.get("Hits", {})
    doc_results = search_result.get("OgdDocumentResults", {})
    references = doc_results.get("OgdDocumentReference", [])
    if isinstance(references, dict):
        references = [references]
    if references is None:
        references = []

    first_raw_doc = references[0] if references else None

    return {
        "endpoint": endpoint,
        "total_hits": hits,
        "raw_documents_on_page": len(references),
        "parsed_documents": len(parsed),
        "first_raw_document_structure": _summarize_structure(first_raw_doc) if first_raw_doc else None,
        "first_raw_document": first_raw_doc,
        "first_parsed": parsed[0] if parsed else None,
        "last_parsed": parsed[-1] if len(parsed) > 1 else None,
    }


def _summarize_structure(obj, depth=0, max_depth=4):
    """Recursively summarize the structure of a nested dict/list for debugging."""
    if depth > max_depth:
        return f"<{type(obj).__name__}>"
    if isinstance(obj, dict):
        return {k: _summarize_structure(v, depth + 1, max_depth) for k, v in obj.items()}
    if isinstance(obj, list):
        if not obj:
            return "[]"
        return [_summarize_structure(obj[0], depth + 1, max_depth), f"... ({len(obj)} items)"]
    if isinstance(obj, str):
        return obj[:100] + ("..." if len(obj) > 100 else "")
    return obj


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
    """Manually trigger a scan of the RIS API (Bundesrecht + Landesrecht + Judikatur)."""
    if date_from is None:
        date_from = date.today() - timedelta(days=90)
    if date_to is None:
        date_to = date.today()

    created_bund = 0
    created_land = 0
    created_rulings = 0
    errors = []
    scanned_total = 0
    duplicates_total = 0

    # Scan Bundesrecht (Federal Law)
    if source_type in ("all", "laws"):
        logger.info(f"Scanning Bundesrecht from {date_from} to {date_to}")
        for page_num in range(1, 11):
            raw = await fetch_law_changes(
                date_from=date_from,
                date_to=date_to,
                keywords=keywords,
                page=page_num,
                law_source="bundesrecht",
            )
            changes = parse_ris_response(raw, law_source="bundesrecht")
            if not changes:
                logger.info(f"Bundesrecht page {page_num}: no results, stopping.")
                break
            scanned_total += len(changes)
            for change_data in changes:
                try:
                    # Don't pass date range — ImRisSeit already filters on the API side.
                    # The post-filter would incorrectly drop results because Aenderungsdatum
                    # (law change date) differs from "last modified in RIS".
                    count = await _store_and_count(db, change_data)
                    if count == 1:
                        created_bund += 1
                    elif count == 0:
                        duplicates_total += 1
                except Exception as e:
                    err_msg = f"Bundesrecht store error for {change_data.get('ris_doc_id', '?')}: {e}"
                    logger.error(err_msg)
                    errors.append(err_msg)
            await db.commit()
        logger.info(f"Bundesrecht: {created_bund} new entries stored")

    # Scan Landesrecht (State Law)
    if source_type in ("all", "laws"):
        logger.info(f"Scanning Landesrecht from {date_from} to {date_to}")
        for page_num in range(1, 6):
            raw = await fetch_law_changes(
                date_from=date_from,
                date_to=date_to,
                keywords=keywords,
                page=page_num,
                law_source="landesrecht",
            )
            changes = parse_ris_response(raw, law_source="landesrecht")
            if not changes:
                logger.info(f"Landesrecht page {page_num}: no results, stopping.")
                break
            scanned_total += len(changes)
            for change_data in changes:
                try:
                    count = await _store_and_count(db, change_data)
                    if count == 1:
                        created_land += 1
                    elif count == 0:
                        duplicates_total += 1
                except Exception as e:
                    err_msg = f"Landesrecht store error for {change_data.get('ris_doc_id', '?')}: {e}"
                    logger.error(err_msg)
                    errors.append(err_msg)
            await db.commit()
        logger.info(f"Landesrecht: {created_land} new entries stored")

    # Scan Judikatur (Court Rulings - all court sources)
    if source_type in ("all", "rulings"):
        logger.info(f"Scanning Judikatur from {date_from} to {date_to}")
        for source_key in COURT_SOURCES:
            for page_num in range(1, 6):
                raw = await fetch_court_rulings(
                    court_source=source_key,
                    date_from=date_from,
                    date_to=date_to,
                    keywords=keywords,
                    page=page_num,
                )
                rulings = parse_judikatur_response(raw, court_source=source_key)
                if not rulings:
                    break
                scanned_total += len(rulings)
                for ruling_data in rulings:
                    try:
                        count = await _store_and_count(db, ruling_data)
                        if count == 1:
                            created_rulings += 1
                        elif count == 0:
                            duplicates_total += 1
                    except Exception as e:
                        err_msg = f"Judikatur store error for {ruling_data.get('ris_doc_id', '?')}: {e}"
                        logger.error(err_msg)
                        errors.append(err_msg)
                await db.commit()
        logger.info(f"Judikatur: {created_rulings} new entries stored")

    total_created = created_bund + created_land + created_rulings
    total_laws = created_bund + created_land
    message = (
        f"{total_created} neue Einträge gespeichert "
        f"(von {scanned_total} gescannt, {duplicates_total} Duplikate): "
        f"{total_laws} Gesetze (Bund: {created_bund}, Land: {created_land}), "
        f"{created_rulings} Urteile"
    )
    if errors:
        message += f". {len(errors)} Fehler aufgetreten."

    return {
        "message": message,
        "bundesrecht_created": created_bund,
        "landesrecht_created": created_land,
        "rulings_created": created_rulings,
        "total_created": total_created,
        "total_scanned": scanned_total,
        "total_duplicates": duplicates_total,
        "errors": errors[:20],  # Limit error output
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
    }


async def _store_and_count(
    db: AsyncSession,
    change_data: dict,
    date_from: date | None = None,
    date_to: date | None = None,
) -> int:
    """Store a change if new; return 1 if created, 0 if duplicate, -1 if filtered out."""
    ris_doc_id = change_data.get("ris_doc_id", "")
    if not ris_doc_id:
        logger.warning("Skipping entry without ris_doc_id")
        return -1

    # Post-filter by date range if provided (API may not support exact date filtering)
    if date_from or date_to:
        change_date = change_data.get("change_date")
        if change_date:
            cd = change_date.date() if isinstance(change_date, datetime) else change_date
            if date_from and cd < date_from:
                return -1
            if date_to and cd > date_to:
                return -1

    # Check for duplicate
    existing = await db.execute(
        select(LawChange).where(LawChange.ris_doc_id == ris_doc_id)
    )
    if existing.scalar_one_or_none():
        return 0

    # Generate AI summary (non-blocking: store even if this fails)
    try:
        ai_summary = await generate_law_summary(
            title=change_data["title"],
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
    db.add(law_change)
    logger.info(f"NEW: {ris_doc_id} — {change_data.get('short_title', '')[:60]} ({change_data.get('law_type', '')})")
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
