export const customerStatuses = {
  invited: "Invited",
  pending_acceptance: "Pending acceptance",
  active: "Active",
  declined: "Declined",
}

export interface VendorCustomer {
  id: number
  full_name: string
  email: string
  phone: string | null
  account_role: string
  status: keyof typeof customerStatuses
  vendor_notes: string | null
  invited_at: string | null
  accepted_at: string | null
  declined_at: string | null
  created_at: string
  updated_at: string
}

export interface CustomerPage {
  items: VendorCustomer[]
  total: number
  limit: number
  offset: number
}
