import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { api } from "@/lib/api"
import { ApiImage } from "@/components/ApiImage"
import type { Design } from "@/types/api"

export function CustomOrderReferences({ vendorId, designs, photos, onDesigns, onPhotos, onBusy }: {
  vendorId: number; designs: number[]; photos: string[]
  onDesigns: (ids: number[]) => void; onPhotos: (ids: string[]) => void; onBusy: (busy: boolean) => void
}) {
  const [catalog, setCatalog] = useState<Design[]>([])
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let current = true
    setError("")
    api<Design[]>(`/api/designs?vendor_id=${vendorId}`).then((items) => { if (current) setCatalog(items) }).catch((reason: Error) => { if (current) setError(reason.message) })
    return () => { current = false }
  }, [vendorId, retry])
  async function upload(file?: File) {
    if (!file || busy || photos.length >= 5) return
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) { toast.error("Use JPEG, PNG or WebP up to 5 MB."); return }
    setBusy(true); onBusy(true)
    try {
      const body = new FormData(); body.append("file", file)
      const result = await api<{ id: string }>("/api/order-reference-photos", { method: "POST", body })
      onPhotos([...photos, result.id])
    } catch (reason) { toast.error((reason as Error).message) }
    finally { setBusy(false); onBusy(false) }
  }
  return <fieldset disabled={busy} style={{ border: 0, padding: 0 }}><legend>Design references (optional)</legend><p>Choose up to 5 vendor designs and 5 photos. These are style references, not additional ordered items. The selected measurement profile applies to this request.</p>
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry((v) => v + 1)}>Retry designs</button></p>}
    <div style={{ maxHeight: 220, overflowY: "auto" }}>{catalog.map((design) => <label key={design.id} style={{ display: "flex", gap: 10, padding: 8 }}><input type="checkbox" checked={designs.includes(design.id)} disabled={!designs.includes(design.id) && designs.length >= 5} onChange={() => onDesigns(designs.includes(design.id) ? designs.filter((id) => id !== design.id) : [...designs, design.id])} />{design.title}</label>)}</div>
    <div className="field"><label htmlFor="reference-photo">Upload reference photo ({photos.length}/5)</label><input id="reference-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || photos.length >= 5} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = "" }} /></div>
    {busy && <p role="status">Uploading photo…</p>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>{photos.map((id) => <div key={id}><ApiImage alt="Custom design reference" src={`/api/order-reference-photos/${id}`} style={{ width: 90, height: 90, objectFit: "cover" }} /><button type="button" onClick={() => onPhotos(photos.filter((photo) => photo !== id))}>Remove</button></div>)}</div>
  </fieldset>
}
