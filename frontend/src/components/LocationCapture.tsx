import { ExternalLink, LoaderCircle, LocateFixed, Map, MapPin, ShieldCheck, X } from "lucide-react"
import { lazy, Suspense, useState } from "react"
import toast from "react-hot-toast"
import { api } from "@/lib/api"
import type { ResolvedLocation } from "@/types/api"

interface LocationCaptureProps {
  compact?: boolean
  current?: Pick<ResolvedLocation, "latitude" | "longitude"> | null
  onResolved: (location: ResolvedLocation) => void
}

const geolocationErrorMessage = (error: GeolocationPositionError) => {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location access was blocked. Allow location for this site in your browser settings and try again."
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "Your device could not determine its location. Turn on location services and try again."
  }
  return "Location capture timed out. Move near a window or check your device location settings."
}

const LocationMapPicker = lazy(() => import("@/components/LocationMapPicker"))

export const LocationCapture = ({ compact = false, current, onResolved }: LocationCaptureProps) => {
  const [resolving, setResolving] = useState(false)
  const [resolved, setResolved] = useState<ResolvedLocation | null>(null)
  const [mapOpen, setMapOpen] = useState(false)

  const resolveCoordinates = async (latitude: number, longitude: number, accuracyMeters: number | null) => {
    if (resolving) return
    setResolving(true)
    try {
      const location = await api<ResolvedLocation>("/api/addresses/resolve-location", {
        method: "POST",
        body: JSON.stringify({
          latitude,
          longitude,
          accuracy_meters: accuracyMeters,
        }),
      })
      setResolved(location)
      onResolved(location)
      toast.success("Location selected")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setResolving(false)
    }
  }

  const capture = () => {
    if (!navigator.geolocation) {
      toast.error("This browser does not support device location")
      return
    }
    if (!window.isSecureContext && window.location.hostname !== "localhost") {
      toast.error("Location access requires HTTPS")
      return
    }

    setResolving(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setResolving(false)
        await resolveCoordinates(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.accuracy,
        )
      },
      (error) => {
        toast.error(geolocationErrorMessage(error))
        setResolving(false)
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 15_000 },
    )
  }

  const visible = resolved || current
  const mapUrl = visible
    ? `https://www.openstreetmap.org/?mlat=${visible.latitude}&mlon=${visible.longitude}#map=18/${visible.latitude}/${visible.longitude}`
    : null

  return (
    <section className={`location-capture ${compact ? "compact" : ""}`}>
      <div className="location-capture-head">
        <span className="location-capture-icon"><LocateFixed size={19} /></span>
        <div>
          <strong>Pin the exact location</strong>
          <p>Use this device to fill the address fields and pin the delivery or pickup point.</p>
        </div>
        <div className="location-actions">
          <button className="button button-secondary location-button" disabled={resolving} onClick={capture} type="button">
            {resolving && !mapOpen ? <LoaderCircle className="spin" size={16} /> : <LocateFixed size={16} />}
            {visible ? "Use my location" : "Locate me"}
          </button>
          <button className={`button button-secondary location-button ${mapOpen ? "is-active" : ""}`} onClick={() => setMapOpen((currentValue) => !currentValue)} type="button">
            {mapOpen ? <X size={16} /> : <Map size={16} />}{mapOpen ? "Close map" : "Choose on map"}
          </button>
        </div>
      </div>
      {mapOpen && (
        <Suspense fallback={<div className="location-map-loading"><LoaderCircle className="spin" size={20} /> Loading map...</div>}>
          <LocationMapPicker
            latitude={visible?.latitude}
            longitude={visible?.longitude}
            resolving={resolving}
            onSelect={(latitude, longitude) => void resolveCoordinates(latitude, longitude, null)}
          />
        </Suspense>
      )}
      {visible && (
        <div className="captured-location">
          <MapPin size={17} />
          <div>
            <strong>{resolved ? resolved.formatted_address : "Precise location saved"}</strong>
            <small>
              {visible.latitude.toFixed(6)}, {visible.longitude.toFixed(6)}
              {resolved?.accuracy_meters != null ? ` · accurate to about ${Math.round(resolved.accuracy_meters)} m` : ""}
            </small>
          </div>
          {mapUrl && <a aria-label="View captured location on OpenStreetMap" href={mapUrl} rel="noreferrer" target="_blank"><ExternalLink size={16} /></a>}
        </div>
      )}
      <p className="location-privacy"><ShieldCheck size={14} /> Your coordinates are shared only with Vastrivo to calculate delivery routes.</p>
    </section>
  )
}
