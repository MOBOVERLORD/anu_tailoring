import { useEffect, useState } from "react"
import { LoaderCircle, MapPin, PackageCheck, Ruler, Shirt, Truck } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { Dialog } from "@/components/Dialog"
import { AppSelect } from "@/components/ui/AppSelect"
import { api } from "@/lib/api"
import type { DeliveryAddress, DeliveryQuote, Design, MeasurementProfile, Order } from "@/types/api"

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
  const [clothSource, setClothSource] = useState<"customer_provided" | "vendor_supplied">("customer_provided")
  const [instructions, setInstructions] = useState("")
  const [loading, setLoading] = useState(true)
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

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

  useEffect(() => {
    if (!addressId) return
    let cancelled = false
    setQuoteLoading(true)
    setQuoteError("")
    setDeliveryQuote(null)
    api<DeliveryQuote>("/api/delivery/quote", {
      method: "POST",
      body: JSON.stringify({ design_id: design.id, address_id: Number(addressId) }),
    })
      .then((quote) => { if (!cancelled) setDeliveryQuote(quote) })
      .catch((error: Error) => { if (!cancelled) setQuoteError(error.message) })
      .finally(() => { if (!cancelled) setQuoteLoading(false) })
    return () => { cancelled = true }
  }, [addressId, design.id])

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
            cloth_source: clothSource,
            fabric_choice: fabric || null,
            custom_instructions: instructions.trim() || null,
            delivery_quote_token: deliveryQuote?.quote_token || null,
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
            <span><small>Made-to-measure design</small><strong>{design.title}</strong><b>Tailoring ₹{design.base_price.toLocaleString("en-IN")}</b></span>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="order-measurements"><Ruler size={14} /> Measurement profile</label>
              <AppSelect id="order-measurements" onValueChange={setMeasurementId} options={measurements.map((profile) => ({ value: String(profile.id), label: `${profile.profile_name} · ${profile.garment_type.replaceAll("_", " ")}` }))} value={measurementId} />
            </div>
            <div className="field">
              <label htmlFor="order-address"><MapPin size={14} /> Delivery address</label>
              <AppSelect id="order-address" onValueChange={setAddressId} options={addresses.map((address) => ({ value: String(address.id), label: `${address.recipient_name} · ${address.city}${address.is_default ? " (Default)" : ""}` }))} value={addressId} />
            </div>
          </div>
          <div className="field cloth-source-choice">
            <span className="field-label"><Shirt size={14} /> Who will provide the cloth?</span>
            <div className="segmented-control">
              <button className={clothSource === "customer_provided" ? "active" : ""} onClick={() => setClothSource("customer_provided")} type="button"><strong>I will provide it</strong><small>No cloth cost in the vendor invoice</small></button>
              <button className={clothSource === "vendor_supplied" ? "active" : ""} onClick={() => setClothSource("vendor_supplied")} type="button"><strong>Vendor will provide it</strong><small>Vendor quotes cloth after reviewing measurements</small></button>
            </div>
            <small>Your choice is saved with this design and cannot be changed by the vendor.</small>
          </div>
          <div className="field">
            <label htmlFor="order-fabric">Fabric preference <small>optional</small></label>
            <AppSelect id="order-fabric" onValueChange={(value) => setFabric(value === "__discuss__" ? "" : value)} options={[{ value: "__discuss__", label: "Discuss with tailor" }, { value: "cotton", label: "Cotton" }, { value: "linen", label: "Linen" }, { value: "silk", label: "Silk" }, { value: "wool", label: "Wool" }]} value={fabric || "__discuss__"} />
          </div>
          <div className="field">
            <label htmlFor="order-instructions">Tailoring notes <small>optional</small></label>
            <textarea id="order-instructions" maxLength={1000} onChange={(event) => setInstructions(event.target.value)} placeholder="Preferred fit, occasion date, colour notes, or questions for the tailor" rows={3} value={instructions} />
          </div>
          <div className="delivery-quote-card">
            <Truck size={20} />
            {quoteLoading ? <div><strong>Calculating delivery…</strong><small>Checking the driving route from the vendor.</small></div> : deliveryQuote ? <><div><small>{deliveryQuote.provider_name} · {(deliveryQuote.distance_meters / 1000).toFixed(1)} km</small><strong>Delivery ₹{deliveryQuote.delivery_cost.toLocaleString("en-IN")}</strong></div><span>₹{deliveryQuote.price_per_100m}/100 m</span></> : <div className="delivery-quote-error"><strong>Delivery quote unavailable</strong><small>{quoteError || "Select a valid delivery address."}</small></div>}
          </div>
          <div className="order-total"><span>Estimated order total<small>Tailoring ₹{design.base_price.toLocaleString("en-IN")} + delivery{deliveryQuote ? ` ₹${deliveryQuote.delivery_cost.toLocaleString("en-IN")}` : ""}</small></span><strong>₹{(design.base_price + (deliveryQuote?.delivery_cost || 0)).toLocaleString("en-IN")}</strong></div>
          <p className="order-quote-note">Delivery is calculated automatically from the vendor pickup point to this address and cannot be changed by the vendor. The vendor will always provide the exact cloth requirement from your selected measurements. {clothSource === "vendor_supplied" ? "The vendor invoice will include cloth cost, and the vendor must attach the cloth bill before you finalize payment." : "Because you are providing the cloth, the vendor invoice cannot include a cloth cost."} Work begins after invoice approval and cloth readiness.</p>
          <div className="dialog-actions">
            <button className="button button-secondary" onClick={onClose} type="button">Cancel</button>
            <button className="button" disabled={submitting || quoteLoading || !deliveryQuote} type="submit">{submitting ? <LoaderCircle className="spin" size={17} /> : <PackageCheck size={17} />} Place order</button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
