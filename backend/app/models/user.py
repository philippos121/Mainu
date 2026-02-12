from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


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

    # User interests — list of legal category slugs
    interests: Mapped[list[str]] = mapped_column(
        ARRAY(String), default=list, server_default="{}"
    )

    # Optional: custom keywords the user wants to track
    keywords: Mapped[list[str]] = mapped_column(
        ARRAY(String), default=list, server_default="{}"
    )

    # Notification preferences
    email_notifications: Mapped[bool] = mapped_column(Boolean, default=True)
