import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, LoaderCircle, MapPin, PackageCheck, ShoppingCart, Store, Trash2, Truck } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { MapAttribution } from "@/components/MapAttribution"
import { AppSelect } from "@/components/ui/AppSelect"
import { useCart } from "@/context/CartContext"
import { api } from "@/lib/api"
import { boundedNumber } from "@/lib/formLimits"
import type { DeliveryAddress, DeliveryQuote, Order } from "@/types/api"

const money = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
type FulfilmentChoice = "home_delivery" | "customer_self_delivery" | "customer_self_pickup"

const fulfilmentCopy: Record<DeliveryQuote["fulfilment_method"], { label: string; summary: string }> = {
  platform_delivery: { label: "Home delivery", summary: "Platform distance pricing" },
  vendor_delivery: { label: "Vendor delivery", summary: "Vendor fixed price" },
  customer_self_delivery: { label: "Self-delivery", summary: "You arrange the transport" },
  customer_self_pickup: { label: "Self-pickup", summary: "Collect from the vendor" },
}

const Cart = () => {
  const cart = useCart()
  const navigate = useNavigate()
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([])
  const [addressId, setAddressId] = useState("")
  const [quote, setQuote] = useState<DeliveryQuote | null>(null)
  const [fulfilmentMethod, setFulfilmentMethod] = useState<FulfilmentChoice>("home_delivery")
  const [loadingAddresses, setLoadingAddresses] = useState(true)
  const [quoting, setQuoting] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    api<DeliveryAddress[]>("/api/addresses").then((items) => {
      setAddresses(items)
      const preferred = items.find((item) => item.is_default) || items[0]
      setAddressId(preferred ? String(preferred.id) : "")
    }).catch((error: Error) => toast.error(error.message)).finally(() => setLoadingAddresses(false))
  }, [])

  useEffect(() => { setQuote(null) }, [addressId, cart.lines, fulfilmentMethod])

  const serviceSubtotal = useMemo(() => cart.lines.reduce((sum, line) => line.kind === "design" && !line.design.is_custom_request_template ? sum + line.design.base_price : sum, 0), [cart.lines])
  const merchandiseSubtotal = useMemo(() => cart.lines.reduce((sum, line) => line.kind === "product" ? sum + line.product.price * line.quantity : sum, 0), [cart.lines])
  const hasCustomPrice = cart.lines.some((line) => line.kind === "design" && line.design.is_custom_request_template)

  const calculateDelivery = async () => {
    const subject = cart.lines[0]
    if (!subject || !addressId) return
    setQuoting(true)
    try {
      const result = await api<DeliveryQuote>("/api/delivery/quote", { method: "POST", body: JSON.stringify(subject.kind === "design" ? { design_id: subject.design.id, address_id: Number(addressId), fulfilment_method: fulfilmentMethod } : { product_id: subject.product.id, address_id: Number(addressId), fulfilment_method: fulfilmentMethod }) })
      setQuote(result)
    } catch (error) { toast.error((error as Error).message) } finally { setQuoting(false) }
  }

  const checkout = async () => {
    if (!addressId || !quote || !cart.lines.length) return
    setSubmitting(true)
    try {
      const order = await api<Order>("/api/orders", { method: "POST", body: JSON.stringify({
        address_id: Number(addressId),
        delivery_quote_token: quote.quote_token,
        fulfilment_method: fulfilmentMethod,
        items: cart.lines.filter((line) => line.kind === "design").map((line) => ({ design_id: line.design.id, measurement_profile_id: line.measurement_profile_id, cloth_source: line.cloth_source, fabric_choice: line.fabric_choice, custom_instructions: line.custom_instructions })),
        product_items: cart.lines.filter((line) => line.kind === "product").map((line) => ({ product_id: line.product.id, quantity: line.quantity, selected_size: line.selected_size, selected_color: line.selected_color })),
      }) })
      cart.clear()
      toast.success(`Order #${order.id} placed · ${fulfilmentCopy[quote.fulfilment_method].label}`)
      navigate("/orders")
    } catch (error) { toast.error((error as Error).message); setQuote(null) } finally { setSubmitting(false) }
  }

  if (!cart.lines.length) return <div className="page cart-page"><section className="empty-state cart-empty"><ShoppingCart size={48} /><h1>Your cart is empty</h1><p>Add designs and products from one vendor. They will become one order with one delivery charge.</p><div><Link className="button" to="/">Browse designs</Link><Link className="button button-secondary" to="/shop">Browse shop</Link></div></section></div>

  return <div className="page cart-page">
    <Link className="back-link" to="/"><ArrowLeft size={16} /> Continue shopping</Link>
    <section className="workspace-heading cart-heading"><div><p className="eyebrow"><ShoppingCart size={15} /> Vendor cart</p><h1>One checkout, one vendor, one delivery</h1><p>All selected items from {cart.vendorName} will be grouped into a single order and invoice.</p></div><span className="queue-count">{cart.lines.length} items</span></section>
    <div className="cart-layout">
      <section className="cart-lines"><header><div><Store size={20} /><span><small>Ordering from</small><strong>{cart.vendorName}</strong></span></div><button className="button button-secondary button-small" onClick={cart.clear} type="button"><Trash2 size={15} /> Clear cart</button></header>
        {cart.lines.map((line) => <article className="cart-line" key={line.key}>
          <span className="cart-line-image">{(line.kind === "design" ? line.design.image_url : line.product.image_url) ? <ApiImage alt={line.kind === "design" ? line.design.title : line.product.title} src={(line.kind === "design" ? line.design.image_url : line.product.image_url)!} /> : <PackageCheck />}</span>
          <div className="cart-line-copy"><small>{line.kind === "design" ? "Tailored design" : "Shop product"}</small><strong>{line.kind === "design" ? line.design.title : line.product.title}</strong>{line.kind === "design" ? <p>{line.measurement_name} · {line.cloth_source === "vendor_supplied" ? "Vendor cloth" : "My cloth"}</p> : <p>{[line.selected_size, line.selected_color].filter(Boolean).join(" · ") || `Sold per ${line.product.unit}`}</p>}</div>
          {line.kind === "product" && <div className="field cart-quantity"><label htmlFor={`qty-${line.key}`}>Quantity</label><input id={`qty-${line.key}`} max={line.product.stock_quantity} min={line.product.unit === "piece" ? 1 : 0.1} onChange={(event) => cart.updateProductQuantity(line.key, boundedNumber(event.target.value, 0, line.product.stock_quantity))} step={line.product.unit === "piece" ? 1 : 0.1} type="number" value={line.quantity} /></div>}
          <strong className="cart-line-price">{line.kind === "design" ? line.design.is_custom_request_template ? "Quoted later" : money(line.design.base_price) : money(line.product.price * line.quantity)}</strong>
          <button aria-label="Remove item" className="icon-button danger" onClick={() => cart.removeLine(line.key)} type="button"><Trash2 size={16} /></button>
        </article>)}
      </section>
      <aside className="cart-checkout"><h2>Order summary</h2>
        <fieldset className="fulfilment-options"><legend>How will you receive this order?</legend>
          <button className={fulfilmentMethod === "home_delivery" ? "is-active" : ""} onClick={() => setFulfilmentMethod("home_delivery")} type="button"><Truck size={18} /><span><strong>Deliver to me</strong><small>Platform or vendor price</small></span></button>
          <button className={fulfilmentMethod === "customer_self_delivery" ? "is-active" : ""} onClick={() => setFulfilmentMethod("customer_self_delivery")} type="button"><PackageCheck size={18} /><span><strong>Self-delivery</strong><small>I arrange transport · ₹0</small></span></button>
          <button className={fulfilmentMethod === "customer_self_pickup" ? "is-active" : ""} onClick={() => setFulfilmentMethod("customer_self_pickup")} type="button"><Store size={18} /><span><strong>Self-pickup</strong><small>I collect it · ₹0</small></span></button>
        </fieldset>
        <div className="field"><label htmlFor="cart-address"><MapPin size={14} /> {fulfilmentMethod === "customer_self_pickup" ? "Contact address for this order" : "Address for the complete order"}</label>{loadingAddresses ? <span>Loading addresses…</span> : addresses.length ? <AppSelect id="cart-address" onValueChange={setAddressId} options={addresses.map((address) => ({ value: String(address.id), label: `${address.recipient_name} · ${address.street_address}` }))} value={addressId} /> : <Link className="button button-secondary button-wide" to="/profile?section=addresses">Add address</Link>}</div>
        <div className="cart-costs"><span><small>Tailoring services</small><strong>{money(serviceSubtotal)}{hasCustomPrice && " + quote"}</strong></span><span><small>Products</small><strong>{money(merchandiseSubtotal)}</strong></span><span className="delivery-once"><small><Truck size={15} /> {quote ? fulfilmentCopy[quote.fulfilment_method].label : "Fulfilment"} <b>{quote ? fulfilmentCopy[quote.fulfilment_method].summary : "charged once"}</b></small><strong>{quote ? money(quote.delivery_cost) : "Confirm"}</strong></span>{quote?.maps_provider !== "not_required" && quote && <MapAttribution provider={quote.maps_provider} />}</div>
        {!quote ? <button className="button button-wide" disabled={!addressId || quoting} onClick={calculateDelivery} type="button">{quoting ? <LoaderCircle className="spin" size={17} /> : <Truck size={17} />} Confirm fulfilment</button> : <><div className="cart-total"><span><small>{hasCustomPrice ? "Current total; custom service added to invoice" : "Order total"}</small>Total</span><strong>{money(serviceSubtotal + merchandiseSubtotal + quote.delivery_cost)}</strong></div><button className="button button-wide" disabled={submitting} onClick={checkout} type="button">{submitting ? <LoaderCircle className="spin" size={17} /> : <PackageCheck size={17} />} Place order</button></>}
        <p className="cart-security-note">Stock is reserved when you place the order. The fulfilment choice and any fee are locked once for every item in this vendor order.</p>
      </aside>
    </div>
  </div>
}

export default Cart
