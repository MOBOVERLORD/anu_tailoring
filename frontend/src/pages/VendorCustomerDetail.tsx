import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import toast from "react-hot-toast"
import { VendorStudioNav } from "@/components/VendorStudioNav"
import { CustomerMeasurements } from "@/components/CustomerMeasurements"
import { api } from "@/lib/api"
import { customerStatuses } from "@/lib/vendorCustomers"
import type { VendorCustomer } from "@/lib/vendorCustomers"

export default function VendorCustomerDetail() {
  const { relationshipId } = useParams()
  const [customer, setCustomer] = useState<VendorCustomer | null>(null)
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let current = true
    setCustomer(null); setError("")
    api<VendorCustomer>(`/api/vendor/customers/${relationshipId}`).then((record) => {
      if (current) { setCustomer(record); setNotes(record.vendor_notes || "") }
    }).catch((reason: Error) => { if (current) setError(reason.message) })
    return () => { current = false }
  }, [relationshipId, retry])
  async function saveNotes() {
    if (saving) return
    setSaving(true)
    try {
      const record = await api<VendorCustomer>(`/api/vendor/customers/${relationshipId}`, { method: "PATCH", body: JSON.stringify({ vendor_notes: notes.trim() || null }) })
      setCustomer(record); setNotes(record.vendor_notes || ""); toast.success("Private notes saved")
    } catch (reason) { toast.error((reason as Error).message) }
    finally { setSaving(false) }
  }
  return <div className="page workspace-page customer-workspace"><VendorStudioNav /><Link to="/vendor/customers">Back to customers</Link>
    {error ? <div role="alert"><p>{error}</p><button className="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></div> : !customer ? <p role="status">Loading customer…</p> : <>
      <div className="section-heading"><div><h1>{customer.full_name}</h1><p>{customerStatuses[customer.status]} · {customer.account_role} account</p></div></div>
      <article className="record-card"><h2>Customer details</h2><p>{customer.email}</p><p>{customer.phone || "No phone"}</p>
        {([ ["Created", customer.created_at], ["Invited", customer.invited_at], ["Accepted", customer.accepted_at], ["Declined", customer.declined_at] ] as const).map(([label, value]) => value && <p key={label}>{label}: {new Date(value).toLocaleString()}</p>)}
        <form className="customer-form" onSubmit={(event) => { event.preventDefault(); void saveNotes() }}><div className="field"><label htmlFor="private-notes">Private vendor notes</label><textarea id="private-notes" rows={4} maxLength={2000} value={notes} disabled={saving} onChange={(event) => setNotes(event.target.value)} /><small>Visible only to your vendor account.</small></div><button className="button button-primary" disabled={saving} type="submit">{saving ? "Saving…" : "Save notes"}</button></form>
      </article>
      <CustomerMeasurements key={customer.id} relationshipId={customer.id} declined={customer.status === "declined"} />
    </>}
  </div>
}
