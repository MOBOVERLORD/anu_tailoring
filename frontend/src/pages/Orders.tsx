import { useCallback, useEffect, useMemo, useState } from "react"
import { Ban, CalendarDays, CheckCircle2, ChevronDown, ChevronUp, Clock3, LoaderCircle, MapPin, Package, PackageCheck, Search, Truck, UserRound, XCircle } from "lucide-react"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog"
import { OrderItemDetail, type OrderWorkflowUpdate } from "@/components/OrderItemDetail"
import { OrderCancellationDialog } from "@/components/OrderCancellationDialog"
import { CombinedOrderInvoice } from "@/components/CombinedOrderInvoice"
import { ProductOrdersPanel, type CustomerOrderView } from "@/components/ProductOrdersPanel"
import { AppSelect } from "@/components/ui/AppSelect"
import { api, getCurrentUser } from "@/lib/api"
import type { Order, OrderItem, OrderPage, OrderStatus, UserProfile } from "@/types/api"

const statusLabels: Record<OrderStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  fabric_cutting: "Fabric cutting",
  stitching: "Stitching",
  quality_check: "Quality check",
  ready_for_shipping: "Ready for shipping",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
}

const statusOptions = Object.keys(statusLabels) as OrderStatus[]
const orderStatusSelectOptions = statusOptions.map((value) => ({ value, label: statusLabels[value] }))
const orderFilterOptions = [{ value: "all", label: "All statuses" }, ...orderStatusSelectOptions]
const PAGE_SIZE = 20

const ordersEndpoint = (role: UserProfile["role"], offset: number, mode: "purchases" | "sales") => {
  const base = role === "vendor" && mode === "sales"
    ? "/api/orders/vendor"
    : role === "customer"
      ? "/api/orders"
      : role === "vendor"
        ? "/api/orders"
      : "/api/admin/orders"
  return `${base}?limit=${PAGE_SIZE}&offset=${offset}`
}

