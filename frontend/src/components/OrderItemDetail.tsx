import { useEffect, useRef, useState } from "react"
import { Check, ChevronRight, CircleDollarSign, Clock3, ExternalLink, FilePenLine, FileText, LoaderCircle, MapPin, MessageSquare, PackageCheck, Paperclip, Play, Printer, Ruler, Send, Shirt, Truck, Upload, XCircle } from "lucide-react"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog"
import { OrderCancellationDialog } from "@/components/OrderCancellationDialog"
import { VendorInvoiceDialog } from "@/components/VendorInvoiceDialog"
import { MapAttribution } from "@/components/MapAttribution"
import { api, apiBlob } from "@/lib/api"
import type { Order, OrderComment, OrderItem, UserProfile, WorkStatus } from "@/types/api"

const workLabels: Record<WorkStatus, string> = {
  awaiting_invoice: "Invoice required",
  awaiting_approval: "Awaiting customer approval",
  awaiting_cloth_payment: "Awaiting cloth payment",
  awaiting_payment_verification: "Verify cloth payment",
  awaiting_cloth: "Awaiting customer cloth",
  ready_to_start: "Ready to start",
  fabric_cutting: "Fabric cutting",
  stitching: "Stitching",
  quality_check: "Quality check",
  completed: "Completed",
  rejected: "Rejected by vendor",
  cancelled: "Cancelled by customer",
}

interface OrderItemDetailProps {
  item: OrderItem
  order: Order
  profile: UserProfile
  onUpdated: (item: OrderItem) => void
  onOrderUpdated: (order: Order) => void
}

interface PendingConfirmation {
  title: string
  description: string
  confirmLabel: string
  action: () => Promise<boolean>
}

