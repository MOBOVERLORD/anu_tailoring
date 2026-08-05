import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, ImageIcon, LoaderCircle, MapPin, Package, Search, ShoppingBag, Store, Truck } from "lucide-react"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { Dialog } from "@/components/Dialog"
import { ImageLightbox } from "@/components/ImageLightbox"
import { AppSelect } from "@/components/ui/AppSelect"
import { api, getCurrentUser } from "@/lib/api"
import { boundedNumber } from "@/lib/formLimits"
import type { DeliveryAddress, DeliveryQuote, DesignImage, Product, ProductOrder, UserProfile } from "@/types/api"

const money = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`
const SHOP_PRODUCT_TYPES = [{ value: "all", label: "All product types" }, { value: "ready_made", label: "Ready-made" }, { value: "fabric", label: "Fabric" }]
const SHOP_CATEGORIES = [{ value: "all", label: "All categories" }, { value: "women", label: "Women" }, { value: "men", label: "Men" }, { value: "unisex", label: "Unisex" }, { value: "kids", label: "Kids" }]

const Shop = () => {
  const [products, setProducts] = useState<Product[]>([])
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [type, setType] = useState("all")
  const [category, setCategory] = useState("all")
  const [selected, setSelected] = useState<Product | null>(null)
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([])
  const [addressId, setAddressId] = useState<number | "">("")
  const [quantity, setQuantity] = useState(1)
  const [size, setSize] = useState("")
  const [quote, setQuote] = useState<DeliveryQuote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [ordering, setOrdering] = useState(false)
  const [lightbox, setLightbox] = useState<{ images: DesignImage[]; index: number } | null>(null)

  const load = useCallback(async () => {
    try {
      const [items, me] = await Promise.all([api<Product[]>("/api/products"), getCurrentUser()])
      setProducts(items)
      setProfile(me)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const visible = useMemo(() => products.filter((product) => {
    const term = search.trim().toLowerCase()
    return (type === "all" || product.product_type === type)
      && (category === "all" || product.category === category)
      && (!term || [product.title, product.description, product.vendor_name, product.garment_type || ""]
        .some((value) => value.toLowerCase().includes(term)))
  }), [category, products, search, type])

  const openProduct = async (product: Product) => {
    setSelected(product)
    setQuantity(1)
    setSize(product.sizes[0] || "")
    setQuote(null)
    if ((profile?.role === "customer" || profile?.role === "vendor") && product.vendor_id !== profile.id && addresses.length === 0) {
      try {
        const items = await api<DeliveryAddress[]>("/api/addresses")
        setAddresses(items)
        setAddressId(items.find((item) => item.is_default)?.id || items[0]?.id || "")
      } catch (error) {
        toast.error((error as Error).message)
      }
    }
  }

  const getQuote = async () => {
    if (!selected || !addressId) return
    setQuoting(true)
    try {
      const result = await api<DeliveryQuote>("/api/delivery/quote", {
        method: "POST",
        body: JSON.stringify({ product_id: selected.id, address_id: Number(addressId) }),
      })
      setQuote(result)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setQuoting(false)
    }
  }

  const placeOrder = async () => {
    if (!selected || !addressId || !quote) return
    setOrdering(true)
    try {
      await api<ProductOrder>("/api/product-orders", {
        method: "POST",
        body: JSON.stringify({
          product_id: selected.id,
          address_id: Number(addressId),
          quantity,
          selected_size: size || null,
          delivery_quote_token: quote.quote_token,
        }),
      })
      toast.success("Order placed. The vendor has been notified.")
      setSelected(null)
      await load()
    } catch (error) {
      toast.error((error as Error).message)
      setQuote(null)
    } finally {
      setOrdering(false)
    }
  }

  return (
    <div className="page shop-page">
      <section className="workspace-heading shop-heading">
        <div><p className="eyebrow"><ShoppingBag size={15} /> Anu shop</p><h1>Clothes and fabrics, from verified vendors</h1><p>Buy ready-made garments or fabric by length, with delivery calculated from the vendor to your address.</p></div>
        <span className="queue-count">{products.length} available</span>
      </section>

      <section className="orders-toolbar" aria-label="Filter shop products">
        <label className="search-field"><Search size={17} /><span className="sr-only">Search products</span><input onChange={(event) => setSearch(event.target.value)} placeholder="Search products or vendors…" value={search} /></label>
        <AppSelect ariaLabel="Product type" className="toolbar-select" onValueChange={setType} options={SHOP_PRODUCT_TYPES} value={type} />
        <AppSelect ariaLabel="Category" className="toolbar-select" onValueChange={setCategory} options={SHOP_CATEGORIES} value={category} />
      </section>

      {loading ? <div className="loading-state"><LoaderCircle className="spin" /> Loading shop…</div> : visible.length === 0 ? (
        <section className="empty-state"><ShoppingBag size={46} strokeWidth={1.4} /><h2>No products match</h2><p>Try another filter or check back after vendors publish new stock.</p></section>
      ) : (
        <section className="product-grid">
          {visible.map((product) => (
            <article className="product-card" key={product.id}>
              <button className="product-card-image" onClick={() => void openProduct(product)} type="button">
                {product.image_url ? <ApiImage alt={product.title} src={product.image_url} /> : <ImageIcon size={42} />}
                <span>{product.product_type === "fabric" ? "Fabric" : "Ready-made"}</span>
              </button>
              <div className="product-card-body"><small>{product.vendor_name} · {product.category}</small><h2>{product.title}</h2><p>{product.description}</p><div><strong>{money(product.price)} <small>/ {product.unit}</small></strong><span>{product.stock_quantity} {product.unit} in stock</span></div><button className="button button-primary button-wide" onClick={() => void openProduct(product)} type="button">View & buy</button></div>
            </article>
          ))}
        </section>
      )}

      {selected && (
        <Dialog className="product-dialog" description="Review the item, choose your options, and confirm delivery." onClose={() => setSelected(null)} title="Product details">
          <div className="product-dialog-grid">
            <div className="product-gallery">
              {selected.image_url ? <button aria-label={`Open ${selected.title} image gallery`} className="product-main-image" onClick={() => setLightbox({ images: selected.images, index: 0 })} type="button"><ApiImage alt={selected.title} src={selected.image_url} /><span className="product-image-hint"><ImageIcon size={15} /> View full size</span><span className="product-image-count">1 / {selected.images.length}</span></button> : <div className="product-main-image product-image-empty"><ImageIcon /><span>No product image</span></div>}
              {selected.images.length > 1 && <div className="product-thumbnails">{selected.images.map((image, index) => image.url && <button onClick={() => setLightbox({ images: selected.images, index })} type="button" key={image.id}><ApiImage alt={`${selected.title} view ${index + 1}`} src={image.url} /></button>)}</div>}
            </div>
            <div className="product-purchase">
              <div className="product-kicker-row"><span className="product-verified"><CheckCircle2 size={14} /> Verified listing</span><span>{selected.category}</span></div>
              <div className="product-title-block"><h2>{selected.title}</h2><p><Store size={15} /> Sold by <strong>{selected.vendor_name}</strong></p></div>
              <div className="product-price"><strong>{money(selected.price)}</strong><span>per {selected.unit}</span></div>
              <div className={`product-stock ${selected.stock_quantity <= 5 ? "is-low" : ""}`}><span aria-hidden="true" />{selected.stock_quantity} {selected.unit} available{selected.stock_quantity <= 5 ? " · Low stock" : " · In stock"}</div>
              <p className="product-description">{selected.description}</p>
              <dl className="product-facts"><div><dt>Product type</dt><dd>{selected.product_type === "fabric" ? "Fabric" : "Ready-made garment"}</dd></div>{selected.garment_type && <div><dt>Style</dt><dd>{selected.garment_type}</dd></div>}</dl>
              {profile?.role === "vendor" && selected.vendor_id === profile.id ? <div className="permission-note"><Package size={18} /><p>This is your own listing. Manage its price, stock, and images from Vendor products.</p></div> : profile?.role !== "customer" && profile?.role !== "vendor" ? <div className="permission-note"><Package size={18} /><p>Customer and vendor accounts can place shop orders.</p></div> : addresses.length === 0 ? <div className="permission-note"><MapPin size={18} /><p>Add a delivery address in Profile & settings before ordering.</p></div> : (
                <div className="product-order-form">
                  <div className="product-options-heading"><h3>Choose your options</h3><span>Required before checkout</span></div>
                  <div className="form-row">
                    <div className="field"><label htmlFor="product-quantity">Quantity ({selected.unit})</label><input id="product-quantity" min={selected.unit === "piece" ? 1 : 0.1} max={selected.stock_quantity} onChange={(event) => { setQuantity(boundedNumber(event.target.value, 0, selected.stock_quantity)); setQuote(null) }} step={selected.unit === "piece" ? 1 : 0.1} type="number" value={quantity} /></div>
                    {selected.sizes.length > 0 && <div className="field"><label htmlFor="product-size">Size</label><AppSelect id="product-size" onValueChange={setSize} options={selected.sizes.map((item) => ({ value: item, label: item }))} value={size} /></div>}
                  </div>
                  <div className="field"><label htmlFor="product-address">Deliver to</label><AppSelect id="product-address" onValueChange={(value) => { setAddressId(Number(value)); setQuote(null) }} options={addresses.map((address) => ({ value: String(address.id), label: `${address.recipient_name} · ${address.street_address}, ${address.city}` }))} placeholder="Choose a delivery address" value={String(addressId)} /></div>
                  {!quote ? <button className="button button-primary button-wide product-purchase-action" disabled={quoting || !addressId || quantity <= 0 || quantity > selected.stock_quantity} onClick={getQuote} type="button">{quoting ? <LoaderCircle className="spin" size={17} /> : <Truck size={17} />} Calculate delivery &amp; total</button> : <div className="shop-total"><div><span>Products</span><strong>{money(selected.price * quantity)}</strong></div><div><span>Delivery · {(quote.distance_meters / 1000).toFixed(1)} km</span><strong>{money(quote.delivery_cost)}</strong></div><div><span>Total</span><strong>{money(selected.price * quantity + quote.delivery_cost)}</strong></div></div>}
                  {quote && <button className="button button-primary button-wide" disabled={ordering} onClick={placeOrder} type="button">{ordering ? <LoaderCircle className="spin" size={17} /> : <ShoppingBag size={17} />} Place order</button>}
                </div>
              )}
            </div>
          </div>
        </Dialog>
      )}
      {lightbox && <ImageLightbox images={lightbox.images.flatMap((image) => image.url ? [{ id: image.id, src: image.url, alt: image.original_filename }] : [])} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  )
}

export default Shop
