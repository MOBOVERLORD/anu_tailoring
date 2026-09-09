"""Customer colour preferences and custom design references."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260909_0007"
down_revision = "20260908_0006"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("order_items", sa.Column("colour_preference", sa.String(100), nullable=True))
    op.add_column("order_items", sa.Column("design_references", JSONB(), nullable=True))
    op.create_table("order_reference_photos",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("object_name", sa.String(500), nullable=False),
        sa.Column("content_type", sa.String(50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_order_reference_photos_user_id", "order_reference_photos", ["user_id"])


def downgrade():
    op.drop_table("order_reference_photos")
    op.drop_column("order_items", "design_references")
    op.drop_column("order_items", "colour_preference")
