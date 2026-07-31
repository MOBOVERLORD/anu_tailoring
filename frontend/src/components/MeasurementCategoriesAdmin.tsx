import { useCallback, useEffect, useState } from "react"
import { Edit3, LoaderCircle, Plus, Ruler, ToggleLeft, ToggleRight, Trash2 } from "lucide-react"
import toast from "react-hot-toast"
import { Dialog } from "@/components/Dialog"
import { api } from "@/lib/api"
import type { MeasurementCategory } from "@/types/api"

const emptyForm = {
  name: "",
  garment_type: "",
  gender: "women" as MeasurementCategory["gender"],
  fields: "",
  sizes: "",
  sort_order: 0,
  is_active: true,
}

const fieldsToText = (category: MeasurementCategory) => category.measurement_fields.map((field) => `${field.key} | ${field.label}`).join("\n")
const sizesToText = (category: MeasurementCategory) => Object.entries(category.standard_sizes).map(([size, values]) => `${size}: ${Object.entries(values).map(([key, value]) => `${key}=${value}`).join(", ")}`).join("\n")

const MeasurementCategoriesAdmin = () => {
  const [categories, setCategories] = useState<MeasurementCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<MeasurementCategory | "new" | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    try { setCategories(await api<MeasurementCategory[]>("/api/admin/measurement-categories")) }
    catch (error) { toast.error((error as Error).message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const openNew = () => { setForm(emptyForm); setEditing("new") }
  const openEdit = (category: MeasurementCategory) => {
    setForm({ name: category.name, garment_type: category.garment_type, gender: category.gender, fields: fieldsToText(category), sizes: sizesToText(category), sort_order: category.sort_order, is_active: category.is_active })
    setEditing(category)
  }

  const payloadFromForm = () => {
    const measurement_fields = form.fields.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
      const [key, ...labelParts] = line.split("|")
      return { key: key.trim().toLowerCase().replaceAll(" ", "_"), label: (labelParts.join("|").trim() || key.trim()) }
    })
    const standard_sizes: Record<string, Record<string, number>> = {}
    form.sizes.split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => {
      const separator = line.indexOf(":")
      if (separator < 1) throw new Error(`Use "Size: field=value" format for: ${line}`)
      const size = line.slice(0, separator).trim()
      standard_sizes[size] = Object.fromEntries(line.slice(separator + 1).split(",").map((pair) => {
        const [key, value] = pair.split("=").map((part) => part.trim())
        if (!key || !value || Number.isNaN(Number(value))) throw new Error(`Invalid size value in: ${line}`)
        return [key, Number(value)]
      }))
    })
    if (!measurement_fields.length) throw new Error("Add at least one measurement field")
    return { name: form.name, garment_type: form.garment_type.trim().toLowerCase().replaceAll(" ", "_"), gender: form.gender, measurement_fields, standard_sizes, is_active: form.is_active, sort_order: Number(form.sort_order) }
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = payloadFromForm()
      const category = await api<MeasurementCategory>(editing === "new" ? "/api/admin/measurement-categories" : `/api/admin/measurement-categories/${editing?.id}`, { method: editing === "new" ? "POST" : "PUT", body: JSON.stringify(payload) })
      setCategories((current) => editing === "new" ? [...current, category] : current.map((item) => item.id === category.id ? category : item))
      setEditing(null)
      toast.success(editing === "new" ? "Measurement category created" : "Measurement category updated")
    } catch (error) { toast.error((error as Error).message) }
    finally { setSaving(false) }
  }

  const toggle = async (category: MeasurementCategory) => {
    setBusyId(category.id)
    try {
      const updated = await api<MeasurementCategory>(`/api/admin/measurement-categories/${category.id}`, { method: "PUT", body: JSON.stringify({ ...category, is_active: !category.is_active }) })
      setCategories((current) => current.map((item) => item.id === updated.id ? updated : item))
      toast.success(updated.is_active ? "Category activated" : "Category hidden from customers")
    } catch (error) { toast.error((error as Error).message) }
    finally { setBusyId(null) }
  }

  const remove = async (category: MeasurementCategory) => {
    if (!window.confirm(`Delete measurement category "${category.name}"?`)) return
    setBusyId(category.id)
    try {
      await api(`/api/admin/measurement-categories/${category.id}`, { method: "DELETE" })
      setCategories((current) => current.filter((item) => item.id !== category.id))
      toast.success("Measurement category deleted")
    } catch (error) { toast.error((error as Error).message) }
    finally { setBusyId(null) }
  }

  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <div><p className="eyebrow">Fit configuration</p><h2>Measurement categories</h2></div>
        <button className="button" onClick={openNew} type="button"><Plus size={17} /> New category</button>
      </div>
      <p className="admin-panel-intro">Configure which measurements customers enter for each garment. Optional standard sizes can prefill those values while remaining editable.</p>
      {loading ? <div className="loading-state"><LoaderCircle className="spin" /> Loading categories…</div> : (
        <div className="measurement-category-list">
          {categories.map((category) => (
            <article className={`measurement-category-card ${category.is_active ? "" : "inactive"}`} key={category.id}>
              <div className="measurement-category-head"><span className="record-icon"><Ruler size={19} /></span><div><h3>{category.name}</h3><p>{category.gender} · {category.garment_type}</p></div><span className={`account-status ${category.is_active ? "active" : "inactive"}`}>{category.is_active ? "Active" : "Hidden"}</span></div>
              <div className="measurement-field-chips">{category.measurement_fields.map((field) => <span key={field.key}>{field.label}</span>)}</div>
              <p className="category-size-copy">{Object.keys(category.standard_sizes).length ? `Standard sizes: ${Object.keys(category.standard_sizes).join(", ")}` : "No standard sizes configured — customers enter custom measurements."}</p>
              <div className="measurement-category-actions">
                <button className="button button-quiet button-small" onClick={() => openEdit(category)} type="button"><Edit3 size={15} /> Edit</button>
                <button className="button button-quiet button-small" disabled={busyId === category.id} onClick={() => toggle(category)} type="button">{category.is_active ? <ToggleRight size={17} /> : <ToggleLeft size={17} />} {category.is_active ? "Deactivate" : "Activate"}</button>
                <button className="icon-button danger" disabled={busyId === category.id} onClick={() => remove(category)} title="Delete category" type="button"><Trash2 size={16} /></button>
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && <Dialog className="measurement-category-dialog" description="Use one field per line. Standard sizes are optional and prefill the matching fields." onClose={() => setEditing(null)} title={editing === "new" ? "New measurement category" : `Edit ${editing.name}`}>
        <form className="dialog-form form-stack" onSubmit={save}>
          <div className="form-grid"><div className="field"><label htmlFor="category-name">Display name</label><input id="category-name" minLength={2} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Saree blouse" required value={form.name} /></div><div className="field"><label htmlFor="category-key">Garment key</label><input id="category-key" onChange={(event) => setForm({ ...form, garment_type: event.target.value })} pattern="[a-zA-Z][a-zA-Z0-9_ ]+" placeholder="saree_blouse" required value={form.garment_type} /></div></div>
          <div className="form-grid"><div className="field"><label htmlFor="category-gender">For</label><select className="select-control" id="category-gender" onChange={(event) => setForm({ ...form, gender: event.target.value as MeasurementCategory["gender"] })} value={form.gender}><option value="women">Women</option><option value="men">Men</option><option value="unisex">Unisex</option><option value="kids">Kids</option></select></div><div className="field"><label htmlFor="category-order">Display order</label><input id="category-order" min={0} onChange={(event) => setForm({ ...form, sort_order: Number(event.target.value) })} type="number" value={form.sort_order} /></div></div>
          <div className="field"><label htmlFor="category-fields">Measurement fields</label><textarea id="category-fields" onChange={(event) => setForm({ ...form, fields: event.target.value })} placeholder={"chest | Chest\nwaist | Waist\nsleeve_length | Sleeve length"} required rows={7} value={form.fields} /><small>Format: field_key | Customer-facing label</small></div>
          <div className="field"><label htmlFor="category-sizes">Standard sizes <small>optional</small></label><textarea id="category-sizes" onChange={(event) => setForm({ ...form, sizes: event.target.value })} placeholder={"S: chest=36, waist=30\nM: chest=38, waist=32"} rows={5} value={form.sizes} /><small>One size per line. Every key must exist in the measurement fields above.</small></div>
          <label className="checkbox-field"><input checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} type="checkbox" /><span><strong>Available to customers</strong><small>Inactive categories remain on existing profiles but cannot be selected for new ones.</small></span></label>
          <div className="dialog-actions"><button className="button button-secondary" onClick={() => setEditing(null)} type="button">Cancel</button><button className="button" disabled={saving} type="submit">{saving ? "Saving…" : "Save category"}</button></div>
        </form>
      </Dialog>}
    </section>
  )
}

export default MeasurementCategoriesAdmin
