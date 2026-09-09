"""Vendor-recorded customer measurements."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "20260908_0005"
down_revision = "20260902_0004"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table("vendor_customer_measurements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("relationship_id", sa.Integer(), sa.ForeignKey("vendor_customer_relationships.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by_vendor_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("profile_name", sa.String(50), nullable=False),
        sa.Column("garment_type", sa.String(50), nullable=False),
        sa.Column("gender", sa.String(20), nullable=False),
        sa.Column("unit", sa.String(10), nullable=False),
        sa.Column("measurements", JSONB(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_vendor_customer_measurements_relationship_id", "vendor_customer_measurements", ["relationship_id"])

def downgrade():
    op.drop_table("vendor_customer_measurements")
