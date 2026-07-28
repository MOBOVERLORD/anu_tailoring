import enum
from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy import (
    String, Integer, Float, ForeignKey, DateTime, Enum, Table, Column, Text
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
    SHIPPED = "shipped"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


# Junction table for User favorites / liked designs
user_liked_designs = Table(
    "user_liked_designs",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("design_id", ForeignKey("designs.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    full_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True, unique=True, index=True
    )
    location: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    measurement_profiles: Mapped[List["MeasurementProfile"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    addresses: Mapped[List["DeliveryAddress"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    # Orders are historical business records: deleting a user must not cascade
    # into deleting their order history. FK uses RESTRICT (see Order.user_id).
    orders: Mapped[List["Order"]] = relationship(back_populates="user")
    liked_designs: Mapped[List["Design"]] = relationship(
        secondary=user_liked_designs, back_populates="liked_by_users"
    )


class MeasurementProfile(Base):
    __tablename__ = "measurement_profiles"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    profile_name: Mapped[str] = mapped_column(String(50))
    gender: Mapped[str] = mapped_column(String(20))
    garment_type: Mapped[str] = mapped_column(String(50), default="general")
    unit: Mapped[str] = mapped_column(String(10), default="inches")
    measurements: Mapped[dict] = mapped_column(JSONB, default=dict)

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

    user: Mapped["User"] = relationship(back_populates="addresses")


class Design(Base):
    __tablename__ = "designs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(150), index=True)
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(20))       # "men" / "women"
    garment_type: Mapped[str] = mapped_column(String(50))   # "suit", "dress", "shirt", etc.
    base_price: Mapped[float] = mapped_column(Float)
    image_url: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    liked_by_users: Mapped[List["User"]] = relationship(
        secondary=user_liked_designs, back_populates="liked_designs"
    )


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    # RESTRICT: an order is a business/financial record. Deleting a user or address
    # that has orders attached should fail loudly, not cascade-delete order history.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    address_id: Mapped[int] = mapped_column(ForeignKey("delivery_addresses.id", ondelete="RESTRICT"))
    total_amount: Mapped[float] = mapped_column(Float)
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus), default=OrderStatus.PENDING)
    tracking_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped["User"] = relationship(back_populates="orders")
    address: Mapped["DeliveryAddress"] = relationship()
    order_items: Mapped[List["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
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
    price: Mapped[float] = mapped_column(Float)

    # Full measurement values at the moment the order was placed, so the record
    # stays accurate even if the linked MeasurementProfile is edited later.
    measurement_snapshot: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    order: Mapped["Order"] = relationship(back_populates="order_items")
    design: Mapped["Design"] = relationship()
    measurement_profile: Mapped["MeasurementProfile"] = relationship()
