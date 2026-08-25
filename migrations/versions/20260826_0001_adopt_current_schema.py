"""Adopt the current Vastrivo schema as the Alembic baseline.

Revision ID: 20260826_0001
Revises: None
Create Date: 2026-08-26

This revision is intentionally idempotent. It creates a fresh schema from the
frozen application baseline and also adopts databases created by the legacy
startup initializer without dropping application data.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

from migrations.schema_20260826 import Base


revision: str = "20260826_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    Base.metadata.create_all(bind=conn, checkfirst=True)
    if conn.dialect.name == "postgresql":
        # SQLAlchemy's native enum is not expanded by create_all for an
        # existing database. Add the vendor handoff stage idempotently.
        conn.execute(text(
            "ALTER TYPE orderstatus ADD VALUE IF NOT EXISTS 'READY_FOR_SHIPPING'"
        ))
    # Adopt databases created by the former startup initializer. These
    # statements are frozen here; later changes belong in new revisions.
    conn.execute(text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS location VARCHAR(150)"
    ))
    conn.execute(text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20)"
    ))
    conn.execute(text(
        "UPDATE users SET role = 'customer' WHERE role IS NULL"
    ))
    conn.execute(text(
        "ALTER TABLE users ALTER COLUMN role SET DEFAULT 'customer'"
    ))
    conn.execute(text(
        "ALTER TABLE users ALTER COLUMN role SET NOT NULL"
    ))
    conn.execute(text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN"
    ))
    conn.execute(text(
        "UPDATE users SET is_active = TRUE WHERE is_active IS NULL"
    ))
    conn.execute(text(
        "ALTER TABLE users ALTER COLUMN is_active SET DEFAULT TRUE"
    ))
    conn.execute(text(
        "ALTER TABLE users ALTER COLUMN is_active SET NOT NULL"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_users_is_active ON users (is_active)"
    ))
    conn.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower "
        "ON users (LOWER(email))"
    ))
    conn.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone_not_null "
        "ON users (phone) WHERE phone IS NOT NULL"
    ))
    conn.execute(text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_pickup_address VARCHAR(500)"
    ))
    conn.execute(text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_pickup_place_id VARCHAR(255)"
    ))
    conn.execute(text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_pickup_latitude DOUBLE PRECISION"
    ))
    conn.execute(text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_pickup_longitude DOUBLE PRECISION"
    ))
    conn.execute(text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_pickup_geocoded_at TIMESTAMPTZ"
    ))
    for statement in (
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_bucket_name VARCHAR(255)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_object_name VARCHAR(1024)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_content_type VARCHAR(100)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_original_filename VARCHAR(255)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_size_bytes INTEGER",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_name VARCHAR(150)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_description TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_logo_bucket_name VARCHAR(255)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_logo_object_name VARCHAR(1024)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_logo_content_type VARCHAR(100)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_logo_original_filename VARCHAR(255)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_logo_size_bytes INTEGER",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_request_status VARCHAR(20)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_request_shop_name VARCHAR(150)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_request_message TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_request_review_comment TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_requested_at TIMESTAMPTZ",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_request_reviewed_at TIMESTAMPTZ",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_request_reviewed_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_delivery_pricing VARCHAR(20) NOT NULL DEFAULT 'platform'",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS vendor_delivery_fee DOUBLE PRECISION NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS delivery_agent_latitude DOUBLE PRECISION",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS delivery_agent_longitude DOUBLE PRECISION",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS delivery_agent_location_accuracy_meters DOUBLE PRECISION",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS delivery_agent_location_updated_at TIMESTAMPTZ",
    ):
        conn.execute(text(statement))
    for statement in (
        "ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS client_type VARCHAR(20) NOT NULL DEFAULT 'web'",
        "ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS device_name VARCHAR(100)",
        "ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS device_platform VARCHAR(20)",
        "ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS app_version VARCHAR(30)",
        "ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS device_id_hash VARCHAR(64)",
        "ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    ):
        conn.execute(text(statement))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_auth_sessions_user_client_last_used "
        "ON auth_sessions (user_id, client_type, last_used_at DESC)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_users_shop_name ON users (shop_name)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_users_vendor_request_status ON users (vendor_request_status)"
    ))
    conn.execute(text(
        "ALTER TABLE delivery_addresses ADD COLUMN IF NOT EXISTS google_place_id VARCHAR(255)"
    ))
    conn.execute(text(
        "ALTER TABLE delivery_addresses ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION"
    ))
    conn.execute(text(
        "ALTER TABLE delivery_addresses ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION"
    ))
    conn.execute(text(
        "ALTER TABLE delivery_addresses ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ"
    ))
    conn.execute(text(
        "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS maps_provider "
        "VARCHAR(30) NOT NULL DEFAULT 'google'"
    ))
    conn.execute(text(
        "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS fulfilment_method "
        "VARCHAR(30) NOT NULL DEFAULT 'platform_delivery'"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_deliveries_fulfilment_method "
        "ON deliveries (fulfilment_method)"
    ))
    for statement in (
        "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS delivery_agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS assigned_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ",
        "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ",
        "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ",
    ):
        conn.execute(text(statement))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_deliveries_agent_status_created_at "
        "ON deliveries (delivery_agent_id, status, created_at DESC)"
    ))
    conn.execute(text(
        "ALTER TABLE measurement_profiles "
        "ADD COLUMN IF NOT EXISTS garment_type VARCHAR(50) NOT NULL DEFAULT 'general'"
    ))
    conn.execute(text(
        "ALTER TABLE measurement_profiles "
        "ADD COLUMN IF NOT EXISTS measurements JSONB NOT NULL DEFAULT '{}'::jsonb"
    ))
    conn.execute(text(
        "ALTER TABLE measurement_profiles "
        "ADD COLUMN IF NOT EXISTS standard_size VARCHAR(30)"
    ))
    conn.execute(text(
        "ALTER TABLE designs ALTER COLUMN image_url DROP NOT NULL"
    ))
    conn.execute(text(
        "ALTER TABLE designs ADD COLUMN IF NOT EXISTS vendor_id INTEGER "
        "REFERENCES users(id) ON DELETE RESTRICT"
    ))
    conn.execute(text(
        "ALTER TABLE designs ADD COLUMN IF NOT EXISTS status VARCHAR(20)"
    ))
    conn.execute(text(
        "UPDATE designs SET status = 'approved' WHERE status IS NULL"
    ))
    conn.execute(text(
        "ALTER TABLE designs ALTER COLUMN status SET DEFAULT 'draft'"
    ))
    conn.execute(text(
        "ALTER TABLE designs ALTER COLUMN status SET NOT NULL"
    ))
    conn.execute(text(
        "ALTER TABLE designs ADD COLUMN IF NOT EXISTS rejection_comment TEXT"
    ))
    conn.execute(text(
        "ALTER TABLE designs ADD COLUMN IF NOT EXISTS reviewed_by_id INTEGER "
        "REFERENCES users(id) ON DELETE SET NULL"
    ))
    conn.execute(text(
        "ALTER TABLE designs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ"
    ))
    conn.execute(text(
        "ALTER TABLE designs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ"
    ))
    conn.execute(text(
        "ALTER TABLE designs ADD COLUMN IF NOT EXISTS is_custom_request_template "
        "BOOLEAN NOT NULL DEFAULT FALSE"
    ))
    conn.execute(text(
        "UPDATE designs SET updated_at = created_at WHERE updated_at IS NULL"
    ))
    conn.execute(text(
        "ALTER TABLE designs ALTER COLUMN updated_at SET DEFAULT NOW()"
    ))
    conn.execute(text(
        "ALTER TABLE designs ALTER COLUMN updated_at SET NOT NULL"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_designs_vendor_id ON designs (vendor_id)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_designs_status ON designs (status)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_designs_custom_request_template "
        "ON designs (is_custom_request_template)"
    ))
    conn.execute(text(
        "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS work_status "
        "VARCHAR(30) NOT NULL DEFAULT 'awaiting_invoice'"
    ))
    conn.execute(text(
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS vendor_id INTEGER "
        "REFERENCES users(id) ON DELETE RESTRICT"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_orders_vendor_created_at "
        "ON orders (vendor_id, created_at DESC)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_order_items_work_status "
        "ON order_items (work_status)"
    ))
    conn.execute(text(
        "ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cloth_source "
        "VARCHAR(30) NOT NULL DEFAULT 'customer_provided'"
    ))
    conn.execute(text(
        "UPDATE order_items AS oi SET cloth_source = vi.cloth_source "
        "FROM vendor_invoices AS vi WHERE vi.order_item_id = oi.id"
    ))
    conn.execute(text(
        "ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS "
        "cloth_bill_bucket_name VARCHAR(255)"
    ))
    conn.execute(text(
        "ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS "
        "cloth_bill_object_name VARCHAR(1024)"
    ))
    conn.execute(text(
        "ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS "
        "cloth_bill_original_filename VARCHAR(255)"
    ))
    conn.execute(text(
        "ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS "
        "cloth_bill_content_type VARCHAR(100)"
    ))
    conn.execute(text(
        "ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS "
        "cloth_bill_size_bytes INTEGER"
    ))
    conn.execute(text(
        "ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS "
        "cloth_bill_uploaded_at TIMESTAMPTZ"
    ))
    conn.execute(text(
        "ALTER TABLE vendor_invoices ADD COLUMN IF NOT EXISTS "
        "revision INTEGER NOT NULL DEFAULT 1"
    ))
    for table_name in ("vendor_invoices", "order_invoices"):
        for column_definition in (
            "payment_gateway VARCHAR(30)",
            "gateway_order_id VARCHAR(100)",
            "gateway_payment_id VARCHAR(100)",
            "gateway_amount_paise INTEGER",
        ):
            conn.execute(text(
                f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {column_definition}"
            ))
        conn.execute(text(
            f"CREATE UNIQUE INDEX IF NOT EXISTS uq_{table_name}_gateway_order_id "
            f"ON {table_name} (gateway_order_id) WHERE gateway_order_id IS NOT NULL"
        ))
        conn.execute(text(
            f"CREATE UNIQUE INDEX IF NOT EXISTS uq_{table_name}_gateway_payment_id "
            f"ON {table_name} (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL"
        ))
        for column_definition in (
            "final_payment_status VARCHAR(30) NOT NULL DEFAULT 'pending'",
            "final_payment_gateway VARCHAR(30)",
            "final_gateway_order_id VARCHAR(100)",
            "final_gateway_payment_id VARCHAR(100)",
            "final_gateway_amount_paise INTEGER",
            "final_paid_at TIMESTAMPTZ",
        ):
            conn.execute(text(
                f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {column_definition}"
            ))
        conn.execute(text(
            f"CREATE UNIQUE INDEX IF NOT EXISTS uq_{table_name}_final_gateway_order_id "
            f"ON {table_name} (final_gateway_order_id) WHERE final_gateway_order_id IS NOT NULL"
        ))
        conn.execute(text(
            f"CREATE UNIQUE INDEX IF NOT EXISTS uq_{table_name}_final_gateway_payment_id "
            f"ON {table_name} (final_gateway_payment_id) WHERE final_gateway_payment_id IS NOT NULL"
        ))
    # Hot list/detail paths. PostgreSQL does not automatically index foreign
    # keys, so create the composite indexes the paginated APIs rely on.
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_orders_user_created_at "
        "ON orders (user_id, created_at DESC)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_orders_created_at "
        "ON orders (created_at DESC)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_order_items_order_id "
        "ON order_items (order_id)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_order_items_design_id "
        "ON order_items (design_id)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_order_comments_item_created_at "
        "ON order_comments (order_item_id, created_at)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_order_comments_item_id "
        "ON order_comments (order_item_id, id)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_notifications_user_created_at "
        "ON notifications (user_id, created_at DESC)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_notifications_user_unread_created_at "
        "ON notifications (user_id, created_at DESC) WHERE read_at IS NULL"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_designs_vendor_status_updated "
        "ON designs (vendor_id, status, updated_at DESC)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_deliveries_status_created_at "
        "ON deliveries (status, created_at DESC)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_deliveries_vendor_created_at "
        "ON deliveries (vendor_id, created_at DESC)"
    ))
    # Product-shop orders share delivery tracking with tailoring orders.
    # Existing databases need these ALTERs because create_all does not
    # evolve tables that already exist.
    conn.execute(text(
        "ALTER TABLE deliveries ALTER COLUMN order_id DROP NOT NULL"
    ))
    conn.execute(text(
        "ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS product_order_id INTEGER"
    ))
    conn.execute(text("""
        DO $$ BEGIN
            ALTER TABLE deliveries ADD CONSTRAINT fk_deliveries_product_order
            FOREIGN KEY (product_order_id) REFERENCES product_orders(id) ON DELETE CASCADE;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
    """))
    conn.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_deliveries_product_order_id "
        "ON deliveries (product_order_id) WHERE product_order_id IS NOT NULL"
    ))
    conn.execute(text("""
        DO $$ BEGIN
            ALTER TABLE deliveries ADD CONSTRAINT ck_delivery_exactly_one_order
            CHECK ((order_id IS NOT NULL) <> (product_order_id IS NOT NULL));
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
    """))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_products_vendor_status_updated "
        "ON products (vendor_id, status, updated_at DESC)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_products_catalog "
        "ON products (status, category, product_type, updated_at DESC)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_product_orders_customer_created "
        "ON product_orders (user_id, created_at DESC)"
    ))
    conn.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_product_orders_vendor_created "
        "ON product_orders (vendor_id, created_at DESC)"
    ))
    


def downgrade() -> None:
    raise RuntimeError(
        "The adopted production baseline is intentionally irreversible; "
        "restore a database backup instead of dropping application tables."
    )
