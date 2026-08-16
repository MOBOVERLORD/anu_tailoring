import { useMemo, useState } from "react"
import { Check, CircleDollarSign, FilePenLine, FileText, LoaderCircle, PackageCheck, Plus, Send, Shirt, Trash2, Truck } from "lucide-react"
import toast from "react-hot-toast"
import { Dialog } from "@/components/Dialog"
import { api } from "@/lib/api"
import { boundedNumber } from "@/lib/formLimits"
import type { Order, UserProfile } from "@/types/api"

interface Props { order: Order; profile: UserProfile; onUpdated: (order: Order) => void }

const CombinedInvoiceDialog = ({ order, onClose, onUpdated }: { order: Order; onClose: () => void; onUpdated: (order: Order) => void }) => {
  const invoice = order.invoice
  const hasTailoring = order.order_items.length > 0
  const hasCustom = order.order_items.some((item) => item.design.is_custom_request_template)
  const vendorCloth = order.order_items.some((item) => item.cloth_source === "vendor_supplied")
  const publishedService = order.order_items.filter((item) => !item.design.is_custom_request_template).reduce((sum, item) => sum + item.price, 0)
  const [service, setService] = useState(invoice?.service_amount ?? order.order_items.reduce((sum, item) => sum + item.price, 0))
  const [clothType, setClothType] = useState(invoice?.cloth_type || (hasTailoring ? "To be confirmed" : "Not applicable"))
  const [requirement, setRequirement] = useState(invoice?.cloth_requirement || (hasTailoring ? "Enter the combined cloth requirement for all selected designs." : "No cloth is required for shop products."))
  const [clothCost, setClothCost] = useState(vendorCloth ? invoice?.cloth_cost || 0 : 0)
  const [lines, setLines] = useState(invoice?.line_items.map((line) => ({ name: line.name, description: line.description || "", quantity: line.quantity, unit_price: line.unit_price })) || [])
  const [saving, setSaving] = useState<"draft" | "send" | null>(null)

  const save = async (send: boolean) => {
    setSaving(send ? "send" : "draft")
    try {
      let updated = await api<Order>(`/api/orders/vendor/${order.id}/invoice`, { method: "PUT", body: JSON.stringify({ expected_revision: invoice?.revision ?? null, service_amount: hasCustom ? service : null, cloth_type: clothType, cloth_requirement: requirement, cloth_cost: vendorCloth ? clothCost : 0, line_items: lines.map((line) => ({ ...line, description: line.description.trim() || null })) }) })
      if (send) updated = await api<Order>(`/api/orders/vendor/${order.id}/invoice/issue`, { method: "POST" })
      onUpdated(updated); onClose(); toast.success(send ? "One invoice sent for the complete order" : "Combined invoice saved")
    } catch (error) { toast.error((error as Error).message) } finally { setSaving(null) }
  }

  const productTotal = order.product_items.reduce((sum, item) => sum + item.merchandise_total, 0)
  const delivery = order.deliveries.reduce((sum, item) => sum + item.delivery_cost, 0)
  const additions = lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0)
  return <Dialog className="vendor-invoice-dialog" description="This single invoice covers every design and product in the order. The platform locks product prices and applies delivery once." onClose={onClose} title={invoice ? `Edit ${invoice.invoice_number}` : "Create combined invoice"}>
    <form className="dialog-form invoice-editor" onSubmit={(event) => { event.preventDefault(); void save(false) }}>
      <section className="combined-invoice-locks"><span><FileText size={18} /><small>Published services</small><strong>₹{publishedService.toLocaleString("en-IN")}</strong></span><span><PackageCheck size={18} /><small>Products (locked)</small><strong>₹{productTotal.toLocaleString("en-IN")}</strong></span><span><Truck size={18} /><small>Delivery once (locked)</small><strong>₹{delivery.toLocaleString("en-IN")}</strong></span></section>
      {hasCustom && <div className="field"><label htmlFor={`combined-service-${order.id}`}>Total tailoring service charge (₹)</label><input id={`combined-service-${order.id}`} max={5_000_000} min={publishedService} onChange={(event) => setService(boundedNumber(event.target.value, 0, 5_000_000))} required type="number" value={service} /><small>Includes published designs plus the agreed custom tailoring charge.</small></div>}
      {hasTailoring && <><section className="customer-cloth-decision"><Shirt size={20} /><div><small>Cloth choice</small><strong>{vendorCloth ? "Vendor supplies cloth for at least one design" : "Customer supplies all cloth"}</strong></div></section><div className="field"><label htmlFor={`combined-cloth-${order.id}`}>Fabric / cloth</label><input id={`combined-cloth-${order.id}`} maxLength={150} minLength={2} onChange={(event) => setClothType(event.target.value)} required value={clothType} /></div><div className="field"><label htmlFor={`combined-requirement-${order.id}`}>Combined cloth requirement</label><textarea id={`combined-requirement-${order.id}`} maxLength={2000} minLength={10} onChange={(event) => setRequirement(event.target.value)} required rows={4} value={requirement} /></div>{vendorCloth && <div className="field"><label htmlFor={`combined-cloth-cost-${order.id}`}>Total cloth cost (₹)</label><input id={`combined-cloth-cost-${order.id}`} max={1_000_000} min={0} onChange={(event) => setClothCost(boundedNumber(event.target.value, 0, 1_000_000))} type="number" value={clothCost} /></div>}</>}
      <section className="invoice-line-editor"><header><div><strong>Additional agreed costs</strong><small>Buttons, lining, alterations, finishing, packaging, or other agreed charges.</small></div><button className="button button-secondary" onClick={() => setLines((current) => [...current, { name: "", description: "", quantity: 1, unit_price: 0 }])} type="button"><Plus size={15} /> Add item</button></header>{lines.map((line, index) => <article key={index}><div className="field"><label htmlFor={`combined-line-name-${index}`}>Charge</label><input id={`combined-line-name-${index}`} minLength={2} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} required value={line.name} /></div><div className="field"><label htmlFor={`combined-line-qty-${index}`}>Quantity</label><input id={`combined-line-qty-${index}`} min={0.01} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: boundedNumber(event.target.value, 0, 10_000) } : item))} step="0.01" type="number" value={line.quantity} /></div><div className="field"><label htmlFor={`combined-line-price-${index}`}>Unit price (₹)</label><input id={`combined-line-price-${index}`} min={0} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, unit_price: boundedNumber(event.target.value, 0, 1_000_000) } : item))} type="number" value={line.unit_price} /></div><button aria-label="Remove charge" className="icon-button danger" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button"><Trash2 size={16} /></button></article>)}</section>
      <div className="invoice-editor-total"><span><small>Additional costs: ₹{additions.toLocaleString("en-IN")}</small>Current combined total</span><strong>₹{(service + productTotal + delivery + clothCost + additions).toLocaleString("en-IN")}</strong></div>
      <div className="dialog-actions"><button className="button button-secondary" onClick={onClose} type="button">Cancel</button><button className="button button-secondary" disabled={Boolean(saving)} type="submit">{saving === "draft" && <LoaderCircle className="spin" size={16} />} Save draft</button><button className="button" disabled={Boolean(saving)} onClick={() => void save(true)} type="button">{saving === "send" ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />} Save & send</button></div>
    </form>
  </Dialog>
}

