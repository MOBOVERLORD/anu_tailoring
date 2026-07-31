import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarDays, LoaderCircle, MapPin, Package, PackageCheck, Search, Truck, UserRound } from "lucide-react"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { api } from "@/lib/api"
import type { Order, OrderStatus, UserProfile } from "@/types/api"

const statusLabels: Record<OrderStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  fabric_cutting: "Fabric cutting",
  stitching: "Stitching",
  quality_check: "Quality check",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
}

const statusOptions = Object.keys(statusLabels) as OrderStatus[]

const Orders = () => {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all")
  const [drafts, setDrafts] = useState<Record<number, { status: OrderStatus; tracking: string }>>({})
  const [busyId, setBusyId] = useState<number | null>(null)

  const loadOrders = useCallback(async () => {
    try {
      const me = await api<UserProfile>("/api/auth/me")
      const endpoint = me.role === "vendor" ? "/api/orders/vendor" : me.role === "customer" ? "/api/orders" : "/api/admin/orders"
      const result = await api<Order[]>(endpoint)
      setProfile(me)
      setOrders(result)
      setDrafts(Object.fromEntries(result.map((order) => [order.id, { status: order.status, tracking: order.tracking_number || "" }])))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadOrders() }, [loadOrders])

  const visibleOrders = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    return orders.filter((order) => {
      const matchesStatus = statusFilter === "all" || order.status === statusFilter
      const haystack = [
        String(order.id),
        order.customer.full_name,
        order.customer.email,
        order.tracking_number || "",
        ...order.order_items.flatMap((item) => [item.design.title, item.design.vendor_name || ""]),
      ].join(" ").toLowerCase()
      return matchesStatus && (!normalized || haystack.includes(normalized))
    })
  }, [orders, search, statusFilter])

  const updateStatus = async (order: Order) => {
    const draft = drafts[order.id]
    if (!draft) return
    setBusyId(order.id)
    try {
      const updated = await api<Order>(`/api/admin/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: draft.status, tracking_number: draft.tracking || null }),
      })
      setOrders((current) => current.map((item) => item.id === updated.id ? updated : item))
      toast.success(`Order #${order.id} updated`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin"
  const heading = profile?.role === "vendor" ? "Orders for your designs" : isAdmin ? "Marketplace orders" : "Your orders"
  const description = profile?.role === "vendor"
    ? "Track customer requests that include designs from your collection."
    : isAdmin ? "Monitor every order and keep fulfilment statuses up to date." : "Follow each garment from confirmation through delivery."

  return (
    <div className="page orders-page">
      <section className="workspace-heading orders-heading">
        <div><p className="eyebrow"><PackageCheck size={15} /> Order centre</p><h1>{heading}</h1><p>{description}</p></div>
        {!loading && <span className="queue-count">{orders.length} total</span>}
      </section>

      {!loading && orders.length > 0 && (
        <section className="orders-toolbar" aria-label="Filter orders">
          <label className="search-field"><Search size={17} /><span className="sr-only">Search orders</span><input onChange={(event) => setSearch(event.target.value)} placeholder="Order, customer, design or tracking…" value={search} /></label>
          <select className="select-control" aria-label="Filter by order status" onChange={(event) => setStatusFilter(event.target.value as "all" | OrderStatus)} value={statusFilter}>
            <option value="all">All statuses</option>{statusOptions.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
          </select>
          <span>{visibleOrders.length} shown</span>
        </section>
      )}

      {loading ? (
        <div className="loading-state"><LoaderCircle className="spin" /> Loading orders…</div>
      ) : orders.length === 0 ? (
        <section className="empty-state"><Package size={48} strokeWidth={1.4} /><p className="eyebrow">Nothing here yet</p><h2>No orders to show</h2><p>{profile?.role === "customer" ? "Open a published design and choose Order design to place your first order." : "New customer orders will appear here automatically."}</p></section>
      ) : visibleOrders.length === 0 ? (
        <section className="empty-state"><Search size={38} /><h2>No matching orders</h2><p>Try a different search or status filter.</p></section>
      ) : (
        <section className="order-list">
          {visibleOrders.map((order) => (
            <article className="order-card" key={order.id}>
              <header className="order-card-head">
                <div><span className="order-number">Order #{order.id}</span><span className={`order-status status-${order.status}`}>{statusLabels[order.status]}</span></div>
                <strong>₹{order.total_amount.toLocaleString("en-IN")}</strong>
              </header>
              <div className="order-context">
                <span><CalendarDays size={15} /> {new Date(order.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                {(profile?.role === "vendor" || isAdmin) && <span><UserRound size={15} /> {order.customer.full_name} · {order.customer.phone || order.customer.email}</span>}
                <span><MapPin size={15} /> {order.delivery_address.city}, {order.delivery_address.state}</span>
                {order.tracking_number && <span><Truck size={15} /> {order.tracking_number}</span>}
              </div>

              <div className="order-items">
                {order.order_items.map((item) => (
                  <div className="order-item" key={item.id}>
                    <div className="order-item-image">{item.design.image_url ? <ApiImage alt={item.design.title} src={item.design.image_url} /> : <Package size={24} />}</div>
                    <div className="order-item-copy">
                      <strong>{item.design.title}</strong>
                      <small>{item.design.vendor_name ? `By ${item.design.vendor_name} · ` : ""}{item.measurement_profile.profile_name}{item.fabric_choice ? ` · ${item.fabric_choice}` : ""}</small>
                      {item.custom_instructions && <p>“{item.custom_instructions}”</p>}
                    </div>
                    <b>₹{item.price.toLocaleString("en-IN")}</b>
                  </div>
                ))}
              </div>

              {(profile?.role === "vendor" || isAdmin) && (
                <div className="delivery-detail"><strong>Delivery</strong><address>{order.delivery_address.recipient_name}, {order.delivery_address.street_address}, {order.delivery_address.city}, {order.delivery_address.state} {order.delivery_address.postal_code}</address></div>
              )}

              {isAdmin && drafts[order.id] && (
                <div className="order-admin-actions">
                  <div className="field"><label htmlFor={`status-${order.id}`}>Order status</label><select className="select-control" id={`status-${order.id}`} onChange={(event) => setDrafts((current) => ({ ...current, [order.id]: { ...current[order.id], status: event.target.value as OrderStatus } }))} value={drafts[order.id].status}>{statusOptions.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></div>
                  <div className="field"><label htmlFor={`tracking-${order.id}`}>Tracking number</label><input id={`tracking-${order.id}`} onChange={(event) => setDrafts((current) => ({ ...current, [order.id]: { ...current[order.id], tracking: event.target.value } }))} placeholder="Required when shipped" value={drafts[order.id].tracking} /></div>
                  <button className="button" disabled={busyId === order.id} onClick={() => updateStatus(order)} type="button">{busyId === order.id ? <LoaderCircle className="spin" size={16} /> : <PackageCheck size={16} />} Update order</button>
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  )
}

export default Orders
