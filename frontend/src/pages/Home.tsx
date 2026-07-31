import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Eye, Heart, LoaderCircle, Search, Shirt, Sparkles } from "lucide-react"
import { useSearchParams } from "react-router-dom"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { DesignDetailsDialog } from "@/components/DesignDetailsDialog"
import { OrderDesignDialog } from "@/components/OrderDesignDialog"
import { api } from "@/lib/api"
import type { Design, UserProfile } from "@/types/api"

type Category = "all" | "women" | "men"

const Home = () => {
  const [designs, setDesigns] = useState<Design[]>([])
  const [favorites, setFavorites] = useState<Design[]>([])
  const [category, setCategory] = useState<Category>("all")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [cardImageIndexes, setCardImageIndexes] = useState<Record<number, number>>({})
  const [selectedDesign, setSelectedDesign] = useState<Design | null>(null)
  const [orderDesign, setOrderDesign] = useState<Design | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const favoritesOnly = searchParams.get("view") === "favorites"

  useEffect(() => {
    Promise.all([
      api<Design[]>("/api/designs"),
      api<Design[]>("/api/designs/liked/me"),
      api<UserProfile>("/api/auth/me"),
    ])
      .then(([allDesigns, likedDesigns, currentProfile]) => {
        setDesigns(allDesigns)
        setFavorites(likedDesigns)
        setProfile(currentProfile)
      })
      .catch((error: Error) => toast.error(error.message))
      .finally(() => setLoading(false))
  }, [])

  const visibleDesigns = useMemo(() => {
    const source = favoritesOnly ? favorites : designs
    return source.filter((design) => {
      const matchesCategory = category === "all" || design.category === category
      const searchText = `${design.title} ${design.description} ${design.garment_type}`.toLowerCase()
      return matchesCategory && searchText.includes(query.toLowerCase())
    })
  }, [category, designs, favorites, favoritesOnly, query])

  const toggleFavorite = async (design: Design) => {
    const alreadyLiked = favorites.some((item) => item.id === design.id)
    setFavorites((current) => alreadyLiked
      ? current.filter((item) => item.id !== design.id)
      : [...current, design]
    )
    try {
      await api<void>(`/api/designs/${design.id}/like`, {
        method: alreadyLiked ? "DELETE" : "POST",
      })
    } catch (error) {
      setFavorites((current) => alreadyLiked
        ? [...current, design]
        : current.filter((item) => item.id !== design.id)
      )
      toast.error((error as Error).message)
    }
  }

  const moveCardImage = (designId: number, imageCount: number, direction: number) => {
    setCardImageIndexes((current) => ({
      ...current,
      [designId]: ((current[designId] ?? 0) + direction + imageCount) % imageCount,
    }))
  }

  return (
    <div className="page catalog-page">
      <section className="catalog-heading">
        <div>
          <p className="eyebrow"><Sparkles size={15} /> Made for your measurements</p>
          <h1>{favoritesOnly ? "Your favorite designs" : "Find your next perfect fit"}</h1>
          <p>
            {favoritesOnly
              ? "All the styles you’ve saved, ready when inspiration strikes."
              : "Browse our made-to-measure collection and save the designs you love."}
          </p>
        </div>
        <div className="catalog-stitch" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>

      <section className="catalog-toolbar" aria-label="Design filters">
        <div className="segmented-control">
          {(["all", "women", "men"] as Category[]).map((value) => (
            <button
              className={category === value ? "active" : ""}
              key={value}
              onClick={() => setCategory(value)}
              type="button"
            >
              {value === "all" ? "All designs" : value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={18} />
          <span className="sr-only">Search designs</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search designs"
            type="search"
            value={query}
          />
        </label>
        <button
          className={`filter-button ${favoritesOnly ? "active" : ""}`}
          onClick={() => setSearchParams(favoritesOnly ? {} : { view: "favorites" })}
          type="button"
        >
          <Heart fill={favoritesOnly ? "currentColor" : "none"} size={17} />
          Favorites
          {favorites.length > 0 && <span>{favorites.length}</span>}
        </button>
      </section>

      {loading ? (
        <div className="loading-state">
          <LoaderCircle className="spin" size={26} />
          <p>Preparing the collection…</p>
        </div>
      ) : visibleDesigns.length > 0 ? (
        <section className="design-grid" aria-live="polite">
          {visibleDesigns.map((design) => {
            const liked = favorites.some((item) => item.id === design.id)
            const gallery = design.images
              .filter((image) => image.upload_status === "ready" && Boolean(image.url))
              .sort((a, b) => a.sort_order - b.sort_order)
            const imageIndex = Math.min(cardImageIndexes[design.id] ?? 0, Math.max(0, gallery.length - 1))
            const currentImageUrl = gallery[imageIndex]?.url || design.image_url
            return (
              <article className="design-card" key={design.id}>
                <div className="design-image">
                  {currentImageUrl ? (
                    <button
                      aria-label={`Open ${design.title}`}
                      className="design-preview-trigger"
                      onClick={() => setSelectedDesign(design)}
                      type="button"
                    >
                      <ApiImage alt={`${design.title}, image ${imageIndex + 1}`} src={currentImageUrl} />
                      <span><Eye size={16} /> View design</span>
                    </button>
                  ) : <div className="design-image-placeholder"><Shirt size={42} /></div>}
                  <button
                    aria-pressed={liked}
                    aria-label={`${liked ? "Remove" : "Add"} ${design.title} ${liked ? "from" : "to"} favorites`}
                    className={`favorite-button ${liked ? "active" : ""}`}
                    onClick={() => toggleFavorite(design)}
                    type="button"
                  >
                    <Heart fill={liked ? "currentColor" : "none"} size={19} />
                  </button>
                  {gallery.length > 1 && (
                    <>
                      <button
                        aria-label={`Previous image for ${design.title}`}
                        className="card-gallery-nav previous"
                        onClick={() => moveCardImage(design.id, gallery.length, -1)}
                        type="button"
                      >
                        <ChevronLeft size={19} />
                      </button>
                      <button
                        aria-label={`Next image for ${design.title}`}
                        className="card-gallery-nav next"
                        onClick={() => moveCardImage(design.id, gallery.length, 1)}
                        type="button"
                      >
                        <ChevronRight size={19} />
                      </button>
                      <span className="card-gallery-count">{imageIndex + 1} / {gallery.length}</span>
                    </>
                  )}
                </div>
                <div className="design-card-body">
                  <div className="design-meta">
                    <span>{design.category}</span>
                    <span>{design.garment_type}</span>
                  </div>
                  <button className="design-title-button" onClick={() => setSelectedDesign(design)} type="button">
                    <h2>{design.title}</h2>
                  </button>
                  <p>{design.description}</p>
                  <div className="design-card-footer">
                    <strong>From ₹{design.base_price.toLocaleString("en-IN")}</strong>
                    <button className="design-view-button" onClick={() => setSelectedDesign(design)} type="button">
                      View design <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      ) : (
        <section className="empty-state">
          <div className="empty-illustration">
            <span className="empty-orbit" />
            <Shirt size={50} strokeWidth={1.5} />
          </div>
          <p className="eyebrow">{favoritesOnly ? "A fresh start" : "Collection coming soon"}</p>
          <h2>{favoritesOnly ? "No favorites saved yet" : "New designs are on the cutting table"}</h2>
          <p>
            {favoritesOnly
              ? "Tap the heart on any design and it’ll be waiting for you here."
              : "We’re preparing our first set of made-to-measure looks. Check back soon."}
          </p>
          {favoritesOnly && (
            <button className="button" onClick={() => setSearchParams({})} type="button">
              Browse all designs
            </button>
          )}
        </section>
      )}
      {selectedDesign && (
        <DesignDetailsDialog
          design={selectedDesign}
          isFavorite={favorites.some((item) => item.id === selectedDesign.id)}
          onClose={() => setSelectedDesign(null)}
          onOrder={profile?.role === "customer" ? () => {
            setOrderDesign(selectedDesign)
            setSelectedDesign(null)
          } : undefined}
          onToggleFavorite={() => toggleFavorite(selectedDesign)}
        />
      )}
      {orderDesign && <OrderDesignDialog design={orderDesign} onClose={() => setOrderDesign(null)} />}
    </div>
  )
}

export default Home
