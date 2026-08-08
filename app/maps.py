import asyncio
from dataclasses import dataclass
import re
from time import monotonic
from urllib.parse import urlparse

import httpx

from app.config import settings


PUBLIC_NOMINATIM_HOST = "nominatim.openstreetmap.org"
PUBLIC_OSRM_HOST = "router.project-osrm.org"


class MapProviderError(RuntimeError):
    """Safe map-provider error that never includes credentials or raw responses."""


@dataclass(frozen=True)
class GeocodedLocation:
    formatted_address: str
    place_id: str
    latitude: float
    longitude: float
    street_address: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    country: str | None = None


@dataclass(frozen=True)
class DrivingRoute:
    distance_meters: int
    duration_seconds: int | None


_osm_request_lock = asyncio.Lock()
_osm_last_request_at = 0.0


def configured_maps_provider() -> str:
    provider = settings.MAPS_PROVIDER.strip().lower()
    return "openstreetmap" if provider == "osm" else provider


def maps_provider_label() -> str:
    return {
        "openstreetmap": "OpenStreetMap",
        "google": "Google Maps",
    }.get(configured_maps_provider(), "Unknown map provider")


def _host(value: str) -> str:
    return (urlparse(value).hostname or "").lower()


def using_public_osm_services() -> bool:
    return (
        _host(settings.OSM_NOMINATIM_URL) == PUBLIC_NOMINATIM_HOST
        or _host(settings.OSM_ROUTING_URL) == PUBLIC_OSRM_HOST
    )


def maps_configured() -> bool:
    provider = configured_maps_provider()
    if provider == "google":
        return bool(settings.GOOGLE_MAPS_API_KEY)
    if provider != "openstreetmap":
        return False
    if not settings.OSM_NOMINATIM_URL or not settings.OSM_ROUTING_URL:
        return False
    return bool(
        settings.is_development
        or settings.OSM_ALLOW_PUBLIC_SERVICES_IN_PRODUCTION
        or not using_public_osm_services()
    )


def maps_configuration_message() -> str:
    provider = configured_maps_provider()
    if provider == "google" and not settings.GOOGLE_MAPS_API_KEY:
        return "Add GOOGLE_MAPS_API_KEY to use Google Maps delivery routing"
    if provider == "openstreetmap" and using_public_osm_services() and not (
        settings.is_development or settings.OSM_ALLOW_PUBLIC_SERVICES_IN_PRODUCTION
    ):
        return (
            "Configure production Nominatim and OSRM endpoints; public OpenStreetMap "
            "services are limited to low-volume development use"
        )
    if provider not in {"openstreetmap", "google"}:
        return "Set MAPS_PROVIDER to openstreetmap or google"
    if not maps_configured():
        return f"{maps_provider_label()} delivery routing is not configured"
    return f"{maps_provider_label()} delivery routing is ready"


def location_reference_matches_provider(reference: str | None) -> bool:
    if not reference:
        return False
    provider = configured_maps_provider()
    if provider == "openstreetmap":
        return reference.startswith("osm:")
    if provider == "google":
        # Raw identifiers support rows geocoded before provider prefixes existed.
        return reference.startswith("google:") or ":" not in reference
    return False


def _osm_headers() -> dict[str, str]:
    return {
        "User-Agent": (
            f"{settings.APP_NAME}/0.1 (+{settings.PUBLIC_APP_URL}; "
            f"contact: {settings.VENDOR_CONTACT_EMAIL})"
        ),
        "Accept": "application/json",
        "Accept-Language": "en-IN,en;q=0.8",
    }


def _first_address_value(address: dict, *keys: str) -> str | None:
    for key in keys:
        value = str(address.get(key, "")).strip()
        if value:
            return value
    return None


