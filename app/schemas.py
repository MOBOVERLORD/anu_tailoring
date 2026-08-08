from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator
from typing import Dict, Optional, List
from datetime import datetime
from decimal import Decimal
import re
from urllib.parse import urlparse
from app.models import DesignStatus, OrderStatus


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
    password: str = Field(max_length=128)
    phone: str = Field(min_length=10, max_length=20)

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
    password: str = Field(max_length=512)

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
    vendor_pickup_address: Optional[str] = None
    vendor_pickup_latitude: Optional[float] = None
    vendor_pickup_longitude: Optional[float] = None
    role: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class PasswordResetRequest(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: EmailStr) -> str:
        return str(v).strip().lower()


class PasswordResetConfirm(BaseModel):
    token: str = Field(min_length=20, max_length=512)
    new_password: str = Field(max_length=128)

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long")
        if not any(c.isdigit() for c in v):
            raise ValueError("Password must contain at least one digit")
        if not any(c.isalpha() for c in v):
            raise ValueError("Password must contain at least one letter")
        return v


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


class AdminUserUpdate(UserUpdate):
    role: Optional[str] = None

    @field_validator("role")
    @classmethod
    def manageable_role(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        normalized = v.strip().lower()
        if normalized not in {"customer", "vendor", "admin"}:
            raise ValueError("Role must be customer, vendor, or admin")
        return normalized



class VendorPickupUpdate(BaseModel):
    pickup_address: str = Field(min_length=10, max_length=500)
    pickup_latitude: float = Field(ge=-90, le=90)
    pickup_longitude: float = Field(ge=-180, le=180)
    location_token: Optional[str] = Field(default=None, min_length=20, max_length=4096)

    @field_validator("pickup_address")
    @classmethod
    def normalize_pickup_address(cls, v: str) -> str:
        return " ".join(v.split())


class VendorCreate(UserCreate):
    pickup_address: str = Field(min_length=10, max_length=500)
    pickup_latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    pickup_longitude: Optional[float] = Field(default=None, ge=-180, le=180)

    @field_validator("pickup_address")
    @classmethod
    def normalize_pickup_address(cls, v: str) -> str:
        return " ".join(v.split())

    @model_validator(mode="after")
    def pickup_coordinates_are_a_pair(self):
        if (self.pickup_latitude is None) != (self.pickup_longitude is None):
            raise ValueError("Pickup latitude and longitude must be provided together")
        return self


class UserStatusUpdate(BaseModel):
    is_active: bool


# --- Measurement Profile Schemas ---
class MeasurementProfileCreate(BaseModel):
    profile_name: str = Field(min_length=2, max_length=50)
    gender: str
    garment_type: str = "general"
    standard_size: Optional[str] = Field(default=None, max_length=30)
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
    notes: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("gender")
    @classmethod
    def valid_gender(cls, v: str) -> str:
        if v not in {"women", "men", "unisex", "kids"}:
            raise ValueError("Gender must be women, men, unisex, or kids")
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


class MeasurementFieldDefinition(BaseModel):
    key: str = Field(min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1, max_length=100)


class MeasurementCategoryCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    garment_type: str = Field(min_length=2, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    gender: str
    measurement_fields: List[MeasurementFieldDefinition] = Field(min_length=1, max_length=40)
    standard_sizes: Dict[str, Dict[str, float]] = Field(default_factory=dict)
    is_active: bool = True
    sort_order: int = Field(default=0, ge=0, le=10_000)

    @field_validator("gender")
    @classmethod
    def valid_category_gender(cls, v: str) -> str:
        normalized = v.strip().lower()
        if normalized not in {"women", "men", "unisex", "kids"}:
            raise ValueError("Gender must be women, men, unisex, or kids")
        return normalized

    @field_validator("name", "garment_type")
    @classmethod
    def normalize_category_text(cls, v: str) -> str:
        return v.strip()

    @field_validator("standard_sizes")
    @classmethod
    def valid_standard_sizes(cls, sizes: Dict[str, Dict[str, float]]) -> Dict[str, Dict[str, float]]:
        if len(sizes) > 20:
            raise ValueError("A category can contain at most 20 standard sizes")
        for size_name, values in sizes.items():
            if not size_name.strip() or len(size_name) > 30:
                raise ValueError("Size names must be between 1 and 30 characters")
            for field, value in values.items():
                if not field or not 0 < value <= 300:
                    raise ValueError(f"Invalid measurement for {size_name}: {field}")
        return sizes


class MeasurementCategoryResponse(MeasurementCategoryCreate):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# --- Design Schemas ---
class DesignCreate(BaseModel):
    title: str = Field(min_length=2, max_length=150)
    description: str = Field(min_length=10, max_length=3000)
    category: str
    garment_type: str = Field(min_length=2, max_length=50)
    base_price: float = Field(gt=0, le=1_000_000)

    @field_validator("category")
    @classmethod
    def valid_category(cls, v: str) -> str:
        normalized = v.strip().lower()
        if normalized not in {"men", "women", "unisex", "kids"}:
            raise ValueError("Category must be men, women, unisex, or kids")
        return normalized

    @field_validator("title", "description", "garment_type")
    @classmethod
    def normalize_design_text(cls, v: str) -> str:
        return v.strip()


class DesignUpdate(DesignCreate):
    pass


class DesignImageResponse(BaseModel):
    id: int
    original_filename: str
    content_type: str
    size_bytes: Optional[int] = None
    sort_order: int
    upload_status: str
    url: Optional[str] = None

    class Config:
        from_attributes = True


class DesignResponse(BaseModel):
    id: int
    title: str
    description: str
    category: str
    garment_type: str
    base_price: float
    image_url: Optional[str] = None
    vendor_id: Optional[int] = None
    vendor_name: Optional[str] = None
    status: str
    rejection_comment: Optional[str] = None
    images: List[DesignImageResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class DesignReviewRequest(BaseModel):
    decision: str
    comment: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("decision")
    @classmethod
    def valid_decision(cls, v: str) -> str:
        normalized = v.strip().lower()
        if normalized not in {
            DesignStatus.APPROVED.value,
            DesignStatus.REJECTED.value,
        }:
            raise ValueError("Decision must be approved or rejected")
        return normalized


class VendorSummaryResponse(BaseModel):
    draft: int = 0
    submitted: int = 0
    approved: int = 0
    rejected: int = 0


# --- Vendor product catalog schemas ---
class ProductCreate(BaseModel):
    title: str = Field(min_length=2, max_length=150)
    description: str = Field(min_length=10, max_length=3000)
    product_type: str
    category: str
    garment_type: Optional[str] = Field(default=None, max_length=50)
    price: Decimal = Field(gt=0, le=1_000_000, decimal_places=2)
    unit: str = "piece"
    stock_quantity: Decimal = Field(gt=0, le=1_000_000, decimal_places=2)
    sizes: List[str] = Field(default_factory=list, max_length=20)
    colors: List[str] = Field(default_factory=list, max_length=20)

    @field_validator("product_type")
    @classmethod
    def valid_product_type(cls, v: str) -> str:
        normalized = v.strip().lower()
        if normalized not in {"ready_made", "fabric"}:
            raise ValueError("Product type must be ready_made or fabric")
        return normalized

    @field_validator("category")
    @classmethod
    def valid_product_category(cls, v: str) -> str:
        normalized = v.strip().lower()
        if normalized not in {"men", "women", "unisex", "kids"}:
            raise ValueError("Category must be men, women, unisex, or kids")
        return normalized

    @field_validator("unit")
    @classmethod
    def valid_product_unit(cls, v: str) -> str:
        normalized = v.strip().lower()
        if normalized not in {"piece", "metre"}:
            raise ValueError("Unit must be piece or metre")
        return normalized

    @field_validator("title", "description")
    @classmethod
    def normalize_product_text(cls, v: str) -> str:
        return v.strip()

    @field_validator("garment_type")
    @classmethod
    def normalize_optional_product_text(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() or None if v else None

    @field_validator("sizes", "colors")
    @classmethod
    def normalize_product_options(cls, values: List[str]) -> List[str]:
        normalized = []
        for value in values:
            item = value.strip()
            if item and item.lower() not in {existing.lower() for existing in normalized}:
                if len(item) > 50:
                    raise ValueError("Product options cannot exceed 50 characters")
                normalized.append(item)
        return normalized

    @model_validator(mode="after")
    def product_type_matches_unit(self):
        if self.product_type == "ready_made" and self.unit != "piece":
            raise ValueError("Ready-made clothing must be sold by piece")
        if self.product_type == "fabric" and self.unit != "metre":
            raise ValueError("Fabric must be sold by metre")
        return self


class ProductUpdate(ProductCreate):
    pass


class ProductImageResponse(DesignImageResponse):
    pass


class ProductResponse(BaseModel):
    id: int
    vendor_id: int
    vendor_name: str
    title: str
    description: str
    product_type: str
    category: str
    garment_type: Optional[str]
    price: float
    unit: str
    stock_quantity: float
    sizes: List[str] = Field(default_factory=list)
    colors: List[str] = Field(default_factory=list)
    status: str
    rejection_comment: Optional[str]
    image_url: Optional[str]
    images: List[ProductImageResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class ProductReviewRequest(DesignReviewRequest):
    pass


class NotificationResponse(BaseModel):
    id: int
    title: str
    message: str
    notification_type: str
    link: Optional[str] = None
    read_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class NotificationListResponse(BaseModel):
    items: List[NotificationResponse]
    unread_count: int


# --- Delivery Address Schemas ---
class DeliveryAddressCreate(BaseModel):
    recipient_name: str = Field(min_length=2, max_length=100)
    phone_number: str = Field(min_length=10, max_length=20)
    street_address: str = Field(min_length=5, max_length=500)
    city: str = Field(min_length=2, max_length=100)
    state: str = Field(min_length=2, max_length=100)
    postal_code: str = Field(pattern=r"^\d{6}$")
    country: Optional[str] = Field(default="India", max_length=100)
    is_default: Optional[bool] = False
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    location_token: Optional[str] = Field(default=None, min_length=20, max_length=4000)

    @field_validator("phone_number")
    @classmethod
    def normalize_address_phone(cls, v: str) -> str:
        return normalize_phone_number(v)

    @field_validator("recipient_name", "street_address", "city", "state")
    @classmethod
    def normalize_address_text(cls, v: str) -> str:
        return " ".join(v.split())

    @model_validator(mode="after")
    def coordinates_are_a_pair(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be provided together")
        return self


class DeliveryAddressUpdate(BaseModel):
    recipient_name: Optional[str] = Field(default=None, min_length=2, max_length=100)
    phone_number: Optional[str] = Field(default=None, min_length=10, max_length=20)
    street_address: Optional[str] = Field(default=None, min_length=5, max_length=500)
    city: Optional[str] = Field(default=None, min_length=2, max_length=100)
    state: Optional[str] = Field(default=None, min_length=2, max_length=100)
    postal_code: Optional[str] = Field(default=None, pattern=r"^\d{6}$")
    country: Optional[str] = Field(default=None, max_length=100)
    is_default: Optional[bool] = None
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    location_token: Optional[str] = Field(default=None, min_length=20, max_length=4000)

    @field_validator("phone_number")
    @classmethod
    def normalize_updated_address_phone(cls, v: Optional[str]) -> Optional[str]:
        return normalize_phone_number(v) if v else None

    @field_validator("recipient_name", "street_address", "city", "state")
    @classmethod
    def normalize_updated_address_text(cls, v: Optional[str]) -> Optional[str]:
        return " ".join(v.split()) if v else None

    @model_validator(mode="after")
    def coordinates_are_a_pair(self):
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be provided together")
        return self


class DeliveryAddressResponse(DeliveryAddressCreate):
    id: int
    user_id: int
    google_place_id: Optional[str] = None

    class Config:
        from_attributes = True


class BrowserLocationRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_meters: Optional[float] = Field(default=None, ge=0, le=100_000)


class ResolvedLocationResponse(BrowserLocationRequest):
    formatted_address: str
    place_id: str
    provider_name: str
    street_address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    country: Optional[str] = None
    location_token: str


# --- Order Schemas ---
class OrderItemCreate(BaseModel):
    design_id: int
    measurement_profile_id: int
    cloth_source: str
    fabric_choice: Optional[str] = None
    custom_instructions: Optional[str] = None
    delivery_quote_token: Optional[str] = Field(default=None, max_length=4000)

    @field_validator("cloth_source")
    @classmethod
    def valid_order_cloth_source(cls, v: str) -> str:
        normalized = v.strip().lower()
        if normalized not in {"vendor_supplied", "customer_provided"}:
            raise ValueError("Choose whether the vendor or customer supplies the cloth")
        return normalized


class OrderCreate(BaseModel):
    address_id: int
    items: List[OrderItemCreate]


class VendorInvoiceLineItemUpsert(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    description: Optional[str] = Field(default=None, max_length=500)
    quantity: Decimal = Field(default=Decimal("1"), gt=0, le=10_000, decimal_places=2)
    unit_price: Decimal = Field(ge=0, le=1_000_000, decimal_places=2)

    @field_validator("name")
    @classmethod
    def normalize_line_item_name(cls, v: str) -> str:
        normalized = v.strip()
        if len(normalized) < 2:
            raise ValueError("Line item name must contain at least 2 characters")
        return normalized

    @field_validator("description")
    @classmethod
    def normalize_line_item_description(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() or None if v else None


class VendorInvoiceUpsert(BaseModel):
    model_config = {"extra": "forbid"}

    expected_revision: Optional[int] = Field(default=None, ge=1)
    cloth_type: str = Field(min_length=2, max_length=150)
    cloth_requirement: str = Field(min_length=10, max_length=2000)
    cloth_cost: Decimal = Field(default=Decimal("0"), ge=0, le=1_000_000, decimal_places=2)
    line_items: List[VendorInvoiceLineItemUpsert] = Field(
        default_factory=list, max_length=25
    )

    @field_validator("cloth_type")
    @classmethod
    def normalize_cloth_type(cls, v: str) -> str:
        normalized = v.strip()
        if len(normalized) < 2:
            raise ValueError("Cloth type must contain at least 2 characters")
        return normalized

    @field_validator("cloth_requirement")
    @classmethod
    def normalize_cloth_requirement(cls, v: str) -> str:
        normalized = v.strip()
        if len(normalized) < 10:
            raise ValueError("Cloth requirement must contain at least 10 characters")
        return normalized

    @model_validator(mode="after")
    def reasonable_invoice_total(self):
        variable_total = self.cloth_cost + sum(
            (line.quantity * line.unit_price for line in self.line_items),
            Decimal("0"),
        )
        if variable_total > Decimal("5000000"):
            raise ValueError("Invoice additions cannot exceed ₹50,00,000")
        return self


class InvoiceDecision(BaseModel):
    decision: str
    comment: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("decision")
    @classmethod
    def valid_invoice_decision(cls, v: str) -> str:
        normalized = v.strip().lower()
        if normalized not in {"approved", "change_requested"}:
            raise ValueError("Decision must be approved or change_requested")
        return normalized


class OrderCancellationRequest(BaseModel):
    reason: str = Field(min_length=5, max_length=1000)

    @field_validator("reason")
    @classmethod
    def normalize_cancellation_reason(cls, v: str) -> str:
        normalized = " ".join(v.split())
        if len(normalized) < 5:
            raise ValueError("Provide a short reason")
        return normalized


class PaymentReferenceCreate(BaseModel):
    payment_reference: str = Field(min_length=3, max_length=150)

    @field_validator("payment_reference")
    @classmethod
    def normalize_payment_reference(cls, v: str) -> str:
        normalized = v.strip()
        if len(normalized) < 3:
            raise ValueError("Payment reference must contain at least 3 characters")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._:/-]{2,149}", normalized):
            raise ValueError("Payment reference contains unsupported characters")
        return normalized


class OrderCommentCreate(BaseModel):
    message: str = Field(min_length=1, max_length=2000)

    @field_validator("message")
    @classmethod
    def normalize_comment(cls, v: str) -> str:
        normalized = v.strip()
        if not normalized:
            raise ValueError("Comment cannot be empty")
        return normalized


class OrderCommentResponse(BaseModel):
    id: int
    author_id: int
    author_name: str
    author_role: str
    message: str
    created_at: datetime


class VendorInvoiceLineItemResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    quantity: float
    unit_price: float
    total_amount: float


class VendorInvoiceResponse(BaseModel):
    id: int
    invoice_number: str
    revision: int
    service_amount: float
    cloth_source: str
    cloth_type: str
    cloth_requirement: str
    cloth_cost: float
    delivery_cost: float
    line_items: List[VendorInvoiceLineItemResponse] = Field(default_factory=list)
    additional_amount: float
    total_amount: float
    status: str
    payment_status: str
    payment_reference: Optional[str]
    cloth_received: bool
    cloth_bill_filename: Optional[str]
    cloth_bill_content_type: Optional[str]
    cloth_bill_size_bytes: Optional[int]
    cloth_bill_url: Optional[str]
    issued_at: Optional[datetime]
    approved_at: Optional[datetime]
    paid_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class OrderItemResponse(BaseModel):
    id: int
    design: DesignResponse
    measurement_profile: MeasurementProfileResponse
    cloth_source: str
    fabric_choice: Optional[str]
    custom_instructions: Optional[str]
    measurement_snapshot: Optional[dict]
    price: float
    work_status: str
    invoice: Optional[VendorInvoiceResponse] = None
    comments: List[OrderCommentResponse] = Field(default_factory=list)

    class Config:
        from_attributes = True


class DeliveryQuoteRequest(BaseModel):
    design_id: Optional[int] = None
    product_id: Optional[int] = None
    address_id: int

    @model_validator(mode="after")
    def exactly_one_delivery_subject(self):
        if (self.design_id is None) == (self.product_id is None):
            raise ValueError("Choose exactly one design or product")
        return self


class DeliveryQuoteResponse(BaseModel):
    vendor_id: int
    vendor_name: str
    distance_meters: int
    duration_seconds: Optional[int]
    delivery_cost: float
    price_per_100m: float
    provider_name: str
    maps_provider: str
    quote_token: str
    expires_at: datetime


class DeliverySettingsUpdate(BaseModel):
    price_per_100m: Decimal = Field(gt=0, le=10_000, decimal_places=2)
    provider_name: str = Field(min_length=2, max_length=150)
    provider_email: EmailStr
    provider_phone: Optional[str] = Field(default=None, max_length=30)
    communication_details: Optional[str] = Field(default=None, max_length=2000)
    is_active: bool = True

    @field_validator("provider_name")
    @classmethod
    def normalize_provider_name(cls, v: str) -> str:
        return " ".join(v.split())

    @field_validator("provider_phone", "communication_details")
    @classmethod
    def normalize_optional_delivery_text(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() or None if v else None


class DeliverySettingsResponse(BaseModel):
    price_per_100m: float
    provider_name: str
    provider_email: str
    provider_phone: Optional[str]
    communication_details: Optional[str]
    is_active: bool
    maps_configured: bool
    maps_provider: str
    maps_configuration_message: str
    updated_at: Optional[datetime]


class DeliveryResponse(BaseModel):
    id: int
    order_id: Optional[int]
    product_order_id: Optional[int]
    order_type: str
    vendor_id: int
    vendor_name: str
    customer_name: str
    customer_phone: Optional[str]
    provider_name: str
    provider_email: str
    provider_phone: Optional[str]
    provider_details: Optional[str]
    maps_provider: str
    origin_address: str
    destination_address: str
    origin_latitude: float
    origin_longitude: float
    destination_latitude: float
    destination_longitude: float
    distance_meters: int
    duration_seconds: Optional[int]
    price_per_100m: float
    delivery_cost: float
    status: str
    tracking_number: Optional[str]
    tracking_url: Optional[str]
    external_reference: Optional[str]
    admin_notes: Optional[str]
    status_updated_at: datetime
    created_at: datetime
    updated_at: datetime


class OrderDeliveryResponse(BaseModel):
    id: int
    vendor_id: int
    provider_name: str
    maps_provider: str
    destination_address: str
    distance_meters: int
    duration_seconds: Optional[int]
    delivery_cost: float
    status: str
    tracking_number: Optional[str]
    tracking_url: Optional[str]


class ProductOrderCreate(BaseModel):
    product_id: int
    address_id: int
    quantity: Decimal = Field(gt=0, le=1000, decimal_places=2)
    selected_size: Optional[str] = Field(default=None, max_length=50)
    selected_color: Optional[str] = Field(default=None, max_length=50)
    delivery_quote_token: str = Field(min_length=20, max_length=4000)

    @field_validator("selected_size", "selected_color")
    @classmethod
    def normalize_selected_option(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() or None if v else None


class ProductOrderStatusUpdate(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def valid_product_order_status(cls, v: str) -> str:
        normalized = v.strip().lower()
        if normalized not in {"placed", "confirmed", "packed", "shipped", "delivered", "cancelled"}:
            raise ValueError("Invalid product order status")
        return normalized


class ProductOrderResponse(BaseModel):
    id: int
    product: ProductResponse
    customer: UserResponse
    delivery_address: DeliveryAddressResponse
    quantity: float
    selected_size: Optional[str]
    selected_color: Optional[str]
    unit_price: float
    merchandise_total: float
    total_amount: float
    status: str
    delivery: OrderDeliveryResponse
    created_at: datetime
    updated_at: datetime


class ProductOrderListResponse(BaseModel):
    items: List[ProductOrderResponse]
    total: int
    limit: int
    offset: int


class DeliveryListResponse(BaseModel):
    items: List[DeliveryResponse]
    total: int
    limit: int
    offset: int


class DeliveryTrackingUpdate(BaseModel):
    status: str
    tracking_number: Optional[str] = Field(default=None, max_length=150)
    tracking_url: Optional[str] = Field(default=None, max_length=1000)
    external_reference: Optional[str] = Field(default=None, max_length=150)
    admin_notes: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("status")
    @classmethod
    def valid_delivery_status(cls, v: str) -> str:
        normalized = v.strip().lower()
        allowed = {
            "quote_ready", "booked", "picked_up", "in_transit",
            "delivered", "cancelled",
        }
        if normalized not in allowed:
            raise ValueError("Invalid delivery status")
        return normalized

    @field_validator("tracking_number", "tracking_url", "external_reference", "admin_notes")
    @classmethod
    def normalize_optional_tracking_text(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() or None if v else None

    @field_validator("tracking_url")
    @classmethod
    def valid_tracking_url(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        parsed = urlparse(v)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("Tracking URL must start with http:// or https://")
        return v


class OrderResponse(BaseModel):
    id: int
    total_amount: float
    service_amount: float
    status: OrderStatus
    tracking_number: Optional[str]
    created_at: datetime
    customer: UserResponse
    delivery_address: DeliveryAddressResponse
    deliveries: List[OrderDeliveryResponse] = Field(default_factory=list)
    order_items: List[OrderItemResponse]

    class Config:
        from_attributes = True


class OrderListResponse(BaseModel):
    items: List[OrderResponse]
    total: int
    limit: int
    offset: int


class OrderStatusUpdate(BaseModel):
    status: OrderStatus
    tracking_number: Optional[str] = Field(default=None, max_length=100)
