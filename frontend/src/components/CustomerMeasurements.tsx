import { useEffect, useState } from "react"
import type { FormEvent } from "react"
import toast from "react-hot-toast"
import { Dialog } from "@/components/Dialog"
import { AppSelect } from "@/components/ui/AppSelect"
import { api } from "@/lib/api"
import type { MeasurementCategory } from "@/types/api"

interface VendorMeasurement {
  id: number
  profile_name: string
  garment_type: string
  unit: "inches" | "cm"
  measurements: Record<string, number>
  notes: string | null
  updated_at: string
  vendor_name?: string
}

function MeasurementEditor({ initial, categories, onSave, saving }: {
  initial: VendorMeasurement | null
  categories: MeasurementCategory[]
  onSave: (body: object) => Promise<void>
  saving: boolean
}) {
  const [name, setName] = useState(initial?.profile_name || "")
  const [garment, setGarment] = useState(initial?.garment_type || categories[0]?.garment_type || "")
  const [unit, setUnit] = useState<"inches" | "cm">(initial?.unit || "inches")
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(Object.entries(initial?.measurements || {}).map(([key, value]) => [key, String(value)])))
  const [notes, setNotes] = useState(initial?.notes || "")
  const category = categories.find((item) => item.garment_type === garment)
  function changeUnit(value: string) {
    const next = value as "inches" | "cm"
    if (next === unit) return
    const factor = next === "cm" ? 2.54 : 1 / 2.54
    setValues(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim() ? String(Math.round(Number(value) * factor * 100) / 100) : ""])))
    setUnit(next)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const measurements = Object.fromEntries((category?.measurement_fields || []).filter(({ key }) => values[key]?.trim()).map(({ key }) => [key, Number(values[key])]))
    if (name.trim().length < 2 || !category || !Object.keys(measurements).length || Object.values(measurements).some((value) => !Number.isFinite(value) || value <= 0 || value > 300)) {
      toast.error("Enter a profile name and at least one measurement greater than 0 and at most 300.")
      return
    }
    await onSave({ profile_name: name.trim(), garment_type: garment, unit, measurements, notes: notes.trim() || null })
  }
  return <form className="customer-form" onSubmit={submit}><fieldset disabled={saving}>
    <div className="field"><label htmlFor="vendor-fit-name">Profile name</label><input id="vendor-fit-name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={50} required /></div>
    <div className="field"><label htmlFor="vendor-fit-category">Garment</label><AppSelect id="vendor-fit-category" value={garment} onValueChange={(value) => { setGarment(value); setValues({}) }} options={categories.map((item) => ({ value: item.garment_type, label: item.name }))} /></div>
    <div className="field"><label htmlFor="vendor-fit-unit">Unit</label><AppSelect id="vendor-fit-unit" value={unit} onValueChange={changeUnit} options={[{ value: "inches", label: "Inches" }, { value: "cm", label: "Centimetres" }]} /><small>Changing units converts the entered values, rounded to two decimal places.</small></div>
    <div className="measurement-input-grid">{category?.measurement_fields.map(({ key, label }) => <div className="field" key={key}><label htmlFor={`vendor-fit-${key}`}>{label} ({unit})</label><input id={`vendor-fit-${key}`} type="number" inputMode="decimal" step="any" min="0.01" max="300" value={values[key] || ""} onChange={(e) => setValues({ ...values, [key]: e.target.value })} /></div>)}</div>
    <div className="field"><label htmlFor="vendor-fit-notes">Fit notes</label><textarea id="vendor-fit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={3} /></div>
    <button type="submit" className="button button-primary" disabled={!category}>{saving ? "Saving…" : "Save measurements"}</button>
  </fieldset></form>
}

