import enum
from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy import (
    Boolean, String, Integer, Float, ForeignKey, DateTime, Enum, Table, Column, Text,
    CheckConstraint, Index, UniqueConstraint, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


def utcnow() -> datetime:
    """Timezone-aware UTC now (datetime.utcnow() is deprecated as of 3.12)."""
    return datetime.now(timezone.utc)


class OrderStatus(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    FABRIC_CUTTING = "fabric_cutting"
    STITCHING = "stitching"
    QUALITY_CHECK = "quality_check"
    READY_FOR_SHIPPING = "ready_for_shipping"
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


class UserRole(str, enum.Enum):
    CUSTOMER = "customer"
    VENDOR = "vendor"
    ADMIN = "admin"
    SUPER_ADMIN = "super_admin"
    DELIVERY_AGENT = "delivery_agent"


class VendorCustomerStatus(str, enum.Enum):
    INVITED = "invited"
    PENDING_ACCEPTANCE = "pending_acceptance"
    ACTIVE = "active"
    DECLINED = "declined"


class DesignStatus(str, enum.Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"


# Junction table for User favorites / liked designs
user_liked_designs = Table(
    "user_liked_designs",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("design_id", ForeignKey("designs.id", ondelete="CASCADE"), primary_key=True),
)

user_favorite_vendors = Table(
    "user_favorite_vendors",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("vendor_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    CheckConstraint("user_id <> vendor_id", name="ck_favorite_vendor_not_self"),
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    full_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )
    location: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    profile_image_bucket_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    profile_image_object_name: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    profile_image_content_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    profile_image_original_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    profile_image_size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    shop_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True, index=True)
    shop_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    vendor_logo_bucket_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    vendor_logo_object_name: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    vendor_logo_content_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    vendor_logo_original_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    vendor_logo_size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    vendor_request_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    vendor_request_shop_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    vendor_request_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    vendor_request_review_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    vendor_requested_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    vendor_request_reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    vendor_request_reviewed_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Delivery pricing uses a vendor-selected, provider-verified business pickup
    # point, separate from the free-form profile location.
    vendor_pickup_address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    vendor_pickup_place_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    vendor_pickup_latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    vendor_pickup_longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    vendor_pickup_geocoded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Vendors can keep platform distance pricing or publish one fixed fee for
    # their own delivery service. Customer-arranged fulfilment remains free.
    vendor_delivery_pricing: Mapped[str] = mapped_column(
        String(20), default="platform", server_default="platform"
    )
    vendor_delivery_fee: Mapped[float] = mapped_column(
        Float, default=0, server_default="0"
    )
    delivery_agent_latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    delivery_agent_longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    delivery_agent_location_accuracy_meters: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )
    delivery_agent_location_updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(
        String(20), default=UserRole.CUSTOMER.value, server_default=UserRole.CUSTOMER.value
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    @property
    def profile_image_url(self) -> Optional[str]:
        if not self.profile_image_object_name:
            return None
        version = self.profile_image_object_name.rsplit("/", 1)[-1]
        return f"/api/media/users/{self.id}/profile-image?v={version}"

    @property
    def vendor_logo_url(self) -> Optional[str]:
        if not self.vendor_logo_object_name:
            return None
        version = self.vendor_logo_object_name.rsplit("/", 1)[-1]
        return f"/api/media/vendors/{self.id}/logo?v={version}"

    measurement_profiles: Mapped[List["MeasurementProfile"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    addresses: Mapped[List["DeliveryAddress"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    # Orders are historical business records: deleting a user must not cascade
    # into deleting their order history. FK uses RESTRICT (see Order.user_id).
    orders: Mapped[List["Order"]] = relationship(
        back_populates="user", foreign_keys="Order.user_id"
    )
    liked_designs: Mapped[List["Design"]] = relationship(
        secondary=user_liked_designs, back_populates="liked_by_users"
    )
    vendor_designs: Mapped[List["Design"]] = relationship(
        back_populates="vendor", foreign_keys="Design.vendor_id"
    )
    notifications: Mapped[List["Notification"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    auth_sessions: Mapped[List["AuthSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    password_reset_tokens: Mapped[List["PasswordResetToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    vendor_customer_relationships: Mapped[
        List["VendorCustomerRelationship"]
    ] = relationship(
        back_populates="vendor",
        foreign_keys="VendorCustomerRelationship.vendor_id",
        cascade="all, delete-orphan",
    )
    customer_vendor_relationships: Mapped[
        List["VendorCustomerRelationship"]
    ] = relationship(
        back_populates="customer",
        foreign_keys="VendorCustomerRelationship.customer_user_id",
        cascade="all, delete-orphan",
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    refresh_token_hash: Mapped[str] = mapped_column(String(64))
    client_type: Mapped[str] = mapped_column(
        String(20), default="web", server_default="web"
    )
    device_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    device_platform: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    app_version: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    device_id_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    last_used_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    user: Mapped["User"] = relationship(back_populates="auth_sessions")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Only a SHA-256 digest is persisted. The usable token exists solely in
    # the email link and can therefore be used only by its recipient.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped["User"] = relationship(back_populates="password_reset_tokens")


class VendorCustomerRelationship(Base):
    __tablename__ = "vendor_customer_relationships"
    __table_args__ = (
        UniqueConstraint(
            "vendor_id",
            "customer_user_id",
            name="uq_vendor_customer_relationship",
        ),
        UniqueConstraint(
            "invitation_token_id",
            name="uq_vendor_customer_invitation_token",
        ),
        CheckConstraint(
            "vendor_id <> customer_user_id",
            name="ck_vendor_customer_not_self",
        ),
        CheckConstraint(
            "status IN ('invited', 'pending_acceptance', 'active', 'declined')",
            name="ck_vendor_customer_status",
        ),
        Index(
            "ix_vendor_customer_relationships_vendor_status_updated",
            "vendor_id",
            "status",
            "updated_at",
        ),
        Index(
            "ix_vendor_customer_relationships_customer_status",
            "customer_user_id",
            "status",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    vendor_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    customer_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    status: Mapped[str] = mapped_column(
        String(30),
        default=VendorCustomerStatus.PENDING_ACCEPTANCE.value,
        server_default=VendorCustomerStatus.PENDING_ACCEPTANCE.value,
    )
    vendor_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    invitation_token_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("password_reset_tokens.id", ondelete="SET NULL"),
        nullable=True,
    )
    invited_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    accepted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    declined_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    vendor: Mapped["User"] = relationship(
        back_populates="vendor_customer_relationships",
        foreign_keys=[vendor_id],
    )
    customer: Mapped["User"] = relationship(
        back_populates="customer_vendor_relationships",
        foreign_keys=[customer_user_id],
    )
    created_by: Mapped[Optional["User"]] = relationship(
        foreign_keys=[created_by_user_id]
    )
    invitation_token: Mapped[Optional["PasswordResetToken"]] = relationship(
        foreign_keys=[invitation_token_id]
    )


class MeasurementProfile(Base):
    __tablename__ = "measurement_profiles"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    profile_name: Mapped[str] = mapped_column(String(50))
    gender: Mapped[str] = mapped_column(String(20))
    garment_type: Mapped[str] = mapped_column(
        String(50), default="general", server_default="general"
    )
    standard_size: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    unit: Mapped[str] = mapped_column(String(10), default="inches")
    measurements: Mapped[dict] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )

    chest: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    waist: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    hips: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    shoulder_width: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sleeve_length: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    inseam: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    neck: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    height: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    user: Mapped["User"] = relationship(back_populates="measurement_profiles")

    # Order items reference this profile via RESTRICT (see OrderItem.measurement_profile_id) —
    # a profile used in a past order can't be hard-deleted; a full value snapshot is also
    # copied onto OrderItem.measurement_snapshot at order time, so history survives either way.


class MeasurementCategory(Base):
    __tablename__ = "measurement_categories"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    garment_type: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    gender: Mapped[str] = mapped_column(String(20), index=True)
    measurement_fields: Mapped[list] = mapped_column(JSONB, default=list)
    standard_sizes: Mapped[dict] = mapped_column(JSONB, default=dict)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class DeliveryAddress(Base):
    __tablename__ = "delivery_addresses"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    recipient_name: Mapped[str] = mapped_column(String(100))
    phone_number: Mapped[str] = mapped_column(String(20))
    street_address: Mapped[str] = mapped_column(String(255))
    city: Mapped[str] = mapped_column(String(100))
    state: Mapped[str] = mapped_column(String(100))
    postal_code: Mapped[str] = mapped_column(String(20))
    country: Mapped[str] = mapped_column(String(100), default="India")
    is_default: Mapped[bool] = mapped_column(default=False)
    google_place_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    geocoded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    user: Mapped["User"] = relationship(back_populates="addresses")


class Design(Base):
    __tablename__ = "designs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(150), index=True)
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(20))       # "men" / "women"
    garment_type: Mapped[str] = mapped_column(String(50))   # "suit", "dress", "shirt", etc.
    base_price: Mapped[float] = mapped_column(Float)
    is_custom_request_template: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    # Kept for backward compatibility with designs seeded before GCS support.
    image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    vendor_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(
        String(20), default=DesignStatus.DRAFT.value,
        server_default=DesignStatus.DRAFT.value, index=True
    )
    rejection_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewed_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow,
        server_default=func.now()
    )

    liked_by_users: Mapped[List["User"]] = relationship(
        secondary=user_liked_designs, back_populates="liked_designs"
    )
    vendor: Mapped[Optional["User"]] = relationship(
        back_populates="vendor_designs", foreign_keys=[vendor_id]
    )
    reviewer: Mapped[Optional["User"]] = relationship(foreign_keys=[reviewed_by_id])
    images: Mapped[List["DesignImage"]] = relationship(
        back_populates="design",
        cascade="all, delete-orphan",
        order_by="DesignImage.sort_order",
    )
    reviews: Mapped[List["DesignReview"]] = relationship(
        back_populates="design", cascade="all, delete-orphan"
    )


class DesignImage(Base):
    __tablename__ = "design_images"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    design_id: Mapped[int] = mapped_column(
        ForeignKey("designs.id", ondelete="CASCADE"), index=True
    )
    bucket_name: Mapped[str] = mapped_column(String(255))
    object_name: Mapped[str] = mapped_column(String(1024), unique=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[Optional[int]] = mapped_column(nullable=True)
    upload_status: Mapped[str] = mapped_column(
        String(20), default="uploading", server_default="uploading"
    )
    sort_order: Mapped[int] = mapped_column(default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    design: Mapped["Design"] = relationship(back_populates="images")


class DesignReview(Base):
    __tablename__ = "design_reviews"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    design_id: Mapped[int] = mapped_column(
        ForeignKey("designs.id", ondelete="CASCADE"), index=True
    )
    reviewer_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT")
    )
    decision: Mapped[str] = mapped_column(String(20))
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    design: Mapped["Design"] = relationship(back_populates="reviews")
    reviewer: Mapped["User"] = relationship(foreign_keys=[reviewer_id])


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    vendor_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    title: Mapped[str] = mapped_column(String(150), index=True)
    description: Mapped[str] = mapped_column(Text)
    product_type: Mapped[str] = mapped_column(String(30), index=True)
    category: Mapped[str] = mapped_column(String(20), index=True)
    garment_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    price: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(20), default="piece", server_default="piece")
    stock_quantity: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    sizes: Mapped[list] = mapped_column(JSONB, default=list)
    colors: Mapped[list] = mapped_column(JSONB, default=list)
    status: Mapped[str] = mapped_column(
        String(20), default=DesignStatus.DRAFT.value,
        server_default=DesignStatus.DRAFT.value, index=True
    )
    rejection_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewed_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    vendor: Mapped["User"] = relationship(foreign_keys=[vendor_id])
    reviewer: Mapped[Optional["User"]] = relationship(foreign_keys=[reviewed_by_id])
    images: Mapped[List["ProductImage"]] = relationship(
        back_populates="product", cascade="all, delete-orphan",
        order_by="ProductImage.sort_order",
    )


class ProductImage(Base):
    __tablename__ = "product_images"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    bucket_name: Mapped[str] = mapped_column(String(255))
    object_name: Mapped[str] = mapped_column(String(1024), unique=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    upload_status: Mapped[str] = mapped_column(
        String(20), default="ready", server_default="ready"
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    product: Mapped["Product"] = relationship(back_populates="images")


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(150))
    message: Mapped[str] = mapped_column(Text)
    notification_type: Mapped[str] = mapped_column(String(50), default="info")
    link: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    read_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped["User"] = relationship(back_populates="notifications")


class EmailOutbox(Base):
    """Retryable transactional email created with its source DB transaction."""

    __tablename__ = "email_outbox"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    recipient_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    subject: Mapped[str] = mapped_column(String(200))
    text_body: Mapped[str] = mapped_column(Text)
    html_body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), default="pending", server_default="pending", index=True
    )
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[Optional["User"]] = relationship(foreign_keys=[user_id])


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    # RESTRICT: an order is a business/financial record. Deleting a user or address
    # that has orders attached should fail loudly, not cascade-delete order history.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    address_id: Mapped[int] = mapped_column(ForeignKey("delivery_addresses.id", ondelete="RESTRICT"))
    # New checkouts are vendor-scoped so tailoring and shop items can share one
    # delivery and one invoice. Nullable keeps historical multi-vendor orders readable.
    vendor_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    total_amount: Mapped[float] = mapped_column(Float)
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus), default=OrderStatus.PENDING)
    tracking_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped["User"] = relationship(back_populates="orders", foreign_keys=[user_id])
    address: Mapped["DeliveryAddress"] = relationship()
    vendor: Mapped[Optional["User"]] = relationship(foreign_keys=[vendor_id])
    order_items: Mapped[List["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )
    deliveries: Mapped[List["Delivery"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )
    product_items: Mapped[List["OrderProductItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )
    combined_invoice: Mapped[Optional["OrderInvoice"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", uselist=False
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    design_id: Mapped[int] = mapped_column(ForeignKey("designs.id", ondelete="RESTRICT"))
    measurement_profile_id: Mapped[int] = mapped_column(
        ForeignKey("measurement_profiles.id", ondelete="RESTRICT")
    )
    fabric_choice: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    custom_instructions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # The customer owns this decision. Vendors quote against it but cannot
    # switch who supplies the cloth while preparing an invoice.
    cloth_source: Mapped[str] = mapped_column(
        String(30), default="customer_provided", server_default="customer_provided"
    )
    price: Mapped[float] = mapped_column(Float)
    work_status: Mapped[str] = mapped_column(
        String(30), default="awaiting_invoice", server_default="awaiting_invoice", index=True
    )

    # Full measurement values at the moment the order was placed, so the record
    # stays accurate even if the linked MeasurementProfile is edited later.
    measurement_snapshot: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    order: Mapped["Order"] = relationship(back_populates="order_items")
    design: Mapped["Design"] = relationship()
    measurement_profile: Mapped["MeasurementProfile"] = relationship()
    invoice: Mapped[Optional["VendorInvoice"]] = relationship(
        back_populates="order_item", cascade="all, delete-orphan", uselist=False
    )
    comments: Mapped[List["OrderComment"]] = relationship(
        back_populates="order_item",
        cascade="all, delete-orphan",
        order_by="OrderComment.created_at",
    )


class OrderProductItem(Base):
    """A product purchase included in the same vendor order as tailoring lines."""

    __tablename__ = "order_product_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), index=True
    )
    quantity: Mapped[float] = mapped_column(Float)
    selected_size: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    selected_color: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    unit_price: Mapped[float] = mapped_column(Float)
    merchandise_total: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(
        String(30), default="placed", server_default="placed", index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    order: Mapped["Order"] = relationship(back_populates="product_items")
    product: Mapped["Product"] = relationship()


class OrderInvoice(Base):
    """One invoice for every line in a vendor-scoped combined order."""

    __tablename__ = "order_invoices"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), unique=True, index=True
    )
    vendor_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    service_amount: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    merchandise_amount: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    cloth_source: Mapped[str] = mapped_column(
        String(30), default="customer_provided", server_default="customer_provided"
    )
    cloth_type: Mapped[str] = mapped_column(String(150))
    cloth_requirement: Mapped[str] = mapped_column(Text)
    cloth_cost: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    delivery_cost: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    status: Mapped[str] = mapped_column(
        String(30), default="draft", server_default="draft", index=True
    )
    payment_status: Mapped[str] = mapped_column(
        String(30), default="not_required", server_default="not_required", index=True
    )
    payment_reference: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    payment_gateway: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    gateway_order_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    gateway_payment_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    gateway_amount_paise: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    final_payment_status: Mapped[str] = mapped_column(
        String(30), default="pending", server_default="pending", index=True
    )
    final_payment_gateway: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    final_gateway_order_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    final_gateway_payment_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    final_gateway_amount_paise: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    final_paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    cloth_received: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    cloth_bill_bucket_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    cloth_bill_object_name: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    cloth_bill_original_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    cloth_bill_content_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    cloth_bill_size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cloth_bill_uploaded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    issued_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    order: Mapped["Order"] = relationship(back_populates="combined_invoice")
    vendor: Mapped["User"] = relationship(foreign_keys=[vendor_id])
    line_items: Mapped[List["OrderInvoiceLineItem"]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan",
        order_by="OrderInvoiceLineItem.id",
    )


class OrderInvoiceLineItem(Base):
    __tablename__ = "order_invoice_line_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("order_invoices.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(150))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=1, server_default="1")
    unit_price: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    invoice: Mapped["OrderInvoice"] = relationship(back_populates="line_items")


class VendorInvoice(Base):
    __tablename__ = "vendor_invoices"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    order_item_id: Mapped[int] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"), unique=True, index=True
    )
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    service_amount: Mapped[float] = mapped_column(Float)
    cloth_source: Mapped[str] = mapped_column(String(30))
    cloth_type: Mapped[str] = mapped_column(String(150))
    cloth_requirement: Mapped[str] = mapped_column(Text)
    cloth_cost: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    delivery_cost: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    status: Mapped[str] = mapped_column(
        String(30), default="draft", server_default="draft", index=True
    )
    payment_status: Mapped[str] = mapped_column(
        String(30), default="not_required", server_default="not_required", index=True
    )
    payment_reference: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    payment_gateway: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    gateway_order_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    gateway_payment_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    gateway_amount_paise: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    final_payment_status: Mapped[str] = mapped_column(
        String(30), default="pending", server_default="pending", index=True
    )
    final_payment_gateway: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    final_gateway_order_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    final_gateway_payment_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    final_gateway_amount_paise: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    final_paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    cloth_received: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    cloth_bill_bucket_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    cloth_bill_object_name: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    cloth_bill_original_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    cloth_bill_content_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    cloth_bill_size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cloth_bill_uploaded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    issued_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    order_item: Mapped["OrderItem"] = relationship(back_populates="invoice")
    line_items: Mapped[List["VendorInvoiceLineItem"]] = relationship(
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="VendorInvoiceLineItem.id",
    )


class VendorInvoiceLineItem(Base):
    __tablename__ = "vendor_invoice_line_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("vendor_invoices.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(150))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=1, server_default="1")
    unit_price: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    invoice: Mapped["VendorInvoice"] = relationship(back_populates="line_items")


class PaymentTransaction(Base):
    """Provider-neutral payment ledger used for reconciliation and refunds."""

    __tablename__ = "payment_transactions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    provider: Mapped[str] = mapped_column(String(30), default="razorpay", server_default="razorpay")
    provider_order_id: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    provider_payment_id: Mapped[Optional[str]] = mapped_column(String(100), unique=True, nullable=True, index=True)
    provider_refund_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    scope: Mapped[str] = mapped_column(String(40))
    resource_id: Mapped[int] = mapped_column(Integer)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    invoice_kind: Mapped[str] = mapped_column(String(20))
    invoice_id: Mapped[int] = mapped_column(Integer, index=True)
    payment_stage: Mapped[str] = mapped_column(String(20), index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    vendor_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    amount_paise: Mapped[int] = mapped_column(Integer)
    amount_refunded_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    currency: Mapped[str] = mapped_column(String(3), default="INR", server_default="INR")
    status: Mapped[str] = mapped_column(String(30), default="created", server_default="created", index=True)
    failure_code: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    failure_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    captured_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    refunded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class PaymentWebhookEvent(Base):
    """Minimal idempotency and audit record for a provider webhook delivery."""

    __tablename__ = "payment_webhook_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    provider: Mapped[str] = mapped_column(String(30), default="razorpay", server_default="razorpay")
    provider_event_id: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    event_type: Mapped[str] = mapped_column(String(100), index=True)
    provider_order_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    provider_payment_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="received", server_default="received", index=True)
    error_message: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class VendorSettlement(Base):
    """Internal payout ledger; no automatic transfer occurs without Route."""

    __tablename__ = "vendor_settlements"
    __table_args__ = (
        UniqueConstraint("payment_transaction_id", name="uq_vendor_settlement_payment_transaction"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    payment_transaction_id: Mapped[int] = mapped_column(
        ForeignKey("payment_transactions.id", ondelete="RESTRICT"), index=True
    )
    vendor_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="RESTRICT"), index=True)
    gross_amount_paise: Mapped[int] = mapped_column(Integer)
    platform_delivery_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    platform_fee_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    payable_amount_paise: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(30), default="pending", server_default="pending", index=True)
    payout_reference: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class OrderComment(Base):
    __tablename__ = "order_comments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    order_item_id: Mapped[int] = mapped_column(
        ForeignKey("order_items.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    order_item: Mapped["OrderItem"] = relationship(back_populates="comments")
    author: Mapped["User"] = relationship(foreign_keys=[author_id])


class ProductOrder(Base):
    __tablename__ = "product_orders"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    vendor_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="RESTRICT"), index=True)
    address_id: Mapped[int] = mapped_column(
        ForeignKey("delivery_addresses.id", ondelete="RESTRICT")
    )
    quantity: Mapped[float] = mapped_column(Float)
    selected_size: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    selected_color: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    unit_price: Mapped[float] = mapped_column(Float)
    merchandise_total: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(
        String(30), default="placed", server_default="placed", index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    vendor: Mapped["User"] = relationship(foreign_keys=[vendor_id])
    product: Mapped["Product"] = relationship()
    address: Mapped["DeliveryAddress"] = relationship()
    delivery: Mapped[Optional["Delivery"]] = relationship(
        back_populates="product_order", cascade="all, delete-orphan", uselist=False
    )


class DeliverySettings(Base):
    """Singleton administrator configuration used when delivery is quoted."""

    __tablename__ = "delivery_settings"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    price_per_100m: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    provider_name: Mapped[str] = mapped_column(String(150), default="")
    provider_email: Mapped[str] = mapped_column(String(255), default="")
    provider_phone: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    communication_details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    updated_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Delivery(Base):
    """One delivery per order/vendor, avoiding repeated charges per design item."""

    __tablename__ = "deliveries"
    __table_args__ = (
        UniqueConstraint("order_id", "vendor_id", name="uq_delivery_order_vendor"),
        CheckConstraint(
            "(order_id IS NOT NULL) <> (product_order_id IS NOT NULL)",
            name="ck_delivery_exactly_one_order",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    order_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=True, index=True
    )
    product_order_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("product_orders.id", ondelete="CASCADE"),
        unique=True, nullable=True, index=True
    )
    vendor_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    delivery_agent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    assigned_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    fulfilment_method: Mapped[str] = mapped_column(
        String(30), default="platform_delivery", server_default="platform_delivery", index=True
    )
    provider_name: Mapped[str] = mapped_column(String(150))
    provider_email: Mapped[str] = mapped_column(String(255))
    provider_phone: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    provider_details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    maps_provider: Mapped[str] = mapped_column(
        String(30), default="openstreetmap", server_default="openstreetmap"
    )
    origin_address: Mapped[str] = mapped_column(String(500))
    origin_place_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    origin_latitude: Mapped[float] = mapped_column(Float)
    origin_longitude: Mapped[float] = mapped_column(Float)
    destination_address: Mapped[str] = mapped_column(String(500))
    destination_place_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    destination_latitude: Mapped[float] = mapped_column(Float)
    destination_longitude: Mapped[float] = mapped_column(Float)
    distance_meters: Mapped[int] = mapped_column(Integer)
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    price_per_100m: Mapped[float] = mapped_column(Float)
    delivery_cost: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(
        String(30), default="quote_ready", server_default="quote_ready", index=True
    )
    tracking_number: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    tracking_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    external_reference: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    admin_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    assigned_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    picked_up_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    order: Mapped[Optional["Order"]] = relationship(back_populates="deliveries")
    product_order: Mapped[Optional["ProductOrder"]] = relationship(back_populates="delivery")
    vendor: Mapped["User"] = relationship(foreign_keys=[vendor_id])
    delivery_agent: Mapped[Optional["User"]] = relationship(foreign_keys=[delivery_agent_id])
    assigned_by: Mapped[Optional["User"]] = relationship(foreign_keys=[assigned_by_id])


# Explicitly model the tuned and partial indexes that were historically added
# by startup SQL. Keeping them in metadata makes Alembic drift checks reliable.
Index(
    "ix_auth_sessions_user_client_last_used",
    AuthSession.user_id,
    AuthSession.client_type,
    AuthSession.last_used_at.desc(),
)
Index(
    "ix_deliveries_agent_status_created_at",
    Delivery.delivery_agent_id,
    Delivery.status,
    Delivery.created_at.desc(),
)
Index("ix_deliveries_status_created_at", Delivery.status, Delivery.created_at.desc())
Index("ix_deliveries_vendor_created_at", Delivery.vendor_id, Delivery.created_at.desc())
Index("ix_designs_custom_request_template", Design.is_custom_request_template)
Index(
    "ix_designs_vendor_status_updated",
    Design.vendor_id,
    Design.status,
    Design.updated_at.desc(),
)
Index("ix_notifications_user_created_at", Notification.user_id, Notification.created_at.desc())
Index(
    "ix_notifications_user_unread_created_at",
    Notification.user_id,
    Notification.created_at.desc(),
    postgresql_where=Notification.read_at.is_(None),
)
Index(
    "ix_order_comments_item_created_at",
    OrderComment.order_item_id,
    OrderComment.created_at,
)
Index("ix_order_comments_item_id", OrderComment.order_item_id, OrderComment.id)
Index("ix_order_items_order_id", OrderItem.order_id)
Index("ix_order_items_design_id", OrderItem.design_id)
Index("ix_orders_created_at", Order.created_at.desc())
Index("ix_orders_user_created_at", Order.user_id, Order.created_at.desc())
Index("ix_orders_vendor_created_at", Order.vendor_id, Order.created_at.desc())
Index(
    "ix_product_orders_customer_created",
    ProductOrder.user_id,
    ProductOrder.created_at.desc(),
)
Index(
    "ix_product_orders_vendor_created",
    ProductOrder.vendor_id,
    ProductOrder.created_at.desc(),
)
Index(
    "ix_products_catalog",
    Product.status,
    Product.category,
    Product.product_type,
    Product.updated_at.desc(),
)
Index(
    "ix_products_vendor_status_updated",
    Product.vendor_id,
    Product.status,
    Product.updated_at.desc(),
)
Index("uq_users_email_lower", func.lower(User.email), unique=True)
Index(
    "uq_users_phone_not_null",
    User.phone,
    unique=True,
    postgresql_where=User.phone.is_not(None),
)
for invoice_model, prefix in (
    (OrderInvoice, "order_invoices"),
    (VendorInvoice, "vendor_invoices"),
):
    Index(
        f"uq_{prefix}_gateway_order_id",
        invoice_model.gateway_order_id,
        unique=True,
        postgresql_where=invoice_model.gateway_order_id.is_not(None),
    )
    Index(
        f"uq_{prefix}_gateway_payment_id",
        invoice_model.gateway_payment_id,
        unique=True,
        postgresql_where=invoice_model.gateway_payment_id.is_not(None),
    )
    Index(
        f"uq_{prefix}_final_gateway_order_id",
        invoice_model.final_gateway_order_id,
        unique=True,
        postgresql_where=invoice_model.final_gateway_order_id.is_not(None),
    )
    Index(
        f"uq_{prefix}_final_gateway_payment_id",
        invoice_model.final_gateway_payment_id,
        unique=True,
        postgresql_where=invoice_model.final_gateway_payment_id.is_not(None),
    )
