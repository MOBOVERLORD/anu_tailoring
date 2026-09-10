import { useEffect, useId, useRef, useState } from "react"
import { ImagePlus, Images } from "lucide-react"
import toast from "react-hot-toast"
import { api } from "@/lib/api"
import { ApiImage } from "@/components/ApiImage"
import type { Design } from "@/types/api"

export function CustomOrderReferences({ vendorId, designs, photos, onDesigns, onPhotos, onBusy, single = false, onCatalog }: {
  onCatalog?: (items: Design[]) => void
  single?: boolean
  vendorId: number; designs: number[]; photos: string[]
  onDesigns: (ids: number[]) => void; onPhotos: (ids: string[]) => void; onBusy: (busy: boolean) => void
}) {
  const inputId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [showCatalog, setShowCatalog] = useState(false)
  const [catalog, setCatalog] = useState<Design[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let current = true
    setError(""); setLoading(true)
    api<Design[]>(`/api/designs?vendor_id=${vendorId}`).then((items) => { if (current) { setCatalog(items); onCatalog?.(items) } }).catch((reason: Error) => { if (current) setError(reason.message) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [vendorId, retry, onCatalog])
  async function upload(file?: File) {
    if (!file || busy || photos.length >= (single ? 1 : 5)) return
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) { toast.error("Use JPEG, PNG or WebP up to 5 MB."); return }
    setBusy(true); onBusy(true)
    try {
      const body = new FormData(); body.append("file", file)
      const result = await api<{ id: string }>("/api/order-reference-photos", { method: "POST", body })
      if (single) onDesigns([])
      onPhotos([...photos, result.id])
    } catch (reason) { toast.error((reason as Error).message) }
    finally { setBusy(false); onBusy(false) }
  }
  const selected = catalog.find((item) => item.id === designs[0])
  const preview = (item: Design) => item.thumbnail_url || item.image_url ? <ApiImage alt={item.title} src={(item.thumbnail_url || item.image_url)!} /> : <Images size={28} aria-label="No preview available" />
  return <fieldset disabled={busy} style={{ border: 0, padding: 0 }}><legend>Design <small>(optional)</small></legend>
    {single && !photos.length && !designs.length && <div className="reference-choice"><button className="button button-secondary" type="button" aria-expanded={showCatalog} onClick={() => setShowCatalog(!showCatalog)}><Images size={17} /> Choose vendor design</button><button className="button button-secondary" type="button" onClick={() => fileInput.current?.click()}><ImagePlus size={17} /> Upload photo</button></div>}
    {single && designs.length > 0 && <div className="reference-selected">{selected && <span className="reference-selected-image">{preview(selected)}</span>}<strong>{selected?.title || "Selected vendor design"}</strong><button className="button button-secondary" type="button" onClick={() => { onDesigns([]); setShowCatalog(true) }}>Change</button></div>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry((v) => v + 1)}>Retry designs</button></p>}
    {(!single || showCatalog && !designs.length && !photos.length) && <div className="reference-shop" aria-label="Vendor design catalog">
      <div className="reference-shop-heading"><strong>From this shop</strong><small>Select a design as your tailoring reference</small></div>
      {loading ? <p role="status">Loading designs…</p> : !error && !catalog.filter((item) => !item.is_custom_request_template).length ? <p>No designs available yet. You can upload a photo instead.</p> : <div className="reference-shop-grid">{catalog.filter((item) => !item.is_custom_request_template).map((item) => <button key={item.id} type="button" className="reference-design-card" aria-pressed={designs.includes(item.id)} disabled={single ? photos.length > 0 : !designs.includes(item.id) && designs.length >= 5} onClick={() => { onDesigns(designs.includes(item.id) ? designs.filter((id) => id !== item.id) : single ? [item.id] : [...designs, item.id]); if (single) setShowCatalog(false) }}><span className="reference-design-image">{preview(item)}</span><strong>{item.title}</strong><small>{designs.includes(item.id) ? "Selected" : "Select design"}</small></button>)}</div>}
    </div>}
    <div className="field"><input ref={fileInput} id={inputId} hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || photos.length >= (single ? 1 : 5) || (single && designs.length > 0)} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = "" }} />{!single && <button className="button button-secondary" type="button" disabled={busy || photos.length >= (single ? 1 : 5) || (single && designs.length > 0)} onClick={() => fileInput.current?.click()}><ImagePlus size={18} />{busy ? "Uploading…" : "Add design photo"}</button>}<small>JPEG, PNG or WebP · up to 5 MB{single && (designs.length > 0 || photos.length > 0) ? " · One reference per garment." : ""}</small></div>
    {busy && <p role="status">Uploading photo…</p>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{photos.map((id) => <div key={id}><ApiImage alt="Custom design reference" src={`/api/order-reference-photos/${id}`} style={{ width: 90, height: 90, objectFit: "cover" }} /><button type="button" onClick={() => onPhotos(photos.filter((photo) => photo !== id))}>Remove</button></div>)}</div>
  </fieldset>
}
