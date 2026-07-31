import { useEffect, useState } from "react"
import type { ImgHTMLAttributes } from "react"
import { apiBlob } from "@/lib/api"


type ApiImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string
}


export const ApiImage = ({ src, alt, ...props }: ApiImageProps) => {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    let currentUrl: string | null = null

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
  }, [src])

  return objectUrl ? <img {...props} alt={alt} src={objectUrl} /> : null
}
