import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import { Dialog } from "@/components/Dialog"
import { VendorStudioNav } from "@/components/VendorStudioNav"
import { AppSelect } from "@/components/ui/AppSelect"
import { api } from "@/lib/api"
import { customerStatuses } from "@/lib/vendorCustomers"
import type { CustomerPage, VendorCustomer } from "@/lib/vendorCustomers"

export default function VendorCustomers() {
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all")
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<CustomerPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  const [mode, setMode] = useState<"link" | "invite" | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let current = true
    setLoading(true)
    setError("")
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ query: query.trim(), limit: "20", offset: String(offset) })
      if (status !== "all") params.set("status", status)
      api<CustomerPage>(`/api/vendor/customers?${params}`).then((result) => {
        if (current) setPage(result)
      }).catch((reason: Error) => { if (current) setError(reason.message) })
        .finally(() => { if (current) setLoading(false) })
    }, 350)
    return () => { current = false; window.clearTimeout(timer) }
  }, [query, status, offset, retry])

  async function addCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !mode) return
    const form = new FormData(event.currentTarget)
    setSaving(true)
    try {
      const customer = await api<VendorCustomer>(`/api/vendor/customers/${mode}`, {
        method: "POST",
        body: JSON.stringify({ email: String(form.get("email")).trim(), phone: String(form.get("phone")).trim(),
          ...(mode === "invite" ? { full_name: String(form.get("full_name")).trim() } : {}),
          vendor_notes: String(form.get("vendor_notes")).trim() || null }),
      })
      navigate(`/vendor/customers/${customer.id}`)
    } catch (reason) { toast.error((reason as Error).message) }
    finally { setSaving(false) }
  }

  return <div className="page workspace-page customer-workspace">
    <VendorStudioNav />
    <div className="section-heading"><div><p className="section-kicker">Vendor studio</p><h1>Customers</h1><p>Your private directory of customer relationships.</p></div>
      <div className="customer-actions"><button className="button" onClick={() => setMode("link")}>Link existing customer</button><button className="button button-primary" onClick={() => setMode("invite")}>Invite new customer</button></div></div>
    <div className="customer-filters">
      <div className="field"><label htmlFor="customer-search">Search customers</label><input id="customer-search" type="search" maxLength={100} value={query} onChange={(e) => { setQuery(e.target.value); setOffset(0) }} placeholder="Name, exact email or phone" /></div>
      <div className="field"><label htmlFor="customer-status">Relationship status</label><AppSelect id="customer-status" value={status} onValueChange={(value) => { setStatus(value); setOffset(0) }} options={[{ value: "all", label: "All statuses" }, ...Object.entries(customerStatuses).map(([value, label]) => ({ value, label }))]} /></div>
    </div>
    {loading ? <p role="status">Loading customers…</p> : error ? <div role="alert"><p>{error}</p><button className="button" onClick={() => setRetry((v) => v + 1)}>Retry</button></div> : page && <>
      <p>{page.total} customer relationship{page.total === 1 ? "" : "s"}</p>
      <div className="record-grid">{page.items.map((customer) => <article className="record-card" key={customer.id}>
        <h2><Link to={`/vendor/customers/${customer.id}`}>{customer.full_name}</Link></h2><p>{customerStatuses[customer.status]}</p><p>{customer.email}</p><p>{customer.phone || "No phone"}</p>
      </article>)}</div>
      {!page.items.length && <p className="inline-empty">No customers match. Adjust your search or link/invite a customer.</p>}
      <div className="customer-actions"><button className="button" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</button><span>Page {Math.floor(offset / 20) + 1}</span><button className="button" disabled={offset + page.items.length >= page.total} onClick={() => setOffset(offset + 20)}>Next</button></div>
    </>}
    {mode && <Dialog title={mode === "link" ? "Link existing customer" : "Invite new customer"} description="Email and phone must identify the same customer. Linking does not grant acceptance on their behalf." onClose={() => { if (!saving) setMode(null) }}>
      <form onSubmit={addCustomer} className="customer-form"><fieldset disabled={saving}>
        {mode === "invite" && <div className="field"><label htmlFor="customer-name">Full name</label><input id="customer-name" name="full_name" required minLength={2} maxLength={100} /></div>}
        <div className="field"><label htmlFor="customer-email">Email</label><input id="customer-email" name="email" type="email" required /></div>
        <div className="field"><label htmlFor="customer-phone">Phone</label><input id="customer-phone" name="phone" type="tel" required minLength={10} maxLength={20} /></div>
        <div className="field"><label htmlFor="customer-notes">Private vendor notes</label><textarea id="customer-notes" name="vendor_notes" maxLength={2000} rows={3} /></div>
        <button className="button button-primary" type="submit">{saving ? "Saving…" : mode === "link" ? "Link customer" : "Create invitation"}</button>
      </fieldset></form>
    </Dialog>}
  </div>
}