export const OrderItemDetail = ({ item, order, profile, onUpdated, onOrderUpdated }: OrderItemDetailProps) => {
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [comment, setComment] = useState("")
  const [decisionNote, setDecisionNote] = useState("")
  const [paymentReference, setPaymentReference] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [printTarget, setPrintTarget] = useState(false)
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [liveComments, setLiveComments] = useState<OrderComment[]>(item.comments)
  const [chatStatus, setChatStatus] = useState<"connecting" | "live" | "reconnecting">("connecting")
  const latestCommentId = useRef(Math.max(0, ...item.comments.map((entry) => entry.id)))
  const chatSocket = useRef<WebSocket | null>(null)
  const invoice = item.invoice
  const delivery = order.deliveries.find((entry) => entry.vendor_id === item.design.vendor_id)
  const isVendor = profile.role === "vendor" && item.design.vendor_id === profile.id
  const isCustomer = order.customer.id === profile.id
  const itemClosed = item.work_status === "rejected" || item.work_status === "cancelled"
  const canVendorReject = isVendor && !itemClosed && invoice?.status !== "approved"

  useEffect(() => {
    setLiveComments((current) => {
      const merged = new Map(current.map((entry) => [entry.id, entry]))
      item.comments.forEach((entry) => merged.set(entry.id, entry))
      return [...merged.values()].sort((a, b) => a.id - b.id)
    })
    latestCommentId.current = Math.max(latestCommentId.current, ...item.comments.map((entry) => entry.id))
  }, [item.comments])

  useEffect(() => {
    let active = true
    let reconnectTimer: number | undefined
    let attempt = 0
    const connect = async () => {
      if (!active) return
      setChatStatus(attempt ? "reconnecting" : "connecting")
      try {
        const { ticket } = await api<{ ticket: string }>(`/api/orders/items/${item.id}/chat-ticket`, { method: "POST" })
        if (!active) return
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
        const socket = new WebSocket(`${protocol}//${window.location.host}/api/orders/items/${item.id}/chat?ticket=${encodeURIComponent(ticket)}&after_id=${latestCommentId.current}`)
        chatSocket.current = socket
        socket.onopen = () => { attempt = 0; setChatStatus("live") }
        socket.onmessage = (event) => {
          const payload = JSON.parse(event.data) as { type: string; comment?: OrderComment; message?: string }
          if (payload.type === "message" && payload.comment) {
            latestCommentId.current = Math.max(latestCommentId.current, payload.comment.id)
            setLiveComments((current) => current.some((entry) => entry.id === payload.comment?.id) ? current : [...current, payload.comment!])
          } else if (payload.type === "error" && payload.message) toast.error(payload.message)
        }
        socket.onerror = () => socket.close()
        socket.onclose = () => {
          if (!active) return
          setChatStatus("reconnecting")
          attempt += 1
          reconnectTimer = window.setTimeout(() => { void connect() }, Math.min(15_000, 1_000 * 2 ** Math.min(attempt, 4)))
        }
      } catch {
        if (!active) return
        setChatStatus("reconnecting")
        attempt += 1
        reconnectTimer = window.setTimeout(() => { void connect() }, Math.min(15_000, 1_000 * 2 ** Math.min(attempt, 4)))
      }
    }
    void connect()
    return () => {
      active = false
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      chatSocket.current?.close()
      chatSocket.current = null
    }
  }, [item.id])

  const rejectOrderItem = async (reason: string) => {
    setBusy("reject")
    try {
      const updated = await api<Order>(`/api/orders/vendor/items/${item.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      })
      onOrderUpdated(updated)
      setRejecting(false)
      toast.success("Order item rejected and the customer was notified")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const runAction = async (name: string, path: string, body?: unknown) => {
    setBusy(name)
    try {
      const updated = await api<OrderItem>(path, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      onUpdated(updated)
      return true
    } catch (error) {
      toast.error((error as Error).message)
      return false
    } finally {
      setBusy(null)
    }
  }

  const addComment = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!comment.trim()) return
    if (chatSocket.current?.readyState !== WebSocket.OPEN) {
      toast.error("Chat is reconnecting. Try again in a moment.")
      return
    }
    chatSocket.current.send(JSON.stringify({ type: "message", message: comment.trim() }))
    setComment("")
  }

  const uploadClothBill = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Cloth bill proof must be 5 MB or smaller")
      return
    }
    setBusy("bill")
    try {
      const body = new FormData()
      body.append("file", file)
      const updated = await api<OrderItem>(`/api/orders/vendor/items/${item.id}/invoice/cloth-bill`, { method: "POST", body })
      onUpdated(updated)
      toast.success("Cloth bill attached")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(null)
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
      } else {
        const link = document.createElement("a")
        link.href = objectUrl
        link.download = invoice.cloth_bill_filename || "cloth-bill"
        link.click()
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (error) {
      preview?.close()
      toast.error((error as Error).message)
    }
  }

  const decideInvoice = async (decision: "approved" | "change_requested") => {
    if (decision === "change_requested" && !decisionNote.trim()) {
      toast.error("Add a note explaining the requested change")
      return false
    }
    const completed = await runAction("decision", `/api/orders/items/${item.id}/invoice/decision`, { decision, comment: decisionNote || null })
    if (completed) {
      setDecisionNote("")
      toast.success(decision === "approved" ? "Invoice approved" : "Changes requested")
    }
    return completed
  }

  const printInvoice = () => {
    setPrintTarget(true)
    window.setTimeout(() => {
      window.print()
      setPrintTarget(false)
    }, 50)
  }

  const measurements = Object.entries(item.measurement_snapshot?.measurements || {})
  const unit = item.measurement_snapshot?.unit === "cm" ? "cm" : "in"
  const invoiceApproved = invoice?.status === "approved"
  const clothReady = Boolean(invoiceApproved && (
    invoice?.cloth_source === "customer_provided"
      ? invoice.cloth_received
      : invoice && (invoice.cloth_cost <= 0 || invoice.payment_status === "paid")
  ))
  const tailoringStarted = ["fabric_cutting", "stitching", "quality_check", "completed"].includes(item.work_status)
  const tailoringComplete = item.work_status === "completed"
  const workflowSteps = [
    {
      label: "Vendor quote",
      detail: invoice
        ? invoice.status === "draft"
          ? "Draft saved"
          : invoice.status === "change_requested"
            ? "Changes requested"
            : "Invoice prepared"
        : "Not started",
      complete: Boolean(invoice && ["issued", "approved"].includes(invoice.status)),
      current: !invoice || invoice.status === "draft" || invoice.status === "change_requested",
    },
    {
      label: "Customer approval",
      detail: invoiceApproved ? "Approved" : invoice?.status === "issued" ? "Review needed" : "Waiting",
      complete: Boolean(invoiceApproved),
      current: invoice?.status === "issued",
    },
    {
      label: "Cloth ready",
      detail: clothReady ? "Ready" : invoiceApproved ? "Action needed" : "Waiting",
      complete: clothReady,
      current: Boolean(invoiceApproved && !clothReady),
    },
    {
      label: "Tailoring",
      detail: tailoringComplete ? "Completed" : tailoringStarted ? workLabels[item.work_status] : "Not started",
      complete: tailoringComplete,
      current: clothReady && !tailoringComplete,
    },
  ]

  const confirmPendingAction = async () => {
    if (!confirmation) return
    const completed = await confirmation.action()
    if (completed) setConfirmation(null)
  }

  return (
    <div className="order-item-detail">
      <section className="order-detail-grid">
        <div className="order-detail-design">
          <div className="order-detail-image">{item.design.image_url ? <ApiImage alt={item.design.title} src={item.design.image_url} /> : <Shirt size={34} />}</div>
          <div><span className={`work-status work-${item.work_status}`}><Clock3 size={13} /> {workLabels[item.work_status]}</span><h3>{item.design.title}</h3><p>{item.design.vendor_name || "Vastrivo"}</p><strong>Tailoring service: ₹{item.price.toLocaleString("en-IN")}</strong>{canVendorReject && <button className="button button-secondary danger-text order-reject-button" disabled={Boolean(busy)} onClick={() => setRejecting(true)} type="button"><XCircle size={16} /> Reject order</button>}</div>
        </div>
        <div className="order-detail-measurements">
          <div className="subsection-heading"><Ruler size={17} /><div><strong>{item.measurement_profile.profile_name}</strong><small>{item.measurement_profile.garment_type.replaceAll("_", " ")} · {item.measurement_profile.standard_size || "Custom fit"}</small></div></div>
          <div className="measurement-detail-chips">{measurements.map(([key, value]) => <span key={key}><small>{key.replaceAll("_", " ")}</small><strong>{value} {unit}</strong></span>)}</div>
          {item.custom_instructions && <p className="customer-order-note">Customer note: “{item.custom_instructions}”</p>}
        </div>
      </section>

      {!itemClosed && <ol aria-label="Order item progress" className="order-workflow">
        {workflowSteps.map((step, index) => (
          <li className={step.complete ? "is-complete" : step.current ? "is-current" : ""} key={step.label}>
            <span>{step.complete ? <Check size={15} /> : index + 1}</span>
            <div><strong>{step.label}</strong><small>{step.detail}</small></div>
          </li>
        ))}
      </ol>}

      {delivery && (
        <section className="order-delivery-summary">
          <Truck size={22} />
          <div>
            <small>Platform-calculated delivery · {delivery.provider_name}</small>
            <strong>{(delivery.distance_meters / 1000).toFixed(1)} km · ₹{delivery.delivery_cost.toLocaleString("en-IN")}</strong><MapAttribution provider={delivery.maps_provider} />
            <p><MapPin size={14} /> {delivery.destination_address}</p>
          </div>
          <span className={`delivery-status status-${delivery.status}`}>{delivery.status.replaceAll("_", " ")}</span>
          {delivery.tracking_url && <a className="button button-secondary" href={delivery.tracking_url} rel="noreferrer" target="_blank"><ExternalLink size={14} /> Track</a>}
        </section>
      )}

      {itemClosed ? (
        <section className="order-closed-state"><XCircle size={25} /><div><h3>{item.work_status === "rejected" ? "Vendor rejected this item" : "Customer cancelled this order"}</h3><p>No invoice or tailoring actions can continue. The reason is recorded in the conversation below.</p></div></section>
      ) : !invoice ? (
        <section className="invoice-empty-state">
          <FileText size={27} /><div><h3>{isVendor ? "Create the job invoice" : "Waiting for vendor invoice"}</h3><p>{isVendor ? `The customer selected ${item.cloth_source === "vendor_supplied" ? "vendor-supplied" : "customer-supplied"} cloth. Add mandatory requirements and any agreed products; delivery is already calculated.` : "The vendor will provide cloth requirements and the itemized tailoring cost breakdown before work begins."}</p></div>
          {isVendor && <button className="button" onClick={() => setInvoiceOpen(true)} type="button"><FilePenLine size={16} /> Create invoice</button>}
        </section>
      ) : (
        <section className={`invoice-sheet ${printTarget ? "print-target" : ""}`}>
          <header className="invoice-sheet-head"><div><p className="eyebrow">Vendor invoice</p><h3>{invoice.invoice_number}</h3><small>Order #{order.id} · {item.design.title}</small></div><div><span className={`invoice-status invoice-${invoice.status}`}>{invoice.status.replaceAll("_", " ")}</span><button className="icon-button" onClick={printInvoice} title="Print or save invoice as PDF" type="button"><Printer size={17} /></button></div></header>
          <div className="invoice-parties"><div><small>Customer</small><strong>{order.customer.full_name}</strong><span>{order.customer.phone || order.customer.email}</span></div><div><small>Vendor</small><strong>{item.design.vendor_name || "Vastrivo"}</strong><span>{item.design.garment_type}</span></div></div>
          <div className="cloth-requirement-card"><Shirt size={18} /><div><small>Cloth requirement · {invoice.cloth_source === "customer_provided" ? "Customer provides cloth" : "Vendor supplies cloth"}</small><strong>{invoice.cloth_type}</strong><p>{invoice.cloth_requirement}</p></div></div>
          {invoice.line_items.length > 0 && <div className="invoice-line-summary"><div className="invoice-line-summary-head"><strong>Additional products and costs</strong><span>₹{invoice.additional_amount.toLocaleString("en-IN")}</span></div>{invoice.line_items.map((line) => <div key={line.id}><span><strong>{line.name}</strong>{line.description && <small>{line.description}</small>}</span><span>{line.quantity} × ₹{line.unit_price.toLocaleString("en-IN")}</span><b>₹{line.total_amount.toLocaleString("en-IN")}</b></div>)}</div>}
          <div className="invoice-costs"><span><small>Tailoring service</small><strong>₹{invoice.service_amount.toLocaleString("en-IN")}</strong></span><span><small>Cloth</small><strong>{invoice.cloth_source === "customer_provided" ? "Customer supplied" : `₹${invoice.cloth_cost.toLocaleString("en-IN")}`}</strong></span><span><small>Additional items</small><strong>₹{invoice.additional_amount.toLocaleString("en-IN")}</strong></span><span className="invoice-grand-total"><small>Vendor invoice total</small><strong>₹{invoice.total_amount.toLocaleString("en-IN")}</strong></span></div>
          {invoice.cloth_source === "vendor_supplied" && invoice.cloth_cost > 0 && <div className={`cloth-bill-proof ${invoice.cloth_bill_url ? "is-attached" : "is-missing"}`}><Paperclip size={18} /><div><small>Cloth purchase proof</small><strong>{invoice.cloth_bill_filename || "Bill not attached yet"}</strong><p>{invoice.cloth_bill_url ? "The customer can review this private attachment before submitting payment." : "Required before the customer can finalize cloth payment."}</p></div>{invoice.cloth_bill_url && <button className="button button-secondary" onClick={openClothBill} type="button"><ExternalLink size={15} /> View bill</button>}{isVendor && invoice.status === "approved" && invoice.payment_status === "pending" && <label className="button button-secondary cloth-bill-upload"><input accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy === "bill"} onChange={(event) => { void uploadClothBill(event.target.files); event.target.value = "" }} type="file" />{busy === "bill" ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />} {invoice.cloth_bill_url ? "Replace bill" : "Attach bill"}</label>}</div>}
          <div className="invoice-readiness"><span><Check size={15} /> Approval: <strong>{invoice.status === "approved" ? "Approved" : "Pending"}</strong></span>{invoice.cloth_source === "vendor_supplied" && invoice.cloth_cost > 0 ? <><span><Paperclip size={15} /> Cloth bill: <strong>{invoice.cloth_bill_url ? "Attached" : "Required"}</strong></span><span><CircleDollarSign size={15} /> Cloth payment: <strong>{invoice.payment_status.replaceAll("_", " ")}</strong></span></> : <span><PackageCheck size={15} /> Cloth received: <strong>{invoice.cloth_source === "vendor_supplied" || invoice.cloth_received ? "Ready" : "Pending"}</strong></span>}</div>

          {isVendor && (
            <div className="invoice-actions">
              {(invoice.status === "draft" || invoice.status === "change_requested") && <button className="button button-secondary" onClick={() => setInvoiceOpen(true)} type="button"><FilePenLine size={16} /> Edit invoice</button>}
              {invoice.status === "draft" && <button className="button" disabled={Boolean(busy)} onClick={async () => { if (await runAction("issue", `/api/orders/vendor/items/${item.id}/invoice/issue`)) toast.success("Invoice sent") }} type="button"><Send size={16} /> Send to customer</button>}
              {invoice.payment_status === "submitted" && <button className="button" disabled={Boolean(busy)} onClick={() => setConfirmation({ title: "Verify this cloth payment?", description: `Confirm that payment reference ${invoice.payment_reference || "provided by the customer"} has been received. This will unlock the tailoring job.`, confirmLabel: "Verify payment", action: async () => { const done = await runAction("verify", `/api/orders/vendor/items/${item.id}/invoice/verify-payment`); if (done) toast.success("Cloth payment verified"); return done } })} type="button"><CircleDollarSign size={16} /> Verify payment {invoice.payment_reference && `(${invoice.payment_reference})`}</button>}
              {invoice.status === "approved" && invoice.cloth_source === "customer_provided" && !invoice.cloth_received && <button className="button" disabled={Boolean(busy)} onClick={() => setConfirmation({ title: "Confirm cloth receipt?", description: "Confirm that you physically received the customer’s cloth and that it matches the stated requirement.", confirmLabel: "Cloth received", action: async () => { const done = await runAction("cloth", `/api/orders/vendor/items/${item.id}/cloth-received`); if (done) toast.success("Customer cloth marked received"); return done } })} type="button"><PackageCheck size={16} /> Confirm cloth received</button>}
              {item.work_status === "ready_to_start" && <button className="button" disabled={Boolean(busy)} onClick={() => setConfirmation({ title: "Start this tailoring job?", description: "The order will move into fabric cutting and the customer will be notified that work has started.", confirmLabel: "Start tailoring", action: async () => { const done = await runAction("start", `/api/orders/vendor/items/${item.id}/start`); if (done) toast.success("Tailoring job started"); return done } })} type="button"><Play size={16} /> Start tailoring job</button>}
            </div>
          )}

          {isCustomer && invoice.status === "issued" && (
            <div className="customer-invoice-decision"><div className="field"><label htmlFor={`decision-${item.id}`}>Note to vendor <small>required for changes</small></label><textarea id={`decision-${item.id}`} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Ask a question or explain a requested change" rows={2} value={decisionNote} /></div><div><button className="button button-secondary" disabled={Boolean(busy)} onClick={() => decideInvoice("change_requested")} type="button">Request changes</button><button className="button" disabled={Boolean(busy)} onClick={() => setConfirmation({ title: "Approve this invoice?", description: `You are approving a total of ₹${invoice.total_amount.toLocaleString("en-IN")} and the stated cloth requirement. Request changes first if anything is incorrect.`, confirmLabel: "Approve invoice", action: () => decideInvoice("approved") })} type="button"><Check size={16} /> Approve invoice</button></div></div>
          )}

          {isCustomer && invoice.status === "approved" && invoice.payment_status === "pending" && invoice.cloth_bill_url && (
            <div className="cloth-payment-form"><div><CircleDollarSign size={19} /><span><strong>Pay cloth cost: ₹{invoice.cloth_cost.toLocaleString("en-IN")}</strong><small>Use the vendor’s agreed offline payment method, then submit the transaction reference for verification.</small></span></div><div><input aria-label="Payment reference" onChange={(event) => setPaymentReference(event.target.value)} placeholder="UPI / bank transaction reference" value={paymentReference} /><button className="button" disabled={Boolean(busy) || paymentReference.trim().length < 3} onClick={() => setConfirmation({ title: "Submit this payment reference?", description: `Confirm that you paid ₹${invoice.cloth_cost.toLocaleString("en-IN")} for cloth using reference ${paymentReference.trim()}. The vendor will verify receipt.`, confirmLabel: "Submit reference", action: async () => { const done = await runAction("payment", `/api/orders/items/${item.id}/invoice/payment`, { payment_reference: paymentReference }); if (done) { setPaymentReference(""); toast.success("Payment reference sent for verification") } return done } })} type="button">Submit payment reference</button></div></div>
          )}
        </section>
      )}

      <section className="order-comments">
        <div className="subsection-heading"><MessageSquare size={17} /><div><strong>Order chat <span className={`chat-live-indicator ${chatStatus}`}><i /> {chatStatus === "live" ? "Live" : chatStatus === "connecting" ? "Connecting" : "Reconnecting"}</span></strong><small>Customer, vendor, and administrators can keep job messages together.</small></div></div>
        <div aria-live="polite" className="comment-list">{liveComments.length ? liveComments.map((entry) => <article className={entry.author_id === profile.id ? "mine" : ""} key={entry.id}><div className="chat-message-meta"><strong>{entry.author_name}</strong><span><em>{entry.author_role.replaceAll("_", " ")}</em><time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</time></span></div><p>{entry.message}</p></article>) : <p className="comment-empty">No messages yet. Use this chat for cloth, fit, or delivery questions.</p>}</div>
        <form className="comment-form" onSubmit={addComment}><input aria-label="Send order chat message" disabled={chatStatus !== "live"} onChange={(event) => setComment(event.target.value)} placeholder={chatStatus === "live" ? "Write a message…" : "Reconnecting to chat…"} value={comment} /><button className="button" disabled={chatStatus !== "live" || !comment.trim()} type="submit"><ChevronRight size={16} /> Send</button></form>
      </section>

      {invoiceOpen && <VendorInvoiceDialog item={item} onClose={() => setInvoiceOpen(false)} onUpdated={onUpdated} />}
      {confirmation && <ConfirmActionDialog busy={Boolean(busy)} confirmLabel={confirmation.confirmLabel} description={confirmation.description} onCancel={() => setConfirmation(null)} onConfirm={confirmPendingAction} title={confirmation.title} />}
      {rejecting && <OrderCancellationDialog busy={busy === "reject"} confirmLabel="Reject order" description="Rejecting this design removes it from the active job and cancels your delivery charge when no other items from your shop remain. You cannot reject it after the customer accepts the invoice." onCancel={() => setRejecting(false)} onConfirm={(reason) => void rejectOrderItem(reason)} title={`Reject ${item.design.title}?`} />}
    </div>
  )
}
