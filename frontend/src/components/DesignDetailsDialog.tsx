import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Heart, Maximize2, Shirt, ShoppingBag, Store } from "lucide-react"
import { ApiImage } from "@/components/ApiImage"
import { Dialog } from "@/components/Dialog"
import { ImageLightbox, type LightboxImage } from "@/components/ImageLightbox"
import type { Design } from "@/types/api"

interface DesignDetailsDialogProps {
  design: Design
  isFavorite: boolean
  onClose: () => void
  onOrder?: () => void
  onToggleFavorite: () => void
}

const getGallery = (design: Design): LightboxImage[] => {
  const images = design.images
    .filter((image) => image.upload_status === "ready" && Boolean(image.url))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((image, index) => ({
      id: image.id,
      src: image.url as string,
      alt: `${design.title}, image ${index + 1}`,
      label: image.original_filename,
    }))

  if (images.length || !design.image_url) return images
  return [{ id: design.id, src: design.image_url, alt: design.title }]
}

export const DesignDetailsDialog = ({
  design,
  isFavorite,
  onClose,
  onOrder,
  onToggleFavorite,
}: DesignDetailsDialogProps) => {
  const gallery = useMemo(() => getGallery(design), [design])
  const [index, setIndex] = useState(0)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const selectedImage = gallery[index]

  const move = (direction: number) => {
    setIndex((current) => (current + direction + gallery.length) % gallery.length)
  }

  return (
    <>
      <Dialog
        className="design-detail-dialog"
        description={design.vendor_name ? `Created by ${design.vendor_name}` : "Made to your measurements"}
        onClose={onClose}
        title={design.title}
      >
        <div className="design-detail-layout">
          <div className="design-detail-gallery">
            <div className="design-detail-main">
              {selectedImage ? (
                <button
                  aria-label={`Open ${design.title} image ${index + 1} full screen`}
                  className="design-detail-image-button"
                  onClick={() => setLightboxIndex(index)}
                  type="button"
                >
                  <ApiImage alt={selectedImage.alt} src={selectedImage.src} />
                  <span><Maximize2 size={16} /> View full screen</span>
                </button>
              ) : (
                <div className="design-detail-placeholder"><Shirt size={54} /></div>
              )}

              {gallery.length > 1 && (
                <>
                  <button aria-label="Previous design image" className="design-detail-nav previous" onClick={() => move(-1)} type="button">
                    <ChevronLeft size={22} />
                  </button>
                  <button aria-label="Next design image" className="design-detail-nav next" onClick={() => move(1)} type="button">
                    <ChevronRight size={22} />
                  </button>
                  <span className="design-detail-count">{index + 1} / {gallery.length}</span>
                </>
              )}
            </div>

            {gallery.length > 1 && (
              <div aria-label="Design images" className="design-detail-thumbnails" role="tablist">
                {gallery.map((image, imageIndex) => (
                  <button
                    aria-label={`Show image ${imageIndex + 1}`}
                    aria-selected={index === imageIndex}
                    className={index === imageIndex ? "active" : ""}
                    key={image.id}
                    onClick={() => setIndex(imageIndex)}
                    role="tab"
                    type="button"
                  >
                    <ApiImage alt="" src={image.src} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="design-detail-copy">
            <div className="design-meta">
              <span>{design.category}</span>
              <span>{design.garment_type}</span>
            </div>
            <p>{design.description || "A made-to-measure design tailored for your preferred fit."}</p>
            {design.vendor_name && (
              <div className="design-vendor"><Store size={16} /><span>Designed by <strong>{design.vendor_name}</strong></span></div>
            )}
            <div className="design-detail-footer">
              <div>
                <small>Starting from</small>
                <strong>₹{design.base_price.toLocaleString("en-IN")}</strong>
              </div>
              <div className="design-detail-actions">
                <button aria-pressed={isFavorite} className={`button ${isFavorite ? "design-favorite-active" : "button-secondary"}`} onClick={onToggleFavorite} type="button">
                  <Heart fill={isFavorite ? "currentColor" : "none"} size={17} /> {isFavorite ? "Saved" : "Save"}
                </button>
                {onOrder && <button className="button" onClick={onOrder} type="button"><ShoppingBag size={17} /> Order design</button>}
              </div>
            </div>
          </div>
        </div>
      </Dialog>

      {lightboxIndex !== null && (
        <ImageLightbox images={gallery} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}
    </>
  )
}
