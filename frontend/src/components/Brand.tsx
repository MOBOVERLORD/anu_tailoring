import { Scissors } from "lucide-react"
import { Link } from "react-router-dom"

interface BrandProps {
  compact?: boolean
}

export function Brand({ compact = false }: BrandProps) {
  return (
    <Link className="brand" to="/">
      <span className="brand-mark" aria-hidden="true">
        <Scissors size={compact ? 17 : 20} strokeWidth={2.4} />
      </span>
      <span>
        <strong>Vastrivo</strong>
      </span>
    </Link>
  )
}
