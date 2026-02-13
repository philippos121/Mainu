from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.json_list import JSONList


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(128))
    full_name: Mapped[str] = mapped_column(String(255), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # User interests — list of legal category slugs (stored as JSON in SQLite)
    interests: Mapped[list[str]] = mapped_column(JSONList, default=list)

    # Optional: custom keywords the user wants to track
    keywords: Mapped[list[str]] = mapped_column(JSONList, default=list)

    # Notification preferences
    email_notifications: Mapped[bool] = mapped_column(Boolean, default=True)
