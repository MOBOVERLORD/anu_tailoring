"""Use the case-safe partial phone uniqueness index consistently.

Revision ID: 20260826_0003
Revises: 20260826_0002
Create Date: 2026-08-26
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260826_0003"
down_revision: Union[str, None] = "20260826_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Fresh baseline databases inherited this redundant constraint from the
    # frozen snapshot. The partial unique index is the canonical rule and also
    # matches pre-Alembic production databases.
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key")


def downgrade() -> None:
    op.create_unique_constraint("users_phone_key", "users", ["phone"])
