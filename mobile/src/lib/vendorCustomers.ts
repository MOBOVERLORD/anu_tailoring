import type { VendorCustomerStatus } from "@/types/api"

export const customerStatusLabel = (status: VendorCustomerStatus) => ({
  active: "Active",
  declined: "Declined",
  invited: "Invited",
  pending_acceptance: "Awaiting approval",
})[status]

export const customerStatusDescription = (status: VendorCustomerStatus) => ({
  active: "This customer accepted the relationship.",
  declined: "This customer declined the relationship request.",
  invited: "A secure account setup invitation was sent to this customer.",
  pending_acceptance: "The existing account must accept this vendor relationship.",
})[status]

export const customerStatusTone = (status: VendorCustomerStatus): "default" | "primary" | "success" => {
  if (status === "active") return "success"
  if (status === "invited") return "primary"
  return "default"
}

export const customerActivityDate = (value: string) => new Date(value).toLocaleDateString("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
})
