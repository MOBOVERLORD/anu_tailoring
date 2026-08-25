import { useEffect, useState } from "react"
import { LoaderCircle, PackageCheck, Ruler, Shirt, ShoppingCart } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import toast from "react-hot-toast"
import { ApiImage } from "@/components/ApiImage"
import { Dialog } from "@/components/Dialog"
import { AppSelect } from "@/components/ui/AppSelect"
import { useCart } from "@/context/CartContext"
import { api } from "@/lib/api"
import type { Design, MeasurementProfile } from "@/types/api"

interface OrderDesignDialogProps { design: Design; onClose: () => void }

export const OrderDesignDialog = ({ design, onClose }: OrderDesignDialogProps) => {
  const isCustomRequest = design.is_custom_request_template
  const [measurements, setMeasurements] = useState<MeasurementProfile[]>([])
  const [measurementId, setMeasurementId] = useState("")
  const [fabric, setFabric] = useState("")
  const [clothSource, setClothSource] = useState<"customer_provided" | "vendor_supplied">("customer_provided")
  const [instructions, setInstructions] = useState("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const cart = useCart()
  const navigate = useNavigate()

  useEffect(() => {
    api<MeasurementProfile[]>("/api/measurements").then((profiles) => {
      setMeasurements(profiles)
      const matching = profiles.find((profile) => profile.garment_type === design.garment_type) || profiles[0]
      setMeasurementId(matching ? String(matching.id) : "")
    }).catch((error: Error) => toast.error(error.message)).finally(() => setLoading(false))
  }, [design.garment_type])

  const addToCart = (event: React.FormEvent) => {
    event.preventDefault()
    if (!measurementId || design.vendor_id == null) return
    setSubmitting(true)
    try {
      const measurement = measurements.find((item) => item.id === Number(measurementId))
      if (!measurement) throw new Error("Choose a measurement profile")
      cart.addDesign({ vendor_id: design.vendor_id, vendor_name: design.vendor_name || "Vendor", design, measurement_profile_id: measurement.id, measurement_name: measurement.profile_name, cloth_source: clothSource, fabric_choice: fabric || null, custom_instructions: instructions.trim() || null })
      toast.success("Design added to your vendor cart")
      onClose()
      navigate("/cart")
    } catch (error) { toast.error((error as Error).message) } finally { setSubmitting(false) }
  }

  return <Dialog className="order-dialog" description={isCustomRequest ? "Configure your request now. It can be combined with other items from this vendor at checkout." : "Choose the fit and cloth details, then add this design to your vendor cart."} onClose={onClose} title={isCustomRequest ? "Custom tailoring" : `Order ${design.title}`}>
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={22} /> Preparing your design…</div> : !measurements.length ? <div className="order-requirements"><PackageCheck size={38} /><h3>Add your measurements first</h3><p>You need at least one measurement profile before adding a tailored design.</p><Link className="button" onClick={onClose} to="/profile?section=measurements">Add measurements</Link></div> :
      <form className="order-form" onSubmit={addToCart}>
        <div className="order-design-summary"><div>{design.thumbnail_url || design.image_url ? <ApiImage alt={design.title} src={design.thumbnail_url || design.image_url!} /> : <PackageCheck size={28} />}</div><span><small>{isCustomRequest ? "Private vendor request" : "Made-to-measure design"}</small><strong>{design.title}</strong><b>{isCustomRequest ? "Service price quoted after discussion" : `Tailoring ₹${design.base_price.toLocaleString("en-IN")}`}</b></span></div>
        <div className="field"><label htmlFor="order-measurements"><Ruler size={14} /> Measurement profile</label><AppSelect id="order-measurements" onValueChange={setMeasurementId} options={measurements.map((profile) => ({ value: String(profile.id), label: `${profile.profile_name} · ${profile.garment_type.replaceAll("_", " ")}` }))} value={measurementId} /></div>
        <div className="field cloth-source-choice"><span className="field-label"><Shirt size={14} /> Who will provide the cloth?</span><div className="segmented-control"><button className={clothSource === "customer_provided" ? "active" : ""} onClick={() => setClothSource("customer_provided")} type="button"><strong>I will provide it</strong><small>No cloth cost in the invoice</small></button><button className={clothSource === "vendor_supplied" ? "active" : ""} onClick={() => setClothSource("vendor_supplied")} type="button"><strong>Vendor will provide it</strong><small>Vendor quotes cloth after reviewing measurements</small></button></div></div>
        <div className="field"><label htmlFor="order-fabric">Fabric preference <small>optional</small></label><AppSelect id="order-fabric" onValueChange={(value) => setFabric(value === "__discuss__" ? "" : value)} options={[{ value: "__discuss__", label: "Discuss with tailor" }, { value: "cotton", label: "Cotton" }, { value: "linen", label: "Linen" }, { value: "silk", label: "Silk" }, { value: "wool", label: "Wool" }]} value={fabric || "__discuss__"} /></div>
        <div className="field"><label htmlFor="order-instructions">{isCustomRequest ? "Describe your custom garment" : "Tailoring notes"} {!isCustomRequest && <small>optional</small>}</label><textarea id="order-instructions" maxLength={1000} minLength={isCustomRequest ? 10 : undefined} onChange={(event) => setInstructions(event.target.value)} placeholder={isCustomRequest ? "Garment type, reference style, occasion, preferred fit and questions for the tailor" : "Preferred fit, occasion date, or questions for the tailor"} required={isCustomRequest} rows={isCustomRequest ? 5 : 3} value={instructions} /></div>
        <p className="order-quote-note">Items from {design.vendor_name || "this vendor"} are combined into one order. At checkout you will choose one address and pay one delivery charge for the entire vendor order.</p>
        <div className="dialog-actions"><button className="button button-secondary" onClick={onClose} type="button">Cancel</button><button className="button" disabled={submitting || (isCustomRequest && instructions.trim().length < 10)} type="submit">{submitting ? <LoaderCircle className="spin" size={17} /> : <ShoppingCart size={17} />} Add to cart</button></div>
      </form>}
  </Dialog>
}
