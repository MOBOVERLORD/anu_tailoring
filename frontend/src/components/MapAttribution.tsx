import { mapProviderLabel } from "@/utils/maps"

interface MapAttributionProps {
  className?: string
  provider: string
}

export const MapAttribution = ({ className = "", provider }: MapAttributionProps) => provider === "openstreetmap"
  ? <a className={`map-attribution ${className}`.trim()} href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">Route data © OpenStreetMap contributors</a>
  : <span className={`map-attribution ${className}`.trim()}>Route data via {mapProviderLabel(provider)}</span>
