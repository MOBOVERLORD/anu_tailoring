from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Dict, Optional, List
from datetime import datetime
import re
from app.models import OrderStatus


def normalize_phone_number(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    if digits.startswith("0091") and len(digits) == 14:
        digits = digits[4:]
    elif digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]

    if not 10 <= len(digits) <= 15:
        raise ValueError("Enter a valid phone number with 10 to 15 digits")
    return digits


# --- Auth Schemas ---
class UserCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str
    phone: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: EmailStr) -> str:
        return str(v).strip().lower()

    @field_validator("full_name")
    @classmethod
    def normalize_name(cls, v: str) -> str:
        return " ".join(v.split())

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, v: str) -> str:
        return normalize_phone_number(v)

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

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: EmailStr) -> str:
        return str(v).strip().lower()


class UserResponse(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    phone: Optional[str] = None
    location: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class UserUpdate(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    phone: Optional[str] = None
    location: Optional[str] = Field(default=None, max_length=150)

    @field_validator("full_name")
    @classmethod
    def normalize_name(cls, v: str) -> str:
        return " ".join(v.split())

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not v.strip():
            return None
        return normalize_phone_number(v)


# --- Measurement Profile Schemas ---
class MeasurementProfileCreate(BaseModel):
    profile_name: str = Field(min_length=2, max_length=50)
    gender: str
    garment_type: str = "general"
    unit: Optional[str] = "inches"
    measurements: Dict[str, float] = Field(default_factory=dict)
    chest: Optional[float] = None
    waist: Optional[float] = None
    hips: Optional[float] = None
    shoulder_width: Optional[float] = None
    sleeve_length: Optional[float] = None
    inseam: Optional[float] = None
    neck: Optional[float] = None
    height: Optional[float] = None
    notes: Optional[str] = None

    @field_validator("gender")
    @classmethod
    def valid_gender(cls, v: str) -> str:
        if v not in {"women", "men"}:
            raise ValueError("Gender must be women or men")
        return v

    @field_validator("unit")
    @classmethod
    def valid_unit(cls, v: Optional[str]) -> str:
        if v not in {"inches", "cm"}:
            raise ValueError("Unit must be inches or cm")
        return v

    @field_validator("measurements")
    @classmethod
    def valid_measurements(cls, values: Dict[str, float]) -> Dict[str, float]:
        if len(values) > 40:
            raise ValueError("A measurement profile can contain at most 40 values")
        for key, value in values.items():
            if not key or len(key) > 50:
                raise ValueError("Measurement names must be between 1 and 50 characters")
            if not 0 < value <= 300:
                raise ValueError(f"{key} looks out of realistic range")
        return values

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
