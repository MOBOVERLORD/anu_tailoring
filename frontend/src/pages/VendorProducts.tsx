import { useCallback, useEffect, useMemo, useState } from "react"
import { Boxes, CircleDollarSign, Eye, ImagePlus, Layers3, LoaderCircle, PackagePlus, Pencil, Plus, Ruler, Search, Send, ShieldCheck, ShoppingBag, Trash2, X } from "lucide-react"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { Dialog } from "@/components/Dialog"
import { ImageLightbox } from "@/components/ImageLightbox"
import { VendorStudioNav } from "@/components/VendorStudioNav"
import { AppSelect } from "@/components/ui/AppSelect"
import { api } from "@/lib/api"
import { boundedNumber } from "@/lib/formLimits"
import type { DesignImage, DesignStatus, Product, ProductInput } from "@/types/api"

const emptyForm: ProductInput = { title: "", description: "", product_type: "ready_made", category: "women", garment_type: "", price: 0, unit: "piece", stock_quantity: 1, sizes: [], colors: [] }
const labels: Record<DesignStatus, string> = { draft: "Draft", submitted: "Under review", approved: "Published", rejected: "Needs changes" }
const MAX_BYTES = 5 * 1024 * 1024
const COMMON_SIZES = ["XS", "S", "M", "L", "XL", "XXL"]
const PRODUCT_TYPES = [{ value: "ready_made", label: "Ready-made clothing" }, { value: "fabric", label: "Fabric" }]
const CUSTOMER_CATEGORIES = [{ value: "women", label: "Women" }, { value: "men", label: "Men" }, { value: "unisex", label: "Unisex" }, { value: "kids", label: "Kids" }]
const PRODUCT_STATUSES = [{ value: "all", label: "All statuses" }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]

