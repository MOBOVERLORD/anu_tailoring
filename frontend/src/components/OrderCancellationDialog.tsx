import { useState } from "react"
import { AlertTriangle, LoaderCircle } from "lucide-react"
import { Dialog } from "@/components/Dialog"

interface OrderCancellationDialogProps {
  title: string
  description: string
  confirmLabel: string
  busy?: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}

export function OrderCancellationDialog({
  title,
  description,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: OrderCancellationDialogProps) {
  const [reason, setReason] = useState("")
  const normalizedReason = reason.trim()
  return (
    <Dialog className="confirm-action-dialog" onClose={busy ? () => undefined : onCancel} title={title}>
      <div className="confirm-dialog-body">
        <div className="confirm-action-content tone-danger">
          <span><AlertTriangle size={22} /></span>
          <p>{description}</p>
        </div>
        <div className="field">
          <label htmlFor="order-cancellation-reason">Reason</label>
          <textarea
            autoFocus
            id="order-cancellation-reason"
            maxLength={1000}
            minLength={5}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Explain why this order cannot continue"
            rows={4}
            value={reason}
          />
          <small>This reason is saved in the order conversation and shared with the other party.</small>
        </div>
        <div className="dialog-actions">
          <button className="button button-secondary" disabled={busy} onClick={onCancel} type="button">Keep order</button>
          <button className="button button-danger" disabled={busy || normalizedReason.length < 5} onClick={() => onConfirm(normalizedReason)} type="button">
            {busy && <LoaderCircle className="spin" size={16} />}{confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
