import type { ReactNode } from "react"
import { X } from "lucide-react"

interface DialogProps {
  title: string
  description?: string
  children: ReactNode
  className?: string
  onClose: () => void
}

export function Dialog({ title, description, children, className = "", onClose }: DialogProps) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        aria-labelledby="dialog-title"
        className={`dialog-panel ${className}`.trim()}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close dialog">
            <X size={19} />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}
