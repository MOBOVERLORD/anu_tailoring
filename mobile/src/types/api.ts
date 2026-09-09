export type UserRole = "customer" | "vendor" | "admin" | "super_admin" | "delivery_agent"

export interface UserProfile {
  id: number
  full_name: string
  email: string
  phone: string | null
  location: string | null
  profile_image_url: string | null
  shop_name: string | null
  shop_description: string | null
  vendor_logo_url: string | null
  vendor_request_status: "pending" | "approved" | "rejected" | null
  vendor_request_shop_name: string | null
  vendor_request_message: string | null
  vendor_request_review_comment: string | null
  role: UserRole
  is_active: boolean
}

export interface DeliveryAddress {
  id: number
  recipient_name: string
  phone_number: string
  street_address: string
  city: string
  state: string
  postal_code: string
  country: string
  is_default: boolean
  latitude: number | null
  longitude: number | null
}

export interface ResolvedLocation {
  latitude: number
  longitude: number
  accuracy_meters: number | null
  formatted_address: string
  place_id: string
  provider_name: string
  street_address: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string | null
  location_token: string
}

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
}

export interface MeasurementProfile {
  id: number
  profile_name: string
  gender: "women" | "men" | "unisex" | "kids"
  garment_type: string
  standard_size: string | null
  unit: "inches" | "cm"
  measurements: Record<string, number>
  notes: string | null
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

export interface DesignImage {
  id: number
  url: string | null
  thumbnail_url: string | null
  sort_order: number
}

export interface Design {
  id: number
  title: string
  description: string
  category: "men" | "women" | "unisex" | "kids"
  garment_type: string
  base_price: number
  vendor_id: number | null
  vendor_name: string | null
  status: "draft" | "submitted" | "approved" | "rejected"
  image_url: string | null
  thumbnail_url: string | null
  images: DesignImage[]
  is_custom_request_template?: boolean
}

export interface Product {
  id: number
  vendor_id: number
  vendor_name: string
  title: string
  description: string
  product_type: "ready_made" | "fabric"
  price: number
  unit: "piece" | "metre"
  stock_quantity: number
  category: "men" | "women" | "unisex" | "kids"
  garment_type: string | null
  sizes: string[]
  colors: string[]
  status: "draft" | "submitted" | "approved" | "rejected"
  image_url: string | null
  thumbnail_url: string | null
  images: DesignImage[]
}

export interface VendorDirectoryItem {
  id: number
  full_name: string
  shop_name: string
  shop_description: string | null
  location: string | null
  profile_image_url: string | null
  logo_url: string | null
  is_favorite: boolean
  accepts_custom_orders: boolean
  custom_design_id: number | null
}

export interface InvoiceSummary {
  id: number
  invoice_number: string
  total_amount: number
  cloth_cost: number
  payment_status: "not_required" | "pending" | "submitted" | "paid"
  final_payment_status: "pending" | "paid"
  status: "draft" | "issued" | "approved" | "change_requested"
  revision: number
  service_amount: number
  merchandise_amount: number
  cloth_source: "customer_provided" | "vendor_supplied"
  cloth_type: string
  cloth_requirement: string
  delivery_cost: number
  line_items: InvoiceLineItem[]
  additional_amount: number
  cloth_received: boolean
  cloth_bill_url: string | null
}

export interface InvoiceLineItem {
  id: number
  name: string
  description: string | null
  quantity: number
  unit_price: number
  total_amount: number
}

export interface OrderComment {
  id: number
  author_id: number
  author_name: string
  author_role: UserRole
  message: string
  created_at: string
}

export interface OrderItem {
  id: number
  work_status: string
  design: Design
  invoice?: InvoiceSummary | null
  cloth_source: "customer_provided" | "vendor_supplied"
  colour_preference?: string | null
  design_references?: { design_id?: number; title?: string; photo_id?: string; url?: string }[]
  fabric_choice: string | null
  custom_instructions: string | null
  measurement_snapshot: { unit?: string; measurements?: Record<string, number> } | null
  price: number
  comments: OrderComment[]
}

export interface Order {
  id: number
  combined_order: boolean
  total_amount: number
  service_amount: number
  status: string
  tracking_number: string | null
  created_at: string
  order_items: OrderItem[]
  product_items: unknown[]
  invoice: InvoiceSummary | null
  customer: Pick<UserProfile, "id" | "full_name" | "email" | "phone">
  delivery_address: DeliveryAddress
  deliveries: Array<{ id: number; fulfilment_method: string; status: string; tracking_number: string | null }>
}

export interface PaginatedOrders {
  items: Order[]
  total: number
  limit: number
  offset: number
}

export interface VendorSummary {
  draft: number
  submitted: number
  approved: number
  rejected: number
}

export interface DeliveryJob {
  id: number
  order_id: number | null
  vendor_name: string
  customer_name: string
  customer_phone: string | null
  origin_address: string
  destination_address: string
  origin_latitude: number
  origin_longitude: number
  destination_latitude: number
  destination_longitude: number
  status: string
  tracking_number: string | null
  delivery_cost: number
}

export interface PaginatedDeliveries {
  items: DeliveryJob[]
  total: number
  limit: number
  offset: number
}

export type VendorCustomerStatus = "invited" | "pending_acceptance" | "active" | "declined"

export interface VendorCustomerRelationship {
  id: number
  vendor_id: number
  customer_user_id: number
  full_name: string
  email: string
  phone: string | null
  account_role: UserRole
  status: VendorCustomerStatus
  vendor_notes: string | null
  invited_at: string | null
  accepted_at: string | null
  declined_at: string | null
  created_at: string
  updated_at: string
}

export interface VendorCustomerRelationshipPage {
  items: VendorCustomerRelationship[]
  total: number
  limit: number
  offset: number
}

export interface MobileToken {
  access_token: string
  refresh_token: string
  access_expires_in: number
  refresh_expires_in: number | null
}
