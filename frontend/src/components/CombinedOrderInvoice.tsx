import { useMemo, useState } from "react"
import { Check, CircleDollarSign, ExternalLink, FilePenLine, FileText, LoaderCircle, PackageCheck, Paperclip, Plus, Send, Shirt, Trash2, Truck, Upload } from "lucide-react"
import toast from "react-hot-toast"
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog"
import { Dialog } from "@/components/Dialog"
import { RazorpayCheckoutButton } from "@/components/RazorpayCheckoutButton"
import { api, apiBlob } from "@/lib/api"
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
      <section className="combined-invoice-locks"><span><FileText size={18} /><small>Published services</small><strong>₹{publishedService.toLocaleString("en-IN")}</strong></span><span><PackageCheck size={18} /><small>Products (locked)</small><strong>₹{productTotal.toLocaleString("en-IN")}</strong></span><span><Truck size={18} /><small>Fulfilment once (locked)</small><strong>₹{delivery.toLocaleString("en-IN")}</strong></span></section>
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
  const [confirmingCloth, setConfirmingCloth] = useState(false)
  const [confirmingShipping, setConfirmingShipping] = useState(false)
  const [note, setNote] = useState("")
  const invoice = order.invoice
  const isVendor = profile.role === "vendor" && profile.id === order.deliveries[0]?.vendor_id
  const isCustomer = profile.id === order.customer.id
  const productCount = useMemo(() => order.product_items.reduce((sum, item) => sum + item.quantity, 0), [order.product_items])
  const hasActiveTailoring = order.order_items.some((item) => !["cancelled", "rejected"].includes(item.work_status))
  const activeTailoringItems = order.order_items.filter((item) => !["cancelled", "rejected"].includes(item.work_status))
  const tailoringComplete = activeTailoringItems.every((item) => item.work_status === "completed")
  const clothAdvance = invoice?.payment_status === "paid" ? invoice.cloth_cost : 0
  const finalBalance = Math.max(0, (invoice?.total_amount || 0) - clothAdvance)
  const fulfilmentMethod = order.deliveries[0]?.fulfilment_method

  const action = async (path: string, body?: unknown, message?: string) => {
    setBusy(true)
    try { const updated = await api<Order>(path, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) }); onUpdated(updated); if (message) toast.success(message); return true } catch (error) { toast.error((error as Error).message); return false } finally { setBusy(false) }
  }

  const uploadClothBill = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Cloth bill proof must be 5 MB or smaller")
      return
    }
    setBusy(true)
    try {
      const body = new FormData()
      body.append("file", file)
      onUpdated(await api<Order>(`/api/orders/vendor/${order.id}/invoice/cloth-bill`, { method: "POST", body }))
      toast.success("Cloth bill attached")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const openClothBill = async () => {
    if (!invoice?.cloth_bill_url) return
    const preview = window.open("", "_blank")
    try {
      const blob = await apiBlob(invoice.cloth_bill_url)
      const objectUrl = URL.createObjectURL(blob)
      if (preview) {
        preview.opener = null
        preview.location.href = objectUrl
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (error) {
      preview?.close()
      toast.error((error as Error).message)
    }
  }

  return <>
    <section className="combined-order-invoice">
      <header><div><FileText size={22} /><span><small>Single vendor invoice</small><strong>{invoice?.invoice_number || "Invoice not created"}</strong><p>{order.order_items.length} design{order.order_items.length === 1 ? "" : "s"} · {productCount} product item{productCount === 1 ? "" : "s"} · fulfilment applied once</p></span></div>{isVendor && (!invoice || ["draft", "change_requested"].includes(invoice.status)) && <button className="button" onClick={() => setEditing(true)} type="button"><FilePenLine size={16} /> {invoice ? "Edit invoice" : "Create invoice"}</button>}</header>
      {invoice ? <><div className="combined-invoice-costs"><span><small>Tailoring</small><strong>₹{invoice.service_amount.toLocaleString("en-IN")}</strong></span><span><small>Products</small><strong>₹{invoice.merchandise_amount.toLocaleString("en-IN")}</strong></span><span><small>Cloth</small><strong>₹{invoice.cloth_cost.toLocaleString("en-IN")}</strong></span><span><small>Delivery once</small><strong>₹{invoice.delivery_cost.toLocaleString("en-IN")}</strong></span><span className="invoice-grand-total"><small>Total</small><strong>₹{invoice.total_amount.toLocaleString("en-IN")}</strong></span></div><div className="combined-invoice-status"><span className={`order-status status-${invoice.status}`}>{invoice.status.replaceAll("_", " ")}</span>{isVendor && invoice.status === "draft" && <button className="button" disabled={busy} onClick={() => void action(`/api/orders/vendor/${order.id}/invoice/issue`, undefined, "Invoice sent") } type="button"><Send size={16} /> Send invoice</button>}</div>{isCustomer && invoice.status === "issued" && <div className="customer-invoice-decision"><div className="field"><label htmlFor={`combined-note-${order.id}`}>Note to vendor <small>required when requesting changes</small></label><textarea id={`combined-note-${order.id}`} onChange={(event) => setNote(event.target.value)} rows={2} value={note} /></div><div><button className="button button-secondary" disabled={busy || !note.trim()} onClick={() => void action(`/api/orders/${order.id}/invoice/decision`, { decision: "change_requested", comment: note }, "Changes requested")} type="button">Request changes</button><button className="button" disabled={busy} onClick={() => void action(`/api/orders/${order.id}/invoice/decision`, { decision: "approved", comment: null }, "Combined invoice approved")} type="button"><Check size={16} /> Approve invoice</button></div></div>}</> : <p className="combined-invoice-empty">{isVendor ? "Review all selected items and create one invoice for this order." : "The vendor is reviewing all selected items and will send one invoice."}</p>}
      {invoice?.status === "approved" && <div className="invoice-readiness">{invoice.cloth_source === "vendor_supplied" && invoice.cloth_cost > 0 && <span><CircleDollarSign size={15} /> Cloth advance: <strong>{invoice.payment_status.replaceAll("_", " ")}</strong></span>}<span><CircleDollarSign size={15} /> Final balance: <strong>{invoice.final_payment_status.replaceAll("_", " ")}</strong></span><span><PackageCheck size={15} /> Order: <strong>{order.status.replaceAll("_", " ")}</strong></span></div>}
      {invoice?.status === "approved" && invoice.cloth_source === "vendor_supplied" && invoice.cloth_cost > 0 && <div className={`cloth-bill-proof ${invoice.cloth_bill_url ? "is-attached" : "is-missing"}`}><Paperclip size={18} /><div><small>Combined cloth purchase proof</small><strong>{invoice.cloth_bill_filename || "Bill not attached yet"}</strong><p>{invoice.cloth_bill_url ? "Review this proof before completing the secure cloth payment." : "The vendor must attach proof before Razorpay Checkout becomes available."}</p></div>{invoice.cloth_bill_url && <button className="button button-secondary" onClick={() => void openClothBill()} type="button"><ExternalLink size={15} /> View bill</button>}{isVendor && invoice.payment_status === "pending" && <label className="button button-secondary cloth-bill-upload"><input accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { void uploadClothBill(event.target.files); event.target.value = "" }} type="file" />{busy ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />} {invoice.cloth_bill_url ? "Replace bill" : "Attach bill"}</label>}</div>}
      {isCustomer && invoice?.status === "approved" && invoice.payment_status === "pending" && invoice.cloth_bill_url && <div className="cloth-payment-form"><div><CircleDollarSign size={19} /><span><strong>Pay cloth cost securely: ₹{invoice.cloth_cost.toLocaleString("en-IN")}</strong><small>Razorpay verifies the captured payment with Vastrivo before tailoring can begin.</small></span></div><RazorpayCheckoutButton amount={invoice.cloth_cost} onVerified={async () => onUpdated(await api<Order>(`/api/orders/${order.id}`))} resourceId={order.id} scope="combined_order" /></div>}
      {isVendor && hasActiveTailoring && invoice?.status === "approved" && invoice.cloth_source === "customer_provided" && !invoice.cloth_received && <div className="combined-workflow-action"><PackageCheck size={21} /><div><strong>Customer cloth is expected</strong><small>Confirm this only after receiving and checking the cloth for every design in this order.</small></div><button className="button" disabled={busy} onClick={() => setConfirmingCloth(true)} type="button"><PackageCheck size={16} /> Confirm cloth received</button></div>}
      {isVendor && hasActiveTailoring && !tailoringComplete && invoice?.status === "approved" && (invoice.cloth_source === "customer_provided" ? invoice.cloth_received : invoice.cloth_cost <= 0 || invoice.payment_status === "paid") && <div className="combined-workflow-note"><Check size={18} /><span><strong>Tailoring status is unlocked</strong><small>Use the status action on each design below to start and move it through stitching, quality check, and completion.</small></span></div>}
      {isCustomer && invoice?.status === "approved" && tailoringComplete && invoice.final_payment_status === "pending" && finalBalance > 0 && <div className="cloth-payment-form final-payment-form"><div><CircleDollarSign size={19} /><span><strong>Pay final order balance: ₹{finalBalance.toLocaleString("en-IN")}</strong><small>{clothAdvance > 0 ? `Your ₹${clothAdvance.toLocaleString("en-IN")} cloth advance has already been deducted. ` : ""}The vendor can ship only after this payment is verified.</small></span></div><RazorpayCheckoutButton amount={finalBalance} onVerified={async () => onUpdated(await api<Order>(`/api/orders/${order.id}`))} resourceId={order.id} scope="combined_order_final" /></div>}
      {isVendor && invoice?.status === "approved" && tailoringComplete && invoice.final_payment_status === "pending" && <div className="combined-workflow-note is-waiting"><CircleDollarSign size={18} /><span><strong>Waiting for final payment</strong><small>The customer can now pay the completed order balance. Shipping unlocks after Razorpay verification.</small></span></div>}
      {isVendor && invoice?.status === "approved" && tailoringComplete && invoice.final_payment_status === "paid" && !["ready_for_shipping", "shipped", "delivered"].includes(order.status) && <div className="combined-workflow-action"><Truck size={21} /><div><strong>{fulfilmentMethod === "customer_self_pickup" ? "Final payment received — prepare collection" : "Final payment received — prepare courier pickup"}</strong><small>{fulfilmentMethod === "customer_self_pickup" ? "Mark the order ready once it is packed for customer pickup." : "Mark it ready after packing. The delivery will be booked, then an agent can be assigned."}</small></div><button className="button" disabled={busy} onClick={() => setConfirmingShipping(true)} type="button"><Truck size={16} /> {fulfilmentMethod === "customer_self_pickup" ? "Ready for pickup" : "Ready for shipping"}</button></div>}
    </section>
    {editing && <CombinedInvoiceDialog onClose={() => setEditing(false)} onUpdated={onUpdated} order={order} />}
    {confirmingCloth && <ConfirmActionDialog busy={busy} confirmLabel="Confirm cloth received" description="This confirms that you physically received and checked the customer's cloth for the complete order. Each design will become ready to start." onCancel={() => setConfirmingCloth(false)} onConfirm={() => void (async () => { if (await action(`/api/orders/vendor/${order.id}/cloth-received`, undefined, "Customer cloth marked as received")) setConfirmingCloth(false) })()} title="Confirm customer cloth?" />}
    {confirmingShipping && <ConfirmActionDialog busy={busy} confirmLabel={fulfilmentMethod === "customer_self_pickup" ? "Ready for pickup" : "Ready for shipping"} description={fulfilmentMethod === "customer_self_pickup" ? "The customer will be notified that their fully paid order is ready for collection." : "A tracking number will be generated and the delivery will be booked awaiting administrator assignment and courier pickup."} onCancel={() => setConfirmingShipping(false)} onConfirm={() => void (async () => { if (await action(`/api/orders/vendor/${order.id}/ship`, undefined, fulfilmentMethod === "customer_self_pickup" ? "Customer notified for pickup" : "Delivery booked for pickup")) setConfirmingShipping(false) })()} title={fulfilmentMethod === "customer_self_pickup" ? "Mark ready for pickup?" : "Mark ready for shipping?"} />}
  </>
}
