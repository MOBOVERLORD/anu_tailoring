import { useEffect, useMemo, useState } from "react"
import { Check, ImageIcon, LoaderCircle, Search, ShoppingBag, X } from "lucide-react"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { ImageLightbox } from "@/components/ImageLightbox"
import { api } from "@/lib/api"
import type { DesignImage, Product } from "@/types/api"

export const ProductApprovals = () => {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [comments, setComments] = useState<Record<number, string>>({})
  const [lightbox, setLightbox] = useState<{ images: DesignImage[]; index: number } | null>(null)

  useEffect(() => {
    api<Product[]>("/api/admin/products?status=submitted").then(setProducts).catch((error) => toast.error((error as Error).message)).finally(() => setLoading(false))
  }, [])
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products.filter((product) => !term || [product.title, product.vendor_name, product.description].some((value) => value.toLowerCase().includes(term)))
  }, [products, search])
  const review = async (product: Product, decision: "approved" | "rejected") => {
    const comment = comments[product.id]?.trim()
    if (decision === "rejected" && !comment) return toast.error("Add a reason before rejecting this product")
    setBusyId(product.id)
    try {
      await api(`/api/admin/products/${product.id}/review`, { method: "POST", body: JSON.stringify({ decision, comment: comment || null }) })
      setProducts((current) => current.filter((item) => item.id !== product.id))
      toast.success(decision === "approved" ? "Product published in the shop" : "Product returned to the vendor")
    } catch (error) { toast.error((error as Error).message) }
    finally { setBusyId(null) }
  }

  return <section className="admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">Shop approval queue</p><h2>Submitted products</h2></div><label className="search-field"><Search size={17} /><input aria-label="Search product approvals" onChange={(event) => setSearch(event.target.value)} placeholder="Product or vendor…" value={search} /></label></div>{loading ? <div className="loading-state"><LoaderCircle className="spin" /> Loading product queue…</div> : visible.length === 0 ? <div className="admin-empty"><ShoppingBag size={36} /><h3>No products awaiting review</h3><p>New vendor submissions will appear here.</p></div> : <div className="review-grid">{visible.map((product) => <article className="review-card" key={product.id}><button className="review-card-image" onClick={() => setLightbox({ images: product.images, index: 0 })} type="button">{product.image_url ? <ApiImage alt={product.title} src={product.image_url} /> : <ImageIcon size={36} />}<span>{product.images.length} images</span></button><div className="review-card-body"><div className="review-meta"><span>{product.product_type === "fabric" ? "Fabric" : "Ready-made"}</span><span>{product.category}</span></div><h3>{product.title}</h3><p>{product.description}</p><dl className="product-facts"><div><dt>Vendor</dt><dd>{product.vendor_name}</dd></div><div><dt>Price</dt><dd>₹{product.price.toLocaleString("en-IN")} / {product.unit}</dd></div><div><dt>Stock</dt><dd>{product.stock_quantity} {product.unit}</dd></div></dl><div className="field"><label htmlFor={`product-note-${product.id}`}>Reviewer note</label><textarea id={`product-note-${product.id}`} onChange={(event) => setComments((current) => ({ ...current, [product.id]: event.target.value }))} placeholder="Required when rejecting" rows={3} value={comments[product.id] || ""} /></div><div className="review-actions"><button className="button button-secondary danger-text" disabled={busyId === product.id} onClick={() => void review(product, "rejected")} type="button"><X size={16} /> Reject</button><button className="button button-primary" disabled={busyId === product.id} onClick={() => void review(product, "approved")} type="button"><Check size={16} /> Approve & publish</button></div></div></article>)}</div>}{lightbox && <ImageLightbox images={lightbox.images.flatMap((image) => image.url ? [{ id: image.id, src: image.url, alt: image.original_filename }] : [])} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />}</section>
}
