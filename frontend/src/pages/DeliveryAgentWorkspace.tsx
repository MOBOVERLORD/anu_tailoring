import { useCallback, useEffect, useMemo, useState } from "react"
import { CheckCircle2, ExternalLink, LocateFixed, LoaderCircle, MapPin, Navigation, PackageCheck, Phone, RefreshCw, Route, Truck } from "lucide-react"
import toast from "react-hot-toast"
import { api } from "@/lib/api"
import type { DeliveryAgentLocation, DeliveryPage, DeliveryRecord, DeliveryStatus } from "@/types/api"

const statusLabels: Record<DeliveryStatus, string> = {
  quote_ready: "Quote ready",
  booked: "Booked · awaiting pickup",
  picked_up: "Picked up",
  in_transit: "In transit",
  delivered: "Delivered",
  cancelled: "Cancelled",
}

const nextStep: Partial<Record<DeliveryStatus, { status: "picked_up" | "in_transit" | "delivered"; label: string }>> = {
  booked: { status: "picked_up", label: "Confirm pickup" },
  picked_up: { status: "in_transit", label: "Start delivery" },
  in_transit: { status: "delivered", label: "Mark delivered" },
}

const osmDirections = (fromLat: number, fromLng: number, toLat: number, toLng: number) =>
  `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(`${fromLat},${fromLng};${toLat},${toLng}`)}`

const DeliveryAgentWorkspace = () => {
  const [location, setLocation] = useState<DeliveryAgentLocation | null>(null)
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [page, currentLocation] = await Promise.all([
        api<DeliveryPage>("/api/delivery-agent/deliveries"),
        api<DeliveryAgentLocation>("/api/delivery-agent/location"),
      ])
      setDeliveries(page.items)
      setLocation(currentLocation)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const shareLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Location is not supported by this browser")
      return
    }
    setSharing(true)
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const updated = await api<DeliveryAgentLocation>("/api/delivery-agent/location", {
          method: "PUT",
          body: JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy_meters: position.coords.accuracy,
          }),
        })
        setLocation(updated)
        toast.success("Current location shared with delivery operations")
      } catch (error) {
        toast.error((error as Error).message)
      } finally {
        setSharing(false)
      }
    }, (error) => {
      setSharing(false)
      toast.error(error.code === error.PERMISSION_DENIED ? "Allow location access to update your position" : "Could not read your current location")
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 })
  }

  const updateStatus = async (delivery: DeliveryRecord) => {
    const next = nextStep[delivery.status]
    if (!next) return
    setBusyId(delivery.id)
    try {
      const updated = await api<DeliveryRecord>(`/api/delivery-agent/deliveries/${delivery.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: next.status }),
      })
      setDeliveries((current) => current.map((item) => item.id === updated.id ? updated : item))
      toast.success(`Delivery ${updated.tracking_number} is ${statusLabels[updated.status].toLowerCase()}`)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  const visible = useMemo(() => deliveries.filter((delivery) => showCompleted
    ? ["delivered", "cancelled"].includes(delivery.status)
    : !["delivered", "cancelled"].includes(delivery.status)), [deliveries, showCompleted])

  return <div className="page workspace-page delivery-agent-workspace">
    <section className="workspace-heading delivery-agent-hero">
      <div><p className="eyebrow"><Truck size={15} /> Delivery partner</p><h1>Your assigned route</h1><p>Share your position when you start work, then update each handoff as it happens.</p></div>
      <button className="button button-primary" disabled={sharing} onClick={shareLocation} type="button">{sharing ? <LoaderCircle className="spin" size={17} /> : <LocateFixed size={17} />} {location?.location_updated_at ? "Update my location" : "Share my location"}</button>
    </section>

    <section className="agent-location-card">
      <LocateFixed size={21} />
      <div><strong>{location?.location_updated_at ? "Location available to dispatch" : "Location not shared yet"}</strong><p>{location?.location_updated_at ? `Last updated ${new Date(location.location_updated_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}${location.accuracy_meters ? ` · about ${Math.round(location.accuracy_meters)} m accuracy` : ""}` : "Administrators use this to coordinate you with the vendor pickup point. Location updates only when you press the button."}</p></div>
      {location?.latitude != null && location.longitude != null && <a className="button button-secondary" href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=16/${location.latitude}/${location.longitude}`} rel="noreferrer" target="_blank"><ExternalLink size={15} /> View my pin</a>}
    </section>

    <div className="agent-delivery-toolbar"><div className="segmented-control"><button className={!showCompleted ? "active" : ""} onClick={() => setShowCompleted(false)} type="button">Assigned</button><button className={showCompleted ? "active" : ""} onClick={() => setShowCompleted(true)} type="button">History</button></div><button className="button button-secondary" disabled={loading} onClick={() => void load()} type="button"><RefreshCw size={16} /> Refresh</button></div>

    {loading ? <div className="loading-state"><LoaderCircle className="spin" /> Loading assigned deliveries…</div> : visible.length === 0 ? <div className="admin-empty"><PackageCheck size={36} /><h3>{showCompleted ? "No completed deliveries" : "No active assignments"}</h3><p>{showCompleted ? "Completed and cancelled deliveries appear here." : "An administrator will assign booked pickups to you."}</p></div> : <div className="agent-delivery-list">{visible.map((delivery) => {
      const goToPickup = delivery.status === "booked"
      const target = goToPickup
        ? { latitude: delivery.origin_latitude, longitude: delivery.origin_longitude, label: "vendor pickup" }
        : { latitude: delivery.destination_latitude, longitude: delivery.destination_longitude, label: "customer delivery" }
      const routeUrl = location?.latitude != null && location.longitude != null
        ? osmDirections(location.latitude, location.longitude, target.latitude, target.longitude)
        : osmDirections(delivery.origin_latitude, delivery.origin_longitude, delivery.destination_latitude, delivery.destination_longitude)
      const next = nextStep[delivery.status]
      return <article className="agent-delivery-card" key={delivery.id}>
        <header><div><span className={`delivery-status status-${delivery.status}`}>{statusLabels[delivery.status]}</span><h2>{delivery.tracking_number || `Delivery #${delivery.id}`}</h2><small>{delivery.order_type === "tailoring" ? "Tailoring" : "Shop"} order #{delivery.order_id ?? delivery.product_order_id}</small></div><strong>₹{delivery.delivery_cost.toLocaleString("en-IN")}</strong></header>
        <div className="agent-route-stops">
          <div className={goToPickup ? "current" : "done"}><MapPin size={18} /><span><small>Pick up from · {delivery.vendor_name}</small><strong>{delivery.origin_address}</strong></span></div>
          <Route size={21} />
          <div className={delivery.status === "in_transit" ? "current" : ""}><Navigation size={18} /><span><small>Deliver to · {delivery.customer_name}</small><strong>{delivery.destination_address}</strong>{delivery.customer_phone && <a href={`tel:${delivery.customer_phone}`}><Phone size={14} /> {delivery.customer_phone}</a>}</span></div>
        </div>
        <div className="agent-delivery-actions"><a className="button button-secondary" href={routeUrl} rel="noreferrer" target="_blank"><Navigation size={16} /> Route to {target.label}</a>{next && <button className="button button-primary" disabled={busyId === delivery.id} onClick={() => void updateStatus(delivery)} type="button">{busyId === delivery.id ? <LoaderCircle className="spin" size={16} /> : next.status === "delivered" ? <CheckCircle2 size={16} /> : <Truck size={16} />} {next.label}</button>}</div>
      </article>
    })}</div>}
  </div>
}

export default DeliveryAgentWorkspace