const VendorProducts = () => {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | DesignStatus>("all")
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<ProductInput>(emptyForm)
  const [formImages, setFormImages] = useState<File[]>([])
  const [addingSize, setAddingSize] = useState(false)
  const [customSize, setCustomSize] = useState("")
  const [saving, setSaving] = useState(false)
  const [lightbox, setLightbox] = useState<{ images: DesignImage[]; index: number } | null>(null)
  const formImagePreviews = useMemo(() => formImages.map((file) => ({ file, url: URL.createObjectURL(file) })), [formImages])

  useEffect(() => () => formImagePreviews.forEach(({ url }) => URL.revokeObjectURL(url)), [formImagePreviews])

  const load = useCallback(async () => {
    try { setProducts(await api<Product[]>("/api/vendor/products")) }
    catch (error) { toast.error((error as Error).message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => products.filter((product) => {
    const term = search.trim().toLowerCase()
    return (statusFilter === "all" || product.status === statusFilter)
      && (!term || [product.title, product.description, product.garment_type || ""].some((value) => value.toLowerCase().includes(term)))
  }), [products, search, statusFilter])

  const openCreate = () => { setEditing(null); setForm(emptyForm); setFormImages([]); setAddingSize(false); setCustomSize(""); setFormOpen(true) }
  const openEdit = (product: Product) => {
    setEditing(product)
    setForm({ title: product.title, description: product.description, product_type: product.product_type, category: product.category, garment_type: product.garment_type || "", price: product.price, unit: product.unit, stock_quantity: product.stock_quantity, sizes: product.sizes, colors: [] })
    setFormImages([])
    setAddingSize(false)
    setCustomSize("")
    setFormOpen(true)
  }
  const toggleSize = (size: string) => setForm((current) => ({
    ...current,
    sizes: current.sizes.includes(size) ? current.sizes.filter((item) => item !== size) : [...current.sizes, size],
  }))
  const addCustomSize = () => {
    const size = customSize.trim().toUpperCase()
    if (!size) return
    setForm((current) => ({ ...current, sizes: current.sizes.includes(size) ? current.sizes : [...current.sizes, size] }))
    setCustomSize("")
    setAddingSize(false)
  }

  const chooseFormImages = (files: FileList | null) => {
    if (!files?.length) return
    const chosen = Array.from(files)
    const existingCount = editing?.images.length || 0
    if (existingCount + formImages.length + chosen.length > 10) return toast.error("Each product can have up to 10 images")
    if (chosen.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size <= 0 || file.size > MAX_BYTES)) return toast.error("Use JPEG, PNG, or WebP images up to 5 MB each")
    setFormImages((current) => [...current, ...chosen])
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    const shouldSubmit = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === "submit"
    if ((editing?.images.length || 0) + formImages.length === 0) {
      toast.error("Add at least one product image before saving")
      return
    }
    setSaving(true)
    let savedProduct: Product | null = null
    try {
      const payload = { ...form, colors: [], garment_type: form.garment_type || null, unit: form.product_type === "fabric" ? "metre" : "piece", price: Number(form.price), stock_quantity: Number(form.stock_quantity) }
      const saved = await api<Product>(editing ? `/api/vendor/products/${editing.id}` : "/api/vendor/products", { method: editing ? "PUT" : "POST", body: JSON.stringify(payload) })
      savedProduct = saved
      for (const [index, file] of formImages.entries()) {
        const data = new FormData(); data.append("file", file); data.append("sort_order", String(saved.images.length + index))
        await api(`/api/vendor/products/${saved.id}/images`, { method: "POST", body: data })
      }
      if (shouldSubmit) {
        await api(`/api/vendor/products/${saved.id}/submit`, { method: "POST" })
        toast.success("Product sent to the administrator for verification")
      } else {
        toast.success(editing?.status === "approved" ? "Changes saved as a draft for reapproval" : editing ? "Product draft updated" : "Product draft and images saved")
      }
      setFormImages([]); setFormOpen(false); await load()
    } catch (error) {
      if (savedProduct) {
        toast.error(`The product draft was saved, but the remaining upload or submission failed: ${(error as Error).message}`)
        setFormImages([]); setFormOpen(false); await load()
      } else toast.error((error as Error).message)
    }
    finally { setSaving(false) }
  }

  const upload = async (product: Product, files: FileList | null) => {
    if (!files?.length) return
    const chosen = Array.from(files)
    if (product.images.length + chosen.length > 10) return toast.error("Each product can have up to 10 images")
    if (chosen.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size <= 0 || file.size > MAX_BYTES)) return toast.error("Use JPEG, PNG, or WebP images up to 5 MB each")
    setBusyId(product.id)
    try {
      for (const [index, file] of chosen.entries()) {
        const data = new FormData(); data.append("file", file); data.append("sort_order", String(product.images.length + index))
        await api(`/api/vendor/products/${product.id}/images`, { method: "POST", body: data })
      }
      toast.success(`${chosen.length} image${chosen.length === 1 ? "" : "s"} uploaded`)
    } catch (error) { toast.error((error as Error).message) }
    finally { setBusyId(null); await load() }
  }

  const remove = async (product: Product) => {
    if (!window.confirm(`Delete “${product.title}”? Its images will also be deleted.`)) return
    setBusyId(product.id)
    try { await api(`/api/vendor/products/${product.id}`, { method: "DELETE" }); toast.success("Product deleted") }
    catch (error) { toast.error((error as Error).message) }
    finally { setBusyId(null); await load() }
  }

  const submit = async (product: Product) => {
    setBusyId(product.id)
    try { await api(`/api/vendor/products/${product.id}/submit`, { method: "POST" }); toast.success("Product sent for approval") }
    catch (error) { toast.error((error as Error).message) }
    finally { setBusyId(null); await load() }
  }

  return (
    <div className="page workspace-page vendor-products-page">
      <VendorStudioNav />
      <section className="workspace-heading"><div><p className="eyebrow"><ShoppingBag size={15} /> Vendor shop</p><h1>Products for sale</h1><p>Manage ready-made clothing and fabric inventory. Products appear in the shop after administrator approval.</p></div><button className="button button-primary" onClick={openCreate} type="button"><PackagePlus size={17} /> Add product</button></section>
      <section className="orders-toolbar"><label className="search-field"><Search size={17} /><input aria-label="Search products" onChange={(event) => setSearch(event.target.value)} placeholder="Search your products…" value={search} /></label><AppSelect ariaLabel="Filter products by status" className="toolbar-select" onValueChange={(value) => setStatusFilter(value as "all" | DesignStatus)} options={PRODUCT_STATUSES} value={statusFilter} /><span>{visible.length} shown</span></section>
      {loading ? <div className="loading-state"><LoaderCircle className="spin" /> Loading products…</div> : visible.length === 0 ? <section className="empty-state"><ShoppingBag size={45} /><h2>No products here yet</h2><p>Create a product draft, upload at least one image, then submit it for review.</p><button className="button button-primary" onClick={openCreate} type="button">Add first product</button></section> : <section className="vendor-product-list">{visible.map((product) => <article className="vendor-product-card" key={product.id}><button className="vendor-product-cover" disabled={!product.image_url} onClick={() => product.image_url && setLightbox({ images: product.images, index: 0 })} type="button">{product.image_url ? <ApiImage alt={product.title} src={product.image_url} /> : <ImagePlus size={32} />}</button><div className="vendor-product-copy"><div><span className={`order-status status-${product.status}`}>{labels[product.status]}</span><small>{product.product_type === "fabric" ? "Fabric" : "Ready-made"} · {product.category}</small></div><h2>{product.title}</h2><p>{product.description}</p>{product.rejection_comment && <div className="review-note"><strong>Reviewer note</strong><p>{product.rejection_comment}</p></div>}<div className="product-inventory"><strong>₹{product.price.toLocaleString("en-IN")} / {product.unit}</strong><span>{product.stock_quantity} {product.unit} in stock</span><span>{product.images.length}/10 images</span></div></div><div className="vendor-product-actions"><button className="button button-secondary" disabled={product.status === "submitted"} onClick={() => openEdit(product)} type="button"><Pencil size={16} /> Edit</button><label className={`button button-secondary ${product.status === "submitted" || busyId === product.id ? "disabled" : ""}`}><ImagePlus size={16} /> Add images<input accept="image/jpeg,image/png,image/webp" disabled={product.status === "submitted" || busyId === product.id} hidden multiple onChange={(event) => { void upload(product, event.target.files); event.target.value = "" }} type="file" /></label>{product.images.length > 0 && <button className="button button-secondary" onClick={() => setLightbox({ images: product.images, index: 0 })} type="button"><Eye size={16} /> Preview</button>}{["draft", "rejected"].includes(product.status) && <button className="button button-primary" disabled={!product.images.length || busyId === product.id} onClick={() => void submit(product)} type="button"><Send size={16} /> Submit</button>}<button className="icon-button danger" disabled={busyId === product.id} onClick={() => void remove(product)} title="Delete product" type="button"><Trash2 size={17} /></button></div></article>)}</section>}

      {formOpen && (
        <Dialog
          className="product-edit-dialog"
          description="Stock is reserved at checkout. Editing a published product sends it through approval again."
          onClose={() => { if (!saving) { setFormImages([]); setFormOpen(false) } }}
          title={editing ? "Edit product" : "Add product"}
        >
          <form className="product-edit-form" onSubmit={save}>
            <div className="product-editor-layout">
              <div className="product-editor-main">
                <section className="product-form-section">
                  <header><span><PackagePlus size={18} /></span><div><h3>Product details</h3><p>Help customers understand exactly what you are selling.</p></div></header>
                  <div className="field"><label htmlFor="shop-title">Product title <b>*</b></label><input autoComplete="off" id="shop-title" maxLength={150} minLength={2} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Handwoven cotton kurta" required value={form.title} /></div>
                  <div className="field"><label htmlFor="shop-description">Description <b>*</b></label><textarea id="shop-description" maxLength={3000} minLength={10} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe the material, fit, finish, and care instructions." required rows={6} value={form.description} /><small>{form.description.length.toLocaleString("en-IN")} / 3,000 characters · minimum 10</small></div>
                </section>
                {form.product_type === "ready_made" && <section className="product-form-section product-size-section">
                  <header><span><Ruler size={18} /></span><div><h3>Available sizes</h3><p>Select every size customers can order.</p></div></header>
                  <div aria-label="Available product sizes" className="product-size-picker" role="group">
                    {COMMON_SIZES.map((size) => <button aria-pressed={form.sizes.includes(size)} className={`product-size-chip ${form.sizes.includes(size) ? "is-selected" : ""}`} key={size} onClick={() => toggleSize(size)} type="button">{size}</button>)}
                    {form.sizes.filter((size) => !COMMON_SIZES.includes(size)).map((size) => <button aria-label={`Remove custom size ${size}`} aria-pressed="true" className="product-size-chip is-selected is-custom" key={size} onClick={() => toggleSize(size)} type="button">{size}<X size={12} /></button>)}
                    <button aria-expanded={addingSize} aria-label="Add a custom size" className="product-size-add" onClick={() => setAddingSize((current) => !current)} type="button"><Plus size={18} /></button>
                  </div>
                  {addingSize && <div className="product-custom-size"><input aria-label="Custom size" autoFocus maxLength={20} onChange={(event) => setCustomSize(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomSize() } else if (event.key === "Escape") { setAddingSize(false); setCustomSize("") } }} placeholder="Custom size, e.g. 3XL" value={customSize} /><button className="button button-secondary button-small" disabled={!customSize.trim()} onClick={addCustomSize} type="button">Add size</button></div>}
                  <small className="product-size-help">Selected sizes are highlighted. Select a highlighted size again to remove it.</small>
                </section>}
                <section className="product-form-section">
                  <header><span><CircleDollarSign size={18} /></span><div><h3>Pricing and stock</h3><p>Customers see this price before delivery is calculated.</p></div></header>
                  <div className="product-form-grid">
                    <div className="field input-with-prefix"><label htmlFor="shop-price">Price per {form.unit} <b>*</b></label><span>₹</span><input id="shop-price" max={1_000_000} min="0.01" onChange={(event) => setForm({ ...form, price: boundedNumber(event.target.value, 0, 1_000_000) })} required step="0.01" type="number" value={form.price} /></div>
                    <div className="field"><label htmlFor="shop-stock">Available stock ({form.unit}) <b>*</b></label><input id="shop-stock" max={1_000_000} min="0.01" onChange={(event) => setForm({ ...form, stock_quantity: boundedNumber(event.target.value, 0, 1_000_000) })} required step={form.unit === "piece" ? 1 : 0.1} type="number" value={form.stock_quantity} /></div>
                  </div>
                </section>
              </div>
              <aside className="product-editor-aside">
                <section className="product-form-section product-media-section">
                  <header><span><ImagePlus size={18} /></span><div><h3>Product photos <b>*</b></h3><p>The first image becomes the shop cover.</p></div></header>
                  <div className={`product-media-grid ${((editing?.images.length || 0) > 0 || formImagePreviews.length > 0) ? "has-images" : "is-empty"}`}>
                    {((editing?.images.length || 0) > 0 || formImagePreviews.length > 0) && <div className="product-form-previews">
                      {editing?.images.map((image, index) => image.url && <div className="product-form-preview" key={`existing-${image.id}`}><ApiImage alt={`${editing.title} image ${index + 1}`} src={image.thumbnail_url || image.url} /><span>{index === 0 ? "Cover" : "Uploaded"}</span></div>)}
                      {formImagePreviews.map(({ file, url }, index) => <div className="product-form-preview is-new" key={`${file.name}-${file.lastModified}-${index}`}><img alt={`New product preview ${index + 1}`} src={url} /><button aria-label={`Remove ${file.name}`} onClick={() => setFormImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button"><X size={14} /></button><span>{(editing?.images.length || 0) === 0 && index === 0 ? "Cover" : "New"}</span></div>)}
                    </div>}
                    <label className="product-image-picker">
                      <input accept="image/jpeg,image/png,image/webp" hidden multiple onChange={(event) => { chooseFormImages(event.target.files); event.target.value = "" }} type="file" />
                      <ImagePlus size={24} /><strong>{((editing?.images.length || 0) + formImages.length) > 0 ? "Add more images" : "Select product images"}</strong><small>{(editing?.images.length || 0) + formImages.length}/10 · JPEG, PNG or WebP · 5 MB max</small>
                    </label>
                  </div>
                </section>
                <section className="product-form-section product-classification-section">
                  <header><span><Layers3 size={18} /></span><div><h3>Classification</h3><p>Controls where customers discover this product.</p></div></header>
                  <div className="field"><label htmlFor="shop-type">Product type</label><AppSelect id="shop-type" onValueChange={(value) => { const product_type = value as ProductInput["product_type"]; setForm({ ...form, product_type, unit: product_type === "fabric" ? "metre" : "piece", sizes: product_type === "fabric" ? [] : form.sizes }) }} options={PRODUCT_TYPES} value={form.product_type} /></div>
                  <div className="field"><label htmlFor="shop-category">Customer category</label><AppSelect id="shop-category" onValueChange={(value) => setForm({ ...form, category: value as ProductInput["category"] })} options={CUSTOMER_CATEGORIES} value={form.category} /></div>
                  <div className="field"><label htmlFor="shop-garment">Style or material</label><input id="shop-garment" maxLength={50} onChange={(event) => setForm({ ...form, garment_type: event.target.value })} placeholder="Kurta, saree, cotton…" value={form.garment_type} /></div>
                </section>
                <div className="product-review-notice"><ShieldCheck size={18} /><div><strong>Administrator verification required</strong><p>Submitting sends the listing and images for approval. It appears in the shop only after verification.</p></div></div>
              </aside>
            </div>
            <footer className="product-form-actions"><span><Boxes size={17} /> Save privately or send the complete listing for verification.</span><div><button className="button button-secondary" disabled={saving} onClick={() => { setFormImages([]); setFormOpen(false) }} type="button">Cancel</button><button className="button button-secondary" disabled={saving} type="submit" value="draft">Save draft</button><button className="button button-primary" disabled={saving} type="submit" value="submit">{saving ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />} Save & submit</button></div></footer>
          </form>
        </Dialog>
      )}
      {lightbox && <ImageLightbox images={lightbox.images.flatMap((image) => image.url ? [{ id: image.id, src: image.url, alt: image.original_filename }] : [])} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  )
}

export default VendorProducts
