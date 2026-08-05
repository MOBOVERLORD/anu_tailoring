import { AlertTriangle, LoaderCircle } from "lucide-react"
import { Dialog } from "@/components/Dialog"

interface ConfirmActionDialogProps {
  title: string
  description: string
  confirmLabel: string
  busy?: boolean
  tone?: "brand" | "danger"
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmActionDialog({
  title,
  description,
  confirmLabel,
  busy = false,
  tone = "brand",
  onCancel,
  onConfirm,
}: ConfirmActionDialogProps) {
  return (
    <Dialog className="confirm-action-dialog" onClose={busy ? () => undefined : onCancel} title={title}>
      <div className={`confirm-action-content tone-${tone}`}>
        <span><AlertTriangle size={22} /></span>
        <p>{description}</p>
      </div>
      <div className="dialog-actions">
        <button className="button button-secondary" disabled={busy} onClick={onCancel} type="button">Cancel</button>
        <button className={`button ${tone === "danger" ? "button-danger" : ""}`} disabled={busy} onClick={onConfirm} type="button">
          {busy && <LoaderCircle className="spin" size={16} />}
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}