def _osm_address_fields(result: dict) -> dict[str, str | None]:
    address = result.get("address") or {}
    road = _first_address_value(address, "road", "pedestrian", "path")
    house_number = _first_address_value(address, "house_number")
    feature_name = str(result.get("name", "")).strip() or None
    area = _first_address_value(
        address, "neighbourhood", "suburb", "quarter", "residential", "hamlet"
    )
    street_parts: list[str] = []
    if feature_name and feature_name not in {road, area}:
        street_parts.append(feature_name)
    if house_number and road:
        street_parts.append(f"{house_number}, {road}")
    elif house_number or road:
        street_parts.append(house_number or road or "")
    if area and area not in street_parts:
        street_parts.append(area)

    return {
        "street_address": ", ".join(part for part in street_parts if part) or None,
        "city": (
            _first_address_value(
                address, "city", "town", "village", "municipality", "city_district"
            )
            # Indian OpenStreetMap results frequently omit city boundaries and
            # expose the usable locality as suburb (for example, Nizampet).
            or area
            or _first_address_value(address, "state_district", "county")
        ),
        "state": _first_address_value(address, "state"),
        "postal_code": _first_address_value(address, "postcode"),
        "country": _first_address_value(address, "country"),
    }


def _google_address_fields(result: dict) -> dict[str, str | None]:
    by_type: dict[str, str] = {}
    for component in result.get("address_components", []):
        value = str(component.get("long_name", "")).strip()
        for component_type in component.get("types", []):
            if value and component_type not in by_type:
                by_type[component_type] = value

    street_parts = []
    premise = by_type.get("subpremise") or by_type.get("premise")
    street_number = by_type.get("street_number")
    route = by_type.get("route")
    if premise:
        street_parts.append(premise)
    if street_number and route:
        street_parts.append(f"{street_number}, {route}")
    elif street_number or route:
        street_parts.append(street_number or route or "")
    for component_type in (
        "neighborhood", "sublocality_level_2", "sublocality_level_1", "sublocality"
    ):
        value = by_type.get(component_type)
        if value and value not in street_parts:
            street_parts.append(value)

    return {
        "street_address": ", ".join(part for part in street_parts if part) or None,
        "city": (
            by_type.get("locality")
            or by_type.get("postal_town")
            or by_type.get("administrative_area_level_2")
        ),
        "state": by_type.get("administrative_area_level_1"),
        "postal_code": by_type.get("postal_code"),
        "country": by_type.get("country"),
    }


async def _respect_osm_rate_limit() -> None:
    global _osm_last_request_at
    interval = max(0.0, settings.OSM_MIN_REQUEST_INTERVAL_SECONDS)
    async with _osm_request_lock:
        wait_for = interval - (monotonic() - _osm_last_request_at)
        if wait_for > 0:
            await asyncio.sleep(wait_for)
        _osm_last_request_at = monotonic()


