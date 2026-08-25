import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, ChevronRight, Heart, ImageIcon, LoaderCircle, MapPin, MessageSquareText, PackageOpen, Shirt, ShoppingBag, Store } from "lucide-react"
import { Link, useParams } from "react-router-dom"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { DesignDetailsDialog } from "@/components/DesignDetailsDialog"
import { OrderDesignDialog } from "@/components/OrderDesignDialog"
import { api, getCurrentUser } from "@/lib/api"
import type { Design, Product, UserProfile, VendorDirectoryItem } from "@/types/api"

const money = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`

const VendorStorefront = () => {
  const { vendorId } = useParams()
  const id = Number(vendorId)
  const [vendor, setVendor] = useState<VendorDirectoryItem | null>(null)
  const [designs, setDesigns] = useState<Design[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [favorites, setFavorites] = useState<Design[]>([])
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [selectedDesign, setSelectedDesign] = useState<Design | null>(null)
  const [orderDesign, setOrderDesign] = useState<Design | null>(null)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const [catalogView, setCatalogView] = useState<"designs" | "products">("designs")

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) {
      setLoading(false)
      return
    }
    Promise.all([
      api<VendorDirectoryItem>(`/api/vendors/${id}`),
      api<Design[]>(`/api/designs?vendor_id=${id}`),
      api<Product[]>(`/api/products?vendor_id=${id}`),
      api<Design[]>("/api/designs/liked/me"),
      getCurrentUser(),
    ])
      .then(([vendorProfile, vendorDesigns, vendorProducts, likedDesigns, current]) => {
        setVendor(vendorProfile)
        setDesigns(vendorDesigns)
        setProducts(vendorProducts)
        setFavorites(likedDesigns)
        setProfile(current)
      })
      .catch((error: Error) => toast.error(error.message))
      .finally(() => setLoading(false))
  }, [id])

  const ownShop = vendor?.id === profile?.id
  const specialties = useMemo(() => Array.from(new Set([
    ...designs.map((design) => design.garment_type),
    ...products.map((product) => product.garment_type).filter(Boolean) as string[],
  ])).slice(0, 5), [designs, products])

  const toggleVendorFavorite = async () => {
    if (!vendor || ownShop) return
    const next = !vendor.is_favorite
    setVendor({ ...vendor, is_favorite: next })
    try {
      await api(`/api/vendors/${vendor.id}/favorite`, { method: next ? "POST" : "DELETE" })
    } catch (error) {
      setVendor({ ...vendor, is_favorite: !next })
      toast.error((error as Error).message)
    }
  }

  const toggleDesignFavorite = async (design: Design) => {
    const liked = favorites.some((item) => item.id === design.id)
    setFavorites((current) => liked ? current.filter((item) => item.id !== design.id) : [...current, design])
    try {
      await api(`/api/designs/${design.id}/like`, { method: liked ? "DELETE" : "POST" })
    } catch (error) {
      setFavorites((current) => liked ? [...current, design] : current.filter((item) => item.id !== design.id))
      toast.error((error as Error).message)
    }
  }

  const beginCustomOrder = async () => {
    if (!vendor) return
    setRequesting(true)
    try {
      setOrderDesign(await api<Design>(`/api/vendors/${vendor.id}/custom-design`, { method: "POST" }))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setRequesting(false)
    }
  }

  if (loading) return <div className="page"><div className="loading-state"><LoaderCircle className="spin" size={25} /> Opening vendor shop…</div></div>
  if (!vendor) return <div className="page"><section className="empty-state"><Store size={42} /><h1>Vendor not found</h1><p>This shop is unavailable or no longer active.</p><Link className="button" to="/vendors"><ArrowLeft size={17} /> Browse vendors</Link></section></div>

  return (
    <div className="page vendor-storefront-page">
      <Link className="vendor-storefront-back" to="/vendors"><ArrowLeft size={17} /> All vendors</Link>
      <section className="vendor-storefront-hero">
        <div className="vendor-storefront-identity">
          <span className="vendor-logo storefront-logo">{vendor.logo_url ? <ApiImage alt={`${vendor.shop_name} logo`} src={vendor.logo_url} /> : <Store size={38} />}</span>
          <div><p className="eyebrow">Verified vendor shop</p><h1>{vendor.shop_name}</h1><p className="vendor-storefront-owner">Tailored by {vendor.full_name}</p>{vendor.location && <span><MapPin size={15} /> {vendor.location}</span>}</div>
        </div>
        <div className="vendor-storefront-actions">
          {!ownShop && <button aria-pressed={vendor.is_favorite} className={`button button-secondary ${vendor.is_favorite ? "design-favorite-active" : ""}`} onClick={toggleVendorFavorite} type="button"><Heart fill={vendor.is_favorite ? "currentColor" : "none"} size={17} /> {vendor.is_favorite ? "Saved vendor" : "Save vendor"}</button>}
          {!ownShop && vendor.accepts_custom_orders && <button className="button button-primary" disabled={requesting} onClick={beginCustomOrder} type="button">{requesting ? <LoaderCircle className="spin" size={17} /> : <MessageSquareText size={17} />} Custom order</button>}
          {ownShop && <Link className="button button-primary" to="/profile?section=shop"><Store size={17} /> Manage your shop</Link>}
        </div>
      </section>

      <section className="vendor-storefront-about">
        <div><p className="section-kicker">About the shop</p><h2>Made around your needs</h2><p>{vendor.shop_description || "Custom tailoring, alterations, and made-to-measure garments from this verified Vastrivo vendor."}</p></div>
        {specialties.length > 0 && <div className="vendor-specialties">{specialties.map((item) => <span key={item}>{item.replaceAll("_", " ")}</span>)}</div>}
      </section>

      <section className="vendor-catalog-panel">
        <div aria-label="Shop catalog" className="vendor-catalog-tabs" role="tablist">
          <button aria-selected={catalogView === "designs"} className={catalogView === "designs" ? "active" : ""} onClick={() => setCatalogView("designs")} role="tab" type="button"><Shirt size={17} /><span><strong>Designs</strong></span></button>
          <button aria-selected={catalogView === "products"} className={catalogView === "products" ? "active" : ""} onClick={() => setCatalogView("products")} role="tab" type="button"><ShoppingBag size={17} /><span><strong>Products</strong></span></button>
        </div>

        {catalogView === "designs" ? <section className="vendor-showcase-section" role="tabpanel">
          <div className="vendor-showcase-heading"><div><p className="section-kicker">Made-to-measure</p><h2>Designs from {vendor.shop_name}</h2></div></div>
          {designs.length ? <div className="vendor-showcase-grid">{designs.map((design) => {
            const liked = favorites.some((item) => item.id === design.id)
            return <article className="vendor-showcase-card" key={design.id}>
              <button className="vendor-showcase-image" onClick={() => setSelectedDesign(design)} type="button">{design.thumbnail_url || design.image_url ? <ApiImage alt={design.title} src={design.thumbnail_url || design.image_url!} /> : <Shirt size={44} />}<span>View design</span></button>
              <div className="vendor-showcase-copy"><div className="design-meta"><span>{design.category}</span><span>{design.garment_type}</span></div><h3>{design.title}</h3><p>{design.description}</p><div><strong>From {money(design.base_price)}</strong><button aria-label={`${liked ? "Remove" : "Add"} ${design.title} ${liked ? "from" : "to"} favorites`} className={`favorite-inline ${liked ? "active" : ""}`} onClick={() => toggleDesignFavorite(design)} type="button"><Heart fill={liked ? "currentColor" : "none"} size={17} /></button></div></div>
            </article>
          })}</div> : <div className="vendor-showcase-empty"><Shirt size={32} /><div><strong>No published designs yet</strong><p>{!ownShop && vendor.accepts_custom_orders ? "Use Custom order above to discuss something made for you." : "Published designs from this shop will appear here."}</p></div></div>}
        </section> : <section className="vendor-showcase-section" role="tabpanel">
          <div className="vendor-showcase-heading"><div><p className="section-kicker">Ready to buy</p><h2>Products from this shop</h2></div></div>
          {products.length ? <div className="vendor-showcase-grid">{products.map((product) => <article className="vendor-showcase-card" key={product.id}>
            <Link className="vendor-showcase-image" to={`/shop?product=${product.id}`}>{product.thumbnail_url || product.image_url ? <ApiImage alt={product.title} src={product.thumbnail_url || product.image_url!} /> : <ImageIcon size={44} />}<span>View product</span></Link>
            <div className="vendor-showcase-copy"><div className="design-meta"><span>{product.product_type === "fabric" ? "fabric" : "ready-made"}</span><span>{product.category}</span></div><h3>{product.title}</h3><p>{product.description}</p><div><strong>{money(product.price)} / {product.unit}</strong><Link className="vendor-product-link" to={`/shop?product=${product.id}`}>Buy <ChevronRight size={15} /></Link></div></div>
          </article>)}</div> : <div className="vendor-showcase-empty"><PackageOpen size={32} /><div><strong>No products for sale yet</strong><p>Published clothes and fabrics will appear here.</p></div></div>}
        </section>}
      </section>

      {selectedDesign && <DesignDetailsDialog design={selectedDesign} isFavorite={favorites.some((item) => item.id === selectedDesign.id)} onClose={() => setSelectedDesign(null)} onOrder={!ownShop ? () => { setOrderDesign(selectedDesign); setSelectedDesign(null) } : undefined} onToggleFavorite={() => toggleDesignFavorite(selectedDesign)} />}
      {orderDesign && <OrderDesignDialog design={orderDesign} onClose={() => setOrderDesign(null)} />}
    </div>
  )
}

export default VendorStorefront
