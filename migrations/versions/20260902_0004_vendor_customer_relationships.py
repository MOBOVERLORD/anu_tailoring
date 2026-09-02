"""Add secure vendor-customer relationships and invitation provenance.

Revision ID: 20260902_0004
Revises: 20260826_0003
Create Date: 2026-09-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260902_0004"
down_revision: Union[str, None] = "20260826_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "vendor_customer_relationships",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("vendor_id", sa.Integer(), nullable=False),
        sa.Column("customer_user_id", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=30),
            server_default="pending_acceptance",
            nullable=False,
        ),
        sa.Column("vendor_notes", sa.Text(), nullable=True),
        sa.Column("invitation_token_id", sa.Integer(), nullable=True),
        sa.Column("invited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("declined_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "vendor_id <> customer_user_id",
            name="ck_vendor_customer_not_self",
        ),
        sa.CheckConstraint(
            "status IN ('invited', 'pending_acceptance', 'active', 'declined')",
            name="ck_vendor_customer_status",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["users.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["customer_user_id"], ["users.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["invitation_token_id"],
            ["password_reset_tokens.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["vendor_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "invitation_token_id",
            name="uq_vendor_customer_invitation_token",
        ),
        sa.UniqueConstraint(
            "vendor_id",
            "customer_user_id",
            name="uq_vendor_customer_relationship",
        ),
    )
    op.create_index(
        "ix_vendor_customer_relationships_customer_status",
        "vendor_customer_relationships",
        ["customer_user_id", "status"],
    )
    op.create_index(
        "ix_vendor_customer_relationships_vendor_status_updated",
        "vendor_customer_relationships",
        ["vendor_id", "status", "updated_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_vendor_customer_relationships_vendor_status_updated",
        table_name="vendor_customer_relationships",
    )
    op.drop_index(
        "ix_vendor_customer_relationships_customer_status",
        table_name="vendor_customer_relationships",
    )
    op.drop_table("vendor_customer_relationships")
