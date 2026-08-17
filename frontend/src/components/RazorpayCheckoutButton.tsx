import { useState } from "react"
import { CircleDollarSign, CreditCard, LoaderCircle, QrCode } from "lucide-react"
import toast from "react-hot-toast"
import { api } from "@/lib/api"

type PaymentScope = "combined_order" | "order_item" | "combined_order_final" | "order_item_final"

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

interface CheckoutSuccess {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

interface CheckoutFailure {
  error?: { description?: string; reason?: string }
}

interface RazorpayOptions {
  key: string
  amount: number
  currency: string
  name: string
  description: string
  order_id: string
  prefill: { name: string; email: string; contact?: string }
  theme: { color: string }
  config?: {
    display: {
      blocks: Record<string, {
        name: string
        instruments: Array<{ method: string }>
      }>
      sequence: string[]
      preferences: { show_default_blocks: boolean }
    }
  }
  modal: { confirm_close: boolean; ondismiss: () => void }
  handler: (response: CheckoutSuccess) => void
}

interface RazorpayInstance {
  open: () => void
  on: (event: "payment.failed", handler: (response: CheckoutFailure) => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance
  }
}

let checkoutScript: Promise<void> | null = null
type CheckoutMode = "upi" | "all"

const loadCheckout = () => {
  if (window.Razorpay) return Promise.resolve()
  if (checkoutScript) return checkoutScript
  checkoutScript = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://checkout.razorpay.com/v1/checkout.js"]')
    const script = existing || document.createElement("script")
    const loaded = () => window.Razorpay ? resolve() : reject(new Error("Razorpay Checkout did not load"))
    script.addEventListener("load", loaded, { once: true })
    script.addEventListener("error", () => reject(new Error("Could not load secure checkout")), { once: true })
    if (!existing) {
      script.src = "https://checkout.razorpay.com/v1/checkout.js"
      script.async = true
      document.head.appendChild(script)
    }
  }).catch((error) => {
    checkoutScript = null
    throw error
  })
  return checkoutScript
}

export const RazorpayCheckoutButton = ({
  amount,
  onVerified,
  resourceId,
  scope,
}: {
  amount: number
  onVerified: () => Promise<void>
  resourceId: number
  scope: PaymentScope
}) => {
  const [busy, setBusy] = useState<CheckoutMode | null>(null)

  const startCheckout = async (mode: CheckoutMode) => {
    setBusy(mode)
    let checkoutFinished = false
    try {
      const [session] = await Promise.all([
        api<CheckoutSession>("/api/payments/razorpay/create-order", {
          method: "POST",
          body: JSON.stringify({ scope, resource_id: resourceId }),
        }),
        loadCheckout(),
      ])
      if (!window.Razorpay) throw new Error("Secure checkout is unavailable")

      const checkout = new window.Razorpay({
        key: session.key_id,
        amount: session.amount,
        currency: session.currency,
        name: session.name,
        description: session.description,
        order_id: session.order_id,
        prefill: {
          name: session.prefill_name,
          email: session.prefill_email,
          ...(session.prefill_contact ? { contact: session.prefill_contact } : {}),
        },
        theme: { color: "#df7b53" },
        ...(mode === "upi" ? {
          config: {
            display: {
              blocks: {
                upi_only: {
                  name: "Pay via UPI or QR",
                  instruments: [{ method: "upi" }],
                },
              },
              sequence: ["block.upi_only"],
              preferences: { show_default_blocks: false },
            },
          },
        } : {}),
        modal: {
          confirm_close: true,
          ondismiss: () => {
            setBusy(null)
            if (!checkoutFinished) toast("Payment cancelled. No charge was recorded.")
          },
        },
        handler: (response) => {
          void (async () => {
            try {
              await api("/api/payments/razorpay/verify-payment", {
                method: "POST",
                body: JSON.stringify({
                  scope,
                  resource_id: resourceId,
                  ...response,
                }),
              })
              checkoutFinished = true
              await onVerified()
              toast.success("Payment verified successfully")
            } catch (error) {
              toast.error((error as Error).message)
            } finally {
              setBusy(null)
            }
          })()
        },
      })
      checkout.on("payment.failed", (response) => {
        checkoutFinished = true
        setBusy(null)
        toast.error(response.error?.description || response.error?.reason || "Payment failed. Please try again.")
      })
      checkout.open()
    } catch (error) {
      setBusy(null)
      toast.error((error as Error).message)
    }
  }

  return (
    <div className="razorpay-checkout-actions">
      <button className="button razorpay-checkout-button" disabled={Boolean(busy)} onClick={() => void startCheckout("upi")} type="button">
        {busy === "upi" ? <LoaderCircle className="spin" size={17} /> : <QrCode size={17} />}
        {busy === "upi" ? "Opening UPI…" : `UPI / QR · ₹${amount.toLocaleString("en-IN")}`}
      </button>
      <button className="button button-secondary razorpay-other-methods" disabled={Boolean(busy)} onClick={() => void startCheckout("all")} type="button">
        {busy === "all" ? <LoaderCircle className="spin" size={17} /> : <CreditCard size={17} />}
        {busy === "all" ? "Opening checkout…" : "Cards & more"}
      </button>
      <small><CircleDollarSign size={12} /> Secure checkout powered by Razorpay</small>
    </div>
  )
}
