"""Compatibility exports for code that imported the original Google-only module."""

from app.maps import (
    DrivingRoute,
    GeocodedLocation,
    MapProviderError,
    compute_driving_route,
    geocode_address,
    maps_configured,
)


GoogleMapsError = MapProviderError

__all__ = [
    "DrivingRoute",
    "GeocodedLocation",
    "GoogleMapsError",
    "MapProviderError",
    "compute_driving_route",
    "geocode_address",
    "maps_configured",
]
