from datetime import datetime

from pydantic import BaseModel


class LawChangeResponse(BaseModel):
    id: int
    ris_doc_id: str
    title: str
    short_title: str
    law_type: str
    bgbl_number: str
    categories: list[str]
    index_numbers: list[str]
    change_date: datetime | None
    publication_date: datetime | None
    effective_date: datetime | None
    document_url: str
    content_snippet: str
    ai_summary: str
    ai_summary_generated_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class LawChangeListResponse(BaseModel):
    items: list[LawChangeResponse]
    total: int
    page: int
    page_size: int


class NotificationResponse(BaseModel):
    id: int
    user_id: int
    law_change_id: int
    title: str
    summary: str
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    total: int
    unread_count: int
