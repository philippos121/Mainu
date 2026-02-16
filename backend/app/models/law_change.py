from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class LawChange(Base):
    __tablename__ = "law_changes"
    __table_args__ = (
        UniqueConstraint("ris_doc_id", "user_id", name="uq_law_change_per_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    ris_doc_id: Mapped[str] = mapped_column(String(255), index=True)
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(Text)
    short_title: Mapped[str] = mapped_column(String(500), default="")
    law_type: Mapped[str] = mapped_column(String(100))  # Bundesrecht, Landesrecht, etc.
    bgbl_number: Mapped[str] = mapped_column(Text, default="")
    categories: Mapped[list[str]] = mapped_column(
        ARRAY(String), default=list, server_default="{}"
    )
    index_numbers: Mapped[list[str]] = mapped_column(
        ARRAY(String), default=list, server_default="{}"
    )
    change_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    publication_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    effective_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    document_url: Mapped[str] = mapped_column(Text, default="")
    content_snippet: Mapped[str] = mapped_column(Text, default="")

    # Court ruling specific fields
    court_name: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    case_number: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)

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
