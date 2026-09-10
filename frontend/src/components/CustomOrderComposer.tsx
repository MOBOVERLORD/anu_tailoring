import { useEffect, useState } from "react"
import { ChevronDown, Plus, ShoppingCart, Trash2 } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { Dialog } from "@/components/Dialog"
import { CustomOrderReferences } from "@/components/CustomOrderReferences"
import { AppSelect } from "@/components/ui/AppSelect"
import { useCart } from "@/context/CartContext"
import { api } from "@/lib/api"
import { expandGarmentPieces, resizePieceFits } from "@/lib/customOrderDraft"
import type { Design, MeasurementProfile } from "@/types/api"

interface Entry {
  id: string
  fits: string[]
  designs: number[]
  photos: string[]
  cloth: "customer_provided" | "vendor_supplied"
  colour: string
  fabric?: string
  notes: string
}
const newEntry = (): Entry => ({ id: crypto.randomUUID(), fits: [""], designs: [], photos: [], cloth: "customer_provided", colour: "", notes: "" })

export function CustomOrderComposer({ design, onClose }: { design: Design; onClose: () => void }) {
  const [entries, setEntries] = useState<Entry[]>(() => [newEntry()])
  const [catalog, setCatalog] = useState<Design[]>([])
  const [attempted, setAttempted] = useState(false)
  const [removed, setRemoved] = useState<{ item: Entry; index: number } | null>(null)
  const [validationAttempt, setValidationAttempt] = useState(0)
  const [active, setActive] = useState(0)
  const [profiles, setProfiles] = useState<MeasurementProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const cart = useCart()
  const navigate = useNavigate()
  const entry = entries[active] || entries[0]
  const count = entries.reduce((sum, item) => sum + item.fits.length, 0)
  const available = Math.max(0, 20 - cart.lines.length)
  const valid = (item: Entry) => item.notes.trim().length >= 10 && item.fits.every((id) => profiles.some((profile) => String(profile.id) === id))
  const update = (patch: Partial<Entry>) => setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, ...patch } : item))
  useEffect(() => {
    let current = true
    setLoading(true); setError("")
    api<MeasurementProfile[]>("/api/measurements").then((items) => { if (current) setProfiles(items) }).catch((reason: Error) => { if (current) setError(reason.message) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [retry])
  useEffect(() => {
    if (!validationAttempt) return
    document.querySelector<HTMLElement>('.custom-composer [aria-invalid="true"]')?.focus()
  }, [validationAttempt])
  const previewUrl = (item: Entry) => item.photos[0] ? `/api/order-reference-photos/${item.photos[0]}` : catalog.find((value) => value.id === item.designs[0])?.thumbnail_url || catalog.find((value) => value.id === item.designs[0])?.image_url
  const close = () => {
    if (busy) { toast.error("Please wait for your photo to finish uploading."); return }
    if (!submitted && (entries.length > 1 || entries.some((item) => item.notes || item.photos.length || item.designs.length || item.fits.some(Boolean) || item.colour || item.fabric || item.cloth !== "customer_provided" || item.fits.length > 1)) && !window.confirm("Discard these custom garment entries? They have not been added to your cart.")) return
    onClose()
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || submitted || design.vendor_id == null) return
    const invalid = entries.findIndex((item) => !valid(item))
    if (invalid !== -1) { setAttempted(true); setActive(invalid); setValidationAttempt((value) => value + 1); return }
    try {
      cart.addDesigns(expandGarmentPieces(entries).map(({ entry: item, measurementId: id, pieceNumber }) => ({
        vendor_id: design.vendor_id!, vendor_name: design.vendor_name || "Vendor", design,
        measurement_profile_id: Number(id), measurement_name: profiles.find((profile) => String(profile.id) === id)!.profile_name,
        cloth_source: item.cloth, colour_preference: item.cloth === "vendor_supplied" ? item.colour.trim() || null : null,
        reference_design_ids: item.designs, reference_photo_ids: item.photos, fabric_choice: item.fabric?.trim() || null,
        custom_instructions: item.fits.length > 1 ? `${item.notes.trim()}\n(Piece ${pieceNumber} of ${item.fits.length}, same design)` : item.notes.trim(),
      })))
      setSubmitted(true); toast.success(`${count} piece${count === 1 ? "" : "s"} added to cart`); onClose(); navigate("/cart")
    } catch (reason) { toast.error((reason as Error).message) }
  }
  return <Dialog className="order-dialog custom-composer" title="Custom tailoring" description="Add your garments here, then review everything together in your cart." onClose={close}>
    {loading ? <p role="status">Loading measurements…</p> : error ? <p role="alert">{error} <button className="button button-secondary" onClick={() => setRetry((value) => value + 1)}>Retry</button></p> : !profiles.length ? <p>Add a measurement profile before ordering. <Link to="/profile?section=measurements" onClick={onClose}>Add measurements</Link></p> : <form className="order-form" onSubmit={submit}>
      <div className="garment-cards">{entries.map((item, index) => <section className={index === active ? "garment-card is-open" : "garment-card"} key={item.id}>
        <div className="garment-card-header">
        <button className="garment-card-heading" type="button" disabled={busy} aria-expanded={index === active} aria-controls={`garment-editor-${item.id}`} onClick={() => setActive(active === index ? -1 : index)}>
          {previewUrl(item) ? <ApiImage className="garment-summary-image" alt="" src={previewUrl(item)!} /> : <span className="garment-number">{index + 1}</span>}
          <span className="garment-card-summary"><strong>{catalog.find((value) => value.id === item.designs[0])?.title || (item.notes.trim() ? item.notes.trim().slice(0, 55) : `Garment ${index + 1}`)}</strong><small>{item.photos.length ? "Photo reference" : item.designs.length ? "Vendor design" : "Custom design"} · {item.fits.length} {item.fits.length === 1 ? "piece" : "pieces"} · {item.fits.filter(Boolean).length}/{item.fits.length} measurements</small><small>{[...new Set(item.fits.map((id) => profiles.find((profile) => String(profile.id) === id)?.profile_name).filter(Boolean))].join(", ") || "Choose measurements below"}</small></span>
          <span className="garment-card-state">{valid(item) ? "Ready" : "To complete"}<ChevronDown size={16} /></span>
        </button>
        {entries.length > 1 && <button type="button" className="garment-remove" disabled={busy || submitted} aria-label={`Remove garment ${index + 1}`} onClick={() => {
          setRemoved({ item, index })
          setEntries((current) => current.filter((garment) => garment.id !== item.id))
          setActive((current) => current === index ? -1 : current > index ? current - 1 : current)
        }}><Trash2 size={16} /><span>Remove</span></button>}
        </div>
        {index === active && <div className="garment-editor" id={`garment-editor-${item.id}`}>
      <fieldset className="custom-entry-fields" disabled={busy || submitted}>
        <legend className="sr-only">Garment {active + 1} details</legend>
        <div className="garment-design-row"><CustomOrderReferences key={entry.id} single onCatalog={setCatalog} vendorId={design.vendor_id!} designs={entry.designs} photos={entry.photos} onDesigns={(designs) => update({ designs })} onPhotos={(photos) => update({ photos })} onBusy={setBusy} />
        <div className="field"><label htmlFor="custom-quantity">Quantity</label><AppSelect id="custom-quantity" value={String(entry.fits.length)} onValueChange={(value) => update({ fits: resizePieceFits(entry.fits, Number(value)) })} options={Array.from({ length: Math.max(entry.fits.length, available - count + entry.fits.length) }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} /></div></div>
        <div className="garment-fit-heading"><strong>Measurements</strong><small>One profile per piece. Reuse a profile if needed.</small></div>
        {entry.fits.length > 1 && entry.fits[0] && <button className="button button-secondary measurement-reuse" type="button" onClick={() => update({ fits: entry.fits.map(() => entry.fits[0]) })}>Use piece 1 measurements for all</button>}
        <div className="garment-fit-grid">
        {entry.fits.map((fit, index) => <div className="field" key={index}><label htmlFor={`piece-${index}`}>Piece {index + 1} — measurement profile</label><AppSelect id={`piece-${index}`} ariaInvalid={attempted && !fit} ariaDescribedBy={attempted && !fit ? `piece-error-${index}` : undefined} value={fit} onValueChange={(value) => update({ fits: entry.fits.map((id, position) => position === index ? value : id) })} options={profiles.map((profile) => ({ value: String(profile.id), label: `${profile.profile_name} · ${profile.garment_type.replaceAll("_", " ")}` }))} />{attempted && !fit && <small className="garment-field-error" id={`piece-error-${index}`}>Choose a measurement profile.</small>}</div>)}
        </div>
        <div className="field"><label htmlFor="custom-notes">Describe this garment</label><textarea aria-invalid={attempted && entry.notes.trim().length < 10} aria-describedby="custom-notes-help" id="custom-notes" value={entry.notes} maxLength={900} rows={2} onChange={(event) => update({ notes: event.target.value })} placeholder="e.g. A long-sleeved kurta with a round neck, relaxed fit…" /><small id="custom-notes-help" className={attempted && entry.notes.trim().length < 10 ? "garment-field-error" : ""}>{attempted && entry.notes.trim().length < 10 ? "Add a description with at least 10 characters." : "Briefly describe the garment (at least 10 characters)."}</small></div>
        <div className="field"><label htmlFor="custom-cloth">Who provides the cloth?</label><AppSelect id="custom-cloth" value={entry.cloth} onValueChange={(value) => update({ cloth: value as Entry["cloth"] })} options={[{ value: "customer_provided", label: "I will provide it" }, { value: "vendor_supplied", label: "Vendor will provide it" }]} /></div>
        {entry.cloth === "vendor_supplied" && <div className="field"><label htmlFor="custom-colour">Colour preference (optional)</label><input id="custom-colour" maxLength={100} value={entry.colour} placeholder="e.g. Navy blue" onChange={(event) => update({ colour: event.target.value })} /></div>}
        <details key={entry.id} className="garment-more"><summary>More details <span>Fabric preference</span></summary>
        <div className="field"><label htmlFor="custom-fabric">Fabric preference (optional)</label><input id="custom-fabric" maxLength={100} value={entry.fabric || ""} placeholder="e.g. Cotton or linen" onChange={(event) => update({ fabric: event.target.value })} /></div>
        </details>
      </fieldset>
        </div>}
      </section>)}</div>
      {removed && <div className="garment-undo" role="status"><span>Garment removed</span><button className="button button-secondary" type="button" disabled={busy || count + removed.item.fits.length > available} onClick={() => {
        const position = Math.min(removed.index, entries.length)
        setEntries((current) => [...current.slice(0, position), removed.item, ...current.slice(position)])
        setActive((current) => current >= position ? current + 1 : current)
        setRemoved(null)
      }}>Undo</button>{count + removed.item.fits.length > available && <small>Reduce quantity to restore it.</small>}</div>}
      <div className="composer-add-garment">
        <button className="button button-secondary" type="button" aria-describedby="custom-order-limit" disabled={busy || count >= available} onClick={() => { setEntries([...entries, newEntry()]); setActive(entries.length) }}><Plus size={17} /> Add another garment</button>
        <p id="custom-order-limit" role="status">
          <strong>{count + cart.lines.length}/20 {cart.lines.length ? "items" : "pieces"}</strong>
          {cart.lines.length > 0 && <small>Includes {cart.lines.length} in cart</small>}
          {count >= available && <small>Limit reached · Reduce quantity to add more</small>}
          {busy && <small>Uploading photo…</small>}
        </p>
      </div>
      <p className="order-quote-note">The vendor will confirm tailoring prices before payment.</p>
      {count > available && <p role="alert">Your cart has room for {available} more pieces. Remove entries or checkout your existing cart first.</p>}
      <div className="composer-footer"><div><strong>{count} {count === 1 ? "piece" : "pieces"}</strong><small>{entries.length} garment {entries.length === 1 ? "entry" : "entries"}</small></div><button className="button button-secondary" type="button" onClick={close} disabled={busy}>Cancel</button><button className="button" type="submit" disabled={busy || submitted || count > available}><ShoppingCart size={17} /> Add & review cart</button></div>
    </form>}
  </Dialog>
}
