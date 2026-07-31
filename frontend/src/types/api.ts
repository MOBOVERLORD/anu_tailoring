export interface UserProfile {
  id: number
  full_name: string
  email: string
  phone: string | null
  location: string | null
  role: "customer" | "vendor" | "admin" | "super_admin"
  is_active: boolean
  created_at: string
}

export type DesignStatus = "draft" | "submitted" | "approved" | "rejected"

export interface DesignImage {
  id: number
  original_filename: string
  content_type: string
  size_bytes: number | null
  sort_order: number
  upload_status: "uploading" | "ready"
  url: string | null
}

export interface Design {
  id: number
  title: string
  description: string
  category: "men" | "women" | "unisex" | "kids"
  garment_type: string
  base_price: number
  image_url: string | null
  vendor_id: number | null
  vendor_name: string | null
  status: DesignStatus
  rejection_comment: string | null
  images: DesignImage[]
  created_at: string
  updated_at: string | null
}

export interface DesignInput {
  title: string
  description: string
  category: Design["category"]
  garment_type: string
  base_price: number
}

export interface VendorSummary {
  draft: number
  submitted: number
  approved: number
  rejected: number
}

export interface AppNotification {
  id: number
  title: string
  message: string
  notification_type: string
  link: string | null
  read_at: string | null
  created_at: string
}

export interface NotificationList {
  items: AppNotification[]
  unread_count: number
}

export interface MeasurementProfile {
  id: number
  user_id: number
  profile_name: string
  gender: "men" | "women" | "unisex" | "kids"
  garment_type: string
  standard_size: string | null
  unit: "inches" | "cm"
  measurements: Record<string, number>
  notes: string | null
}

export type MeasurementProfileInput = Omit<MeasurementProfile, "id" | "user_id">

export interface MeasurementFieldDefinition {
  key: string
  label: string
}

export interface MeasurementCategory {
  id: number
  name: string
  garment_type: string
  gender: "women" | "men" | "unisex" | "kids"
  measurement_fields: MeasurementFieldDefinition[]
  standard_sizes: Record<string, Record<string, number>>
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface DeliveryAddress {
  id: number
  user_id: number
  recipient_name: string
  phone_number: string
  street_address: string
  city: string
  state: string
  postal_code: string
  country: string
  is_default: boolean
}

export type DeliveryAddressInput = Omit<DeliveryAddress, "id" | "user_id">

export type OrderStatus = "pending" | "confirmed" | "fabric_cutting" | "stitching" | "quality_check" | "shipped" | "delivered" | "cancelled"

export interface OrderItem {
  id: number
  design: Design
  measurement_profile: MeasurementProfile
  fabric_choice: string | null
  custom_instructions: string | null
  measurement_snapshot: {
    profile_name?: string
    unit?: string
    measurements?: Record<string, number>
    notes?: string | null
  } | null
  price: number
}

export interface Order {
  id: number
  total_amount: number
  status: OrderStatus
  tracking_number: string | null
  created_at: string
  customer: UserProfile
  delivery_address: DeliveryAddress
  order_items: OrderItem[]
}