export const CombinedOrderInvoice = ({ order, profile, onUpdated }: Props) => {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState("")
  const invoice = order.invoice
  const isVendor = profile.role === "vendor" && profile.id === order.deliveries[0]?.vendor_id
  const isCustomer = profile.id === order.customer.id
  const productCount = useMemo(() => order.product_items.reduce((sum, item) => sum + item.quantity, 0), [order.product_items])

  const action = async (path: string, body?: unknown, message?: string) => {
    setBusy(true)
    try { const updated = await api<Order>(path, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) }); onUpdated(updated); if (message) toast.success(message) } catch (error) { toast.error((error as Error).message) } finally { setBusy(false) }
  }

  return <>
    <section className="combined-order-invoice">
      <header><div><FileText size={22} /><span><small>Single vendor invoice</small><strong>{invoice?.invoice_number || "Invoice not created"}</strong><p>{order.order_items.length} design{order.order_items.length === 1 ? "" : "s"} · {productCount} product item{productCount === 1 ? "" : "s"} · delivery charged once</p></span></div>{isVendor && (!invoice || ["draft", "change_requested"].includes(invoice.status)) && <button className="button" onClick={() => setEditing(true)} type="button"><FilePenLine size={16} /> {invoice ? "Edit invoice" : "Create invoice"}</button>}</header>
      {invoice ? <><div className="combined-invoice-costs"><span><small>Tailoring</small><strong>₹{invoice.service_amount.toLocaleString("en-IN")}</strong></span><span><small>Products</small><strong>₹{invoice.merchandise_amount.toLocaleString("en-IN")}</strong></span><span><small>Cloth</small><strong>₹{invoice.cloth_cost.toLocaleString("en-IN")}</strong></span><span><small>Delivery once</small><strong>₹{invoice.delivery_cost.toLocaleString("en-IN")}</strong></span><span className="invoice-grand-total"><small>Total</small><strong>₹{invoice.total_amount.toLocaleString("en-IN")}</strong></span></div><div className="combined-invoice-status"><span className={`order-status status-${invoice.status}`}>{invoice.status.replaceAll("_", " ")}</span>{isVendor && invoice.status === "draft" && <button className="button" disabled={busy} onClick={() => void action(`/api/orders/vendor/${order.id}/invoice/issue`, undefined, "Invoice sent") } type="button"><Send size={16} /> Send invoice</button>}</div>{isCustomer && invoice.status === "issued" && <div className="customer-invoice-decision"><div className="field"><label htmlFor={`combined-note-${order.id}`}>Note to vendor <small>required when requesting changes</small></label><textarea id={`combined-note-${order.id}`} onChange={(event) => setNote(event.target.value)} rows={2} value={note} /></div><div><button className="button button-secondary" disabled={busy || !note.trim()} onClick={() => void action(`/api/orders/${order.id}/invoice/decision`, { decision: "change_requested", comment: note }, "Changes requested")} type="button">Request changes</button><button className="button" disabled={busy} onClick={() => void action(`/api/orders/${order.id}/invoice/decision`, { decision: "approved", comment: null }, "Combined invoice approved")} type="button"><Check size={16} /> Approve invoice</button></div></div>}</> : <p className="combined-invoice-empty">{isVendor ? "Review all selected items and create one invoice for this order." : "The vendor is reviewing all selected items and will send one invoice."}</p>}
      {invoice?.status === "approved" && <div className="invoice-readiness"><span><CircleDollarSign size={15} /> Payment: <strong>{invoice.payment_status.replaceAll("_", " ")}</strong></span><span><PackageCheck size={15} /> Order: <strong>confirmed</strong></span></div>}
    </section>
    {editing && <CombinedInvoiceDialog onClose={() => setEditing(false)} onUpdated={onUpdated} order={order} />}
  </>
}
