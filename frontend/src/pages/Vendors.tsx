import { useEffect, useMemo, useState } from "react"
import { ChevronRight, Heart, LoaderCircle, MapPin, MessageSquareText, Search, Store } from "lucide-react"
import { Link } from "react-router-dom"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { OrderDesignDialog } from "@/components/OrderDesignDialog"
import { api, getCurrentUser } from "@/lib/api"
import type { Design, UserProfile, VendorDirectoryItem } from "@/types/api"

const Vendors = () => {
  const [vendors, setVendors] = useState<VendorDirectoryItem[]>([])
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [query, setQuery] = useState("")
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [customDesign, setCustomDesign] = useState<Design | null>(null)

  useEffect(() => {
    Promise.all([api<VendorDirectoryItem[]>("/api/vendors"), getCurrentUser()])
      .then(([items, current]) => {
        setVendors(items)
        setProfile(current)
      })
      .catch((error: Error) => toast.error(error.message))
      .finally(() => setLoading(false))
  }, [])

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase()
    return vendors.filter((vendor) => {
      const matchesFavorite = !favoritesOnly || vendor.is_favorite
      const matchesSearch = !search || [
        vendor.shop_name,
        vendor.full_name,
        vendor.location || "",
        vendor.shop_description || "",
      ].some((value) => value.toLowerCase().includes(search))
      return matchesFavorite && matchesSearch
    })
  }, [favoritesOnly, query, vendors])

  const toggleFavorite = async (vendor: VendorDirectoryItem) => {
    if (vendor.id === profile?.id) return
    const next = !vendor.is_favorite
    setVendors((current) => current.map((item) => item.id === vendor.id ? { ...item, is_favorite: next } : item))
    try {
      await api(`/api/vendors/${vendor.id}/favorite`, { method: next ? "POST" : "DELETE" })
    } catch (error) {
      setVendors((current) => current.map((item) => item.id === vendor.id ? { ...item, is_favorite: !next } : item))
      toast.error((error as Error).message)
    }
  }

  const beginCustomOrder = async (vendor: VendorDirectoryItem) => {
    setBusyId(vendor.id)
    try {
      const design = await api<Design>(`/api/vendors/${vendor.id}/custom-design`, { method: "POST" })
      setCustomDesign(design)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page vendor-directory-page">
      <section className="vendor-directory-hero">
        <div><p className="eyebrow"><Store size={15} /> Tailors near your wardrobe</p><h1>Find your tailoring partner</h1><p>Save trusted vendors, compare their shops, and start a private custom-order conversation.</p></div>
      </section>
      <section className="vendor-directory-toolbar">
        <label className="search-field"><Search size={18} /><span className="sr-only">Search vendors</span><input onChange={(event) => setQuery(event.target.value)} placeholder="Search shop, tailor or location" type="search" value={query} /></label>
        <button className={`filter-button ${favoritesOnly ? "active" : ""}`} onClick={() => setFavoritesOnly((value) => !value)} type="button"><Heart fill={favoritesOnly ? "currentColor" : "none"} size={17} /> Favorite vendors</button>
      </section>

      {loading ? <div className="loading-state"><LoaderCircle className="spin" size={25} /> Loading vendors…</div> : visible.length ? (
        <section className="vendor-directory-grid">
          {visible.map((vendor) => {
            const ownShop = vendor.id === profile?.id
            return (
              <article className="vendor-directory-card" key={vendor.id}>
                <div className="vendor-directory-brand">
                  <Link aria-label={`Open ${vendor.shop_name}`} className="vendor-logo" to={`/vendors/${vendor.id}`}>{vendor.logo_url ? <ApiImage alt={`${vendor.shop_name} logo`} src={vendor.logo_url} /> : <Store size={28} />}</Link>
                  <button aria-label={`${vendor.is_favorite ? "Remove" : "Add"} ${vendor.shop_name} ${vendor.is_favorite ? "from" : "to"} favorites`} className={`favorite-button ${vendor.is_favorite ? "active" : ""}`} disabled={ownShop} onClick={() => toggleFavorite(vendor)} type="button"><Heart fill={vendor.is_favorite ? "currentColor" : "none"} size={18} /></button>
                </div>
                <div className="vendor-directory-copy"><small>{vendor.full_name}</small><Link to={`/vendors/${vendor.id}`}><h2>{vendor.shop_name}</h2><p>{vendor.shop_description || "Custom tailoring and made-to-measure service."}</p>{vendor.location && <span><MapPin size={14} /> {vendor.location}</span>}</Link></div>
                <div className="vendor-directory-actions">
                  {ownShop ? <span className="own-shop-label">Your shop</span> : (
                    <><Link className="button button-secondary" to={`/vendors/${vendor.id}`}>View shop <ChevronRight size={16} /></Link><div className="custom-order-availability"><button className="button button-primary" aria-describedby={!vendor.accepts_custom_orders ? `custom-order-unavailable-${vendor.id}` : undefined} disabled={busyId === vendor.id || !vendor.accepts_custom_orders} onClick={() => beginCustomOrder(vendor)} type="button">{busyId === vendor.id ? <LoaderCircle className="spin" size={17} /> : <MessageSquareText size={17} />} Custom order</button>{!vendor.accepts_custom_orders && <small id={`custom-order-unavailable-${vendor.id}`}>Unavailable · Vendor pickup setup pending</small>}</div></>
                  )}
                </div>
              </article>
            )
          })}
        </section>
      ) : <section className="empty-state"><Store size={44} /><h2>No matching vendors</h2><p>Try another shop name, tailor, or location.</p></section>}

      {customDesign && <OrderDesignDialog design={customDesign} onClose={() => setCustomDesign(null)} />}
    </div>
  )
}

export default Vendors
