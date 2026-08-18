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

export interface DesignImage {
  id: number
  url: string | null
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
  images: DesignImage[]
}

export interface Product {
  id: number
  vendor_id: number
  vendor_name: string
  title: string
  description: string
  price: number
  unit: "piece" | "metre"
  stock_quantity: number
  category: "men" | "women" | "unisex" | "kids"
  garment_type: string | null
  sizes: string[]
  colors: string[]
  status: "draft" | "submitted" | "approved" | "rejected"
  image_url: string | null
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
}

export interface InvoiceSummary {
  id: number
  invoice_number: string
  total_amount: number
  cloth_cost: number
  payment_status: "not_required" | "pending" | "submitted" | "paid"
  final_payment_status: "pending" | "paid"
  status: "draft" | "issued" | "approved" | "change_requested"
}

export interface OrderItem {
  id: number
  work_status: string
  design: Design
  invoice?: InvoiceSummary | null
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

export interface MobileToken {
  access_token: string
  refresh_token: string
  access_expires_in: number
  refresh_expires_in: number
}
