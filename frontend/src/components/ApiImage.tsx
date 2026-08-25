import { useEffect, useRef, useState } from "react"
import type { ImgHTMLAttributes } from "react"
import { apiBlob } from "@/lib/api"


type ApiImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string
}


export const ApiImage = ({ src, alt, ...props }: ApiImageProps) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [shouldLoad, setShouldLoad] = useState(false)
  const imageRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    const element = imageRef.current
    if (!element || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShouldLoad(true)
        observer.disconnect()
      }
    }, { rootMargin: "320px" })
    observer.observe(element)
    return () => observer.disconnect()
  }, [src])

  useEffect(() => {
    if (!shouldLoad) return
    const controller = new AbortController()
    let currentUrl: string | null = null
    setObjectUrl(null)

    apiBlob(src, { signal: controller.signal })
      .then((blob) => {
        currentUrl = URL.createObjectURL(blob)
        setObjectUrl(currentUrl)
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setObjectUrl(null)
      })

    return () => {
      controller.abort()
      if (currentUrl) URL.revokeObjectURL(currentUrl)
    }
  }, [shouldLoad, src])

  return <img
    {...props}
    alt={alt}
    className={`${props.className || ""} ${objectUrl ? "api-image-ready" : "api-image-loading"}`.trim()}
    decoding={props.decoding || "async"}
    loading={props.loading || "lazy"}
    ref={imageRef}
    src={objectUrl || "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="}
  />
}
