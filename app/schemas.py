from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime
from app.models import OrderStatus

# Auth Schemas
class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    phone: Optional[str] = None

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
    token_type: str = "bearer"

# Measurement Profile Schemas
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

class MeasurementProfileResponse(MeasurementProfileCreate):
    id: int
    user_id: int
    class Config:
        from_attributes = True

# Design Schemas
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

# Order Schemas
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