const Orders = ({ mode = "purchases" }: { mode?: "purchases" | "sales" }) => {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [loadingMore, setLoadingMore] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all")
  const [drafts, setDrafts] = useState<Record<number, { status: OrderStatus; tracking: string }>>({})
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set())
  const [busyId, setBusyId] = useState<number | null>(null)
  const [statusConfirmation, setStatusConfirmation] = useState<Order | null>(null)
  const [cancellingOrder, setCancellingOrder] = useState<Order | null>(null)
  const [rejectingOrder, setRejectingOrder] = useState<Order | null>(null)
  const [customerView, setCustomerView] = useState<CustomerOrderView>("in_progress")

  const loadOrders = useCallback(async () => {
    setLoadError("")
    try {
      const me = await getCurrentUser()
      const result = await api<OrderPage>(ordersEndpoint(me.role, 0, mode))
      setProfile(me)
      setOrders(result.items)
      setTotalCount(result.total)
      setDrafts(Object.fromEntries(result.items.map((order) => [order.id, { status: order.status, tracking: order.tracking_number || "" }])))
    } catch (error) {
      setLoadError((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [mode])

  useEffect(() => { void loadOrders() }, [loadOrders])

  const loadMore = async () => {
    if (!profile || loadingMore || orders.length >= totalCount) return
    setLoadingMore(true)
    try {
      const result = await api<OrderPage>(ordersEndpoint(profile.role, orders.length, mode))
      setOrders((current) => [...current, ...result.items])
      setTotalCount(result.total)
      setDrafts((current) => ({
        ...current,
        ...Object.fromEntries(result.items.map((order) => [order.id, { status: order.status, tracking: order.tracking_number || "" }])),
      }))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }

  const visibleOrders = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    return orders.filter((order) => {
      const matchesStatus = statusFilter === "all" || order.status === statusFilter
      const isBuyerView = profile?.role === "customer" || (profile?.role === "vendor" && mode === "purchases")
      const matchesCustomerView = !isBuyerView
        || (customerView === "closed"
          ? order.status === "cancelled" || ((order.order_items.length + order.product_items.length) > 0
            && order.order_items.every((item) => ["cancelled", "rejected"].includes(item.work_status))
            && order.product_items.every((item) => item.status === "cancelled"))
          : customerView === "completed"
            ? order.status === "delivered"
            : !["cancelled", "delivered"].includes(order.status))
      const haystack = [
        String(order.id),
        order.customer.full_name,
        order.customer.email,
        order.tracking_number || "",
        ...order.order_items.flatMap((item) => [item.design.title, item.design.vendor_name || ""]),
        ...order.product_items.flatMap((item) => [item.product.title, item.product.vendor_name]),
      ].join(" ").toLowerCase()
      return matchesStatus && matchesCustomerView && (!normalized || haystack.includes(normalized))
    })
  }, [customerView, mode, orders, profile?.role, search, statusFilter])

  const updateStatus = async (order: Order) => {
    const draft = drafts[order.id]
    if (!draft) return false
    setBusyId(order.id)
    try {
      const updated = await api<Order>(`/api/admin/orders/${order.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: draft.status, tracking_number: draft.tracking || null }),
      })
      setOrders((current) => current.map((item) => item.id === updated.id ? updated : item))
      toast.success(`Order #${order.id} updated`)
      return true
    } catch (error) {
      toast.error((error as Error).message)
      return false
    } finally {
      setBusyId(null)
    }
  }

  const replaceOrderItem = (updated: OrderItem) => {
    setOrders((current) => current.map((order) => {
      if (!order.order_items.some((item) => item.id === updated.id)) return order
      const orderItems = order.order_items.map((item) => item.id === updated.id ? updated : item)
      return {
        ...order,
        order_items: orderItems,
        service_amount: orderItems.reduce((sum, item) => sum + item.price, 0),
        total_amount: orderItems.reduce((sum, item) => sum + (item.invoice?.total_amount ?? item.price), 0)
          + order.deliveries.reduce((sum, delivery) => sum + delivery.delivery_cost, 0),
      }
    }))
  }

  const replaceOrder = (updated: Order) => {
    setOrders((current) => current.map((order) => order.id === updated.id ? updated : order))
    setDrafts((current) => ({
      ...current,
      [updated.id]: { status: updated.status, tracking: updated.tracking_number || "" },
    }))
  }

  const replaceWorkflowStatus = useCallback((
    orderId: number,
    itemId: number,
    update: OrderWorkflowUpdate,
  ) => {
    setOrders((current) => current.map((order) => {
      if (order.id !== orderId) return order
      const updateInvoice = (invoice: Order["invoice"]) => invoice && update.invoice_status ? {
        ...invoice,
        status: update.invoice_status,
        ...(update.payment_status ? { payment_status: update.payment_status } : {}),
        ...(update.final_payment_status ? { final_payment_status: update.final_payment_status } : {}),
        ...(typeof update.cloth_received === "boolean" ? { cloth_received: update.cloth_received } : {}),
        ...(update.cloth_source ? { cloth_source: update.cloth_source } : {}),
      } : invoice
      return {
        ...order,
        status: update.order_status,
        invoice: order.combined_order ? updateInvoice(order.invoice) : order.invoice,
        order_items: order.order_items.map((item) => item.id === itemId ? {
          ...item,
          work_status: update.work_status,
          invoice: order.combined_order ? item.invoice : updateInvoice(item.invoice),
        } : item),
      }
    }))
  }, [])

  const cancelCustomerOrder = async (reason: string) => {
    if (!cancellingOrder) return
    setBusyId(cancellingOrder.id)
    try {
      const updated = await api<Order>(`/api/orders/${cancellingOrder.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      })
      replaceOrder(updated)
      setCancellingOrder(null)
      toast.success(`Order #${updated.id} cancelled`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const rejectVendorOrder = async (reason: string) => {
    if (!rejectingOrder) return
    setBusyId(rejectingOrder.id)
    try {
      const updated = await api<Order>(`/api/orders/vendor/${rejectingOrder.id}/reject`, { method: "POST", body: JSON.stringify({ reason }) })
      replaceOrder(updated); setRejectingOrder(null); toast.success(`Order #${updated.id} rejected`)
    } catch (error) { toast.error((error as Error).message) } finally { setBusyId(null) }
  }

  const toggleOrder = (orderId: number) => {
    setExpandedOrders((current) => {
      const next = new Set(current)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin"
  const isVendorSales = profile?.role === "vendor" && mode === "sales"
  const isBuyerView = profile?.role === "customer" || (profile?.role === "vendor" && mode === "purchases")
  const heading = isVendorSales ? "Orders placed with you" : isAdmin ? "Marketplace orders" : "Your orders"
  const description = isVendorSales
    ? "Open each order to quote cloth, answer the customer, and start approved jobs. Delivery pricing is calculated automatically."
    : isAdmin ? "Monitor every order, invoice, and fulfilment status." : "Review vendor invoices, cloth requirements, payments, and job progress."

  return (
    <div className="page orders-page">
      <section className="workspace-heading orders-heading">
        <div><p className="eyebrow"><PackageCheck size={15} /> Order centre</p><h1>{heading}</h1><p>{description}</p></div>
        {!loading && <span className="queue-count">{totalCount} total</span>}
      </section>

      {isBuyerView && (
        <nav aria-label="Customer order views" className="customer-order-tabs">
          <button className={customerView === "in_progress" ? "active" : ""} onClick={() => setCustomerView("in_progress")} type="button"><Clock3 size={18} /><span>In progress</span></button>
          <button className={customerView === "completed" ? "active" : ""} onClick={() => setCustomerView("completed")} type="button"><CheckCircle2 size={18} /><span>Completed</span></button>
          <button className={customerView === "closed" ? "active" : ""} onClick={() => setCustomerView("closed")} type="button"><Ban size={18} /><span>Cancelled / rejected</span></button>
        </nav>
      )}

      {profile && <ProductOrdersPanel customerView={customerView} mode={mode} profile={profile} />}

      {!loading && orders.length > 0 && (
        <section className="orders-toolbar" aria-label="Filter orders">
          <label className="search-field"><Search size={17} /><span className="sr-only">Search loaded orders</span><input onChange={(event) => setSearch(event.target.value)} placeholder="Search loaded orders…" value={search} /></label>
          {!isBuyerView && <AppSelect ariaLabel="Filter by order status" className="toolbar-select" onValueChange={(value) => setStatusFilter(value as "all" | OrderStatus)} options={orderFilterOptions} value={statusFilter} />}
          <span>{visibleOrders.length} shown</span>
        </section>
      )}

      {loadError && <section className="empty-state"><h2>Couldn’t refresh your orders</h2><p role="alert">{loadError}</p><button className="button button-secondary" disabled={loading} onClick={() => { setLoading(true); void loadOrders() }}>Retry</button></section>}
      {loading ? (
        <div className="loading-state"><LoaderCircle className="spin" /> Loading orders…</div>
      ) : loadError && orders.length === 0 ? null : orders.length === 0 ? (
        <section className="empty-state"><Package size={48} strokeWidth={1.4} /><p className="eyebrow">Tailoring orders</p><h2>{isBuyerView && customerView === "completed" ? "No completed tailoring orders" : isBuyerView && customerView === "closed" ? "No cancelled or rejected tailoring orders" : isVendorSales ? "No customer tailoring orders yet" : "No tailoring orders in progress"}</h2><p>{isBuyerView ? customerView === "completed" ? "Delivered tailoring orders will be kept here for easy reference." : customerView === "closed" ? "Orders cancelled by you or rejected by a vendor will appear here." : "Open a published design and choose Order design to place your first tailoring order. Shop purchases appear above." : "New made-to-measure orders will appear here automatically."}</p></section>
      ) : visibleOrders.length === 0 ? (
        <section className="empty-state"><Search size={38} /><h2>No matching orders</h2><p>Try a different search or status filter.</p></section>
      ) : (
        <section className="order-list">
          {visibleOrders.map((order) => {
            const expanded = expandedOrders.has(order.id)
            const hasInvoice = Boolean(order.invoice) || order.order_items.some((item) => item.invoice)
            const awaitingQuote = !hasInvoice && order.order_items.some((item) => item.design.is_custom_request_template)
            const invoiceAccepted = order.invoice?.status === "approved" || order.order_items.some((item) => item.invoice?.status === "approved")
            const customerCanCancel = isBuyerView && order.customer.id === profile?.id
              && !invoiceAccepted
              && !["cancelled", "ready_for_shipping", "shipped", "delivered"].includes(order.status)
            return (
              <article className={`order-card ${expanded ? "is-expanded" : ""}`} key={order.id}>
                <button aria-expanded={expanded} className="order-card-toggle" onClick={() => toggleOrder(order.id)} type="button">
                  <span className="order-card-identity"><span><b className="order-number">Order #{order.id}</b><span className={`order-status status-${order.status}`}>{statusLabels[order.status]}</span></span><small><CalendarDays size={14} /> {new Date(order.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}{(isVendorSales || isAdmin) && <> · <UserRound size={14} /> {order.customer.full_name}</>}</small></span>
                  <span className="order-card-total">{awaitingQuote ? <><small>Custom tailoring</small><strong>Awaiting vendor quote</strong><small>Final total not yet confirmed</small></> : <><small>{hasInvoice ? "Current quoted total" : order.combined_order ? "Items + one delivery" : "Tailoring service"}</small><strong>₹{order.total_amount.toLocaleString("en-IN")}</strong></>}</span>
                  <span className="open-order-button">{expanded ? "Close" : "Open order"}{expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</span>
                </button>

                {!expanded && (
                  <div className="order-card-summary">
                    <div className="order-summary-designs">{order.order_items.slice(0, 2).map((item) => <span className="order-summary-image" key={`d-${item.id}`}>{item.design.image_url ? <ApiImage alt="" src={item.design.image_url} /> : <Package size={19} />}</span>)}{order.product_items.slice(0, Math.max(0, 3 - order.order_items.length)).map((item) => <span className="order-summary-image" key={`p-${item.id}`}>{item.product.image_url ? <ApiImage alt="" src={item.product.image_url} /> : <Package size={19} />}</span>)}<span><strong>{order.order_items.length + order.product_items.length} {(order.order_items.length + order.product_items.length) === 1 ? "item" : "items"} from one vendor</strong><small>{[...order.order_items.map((item) => item.design.title), ...order.product_items.map((item) => item.product.title)].join(", ")}</small></span></div>
                    <span><MapPin size={15} /> {order.delivery_address.city}, {order.delivery_address.state}</span>
                    {order.tracking_number && <span><Truck size={15} /> {order.tracking_number}</span>}
                  </div>
                )}

                {expanded && profile && (
                  <div className="order-card-expanded">
                    <div className="order-context">
                      <span><CalendarDays size={15} /> Placed {new Date(order.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                      {(isVendorSales || isAdmin) && <span><UserRound size={15} /> {order.customer.full_name} · {order.customer.phone || order.customer.email}</span>}
                      {order.tracking_number && <span><Truck size={15} /> {order.tracking_number}</span>}
                    </div>



                    {isVendorSales && order.combined_order && order.status !== "cancelled" && order.invoice?.status !== "approved" && <div className="order-cancellation-bar"><div><XCircle size={18} /><span><strong>Cannot accept this combined order?</strong><small>Rejecting closes every design and product line and cancels the single delivery.</small></span></div><button className="button button-secondary danger-text" onClick={() => setRejectingOrder(order)} type="button">Reject order</button></div>}

                    {order.combined_order && <CombinedOrderInvoice onUpdated={replaceOrder} order={order} profile={profile} />}
                    {isBuyerView && customerCanCancel && <div className="order-secondary-actions"><button className="button button-secondary" onClick={() => setCancellingOrder(order)} type="button">Cancel order</button><small>Available before accepting a vendor invoice.</small></div>}


                    {order.product_items.length > 0 && <section className="combined-product-lines"><header><Package size={19} /><div><strong>Products in this order</strong><small>Included in the single vendor invoice</small></div></header>{order.product_items.map((item) => <article key={item.id}><span className="order-summary-image">{item.product.image_url ? <ApiImage alt={item.product.title} src={item.product.image_url} /> : <Package size={18} />}</span><div><strong>{item.product.title}</strong><small>{item.quantity} {item.product.unit}{item.selected_size ? ` · ${item.selected_size}` : ""}</small></div><b>₹{item.merchandise_total.toLocaleString("en-IN")}</b><span className={`order-status status-${item.status}`}>{item.status}</span></article>)}</section>}

                    <div className="order-detail-items">
                      {order.order_items.map((item) => <OrderItemDetail item={item} key={item.id} onOrderUpdated={replaceOrder} onUpdated={replaceOrderItem} onWorkflowUpdated={replaceWorkflowStatus} order={order} profile={profile} />)}
                    </div>

                    <div className="delivery-detail"><strong>{order.deliveries[0]?.fulfilment_method === "customer_self_pickup" ? "Customer self-pickup" : order.deliveries[0]?.fulfilment_method === "customer_self_delivery" ? "Customer-arranged delivery" : order.deliveries[0]?.fulfilment_method === "vendor_delivery" ? "Vendor-managed delivery" : order.combined_order ? "One delivery for the complete order" : "Delivery"}</strong><address>{order.deliveries[0]?.fulfilment_method === "customer_self_pickup" ? order.deliveries[0].destination_address : `${order.delivery_address.recipient_name}, ${order.delivery_address.street_address}, ${order.delivery_address.city}, ${order.delivery_address.state} ${order.delivery_address.postal_code}`}</address>{order.combined_order && order.deliveries[0] && <span>₹{order.deliveries[0].delivery_cost.toLocaleString("en-IN")}{order.deliveries[0].fulfilment_method === "platform_delivery" ? ` · ${(order.deliveries[0].distance_meters / 1000).toFixed(1)} km` : ""}</span>}</div>

                    {isAdmin && drafts[order.id] && (
                      <div className="order-admin-actions">
                        <div className="field"><label htmlFor={`status-${order.id}`}>Order status</label><AppSelect id={`status-${order.id}`} onValueChange={(value) => setDrafts((current) => ({ ...current, [order.id]: { ...current[order.id], status: value as OrderStatus } }))} options={orderStatusSelectOptions} value={drafts[order.id].status} /></div>
                        <div className="field"><label htmlFor={`tracking-${order.id}`}>Tracking number</label><input id={`tracking-${order.id}`} onChange={(event) => setDrafts((current) => ({ ...current, [order.id]: { ...current[order.id], tracking: event.target.value } }))} placeholder="Required when shipped" value={drafts[order.id].tracking} /></div>
                        <button className="button" disabled={busyId === order.id} onClick={() => setStatusConfirmation(order)} type="button">{busyId === order.id ? <LoaderCircle className="spin" size={16} /> : <PackageCheck size={16} />} Review & update</button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            )
          })}
          {orders.length < totalCount && (
            <button className="button button-secondary orders-load-more" disabled={loadingMore} onClick={loadMore} type="button">
              {loadingMore ? <LoaderCircle className="spin" size={16} /> : <Package size={16} />}
              Load more orders ({orders.length} of {totalCount})
            </button>
          )}
        </section>
      )}
      {statusConfirmation && drafts[statusConfirmation.id] && (
        <ConfirmActionDialog
          busy={busyId === statusConfirmation.id}
          confirmLabel="Update order"
          description={`Order #${statusConfirmation.id} will move from ${statusLabels[statusConfirmation.status]} to ${statusLabels[drafts[statusConfirmation.id].status]}${drafts[statusConfirmation.id].tracking ? ` with tracking ${drafts[statusConfirmation.id].tracking}` : ""}. The customer will be notified.`}
          onCancel={() => setStatusConfirmation(null)}
          onConfirm={async () => { if (await updateStatus(statusConfirmation)) setStatusConfirmation(null) }}
          title="Confirm order update"
        />
      )}
      {cancellingOrder && <OrderCancellationDialog busy={busyId === cancellingOrder.id} confirmLabel="Cancel order" description="This cancels every tailoring item and its delivery. Vendors will be notified. Once any invoice is accepted, cancellation is permanently disabled." onCancel={() => setCancellingOrder(null)} onConfirm={(reason) => void cancelCustomerOrder(reason)} title={`Cancel order #${cancellingOrder.id}?`} />}
      {rejectingOrder && <OrderCancellationDialog busy={busyId === rejectingOrder.id} confirmLabel="Reject order" description="This rejects every design and product in the combined order, restores product stock, and cancels its one delivery. The customer will see your reason." onCancel={() => setRejectingOrder(null)} onConfirm={(reason) => void rejectVendorOrder(reason)} title={`Reject order #${rejectingOrder.id}?`} />}
    </div>
  )
}

export default Orders
