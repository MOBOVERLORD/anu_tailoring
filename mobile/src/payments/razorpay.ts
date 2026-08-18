import RazorpayCheckout from "react-native-razorpay"
import { api } from "@/lib/api"

export type PaymentScope = "combined_order" | "order_item" | "combined_order_final" | "order_item_final"

interface CheckoutSession {
  key_id: string
  order_id: string
  amount: number
  currency: string
  name: string
  description: string
  prefill_name: string
  prefill_email: string
  prefill_contact: string | null
}

interface CheckoutResult {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

export async function openRazorpayCheckout(scope: PaymentScope, resourceId: number) {
  const session = await api<CheckoutSession>("/api/payments/razorpay/create-order", {
    method: "POST",
    body: JSON.stringify({ scope, resource_id: resourceId }),
  })
  const result = await RazorpayCheckout.open({
    key: session.key_id,
    amount: session.amount,
    currency: session.currency,
    name: session.name,
    description: session.description,
    order_id: session.order_id,
    prefill: {
      name: session.prefill_name,
      email: session.prefill_email,
      contact: session.prefill_contact || undefined,
    },
    theme: { color: "#B84F2E" },
    retry: { enabled: true, max_count: 3 },
  }) as CheckoutResult
  return api<{ success: boolean; message: string }>("/api/payments/razorpay/verify-payment", {
    method: "POST",
    body: JSON.stringify({
      scope,
      resource_id: resourceId,
      razorpay_payment_id: result.razorpay_payment_id,
      razorpay_order_id: result.razorpay_order_id,
      razorpay_signature: result.razorpay_signature,
    }),
  })
}
