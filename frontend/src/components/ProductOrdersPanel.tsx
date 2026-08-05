import { useCallback, useEffect, useState } from "react"
import { LoaderCircle, MapPin, Package, ShoppingBag, Truck, UserRound } from "lucide-react"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { AppSelect } from "@/components/ui/AppSelect"
import { api } from "@/lib/api"
import type { ProductOrder, ProductOrderPage, ProductOrderStatus, UserProfile } from "@/types/api"

const labels: Record<ProductOrderStatus, string> = { placed: "Placed", confirmed: "Confirmed", packed: "Packed", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled" }
const nextStatuses: Record<ProductOrderStatus, ProductOrderStatus[]> = { placed: ["confirmed", "cancelled"], confirmed: ["packed", "cancelled"], packed: ["shipped", "cancelled"], shipped: ["delivered"], delivered: [], cancelled: [] }

const endpoint = (role: UserProfile["role"], mode: "purchases" | "sales") => role === "customer" || (role === "vendor" && mode === "purchases") ? "/api/product-orders" : role === "vendor" ? "/api/product-orders/vendor" : "/api/admin/product-orders"

export type CustomerOrderView = "in_progress" | "completed" | "closed"

export const ProductOrdersPanel = ({ profile, customerView = "in_progress", mode = "purchases" }: { profile: UserProfile; customerView?: CustomerOrderView; mode?: "purchases" | "sales" }) => {
  const [orders, setOrders] = useState<ProductOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const load = useCallback(async () => {
    try { setOrders((await api<ProductOrderPage>(`${endpoint(profile.role, mode)}?limit=100&offset=0`)).items) }
    catch (error) { toast.error((error as Error).message) }
    finally { setLoading(false) }
  }, [mode, profile.role])
  useEffect(() => { void load() }, [load])

  const update = async (order: ProductOrder, status: ProductOrderStatus) => {
    setBusyId(order.id)
    try {
      const updated = await api<ProductOrder>(`/api/product-orders/${order.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) })
      setOrders((current) => current.map((item) => item.id === updated.id ? updated : item))
      toast.success(`Shop order #${order.id} is now ${labels[status].toLowerCase()}`)
    } catch (error) { toast.error((error as Error).message) }
    finally { setBusyId(null) }
  }

  if (loading) return <section className="product-orders-section"><div className="loading-state"><LoaderCircle className="spin" /> Loading shop orders…</div></section>
  const isBuyer = profile.role === "customer" || (profile.role === "vendor" && mode === "purchases")
  const visibleOrders = isBuyer ? orders.filter((order) => customerView === "completed" ? order.status === "delivered" : customerView === "closed" ? order.status === "cancelled" : !["delivered", "cancelled"].includes(order.status)) : orders
  if (!visibleOrders.length) return null

  return (
    <section className="product-orders-section">
      <div className="section-heading">
        <div><p className="eyebrow"><ShoppingBag size={15} /> {isBuyer ? "Shop purchases" : "Product sales"}</p><h2>{isBuyer ? "Clothing and fabric purchases" : "Products ordered from your shop"}</h2></div>
        <span className="queue-count">{visibleOrders.length}</span>
      </div>
      <div className="product-order-list">
        {visibleOrders.map((order) => (
          <article className="product-order-card" key={order.id}>
            <div className="product-order-image">{order.product.image_url ? <ApiImage alt={order.product.title} src={order.product.image_url} /> : <Package size={26} />}</div>
            <div className="product-order-main">
              <div className="product-order-title"><div><small>Shop order #{order.id}</small><h3>{order.product.title}</h3></div><span className={`order-status status-${order.status}`}>{labels[order.status]}</span></div>
              <div className="product-order-meta"><span>{order.quantity} {order.product.unit}</span>{order.selected_size && <span>Size {order.selected_size}</span>}{order.selected_color && <span>{order.selected_color}</span>}{!isBuyer && <span><UserRound size={14} /> {order.customer.full_name}</span>}</div>
              <div className="product-order-route"><span><MapPin size={14} /> {order.delivery_address.city}, {order.delivery_address.state}</span><span><Truck size={14} /> {(order.delivery.distance_meters / 1000).toFixed(1)} km · {order.delivery.provider_name}</span></div>
            </div>
            <div className="product-order-total">
              <small>Product + delivery</small>
              <strong>₹{order.total_amount.toLocaleString("en-IN")}</strong>
              {isBuyer && order.status === "placed" ? (
                <button className="button button-secondary danger-text" disabled={busyId === order.id} onClick={() => void update(order, "cancelled")} type="button">Cancel order</button>
              ) : !isBuyer && nextStatuses[order.status].length > 0 ? (
                <AppSelect ariaLabel={`Update shop order ${order.id}`} disabled={busyId === order.id} onValueChange={(value) => void update(order, value as ProductOrderStatus)} options={nextStatuses[order.status].map((status) => ({ value: status, label: labels[status] }))} placeholder="Update status…" value="" />
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
