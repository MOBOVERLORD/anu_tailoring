import { useEffect, useMemo, useState } from "react"
import { Banknote, CircleDollarSign, LoaderCircle, RefreshCw, RotateCcw, Save, Search, ShieldCheck, WalletCards } from "lucide-react"
import toast from "react-hot-toast"
import { Dialog } from "@/components/Dialog"
import { AppSelect } from "@/components/ui/AppSelect"
import { api } from "@/lib/api"
import type { PaymentTransaction, VendorSettlement } from "@/types/api"

interface PaymentOperationsProps {
  isSuperAdmin: boolean
}

const transactionStatuses = ["all", "created", "captured", "failed", "refund_pending", "partially_refunded", "refunded", "refund_failed"]
const settlementStatuses = ["pending", "held", "paid", "cancelled", "recovery_required"] as const
const money = (value: number) => `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—"

const SettlementCard = ({ canEdit, onUpdated, settlement }: { canEdit: boolean; onUpdated: (value: VendorSettlement) => void; settlement: VendorSettlement }) => {
  const [draft, setDraft] = useState({
    status: settlement.status,
    payable_amount: String(settlement.payable_amount),
    platform_fee_amount: String(settlement.platform_fee_amount),
    payout_reference: settlement.payout_reference || "",
    notes: settlement.notes || "",
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => setDraft({
    status: settlement.status,
    payable_amount: String(settlement.payable_amount),
    platform_fee_amount: String(settlement.platform_fee_amount),
    payout_reference: settlement.payout_reference || "",
    notes: settlement.notes || "",
  }), [settlement])

  const save = async () => {
    const payable = Number(draft.payable_amount)
    const fee = Number(draft.platform_fee_amount)
    if (!Number.isFinite(payable) || payable < 0 || !Number.isFinite(fee) || fee < 0) {
      toast.error("Enter valid payout amounts")
      return
    }
    setSaving(true)
    try {
      const updated = await api<VendorSettlement>(`/api/payments/razorpay/admin/settlements/${settlement.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...draft, payable_amount: payable, platform_fee_amount: fee }),
      })
      onUpdated(updated)
      toast.success(updated.status === "paid" ? "Vendor payout recorded" : "Settlement updated")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return <article className="settlement-admin-card">
    <header><div><span className={`payment-state state-${settlement.status}`}>{settlement.status.replaceAll("_", " ")}</span><h3>{settlement.vendor_name}</h3><small>Order #{settlement.order_id} · {settlement.payment_stage === "cloth" ? "Cloth advance" : "Final balance"}</small></div><strong>{money(settlement.payable_amount)}</strong></header>
    <div className="payment-metrics"><span><small>Customer payment</small><strong>{money(settlement.gross_amount)}</strong></span><span><small>Platform delivery retained</small><strong>{money(settlement.platform_delivery_amount)}</strong></span><span><small>Platform fee</small><strong>{money(settlement.platform_fee_amount)}</strong></span><span><small>Vendor payable</small><strong>{money(settlement.payable_amount)}</strong></span></div>
    <div className="payment-reference-row"><span><small>Payment ID</small><code>{settlement.provider_payment_id || "Awaiting payment ID"}</code></span><span><small>Paid at</small><strong>{dateTime(settlement.paid_at)}</strong></span></div>
    {canEdit ? <div className="settlement-form"><div className="field"><label htmlFor={`settlement-status-${settlement.id}`}>Payout status</label><AppSelect id={`settlement-status-${settlement.id}`} onValueChange={(value) => setDraft({ ...draft, status: value as VendorSettlement["status"] })} options={settlementStatuses.map((status) => ({ value: status, label: status.replaceAll("_", " ") }))} value={draft.status} /></div><div className="field"><label htmlFor={`settlement-payable-${settlement.id}`}>Vendor payable (₹)</label><input id={`settlement-payable-${settlement.id}`} min="0" onChange={(event) => setDraft({ ...draft, payable_amount: event.target.value })} step="0.01" type="number" value={draft.payable_amount} /></div><div className="field"><label htmlFor={`settlement-fee-${settlement.id}`}>Platform fee (₹)</label><input id={`settlement-fee-${settlement.id}`} min="0" onChange={(event) => setDraft({ ...draft, platform_fee_amount: event.target.value })} step="0.01" type="number" value={draft.platform_fee_amount} /></div><div className="field"><label htmlFor={`settlement-reference-${settlement.id}`}>Bank / payout reference</label><input id={`settlement-reference-${settlement.id}`} maxLength={150} onChange={(event) => setDraft({ ...draft, payout_reference: event.target.value })} value={draft.payout_reference} /></div><div className="field settlement-notes"><label htmlFor={`settlement-notes-${settlement.id}`}>Internal notes</label><textarea id={`settlement-notes-${settlement.id}`} maxLength={2000} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} rows={2} value={draft.notes} /></div><button className="button" disabled={saving} onClick={() => void save()} type="button">{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Save settlement</button></div> : <p className="payment-read-only"><ShieldCheck size={16} /> Super-administrator access is required to record payouts.</p>}
  </article>
}

