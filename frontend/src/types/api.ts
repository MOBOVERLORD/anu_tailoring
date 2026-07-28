export interface UserProfile {
  id: number
  full_name: string
  email: string
  phone: string | null
  location: string | null
  created_at: string
}

export interface Design {
  id: number
  title: string
  description: string
  category: "men" | "women"
  garment_type: string
  base_price: number
  image_url: string
}

export interface MeasurementProfile {
  id: number
  user_id: number
  profile_name: string
  gender: "men" | "women"
  garment_type: string
  unit: "inches" | "cm"
  measurements: Record<string, number>
  notes: string | null
}

export type MeasurementProfileInput = Omit<MeasurementProfile, "id" | "user_id">

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
