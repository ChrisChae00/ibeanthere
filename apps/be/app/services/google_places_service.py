"""
Google Places API (New) service for extracting cafe information from Google Maps URLs.

Supports:
- Standard Google Maps place URLs
- Short links (maps.app.goo.gl)
- CID-based URLs

Uses field masks to minimize API cost.
"""

import httpx
import re
import logging
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse, unquote, parse_qs, urlencode, urlunparse

logger = logging.getLogger(__name__)


class GooglePlacesService:
    """Service for looking up place details from Google Maps URLs."""
    
    PLACES_API_BASE = "https://places.googleapis.com/v1/places"
    
    # Field mask for Place Details — request only what we need to minimize cost
    # Basic fields (no charge): displayName, location
    # Contact fields ($3/1000): nationalPhoneNumber, websiteUri
    # Atmosphere fields ($5/1000): regularOpeningHours
    FIELD_MASK = ",".join([
        "id",  # place_id — stored server-side as the cafe's Google identity
        "displayName",
        "formattedAddress",
        "location",
        "nationalPhoneNumber",
        "internationalPhoneNumber",
        "websiteUri",
        "regularOpeningHours",
        "googleMapsUri",
    ])
    
    # The registrant is standing in the cafe, so the nearest few are enough.
    AUTOCOMPLETE_LIMIT = 5

    def __init__(self, api_key: str):
        self.api_key = api_key

    async def get_first_photo(self, place_id: str) -> Optional[Dict[str, Any]]:
        """Return fresh metadata for the first usable photo; photo names are never cached."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{self.PLACES_API_BASE}/{place_id}",
                headers={
                    "X-Goog-Api-Key": self.api_key,
                    "X-Goog-FieldMask": "id,photos",
                },
            )
            response.raise_for_status()

        photos = response.json().get("photos") or []
        if not photos or not photos[0].get("googleMapsUri"):
            return None
        return photos[0]

    async def get_photo_uri(self, photo_name: str) -> str:
        """Resolve a short-lived Google-hosted URI without following the redirect."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"https://places.googleapis.com/v1/{photo_name}/media",
                headers={"X-Goog-Api-Key": self.api_key},
                params={
                    "maxWidthPx": 800,
                    "maxHeightPx": 600,
                    "skipHttpRedirect": "true",
                },
            )
            response.raise_for_status()

        photo_uri = response.json().get("photoUri")
        if not photo_uri:
            raise ValueError("Google Place Photo response omitted photoUri")
        return photo_uri

    async def find_place_id_for_cafe(
        self, name: str, address: str, latitude: float, longitude: float
    ) -> Optional[Dict[str, Any]]:
        """Use IDs-only search, then fetch only the candidate id and location."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            search = await client.post(
                f"{self.PLACES_API_BASE}:searchText",
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": self.api_key,
                    "X-Goog-FieldMask": "places.id",
                },
                json={
                    "textQuery": " ".join(part for part in (name, address) if part),
                    "locationBias": {
                        "circle": {
                            "center": {"latitude": latitude, "longitude": longitude},
                            "radius": 200.0,
                        }
                    },
                },
            )
            search.raise_for_status()
            places = search.json().get("places") or []
            if not places:
                return None

            details = await client.get(
                f"{self.PLACES_API_BASE}/{places[0]['id']}",
                headers={
                    "X-Goog-Api-Key": self.api_key,
                    "X-Goog-FieldMask": "id,location",
                },
            )
            details.raise_for_status()
            return details.json()
    
    async def lookup_from_url(self, url: str) -> Optional[Dict[str, Any]]:
        """
        Extract cafe information from a Google Maps URL.
        
        1. Parse the URL to extract place name / coordinates / place ID
        2. Search for the place using the extracted info
        3. Return standardized place details
        
        Args:
            url: Google Maps URL
            
        Returns:
            Dict with cafe details or None if lookup fails
        """
        try:
            # Step 1: Resolve short links
            resolved_url = await self._resolve_short_link(url)
            
            # Step 2: Try to extract place ID from URL
            place_id = self._extract_place_id(resolved_url)
            
            if place_id:
                result = await self._get_place_details(place_id)
                if result:
                    return result

            # Step 3: Try to extract name and coordinates for text search
            name, lat, lng = self._extract_name_and_coords(resolved_url)
            
            if name or (lat and lng):
                place_id = await self._search_place(name, lat, lng)
                if place_id:
                    return await self._get_place_details(place_id)
            
            # Step 4: Try CID-based lookup as last resort
            cid = self._extract_cid(resolved_url)
            if cid:
                place_id = await self._search_place_by_cid(cid)
                if place_id:
                    return await self._get_place_details(place_id)
            
            logger.warning(f"Could not extract place info from URL: {resolved_url}")
            return None
            
        except Exception as e:
            logger.error(f"Google Places lookup error: {e}")
            return None
    
    async def _resolve_short_link(self, url: str) -> str:
        """Follow redirects for short URLs like maps.app.goo.gl or goo.gl/maps.

        Strips `g_st` query param, then issues a single request without a
        browser User-Agent so Google returns a 302 directly to a usable Maps
        URL (browser UAs trigger a Firebase JS page instead of a redirect).
        """
        parsed = urlparse(url)

        if parsed.hostname in ("maps.app.goo.gl", "goo.gl"):
            # Strip g_st to avoid mobile-specific redirect behavior
            params = parse_qs(parsed.query, keep_blank_values=True)
            params.pop("g_st", None)
            clean_query = urlencode({k: v[0] for k, v in params.items()})
            clean_url = urlunparse(parsed._replace(query=clean_query))

            try:
                # Default httpx UA triggers a 302 to a usable Maps URL
                async with httpx.AsyncClient(
                    follow_redirects=False,
                    timeout=10.0,
                ) as client:
                    response = await client.get(clean_url)
                    location = response.headers.get("location", "")
                    logger.info(
                        f"Short link: {clean_url} -> {response.status_code} -> {location!r}"
                    )
                    if location:
                        return location

                # Fallback: follow all redirects and return final URL
                async with httpx.AsyncClient(
                    follow_redirects=True,
                    timeout=10.0,
                ) as client:
                    response = await client.get(clean_url)
                    final_url = str(response.url)
                    logger.info(f"Short link final URL (fallback): {final_url}")
                    return final_url

            except Exception as e:
                logger.warning(f"Failed to resolve short link: {e}")
                return url

        return url
    
    def _extract_place_id(self, url: str) -> Optional[str]:
        """Extract Google Place ID from URL if present."""
        # Pattern: /place/.../data=...!1s<place_id>
        # Place IDs start with "ChIJ"
        match = re.search(r'!1s(ChIJ[A-Za-z0-9_-]+)', url)
        if match:
            return match.group(1)
        
        # Pattern: place_id=<id>
        match = re.search(r'place_id=([A-Za-z0-9_-]+)', url)
        if match:
            return match.group(1)
        
        # Pattern: ftid=0x...:0x... (explicit query param)
        match = re.search(r'ftid=(0x[a-f0-9]+:0x[a-f0-9]+)', url)
        if match:
            return match.group(1)
        
        return None
    
    def _extract_cid(self, url: str) -> Optional[str]:
        """Extract CID (Customer ID) from Google Maps URL.
        
        CID URLs look like: https://maps.google.com/?cid=6024271707753344746
        These appear when Google redirects short links via HEAD requests.
        """
        match = re.search(r'[?&]cid=(\d+)', url)
        if match:
            return match.group(1)
        return None
    
    async def _search_place_by_cid(self, cid: str) -> Optional[str]:
        """Search for a place using its CID by querying the CID URL.
        
        Google CID is a unique numeric identifier. We use it as a text
        query in the Places API to find the corresponding place.
        """
        try:
            # First, try to resolve the CID to a full URL with place info
            cid_url = f"https://maps.google.com/?cid={cid}"
            try:
                async with httpx.AsyncClient(
                    follow_redirects=True,
                    timeout=10.0,
                    headers={"User-Agent": "Mozilla/5.0"}
                ) as client:
                    response = await client.get(cid_url)
                    resolved = str(response.url)
                    
                    # Try to extract name and coords from the resolved URL
                    name, lat, lng = self._extract_name_and_coords(resolved)
                    if name or (lat and lng):
                        return await self._search_place(name, lat, lng)
            except Exception as e:
                logger.warning(f"Failed to resolve CID URL: {e}")
            
            # Fallback: use CID as a direct text search query
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{self.PLACES_API_BASE}:searchText",
                    headers={
                        "Content-Type": "application/json",
                        "X-Goog-Api-Key": self.api_key,
                        "X-Goog-FieldMask": "places.id",
                    },
                    json={"textQuery": f"cid:{cid}"},
                )
                
                if response.status_code == 200:
                    data = response.json()
                    places = data.get("places", [])
                    if places:
                        return places[0]["id"]
            
            return None
        except Exception as e:
            logger.error(f"CID search error: {e}")
            return None
    
    def _extract_name_and_coords(self, url: str) -> tuple:
        """Extract place name and coordinates from Google Maps URL."""
        name = None
        lat = None
        lng = None
        
        # Extract name from /place/Name+Here/ pattern
        place_match = re.search(r'/place/([^/@]+)', url)
        if place_match:
            name = unquote(place_match.group(1)).replace('+', ' ')
        
        # Extract coordinates from /@lat,lng pattern
        coords_match = re.search(r'@(-?\d+\.?\d*),(-?\d+\.?\d*)', url)
        if coords_match:
            lat = float(coords_match.group(1))
            lng = float(coords_match.group(2))
        
        # Also try ?q=lat,lng pattern
        if not (lat and lng):
            q_match = re.search(r'[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)', url)
            if q_match:
                lat = float(q_match.group(1))
                lng = float(q_match.group(2))

        # Extract name from ?q= parameter (used by maps.google.com redirect URLs)
        if not name:
            q_name = re.search(r'[?&]q=([^&]+)', url)
            if q_name:
                candidate = unquote(q_name.group(1)).replace('+', ' ')
                # Only use if it doesn't look like bare coordinates
                if not re.match(r'^-?\d+\.?\d*,-?\d+\.?\d*$', candidate.strip()):
                    name = candidate

        return name, lat, lng
    
    async def _search_place(
        self, name: Optional[str], lat: Optional[float], lng: Optional[float]
    ) -> Optional[str]:
        """Search for a place by name and/or coordinates, return place ID."""
        if not name and not (lat and lng):
            return None
        
        try:
            search_body: Dict[str, Any] = {}
            
            if name:
                search_body["textQuery"] = name
            elif lat and lng:
                search_body["textQuery"] = f"{lat},{lng}"
            
            if lat and lng:
                search_body["locationBias"] = {
                    "circle": {
                        "center": {"latitude": lat, "longitude": lng},
                        "radius": 200.0  # 200m radius
                    }
                }
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{self.PLACES_API_BASE}:searchText",
                    headers={
                        "Content-Type": "application/json",
                        "X-Goog-Api-Key": self.api_key,
                        "X-Goog-FieldMask": "places.id",
                    },
                    json=search_body,
                )
                
                if response.status_code == 200:
                    data = response.json()
                    places = data.get("places", [])
                    if places:
                        return places[0]["id"]
                else:
                    logger.warning(f"Places text search failed: {response.status_code} - {response.text}")
            
            return None
            
        except Exception as e:
            logger.error(f"Places text search error: {e}")
            return None
    
    async def autocomplete(
        self,
        query: str,
        session_token: str,
        lat: Optional[float] = None,
        lng: Optional[float] = None,
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Suggest cafes for a partial name. None means Google failed, [] means no match.

        The session token ties these keystrokes to the Place Details call that ends
        them; Google bills that session as one Details call instead of per request.
        """
        body: Dict[str, Any] = {
            "input": query,
            "sessionToken": session_token,
            "includedPrimaryTypes": ["cafe", "coffee_shop"],
        }
        if lat is not None and lng is not None:
            body["locationBias"] = {
                "circle": {
                    "center": {"latitude": lat, "longitude": lng},
                    "radius": 5000.0,
                }
            }
            # origin makes Google return distanceMeters, which the list is sorted by.
            body["origin"] = {"latitude": lat, "longitude": lng}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{self.PLACES_API_BASE}:autocomplete",
                    headers={
                        "Content-Type": "application/json",
                        "X-Goog-Api-Key": self.api_key,
                    },
                    json=body,
                )
            if response.status_code != 200:
                logger.warning(f"Places autocomplete failed: {response.status_code} - {response.text}")
                return None
            suggestions = []
            for item in response.json().get("suggestions", []):
                prediction = item.get("placePrediction")
                if not prediction or not prediction.get("placeId"):
                    continue
                fmt = prediction.get("structuredFormat", {})
                suggestions.append({
                    "distance": prediction.get("distanceMeters"),
                    "place_id": prediction["placeId"],
                    "name": fmt.get("mainText", {}).get("text")
                        or prediction.get("text", {}).get("text", ""),
                    "secondary": fmt.get("secondaryText", {}).get("text", ""),
                })
            # Nearest first; without an origin Google's relevance order stands.
            suggestions.sort(key=lambda s: s["distance"] if s["distance"] is not None else float("inf"))
            for suggestion in suggestions:
                del suggestion["distance"]
            return suggestions[:self.AUTOCOMPLETE_LIMIT]
        except Exception as e:
            logger.error(f"Places autocomplete error: {e}")
            return None

    async def _get_place_details(
        self,
        place_id: str,
        session_token: Optional[str] = None,
        field_mask: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Get place details from Google Places API and return standardized format."""
        try:
            logger.info(f"Getting place details for place_id: {place_id}")
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.PLACES_API_BASE}/{place_id}",
                    params={"sessionToken": session_token} if session_token else None,
                    headers={
                        "Content-Type": "application/json",
                        "X-Goog-Api-Key": self.api_key,
                        "X-Goog-FieldMask": field_mask or self.FIELD_MASK,
                    },
                )
                
                if response.status_code == 200:
                    data = response.json()
                    result = self._format_response(data)
                    if not result.get("place_id"):
                        result["place_id"] = place_id
                    return result
                else:
                    logger.warning(f"Place details failed: {response.status_code} - {response.text}")
                    return None
                    
        except Exception as e:
            logger.error(f"Place details error: {e}")
            return None
    
    def _format_response(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Convert Google Places API response to our standard format."""
        result: Dict[str, Any] = {}

        # Google's stable id for this place. Only the server ever writes it to the
        # cafes row; the registration path re-looks-it-up rather than trusting the
        # client with it.
        result["place_id"] = data.get("id")
        
        # Name
        display_name = data.get("displayName", {})
        if isinstance(display_name, dict):
            result["name"] = display_name.get("text", "")
        elif isinstance(display_name, str):
            result["name"] = display_name
        
        # Address
        result["address"] = data.get("formattedAddress", "")
        
        # Coordinates
        location = data.get("location", {})
        result["latitude"] = location.get("latitude")
        result["longitude"] = location.get("longitude")
        
        # Phone
        result["phone"] = (
            data.get("internationalPhoneNumber")
            or data.get("nationalPhoneNumber")
        )
        
        # Website
        result["website"] = data.get("websiteUri")
        
        # Google Maps URL
        result["google_maps_url"] = data.get("googleMapsUri")
        
        # Business hours
        opening_hours = data.get("regularOpeningHours", {})
        if opening_hours and opening_hours.get("periods"):
            result["business_hours"] = self._format_business_hours(opening_hours)
        
        return result
    
    def _format_business_hours(self, opening_hours: Dict[str, Any]) -> Dict[str, Any]:
        """Convert Google Places opening hours to our BusinessHours format."""
        day_names = [
            "sunday", "monday", "tuesday", "wednesday",
            "thursday", "friday", "saturday"
        ]
        
        # Initialize all days as closed
        hours: Dict[str, Any] = {}
        for day in day_names:
            hours[day] = {"open": "", "close": "", "closed": True}
        
        periods = opening_hours.get("periods", [])
        for period in periods:
            open_info = period.get("open", {})
            close_info = period.get("close", {})
            
            day_index = open_info.get("day")
            if day_index is None or day_index >= len(day_names):
                continue
            
            day_name = day_names[day_index]
            
            open_hour = open_info.get("hour", 0)
            open_minute = open_info.get("minute", 0)

            close_hour = close_info.get("hour", 0)
            close_minute = close_info.get("minute", 0)

            # If close day differs from open day, close is past midnight — add 24h
            close_day = close_info.get("day")
            if close_day is not None and close_day != day_index:
                close_hour += 24

            hours[day_name] = {
                "open": f"{open_hour:02d}:{open_minute:02d}",
                "close": f"{close_hour:02d}:{close_minute:02d}",
                "closed": False,
            }
        
        return hours