export function CustomerMeasurements({ relationshipId, declined = false }: { relationshipId?: number; declined?: boolean }) {
  const shared = relationshipId === undefined
  const endpoint = shared ? "/api/measurements/vendor-recorded" : `/api/vendor/customers/${relationshipId}/measurements`
  const [records, setRecords] = useState<VendorMeasurement[]>([])
  const [categories, setCategories] = useState<MeasurementCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [editing, setEditing] = useState<VendorMeasurement | "new" | null>(null)
  const [deleting, setDeleting] = useState<VendorMeasurement | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    let current = true
    setLoading(true)
    setError("")
    Promise.all([api<VendorMeasurement[]>(endpoint), api<MeasurementCategory[]>("/api/measurements/categories")]).then(([items, catalog]) => {
      if (current) { setRecords(items); setCategories(catalog) }
    }).catch((reason: Error) => { if (current) setError(reason.message) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [endpoint, reload])
  async function save(body: object) {
    if (saving || shared) return
    setSaving(true)
    try {
      await api(editing && editing !== "new" ? `${endpoint}/${editing.id}` : endpoint, { method: editing === "new" ? "POST" : "PATCH", body: JSON.stringify(body) })
      setEditing(null); setReload((value) => value + 1); toast.success("Measurements saved")
    } catch (reason) { toast.error((reason as Error).message) }
    finally { setSaving(false) }
  }
  async function remove() {
    if (!deleting || saving || shared) return
    setSaving(true)
    try {
      await api(`${endpoint}/${deleting.id}`, { method: "DELETE" })
      setDeleting(null); setReload((value) => value + 1); toast.success("Measurements deleted")
    } catch (reason) { toast.error((reason as Error).message) }
    finally { setSaving(false) }
  }
  return <section className="customer-measurements">
    <div className="section-heading"><div><h2>Vendor-recorded measurements</h2><p>{shared ? "Read-only fits shared by vendors you have accepted. These do not replace your personal saved fits." : "Separate vendor records. Customers can view them only after accepting this relationship."}</p></div>
      {!shared && <button className="button button-primary" disabled={declined || loading || !!error || !categories.length} onClick={() => setEditing("new")}>Add measurements</button>}</div>
    {declined && <p>Creation and editing are disabled for declined relationships.</p>}
    {loading ? <p role="status">Loading measurements…</p> : error ? <div role="alert"><p>{error}</p><button className="button" onClick={() => setReload((value) => value + 1)}>Retry</button></div> : <div className="record-grid">
      {!records.length && <p>No vendor-recorded measurements yet.</p>}
      {records.map((item) => {
        const category = categories.find((value) => value.garment_type === item.garment_type)
        return <article className="record-card" key={item.id}><h3>{item.profile_name}</h3><p>{category?.name || item.garment_type}{shared && ` · ${item.vendor_name}`}</p>
          <div className="measurement-summary">{Object.entries(item.measurements).map(([key, value]) => <span key={key}><small>{category?.measurement_fields.find((field) => field.key === key)?.label || key}</small><strong>{value} {item.unit}</strong></span>)}</div>
          {item.notes && <p>{item.notes}</p>}<p>Updated {new Date(item.updated_at).toLocaleString()}</p>
          {!shared && <div className="customer-actions"><button className="button" disabled={declined || !category} onClick={() => setEditing(item)}>Edit</button><button className="button" onClick={() => setDeleting(item)}>Delete</button></div>}
        </article>
      })}
    </div>}
    {editing && <Dialog title={editing === "new" ? "Add measurements" : "Edit measurements"} onClose={() => { if (!saving) setEditing(null) }}><MeasurementEditor initial={editing === "new" ? null : editing} categories={categories} saving={saving} onSave={save} /></Dialog>}
    {deleting && <Dialog title="Delete measurements?" description={`Permanently delete ${deleting.profile_name}? This cannot be undone.`} onClose={() => { if (!saving) setDeleting(null) }}><button className="button" disabled={saving} onClick={() => setDeleting(null)}>Cancel</button><button className="button button-primary" disabled={saving} onClick={() => void remove()}>{saving ? "Deleting…" : "Delete measurements"}</button></Dialog>}
  </section>
}