export const PaymentOperations = ({ isSuperAdmin }: PaymentOperationsProps) => {
  const [view, setView] = useState<"transactions" | "settlements">("transactions")
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([])
  const [settlements, setSettlements] = useState<VendorSettlement[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [refunding, setRefunding] = useState<PaymentTransaction | null>(null)
  const [refundForm, setRefundForm] = useState({ amount: "", reason: "" })
  const [submittingRefund, setSubmittingRefund] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [loadedTransactions, loadedSettlements] = await Promise.all([
        api<PaymentTransaction[]>("/api/payments/razorpay/admin/transactions?limit=250"),
        api<VendorSettlement[]>("/api/payments/razorpay/admin/settlements?limit=250"),
      ])
      setTransactions(loadedTransactions)
      setSettlements(loadedSettlements)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const filteredTransactions = useMemo(() => {
    const query = search.trim().toLowerCase()
    return transactions.filter((transaction) => (statusFilter === "all" || transaction.status === statusFilter) && (!query || [transaction.provider_order_id, transaction.provider_payment_id || "", transaction.customer_name, transaction.vendor_name, String(transaction.order_id)].some((value) => value.toLowerCase().includes(query))))
  }, [search, statusFilter, transactions])
  const filteredSettlements = useMemo(() => {
    const query = search.trim().toLowerCase()
    return settlements.filter((settlement) => (statusFilter === "all" || settlement.status === statusFilter) && (!query || [settlement.vendor_name, settlement.provider_payment_id || "", String(settlement.order_id)].some((value) => value.toLowerCase().includes(query))))
  }, [search, settlements, statusFilter])

  const openRefund = (transaction: PaymentTransaction) => {
    setRefunding(transaction)
    setRefundForm({ amount: String(Math.max(0, transaction.amount - transaction.amount_refunded)), reason: "" })
  }

  const submitRefund = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!refunding) return
    const amount = Number(refundForm.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid refund amount")
      return
    }
    setSubmittingRefund(true)
    try {
      const updated = await api<PaymentTransaction>(`/api/payments/razorpay/admin/transactions/${refunding.id}/refund`, { method: "POST", body: JSON.stringify({ amount, reason: refundForm.reason }) })
      setTransactions((current) => current.map((item) => item.id === updated.id ? updated : item))
      setRefunding(null)
      await load()
      toast.success("Refund submitted to Razorpay")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSubmittingRefund(false)
    }
  }

  return <section className="admin-panel payment-operations">
    <div className="admin-panel-heading"><div><p className="eyebrow">Payment operations</p><h2>Transactions, refunds & vendor payouts</h2><p>Razorpay remains the payment source of truth. Vendor payouts below are internal records until Route or another payout provider is enabled.</p></div><button className="button button-secondary" disabled={loading} onClick={() => void load()} type="button"><RefreshCw size={16} /> Refresh</button></div>
    <div className="payment-view-tabs"><button className={view === "transactions" ? "active" : ""} onClick={() => { setView("transactions"); setStatusFilter("all") }} type="button"><WalletCards size={17} /> Transactions <span>{transactions.length}</span></button><button className={view === "settlements" ? "active" : ""} onClick={() => { setView("settlements"); setStatusFilter("all") }} type="button"><Banknote size={17} /> Vendor settlements <span>{settlements.length}</span></button></div>
    <div className="payment-toolbar"><label className="search-field"><Search size={17} /><input aria-label="Search payments" onChange={(event) => setSearch(event.target.value)} placeholder="Order, customer, vendor, payment ID…" value={search} /></label><AppSelect ariaLabel="Filter payment status" className="toolbar-select" onValueChange={setStatusFilter} options={(view === "transactions" ? transactionStatuses : ["all", ...settlementStatuses]).map((status) => ({ value: status, label: status.replaceAll("_", " ") }))} value={statusFilter} /></div>
    {loading ? <div className="loading-state"><LoaderCircle className="spin" /> Loading payment records…</div> : view === "transactions" ? <div className="payment-admin-list">{filteredTransactions.length ? filteredTransactions.map((transaction) => {
      const remaining = Math.max(0, transaction.amount - transaction.amount_refunded)
      const canRefund = isSuperAdmin && Boolean(transaction.provider_payment_id) && remaining > 0 && ["captured", "partially_refunded", "refund_failed"].includes(transaction.status)
      return <article className="payment-admin-card" key={transaction.id}><header><div><span className={`payment-state state-${transaction.status}`}>{transaction.status.replaceAll("_", " ")}</span><h3>Order #{transaction.order_id}</h3><small>{transaction.payment_stage === "cloth" ? "Cloth advance" : "Final order balance"} · {transaction.customer_name} → {transaction.vendor_name}</small></div><strong>{money(transaction.amount)}</strong></header><div className="payment-metrics"><span><small>Captured</small><strong>{dateTime(transaction.captured_at)}</strong></span><span><small>Refunded</small><strong>{money(transaction.amount_refunded)}</strong></span><span><small>Remaining</small><strong>{money(remaining)}</strong></span><span><small>Currency</small><strong>{transaction.currency}</strong></span></div><div className="payment-reference-row"><span><small>Razorpay order</small><code>{transaction.provider_order_id}</code></span><span><small>Payment ID</small><code>{transaction.provider_payment_id || "Not captured"}</code></span>{transaction.provider_refund_id && <span><small>Latest refund</small><code>{transaction.provider_refund_id}</code></span>}</div>{transaction.failure_reason && <p className="payment-failure">{transaction.failure_reason}</p>}{canRefund && <button className="button button-secondary payment-refund-button" onClick={() => openRefund(transaction)} type="button"><RotateCcw size={16} /> Refund payment</button>}</article>
    }) : <div className="admin-empty"><CircleDollarSign size={34} /><h3>No matching transactions</h3><p>Payment orders appear here after checkout is opened.</p></div>}</div> : <div className="payment-admin-list">{filteredSettlements.length ? filteredSettlements.map((settlement) => <SettlementCard canEdit={isSuperAdmin} key={settlement.id} onUpdated={(updated) => setSettlements((current) => current.map((item) => item.id === updated.id ? updated : item))} settlement={settlement} />) : <div className="admin-empty"><Banknote size={34} /><h3>No matching settlements</h3><p>A pending settlement is created after a payment is captured.</p></div>}</div>}
    {refunding && <Dialog description={`Captured ${money(refunding.amount)} · already refunded ${money(refunding.amount_refunded)}`} onClose={() => setRefunding(null)} title={`Refund order #${refunding.order_id}`}><form className="dialog-form form-stack" onSubmit={submitRefund}><div className="refund-warning"><RotateCcw size={19} /><p><strong>This sends money back through Razorpay.</strong><br />The vendor settlement will be held or marked for recovery. Confirm the order and payment ID before continuing.</p></div><div className="field"><label htmlFor="refund-amount">Refund amount (₹)</label><input id="refund-amount" max={Math.max(0, refunding.amount - refunding.amount_refunded)} min="1" onChange={(event) => setRefundForm({ ...refundForm, amount: event.target.value })} required step="0.01" type="number" value={refundForm.amount} /></div><div className="field"><label htmlFor="refund-reason">Internal refund reason</label><textarea id="refund-reason" maxLength={500} minLength={5} onChange={(event) => setRefundForm({ ...refundForm, reason: event.target.value })} required rows={3} value={refundForm.reason} /></div><div className="dialog-actions"><button className="button button-secondary" onClick={() => setRefunding(null)} type="button">Keep payment</button><button className="button danger" disabled={submittingRefund} type="submit">{submittingRefund ? <LoaderCircle className="spin" size={16} /> : <RotateCcw size={16} />} Submit refund</button></div></form></Dialog>}
  </section>
}
