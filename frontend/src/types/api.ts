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
  vendor_pickup_address: string | null
  vendor_pickup_latitude: number | null
  vendor_pickup_longitude: number | null
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
  is_custom_request_template: boolean
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

export type ProductType = "ready_made" | "fabric"
export type ProductUnit = "piece" | "metre"

export interface Product {
  id: number
  vendor_id: number
  vendor_name: string
  title: string
  description: string
  product_type: ProductType
  category: Design["category"]
  garment_type: string | null
  price: number
  unit: ProductUnit
  stock_quantity: number
  sizes: string[]
  colors: string[]
  status: DesignStatus
  rejection_comment: string | null
  image_url: string | null
  images: DesignImage[]
  created_at: string
  updated_at: string
}

export interface ProductInput {
  title: string
  description: string
  product_type: ProductType
  category: Design["category"]
  garment_type: string
  price: number
  unit: ProductUnit
  stock_quantity: number
  sizes: string[]
  colors: string[]
}

export interface VendorSummary {
  draft: number
  submitted: number
  approved: number
  rejected: number
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
  custom_design_id: number | null
  accepts_custom_orders: boolean
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
  latitude: number | null
  longitude: number | null
  google_place_id: string | null
}

export type DeliveryAddressInput = Omit<DeliveryAddress, "id" | "user_id" | "google_place_id" | "latitude" | "longitude"> & {
  latitude?: number | null
  longitude?: number | null
  location_token?: string | null
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

export type OrderStatus = "pending" | "confirmed" | "fabric_cutting" | "stitching" | "quality_check" | "shipped" | "delivered" | "cancelled"

export type WorkStatus = "awaiting_invoice" | "awaiting_approval" | "awaiting_cloth_payment" | "awaiting_payment_verification" | "awaiting_cloth" | "ready_to_start" | "fabric_cutting" | "stitching" | "quality_check" | "completed" | "rejected" | "cancelled"

export interface OrderComment {
  id: number
  author_id: number
  author_name: string
  author_role: UserProfile["role"]
  message: string
  created_at: string
}

export interface VendorInvoiceLineItem {
  id: number
  name: string
  description: string | null
  quantity: number
  unit_price: number
  total_amount: number
}

export interface VendorInvoice {
  id: number
  invoice_number: string
  revision: number
  service_amount: number
  merchandise_amount: number
  cloth_source: "vendor_supplied" | "customer_provided"
  cloth_type: string
  cloth_requirement: string
  cloth_cost: number
  delivery_cost: number
  line_items: VendorInvoiceLineItem[]
  additional_amount: number
  total_amount: number
  status: "draft" | "issued" | "approved" | "change_requested"
  payment_status: "not_required" | "pending" | "submitted" | "paid"
  payment_reference: string | null
  cloth_received: boolean
  cloth_bill_filename: string | null
  cloth_bill_content_type: string | null
  cloth_bill_size_bytes: number | null
  cloth_bill_url: string | null
  issued_at: string | null
  approved_at: string | null
  paid_at: string | null
  created_at: string
  updated_at: string
}

export interface OrderProductItem {
  id: number
  product: Product
  quantity: number
  selected_size: string | null
  selected_color: string | null
  unit_price: number
  merchandise_total: number
  status: string
}

export interface OrderItem {
  id: number
  design: Design
  measurement_profile: MeasurementProfile
  cloth_source: "vendor_supplied" | "customer_provided"
  fabric_choice: string | null
  custom_instructions: string | null
  measurement_snapshot: {
    profile_name?: string
    unit?: string
    measurements?: Record<string, number>
    notes?: string | null
  } | null
  price: number
  work_status: WorkStatus
  invoice: VendorInvoice | null
  comments: OrderComment[]
}

export interface Order {
  id: number
  combined_order: boolean
  total_amount: number
  service_amount: number
  status: OrderStatus
  tracking_number: string | null
  created_at: string
  customer: UserProfile
  delivery_address: DeliveryAddress
  deliveries: OrderDelivery[]
  order_items: OrderItem[]
  product_items: OrderProductItem[]
  invoice: VendorInvoice | null
}

export type DeliveryStatus = "quote_ready" | "booked" | "picked_up" | "in_transit" | "delivered" | "cancelled"

export interface DeliveryQuote {
  vendor_id: number
  vendor_name: string
  distance_meters: number
  duration_seconds: number | null
  delivery_cost: number
  price_per_100m: number
  provider_name: string
  maps_provider: string
  quote_token: string
  expires_at: string
}

export interface DeliverySettings {
  price_per_100m: number
  provider_name: string
  provider_email: string
  provider_phone: string | null
  communication_details: string | null
  is_active: boolean
  maps_configured: boolean
  maps_provider: string
  maps_configuration_message: string
  updated_at: string | null
}

export interface DeliveryRecord {
  id: number
  order_id: number | null
  product_order_id: number | null
  order_type: "tailoring" | "product"
  vendor_id: number
  vendor_name: string
  customer_name: string
  customer_phone: string | null
  provider_name: string
  provider_email: string
  provider_phone: string | null
  provider_details: string | null
  maps_provider: string
  origin_address: string
  destination_address: string
  origin_latitude: number
  origin_longitude: number
  destination_latitude: number
  destination_longitude: number
  distance_meters: number
  duration_seconds: number | null
  price_per_100m: number
  delivery_cost: number
  status: DeliveryStatus
  tracking_number: string | null
  tracking_url: string | null
  external_reference: string | null
  admin_notes: string | null
  status_updated_at: string
  created_at: string
  updated_at: string
}

export interface OrderDelivery {
  id: number
  vendor_id: number
  provider_name: string
  maps_provider: string
  destination_address: string
  distance_meters: number
  duration_seconds: number | null
  delivery_cost: number
  status: DeliveryStatus
  tracking_number: string | null
  tracking_url: string | null
}

export interface DeliveryPage {
  items: DeliveryRecord[]
  total: number
  limit: number
  offset: number
}

export interface OrderPage {
  items: Order[]
  total: number
  limit: number
  offset: number
}

export type ProductOrderStatus = "placed" | "confirmed" | "packed" | "shipped" | "delivered" | "cancelled"

export interface ProductOrder {
  id: number
  product: Product
  customer: UserProfile
  delivery_address: DeliveryAddress
  quantity: number
  selected_size: string | null
  selected_color: string | null
  unit_price: number
  merchandise_total: number
  total_amount: number
  status: ProductOrderStatus
  delivery: OrderDelivery
  created_at: string
  updated_at: string
}

export interface ProductOrderPage {
  items: ProductOrder[]
  total: number
  limit: number
  offset: number
}
