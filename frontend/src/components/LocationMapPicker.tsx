import "leaflet/dist/leaflet.css"
import { LoaderCircle } from "lucide-react"
import { useEffect } from "react"
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet"

interface LocationMapPickerProps {
  latitude?: number
  longitude?: number
  resolving: boolean
  onSelect: (latitude: number, longitude: number) => void
}

const MapSelection = ({ latitude, longitude, onSelect }: Omit<LocationMapPickerProps, "resolving">) => {
  const map = useMapEvents({
    click: (event) => {
      if (map.getZoom() < 14) {
        map.flyTo(event.latlng, 14)
        return
      }
      onSelect(event.latlng.lat, event.latlng.lng)
    },
  })
  return latitude != null && longitude != null
    ? <CircleMarker center={[latitude, longitude]} pathOptions={{ color: "#fffaf6", fillColor: "#db7b56", fillOpacity: 1, weight: 3 }} radius={9} />
    : null
}

const MapFocus = ({ latitude, longitude }: Pick<LocationMapPickerProps, "latitude" | "longitude">) => {
  const map = useMap()
  useEffect(() => {
    if (latitude != null && longitude != null) map.flyTo([latitude, longitude], Math.max(map.getZoom(), 16))
  }, [latitude, longitude, map])
  return null
}

const LocationMapPicker = ({ latitude, longitude, resolving, onSelect }: LocationMapPickerProps) => (
  <div className="location-map-picker">
    <div className="location-map-heading">
      <div><strong>Choose the delivery point</strong><p>Tap an area to zoom in, then tap the exact building or entrance.</p></div>
      {resolving && <span><LoaderCircle className="spin" size={15} /> Finding address...</span>}
    </div>
    <MapContainer
      center={latitude != null && longitude != null ? [latitude, longitude] : [20.5937, 78.9629]}
      className="location-map"
      scrollWheelZoom
      zoom={latitude != null && longitude != null ? 16 : 5}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapSelection latitude={latitude} longitude={longitude} onSelect={onSelect} />
      <MapFocus latitude={latitude} longitude={longitude} />
    </MapContainer>
  </div>
)

export default LocationMapPicker
