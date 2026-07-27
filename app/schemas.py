from pydantic import BaseModel, EmailStr, field_validator
from typing import Optional, List
from datetime import datetime
from app.models import OrderStatus


# --- Auth Schemas ---
class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    phone: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one digit")
        if not any(c.isalpha() for c in v):
            raise ValueError("Password must contain at least one letter")
        return v


class UserLogin(BaseModel):
    """Separate from UserCreate: login only needs credentials, not a full name."""
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    phone: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshTokenRequest(BaseModel):
    refresh_token: str


# --- Measurement Profile Schemas ---
class MeasurementProfileCreate(BaseModel):
    profile_name: str
    gender: str
    unit: Optional[str] = "inches"
    chest: Optional[float] = None
    waist: Optional[float] = None
    hips: Optional[float] = None
    shoulder_width: Optional[float] = None
    sleeve_length: Optional[float] = None
    inseam: Optional[float] = None
    neck: Optional[float] = None
    height: Optional[float] = None
    notes: Optional[str] = None

    @field_validator(
        "chest", "waist", "hips", "shoulder_width",
        "sleeve_length", "inseam", "neck", "height",
    )
    @classmethod
    def within_plausible_bounds(cls, v: Optional[float]) -> Optional[float]:
        # Loose bounds-check in cm-equivalent-ish range; catches obvious bad input
        # (negative values, typos like 1000) without being overly strict on units.
        if v is not None and not (0 < v <= 120):
            raise ValueError("Measurement value looks out of realistic range (0-120)")
        return v


class MeasurementProfileResponse(MeasurementProfileCreate):
    id: int
    user_id: int

    class Config:
        from_attributes = True


# --- Design Schemas ---
class DesignResponse(BaseModel):
    id: int
    title: str
    description: str
    category: str
    garment_type: str
    base_price: float
    image_url: str

    class Config:
        from_attributes = True


# --- Delivery Address Schemas ---
class DeliveryAddressCreate(BaseModel):
    recipient_name: str
    phone_number: str
    street_address: str
    city: str
    state: str
    postal_code: str
    country: Optional[str] = "India"
    is_default: Optional[bool] = False


class DeliveryAddressUpdate(BaseModel):
    recipient_name: Optional[str] = None
    phone_number: Optional[str] = None
    street_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None
    is_default: Optional[bool] = None


class DeliveryAddressResponse(DeliveryAddressCreate):
    id: int
    user_id: int

    class Config:
        from_attributes = True


# --- Order Schemas ---
class OrderItemCreate(BaseModel):
    design_id: int
    measurement_profile_id: int
    fabric_choice: Optional[str] = None
    custom_instructions: Optional[str] = None


class OrderCreate(BaseModel):
    address_id: int
    items: List[OrderItemCreate]


class OrderItemResponse(BaseModel):
    id: int
    design: DesignResponse
    measurement_profile: MeasurementProfileResponse
    fabric_choice: Optional[str]
    price: float

    class Config:
        from_attributes = True


class OrderResponse(BaseModel):
    id: int
    total_amount: float
    status: OrderStatus
    tracking_number: Optional[str]
    created_at: datetime
    order_items: List[OrderItemResponse]

    class Config:
        from_attributes = True
