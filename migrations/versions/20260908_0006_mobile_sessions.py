"""Durable mobile sessions and idempotent refresh recovery."""
from alembic import op
import sqlalchemy as sa

revision = "20260908_0006"
down_revision = "20260908_0005"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("auth_sessions", "expires_at", existing_type=sa.DateTime(timezone=True), nullable=True)
    op.add_column("auth_sessions", sa.Column("previous_refresh_hash", sa.String(64), nullable=True))
    op.add_column("auth_sessions", sa.Column("refresh_request_hash", sa.String(64), nullable=True))


def downgrade():
    # Older code cannot consume opaque mobile tokens; close these sessions.
    op.execute("UPDATE auth_sessions SET expires_at = CURRENT_TIMESTAMP, revoked_at = CURRENT_TIMESTAMP WHERE expires_at IS NULL")
    op.alter_column("auth_sessions", "expires_at", existing_type=sa.DateTime(timezone=True), nullable=False)
    op.drop_column("auth_sessions", "refresh_request_hash")
    op.drop_column("auth_sessions", "previous_refresh_hash")
