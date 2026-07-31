import { useEffect, useState } from "react"
import { LoaderCircle, MapPin, PackageCheck, Ruler } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { Dialog } from "@/components/Dialog"
import { api } from "@/lib/api"
import type { DeliveryAddress, Design, MeasurementProfile, Order } from "@/types/api"

interface OrderDesignDialogProps {
  design: Design
  onClose: () => void
}

export const OrderDesignDialog = ({ design, onClose }: OrderDesignDialogProps) => {
  const [measurements, setMeasurements] = useState<MeasurementProfile[]>([])
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([])
  const [measurementId, setMeasurementId] = useState("")
  const [addressId, setAddressId] = useState("")
  const [fabric, setFabric] = useState("")
  const [instructions, setInstructions] = useState("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  const fabricModifier = ({ cotton: 0, linen: 15, silk: 45, wool: 30 } as Record<string, number>)[fabric] || 0
  const orderTotal = design.base_price + fabricModifier

  useEffect(() => {
    Promise.all([
      api<MeasurementProfile[]>("/api/measurements"),
      api<DeliveryAddress[]>("/api/addresses"),
    ])
      .then(([profiles, savedAddresses]) => {
        setMeasurements(profiles)
        setAddresses(savedAddresses)
        const matching = profiles.find((profile) => profile.garment_type === design.garment_type) || profiles[0]
        setMeasurementId(matching ? String(matching.id) : "")
        const defaultAddress = savedAddresses.find((address) => address.is_default) || savedAddresses[0]
        setAddressId(defaultAddress ? String(defaultAddress.id) : "")
      })
      .catch((error: Error) => toast.error(error.message))
      .finally(() => setLoading(false))
  }, [design.garment_type])

  const placeOrder = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!measurementId || !addressId) return
    setSubmitting(true)
    try {
      const order = await api<Order>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          address_id: Number(addressId),
          items: [{
            design_id: design.id,
            measurement_profile_id: Number(measurementId),
            fabric_choice: fabric || null,
            custom_instructions: instructions.trim() || null,
          }],
        }),
      })
      toast.success(`Order #${order.id} placed successfully`)
      onClose()
      navigate("/orders")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog className="order-dialog" description="Confirm your fit and delivery details before placing the order." onClose={onClose} title={`Order ${design.title}`}>
      {loading ? (
        <div className="loading-state"><LoaderCircle className="spin" size={22} /> Preparing your order…</div>
      ) : !measurements.length || !addresses.length ? (
        <div className="order-requirements">
          <PackageCheck size={38} />
          <h3>Complete your tailoring details</h3>
          <p>You need at least one measurement profile and one delivery address before ordering.</p>
          <Link className="button" onClick={onClose} to="/profile">Complete Profile & Settings</Link>
        </div>
      ) : (
        <form className="order-form" onSubmit={placeOrder}>
          <div className="order-design-summary">
            <div>{design.image_url ? <ApiImage alt={design.title} src={design.image_url} /> : <PackageCheck size={28} />}</div>
            <span><small>Made-to-measure design</small><strong>{design.title}</strong><b>₹{design.base_price.toLocaleString("en-IN")}</b></span>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="order-measurements"><Ruler size={14} /> Measurement profile</label>
              <select className="select-control" id="order-measurements" onChange={(event) => setMeasurementId(event.target.value)} required value={measurementId}>
                {measurements.map((profile) => <option key={profile.id} value={profile.id}>{profile.profile_name} · {profile.garment_type.replaceAll("_", " ")}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="order-address"><MapPin size={14} /> Delivery address</label>
              <select className="select-control" id="order-address" onChange={(event) => setAddressId(event.target.value)} required value={addressId}>
                {addresses.map((address) => <option key={address.id} value={address.id}>{address.recipient_name} · {address.city}{address.is_default ? " (Default)" : ""}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="order-fabric">Fabric preference <small>optional</small></label>
            <select className="select-control" id="order-fabric" onChange={(event) => setFabric(event.target.value)} value={fabric}>
              <option value="">Discuss with tailor</option>
              <option value="cotton">Cotton</option><option value="linen">Linen</option><option value="silk">Silk</option><option value="wool">Wool</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="order-instructions">Tailoring notes <small>optional</small></label>
            <textarea id="order-instructions" maxLength={1000} onChange={(event) => setInstructions(event.target.value)} placeholder="Preferred fit, occasion date, colour notes, or questions for the tailor" rows={3} value={instructions} />
          </div>
          <div className="order-total"><span>Estimated total</span><strong>₹{orderTotal.toLocaleString("en-IN")}</strong></div>
          <div className="dialog-actions">
            <button className="button button-secondary" onClick={onClose} type="button">Cancel</button>
            <button className="button" disabled={submitting} type="submit">{submitting ? <LoaderCircle className="spin" size={17} /> : <PackageCheck size={17} />} Place order</button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
