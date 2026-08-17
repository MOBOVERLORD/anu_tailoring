import { useEffect, useMemo, useState } from "react"
import { Check, ChevronDown, CircleAlert, ExternalLink, LocateFixed, LoaderCircle, Mail, MapPin, Phone, RefreshCw, Route, Save, Truck, UserRoundCheck } from "lucide-react"
import toast from "react-hot-toast"
import { api } from "@/lib/api"
import { AppSelect } from "@/components/ui/AppSelect"
import { boundedNumber } from "@/lib/formLimits"
import type { DeliveryAgentSummary, DeliveryPage, DeliveryRecord, DeliverySettings, DeliveryStatus } from "@/types/api"
import { MapAttribution } from "@/components/MapAttribution"
import { mapProviderLabel } from "@/utils/maps"

const statuses: DeliveryStatus[] = ["quote_ready", "booked", "picked_up", "in_transit", "delivered", "cancelled"]
const fulfilmentLabels = {
  platform_delivery: "Platform delivery",
  vendor_delivery: "Vendor delivery",
  customer_self_delivery: "Customer self-delivery",
  customer_self_pickup: "Customer self-pickup",
}

interface DeliveryManagementProps {
  isSuperAdmin: boolean
}

interface DeliveryCardProps {
  delivery: DeliveryRecord
  agents: DeliveryAgentSummary[]
  onUpdated: (delivery: DeliveryRecord) => void
}

