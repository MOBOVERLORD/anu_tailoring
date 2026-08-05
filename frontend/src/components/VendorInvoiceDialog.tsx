import { useState } from "react"
import { FileText, LoaderCircle, Plus, Save, Send, Shirt, Trash2 } from "lucide-react"
import toast from "react-hot-toast"
import { Dialog } from "@/components/Dialog"
import { api } from "@/lib/api"
import { boundedNumber } from "@/lib/formLimits"
import type { OrderItem } from "@/types/api"

interface VendorInvoiceDialogProps {
  item: OrderItem
  onClose: () => void
  onUpdated: (item: OrderItem) => void
}

interface EditableLineItem {
  name: string
  description: string
  quantity: number
  unit_price: number
}

const emptyLineItem = (): EditableLineItem => ({ name: "", description: "", quantity: 1, unit_price: 0 })

export const VendorInvoiceDialog = ({ item, onClose, onUpdated }: VendorInvoiceDialogProps) => {
  const existing = item.invoice
  const customerProvidesCloth = item.cloth_source === "customer_provided"
  const [form, setForm] = useState({
    cloth_type: existing?.cloth_type || item.fabric_choice || "",
    cloth_requirement: existing?.cloth_requirement || "",
    cloth_cost: customerProvidesCloth ? 0 : existing?.cloth_cost || 0,
    line_items: existing?.line_items.map((line) => ({
      name: line.name,
      description: line.description || "",
      quantity: line.quantity,
      unit_price: line.unit_price,
    })) || [],
  })
  const [saving, setSaving] = useState<"draft" | "issue" | null>(null)
  const measurements = Object.entries(item.measurement_snapshot?.measurements || {})
  const measurementUnit = item.measurement_snapshot?.unit === "cm" ? "cm" : "in"

  const updateLineItem = (index: number, patch: Partial<EditableLineItem>) => {
    setForm((current) => ({
      ...current,
      line_items: current.line_items.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line),
    }))
  }

  const removeLineItem = (index: number) => {
    setForm((current) => ({ ...current, line_items: current.line_items.filter((_, lineIndex) => lineIndex !== index) }))
  }

  const submit = async (event: React.SyntheticEvent, issue: boolean) => {
    event.preventDefault()
    setSaving(issue ? "issue" : "draft")
    try {
      const payload = {
        expected_revision: existing?.revision ?? null,
        cloth_type: form.cloth_type,
        cloth_requirement: form.cloth_requirement,
        cloth_cost: customerProvidesCloth ? 0 : Number(form.cloth_cost),
        line_items: form.line_items.map((line) => ({
          name: line.name,
          description: line.description.trim() || null,
          quantity: Number(line.quantity),
          unit_price: Number(line.unit_price),
        })),
      }
      let updated = await api<OrderItem>(`/api/orders/vendor/items/${item.id}/invoice`, {
        method: "PUT",
        body: JSON.stringify(payload),
      })
      if (issue) updated = await api<OrderItem>(`/api/orders/vendor/items/${item.id}/invoice/issue`, { method: "POST" })
      onUpdated(updated)
      onClose()
      toast.success(issue ? "Invoice sent to the customer" : "Invoice draft saved")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(null)
    }
  }

  const additionalTotal = form.line_items.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_price), 0)
  const invoiceTotal = item.price + (customerProvidesCloth ? 0 : Number(form.cloth_cost)) + additionalTotal

  return (
    <Dialog className="vendor-invoice-dialog" description="The customer has already selected who supplies the cloth. Delivery is calculated by the platform, so only add tailoring, cloth, and agreed product charges." onClose={onClose} title={existing ? `Edit invoice ${existing.invoice_number}` : "Create vendor invoice"}>
      <form className="dialog-form invoice-editor" onSubmit={(event) => submit(event, false)}>
        <div className="invoice-service-banner"><FileText size={20} /><div><small>Tailoring service charge</small><strong>₹{item.price.toLocaleString("en-IN")}</strong><p>Carried from the design price and not treated as cloth or product cost.</p></div></div>

        <section className="customer-cloth-decision"><Shirt size={20} /><div><small>Customer’s cloth choice</small><strong>{customerProvidesCloth ? "Customer provides the cloth" : "Vendor provides the cloth"}</strong><p>{customerProvidesCloth ? "Cloth cost is locked at ₹0. You must still give the exact cloth requirement." : "Quote the cloth cost here. After approval, attach the actual cloth bill before the customer pays."}</p></div></section>

        <section className="invoice-measurement-reference">
          <div><small>Measurements used for this cloth quote</small><strong>{item.measurement_profile.profile_name} · {item.measurement_profile.garment_type.replaceAll("_", " ")}</strong></div>
          <div className="measurement-detail-chips">{measurements.map(([key, value]) => <span key={key}><small>{key.replaceAll("_", " ")}</small><strong>{value} {measurementUnit}</strong></span>)}</div>
        </section>

        <div className="field"><label htmlFor="invoice-cloth-type">Required cloth / fabric</label><input id="invoice-cloth-type" maxLength={150} onChange={(event) => setForm({ ...form, cloth_type: event.target.value })} placeholder="e.g. 44-inch cotton-silk, matching lining" required value={form.cloth_type} /></div>
        <div className="field"><label htmlFor="invoice-requirement">Cloth requirement based on selected measurements</label><textarea id="invoice-requirement" maxLength={2000} minLength={10} onChange={(event) => setForm({ ...form, cloth_requirement: event.target.value })} placeholder="e.g. 3.5 metres of 44-inch main fabric plus 1 metre lining." required rows={5} value={form.cloth_requirement} /><small>This is mandatory regardless of who provides the cloth.</small></div>
        <div className="field"><label htmlFor="invoice-cloth-cost">Cloth cost (₹)</label><input disabled={customerProvidesCloth} id="invoice-cloth-cost" max={1_000_000} min={0} onChange={(event) => setForm({ ...form, cloth_cost: boundedNumber(event.target.value, 0, 1_000_000) })} type="number" value={customerProvidesCloth ? 0 : form.cloth_cost} /></div>

        <section className="invoice-line-editor">
          <header><div><strong>Additional products and costs</strong><small>Itemize lining, buttons, zips, accessories, special finishing, or any other agreed charge.</small></div><button className="button button-secondary" disabled={form.line_items.length >= 25} onClick={() => setForm({ ...form, line_items: [...form.line_items, emptyLineItem()] })} type="button"><Plus size={15} /> Add item</button></header>
          {form.line_items.length === 0 ? <p>No additional items added.</p> : <div className="invoice-line-list">{form.line_items.map((line, index) => (
            <article key={index}>
              <div className="field"><label htmlFor={`line-name-${index}`}>Product or charge</label><input id={`line-name-${index}`} maxLength={150} onChange={(event) => updateLineItem(index, { name: event.target.value })} placeholder="e.g. Cotton lining" required value={line.name} /></div>
              <div className="field"><label htmlFor={`line-description-${index}`}>Description <small>optional</small></label><input id={`line-description-${index}`} maxLength={500} onChange={(event) => updateLineItem(index, { description: event.target.value })} placeholder="Brand, colour, or specification" value={line.description} /></div>
              <div className="field"><label htmlFor={`line-quantity-${index}`}>Quantity</label><input id={`line-quantity-${index}`} max={10_000} min={0.01} onChange={(event) => updateLineItem(index, { quantity: boundedNumber(event.target.value, 0, 10_000) })} required step="0.01" type="number" value={line.quantity} /></div>
              <div className="field"><label htmlFor={`line-price-${index}`}>Unit cost (₹)</label><input id={`line-price-${index}`} max={1_000_000} min={0} onChange={(event) => updateLineItem(index, { unit_price: boundedNumber(event.target.value, 0, 1_000_000) })} required step="0.01" type="number" value={line.unit_price} /></div>
              <strong className="line-item-total">₹{(Number(line.quantity) * Number(line.unit_price)).toLocaleString("en-IN")}</strong>
              <button aria-label={`Remove ${line.name || "invoice item"}`} className="icon-button danger" onClick={() => removeLineItem(index)} type="button"><Trash2 size={16} /></button>
            </article>
          ))}</div>}
        </section>

        <div className="invoice-editor-total"><span><small>Additional items: ₹{additionalTotal.toLocaleString("en-IN")}</small>Invoice total</span><strong>₹{invoiceTotal.toLocaleString("en-IN")}</strong></div>
        <div className="dialog-actions invoice-dialog-actions">
          <button className="button button-secondary" onClick={onClose} type="button">Cancel</button>
          <button className="button button-secondary" disabled={Boolean(saving)} type="submit">{saving === "draft" ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Save draft</button>
          <button className="button" disabled={Boolean(saving)} onClick={(event) => submit(event, true)} type="button">{saving === "issue" ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />} Save & send</button>
        </div>
      </form>
    </Dialog>
  )
}
