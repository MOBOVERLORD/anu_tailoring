from dataclasses import dataclass
import re

import httpx

from app.config import settings


class GoogleMapsError(RuntimeError):
    """Safe provider error that never includes credentials or raw responses."""


@dataclass(frozen=True)
class GeocodedLocation:
    formatted_address: str
    place_id: str
    latitude: float
    longitude: float


@dataclass(frozen=True)
class DrivingRoute:
    distance_meters: int
    duration_seconds: int | None


def maps_configured() -> bool:
    return bool(settings.GOOGLE_MAPS_API_KEY)


async def geocode_address(address: str) -> GeocodedLocation:
    """Resolve a postal address on the backend with Google's Geocoding API."""
    if not settings.GOOGLE_MAPS_API_KEY:
        raise GoogleMapsError("Google Maps delivery calculation is not configured")

    try:
        async with httpx.AsyncClient(timeout=settings.GOOGLE_MAPS_TIMEOUT_SECONDS) as client:
            response = await client.get(
                "https://maps.googleapis.com/maps/api/geocode/json",
                params={
                    "address": address,
                    "region": "in",
                    "key": settings.GOOGLE_MAPS_API_KEY,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GoogleMapsError("Google could not verify this address right now") from exc

    api_status = payload.get("status")
    if api_status == "ZERO_RESULTS":
        raise GoogleMapsError("Google could not find this address; add more street and postal details")
    if api_status != "OK" or not payload.get("results"):
        raise GoogleMapsError("Google Maps rejected the address lookup")

    result = payload["results"][0]
    location = result.get("geometry", {}).get("location", {})
    try:
        return GeocodedLocation(
            formatted_address=result["formatted_address"],
            place_id=result["place_id"],
            latitude=float(location["lat"]),
            longitude=float(location["lng"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise GoogleMapsError("Google returned an incomplete address result") from exc


async def compute_driving_route(
    origin_latitude: float,
    origin_longitude: float,
    destination_latitude: float,
    destination_longitude: float,
) -> DrivingRoute:
    """Return driving distance and duration from Routes Compute Route Matrix."""
    if not settings.GOOGLE_MAPS_API_KEY:
        raise GoogleMapsError("Google Maps delivery calculation is not configured")

    request_body = {
        "origins": [{
            "waypoint": {"location": {"latLng": {
                "latitude": origin_latitude,
                "longitude": origin_longitude,
            }}},
        }],
        "destinations": [{
            "waypoint": {"location": {"latLng": {
                "latitude": destination_latitude,
                "longitude": destination_longitude,
            }}},
        }],
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
        "units": "METRIC",
    }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": (
            "originIndex,destinationIndex,status,condition,distanceMeters,duration"
        ),
    }
    try:
        async with httpx.AsyncClient(timeout=settings.GOOGLE_MAPS_TIMEOUT_SECONDS) as client:
            response = await client.post(
                "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
                headers=headers,
                json=request_body,
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GoogleMapsError("Google could not calculate the delivery route right now") from exc

    element = payload[0] if isinstance(payload, list) and payload else None
    if not element or element.get("condition") != "ROUTE_EXISTS":
        raise GoogleMapsError("No driving route was found between vendor and customer")
    try:
        distance_meters = int(element["distanceMeters"])
    except (KeyError, TypeError, ValueError) as exc:
        raise GoogleMapsError("Google returned an incomplete route result") from exc
    if distance_meters <= 0:
        raise GoogleMapsError("The delivery distance returned by Google is invalid")

    duration_match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)s", element.get("duration", ""))
    duration_seconds = round(float(duration_match.group(1))) if duration_match else None
    return DrivingRoute(distance_meters=distance_meters, duration_seconds=duration_seconds)
