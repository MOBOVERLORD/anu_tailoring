"""Align the adopted schema with declared SQLAlchemy metadata.

Revision ID: 20260826_0002
Revises: 20260826_0001
Create Date: 2026-08-26
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260826_0002"
down_revision: Union[str, None] = "20260826_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Older databases received a Google-era default from compatibility SQL;
    # new routing defaults to the configured OpenStreetMap provider.
    op.execute(
        "ALTER TABLE deliveries ALTER COLUMN maps_provider "
        "SET DEFAULT 'openstreetmap'"
    )

    # A fresh baseline may contain these single-column indexes from the frozen
    # model snapshot. Composite/partial indexes below cover the real queries.
    for index_name in (
        "ix_deliveries_delivery_agent_id",
        "ix_designs_is_custom_request_template",
        "ix_orders_vendor_id",
        "ix_users_phone",
    ):
        op.execute(f"DROP INDEX IF EXISTS {index_name}")

    # These status indexes were declared by current models but never added to
    # databases that predated the payment completion workflow.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_order_invoices_final_payment_status "
        "ON order_invoices (final_payment_status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_vendor_invoices_final_payment_status "
        "ON vendor_invoices (final_payment_status)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_vendor_invoices_final_payment_status")
    op.execute("DROP INDEX IF EXISTS ix_order_invoices_final_payment_status")
    op.execute(
        "ALTER TABLE deliveries ALTER COLUMN maps_provider SET DEFAULT 'google'"
    )
