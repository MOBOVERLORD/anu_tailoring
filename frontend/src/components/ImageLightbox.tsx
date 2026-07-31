import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react"
import { ApiImage } from "@/components/ApiImage"

export interface LightboxImage {
  id: number
  src: string
  alt: string
  label?: string
}

interface ImageLightboxProps {
  images: LightboxImage[]
  initialIndex?: number
  onClose: () => void
}

export const ImageLightbox = ({ images, initialIndex = 0, onClose }: ImageLightboxProps) => {
  const [index, setIndex] = useState(Math.min(initialIndex, Math.max(0, images.length - 1)))
  const [zoom, setZoom] = useState(1)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const move = (direction: number) => {
    setIndex((current) => (current + direction + images.length) % images.length)
    setZoom(1)
  }

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    closeButtonRef.current?.focus()

    const moveFromKeyboard = (direction: number) => {
      setIndex((current) => (current + direction + images.length) % images.length)
      setZoom(1)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current()
      if (event.key === "ArrowLeft" && images.length > 1) moveFromKeyboard(-1)
      if (event.key === "ArrowRight" && images.length > 1) moveFromKeyboard(1)
      if (event.key === "+" || event.key === "=") setZoom((value) => Math.min(3, value + .25))
      if (event.key === "-") setZoom((value) => Math.max(1, value - .25))
      if (event.key !== "Tab") return

      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )
      if (!controls?.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeyDown)
      previousFocus?.focus()
    }
  }, [images.length])

  if (!images.length) return null
  const image = images[index]

  return (
    <div
      aria-label="Design image viewer"
      aria-modal="true"
      className="image-lightbox"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      ref={dialogRef}
      role="dialog"
    >
      <div className="lightbox-toolbar">
        <span>{index + 1} / {images.length}</span>
        <div>
          <button aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - .25))} type="button"><ZoomOut size={19} /></button>
          <button aria-label="Reset zoom" onClick={() => setZoom(1)} type="button">{Math.round(zoom * 100)}%</button>
          <button aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, value + .25))} type="button"><ZoomIn size={19} /></button>
          <button aria-label="Close image viewer" onClick={onClose} ref={closeButtonRef} type="button"><X size={21} /></button>
        </div>
      </div>
      <div className="lightbox-stage">
        {images.length > 1 && <button aria-label="Previous image" className="lightbox-nav previous" onClick={() => move(-1)} type="button"><ChevronLeft size={28} /></button>}
        <div className="lightbox-image-scroll"><ApiImage alt={image.alt} src={image.src} style={{ transform: `scale(${zoom})` }} /></div>
        {images.length > 1 && <button aria-label="Next image" className="lightbox-nav next" onClick={() => move(1)} type="button"><ChevronRight size={28} /></button>}
      </div>
      <p>{image.label || image.alt}</p>
    </div>
  )
}
