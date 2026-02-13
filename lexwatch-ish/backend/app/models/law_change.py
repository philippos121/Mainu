from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.json_list import JSONList


class LawChange(Base):
    __tablename__ = "law_changes"

    id: Mapped[int] = mapped_column(primary_key=True)
    ris_doc_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    title: Mapped[str] = mapped_column(Text)
    short_title: Mapped[str] = mapped_column(String(500), default="")
    law_type: Mapped[str] = mapped_column(String(100))  # Bundesrecht, Landesrecht, etc.
    bgbl_number: Mapped[str] = mapped_column(String(100), default="")
    categories: Mapped[list[str]] = mapped_column(JSONList, default=list)
    index_numbers: Mapped[list[str]] = mapped_column(JSONList, default=list)
    change_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    publication_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    effective_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    document_url: Mapped[str] = mapped_column(Text, default="")
    content_snippet: Mapped[str] = mapped_column(Text, default="")

    # AI-generated summary
    ai_summary: Mapped[str] = mapped_column(Text, default="")
    ai_summary_generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
