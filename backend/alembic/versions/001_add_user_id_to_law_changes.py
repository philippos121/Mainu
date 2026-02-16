"""add user_id to law_changes for per-user scans

Revision ID: 001_user_scans
Revises:
Create Date: 2026-02-16
"""
from alembic import op
import sqlalchemy as sa

revision = "001_user_scans"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add user_id column
    op.add_column("law_changes", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_law_changes_user_id", "law_changes", "users", ["user_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("ix_law_changes_user_id", "law_changes", ["user_id"])

    # Drop old unique constraint on ris_doc_id alone
    op.drop_constraint("law_changes_ris_doc_id_key", "law_changes", type_="unique")

    # Add composite unique constraint (ris_doc_id + user_id)
    op.create_unique_constraint("uq_law_change_per_user", "law_changes", ["ris_doc_id", "user_id"])


def downgrade() -> None:
    op.drop_constraint("uq_law_change_per_user", "law_changes", type_="unique")
    op.drop_index("ix_law_changes_user_id", "law_changes")
    op.drop_constraint("fk_law_changes_user_id", "law_changes", type_="foreignkey")
    op.drop_column("law_changes", "user_id")
    op.create_unique_constraint("law_changes_ris_doc_id_key", "law_changes", ["ris_doc_id"])