const DeliveryCard = ({ agents, delivery, onUpdated }: DeliveryCardProps) => {
  const [expanded, setExpanded] = useState(!["delivered", "cancelled"].includes(delivery.status))
  const [draft, setDraft] = useState({
    status: delivery.status,
    tracking_number: delivery.tracking_number || "",
    tracking_url: delivery.tracking_url || "",
    external_reference: delivery.external_reference || "",
    admin_notes: delivery.admin_notes || "",
  })
  const [saving, setSaving] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const routeUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(`${delivery.origin_latitude},${delivery.origin_longitude};${delivery.destination_latitude},${delivery.destination_longitude}`)}`
  const agentRouteUrl = delivery.delivery_agent_latitude != null && delivery.delivery_agent_longitude != null
    ? `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(`${delivery.delivery_agent_latitude},${delivery.delivery_agent_longitude};${delivery.status === "booked" ? `${delivery.origin_latitude},${delivery.origin_longitude}` : `${delivery.destination_latitude},${delivery.destination_longitude}`}`)}`
    : null

  const assign = async (value: string) => {
    setAssigning(true)
    try {
      const updated = await api<DeliveryRecord>(`/api/admin/delivery/${delivery.id}/assignment`, {
        method: "PUT",
        body: JSON.stringify({ delivery_agent_id: value === "unassigned" ? null : Number(value) }),
      })
      onUpdated(updated)
      toast.success(updated.delivery_agent_name ? `${updated.delivery_agent_name} assigned` : "Delivery unassigned")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setAssigning(false)
    }
  }

  const save = async () => {
    setSaving(true)
    try {
      const updated = await api<DeliveryRecord>(`/api/admin/delivery/${delivery.id}`, {
        method: "PATCH",
        body: JSON.stringify(draft),
      })
      onUpdated(updated)
      setDraft({
        status: updated.status,
        tracking_number: updated.tracking_number || "",
        tracking_url: updated.tracking_url || "",
        external_reference: updated.external_reference || "",
        admin_notes: updated.admin_notes || "",
      })
      toast.success(`Delivery #${updated.id} updated`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className={`delivery-admin-card${expanded ? " is-expanded" : " is-collapsed"}`}>
      <header>
        <button aria-expanded={expanded} className="delivery-card-toggle" onClick={() => setExpanded((current) => !current)} type="button">
          <span className="delivery-card-title"><span><span className={`delivery-status status-${delivery.status}`}>{delivery.status.replaceAll("_", " ")}</span><h3>{delivery.order_type === "product" ? "Shop order" : "Tailoring order"} #{delivery.order_id ?? delivery.product_order_id}</h3></span><small>Delivery #{delivery.id} · {new Date(delivery.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</small></span>
          <span className="delivery-card-summary"><strong>₹{delivery.delivery_cost.toLocaleString("en-IN")}</strong><span className="delivery-card-chevron" aria-hidden="true"><ChevronDown size={20} /></span></span>
        </button>
      </header>
      {expanded && <div className="delivery-card-body">
      <div className="delivery-route-summary">
        <div><MapPin size={16} /><span><small>Pickup · {delivery.vendor_name}</small><strong>{delivery.origin_address}</strong></span></div>
        <Route size={20} />
        <div><MapPin size={16} /><span><small>Customer · {delivery.customer_name}</small><strong>{delivery.destination_address}</strong></span></div>
      </div>
      <div className="delivery-metrics">
        <span><small>Fulfilment</small><strong>{fulfilmentLabels[delivery.fulfilment_method]}</strong></span>
        <span><small>Driving distance</small><strong>{delivery.fulfilment_method === "platform_delivery" ? `${(delivery.distance_meters / 1000).toFixed(1)} km` : "Not used"}</strong></span>
        <span><small>Estimated drive</small><strong>{delivery.duration_seconds ? `${Math.max(1, Math.round(delivery.duration_seconds / 60))} min` : "—"}</strong></span>
        <span><small>Applied rate</small><strong>₹{delivery.price_per_100m}/100 m</strong></span>
        <span><small>Provider</small><strong>{delivery.provider_name}</strong></span>
      </div>
      {delivery.fulfilment_method === "platform_delivery" && (
        <div className="delivery-agent-assignment">
          <div><UserRoundCheck size={19} /><span><small>Assigned delivery agent</small><strong>{delivery.delivery_agent_name || "Awaiting assignment"}</strong>{delivery.delivery_agent_phone && <small>{delivery.delivery_agent_phone}</small>}</span></div>
          {delivery.status === "booked" ? <div className="field"><label htmlFor={`delivery-agent-${delivery.id}`}>Assign agent</label><AppSelect disabled={assigning} id={`delivery-agent-${delivery.id}`} onValueChange={(value) => void assign(value)} options={[{ value: "unassigned", label: "Not assigned" }, ...agents.map((agent) => ({ value: String(agent.id), label: `${agent.full_name}${agent.location_updated_at ? " · location shared" : " · no location"}` }))]} value={delivery.delivery_agent_id ? String(delivery.delivery_agent_id) : "unassigned"} /></div> : <span className="delivery-assignment-locked">Assignment locked after pickup</span>}
          {delivery.delivery_agent_location_updated_at && <div className="delivery-agent-location"><LocateFixed size={16} /><span><strong>Agent location updated {new Date(delivery.delivery_agent_location_updated_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</strong><small>{delivery.delivery_agent_location_accuracy_meters ? `Accuracy about ${Math.round(delivery.delivery_agent_location_accuracy_meters)} m` : "Location accuracy unavailable"}</small></span>{agentRouteUrl && <a className="button button-secondary" href={agentRouteUrl} rel="noreferrer" target="_blank"><ExternalLink size={15} /> Agent route</a>}</div>}
        </div>
      )}
      {delivery.maps_provider !== "not_required" && <div className="delivery-map-actions"><MapAttribution provider={delivery.maps_provider} /><a className="button button-secondary" href={routeUrl} rel="noreferrer" target="_blank"><ExternalLink size={15} /> Open route map</a></div>}
      <div className="delivery-tracking-form">
        <div className="field"><label htmlFor={`delivery-status-${delivery.id}`}>Status override</label><AppSelect id={`delivery-status-${delivery.id}`} onValueChange={(value) => setDraft({ ...draft, status: value as DeliveryStatus })} options={statuses.map((status) => ({ value: status, label: status.replaceAll("_", " ") }))} value={draft.status} /><small>Agents normally advance pickup and transit statuses.</small></div>
        <div className="field"><label htmlFor={`delivery-tracking-${delivery.id}`}>Tracking number</label><input id={`delivery-tracking-${delivery.id}`} readOnly value={draft.tracking_number} /><small>Generated automatically when the vendor marks the order ready.</small></div>
        <div className="field"><label htmlFor={`delivery-url-${delivery.id}`}>Tracking URL</label><input id={`delivery-url-${delivery.id}`} onChange={(event) => setDraft({ ...draft, tracking_url: event.target.value })} placeholder="https://…" type="url" value={draft.tracking_url} /></div>
        <div className="field"><label htmlFor={`delivery-reference-${delivery.id}`}>Provider reference</label><input id={`delivery-reference-${delivery.id}`} maxLength={150} onChange={(event) => setDraft({ ...draft, external_reference: event.target.value })} value={draft.external_reference} /></div>
        <div className="field delivery-notes-field"><label htmlFor={`delivery-notes-${delivery.id}`}>Internal communication notes</label><textarea id={`delivery-notes-${delivery.id}`} maxLength={2000} onChange={(event) => setDraft({ ...draft, admin_notes: event.target.value })} rows={2} value={draft.admin_notes} /></div>
        <button className="button" disabled={saving} onClick={save} type="button">{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Save tracking</button>
      </div>
      </div>}
    </article>
  )
}

export const DeliveryManagement = ({ isSuperAdmin }: DeliveryManagementProps) => {
  const [settings, setSettings] = useState<DeliverySettings | null>(null)
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([])
  const [agents, setAgents] = useState<DeliveryAgentSummary[]>([])
  const [form, setForm] = useState({ price_per_100m: 0, provider_name: "", provider_email: "", provider_phone: "", communication_details: "", is_active: false })
  const [statusFilter, setStatusFilter] = useState<"all" | DeliveryStatus>("all")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [loadedSettings, page, loadedAgents] = await Promise.all([
        api<DeliverySettings>("/api/admin/delivery/settings"),
        api<DeliveryPage>("/api/admin/delivery?limit=100"),
        api<DeliveryAgentSummary[]>("/api/admin/delivery/agents"),
      ])
      setSettings(loadedSettings)
      setForm({
        price_per_100m: loadedSettings.price_per_100m,
        provider_name: loadedSettings.provider_name,
        provider_email: loadedSettings.provider_email,
        provider_phone: loadedSettings.provider_phone || "",
        communication_details: loadedSettings.communication_details || "",
        is_active: loadedSettings.is_active,
      })
      setDeliveries(page.items)
      setAgents(loadedAgents)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return deliveries.filter((delivery) => {
      const matchesStatus = statusFilter === "all" || delivery.status === statusFilter
      const matchesSearch = !query || [String(delivery.order_id ?? delivery.product_order_id), delivery.order_type, delivery.vendor_name, delivery.customer_name, delivery.provider_name, delivery.tracking_number || ""].some((value) => value.toLowerCase().includes(query))
      return matchesStatus && matchesSearch
    })
  }, [deliveries, search, statusFilter])

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault()
    setSavingSettings(true)
    try {
      const updated = await api<DeliverySettings>("/api/admin/delivery/settings", { method: "PUT", body: JSON.stringify(form) })
      setSettings(updated)
      toast.success("Delivery pricing and provider saved")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSavingSettings(false)
    }
  }

  const replaceDelivery = (updated: DeliveryRecord) => setDeliveries((current) => current.map((item) => item.id === updated.id ? updated : item))

  return (
    <section className="admin-panel delivery-management">
      <div className="admin-panel-heading">
        <div><p className="eyebrow">Delivery operations</p><h2>Pricing, provider & tracking</h2><p>Distance is calculated by {mapProviderLabel(settings?.maps_provider || "openstreetmap")} from the verified vendor pickup point to the customer's saved address.</p>{settings?.maps_provider && <MapAttribution provider={settings.maps_provider} />}</div>
        <button className="button button-secondary" disabled={loading} onClick={load} type="button"><RefreshCw size={16} /> Refresh</button>
      </div>

      <div className="delivery-settings-layout">
        <form className="delivery-settings-card form-stack" onSubmit={saveSettings}>
          <header><Truck size={21} /><div><h3>Delivery provider</h3><p>One rate is charged for every started 100-metre block.</p></div></header>
          {!settings?.maps_configured && <div className="delivery-config-warning"><CircleAlert size={18} /><p><strong>Map routing unavailable</strong><br />{settings?.maps_configuration_message || "Configure a backend map provider before activating delivery."}</p></div>}
          <div className="field"><label htmlFor="delivery-rate">Price per 0.1 km (₹)</label><input disabled={!isSuperAdmin} id="delivery-rate" max={10_000} min={0.01} onChange={(event) => setForm({ ...form, price_per_100m: boundedNumber(event.target.value, 0, 10_000) })} required step="0.01" type="number" value={form.price_per_100m} /></div>
          <div className="field"><label htmlFor="delivery-provider">Provider name</label><input disabled={!isSuperAdmin} id="delivery-provider" maxLength={150} minLength={2} onChange={(event) => setForm({ ...form, provider_name: event.target.value })} required value={form.provider_name} /></div>
          <div className="form-grid"><div className="field"><label htmlFor="delivery-email"><Mail size={14} /> Communication email</label><input disabled={!isSuperAdmin} id="delivery-email" maxLength={254} onChange={(event) => setForm({ ...form, provider_email: event.target.value })} required type="email" value={form.provider_email} /></div><div className="field"><label htmlFor="delivery-phone"><Phone size={14} /> Phone</label><input disabled={!isSuperAdmin} id="delivery-phone" maxLength={30} onChange={(event) => setForm({ ...form, provider_phone: event.target.value })} type="tel" value={form.provider_phone} /></div></div>
          <div className="field"><label htmlFor="delivery-details">Communication details</label><textarea disabled={!isSuperAdmin} id="delivery-details" maxLength={2000} onChange={(event) => setForm({ ...form, communication_details: event.target.value })} placeholder="Escalation contact, operating hours, booking process…" rows={4} value={form.communication_details} /></div>
          <label className="settings-toggle"><input checked={form.is_active} disabled={!isSuperAdmin || !settings?.maps_configured} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} type="checkbox" /><span><strong>Accept delivery orders</strong><small>Customers can only order while pricing and Maps are active.</small></span></label>
          {isSuperAdmin ? <button className="button" disabled={savingSettings} type="submit">{savingSettings ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Save delivery setup</button> : <div className="permission-note"><Check size={17} /><p>Provider and pricing changes require super-admin access.</p></div>}
        </form>

        <div className="delivery-list-panel">
          <div className="delivery-list-toolbar"><label className="search-field"><input aria-label="Search deliveries" onChange={(event) => setSearch(event.target.value)} placeholder="Order, customer, vendor, tracking…" value={search} /></label><AppSelect ariaLabel="Filter delivery status" className="toolbar-select" onValueChange={(value) => setStatusFilter(value as "all" | DeliveryStatus)} options={[{ value: "all", label: "All statuses" }, ...statuses.map((status) => ({ value: status, label: status.replaceAll("_", " ") }))]} value={statusFilter} /></div>
          {loading ? <div className="loading-state"><LoaderCircle className="spin" /> Loading deliveries…</div> : filtered.length ? <div className="delivery-admin-list">{filtered.map((delivery) => <DeliveryCard agents={agents} delivery={delivery} key={delivery.id} onUpdated={replaceDelivery} />)}</div> : <div className="admin-empty"><Truck size={34} /><h3>No matching deliveries</h3><p>New orders appear here after an automatic route quote is created.</p></div>}
        </div>
      </div>
    </section>
  )
}
