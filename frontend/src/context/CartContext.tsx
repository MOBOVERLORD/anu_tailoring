import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { getAccessToken, onAuthChange } from "@/lib/api"
import type { Design, Product } from "@/types/api"

export interface CartDesignLine {
  key: string
  kind: "design"
  vendor_id: number
  vendor_name: string
  design: Design
  measurement_profile_id: number
  measurement_name: string
  cloth_source: "customer_provided" | "vendor_supplied"
  fabric_choice: string | null
  custom_instructions: string | null
}

export interface CartProductLine {
  key: string
  kind: "product"
  vendor_id: number
  vendor_name: string
  product: Product
  quantity: number
  selected_size: string | null
  selected_color: string | null
}

export type CartLine = CartDesignLine | CartProductLine

interface CartValue {
  lines: CartLine[]
  vendorId: number | null
  vendorName: string | null
  addDesign: (line: Omit<CartDesignLine, "key" | "kind">) => void
  addProduct: (line: Omit<CartProductLine, "key" | "kind">) => void
  updateProductQuantity: (key: string, quantity: number) => void
  removeLine: (key: string) => void
  clear: () => void
}

const STORAGE_KEY = "vastrivo-vendor-cart-v1"
const CartContext = createContext<CartValue | null>(null)

const readCart = (): CartLine[] => {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const CartProvider = ({ children }: { children: React.ReactNode }) => {
  const [lines, setLines] = useState<CartLine[]>(readCart)

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
  }, [lines])

  useEffect(() => onAuthChange(() => {
    if (!getAccessToken()) setLines([])
  }), [])

  const ensureVendor = (vendorId: number) => {
    const currentVendor = lines[0]?.vendor_id
    if (currentVendor && currentVendor !== vendorId) {
      throw new Error("Your cart contains items from another vendor. Checkout or clear it before shopping from a different vendor.")
    }
  }

  const value = useMemo<CartValue>(() => ({
    lines,
    vendorId: lines[0]?.vendor_id ?? null,
    vendorName: lines[0]?.vendor_name ?? null,
    addDesign: (line) => {
      ensureVendor(line.vendor_id)
      setLines((current) => [...current, { ...line, key: crypto.randomUUID(), kind: "design" }])
    },
    addProduct: (line) => {
      ensureVendor(line.vendor_id)
      setLines((current) => {
        const existing = current.find((item): item is CartProductLine => item.kind === "product" && item.product.id === line.product.id && item.selected_size === line.selected_size && item.selected_color === line.selected_color)
        if (!existing) return [...current, { ...line, key: crypto.randomUUID(), kind: "product" }]
        return current.map((item) => item.key === existing.key ? { ...existing, quantity: Math.min(existing.product.stock_quantity, existing.quantity + line.quantity) } : item)
      })
    },
    updateProductQuantity: (key, quantity) => setLines((current) => current.map((line) => line.key === key && line.kind === "product" ? { ...line, quantity: Math.max(0.01, Math.min(line.product.stock_quantity, quantity)) } : line)),
    removeLine: (key) => setLines((current) => current.filter((line) => line.key !== key)),
    clear: () => setLines([]),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [lines])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export const useCart = () => {
  const value = useContext(CartContext)
  if (!value) throw new Error("useCart must be used inside CartProvider")
  return value
}