async def _geocode_with_openstreetmap(address: str) -> GeocodedLocation:
    await _respect_osm_rate_limit()
    try:
        async with httpx.AsyncClient(timeout=settings.MAPS_HTTP_TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"{settings.OSM_NOMINATIM_URL.rstrip('/')}/search",
                headers=_osm_headers(),
                params={
                    "q": address,
                    "format": "jsonv2",
                    "addressdetails": 1,
                    "limit": 1,
                    "countrycodes": "in",
                },
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise MapProviderError("OpenStreetMap could not verify this address right now") from exc

    if not isinstance(payload, list) or not payload:
        raise MapProviderError(
            "OpenStreetMap could not find this address; add more street and postal details"
        )
    result = payload[0]
    try:
        latitude = float(result["lat"])
        longitude = float(result["lon"])
        osm_type = str(result["osm_type"])
        osm_id = str(result["osm_id"])
        formatted_address = str(result["display_name"])
    except (KeyError, TypeError, ValueError) as exc:
        raise MapProviderError("OpenStreetMap returned an incomplete address result") from exc
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise MapProviderError("OpenStreetMap returned invalid address coordinates")
    return GeocodedLocation(
        formatted_address=formatted_address,
        place_id=f"osm:{osm_type}:{osm_id}",
        latitude=latitude,
        longitude=longitude,
    )


async def _reverse_geocode_with_openstreetmap(
    latitude: float, longitude: float
) -> GeocodedLocation:
    await _respect_osm_rate_limit()
    try:
        async with httpx.AsyncClient(timeout=settings.MAPS_HTTP_TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"{settings.OSM_NOMINATIM_URL.rstrip('/')}/reverse",
                headers=_osm_headers(),
                params={
                    "lat": latitude,
                    "lon": longitude,
                    "format": "jsonv2",
                    "addressdetails": 1,
                    "zoom": 18,
                },
            )
            response.raise_for_status()
            result = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise MapProviderError("OpenStreetMap could not identify this location right now") from exc

    if not isinstance(result, dict) or result.get("error"):
        raise MapProviderError("OpenStreetMap could not find an address at this location")
    address = result.get("address") or {}
    if str(address.get("country_code", "")).lower() != "in":
        raise MapProviderError("The selected location must be within India")
    try:
        resolved_latitude = float(result["lat"])
        resolved_longitude = float(result["lon"])
        osm_type = str(result["osm_type"])
        osm_id = str(result["osm_id"])
        formatted_address = str(result["display_name"])
    except (KeyError, TypeError, ValueError) as exc:
        raise MapProviderError("OpenStreetMap returned an incomplete location result") from exc
    return GeocodedLocation(
        formatted_address=formatted_address,
        place_id=f"osm:{osm_type}:{osm_id}",
        # Preserve the device point rather than snapping delivery to the map feature centroid.
        latitude=latitude if -90 <= latitude <= 90 else resolved_latitude,
        longitude=longitude if -180 <= longitude <= 180 else resolved_longitude,
        **_osm_address_fields(result),
    )


async def _route_with_osrm(
    origin_latitude: float,
    origin_longitude: float,
    destination_latitude: float,
    destination_longitude: float,
) -> DrivingRoute:
    await _respect_osm_rate_limit()
    coordinates = (
        f"{origin_longitude:.7f},{origin_latitude:.7f};"
        f"{destination_longitude:.7f},{destination_latitude:.7f}"
    )
    try:
        async with httpx.AsyncClient(timeout=settings.MAPS_HTTP_TIMEOUT_SECONDS) as client:
            response = await client.get(
                f"{settings.OSM_ROUTING_URL.rstrip('/')}/route/v1/driving/{coordinates}",
                headers=_osm_headers(),
                params={"overview": "false", "steps": "false", "alternatives": "false"},
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise MapProviderError("OpenStreetMap routing is unavailable right now") from exc

    routes = payload.get("routes") if isinstance(payload, dict) else None
    if payload.get("code") != "Ok" or not routes:
        raise MapProviderError("No driving route was found between vendor and customer")
    try:
        distance_meters = round(float(routes[0]["distance"]))
        duration_seconds = round(float(routes[0]["duration"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise MapProviderError("OpenStreetMap returned an incomplete route result") from exc
    if distance_meters <= 0:
        raise MapProviderError("The delivery route distance is invalid")
    return DrivingRoute(
        distance_meters=distance_meters,
        duration_seconds=duration_seconds if duration_seconds >= 0 else None,
    )


async def _geocode_with_google(address: str) -> GeocodedLocation:
    if not settings.GOOGLE_MAPS_API_KEY:
        raise MapProviderError("Google Maps delivery calculation is not configured")
    try:
        async with httpx.AsyncClient(timeout=settings.MAPS_HTTP_TIMEOUT_SECONDS) as client:
            response = await client.get(
                "https://maps.googleapis.com/maps/api/geocode/json",
                params={"address": address, "region": "in", "key": settings.GOOGLE_MAPS_API_KEY},
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise MapProviderError("Google could not verify this address right now") from exc

    api_status = payload.get("status")
    if api_status == "ZERO_RESULTS":
        raise MapProviderError("Google could not find this address; add more street and postal details")
    if api_status != "OK" or not payload.get("results"):
        raise MapProviderError("Google Maps rejected the address lookup")
    result = payload["results"][0]
    location = result.get("geometry", {}).get("location", {})
    try:
        return GeocodedLocation(
            formatted_address=result["formatted_address"],
            place_id=f"google:{result['place_id']}",
            latitude=float(location["lat"]),
            longitude=float(location["lng"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise MapProviderError("Google returned an incomplete address result") from exc


async def _reverse_geocode_with_google(
    latitude: float, longitude: float
) -> GeocodedLocation:
    if not settings.GOOGLE_MAPS_API_KEY:
        raise MapProviderError("Google Maps delivery calculation is not configured")
    try:
        async with httpx.AsyncClient(timeout=settings.MAPS_HTTP_TIMEOUT_SECONDS) as client:
            response = await client.get(
                "https://maps.googleapis.com/maps/api/geocode/json",
                params={
                    "latlng": f"{latitude},{longitude}",
                    "result_type": "street_address|premise|subpremise|route",
                    "key": settings.GOOGLE_MAPS_API_KEY,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise MapProviderError("Google could not identify this location right now") from exc

    if payload.get("status") == "ZERO_RESULTS":
        raise MapProviderError("Google could not find an address at this location")
    if payload.get("status") != "OK" or not payload.get("results"):
        raise MapProviderError("Google Maps rejected the location lookup")
    result = payload["results"][0]
    country_codes = {
        component.get("short_name")
        for component in result.get("address_components", [])
        if "country" in component.get("types", [])
    }
    if "IN" not in country_codes:
        raise MapProviderError("The selected location must be within India")
    try:
        return GeocodedLocation(
            formatted_address=result["formatted_address"],
            place_id=f"google:{result['place_id']}",
            latitude=latitude,
            longitude=longitude,
            **_google_address_fields(result),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise MapProviderError("Google returned an incomplete location result") from exc


async def _route_with_google(
    origin_latitude: float,
    origin_longitude: float,
    destination_latitude: float,
    destination_longitude: float,
) -> DrivingRoute:
    if not settings.GOOGLE_MAPS_API_KEY:
        raise MapProviderError("Google Maps delivery calculation is not configured")
    request_body = {
        "origins": [{"waypoint": {"location": {"latLng": {
            "latitude": origin_latitude, "longitude": origin_longitude,
        }}}}],
        "destinations": [{"waypoint": {"location": {"latLng": {
            "latitude": destination_latitude, "longitude": destination_longitude,
        }}}}],
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
        "units": "METRIC",
    }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "originIndex,destinationIndex,status,condition,distanceMeters,duration",
    }
    try:
        async with httpx.AsyncClient(timeout=settings.MAPS_HTTP_TIMEOUT_SECONDS) as client:
            response = await client.post(
                "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
                headers=headers,
                json=request_body,
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise MapProviderError("Google could not calculate the delivery route right now") from exc
    element = payload[0] if isinstance(payload, list) and payload else None
    if not element or element.get("condition") != "ROUTE_EXISTS":
        raise MapProviderError("No driving route was found between vendor and customer")
    try:
        distance_meters = int(element["distanceMeters"])
    except (KeyError, TypeError, ValueError) as exc:
        raise MapProviderError("Google returned an incomplete route result") from exc
    if distance_meters <= 0:
        raise MapProviderError("The delivery distance returned by Google is invalid")
    duration_match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)s", element.get("duration", ""))
    duration_seconds = round(float(duration_match.group(1))) if duration_match else None
    return DrivingRoute(distance_meters=distance_meters, duration_seconds=duration_seconds)


async def geocode_address(address: str) -> GeocodedLocation:
    if not maps_configured():
        raise MapProviderError(maps_configuration_message())
    if configured_maps_provider() == "openstreetmap":
        return await _geocode_with_openstreetmap(address)
    return await _geocode_with_google(address)


async def reverse_geocode_location(
    latitude: float, longitude: float
) -> GeocodedLocation:
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise MapProviderError("The device returned invalid location coordinates")
    if not maps_configured():
        raise MapProviderError(maps_configuration_message())
    if configured_maps_provider() == "openstreetmap":
        return await _reverse_geocode_with_openstreetmap(latitude, longitude)
    return await _reverse_geocode_with_google(latitude, longitude)


async def compute_driving_route(
    origin_latitude: float,
    origin_longitude: float,
    destination_latitude: float,
    destination_longitude: float,
) -> DrivingRoute:
    if not maps_configured():
        raise MapProviderError(maps_configuration_message())
    if configured_maps_provider() == "openstreetmap":
        return await _route_with_osrm(
            origin_latitude,
            origin_longitude,
            destination_latitude,
            destination_longitude,
        )
    return await _route_with_google(
        origin_latitude,
        origin_longitude,
        destination_latitude,
        destination_longitude,
    )
